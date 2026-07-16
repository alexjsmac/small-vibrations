import * as THREE from 'three';
import type { ActParams } from './sections';

/**
 * GPU Physarum (slime mold) simulation — b1's signature element. Hand-rolled
 * ping-pong (house pattern from a1-primordial/rd.ts and a2-hive/traceField.ts:
 * own scene/ortho-camera/quad, offscreen render targets, step()/texture/
 * dispose()), NOT GPUComputationRenderer. Three passes per tick:
 *
 *  1. Agent update (fragment, one texel per agent). Agent state texture:
 *     two RGBA render targets, texel = (x, y, heading, spare), positions in
 *     dish-uv [0,1]. Species is DERIVED, not stored: species = floor(vUv.y
 *     * 3.0) (thirds of the texture) — the deposit pass agrees for free.
 *     Classic sense-and-turn: sample the trail's OWN species channel at 3
 *     sensors (ahead/left/right) plus an analytic food field, turn toward
 *     the strongest + hash jitter; pos += dir * speed * dt. Dish boundary
 *     (inscribed circle DISH_R around (0.5,0.5)): steer back toward centre,
 *     no teleport. A single burst uniform (uBurst + uBurstSeed) teleports
 *     agents whose hash(aUv, uBurstSeed) < strength to the burst point with
 *     random ("outward") headings — drives both ambient onset bursts and
 *     the scripted 54s/178s mass-spawn hits.
 *  2. Trail diffuse/decay (fragment): trail ping-pong targets, 3x3 blur x
 *     per-channel decay. The A channel is a slow fruiting-body integrator:
 *     a = clamp(prev.a * decayFruit + dot(newRgb, 1/3) * fruitGain, 0, 1).
 *  3. Deposit (THREE.Points, one vertex per agent, static aUv attribute):
 *     vertex shader vertex-texture-fetches the agent texture (the
 *     `webgl_gpgpu_birds` idiom), places points in trail space; fragment
 *     writes speciesMask * deposit. Additive, rendered into the
 *     just-written trail target with autoClear off, then swap.
 *
 * "Active fraction" agents are dormant: they neither move nor deposit. The
 * hash test that decides this (isActiveAgent) lives in ONE shared GLSL
 * string (AGENT_SHARED_GLSL) interpolated verbatim into both the
 * agent-update and deposit shaders, so the two can never disagree about
 * which agents are awake.
 */

/** Inscribed dish radius (dish-uv units, centre 0.5,0.5) — shared with dishShader.ts's ground/edge rendering so the sim boundary and the visible glass rim always agree. */
export const DISH_R = 0.48;

export const AGENT_TEX_FULL = 512;
export const AGENT_TEX_LITE = 256;
export const TRAIL_TEX_FULL = 1024;
export const TRAIL_TEX_LITE = 512;
export const SPECIES_COUNT = 3;
export const FOOD_SLOTS_FULL = 6;
export const FOOD_SLOTS_LITE = 4;
/** Composite-side visual burst-flash pool (dishShader.ts's uBurstVis) — distinct from the sim's single uBurst/uBurstSeed teleport uniform below. */
export const BURST_VIS_SLOTS_FULL = 4;
export const BURST_VIS_SLOTS_LITE = 3;
export const SIM_STEPS_FULL = 2;
export const SIM_STEPS_LITE = 1;
export const WARMUP_STEPS_INIT = 180;
export const WARMUP_STEPS_LOOP = 60;
/** Fixed per-tick dt used while warming up (not real elapsed time) — the network settles to a formed-looking state regardless of the caller's frame rate. */
export const WARMUP_TICK_DT = 1 / 30;

/**
 * Per-species turn clamp (rad per TICK, not per second — turnToward's clamp
 * is applied once per sim tick with no dt term) and heading jitter (rad).
 * At these values the clamp never actually binds for sensor turns (the
 * target is only ever heading +/- sensorAngle, always well inside the
 * clamp), so turning is effectively instantaneous — the standard
 * rotate-to-winning-sensor Physarum variant, and the dynamics the whole
 * module was tuned and visually verified against. Per-species character
 * therefore comes from JITTER (and sections.ts's sensing geometry), not
 * TURN_RATE; the clamp is kept as a safety rail, not a styling knob. Do not
 * "fix" this by scaling with uDt — that turns agents glacial (~0.02
 * rad/tick), un-forms every verified network, and invalidates the warmup
 * budgets.
 */
const TURN_RATE: readonly [number, number, number] = [2.4, 2.8, 3.2];
const JITTER: readonly [number, number, number] = [0.35, 0.45, 0.55];

/** Fruiting-body accumulator's own decay time constant (seconds) — fixed, not act-tunable; only its GAIN (fruitGain, how much new density feeds it) is staged. */
const FRUIT_DECAY_TAU = 15;

const ORTHO_VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/**
 * Shared GLSL: species derivation + the active-fraction dormancy test.
 * Interpolated VERBATIM into both the agent-update fragment shader and the
 * deposit vertex shader — the house rule (see class doc) that keeps the two
 * passes from ever disagreeing about which agents are awake. NO backticks
 * anywhere in this string (template-literal truncation trap).
 */
const AGENT_SHARED_GLSL = `
float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
// Species is derived from the agent texel's own y-coordinate (thirds of the
// texture), never stored — this function is the single source of truth
// every pass (update, deposit) calls, so they can never drift apart.
float speciesOf(vec2 auv) { return floor(clamp(auv.y, 0.0, 0.999999) * 3.0); }
// Dormant agents (hash over activeFrac threshold) neither move nor deposit.
bool isActiveAgent(vec2 auv, float activeFrac) { return hash21(auv + 41.7) <= activeFrac; }
`;

export function buildAgentFragmentShader(foodSlots: number): string {
  return `
precision highp float;
varying vec2 vUv;
uniform sampler2D uAgentPrev;
uniform sampler2D uTrail;
uniform float uDt;
uniform vec4 uSpeciesA[3]; // sensorDist, sensorAngle, turnRate, speed
uniform vec4 uSpeciesB[3]; // deposit (unused here), activeFrac, jitter, spare
uniform vec4 uFood[${foodSlots}]; // xy pos (dish-uv), z radius, w strength (0 = inactive)
uniform float uFoodPull;
uniform vec4 uBurst; // xy pos (dish-uv), z radius (unused), w strength (0 = inactive)
uniform float uBurstSeed;

const float DISH_R = ${DISH_R.toFixed(4)};
const vec2 DISH_C = vec2(0.5, 0.5);
const float PI = 3.14159265;
const float TWO_PI = 6.2831853;

${AGENT_SHARED_GLSL}

float foodAt(vec2 p) {
  float f = 0.0;
  for (int i = 0; i < ${foodSlots}; i++) {
    vec4 fo = uFood[i];
    if (fo.w <= 0.0) continue;
    vec2 d = p - fo.xy;
    f += exp(-dot(d, d) / (fo.z * fo.z)) * fo.w;
  }
  return f;
}

// Turns 'heading' toward 'target' by at most 'rate' radians, taking the
// shortest angular path (wrapped into [-PI, PI] first).
float turnToward(float heading, float target, float rate) {
  float diff = mod(target - heading + PI, TWO_PI) - PI;
  return heading + clamp(diff, -rate, rate);
}

void main() {
  vec4 state = texture2D(uAgentPrev, vUv);
  vec2 pos = state.xy;
  float heading = state.z;

  float s = speciesOf(vUv);
  vec4 sA; vec4 sB;
  if (s < 0.5) { sA = uSpeciesA[0]; sB = uSpeciesB[0]; }
  else if (s < 1.5) { sA = uSpeciesA[1]; sB = uSpeciesB[1]; }
  else { sA = uSpeciesA[2]; sB = uSpeciesB[2]; }
  float sensorDist = sA.x, sensorAngle = sA.y, turnRate = sA.z, speed = sA.w;
  float activeFrac = sB.y, jitter = sB.z;

  // Burst teleport: independent of active/dormant state, so a burst visibly
  // erupts across the whole population rather than only where agents
  // already happened to be awake. Single-shot per tick this uniform is
  // active — index.ts owns the activation window.
  float burstHash = hash21(vUv * 913.73 + uBurstSeed);
  if (uBurst.w > 0.0 && burstHash < uBurst.w) {
    pos = uBurst.xy;
    heading = burstHash * TWO_PI; // random "outward" heading per agent
    gl_FragColor = vec4(pos, heading, 0.0);
    return;
  }

  if (!isActiveAgent(vUv, activeFrac)) {
    // Dormant: hold position and heading exactly.
    gl_FragColor = vec4(pos, heading, 0.0);
    return;
  }

  // Sense-and-turn: 3 sensors (ahead/left/right) read the trail's OWN
  // species channel plus the analytic food field (strongly weighted).
  vec2 dirF = vec2(cos(heading), sin(heading));
  vec2 dirL = vec2(cos(heading + sensorAngle), sin(heading + sensorAngle));
  vec2 dirR = vec2(cos(heading - sensorAngle), sin(heading - sensorAngle));
  vec2 pF = pos + dirF * sensorDist;
  vec2 pL = pos + dirL * sensorDist;
  vec2 pR = pos + dirR * sensorDist;

  vec3 trailF = texture2D(uTrail, pF).rgb;
  vec3 trailL = texture2D(uTrail, pL).rgb;
  vec3 trailR = texture2D(uTrail, pR).rgb;
  float chanF = s < 0.5 ? trailF.r : (s < 1.5 ? trailF.g : trailF.b);
  float chanL = s < 0.5 ? trailL.r : (s < 1.5 ? trailL.g : trailL.b);
  float chanR = s < 0.5 ? trailR.r : (s < 1.5 ? trailR.g : trailR.b);

  float valF = chanF + foodAt(pF) * uFoodPull;
  float valL = chanL + foodAt(pL) * uFoodPull;
  float valR = chanR + foodAt(pR) * uFoodPull;

  float jitterAmt = (hash21(vUv * 77.31 + heading * 3.1 + uBurstSeed * 0.01) - 0.5) * jitter;
  if (valF >= valL && valF >= valR) {
    heading += jitterAmt;
  } else if (valL > valR) {
    heading = turnToward(heading, heading + sensorAngle, turnRate) + jitterAmt;
  } else {
    heading = turnToward(heading, heading - sensorAngle, turnRate) + jitterAmt;
  }

  // Dish boundary: steer back toward centre when outside the inscribed
  // circle — no teleport.
  vec2 toCenter = DISH_C - pos;
  float distC = length(pos - DISH_C);
  if (distC > DISH_R) {
    float targetAngle = atan(toCenter.y, toCenter.x);
    heading = turnToward(heading, targetAngle, turnRate * 2.0);
  }

  pos += vec2(cos(heading), sin(heading)) * speed * uDt;

  // Hard clamp fallback: a fast agent can never escape the dish outright
  // while the steer-back above is still catching up over several ticks.
  vec2 fromCenter = pos - DISH_C;
  float d2 = length(fromCenter);
  if (d2 > DISH_R + 0.03) {
    pos = DISH_C + fromCenter * ((DISH_R + 0.03) / max(1e-5, d2));
  }

  gl_FragColor = vec4(pos, heading, 0.0);
}
`;
}

export const SEED_FRAG = `
precision highp float;
varying vec2 vUv;
uniform float uSeed;
const float DISH_R = ${DISH_R.toFixed(4)};
float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  float h1 = hash21(vUv * 913.71 + uSeed);
  float h2 = hash21(vUv * 457.13 + uSeed * 1.37 + 11.7);
  float h3 = hash21(vUv * 77.31 + uSeed * 2.11 + 31.9);
  // Uniform-area sampling inside the inscribed dish circle (sqrt(h1), not
  // h1 directly — otherwise agents cluster toward the centre).
  float r = DISH_R * sqrt(h1);
  float theta = h2 * 6.2831853;
  vec2 pos = vec2(0.5) + vec2(cos(theta), sin(theta)) * r;
  float heading = h3 * 6.2831853;
  gl_FragColor = vec4(pos, heading, 0.0);
}
`;

export const TRAIL_FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uTrailPrev;
uniform vec2 uTexel;
uniform vec3 uDecay; // per-channel retention multiplier this tick, exp(-decayRate*dt)
uniform float uDecayFruit; // fruiting accumulator retention multiplier this tick
uniform float uFruitGain; // already pre-scaled by this substep's dt (TS side, see PhysarumSim.updateTrailUniforms) — a per-second rate, not a flat per-tick gain

void main() {
  vec4 prev = texture2D(uTrailPrev, vUv);
  vec2 tx = uTexel;
  // 3x3 tent blur of the RGB (species density) channels.
  vec3 sum = prev.rgb * 4.0;
  sum += texture2D(uTrailPrev, vUv + vec2(tx.x, 0.0)).rgb * 2.0;
  sum += texture2D(uTrailPrev, vUv - vec2(tx.x, 0.0)).rgb * 2.0;
  sum += texture2D(uTrailPrev, vUv + vec2(0.0, tx.y)).rgb * 2.0;
  sum += texture2D(uTrailPrev, vUv - vec2(0.0, tx.y)).rgb * 2.0;
  sum += texture2D(uTrailPrev, vUv + vec2(tx.x, tx.y)).rgb;
  sum += texture2D(uTrailPrev, vUv + vec2(-tx.x, tx.y)).rgb;
  sum += texture2D(uTrailPrev, vUv + vec2(tx.x, -tx.y)).rgb;
  sum += texture2D(uTrailPrev, vUv + vec2(-tx.x, -tx.y)).rgb;
  vec3 blurred = sum / 16.0;
  vec3 newRgb = blurred * uDecay;

  // Fruiting-body integrator: a slow accumulator of sustained local
  // density — fruiting bodies live where the network has PERSISTED, not
  // merely passed through.
  float a = clamp(prev.a * uDecayFruit + dot(newRgb, vec3(1.0 / 3.0)) * uFruitGain, 0.0, 1.0);
  gl_FragColor = vec4(newRgb, a);
}
`;

export const DEPOSIT_VERT = `
precision highp float;
attribute vec2 aUv; // static texel-centre uv into the agent texture
uniform sampler2D uAgentTex;
uniform vec4 uSpeciesB[3]; // deposit, activeFrac, jitter, spare
// Deposit is a per-SECOND rate (matching uDecay's exp(-decayRate*dt) in the
// trail shader, also per-second) — scaling by the substep's own dt here is
// load-bearing: an unscaled flat deposit-per-tick vastly outruns decay
// whenever more ticks run per second (warmup's fixed-dt loop, or Lite's 1
// vs Full's 2 steps/frame), saturating the whole trail to solid white
// within seconds (caught live: readback showed every visited texel
// clamped to 1.0 after warmup).
uniform float uDt;
varying float vSpecies;
varying float vDeposit;
varying float vActive;

${AGENT_SHARED_GLSL}

void main() {
  vec4 state = texture2D(uAgentTex, aUv);
  vec2 pos = state.xy;
  float s = speciesOf(aUv);
  vec4 sB;
  if (s < 0.5) sB = uSpeciesB[0];
  else if (s < 1.5) sB = uSpeciesB[1];
  else sB = uSpeciesB[2];
  // NOTE: 'active' is a GLSL reserved word (illegal as an identifier even
  // though it isn't used by any current stage) — named agentAwake instead.
  bool agentAwake = isActiveAgent(aUv, sB.y);
  vSpecies = s;
  vDeposit = sB.x * uDt;
  vActive = agentAwake ? 1.0 : 0.0;

  vec2 clip = pos * 2.0 - 1.0;
  // Dormant agents: push off-clip so nothing rasterizes for them — cheaper
  // than relying solely on the fragment-stage discard below, which would
  // still pay rasterization cost for a degenerate on-screen point.
  if (!agentAwake) clip = vec2(2.0, 2.0);
  gl_Position = vec4(clip, 0.0, 1.0);
  gl_PointSize = 1.0;
}
`;

export const DEPOSIT_FRAG = `
precision highp float;
varying float vSpecies;
varying float vDeposit;
varying float vActive;
void main() {
  if (vActive < 0.5) discard;
  vec3 mask = vSpecies < 0.5 ? vec3(1.0, 0.0, 0.0)
            : vSpecies < 1.5 ? vec3(0.0, 1.0, 0.0)
            : vec3(0.0, 0.0, 1.0);
  gl_FragColor = vec4(mask * vDeposit, 0.0);
}
`;

export class PhysarumSim {
  private renderer: THREE.WebGLRenderer;
  private agentTexSize: number;
  private trailTexSize: number;
  private foodSlots: number;

  private agentTargets: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
  private agentReadIndex = 0;
  private trailTargets: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
  private trailReadIndex = 0;

  private agentScene: THREE.Scene;
  private trailScene: THREE.Scene;
  private depositScene: THREE.Scene;
  private orthoCam: THREE.OrthographicCamera;

  private agentQuad: THREE.Mesh;
  private agentMaterial: THREE.ShaderMaterial;
  private seedMaterial: THREE.ShaderMaterial;
  private trailQuad: THREE.Mesh;
  private trailMaterial: THREE.ShaderMaterial;
  private depositPoints: THREE.Points;
  private depositMaterial: THREE.ShaderMaterial;

  /** uSpeciesA/uSpeciesB pooled Vector4 arrays — shared BY REFERENCE between the agent-update material and the deposit material (uSpeciesB only; deposit doesn't need sensing geometry), so index.ts's per-frame writes are visible to both with zero extra bookkeeping. */
  private speciesA: THREE.Vector4[];
  private speciesB: THREE.Vector4[];

  private params: ActParams | null = null;
  /** Multiplicative speed modifier — index.ts's one job for smoothed `audio.mid` (the plan's audio-map table: "mid -> agent speed"), applied on top of the act's staged `speed` knob. 1 = no modulation. */
  private speedMod = 1;

  constructor(
    renderer: THREE.WebGLRenderer,
    full: boolean,
    foodSlots: number,
    /** Pooled uFood Vector4 array owned by index.ts — shared BY REFERENCE with the agent-update material AND (by the caller) dishShader's composite material, never copied. */
    foodValues: THREE.Vector4[],
  ) {
    this.renderer = renderer;
    this.foodSlots = foodSlots;
    this.agentTexSize = full ? AGENT_TEX_FULL : AGENT_TEX_LITE;
    this.trailTexSize = full ? TRAIL_TEX_FULL : TRAIL_TEX_LITE;

    const useFloat = !!renderer.extensions.get('EXT_color_buffer_float');
    const agentType = useFloat ? THREE.FloatType : THREE.HalfFloatType;

    const agentRtOpts: THREE.RenderTargetOptions = {
      type: agentType,
      format: THREE.RGBAFormat,
      // NearestFilter is load-bearing: the deposit vertex shader's
      // vertex-texture-fetch must land exactly on one agent's texel, never
      // blend two agents' positions together.
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      depthBuffer: false,
      stencilBuffer: false,
    };
    this.agentTargets = [
      new THREE.WebGLRenderTarget(this.agentTexSize, this.agentTexSize, agentRtOpts),
      new THREE.WebGLRenderTarget(this.agentTexSize, this.agentTexSize, agentRtOpts),
    ];

    const trailRtOpts: THREE.RenderTargetOptions = {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      depthBuffer: false,
      stencilBuffer: false,
    };
    this.trailTargets = [
      new THREE.WebGLRenderTarget(this.trailTexSize, this.trailTexSize, trailRtOpts),
      new THREE.WebGLRenderTarget(this.trailTexSize, this.trailTexSize, trailRtOpts),
    ];

    this.orthoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this.speciesA = [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()];
    this.speciesB = [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()];

    // ---- agent update + seed (share one scene/quad, swap material) ----
    this.agentScene = new THREE.Scene();
    const quadGeom = new THREE.PlaneGeometry(2, 2);
    this.agentMaterial = new THREE.ShaderMaterial({
      vertexShader: ORTHO_VERT,
      fragmentShader: buildAgentFragmentShader(foodSlots),
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uAgentPrev: { value: null },
        uTrail: { value: null },
        uDt: { value: 0 },
        uSpeciesA: { value: this.speciesA },
        uSpeciesB: { value: this.speciesB },
        uFood: { value: foodValues },
        uFoodPull: { value: 0 },
        uBurst: { value: new THREE.Vector4(0, 0, 0, 0) },
        uBurstSeed: { value: 0 },
      },
    });
    this.seedMaterial = new THREE.ShaderMaterial({
      vertexShader: ORTHO_VERT,
      fragmentShader: SEED_FRAG,
      depthTest: false,
      depthWrite: false,
      uniforms: { uSeed: { value: 0 } },
    });
    this.agentQuad = new THREE.Mesh(quadGeom, this.agentMaterial);
    this.agentScene.add(this.agentQuad);

    // ---- trail diffuse/decay ----
    this.trailScene = new THREE.Scene();
    this.trailMaterial = new THREE.ShaderMaterial({
      vertexShader: ORTHO_VERT,
      fragmentShader: TRAIL_FRAG,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uTrailPrev: { value: null },
        uTexel: { value: new THREE.Vector2(1 / this.trailTexSize, 1 / this.trailTexSize) },
        uDecay: { value: new THREE.Vector3(1, 1, 1) },
        uDecayFruit: { value: 1 },
        uFruitGain: { value: 0 },
      },
    });
    this.trailQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.trailMaterial);
    this.trailScene.add(this.trailQuad);

    // ---- deposit (Points, vertex texture fetch) ----
    const n = this.agentTexSize;
    const aUv = new Float32Array(n * n * 2);
    let k = 0;
    for (let iy = 0; iy < n; iy++) {
      for (let ix = 0; ix < n; ix++) {
        aUv[k++] = (ix + 0.5) / n;
        aUv[k++] = (iy + 0.5) / n;
      }
    }
    const depositGeom = new THREE.BufferGeometry();
    depositGeom.setAttribute('aUv', new THREE.BufferAttribute(aUv, 2));
    // A dummy 'position' attribute is required by three.js's own render
    // path validation even though the vertex shader never reads it.
    depositGeom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * n * 3), 3));
    this.depositMaterial = new THREE.ShaderMaterial({
      vertexShader: DEPOSIT_VERT,
      fragmentShader: DEPOSIT_FRAG,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      // CustomBlending, not the THREE.AdditiveBlending default: that preset's
      // default src factor is SrcAlphaFactor, which multiplies the deposited
      // RGB by the fragment's OWN alpha — and DEPOSIT_FRAG deliberately
      // writes alpha 0.0 (the trail's .a channel is the fruiting-body
      // integrator, owned entirely by the trail-diffuse pass, never touched
      // here). Under the default preset that zeroes every deposit outright
      // (caught live: the trail read back all-zero). ONE/ONE on the RGB
      // terms gives pure additive color; ZERO/ONE on the alpha terms leaves
      // the destination alpha untouched by this pass.
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
      uniforms: {
        uAgentTex: { value: null },
        uSpeciesB: { value: this.speciesB },
        uDt: { value: 0 },
      },
    });
    this.depositPoints = new THREE.Points(depositGeom, this.depositMaterial);
    this.depositPoints.frustumCulled = false;
    this.depositScene = new THREE.Scene();
    this.depositScene.add(this.depositPoints);

    // Defensive explicit clear (beyond relying on a new WebGLRenderTarget's
    // implicit zero-fill) — the trail's decay/max-free formulas are
    // well-defined starting from all-zero, same as a2's TraceField.
    this.clearTrail();
  }

  /** Cache this frame's staged params — step() reads them for each substep's uniform computation (decay/food-pull/etc. depend on the substep's own dt). */
  setActParams(p: ActParams): void {
    this.params = p;
  }

  /** Smoothed `audio.mid` speed modulation (index.ts's single job for the mid band) — 1 = no change. */
  setSpeedMod(mod: number): void {
    this.speedMod = mod;
  }

  /** Single-shot burst activation: index.ts calls this with strength=0 to clear. `seed` re-rolls which agents the hash test selects. */
  setBurst(x: number, y: number, radius: number, strength: number, seed: number): void {
    (this.agentMaterial.uniforms.uBurst.value as THREE.Vector4).set(x, y, radius, strength);
    this.agentMaterial.uniforms.uBurstSeed.value = seed;
  }

  private updateAgentUniforms(p: ActParams, subDt: number) {
    const speed = p.speed * this.speedMod;
    this.speciesA[0].set(p.sensDistA, p.sensAngleA, TURN_RATE[0], speed);
    this.speciesA[1].set(p.sensDistB, p.sensAngleB, TURN_RATE[1], speed);
    this.speciesA[2].set(p.sensDistC, p.sensAngleC, TURN_RATE[2], speed);
    this.speciesB[0].set(p.deposit, p.activeA, JITTER[0], 0);
    this.speciesB[1].set(p.deposit, p.activeB, JITTER[1], 0);
    this.speciesB[2].set(p.deposit, p.activeC, JITTER[2], 0);
    this.agentMaterial.uniforms.uDt.value = subDt;
    this.agentMaterial.uniforms.uFoodPull.value = p.foodPull;
  }

  private updateTrailUniforms(p: ActParams, subDt: number) {
    const retention = Math.exp(-p.decay * subDt);
    (this.trailMaterial.uniforms.uDecay.value as THREE.Vector3).set(retention, retention, retention);
    this.trailMaterial.uniforms.uDecayFruit.value = Math.exp(-subDt / FRUIT_DECAY_TAU);
    // fruitGain is a per-SECOND rate too (same dt-scaling fix as deposit
    // above, same failure mode caught live: an unscaled flat per-tick gain
    // saturated the whole dish to solid fruiting glow within a couple of
    // ticks instead of accumulating over tens of seconds of sustained
    // density).
    this.trailMaterial.uniforms.uFruitGain.value = p.fruitGain * subDt;
  }

  /** Runs `n` simulation ticks, each advancing by dt/n (so total advance equals dt regardless of substep count). */
  step(dt: number, n: number): void {
    const p = this.params;
    if (!p || n <= 0) return;
    const subDt = dt / n;
    const prevTarget = this.renderer.getRenderTarget();
    const prevAutoClear = this.renderer.autoClear;

    for (let i = 0; i < n; i++) {
      // 1. Agent update: read OLD trail (pre-diffuse this tick) for sensing.
      this.updateAgentUniforms(p, subDt);
      const aRead = this.agentTargets[this.agentReadIndex];
      const aWrite = this.agentTargets[1 - this.agentReadIndex];
      this.agentMaterial.uniforms.uAgentPrev.value = aRead.texture;
      this.agentMaterial.uniforms.uTrail.value = this.trailTargets[this.trailReadIndex].texture;
      this.renderer.setRenderTarget(aWrite);
      this.renderer.autoClear = true;
      this.renderer.render(this.agentScene, this.orthoCam);
      this.agentReadIndex = 1 - this.agentReadIndex;

      // 2. Trail diffuse/decay: fresh render into the write target.
      this.updateTrailUniforms(p, subDt);
      const tRead = this.trailTargets[this.trailReadIndex];
      const tWrite = this.trailTargets[1 - this.trailReadIndex];
      this.trailMaterial.uniforms.uTrailPrev.value = tRead.texture;
      this.renderer.setRenderTarget(tWrite);
      this.renderer.autoClear = true;
      this.renderer.render(this.trailScene, this.orthoCam);

      // 3. Deposit: additive Points render into the SAME just-written
      // target, autoClear off, using the agent positions just written in
      // step 1 above.
      this.depositMaterial.uniforms.uAgentTex.value = this.agentTargets[this.agentReadIndex].texture;
      this.depositMaterial.uniforms.uDt.value = subDt;
      this.renderer.autoClear = false;
      this.renderer.render(this.depositScene, this.orthoCam);

      this.trailReadIndex = 1 - this.trailReadIndex;
    }

    this.renderer.autoClear = prevAutoClear;
    this.renderer.setRenderTarget(prevTarget ?? null);
  }

  /** Re-seeds agent positions/headings into BOTH ping-pong targets (mirrors TraceField.seed — correct regardless of ping-pong parity). */
  seedAgents(rng: () => number): void {
    const seedFloat = rng();
    this.seedMaterial.uniforms.uSeed.value = seedFloat;
    const prevTarget = this.renderer.getRenderTarget();
    this.agentQuad.material = this.seedMaterial;
    for (const t of this.agentTargets) {
      this.renderer.setRenderTarget(t);
      this.renderer.render(this.agentScene, this.orthoCam);
    }
    this.renderer.setRenderTarget(prevTarget ?? null);
    this.agentQuad.material = this.agentMaterial;
  }

  /** Clears both trail targets to zero (color buffer only) — used at construction and on loop-wrap. */
  clearTrail(): void {
    const prevTarget = this.renderer.getRenderTarget();
    const prevClearColor = new THREE.Color();
    this.renderer.getClearColor(prevClearColor);
    const prevClearAlpha = this.renderer.getClearAlpha();
    this.renderer.setClearColor(0x000000, 0);
    for (const t of this.trailTargets) {
      this.renderer.setRenderTarget(t);
      this.renderer.clear(true, false, false);
    }
    this.renderer.setClearColor(prevClearColor, prevClearAlpha);
    this.renderer.setRenderTarget(prevTarget ?? null);
  }

  get trailTexture(): THREE.Texture {
    return this.trailTargets[this.trailReadIndex].texture;
  }

  dispose(): void {
    this.agentTargets[0].dispose();
    this.agentTargets[1].dispose();
    this.trailTargets[0].dispose();
    this.trailTargets[1].dispose();
    this.agentMaterial.dispose();
    this.seedMaterial.dispose();
    this.trailMaterial.dispose();
    this.depositMaterial.dispose();
    this.agentQuad.geometry.dispose();
    this.trailQuad.geometry.dispose();
    this.depositPoints.geometry.dispose();
  }
}
