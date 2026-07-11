/**
 * "They Come Marching" (primordial take) is staged by song position, not
 * just instantaneous audio — a Gray-Scott reaction-diffusion field arcs from
 * lone bloom-and-die spots through mitosis, worms, coral growth, a
 * labyrinthine shift, aligned marching stripes, and finally decay back to
 * specks, matching the track's structure (measured from the master WAV's
 * RMS/band profile). See src/viz/a1-they-come-marching/sections.ts for the
 * pattern this mirrors.
 *
 * `paramsAt(songTime)` returns the current blend of two adjacent acts'
 * scalar parameters (crossfaded over CROSSFADE_SECONDS before each
 * boundary) plus `localT` — 0..1 progress through the *dominant* act — so
 * index.ts can layer its own within-act envelopes on top of the boundary
 * crossfade.
 */

export interface ActParams {
  name: string;
  /** Gray-Scott feed rate F. */
  feed: number;
  /** Gray-Scott kill rate k. */
  kill: number;
  /** Overall diffusion scale (multiplies both dA and dB). */
  dScale: number;
  /** Per-axis diffusion anisotropy (1,1 = isotropic; X>Y elongates patterns horizontally). */
  anisoX: number;
  anisoY: number;
  /** Field advection in texels/step — makes the whole pattern stream. */
  advectX: number;
  advectY: number;
  /** New life seeds injected per minute. */
  seedRate: number;
  /** Display intensity of the organism layer, 0..1. */
  fieldGain: number;
  /** 0..1 morph through the palette (0 = cool cyan/blue emphasis, 1 = hot coral/gold emphasis). */
  palMix: number;
  /** 0..1 background nebula level. */
  nebula: number;
  /** Edge-glow strength. */
  glow: number;
  /** How much bass swells brightness, 0..1. */
  pulse: number;
  /** 0..1 spatial feed-rate noise (breaks up uniformity, adds patchiness). */
  feedNoise: number;
}

/** Boundary times in seconds, measured from the master's 2s RMS/band profile. Track duration: 286.439s. */
export const CUES = [0, 16, 64, 100, 180, 200, 248, 286.439] as const;

export const ACTS: ActParams[] = [
  { // 1. void — lone spots bloom and slowly die
    name: 'void',
    feed: 0.034, kill: 0.0655, dScale: 1, anisoX: 1, anisoY: 1,
    advectX: 0, advectY: 0, seedRate: 6, fieldGain: 0.45, palMix: 0.05,
    nebula: 0.55, glow: 0.5, pulse: 0.2, feedNoise: 0.1,
  },
  { // 2. stirring — mitosis, spots divide
    name: 'stirring',
    feed: 0.0367, kill: 0.0649, dScale: 1, anisoX: 1, anisoY: 1,
    advectX: 0, advectY: 0, seedRate: 10, fieldGain: 0.7, palMix: 0.15,
    nebula: 0.45, glow: 0.7, pulse: 0.35, feedNoise: 0.15,
  },
  { // 3. fragments — worms
    name: 'fragments',
    feed: 0.046, kill: 0.063, dScale: 1.05, anisoX: 1, anisoY: 1,
    advectX: 0, advectY: 0, seedRate: 14, fieldGain: 0.8, palMix: 0.3,
    nebula: 0.35, glow: 0.9, pulse: 0.5, feedNoise: 0.35,
  },
  { // 4. condensation — coral growth
    name: 'condensation',
    feed: 0.0545, kill: 0.062, dScale: 1, anisoX: 1, anisoY: 1,
    advectX: 0, advectY: 0, seedRate: 8, fieldGain: 0.95, palMix: 0.45,
    nebula: 0.3, glow: 1.0, pulse: 0.45, feedNoise: 0.2,
  },
  { // 5. shift — labyrinth, begins to stream
    name: 'shift',
    feed: 0.029, kill: 0.057, dScale: 1, anisoX: 1.25, anisoY: 0.85,
    advectX: 0.08, advectY: 0, seedRate: 6, fieldGain: 0.9, palMix: 0.6,
    nebula: 0.3, glow: 1.1, pulse: 0.5, feedNoise: 0.2,
  },
  { // 6. the-march — aligned stripes streaming sideways
    name: 'the-march',
    feed: 0.029, kill: 0.057, dScale: 1, anisoX: 1.6, anisoY: 0.7,
    advectX: 0.10, advectY: -0.01, seedRate: 6, fieldGain: 1.0, palMix: 0.9,
    nebula: 0.25, glow: 1.3, pulse: 0.6, feedNoise: 0.15,
  },
  { // 7. dissolve — decay to specks
    name: 'dissolve',
    feed: 0.030, kill: 0.0658, dScale: 1, anisoX: 1, anisoY: 1,
    advectX: 0, advectY: 0, seedRate: 2, fieldGain: 0.5, palMix: 0.35,
    nebula: 0.5, glow: 0.6, pulse: 0.25, feedNoise: 0.1,
  },
];

/** Seconds before a boundary over which params crossfade into the next act. */
const CROSSFADE_SECONDS = 6;

export interface SectionState {
  params: ActParams;
  /** Index of the dominant (trailing) act. */
  actIndex: number;
  /** 0..1 progress through the dominant act's [start, end) window — for within-act envelopes. */
  localT: number;
  /** 0..1 crossfade weight toward the next act (0 = fully dominant, 1 = fully next). */
  blend: number;
}

function smoothstep01(x: number): number {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
}

function lerpParams(a: ActParams, b: ActParams, k: number): ActParams {
  if (k <= 0) return a;
  if (k >= 1) return b;
  // Lerp every numeric field by key so newly added ActParams can't be
  // silently skipped here.
  const out = { ...a, name: k < 0.5 ? a.name : b.name };
  for (const key of Object.keys(a) as (keyof ActParams)[]) {
    const av = a[key], bv = b[key];
    if (typeof av === 'number' && typeof bv === 'number') {
      (out as Record<string, number | string>)[key] = av + (bv - av) * k;
    }
  }
  return out;
}

/** Song-time (seconds, looping externally by the caller) → staged scene parameters. */
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
