// Murmuration's OGL meshes and shaders. Everything here is built once per mount; frame() only
// writes uniforms and a few small CPU-side buffers. All colours are linear; bloom.ts converts the
// final image to sRGB.

import { Geometry, Mesh, Plane, Program, Texture, Triangle, type OGLRenderingContext } from "ogl";
import type { RGB } from "./look";

export const RING_R = 10;
export const LOOM_W = 6.4;
export const LOOM_H = 5.2;
export const LOOM_Y = 0.9; // bottom edge
export const HIST = 64; // flock centre history samples
export const HIST_STEP_MS = 20;
/** Escort squads: each owns a row of the history texture (row 0 is the main flock) and 1/12 of the birds. */
export const SQUADS = 8;
const ROWS = SQUADS + 1;
export const BRIGHT = 64; // bright-star slots
export const THREADS = 24;
export const THREAD_PTS = 36;

const VERT = /* glsl */ `#version 300 es
precision highp float;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
`;
const FRAG = /* glsl */ `#version 300 es
precision highp float;
out vec4 fragColor;
float dot2(vec2 c) { vec2 d = c - 0.5; return dot(d, d); }
`;

/** Additive light, as three's AdditiveBlending. */
function additive(gl: OGLRenderingContext, p: Program): Program {
  p.setBlendFunc(gl.SRC_ALPHA, gl.ONE);
  return p;
}

function points(gl: OGLRenderingContext, geometry: Geometry, program: Program, renderOrder: number): Mesh {
  return new Mesh(gl, { geometry, program, mode: gl.POINTS, frustumCulled: false, renderOrder });
}

/** A float or byte data texture, nearest-sampled, no mipmaps, rows bottom-up as uploaded. */
export function dataTexture(
  gl: OGLRenderingContext, image: Float32Array | Uint8Array, width: number, height: number, float: boolean,
): Texture {
  const g2 = gl as WebGL2RenderingContext; // the skin only runs on WebGL2
  return new Texture(gl, {
    image, width, height,
    type: float ? g2.FLOAT : g2.UNSIGNED_BYTE,
    format: float ? g2.RGBA : g2.RED,
    internalFormat: float ? g2.RGBA32F : g2.R8,
    minFilter: gl.NEAREST, magFilter: gl.NEAREST, generateMipmaps: false, flipY: false, unpackAlignment: 1,
  });
}

// ---------------------------------------------------------------------------
// Sky: a full-screen gradient drawn first.

export function makeSky(gl: OGLRenderingContext, top: RGB, bottom: RGB): Mesh {
  const program = new Program(gl, {
    vertex: /* glsl */ `#version 300 es
      in vec2 position; out float vY;
      void main() { vY = position.y * 0.5 + 0.5; gl_Position = vec4(position, 0.9999, 1.0); }`,
    fragment: /* glsl */ `${FRAG}
      uniform vec3 uTop, uBottom; in float vY;
      void main() { fragColor = vec4(mix(uBottom, uTop, smoothstep(0.0, 1.0, vY)), 1.0); }`,
    uniforms: { uTop: { value: top }, uBottom: { value: bottom } },
    depthTest: false, depthWrite: false, cullFace: false,
  });
  return new Mesh(gl, { geometry: new Triangle(gl), program, frustumCulled: false, renderOrder: -1 });
}

// ---------------------------------------------------------------------------
// Ring of faint stars (ring-local coordinates; the parent transform turns).

export function makeRing(gl: OGLRenderingContext, count: number, rand: () => number): Mesh {
  const pos = new Float32Array(count * 3);
  const size = new Float32Array(count);
  const bright = new Float32Array(count);
  const phase = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const a = rand() * Math.PI * 2;
    const g = (rand() + rand() + rand() - 1.5) * 0.9; // roughly normal
    const r = RING_R + g * (0.4 + rand() * 0.5);
    pos[i * 3] = Math.cos(a) * r;
    pos[i * 3 + 1] = (rand() + rand() - 1) * 0.25;
    pos[i * 3 + 2] = Math.sin(a) * r;
    size[i] = 0.8 + rand() * rand() * 2.2;
    bright[i] = 0.12 + rand() * rand() * 0.6;
    phase[i] = rand();
  }
  const geometry = new Geometry(gl, {
    position: { size: 3, data: pos }, aSize: { size: 1, data: size }, aBright: { size: 1, data: bright }, aPhase: { size: 1, data: phase },
  });
  const program = additive(gl, new Program(gl, {
    vertex: /* glsl */ `${VERT}
      in vec3 position; in float aSize; in float aBright; in float aPhase;
      uniform float uTime, uPx, uAlpha;
      out float vA;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        float tw = 0.7 + 0.3 * sin(uTime * (0.5 + aPhase) + aPhase * 40.0);
        vA = aBright * tw * uAlpha;
        gl_PointSize = max(1.0, aSize * uPx * 24.0 / -mv.z);
      }`,
    fragment: /* glsl */ `${FRAG}
      uniform vec3 uColor; in float vA;
      void main() {
        float a = (1.0 - smoothstep(0.0, 0.25, dot2(gl_PointCoord))) * vA;
        fragColor = vec4(uColor * a, 1.0);
      }`,
    // three's Color(0.75, 0.82, 1) is already linear
    uniforms: { uTime: { value: 0 }, uPx: { value: 1 }, uAlpha: { value: 1 }, uColor: { value: [0.75, 0.82, 1] } },
    transparent: true, depthWrite: false, cullFace: false,
  }));
  return points(gl, geometry, program, 0);
}

// ---------------------------------------------------------------------------
// Bright stars: seeds, the file's target, lookup flickers, chunk origins. CPU-updated (64 slots).

export function makeBright(gl: OGLRenderingContext): Mesh {
  const geometry = new Geometry(gl, {
    position: { size: 3, data: new Float32Array(BRIGHT * 3) },
    aColor: { size: 3, data: new Float32Array(BRIGHT * 3) },
    aSize: { size: 1, data: new Float32Array(BRIGHT) },
    aBright: { size: 1, data: new Float32Array(BRIGHT) },
  });
  const program = additive(gl, new Program(gl, {
    vertex: /* glsl */ `${VERT}
      in vec3 position; in vec3 aColor; in float aSize; in float aBright;
      uniform float uPx;
      out vec3 vC; out float vA;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        vC = aColor; vA = aBright;
        gl_PointSize = aBright <= 0.001 ? 0.0 : max(2.0, aSize * uPx * 24.0 / -mv.z);
      }`,
    fragment: /* glsl */ `${FRAG}
      in vec3 vC; in float vA;
      void main() {
        float d = dot2(gl_PointCoord);
        float a = (exp(-d * 60.0) + 0.35 * exp(-d * 12.0)) * (1.0 - smoothstep(0.18, 0.25, d)) * vA;
        fragColor = vec4(vC * a, 1.0);
      }`,
    uniforms: { uPx: { value: 1 } },
    transparent: true, depthWrite: false, cullFace: false,
  }));
  return points(gl, geometry, program, 0);
}

// ---------------------------------------------------------------------------
// The flock: GPU particles that trail a CPU-steered centre path (a history texture), folding like
// starlings through a shared wave field.

export function makeHistory(gl: OGLRenderingContext): Texture {
  return dataTexture(gl, new Float32Array(HIST * ROWS * 4), HIST, ROWS, true);
}

export function makeFlock(gl: OGLRenderingContext, count: number, rand: () => number, hist: Texture): Mesh {
  const off = new Float32Array(count * 4);
  const rnd = new Float32Array(count * 4);
  const squad = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    // A flattened, dense-cored blob.
    let x = 0, y = 0, z = 0;
    do { x = rand() * 2 - 1; y = rand() * 2 - 1; z = rand() * 2 - 1; } while (x * x + y * y + z * z > 1);
    const k = 0.55 + 0.45 * Math.sqrt(rand());
    // A thin sheet: the folds of the wave field turn it into ribbons.
    off[i * 4] = x * k * 1.9;
    off[i * 4 + 1] = y * k * 0.3;
    off[i * 4 + 2] = z * k * 1.2;
    off[i * 4 + 3] = Math.pow(rand(), 1.6); // delay along the path: most birds near the front
    rnd[i * 4] = rand() * 6.283;
    rnd[i * 4 + 1] = 0.25 + rand() * 0.5;
    rnd[i * 4 + 2] = rand();
    rnd[i * 4 + 3] = rand();
    squad[i] = i % 12 < SQUADS ? (i % 12) + 1 : 0;
  }
  const geometry = new Geometry(gl, { aOff: { size: 4, data: off }, aRnd: { size: 4, data: rnd }, aSquad: { size: 1, data: squad } });
  const program = additive(gl, new Program(gl, {
    vertex: /* glsl */ `${VERT}
      in vec4 aOff; in vec4 aRnd; in float aSquad;
      uniform sampler2D uHist;
      uniform float uTime, uPx, uAlpha, uScatter, uWave, uSize;
      out float vA; out float vMix;
      void main() {
        vec4 h = texture(uHist, vec2((aOff.w * ${HIST - 1}.0 + 0.5) / ${HIST}.0, 0.5 / ${ROWS}.0));
        vec3 o = aOff.xyz;
        float t = uTime * aRnd.y + aRnd.x;
        float c = cos(t * 0.35), s = sin(t * 0.35);
        o.xz = mat2(c, -s, s, c) * o.xz;
        // Shared folds: the whole flock bends and thins together.
        o.y += uWave * 0.55 * sin(o.x * 1.9 + uTime * 0.83);
        o.x += uWave * 0.45 * sin(o.z * 1.4 + uTime * 0.61 + o.y * 1.3);
        o.z += uWave * 0.35 * sin(o.x * 1.1 - uTime * 0.47);
        vec3 p = h.xyz + o * h.w;
        if (aSquad > 0.5) {
          // An escort squad: a tight streak on its own path, blended in and out by its weight (q.w).
          vec4 q = texture(uHist, vec2((aOff.w * ${Math.floor((HIST - 1) / 2)}.0 + 0.5) / ${HIST}.0, (aSquad + 0.5) / ${ROWS}.0));
          p = mix(p, q.xyz + o * 0.5, q.w);
        }
        vec3 dir = normalize(aOff.xyz + vec3(0.0, 0.0001, 0.0));
        p += dir * uScatter * (0.4 + aRnd.w) * 7.0;
        p.y += uScatter * uScatter * (aRnd.z - 0.3) * 3.0;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        // Density waves sweep through the flock, like the dark bands in a starling murmuration.
        float band = 0.5 + 0.5 * sin(dot(aOff.xyz, vec3(2.3, 1.1, 1.7)) * 1.6 - uTime * 1.3);
        vA = uAlpha * (0.45 + 0.55 * aRnd.z) * (1.0 - 0.5 * aOff.w) * mix(1.0, 0.25 + 1.5 * band * band, min(1.0, uWave * 1.6));
        vMix = aRnd.w;
        gl_PointSize = max(1.0, uSize * (0.7 + aRnd.z * 0.6) * uPx * 24.0 / -mv.z);
      }`,
    fragment: /* glsl */ `${FRAG}
      uniform vec3 uColorA, uColorB; uniform float uGrey;
      in float vA; in float vMix;
      void main() {
        float a = (1.0 - smoothstep(0.04, 0.25, dot2(gl_PointCoord))) * vA;
        vec3 c = mix(uColorA, uColorB, step(0.7, vMix));
        c = mix(c, vec3(dot(c, vec3(0.3, 0.5, 0.2))) * 0.6, uGrey);
        fragColor = vec4(c * a, 1.0);
      }`,
    uniforms: {
      uHist: { value: hist }, uTime: { value: 0 }, uPx: { value: 1 }, uAlpha: { value: 0 },
      uScatter: { value: 0 }, uWave: { value: 0.6 }, uSize: { value: 1 },
      uColorA: { value: [1, 1, 1] }, uColorB: { value: [1, 1, 1] }, uGrey: { value: 0 },
    },
    transparent: true, depthWrite: false, cullFace: false,
  }));
  return points(gl, geometry, program, 3);
}

// ---------------------------------------------------------------------------
// Threads of light flying from a star into the loom (CPU-updated, world coordinates).

export function makeThreads(gl: OGLRenderingContext): Mesh {
  const n = THREADS * THREAD_PTS;
  const geometry = new Geometry(gl, {
    position: { size: 3, data: new Float32Array(n * 3) },
    aA: { size: 1, data: new Float32Array(n) },
    aSize: { size: 1, data: new Float32Array(n) },
  });
  const program = additive(gl, new Program(gl, {
    vertex: /* glsl */ `${VERT}
      in vec3 position; in float aA; in float aSize;
      uniform float uPx;
      out float vA;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        vA = aA;
        gl_PointSize = aA <= 0.001 ? 0.0 : max(1.5, aSize * uPx * 24.0 / -mv.z);
      }`,
    fragment: /* glsl */ `${FRAG}
      uniform vec3 uColor; uniform float uGrey;
      in float vA;
      void main() {
        float a = (1.0 - smoothstep(0.0, 0.25, dot2(gl_PointCoord))) * vA;
        vec3 c = mix(uColor, vec3(0.5), uGrey);
        fragColor = vec4(c * a, 1.0);
      }`,
    uniforms: { uPx: { value: 1 }, uColor: { value: [1, 1, 1] }, uGrey: { value: 0 } },
    transparent: true, depthWrite: false, cullFace: false,
  }));
  return points(gl, geometry, program, 4);
}

// ---------------------------------------------------------------------------
// The loom and tapestry. Each chunk reveals one row band of a seeded woven image; after
// verification the image settles into a portrait of the file's hash.

export function makeRowsTexture(gl: OGLRenderingContext, total: number): Texture {
  const w = 64, h = Math.max(1, Math.ceil(total / w));
  return dataTexture(gl, new Float32Array(w * h * 4), w, h, true);
}

export function makeLoom(gl: OGLRenderingContext, rows: Texture, portrait: Texture): Mesh {
  const program = new Program(gl, {
    vertex: /* glsl */ `${VERT}
      in vec3 position; in vec2 uv; out vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragment: /* glsl */ `${FRAG}
      uniform sampler2D uRows, uPortrait;
      uniform float uRowsW, uRowsH, uTotal, uTime, uAppear, uShimmer, uScan, uScanPos, uFlare, uGrey;
      uniform float uHashMix, uDim, uWarpFade, uReveal, uPattern, uGlow, uSRGB;
      uniform vec4 uDetail;
      uniform vec3 uC0, uC1, uC2, uC3, uWarpC;
      in vec2 vUv;
      vec3 pal(float i) { return i < 0.5 ? uC0 : i < 1.5 ? uC1 : i < 2.5 ? uC2 : uC3; }
      void main() {
        vec2 uv = vUv;
        float cols = 40.0, rws = 34.0;
        vec2 g = uv * vec2(cols, rws);
        vec2 cell = floor(g), f = fract(g);

        // Seeded weave motif.
        float idx;
        if (uPattern < 0.5) {
          idx = mod(floor((cell.x + cell.y) / (2.0 + floor(uDetail.x * 3.0))), 4.0);
        } else if (uPattern < 1.5) {
          float P = 8.0 + 2.0 * floor(uDetail.y * 4.0);
          float d = abs(mod(cell.x, P) - P * 0.5) + abs(mod(cell.y + floor(uDetail.z * P), P) - P * 0.5);
          idx = mod(floor(d / 2.0), 4.0);
        } else {
          idx = mod(floor(cell.y / (1.0 + floor(uDetail.z * 3.0))) + floor(cell.y / 7.0) + step(0.5, uDetail.w) * floor(cell.x / 20.0), 4.0);
        }
        // The hash portrait: 16 × 16, mirrored left to right.
        vec2 pc = floor(uv * 16.0);
        float px = pc.x < 8.0 ? pc.x : 15.0 - pc.x;
        float pidx = floor(texture(uPortrait, vec2((px + 0.5) / 8.0, (pc.y + 0.5) / 16.0)).r * 3.0 + 0.5);
        vec3 weftC = mix(pal(idx), pal(pidx), uHashMix);

        // Over/under: a 2/2 twill decides which thread shows in each cell.
        bool weftOver = mod(cell.x + cell.y, 4.0) < 2.0;
        float shade = weftOver ? 0.55 + 0.45 * sin(3.14159 * f.y) : 0.55 + 0.45 * sin(3.14159 * f.x);
        vec3 woven = (weftOver ? weftC : mix(uWarpC * 0.6, weftC, 0.45)) * shade;

        // Which rows are woven (each chunk is one row band, bottom to top).
        float row = min(floor(uv.y * uTotal), uTotal - 1.0);
        vec4 d = texture(uRows, vec2((mod(row, uRowsW) + 0.5) / uRowsW, (floor(row / uRowsW) + 0.5) / uRowsH));
        float reveal = d.a > 0.5 ? clamp((uTime - d.r) / uReveal, 0.0, 1.0) : 0.0;
        float xs = d.b > 0.5 ? 1.0 - uv.x : uv.x;
        float shown = d.a > 0.5 ? 1.0 - smoothstep(reveal * 1.1 - 0.1, reveal * 1.1 - 0.06, xs) : 0.0;
        float edge = d.a > 0.5 ? exp(-abs(xs - reveal * 1.1 + 0.08) * 40.0) * (1.0 - reveal) : 0.0;
        float bright = 0.6 + 0.4 * d.g;

        vec3 col = woven * 0.55 * bright * uDim * shown * uGlow;
        col += uWarpC * edge * 1.2;

        // Shimmer while waiting.
        col *= 1.0 + uShimmer * 0.3 * sin(uv.x * 37.0 + uv.y * 23.0 + uTime * 3.1);

        // The loom: warp threads, frame and a tick per row.
        float wx = abs(fract(uv.x * cols) - 0.5);
        float warp = (1.0 - smoothstep(0.05, 0.18, wx)) * (0.16 + uShimmer * 0.12 * (0.5 + 0.5 * sin(uTime * 4.0 + uv.x * 60.0)));
        float b = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
        float frame = (1.0 - smoothstep(0.004, 0.012, b)) * 0.3;
        float tickZone = step(min(uv.x, 1.0 - uv.x), 0.022) * step(uTotal, 400.0);
        float rf = abs(fract(uv.y * uTotal + 0.5) - 0.5);
        float tick = tickZone * (1.0 - smoothstep(0.0, fwidth(uv.y * uTotal) * 1.2, rf)) * 0.35;
        float loomA = (warp * (1.0 - shown) * uWarpFade + frame * max(uWarpFade, 0.35) + tick * uWarpFade) * uAppear;
        col += uWarpC * loomA;

        // The "checking" scan, then the finishing flare.
        float scan = exp(-pow((uv.y - uScanPos) * 16.0, 2.0)) * uScan;
        col += (uWarpC * 0.5 + col * 1.2) * scan;
        col += col * uFlare * 1.2 + uWarpC * uFlare * 0.08 * shown;

        col = mix(col, vec3(dot(col, vec3(0.3, 0.5, 0.2))) * 0.55, uGrey);
        float alpha = clamp(max(shown * uDim, loomA * 2.0), 0.0, 1.0);
        if (alpha < 0.02) discard;
        // The saved image is drawn straight to an 8-bit target, so it is encoded to sRGB here.
        if (uSRGB > 0.5) col = mix(pow(col, vec3(0.41666)) * 1.055 - 0.055, col * 12.92, vec3(lessThanEqual(col, vec3(0.0031308))));
        fragColor = vec4(col, alpha);
      }`,
    uniforms: {
      uRows: { value: rows }, uRowsW: { value: 64 }, uRowsH: { value: 1 }, uTotal: { value: 1 },
      uPortrait: { value: portrait },
      uTime: { value: 0 }, uAppear: { value: 0 }, uShimmer: { value: 0 }, uScan: { value: 0 }, uScanPos: { value: 0 },
      uFlare: { value: 0 }, uGrey: { value: 0 }, uHashMix: { value: 0 }, uDim: { value: 1 }, uWarpFade: { value: 1 },
      uReveal: { value: 0.45 }, uPattern: { value: 0 }, uDetail: { value: [0, 0, 0, 0] },
      uC0: { value: [1, 1, 1] }, uC1: { value: [1, 1, 1] }, uC2: { value: [1, 1, 1] }, uC3: { value: [1, 1, 1] },
      uWarpC: { value: [1, 1, 1] }, uGlow: { value: 1 }, uSRGB: { value: 0 },
    },
    transparent: true, cullFace: false, depthFunc: gl.LEQUAL,
  });
  const mesh = new Mesh(gl, { geometry: new Plane(gl, { width: LOOM_W, height: LOOM_H }), program, frustumCulled: false, renderOrder: 1 });
  mesh.position.set(0, LOOM_Y + LOOM_H / 2, 0);
  return mesh;
}
