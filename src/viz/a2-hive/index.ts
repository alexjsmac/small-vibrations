import * as THREE from 'three';
import type { Viz, VizContext, AudioFrame, VizModule, VizPointerEvent } from '../types';
import {
  WALL_VERT, buildWallFragmentShader,
  HEX_R, ROOM_SIZE, HEX_SEEDS, HEX_JITTER, HEX_MAX_RING,
  KNOCK_SLOTS_FULL, KNOCK_SLOTS_LITE, KNOCK_BOOST_LIFETIME, KNOCK_GLOW_LIFETIME,
  LINE_SLOTS_FULL, LINE_SLOTS_LITE, LINE_LIFETIME, LINE_MIN_LENGTH,
  CRAWLER_SLOTS_FULL, CRAWLER_SLOTS_LITE,
} from './wallShader';
import { Bees } from './bees';
import { paramsAt, arcAt } from './sections';
import { mulberry32 } from '../random';

/** Bass-onset detector: excess over its own slow EMA that kicks a flash + an ambient knock. */
const ONSET_THRESHOLD = 0.12;
const ONSET_COOLDOWN = 1.5;

/** uFlash exponential decay rate (1/s) and the size of a single kick. */
const FLASH_DECAY = 3.0;
const FLASH_KICK_ONSET = 0.5;
const FLASH_KICK_BOUNDARY_54 = 0.9;
const FLASH_KICK_BOUNDARY_188 = 1.2;
const FLASH_KICK_AMBIENT = 0.4;
const FLASH_CEILING = 1.5;

/**
 * Dense beat-pulse channel: a second, faster kick/decay/schedule triple
 * mirroring the uFlash pair above, but driving ONLY the wall shader's
 * beat-pulse cell block (see wallShader.ts). uFlash itself is untouched
 * everywhere else (windows, bees, big scene lifts) — raising ITS rate to
 * pulse-channel speeds (up to 90/min) would strobe the whole scene instead
 * of just adding more pulses to the comb.
 */
const PULSE_DECAY = 6.0;
const PULSE_KICK_ONSET = 0.6;
const PULSE_KICK_AMBIENT = 0.5;
const PULSE_CEILING = 1.2;
/** Onset threshold/cooldown for the pulse channel's OWN bass-onset kick — reuses bassE/bassSlowE (no duplicate EMA pair), but tracks its own cooldown timer so it can fire at a different cadence than the flash onset detector. */
const PULSE_ONSET_THRESHOLD = 0.06;
const PULSE_ONSET_COOLDOWN = 0.3;
/** Minimum gap (seconds) between scheduled ambient pulses, floor-clamped into the Poisson draw — at ~90/min a raw Poisson process occasionally clusters two draws back-to-back, which reads as a stutter rather than a pulse. */
const PULSE_MIN_GAP = 0.12;

/** Homemakers crawler tuning: step duration bounds (seconds/hex hop), small perpendicular walk bob, and the neighbour-choice weighting terms used by chooseNeighbor(). */
const CRAWLER_STEP_DUR_MIN = 0.5;
const CRAWLER_STEP_DUR_MAX = 0.9;
/** Perpendicular bob amplitude (wall-uv units) — a leg-wobble walk cycle, not a straight glide cell-center to cell-center. */
const CRAWLER_BOB_AMOUNT = 0.006;
/** Backtrack is discouraged, not forbidden — an immediate U-turn back to the cell just left gets this multiplier on its neighbour weight. */
const CRAWLER_BACKTRACK_FACTOR = 0.08;
/** Multiplier applied to a neighbour's weight when it's already built (hexBirthApprox <= the current build front) — crawlers mostly walk on finished comb, occasionally push onto the build front itself. */
const CRAWLER_BUILT_PREFERENCE = 1.8;
/** Soft-recall: beyond this distance (wall-uv units) from the live view center (uScroll), a bias toward neighbours heading back in starts ramping in — never a hard wall or a teleport, just a lean. */
const CRAWLER_RECALL_RADIUS = 1.1;
/** Recall bias strength per wall-uv unit beyond CRAWLER_RECALL_RADIUS. */
const CRAWLER_RECALL_GAIN = 1.5;
/** The six pointy-top axial hex neighbour offsets (dq, dr), redblobgames convention — matches the pixelToAxial/axialToPixel formulas ported from wallShader.ts's GLSL below. */
const AXIAL_DIRS: readonly [number, number][] = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];

// ---- scalar axial hex math, ported from wallShader.ts's GLSL (axialToPixel,
// hexDist) — scalar in/out (not THREE.Vector2) so the crawler position
// write in updateCrawlers' per-frame loop allocates nothing. ----
function axialToPixelX(q: number, r: number, R: number): number {
  return R * (1.7320508 * q + 0.8660254 * r);
}
function axialToPixelY(q: number, r: number, R: number): number {
  return R * 1.5 * r;
}
function hexAxialDist(aq: number, ar: number, bq: number, br: number): number {
  const ax = aq, ay = -aq - ar, az = ar;
  const bx = bq, by = -bq - br, bz = br;
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by), Math.abs(az - bz));
}
function frac(x: number): number {
  return x - Math.floor(x);
}

/**
 * CPU approximation of the shader's hexHash/hexBirth field, used ONLY by
 * chooseNeighbor()'s "prefer already-built cells" weighting — NEVER treated
 * as a source of truth for anything visual. The GLSL hash21 uses the
 * hardware `sin()`; JS `Math.sin` on the same inputs measurably diverges
 * from it (validated against this branch during planning: divergence up to
 * 0.87 on this exact formula, i.e. can land on the opposite side of 0.5).
 * It's a ring-dominated heuristic — good for a coarse "closer to a seed
 * reads as more built" lean, not for reconstructing any single cell's real
 * GPU birth value.
 *
 * `seed` is added to BOTH q*1.7 and r*1.7 before the hash — this matches
 * the GLSL `hexId * 1.7 + uSeed`, where `vec2 * float + float` broadcasts
 * the scalar `uSeed` onto both components, not just one.
 */
function hexBirthApprox(q: number, r: number, seed: number): number {
  let ring = Infinity;
  for (const [sq, sr] of HEX_SEEDS) {
    const d = hexAxialDist(q, r, sq, sr);
    if (d < ring) ring = d;
  }
  const qx = q * 1.7 + seed;
  const qy = r * 1.7 + seed;
  const hash = frac(Math.sin(qx * 127.1 + qy * 311.7) * 43758.5453);
  const birth = (ring + hash * HEX_JITTER) / HEX_MAX_RING;
  return Math.min(1, Math.max(0, birth));
}

/** Ambient-knock reach (wall-uv) — comparable to the wall-space span the cover-fit transform produces. */
const AMBIENT_KNOCK_SPAN_X = 1.4;
const AMBIENT_KNOCK_SPAN_Y = 1.0;
/** Continuous rate (knocks/min) used for the `?knock=always` debug affordance. */
const DEBUG_KNOCK_RATE = 60;

/** Continuous rate (lines/min) used for the `?lines=always` debug affordance. */
const DEBUG_LINE_RATE = 40;
/** Fraction of the view span (each axis) a line endpoint samples within. */
const LINE_SPAN_FRAC = 0.6;
/** Fraction of the view span a "center-biased" endpoint samples within, so lines visibly cut through rather than skim the edge. */
const LINE_CENTER_FRAC = 0.33;
/** Bounded resample attempts to satisfy LINE_MIN_LENGTH — mirrors the small-bounded-retry idiom used elsewhere, never an unbounded loop. */
const LINE_SPAWN_ATTEMPTS = 6;
/** Bass-onset coupling: an extra line spawns on top of the Poisson schedule once an act's lineRate reaches this (climax coupling). */
const LINE_ONSET_RATE_THRESHOLD = 8;

/** Drag-release momentum: friction decay rate and the speed floor below which we snap to a stop (a1 idiom). */
const MOMENTUM_FRICTION = 2.5;
const MOMENTUM_STOP_SPEED = 0.0005;
/** Velocity EMA smoothing rate and clamp (wall-uv/s) — keeps a jittery drag from producing a wild fling. */
const VEL_EMA_RATE = 10;
const VEL_MAX = 1.5;
/**
 * Soft pan radius (wall-uv) — hitting it zeroes momentum. Wrapping (a1's
 * approach) was rejected: the wall is an unbounded plane grown outward from
 * fixed seed cells, and wrapping would silently teleport the view back over
 * already-dead ground, breaking "seed cells die last" at lights-out.
 */
const MAX_PAN = 8 * HEX_R;

interface KnockSlot {
  age: number;
  active: boolean;
}

interface LineSlot {
  age: number;
  active: boolean;
}

/**
 * One crawler's walk state: currently stepping fromQ,fromR -> toQ,toR (axial
 * hex coords), t is 0..1 progress through the hop, heading is cached at the
 * start of each hop (radians, for both the shader's body rotation and the
 * bob's perpendicular direction). strength eases toward its budget target
 * every frame — fade, never pop — but keeps SIMULATING (t/stepDur keep
 * advancing, arrivals keep choosing new neighbours) even while faded to 0,
 * so a later fade-in resumes from a sensible position instead of a stale one.
 */
interface CrawlerSlot {
  fromQ: number;
  fromR: number;
  toQ: number;
  toR: number;
  heading: number;
  t: number;
  stepDur: number;
  strength: number;
}

/** One crawler-boost slot: 1:1 with its crawler (index i), fired on arrival, aged out over `lifetime` (≈ that hop's stepDur, so the bloom decays as the crawler departs the cell it just finished). */
interface CrawlerBoostSlot {
  age: number;
  lifetime: number;
  active: boolean;
}

interface ArcOverride {
  hexBuild: number;
  roomBuild: number;
  macro: number;
  dim: number;
}

/**
 * "Homemakers" (hive rebuild) — the golden wax wall. One fullscreen
 * fragment shader (wallShader.ts) composites a hex comb lattice and a rect
 * room lattice negotiating every shared edge, plus an additive bees layer
 * (bees.ts) reprojected into the same view-relative space, plus a CPU
 * crawler system ("the Homemakers": dark entities that walk the built comb
 * cell to cell, leaving a warm ember wake, and pre-build the cell they're
 * standing on). Deterministic: no sim, no warmup — every `?t=` lands
 * exactly on the staged arc (sections.ts).
 *
 * Debug: `?solo=wall|bees` isolates a layer, `?knock=always` forces a
 * steady ambient knock stream (verification affordance for the knock-glow
 * travel + boost pre-build), `?lines=always` forces a steady chalk-line
 * stream (same idiom, for the line pool), `?arc=hexBuild,roomBuild,macro,dim`
 * force-overrides those four continuous arc values (comma list of floats),
 * `?crawlers=<0..1>` force-overrides the crawler population fraction
 * (independent of the act's `crawlers` ActParams — for screenshots at full
 * population regardless of song position).
 */
class HiveWall implements Viz {
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.OrthographicCamera;
  private quad!: THREE.Mesh;
  private material!: THREE.ShaderMaterial;
  private bees!: Bees;

  private rand!: () => number;
  private soloWall = true;
  private soloBees = true;
  private forceKnockAlways = false;
  private forceLinesAlways = false;
  private arcOverride: ArcOverride | null = null;
  /** `?crawlers=<0..1>` debug override — forces the crawler population fraction regardless of the act's `crawlers` ActParams. Null means "no override, use the act value". */
  private forceCrawlers: number | null = null;

  /** Cover-fit scale, computed in resize() — copied by value into both the wall and bees uniforms each frame/resize (see bees.ts's uCover doc comment on why not shared by reference). */
  private cover = new THREE.Vector2(1, 1);
  /** Current act zoom, cached for chooseNeighbor's view-proportional recall. */
  private currentZoom = 1;

  private bassE = 0;
  private midE = 0;
  private highE = 0;
  private bassSlowE = 0;
  private onsetCooldown = 0;
  private flash = 0;
  /** Beat/flash-event counter — incremented on every kickFlash() call (a1's "each kick = a beat event"), re-rolls the beat-pulse colour selection each time. */
  private flashCount = 0;
  private flashTimeToNext = 0;
  private knockTimeToNext = 0;
  private lineTimeToNext = 0;
  /** Previous frame's song time, for edge-triggered 54s/188s boundary detection (old a2-homemakers/index.ts idiom). */
  private lastSongTime = -1;

  /** Dense beat-pulse channel — mirrors flash/flashCount/onsetCooldown above but decoupled: own decay rate, own onset cooldown timer (reusing bassE/bassSlowE, not a duplicate EMA pair), own Poisson schedule. Drives ONLY wallShader.ts's beat-pulse block. */
  private pulse = 0;
  private pulseCount = 0;
  private pulseOnsetCooldown = 0;
  private pulseTimeToNext = 0;

  private knockSlotCount = KNOCK_SLOTS_FULL;
  private knockBoosts: KnockSlot[] = [];
  private knockBoostUniformValues!: THREE.Vector4[];
  private knockGlows: KnockSlot[] = [];
  private knockGlowUniformValues!: THREE.Vector4[];

  private lineSlotCount = LINE_SLOTS_FULL;
  private lines: LineSlot[] = [];
  private lineAUniformValues!: THREE.Vector4[];
  private lineMetaUniformValues!: THREE.Vector4[];

  private crawlerSlotCount = CRAWLER_SLOTS_FULL;
  private crawlers: CrawlerSlot[] = [];
  private crawlerUniformValues!: THREE.Vector4[];
  private crawlerBoosts: CrawlerBoostSlot[] = [];
  private crawlerBoostUniformValues!: THREE.Vector4[];
  /** uSeed's float value — cached so hexBirthApprox() (chooseNeighbor's weighting) always matches the same seed the shader's hexHash uses. */
  private hexSeedFloat = 0;

  /** Pointer/drag-pan state — all scalars, zero per-frame allocation (a1 momentum block, verbatim shape). */
  private held = false;
  private dragDx = 0;
  private dragDy = 0;
  private velX = 0;
  private velY = 0;

  init(ctx: VizContext) {
    const { renderer, seed, quality } = ctx;
    this.renderer = renderer;
    this.rand = mulberry32(seed ^ 0x40b1e5ee);

    const params = new URLSearchParams(location.search);
    const solo = params.get('solo');
    this.soloWall = !solo || solo === 'wall';
    this.soloBees = !solo || solo === 'bees';
    this.forceKnockAlways = params.get('knock') === 'always';
    this.forceLinesAlways = params.get('lines') === 'always';
    const arcParam = params.get('arc');
    if (arcParam) {
      const parts = arcParam.split(',').map(Number);
      if (parts.length === 4 && parts.every(Number.isFinite)) {
        this.arcOverride = { hexBuild: parts[0], roomBuild: parts[1], macro: parts[2], dim: parts[3] };
      }
    }
    const crawlersParam = params.get('crawlers');
    if (crawlersParam !== null) {
      const v = Number(crawlersParam);
      if (Number.isFinite(v)) this.forceCrawlers = Math.min(1, Math.max(0, v));
    }

    const full = quality.level === 'full';
    this.knockSlotCount = full ? KNOCK_SLOTS_FULL : KNOCK_SLOTS_LITE;
    for (let i = 0; i < this.knockSlotCount; i++) this.knockBoosts.push({ age: 0, active: false });
    this.knockBoostUniformValues = [];
    for (let i = 0; i < this.knockSlotCount; i++) this.knockBoostUniformValues.push(new THREE.Vector4(0, 0, 0, 0));
    for (let i = 0; i < this.knockSlotCount; i++) this.knockGlows.push({ age: 0, active: false });
    this.knockGlowUniformValues = [];
    for (let i = 0; i < this.knockSlotCount; i++) this.knockGlowUniformValues.push(new THREE.Vector4(0, 0, 0, 0));

    this.lineSlotCount = full ? LINE_SLOTS_FULL : LINE_SLOTS_LITE;
    for (let i = 0; i < this.lineSlotCount; i++) this.lines.push({ age: 0, active: false });
    this.lineAUniformValues = [];
    for (let i = 0; i < this.lineSlotCount; i++) this.lineAUniformValues.push(new THREE.Vector4(0, 0, 0, 0));
    this.lineMetaUniformValues = [];
    for (let i = 0; i < this.lineSlotCount; i++) this.lineMetaUniformValues.push(new THREE.Vector4(0, 0, 0, 0));

    this.crawlerSlotCount = full ? CRAWLER_SLOTS_FULL : CRAWLER_SLOTS_LITE;
    this.crawlerUniformValues = [];
    for (let i = 0; i < this.crawlerSlotCount; i++) this.crawlerUniformValues.push(new THREE.Vector4(0, 0, 0, 0));
    for (let i = 0; i < this.crawlerSlotCount; i++) this.crawlerBoosts.push({ age: 0, lifetime: 0, active: false });
    this.crawlerBoostUniformValues = [];
    for (let i = 0; i < this.crawlerSlotCount; i++) this.crawlerBoostUniformValues.push(new THREE.Vector4(0, 0, 0, 0));

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    const geometry = new THREE.PlaneGeometry(2, 2);
    const seedFloat = ((seed >>> 0) % 100000) / 100000;
    this.hexSeedFloat = seedFloat;
    this.material = new THREE.ShaderMaterial({
      vertexShader: WALL_VERT,
      fragmentShader: buildWallFragmentShader(full, this.knockSlotCount, this.lineSlotCount, this.crawlerSlotCount),
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uSeed: { value: seedFloat },
        uHexR: { value: HEX_R },
        uRoomSize: { value: ROOM_SIZE },
        uCover: { value: new THREE.Vector2(1, 1) },
        uScroll: { value: new THREE.Vector2(0, 0) },
        uZoom: { value: 1 },
        uHexBuild: { value: 0 },
        uRoomBuild: { value: 0 },
        uMacro: { value: 0 },
        uDim: { value: 0 },
        uWallGlow: { value: 0 },
        uHoneyFill: { value: 0 },
        uRoomLight: { value: 0 },
        uShimmer: { value: 0 },
        uPalMix: { value: 0 },
        uHueVar: { value: 0 },
        uBass: { value: 0 },
        uMid: { value: 0 },
        uHigh: { value: 0 },
        uFlash: { value: 0 },
        uFlashCount: { value: 0 },
        uPulse: { value: 0 },
        uPulseCount: { value: 0 },
        uGhost: { value: 0 },
        uBeatPulse: { value: 0 },
        uKnockBoost: { value: this.knockBoostUniformValues },
        uKnockGlow: { value: this.knockGlowUniformValues },
        uLineA: { value: this.lineAUniformValues },
        uLineMeta: { value: this.lineMetaUniformValues },
        uCrawler: { value: this.crawlerUniformValues },
        uCrawlerBoost: { value: this.crawlerBoostUniformValues },
      },
    });
    this.quad = new THREE.Mesh(geometry, this.material);
    if (this.soloWall) this.scene.add(this.quad);

    this.bees = new Bees(seed, quality, renderer);
    if (this.soloBees) this.scene.add(this.bees.object);

    this.initCrawlers();

    const canvas = renderer.domElement;
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    this.resize(w, h);
  }

  private kickFlash(amount: number) {
    this.flash = Math.min(FLASH_CEILING, this.flash + amount);
    // Every kick is a beat event, whether from a bass onset, a boundary
    // crossing, or the ambient Poisson schedule — the beat-pulse shader
    // term re-rolls its cell selection + colour off this counter.
    this.flashCount++;
  }

  /** Dense-channel twin of kickFlash — bumps uPulse and re-rolls the beat-pulse cell selection via uPulseCount. */
  private kickPulse(amount: number) {
    this.pulse = Math.min(PULSE_CEILING, this.pulse + amount);
    this.pulseCount++;
  }

  private activateKnockBoost(x: number, y: number, strength = 1) {
    // Reuse-or-steal idiom, mirroring a1's SeedSlot/RippleSlot pools.
    let idx = this.knockBoosts.findIndex((s) => !s.active);
    if (idx < 0) idx = 0;
    const slot = this.knockBoosts[idx];
    slot.active = true;
    slot.age = 0;
    this.knockBoostUniformValues[idx].set(x, y, 0, strength);
  }

  private activateKnockGlow(x: number, y: number, strength = 1) {
    let idx = this.knockGlows.findIndex((s) => !s.active);
    if (idx < 0) idx = 0;
    const slot = this.knockGlows[idx];
    slot.active = true;
    slot.age = 0;
    this.knockGlowUniformValues[idx].set(x, y, 0, strength);
  }

  /**
   * Ages both knock pools. `w` is left constant at its activation strength
   * for the shader's own exp(-age*k) curves to decay (matching a1's
   * RippleSlot pattern, not its linearly-decayed SeedSlot pattern) — a
   * hard cutoff at the lifetime just retires the slot for reuse.
   */
  private updateKnockAges(dt: number) {
    for (let i = 0; i < this.knockBoosts.length; i++) {
      const slot = this.knockBoosts[i];
      if (!slot.active) continue;
      slot.age += dt;
      if (slot.age >= KNOCK_BOOST_LIFETIME) {
        slot.active = false;
        this.knockBoostUniformValues[i].w = 0;
      } else {
        this.knockBoostUniformValues[i].z = slot.age;
      }
    }
    for (let i = 0; i < this.knockGlows.length; i++) {
      const slot = this.knockGlows[i];
      if (!slot.active) continue;
      slot.age += dt;
      if (slot.age >= KNOCK_GLOW_LIFETIME) {
        slot.active = false;
        this.knockGlowUniformValues[i].w = 0;
      } else {
        this.knockGlowUniformValues[i].z = slot.age;
      }
    }
  }

  private scheduleFlash(dt: number, ratePerMinute: number) {
    // Poisson process, same idiom as a1's scheduleSeeds.
    const rate = Math.max(0, ratePerMinute) / 60;
    if (rate <= 0) return;
    this.flashTimeToNext -= dt;
    while (this.flashTimeToNext <= 0) {
      this.kickFlash(FLASH_KICK_AMBIENT);
      const u = Math.max(1e-6, this.rand());
      this.flashTimeToNext += -Math.log(u) / rate;
    }
  }

  /**
   * Poisson schedule for the dense pulse channel — same idiom as
   * scheduleFlash, with one addition: the draw is floor-clamped to
   * PULSE_MIN_GAP. At this channel's rates (up to 90/min) a raw exponential
   * draw occasionally lands two events back-to-back, which reads as a
   * stutter cluster rather than a rhythm; the floor keeps event density
   * high without ever letting the gap collapse below legibility.
   */
  private schedulePulse(dt: number, ratePerMinute: number) {
    const rate = Math.max(0, ratePerMinute) / 60;
    if (rate <= 0) return;
    this.pulseTimeToNext -= dt;
    while (this.pulseTimeToNext <= 0) {
      this.kickPulse(PULSE_KICK_AMBIENT);
      const u = Math.max(1e-6, this.rand());
      this.pulseTimeToNext += Math.max(PULSE_MIN_GAP, -Math.log(u) / rate);
    }
  }

  private scheduleKnocks(dt: number, ratePerMinute: number) {
    const rate = Math.max(0, ratePerMinute) / 60;
    if (rate <= 0) return;
    this.knockTimeToNext -= dt;
    while (this.knockTimeToNext <= 0) {
      const wx = (this.rand() * 2 - 1) * AMBIENT_KNOCK_SPAN_X;
      const wy = (this.rand() * 2 - 1) * AMBIENT_KNOCK_SPAN_Y;
      this.activateKnockBoost(wx, wy, 0.6);
      this.activateKnockGlow(wx, wy, 0.6);
      const u = Math.max(1e-6, this.rand());
      this.knockTimeToNext += -Math.log(u) / rate;
    }
  }

  /**
   * Chalk-line spawn: endpoints sampled within the current view span
   * (`scroll ± cover/zoom * LINE_SPAN_FRAC`), with one endpoint per attempt
   * biased toward the view-center third so a spawned line visibly cuts
   * through the frame instead of skimming its edge. Segments shorter than
   * LINE_MIN_LENGTH are resampled, bounded by LINE_SPAWN_ATTEMPTS (small-
   * bounded-retry idiom — never an unbounded loop).
   */
  private activateLine() {
    let idx = this.lines.findIndex((s) => !s.active);
    if (idx < 0) idx = 0;
    const slot = this.lines[idx];

    const cover = this.cover;
    const zoom = this.material.uniforms.uZoom.value as number;
    const scroll = this.material.uniforms.uScroll.value as THREE.Vector2;
    const spanX = (cover.x / zoom) * LINE_SPAN_FRAC;
    const spanY = (cover.y / zoom) * LINE_SPAN_FRAC;

    let ax = 0, ay = 0, bx = 0, by = 0;
    for (let attempt = 0; attempt < LINE_SPAWN_ATTEMPTS; attempt++) {
      const cx = scroll.x + (this.rand() * 2 - 1) * spanX * LINE_CENTER_FRAC;
      const cy = scroll.y + (this.rand() * 2 - 1) * spanY * LINE_CENTER_FRAC;
      const fx = scroll.x + (this.rand() * 2 - 1) * spanX;
      const fy = scroll.y + (this.rand() * 2 - 1) * spanY;
      if (this.rand() < 0.5) { ax = cx; ay = cy; bx = fx; by = fy; }
      else { ax = fx; ay = fy; bx = cx; by = cy; }
      if (Math.hypot(bx - ax, by - ay) >= LINE_MIN_LENGTH) break;
    }

    slot.active = true;
    slot.age = 0;
    this.lineAUniformValues[idx].set(ax, ay, bx, by);
    this.lineMetaUniformValues[idx].set(0, 1, this.rand(), 0);
  }

  /**
   * Ages the line pool. Unlike the knock pools' `w`-holds-strength pattern,
   * the line meta's x component IS the age the shader reads directly (its
   * head-travel and fade curves are both keyed off raw seconds) — only y
   * (strength) needs zeroing to retire a slot for reuse.
   */
  private updateLineAges(dt: number) {
    for (let i = 0; i < this.lines.length; i++) {
      const slot = this.lines[i];
      if (!slot.active) continue;
      slot.age += dt;
      if (slot.age >= LINE_LIFETIME) {
        slot.active = false;
        this.lineMetaUniformValues[i].y = 0;
      } else {
        this.lineMetaUniformValues[i].x = slot.age;
      }
    }
  }

  private scheduleLines(dt: number, ratePerMinute: number) {
    // Poisson process, same idiom as scheduleKnocks/scheduleFlash.
    const rate = Math.max(0, ratePerMinute) / 60;
    if (rate <= 0) return;
    this.lineTimeToNext -= dt;
    while (this.lineTimeToNext <= 0) {
      this.activateLine();
      const u = Math.max(1e-6, this.rand());
      this.lineTimeToNext += -Math.log(u) / rate;
    }
  }

  /**
   * Spawns each crawler on (or near) a built cell around the origin: a small
   * bounded sample of cells within a few rings of the seed cluster, keeping
   * the lowest hexBirthApprox candidate — earliest-born cells are the ones
   * guaranteed visible at any uHexBuild > 0, so no crawler starts on ground
   * that doesn't exist yet. Step phases/durations are staggered from the
   * module's seeded RNG so the population never walks in lockstep. All
   * strengths start at 0 (fade in via the per-frame ease, never pop).
   */
  private initCrawlers() {
    for (let i = 0; i < this.crawlerSlotCount; i++) {
      let bestQ = 0, bestR = 0, bestBirth = Infinity;
      for (let attempt = 0; attempt < 12; attempt++) {
        const q = Math.round((this.rand() * 2 - 1) * 4);
        const r = Math.round((this.rand() * 2 - 1) * 4);
        const birth = hexBirthApprox(q, r, this.hexSeedFloat);
        if (birth < bestBirth) { bestBirth = birth; bestQ = q; bestR = r; }
      }
      const dir = AXIAL_DIRS[Math.min(AXIAL_DIRS.length - 1, Math.floor(this.rand() * AXIAL_DIRS.length))];
      const slot: CrawlerSlot = {
        fromQ: bestQ,
        fromR: bestR,
        toQ: bestQ + dir[0],
        toR: bestR + dir[1],
        heading: 0,
        t: this.rand(), // staggered phase — not everyone mid-hop at once
        stepDur: CRAWLER_STEP_DUR_MIN + this.rand() * (CRAWLER_STEP_DUR_MAX - CRAWLER_STEP_DUR_MIN),
        strength: 0,
      };
      slot.heading = Math.atan2(
        axialToPixelY(slot.toQ, slot.toR, HEX_R) - axialToPixelY(slot.fromQ, slot.fromR, HEX_R),
        axialToPixelX(slot.toQ, slot.toR, HEX_R) - axialToPixelX(slot.fromQ, slot.fromR, HEX_R),
      );
      this.crawlers.push(slot);
    }
  }

  /**
   * On-arrival neighbour pick: a weighted roll over the 6 axial directions.
   *  - forward bias: weight grows with the dot of the candidate direction
   *    against the incoming heading, so walks read as purposeful paths, not
   *    a random scribble;
   *  - backtrack ×CRAWLER_BACKTRACK_FACTOR: an immediate U-turn is strongly
   *    discouraged but NOT forbidden (a dead-end weighting elsewhere could
   *    otherwise strand a crawler with zero total weight);
   *  - built preference ×CRAWLER_BUILT_PREFERENCE via hexBirthApprox — a
   *    HEURISTIC lean only (see hexBirthApprox's doc comment for the
   *    measured CPU↔GPU divergence), never a hard gate;
   *  - soft recall: beyond CRAWLER_RECALL_RADIUS from the live view center
   *    (uScroll), candidates pointing back toward it gain weight
   *    proportionally to the excess distance — a lean, not a wall, so
   *    there are no teleports and no visible bounce at an invisible fence.
   * Arrival path (~1-2 calls/sec/crawler) — free to allocate, unlike the
   * per-frame position writes in updateCrawlers.
   */
  private chooseNeighbor(slot: CrawlerSlot, hexBuild: number, scrollX: number, scrollY: number): [number, number] {
    const cx = axialToPixelX(slot.toQ, slot.toR, HEX_R);
    const cy = axialToPixelY(slot.toQ, slot.toR, HEX_R);
    const inX = Math.cos(slot.heading);
    const inY = Math.sin(slot.heading);
    const toCenterX = scrollX - cx;
    const toCenterY = scrollY - cy;
    const distFromView = Math.hypot(toCenterX, toCenterY);
    // Recall must be VIEW-PROPORTIONAL: the visible half-span is
    // max(cover)/zoom * 0.5 (~0.5 wall units at zoom 1) — a fixed radius
    // larger than that lets crawlers drift multiple viewports away before
    // feeling any pull (verified live: all 5 sat off-screen). Kick in just
    // inside the edge so they orbit the visible wall.
    const halfSpan = (Math.max(this.cover.x, this.cover.y) / Math.max(0.3, this.currentZoom)) * 0.5;
    const recallRadius = Math.min(CRAWLER_RECALL_RADIUS, halfSpan * 0.85);
    const recallExcess = Math.max(0, distFromView - recallRadius);
    const recallNX = distFromView > 1e-6 ? toCenterX / distFromView : 0;
    const recallNY = distFromView > 1e-6 ? toCenterY / distFromView : 0;

    const weights: number[] = [];
    let total = 0;
    for (const [dq, dr] of AXIAL_DIRS) {
      const nq = slot.toQ + dq;
      const nr = slot.toR + dr;
      const dx = axialToPixelX(nq, nr, HEX_R) - cx;
      const dy = axialToPixelY(nq, nr, HEX_R) - cy;
      const len = Math.hypot(dx, dy);
      const ndx = dx / len, ndy = dy / len;
      // Forward bias: floor keeps sideways turns alive, dot rewards straight-ish.
      let w = 0.35 + Math.max(0, ndx * inX + ndy * inY);
      if (nq === slot.fromQ && nr === slot.fromR) w *= CRAWLER_BACKTRACK_FACTOR;
      if (hexBirthApprox(nq, nr, this.hexSeedFloat) <= hexBuild) w *= CRAWLER_BUILT_PREFERENCE;
      w *= 1 + recallExcess * CRAWLER_RECALL_GAIN * Math.max(0, ndx * recallNX + ndy * recallNY);
      weights.push(w);
      total += w;
    }

    let roll = this.rand() * total;
    for (let d = 0; d < AXIAL_DIRS.length; d++) {
      roll -= weights[d];
      if (roll <= 0) return [slot.toQ + AXIAL_DIRS[d][0], slot.toR + AXIAL_DIRS[d][1]];
    }
    // Float-sum residue fallback: the last candidate.
    const last = AXIAL_DIRS[AXIAL_DIRS.length - 1];
    return [slot.toQ + last[0], slot.toR + last[1]];
  }

  /** Fires the crawler-boost slot paired 1:1 with crawler `idx` — called on arrival, so the cell just reached blooms "finished" and decays over roughly the hop the crawler spends departing it. */
  private activateCrawlerBoost(idx: number, x: number, y: number, lifetime: number, strength: number) {
    const slot = this.crawlerBoosts[idx];
    slot.active = true;
    slot.age = 0;
    slot.lifetime = lifetime;
    this.crawlerBoostUniformValues[idx].set(x, y, 0, strength);
  }

  /** Ages the crawler-boost pool — same shape as updateKnockAges (w holds strength, shader decays via exp(-age*2)), but with per-slot lifetimes (each ≈ its crawler's stepDur). */
  private updateCrawlerAges(dt: number) {
    for (let i = 0; i < this.crawlerBoosts.length; i++) {
      const slot = this.crawlerBoosts[i];
      if (!slot.active) continue;
      slot.age += dt;
      if (slot.age >= slot.lifetime) {
        slot.active = false;
        this.crawlerBoostUniformValues[i].w = 0;
      } else {
        this.crawlerBoostUniformValues[i].z = slot.age;
      }
    }
  }

  /**
   * Per-frame crawler walk. `targetFraction` is the act's `crawlers` value
   * (or the `?crawlers=` debug override): slot i's strength eases toward
   * 1 if i < targetFraction * slotCount else 0, with min(1, dt*3) — fade,
   * never pop. Faded-out crawlers KEEP walking (the whole body of this loop
   * still runs for them) so a later fade-in resumes from wherever their walk
   * actually got to, not a stale frozen position.
   *
   * Hot path discipline: the position/heading/strength writes below are all
   * scalar math into the pooled Vector4s — zero allocation. Only the
   * arrival branch (chooseNeighbor, ~1-2 times/sec/crawler) allocates.
   */
  private updateCrawlers(dt: number, targetFraction: number, hexBuild: number, scrollX: number, scrollY: number) {
    const n = this.crawlers.length;
    const ease = Math.min(1, dt * 3);
    for (let i = 0; i < n; i++) {
      const slot = this.crawlers[i];
      const target = i < targetFraction * n ? 1 : 0;
      slot.strength += (target - slot.strength) * ease;

      slot.t += dt / slot.stepDur;
      while (slot.t >= 1) {
        slot.t -= 1;
        // Arrival: the cell just reached blooms under the crawler...
        const arrX = axialToPixelX(slot.toQ, slot.toR, HEX_R);
        const arrY = axialToPixelY(slot.toQ, slot.toR, HEX_R);
        this.activateCrawlerBoost(i, arrX, arrY, slot.stepDur, slot.strength);
        // ...then pick where to walk next.
        const next = this.chooseNeighbor(slot, hexBuild, scrollX, scrollY);
        slot.fromQ = slot.toQ;
        slot.fromR = slot.toR;
        slot.toQ = next[0];
        slot.toR = next[1];
        slot.heading = Math.atan2(
          axialToPixelY(slot.toQ, slot.toR, HEX_R) - arrY,
          axialToPixelX(slot.toQ, slot.toR, HEX_R) - arrX,
        );
      }

      // Smoothstep the hop (ease out of/into each cell center) + a small
      // perpendicular bob at walk-cycle rate — legs, not a straight glide.
      const tt = slot.t;
      const s = tt * tt * (3 - 2 * tt);
      const fx = axialToPixelX(slot.fromQ, slot.fromR, HEX_R);
      const fy = axialToPixelY(slot.fromQ, slot.fromR, HEX_R);
      const tx = axialToPixelX(slot.toQ, slot.toR, HEX_R);
      const ty = axialToPixelY(slot.toQ, slot.toR, HEX_R);
      const bob = Math.sin(tt * Math.PI * 2 + i * 2.399) * CRAWLER_BOB_AMOUNT;
      const px = fx + (tx - fx) * s - Math.sin(slot.heading) * bob;
      const py = fy + (ty - fy) * s + Math.cos(slot.heading) * bob;
      this.crawlerUniformValues[i].set(px, py, slot.heading, slot.strength);
    }
  }

  update(dt: number, audio: AudioFrame) {
    const section = paramsAt(audio.time);
    const arc = arcAt(audio.time);
    const p = section.params;

    // The two drops land as discrete hits, not crossfades — same edge-
    // triggered detection as the old a2-homemakers/index.ts. The `< 0.5`
    // guard rejects the ?t= dev-seed jump and the 294->0 loop wrap as
    // false triggers (a normal frame's dt never approaches that).
    if (this.lastSongTime >= 0 && audio.time - this.lastSongTime >= 0 && audio.time - this.lastSongTime < 0.5) {
      if (this.lastSongTime < 54 && audio.time >= 54) this.kickFlash(FLASH_KICK_BOUNDARY_54);
      if (this.lastSongTime < 188 && audio.time >= 188) this.kickFlash(FLASH_KICK_BOUNDARY_188);
    }
    this.lastSongTime = audio.time;

    // Smooth audio bands with EMAs (a1 idiom) so reactivity isn't jittery.
    const k = Math.min(1, dt * 8);
    this.bassE += (audio.bass - this.bassE) * k;
    this.midE += (audio.mid - this.midE) * k;
    this.highE += (audio.high - this.highE) * k;
    this.bassSlowE += (audio.bass - this.bassSlowE) * Math.min(1, dt * 1.5);

    // Bass-onset detector: excess over its own slow EMA kicks the flash
    // and an ambient knock (a1's ONSET_THRESHOLD/ONSET_COOLDOWN pattern).
    this.onsetCooldown -= dt;
    if (this.onsetCooldown <= 0 && this.bassE - this.bassSlowE > ONSET_THRESHOLD) {
      this.kickFlash(FLASH_KICK_ONSET);
      const wx = (this.rand() * 2 - 1) * AMBIENT_KNOCK_SPAN_X;
      const wy = (this.rand() * 2 - 1) * AMBIENT_KNOCK_SPAN_Y;
      this.activateKnockBoost(wx, wy);
      this.activateKnockGlow(wx, wy);
      // Climax coupling: once an act's baseline lineRate reaches the
      // threshold (only two-homes-one-wall's 20 does), every bass onset
      // also spawns an extra chalk line on top of the Poisson schedule.
      if (p.lineRate >= LINE_ONSET_RATE_THRESHOLD) this.activateLine();
      this.onsetCooldown = ONSET_COOLDOWN;
    }

    // Pulse-channel onset detector: reuses the same bassE/bassSlowE EMA pair
    // as the flash detector above (a duplicate pair would just track the
    // same signal), but with its own lower threshold and much shorter
    // cooldown — the dense channel wants to catch beats the flash channel's
    // 1.5s cooldown deliberately skips.
    this.pulseOnsetCooldown -= dt;
    if (this.pulseOnsetCooldown <= 0 && this.bassE - this.bassSlowE > PULSE_ONSET_THRESHOLD) {
      this.kickPulse(PULSE_KICK_ONSET);
      this.pulseOnsetCooldown = PULSE_ONSET_COOLDOWN;
    }

    this.scheduleFlash(dt, p.flashRate);
    this.flash *= Math.exp(-FLASH_DECAY * dt);

    this.schedulePulse(dt, p.pulseRate);
    this.pulse *= Math.exp(-PULSE_DECAY * dt);

    this.scheduleKnocks(dt, this.forceKnockAlways ? DEBUG_KNOCK_RATE : p.knockRate);
    this.updateKnockAges(dt);

    this.scheduleLines(dt, this.forceLinesAlways ? DEBUG_LINE_RATE : p.lineRate);
    this.updateLineAges(dt);

    const du = this.material.uniforms;
    du.uTime.value += dt;
    du.uBass.value = this.bassE;
    du.uMid.value = this.midE;
    du.uHigh.value = this.highE;
    du.uFlash.value = this.flash;
    du.uFlashCount.value = this.flashCount;
    du.uPulse.value = this.pulse;
    du.uPulseCount.value = this.pulseCount;
    du.uGhost.value = p.ghost;
    du.uBeatPulse.value = p.beatPulse;

    du.uHexBuild.value = this.arcOverride?.hexBuild ?? arc.hexBuild;
    du.uRoomBuild.value = this.arcOverride?.roomBuild ?? arc.roomBuild;
    du.uMacro.value = this.arcOverride?.macro ?? arc.macro;
    du.uDim.value = this.arcOverride?.dim ?? arc.dim;

    du.uWallGlow.value = p.wallGlow;
    du.uHoneyFill.value = p.honeyFill;
    du.uRoomLight.value = p.roomLight;
    du.uShimmer.value = p.shimmer;
    du.uPalMix.value = p.palMix;
    du.uHueVar.value = p.hueVar;

    const zoom = p.zoom;
    du.uZoom.value = zoom;
    this.currentZoom = zoom; // read by chooseNeighbor's view-proportional recall

    // Ambient wall-space scroll drift — mid nudges pace, matching a1's march.
    const scroll = du.uScroll.value as THREE.Vector2;
    const driftPace = 1 + audio.mid * 0.3;
    scroll.x += p.driftX * dt * driftPace;
    scroll.y += p.driftY * dt * driftPace;

    // Drag momentum: composes additively on top of the act's drift above.
    // While held, EMA this frame's accumulated drag into an instantaneous
    // velocity; after release, integrate it into scroll with exponential
    // friction so a flung drag glides to a stop (a1 idiom, verbatim shape).
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
      scroll.x += (this.velX * cover.x / zoom) * dt;
      scroll.y += (this.velY * cover.y / zoom) * dt;
      const friction = Math.exp(-MOMENTUM_FRICTION * dt);
      this.velX *= friction;
      this.velY *= friction;
      if (Math.abs(this.velX) < MOMENTUM_STOP_SPEED) this.velX = 0;
      if (Math.abs(this.velY) < MOMENTUM_STOP_SPEED) this.velY = 0;
    }

    // Pan clamp: soft radius around the seed origin — hitting it zeroes
    // momentum rather than letting a fling coast past it.
    const panDist = Math.hypot(scroll.x, scroll.y);
    if (panDist > MAX_PAN) {
      scroll.x *= MAX_PAN / panDist;
      scroll.y *= MAX_PAN / panDist;
      this.velX = 0;
      this.velY = 0;
    }

    // Homemakers: walked AFTER the scroll/pan block so the recall bias in
    // chooseNeighbor sees this frame's actual view center, not last frame's.
    // hexBuild goes in as the same effective value the shader will read
    // (arc override included) — the built-cell preference should follow
    // whatever build front is actually on screen.
    this.updateCrawlers(
      dt,
      this.forceCrawlers ?? p.crawlers,
      this.arcOverride?.hexBuild ?? arc.hexBuild,
      scroll.x, scroll.y,
    );
    this.updateCrawlerAges(dt);

    this.bees.update(dt, audio, section, arc, zoom, cover, this.flash);
  }

  pointer(e: VizPointerEvent) {
    const du = this.material.uniforms;
    const cover = this.cover;
    const zoom = du.uZoom.value as number;
    const scroll = du.uScroll.value as THREE.Vector2;

    if (e.type === 'down') {
      this.held = true;
      this.dragDx = 0;
      this.dragDy = 0;
      this.velX = 0; // grabbing kills any in-flight momentum glide
      this.velY = 0;

      // Screen uv -> wall-space, via the wall shader's own formula
      // ((vUv-0.5)*uCover/uZoom + uScroll). No wrap here (unlike a1's
      // field-uv poke) — the wall is unbounded, so a raw wall-space
      // position is always valid.
      const wx = (e.x - 0.5) * cover.x / zoom + scroll.x;
      const wy = (e.y - 0.5) * cover.y / zoom + scroll.y;
      this.activateKnockBoost(wx, wy);
      this.activateKnockGlow(wx, wy);
      return;
    }

    if (e.type === 'move') {
      if (!this.held) return;
      // 1:1 finger tracking, derived directly from the wall-space formula.
      scroll.x += (e.dx * cover.x) / zoom;
      scroll.y += (e.dy * cover.y) / zoom;
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
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.scene, this.camera);
  }

  resize(w: number, h: number) {
    if (!this.material || w <= 0 || h <= 0) return;
    // Clamp: mid-layout (sheet drag, mobile URL-bar show/hide, pane resize)
    // the stage can report a degenerate height for one event, and no later
    // resize corrects it — an unclamped aspect (seen: 375) collapses the
    // whole wall into sub-pixel hexes.
    const aspect = Math.min(3.5, Math.max(0.28, w / h));
    // Hexes stay regular regardless of viewport aspect.
    if (aspect >= 1) this.cover.set(aspect, 1);
    else this.cover.set(1, 1 / aspect);
    (this.material.uniforms.uCover.value as THREE.Vector2).copy(this.cover);
  }

  dispose() {
    this.material.dispose();
    this.quad.geometry.dispose();
    this.bees.dispose();
    this.renderer.setRenderTarget(null);
  }
}

const mod: VizModule = { default: () => new HiveWall() };
export default mod.default;
