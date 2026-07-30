import { describe, it, expect } from 'vitest';
import { PoissonSchedule, poissonInterArrival } from './poisson';
import { mulberry32 } from '../random';

describe('poissonInterArrival', () => {
  it('returns Infinity for a non-positive rate (never fires, no special-casing needed by callers)', () => {
    expect(poissonInterArrival(() => 0.5, 0)).toBe(Infinity);
    expect(poissonInterArrival(() => 0.5, -3)).toBe(Infinity);
  });

  it('respects maxGapSeconds', () => {
    // rand() close to 1 -> u = 1-rand() close to 0 -> -ln(u) large -> would blow past the clamp.
    const d = poissonInterArrival(() => 0.999999, 1, 10);
    expect(d).toBeLessThanOrEqual(10);
  });

  it('is unclamped by default (b3s original shape)', () => {
    const d = poissonInterArrival(() => 0.999999, 1);
    expect(d).toBeGreaterThan(10);
  });
});

describe('PoissonSchedule', () => {
  it('rescales the countdown when the rate changes rather than latching at a stale near-zero-rate delay', () => {
    const rand = mulberry32(1);
    const sched = new PoissonSchedule();
    let fires = 0;
    const dt = 1 / 60;
    let t = 0;
    // Simulate a 6s crossfade ramping the rate 0 -> 5/min, crossing a
    // near-zero blended rate on the way — the exact bug-class-#2 scenario.
    for (; t < 6; t += dt) {
      const rate = 5 * (t / 6);
      sched.update(dt, rate, rand, () => fires++);
    }
    const afterCrossfade = fires;
    // Continue running at the full settled rate for a while — a latched
    // schedule would stay stuck at 0 fires for the rest of the run.
    for (let i = 0; i < 3600; i++) sched.update(dt, 5, rand, () => fires++);
    expect(fires).toBeGreaterThan(afterCrossfade);
    expect(fires).toBeGreaterThan(3); // roughly the expected density at 5/min over ~66s
  });

  it('a rate sweeping through near-zero and back never produces an absurd delay', () => {
    const rand = mulberry32(2);
    const sched = new PoissonSchedule({ maxGapSeconds: 90 });
    const dt = 1 / 60;
    let t = 0;
    for (; t < 5; t += dt) sched.update(dt, 5, rand, () => {});
    // Near-zero (not exactly 0, so this exercises the rescale path, not the off/reactivate path) for 5s.
    for (; t < 10; t += dt) sched.update(dt, 1e-4, rand, () => {});
    // Back to full rate: time-to-first-fire should be nowhere near the
    // ~1e5s an unclamped, unrescaled schedule would have baked in.
    let fireTime: number | null = null;
    const rampStart = t;
    for (; t < rampStart + 200 && fireTime === null; t += dt) {
      sched.update(dt, 5, rand, () => {
        if (fireTime === null) fireTime = t - rampStart;
      });
    }
    expect(fireTime).not.toBeNull();
    expect(fireTime as unknown as number).toBeLessThan(95);
  });

  it('reactivating from a genuine OFF period fires due-now, not on a stale leftover countdown', () => {
    const rand = mulberry32(3);
    const sched = new PoissonSchedule({ reactivateDueNow: true });
    const dt = 1 / 60;
    let t = 0;
    // Arm a long countdown (mean gap 60s at rate 1/min) then go OFF long
    // enough that, absent the fix, the leftover countdown could easily
    // still be pending when the channel comes back.
    for (; t < 2; t += dt) sched.update(dt, 1, rand, () => {});
    for (; t < 62; t += dt) sched.update(dt, 0, rand, () => {});
    let fired = false;
    sched.update(dt, 30, rand, () => {
      fired = true;
    });
    expect(fired).toBe(true);
  });

  it('mean inter-arrival roughly matches the configured rate', () => {
    const rand = mulberry32(4);
    const sched = new PoissonSchedule();
    const dt = 1 / 60;
    const ratePerMinute = 30; // mean gap 2s
    let fires = 0;
    const total = 600; // 10 minutes -> expect ~300 fires
    for (let t = 0; t < total; t += dt) sched.update(dt, ratePerMinute, rand, () => fires++);
    const expected = total / (60 / ratePerMinute);
    expect(fires).toBeGreaterThan(expected * 0.7);
    expect(fires).toBeLessThan(expected * 1.3);
  });

  it('rate <= 0 turns the channel off without freezing a live countdown at a stale value', () => {
    const rand = mulberry32(5);
    const sched = new PoissonSchedule();
    const dt = 1 / 60;
    let fires = 0;
    for (let t = 0; t < 30; t += dt) sched.update(dt, 0, rand, () => fires++);
    expect(fires).toBe(0);
  });
});
