/**
 * "They Come Marching" is staged by song position, not just instantaneous
 * audio — the scene arcs from an empty void through condensing matter to a
 * coordinated "march" and back to dissolve, matching the track's structure
 * (measured from the master WAV's RMS/band profile). See the plan for the
 * act-by-act visual description.
 *
 * `paramsAt(songTime)` returns the current blend of two adjacent acts' scalar
 * parameters (crossfaded over CROSSFADE_SECONDS before each boundary) plus
 * `localT` — 0..1 progress through the *dominant* act — so dust.ts/blobs.ts
 * can layer their own within-act envelopes (fade-in, growth, dissolve) on
 * top of the boundary crossfade.
 */

export interface ActParams {
  name: string;
  /** 0..1 fraction of the dust budget visible. */
  dustDensity: number;
  /** Curl-noise flow speed multiplier. */
  flowSpeed: number;
  /** Curl-noise spatial frequency (higher = smaller, busier eddies). */
  turbulence: number;
  /** 0..1 blend from free drifting to orbiting the nearest blob. */
  condensation: number;
  /** 0..1 strength of the directional "marching" stream (Act 6). */
  marchDrift: number;
  /** Dust base brightness multiplier (audio `high` adds sparkle on top). */
  dustBrightness: number;
  /** 0..1 overall metaball presence (0 = no balls this frame). */
  blobPresence: number;
  /** Base metaball field strength before bass swell. */
  blobStrength: number;
  /** Camera dolly/orbit speed multiplier. */
  cameraDrift: number;
  /** 0..1 mix toward the procedural "developed skin" pattern on blob surfaces (Full quality only). */
  skinPattern: number;
}

/** Boundary times in seconds, measured from the master's 2s RMS/band profile. Track duration: 286.439s. */
export const CUES = [0, 16, 64, 100, 180, 200, 248, 286.439] as const;

export const ACTS: ActParams[] = [
  { // 1. Void — near-black, sparse dust fading in
    name: 'void',
    dustDensity: 0.12, flowSpeed: 0.25, turbulence: 0.6, condensation: 0,
    marchDrift: 0, dustBrightness: 0.35,
    blobPresence: 0, blobStrength: 0,
    cameraDrift: 0.15, skinPattern: 0,
  },
  { // 2. Stirring — full dust field flowing, faint clustering
    name: 'stirring',
    dustDensity: 1.0, flowSpeed: 0.6, turbulence: 0.8, condensation: 0.15,
    marchDrift: 0, dustBrightness: 0.75,
    blobPresence: 0, blobStrength: 0,
    cameraDrift: 0.3, skinPattern: 0,
  },
  { // 3. Fragments — turbulent, proto-blobs flicker in on hits
    name: 'fragments',
    dustDensity: 0.85, flowSpeed: 1.1, turbulence: 1.4, condensation: 0.35,
    marchDrift: 0, dustBrightness: 0.85,
    blobPresence: 0.5, blobStrength: 0.35,
    cameraDrift: 0.45, skinPattern: 0,
  },
  { // 4. Condensation — metaballs grow/merge, dust orbits them
    name: 'condensation',
    dustDensity: 0.8, flowSpeed: 0.55, turbulence: 0.7, condensation: 0.7,
    marchDrift: 0, dustBrightness: 0.85,
    blobPresence: 1.0, blobStrength: 0.55,
    cameraDrift: 0.3, skinPattern: 0.15,
  },
  { // 5. Shift — merged mass stretches, reorganizes into a column
    name: 'shift',
    dustDensity: 0.6, flowSpeed: 0.9, turbulence: 0.9, condensation: 0.8,
    marchDrift: 0.25, dustBrightness: 0.8,
    blobPresence: 1.0, blobStrength: 0.75,
    cameraDrift: 0.55, skinPattern: 0.4,
  },
  { // 6. The March — peak brightness, forms process, dust streams with them
    name: 'the-march',
    dustDensity: 1.0, flowSpeed: 1.2, turbulence: 0.75, condensation: 0.5,
    marchDrift: 1.0, dustBrightness: 1.0,
    blobPresence: 1.0, blobStrength: 0.9,
    cameraDrift: 0.7, skinPattern: 1.0,
  },
  { // 7. Dissolve — forms release back to dust, thins toward black
    name: 'dissolve',
    dustDensity: 0.5, flowSpeed: 0.4, turbulence: 0.6, condensation: 0.1,
    marchDrift: 0, dustBrightness: 0.4,
    blobPresence: 0, blobStrength: 0,
    cameraDrift: 0.2, skinPattern: 0.2,
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
