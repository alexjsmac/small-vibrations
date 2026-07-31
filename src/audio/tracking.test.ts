import { describe, it, expect } from 'vitest';
import {
  RatioScheduler,
  SpeedEstimator,
  TrackLock,
  REFINE_STEPS,
  RATIOS_PER_CYCLE,
  ACQUIRE_VOTES,
  SUSTAIN_VOTES,
  CONFIRM_CYCLES,
  DROP_CYCLES,
  SILENT_DROP_CYCLES,
  SILENCE_LEVEL,
  POSITION_TOLERANCE,
  MAX_NUDGE,
  RATIO_NUDGE,
  MIN_SPAN_SECONDS,
  type CycleInput,
} from './tracking';
import { SPEED_RATIOS } from './dsp';

/** Seconds of new audio between match cycles (match-worker's CYCLE_SECONDS). */
const CYCLE = 1.5;

// ---------------------------------------------------------------------------
// RatioScheduler
// ---------------------------------------------------------------------------

describe('RatioScheduler', () => {
  it('sweeps the coarse grid while searching', () => {
    const s = new RatioScheduler();
    const seen = new Set<number>();
    // Every ratio should be reachable within a full sweep of the grid.
    for (let cycle = 0; cycle < Math.ceil(SPEED_RATIOS.length / RATIOS_PER_CYCLE); cycle++) {
      const batch = s.next();
      expect(batch).toHaveLength(RATIOS_PER_CYCLE);
      for (const r of batch) seen.add(r);
      s.report(batch[0], 0);
    }
    for (const r of SPEED_RATIOS) expect(seen).toContain(r);
  });

  it('starts at nominal speed, so a correct deck matches on the first cycle', () => {
    expect(new RatioScheduler().next()[0]).toBe(1);
  });

  it('re-tests a promising ratio first next cycle', () => {
    const s = new RatioScheduler();
    s.next();
    s.report(1.03, 40); // well over RATIO_HINT_VOTES
    expect(s.next()[0]).toBe(1.03);
  });

  it('forgets the hint when the cycle scored badly', () => {
    const hinted = new RatioScheduler();
    hinted.next();
    hinted.report(1.03, 1); // under RATIO_HINT_VOTES
    // Nothing is prepended, so the batch is just the rotation continuing —
    // identical to a scheduler that never saw a promising ratio at all.
    const plain = new RatioScheduler();
    plain.next();
    plain.report(1.03, 0);
    const batch = hinted.next();
    expect(batch).toEqual(plain.next());
    expect(batch[0]).not.toBe(1.03);
  });

  it('brackets the confirmed ratio, narrowing each cycle, then settles', () => {
    const s = new RatioScheduler();
    s.lock(1.03);
    for (const step of REFINE_STEPS) {
      expect(s.state.kind).toBe('refine');
      const batch = s.next();
      expect(batch).toHaveLength(3);
      expect(batch).toContain(1.03);
      // probes sit symmetrically at ±step
      expect(Math.min(...batch)).toBeCloseTo(1.03 - step, 10);
      expect(Math.max(...batch)).toBeCloseTo(1.03 + step, 10);
      s.report(1.03, 100); // centre wins each time → centre stays put
    }
    expect(s.state).toEqual({ kind: 'lock', ratio: 1.03 });
  });

  it('converges on an off-grid deck speed to within the finest step', () => {
    const truth = 1.0338;
    const s = new RatioScheduler();
    s.lock(1.03); // coarse grid lands 0.38% away
    for (let i = 0; i < REFINE_STEPS.length; i++) {
      const batch = s.next();
      // Whichever probe sits closest to the truth wins the (same-window) vote.
      const winner = batch.reduce((a, b) =>
        Math.abs(b - truth) < Math.abs(a - truth) ? b : a);
      s.report(winner, 100);
    }
    expect(s.state.kind).toBe('lock');
    const settled = s.state.kind === 'lock' ? s.state.ratio : NaN;
    expect(Math.abs(settled - truth)).toBeLessThanOrEqual(REFINE_STEPS[REFINE_STEPS.length - 1]);
    // and far better than the coarse grid it started from
    expect(Math.abs(settled - truth)).toBeLessThan(Math.abs(1.03 - truth));
  });

  it('spends one fingerprint per cycle once locked', () => {
    const s = new RatioScheduler();
    s.setRatio(1.025);
    expect(s.next()).toEqual([1.025]);
    s.report(1.025, 200);
    expect(s.next()).toEqual([1.025]);
  });

  it('adopts a drift-measured ratio without re-refining it', () => {
    const s = new RatioScheduler();
    s.setRatio(1.0315);
    expect(s.state).toEqual({ kind: 'lock', ratio: 1.0315 });
  });

  it('re-acquires from the last good ratio after a drop', () => {
    const s = new RatioScheduler();
    s.lock(1.04);
    s.report(1.04, 100); // refine → narrows, lastGood = 1.04
    s.unlock();
    // It is the same deck: the first thing tried should be what worked before,
    // not a fresh sweep from nominal.
    expect(s.next()[0]).toBe(1.04);
  });

  it('drops the remembered ratio on a full reset', () => {
    const s = new RatioScheduler();
    s.lock(1.04);
    s.reset();
    expect(s.next()[0]).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// SpeedEstimator
// ---------------------------------------------------------------------------

/** One offset bin of position quantization (2 frames at 12 kHz / 512 hop). */
const BIN = (2 * 512) / 12000;
/** Cycles needed to clear both the sample count and the span requirement. */
const FIT_CYCLES = 62;

/** Feed `n` cycles of a deck running at `speed`, 1.5 s apart. */
function feed(est: SpeedEstimator, speed: number, n: number, quantize = 0) {
  for (let i = 0; i < n; i++) {
    const wall = 100 + i * CYCLE;
    const pos = 30 + i * CYCLE * speed;
    est.add(wall, quantize ? Math.round(pos / quantize) * quantize : pos);
  }
}

describe('SpeedEstimator', () => {
  it('withholds an estimate until the fit is trustworthy', () => {
    const est = new SpeedEstimator();
    expect(est.estimate()).toBeNull();
    feed(est, 1.03, 4);
    expect(est.estimate()).toBeNull(); // too few samples, too short a span
    feed(est, 1.03, 20);
    expect(est.estimate()).toBeNull(); // 30 s of span still isn't enough
  });

  it('recovers a clean slope exactly', () => {
    const est = new SpeedEstimator();
    feed(est, 1.034, FIT_CYCLES);
    expect(est.estimate()!).toBeCloseTo(1.034, 6);
  });

  it('stays inside its quantization bound on an adversarial staircase', () => {
    // Quantizing a smooth ramp is *correlated* error, not noise: it does not
    // average down with sample count, and when the per-cycle step lands near a
    // whole number of bins the staircase is perfectly periodic. 1.0203 is one
    // such case — its steps alias to exactly 18 bins, reading as 1.024 over a
    // short baseline. Only a long baseline fixes it.
    const bound = (1.5 * BIN) / MIN_SPAN_SECONDS;
    for (const truth of [0.972, 1.0, 1.0185, 1.0203, 1.0338, 1.041]) {
      const est = new SpeedEstimator();
      feed(est, truth, FIT_CYCLES, BIN);
      const got = est.estimate();
      expect(got).not.toBeNull();
      expect(Math.abs(got! - truth)).toBeLessThanOrEqual(bound);
    }
  });

  it('never reports drift big enough to act on when the deck is steady', () => {
    // The guarantee that matters: a rock-steady deck must not produce a
    // correction, or the tracker would chase its own quantization forever.
    for (const truth of [0.972, 1.0, 1.0185, 1.0203, 1.0338, 1.041]) {
      const est = new SpeedEstimator();
      feed(est, truth, FIT_CYCLES, BIN);
      expect(Math.abs(est.estimate()! - truth)).toBeLessThan(RATIO_NUDGE);
    }
  });

  it('is far finer than the 1% acquisition grid it replaces', () => {
    const est = new SpeedEstimator();
    feed(est, 1.0338, FIT_CYCLES, BIN);
    // The grid could only ever say 1.03; the fit should do much better.
    expect(Math.abs(est.estimate()! - 1.0338)).toBeLessThan(Math.abs(1.03 - 1.0338));
  });

  it('rejects an implausible fit rather than reporting nonsense', () => {
    const est = new SpeedEstimator();
    feed(est, 1.8, FIT_CYCLES); // a needle drop mid-fit, not a fast deck
    expect(est.estimate()).toBeNull();
  });

  it('ages samples out of the fit window', () => {
    const est = new SpeedEstimator(150);
    feed(est, 1.03, 300); // 450 s of cycles
    expect(est.size).toBeLessThanOrEqual(Math.ceil(150 / CYCLE) + 1);
  });

  it('forgets everything on reset', () => {
    const est = new SpeedEstimator();
    feed(est, 1.03, FIT_CYCLES);
    est.reset();
    expect(est.size).toBe(0);
    expect(est.estimate()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// TrackLock
// ---------------------------------------------------------------------------

function cyc(over: Partial<CycleInput> = {}): CycleInput {
  return {
    now: 0,
    trackIndex: 0,
    votes: 100,
    runnerUpVotes: 5,
    position: 30,
    ratio: 1,
    level: 0.1,
    ...over,
  };
}

/** Drive a clean lock onto `track` and return the wall clock afterwards. */
function acquire(lock: TrackLock, track = 0, ratio = 1, start = 100): number {
  let now = start;
  for (let i = 0; i < CONFIRM_CYCLES; i++) {
    lock.observe(cyc({ now, trackIndex: track, position: 30 + i * CYCLE * ratio, ratio }));
    now += CYCLE;
  }
  expect(lock.trackIndex).toBe(track);
  return now;
}

describe('TrackLock — acquiring', () => {
  it('needs consecutive agreeing cycles at the full bar', () => {
    const lock = new TrackLock();
    const first = lock.observe(cyc({ now: 100 }));
    expect(first.event).toBeNull();
    const second = lock.observe(cyc({ now: 101.5, position: 31.5 }));
    expect(second.event).toBe('confirm');
    expect(lock.trackIndex).toBe(0);
  });

  it('refuses a cycle under the vote bar', () => {
    const lock = new TrackLock();
    for (let i = 0; i < 6; i++) {
      lock.observe(cyc({ now: 100 + i * CYCLE, votes: ACQUIRE_VOTES - 1, runnerUpVotes: 0 }));
    }
    expect(lock.trackIndex).toBeNull();
  });

  it('refuses a cycle without a clear margin over the runner-up', () => {
    const lock = new TrackLock();
    for (let i = 0; i < 6; i++) {
      lock.observe(cyc({ now: 100 + i * CYCLE, votes: 30, runnerUpVotes: 20 }));
    }
    expect(lock.trackIndex).toBeNull();
  });

  it('resets the run when the winning track changes between cycles', () => {
    const lock = new TrackLock();
    lock.observe(cyc({ now: 100, trackIndex: 0 }));
    lock.observe(cyc({ now: 101.5, trackIndex: 1 }));
    expect(lock.trackIndex).toBeNull(); // neither reached CONFIRM_CYCLES
  });

  it('sends the confirmed ratio for refinement, since it came off the coarse grid', () => {
    const lock = new TrackLock();
    lock.observe(cyc({ now: 100, ratio: 1.03 }));
    const up = lock.observe(cyc({ now: 101.5, position: 31.5, ratio: 1.03 }));
    expect(up.speed).toEqual({ kind: 'lock', ratio: 1.03, refine: true });
  });

  it('cannot be won by a sustain-level cycle alone', () => {
    const lock = new TrackLock();
    for (let i = 0; i < 10; i++) {
      lock.observe(cyc({ now: 100 + i * CYCLE, votes: SUSTAIN_VOTES, runnerUpVotes: 0, position: 30 + i * CYCLE }));
    }
    expect(lock.trackIndex).toBeNull();
  });
});

describe('TrackLock — holding', () => {
  it('holds on few votes when the position lands where predicted', () => {
    const lock = new TrackLock();
    const now = acquire(lock);
    const up = lock.observe(cyc({ now, position: lock.predict(now), votes: SUSTAIN_VOTES, runnerUpVotes: SUSTAIN_VOTES }));
    expect(up.held).toBe(true);
    expect(lock.misses).toBe(0);
    expect(lock.trackIndex).toBe(0);
  });

  it('rejects a low-vote cycle whose position is nowhere near the prediction', () => {
    const lock = new TrackLock();
    const now = acquire(lock);
    const up = lock.observe(cyc({
      now,
      position: lock.predict(now) + POSITION_TOLERANCE * 10,
      votes: SUSTAIN_VOTES,
      runnerUpVotes: SUSTAIN_VOTES,
    }));
    expect(up.held).toBe(false);
    expect(lock.misses).toBe(1);
  });

  it('re-anchors to a moved needle only at the full acquisition bar', () => {
    const lock = new TrackLock();
    const now = acquire(lock);
    const up = lock.observe(cyc({ now, position: 180, votes: 90, runnerUpVotes: 3 }));
    expect(up.held).toBe(true);
    expect(lock.position).toBe(180);
    expect(lock.predict(now)).toBeCloseTo(180, 6);
  });

  it('survives a sparse passage that the old absolute vote gate would have dropped', () => {
    const lock = new TrackLock();
    let now = acquire(lock);
    // Ten cycles of thin-but-consistent evidence — under the acquisition bar.
    for (let i = 0; i < 10; i++) {
      lock.observe(cyc({
        now,
        position: lock.predict(now),
        votes: ACQUIRE_VOTES - 5,
        runnerUpVotes: ACQUIRE_VOTES - 5,
      }));
      now += CYCLE;
    }
    expect(lock.trackIndex).toBe(0);
    expect(lock.misses).toBe(0);
  });
});

describe('TrackLock — coasting and dropping', () => {
  it('carries the visuals through a long run of misses before giving up', () => {
    const lock = new TrackLock();
    let now = acquire(lock);
    for (let i = 0; i < DROP_CYCLES - 1; i++) {
      const up = lock.observe(cyc({ now, trackIndex: null, votes: 0, position: null }));
      expect(up.event).toBeNull();
      expect(lock.trackIndex).toBe(0);
      expect(lock.coasting).toBe(true);
      now += CYCLE;
    }
    expect(lock.observe(cyc({ now, trackIndex: null, votes: 0, position: null })).event).toBe('drop');
    expect(lock.trackIndex).toBeNull();
  });

  it('coasts for far longer than the old four-cycle drop', () => {
    expect(DROP_CYCLES * CYCLE).toBeGreaterThan(15);
  });

  it('keeps extrapolating position while coasting', () => {
    const lock = new TrackLock();
    const now = acquire(lock, 0, 1.03);
    lock.observe(cyc({ now, trackIndex: null, votes: 0, position: null }));
    // A fast deck advances the track's own clock faster than wall time, and
    // during a coast this extrapolation is the only clock the visuals have.
    expect(lock.predict(now + 10) - lock.predict(now)).toBeCloseTo(10 * 1.03, 6);
    expect(lock.speed).toBeCloseTo(1.03, 6);
  });

  it('recovers without a drop when the signal comes back mid-coast', () => {
    const lock = new TrackLock();
    let now = acquire(lock);
    for (let i = 0; i < DROP_CYCLES - 2; i++) {
      lock.observe(cyc({ now, trackIndex: null, votes: 0, position: null }));
      now += CYCLE;
    }
    expect(lock.coasting).toBe(true);
    const up = lock.observe(cyc({ now, position: lock.predict(now), votes: SUSTAIN_VOTES }));
    expect(up.held).toBe(true);
    expect(lock.misses).toBe(0);
    expect(lock.coasting).toBe(false);
  });

  it('gives up quickly once the input goes silent — the needle was lifted', () => {
    const lock = new TrackLock();
    let now = acquire(lock);
    let dropped = false;
    for (let i = 0; i < SILENT_DROP_CYCLES; i++) {
      const up = lock.observe(cyc({
        now, trackIndex: null, votes: 0, position: null, level: SILENCE_LEVEL / 2,
      }));
      dropped ||= up.event === 'drop';
      now += CYCLE;
    }
    expect(dropped).toBe(true);
    expect(SILENT_DROP_CYCLES).toBeLessThan(DROP_CYCLES);
  });

  it('releases the speed lock on drop so the worker re-searches', () => {
    const lock = new TrackLock();
    let now = acquire(lock, 0, 1.03);
    let speed: unknown = null;
    for (let i = 0; i < DROP_CYCLES; i++) {
      speed = lock.observe(cyc({ now, trackIndex: null, votes: 0, position: null })).speed ?? speed;
      now += CYCLE;
    }
    expect(speed).toEqual({ kind: 'unlock' });
  });

  it('switches tracks on two full-bar cycles for a different track', () => {
    const lock = new TrackLock();
    let now = acquire(lock, 0);
    lock.observe(cyc({ now, trackIndex: 3, position: 2 }));
    now += CYCLE;
    const up = lock.observe(cyc({ now, trackIndex: 3, position: 3.5 }));
    expect(up.event).toBe('confirm');
    expect(lock.trackIndex).toBe(3);
  });
});

describe('TrackLock — following deck drift', () => {
  /**
   * Play `n` held cycles of a deck truly running at `truth`, continuing from
   * wherever the lock is anchored so the position stream stays continuous (a
   * gap would read as a moved needle and reset the fit).
   */
  function play(lock: TrackLock, truth: number, n: number) {
    const commands: number[] = [];
    let now = lock.anchorWall;
    let pos = lock.position;
    for (let i = 0; i < n; i++) {
      now += CYCLE;
      pos += CYCLE * truth;
      const up = lock.observe(cyc({
        now,
        position: Math.round(pos / BIN) * BIN,
        votes: 80,
        runnerUpVotes: 4,
        ratio: lock.ratio,
      }));
      expect(up.held).toBe(true); // the fit only advances on held cycles
      if (up.speed?.kind === 'lock') commands.push(up.speed.ratio);
    }
    return commands;
  }

  it('measures the deck and corrects a coarse-grid lock toward the truth', () => {
    const lock = new TrackLock();
    acquire(lock, 0, 1.03);            // grid says 1.03…
    const commands = play(lock, 1.0345, FIT_CYCLES); // …deck is really at 1.0345
    expect(commands.length).toBeGreaterThan(0);
    // The correction must move toward the truth, never away from it.
    expect(Math.abs(lock.ratio - 1.0345)).toBeLessThan(Math.abs(1.03 - 1.0345));
    expect(Math.abs(lock.speed - 1.0345)).toBeLessThan(RATIO_NUDGE);
  });

  it('converges onto a drifting deck over successive fits', () => {
    const lock = new TrackLock();
    acquire(lock, 0, 1.0);
    // 1% away — further than one clamped correction can travel, so this only
    // succeeds if the loop keeps re-measuring and stepping.
    for (let round = 0; round < 6; round++) play(lock, 1.01, FIT_CYCLES);
    expect(Math.abs(lock.ratio - 1.01)).toBeLessThan(RATIO_NUDGE);
  });

  it('sends drift corrections as settled ratios, not for re-refinement', () => {
    const lock = new TrackLock();
    acquire(lock, 0, 1.03);
    let sawDrift = false;
    let now = lock.anchorWall, pos = lock.position;
    for (let i = 0; i < FIT_CYCLES; i++) {
      now += CYCLE;
      pos += CYCLE * 1.0345;
      const up = lock.observe(cyc({
        now, position: Math.round(pos / BIN) * BIN, votes: 80, runnerUpVotes: 4, ratio: lock.ratio,
      }));
      if (up.speed?.kind === 'lock' && up.speed.refine === false) sawDrift = true;
    }
    expect(sawDrift).toBe(true);
  });

  it('leaves a steady deck alone instead of chasing quantization', () => {
    // 1.0203 is the aliasing case that reads as 1.024 over a short baseline —
    // acting on it would knock a perfectly good lock 0.4% off.
    for (const truth of [1.0203, 1.0, 0.9805]) {
      const lock = new TrackLock();
      acquire(lock, 0, truth);
      expect(play(lock, truth, FIT_CYCLES * 2)).toHaveLength(0);
    }
  });

  it('clamps each correction so one bad fit cannot throw the lock', () => {
    const lock = new TrackLock();
    acquire(lock, 0, 1.0);
    let prev = 1.0;
    for (const c of play(lock, 1.05, FIT_CYCLES * 3)) {
      expect(Math.abs(c - prev)).toBeLessThanOrEqual(MAX_NUDGE + 1e-9);
      prev = c;
    }
  });

  it('does not chase drift while coasting on missed cycles', () => {
    const lock = new TrackLock();
    let now = acquire(lock, 0, 1.03);
    for (let i = 0; i < DROP_CYCLES - 1; i++) {
      const up = lock.observe(cyc({ now, trackIndex: null, votes: 0, position: null }));
      expect(up.speed).toBeNull();
      now += CYCLE;
    }
  });
});
