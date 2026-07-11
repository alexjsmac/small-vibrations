/**
 * "Homemakers" (hive rebuild) — two kinds of home, one golden wax wall.
 * Hexagonal comb and rectangular human rooms grow into and around each
 * other on a single fullscreen wall shader, negotiating every shared edge.
 * Staged by song position from the master's 2s RMS/band profile
 * (294.124s):
 *
 *   0:00 groundbreaking      — ink-dark wax, first seed cells appear
 *   0:54 raising-the-frame   — first drop; comb accretes fast in rings
 *   1:41 settling-in         — breakdown; growth halts, wall breathes
 *   2:12 inside-the-house    — camera pulls in tight (zoom 1.6), intimate
 *   3:08 two-homes-one-wall  — the climax; comb + rooms interlock, boundary
 *                              shimmer peaks once, macro comb pulls back
 *   4:12 housewarming        — step-down; the finished wall holds, warm
 *   4:27 lights-out          — windows go dark one by one, back to ink
 *
 * Same machinery as a1/a2-homemakers: acts are parameter keyframes
 * crossfaded near each boundary, `localT` exposes within-act progress.
 * Construction progress and the final dimming are continuous
 * piecewise-linear curves over the whole track (`arcAt`) rather than act
 * params, so growth never pops at a boundary crossfade.
 *
 * Audio map (each band one job, applied in index.ts / wallShader.ts):
 *  - smoothed bass  -> honey glow breath + wall pulse
 *  - bass onsets    -> uFlash kick + an ambient knock (a1's EMA-floor idiom)
 *  - highs          -> bee sparkle + shimmer flicker
 *  - mid            -> ambient drift pace + honey drip speed
 *  - boundaries 54/188 -> arcAt's near-vertical steps below (already
 *    encoded in ARC_KEYS) plus a scripted uFlash impulse on crossing,
 *    detected in index.ts the same way the old a2-homemakers/index.ts did.
 */

export interface ActParams {
  name: string;
  /** Additive brightness multiplier on hex + room wall lines. */
  wallGlow: number;
  /** Honey-fill visibility/intensity inside built hex cells. */
  honeyFill: number;
  /** Warm window-light visibility/intensity inside built rooms. */
  roomLight: number;
  /** 0..1 boundary-accent shimmer strength where hex and room walls coincide. */
  shimmer: number;
  /** 0..1 fraction of the bee particle budget visible. */
  beeDensity: number;
  /** 0..1 blend from free curl drift to circulating around the wall (bees). */
  beeSwarm: number;
  /** Baseline full-wall light pulses per minute (bass onsets add more). */
  flashRate: number;
  /** Baseline ambient wall-knocks per minute (pointer taps add more, on top). */
  knockRate: number;
  /** Ambient wall-space scroll drift, x component (wall-uv units/s). */
  driftX: number;
  /** Ambient wall-space scroll drift, y component (wall-uv units/s). */
  driftY: number;
  /** 0..1 palette lean between amber and honey-gold anchors. */
  palMix: number;
  /** 0..1 strength of regional per-cell hue variation (anti-monochrome). */
  hueVar: number;
  /** Wall-space camera zoom (>1 = closer/intimate, <1 = pulled back). */
  zoom: number;
}

/** Boundary times in seconds, from the master's 2s RMS/band profile. Track duration: 294.124s. */
export const CUES = [0, 54, 101, 132, 188, 252, 267, 294.124] as const;

export const ACTS: ActParams[] = [
  { // 1. Groundbreaking — ink void, a few seed cells glowing faintly
    name: 'groundbreaking',
    wallGlow: 0.4, honeyFill: 0.15, roomLight: 0, shimmer: 0,
    beeDensity: 0.2, beeSwarm: 0.1, flashRate: 1.5, knockRate: 0.5,
    driftX: 0.02, driftY: 0.01, palMix: 0.1, hueVar: 0.4, zoom: 1.0,
  },
  { // 2. Raising the Frame — first drop: comb accretes fast in rings
    name: 'raising-the-frame',
    wallGlow: 0.65, honeyFill: 0.5, roomLight: 0.2, shimmer: 0.15,
    beeDensity: 0.4, beeSwarm: 0.25, flashRate: 8, knockRate: 4,
    driftX: 0.05, driftY: 0.02, palMix: 0.3, hueVar: 0.55, zoom: 1.0,
  },
  { // 3. Settling In — breakdown: growth halts, the half-built wall breathes
    name: 'settling-in',
    wallGlow: 0.55, honeyFill: 0.4, roomLight: 0.15, shimmer: 0,
    beeDensity: 0.3, beeSwarm: 0.2, flashRate: 2, knockRate: 2,
    driftX: 0.015, driftY: 0.01, palMix: 0.25, hueVar: 0.5, zoom: 1.0,
  },
  { // 4. Inside the House — camera pulls in tight; intimate before the climax pulls back
    name: 'inside-the-house',
    wallGlow: 0.5, honeyFill: 0.45, roomLight: 0.4, shimmer: 0.1,
    beeDensity: 0.3, beeSwarm: 0.15, flashRate: 3, knockRate: 6,
    driftX: 0.01, driftY: 0.04, palMix: 0.4, hueVar: 0.6, zoom: 1.6,
  },
  { // 5. Two Homes, One Wall — climax: THE single maximum (shimmer 1.0 once); macro pull-back
    name: 'two-homes-one-wall',
    wallGlow: 0.9, honeyFill: 0.85, roomLight: 0.6, shimmer: 1.0,
    beeDensity: 0.85, beeSwarm: 0.85, flashRate: 9, knockRate: 16,
    driftX: 0.08, driftY: 0.03, palMix: 0.6, hueVar: 0.8, zoom: 0.55,
  },
  { // 6. Housewarming — the finished wall holds, warm, restrained
    name: 'housewarming',
    wallGlow: 0.75, honeyFill: 0.75, roomLight: 0.5, shimmer: 0.4,
    beeDensity: 0.5, beeSwarm: 0.5, flashRate: 3, knockRate: 9,
    driftX: 0.03, driftY: 0.015, palMix: 0.5, hueVar: 0.65, zoom: 0.85,
  },
  { // 7. Lights Out — windows go dark one by one, dust settles, back to ink
    name: 'lights-out',
    wallGlow: 0.3, honeyFill: 0.2, roomLight: 0.05, shimmer: 0,
    beeDensity: 0.1, beeSwarm: 0.1, flashRate: 0.3, knockRate: 0,
    driftX: 0.005, driftY: 0.005, palMix: 0.2, hueVar: 0.3, zoom: 1.0,
  },
];

/**
 * Continuous arc curves: [t, hexBuild, roomBuild, dim, macro, settle, energy]
 * keys, linearly interpolated. Kept out of ActParams so they move smoothly
 * across whole acts instead of only inside the 6s boundary crossfades.
 *  - hexBuild/roomBuild: 0..1 birth-order growth fraction for each lattice
 *  - dim:    0..1 lights-out progress (drives the alive/window-off term)
 *  - macro:  reveal of the giant background comb (the climax scale shift;
 *    must be coordinated with the climax act's zoom pull-back to 0.55)
 *  - settle: the bee swarm "moving in" once construction completes
 *  - energy: the track's 0..1 energy envelope
 * The near-vertical steps at 54s and 188s are deliberate: the drops hit as
 * discrete state changes (a burst of cells born on the beat), not
 * crossfades. Ported verbatim from a2-homemakers/sections.ts.
 */
const ARC_KEYS: [number, number, number, number, number, number, number][] = [
  [0,       0.05, 0,    0,    0,   0,    0.15],
  [53.8,    0.24, 0,    0,    0,   0,    0.40],
  [54.3,    0.30, 0,    0,    0,   0,    0.75],
  [95,      0.58, 0,    0,    0,   0,    0.70],
  [101,     0.60, 0,    0,    0,   0,    0.35],
  [132,     0.60, 0,    0,    0,   0,    0.30],
  [150,     0.63, 0.12, 0,    0,   0,    0.35],
  [187.8,   0.70, 0.38, 0,    0,   0,    0.50],
  [188.4,   0.78, 0.50, 0,    0.1, 0,    1.0],
  [215,     0.93, 0.85, 0,    1,   0,    1.0],
  [225,     1.0,  1.0,  0,    1,   0,    0.95],
  [248,     1.0,  1.0,  0,    1,   0.9,  0.85],
  [252,     1.0,  1.0,  0,    1,   0.95, 0.70],
  [267,     1.0,  1.0,  0,    1,   1,    0.40],
  [290,     1.0,  1.0,  0.97, 1,   1,    0.08],
  [294.124, 1.0,  1.0,  1,    1,   1,    0],
];

export interface ArcState {
  hexBuild: number;
  roomBuild: number;
  dim: number;
  macro: number;
  settle: number;
  energy: number;
}

const _arc: ArcState = { hexBuild: 0, roomBuild: 0, dim: 0, macro: 0, settle: 0, energy: 0 };

/** Piecewise-linear construction + dimming state at song time. Returns a reused object — read, don't hold. */
export function arcAt(songTime: number): ArcState {
  const t = Math.min(Math.max(songTime, 0), ARC_KEYS[ARC_KEYS.length - 1][0]);
  let i = 0;
  while (i < ARC_KEYS.length - 2 && t >= ARC_KEYS[i + 1][0]) i++;
  const a = ARC_KEYS[i], b = ARC_KEYS[i + 1];
  const k = Math.min(1, Math.max(0, (t - a[0]) / Math.max(1e-3, b[0] - a[0])));
  _arc.hexBuild = a[1] + (b[1] - a[1]) * k;
  _arc.roomBuild = a[2] + (b[2] - a[2]) * k;
  _arc.dim = a[3] + (b[3] - a[3]) * k;
  _arc.macro = a[4] + (b[4] - a[4]) * k;
  _arc.settle = a[5] + (b[5] - a[5]) * k;
  _arc.energy = a[6] + (b[6] - a[6]) * k;
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
