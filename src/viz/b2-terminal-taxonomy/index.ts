import * as THREE from 'three';
import type { Viz, VizContext, AudioFrame, VizModule, VizPointerEvent } from '../types';
import {
  CommunityField,
  STAMP_SLOTS_FULL, STAMP_SLOTS_LITE,
  SIM_STEPS_FULL, SIM_STEPS_LITE,
  WARMUP_STEPS_INIT, WARMUP_STEPS_LOOP, WARMUP_TICK_DT,
  POKE_SLOTS,
} from './communityField';
import { CATALOGUE_VERT, buildCatalogueFragment } from './catalogueShader';
import { paramsAt, arcAt, orderAt, ACTS, CUES, type ActParams } from './sections';
import { mulberry32 } from '../random';

/** Bass-onset detector (a1/a2/a3/b1 EMA + margin + cooldown recipe): excess over its own slow EMA fires a classification scan + flash. */
const ONSET_THRESHOLD = 0.12;
const ONSET_COOLDOWN = 0.5;

/** High-band onset detector (glyph ticks — high's fast job). */
const HIGH_ONSET_THRESHOLD = 0.09;
const HIGH_ONSET_COOLDOWN = 0.22;

/** uFlash exponential decay rate (1/s) and per-event kick sizes. */
const FLASH_DECAY = 3.4;
const FLASH_KICK_ONSET = 0.35;
const FLASH_KICK_AMBIENT = 0.18;
const FLASH_KICK_BOUNDARY = 1.2;
const FLASH_CEILING = 1.6;

/** Fast spark channel (uGlyphKick): a bass onset raises vitality/flash, but the SPARKLE of a glyph tick needs its own kick+decay scalar (the a3 lesson: one decaying scalar can't serve both scene hits and per-beat ticks). */
const SPARK_KICK = 0.75;
const SPARK_DECAY = 7;
const SPARK_CEILING = 1.2;
/** `?spark=always` debug affordance interval (seconds). */
const DEBUG_SPARK_INTERVAL = 0.5;

/** Tap ripple-ring pool (near-white display-side rings, a1/a3 idiom): a poke must read even where the sim's classified-resistance alone would be invisible. */
const RIPPLE_SLOTS = 4;
const RIPPLE_LIFETIME = 1.2;

/** Voronoi community search window half-width, per quality tier (2 -> 5x5 exact, 1 -> 3x3 cheaper). */
const VOR_REACH_FULL = 2;
const VOR_REACH_LITE = 1;
/** Living-glyph stroke count per quality tier. */
const GLYPH_STROKES_FULL = 4;
const GLYPH_STROKES_LITE = 2;

/**
 * Classification scan lifecycle (matches the catalogue shader's age phases):
 * ACQUIRE is the bracket-snap-in window, LOCK_END is when the sweep line
 * finishes and the label locks in (also the classified-ratchet bump point),
 * LIFETIME is full fade-out. Radius is in COMMUNITY units (the shader scales
 * a wrapped field-delta by uCommFreq before comparing); the sim's stamp
 * radius is that divided by commFreq to land back in field-uv units.
 */
const SCAN_ACQUIRE = 0.5;
const SCAN_LOCK_END = 1.4;
const SCAN_LIFETIME = 2.2;
const SCAN_RADIUS_COMM = 0.42;
const SCAN_RADIUS_COMM_JITTER = 0.12;
/** classifiedFraction bump when a scan's age crosses SCAN_LOCK_END. */
const SCAN_CLASS_INC = 0.012;
/** `?scan=always` debug affordance interval (seconds). */
const DEBUG_SCAN_INTERVAL = 1.2;

/** Mass-classification ring waves (act 5 / total-classification): one wave state, grows then fades across WAVE_GROW_SECONDS. */
const WAVE_GROW_SECONDS = 1.6;
const WAVE_MAX_RADIUS = 0.8;
const WAVE_STRENGTH = 1.0;

/** Scripted discrete hits (edge-triggered on the boundary crossing, a3/b1 idiom). */
const MASS_SCAN_TIME = 168;   // act-3 cascade: a burst of scans + a wave + a boundary flash.
const DROP_TIME = 232;        // THE drop: grid slam, zoom snap, a wave, a boundary flash.
const POWERDOWN_TIME = 316;   // power-down: a boundary flash.
const FINAL_FLICKER_TIME = 330; // the outro's one last living-language flicker.

/** gridSlam: kicked at the drop, decays exponentially, feeds uGridSlam (the grid's one-time strength spike). */
const GRID_SLAM_KICK = 0.6;
const GRID_SLAM_DECAY = 2.5;

/** flickerEnv decay rate (1/s) — the final-flicker's own short-lived envelope. */
const FLICKER_DECAY = 0.6;

/** Beat pulse (uLifeClock's accelerant): a bass onset kicks it, it decays exponentially, and it triples the lifecycle clock's rate while hot — beats visibly speed up specimen filing in/out. */
const BEAT_PULSE_KICK = 1.0;
const BEAT_PULSE_CEILING = 1.5;
const BEAT_PULSE_DECAY = 4;
/** `?life=fast` debug affordance multiplier on the lifecycle clock's rate. */
const LIFE_FAST_MUL = 6;

/**
 * Camera choreography. Act 0 (thriving-field) opens HERO-CLOSE — zoomed in
 * from OPEN_ZOOM on the one pinned hero specimen (community cc=(0,0),
 * epoch-0 anchor, the shader's HERO OVERRIDE — see catalogueShader.ts's
 * specLife) — and eases out across OPEN_SECONDS (real seconds, not
 * act-fraction — the act itself runs longer than the pull-back) to reveal
 * the whole living field; the a3 seed-act settle-in pattern, but pulling
 * back from a specific living thing instead of a bare zoom number. Act 2
 * (accelerating-catalogue) HOLDS its own zoom through the pre-boundary
 * crossfade so the deep zoom onto the last unclassified community starts
 * exactly at the boundary, not early. Act 3 (last-unclassified) runs its own
 * DEEP_ZOOM_SECONDS envelope in from act 2's zoom, then holds for the rest of
 * the act (including ITS pre-boundary crossfade — the snap must not leak in
 * early either). Act 4 (total-classification) opens with a SNAP_SECONDS
 * zoom-snap from act 3's deep zoom back out to its own — the drop's visual
 * shock — then falls through to the normal crossfaded value. All other acts
 * just use the crossfaded p.zoom. A gentle global breath (art-direction's
 * "fast evolution" rule) keeps even the stillest acts moving, damped hard
 * during the survivor-focus act so the spotlighted holdout reads as calm.
 */
const OPEN_ZOOM = 9.5;
const OPEN_SECONDS = 40;
const DEEP_ZOOM_SECONDS = 8;
const SNAP_SECONDS = 0.45;
const BREATH_AMP = 0.015;
const BREATH_RATE = 0.22;

/**
 * Tiny JS mirror of COMM_CELL_GLSL's ttHash22, evaluated ONCE at module
 * load for a SINGLE constant — the hero specimen's (cc=(0,0), epoch=0)
 * organic anchor — to seed the opening pan. This is deliberately NOT the
 * per-fragment CPU/GPU hash mirroring BRIEFING.md warns against ("CPU/GPU
 * hash divergence is total, not approximate... never gate a hard visual on
 * one"): that rule targets replicating a shader hash every pixel/frame and
 * expecting exact agreement. Here the JS and GLSL hashes are evaluated
 * once each, agree to float32 precision (same formula, same inputs), and
 * a ~1e-6 divergence only nudges where the opening pan starts — an
 * already-soft camera ease that fades to zero by kOpen=1, never a hard
 * visual gate.
 */
function heroHash22(x: number, y: number): [number, number] {
  const px = x * 127.1 + y * 311.7;
  const py = x * 269.5 + y * 183.3;
  const sx = Math.sin(px) * 43758.5453;
  const sy = Math.sin(py) * 43758.5453;
  return [sx - Math.floor(sx), sy - Math.floor(sy)];
}
const [HERO_HASH_X, HERO_HASH_Y] = heroHash22(0, 0);
/** Hero specimen's epoch-0 organic anchor (community-cell-local, [0.22, 0.78]) — mirrors specAnchor's organic base for cc=(0,0), epoch=0. */
const HERO_ORGANIC = { x: 0.22 + 0.56 * HERO_HASH_X, y: 0.22 + 0.56 * HERO_HASH_Y };
/** Community frequency all acts share (sections.ts ActParams.commFreq is 6 everywhere) — used once here to convert the hero anchor into a pan offset. */
const HERO_COMM_FREQ = 6;
/**
 * Pan that centres the hero specimen at act-0's opening zoom. Community
 * point of cell (0,0)'s anchor is `organic` (cc=0); field-uv of a
 * community-space point q is `q / uCommFreq + 0.5` (inverse of the display
 * shader's `p = (field - 0.5) * uCommFreq`); the screen centre lands at
 * field `0.5 + pan`, so `pan = heroField - 0.5 = organic / uCommFreq`.
 */
const HERO_PAN = { x: HERO_ORGANIC.x / HERO_COMM_FREQ, y: HERO_ORGANIC.y / HERO_COMM_FREQ };

/** Drag-release momentum (a1/a2/a3/b1 idiom, verbatim shape). */
const MOMENTUM_FRICTION = 2.5;
const MOMENTUM_STOP_SPEED = 0.0005;
const VEL_EMA_RATE = 10;
const VEL_MAX = 1.5;
/** Soft pan radius (field-uv) — hitting it zeroes momentum. */
const MAX_PAN = 0.6;

/** Pointer pokes (the resistance mechanic — the only thing that can lower the classified ratchet). */
const POKE_LIFETIME = 0.35;
const POKE_RADIUS = 0.05;
const POKE_STRENGTH = 1.0;

interface AgeSlot {
  age: number;
  active: boolean;
}

interface ScanSlot {
  age: number;
  active: boolean;
  mislabel: boolean;
}

/**
 * "Terminal Taxonomy" — the living-community catalogue field. Composes
 * CommunityField (communityField.ts, the GPU classification-ratchet sim) +
 * a fullscreen Voronoi-community display quad (catalogueShader.ts) in one
 * self-owned orthographic scene/camera (VizHost's ctx.scene/ctx.camera are
 * unused — same fullscreen-shader pattern as a1/a2/a3/b1; `render()` is
 * implemented so VizHost's default render is bypassed).
 *
 * Debug: `?solo=field|patch|glyphs|machine` isolates one of the shader's
 * four solo layers, `?scan=always` forces a steady classification-scan
 * stream, `?mis=always` forces every scan to visibly misclassify,
 * `?wave=always` forces a mass-classification ring wave every 3s,
 * `?spark=always` forces the high-onset glyph-tick spark events,
 * `?flicker=always` pins the outro's final-flicker envelope on,
 * `?classified=<0..1>` pins the classified ratchet, `?life=fast` speeds up
 * the specimen appear/disappear lifecycle clock, `?order=<0..1>` pins the
 * scatter->drawer-rows envelope, plus the standard `?t=`, `?q=`, `?debug=1`.
 */
class TerminalTaxonomy implements Viz {
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.OrthographicCamera;
  private field!: CommunityField;
  private quad!: THREE.Mesh;
  private material!: THREE.ShaderMaterial;

  private rand!: () => number;
  private forceScanAlways = false;
  private forceMisAlways = false;
  private forceWaveAlways = false;
  private forceFlickerAlways = false;
  private forceSparkAlways = false;
  private forceLifeFast = false;
  private pinnedClassified: number | null = null;
  private pinnedOrder: number | null = null;

  private full = true;
  private stampSlotCount = STAMP_SLOTS_FULL;
  private stepsPerFrame = SIM_STEPS_FULL;

  /** Cover-fit scale (keeps the community lattice square regardless of viewport aspect). */
  private cover = new THREE.Vector2(1, 1);
  /** Field-space pan offset — pointer-drag only, EXCEPT act 0's hero pull-back, which owns it until the user's first drag. */
  private pan = new THREE.Vector2(0, 0);
  /** Set true on the user's first drag move — once set, the hero opening pan never touches `pan` again. */
  private userPanned = false;

  private bassE = 0;
  private midE = 0;
  private highE = 0;
  private bassSlowE = 0;
  private highSlowE = 0;
  private onsetCooldown = 0;
  private highOnsetCooldown = 0;
  private flash = 0;
  /** Beat pulse (bass onsets -> uLifeClock accelerant): kick+decay scalar, tripled weight while hot. */
  private beatPulse = 0;
  /** CPU-accumulated specimen lifecycle clock (epochs) — feeds uLifeClock; advances by lifeRate * beat-multiplier each frame. */
  private lifeClock = 0;
  /** Fast spark channel (high onsets -> glyph ticks): kick+decay scalar + per-event re-roll counter. */
  private spark = 0;
  private sparkSeed = 0;
  private sparkDebugTimer = 0;

  /** Classification-scan reticle pool: parallel CPU age/state + preallocated display Vector4s (index-aligned with field.stamps, the sim-side effect). */
  private scanSlots: ScanSlot[] = [];
  private scanA: THREE.Vector4[] = [];
  private scanB: THREE.Vector4[] = [];
  private scanTimeToNext = 0;
  private scanDebugTimer = 0;

  /** Scripted mass-scan burst (t=168): a queued release, one scan per 0.18s. */
  private pendingBurst = 0;
  private burstTimer = 0;

  /** Mass-classification ring wave — one slot, CPU age drives field.wave (shared by reference). */
  private waveActive = false;
  private waveAge = 0;
  private waveCx = 0.5;
  private waveCy = 0.5;
  private waveTimeToNext = 0;
  private waveDebugTimer = 0;

  private rippleSlots: AgeSlot[] = [];
  private rippleValues: THREE.Vector4[] = [];

  private pokeSlots: AgeSlot[] = [];

  /** CPU classified-ratchet scalar (mirrors the sim's own .g channel at a coarse, whole-scene grain for uClassified/uDesat). Monotonic except when pinned. */
  private classified = 0;
  private gridSlam = 0;
  private flickerEnv = 0;

  /** Per-play phase for the global zoom breath. */
  private breathPhase = 0;

  private firstUpdate = true;
  private lastDt = 0;
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
    this.rand = mulberry32(seed ^ 0xb2c47a19);

    const params = new URLSearchParams(location.search);
    const solo = params.get('solo');
    const soloMode = solo === 'field' ? 1 : solo === 'patch' ? 2 : solo === 'glyphs' ? 3 : solo === 'machine' ? 4 : 0;
    this.forceScanAlways = params.get('scan') === 'always';
    this.forceMisAlways = params.get('mis') === 'always';
    this.forceWaveAlways = params.get('wave') === 'always';
    this.forceFlickerAlways = params.get('flicker') === 'always';
    this.forceSparkAlways = params.get('spark') === 'always';
    this.forceLifeFast = params.get('life') === 'fast';
    const classifiedParam = params.get('classified');
    if (classifiedParam !== null) {
      const v = parseFloat(classifiedParam);
      if (!Number.isNaN(v)) this.pinnedClassified = Math.min(1, Math.max(0, v));
    }
    const orderParam = params.get('order');
    if (orderParam !== null) {
      const v = parseFloat(orderParam);
      if (!Number.isNaN(v)) this.pinnedOrder = Math.min(1, Math.max(0, v));
    }

    this.full = quality.level === 'full';
    this.stampSlotCount = this.full ? STAMP_SLOTS_FULL : STAMP_SLOTS_LITE;
    const reach = this.full ? VOR_REACH_FULL : VOR_REACH_LITE;
    const glyphStrokes = this.full ? GLYPH_STROKES_FULL : GLYPH_STROKES_LITE;
    this.stepsPerFrame = this.full ? SIM_STEPS_FULL : SIM_STEPS_LITE;

    for (let i = 0; i < this.stampSlotCount; i++) {
      this.scanSlots.push({ age: 0, active: false, mislabel: false });
      this.scanA.push(new THREE.Vector4(0, 0, 0, 0));
      this.scanB.push(new THREE.Vector4(0, 0, 0, 0));
    }
    for (let i = 0; i < RIPPLE_SLOTS; i++) {
      this.rippleSlots.push({ age: 0, active: false });
      this.rippleValues.push(new THREE.Vector4(0, 0, 0, 0));
    }
    for (let i = 0; i < POKE_SLOTS; i++) {
      this.pokeSlots.push({ age: 0, active: false });
    }

    this.breathPhase = this.rand() * Math.PI * 2;

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this.field = new CommunityField(renderer, this.full, this.stampSlotCount);

    this.material = new THREE.ShaderMaterial({
      vertexShader: CATALOGUE_VERT,
      fragmentShader: buildCatalogueFragment(RIPPLE_SLOTS, this.stampSlotCount, reach, glyphStrokes),
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uField: { value: null },
        uTime: { value: 0 },
        uCover: { value: new THREE.Vector2(1, 1) },
        uZoom: { value: 1 },
        uPan: { value: this.pan },
        uCommFreq: { value: 6 },
        uEnergy: { value: 0 },
        uFlash: { value: 0 },
        uSparkle: { value: 0 },
        uGlyphKick: { value: 0 },
        uGlyphSeed: { value: 0 },
        uChurn: { value: 0 },
        uChatter: { value: 0 },
        uGlyphDensity: { value: 0 },
        uMachineFrac: { value: 0 },
        uMachineOrder: { value: 0 },
        uClassified: { value: 0 },
        uGridStrength: { value: 0 },
        uGridFine: { value: 0 },
        uGridSlam: { value: 0 },
        uHueSat: { value: 0 },
        uWarmth: { value: 0 },
        uRustMix: { value: 0 },
        uInkPersist: { value: 0 },
        uVignette: { value: 0 },
        uMotes: { value: 0 },
        uGroundLight: { value: 0 },
        uSurvivorFocus: { value: 0 },
        uDesat: { value: 0 },
        uSoloMode: { value: soloMode },
        uFlicker: { value: 0 },
        uLifeClock: { value: 0 },
        uPresence: { value: 0 },
        uWriggle: { value: 0 },
        uDrift: { value: 0 },
        uWaveVis: { value: this.field.wave },
        uScanA: { value: this.scanA },
        uScanB: { value: this.scanB },
        uRipple: { value: this.rippleValues },
      },
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.scene.add(this.quad);

    const canvas = renderer.domElement;
    this.resize(canvas.clientWidth || 1, canvas.clientHeight || 1);
  }

  private sst(x: number): number {
    const c = Math.min(1, Math.max(0, x));
    return c * c * (3 - 2 * c);
  }

  private kickFlash(amount: number) {
    this.flash = Math.min(FLASH_CEILING, this.flash + amount);
  }

  private kickSpark() {
    this.spark = Math.min(SPARK_CEILING, this.spark + SPARK_KICK);
    this.sparkSeed++;
  }

  /** Activates one classification-scan slot at field-uv (x,y) (already wrapped), picking a free slot or else the oldest. */
  private startScan(x: number, y: number, p: ActParams) {
    let idx = this.scanSlots.findIndex((s) => !s.active);
    if (idx < 0) {
      idx = 0;
      let maxAge = this.scanSlots[0].age;
      for (let i = 1; i < this.scanSlots.length; i++) {
        if (this.scanSlots[i].age > maxAge) {
          maxAge = this.scanSlots[i].age;
          idx = i;
        }
      }
    }
    const slot = this.scanSlots[idx];
    slot.active = true;
    slot.age = 0;
    const mis = this.forceMisAlways || this.rand() < p.misProb;
    slot.mislabel = mis;
    this.scanA[idx].set(x, y, 0, 1);
    this.scanB[idx].set(SCAN_RADIUS_COMM + this.rand() * SCAN_RADIUS_COMM_JITTER, mis ? 1 : 0, this.rand(), 0);
  }

  /**
   * Picks a screen-visible scan target and fires it. Scans must be SEEN: the
   * offset is generated in pre-pan/zoom screen space and only then mapped
   * into field-uv via the house screen->field formula. In the survivor-focus
   * act, resample (up to 4 tries) until the raw offset clears the spotlight
   * radius so scans never land inside it.
   */
  private fireScan(p: ActParams) {
    const cover = this.cover;
    const zoom = this.material.uniforms.uZoom.value as number;
    let ox = 0;
    let oy = 0;
    const resample = p.survivorFocus > 0.5;
    for (let i = 0; i < 4; i++) {
      ox = (this.rand() - 0.5) * 0.85;
      oy = (this.rand() - 0.5) * 0.85;
      if (!resample || Math.hypot(ox, oy) > 0.3) break;
    }
    let x = 0.5 + this.pan.x + (ox * cover.x) / zoom;
    let y = 0.5 + this.pan.y + (oy * cover.y) / zoom;
    x -= Math.floor(x);
    y -= Math.floor(y);
    this.startScan(x, y, p);
  }

  /** Poisson ambient scans (a3's scheduleIgnitions shape): each one also nudges the ambient flash channel — a scene that's quietly cataloguing itself even between onsets. */
  private scheduleScans(dt: number, ratePerMinute: number, p: ActParams) {
    const rate = Math.max(0, ratePerMinute) / 60;
    if (rate <= 0) return;
    this.scanTimeToNext -= dt;
    while (this.scanTimeToNext <= 0) {
      this.fireScan(p);
      this.kickFlash(FLASH_KICK_AMBIENT);
      const u = Math.max(1e-6, this.rand());
      this.scanTimeToNext += -Math.log(u) / rate;
    }
  }

  /** Ages every active scan slot: writes the shared display age, bumps the classified ratchet on lock, and drives the sim stamp (drain only active during the acquire->lock window). */
  private ageScans(dt: number, p: ActParams) {
    for (let i = 0; i < this.scanSlots.length; i++) {
      const slot = this.scanSlots[i];
      if (!slot.active) continue;
      const prevAge = slot.age;
      slot.age += dt;
      const age = slot.age;
      this.scanA[i].z = age;
      if (prevAge < SCAN_LOCK_END && age >= SCAN_LOCK_END) {
        this.classified += SCAN_CLASS_INC;
      }
      if (age >= SCAN_LIFETIME) {
        slot.active = false;
        this.scanA[i].w = 0;
        this.field.stamps[i].w = 0;
      } else {
        const radiusComm = this.scanB[i].x;
        const drainActive = age >= SCAN_ACQUIRE && age < SCAN_LOCK_END;
        this.field.stamps[i].set(this.scanA[i].x, this.scanA[i].y, radiusComm / p.commFreq, drainActive ? p.scanDrain : 0);
      }
    }
  }

  /** Scripted mass-scan cascade (t=168): queues a burst of scans (released one per 0.18s), starts a wave, and kicks the boundary flash. */
  private scriptedMassScan() {
    this.pendingBurst = this.stampSlotCount;
    this.burstTimer = 0;
    this.startWave();
    this.kickFlash(FLASH_KICK_BOUNDARY);
  }

  /** THE drop (t=232): boundary flash, grid slam, and a wave. The zoom-snap itself is driven purely by act-4's own localT in the camera choreography below. */
  private scriptedDrop() {
    this.kickFlash(FLASH_KICK_BOUNDARY);
    this.gridSlam = GRID_SLAM_KICK;
    this.startWave();
  }

  /** (Re)starts the single mass-classification ring wave at a fresh random field-uv centre. */
  private startWave() {
    this.waveCx = this.rand();
    this.waveCy = this.rand();
    this.waveActive = true;
    this.waveAge = 0;
  }

  /** Ages the active wave (growing radius, fading strength, writing field.wave), then schedules new ones via a Poisson process at ratePerMinute (act 5 only in practice — other acts pass 0). */
  private scheduleWaves(dt: number, ratePerMinute: number) {
    if (this.waveActive) {
      this.waveAge += dt;
      if (this.waveAge >= WAVE_GROW_SECONDS) {
        this.waveActive = false;
        this.field.wave.w = 0;
      } else {
        const kGrow = this.sst(this.waveAge / WAVE_GROW_SECONDS);
        this.field.wave.set(this.waveCx, this.waveCy, kGrow * WAVE_MAX_RADIUS, WAVE_STRENGTH * (1 - this.waveAge / WAVE_GROW_SECONDS));
      }
    }
    const rate = Math.max(0, ratePerMinute) / 60;
    if (rate <= 0) return;
    this.waveTimeToNext -= dt;
    while (this.waveTimeToNext <= 0) {
      this.startWave();
      const u = Math.max(1e-6, this.rand());
      this.waveTimeToNext += -Math.log(u) / rate;
    }
  }

  /** Activates one pointer-poke slot at field-uv (x,y) (already wrapped) — the resistance mechanic, the only thing that can lower the classified ratchet. */
  private activatePoke(x: number, y: number) {
    let idx = this.pokeSlots.findIndex((s) => !s.active);
    if (idx < 0) idx = 0;
    const slot = this.pokeSlots[idx];
    slot.active = true;
    slot.age = 0;
    this.field.pokes[idx].set(x, y, POKE_RADIUS, POKE_STRENGTH);
  }

  private updatePokeAges(dt: number) {
    for (let i = 0; i < this.pokeSlots.length; i++) {
      const slot = this.pokeSlots[i];
      if (!slot.active) continue;
      slot.age += dt;
      if (slot.age >= POKE_LIFETIME) {
        slot.active = false;
        this.field.pokes[i].w = 0;
      }
    }
  }

  /** Near-white expanding ripple ring at field-uv (x,y) — the display-side half of a tap. Coords wrapped into [0,1); the shader torus-wraps its distance to match. */
  private activateRipple(x: number, y: number) {
    let idx = this.rippleSlots.findIndex((s) => !s.active);
    if (idx < 0) idx = 0;
    const slot = this.rippleSlots[idx];
    slot.active = true;
    slot.age = 0;
    this.rippleValues[idx].set(x - Math.floor(x), y - Math.floor(y), 0, 1);
  }

  private updateRippleAges(dt: number) {
    for (let i = 0; i < this.rippleSlots.length; i++) {
      const slot = this.rippleSlots[i];
      if (!slot.active) continue;
      slot.age += dt;
      if (slot.age >= RIPPLE_LIFETIME) {
        slot.active = false;
        this.rippleValues[i].w = 0;
      } else {
        this.rippleValues[i].z = slot.age;
      }
    }
  }

  /** Runs the staged warmup: clear + analytically seed the field at the classified floor (using the CALLER-computed order envelope — `orderAt`/`?order=` live outside ActParams, see the machine-order wiring in `update()`), then replay the real scan-scheduling + aging + step path at fixed WARMUP_TICK_DT so `?t=` deep links land on a formed, mid-catalogue field regardless of frame rate. */
  private warmup(p: ActParams, steps: number, order: number) {
    this.field.clearField();
    this.field.setActParams(p);
    const floor = this.pinnedClassified ?? p.classifiedFloor;
    this.field.seedField(floor, p.commFreq, order);
    this.classified = floor;
    for (let i = 0; i < steps; i++) {
      this.scheduleScans(WARMUP_TICK_DT, p.scanRate, p);
      this.ageScans(WARMUP_TICK_DT, p);
      this.field.step(WARMUP_TICK_DT, 1);
    }
  }

  update(dt: number, audio: AudioFrame) {
    const section = paramsAt(audio.time);
    // Acts 4 and 5 (indices 3/4) HOLD their pure act values through their
    // outgoing pre-boundary crossfades — the same idiom as the zoom hold,
    // extended to every param. Otherwise the generic 6s lerp leaks act 5's
    // grid/rust/drain maximum INTO the quiet last-unclassified act (and act
    // 6's bleach into the climax), and the 232 drop / 316 power-down arrive
    // as fades instead of the scripted discrete hits (ARC.md failure mode
    // 7). All other boundaries keep the house crossfade — the machine
    // *creeping in* gradually is the story; the drop and the power-down are
    // not.
    const p = section.actIndex === 3 || section.actIndex === 4 ? ACTS[section.actIndex] : section.params;
    this.lastDt = dt;

    // Scatter->drawer-rows envelope: continuous (not act-held, its motion IS
    // the content — see orderAt's doc), computed once here from audio.time
    // so warmup() (which runs before any other per-frame state matters) and
    // the display uniform below use the SAME value.
    const order = this.pinnedOrder ?? orderAt(audio.time).order;

    if (this.firstUpdate) {
      this.firstUpdate = false;
      this.warmup(p, WARMUP_STEPS_INIT, order);
    }

    // Loop-wrap: song time jumping backward by >10s means the track looped —
    // clear + re-warm so a new play doesn't inherit the previous field.
    if (this.lastSongTime >= 0 && audio.time < this.lastSongTime - 10) {
      this.warmup(p, WARMUP_STEPS_LOOP, order);
    }

    // Scripted discrete hits (edge-triggered; the < 0.5 guard rejects the ?t=
    // seed jump and the loop wrap as false triggers).
    if (this.lastSongTime >= 0 && audio.time - this.lastSongTime >= 0 && audio.time - this.lastSongTime < 0.5) {
      if (this.lastSongTime < MASS_SCAN_TIME && audio.time >= MASS_SCAN_TIME) this.scriptedMassScan();
      if (this.lastSongTime < DROP_TIME && audio.time >= DROP_TIME) this.scriptedDrop();
      if (this.lastSongTime < POWERDOWN_TIME && audio.time >= POWERDOWN_TIME) this.kickFlash(FLASH_KICK_BOUNDARY);
      if (this.lastSongTime < FINAL_FLICKER_TIME && audio.time >= FINAL_FLICKER_TIME) this.flickerEnv = 1;
    }
    this.lastSongTime = audio.time;

    // Smooth audio bands (a1/a2/a3/b1 idiom) so reactivity isn't jittery.
    const k = Math.min(1, dt * 8);
    this.bassE += (audio.bass - this.bassE) * k;
    this.midE += (audio.mid - this.midE) * k;
    this.highE += (audio.high - this.highE) * k;
    const kSlow = Math.min(1, dt * 1.5);
    this.bassSlowE += (audio.bass - this.bassSlowE) * kSlow;
    this.highSlowE += (audio.high - this.highSlowE) * kSlow;

    // Bass-onset detector: excess over its own slow EMA fires a scan + flash;
    // in act 4 (total-classification) it also starts a wave if none is running.
    this.onsetCooldown -= dt;
    if (this.onsetCooldown <= 0 && this.bassE - this.bassSlowE > ONSET_THRESHOLD) {
      if (p.scanRate > 0.5) this.fireScan(p);
      this.kickFlash(FLASH_KICK_ONSET);
      if (section.actIndex === 4 && !this.waveActive) this.startWave();
      this.beatPulse = Math.min(BEAT_PULSE_CEILING, this.beatPulse + BEAT_PULSE_KICK);
      this.onsetCooldown = ONSET_COOLDOWN;
    }

    // High-onset detector — the fast spark channel (glyph ticks).
    this.highOnsetCooldown -= dt;
    if (this.highOnsetCooldown <= 0 && this.highE - this.highSlowE > HIGH_ONSET_THRESHOLD) {
      this.kickSpark();
      this.highOnsetCooldown = HIGH_ONSET_COOLDOWN;
    }
    if (this.forceSparkAlways) {
      this.sparkDebugTimer -= dt;
      if (this.sparkDebugTimer <= 0) {
        this.kickSpark();
        this.sparkDebugTimer = DEBUG_SPARK_INTERVAL;
      }
    }
    this.spark *= Math.exp(-SPARK_DECAY * dt);

    // ?scan=always debug affordance.
    if (this.forceScanAlways) {
      this.scanDebugTimer -= dt;
      if (this.scanDebugTimer <= 0) {
        this.fireScan(p);
        this.scanDebugTimer = DEBUG_SCAN_INTERVAL;
      }
    }

    // Poisson ambient scans (a3's scheduleIgnitions shape).
    this.scheduleScans(dt, p.scanRate, p);

    // Mass-classification ring waves: age the active one, Poisson-schedule
    // new ones at p.waveRate/min (act 5), plus the ?wave=always affordance.
    this.scheduleWaves(dt, p.waveRate);
    if (this.forceWaveAlways) {
      this.waveDebugTimer -= dt;
      if (this.waveDebugTimer <= 0) {
        this.startWave();
        this.waveDebugTimer = 3;
      }
    }

    // Release the scripted mass-scan burst, one scan per 0.18s.
    if (this.pendingBurst > 0) {
      this.burstTimer -= dt;
      while (this.burstTimer <= 0 && this.pendingBurst > 0) {
        this.fireScan(p);
        this.pendingBurst--;
        this.burstTimer += 0.18;
      }
    }

    // classifiedFraction ratchet: floor first (or pin), then let scan locks
    // (in ageScans below) push it forward, then clamp/re-pin.
    if (this.pinnedClassified !== null) {
      this.classified = this.pinnedClassified;
    } else {
      this.classified = Math.max(this.classified, p.classifiedFloor);
    }

    this.ageScans(dt, p);
    this.updatePokeAges(dt);
    this.updateRippleAges(dt);

    this.classified = Math.min(1, this.classified);
    if (this.pinnedClassified !== null) this.classified = this.pinnedClassified;

    this.flash *= Math.exp(-FLASH_DECAY * dt);
    this.gridSlam *= Math.exp(-GRID_SLAM_DECAY * dt);
    this.beatPulse *= Math.exp(-BEAT_PULSE_DECAY * dt);
    if (this.forceFlickerAlways) {
      this.flickerEnv = 1;
    } else {
      this.flickerEnv *= Math.exp(-FLICKER_DECAY * dt);
    }

    // Specimen lifecycle clock: epochs/second baseline from the act, tripled
    // while a beat pulse is hot, `?life=fast` multiplies further for review.
    const lifeMul = this.forceLifeFast ? LIFE_FAST_MUL : 1;
    this.lifeClock += dt * p.lifeRate * lifeMul * (1 + this.beatPulse * 3);

    // Audio -> sim.
    this.field.setVitalityMod(1 + this.bassE * 0.5);
    this.field.setActParams(p);

    // Camera choreography (see the OPEN/DEEP_ZOOM/SNAP/BREATH constants' doc).
    let zoom: number;
    if (section.actIndex === 0) {
      const dur0 = CUES[1] - CUES[0];
      const t0 = section.localT * dur0;
      const kOpen = this.sst(Math.min(1, t0 / OPEN_SECONDS));
      const base = OPEN_ZOOM + (ACTS[0].zoom - OPEN_ZOOM) * kOpen;
      zoom = base + (ACTS[1].zoom - base) * section.blend;
      // Hero pull-back: eases the pinned hero specimen out of screen centre
      // as the view widens. Once the user drags, this never touches pan again.
      if (!this.userPanned) {
        this.pan.set(HERO_PAN.x * (1 - kOpen), HERO_PAN.y * (1 - kOpen));
      }
    } else if (section.actIndex === 2) {
      // Hold through the pre-boundary crossfade — the deep zoom must start
      // exactly at the boundary, not leak in early.
      zoom = ACTS[2].zoom;
    } else if (section.actIndex === 3) {
      const dur3 = CUES[4] - CUES[3];
      const t3 = section.localT * dur3;
      const kDeep = this.sst(Math.min(1, t3 / DEEP_ZOOM_SECONDS));
      // Holds ACTS[3].zoom once kDeep saturates — including this act's own
      // pre-boundary crossfade window, since blend is never applied here.
      zoom = ACTS[2].zoom + (ACTS[3].zoom - ACTS[2].zoom) * kDeep;
    } else if (section.actIndex === 4) {
      const dur4 = CUES[5] - CUES[4];
      const elapsed4 = section.localT * dur4;
      if (elapsed4 < SNAP_SECONDS) {
        zoom = ACTS[3].zoom + (ACTS[4].zoom - ACTS[3].zoom) * this.sst(elapsed4 / SNAP_SECONDS);
      } else {
        zoom = p.zoom;
      }
    } else {
      zoom = p.zoom;
    }
    // Gentle global breath — damped hard during the survivor-focus act so
    // the spotlighted holdout reads as calm.
    const breathAmp = BREATH_AMP * (1 - 0.7 * p.survivorFocus);
    zoom *= 1 + breathAmp * Math.sin(audio.time * BREATH_RATE + this.breathPhase);

    // Display uniforms.
    const u = this.material.uniforms;
    u.uTime.value += dt;
    u.uZoom.value = zoom;
    u.uCommFreq.value = p.commFreq;
    u.uChurn.value = p.churn;
    u.uChatter.value = p.chatterRate * (1 + this.midE * 0.8);
    u.uWarmth.value = p.warmth;
    u.uSparkle.value = this.highE;
    u.uGlyphKick.value = this.spark;
    u.uGlyphSeed.value = this.sparkSeed;
    u.uEnergy.value = arcAt(audio.time).energy;
    u.uFlash.value = this.flash;
    u.uClassified.value = this.classified;
    u.uDesat.value = Math.min(1, this.classified * 0.6);
    u.uMachineFrac.value = p.machineFrac;
    u.uMachineOrder.value = order;
    u.uGridStrength.value = p.gridStrength;
    u.uGridFine.value = p.gridFine;
    u.uGlyphDensity.value = p.glyphDensity;
    u.uHueSat.value = p.hueSat;
    u.uRustMix.value = p.rustMix;
    u.uInkPersist.value = p.inkPersist;
    u.uVignette.value = p.vignette;
    u.uMotes.value = p.motes;
    u.uGroundLight.value = p.groundLight;
    u.uSurvivorFocus.value = p.survivorFocus;
    u.uGridSlam.value = this.gridSlam;
    u.uFlicker.value = this.flickerEnv;
    u.uLifeClock.value = this.lifeClock;
    u.uPresence.value = p.presence;
    u.uWriggle.value = p.wriggle;
    u.uDrift.value = p.drift;
    // uWaveVis is bound by reference to this.field.wave (init()) — no
    // per-frame assignment needed, it's already mutated in place by
    // scheduleWaves()/startWave().

    // Drag momentum (a1/a2/a3/b1 idiom, verbatim shape). No ambient drift.
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

    const panDist = Math.hypot(this.pan.x, this.pan.y);
    if (panDist > MAX_PAN) {
      this.pan.x *= MAX_PAN / panDist;
      this.pan.y *= MAX_PAN / panDist;
      this.velX = 0;
      this.velY = 0;
    }
  }

  pointer(e: VizPointerEvent) {
    const zoom = this.material.uniforms.uZoom.value as number;
    const cover = this.cover;

    if (e.type === 'down') {
      this.held = true;
      this.dragDx = 0;
      this.dragDy = 0;
      this.velX = 0;
      this.velY = 0;
      // Screen uv -> field uv via the display shader's own formula — a tap
      // pokes the field (the resistance mechanic) + a visible ripple ring.
      const fx = (e.x - 0.5) * cover.x / zoom + 0.5 + this.pan.x;
      const fy = (e.y - 0.5) * cover.y / zoom + 0.5 + this.pan.y;
      const wx = fx - Math.floor(fx);
      const wy = fy - Math.floor(fy);
      this.activatePoke(wx, wy);
      this.activateRipple(wx, wy);
      this.kickFlash(FLASH_KICK_ONSET);
      return;
    }

    if (e.type === 'move') {
      if (!this.held) return;
      // The user's first drag hands pan control away from the act-0 hero
      // pull-back permanently — it never touches `pan` again after this.
      this.userPanned = true;
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
    this.field.step(this.lastDt, this.stepsPerFrame);
    this.material.uniforms.uField.value = this.field.texture;
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.scene, this.camera);
  }

  resize(w: number, h: number) {
    if (!this.material || w <= 0 || h <= 0) return;
    const aspect = Math.min(3.5, Math.max(0.28, w / h));
    // Keep the community lattice square regardless of viewport aspect.
    if (aspect >= 1) this.cover.set(aspect, 1);
    else this.cover.set(1, 1 / aspect);
    (this.material.uniforms.uCover.value as THREE.Vector2).copy(this.cover);
  }

  dispose() {
    this.field.dispose();
    this.material.dispose();
    this.quad.geometry.dispose();
    this.renderer.setRenderTarget(null);
  }
}

const mod: VizModule = { default: () => new TerminalTaxonomy() };
export default mod.default;
