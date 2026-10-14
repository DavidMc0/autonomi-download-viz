// Murmuration's three.js objects and shaders. Everything here is built once per mount; frame() only
// writes uniforms and a few small CPU-side buffers.

import {
  AdditiveBlending, BufferAttribute, BufferGeometry, Color, DataTexture, FloatType, Mesh, NearestFilter,
  PlaneGeometry, Points, RedFormat, RGBAFormat, ShaderMaterial, UnsignedByteType,
} from "three";

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

const DOT = /* glsl */ `
  float dot2(vec2 c) { vec2 d = c - 0.5; return dot(d, d); }
`;

// ---------------------------------------------------------------------------
// Sky: a full-screen gradient drawn first (colours are linear, like everything else in the scene).

export function makeSky(top: string, bottom: string): Mesh {
  const mat = new ShaderMaterial({
    uniforms: { uTop: { value: new Color(top) }, uBottom: { value: new Color(bottom) } },
    vertexShader: /* glsl */ `
      varying float vY;
      void main() { vY = position.y * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.9999, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uTop, uBottom; varying float vY;
      void main() { gl_FragColor = vec4(mix(uBottom, uTop, smoothstep(0.0, 1.0, vY)), 1.0); }`,
    depthTest: false, depthWrite: false,
  });
  const mesh = new Mesh(new PlaneGeometry(2, 2), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  return mesh;
}

// ---------------------------------------------------------------------------
// Ring of faint stars (ring-local coordinates; the parent group turns).

export function makeRing(count: number, rand: () => number): Points {
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
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(pos, 3));
  geo.setAttribute("aSize", new BufferAttribute(size, 1));
  geo.setAttribute("aBright", new BufferAttribute(bright, 1));
  geo.setAttribute("aPhase", new BufferAttribute(phase, 1));
  const mat = new ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uPx: { value: 1 }, uAlpha: { value: 1 }, uColor: { value: new Color(0.75, 0.82, 1) } },
    vertexShader: /* glsl */ `
      attribute float aSize; attribute float aBright; attribute float aPhase;
      uniform float uTime, uPx, uAlpha;
      varying float vA;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        float tw = 0.7 + 0.3 * sin(uTime * (0.5 + aPhase) + aPhase * 40.0);
        vA = aBright * tw * uAlpha;
        gl_PointSize = max(1.0, aSize * uPx * 24.0 / -mv.z);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; varying float vA;
      ${DOT}
      void main() {
        float a = (1.0 - smoothstep(0.0, 0.25, dot2(gl_PointCoord))) * vA;
        gl_FragColor = vec4(uColor * a, 1.0);
      }`,
    transparent: true, depthWrite: false, blending: AdditiveBlending,
  });
  return new Points(geo, mat);
}

// ---------------------------------------------------------------------------
// Bright stars: seeds, the file's target, lookup flickers, chunk origins. CPU-updated (64 slots).

export function makeBright(): Points {
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(new Float32Array(BRIGHT * 3), 3));
  geo.setAttribute("aColor", new BufferAttribute(new Float32Array(BRIGHT * 3), 3));
  geo.setAttribute("aSize", new BufferAttribute(new Float32Array(BRIGHT), 1));
  geo.setAttribute("aBright", new BufferAttribute(new Float32Array(BRIGHT), 1));
  const mat = new ShaderMaterial({
    uniforms: { uPx: { value: 1 } },
    vertexShader: /* glsl */ `
      attribute vec3 aColor; attribute float aSize; attribute float aBright;
      uniform float uPx;
      varying vec3 vC; varying float vA;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        vC = aColor; vA = aBright;
        gl_PointSize = aBright <= 0.001 ? 0.0 : max(2.0, aSize * uPx * 24.0 / -mv.z);
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vC; varying float vA;
      ${DOT}
      void main() {
        float d = dot2(gl_PointCoord);
        float a = (exp(-d * 60.0) + 0.35 * exp(-d * 12.0)) * (1.0 - smoothstep(0.18, 0.25, d)) * vA;
        gl_FragColor = vec4(vC * a, 1.0);
      }`,
    transparent: true, depthWrite: false, blending: AdditiveBlending,
  });
  const pts = new Points(geo, mat);
  pts.frustumCulled = false;
  return pts;
}

// ---------------------------------------------------------------------------
// The flock: GPU particles that trail a CPU-steered centre path (a history texture), folding like
// starlings through a shared wave field.

export function makeHistory(): DataTexture {
  const tex = new DataTexture(new Float32Array(HIST * ROWS * 4), HIST, ROWS, RGBAFormat, FloatType);
  tex.minFilter = tex.magFilter = NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

export function makeFlock(count: number, rand: () => number, hist: DataTexture): Points {
  const off = new Float32Array(count * 4);
  const rnd = new Float32Array(count * 4);
  const squad = new Float32Array(count);
  const pos = new Float32Array(count * 3); // unused by the shader; three needs a position attribute
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
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(pos, 3));
  geo.setAttribute("aOff", new BufferAttribute(off, 4));
  geo.setAttribute("aRnd", new BufferAttribute(rnd, 4));
  geo.setAttribute("aSquad", new BufferAttribute(squad, 1));
  const mat = new ShaderMaterial({
    uniforms: {
      uHist: { value: hist }, uTime: { value: 0 }, uPx: { value: 1 }, uAlpha: { value: 0 },
      uScatter: { value: 0 }, uWave: { value: 0.6 }, uSize: { value: 1 },
      uColorA: { value: new Color() }, uColorB: { value: new Color() }, uGrey: { value: 0 },
    },
    vertexShader: /* glsl */ `
      attribute vec4 aOff; attribute vec4 aRnd; attribute float aSquad;
      uniform sampler2D uHist;
      uniform float uTime, uPx, uAlpha, uScatter, uWave, uSize;
      varying float vA; varying float vMix;
      void main() {
        vec4 h = texture2D(uHist, vec2((aOff.w * ${HIST - 1}.0 + 0.5) / ${HIST}.0, 0.5 / ${ROWS}.0));
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
          vec4 q = texture2D(uHist, vec2((aOff.w * ${Math.floor((HIST - 1) / 2)}.0 + 0.5) / ${HIST}.0, (aSquad + 0.5) / ${ROWS}.0));
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
    fragmentShader: /* glsl */ `
      uniform vec3 uColorA, uColorB; uniform float uGrey;
      varying float vA; varying float vMix;
      ${DOT}
      void main() {
        float a = (1.0 - smoothstep(0.04, 0.25, dot2(gl_PointCoord))) * vA;
        vec3 c = mix(uColorA, uColorB, step(0.7, vMix));
        c = mix(c, vec3(dot(c, vec3(0.3, 0.5, 0.2))) * 0.6, uGrey);
        gl_FragColor = vec4(c * a, 1.0);
      }`,
    transparent: true, depthWrite: false, blending: AdditiveBlending,
  });
  const pts = new Points(geo, mat);
  pts.frustumCulled = false;
  return pts;
}

// ---------------------------------------------------------------------------
// Threads of light flying from a star into the loom (CPU-updated, world coordinates).

export function makeThreads(): Points {
  const n = THREADS * THREAD_PTS;
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(new Float32Array(n * 3), 3));
  geo.setAttribute("aA", new BufferAttribute(new Float32Array(n), 1));
  geo.setAttribute("aSize", new BufferAttribute(new Float32Array(n), 1));
  const mat = new ShaderMaterial({
    uniforms: { uPx: { value: 1 }, uColor: { value: new Color() }, uGrey: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute float aA; attribute float aSize;
      uniform float uPx;
      varying float vA;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        vA = aA;
        gl_PointSize = aA <= 0.001 ? 0.0 : max(1.5, aSize * uPx * 24.0 / -mv.z);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uGrey;
      varying float vA;
      ${DOT}
      void main() {
        float a = (1.0 - smoothstep(0.0, 0.25, dot2(gl_PointCoord))) * vA;
        vec3 c = mix(uColor, vec3(0.5), uGrey);
        gl_FragColor = vec4(c * a, 1.0);
      }`,
    transparent: true, depthWrite: false, blending: AdditiveBlending,
  });
  const pts = new Points(geo, mat);
  pts.frustumCulled = false;
  return pts;
}

// ---------------------------------------------------------------------------
// The loom and tapestry. Each chunk reveals one row band of a seeded woven image; after
// verification the image settles into a portrait of the file's hash.

export function makeRowsTexture(total: number): DataTexture {
  const w = 64, h = Math.max(1, Math.ceil(total / w));
  const tex = new DataTexture(new Float32Array(w * h * 4), w, h, RGBAFormat, FloatType);
  tex.minFilter = tex.magFilter = NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

export function makePortraitTexture(cells: Uint8Array): DataTexture {
  const tex = new DataTexture(cells, 8, 16, RedFormat, UnsignedByteType);
  tex.minFilter = tex.magFilter = NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

export function makeLoom(rows: DataTexture, portrait: DataTexture): Mesh {
  const geo = new PlaneGeometry(LOOM_W, LOOM_H);
  const mat = new ShaderMaterial({
    uniforms: {
      uRows: { value: rows }, uRowsW: { value: 64 }, uRowsH: { value: 1 }, uTotal: { value: 1 },
      uPortrait: { value: portrait },
      uTime: { value: 0 }, uAppear: { value: 0 }, uShimmer: { value: 0 }, uScan: { value: 0 }, uScanPos: { value: 0 },
      uFlare: { value: 0 }, uGrey: { value: 0 }, uHashMix: { value: 0 }, uDim: { value: 1 }, uWarpFade: { value: 1 },
      uReveal: { value: 0.45 }, uPattern: { value: 0 }, uDetail: { value: [0, 0, 0, 0] },
      uC0: { value: new Color() }, uC1: { value: new Color() }, uC2: { value: new Color() }, uC3: { value: new Color() },
      uWarpC: { value: new Color() }, uGlow: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uRows, uPortrait;
      uniform float uRowsW, uRowsH, uTotal, uTime, uAppear, uShimmer, uScan, uScanPos, uFlare, uGrey;
      uniform float uHashMix, uDim, uWarpFade, uReveal, uPattern, uGlow;
      uniform vec4 uDetail;
      uniform vec3 uC0, uC1, uC2, uC3, uWarpC;
      varying vec2 vUv;
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
        float pidx = floor(texture2D(uPortrait, vec2((px + 0.5) / 8.0, (pc.y + 0.5) / 16.0)).r * 3.0 + 0.5);
        vec3 weftC = mix(pal(idx), pal(pidx), uHashMix);

        // Over/under: a 2/2 twill decides which thread shows in each cell.
        bool weftOver = mod(cell.x + cell.y, 4.0) < 2.0;
        float shade = weftOver ? 0.55 + 0.45 * sin(3.14159 * f.y) : 0.55 + 0.45 * sin(3.14159 * f.x);
        vec3 woven = (weftOver ? weftC : mix(uWarpC * 0.6, weftC, 0.45)) * shade;

        // Which rows are woven (each chunk is one row band, bottom to top).
        float row = min(floor(uv.y * uTotal), uTotal - 1.0);
        vec4 d = texture2D(uRows, vec2((mod(row, uRowsW) + 0.5) / uRowsW, (floor(row / uRowsW) + 0.5) / uRowsH));
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
        gl_FragColor = vec4(col, alpha);
        #include <colorspace_fragment>
      }`,
    transparent: true,
  });
  const mesh = new Mesh(geo, mat);
  mesh.position.set(0, LOOM_Y + LOOM_H / 2, 0);
  return mesh;
}
