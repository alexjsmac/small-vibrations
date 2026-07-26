/**
 * "Biome Dominoes" — a living lattice of interconnected biome cells where a
 * spark leaps cell-to-cell in propagating chains. The web wires itself into
 * total synchrony, then one broken link cascades the whole system dark, back
 * to a single lonely blip (loop closure to the seed).
 *
 * The signature element is a GPU excitable medium (Barkley/FitzHugh-Nagumo
 * reaction field, excitableField.ts) rendered through a Voronoi biome-cell
 * shader (latticeShader.ts): the activation channel `u` diffuses as a
 * travelling wave, and the recovery channel `v` IS the refractory period —
 * a cell that just fired can't re-fire until v decays. That refractory
 * recharge is literally "dominoes that stand back up".
 *
 * Staged by song position from the master's 2s RMS/band profile (259.835s):
 *
 *   0:00 seed        — near-dark lattice; one spark hops between 2-3 cells
 *                       (the ticking intro). Slow zoom-in. Motif introduced.
 *   0:34 first-chains — first big element: sparks multiply; short 3-5 cell
 *                       chains fire in sequence; cells briefly bloom.
 *   1:18 wiring-up    — build: chains lengthen into travelling waves; target
 *                       + spiral patterns emerge; palette warms/saturates.
 *   2:00 synchrony    — discrete hit: THE peak, the once-only maximum. Whole
 *                       lattice fires in coordinated waves (global drive on),
 *                       max saturation, AND a zoom-OUT scale shift revealing
 *                       the lattice was a patch of a far larger web.
 *   2:32 strain       — heavy bass, highs drop: waves denser + colliding,
 *                       hotter/darker; the system straining (tension).
 *   3:08 fraying      — energy leaking: waves lose coherence, excitability
 *                       drops, dark gaps open in the lattice.
 *   3:24 collapse     — the drop: a de-activation ring sweeps the field dark
 *                       cell-by-cell (motif inverted, index.ts grows the ring
 *                       across localT). Excitability floored so nothing
 *                       reignites; only dying flickers remain.
 *   4:04 cold-lattice — fade to silence: one last lonely blip on the dark web
 *                       = loop closure back to act 1's seed.
 *
 * Same machinery as a2-hive/b1-biosphere: acts are parameter keyframes
 * crossfaded near each boundary (`paramsAt`, ~6s window, `localT` exposes
 * within-act progress), plus a continuous `energy` life-curve (`arcAt`) with
 * near-vertical steps at 120s (peak lock) and 204s (collapse) so those two
 * scripted hits land as discrete state changes, not crossfades — ported
 * idiom from a2-hive's ARC_KEYS.
 *
 * Audio map (each band one job, applied in index.ts / latticeShader.ts):
 *  - audio.time         -> act staging (the whole arc)
 *  - bass onsets        -> ignition: inject a u-spike at a cell -> a chain leaps
 *  - smoothed mid       -> wave propagation speed (diffusion) nudge
 *  - smoothed/onset high-> cell-bloom sparkle, refractory shimmer, filaments
 *  - boundaries 120/204 -> discrete hits: synchrony lock; de-activation cascade
 */

export interface ActParams {
  name: string;
  /** Baseline ignition events per minute (bass onsets add more) — new chains leaping. */
  ignitionRate: number;
  /** Activation (u) diffusion coefficient — wave propagation speed/spread. */
  diff: number;
  /** Reaction timescale (1/eps): higher = sharper, faster excitation fronts. */
  eps: number;
  /** Excitation threshold slope (Barkley `a`): higher = easier to excite, waves propagate more readily. */
  exA: number;
  /** Excitation threshold offset (Barkley `b`): higher = harder to excite (collapse floors excitability by raising this + dropping exA). */
  exB: number;
  /** Recovery/refractory rate (1/s): higher = cells recharge faster ("dominoes stand back up" sooner). */
  vRate: number;
  /** Global drive added to u each tick — 0 everywhere except synchrony, where a small positive drive tips the whole field toward coordinated auto-firing. */
  drive: number;
  /** Voronoi cell frequency (cells across field-space) — the scale-shift knob; jumps up at the synchrony pull-back to reveal a larger web. */
  cellFreq: number;
  /** Field-space zoom (>1 closer, <1 pulled back — synchrony's back-half scale shift). */
  zoom: number;
  /** Cell bloom brightness when the wave passes. */
  bloomGain: number;
  /** 0..1 saturation multiplier. */
  sat: number;
  /** Hot leading-edge (cyan front) intensity. */
  frontGain: number;
  /** Refractory afterglow (magenta-violet) strength. */
  refractGlow: number;
  /** Edge-filament (chain-link) brightness between adjacent active cells. */
  filament: number;
  /** Micro-biome interior texture amount inside blooming cells. */
  microTex: number;
  /** 0..1 intra-cell interior life — animated churn/ripple/core intensity; always-on baseline that flares on activation. */
  cellLife: number;
  /** 0..1 palette warmth lean (0 = cool electric lime/cyan, 1 = hotter magenta/pink lean). */
  warmth: number;
  /** 0..1 collapse de-activation gate — index.ts grows a suppression ring only while this is > 0. */
  suppress: number;
  /** 0..1 atmospheric dust-haze density. */
  dust: number;
  /**
   * Lattice-rewire phase speed (1/s). 0 = frozen lattice (the seed/collapse/
   * cold acts). When > 0, each cell an activation wave passes slides its
   * nucleus to a new hash-picked spot over ~1/rewireRate seconds — walls flex,
   * adjacencies change, and later waves light a different sequence of cells.
   * Keep nonzero values >= ~0.3 so the a>=0.999 rewire gate never stalls under
   * half-float precision. Mirrors the frozen->fluid->frozen energy arc.
   */
  rewireRate: number;
  /** 0..1 nucleus travel amplitude — how FAR a cell's centre wanders per firing (subtle drift -> dramatic reroute; the escalation knob). */
  rewireJump: number;
  /** 0..1 edge break/crack-shimmer intensity while a cell is mid-rewire (0 = smooth drift, high = visible break-and-reform). */
  rewireCrack: number;
}

/** Boundary times in seconds, from the master's 2s RMS/band profile. Track duration: 259.835s. */
export const CUES = [0, 34, 78, 120, 152, 188, 204, 244, 259.835] as const;

export const ACTS: ActParams[] = [
  { // 1. Seed — near-dark lattice; one spark hops between a few cells (the
    // ticking intro). Low ignition, slow waves, cells recharge slowly so a
    // single hop reads clearly. Cool, unsaturated, zoomed in close.
    name: 'seed',
    ignitionRate: 14, diff: 0.35, eps: 11, exA: 0.7, exB: 0.02, vRate: 1.0,
    drive: 0, cellFreq: 8, zoom: 1.35, bloomGain: 0.55, sat: 0.7,
    frontGain: 0.5, refractGlow: 0.4, filament: 0.35, microTex: 0.2,
    warmth: 0.05, suppress: 0, dust: 0.25,
    rewireRate: 0.0, rewireJump: 0.0, rewireCrack: 0.0, cellLife: 0.4,
  },
  { // 2. First chains — sparks multiply; short chains of 3-5 cells fire in
    // sequence. More ignition, waves reach a little further, refractory
    // still visible so chains read as sequential.
    name: 'first-chains',
    ignitionRate: 80, diff: 0.45, eps: 12, exA: 0.8, exB: 0.02, vRate: 1.1,
    drive: 0, cellFreq: 9, zoom: 1.2, bloomGain: 0.75, sat: 0.82,
    frontGain: 0.7, refractGlow: 0.5, filament: 0.55, microTex: 0.35,
    warmth: 0.1, suppress: 0, dust: 0.3,
    rewireRate: 0.6, rewireJump: 0.25, rewireCrack: 0.1, cellLife: 0.55,
  },
  { // 3. Wiring up — the build: chains lengthen into travelling waves; target
    // and spiral patterns emerge as excitability climbs; palette warms and
    // saturates. Restraint before the peak (sat/bloom below act 4's max).
    name: 'wiring-up',
    ignitionRate: 110, diff: 0.65, eps: 13, exA: 0.88, exB: 0.02, vRate: 1.2,
    drive: 0, cellFreq: 10, zoom: 1.08, bloomGain: 0.9, sat: 0.9,
    frontGain: 0.85, refractGlow: 0.6, filament: 0.7, microTex: 0.5,
    warmth: 0.2, suppress: 0, dust: 0.3,
    rewireRate: 1.0, rewireJump: 0.45, rewireCrack: 0.3, cellLife: 0.75,
  },
  { // 4. Synchrony — discrete hit at 120s: THE single maximum (bloom/front/
    // filament/sat all peak here, exactly once). A small global drive tips
    // the whole lattice into coordinated auto-firing waves. The back-half
    // scale shift: cellFreq jumps UP and zoom pulls OUT below 1 for the only
    // time in the track — the lattice recedes into a far larger web.
    name: 'synchrony',
    ignitionRate: 70, diff: 0.7, eps: 15, exA: 0.9, exB: 0.02, vRate: 1.3,
    drive: 0.006, cellFreq: 17, zoom: 0.72, bloomGain: 1.0, sat: 1.0,
    frontGain: 1.0, refractGlow: 0.7, filament: 0.95, microTex: 0.6,
    warmth: 0.3, suppress: 0, dust: 0.35,
    rewireRate: 1.5, rewireJump: 0.8, rewireCrack: 0.7, cellLife: 1.0,
  },
  { // 5. Strain — heavy bass, highs drop: waves denser and colliding, hotter
    // and darker; the system straining. Excitability still high but drive
    // off and saturation pulled back into a bruised heat (warmth up), so it
    // reads as tension, not release.
    name: 'strain',
    ignitionRate: 95, diff: 0.6, eps: 14, exA: 0.86, exB: 0.03, vRate: 1.2,
    drive: 0, cellFreq: 15, zoom: 0.85, bloomGain: 0.85, sat: 0.88,
    frontGain: 0.8, refractGlow: 0.75, filament: 0.75, microTex: 0.45,
    warmth: 0.6, suppress: 0, dust: 0.4,
    rewireRate: 1.4, rewireJump: 0.75, rewireCrack: 0.85, cellLife: 0.95,
  },
  { // 6. Fraying — energy leaking: waves lose coherence, excitability drops,
    // dark gaps open in the lattice. Fewer ignitions, slower recharge, dimmer.
    name: 'fraying',
    ignitionRate: 70, diff: 0.45, eps: 12, exA: 0.78, exB: 0.05, vRate: 1.1,
    drive: 0, cellFreq: 14, zoom: 0.92, bloomGain: 0.65, sat: 0.78,
    frontGain: 0.6, refractGlow: 0.65, filament: 0.5, microTex: 0.35,
    warmth: 0.55, suppress: 0, dust: 0.45,
    rewireRate: 0.8, rewireJump: 0.5, rewireCrack: 0.4, cellLife: 0.6,
  },
  { // 7. Collapse — the drop at 204s. The field stays EXCITABLE (exA high, so
    // the un-swept region keeps firing); `suppress` goes to 1 and index.ts
    // grows a de-activation ring across this act's localT that forces u,v to 0
    // inside an ever-expanding disc. Because the disc only grows and the
    // outside stays alive, the darkness sweeps outward cell-by-cell from the
    // origin (the travelling-wave motif inverted) rather than the whole field
    // dimming at once. Ignition holds so the surviving outer ring still glows
    // against the advancing dark — the contrast that makes the sweep read.
    name: 'collapse',
    ignitionRate: 55, diff: 0.5, eps: 13, exA: 0.82, exB: 0.02, vRate: 1.3,
    drive: 0, cellFreq: 12, zoom: 1.0, bloomGain: 0.85, sat: 0.8,
    frontGain: 0.7, refractGlow: 0.65, filament: 0.55, microTex: 0.4,
    warmth: 0.5, suppress: 1, dust: 0.4,
    rewireRate: 0.0, rewireJump: 0.0, rewireCrack: 0.0, cellLife: 0.35,
  },
  { // 8. Cold lattice — fade to silence: one last lonely blip hops on the
    // dark web, then fades. Loop closure back toward act 1's seed (zoom
    // returns close, ignition near zero).
    name: 'cold-lattice',
    ignitionRate: 5, diff: 0.3, eps: 10, exA: 0.66, exB: 0.04, vRate: 1.0,
    drive: 0, cellFreq: 9, zoom: 1.3, bloomGain: 0.45, sat: 0.55,
    frontGain: 0.45, refractGlow: 0.45, filament: 0.3, microTex: 0.15,
    warmth: 0.15, suppress: 0, dust: 0.25,
    rewireRate: 0.0, rewireJump: 0.0, rewireCrack: 0.0, cellLife: 0.3,
  },
];

/**
 * Continuous energy envelope: [t, energy] keys, linearly interpolated. Kept
 * out of ActParams so it moves smoothly across whole acts instead of only
 * inside the 6s boundary crossfades. The near-vertical steps at 120s (an
 * UPWARD step: the synchrony peak locks in) and 204s (a DOWNWARD step: the
 * collapse hits) are deliberate — the two scripted moments land as discrete
 * state changes, not crossfades (ported idiom from a2-hive's ARC_KEYS).
 * Ration the maximum: 1.0 appears once, mid-synchrony; the build (act 3) is
 * held well below it (restraint before the peak). The outro resolves back
 * near the opening level (loop closure).
 */
const ARC_KEYS: [number, number][] = [
  [0, 0.10],
  [30, 0.18],
  [33.8, 0.20],
  [34.3, 0.46],
  [76, 0.52],
  [78, 0.5],
  [116, 0.80],
  [119.8, 0.84],
  [120.3, 0.98],
  [138, 1.0],
  [152, 0.9],
  [188, 0.74],
  [203.6, 0.66],
  [204.3, 0.26],
  [230, 0.14],
  [244, 0.10],
  [259.835, 0.02],
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
