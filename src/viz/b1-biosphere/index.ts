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
import { paramsAt, arcAt, ACTS, CUES, type ActParams } from './sections';
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

/**
 * Daughter-cell bubble colony (full-biosphere act only, 178-234s): each
 * active bubble is an independent circular WINDOW into the SAME trail
 * texture (own offset/rotation/scale, see dishShader.ts's bubble loop), not
 * a second sim — "one bubble after another... fighting for the space",
 * per the artist's note. BUBBLE_SLOTS: 14 Full / 10 Lite.
 */
const BUBBLE_SLOTS_FULL = 14;
const BUBBLE_SLOTS_LITE = 10;
/** Radius at spawn (dish-uv units) — eases toward its (bubbles-scaled) target over BUBBLE_GROW_TAU seconds. */
const BUBBLE_START_R = 0.03;
/** Hash-varied per-spawn target radius range (dish-uv units) — the upper bound (0.16) is also dishShader.ts's growthFrac literal; keep the two in sync. */
const BUBBLE_TARGET_R_MIN = 0.09;
const BUBBLE_TARGET_R_MAX = 0.16;
/** Growth (and exhale shrink) time constant, seconds — an asymptotic ease, not a linear ramp. */
const BUBBLE_GROW_TAU = 2.5;
/** A daughter above this radius counts as "large" — eligible as a rim-spawn parent ("colonies budding off colonies"). */
const BUBBLE_LARGE_R = 0.07;
/** Poisson baseline spawn interval (seconds): accelerates from START to END across BUBBLE_SPAWN_PHASE_WINDOW of the act, then holds. */
const BUBBLE_SPAWN_INTERVAL_START = 2.5;
const BUBBLE_SPAWN_INTERVAL_END = 0.7;
const BUBBLE_SPAWN_PHASE_WINDOW = 0.6;
/** Spawn-point flash-ring strength (dimmer than a scripted mass burst's 1.0 — "small", per the plan). */
const BUBBLE_SPAWN_FLASH_STRENGTH = 0.55;
/** Pairwise/mother repulsion: cushion added to the sum-of-radii overlap test (dish-uv units), and the two acceleration gains (dish-uv/s^2 per unit overlap) — the mother pushes a touch harder so daughters read as crowding/shoving against its edge specifically, not just each other. */
const BUBBLE_REPEL_PAD = 0.015;
const BUBBLE_REPEL_ACCEL = 7;
const BUBBLE_MOTHER_REPEL_ACCEL = 10;
/** Velocity damping rate (1/s), applied every frame after integrating repulsion+orbit+wander. Lowered from an earlier 4 (round-1 taste note: "everything seems quite static") so motion sustains instead of snapping dead each frame. */
const BUBBLE_DAMPING_RATE = 2.2;
/** Tangential (orbit) acceleration magnitude around the CURRENT mother centre (dish-uv/s^2) — direction (CW/CCW) is hash-fixed per bubble from its stored seed, so the colony visibly circulates and daughters overtake/shove past one another. */
const BUBBLE_ORBIT_ACCEL = 0.10;
/** Per-bubble sinusoidal wander acceleration magnitude (dish-uv/s^2) — organic jitter on top of the orbit so paths never look mechanical; frequencies/phases are hash-derived from the bubble's seed each frame (no stored state). */
const BUBBLE_WANDER_ACCEL = 0.08;
/** Hard speed cap (dish-uv/s) applied to a daughter's velocity after integration — keeps the added orbit/wander/lowered-damping combo from runaway speeds. */
const BUBBLE_MAX_SPEED = 0.14;
/** Soft outer clamp (dish-uv units from dish centre) — the colony never escapes the zoomed-out climax view. */
const BUBBLE_MAX_DIST = 1.1;
/** The one act the colony exists in, looked up by name (not a hardcoded index) so this window can never silently drift out of sync with sections.ts. */
const BUBBLE_ACT_INDEX = ACTS.findIndex((a) => a.name === 'full-biosphere');
const BUBBLE_ACT_START = CUES[BUBBLE_ACT_INDEX];
const BUBBLE_ACT_END = CUES[BUBBLE_ACT_INDEX + 1];

/**
 * The mother becomes a physics body (round-2 taste note): a spring-anchored
 * disc at (0.5, 0.5) that daughters jostle via the reaction half of the
 * existing mother-repulsion term, plus a crowd-dependent radius that eases
 * smaller while the colony is dense and back to full DISH_R once it drains
 * in the exhale (paired with the existing zoom return to 1.0 — "take the
 * full scene back").
 */
/** Spring rate pulling the mother back toward its (0.5, 0.5) anchor (dish-uv/s^2 per unit displacement). */
const MOTHER_SPRING_RATE = 3.0;
/** Hard displacement cap (dish-uv units) — "moving slightly", never drifting away. Velocity zeroes on hitting it. Kept firmly small because the roaming colony is often lopsided enough that the MOTHER_COM_PUSH anchor saturates this cap, so this value (not the push) is the real amplitude governor for the sway. */
const MOTHER_MAX_OFFSET = 0.03;
/** How hard the mother is pushed away from the colony's mass centroid (fraction of the centroid's own offset from centre) — the non-cancelling driver of the "slight rock" (see updateMother). The MOTHER_MAX_OFFSET cap still bounds the result. */
const MOTHER_COM_PUSH = 0.12;
/** Max fractional radius shrink at crowd=1 ("shrink slightly"). */
const MOTHER_SHRINK_MAX = 0.10;
/** Radius easing time constant (seconds) toward the crowd-dependent target. */
const MOTHER_RADIUS_TAU = 3.0;

/**
 * Pure hash of a bubble's stored seed (`bubbleValues[i].w`) into [0,1),
 * independent of the shared `rand` stream so a daughter's orbit direction
 * and wander phase/frequency are fixed for its lifetime and reproducible
 * every frame from pure math alone — no extra fields, no allocation.
 */
function bubbleSeedHash(x: number): number {
  const s = Math.sin(x * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}

interface AgeSlot {
  age: number;
  active: boolean;
}

/**
 * One daughter bubble's CPU-side physics state. Its position/radius/seed
 * live directly in the pooled `bubbleValues[i]` Vector4 (shared BY
 * REFERENCE with the dishShader uBubble uniform, the same idiom as
 * foodValues/burstVisValues) — this slot only holds what doesn't fit a
 * Vector4: this spawn's own hash-varied growth target (EFFECTIVE target is
 * this scaled by the act's `bubbles` param — see ActParams.bubbles' doc),
 * velocity (for the pairwise-repulsion "pushing each other aside" physics),
 * and age (guards against freeing a slot on the very frame it spawns).
 */
interface BubbleSlot {
  active: boolean;
  growTargetR: number;
  vx: number;
  vy: number;
  age: number;
}

/**
 * "Icky, Sticky, & Thriving" — the petri-dish biosphere. Composes
 * PhysarumSim (physarum.ts, the GPU slime-mold network) + the dish
 * composite quad (dishShader.ts) + drifting spore motes (spores.ts) + a CPU
 * daughter-cell bubble colony (full-biosphere act only — see the
 * BUBBLE_* constants and BubbleSlot above), all in one self-owned
 * orthographic scene/camera (VizHost's ctx.scene/ctx.camera are unused —
 * same pattern as a1-primordial/a2-hive's fullscreen-shader modules;
 * `render()` is implemented so VizHost's default
 * renderer.render(this.scene, this.camera) is bypassed).
 *
 * Debug: `?solo=veins|spores|fruit` isolates a layer, `?burst=always`
 * forces a steady ambient burst stream, `?food=always` forces a steady
 * nutrient-drop stream (verification affordances for their respective
 * pools), plus the standard `?t=`, `?q=`, `?debug=1`. The bubble colony has
 * no force-always switch — it's gated by ActParams.bubbles (not audio
 * onsets), so a `?t=` deep link into full-biosphere plus a few repeated
 * screenshots (each advances a beat of real time — see BRIEFING.md's pane-
 * physics note) is enough to watch it accumulate.
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

  private bubbleSlotCount = BUBBLE_SLOTS_FULL;
  private bubbleSlots: BubbleSlot[] = [];
  private bubbleValues!: THREE.Vector4[];
  private bubbleTimeToNext = 0;

  /** Mother physics body (CPU state — see the MOTHER_* constants' doc): position, velocity, and current (crowd-eased) radius. Anchor is (0.5, 0.5), rest radius is DISH_R. `motherUniformVec` is the owned THREE.Vector4 bound BY REFERENCE to the dish shader's uMother uniform (same "own the object, mutate in place" idiom as uPan/bubbleValues) — updated via .set() each frame, zero per-frame allocation. */
  private motherX = 0.5;
  private motherY = 0.5;
  private motherVX = 0;
  private motherVY = 0;
  private motherR = DISH_R;
  private motherUniformVec = new THREE.Vector4(0.5, 0.5, DISH_R, 0);

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

    this.bubbleSlotCount = this.full ? BUBBLE_SLOTS_FULL : BUBBLE_SLOTS_LITE;
    for (let i = 0; i < this.bubbleSlotCount; i++) this.bubbleSlots.push({ active: false, growTargetR: 0, vx: 0, vy: 0, age: 0 });
    this.bubbleValues = [];
    for (let i = 0; i < this.bubbleSlotCount; i++) this.bubbleValues.push(new THREE.Vector4(0, 0, 0, 0));

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
      fragmentShader: buildDishFragmentShader(this.full, this.foodSlotCount, this.burstVisSlotCount, this.bubbleSlotCount),
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
        uBubble: { value: this.bubbleValues },
        uMother: { value: this.motherUniformVec },
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

  /**
   * Spawns one daughter bubble, if a slot is free. Unlike the burst/food
   * pools this never force-evicts slot 0 when the pool is full — popping a
   * still-growing daughter to reuse its slot would read as a visible glitch,
   * so a spawn attempt against a full pool simply misses.
   *
   * Position: 50/50 either freshly off the MOTHER's own rim, or off the rim
   * of an existing "large" daughter (reservoir-sampled among active bubbles
   * with radius > BUBBLE_LARGE_R, zero allocation) — "colonies budding off
   * colonies", per the plan. Falls back to the mother's rim if no large
   * daughter exists yet.
   */
  private trySpawnBubble() {
    let idx = -1;
    for (let i = 0; i < this.bubbleSlots.length; i++) {
      if (!this.bubbleSlots[i].active) { idx = i; break; }
    }
    if (idx < 0) return;

    let parent = -1;
    if (this.rand() < 0.5) {
      let seen = 0;
      for (let i = 0; i < this.bubbleSlots.length; i++) {
        if (this.bubbleSlots[i].active && this.bubbleValues[i].z > BUBBLE_LARGE_R) {
          seen++;
          if (this.rand() < 1 / seen) parent = i;
        }
      }
    }

    const theta = this.rand() * Math.PI * 2;
    let cx: number;
    let cy: number;
    if (parent >= 0) {
      const pv = this.bubbleValues[parent];
      cx = pv.x + Math.cos(theta) * (pv.z + 0.5 * BUBBLE_START_R);
      cy = pv.y + Math.sin(theta) * (pv.z + 0.5 * BUBBLE_START_R);
    } else {
      // Rim-spawn off the CURRENT mother position/radius (a physics body
      // now, not the fixed (0.5, DISH_R) of round 1) — a `?t=` deep link
      // seeding this loop against an already-displaced/shrunk mother lands
      // daughters on its actual rim, not a phantom fixed one.
      cx = this.motherX + Math.cos(theta) * (this.motherR + 0.5 * BUBBLE_START_R);
      cy = this.motherY + Math.sin(theta) * (this.motherR + 0.5 * BUBBLE_START_R);
    }

    const slot = this.bubbleSlots[idx];
    slot.active = true;
    slot.age = 0;
    slot.growTargetR = BUBBLE_TARGET_R_MIN + this.rand() * (BUBBLE_TARGET_R_MAX - BUBBLE_TARGET_R_MIN);
    slot.vx = 0;
    slot.vy = 0;
    this.bubbleValues[idx].set(cx, cy, BUBBLE_START_R, this.rand());
    this.activateBurstVis(cx, cy, BUBBLE_SPAWN_FLASH_STRENGTH);
  }

  /**
   * Poisson baseline spawn schedule (same exponential-inter-arrival idiom as
   * scheduleBursts/scheduleFood above): the interval accelerates from
   * BUBBLE_SPAWN_INTERVAL_START to _END across the first
   * BUBBLE_SPAWN_PHASE_WINDOW of the full-biosphere act's own window
   * (BUBBLE_ACT_START..END, looked up by name — see its doc), then holds at
   * the fast end for the rest of the act — "one bubble after another...
   * really accelerating", per the artist's note. Gated on `p.bubbles`
   * (crossfades to 0 into the exhale act, so spawning stops there
   * naturally) rather than on song time directly, so a debug override that
   * forced `bubbles` nonzero elsewhere would still spawn correctly.
   */
  private scheduleBubbleSpawns(dt: number, p: ActParams, songTime: number) {
    if (p.bubbles <= 0.001) return;
    const phase = Math.min(1, Math.max(0, (songTime - BUBBLE_ACT_START) / Math.max(1e-3, BUBBLE_ACT_END - BUBBLE_ACT_START)));
    const interval = BUBBLE_SPAWN_INTERVAL_START
      + (BUBBLE_SPAWN_INTERVAL_END - BUBBLE_SPAWN_INTERVAL_START) * Math.min(1, phase / BUBBLE_SPAWN_PHASE_WINDOW);
    const rate = 1 / interval;
    this.bubbleTimeToNext -= dt;
    while (this.bubbleTimeToNext <= 0) {
      this.trySpawnBubble();
      const u = Math.max(1e-6, this.rand());
      this.bubbleTimeToNext += -Math.log(u) / rate;
    }
  }

  /**
   * Per-frame daughter-bubble physics: radius eases toward its
   * bubbles-scaled target (see ActParams.bubbles' doc — this is also how
   * the exhale drain works, with no extra bookkeeping); pairwise circle
   * repulsion pushes overlapping daughters apart (weighted by r^2 so the
   * larger one moves less) plus repulsion from the mother disk (now a
   * physics body — CURRENT motherX/Y/R, not the fixed (0.5, DISH_R) of
   * round 1) so daughters crowd AGAINST the mother's edge and each other and
   * visibly shove; the reaction half of that mother-repel push is applied
   * to the mother's own velocity (see updateMother below), scaled by the
   * daughter/mother mass ratio r^2, so the mother rocks from being bumped.
   * On top of that (round-2 taste note: "these bubbles should be
   * energetically moving around the scene"), each active daughter also gets
   * a tangential orbit acceleration around the current mother centre
   * (direction hash-fixed per bubble from its seed) plus a sinusoidal
   * wander acceleration (hash-varied phase/frequency from the same seed,
   * pure math, no stored state) so orbits never look mechanical. Velocity
   * damps every frame (lower rate than round 1 so motion sustains) and is
   * speed-capped after integration; a soft outer clamp keeps the whole
   * colony inside the zoomed-out climax view. N <= 14, so the pairwise
   * O(N^2) pass is trivial. Zero per-frame allocation: everything below is
   * scalar math into the pooled BubbleSlot/Vector4 arrays.
   */
  private updateBubbles(dt: number, p: ActParams, t: number) {
    const slots = this.bubbleSlots;
    const values = this.bubbleValues;
    const n = slots.length;
    const growEase = 1 - Math.exp(-dt / BUBBLE_GROW_TAU);

    for (let i = 0; i < n; i++) {
      const slot = slots[i];
      if (!slot.active) continue;
      slot.age += dt;
      const v = values[i];
      const target = slot.growTargetR * p.bubbles;
      v.z += (target - v.z) * growEase;
      if (v.z < 0.01 && slot.age > 0.1) {
        slot.active = false;
        v.set(0, 0, 0, 0);
      }
    }

    for (let i = 0; i < n; i++) {
      if (!slots[i].active) continue;
      const vi = values[i];
      for (let j = i + 1; j < n; j++) {
        if (!slots[j].active) continue;
        const vj = values[j];
        const dx = vj.x - vi.x;
        const dy = vj.y - vi.y;
        const dist = Math.max(1e-5, Math.hypot(dx, dy));
        const minDist = vi.z + vj.z + BUBBLE_REPEL_PAD;
        if (dist >= minDist) continue;
        const nx = dx / dist;
        const ny = dy / dist;
        const overlap = minDist - dist;
        // Movement share grows with the OTHER bubble's r^2 — the larger of
        // the pair moves less.
        const wj = (vi.z * vi.z) / (vi.z * vi.z + vj.z * vj.z + 1e-6);
        const wi = 1 - wj;
        const accel = overlap * BUBBLE_REPEL_ACCEL * dt;
        slots[i].vx -= nx * accel * wi;
        slots[i].vy -= ny * accel * wi;
        slots[j].vx += nx * accel * wj;
        slots[j].vy += ny * accel * wj;
      }

      // Repel from the mother — now a physics body at (motherX, motherY)
      // with radius motherR, not an immovable fixed circle. Daughters spawn
      // straddling its rim by construction, so this is in mild effect for
      // nearly every active bubble, gently pushing outward against it.
      const dxm = vi.x - this.motherX;
      const dym = vi.y - this.motherY;
      const distm = Math.max(1e-5, Math.hypot(dxm, dym));
      const minDistm = this.motherR + vi.z + BUBBLE_REPEL_PAD;
      if (distm < minDistm) {
        const nx = dxm / distm;
        const ny = dym / distm;
        const accelMag = (minDistm - distm) * BUBBLE_MOTHER_REPEL_ACCEL * dt;
        slots[i].vx += nx * accelMag;
        slots[i].vy += ny * accelMag;
        // Reaction on the mother: same accel magnitude, opposite direction,
        // scaled by the mass ratio (daughterR^2 / motherR^2) — a big
        // daughter (~0.16 vs 0.48) is ~1/9, "moving slightly"; typical
        // daughters land closer to 1/16-1/50.
        const massRatio = (vi.z * vi.z) / (this.motherR * this.motherR);
        this.motherVX -= nx * accelMag * massRatio;
        this.motherVY -= ny * accelMag * massRatio;
      }

      // Orbit: tangential acceleration around the current mother centre,
      // direction hash-fixed per bubble from its stored seed (values[i].w)
      // so a given daughter always circulates the same way for its life.
      const rx = vi.x - this.motherX;
      const ry = vi.y - this.motherY;
      const rlen = Math.max(1e-5, Math.hypot(rx, ry));
      const dir = bubbleSeedHash(vi.w * 3.7 + 1.1) < 0.5 ? 1 : -1;
      const tx = (-ry / rlen) * dir;
      const ty = (rx / rlen) * dir;
      slots[i].vx += tx * BUBBLE_ORBIT_ACCEL * dt;
      slots[i].vy += ty * BUBBLE_ORBIT_ACCEL * dt;

      // Wander: per-bubble sinusoidal drift, hash-varied phase/frequency
      // derived fresh from the seed every frame — pure math, no allocation,
      // no extra stored fields.
      const w1 = 0.5 + bubbleSeedHash(vi.w * 5.21 + 2.3) * 0.8;
      const w2 = 0.5 + bubbleSeedHash(vi.w * 7.77 + 9.4) * 0.8;
      const phi1 = bubbleSeedHash(vi.w * 3.14 + 6.6) * Math.PI * 2;
      const phi2 = bubbleSeedHash(vi.w * 4.44 + 8.8) * Math.PI * 2;
      const wx = Math.sin(t * w1 + phi1);
      const wy = Math.cos(t * w2 + phi2);
      slots[i].vx += wx * BUBBLE_WANDER_ACCEL * dt;
      slots[i].vy += wy * BUBBLE_WANDER_ACCEL * dt;
    }

    const damp = Math.exp(-BUBBLE_DAMPING_RATE * dt);
    for (let i = 0; i < n; i++) {
      const slot = slots[i];
      if (!slot.active) continue;
      const v = values[i];
      v.x += slot.vx * dt;
      v.y += slot.vy * dt;
      slot.vx *= damp;
      slot.vy *= damp;

      // Speed cap: the orbit+wander+lowered-damping combo can otherwise run
      // away over many frames. N <= 14, plain hypot is plenty cheap.
      const speed = Math.hypot(slot.vx, slot.vy);
      if (speed > BUBBLE_MAX_SPEED) {
        const sc = BUBBLE_MAX_SPEED / speed;
        slot.vx *= sc;
        slot.vy *= sc;
      }

      const ddx = v.x - 0.5;
      const ddy = v.y - 0.5;
      const dCenter = Math.hypot(ddx, ddy);
      if (dCenter > BUBBLE_MAX_DIST) {
        v.x = 0.5 + (ddx / dCenter) * BUBBLE_MAX_DIST;
        v.y = 0.5 + (ddy / dCenter) * BUBBLE_MAX_DIST;
        slot.vx = 0;
        slot.vy = 0;
      }
    }
  }

  /**
   * Per-frame mother physics (round-2 taste note): a spring pulls it back
   * toward its (0.5, 0.5) anchor against the jostle velocity accumulated by
   * updateBubbles' mother-repel reaction above, with its own damping and a
   * hard displacement cap (zeroes velocity on hitting it) — the mother
   * visibly rocks back and forth as daughters bump it, never drifts away.
   * Radius eases toward a crowd-dependent target: denser colony -> smaller
   * mother ("shrink slightly"); crowd -> 0 in the exhale as the colony
   * drains -> motherR eases back to full DISH_R, which combined with the
   * existing zoom return to 1.0 "takes the full scene back" with no extra
   * staging. Writes the result into motherUniformVec (uMother) in place —
   * zero per-frame allocation.
   */
  private updateMother(dt: number) {
    // Colony mass balance: sum daughter mass (r^2) for the crowd-shrink AND
    // the mass-weighted centroid for the sway. Instantaneous collision
    // reactions (updateBubbles' massRatio kicks) mostly cancel across a
    // near-symmetric ring, so on their own the mother barely twitches
    // (~1e-4 uv — verified invisible). The centroid does NOT cancel: as the
    // roaming colony is momentarily lopsided (and as it orbits), its centre
    // of mass sweeps around, and the mother is pushed the OPPOSITE way — a
    // continuous, legible "slight rock... based on the interactions with the
    // other smaller bubbles" (round-2 taste note) rather than a dead value.
    let crowd = 0;
    let comX = 0;
    let comY = 0;
    let totalW = 0;
    const slots = this.bubbleSlots;
    const values = this.bubbleValues;
    for (let i = 0; i < slots.length; i++) {
      if (!slots[i].active) continue;
      const v = values[i];
      const w = v.z * v.z;
      crowd += w;
      comX += v.x * w;
      comY += v.y * w;
      totalW += w;
    }
    // Anchor: nudged away from the colony's centre of mass. With no colony
    // (totalW 0) this is exactly (0.5, 0.5), so acts 1-5 and a drained
    // exhale spring to the true centre — unchanged.
    let anchorX = 0.5;
    let anchorY = 0.5;
    if (totalW > 1e-6) {
      anchorX = 0.5 - MOTHER_COM_PUSH * (comX / totalW - 0.5);
      anchorY = 0.5 - MOTHER_COM_PUSH * (comY / totalW - 0.5);
    }

    // Spring back toward the (COM-biased) anchor.
    const dx = this.motherX - anchorX;
    const dy = this.motherY - anchorY;
    this.motherVX += -MOTHER_SPRING_RATE * dx * dt;
    this.motherVY += -MOTHER_SPRING_RATE * dy * dt;

    this.motherX += this.motherVX * dt;
    this.motherY += this.motherVY * dt;

    const damp = Math.exp(-2.5 * dt);
    this.motherVX *= damp;
    this.motherVY *= damp;

    // Hard displacement cap (measured from the true centre, not the anchor):
    // zero velocity on hitting it so the mother never overshoots into a
    // visible drift.
    const ddx = this.motherX - 0.5;
    const ddy = this.motherY - 0.5;
    const d = Math.hypot(ddx, ddy);
    if (d > MOTHER_MAX_OFFSET) {
      this.motherX = 0.5 + (ddx / d) * MOTHER_MAX_OFFSET;
      this.motherY = 0.5 + (ddy / d) * MOTHER_MAX_OFFSET;
      this.motherVX = 0;
      this.motherVY = 0;
    }

    // Crowd shrink: target radius from the summed daughter mass (r^2),
    // relative to the mother's own rest area.
    crowd /= DISH_R * DISH_R;
    const targetR = DISH_R * (1 - MOTHER_SHRINK_MAX * Math.min(1, crowd));
    const radiusEase = 1 - Math.exp(-dt / MOTHER_RADIUS_TAU);
    this.motherR += (targetR - this.motherR) * radiusEase;

    this.motherUniformVec.set(this.motherX, this.motherY, this.motherR, 0);
  }

  /** Deactivates every daughter bubble and re-zeros its uniform slot, and resets the mother to its rest state (0.5, 0.5, DISH_R, zero velocity) — called on loop-wrap so a new play never inherits the previous play's colony or a jostled/shrunk mother. */
  private resetBubbles() {
    for (let i = 0; i < this.bubbleSlots.length; i++) {
      const slot = this.bubbleSlots[i];
      slot.active = false;
      slot.vx = 0;
      slot.vy = 0;
      slot.age = 0;
      this.bubbleValues[i].set(0, 0, 0, 0);
    }
    this.bubbleTimeToNext = 0;
    this.motherX = 0.5;
    this.motherY = 0.5;
    this.motherVX = 0;
    this.motherVY = 0;
    this.motherR = DISH_R;
    this.motherUniformVec.set(0.5, 0.5, DISH_R, 0);
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
      // Colony seed (the a2 seed-pass rule): a deep link into the climax
      // must land on an already-crowded colony, not an empty mother that
      // only starts budding after load. Replays the REAL spawn/physics code
      // paths from the act start to the current clock at a coarse fixed dt
      // — deterministic per play seed, and any spawn-flash rings it fires
      // are aged out by the same loop.
      if (p.bubbles > 0.001 && audio.time > BUBBLE_ACT_START) {
        const SEED_DT = 0.25;
        for (let st = BUBBLE_ACT_START; st < audio.time; st += SEED_DT) {
          this.scheduleBubbleSpawns(SEED_DT, p, st);
          this.updateBubbles(SEED_DT, p, st);
          this.updateMother(SEED_DT);
          this.updateBurstVisAges(SEED_DT);
        }
      }
    }

    // Loop-wrap: song time jumping backward by more than 10s means the
    // track looped back to 0 — reseed agents + clear the trail so the
    // network resets with the song instead of a new play inheriting the
    // previous play's biosphere.
    if (this.lastSongTime >= 0 && audio.time < this.lastSongTime - 10) {
      this.sim.clearTrail();
      this.warmup(p, WARMUP_STEPS_LOOP, true);
      this.resetBubbles();
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
      // Beat-locked division: every bass onset buds one more daughter, if a
      // slot is free — the plan's "beat-locked division" on top of the
      // Poisson baseline below.
      if (p.bubbles > 0.001) this.trySpawnBubble();
      this.onsetCooldown = ONSET_COOLDOWN;
    }

    this.scheduleBursts(dt, this.forceBurstAlways ? DEBUG_BURST_RATE : p.burstRate);
    this.updateBurstActive(dt);
    this.updateBurstVisAges(dt);

    this.scheduleFood(dt, this.forceFoodAlways ? DEBUG_FOOD_RATE : 0);
    this.updateFoodAges(dt);

    this.scheduleBubbleSpawns(dt, p, audio.time);
    this.updateBubbles(dt, p, audio.time);
    this.updateMother(dt);

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
