/**
 * "Terminal Taxonomy" — living micro-communities as discrete SPECIMENS on
 * pale bone catalogue paper, each with its own hue, Turing-like skin, and
 * unreadable glyph script (its "language"), progressively scanned, labeled,
 * and flattened into one uniform rust-toned machine catalogue. By the end,
 * only unclassifiable residue remains. Deliberately NOT a tiling cell
 * lattice (that geometry is a3's): specimens are organic ink-rimmed
 * silhouettes with paper between them, and `orderAt` drifts the page from
 * natural scatter to aligned museum-drawer rows as the catalogue wins.
 * Specimens are alive, not static stamps: on a beat-coupled lifecycle
 * (`presence`/`lifeRate`) they appear and disappear in new places, their
 * outlines wriggle (`wriggle`), and their anchors micro-wander (`drift`)
 * until the drawer files them still. The piece opens hero-close: zoomed on
 * one wriggling specimen, pulling back across the first ~40s to reveal the
 * whole living field.
 *
 * The signature element is a pair of GPU layers: the living specimen field
 * (per-community skin + procedural glyph script) and a classification-
 * reticle scan system that stamps each community, drains its vitality,
 * and — once classified — rewrites its script into one uniform machine
 * grammar. The classified ratchet only moves forward (`classifiedFloor`),
 * so the catalogue never un-labels a community; it only spreads.
 *
 * Staged by song position from the master's 4s RMS/band profile (336.998s):
 *
 *   0:00 thriving-field         — living patchwork at full vibrancy; no
 *                                  machine apparatus yet, every community
 *                                  speaking its own glyph language.
 *   0:56 first-scans             — faint grid fades in; sparse reticle scans
 *                                  land, most visibly WRONG here — half of
 *                                  them are visible misclassifications.
 *   2:08 accelerating-catalogue  — scan rate climbs, drained/labeled patches
 *                                  accumulate; t=168 lands a mass-scan
 *                                  cascade (bass-onset burst).
 *   2:52 last-unclassified       — restraint + scale shift: deep zoom onto
 *                                  the one surviving unclassified community,
 *                                  grid dimmed, near-mono spotlight outside
 *                                  it (the holdout still thriving).
 *   3:52 total-classification    — THE drop at t=232: grid slams to full
 *                                  strength, mass-classification ring waves
 *                                  sweep the field, rust ascendant, the
 *                                  album-max density hit exactly once.
 *   5:16 residue                 — power-down at t=316: the field bleaches
 *                                  toward pale bone catalogue paper, sparse
 *                                  unclassified motes drift, one last glyph
 *                                  flicker at t=330 — loop closure.
 *
 * Same machinery as a3-biome-dominoes: acts are parameter keyframes
 * crossfaded near each boundary (`paramsAt`, ~6s window, `localT` exposes
 * within-act progress), plus a continuous `energy` life-curve (`arcAt`) with
 * near-vertical steps at the scripted hits so those land as discrete state
 * changes, not crossfades. A second continuous envelope, `orderAt`, drives
 * the scatter -> drawer-rows morph independently of the act boundaries: it
 * stays flat through the opening, wakes across act 3, and — its real job —
 * assembles visibly across the whole of act 5, so the climax is watchable
 * as the drawer wins the page in real time, not a per-act snap.
 *
 * Audio map (each band one job, applied in index.ts / the field + reticle
 * shaders):
 *  - audio.time          -> act staging (the whole arc)
 *  - bass onsets         -> scan events; in act 5, alternating between
 *    mass-classification waves and link-strike events (specimen-to-specimen
 *    racing lines)
 *  - smoothed bass       -> living-field vitality / interior churn
 *  - smoothed mid        -> glyph chatter (re-roll rate) + palette warmth
 *  - smoothed high       -> scan-line sparkle
 *  - high onsets         -> glyph ticks + grid line-runner pulses
 *  - scripted hits        -> t=168 mass-scan cascade; t=232 THE drop (zoom
 *    snap + grid slam); t=316 power-down; t=330 final glyph flicker
 */

export interface ActParams {
  name: string;
  /** Baseline living-field vitality the sim regrows toward (0..1). */
  vitalityTarget: number;
  /** Organic pattern-motion amount inside communities (0..1). */
  churn: number;
  /** 0..1 fraction of specimens present per lifecycle epoch (appear/disappear in new places). */
  presence: number;
  /** Lifecycle epochs per second baseline (beat pulses accelerate it; higher = faster filing in/out). */
  lifeRate: number;
  /** 0..1 living-outline wriggle amplitude (edges thriving). */
  wriggle: number;
  /** 0..1 anchor micro-wander amount (specimens float; filed/ordered specimens stop). */
  drift: number;
  /** Baseline classification-scan events per minute (bass onsets add more). */
  scanRate: number;
  /** Vitality drain strength inside an active scan stamp (0..1). */
  scanDrain: number;
  /** Probability a scan is a visible MISclassification (wrong-hue label + glitch) (0..1). */
  misProb: number;
  /** Global classification creep per second, act 5 only (0..1). */
  classifyPressure: number;
  /** Mass-classification ring waves per minute, act 5 only. */
  waveRate: number;
  /** Link-strike events per minute (the machine connects two specimens with a racing line, then strikes one out; bass onsets add more). */
  linkRate: number;
  /** Grid line-runner pulses per minute (bright heads racing along grid lines; high onsets add more). */
  runnerRate: number;
  /** 0..1 how strongly events (waves, links, flashes) restore specimens' vivid pre-flattening color. */
  eventVivid: number;
  /** Machine grid overlay intensity (0..1). */
  gridStrength: number;
  /** Fine tick subdivision of the grid (0..1). */
  gridFine: number;
  /** Living glyph-script coverage inside communities (0..1). */
  glyphDensity: number;
  /** Glyph re-roll (writing) speed multiplier. */
  chatterRate: number;
  /** 0..1 fraction of script rendered as uniform machine code regardless of local classified state. */
  machineFrac: number;
  /** 0..1 monotonic floor for the classified ratchet (seeds the field on ?t= deep links). */
  classifiedFloor: number;
  /** Voronoi community frequency (cells across field space). */
  commFreq: number;
  /** Field-space zoom (>1 closer; act 4's deep zoom, act 5's pull-back). */
  zoom: number;
  /** 0..1 act-4 screen-centre spotlight (near-mono outside the last unclassified patch). */
  survivorFocus: number;
  /** 0..1 community hue saturation multiplier. */
  hueSat: number;
  /** 0..1 palette warmth lean. */
  warmth: number;
  /** 0..1 machine-rust grade mix (rust ascendant). */
  rustMix: number;
  /** 0..1 display opacity of accumulated archive ink. */
  inkPersist: number;
  /** Vignette strength (0..1). */
  vignette: number;
  /** 0..1 sparse unclassified drifting motes amount. */
  motes: number;
  /** 0..1 ground mix: 0 dark, 1 pale bone catalogue paper. */
  groundLight: number;
}

/** Boundary times in seconds, from the master's 4s RMS/band profile. Track duration: 336.998s. */
export const CUES = [0, 56, 128, 172, 232, 316, 336.998] as const;

export const ACTS: ActParams[] = [
  { // 1. Thriving field — the living patchwork at full vibrancy; no machine
    // apparatus yet. Vitality and churn near their global max, glyph-script
    // coverage dense, palette warm and saturated on the pale bone ground.
    name: 'thriving-field',
    vitalityTarget: 0.95, churn: 0.9,
    presence: 0.8, lifeRate: 0.10, wriggle: 1.0, drift: 1.0,
    scanRate: 0, scanDrain: 0, misProb: 0,
    classifyPressure: 0, waveRate: 0, linkRate: 0, runnerRate: 0, eventVivid: 0,
    gridStrength: 0, gridFine: 0,
    glyphDensity: 0.85, chatterRate: 1.2, machineFrac: 0, classifiedFloor: 0,
    commFreq: 6, zoom: 1.18, survivorFocus: 0,
    hueSat: 1.0, warmth: 0.55, rustMix: 0.05, inkPersist: 0,
    vignette: 0.3, motes: 0.15, groundLight: 0.9,
  },
  { // 2. First scans — a faint machine grid fades in; sparse reticle scans
    // land. This is where misclassification is most visible: nearly a third
    // of scans stamp the wrong hue and glitch.
    name: 'first-scans',
    vitalityTarget: 0.85, churn: 0.8,
    presence: 0.85, lifeRate: 0.12, wriggle: 0.8, drift: 0.8,
    scanRate: 5, scanDrain: 0.5, misProb: 0.3,
    classifyPressure: 0, waveRate: 0, linkRate: 0, runnerRate: 0, eventVivid: 0.3,
    gridStrength: 0.18, gridFine: 0.25,
    glyphDensity: 0.8, chatterRate: 1.0, machineFrac: 0.08, classifiedFloor: 0.06,
    commFreq: 6, zoom: 1.05, survivorFocus: 0,
    hueSat: 0.92, warmth: 0.5, rustMix: 0.15, inkPersist: 0.5,
    vignette: 0.32, motes: 0.08, groundLight: 0.9,
  },
  { // 3. Accelerating catalogue — scan rate climbs, drained/labeled patches
    // accumulate as visible scar tissue; t=168 lands a mass-scan cascade
    // (bass-onset burst). Grid firms up, archive ink starts to persist.
    name: 'accelerating-catalogue',
    vitalityTarget: 0.70, churn: 0.75,
    presence: 0.8, lifeRate: 0.16, wriggle: 0.7, drift: 0.6,
    scanRate: 16, scanDrain: 0.7, misProb: 0.15,
    classifyPressure: 0, waveRate: 0, linkRate: 2, runnerRate: 4, eventVivid: 0.5,
    gridStrength: 0.42, gridFine: 0.5,
    glyphDensity: 0.7, chatterRate: 0.9, machineFrac: 0.3, classifiedFloor: 0.28,
    commFreq: 6, zoom: 0.98, survivorFocus: 0,
    hueSat: 0.8, warmth: 0.45, rustMix: 0.35, inkPersist: 0.8,
    vignette: 0.35, motes: 0.05, groundLight: 0.9,
  },
  { // 4. Last unclassified — restraint + scale shift: deep zoom onto the one
    // surviving unclassified community, grid dimmed, near-mono spotlight
    // outside it (survivorFocus). Vitality regrows here — the holdout is
    // thriving even as the world flattens around it.
    name: 'last-unclassified',
    vitalityTarget: 0.90, churn: 0.6,
    presence: 0.75, lifeRate: 0.08, wriggle: 1.0, drift: 0.7,
    scanRate: 1.5, scanDrain: 0.4, misProb: 0,
    classifyPressure: 0, waveRate: 0, linkRate: 0, runnerRate: 0, eventVivid: 0.4,
    gridStrength: 0.10, gridFine: 0.15,
    glyphDensity: 0.9, chatterRate: 0.7, machineFrac: 0.35, classifiedFloor: 0.34,
    commFreq: 6, zoom: 2.9, survivorFocus: 1,
    hueSat: 0.85, warmth: 0.5, rustMix: 0.3, inkPersist: 0.5,
    vignette: 0.5, motes: 0.05, groundLight: 0.9,
  },
  { // 5. Total classification — THE drop at t=232: grid slams to full
    // strength, mass-classification ring waves sweep the field, rust
    // ascendant. Album-max density hit exactly once here (gridStrength,
    // scanRate, rustMix all peak, uniquely).
    name: 'total-classification',
    vitalityTarget: 0.25, churn: 0.5,
    presence: 0.9, lifeRate: 0.30, wriggle: 0.35, drift: 0.25,
    scanRate: 34, scanDrain: 1.0, misProb: 0,
    classifyPressure: 0.35, waveRate: 10, linkRate: 14, runnerRate: 22, eventVivid: 1.0,
    gridStrength: 1.0, gridFine: 1.0,
    glyphDensity: 0.55, chatterRate: 1.4, machineFrac: 0.9, classifiedFloor: 0.9,
    commFreq: 6, zoom: 0.82, survivorFocus: 0,
    hueSat: 0.4, warmth: 0.35, rustMix: 0.55, inkPersist: 1.0,
    vignette: 0.42, motes: 0.02, groundLight: 0.9,
  },
  { // 6. Residue — power-down at t=316; the field bleaches toward pale bone
    // catalogue paper, only sparse unclassified motes drift (album-max),
    // one last glyph flicker at t=330, then settles near the opening's
    // zoom/vitality — loop closure.
    name: 'residue',
    vitalityTarget: 0.10, churn: 0.25,
    presence: 0.22, lifeRate: 0.04, wriggle: 0.15, drift: 0.1,
    scanRate: 0, scanDrain: 0, misProb: 0,
    classifyPressure: 0, waveRate: 0, linkRate: 0, runnerRate: 0, eventVivid: 0.2,
    gridStrength: 0.06, gridFine: 0,
    glyphDensity: 0.08, chatterRate: 0.3, machineFrac: 1.0, classifiedFloor: 0.93,
    commFreq: 6, zoom: 1.15, survivorFocus: 0,
    hueSat: 0.2, warmth: 0.3, rustMix: 0.45, inkPersist: 0.35,
    vignette: 0.45, motes: 0.5, groundLight: 1.0,
  },
];

/**
 * Continuous energy envelope: [t, energy] keys, linearly interpolated. Kept
 * out of ActParams so it moves smoothly across whole acts instead of only
 * inside the 6s boundary crossfades. The near-vertical steps are the
 * scripted hits: an UPWARD step at 167.8->168.3 (the mass-scan cascade), a
 * big UPWARD step at 231.7->232.2 (THE drop), and a DOWNWARD step at
 * 315.6->316.4 (the power-down) — deliberate discrete state changes, not
 * crossfades (ported idiom from a3-biome-dominoes' ARC_KEYS). Ration the
 * maximum: 1.0 appears once, mid total-classification (t=246); the build
 * (act 3) is held well below it (restraint before the peak). A small settle
 * dip just after the opening (t=36) and the fade to residue resolve the
 * outro back down near the opening level (loop closure).
 */
const ARC_KEYS: [number, number][] = [
  [0, 0.22],
  [30, 0.34],
  [36, 0.28],
  [54, 0.30],
  [56, 0.36],
  [100, 0.45],
  [126, 0.50],
  [128, 0.58],
  [167.8, 0.68],
  [168.3, 0.78],
  [171, 0.74],
  [174, 0.42],
  [200, 0.38],
  [228, 0.50],
  [231.7, 0.55],
  [232.2, 0.96],
  [246, 1.0],
  [300, 0.82],
  [315.6, 0.70],
  [316.4, 0.18],
  [330, 0.08],
  [336.998, 0.04],
];

export interface ArcState {
  energy: number;
}

const _arc: ArcState = { energy: 0 };

/** Piecewise-linear energy envelope at song time. Returns a reused object — read, don't hold; spread-copy before comparing across two calls. */
export function arcAt(songTime: number): ArcState {
  const t = Math.min(Math.max(songTime, 0), ARC_KEYS[ARC_KEYS.length - 1][0]);
  let i = 0;
  while (i < ARC_KEYS.length - 2 && t >= ARC_KEYS[i + 1][0]) i++;
  const a = ARC_KEYS[i], b = ARC_KEYS[i + 1];
  const k = Math.min(1, Math.max(0, (t - a[0]) / Math.max(1e-3, b[0] - a[0])));
  _arc.energy = a[1] + (b[1] - a[1]) * k;
  return _arc;
}

/**
 * Continuous spatial machine-order envelope: [t, order] keys, linearly
 * interpolated — specimen anchors drift from organic scatter to aligned
 * museum-drawer rows. Zero through acts 1-2 (pure living scatter), first
 * slow alignments across act 3, held gently through the breakdown, then the
 * LONG VISIBLE ASSEMBLY across act 5 (0.25 -> 0.95 over 68s — the climax is
 * watching the drawer win), locked from the 316 power-down. Deliberately a
 * continuous envelope, NOT an act-held param: its motion IS the content
 * (contrast index.ts's act-hold idiom for discrete boundaries).
 */
const ORDER_KEYS: [number, number][] = [
  [0, 0],
  [128, 0],
  [172, 0.22],
  [232, 0.25],
  [300, 0.95],
  [316, 1],
  [336.998, 1],
];

export interface OrderState {
  order: number;
}

const _order: OrderState = { order: 0 };

/** Piecewise-linear machine-order envelope at song time. Returns a reused object — read, don't hold; spread-copy before comparing across two calls. */
export function orderAt(songTime: number): OrderState {
  const t = Math.min(Math.max(songTime, 0), ORDER_KEYS[ORDER_KEYS.length - 1][0]);
  let i = 0;
  while (i < ORDER_KEYS.length - 2 && t >= ORDER_KEYS[i + 1][0]) i++;
  const a = ORDER_KEYS[i], b = ORDER_KEYS[i + 1];
  const k = Math.min(1, Math.max(0, (t - a[0]) / Math.max(1e-3, b[0] - a[0])));
  _order.order = a[1] + (b[1] - a[1]) * k;
  return _order;
}

/** Seconds before a boundary over which params crossfade into the next act. */
const CROSSFADE_SECONDS = 6;

export interface SectionState {
  params: ActParams;
  actIndex: number;
  /** 0..1 progress through the dominant act's window. */
  localT: number;
  /** 0..1 crossfade weight toward the next act. */
  blend: number;
}

function smoothstep01(x: number): number {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
}

function lerpParams(a: ActParams, b: ActParams, k: number): ActParams {
  if (k <= 0) return a;
  if (k >= 1) return b;
  const out = { ...a, name: k < 0.5 ? a.name : b.name };
  for (const key of Object.keys(a) as (keyof ActParams)[]) {
    const av = a[key], bv = b[key];
    if (typeof av === 'number' && typeof bv === 'number') {
      (out as Record<string, number | string>)[key] = av + (bv - av) * k;
    }
  }
  return out;
}

/** Song-time (seconds) → staged scene parameters. */
export function paramsAt(songTime: number): SectionState {
  const totalEnd = CUES[CUES.length - 1];
  const t = Math.min(Math.max(songTime, 0), totalEnd - 1e-3);

  let i = 0;
  while (i < ACTS.length - 1 && t >= CUES[i + 1]) i++;
  const start = CUES[i];
  const end = CUES[i + 1] ?? totalEnd;
  const localT = Math.min(1, Math.max(0, (t - start) / Math.max(1e-3, end - start)));

  const hasNext = i < ACTS.length - 1;
  const timeToEnd = end - t;
  const blend = hasNext ? smoothstep01(1 - Math.min(1, timeToEnd / CROSSFADE_SECONDS)) : 0;

  const a = ACTS[i];
  const b = hasNext ? ACTS[i + 1] : a;
  return { params: lerpParams(a, b, blend), actIndex: i, localT, blend };
}
