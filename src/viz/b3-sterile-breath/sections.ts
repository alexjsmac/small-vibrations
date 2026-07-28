/**
 * "Sterile Breath" — the album closer, and the record's undoing: the last
 * lush biomass this album has spent nine tracks growing is progressively
 * scrubbed away by an advancing sterilization front, ending in a clinical
 * blank and true silence. A dark, hot-and-decayed ground of living clumps
 * fills the frame at full vibrancy; a scrub line sweeps across it toward a
 * pale surgical white, converting biomass to sterile field as it advances
 * (`sterileAt`). Bass onsets punch swab strikes into the field — wounds
 * that heal shut in the early acts (`strikeHeal` > 0) but, once healing
 * fails at the 140s purge (`strikeHeal` === 0 from act 4 on), scar
 * permanently. A scripted camera pull-out across 164-178s (`zoomAt`)
 * reveals the whole frame was only ever a small living patch on a vast,
 * already-sterile blank. The last surviving biomass condenses to a single
 * seed point and fades out exactly at the album's final silence.
 *
 * Staged by song position (track duration 200.042s):
 *
 *   0:00 breath              — the ground at full vibrancy: hot, dense,
 *                               breathing; no front yet, no strikes,
 *                               nothing sterile.
 *   0:12 the-front-appears   — the sterilization front becomes visible and
 *                               starts advancing; the first swab strikes
 *                               land and heal quickly.
 *   1:18 losing-ground       — front advance accelerates, strikes come
 *                               faster, healing slows — the biomass is
 *                               losing more ground than it regrows.
 *   1:44 remission           — a scripted pull-back in intensity: front
 *                               advance stalls and even retreats slightly
 *                               (`sterileAt` dips 110->118), strikes ease,
 *                               restraint before the purge.
 *   2:20 the-purge           — discrete rule change at t=140: healing fails
 *                               outright (`strikeHeal` -> 0), strike and
 *                               crackle rates peak, the front surges,
 *                               camera shake kicks in — the album-max
 *                               intensity, hit exactly once.
 *   2:42 sterile              — the front has all but won; the scripted
 *                               164-178s zoom-out reveals the frame was a
 *                               small patch on a vast sterile blank
 *                               (`zoomAt` collapses from 1.0 to 0.30).
 *   3:04 last-breath          — true residue: one seed point of biomass
 *                               remains, breathing weakly, and fades to
 *                               nothing as the front finishes and the
 *                               album goes to true silence at 200.042s.
 *
 * Same machinery as b2-terminal-taxonomy: acts are parameter keyframes
 * crossfaded near each boundary (`paramsAt`, 6s window, `localT` exposes
 * within-act progress). Four continuous envelopes ride independently of the
 * act boundaries and share one piecewise-linear sampler (`sampleKeys`):
 * `sterileAt` (0..1 front progress driving `uSterile`), `zoomAt` (the
 * camera's field-of-view multiplier, including the scripted pull-out),
 * `arcAt` (0..1 energy driving exposure lift + a Poisson event-rate
 * multiplier, with near-vertical steps at the purge's onset/release so
 * those land as discrete state changes, not crossfades), and
 * `lifeClockAt` (the cumulative integral of each act's `lifeRate` — a
 * monotonic lifecycle clock for biomass regrowth/decay phase, since a raw
 * per-frame rate can't be integrated exactly by the caller). Deliberate
 * departure from b2: these envelopes return plain numbers, not a
 * reused/mutated state object — no read-don't-hold footgun to spread-copy
 * around.
 *
 * Audio map (each band one job, applied in index.ts / the field + front
 * shaders):
 *  - audio.time            -> act staging (the whole arc) + envelope inputs
 *  - bass onsets            -> swab strikes punched into the field
 *  - smoothed bass          -> breathing amplitude + front-edge glow
 *  - smoothed mid           -> biomass motion phase rate
 *  - fast-smoothed highs    -> droplet glints on the scrub line
 *  - high onsets            -> crackle flashes
 *  - scripted boundaries    -> discrete rule changes: t=140 healing fails
 *    (the purge); t=164-178 the reveal pull-out; final fade to true
 *    silence at 200.042s
 */

export interface ActParams {
  name: string;
  /** Ambient breathing pulse amplitude of the biomass (0..1; smoothed bass rides on top). */
  breathAmp: number;
  /** 0..1 fraction of biomass clumps present in the field. */
  clumpPresence: number;
  /** Biomass lifecycle rate, epochs per second (regrowth/decay phase baseline; integrated by `lifeClockAt`). */
  lifeRate: number;
  /** Biomass motion phase-rate multiplier, driven by mids (0..~1.2). */
  motionSpeed: number;
  /** 0..1 hot/decayed biomass warmth (palette heat channel). */
  heat: number;
  /** 0..1 pale/clinical desaturation mix (paleness fights heat as the ground sterilizes). */
  paleness: number;
  /** 0..1 residual ghost-trail amplitude of dying biomass (0 once healing has failed). */
  ghostAmp: number;
  /** 0..1 turbulence/roughness of the advancing sterilization front edge. */
  frontNoise: number;
  /** 0..1 glow strength along the scrub/front-edge line (smoothed bass -> front-edge glow). */
  scrubGlow: number;
  /** 0..1 droplet-glint amplitude on the scrub line (fast-smoothed highs). */
  glintAmp: number;
  /** Crackle-flash events per minute (high onsets). */
  crackleRate: number;
  /** Swab-strike events per minute (bass onsets punch the biomass). */
  strikeRate: number;
  /** Strike-wound radius shrink rate, 1/s (0 = healing has failed — strikes scar permanently). */
  strikeHeal: number;
  /** Swab-strike radius, in field-uv units. */
  strikeSize: number;
  /** Biomass bloom events per minute (bursts of regrowth). */
  bloomRate: number;
  /** 0..1 bloom event amplitude. */
  bloomAmp: number;
  /** 0..1 residual stain/watermark opacity left by the retreating biomass. */
  watermark: number;
  /** 0..1 clinical specular sheen of the sterile surface. */
  sterileSpec: number;
  /** 0..1 cold color-grade mix toward the surgical-blank palette. */
  grade: number;
  /** Vignette strength (0..1). */
  vignette: number;
  /** 0..1 camera/field drift speed (0 = held still). */
  driftSpeed: number;
  /** 0..1 camera shake amplitude (the purge only). */
  shake: number;
}

/** Boundary times in seconds. Track duration: 200.042s. */
export const CUES: readonly number[] = [0, 12, 78, 104, 140, 162, 184, 200.042];

export const ACTS: ActParams[] = [
  { // 1. Breath — the ground at full vibrancy: hot, dense, breathing; no
    // front, no strikes, nothing sterile yet.
    name: 'breath',
    breathAmp: 1.0, clumpPresence: 0.85,
    lifeRate: 0.06, motionSpeed: 0.5,
    heat: 0.7, paleness: 0, ghostAmp: 0.25,
    frontNoise: 0, scrubGlow: 0, glintAmp: 0,
    crackleRate: 0, strikeRate: 0, strikeHeal: 0.22, strikeSize: 0.05,
    bloomRate: 10, bloomAmp: 1.0,
    watermark: 0, sterileSpec: 0.2, grade: 0.05, vignette: 0.15,
    driftSpeed: 0.4, shake: 0,
  },
  { // 2. The front appears — the sterilization front becomes visible and
    // starts advancing; the first swab strikes land and heal quickly.
    name: 'the-front-appears',
    breathAmp: 0.8, clumpPresence: 0.9,
    lifeRate: 0.10, motionSpeed: 0.7,
    heat: 0.8, paleness: 0, ghostAmp: 0.35,
    frontNoise: 0.5, scrubGlow: 0.5, glintAmp: 0.4,
    crackleRate: 4, strikeRate: 5, strikeHeal: 0.20, strikeSize: 0.07,
    // bloomRate held at 0 here (not the table's raw 2): bloomRate is
    // strictly max in act 0 and, by design, nonzero ONLY in acts 0, 3, 6 —
    // regrowth bursts are an opening/remission/last-breath signature, not
    // an early-front one.
    bloomRate: 0, bloomAmp: 0.5,
    watermark: 0.25, sterileSpec: 0.35, grade: 0.10, vignette: 0.2,
    driftSpeed: 0.5, shake: 0,
  },
  { // 3. Losing ground — front advance accelerates, strikes come faster,
    // healing slows: the biomass is losing more ground than it regrows.
    name: 'losing-ground',
    breathAmp: 0.7, clumpPresence: 0.9,
    lifeRate: 0.14, motionSpeed: 0.9,
    heat: 1.0, paleness: 0.05, ghostAmp: 0.3,
    frontNoise: 0.65, scrubGlow: 0.65, glintAmp: 0.55,
    crackleRate: 8, strikeRate: 10, strikeHeal: 0.12, strikeSize: 0.08,
    bloomRate: 0, bloomAmp: 0.3,
    watermark: 0.35, sterileSpec: 0.4, grade: 0.15, vignette: 0.25,
    driftSpeed: 0.6, shake: 0,
  },
  { // 4. Remission — a scripted pull-back in intensity: front advance
    // stalls and even retreats slightly (see sterileAt's 110->118 dip),
    // strikes ease, restraint before the purge.
    name: 'remission',
    breathAmp: 0.55, clumpPresence: 0.75,
    lifeRate: 0.05, motionSpeed: 0.4,
    heat: 0.45, paleness: 0.55, ghostAmp: 0.3,
    frontNoise: 0.45, scrubGlow: 0.4, glintAmp: 0.35,
    crackleRate: 2, strikeRate: 2, strikeHeal: 0.06, strikeSize: 0.06,
    bloomRate: 4, bloomAmp: 0.7,
    watermark: 0.3, sterileSpec: 0.35, grade: 0.12, vignette: 0.3,
    driftSpeed: 0, shake: 0,
  },
  { // 5. The purge — discrete rule change at t=140: healing fails outright
    // (strikeHeal -> 0), strike/crackle rates peak, the front surges,
    // camera shake kicks in. Album-max intensity, hit exactly once.
    name: 'the-purge',
    breathAmp: 0.5, clumpPresence: 0.8,
    lifeRate: 0.30, motionSpeed: 1.2,
    heat: 0.9, paleness: 0.15, ghostAmp: 0.15,
    frontNoise: 1.0, scrubGlow: 1.0, glintAmp: 1.0,
    crackleRate: 18, strikeRate: 22, strikeHeal: 0, strikeSize: 0.11,
    bloomRate: 0, bloomAmp: 0.2,
    watermark: 0.45, sterileSpec: 0.5, grade: 0.2, vignette: 0.35,
    driftSpeed: 0.8, shake: 1.0,
  },
  { // 6. Sterile — the front has all but won; the scripted 164-178s
    // zoom-out reveals the frame was a small patch on a vast sterile
    // blank. Watermark (residual stain) peaks here, album-max.
    name: 'sterile',
    breathAmp: 0.25, clumpPresence: 0.5,
    lifeRate: 0.06, motionSpeed: 0.3,
    heat: 0.6, paleness: 0.3, ghostAmp: 0,
    frontNoise: 0.6, scrubGlow: 0.7, glintAmp: 0.5,
    crackleRate: 3, strikeRate: 3, strikeHeal: 0, strikeSize: 0.08,
    bloomRate: 0, bloomAmp: 0.3,
    watermark: 0.7, sterileSpec: 0.8, grade: 0.5, vignette: 0.25,
    driftSpeed: 0, shake: 0,
  },
  { // 7. Last breath — true residue: one seed point of biomass remains,
    // breathing weakly, and fades to nothing as the front finishes and the
    // album goes to true silence at 200.042s.
    name: 'last-breath',
    breathAmp: 0.15, clumpPresence: 0.25,
    lifeRate: 0.02, motionSpeed: 0.1,
    heat: 0.5, paleness: 0.4, ghostAmp: 0,
    frontNoise: 0.3, scrubGlow: 0.2, glintAmp: 0,
    crackleRate: 0, strikeRate: 0, strikeHeal: 0, strikeSize: 0.05,
    bloomRate: 1.5, bloomAmp: 0.9,
    watermark: 0.3, sterileSpec: 1.0, grade: 0.8, vignette: 0.4,
    driftSpeed: 0, shake: 0,
  },
];

/** Seconds before a boundary over which params crossfade into the next act. */
export const CROSSFADE_SECONDS = 6;

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

/**
 * Shared piecewise-linear sampler for the [time, value] key tables below.
 * Clamps to the table's domain and returns a plain number — no shared
 * mutable state, so callers never need to spread-copy a result before a
 * second call.
 */
function sampleKeys(keys: readonly [number, number][], t: number): number {
  const clamped = Math.min(Math.max(t, 0), keys[keys.length - 1][0]);
  let i = 0;
  while (i < keys.length - 2 && clamped >= keys[i + 1][0]) i++;
  const a = keys[i], b = keys[i + 1];
  const k = Math.min(1, Math.max(0, (clamped - a[0]) / Math.max(1e-3, b[0] - a[0])));
  return a[1] + (b[1] - a[1]) * k;
}

/** Song-time (seconds) → staged scene parameters, crossfaded near each act boundary. */
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

/**
 * Sterilization front progress: [t, sterile] keys, 0 = fully living,
 * 1 = fully sterile. Mostly a slow monotonic creep, but with two
 * deliberate deviations from monotonic: a scripted remission-act dip
 * (110->118, the front briefly loses ground) and, past that, a string of
 * near-vertical steps at scripted hits (the 140s purge onset, the 144s
 * healing-collapse follow-through, and three small droplet-shudder steps
 * on the way into act 5) — discrete state changes, not crossfades — before
 * locking at 1 from 184.3s (the world is fully sterile with 16s left).
 */
const STERILE_KEYS: [number, number][] = [
  [0, 0],
  [12, 0.02],
  [30, 0.06],
  [78, 0.20],
  [104, 0.42],
  [110, 0.41],
  [118, 0.34],
  [128, 0.33],
  [139.7, 0.33],
  [140.3, 0.52],
  [143.8, 0.56],
  [144.4, 0.66],
  [150, 0.72],
  [162, 0.86],
  [167.8, 0.87],
  [168.3, 0.905],
  [173.7, 0.91],
  [174.3, 0.945],
  [179.7, 0.95],
  [180.3, 0.975],
  [183.7, 0.98],
  [184.3, 1],
  [200.042, 1],
];

/** Piecewise-linear sterilization-front progress at song time, 0..1, driving `uSterile`. */
export function sterileAt(songTime: number): number {
  return sampleKeys(STERILE_KEYS, songTime);
}

/**
 * Camera field-of-view multiplier: [t, zoom] keys (>1 closer, <1 pulled
 * back). Opens close on the breathing ground, eases out gently across
 * acts 1-3, then the piece's one big scripted move: the 164-178s pull-out
 * from 1.0 to 0.30 that reveals the living patch was always small against
 * a vast sterile blank, settling near that pulled-back framing for the
 * fade to true silence.
 */
const ZOOM_KEYS: [number, number][] = [
  [0, 1.45],
  [12, 1.45],
  [40, 1.25],
  [78, 1.15],
  [104, 1.22],
  [139.7, 1.22],
  [140.3, 1.08],
  [162, 1.02],
  [164, 1.0],
  [178, 0.30],
  [184, 0.28],
  [200.042, 0.28],
];

/** Piecewise-linear camera zoom multiplier at song time, feeding `uZoom`. */
export function zoomAt(songTime: number): number {
  return sampleKeys(ZOOM_KEYS, songTime);
}

/**
 * Continuous energy envelope: [t, energy] keys, driving exposure lift and
 * a Poisson event-rate multiplier. Kept out of ActParams so it moves
 * smoothly across whole acts instead of only inside the 6s boundary
 * crossfades. A dip mid-remission (103->106, restraint before the purge),
 * then a big near-vertical UPWARD step at 139.7->140.3 (the purge lands),
 * the album's single 1.0 peak at t=144 (healing-collapse follow-through),
 * a near-vertical DOWNWARD step at 161.7->162.3 (the purge releases into
 * `sterile`), and a long fade to 0 at true silence, 200.042s.
 */
const ARC_KEYS: [number, number][] = [
  [0, 0.25],
  [12, 0.4],
  [40, 0.5],
  [78, 0.65],
  [104, 0.55],
  [105.5, 0.30],
  [108, 0.35],
  [126, 0.4],
  [139.7, 0.45],
  [140.3, 0.9],
  [144, 1.0],
  [148, 0.95],
  [161.7, 0.9],
  [162.3, 0.55],
  [168, 0.45],
  [174, 0.35],
  [180, 0.25],
  [184, 0.12],
  [196, 0.02],
  [200.042, 0],
];

/** Piecewise-linear energy envelope at song time, 0..1: exposure lift + Poisson rate multiplier. */
export function arcAt(songTime: number): number {
  return sampleKeys(ARC_KEYS, songTime);
}

/**
 * Cumulative sum of each act's `lifeRate * actDuration`, precomputed once
 * at module scope: `LIFE_CUM[i]` is the lifecycle clock's value at
 * `CUES[i]`. `lifeClockAt` adds the in-progress fraction of the current
 * act on top.
 */
const LIFE_CUM: number[] = (() => {
  const cum = [0];
  for (let i = 0; i < ACTS.length; i++) {
    const dt = CUES[i + 1] - CUES[i];
    cum.push(cum[i] + ACTS[i].lifeRate * dt);
  }
  return cum;
})();

/**
 * Cumulative lifecycle clock: the piecewise-linear integral of each act's
 * `lifeRate` over time, monotonically increasing (every act's `lifeRate`
 * is positive) from 0 at t=0 to its final value at the last cue. Feeds
 * biomass regrowth/decay phase, where a raw per-frame rate can't be
 * integrated exactly by the caller.
 */
export function lifeClockAt(songTime: number): number {
  const totalEnd = CUES[CUES.length - 1];
  const t = Math.min(Math.max(songTime, 0), totalEnd);

  let i = 0;
  while (i < ACTS.length - 1 && t >= CUES[i + 1]) i++;
  return LIFE_CUM[i] + ACTS[i].lifeRate * (t - CUES[i]);
}
