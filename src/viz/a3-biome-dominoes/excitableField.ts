import * as THREE from 'three';
import type { ActParams } from './sections';

/**
 * GPU excitable medium — a3's signature element. A Barkley/FitzHugh-Nagumo
 * reaction field run as a hand-rolled ping-pong (the house pattern from
 * a1-primordial/rd.ts, a2-hive/traceField.ts and b1-biosphere/physarum.ts:
 * own scene/ortho-camera/quad, offscreen half-float targets, step()/texture/
 * dispose()). ONE fragment pass per tick — no agent/deposit passes (simpler
 * than Physarum). Two channels in one RGBA target:
 *
 *   .r = u  (activation / excitation) — diffuses, so it propagates as a
 *            travelling wave: a cell tipped over threshold excites its
 *            neighbours, and the chain leaps outward.
 *   .g = v  (recovery / refractory) — rises following u, and while it is
 *            high the local threshold ((v+b)/a) sits above u, so the cell
 *            CANNOT re-fire until v decays. That refractory recharge is
 *            literally "dominoes that stand back up".
 *
 * Barkley dynamics (explicit Euler, u clamped to [0,1] each tick so the
 * reaction term stays bounded and stable — same trick as a1's Gray-Scott):
 *
 *   du/dt = uEps * u*(1-u)*(u - (v+uB)/uA) + uDiff*lap(u) + uDrive
 *   dv/dt = (u - v) * uVRate
 *
 * All reaction parameters are per-act uniforms (excitability, diffusion,
 * refractory rate, global drive), so the SAME field goes from single hops ->
 * chains -> spiral/target waves -> total synchrony (uDrive on) -> a
 * de-activation cascade (uSuppress ring), with no scene swaps — the arc is
 * knob turns on one world.
 *
 * Ignition (`uSeeds`): gaussian bumps ADDED to u, injected by index.ts on
 * bass onsets and on a per-act Poisson schedule — each one leaps a new
 * chain. Injected repeatedly over a short (~0.12s) window so a seed reliably
 * tips its cell over threshold regardless of substep count.
 *
 * Collapse (`uSuppress`): a growing ring (centre, radius, strength) that
 * forces u (and v) toward 0 inside it — index.ts expands the radius across
 * the collapse act's localT so the field goes dark cell-by-cell (the
 * travelling-wave motif inverted). With the collapse act's floored
 * excitability nothing reignites behind the sweep.
 *
 * NO backticks anywhere in the GLSL strings (template-literal truncation
 * trap, a2 lesson). Seed pool size is fixed per quality and baked at init.
 */

export const FIELD_TEX_FULL = 1024;
export const FIELD_TEX_LITE = 512;
/**
 * The reaction's laplacian taps use a FIXED virtual-grid spacing (1/SIM_GRID
 * field-uv) rather than the storage texture's own texel size. Storage
 * resolution then only smooths the stored fronts (the plan's reason for
 * 512/1024) while the DYNAMICS — wave speed in field units, chain length,
 * warmup formation — stay identical across Lite, Full and the values the
 * acts were tuned at (the b1 "Lite and Full live in different worlds" trap:
 * texel-spaced taps halve uv-space wave speed every time resolution
 * doubles). Fixed spacing also keeps explicit-Euler diffusion far from its
 * stability bound at 1024².
 */
export const SIM_GRID = 256;
export const IGNITE_SLOTS_FULL = 6;
export const IGNITE_SLOTS_LITE = 4;
export const SIM_STEPS_FULL = 3;
export const SIM_STEPS_LITE = 2;
// 300 ticks ≈ 10s of sim time: enough for synchrony's slow drive charge to
// reach steady state, so a `?t=` deep link lands as dense as continuous play
// (150 ticks left the peak visibly sparser than arriving there naturally).
export const WARMUP_STEPS_INIT = 300;
export const WARMUP_STEPS_LOOP = 60;
/** Fixed per-tick dt used while warming up (not real elapsed time) — the field settles to a formed, mid-propagation state regardless of the caller's frame rate. */
export const WARMUP_TICK_DT = 1 / 30;

const ORTHO_VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/** Resting state u=0, v=0 (uniform-inert) — the field starts silent, ignitions wake it. */
const INIT_FRAG = `
precision highp float;
void main() { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); }
`;

function buildSimFragment(igniteSlots: number): string {
  return `
precision highp float;
varying vec2 vUv;
uniform sampler2D uPrev;
uniform vec2 uTexel;
uniform float uDt;
uniform float uDiff;   // activation diffusion (wave speed/spread)
uniform float uEps;    // reaction timescale (front sharpness / excitation speed)
uniform float uA;      // excitation threshold slope (higher = easier to excite)
uniform float uB;      // excitation threshold offset (higher = harder to excite)
uniform float uVRate;  // recovery/refractory rate (higher = recharge sooner)
uniform float uDrive;  // global drive toward firing (synchrony act only)
uniform float uRewireRate; // lattice-rewire phase speed (1/s); 0 = frozen lattice
uniform vec4 uSeeds[${igniteSlots}]; // xy pos, z radius (uv), w strength (0 = inactive)
uniform vec4 uSuppress; // xy centre, z radius, w strength (collapse de-activation ring)

// Activation level a cell must cross UPWARD to count as "fired" (and re-wire
// the display lattice). Well above the Barkley rest threshold ((v+uB)/uA ~
// 0.03-0.07) so a gaussian ignition SKIRT that lifts a marginal/refractory
// texel a little then decays does not count; well below the ~1.0 excited
// plateau, and u rises monotonically through it, so a real firing crosses
// exactly once regardless of substep count.
const float FIRE_T = 0.6;

void main() {
  vec4 c = texture2D(uPrev, vUv);
  float prevU = c.r;
  float u = c.r;
  float v = c.g;
  // .b = integer rewire GENERATION counter, .a = 0..1 transition PHASE — see
  // the firing-edge block below and latticeShader.ts's anchor+jump offsets.
  float genB = c.b;
  float phaseA = c.a;
  // uTexel is the FIXED virtual sim-grid spacing (1/SIM_GRID), not the
  // storage texel size — see SIM_GRID's doc.
  vec2 tx = uTexel;

  // 5-tap laplacian of u (activation diffuses; recovery does not).
  float lap =
      texture2D(uPrev, vUv + vec2(tx.x, 0.0)).r
    + texture2D(uPrev, vUv - vec2(tx.x, 0.0)).r
    + texture2D(uPrev, vUv + vec2(0.0, tx.y)).r
    + texture2D(uPrev, vUv - vec2(0.0, tx.y)).r
    - 4.0 * u;

  float thresh = (v + uB) / uA;
  float du = uEps * u * (1.0 - u) * (u - thresh) + uDiff * lap + uDrive;
  float dv = (u - v) * uVRate;
  u += du * uDt;
  v += dv * uDt;

  // Ignition: gaussian dabs of u where seeds are active — a new chain leaps.
  // Deliberately NOT dt-scaled (exception to the b1 per-tick-rate rule): u
  // clamps to 1.0 below, so extra ticks inside the seed window saturate
  // instead of accumulating — warmup, Lite and Full all land on the same
  // fired cell.
  for (int i = 0; i < ${igniteSlots}; i++) {
    vec4 s = uSeeds[i];
    if (s.w > 0.0) {
      vec2 d = vUv - s.xy;
      float g = exp(-dot(d, d) / (s.z * s.z));
      u += s.w * g;
    }
  }

  // Collapse de-activation ring: force u (and, more gently, v) toward 0
  // inside a growing radius so the field darkens cell-by-cell.
  if (uSuppress.w > 0.0) {
    float d = distance(vUv, uSuppress.xy);
    float inside = 1.0 - smoothstep(uSuppress.z * 0.85, uSuppress.z, d);
    float k = inside * uSuppress.w;
    u *= (1.0 - k);
    v *= (1.0 - 0.5 * k);
  }

  u = clamp(u, 0.0, 1.0);
  v = clamp(v, 0.0, 2.0);

  // Lattice rewiring state. A cell "fires" on the upward crossing of FIRE_T,
  // but ONLY once its previous slide has settled (phaseA >= 0.999) — that gate
  // caps one pending transition per cell, so a rapid re-fire mid-slide can
  // never pop the display nucleus. On firing: bump the generation counter and
  // restart the phase; otherwise ease the phase toward settled (dt-scaled, so
  // warmup / Lite / Full advance the same rewire per wall-second). Suppression
  // only lowers u, so collapse dead zones never fire and freeze for free.
  if (prevU < FIRE_T && u >= FIRE_T && phaseA >= 0.999) {
    genB += 1.0;
    phaseA = 0.0;
  } else {
    phaseA = min(1.0, phaseA + uRewireRate * uDt);
  }
  gl_FragColor = vec4(u, v, genB, phaseA);
}
`;
}

export interface FieldUniforms {
  uPrev: { value: THREE.Texture | null };
  uTexel: { value: THREE.Vector2 };
  uDt: { value: number };
  uDiff: { value: number };
  uEps: { value: number };
  uA: { value: number };
  uB: { value: number };
  uVRate: { value: number };
  uDrive: { value: number };
  uRewireRate: { value: number };
  uSeeds: { value: THREE.Vector4[] };
  uSuppress: { value: THREE.Vector4 };
}

export class ExcitableField {
  readonly uniforms: FieldUniforms;
  /** Pooled ignition seeds — shared BY REFERENCE with index.ts, which activates/ages them (same idiom as b1's foodValues). */
  readonly seeds: THREE.Vector4[];
  /** Collapse de-activation ring — shared BY REFERENCE with index.ts, which grows its radius across the collapse act. */
  readonly suppress: THREE.Vector4;

  private renderer: THREE.WebGLRenderer;
  private texSize: number;
  private targets: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
  private readIndex = 0;
  private scene: THREE.Scene;
  private camera: THREE.OrthographicCamera;
  private quad: THREE.Mesh;
  private simMaterial: THREE.ShaderMaterial;
  private initMaterial: THREE.ShaderMaterial;
  private params: ActParams | null = null;
  /** Multiplicative diffusion modifier — index.ts's one job for smoothed audio.mid (wave propagation speed). 1 = no change. */
  private diffMod = 1;
  /** Multiplicative rewire-rate modifier — the `?rewire=fast` debug switch (multiplies the act's rewireRate without mutating the shared/lerped ActParams). 1 = no change. */
  private rewireMod = 1;

  constructor(renderer: THREE.WebGLRenderer, full: boolean, igniteSlots: number) {
    this.renderer = renderer;
    this.texSize = full ? FIELD_TEX_FULL : FIELD_TEX_LITE;

    const rtOpts: THREE.RenderTargetOptions = {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      // LinearFilter so the display shader samples a smooth field; the sim's
      // own neighbour reads land on texel centres regardless.
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      // Repeat (torus) so the field's laplacian wraps at the edges (a
      // boundary-free excitable medium) AND the display shader can pan/zoom
      // out past [0,1] into a seamlessly tiling lattice — the synchrony
      // pull-back reveals a clean infinite web, not a clamped edge smear.
      wrapS: THREE.RepeatWrapping,
      wrapT: THREE.RepeatWrapping,
      depthBuffer: false,
      stencilBuffer: false,
    };
    this.targets = [
      new THREE.WebGLRenderTarget(this.texSize, this.texSize, rtOpts),
      new THREE.WebGLRenderTarget(this.texSize, this.texSize, rtOpts),
    ];

    this.seeds = [];
    for (let i = 0; i < igniteSlots; i++) this.seeds.push(new THREE.Vector4(0, 0, 0.03, 0));
    this.suppress = new THREE.Vector4(0.5, 0.5, 0, 0);

    this.uniforms = {
      uPrev: { value: null },
      // Fixed sim-grid spacing, NOT 1/texSize — see SIM_GRID's doc.
      uTexel: { value: new THREE.Vector2(1 / SIM_GRID, 1 / SIM_GRID) },
      uDt: { value: 0 },
      uDiff: { value: 0.12 },
      uEps: { value: 10 },
      uA: { value: 0.7 },
      uB: { value: 0.02 },
      uVRate: { value: 1.6 },
      uDrive: { value: 0 },
      uRewireRate: { value: 0 },
      uSeeds: { value: this.seeds },
      uSuppress: { value: this.suppress },
    };

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const geometry = new THREE.PlaneGeometry(2, 2);
    this.simMaterial = new THREE.ShaderMaterial({
      vertexShader: ORTHO_VERT,
      fragmentShader: buildSimFragment(igniteSlots),
      uniforms: this.uniforms as unknown as Record<string, THREE.IUniform>,
      depthTest: false,
      depthWrite: false,
    });
    this.initMaterial = new THREE.ShaderMaterial({
      vertexShader: ORTHO_VERT,
      fragmentShader: INIT_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new THREE.Mesh(geometry, this.initMaterial);
    this.scene.add(this.quad);

    this.clearField();
    this.quad.material = this.simMaterial;
  }

  /** Cache this frame's staged params — step() reads them for each substep's uniform computation. */
  setActParams(p: ActParams): void {
    this.params = p;
  }

  /** Smoothed audio.mid diffusion (wave-speed) modulation — 1 = no change. */
  setDiffMod(mod: number): void {
    this.diffMod = mod;
  }

  /** `?rewire=fast` debug multiplier on the act's rewire rate — 1 = no change. */
  setRewireMod(mod: number): void {
    this.rewireMod = mod;
  }

  private applyParams(p: ActParams): void {
    this.uniforms.uDiff.value = p.diff * this.diffMod;
    this.uniforms.uEps.value = p.eps;
    this.uniforms.uA.value = p.exA;
    this.uniforms.uB.value = p.exB;
    this.uniforms.uVRate.value = p.vRate;
    this.uniforms.uDrive.value = p.drive;
    this.uniforms.uRewireRate.value = p.rewireRate * this.rewireMod;
  }

  /** Runs `n` simulation ticks, each advancing by dt/n (total advance equals dt regardless of substep count). */
  step(dt: number, n: number): void {
    const p = this.params;
    if (!p || n <= 0) return;
    this.applyParams(p);
    this.uniforms.uDt.value = dt / n;
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

  /** Clears both targets to the resting state (u=0, v=0) — used at construction and on loop-wrap. */
  clearField(): void {
    const prevTarget = this.renderer.getRenderTarget();
    const prevMaterial = this.quad.material;
    this.quad.material = this.initMaterial;
    for (const t of this.targets) {
      this.renderer.setRenderTarget(t);
      this.renderer.render(this.scene, this.camera);
    }
    this.renderer.setRenderTarget(prevTarget ?? null);
    this.quad.material = prevMaterial;
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
