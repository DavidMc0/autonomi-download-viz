// Bloom and output, matching three's UnrealBloomPass + OutputPass (r186), which the first version of
// this skin used: a luminosity high pass at half resolution, five progressively halved mips each with
// a separable gaussian (kernels 6, 10, 14, 18, 22, sigma = kernel / 3, paired bilinear taps), a
// weighted composite added over the scene, then linear → sRGB.

import { Mesh, Program, RenderTarget, Triangle, type Camera, type OGLRenderingContext, type Renderer, type Transform } from "ogl";

const MIPS = 5;
const KERNELS = [6, 10, 14, 18, 22];
const FACTORS = [1.0, 0.8, 0.6, 0.4, 0.2];
const DIR_X = [1, 0], DIR_Y = [0, 1];

const QUAD_VERT = /* glsl */ `#version 300 es
in vec2 position; in vec2 uv; out vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position, 0.0, 1.0); }`;
const HEAD = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv; out vec4 fragColor;
`;

function blurShader(kernel: number): string {
  const sigma = kernel / 3;
  const c: number[] = [];
  for (let i = 0; i < kernel; i++) c.push((0.39894 * Math.exp((-0.5 * i * i) / (sigma * sigma))) / sigma);
  const offsets: number[] = [], weights: number[] = [];
  for (let i = 1; i < kernel; i += 2) {
    const wa = c[i], wb = i + 1 < kernel ? c[i + 1] : 0, w = wa + wb;
    offsets.push((i * wa + (i + 1) * wb) / w);
    weights.push(w);
  }
  const arr = (a: number[]) => a.map((v) => v.toFixed(9)).join(", ");
  return /* glsl */ `${HEAD}
uniform sampler2D tex; uniform vec2 invSize; uniform vec2 direction;
const float OFFSETS[${offsets.length}] = float[](${arr(offsets)});
const float WEIGHTS[${weights.length}] = float[](${arr(weights)});
void main() {
  vec3 sum = texture(tex, vUv).rgb * ${c[0].toFixed(9)};
  for (int i = 0; i < ${offsets.length}; i++) {
    vec2 o = direction * invSize * OFFSETS[i];
    sum += (texture(tex, vUv + o).rgb + texture(tex, vUv - o).rgb) * WEIGHTS[i];
  }
  fragColor = vec4(sum, 1.0);
}`;
}

export class Bloom {
  private gl: OGLRenderingContext;
  private scene: RenderTarget;
  private bright: RenderTarget;
  private h: RenderTarget[] = [];
  private v: RenderTarget[] = [];
  private quad: Triangle;
  private highPass: Mesh;
  private blurs: Mesh[] = [];
  private output: Mesh;
  strength = 0.7;
  radius = 0.5;
  threshold = 0.3;

  constructor(gl: OGLRenderingContext) {
    this.gl = gl;
    const g2 = gl as WebGL2RenderingContext; // the skin only runs on WebGL2
    const rt = (depth: boolean) =>
      new RenderTarget(gl, { width: 4, height: 4, type: g2.HALF_FLOAT, internalFormat: g2.RGBA16F, format: gl.RGBA, depth, minFilter: gl.LINEAR });
    this.scene = rt(true);
    this.bright = rt(false);
    for (let i = 0; i < MIPS; i++) { this.h.push(rt(false)); this.v.push(rt(false)); }
    this.quad = new Triangle(gl);
    const pass = (fragment: string, uniforms: Record<string, { value: unknown }>) =>
      new Mesh(gl, {
        geometry: this.quad,
        program: new Program(gl, { vertex: QUAD_VERT, fragment, uniforms, depthTest: false, depthWrite: false, cullFace: false }),
        frustumCulled: false,
      });

    this.highPass = pass(/* glsl */ `${HEAD}
      uniform sampler2D tex; uniform float threshold;
      void main() {
        vec4 t = texture(tex, vUv);
        float v = dot(t.rgb, vec3(0.2126, 0.7152, 0.0722));
        fragColor = mix(vec4(0.0), t, smoothstep(threshold, threshold + 0.01, v));
      }`, { tex: { value: this.scene.texture }, threshold: { value: this.threshold } });

    for (let i = 0; i < MIPS; i++) {
      this.blurs.push(pass(blurShader(KERNELS[i]), { tex: { value: this.bright.texture }, invSize: { value: [1, 1] }, direction: { value: DIR_X } }));
    }

    this.output = pass(/* glsl */ `${HEAD}
      uniform sampler2D scene, b0, b1, b2, b3, b4; uniform float strength, radius;
      float f(float x) { return mix(x, 1.2 - x, radius); }
      void main() {
        vec3 bloom = 3.0 * strength * (
          f(${FACTORS[0].toFixed(1)}) * texture(b0, vUv).rgb + f(${FACTORS[1].toFixed(1)}) * texture(b1, vUv).rgb +
          f(${FACTORS[2].toFixed(1)}) * texture(b2, vUv).rgb + f(${FACTORS[3].toFixed(1)}) * texture(b3, vUv).rgb +
          f(${FACTORS[4].toFixed(1)}) * texture(b4, vUv).rgb);
        // three adds the composite with premultiplied additive blending (ONE, ONE).
        vec3 c = texture(scene, vUv).rgb + bloom;
        c = max(c, 0.0);
        fragColor = vec4(mix(pow(c, vec3(0.41666)) * 1.055 - 0.055, c * 12.92, vec3(lessThanEqual(c, vec3(0.0031308)))), 1.0);
      }`, {
      scene: { value: this.scene.texture },
      b0: { value: this.v[0].texture }, b1: { value: this.v[1].texture }, b2: { value: this.v[2].texture },
      b3: { value: this.v[3].texture }, b4: { value: this.v[4].texture },
      strength: { value: this.strength }, radius: { value: this.radius },
    });
  }

  /** Size in device pixels. */
  setSize(w: number, h: number): void {
    this.scene.setSize(w, h);
    let rx = Math.round(w / 2), ry = Math.round(h / 2);
    this.bright.setSize(rx, ry);
    for (let i = 0; i < MIPS; i++) {
      this.h[i].setSize(rx, ry);
      this.v[i].setSize(rx, ry);
      this.blurs[i].program.uniforms.invSize.value = [1 / rx, 1 / ry];
      rx = Math.round(rx / 2);
      ry = Math.round(ry / 2);
    }
  }

  render(renderer: Renderer, scene: Transform, camera: Camera): void {
    const gl = this.gl;
    gl.clearColor(0, 0, 0, 1);
    renderer.render({ scene, camera, target: this.scene, frustumCull: false });
    this.highPass.program.uniforms.threshold.value = this.threshold;
    renderer.render({ scene: this.highPass, target: this.bright });
    let input = this.bright;
    for (let i = 0; i < MIPS; i++) {
      const u = this.blurs[i].program.uniforms;
      u.tex.value = input.texture;
      u.direction.value = DIR_X;
      renderer.render({ scene: this.blurs[i], target: this.h[i] });
      u.tex.value = this.h[i].texture;
      u.direction.value = DIR_Y;
      renderer.render({ scene: this.blurs[i], target: this.v[i] });
      input = this.v[i];
    }
    const o = this.output.program.uniforms;
    o.strength.value = this.strength;
    o.radius.value = this.radius;
    renderer.render({ scene: this.output });
  }

  dispose(): void {
    for (const rt of [this.scene, this.bright, ...this.h, ...this.v]) disposeTarget(this.gl, rt);
    for (const m of [this.highPass, this.output, ...this.blurs]) m.program.remove();
    this.quad.remove();
  }
}

export function disposeTarget(gl: OGLRenderingContext, rt: RenderTarget): void {
  for (const t of rt.textures) gl.deleteTexture(t.texture);
  if (rt.depthBuffer) gl.deleteRenderbuffer(rt.depthBuffer);
  gl.deleteFramebuffer(rt.buffer);
}
