/**
 * "Homemakers" — bees and humans as parallel homemakers, their homes built
 * against each other's walls in one shared structure. Staged by song
 * position from the master's 2s RMS/band profile (294.124s):
 *
 *   0:00 groundbreaking      — steady rising pulse; first seed cells
 *   0:54 raising-the-frame   — first drop; the comb accretes in rings,
 *                              ghost-flashes of human rooms foreshadow 3:08
 *   1:41 settling-in         — breakdown; growth halts, structure breathes
 *   2:12 inside-the-house    — ambient household sounds; camera inside the
 *                              lattice, cells slide around like furniture
 *   3:08 two-homes-one-wall  — the climax; comb + rooms interlock and finish,
 *                              spectrum-driven shimmer, dust swarms like bees
 *   4:12 housewarming        — step-down; the finished structure holds, warm
 *   4:27 lights-out          — fade; windows go dark one by one
 *
 * Same machinery as a1: acts are parameter keyframes crossfaded near each
 * boundary, `localT` exposes within-act progress. Construction progress and
 * the final dimming are continuous piecewise-linear curves over the whole
 * track (`arcAt`) rather than act params, so growth never pops at a boundary.
 */

export interface ActParams {
  name: string;
  /** 0..1 fraction of the pollen-dust budget visible. */
  dustDensity: number;
  /** Curl-noise flow speed multiplier. */
  flowSpeed: number;
  /** Curl-noise spatial frequency. */
  turbulence: number;
  /** Dust base brightness multiplier. */
  dustBrightness: number;
  /** 0..1 blend from free drift to circulating around the structure (bees). */
  swarm: number;
  /** 0..1 ghost-flicker strength of not-yet-built human rooms (the foreshadow). */
  roomGhost: number;
  /** Lattice base glow multiplier. */
  latticeBrightness: number;
  /** 0..1 spectrum-driven per-cell shimmer (audio.frequency), climax register. */
  spectrum: number;
  /** Bass scale-breath amount on cells. */
  breath: number;
  /** Baseline furniture-move events per minute (high onsets add more). */
  moverRate: number;
  /** Baseline full-scene light pulses per minute (bass onsets add more). */
  flashRate: number;
  /** 0..1 how alive the built cells are — individual pulse/color cycling amplitude. */
  life: number;
  /** Baseline glowing pathways bridged between cells per minute (high onsets add more). */
  pathRate: number;
  /** 0..1 how much rust accent (#c44d3a) may appear. */
  accent: number;
  /** Manual depth-fade density (mystery haze; unlit shaders fade with distance). */
  fog: number;
  /** Camera orbit distance from the wall. */
  camDist: number;
  /** Camera drift pace multiplier. */
  camDrift: number;
  /** Camera height bias. */
  camHeight: number;
  /** 0..1 blend from the orbit camera regime to a slow forward drift along the wall (the inside act). */
  camJourney: number;
}

/** Boundary times in seconds, from the master's 2s RMS/band profile. Track duration: 294.124s. */
export const CUES = [0, 54, 101, 132, 188, 252, 267, 294.124] as const;

export const ACTS: ActParams[] = [
  { // 1. Groundbreaking — ink void, drifting pollen, scattered seed cells appear
    name: 'groundbreaking',
    dustDensity: 0.25, flowSpeed: 0.4, turbulence: 0.7, dustBrightness: 0.5,
    swarm: 0.1, roomGhost: 0, latticeBrightness: 0.55, spectrum: 0,
    breath: 0.25, moverRate: 0.5, flashRate: 1.5, life: 0.15, pathRate: 0.5, accent: 0.02,
    fog: 0.1, camDist: 4.6, camDrift: 0.25, camHeight: 0.2, camJourney: 0,
  },
  { // 2. Raising the Frame — first drop: comb accretes fast, ghost rooms flash on hits
    name: 'raising-the-frame',
    dustDensity: 0.45, flowSpeed: 0.9, turbulence: 1.0, dustBrightness: 0.5,
    swarm: 0.25, roomGhost: 0.85, latticeBrightness: 0.65, spectrum: 0.15,
    breath: 0.5, moverRate: 1, flashRate: 8, life: 0.5, pathRate: 4, accent: 0.08,
    fog: 0.08, camDist: 3.6, camDrift: 0.5, camHeight: 0.3, camJourney: 0,
  },
  { // 3. Settling In — breakdown: growth halts, the half-built structure breathes
    name: 'settling-in',
    dustDensity: 0.35, flowSpeed: 0.45, turbulence: 0.7, dustBrightness: 0.55,
    swarm: 0.2, roomGhost: 0.15, latticeBrightness: 0.6, spectrum: 0,
    breath: 0.3, moverRate: 2, flashRate: 2, life: 0.35, pathRate: 2, accent: 0.06,
    fog: 0.14, camDist: 2.4, camDrift: 0.3, camHeight: 0.1, camJourney: 0,
  },
  { // 4. Inside the House — dim, hazy, camera among the cells; furniture moves
    name: 'inside-the-house',
    dustDensity: 0.35, flowSpeed: 0.3, turbulence: 0.5, dustBrightness: 0.45,
    swarm: 0.15, roomGhost: 0.25, latticeBrightness: 0.5, spectrum: 0.1,
    breath: 0.25, moverRate: 10, flashRate: 3, life: 0.45, pathRate: 6, accent: 0.1,
    fog: 0.3, camDist: 1.05, camDrift: 0.18, camHeight: 0, camJourney: 1,
  },
  { // 5. Two Homes, One Wall — climax: full dual lattice, spectrum shimmer, bee swarm
    name: 'two-homes-one-wall',
    dustDensity: 0.8, flowSpeed: 1.1, turbulence: 0.9, dustBrightness: 0.7,
    swarm: 0.85, roomGhost: 0, latticeBrightness: 0.8, spectrum: 1.0,
    breath: 0.7, moverRate: 4, flashRate: 9, life: 1.0, pathRate: 16, accent: 0.3,
    fog: 0.05, camDist: 4.3, camDrift: 0.6, camHeight: 0.5, camJourney: 0,
  },
  { // 6. Housewarming — the finished structure holds, warm, slowly receding
    name: 'housewarming',
    dustDensity: 0.45, flowSpeed: 0.5, turbulence: 0.6, dustBrightness: 0.7,
    swarm: 0.5, roomGhost: 0, latticeBrightness: 0.75, spectrum: 0.4,
    breath: 0.4, moverRate: 1.5, flashRate: 3, life: 0.8, pathRate: 9, accent: 0.22,
    fog: 0.08, camDist: 3.2, camDrift: 0.3, camHeight: 0.3, camJourney: 0,
  },
  { // 7. Lights Out — windows go dark one by one, dust settles, back to ink
    name: 'lights-out',
    dustDensity: 0.15, flowSpeed: 0.25, turbulence: 0.5, dustBrightness: 0.3,
    swarm: 0.1, roomGhost: 0, latticeBrightness: 0.5, spectrum: 0,
    breath: 0.15, moverRate: 0, flashRate: 0.3, life: 0.08, pathRate: 0, accent: 0.08,
    fog: 0.2, camDist: 4.4, camDrift: 0.06, camHeight: 0.15, camJourney: 0,
  },
];

/**
 * Continuous arc curves: [t, hexBuild, roomBuild, dim, macro, settle, energy]
 * keys, linearly interpolated. Kept out of ActParams so they move smoothly
 * across whole acts instead of only inside the 6s boundary crossfades.
 *  - macro:  reveal of the giant comb behind the wall (the climax scale shift)
 *  - settle: the swarm "moving in" once construction completes
 *  - energy: the track's 0..1 energy envelope — drives background temperature,
 *    camera pace, and flash strength at the structural level
 * The near-vertical steps at 54s and 188s are deliberate: the drops hit as
 * discrete state changes (a burst of cells born on the beat), not crossfades.
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
