import * as THREE from 'three';
import type { Viz, VizContext, AudioFrame, VizModule, VizPointerEvent } from '../types';
import {
  PhysarumSim, DISH_R,
  TRAIL_TEX_FULL, TRAIL_TEX_LITE,
  FOOD_SLOTS_FULL, FOOD_SLOTS_LITE, BURST_VIS_SLOTS_FULL, BURST_VIS_SLOTS_LITE,
  SIM_STEPS_FULL, SIM_STEPS_LITE, WARMUP_STEPS_INIT, WARMUP_STEPS_LOOP, WARMUP_TICK_DT,
} from './physarum';
import { DISH_VERT, buildDishFragmentShader } from './dishShader';
import { Spores } from './spores';
import { paramsAt, arcAt, type ActParams } from './sections';
import { mulberry32 } from '../random';

/** Bass-onset detector (a1/a2's EMA + margin + cooldown recipe): excess over its own slow EMA triggers a small spore burst + flash. */
const ONSET_THRESHOLD = 0.12;
const ONSET_COOLDOWN = 1.1;

/** uFlash exponential decay rate (1/s) and per-event kick sizes. */
const FLASH_DECAY = 3.2;
const FLASH_KICK_ONSET = 0.4;
const FLASH_KICK_AMBIENT = 0.25;
const FLASH_KICK_BOUNDARY = 1.1;
const FLASH_CEILING = 1.6;

/** Smoothed audio.mid -> agent speed modulation gain (the plan's "each band has one job" table: mid's one job here). */
const MID_SPEED_GAIN = 0.5;

/** Single-slot sim burst (physarum.ts's uBurst/uBurstSeed): how long a teleport window stays open once triggered. Short — a handful of sim ticks is plenty for the hash test to select agents. */
const BURST_SIM_DURATION = 0.18;
/** Sim-side burst radius/strength for ambient (onset/Poisson) vs. the two scripted mass-spawn hits. */
const BURST_RADIUS_AMBIENT = 0.05;
const BURST_STRENGTH_AMBIENT = 0.12;
const BURST_RADIUS_MASS = 0.09;
const BURST_STRENGTH_MASS = 0.45;

/** Composite-side visual burst-flash pool lifetime (seconds) — matches dishShader.ts's exp(-age*3.4) ring-decay curve (negligible by ~1.2s). */
const BURST_VIS_LIFETIME = 1.2;
/** `?burst=always` debug affordance rate (events/min). */
const DEBUG_BURST_RATE = 50;

/** Nutrient-drop (tap) pool: radius and lifetime (~6s decay, per the plan). */
const FOOD_RADIUS = 0.06;
const FOOD_LIFETIME = 6;
/** `?food=always` debug affordance rate (events/min). */
const DEBUG_FOOD_RATE = 20;

/** Drag-release momentum: friction decay rate and the speed floor below which we snap to a stop (a1/a2 idiom, verbatim shape). */
const MOMENTUM_FRICTION = 2.5;
const MOMENTUM_STOP_SPEED = 0.0005;
const VEL_EMA_RATE = 10;
const VEL_MAX = 1.5;
/** Soft pan radius (dish-uv units) — a small looking-around range within/near the dish; hitting it zeroes momentum. */
const MAX_PAN = 0.16;

interface AgeSlot {
  age: number;
  active: boolean;
}

/**
 * "Icky, Sticky, & Thriving" — the petri-dish biosphere. Composes
 * PhysarumSim (physarum.ts, the GPU slime-mold network) + the dish
 * composite quad (dishShader.ts) + drifting spore motes (spores.ts), all in
 * one self-owned orthographic scene/camera (VizHost's ctx.scene/ctx.camera
 * are unused — same pattern as a1-primordial/a2-hive's fullscreen-shader
 * modules; `render()` is implemented so VizHost's default
 * renderer.render(this.scene, this.camera) is bypassed).
 *
 * Debug: `?solo=veins|spores|fruit` isolates a layer, `?burst=always`
 * forces a steady ambient burst stream, `?food=always` forces a steady
 * nutrient-drop stream (verification affordances for their respective
 * pools), plus the standard `?t=`, `?q=`, `?debug=1`.
 */
class Biosphere implements Viz {
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.OrthographicCamera;
  private sim!: PhysarumSim;
  private dishQuad!: THREE.Mesh;
  private dishMaterial!: THREE.ShaderMaterial;
  private spores!: Spores;

  private rand!: () => number;
  private soloDish = true;
  private soloSpores = true;
  private forceBurstAlways = false;
  private forceFoodAlways = false;

  private full = true;
  private foodSlotCount = FOOD_SLOTS_FULL;
  private burstVisSlotCount = BURST_VIS_SLOTS_FULL;
  private stepsPerFrame = SIM_STEPS_FULL;

  /** Cover-fit scale, computed in resize() (dish is inherently square, so this is the same aspect-1 cover-fit idiom as a1/a2). */
  private cover = new THREE.Vector2(1, 1);
  /** Dish-space pan offset (uv units) — pointer-drag only, no ambient drift (not in the plan's ActParams surface for b1). */
  private pan = new THREE.Vector2(0, 0);

  private bassE = 0;
  private midE = 0;
  private highE = 0;
  private bassSlowE = 0;
  private onsetCooldown = 0;
  private flash = 0;

  private burstTimeToNext = 0;
  private burstActive = false;
  private burstTimeLeft = 0;

  private foodTimeToNext = 0;

  private foodSlots: AgeSlot[] = [];
  private foodValues!: THREE.Vector4[];
  private burstVisSlots: AgeSlot[] = [];
  private burstVisValues!: THREE.Vector4[];

  /** Set until the first update() call runs the initial warmup — mirrors a1's warmup gate, and (since init() reruns on a mid-song quality toggle) transparently covers quality-reload warmup too. */
  private firstUpdate = true;
  /** Cached from the most recent update(dt, ...) call so render() (called by VizHost after update(), with no dt of its own) can advance sim.step() by the same dt this frame's simulation used. */
  private lastDt = 0;
  /** Previous frame's song time, for edge-triggered 54s/178s boundary detection and loop-wrap detection (a2 idiom). */
  private lastSongTime = -1;

  /** Pointer/drag-pan state — all scalars, zero per-frame allocation. */
  private held = false;
  private dragDx = 0;
  private dragDy = 0;
  private velX = 0;
  private velY = 0;

  init(ctx: VizContext) {
    const { renderer, seed, quality } = ctx;
    this.renderer = renderer;
    this.rand = mulberry32(seed ^ 0xb105fe4e);

    const params = new URLSearchParams(location.search);
    const solo = params.get('solo');
    this.soloDish = !solo || solo === 'veins' || solo === 'fruit';
    this.soloSpores = !solo || solo === 'spores';
    this.forceBurstAlways = params.get('burst') === 'always';
    this.forceFoodAlways = params.get('food') === 'always';
    const soloMode = solo === 'veins' ? 1 : solo === 'fruit' ? 2 : 0;

    this.full = quality.level === 'full';
    this.foodSlotCount = this.full ? FOOD_SLOTS_FULL : FOOD_SLOTS_LITE;
    this.burstVisSlotCount = this.full ? BURST_VIS_SLOTS_FULL : BURST_VIS_SLOTS_LITE;
    this.stepsPerFrame = this.full ? SIM_STEPS_FULL : SIM_STEPS_LITE;

    for (let i = 0; i < this.foodSlotCount; i++) this.foodSlots.push({ age: 0, active: false });
    this.foodValues = [];
    for (let i = 0; i < this.foodSlotCount; i++) this.foodValues.push(new THREE.Vector4(0, 0, FOOD_RADIUS, 0));

    for (let i = 0; i < this.burstVisSlotCount; i++) this.burstVisSlots.push({ age: 0, active: false });
    this.burstVisValues = [];
    for (let i = 0; i < this.burstVisSlotCount; i++) this.burstVisValues.push(new THREE.Vector4(0, 0, 0, 0));

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    if (solo) {
      // Bright neutral background for solo=spores (the dish quad, which
      // would otherwise cover the whole viewport, is not added to the
      // scene in that case) — the house "isolate on a bright background"
      // convention (a1-they-come-marching/index.ts).
      this.scene.background = new THREE.Color(0x3a3040);
    }

    // ---- sim ----
    this.sim = new PhysarumSim(renderer, this.full, this.foodSlotCount, this.foodValues);

    // ---- dish composite quad ----
    const trailTexSize = this.full ? TRAIL_TEX_FULL : TRAIL_TEX_LITE;
    this.dishMaterial = new THREE.ShaderMaterial({
      vertexShader: DISH_VERT,
      fragmentShader: buildDishFragmentShader(this.full, this.foodSlotCount, this.burstVisSlotCount),
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uTrail: { value: null },
        uTrailTexel: { value: new THREE.Vector2(1 / trailTexSize, 1 / trailTexSize) },
        uCover: { value: new THREE.Vector2(1, 1) },
        uPan: { value: this.pan },
        uZoom: { value: 1 },
        uTime: { value: 0 },
        uBass: { value: 0 },
        uHigh: { value: 0 },
        uFlash: { value: 0 },
        uThrob: { value: 0 },
        uShimmer: { value: 0 },
        uSat: { value: 1 },
        uPalMix: { value: 0 },
        uEnergy: { value: 0 },
        uFruitGlow: { value: 0 },
        uFood: { value: this.foodValues },
        uBurstVis: { value: this.burstVisValues },
        uSoloMode: { value: soloMode },
      },
    });
    this.dishQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.dishMaterial);
    if (this.soloDish) this.scene.add(this.dishQuad);

    // ---- spores ----
    this.spores = new Spores(seed, quality, renderer);
    if (this.soloSpores) this.scene.add(this.spores.object);

    const canvas = renderer.domElement;
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    this.resize(w, h);
  }

  private kickFlash(amount: number) {
    this.flash = Math.min(FLASH_CEILING, this.flash + amount);
  }

  /** Uniform-area random point inside the inscribed dish circle (mirrors physarum.ts's SEED_FRAG sampling, done here in JS for CPU-side event placement). */
  private randomDishPoint(): [number, number] {
    const r = DISH_R * Math.sqrt(this.rand());
    const theta = this.rand() * Math.PI * 2;
    return [0.5 + Math.cos(theta) * r, 0.5 + Math.sin(theta) * r];
  }

  private activateBurstVis(x: number, y: number, strength: number) {
    let idx = this.burstVisSlots.findIndex((s) => !s.active);
    if (idx < 0) idx = 0;
    const slot = this.burstVisSlots[idx];
    slot.active = true;
    slot.age = 0;
    this.burstVisValues[idx].set(x, y, 0, strength);
  }

  private updateBurstVisAges(dt: number) {
    for (let i = 0; i < this.burstVisSlots.length; i++) {
      const slot = this.burstVisSlots[i];
      if (!slot.active) continue;
      slot.age += dt;
      if (slot.age >= BURST_VIS_LIFETIME) {
        slot.active = false;
        this.burstVisValues[i].w = 0;
      } else {
        this.burstVisValues[i].z = slot.age;
      }
    }
  }

  /** Fires the single-slot sim burst (teleports a fraction of agents to x,y for BURST_SIM_DURATION) plus a visual flash ring at the same point. */
  private triggerBurst(x: number, y: number, radius: number, strength: number) {
    this.burstActive = true;
    this.burstTimeLeft = BURST_SIM_DURATION;
    this.sim.setBurst(x, y, radius, strength, this.rand());
    this.activateBurstVis(x, y, 1);
  }

  private updateBurstActive(dt: number) {
    if (!this.burstActive) return;
    this.burstTimeLeft -= dt;
    if (this.burstTimeLeft <= 0) {
      this.burstActive = false;
      this.sim.setBurst(0, 0, 0, 0, 0);
    }
  }

  private scheduleBursts(dt: number, ratePerMinute: number) {
    const rate = Math.max(0, ratePerMinute) / 60;
    if (rate <= 0) return;
    this.burstTimeToNext -= dt;
    while (this.burstTimeToNext <= 0) {
      const [x, y] = this.randomDishPoint();
      this.triggerBurst(x, y, BURST_RADIUS_AMBIENT, BURST_STRENGTH_AMBIENT);
      this.kickFlash(FLASH_KICK_AMBIENT);
      const u = Math.max(1e-6, this.rand());
      this.burstTimeToNext += -Math.log(u) / rate;
    }
  }

  /** Scripted mass-spawn hit (54s/178s boundary crossings): a stronger, wider sim burst plus several simultaneous visual flashes across the dish. */
  private scriptedMassBurst() {
    this.triggerBurst(0.5, 0.5, BURST_RADIUS_MASS, BURST_STRENGTH_MASS);
    for (let i = 0; i < 3; i++) {
      const [x, y] = this.randomDishPoint();
      this.activateBurstVis(x, y, 1);
    }
    this.kickFlash(FLASH_KICK_BOUNDARY);
  }

  private activateFood(x: number, y: number) {
    let idx = this.foodSlots.findIndex((s) => !s.active);
    if (idx < 0) idx = 0;
    const slot = this.foodSlots[idx];
    slot.active = true;
    slot.age = 0;
    this.foodValues[idx].set(x, y, FOOD_RADIUS, 1);
  }

  private updateFoodAges(dt: number) {
    for (let i = 0; i < this.foodSlots.length; i++) {
      const slot = this.foodSlots[i];
      if (!slot.active) continue;
      slot.age += dt;
      if (slot.age >= FOOD_LIFETIME) {
        slot.active = false;
        this.foodValues[i].w = 0;
      } else {
        this.foodValues[i].w = 1 - slot.age / FOOD_LIFETIME;
      }
    }
  }

  private scheduleFood(dt: number, ratePerMinute: number) {
    const rate = Math.max(0, ratePerMinute) / 60;
    if (rate <= 0) return;
    this.foodTimeToNext -= dt;
    while (this.foodTimeToNext <= 0) {
      const [x, y] = this.randomDishPoint();
      this.activateFood(x, y);
      const u = Math.max(1e-6, this.rand());
      this.foodTimeToNext += -Math.log(u) / rate;
    }
  }

  /** Runs the staged warmup: seed agents (if requested) and step the sim `steps` times at a fixed WARMUP_TICK_DT so the network is already formed, regardless of the caller's frame rate. */
  private warmup(p: ActParams, steps: number, reseed: boolean) {
    if (reseed) this.sim.seedAgents(this.rand);
    this.sim.setActParams(p);
    this.sim.step(WARMUP_TICK_DT * steps, steps);
  }

  update(dt: number, audio: AudioFrame) {
    const section = paramsAt(audio.time);
    const p = section.params;
    this.lastDt = dt;

    if (this.firstUpdate) {
      this.firstUpdate = false;
      // Covers cold loads, `?t=` deep links, AND mid-song quality toggles
      // (VizHost's reloadCurrent reruns init(), resetting firstUpdate to
      // true) — all three land on a formed network instead of a bare dish
      // waiting for agents to organize live.
      this.warmup(p, WARMUP_STEPS_INIT, true);
    }

    // Loop-wrap: song time jumping backward by more than 10s means the
    // track looped back to 0 — reseed agents + clear the trail so the
    // network resets with the song instead of a new play inheriting the
    // previous play's biosphere.
    if (this.lastSongTime >= 0 && audio.time < this.lastSongTime - 10) {
      this.sim.clearTrail();
      this.warmup(p, WARMUP_STEPS_LOOP, true);
    }

    // The two scripted hits land as discrete state changes, not crossfades
    // — same edge-triggered detection as a2-hive's index.ts. The `< 0.5`
    // guard rejects the ?t= dev-seed jump and the 251.238->0 loop wrap as
    // false triggers (a normal frame's dt never approaches that).
    if (this.lastSongTime >= 0 && audio.time - this.lastSongTime >= 0 && audio.time - this.lastSongTime < 0.5) {
      if (this.lastSongTime < 54 && audio.time >= 54) this.scriptedMassBurst();
      if (this.lastSongTime < 178 && audio.time >= 178) this.scriptedMassBurst();
    }
    this.lastSongTime = audio.time;

    // Smooth audio bands with EMAs (a1/a2 idiom) so reactivity isn't jittery.
    const k = Math.min(1, dt * 8);
    this.bassE += (audio.bass - this.bassE) * k;
    this.midE += (audio.mid - this.midE) * k;
    this.highE += (audio.high - this.highE) * k;
    this.bassSlowE += (audio.bass - this.bassSlowE) * Math.min(1, dt * 1.5);

    // Bass-onset detector: excess over its own slow EMA fires a small
    // ambient spore burst + flash.
    this.onsetCooldown -= dt;
    if (this.onsetCooldown <= 0 && this.bassE - this.bassSlowE > ONSET_THRESHOLD) {
      const [x, y] = this.randomDishPoint();
      this.triggerBurst(x, y, BURST_RADIUS_AMBIENT, BURST_STRENGTH_AMBIENT);
      this.kickFlash(FLASH_KICK_ONSET);
      this.onsetCooldown = ONSET_COOLDOWN;
    }

    this.scheduleBursts(dt, this.forceBurstAlways ? DEBUG_BURST_RATE : p.burstRate);
    this.updateBurstActive(dt);
    this.updateBurstVisAges(dt);

    this.scheduleFood(dt, this.forceFoodAlways ? DEBUG_FOOD_RATE : 0);
    this.updateFoodAges(dt);

    this.flash *= Math.exp(-FLASH_DECAY * dt);

    // mid's one job (the plan's audio-map table): smoothed speed modulation.
    this.sim.setSpeedMod(1 + this.midE * MID_SPEED_GAIN);
    this.sim.setActParams(p);

    const du = this.dishMaterial.uniforms;
    du.uTime.value += dt;
    du.uBass.value = this.bassE;
    du.uHigh.value = this.highE;
    du.uFlash.value = this.flash;
    du.uThrob.value = p.throb;
    du.uShimmer.value = p.shimmer;
    du.uSat.value = p.sat;
    du.uPalMix.value = p.palMix;
    du.uFruitGlow.value = p.fruitGlow;
    // arcAt's continuous energy envelope -> composite brightness lift; its
    // near-vertical ARC_KEYS steps at 54s/178s are the "palette snap" half
    // of the scripted discrete hits (scriptedMassBurst above is the other).
    du.uEnergy.value = arcAt(audio.time).energy;

    const zoom = p.zoom;
    du.uZoom.value = zoom;

    // Drag momentum: while held, EMA this frame's accumulated drag into an
    // instantaneous velocity; after release, integrate it into pan with
    // exponential friction so a flung drag glides to a stop (a1/a2 idiom,
    // verbatim shape). No ambient drift term — b1's ActParams surface has
    // none; the dish only pans on pointer input.
    const cover = this.cover;
    if (this.held) {
      if (dt > 1e-5) {
        const kv = Math.min(1, dt * VEL_EMA_RATE);
        const instVelX = Math.min(VEL_MAX, Math.max(-VEL_MAX, this.dragDx / dt));
        const instVelY = Math.min(VEL_MAX, Math.max(-VEL_MAX, this.dragDy / dt));
        this.velX += (instVelX - this.velX) * kv;
        this.velY += (instVelY - this.velY) * kv;
      }
      this.dragDx = 0;
      this.dragDy = 0;
    } else if (this.velX !== 0 || this.velY !== 0) {
      this.pan.x += (this.velX * cover.x / zoom) * dt;
      this.pan.y += (this.velY * cover.y / zoom) * dt;
      const friction = Math.exp(-MOMENTUM_FRICTION * dt);
      this.velX *= friction;
      this.velY *= friction;
      if (Math.abs(this.velX) < MOMENTUM_STOP_SPEED) this.velX = 0;
      if (Math.abs(this.velY) < MOMENTUM_STOP_SPEED) this.velY = 0;
    }

    // Pan clamp: soft radius around the dish centre — hitting it zeroes momentum.
    const panDist = Math.hypot(this.pan.x, this.pan.y);
    if (panDist > MAX_PAN) {
      this.pan.x *= MAX_PAN / panDist;
      this.pan.y *= MAX_PAN / panDist;
      this.velX = 0;
      this.velY = 0;
    }

    this.spores.update(dt, audio, section, zoom, cover, this.pan, this.flash);
  }

  pointer(e: VizPointerEvent) {
    const zoom = this.dishMaterial.uniforms.uZoom.value as number;
    const cover = this.cover;

    if (e.type === 'down') {
      this.held = true;
      this.dragDx = 0;
      this.dragDy = 0;
      this.velX = 0; // grabbing kills any in-flight momentum glide
      this.velY = 0;

      // Screen uv -> dish uv, via the dish shader's own formula
      // ((vUv-0.5)*uCover/uZoom+0.5+uPan) — never a parallel inverse.
      const dx = (e.x - 0.5) * cover.x / zoom + 0.5 + this.pan.x;
      const dy = (e.y - 0.5) * cover.y / zoom + 0.5 + this.pan.y;
      this.activateFood(dx, dy);
      return;
    }

    if (e.type === 'move') {
      if (!this.held) return;
      // 1:1 finger tracking, derived directly from the dish-space formula.
      this.pan.x += (e.dx * cover.x) / zoom;
      this.pan.y += (e.dy * cover.y) / zoom;
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
    this.sim.step(this.lastDt, this.stepsPerFrame);
    this.dishMaterial.uniforms.uTrail.value = this.sim.trailTexture;
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.scene, this.camera);
  }

  resize(w: number, h: number) {
    if (!this.dishMaterial || w <= 0 || h <= 0) return;
    // Clamp guards against a transient degenerate aspect mid-layout (sheet
    // drag, mobile URL-bar show/hide) collapsing the dish to sub-pixel size.
    const aspect = Math.min(3.5, Math.max(0.28, w / h));
    // The dish stays circular regardless of viewport aspect.
    if (aspect >= 1) this.cover.set(aspect, 1);
    else this.cover.set(1, 1 / aspect);
    (this.dishMaterial.uniforms.uCover.value as THREE.Vector2).copy(this.cover);
  }

  dispose() {
    this.sim.dispose();
    this.dishMaterial.dispose();
    this.dishQuad.geometry.dispose();
    this.spores.dispose();
    this.renderer.setRenderTarget(null);
  }
}

const mod: VizModule = { default: () => new Biosphere() };
export default mod.default;
