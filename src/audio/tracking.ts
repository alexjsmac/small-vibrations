/**
 * Lock-holding logic for the matcher: which candidate ratios to fingerprint,
 * what counts as a hit once a track is playing, how fast the deck is *actually*
 * running, and when to finally give up.
 *
 * All pure — data in, decisions out — because the two places this logic would
 * otherwise live (AudioEngine, match-worker) can't be unit-tested at all
 * (Worker + import.meta). The reliability rules belong somewhere with tests.
 *
 * ## Why any of this exists
 *
 * Acquisition already searches playback speed (SPEED_RATIOS, ±6% on a 1% grid).
 * Holding the lock afterwards is a different problem. Votes fall off a cliff as
 * the *residual* speed error grows — measured through this pipeline, median /
 * worst-window votes for a 12 s query:
 *
 * | residual | 0% | 0.25% | 0.5% | 0.75% | 1.0% | 1.5% |
 * |----------|-----|-------|------|-------|------|------|
 * | median   | 198 | 142   | 100  | 49    | 23   | 7    |
 * | worst    | 155 | 80    | 26   | 31    | 9    | 3    |
 *
 * A coarse 1%-grid lock starts with up to 0.5% residual already spent, which
 * leaves a worst-case margin of ~26 votes against a gate of 12. Half a percent
 * of ordinary deck drift — belt tension, a warming platter, stylus drag — and
 * the match collapses. That is the whole failure mode this module fixes:
 *
 *  1. `RatioScheduler` refines the coarse lock to ~0.1% over three cycles.
 *  2. `SpeedEstimator` then measures the deck's true speed from the slope of
 *     reported position against wall time, and `TrackLock` nudges the
 *     correction to follow drift indefinitely.
 *  3. `TrackLock` scores cycles against the *predicted* position, so holding a
 *     lock needs far fewer votes than winning one.
 *  4. `RatioScheduler` keeps the last good ratio across a drop, so re-acquiring
 *     the same deck costs a cycle or two instead of a full sweep.
 */

import { SPEED_RATIOS } from './dsp';

// ---------------------------------------------------------------------------
// Candidate playback ratios
// ---------------------------------------------------------------------------

/** Ratios to fingerprint in one cycle while unlocked. Each costs a full pass. */
export const RATIOS_PER_CYCLE = 3;
/**
 * Votes at which a ratio is worth re-testing next cycle instead of rotating
 * past it. Deliberately loose — TrackLock owns the real gate; this only decides
 * where to spend the next cycle's budget. Without it, rotation would test a
 * different ratio each cycle and the consecutive-agreement rule could never be
 * satisfied on an off-speed deck.
 */
export const RATIO_HINT_VOTES = 10;
/**
 * Half-widths for the post-lock local search, coarsest first. The first must
 * bracket the 1% grid's worst-case 0.5% quantization error; the last sets the
 * residual we settle at (~0.125%), which buys roughly 4x the vote margin of a
 * raw grid lock. Three cycles, and each comparison happens within a single
 * window so the votes are directly comparable.
 */
export const REFINE_STEPS: readonly number[] = [0.005, 0.0025, 0.00125];

export type SpeedMode =
  /** Sweeping the coarse grid for a track. */
  | { kind: 'search' }
  /** Local search around a just-confirmed ratio. */
  | { kind: 'refine'; center: number; stepIndex: number }
  /** Settled; one fingerprint per cycle. */
  | { kind: 'lock'; ratio: number };

/**
 * Picks the candidate ratios for each match cycle and walks the
 * search → refine → lock progression.
 */
export class RatioScheduler {
  private mode: SpeedMode = { kind: 'search' };
  private cursor = 0;
  private hint: number | null = null;
  /**
   * Ratio of the last confirmed lock. It is the same deck after a dropout, so
   * re-acquisition starts here rather than back at nominal.
   */
  private lastGood: number | null = null;

  get state(): SpeedMode {
    return this.mode;
  }

  /** Ratios to fingerprint this cycle, best-first. */
  next(): number[] {
    const m = this.mode;
    if (m.kind === 'lock') return [m.ratio];
    if (m.kind === 'refine') {
      const step = REFINE_STEPS[m.stepIndex];
      return [m.center, m.center - step, m.center + step];
    }
    const batch: number[] = [];
    const seed = this.hint ?? this.lastGood;
    if (seed !== null) batch.push(seed);
    while (batch.length < RATIOS_PER_CYCLE) {
      const ratio = SPEED_RATIOS[this.cursor % SPEED_RATIOS.length];
      this.cursor++;
      if (!batch.includes(ratio)) batch.push(ratio);
    }
    return batch;
  }

  /** Feed back the winning ratio of the cycle `next()` just produced. */
  report(ratio: number, votes: number) {
    const m = this.mode;
    if (m.kind === 'search') {
      this.hint = votes >= RATIO_HINT_VOTES ? ratio : null;
    } else if (m.kind === 'refine') {
      // Narrow around whichever probe won, then settle.
      const stepIndex = m.stepIndex + 1;
      this.mode = stepIndex < REFINE_STEPS.length
        ? { kind: 'refine', center: ratio, stepIndex }
        : { kind: 'lock', ratio };
      this.lastGood = ratio;
    }
  }

  /** A track was confirmed at `ratio` — refine it before settling. */
  lock(ratio: number) {
    this.lastGood = ratio;
    this.mode = { kind: 'refine', center: ratio, stepIndex: 0 };
  }

  /** Adopt a ratio measured from drift, bypassing the local search. */
  setRatio(ratio: number) {
    this.lastGood = ratio;
    this.mode = { kind: 'lock', ratio };
  }

  /** Lock lost. Resume searching, seeded by the last ratio that worked. */
  unlock() {
    this.mode = { kind: 'search' };
    this.hint = null;
    this.cursor = 0;
  }

  reset() {
    this.unlock();
    this.lastGood = null;
  }
}

// ---------------------------------------------------------------------------
// Deck speed from position drift
// ---------------------------------------------------------------------------

/**
 * Samples must span at least this long before the slope is trustworthy.
 *
 * Position is quantized to one offset bin (~85 ms), and that error is *not*
 * independent per sample — quantizing a smooth ramp produces a staircase whose
 * error is strongly correlated, so it does not average down with sample count.
 * The worst-case slope error of a least-squares fit is 1.5·bin/span, which is
 * 0.7% at 18 s (uselessly coarse — larger than the whole drift budget) and
 * 0.14% at 90 s. That has to stay well under RATIO_NUDGE or the tracker would
 * chase its own quantization; 90 s gives a ~2x margin.
 *
 * Being slow is fine. RatioScheduler's local search already lands the lock at
 * ~0.125% residual, so this loop only has to catch drift that accumulates over
 * minutes, not to acquire anything.
 */
export const MIN_SPAN_SECONDS = 90;
const MIN_SAMPLES = 30;
/** Sanity bounds — anything outside this is a bad fit, not a fast deck. */
const MIN_PLAUSIBLE = 0.9;
const MAX_PLAUSIBLE = 1.1;

/**
 * Measures the deck's true playback speed from the reported track position.
 *
 * A successful match reports where the needle is in the track's own timeline,
 * so position advances at exactly the deck's speed per wall-clock second —
 * independent of whatever correction ratio produced the match. The slope of
 * position against wall time *is* the deck speed, no reference needed.
 *
 * Position carries about ±43 ms of offset-bin quantization, so the fit needs a
 * long baseline to be worth acting on — see MIN_SPAN_SECONDS, which is the
 * subtle part of this class.
 */
export class SpeedEstimator {
  private wall: number[] = [];
  private pos: number[] = [];

  constructor(private readonly spanSeconds = 150) {}

  get size(): number {
    return this.wall.length;
  }

  reset() {
    this.wall.length = 0;
    this.pos.length = 0;
  }

  add(wallSeconds: number, positionSeconds: number) {
    this.wall.push(wallSeconds);
    this.pos.push(positionSeconds);
    // Drop samples that have aged out of the fit window.
    const cutoff = wallSeconds - this.spanSeconds;
    let drop = 0;
    while (drop < this.wall.length && this.wall[drop] < cutoff) drop++;
    if (drop > 0) {
      this.wall.splice(0, drop);
      this.pos.splice(0, drop);
    }
  }

  /** Least-squares slope, or null when the fit isn't yet trustworthy. */
  estimate(): number | null {
    const n = this.wall.length;
    if (n < MIN_SAMPLES) return null;
    const span = this.wall[n - 1] - this.wall[0];
    if (span < MIN_SPAN_SECONDS) return null;

    let sw = 0, sp = 0;
    for (let i = 0; i < n; i++) { sw += this.wall[i]; sp += this.pos[i]; }
    const mw = sw / n, mp = sp / n;
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) {
      const dw = this.wall[i] - mw;
      num += dw * (this.pos[i] - mp);
      den += dw * dw;
    }
    if (den === 0) return null;
    const slope = num / den;
    if (!Number.isFinite(slope) || slope < MIN_PLAUSIBLE || slope > MAX_PLAUSIBLE) return null;
    return slope;
  }
}

// ---------------------------------------------------------------------------
// Holding the lock
// ---------------------------------------------------------------------------

/** Votes + margin needed to win a lock from nothing. */
export const ACQUIRE_VOTES = 12;
export const ACQUIRE_MARGIN = 2.0;
/** Consecutive agreeing cycles before announcing a (new) track. */
export const CONFIRM_CYCLES = 2;
/**
 * Votes needed to *hold* a lock when the position also lands where we predicted
 * it would. Far below the acquisition bar on purpose: "this is the track we're
 * already playing, at the exact spot we expected" is overwhelmingly stronger
 * evidence than a raw vote count, so a sparse or noisy window shouldn't cost us
 * the lock. Winning a lock still needs the full bar.
 */
export const SUSTAIN_VOTES = 5;
/**
 * How far the reported position may sit from prediction and still count as the
 * same continuous playback. Generous against the ±43 ms of bin quantization,
 * but far shorter than any musical self-similarity that could alias.
 */
export const POSITION_TOLERANCE = 0.75;
/** Missed cycles before dropping while the input still carries signal. */
export const DROP_CYCLES = 13;
/** Missed cycles before dropping once the input has gone quiet. */
export const SILENT_DROP_CYCLES = 2;
/**
 * RMS below which the matcher's input counts as silence — the needle was
 * lifted or the side ended, so there is nothing to coast towards.
 *
 * Set low (~-62 dBFS) on purpose. Vinyl surface noise on a direct feed sits
 * above this, a lifted stylus and a muted interface sit well below, and the two
 * ways of being wrong are not symmetric: too low merely falls back to the
 * ordinary 20 s coast, while too high withdraws the visuals during a quiet
 * passage — the exact thing this module exists to stop.
 */
export const SILENCE_LEVEL = 0.0008;
/**
 * Ignore drift corrections smaller than this — below it we'd be chasing the
 * estimator's own quantization error (worst case 0.14% at MIN_SPAN_SECONDS).
 * Tolerating up to 0.3% of uncorrected drift on top of the ~0.125% the local
 * search leaves still sits far inside the ~1% cliff.
 */
export const RATIO_NUDGE = 0.003;
/** Cap on a single drift correction, so one bad fit can't throw the lock. */
export const MAX_NUDGE = 0.004;

export interface CycleInput {
  /** Monotonic wall-clock seconds. */
  now: number;
  /** Best-scoring track this cycle, or null for an empty window. */
  trackIndex: number | null;
  votes: number;
  /** Votes of the best bin belonging to a *different* track. */
  runnerUpVotes: number;
  /** Track-time seconds at the end of the analyzed window. */
  position: number | null;
  /** Playback ratio this result came from. */
  ratio: number;
  /** RMS of the audio reaching the matcher. */
  level: number;
}

export interface LockUpdate {
  /** State change to announce, if any. */
  event: 'confirm' | 'drop' | null;
  /**
   * New speed directive for the worker, if it changed this cycle. `refine`
   * distinguishes a fresh confirm (whose ratio came off the coarse 1% grid and
   * needs the local search) from a drift correction (already measured to well
   * under 0.1%, so it settles immediately).
   */
  speed: { kind: 'lock'; ratio: number; refine: boolean } | { kind: 'unlock' } | null;
  /** Whether this cycle counted as a hit for the current track. */
  held: boolean;
}

/**
 * Decides what a match cycle means for the currently-playing track.
 *
 * Asymmetric by design: winning a lock is hard (full vote bar, a 2x margin over
 * the runner-up, two consecutive cycles), holding one is easy (a handful of
 * votes at the predicted position), and losing one is slow (~20 s of misses, or
 * ~3 s once the input goes silent). Between them that keeps the visuals up
 * through the sparse passages and momentary dropouts that used to withdraw
 * them, without making it any easier to latch onto the wrong track.
 */
export class TrackLock {
  /** Confirmed track, or null while listening. */
  trackIndex: number | null = null;
  /** Track-time position at `anchorWall`. */
  position = 0;
  /** Wall-clock seconds at which `position` was set. */
  anchorWall = 0;
  votes = 0;
  /** Best estimate of the deck's playback speed (1 = nominal). */
  speed = 1;
  /** Correction ratio currently commanded to the worker. */
  ratio = 1;
  /** Consecutive missed cycles since the last hit. */
  misses = 0;
  /** True while the lock is being held open on extrapolation alone. */
  get coasting(): boolean {
    return this.trackIndex !== null && this.misses > 0;
  }

  private candidate: number | null = null;
  private hits = 0;
  private lastRatio = 1;
  private readonly estimator = new SpeedEstimator();

  /** Where the needle should be right now, by extrapolation. */
  predict(now: number): number {
    return this.position + (now - this.anchorWall) * this.speed;
  }

  reset() {
    this.trackIndex = null;
    this.position = 0;
    this.anchorWall = 0;
    this.votes = 0;
    this.speed = 1;
    this.ratio = 1;
    this.misses = 0;
    this.candidate = null;
    this.hits = 0;
    this.lastRatio = 1;
    this.estimator.reset();
  }

  observe(c: CycleInput): LockUpdate {
    // A changed correction ratio shifts the reported position by up to a bin,
    // so the fit has to start over. This also keeps the estimator empty through
    // the refine cycles, where the ratio moves every cycle by design.
    if (c.ratio !== this.lastRatio) {
      this.estimator.reset();
      this.lastRatio = c.ratio;
    }

    const acquired =
      c.trackIndex !== null &&
      c.votes >= ACQUIRE_VOTES &&
      c.votes >= c.runnerUpVotes * ACQUIRE_MARGIN;

    // Holding: same track, roughly where we predicted, a few votes. Requires an
    // established anchor, so it can never be the thing that wins a lock.
    const sustained =
      this.trackIndex !== null &&
      c.trackIndex === this.trackIndex &&
      c.position !== null &&
      c.votes >= SUSTAIN_VOTES &&
      Math.abs(c.position - this.predict(c.now)) <= POSITION_TOLERANCE;

    if (sustained) return this.hold(c, /* continuous */ true);
    if (acquired && c.trackIndex === this.trackIndex) {
      // Same track, but the position disagrees — the needle was moved. Trust it
      // only at the full acquisition bar, and restart the speed fit.
      return this.hold(c, /* continuous */ false);
    }
    if (acquired) return this.acquire(c);
    return this.miss(c);
  }

  /** A hit for the track already locked: re-anchor and feed the speed fit. */
  private hold(c: CycleInput, continuous: boolean): LockUpdate {
    this.misses = 0;
    this.hits = 0;
    this.candidate = this.trackIndex;
    this.votes = c.votes;
    this.position = c.position ?? this.position;
    this.anchorWall = c.now;
    if (!continuous) {
      this.estimator.reset();
      return { event: null, speed: null, held: true };
    }
    this.estimator.add(c.now, this.position);
    return { event: null, speed: this.trackSpeed(), held: true };
  }

  /** Follow deck drift: adopt the measured speed once it has moved enough. */
  private trackSpeed(): LockUpdate['speed'] {
    const measured = this.estimator.estimate();
    if (measured === null) return null;
    this.speed = measured;
    const delta = measured - this.ratio;
    if (Math.abs(delta) < RATIO_NUDGE) return null;
    const clamped = Math.max(-MAX_NUDGE, Math.min(MAX_NUDGE, delta));
    this.ratio = this.ratio + clamped;
    // The next cycle arrives under a new correction, so the fit restarts.
    this.estimator.reset();
    return { kind: 'lock', ratio: this.ratio, refine: false };
  }

  /** A cycle clearing the full bar for some track that isn't locked. */
  private acquire(c: CycleInput): LockUpdate {
    const t = c.trackIndex!;
    this.misses = 0;
    this.hits = t === this.candidate ? this.hits + 1 : 1;
    this.candidate = t;
    if (this.hits < CONFIRM_CYCLES) return { event: null, speed: null, held: false };

    this.trackIndex = t;
    this.position = c.position ?? 0;
    this.anchorWall = c.now;
    this.votes = c.votes;
    this.ratio = c.ratio;
    this.speed = c.ratio;
    this.estimator.reset();
    return { event: 'confirm', speed: { kind: 'lock', ratio: c.ratio, refine: true }, held: true };
  }

  /** Nothing usable this cycle. Coast, then eventually give up. */
  private miss(c: CycleInput): LockUpdate {
    this.hits = 0;
    if (this.trackIndex === null) {
      this.candidate = null;
      return { event: null, speed: null, held: false };
    }
    this.misses++;
    const limit = c.level < SILENCE_LEVEL ? SILENT_DROP_CYCLES : DROP_CYCLES;
    if (this.misses < limit) return { event: null, speed: null, held: false };

    this.reset();
    return { event: 'drop', speed: { kind: 'unlock' }, held: false };
  }
}
