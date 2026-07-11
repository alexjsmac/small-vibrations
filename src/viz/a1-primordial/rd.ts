import * as THREE from 'three';

/**
 * Ping-pong Gray-Scott reaction-diffusion simulation. A lives in `.r`, B in
 * `.g`. Runs entirely on the GPU: each `step()` call renders a pass into an
 * offscreen half-float target reading the previous pass's texture, then
 * swaps read/write. The caller (index.ts) owns staging — it writes act
 * params into `uniforms` once per frame and calls `step(n)` to advance the
 * field by n simulation ticks.
 */

const VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const INIT_FRAG = `
precision highp float;
void main() {
  gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0);
}
`;

const SIM_FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uPrev;
uniform vec2 uTexel;
uniform float uFeed, uKill, uDScale, uFeedNoise, uNoiseTime;
uniform vec2 uAniso;   // per-axis laplacian scale
uniform vec2 uAdvect;  // texels per step
uniform vec4 uSeeds[4]; // xy = pos (uv), z = radius (uv), w = strength (0 = inactive)

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1,0)), u.x),
             mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), u.x), u.y);
}

void main(){
  vec2 uv = vUv - uAdvect * uTexel;
  vec2 tx = uTexel * uAniso;
  vec2 c  = texture2D(uPrev, uv).rg;
  // 9-point laplacian
  vec2 lap = -c;
  lap += 0.2  * texture2D(uPrev, uv + vec2( tx.x, 0.0)).rg;
  lap += 0.2  * texture2D(uPrev, uv + vec2(-tx.x, 0.0)).rg;
  lap += 0.2  * texture2D(uPrev, uv + vec2(0.0,  tx.y)).rg;
  lap += 0.2  * texture2D(uPrev, uv + vec2(0.0, -tx.y)).rg;
  lap += 0.05 * texture2D(uPrev, uv + vec2( tx.x,  tx.y)).rg;
  lap += 0.05 * texture2D(uPrev, uv + vec2(-tx.x,  tx.y)).rg;
  lap += 0.05 * texture2D(uPrev, uv + vec2( tx.x, -tx.y)).rg;
  lap += 0.05 * texture2D(uPrev, uv + vec2(-tx.x, -tx.y)).rg;

  float f = uFeed * (1.0 + uFeedNoise * (vnoise(vUv * 4.0 + uNoiseTime) - 0.5) * 2.0);
  float A = c.r, B = c.g;
  float ABB = A * B * B;
  float dA = uDScale * 1.0 * lap.r - ABB + f * (1.0 - A);
  float dB = uDScale * 0.5 * lap.g + ABB - (uKill + f) * B;
  A = clamp(A + dA, 0.0, 1.0);
  B = clamp(B + dB, 0.0, 1.0);

  // Life injection: gaussian dabs of B where seeds are active.
  for (int i = 0; i < 4; i++) {
    vec4 s = uSeeds[i];
    if (s.w > 0.0) {
      vec2 d = vUv - s.xy;
      float g = exp(-dot(d, d) / (s.z * s.z));
      B = clamp(B + s.w * g, 0.0, 1.0);
      A = clamp(A - 0.5 * s.w * g, 0.0, 1.0);
    }
  }
  gl_FragColor = vec4(A, B, 0.0, 1.0);
}
`;

export interface RDUniforms {
  uPrev: { value: THREE.Texture | null };
  uTexel: { value: THREE.Vector2 };
  uFeed: { value: number };
  uKill: { value: number };
  uDScale: { value: number };
  uFeedNoise: { value: number };
  uNoiseTime: { value: number };
  uAniso: { value: THREE.Vector2 };
  uAdvect: { value: THREE.Vector2 };
  uSeeds: { value: THREE.Vector4[] };
}

export class RDSim {
  readonly uniforms: RDUniforms;

  private renderer: THREE.WebGLRenderer;
  private targets: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
  private readIndex = 0;
  private scene: THREE.Scene;
  private camera: THREE.OrthographicCamera;
  private quad: THREE.Mesh;
  private simMaterial: THREE.ShaderMaterial;
  private initMaterial: THREE.ShaderMaterial;

  constructor(renderer: THREE.WebGLRenderer, width: number, height: number) {
    this.renderer = renderer;

    const rtOpts: THREE.RenderTargetOptions = {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.RepeatWrapping,
      wrapT: THREE.RepeatWrapping,
      depthBuffer: false,
      stencilBuffer: false,
    };
    this.targets = [
      new THREE.WebGLRenderTarget(width, height, rtOpts),
      new THREE.WebGLRenderTarget(width, height, rtOpts),
    ];

    this.uniforms = {
      uPrev: { value: null },
      uTexel: { value: new THREE.Vector2(1 / width, 1 / height) },
      uFeed: { value: 0.03 },
      uKill: { value: 0.0665 },
      uDScale: { value: 1 },
      uFeedNoise: { value: 0.1 },
      uNoiseTime: { value: 0 },
      uAniso: { value: new THREE.Vector2(1, 1) },
      uAdvect: { value: new THREE.Vector2(0, 0) },
      uSeeds: { value: [
        new THREE.Vector4(0, 0, 0.02, 0),
        new THREE.Vector4(0, 0, 0.02, 0),
        new THREE.Vector4(0, 0, 0.02, 0),
        new THREE.Vector4(0, 0, 0.02, 0),
      ] },
    };

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const geometry = new THREE.PlaneGeometry(2, 2);
    this.simMaterial = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: SIM_FRAG,
      uniforms: this.uniforms as unknown as Record<string, THREE.IUniform>,
      depthTest: false,
      depthWrite: false,
    });
    this.initMaterial = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: INIT_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new THREE.Mesh(geometry, this.initMaterial);
    this.scene.add(this.quad);

    // Seed both targets with A=1, B=0 so the field starts uniform-inert.
    const prevTarget = this.renderer.getRenderTarget();
    for (const t of this.targets) {
      this.renderer.setRenderTarget(t);
      this.renderer.render(this.scene, this.camera);
    }
    this.renderer.setRenderTarget(prevTarget);
    this.quad.material = this.simMaterial;
  }

  /** Run n ping-pong simulation passes, advancing the field in place. */
  step(n: number): void {
    const prevTarget = this.renderer.getRenderTarget();
    for (let i = 0; i < n; i++) {
      const read = this.targets[this.readIndex];
      const write = this.targets[1 - this.readIndex];
      this.uniforms.uPrev.value = read.texture;
      this.renderer.setRenderTarget(write);
      this.renderer.render(this.scene, this.camera);
      this.readIndex = 1 - this.readIndex;
    }
    this.renderer.setRenderTarget(prevTarget ?? null);
  }

  get texture(): THREE.Texture {
    return this.targets[this.readIndex].texture;
  }

  dispose(): void {
    this.targets[0].dispose();
    this.targets[1].dispose();
    this.simMaterial.dispose();
    this.initMaterial.dispose();
    this.quad.geometry.dispose();
  }
}
