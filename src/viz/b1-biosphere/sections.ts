/**
 * "Icky, Sticky, & Thriving" — the petri-dish biosphere. A single spore
 * lands in a dark dish; life in many forms (networks, blooms, rot, rebirth)
 * converges into one full teeming biosphere, then exhales back to a spore.
 * Staged by song position from the master's 2s RMS/band profile (251.238s):
 *
 *   0:00 spores          — sparse gold motes drift; first thin hyphae reach
 *                           between them (species A only, low deposit)
 *   0:54 first-bloom      — discrete hit: mass spawn burst; veins fatten +
 *                           throb; first fruiting bodies
 *   1:46 rot              — veins wither (decay up, deposit down); palette
 *                           bruises/desaturates
 *   2:10 stirring         — species B activates with DIFFERENT sensing
 *                           params — visibly different network texture
 *   2:34 convergence      — density climbs, all species on, colour
 *                           deliberately held back (restraint before peak)
 *   2:58 full-biosphere    — the maximum, once: full density, spore bursts,
 *                           saturated gold, slow zoom-OUT scale shift
 *   3:54 exhale           — hard cut honored discretely: network dissolves
 *                           to drifting spores; one last node glows and
 *                           fades (loop closure back toward act 1)
 *
 * Same machinery as a2-hive: acts are parameter keyframes crossfaded near
 * each boundary (`paramsAt`, ~6s window, `localT` exposes within-act
 * progress), plus a continuous `energy` life-curve (`arcAt`) with
 * near-vertical steps at the two scripted drops (54s/178s) so those land as
 * discrete hits rather than crossfades — ported idiom from a2-hive's
 * ARC_KEYS.
 *
 * Audio map (each band one job, applied in index.ts / dishShader.ts):
 *  - smoothed bass  -> vein throb (brightness swell)
 *  - bass onsets    -> spore bursts (agent teleport + visual flash ring)
 *  - mid            -> agent speed nudge
 *  - high           -> vein shimmer / iridescent flicker
 *  - boundaries 54/178 -> discrete hits: mass burst + a palette snap via
 *    arcAt's near-vertical energy step, detected in index.ts the same way
 *    a2-hive's index.ts detects 54/188.
 */

export interface ActParams {
  name: string;
  /** 0..1 active-agent fraction, species A/B/C (dormant agents don't move or deposit). */
  activeA: number;
  activeB: number;
  activeC: number;
  /** Sensor distance (dish-uv units), species A/B/C — the per-act network *texture* reorganization. */
  sensDistA: number;
  sensDistB: number;
  sensDistC: number;
  /** Sensor half-angle (radians), species A/B/C. */
  sensAngleA: number;
  sensAngleB: number;
  sensAngleC: number;
  /** Agent speed (dish-uv/s), shared across species. */
  speed: number;
  /** Deposit strength per tick, shared across species. */
  deposit: number;
  /** Trail decay RATE (1/s) — higher wilts veins faster (the rot act raises this). */
  decay: number;
  /** Fruiting-body accumulator gain (trail A channel). */
  fruitGain: number;
  /** Fruiting-body composite brightness. */
  fruitGlow: number;
  /** 0..1 fraction of the spore mote budget visible. */
  sporeDensity: number;
  /** Baseline burst events per minute (bass onsets add more). */
  burstRate: number;
  /** 0..1 bass-driven vein brightness swell strength. */
  throb: number;
  /** 0..1 high-driven flicker/iridescence strength. */
  shimmer: number;
  /** 0..1 saturation multiplier — lower bruises/desaturates (the rot act). */
  sat: number;
  /** 0..1 palette lean (hue tilt toward bruise/purple vs. gold). */
  palMix: number;
  /** Dish-space camera zoom (>1 closer, <1 pulled back — act 6's back-half scale shift). */
  zoom: number;
  /** Strength of the analytic food field added to agent sensors. */
  foodPull: number;
}

/** Boundary times in seconds, from the master's 2s RMS/band profile. Track duration: 251.238s. */
export const CUES = [0, 54, 106, 130, 154, 178, 234, 251.238] as const;

export const ACTS: ActParams[] = [
  { // 1. Spores — sparse gold motes drift; first thin hyphae reach between
    // them. Species A only (B/C inert but keep sensible neutral params so
    // later crossfades into them don't jump).
    name: 'spores',
    activeA: 0.35, activeB: 0, activeC: 0,
    sensDistA: 0.035, sensDistB: 0.03, sensDistC: 0.03,
    sensAngleA: 0.5, sensAngleB: 0.4, sensAngleC: 0.4,
    speed: 0.05, deposit: 0.15, decay: 0.25,
    fruitGain: 0.05, fruitGlow: 0.1,
    sporeDensity: 1.0, burstRate: 2,
    throb: 0.2, shimmer: 0.15, sat: 0.9, palMix: 0.1, zoom: 1.0, foodPull: 0.3,
  },
  { // 2. First Bloom — discrete hit at 54s: mass spawn burst; veins fatten
    // and throb; first fruiting bodies appear.
    name: 'first-bloom',
    activeA: 0.8, activeB: 0.1, activeC: 0,
    sensDistA: 0.04, sensDistB: 0.03, sensDistC: 0.03,
    sensAngleA: 0.55, sensAngleB: 0.4, sensAngleC: 0.4,
    speed: 0.09, deposit: 0.45, decay: 0.2,
    fruitGain: 0.25, fruitGlow: 0.4,
    sporeDensity: 0.5, burstRate: 10,
    throb: 0.6, shimmer: 0.3, sat: 1.0, palMix: 0.2, zoom: 1.0, foodPull: 0.4,
  },
  { // 3. Rot — veins wither (decay up, deposit down); palette bruises and
    // desaturates.
    name: 'rot',
    activeA: 0.55, activeB: 0.1, activeC: 0,
    sensDistA: 0.04, sensDistB: 0.03, sensDistC: 0.03,
    sensAngleA: 0.5, sensAngleB: 0.4, sensAngleC: 0.4,
    speed: 0.06, deposit: 0.15, decay: 0.55,
    fruitGain: 0.1, fruitGlow: 0.2,
    sporeDensity: 0.3, burstRate: 1.5,
    throb: 0.25, shimmer: 0.15, sat: 0.45, palMix: 0.55, zoom: 1.0, foodPull: 0.2,
  },
  { // 4. Stirring — species B activates with visibly DIFFERENT sensing
    // params (wider sensor distance/angle) — a distinct network texture
    // from species A's tighter, straighter comb.
    name: 'stirring',
    activeA: 0.5, activeB: 0.7, activeC: 0,
    sensDistA: 0.04, sensDistB: 0.07, sensDistC: 0.03,
    sensAngleA: 0.5, sensAngleB: 0.9, sensAngleC: 0.4,
    speed: 0.08, deposit: 0.3, decay: 0.3,
    fruitGain: 0.15, fruitGlow: 0.25,
    sporeDensity: 0.35, burstRate: 4,
    throb: 0.35, shimmer: 0.25, sat: 0.7, palMix: 0.35, zoom: 1.0, foodPull: 0.35,
  },
  { // 5. Convergence — density climbs, all three species on, colour
    // deliberately held back (restraint before the peak: sat well below
    // both neighbouring acts and far below act 6's 1.0).
    name: 'convergence',
    activeA: 0.7, activeB: 0.75, activeC: 0.4,
    sensDistA: 0.04, sensDistB: 0.07, sensDistC: 0.025,
    sensAngleA: 0.5, sensAngleB: 0.9, sensAngleC: 0.3,
    speed: 0.09, deposit: 0.4, decay: 0.25,
    fruitGain: 0.2, fruitGlow: 0.3,
    sporeDensity: 0.3, burstRate: 6,
    throb: 0.4, shimmer: 0.3, sat: 0.55, palMix: 0.3, zoom: 1.0, foodPull: 0.45,
  },
  { // 6. Full Biosphere — discrete hit at 178s: THE single maximum (sat
    // 1.0, throb/burstRate/deposit all peak here, exactly once) plus the
    // back-half scale shift: zoom pulls OUT below 1 for the only time in
    // the track.
    name: 'full-biosphere',
    activeA: 0.95, activeB: 0.9, activeC: 0.6,
    sensDistA: 0.045, sensDistB: 0.075, sensDistC: 0.028,
    sensAngleA: 0.55, sensAngleB: 0.95, sensAngleC: 0.32,
    speed: 0.11, deposit: 0.55, decay: 0.2,
    fruitGain: 0.3, fruitGlow: 0.55,
    sporeDensity: 0.6, burstRate: 16,
    throb: 0.85, shimmer: 0.6, sat: 1.0, palMix: 0.15, zoom: 0.72, foodPull: 0.5,
  },
  { // 7. Exhale — the hard cut at 234s: network dissolves back to drifting
    // spores (sporeDensity climbs back near act 1's 1.0, zoom returns to
    // 1.0) — loop closure. One last node glows and fades via fruitGlow.
    name: 'exhale',
    activeA: 0.15, activeB: 0.05, activeC: 0.02,
    sensDistA: 0.035, sensDistB: 0.03, sensDistC: 0.025,
    sensAngleA: 0.5, sensAngleB: 0.4, sensAngleC: 0.3,
    speed: 0.04, deposit: 0.08, decay: 0.7,
    fruitGain: 0.05, fruitGlow: 0.15,
    sporeDensity: 0.9, burstRate: 1,
    throb: 0.15, shimmer: 0.1, sat: 0.6, palMix: 0.1, zoom: 1.0, foodPull: 0.2,
  },
];

/**
 * Continuous energy envelope: [t, energy] keys, linearly interpolated.
 * Kept out of ActParams so it moves smoothly across whole acts instead of
 * only inside the 6s boundary crossfades. The near-vertical steps at 54s
 * and 178s are deliberate: the two scripted drops hit as discrete state
 * changes (a burst of biomass on the beat), not crossfades — ported idiom
 * from a2-hive's ARC_KEYS. Ration the maximum: 1.0 appears once, at the
 * full-biosphere climax; convergence (the act before it) is held well
 * below both its neighbours (restraint before the peak). The outro
 * resolves back near the opening level (loop closure).
 */
const ARC_KEYS: [number, number][] = [
  [0, 0.10],
  [40, 0.25],
  [53.8, 0.30],
  [54.3, 0.55],
  [90, 0.50],
  [106, 0.35],
  [130, 0.40],
  [154, 0.55],
  [177.8, 0.62],
  [178.3, 0.95],
  [210, 1.0],
  [234, 0.5],
  [251.238, 0.12],
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
