import * as THREE from 'three';
import type { ActParams } from './sections';

/**
 * GPU ping-pong state sim for "Terminal Taxonomy" — the living-community /
 * classification field. Same hand-rolled house pattern as a3-biome-dominoes'
 * ExcitableField (own scene/ortho-camera/quad, offscreen half-float
 * ping-pong targets, step()/texture/dispose), but the reaction here is a
 * classification ratchet over a Voronoi community lattice rather than an
 * excitable medium. ONE fragment pass per tick. Four channels in one RGBA
 * target:
 *
 *   .r = v   (vitality)      — regrows toward the act's vitality target,
 *                               drained by active scan stamps and by local
 *                               classified state, softly laplacian-bled.
 *   .g = c   (classified)    — the local ratchet: raised by stamps, by
 *                               act-5 global pressure, and by mass-
 *                               classification ring waves; PUSHED BACK by
 *                               pokes (the resistance mechanic — the only
 *                               thing in this field that can lower it).
 *   .b = glow (poke glow)    — fast-decay, gaussian-reignited by pokes; pure
 *                               interaction feedback, no bearing on c/v maths
 *                               beyond what pokeG itself already carries.
 *   .a = ink (archive ink)   — persistent label marks written inside an
 *                               active stamp's lower "label row" band.
 *                               NEVER decays — the catalogue only
 *                               accumulates. Only clearField()/seedField()
 *                               ever reset it.
 *
 * Classification (.g) uses MULTIPLICATIVE relaxation toward 1
 * (`c += (1-c)*(1-exp(-rate*dt))`), never a bare `c += tiny*dt` — half-float
 * targets lose precision near 1.0 and an additive ratchet stalls (the a2/b1
 * lesson). Ink (.a) uses the same relaxation shape but with NO decay term,
 * by design (an archive, not a transient).
 *
 * Every distance to a stamp/poke/wave centre torus-wraps
 * (`d -= floor(d + vec2(0.5))`) so the field can pan/tile seamlessly and
 * pokes/scans never silently miss across the wrap seam (BRIEFING.md's
 * standing lesson, ported from a1/a3).
 *
 * Resolution independence: unlike a3 (which fixes its laplacian tap spacing
 * at 1/SIM_GRID regardless of storage resolution), this field samples its
 * neighbours at the ACTUAL texel spacing (1/texSize) but pre-scales uDiff by
 * (texSize/SIM_GRID)^2 once at construction — the discrete 5-point laplacian
 * itself scales as texel-spacing^2, so this scaling exactly cancels that and
 * the physical bleed rate lands identical across Lite (256) and Full (512).
 *
 * NO backticks anywhere in the GLSL strings (template-literal truncation
 * trap). GLSL source is assembled with plain JS template-literal
 * interpolation only at the outermost (TS) level; COMM_CELL_GLSL is spliced
 * into the seed-pass source the same way.
 */

export const FIELD_TEX_FULL = 512;
export const FIELD_TEX_LITE = 256;
export const SIM_STEPS_FULL = 2;
export const SIM_STEPS_LITE = 1;
export const STAMP_SLOTS_FULL = 6;
export const STAMP_SLOTS_LITE = 4;
export const POKE_SLOTS = 4;
// 240 ticks @ WARMUP_TICK_DT ≈ 8s of sim time: enough for the classified
// ratchet / archive ink to settle at a `?t=` deep link's staged act rather
// than arriving visibly sparser than continuous play would have produced.
export const WARMUP_STEPS_INIT = 240;
export const WARMUP_STEPS_LOOP = 60;
/** Fixed per-tick dt used while warming up (not real elapsed time) — the field settles to a formed state regardless of the caller's frame rate. */
export const WARMUP_TICK_DT = 1 / 30;
/**
 * Reference resolution the base diffusion rate below is calibrated at. The
 * ACTUAL laplacian taps use the field's real texel spacing (1/texSize, see
 * the class doc), and uDiff is scaled by (texSize/SIM_GRID)^2 at
 * construction to keep the physical bleed rate resolution-independent.
 */
export const SIM_GRID = 256;

/** Base vitality-bleed diffusion coefficient, calibrated at SIM_GRID (256). */
const BASE_DIFF = 0.05;

const ORTHO_VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/** Resting state v=0, c=0, glow=0, ink=0 — used by clearField() (construction + loop-wrap). */
const INIT_FRAG = `
precision highp float;
void main() { gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0); }
`;

/**
 * Shared GLSL helpers for the Voronoi-community lattice (feature-point
 * placement + stable per-community classification order + nearest-community
 * lookup). Exported so the display shader can import the SAME functions and
 * land on exactly the same community boundaries/order the seed pass used —
 * tt/comm-prefixed throughout so concatenating this into a larger shader
 * (alongside that shader's own hash21 etc.) never collides.
 */
export const COMM_CELL_GLSL = `
float ttHash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec2 ttHash22(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453);
}
// Per-community machine-order amount: how far THIS community has drifted
// from its organic placement toward the aligned museum-drawer grid, given
// the global order knob (hash-staggered so communities align at different
// moments, never all at once).
float commOrderAmt(vec2 cc, float order) {
  return clamp(order * (0.75 + 0.5 * ttHash21(cc + vec2(5.5, 2.2))), 0.0, 1.0);
}
// Feature point (nucleus) inside integer community cell cc. Organic scatter
// confined to [0.22, 0.78] of the cell, sliding toward the cell CENTRE
// (aligned drawer rows) as the machine order rises — the flattening enacted
// spatially.
vec2 commAnchor(vec2 cc, float order) {
  vec2 organic = vec2(0.22) + 0.56 * ttHash22(cc);
  return mix(organic, vec2(0.5), commOrderAmt(cc, order));
}
// Stable 0..1 classification order for a community — the ratchet's global
// "how early does this community get classified" schedule.
float commOrder(vec2 cc) { return ttHash21(cc + vec2(7.31, 3.77)); }
// Nearest community to p (p already in community space = fieldUv * uCommFreq):
// 3x3 search over integer cells around p, returns the WINNING cell's integer
// coordinate (not the fractional nucleus position).
vec2 commCell(vec2 p, float order) {
  vec2 n = floor(p);
  vec2 f = fract(p);
  vec2 best = n;
  float bestD = 1.0e6;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 cc = n + g;
      vec2 anchor = commAnchor(cc, order);
      vec2 r = g + anchor - f;
      float d = dot(r, r);
      if (d < bestD) { bestD = d; best = cc; }
    }
  }
  return best;
}
`;

function buildSimFragment(stampSlots: number): string {
  return `
precision highp float;
varying vec2 vUv;
uniform sampler2D uPrev;
uniform vec2 uTexel;
uniform float uDt;
uniform float uDiff;              // vitality bleed, pre-scaled to SIM_GRID (see uDiff doc above)
uniform float uVitalityTarget;    // act's baseline vitality regrow target
uniform float uVitalityMod;       // smoothed-bass multiplier from index.ts (1 = no change)
uniform float uClassifyPressure;  // global classification creep per second (act 5 only)
uniform vec4 uStamps[${stampSlots}]; // xy field-uv, z radius, w drain strength (0 = inactive)
uniform vec4 uPokes[${POKE_SLOTS}];  // xy field-uv, z radius, w strength (0 = inactive)
uniform vec4 uWave;                   // xy centre, z ring radius, w strength (0 = off)

float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
  vec4 prev = texture2D(uPrev, vUv);
  float v = prev.r;
  float c = prev.g;
  float glow = prev.b;
  float ink = prev.a;
  vec2 tx = uTexel;

  // 4-neighbour laplacian of vitality (real texel spacing — see the uDiff
  // resolution-independence note above).
  float lap =
      texture2D(uPrev, vUv + vec2(tx.x, 0.0)).r
    + texture2D(uPrev, vUv - vec2(tx.x, 0.0)).r
    + texture2D(uPrev, vUv + vec2(0.0, tx.y)).r
    + texture2D(uPrev, vUv - vec2(0.0, tx.y)).r
    - 4.0 * v;

  // Scan stamps: gaussian drain well per active stamp, plus a sparse
  // label-row mask in a band beneath the stamp centre (reads as catalogue
  // text rows, not a solid block) that drives the archive-ink write below.
  float stampDrain = 0.0;
  float stampActive = 0.0;
  for (int i = 0; i < ${stampSlots}; i++) {
    vec4 s = uStamps[i];
    if (s.w > 0.0) {
      vec2 d = vUv - s.xy;
      d -= floor(d + vec2(0.5));
      float g = exp(-dot(d, d) / (s.z * s.z));
      stampDrain += g * s.w;

      vec2 db = d - vec2(0.0, 0.35 * s.z);
      float halfW = 0.7 * s.z;
      float halfH = 0.06 * s.z;
      if (abs(db.x) < halfW && abs(db.y) < halfH) {
        float rowT = (db.y + halfH) / max(1.0e-4, 2.0 * halfH) * 5.0;
        float rowId = floor(rowT);
        float rowOn = step(0.5, hash21(s.xy * 41.0 + rowId * 3.1 + float(i) * 11.0));
        float colId = floor((db.x + halfW) / max(1.0e-4, halfW * 0.18));
        float colOn = step(0.55, hash21(s.xy * 17.0 + vec2(colId, rowId) * 1.7 + float(i) * 5.3));
        stampActive += rowOn * colOn;
      }
    }
  }

  // Pokes: gaussian re-ignition bump, weighted by strength.
  float pokeG = 0.0;
  for (int i = 0; i < ${POKE_SLOTS}; i++) {
    vec4 p = uPokes[i];
    if (p.w > 0.0) {
      vec2 d = vUv - p.xy;
      d -= floor(d + vec2(0.5));
      pokeG += exp(-dot(d, d) / (p.z * p.z)) * p.w;
    }
  }

  // Mass-classification ring wave: gaussian band around the wrapped
  // distance to the ring, |dist - radius| within a fixed band width.
  float waveG = 0.0;
  if (uWave.w > 0.0) {
    vec2 d = vUv - uWave.xy;
    d -= floor(d + vec2(0.5));
    float band = abs(length(d) - uWave.z);
    waveG = exp(-(band * band) / (0.04 * 0.04)) * uWave.w;
  }

  // Vitality: regrow toward the act's target, laplacian bleed, drain from
  // active stamps + classified suppression, poke re-ignition.
  v += (uVitalityTarget * uVitalityMod - v) * (1.0 - exp(-0.4 * uDt));
  v += lap * uDiff * uDt;
  v -= v * (stampDrain * 1.2 + c * 0.35) * uDt;
  v = max(v, pokeG * 0.9);
  v = clamp(v, 0.0, 1.0);

  // Classified ratchet: multiplicative relaxation toward 1 (never a bare
  // additive tiny*dt — half-float precision dies near 1.0). Pokes are the
  // ONLY thing that reduces it (the resistance mechanic).
  float cRate = stampDrain * 2.5 + uClassifyPressure + waveG * 3.0;
  c += (1.0 - c) * (1.0 - exp(-cRate * uDt));
  c *= 1.0 - min(1.0, pokeG * 0.8);
  c = clamp(c, 0.0, 1.0);

  // Poke glow: fast exponential decay, gaussian re-ignition.
  glow = max(glow * exp(-2.2 * uDt), pokeG);
  glow = clamp(glow, 0.0, 1.0);

  // Archive ink: write-toward-1 relaxation inside an active stamp's label
  // row band. NO decay term, ever — the catalogue only accumulates.
  ink += (1.0 - ink) * (1.0 - exp(-2.0 * uDt * stampActive));
  ink = clamp(ink, 0.0, 1.0);

  gl_FragColor = vec4(v, c, glow, ink);
}
`;
}

/** Bakes the field's actual texel size into the row-jitter maths below (matches the storage target's own resolution, unlike the sim pass's fixed-vs-actual split — the seed pass runs once, cost isn't a concern). */
function buildSeedFragment(texSize: number): string {
  return `
precision highp float;
varying vec2 vUv;
uniform float uSeedFloor;
uniform float uSeedVitality;
uniform float uCommFreq;
uniform float uSeedOrder;
const float FIELD_SIZE = ${texSize.toFixed(1)};

${COMM_CELL_GLSL}

void main() {
  vec2 cc = commCell(vUv * uCommFreq, uSeedOrder);
  float ord = commOrder(cc);
  // Communities with commOrder(cc) < uSeedFloor are already classified.
  float c0 = 1.0 - smoothstep(uSeedFloor - 0.05, uSeedFloor + 0.05, ord);
  float v = mix(uSeedVitality, 0.12, c0);

  // Sparse horizontal-row ink mask: rows every ~8 texels, hash-jittered per
  // community so classified patches carry faint accumulated label rows
  // rather than an aligned grid.
  vec2 texel = floor(vUv * FIELD_SIZE);
  float rowSpan = 8.0;
  float jitter = floor(ttHash21(cc + vec2(3.1, 9.7)) * rowSpan);
  float rowLine = mod(texel.y + jitter, rowSpan);
  float isRow = 1.0 - step(0.5, rowLine);
  float colBucket = floor(texel.x / 3.0);
  float colHash = ttHash21(cc * 3.7 + vec2(colBucket, jitter) * 1.3);
  float colOn = step(0.6, colHash);
  float ink = c0 * isRow * colOn;

  gl_FragColor = vec4(v, c0, 0.0, ink);
}
`;
}

export interface FieldUniforms {
  uPrev: { value: THREE.Texture | null };
  uTexel: { value: THREE.Vector2 };
  uDt: { value: number };
  uDiff: { value: number };
  uVitalityTarget: { value: number };
  uVitalityMod: { value: number };
  uClassifyPressure: { value: number };
  uStamps: { value: THREE.Vector4[] };
  uPokes: { value: THREE.Vector4[] };
  uWave: { value: THREE.Vector4 };
}

interface SeedUniforms {
  uSeedFloor: { value: number };
  uSeedVitality: { value: number };
  uCommFreq: { value: number };
  uSeedOrder: { value: number };
}

export class CommunityField {
  readonly uniforms: FieldUniforms;
  /** Scan-reticle stamps — xy field-uv, z radius, w drain strength (0 = inactive). Shared BY REFERENCE with index.ts, which activates/ages them (a3 seeds idiom). */
  readonly stamps: THREE.Vector4[];
  /** Pointer-interaction pokes (the resistance mechanic) — xy field-uv, z radius, w strength (0 = inactive). Shared BY REFERENCE with index.ts. */
  readonly pokes: THREE.Vector4[];
  /** Mass-classification ring wave — xy centre, z ring radius, w strength (0 = off). Shared BY REFERENCE with index.ts, which grows its radius across act 5's wave events. */
  readonly wave: THREE.Vector4;

  private renderer: THREE.WebGLRenderer;
  private texSize: number;
  private targets: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
  private readIndex = 0;
  private scene: THREE.Scene;
  private camera: THREE.OrthographicCamera;
  private quad: THREE.Mesh;
  private simMaterial: THREE.ShaderMaterial;
  private initMaterial: THREE.ShaderMaterial;
  private seedMaterial: THREE.ShaderMaterial;
  private params: ActParams | null = null;
  /** Multiplicative vitality-regrow modifier — index.ts's smoothed-bass hook. 1 = no change. */
  private vitalityMod = 1;

  constructor(renderer: THREE.WebGLRenderer, full: boolean, stampSlots: number) {
    this.renderer = renderer;
    this.texSize = full ? FIELD_TEX_FULL : FIELD_TEX_LITE;

    const rtOpts: THREE.RenderTargetOptions = {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      // LinearFilter so the display shader samples a smooth field; the
      // sim's own neighbour reads land on texel centres regardless.
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      // Repeat (torus) so the laplacian wraps at the edges and the display
      // shader can pan/zoom out past [0,1] into a seamlessly tiling field.
      wrapS: THREE.RepeatWrapping,
      wrapT: THREE.RepeatWrapping,
      depthBuffer: false,
      stencilBuffer: false,
    };
    this.targets = [
      new THREE.WebGLRenderTarget(this.texSize, this.texSize, rtOpts),
      new THREE.WebGLRenderTarget(this.texSize, this.texSize, rtOpts),
    ];

    // Default radii are placeholders for inactive (w=0) slots — index.ts
    // sets the real xyz whenever it activates a slot.
    this.stamps = [];
    for (let i = 0; i < stampSlots; i++) this.stamps.push(new THREE.Vector4(0, 0, 0.05, 0));
    this.pokes = [];
    for (let i = 0; i < POKE_SLOTS; i++) this.pokes.push(new THREE.Vector4(0, 0, 0.035, 0));
    this.wave = new THREE.Vector4(0.5, 0.5, 0, 0);

    this.uniforms = {
      uPrev: { value: null },
      // Real texel spacing (not a fixed SIM_GRID offset like a3) — see the
      // class doc's resolution-independence note.
      uTexel: { value: new THREE.Vector2(1 / this.texSize, 1 / this.texSize) },
      uDt: { value: 0 },
      // Pre-scaled once for this instance's actual resolution; never
      // touched again after construction.
      uDiff: { value: BASE_DIFF * (this.texSize / SIM_GRID) * (this.texSize / SIM_GRID) },
      uVitalityTarget: { value: 0 },
      uVitalityMod: { value: 1 },
      uClassifyPressure: { value: 0 },
      uStamps: { value: this.stamps },
      uPokes: { value: this.pokes },
      uWave: { value: this.wave },
    };

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const geometry = new THREE.PlaneGeometry(2, 2);
    this.simMaterial = new THREE.ShaderMaterial({
      vertexShader: ORTHO_VERT,
      fragmentShader: buildSimFragment(stampSlots),
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
    const seedUniforms: SeedUniforms = {
      uSeedFloor: { value: 0 },
      uSeedVitality: { value: 0.8 },
      uCommFreq: { value: 6 },
      uSeedOrder: { value: 0 },
    };
    this.seedMaterial = new THREE.ShaderMaterial({
      vertexShader: ORTHO_VERT,
      fragmentShader: buildSeedFragment(this.texSize),
      uniforms: seedUniforms as unknown as Record<string, THREE.IUniform>,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new THREE.Mesh(geometry, this.initMaterial);
    this.scene.add(this.quad);

    this.clearField();
    this.quad.material = this.simMaterial;
  }

  /** Cache this frame's staged params — step() (and seedField()'s vitality default) read them. */
  setActParams(p: ActParams): void {
    this.params = p;
  }

  /** Smoothed-bass vitality-regrow modifier — 1 = no change. */
  setVitalityMod(m: number): void {
    this.vitalityMod = m;
  }

  private applyParams(p: ActParams): void {
    this.uniforms.uVitalityTarget.value = p.vitalityTarget;
    this.uniforms.uVitalityMod.value = this.vitalityMod;
    this.uniforms.uClassifyPressure.value = p.classifyPressure;
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

  /** One-shot analytic seed for `?t=` deep links: writes classified/vitality/ink state straight from the community lattice at `commFreq` (anchors at `machineOrder` spatial drift), floored by `classifiedFloor` (sections.ts's ActParams). Re-seeds BOTH ping-pong targets, correct regardless of parity. */
  seedField(classifiedFloor: number, commFreq: number, machineOrder: number): void {
    const seedUniforms = this.seedMaterial.uniforms as unknown as SeedUniforms;
    seedUniforms.uSeedFloor.value = classifiedFloor;
    seedUniforms.uSeedVitality.value = this.params?.vitalityTarget ?? 0.8;
    seedUniforms.uCommFreq.value = commFreq;
    seedUniforms.uSeedOrder.value = machineOrder;
    const prevTarget = this.renderer.getRenderTarget();
    const prevMaterial = this.quad.material;
    this.quad.material = this.seedMaterial;
    for (const t of this.targets) {
      this.renderer.setRenderTarget(t);
      this.renderer.render(this.scene, this.camera);
    }
    this.renderer.setRenderTarget(prevTarget ?? null);
    this.quad.material = prevMaterial;
  }

  /** Clears both targets to the resting state (v=0, c=0, glow=0, ink=0) — used at construction and on loop-wrap. */
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
    this.seedMaterial.dispose();
    this.quad.geometry.dispose();
  }
}
