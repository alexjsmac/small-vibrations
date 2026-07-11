import * as THREE from 'three';
import type { Viz, VizContext, AudioFrame, VizModule, VizPointerEvent } from '../types';
import { RDSim } from './rd';
import { ACTS, paramsAt, type ActParams } from './sections';
import { mulberry32 } from '../random';

const VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const DISPLAY_FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uField;
uniform vec2 uTexel;    // sim texel size
uniform vec2 uCover;    // cover-fit uv scale
uniform vec2 uScroll;   // accumulated display drift (uv) — the "march"; sim texture wraps
uniform float uTime, uGain, uPalMix, uNebula, uGlow, uBass, uHigh, uPulse;
uniform vec4 uRipples[3]; // xy = field uv center, z = age (s), w = base amp (0 = inactive)

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1,0)), u.x),
             mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), u.x), u.y);
}
float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++){ v += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return v;
}

void main(){
  vec2 uv = (vUv - 0.5) * uCover + 0.5 - uScroll;

  // Poke ripples: distort uv before the field/lighting samples below so the
  // wave visibly warps both the organism and its shading, then add a glow
  // ring on top. Placed here (not after B/gradient sampling) deliberately.
  vec3 rippleGlow = vec3(0.0);
  for (int i = 0; i < 3; i++) {
    vec4 rp = uRipples[i];
    if (rp.w <= 0.0) continue;
    vec2 rd = uv - rp.xy;
    rd -= floor(rd + 0.5); // torus wrap: uv is unbounded (scroll drift) while rp.xy is wrapped to [0,1)
    float dist = length(rd);
    float amp = rp.w * exp(-rp.z * 3.2);
    float wave = sin(dist * 160.0 - rp.z * 7.0) * exp(-dist * 16.0) * amp;
    uv += normalize(rd + 1e-5) * wave * 0.012;
    float ring = exp(-pow((dist - rp.z * 0.14) * 26.0, 2.0)) * amp;
    rippleGlow += vec3(1.0, 0.96, 0.88) * ring;
  }

  float B = texture2D(uField, uv).g;

  // Gradient → fake lighting (wet, embossed organisms).
  float bx = texture2D(uField, uv + vec2(uTexel.x, 0.0)).g - texture2D(uField, uv - vec2(uTexel.x, 0.0)).g;
  float by = texture2D(uField, uv + vec2(0.0, uTexel.y)).g - texture2D(uField, uv - vec2(0.0, uTexel.y)).g;
  vec3 n = normalize(vec3(-bx * 6.0, -by * 6.0, 1.0));
  vec3 L = normalize(vec3(cos(uTime * 0.05), sin(uTime * 0.05), 0.9));
  float diff = max(dot(n, L), 0.0);
  float spec = pow(max(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0), 24.0);

  // Background nebula: domain-warped fbm, deep indigo → violet.
  vec2 w = vec2(fbm(vUv * 2.0 + uTime * 0.01), fbm(vUv * 2.0 + 5.2 - uTime * 0.008));
  float neb = fbm(vUv * 3.0 + w * 1.6);
  vec3 bg = mix(vec3(0.024, 0.016, 0.08), vec3(0.10, 0.03, 0.22), neb) * uNebula;
  bg += vec3(0.0, 0.02, 0.03) * fbm(vUv * 6.0 - w) * uNebula;

  // Organism palette ramp on B, morphed by uPalMix (cool → hot).
  vec3 c1 = mix(vec3(0.05, 0.15, 0.45), vec3(0.25, 0.06, 0.30), uPalMix); // body deep
  vec3 c2 = mix(vec3(0.00, 0.76, 0.78), vec3(1.00, 0.31, 0.47), uPalMix); // body main
  vec3 c3 = mix(vec3(0.48, 0.18, 0.97), vec3(1.00, 0.82, 0.40), uPalMix); // rim/hot
  // Regional hue drift so neighbouring colonies differ — kills the monochrome wash.
  vec3 c2b = mix(vec3(0.10, 0.95, 0.55), vec3(1.00, 0.55, 0.20), uPalMix); // alt body (bio-green → amber)
  float hueVar = vnoise(uv * 5.0 + 3.7);
  vec3 bodyCol = mix(c2, c2b, smoothstep(0.3, 0.7, hueVar));
  float body = smoothstep(0.12, 0.35, B);
  float core = smoothstep(0.30, 0.55, B);
  vec3 org = c1 * body + bodyCol * core * (0.7 + 0.5 * diff);
  float edge = length(vec2(bx, by)) * 4.0;
  org += c3 * edge * uGlow;
  org += vec3(1.0, 0.95, 0.85) * spec * core * 0.6;

  float pulse = 1.0 + uBass * uPulse * 0.5;
  vec3 col = bg + org * uGain * pulse;
  col += c3 * uHigh * 0.06 * hash(vUv * 731.0 + uTime); // high-band shimmer grain
  col += rippleGlow * 1.4; // near-white additive glow reads on both dark void acts and dense colony fields

  // Vignette + gentle filmic curve.
  float vig = smoothstep(1.25, 0.35, length(vUv - 0.5) * 1.6);
  col *= vig;
  col = 1.0 - exp(-col * 2.2);
  gl_FragColor = vec4(col, 1.0);
}
`;

/** Max simultaneous life-injection seeds (must match uSeeds[4] in rd.ts). */
const SEED_SLOTS = 4;
/** Seed lifetime (seconds) — strength ramps 0.5 → 0 over this window. */
const SEED_LIFETIME = 0.4;
const SEED_STRENGTH = 0.5;
/** Bass-onset detector: excess over its own slow EMA that triggers a seed. */
const ONSET_THRESHOLD = 0.12;
const ONSET_COOLDOWN = 1.5;

/** Poke (pointer down) seed: bigger + hotter than ambient seeds so a tap reads clearly. */
const POKE_RADIUS = 0.03;
const POKE_STRENGTH = 0.65;

/** Max simultaneous ripples (must match uRipples[3] in DISPLAY_FRAG above). */
const RIPPLE_SLOTS = 3;
/** Ripple lifetime (seconds) — matches the shader's own exp(-age*3.2) decay window. */
const RIPPLE_LIFETIME = 1.1;

/** Drag-release momentum: friction decay rate and the speed floor below which we snap to a stop. */
const MOMENTUM_FRICTION = 2.5;
const MOMENTUM_STOP_SPEED = 0.0005;
/** Velocity EMA smoothing rate and clamp (uv/s) — keeps a jittery drag from producing a wild fling. */
const VEL_EMA_RATE = 10;
const VEL_MAX = 1.5;

interface SeedSlot {
  age: number;
  active: boolean;
  /** Peak strength this slot was activated with — ages decay proportionally from this, not a global constant, since pokes use a different strength than ambient seeds. */
  strength: number;
}

interface RippleSlot {
  age: number;
  active: boolean;
}

/**
 * "They Come Marching" (primordial take) — a living Gray-Scott
 * reaction-diffusion micro-ecosystem staged across the song's measured
 * sections (see sections.ts). The sim runs entirely on the GPU (rd.ts);
 * this module owns the display pass, staging, seed scheduling, and
 * audio-reactive envelopes.
 *
 * Debug: ?regime=N (0-6) forces that act's params permanently, ?rd=F,K
 * overrides feed/kill, ?steps=N overrides simulation steps/frame.
 */
class Primordial implements Viz {
  private renderer!: THREE.WebGLRenderer;
  private sim!: RDSim;
  private scene!: THREE.Scene;
  private camera!: THREE.OrthographicCamera;
  private quad!: THREE.Mesh;
  private material!: THREE.ShaderMaterial;

  private rand!: () => number;
  private stepsPerFrame = 14;
  private forcedAct: ActParams | null = null;
  private rdOverride: { feed: number; kill: number } | null = null;

  private bassE = 0;
  private bassSlowE = 0;
  private highE = 0;
  private onsetCooldown = 0;

  private seeds: SeedSlot[] = [];
  private seedUniformValues!: THREE.Vector4[];
  private seedTimeToNext = 0;

  private ripples: RippleSlot[] = [];
  private rippleUniformValues!: THREE.Vector4[];

  /** Pointer/drag-pan state — all scalars, zero per-frame allocation. */
  private held = false;
  private dragDx = 0;
  private dragDy = 0;
  private velX = 0;
  private velY = 0;

  private firstUpdate = true;
  private aspect = 16 / 9;
  private simW = 512;
  private simH = 512;

  init(ctx: VizContext) {
    const { renderer, seed, quality } = ctx;
    this.renderer = renderer;

    const params = new URLSearchParams(location.search);
    const regime = params.get('regime');
    if (regime !== null) {
      const idx = Math.min(ACTS.length - 1, Math.max(0, parseInt(regime, 10) || 0));
      this.forcedAct = ACTS[idx];
    }
    const rd = params.get('rd');
    if (rd) {
      const [f, k] = rd.split(',').map(Number);
      if (Number.isFinite(f) && Number.isFinite(k)) this.rdOverride = { feed: f, kill: k };
    }
    const steps = params.get('steps');
    if (steps) {
      const n = parseInt(steps, 10);
      if (Number.isFinite(n) && n > 0) this.stepsPerFrame = n;
    }
    if (this.stepsPerFrame === 14) {
      this.stepsPerFrame = quality.level === 'full' ? 14 : 8;
    }

    this.rand = mulberry32(seed ^ 0x7a11a0c1);

    const canvas = renderer.domElement;
    this.aspect = canvas.clientWidth > 0 && canvas.clientHeight > 0
      ? canvas.clientWidth / canvas.clientHeight
      : 16 / 9;
    const clampedAspect = Math.min(2.2, Math.max(1, this.aspect));
    const shortSide = quality.level === 'full' ? 512 : 256;
    this.simW = Math.round(shortSide * clampedAspect);
    this.simH = shortSide;
    // Landscape is the common case; if the viewport is portrait, swap so the
    // long side still tracks the larger screen dimension.
    if (this.aspect < 1) {
      const tmp = this.simW;
      this.simW = this.simH;
      this.simH = tmp;
    }

    this.sim = new RDSim(renderer, this.simW, this.simH);

    for (let i = 0; i < SEED_SLOTS; i++) this.seeds.push({ age: 0, active: false, strength: 0 });
    this.seedUniformValues = this.sim.uniforms.uSeeds.value;

    for (let i = 0; i < RIPPLE_SLOTS; i++) this.ripples.push({ age: 0, active: false });
    this.rippleUniformValues = [];
    for (let i = 0; i < RIPPLE_SLOTS; i++) this.rippleUniformValues.push(new THREE.Vector4(0, 0, 0, 0));

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const geometry = new THREE.PlaneGeometry(2, 2);
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: DISPLAY_FRAG,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uField: { value: this.sim.texture },
        uTexel: { value: new THREE.Vector2(1 / this.simW, 1 / this.simH) },
        uCover: { value: new THREE.Vector2(1, 1) },
        uScroll: { value: new THREE.Vector2(0, 0) },
        uTime: { value: 0 },
        uGain: { value: 0.5 },
        uPalMix: { value: 0 },
        uNebula: { value: 0.5 },
        uGlow: { value: 0.5 },
        uBass: { value: 0 },
        uHigh: { value: 0 },
        uPulse: { value: 0.3 },
        uRipples: { value: this.rippleUniformValues },
      },
    });
    this.quad = new THREE.Mesh(geometry, this.material);
    this.scene.add(this.quad);

    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    this.resize(w, h);
  }

  private applyActParams(p: ActParams) {
    const su = this.sim.uniforms;
    su.uFeed.value = this.rdOverride ? this.rdOverride.feed : p.feed;
    su.uKill.value = this.rdOverride ? this.rdOverride.kill : p.kill;
    su.uDScale.value = p.dScale;
    su.uAniso.value.set(p.anisoX, p.anisoY);
    // advectX/Y drive the display scroll only. In-sim advection resamples the
    // field every step — the accumulated blur exterminates the colony over a
    // warmup's ~1000 steps (verified: the march act came up empty).
    su.uAdvect.value.set(0, 0);
    su.uFeedNoise.value = p.feedNoise;

    const du = this.material.uniforms;
    du.uGain.value = p.fieldGain;
    du.uPalMix.value = p.palMix;
    du.uNebula.value = p.nebula;
    du.uGlow.value = p.glow;
    du.uPulse.value = p.pulse;
  }

  private activateSeed(x: number, y: number, radius = 0.006 + this.rand() * 0.012, strength = SEED_STRENGTH) {
    // Reuse the oldest/inactive slot; if all active, steal slot 0 rather
    // than allocate — seed churn is expected to be frequent but sparse.
    let idx = this.seeds.findIndex((s) => !s.active);
    if (idx < 0) idx = 0;
    const slot = this.seeds[idx];
    slot.active = true;
    slot.age = 0;
    slot.strength = strength;
    this.seedUniformValues[idx].set(x, y, radius, strength);
  }

  private activateRipple(x: number, y: number) {
    // Same reuse-or-steal idiom as activateSeed — ripples are sparse (one
    // per poke), so 3 slots is plenty of headroom for rapid tapping.
    let idx = this.ripples.findIndex((r) => !r.active);
    if (idx < 0) idx = 0;
    const slot = this.ripples[idx];
    slot.active = true;
    slot.age = 0;
    this.rippleUniformValues[idx].set(x, y, 0, 1);
  }

  private scheduleSeeds(dt: number, seedRate: number) {
    // Poisson process: expected events per second = seedRate/60.
    const rate = Math.max(0, seedRate) / 60;
    if (rate <= 0) return;
    this.seedTimeToNext -= dt;
    while (this.seedTimeToNext <= 0) {
      this.activateSeed(this.rand(), this.rand());
      // Exponential inter-arrival time.
      const u = Math.max(1e-6, this.rand());
      this.seedTimeToNext += -Math.log(u) / rate;
    }
  }

  private updateSeedAges(dt: number) {
    for (let i = 0; i < this.seeds.length; i++) {
      const slot = this.seeds[i];
      if (!slot.active) continue;
      slot.age += dt;
      const t = Math.min(1, slot.age / SEED_LIFETIME);
      // Decay from the slot's own peak strength, not a global constant —
      // pokes activate at POKE_STRENGTH (0.65), ambient seeds at SEED_STRENGTH.
      const strength = slot.strength * (1 - t);
      this.seedUniformValues[i].w = strength;
      if (t >= 1) {
        slot.active = false;
        this.seedUniformValues[i].w = 0;
      }
    }
  }

  private updateRippleAges(dt: number) {
    for (let i = 0; i < this.ripples.length; i++) {
      const slot = this.ripples[i];
      if (!slot.active) continue;
      slot.age += dt;
      if (slot.age >= RIPPLE_LIFETIME) {
        slot.active = false;
        this.rippleUniformValues[i].w = 0;
      } else {
        this.rippleUniformValues[i].z = slot.age;
      }
    }
  }

  /**
   * Populate the field before the long settle: the init state is A=1/B=0
   * everywhere, and Gray-Scott can't start from nothing — without these
   * dabs the warmup develops an empty field and the scene opens sterile.
   */
  private warmup() {
    // Small dabs survive and divide; big saturated ones collapse and die.
    for (let round = 0; round < 24; round++) {
      for (let i = 0; i < SEED_SLOTS; i++) {
        this.seedUniformValues[i].set(this.rand(), this.rand(), 0.004 + this.rand() * 0.01, 0.35);
      }
      this.sim.step(8);
    }
    for (let i = 0; i < SEED_SLOTS; i++) this.seedUniformValues[i].w = 0;
    this.sim.step(900);
  }

  update(dt: number, audio: AudioFrame) {
    const st = this.forcedAct ?? paramsAt(audio.time).params;

    if (this.firstUpdate) {
      this.firstUpdate = false;
      this.applyActParams(st);
      this.warmup();
    }

    this.applyActParams(st);
    this.sim.uniforms.uNoiseTime.value += dt * 0.15;

    // Smooth audio bands with EMAs so seed/pulse reactivity isn't jittery.
    this.bassE += (audio.bass - this.bassE) * Math.min(1, dt * 8);
    this.highE += (audio.high - this.highE) * Math.min(1, dt * 8);
    this.bassSlowE += (audio.bass - this.bassSlowE) * Math.min(1, dt * 1.5);

    this.scheduleSeeds(dt, st.seedRate);

    this.onsetCooldown -= dt;
    if (this.onsetCooldown <= 0 && this.bassE - this.bassSlowE > ONSET_THRESHOLD) {
      this.activateSeed(this.rand(), this.rand());
      this.onsetCooldown = ONSET_COOLDOWN;
    }

    this.updateSeedAges(dt);
    this.updateRippleAges(dt);

    const du = this.material.uniforms;
    du.uTime.value += dt;
    du.uBass.value = this.bassE;
    du.uHigh.value = this.highE;
    // The visible "march": drift the display window across the (wrapping)
    // field, driven by the act's advection — mids nudge the pace.
    const scroll = du.uScroll.value as THREE.Vector2;
    const drift = 0.25 * (1 + audio.mid * 0.5);
    scroll.x += st.advectX * dt * drift;
    scroll.y += st.advectY * dt * drift;

    // Drag momentum: composes additively on top of the act's march drift
    // above. While held, EMA this frame's accumulated drag into an
    // instantaneous velocity; after release, integrate it into scroll with
    // exponential friction so a flung drag glides to a stop.
    const cover = du.uCover.value as THREE.Vector2;
    if (this.held) {
      if (dt > 1e-5) {
        const k = Math.min(1, dt * VEL_EMA_RATE);
        const instVelX = Math.min(VEL_MAX, Math.max(-VEL_MAX, this.dragDx / dt));
        const instVelY = Math.min(VEL_MAX, Math.max(-VEL_MAX, this.dragDy / dt));
        this.velX += (instVelX - this.velX) * k;
        this.velY += (instVelY - this.velY) * k;
      }
      this.dragDx = 0;
      this.dragDy = 0;
    } else if (this.velX !== 0 || this.velY !== 0) {
      scroll.x += this.velX * cover.x * dt;
      scroll.y += this.velY * cover.y * dt;
      const friction = Math.exp(-MOMENTUM_FRICTION * dt);
      this.velX *= friction;
      this.velY *= friction;
      if (Math.abs(this.velX) < MOMENTUM_STOP_SPEED) this.velX = 0;
      if (Math.abs(this.velY) < MOMENTUM_STOP_SPEED) this.velY = 0;
    }
  }

  pointer(e: VizPointerEvent) {
    const du = this.material.uniforms;
    const cover = du.uCover.value as THREE.Vector2;
    const scroll = du.uScroll.value as THREE.Vector2;

    if (e.type === 'down') {
      this.held = true;
      this.dragDx = 0;
      this.dragDy = 0;
      this.velX = 0; // grabbing kills any in-flight momentum glide
      this.velY = 0;

      // Screen uv -> field uv via the display shader's own formula
      // (uv = (vUv-0.5)*uCover+0.5-uScroll), then fract-wrap into [0,1).
      // uScroll accumulates unboundedly (act drift + panning) and the sim's
      // seed-injection math (`vec2 d = vUv - s.xy` in rd.ts) does not wrap,
      // so an unwrapped field position silently misses after minutes of drift.
      let fx = (e.x - 0.5) * cover.x + 0.5 - scroll.x;
      let fy = (e.y - 0.5) * cover.y + 0.5 - scroll.y;
      fx -= Math.floor(fx);
      fy -= Math.floor(fy);
      this.activateSeed(fx, fy, POKE_RADIUS, POKE_STRENGTH);
      this.activateRipple(fx, fy);
      return;
    }

    if (e.type === 'move') {
      if (!this.held) return;
      // 1:1 finger tracking, derived directly from the display formula: a
      // uv-space pointer delta must scale by uCover to move the sampled
      // field by the same visual delta (cover != 1 off cover-fit aspect).
      scroll.x += e.dx * cover.x;
      scroll.y += e.dy * cover.y;
      this.dragDx += e.dx;
      this.dragDy += e.dy;
      return;
    }

    if (e.type === 'up') {
      this.held = false;
      return;
    }

    // 'cancel': no fling from an interrupted gesture.
    this.held = false;
    this.velX = 0;
    this.velY = 0;
    this.dragDx = 0;
    this.dragDy = 0;
  }

  render() {
    this.sim.step(this.stepsPerFrame);
    this.material.uniforms.uField.value = this.sim.texture;
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.scene, this.camera);
  }

  resize(w: number, h: number) {
    if (!this.material || w <= 0 || h <= 0) return;
    const viewAspect = w / h;
    const simAspect = this.simW / this.simH;
    // Cover-fit: scale UVs around center by the max ratio so the sim
    // texture fills the viewport without distortion.
    const cover = this.material.uniforms.uCover.value as THREE.Vector2;
    if (viewAspect > simAspect) {
      cover.set(1, simAspect / viewAspect);
    } else {
      cover.set(viewAspect / simAspect, 1);
    }
  }

  dispose() {
    this.sim.dispose();
    this.material.dispose();
    this.quad.geometry.dispose();
    this.renderer.setRenderTarget(null);
  }
}

const mod: VizModule = { default: () => new Primordial() };
export default mod.default;
