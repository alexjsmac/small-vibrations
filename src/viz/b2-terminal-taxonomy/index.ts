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

/**
 * Poisson-delay clamp (album-audit Bug A, belt-and-braces guard — see
 * scheduleScans/scheduleLinks/scheduleRunners' own docs for the actual fix):
 * caps a single drawn inter-arrival delay so a pathological near-zero rate
 * (a crossfade epsilon, or any other future bug) can never bake in an
 * absurd multi-hour wait even before the schedule-rate rescale below has a
 * chance to shrink it back down. ~3x the slowest channel's own mean gap at
 * its lowest realistic nonzero rate (linkRate=2/min -> 30s mean), so it
 * never clips a normal draw in practice.
 */
const MAX_POISSON_GAP_SECONDS = 90;

/**
 * Draws one Poisson inter-arrival delay (seconds) at `ratePerMinute`
 * events/minute, clamped to MAX_POISSON_GAP_SECONDS (see its own doc).
 * Shared by scheduleScans/scheduleLinks/scheduleRunners — the three Bug-A
 * crossfade-epsilon channels (scheduleScans' scanRate 0->5 @56s,
 * scheduleLinks' linkRate 0->2 @128s, scheduleRunners' runnerRate 0->4
 * @128s — see each scheduler's own doc). scheduleWaves is NOT affected (its
 * rate only ever steps discretely via the act-hold `p`, never crosses
 * through an epsilon blend — see its own doc) so it keeps its original
 * inline draw untouched, out of caution/scope discipline.
 */
function poissonDelay(rand: () => number, ratePerMinute: number): number {
  const rate = Math.max(1e-9, ratePerMinute) / 60;
  const u = Math.max(1e-6, rand());
  return Math.min(MAX_POISSON_GAP_SECONDS, -Math.log(u) / rate);
}

/**
 * Bass-onset detector (album-audit fix, transplanted from b3-sterile-breath's
 * increment-11 cure — see that module's BASS_ONSET_* doc for the full
 * postmortem): this.bassE (fast EMA, rate 8, tau ~0.125s, ALSO feeds the
 * continuous vitality-mod/aura-pulse uniforms below — untouched) chases its
 * own REFERENCE EMA (this.bassSlowE) at BASS_ONSET_EMA_RATE.
 *
 * Pre-fix defect: the reference ran at rate 1.5 (tau ~0.67s), only ~5.3x
 * slower than the fast EMA, and the fire test was an ABSOLUTE gap
 * (`bassE - bassSlowE > ONSET_THRESHOLD`). At musical tempos the reference
 * tracked the beat envelope almost as closely as the fast EMA, so the gap
 * collapsed and onsets only fired during the cold-start transient (both
 * EMAs climbing from 0) — measured as 2 fires in the first 10s of a
 * synthetic 120bpm bass line, then exactly 0 for the remaining ~80s+.
 *
 * Fix: slow the reference to BASS_ONSET_EMA_RATE (32x ratio) so per-beat
 * peaks actually stand out against the passage average, replace the
 * absolute gap with a RELATIVE threshold (`bassE > bassSlowE * (1 +
 * BASS_ONSET_REL_MARGIN)`) so it works at any playback level, gated by a
 * small absolute floor (BASS_ONSET_ABS_FLOOR) so silence/noise never
 * triggers, and add a rising-edge requirement (`bassE > prevBassE`) so it
 * fires on attacks, not anywhere on a sustained plateau.
 *
 * BASS_ONSET_REL_MARGIN measured down from b3's own 0.22 (started there per
 * the fix's own instructions, then tuned by measurement, as directed):
 * bassE's fast EMA (rate 8, tau ~0.125s, shared with the continuous
 * vitality-mod/aura-pulse uniforms — can't be changed independently) only
 * reaches ~1.106x its own converged steady-state average against the
 * verification harness's synthetic 120bpm kick (`0.42 + 0.40 *
 * exp(-((t*2)%1)*9)`, an effective ~56ms decay — much narrower than the
 * fast EMA's own tau, so it undershoots the spike badly). b3's 0.22 margin
 * (22%) sits well above that ~10.6% ceiling and never fires once the
 * reference converges — measured directly (a standalone EMA simulation
 * against the exact verification formula) rather than assumed.
 *
 * Round 2 (density-vs-composition fix): once each downstream EFFECT got its
 * own cooldown derived from the act's own rate (scanOnsetCooldown/
 * linkOnsetCooldown, see their doc), the RAW detection rate no longer sets
 * visible event density — so it can afford to sit further from the noise
 * floor for cleaner attack-only discrimination. Re-measured at 0.08 (vs the
 * round-1 0.05): still comfortably below the ~10.6% ceiling (~25% safety
 * margin) and confirmed to fire continuously across the full verification
 * run, so raised back up.
 */
const BASS_ONSET_EMA_RATE = 0.25;
const BASS_ONSET_REL_MARGIN = 0.08;
const BASS_ONSET_ABS_FLOOR = 0.06;
const ONSET_COOLDOWN = 0.5;

/**
 * High-band onset detector (glyph ticks + grid line-runners — high's fast
 * job): same album-audit fix as the bass detector above, transplanted from
 * b3's crackle detector (CRACKLE_ONSET_* there) — this.highE (fast EMA,
 * rate 8, ALSO feeds uSparkle below — untouched) chases its own REFERENCE
 * EMA (this.highSlowE) at HIGH_ONSET_EMA_RATE, relative margin + absolute
 * floor + rising edge. Pre-fix: reference at rate 1.5, absolute-gap test —
 * measured as 5 fires in the first 10s, then exactly 0 for the rest of the
 * track. The high band sits at a lower absolute level than bass in
 * practice, so its margin/floor started from b3's own crackle values, then
 * measured down the same way as BASS_ONSET_REL_MARGIN above: against the
 * verification harness's synthetic kick, highE's steady-state peak/average
 * ratio is only ~1.09x (~9%) — b3's 0.16 margin never fires past warmup for
 * the same reason bass's 0.22 didn't.
 *
 * Round 2 (density-vs-composition fix): same reasoning as
 * BASS_ONSET_REL_MARGIN above — runnerOnsetCooldown now separately governs
 * visible runner density, so the raw margin was re-measured and raised from
 * the round-1 0.04 to 0.06 (still ~33% below the ~9% ceiling, confirmed to
 * fire continuously across the full verification run).
 */
const HIGH_ONSET_EMA_RATE = 0.25;
const HIGH_ONSET_REL_MARGIN = 0.06;
const HIGH_ONSET_ABS_FLOOR = 0.05;
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

/**
 * Link-strike events (act 5's "connects and collides" hit): the machine
 * races a line from a source specimen A to a target B, then strikes B out
 * with an X. LINK_LINE_END is when the racing head reaches B (and the scan
 * stamp/flash fire); LINK_LIFETIME is full fade-out (matches the shader's
 * fade window, see catalogueShader.ts's link-strike block).
 */
const LINK_SLOTS = 3;
const LINK_LINE_END = 0.35;
const LINK_LIFETIME = 1.6;
/** `?link=always` debug affordance interval (seconds). */
const DEBUG_LINK_INTERVAL = 1.6;

/**
 * Kill zones (round-4 "strikes KILL instantly" note): a link strike doesn't
 * just visually X-out its target, it annihilates the specimen — the kill
 * zone pins that field-uv point dead for KILL_HOLD seconds (long enough the
 * lifecycle epoch has usually moved on, so the specimen "returns" elsewhere
 * if at all; see catalogueShader.ts's killEnv/specimenSd). Fired from
 * ageLinks at the same moment the strike scan fires.
 */
const KILL_SLOTS = 4;
const KILL_HOLD = 8.0;
/** `?kill=always` debug affordance interval (seconds). */
const DEBUG_KILL_INTERVAL = 2.0;

/** Grid line-runner pulses (act 5): a bright head races the full length of one grid line. */
const RUNNER_SLOTS = 4;
const RUNNER_LIFETIME = 0.5;
/** `?run=always` debug affordance interval (seconds). */
const DEBUG_RUN_INTERVAL = 0.7;

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
 * Beat-pop colour-restore envelope (uBeatFlash): kicked straight to 1 at
 * every site that increments `beatCount` (the bass-onset detector fire and
 * the ambient Poisson scan in scheduleScans), then decays exponentially —
 * feeds the shader's hash-picked ~28% subset of specimens that flashes back
 * to full vivid colour on each beat, so the climax's monochrome breaks
 * rhythmically instead of sitting unbroken. uBeatCount rotating on the same
 * beats is what rotates the selected subset.
 */
const BEAT_FLASH_DECAY = 2.8;
/** `?pop=always` debug affordance interval (seconds) — also rotates uBeatCount so the flashed subset keeps changing. */
const DEBUG_POP_INTERVAL = 0.5;

/**
 * Living-grid background reactivity modes (uGridMode): 0 scatter (original
 * hashed per-cell membership), 1 row cascade, 2 ring pulse, 3 checker — see
 * catalogueShader.ts's fill-selection block. Rotates on a beat-gated timer
 * so the background's behavior visibly changes over the track, instead of
 * scattering the same way for 5.5 minutes.
 */
const GRID_MODE_COUNT = 4;
/** gridModeTimer reset range (seconds): counts down, then a switch goes PENDING and waits for the next bass onset (rule changes land on beats, at phrase-length intervals). */
const GRID_MODE_TIMER_MIN = 16;
const GRID_MODE_TIMER_JITTER = 8;
/** If no bass onset arrives this long after a switch goes pending, switch anyway (no-mic playback fallback). */
const GRID_MODE_PENDING_FALLBACK = 6;

/**
 * Scheduled global-effect interludes (uFxMode/uFxAmt, catalogueShader.ts):
 * every ~30s an episode runs for a few seconds, picking one of three
 * single-pass effects — soft-focus blur (0), echo trails (1), or pulse-warp
 * (2). The world is pure SDF, so each is cheap: blur widens the
 * fwidth-derived AA windows, echo adds a couple of extra silhouette taps
 * with a fixed lag offset, and warp bends the whole page's domain before
 * the specimen search. No new framebuffers. `?fx=<0-2>` pins a fixed mode
 * at full (un-enveloped) strength for review.
 */
const FX_GAP_MEAN = 14;
const FX_GAP_MIN = 8;
const FX_DURATION_MIN = 5;
const FX_DURATION_JITTER = 3;
const FX_MODES = 3;

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

interface LinkSlot {
  age: number;
  active: boolean;
  /** Set once the racing head has reached B and the strike scan/flash have fired (edge-triggered, so it only fires once per link). */
  struck: boolean;
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
 * `?link=always` forces a steady link-strike stream (source -> target racing
 * line + X strike), `?run=always` forces a steady grid line-runner stream,
 * `?flicker=always` pins the outro's final-flicker envelope on,
 * `?classified=<0..1>` pins the classified ratchet, `?life=fast` speeds up
 * the specimen appear/disappear lifecycle clock, `?order=<0..1>` pins the
 * scatter->drawer-rows envelope, `?kill=always` forces a steady kill-zone
 * stream at random visible points, `?gridmode=<0-3>` pins the living-grid
 * background's fill-selection mode (0 scatter / 1 row cascade / 2 ring
 * pulse / 3 checker) and disables its beat-gated rotation, `?aura=always`
 * pins the act-4 ambient aura rings on, `?fx=<0-2>` pins the scheduled
 * global-effect interlude (0 soft-focus blur / 1 echo trails / 2 pulse-warp)
 * to a fixed mode at full un-enveloped strength and disables its own timer,
 * `?pop=always` forces a steady beat-pop colour-restore stream (kicks
 * uBeatFlash to 1 and rotates the flashed subset every 0.5s regardless of
 * audio), plus the standard `?t=`, `?q=`, `?debug=1`.
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
  private forceLinkAlways = false;
  private forceRunAlways = false;
  private forceLifeFast = false;
  private forceKillAlways = false;
  private forceAuraAlways = false;
  private forcePopAlways = false;
  private pinnedClassified: number | null = null;
  private pinnedOrder: number | null = null;
  private pinnedGridMode: number | null = null;

  /** Living-grid background reactivity mode (0-3, see GRID_MODE_COUNT's doc) — starts at scatter (0). */
  private gridMode = 0;
  /** Countdown to the next mode-switch going pending; reset to GRID_MODE_TIMER_MIN + rand*GRID_MODE_TIMER_JITTER on init and after every switch. */
  private gridModeTimer = 0;
  /** True once the timer has expired — waiting for the next bass onset (or the no-mic fallback) to actually flip the mode. */
  private gridModePending = false;
  /** Seconds elapsed since gridModePending went true — drives the no-mic fallback switch. */
  private gridModePendingElapsed = 0;

  /**
   * Scheduled global-effect interlude (soft-focus blur / echo trails /
   * pulse-warp, see the FX_ constants' doc) — fxMode picks which of the 3
   * effects the current/next episode uses; fxTimeToNext is randomized
   * properly in init() (this.rand isn't seeded until then — mirrors
   * gridModeTimer's own pattern).
   */
  private fxMode = 0;
  private fxActive = false;
  private fxAge = 0;
  private fxDuration = 0;
  private fxTimeToNext = 0;
  /** `?fx=<0|1|2>` pins a fixed mode at full (un-enveloped) strength and disables the episode scheduler entirely. */
  private pinnedFx: number | null = null;

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
  /**
   * Per-EFFECT onset cooldowns (density-vs-composition fix, see the
   * BASS_ONSET_ and HIGH_ONSET_ constants' doc): the raw bass/high onset
   * detection above is debounced only by onsetCooldown/highOnsetCooldown
   * (a fixed floor, matching real kick timing), but each downstream effect
   * — scan, link, runner — additionally needs its OWN cooldown so its
   * FIRE RATE follows the act's own scanRate/linkRate/runnerRate rather
   * than firing on every recognized beat. Set to `max(floor, 60/actRate)`
   * on every fire (the b3 onsetCooldownGap idiom), decremented every frame
   * regardless of whether the raw onset condition triggered that frame.
   */
  private scanOnsetCooldown = 0;
  private linkOnsetCooldown = 0;
  private runnerOnsetCooldown = 0;
  private flash = 0;
  /** Beat pulse (bass onsets -> uLifeClock accelerant): kick+decay scalar, tripled weight while hot. */
  private beatPulse = 0;
  /** CPU-accumulated specimen lifecycle clock (epochs) — feeds uLifeClock; advances by lifeRate * beat-multiplier each frame. */
  private lifeClock = 0;
  /** Running beat counter (bass onsets + ambient Poisson scans, so no-mic playback still ticks) — feeds uBeatCount, the living grid background's re-roll phase. */
  private beatCount = 0;
  /** Beat-pop colour-restore envelope (bass onsets + ambient scans): kicked to 1 on every beatCount increment, decays exponentially — feeds uBeatFlash. */
  private beatFlash = 0;
  /** Fast spark channel (high onsets -> glyph ticks): kick+decay scalar + per-event re-roll counter. */
  private spark = 0;
  private sparkSeed = 0;
  private sparkDebugTimer = 0;

  /** Classification-scan reticle pool: parallel CPU age/state + preallocated display Vector4s (index-aligned with field.stamps, the sim-side effect). */
  private scanSlots: ScanSlot[] = [];
  private scanA: THREE.Vector4[] = [];
  private scanB: THREE.Vector4[] = [];
  private scanTimeToNext = 0;
  /** The scanRate (events/min) the CURRENT scanTimeToNext was scheduled/rescaled against, 0 when unarmed — album-audit Bug A fix, see scheduleScans' own doc. */
  private scanScheduleRate = 0;
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

  /** Link-strike pool: parallel CPU age/state + preallocated display Vector4s (bound as uLinkA/uLinkB). */
  private linkSlots: LinkSlot[] = [];
  private linkA: THREE.Vector4[] = [];
  private linkB: THREE.Vector4[] = [];
  private linkTimeToNext = 0;
  /** The linkRate (events/min) the CURRENT linkTimeToNext was scheduled/rescaled against, 0 when unarmed — album-audit Bug A fix, see scheduleLinks' own doc. */
  private linkScheduleRate = 0;
  private linkDebugTimer = 0;
  /** Alternates the bass-onset branch between the wave start and a link fire (even -> wave, odd -> link). */
  private onsetCount = 0;

  /** Grid line-runner pool: parallel CPU age/state + preallocated display Vector4s (bound as uRunner). */
  private runnerSlots: AgeSlot[] = [];
  private runnerValues: THREE.Vector4[] = [];
  private runnerTimeToNext = 0;
  /** The runnerRate (events/min) the CURRENT runnerTimeToNext was scheduled/rescaled against, 0 when unarmed — album-audit Bug A fix, see scheduleRunners' own doc. */
  private runnerScheduleRate = 0;
  private runDebugTimer = 0;

  /** Kill-zone pool: parallel CPU age/state + preallocated display Vector4s (bound as uKill) — an instant-death strike location, fired from ageLinks. */
  private killSlots: AgeSlot[] = [];
  private killValues: THREE.Vector4[] = [];
  private killDebugTimer = 0;
  /** `?pop=always` debug affordance timer (seconds to next forced beat-pop). */
  private popDebugTimer = 0;

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
    this.forceLinkAlways = params.get('link') === 'always';
    this.forceRunAlways = params.get('run') === 'always';
    this.forceLifeFast = params.get('life') === 'fast';
    this.forceKillAlways = params.get('kill') === 'always';
    this.forcePopAlways = params.get('pop') === 'always';
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
    const gridModeParam = params.get('gridmode');
    if (gridModeParam !== null) {
      const v = parseInt(gridModeParam, 10);
      if (!Number.isNaN(v) && v >= 0 && v < GRID_MODE_COUNT) this.pinnedGridMode = v;
    }
    this.forceAuraAlways = params.get('aura') === 'always';
    const fxParam = params.get('fx');
    if (fxParam !== null) {
      const v = parseInt(fxParam, 10);
      if (!Number.isNaN(v) && v >= 0 && v < FX_MODES) this.pinnedFx = v;
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
    for (let i = 0; i < LINK_SLOTS; i++) {
      this.linkSlots.push({ age: 0, active: false, struck: false });
      this.linkA.push(new THREE.Vector4(0, 0, 0, 0));
      this.linkB.push(new THREE.Vector4(0, 0, 0, 0));
    }
    for (let i = 0; i < RUNNER_SLOTS; i++) {
      this.runnerSlots.push({ age: 0, active: false });
      this.runnerValues.push(new THREE.Vector4(0, 0, 0, 0));
    }
    for (let i = 0; i < KILL_SLOTS; i++) {
      this.killSlots.push({ age: 0, active: false });
      this.killValues.push(new THREE.Vector4(0, 0, 0, 0));
    }

    this.breathPhase = this.rand() * Math.PI * 2;

    // Grid-mode rotation: starts at scatter (0, the field default) unless
    // pinned via ?gridmode=; the timer is randomized regardless (harmless
    // when pinned — the pinned branch in update() never reads it).
    if (this.pinnedGridMode !== null) this.gridMode = this.pinnedGridMode;
    this.gridModeTimer = GRID_MODE_TIMER_MIN + this.rand() * GRID_MODE_TIMER_JITTER;
    this.fxTimeToNext = FX_GAP_MIN + this.rand() * FX_GAP_MEAN;

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
        uEventVivid: { value: 0 },
        uLinkA: { value: this.linkA },
        uLinkB: { value: this.linkB },
        uRunner: { value: this.runnerValues },
        uKill: { value: this.killValues },
        uBeatCount: { value: 0 },
        uBeatFlash: { value: 0 },
        uBeatPop: { value: 0 },
        uGridLife: { value: 0 },
        uGridMode: { value: 0 },
        uAura: { value: 0 },
        uAuraPulse: { value: 0 },
        uFxMode: { value: 0 },
        uFxAmt: { value: 0 },
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

  /**
   * Advances the living-grid background to a random DIFFERENT reactivity
   * mode and resets the rotation timer. Called either from a bass onset
   * while a switch is pending (rule changes land on beats, at phrase-length
   * intervals) or as the no-mic fallback once gridModePending has been true
   * for GRID_MODE_PENDING_FALLBACK seconds. No-op when `?gridmode=` pins a
   * fixed mode (update() also guards the timer countdown in that case, so
   * this is a belt-and-suspenders check).
   */
  private advanceGridMode() {
    if (this.pinnedGridMode !== null) return;
    let next = this.gridMode;
    while (next === this.gridMode) next = Math.floor(this.rand() * GRID_MODE_COUNT);
    this.gridMode = next;
    this.gridModeTimer = GRID_MODE_TIMER_MIN + this.rand() * GRID_MODE_TIMER_JITTER;
    this.gridModePending = false;
    this.gridModePendingElapsed = 0;
  }

  /**
   * Scheduled global-effect interlude scheduler (soft-focus blur / echo
   * trails / pulse-warp — see the FX_ constants' doc): while inactive,
   * counts down to the next episode; once one starts, ages it through a
   * 0.9s ease-in / 1.2s ease-out envelope (reusing the class's own `sst`)
   * and writes uFxMode/uFxAmt. `?fx=` pins a fixed mode at full strength
   * and bypasses the scheduler entirely.
   */
  private updateFx(dt: number, p: ActParams) {
    const u = this.material.uniforms;
    if (this.pinnedFx !== null) {
      u.uFxMode.value = this.pinnedFx;
      u.uFxAmt.value = p.fxAmount;
      return;
    }
    if (!this.fxActive) {
      this.fxTimeToNext -= dt;
      if (this.fxTimeToNext <= 0) {
        this.fxActive = true;
        this.fxAge = 0;
        this.fxDuration = FX_DURATION_MIN + this.rand() * FX_DURATION_JITTER;
        let next = this.fxMode;
        while (next === this.fxMode) next = Math.floor(this.rand() * FX_MODES);
        this.fxMode = next;
      }
    }
    if (this.fxActive) {
      this.fxAge += dt;
      const envIn = this.sst(Math.min(1, this.fxAge / 0.9));
      const envOut = 1 - this.sst(Math.max(0, (this.fxAge - (this.fxDuration - 1.2)) / 1.2));
      u.uFxAmt.value = envIn * envOut * p.fxAmount;
      if (this.fxAge >= this.fxDuration) {
        this.fxActive = false;
        this.fxTimeToNext = FX_GAP_MIN + this.rand() * FX_GAP_MEAN;
      }
    } else {
      u.uFxAmt.value = 0;
    }
    u.uFxMode.value = this.fxMode;
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
   * Picks a screen-visible raw (UN-wrapped) field-uv point: the offset is
   * generated in pre-pan/zoom screen space and only then mapped into
   * field-uv via the house screen->field formula. In the survivor-focus act,
   * resample (up to 4 tries) until the raw offset clears the spotlight
   * radius so nothing lands inside it. Shared by fireScan (which wraps the
   * result into [0,1)) and fireLink (which keeps both endpoints unwrapped so
   * the shader's link-line math, deliberately non-torus, never crosses the
   * seam between them).
   */
  private pickVisiblePoint(p: ActParams): { x: number; y: number } {
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
    const x = 0.5 + this.pan.x + (ox * cover.x) / zoom;
    const y = 0.5 + this.pan.y + (oy * cover.y) / zoom;
    return { x, y };
  }

  /** Picks a screen-visible scan target and fires it (wraps into [0,1) — scans DO torus-wrap). */
  private fireScan(p: ActParams) {
    const { x, y } = this.pickVisiblePoint(p);
    this.startScan(x - Math.floor(x), y - Math.floor(y), p);
  }

  /**
   * Poisson ambient scans (a3's scheduleIgnitions shape): each one also
   * nudges the ambient flash channel — a scene that's quietly cataloguing
   * itself even between onsets — and ticks beatCount (the living grid
   * background's clock), so no-mic playback still moves.
   *
   * Album-audit Bug A fix (transplanted from b3-sterile-breath's
   * increment-11 fix — see its strikeScheduleRate doc for the full
   * postmortem): ratePerMinute comes from the crossfaded act params
   * (paramsAt's 6s blend), so at the 56s boundary (scanRate 0 -> 5) the
   * blended rate passes through ~2.3e-5 on the first frame. The OLD `if
   * (rate <= 0) return;` early-return froze scanTimeToNext at exactly 0
   * (its init value) while rate was 0, so the first frame with rate > 0
   * fired immediately (correct) and then baked its NEXT delay
   * (-log(u)/rate) against that near-zero rate — order 1e5 seconds,
   * effectively never. Measured: 0 scans after ~50s for the rest of the
   * 337s track, killing beatCount/beatFlash (the living-grid background's
   * clock) along with the scan channel itself.
   *
   * Fix: track the rate the CURRENT scanTimeToNext was baked against
   * (scanScheduleRate) and rescale the countdown every time the effective
   * rate changes (`timeToNext *= oldRate/newRate`, the quantile-preserving
   * rescale for an Exponential under a rate change) — the "due now" fire on
   * arrival still happens, but the delay it schedules keeps shrinking in
   * step with the crossfade instead of freezing. scanScheduleRate resets to
   * 0 whenever rate turns off.
   *
   * Round-2 gap (found via the density-fix harness on the link/runner
   * channels, which — unlike scan — cycle on/off/on more than once across
   * the act table): reactivating from a genuine OFF period
   * (scanScheduleRate already 0, not merely a crossfade epsilon) skipped
   * the rescale branch entirely, so a stale timeToNext left over from
   * BEFORE the channel went quiet — occasionally a large one, up to the
   * MAX_POISSON_GAP_SECONDS clamp itself, from an unlucky exponential tail
   * draw — got reused verbatim instead of firing due-now. Measured on
   * linkRate's 0(act3)->14(act4) re-arm: a ~90s stale countdown survived
   * the entire 60s OFF span and then ate a big chunk of the NEXT on-period
   * too, silencing the Poisson channel through most of the album-max act.
   * Fixed below: reactivating from scheduleRate<=0 forces timeToNext to 0
   * (the same "due now" a genuine first-ever activation gets), never
   * resumes a leftover value.
   */
  private scheduleScans(dt: number, ratePerMinute: number, p: ActParams) {
    const rate = Math.max(0, ratePerMinute);
    if (rate <= 0) {
      this.scanScheduleRate = 0;
      return;
    }
    if (this.scanScheduleRate > 0 && this.scanTimeToNext > 0) {
      this.scanTimeToNext = Math.min(
        MAX_POISSON_GAP_SECONDS,
        this.scanTimeToNext * (this.scanScheduleRate / rate),
      );
    } else if (this.scanScheduleRate <= 0) {
      this.scanTimeToNext = 0;
    }
    this.scanScheduleRate = rate;
    this.scanTimeToNext -= dt;
    while (this.scanTimeToNext <= 0) {
      this.fireScan(p);
      this.kickFlash(FLASH_KICK_AMBIENT);
      this.beatCount++;
      this.beatFlash = 1;
      this.scanTimeToNext += poissonDelay(this.rand, rate);
      this.scanScheduleRate = rate;
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

  /**
   * Fires one link-strike: A is a screen-visible point (fireScan's own
   * target-picking), B is a second independent visible point, retried once
   * if the pair lands further than 0.35 apart in field-uv (else clamped
   * toward A at 0.35) so the racing line never has to cross the whole
   * screen. Both stay UN-wrapped (the shader's link-line math is
   * deliberately non-torus) — only the eventual strike scan (in ageLinks,
   * once the head reaches B) gets wrapped into [0,1).
   */
  private fireLink(p: ActParams) {
    let idx = this.linkSlots.findIndex((s) => !s.active);
    if (idx < 0) {
      idx = 0;
      let maxAge = this.linkSlots[0].age;
      for (let i = 1; i < this.linkSlots.length; i++) {
        if (this.linkSlots[i].age > maxAge) {
          maxAge = this.linkSlots[i].age;
          idx = i;
        }
      }
    }
    const a = this.pickVisiblePoint(p);
    let b = this.pickVisiblePoint(p);
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    if (Math.hypot(dx, dy) > 0.35) {
      b = this.pickVisiblePoint(p);
      dx = b.x - a.x;
      dy = b.y - a.y;
    }
    const dist = Math.hypot(dx, dy);
    if (dist > 0.35) {
      const k = 0.35 / dist;
      b = { x: a.x + dx * k, y: a.y + dy * k };
    }
    const slot = this.linkSlots[idx];
    slot.active = true;
    slot.struck = false;
    slot.age = 0;
    this.linkA[idx].set(a.x, a.y, 0, 1);
    this.linkB[idx].set(b.x, b.y, this.rand(), 0);
  }

  /**
   * Poisson-scheduled link-strike events (act 5 mainly — other acts pass 0).
   *
   * Album-audit Bug A fix (same defect, same cure as scheduleScans above —
   * see its doc for the full postmortem): linkRate crosses 0 -> 2 at the
   * 128s boundary through the crossfade blend, so the pre-fix code baked a
   * ~9.0e5s delay against the near-zero first-frame rate and killed the
   * link-strike channel for the rest of the track, including the act-4
   * climax (linkRate: 14). Fixed by rescaling linkTimeToNext against
   * linkScheduleRate whenever the effective rate changes.
   *
   * Round-2 gap (see scheduleScans' own doc for the full writeup): linkRate
   * is 0 in act3 (last-unclassified) between its two nonzero spans — act2's
   * 2/min and act4's 14/min — so it cycles on/off/on, unlike scan's single
   * on-period. Reactivating from a genuine OFF period (linkScheduleRate
   * already 0) now forces timeToNext to 0 instead of resuming a stale,
   * occasionally clamp-sized leftover from the PREVIOUS on-period — this is
   * what silenced the Poisson link channel through most of act 4 even after
   * the round-1 rescale fix.
   */
  private scheduleLinks(dt: number, ratePerMinute: number, p: ActParams) {
    const rate = Math.max(0, ratePerMinute);
    if (rate <= 0) {
      this.linkScheduleRate = 0;
      return;
    }
    if (this.linkScheduleRate > 0 && this.linkTimeToNext > 0) {
      this.linkTimeToNext = Math.min(
        MAX_POISSON_GAP_SECONDS,
        this.linkTimeToNext * (this.linkScheduleRate / rate),
      );
    } else if (this.linkScheduleRate <= 0) {
      this.linkTimeToNext = 0;
    }
    this.linkScheduleRate = rate;
    this.linkTimeToNext -= dt;
    while (this.linkTimeToNext <= 0) {
      this.fireLink(p);
      this.linkTimeToNext += poissonDelay(this.rand, rate);
      this.linkScheduleRate = rate;
    }
  }

  /** Ages every active link slot: writes the shared display age; once age crosses LINK_LINE_END (the racing head reaching B) fires the strike scan at B (wrapped) + a kill zone at that same point + a flash, exactly once per link; deactivates at LINK_LIFETIME. */
  private ageLinks(dt: number, p: ActParams) {
    for (let i = 0; i < this.linkSlots.length; i++) {
      const slot = this.linkSlots[i];
      if (!slot.active) continue;
      const prevAge = slot.age;
      slot.age += dt;
      const age = slot.age;
      this.linkA[i].z = age;
      if (!slot.struck && prevAge < LINK_LINE_END && age >= LINK_LINE_END) {
        slot.struck = true;
        const bx = this.linkB[i].x;
        const by = this.linkB[i].y;
        const wx = bx - Math.floor(bx);
        const wy = by - Math.floor(by);
        this.startScan(wx, wy, p);
        this.fireKill(wx, wy);
        this.kickFlash(FLASH_KICK_ONSET);
      }
      if (age >= LINK_LIFETIME) {
        slot.active = false;
        this.linkA[i].w = 0;
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

  /** Fires one grid line-runner: a random axis (0 horizontal / 1 vertical) and a coordinate uniform across the visible grid span in that axis's cross-direction (screen-space `gv`, matching the shader's uCover-scaled grid). */
  private fireRunner() {
    let idx = this.runnerSlots.findIndex((s) => !s.active);
    if (idx < 0) {
      idx = 0;
      let maxAge = this.runnerSlots[0].age;
      for (let i = 1; i < this.runnerSlots.length; i++) {
        if (this.runnerSlots[i].age > maxAge) {
          maxAge = this.runnerSlots[i].age;
          idx = i;
        }
      }
    }
    const cover = this.cover;
    const axis = this.rand() < 0.5 ? 0 : 1;
    const c = axis === 0 ? (this.rand() - 0.5) * cover.y : (this.rand() - 0.5) * cover.x;
    const slot = this.runnerSlots[idx];
    slot.active = true;
    slot.age = 0;
    this.runnerValues[idx].set(axis, c, 0, 1);
  }

  /** Ages every active runner slot, deactivating at RUNNER_LIFETIME. */
  private ageRunners(dt: number) {
    for (let i = 0; i < this.runnerSlots.length; i++) {
      const slot = this.runnerSlots[i];
      if (!slot.active) continue;
      slot.age += dt;
      if (slot.age >= RUNNER_LIFETIME) {
        slot.active = false;
        this.runnerValues[i].w = 0;
      } else {
        this.runnerValues[i].z = slot.age;
      }
    }
  }

  /**
   * Poisson-scheduled grid line-runners (act 5 mainly — other acts pass 0).
   *
   * Album-audit Bug A fix (same defect, same cure as scheduleScans above —
   * see its doc for the full postmortem): runnerRate crosses 0 -> 4 at the
   * 128s boundary through the crossfade blend, so the pre-fix code baked a
   * ~4.5e5s delay against the near-zero first-frame rate and killed the
   * Poisson grid-runner channel for the rest of the track. Fixed by
   * rescaling runnerTimeToNext against runnerScheduleRate whenever the
   * effective rate changes.
   *
   * Round-2 gap (see scheduleScans' own doc for the full writeup):
   * runnerRate is 0 in act1 and act3, nonzero in act2 (4/min) and act4
   * (22/min) — on/off/on, same as linkRate. Reactivating from a genuine OFF
   * period (runnerScheduleRate already 0) now forces timeToNext to 0
   * instead of resuming a stale leftover from the PREVIOUS on-period.
   */
  private scheduleRunners(dt: number, ratePerMinute: number) {
    const rate = Math.max(0, ratePerMinute);
    if (rate <= 0) {
      this.runnerScheduleRate = 0;
      return;
    }
    if (this.runnerScheduleRate > 0 && this.runnerTimeToNext > 0) {
      this.runnerTimeToNext = Math.min(
        MAX_POISSON_GAP_SECONDS,
        this.runnerTimeToNext * (this.runnerScheduleRate / rate),
      );
    } else if (this.runnerScheduleRate <= 0) {
      this.runnerTimeToNext = 0;
    }
    this.runnerScheduleRate = rate;
    this.runnerTimeToNext -= dt;
    while (this.runnerTimeToNext <= 0) {
      this.fireRunner();
      this.runnerTimeToNext += poissonDelay(this.rand, rate);
      this.runnerScheduleRate = rate;
    }
  }

  /** Activates one kill-zone slot at field-uv (x,y) (already wrapped [0,1)) — an instant-death strike location; picks a free slot or else the oldest. */
  private fireKill(x: number, y: number) {
    let idx = this.killSlots.findIndex((s) => !s.active);
    if (idx < 0) {
      idx = 0;
      let maxAge = this.killSlots[0].age;
      for (let i = 1; i < this.killSlots.length; i++) {
        if (this.killSlots[i].age > maxAge) {
          maxAge = this.killSlots[i].age;
          idx = i;
        }
      }
    }
    const slot = this.killSlots[idx];
    slot.active = true;
    slot.age = 0;
    this.killValues[idx].set(x, y, 0, 1);
  }

  /** Ages every active kill slot: writes the shared display age, deactivating at KILL_HOLD (long enough the lifecycle epoch has usually moved on, so a struck specimen "returns" elsewhere if at all — see catalogueShader.ts's killEnv). */
  private ageKills(dt: number) {
    for (let i = 0; i < this.killSlots.length; i++) {
      const slot = this.killSlots[i];
      if (!slot.active) continue;
      slot.age += dt;
      if (slot.age >= KILL_HOLD) {
        slot.active = false;
        this.killValues[i].w = 0;
      } else {
        this.killValues[i].z = slot.age;
      }
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
    // prevBassE/prevHighE captured BEFORE this frame's EMA update — the
    // onset detectors below need the pre-update fast-EMA value for their
    // rising-edge test.
    const prevBassE = this.bassE;
    const prevHighE = this.highE;
    const k = Math.min(1, dt * 8);
    this.bassE += (audio.bass - this.bassE) * k;
    this.midE += (audio.mid - this.midE) * k;
    this.highE += (audio.high - this.highE) * k;
    // Onset reference EMAs (album-audit fix — see BASS_ONSET_*/HIGH_ONSET_*
    // constants' doc for the postmortem): each chases its own FAST EMA
    // (bassE/highE, already updated above), not the raw audio band — the
    // b3-transplanted recipe — at the much slower BASS_ONSET_EMA_RATE /
    // HIGH_ONSET_EMA_RATE (was the shared, too-fast rate 1.5).
    this.bassSlowE += (this.bassE - this.bassSlowE) * Math.min(1, dt * BASS_ONSET_EMA_RATE);
    this.highSlowE += (this.highE - this.highSlowE) * Math.min(1, dt * HIGH_ONSET_EMA_RATE);

    // Bass-onset detector (album-audit fix — see BASS_ONSET_* constants' doc
    // for the postmortem): fires on a RISING edge (bassE > prevBassE) once
    // bassE clears both a relative margin over its reference EMA and an
    // absolute floor. onsetCooldown debounces the RAW detection only (so
    // "a beat was felt" — beatCount/beatFlash/beatPulse/grid-mode-advance —
    // still tracks real kick timing at up to 1/ONSET_COOLDOWN); each
    // downstream EFFECT (scan, then the act-4 wave/link alternation) is
    // separately gated by its own cooldown derived from the act's own
    // scanRate/linkRate (scanOnsetCooldown/linkOnsetCooldown, the b3
    // onsetCooldownGap idiom — see their own doc) so FIRE RATE follows the
    // composition even though every beat is still detected. Without this
    // split, mic-path scan/link counts ran ~6x the no-mic Poisson totals
    // (every felt beat fired a scan wherever scanRate was merely nonzero) —
    // measured on the album audit's own harness.
    this.onsetCooldown -= dt;
    this.scanOnsetCooldown -= dt;
    this.linkOnsetCooldown -= dt;
    if (
      this.onsetCooldown <= 0 &&
      this.bassE > prevBassE &&
      this.bassE > BASS_ONSET_ABS_FLOOR &&
      this.bassE > this.bassSlowE * (1 + BASS_ONSET_REL_MARGIN)
    ) {
      this.onsetCooldown = ONSET_COOLDOWN;
      if (this.scanOnsetCooldown <= 0 && p.scanRate > 0.5) {
        this.fireScan(p);
        this.kickFlash(FLASH_KICK_ONSET);
        this.scanOnsetCooldown = Math.max(ONSET_COOLDOWN, 60 / p.scanRate);
      }
      this.beatCount++;
      this.beatFlash = 1;
      this.onsetCount++;
      if (this.onsetCount % 2 === 0) {
        if (section.actIndex === 4 && !this.waveActive) this.startWave();
      } else if (this.linkOnsetCooldown <= 0 && p.linkRate > 0.5) {
        this.fireLink(p);
        this.linkOnsetCooldown = Math.max(ONSET_COOLDOWN, 60 / p.linkRate);
      }
      this.beatPulse = Math.min(BEAT_PULSE_CEILING, this.beatPulse + BEAT_PULSE_KICK);
      // A pending grid-mode switch lands on this beat (rule changes land at
      // phrase boundaries, not mid-phrase) — see GRID_MODE_PENDING_FALLBACK's
      // doc for the no-mic fallback that covers the case no onset arrives.
      if (this.gridModePending) this.advanceGridMode();
    }

    // High-onset detector (album-audit fix — see HIGH_ONSET_* constants' doc
    // for the postmortem): fires on a RISING edge (highE > prevHighE) once
    // highE clears both a relative margin over its reference EMA and an
    // absolute floor. Drives the fast spark channel (glyph ticks, ungated —
    // a decay scalar, not a rate-limited pool, so no density concern) + one
    // grid line-runner when the act calls for them (high's fast job).
    // Same split as the bass detector above: highOnsetCooldown debounces the
    // raw detection, runnerOnsetCooldown (derived from p.runnerRate)
    // separately throttles the runner fire rate to the composition.
    this.highOnsetCooldown -= dt;
    this.runnerOnsetCooldown -= dt;
    if (
      this.highOnsetCooldown <= 0 &&
      this.highE > prevHighE &&
      this.highE > HIGH_ONSET_ABS_FLOOR &&
      this.highE > this.highSlowE * (1 + HIGH_ONSET_REL_MARGIN)
    ) {
      this.highOnsetCooldown = HIGH_ONSET_COOLDOWN;
      this.kickSpark();
      if (this.runnerOnsetCooldown <= 0 && p.runnerRate > 0.5) {
        this.fireRunner();
        this.runnerOnsetCooldown = Math.max(HIGH_ONSET_COOLDOWN, 60 / p.runnerRate);
      }
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

    // Link-strike events: Poisson-schedule at p.linkRate/min, age the active
    // pool, plus the ?link=always affordance.
    this.scheduleLinks(dt, p.linkRate, p);
    this.ageLinks(dt, p);
    if (this.forceLinkAlways) {
      this.linkDebugTimer -= dt;
      if (this.linkDebugTimer <= 0) {
        this.fireLink(p);
        this.linkDebugTimer = DEBUG_LINK_INTERVAL;
      }
    }

    // Grid line-runners: Poisson-schedule at p.runnerRate/min, age the
    // active pool, plus the ?run=always affordance.
    this.scheduleRunners(dt, p.runnerRate);
    this.ageRunners(dt);
    if (this.forceRunAlways) {
      this.runDebugTimer -= dt;
      if (this.runDebugTimer <= 0) {
        this.fireRunner();
        this.runDebugTimer = DEBUG_RUN_INTERVAL;
      }
    }

    // Kill zones: aged here (normally fired from ageLinks, at the same
    // moment the strike scan fires), plus the ?kill=always affordance —
    // fires at random visible points via pickVisiblePoint, same idiom as
    // the other debug streams.
    this.ageKills(dt);
    if (this.forceKillAlways) {
      this.killDebugTimer -= dt;
      if (this.killDebugTimer <= 0) {
        const { x, y } = this.pickVisiblePoint(p);
        this.fireKill(x - Math.floor(x), y - Math.floor(y));
        this.killDebugTimer = DEBUG_KILL_INTERVAL;
      }
    }

    // `?pop=always` debug affordance: force a steady beat-pop colour-restore
    // stream regardless of audio — also increments beatCount so the
    // hash-picked subset keeps rotating, not just flashing the same one.
    if (this.forcePopAlways) {
      this.popDebugTimer -= dt;
      if (this.popDebugTimer <= 0) {
        this.beatFlash = 1;
        this.beatCount++;
        this.popDebugTimer = DEBUG_POP_INTERVAL;
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
    this.beatFlash *= Math.exp(-BEAT_FLASH_DECAY * dt);
    this.updateFx(dt, p);

    // Grid-mode rotation timer: counts down to a pending switch (actually
    // flipped on the next bass onset above, or by the no-mic fallback here
    // if none arrives in time). Disabled entirely when ?gridmode= pins a
    // fixed mode.
    if (this.pinnedGridMode === null) {
      this.gridModeTimer -= dt;
      if (this.gridModeTimer <= 0 && !this.gridModePending) {
        this.gridModePending = true;
        this.gridModePendingElapsed = 0;
      }
      if (this.gridModePending) {
        this.gridModePendingElapsed += dt;
        if (this.gridModePendingElapsed >= GRID_MODE_PENDING_FALLBACK) {
          this.advanceGridMode();
        }
      }
    }
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
    u.uEventVivid.value = p.eventVivid;
    u.uBeatCount.value = this.beatCount;
    u.uBeatFlash.value = this.beatFlash;
    u.uBeatPop.value = p.beatPop;
    u.uGridLife.value = p.gridLife;
    u.uGridMode.value = this.pinnedGridMode ?? this.gridMode;
    u.uAura.value = this.forceAuraAlways ? 1 : p.aura;
    u.uAuraPulse.value = this.bassE;
    // uWaveVis is bound by reference to this.field.wave (init()) — no
    // per-frame assignment needed, it's already mutated in place by
    // scheduleWaves()/startWave(). uLinkA/uLinkB/uRunner/uKill are likewise
    // bound by reference to this.linkA/this.linkB/this.runnerValues/
    // this.killValues (init()) — fireLink/ageLinks/fireRunner/ageRunners/
    // fireKill/ageKills mutate them in place.

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
