import { describe, it, expect } from 'vitest';
import { OnsetDetector, rateGapSeconds } from './onset';

/** The synthetic 120bpm kick used by the album's own verification harnesses (b2/b3 fix commits) — a sharp attack decaying over ~56ms, period 0.5s. */
function kick(t: number): number {
  return 0.42 + 0.4 * Math.exp(-((t * 2) % 1) * 9);
}

describe('OnsetDetector', () => {
  it('fires continuously under a sustained synthetic beat (the exact deaf-after-warmup regression)', () => {
    // b2's round-2 bass tuning: the one the album audit explicitly measured
    // to "fire continuously across the full verification run" against this
    // exact synthetic kick (b2's own BASS_ONSET_REL_MARGIN doc). b3's own
    // 0.22 margin is tuned for real music's greater dynamic variance, not
    // this idealized kick specifically — b3's own doc for
    // BASS_ONSET_REL_MARGIN notes 0.22 sits "well above" the ~10.6% ceiling
    // this synthetic kick's fast EMA ever reaches, i.e. by design it can
    // fall silent against this one artificial signal once the reference
    // converges. This test pins the MECHANISM'S regression (a reference
    // slowed to refRate 0.25 with a margin comfortably below the fast EMA's
    // real ceiling keeps firing forever), not one specific act's tuning.
    const det = new OnsetDetector({ refRate: 0.25, relMargin: 0.08, absFloor: 0.06, cooldown: 0.5 });
    const dt = 1 / 60;
    const total = 95; // > 90s, well past where the pre-fix recipe had already gone deaf
    let fast = 0;
    const fireTimes: number[] = [];
    for (let step = 0; step * dt < total; step++) {
      const t = step * dt;
      const prevFast = fast;
      fast += (kick(t) - fast) * Math.min(1, dt * 8);
      if (det.update(dt, fast, prevFast)) fireTimes.push(t);
    }
    const lastThird = fireTimes.filter((t) => t >= (total * 2) / 3);
    expect(fireTimes.length).toBeGreaterThan(10);
    // The regression this pins: the pre-fix detector fired only during the
    // cold-start transient. A healthy detector keeps firing deep into the run.
    expect(lastThird.length).toBeGreaterThan(0);
  });

  it('never fires in silence', () => {
    const det = new OnsetDetector({ refRate: 0.25, relMargin: 0.1, absFloor: 0.05, cooldown: 0.2 });
    const dt = 1 / 60;
    let fast = 0;
    let fired = false;
    for (let step = 0; step * dt < 30; step++) {
      const prevFast = fast;
      fast += (0 - fast) * Math.min(1, dt * 8); // band stays at 0 the whole time
      if (det.update(dt, fast, prevFast)) fired = true;
    }
    expect(fired).toBe(false);
  });

  it('respects its own cooldown floor even under a rapidly re-triggering signal', () => {
    const cooldown = 0.3;
    const det = new OnsetDetector({ refRate: 5, relMargin: 0.01, absFloor: 0.01, cooldown });
    const dt = 1 / 60;
    let fast = 0;
    const fireTimes: number[] = [];
    for (let step = 0; step < 6000; step++) {
      const t = step * dt;
      const prevFast = fast;
      // 5Hz oscillation: many rising edges per second, far faster than the cooldown.
      fast = 0.5 + 0.5 * Math.sin(t * 2 * Math.PI * 5);
      if (det.update(dt, fast, prevFast)) fireTimes.push(t);
    }
    expect(fireTimes.length).toBeGreaterThan(1);
    for (let i = 1; i < fireTimes.length; i++) {
      expect(fireTimes[i] - fireTimes[i - 1]).toBeGreaterThanOrEqual(cooldown - 1e-6);
    }
  });

  it('a rate-derived gap (ratePerMinute) yields roughly the expected density', () => {
    // ratePerMinute=30 -> rateGapSeconds(0.1, 30) = max(0.1, 2) = 2s gap, i.e. ~1 fire every 2s.
    const det = new OnsetDetector({ refRate: 0.25, relMargin: 0.05, absFloor: 0.05, cooldown: 0.1 });
    const ratePerMinute = 30;
    const dt = 1 / 60;
    const total = 120;
    let fast = 0;
    const fireTimes: number[] = [];
    for (let step = 0; step * dt < total; step++) {
      const t = step * dt;
      const prevFast = fast;
      fast += (kick(t) - fast) * Math.min(1, dt * 8);
      if (det.update(dt, fast, prevFast, ratePerMinute)) fireTimes.push(t);
    }
    expect(fireTimes.length).toBeGreaterThan(10);
    const meanGap = (fireTimes[fireTimes.length - 1] - fireTimes[0]) / (fireTimes.length - 1);
    expect(meanGap).toBeGreaterThan(1.5);
    expect(meanGap).toBeLessThan(2.7);
  });

  it('ratePerMinute <= 0 disables firing entirely (an act with rate 0 fires no onset events)', () => {
    const det = new OnsetDetector({ refRate: 0.25, relMargin: 0.05, absFloor: 0.05, cooldown: 0.1 });
    const dt = 1 / 60;
    let fast = 0;
    let fired = false;
    for (let step = 0; step * dt < 30; step++) {
      const t = step * dt;
      const prevFast = fast;
      fast += (kick(t) - fast) * Math.min(1, dt * 8);
      if (det.update(dt, fast, prevFast, 0)) fired = true;
    }
    expect(fired).toBe(false);
  });
});

describe('rateGapSeconds', () => {
  it('floors at floorSeconds even for a very high rate', () => {
    expect(rateGapSeconds(0.5, 6000)).toBe(0.5);
  });

  it('is 60/ratePerMinute once that exceeds the floor', () => {
    expect(rateGapSeconds(0.1, 30)).toBeCloseTo(2, 10);
  });

  it('is Infinity once ratePerMinute is 0 (never re-arms against a dead rate)', () => {
    expect(rateGapSeconds(0.5, 0)).toBe(Infinity);
  });
});
