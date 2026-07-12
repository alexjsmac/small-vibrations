import { describe, it, expect } from 'vitest';
import { paramsAt, arcAt, CUES, ACTS } from './sections';

describe('a2-hive sections', () => {
  it('starts at act 0 with localT 0 and blend 0', () => {
    const s = paramsAt(0);
    expect(s.actIndex).toBe(0);
    expect(s.localT).toBe(0);
    expect(s.blend).toBe(0);
  });

  it('is mid-crossfade a few seconds before a boundary', () => {
    const boundary = CUES[1]; // 54
    const s = paramsAt(boundary - 3);
    expect(s.blend).toBeGreaterThan(0);
    expect(s.blend).toBeLessThan(1);
  });

  it('keeps localT within [0, 1] across a full sweep', () => {
    const totalEnd = CUES[CUES.length - 1];
    for (let t = 0; t <= totalEnd; t += 1.7) {
      const s = paramsAt(t);
      expect(s.localT).toBeGreaterThanOrEqual(0);
      expect(s.localT).toBeLessThanOrEqual(1);
    }
  });

  it('does not throw for t beyond the last cue, and clamps to the final act', () => {
    const totalEnd = CUES[CUES.length - 1];
    expect(() => paramsAt(totalEnd + 1000)).not.toThrow();
    const s = paramsAt(totalEnd + 1000);
    expect(s.actIndex).toBe(ACTS.length - 1);
    expect(s.blend).toBe(0);
  });

  it('does not throw for negative t, and clamps to the first act', () => {
    expect(() => paramsAt(-10)).not.toThrow();
    const s = paramsAt(-10);
    expect(s.actIndex).toBe(0);
    expect(s.localT).toBe(0);
  });

  it('two-homes-one-wall (the climax) is the single maximum for shimmer, and settling-in/housewarming are restrained by comparison', () => {
    // Arc discipline check (plan §3): shimmer 1.0 appears exactly once, at
    // the climax act — every other act's shimmer sits well below it.
    const climax = ACTS.find((a) => a.name === 'two-homes-one-wall')!;
    expect(climax.shimmer).toBe(1.0);
    for (const act of ACTS) {
      if (act.name === 'two-homes-one-wall') continue;
      expect(act.shimmer).toBeLessThan(1.0);
    }
  });
});

describe('a2-hive arcAt', () => {
  it('is well-shaped (all fields in [0,1]) across a full sweep, without throwing', () => {
    const totalEnd = CUES[CUES.length - 1];
    for (let t = -10; t <= totalEnd + 1000; t += 2.3) {
      const a = arcAt(t);
      for (const key of ['hexBuild', 'roomBuild', 'dim', 'macro', 'settle', 'energy'] as const) {
        expect(a[key]).toBeGreaterThanOrEqual(0);
        expect(a[key]).toBeLessThanOrEqual(1);
        expect(Number.isFinite(a[key])).toBe(true);
      }
    }
  });

  it('starts near the first keyframe and ends at the last keyframe (dim reaches 1.0, closing the lights-out loop)', () => {
    const start = arcAt(0);
    expect(start.hexBuild).toBeCloseTo(0.05, 5);
    expect(start.energy).toBeCloseTo(0.15, 5);

    const totalEnd = CUES[CUES.length - 1];
    const end = arcAt(totalEnd);
    expect(end.hexBuild).toBeCloseTo(1, 5);
    expect(end.roomBuild).toBeCloseTo(1, 5);
    expect(end.dim).toBeCloseTo(1, 5);
    expect(end.energy).toBeCloseTo(0, 5);
  });

  it('hexBuild and roomBuild are monotonically non-decreasing (construction never un-builds)', () => {
    const totalEnd = CUES[CUES.length - 1];
    let prevHex = -Infinity, prevRoom = -Infinity;
    for (let t = 0; t <= totalEnd; t += 3.1) {
      const a = arcAt(t);
      expect(a.hexBuild).toBeGreaterThanOrEqual(prevHex - 1e-9);
      expect(a.roomBuild).toBeGreaterThanOrEqual(prevRoom - 1e-9);
      prevHex = a.hexBuild;
      prevRoom = a.roomBuild;
    }
  });

  it('macro is 0 outside ~[188, 267] — the guarded second-lattice branch in wallShader.ts (`if (uMacro > 0.001)`) must skip everywhere but the climax scale-shift', () => {
    for (let t = 0; t <= 180; t += 15) {
      expect(arcAt(t).macro).toBe(0);
    }
    for (let t = 267; t <= CUES[CUES.length - 1]; t += 5) {
      expect(arcAt(t).macro).toBe(0);
    }
    // And it does actually reveal somewhere in between (coordinated with the
    // climax act's zoom pull-back to 0.55) — a fully-zero macro curve would
    // silently satisfy the two loops above without ever paying off visually.
    expect(arcAt(230).macro).toBeGreaterThan(0.9);
  });

  it('has a discrete jump (not a crossfade) at the 54s drop: hexBuild and energy both step sharply', () => {
    // arcAt returns a reused/mutated object (see its own doc comment) — snapshot
    // each call with a spread before taking the next, or `before` silently
    // aliases `after`'s values.
    const before = { ...arcAt(54 - 0.5) };
    const after = { ...arcAt(54 + 0.5) };
    expect(after.hexBuild - before.hexBuild).toBeGreaterThan(0.05);
    expect(Math.abs(after.energy - before.energy)).toBeGreaterThan(0.15);
  });

  it('has a discrete jump (not a crossfade) at the 188s drop: hexBuild and energy both step sharply', () => {
    const before = { ...arcAt(188 - 0.5) };
    const after = { ...arcAt(188 + 0.5) };
    expect(after.hexBuild - before.hexBuild).toBeGreaterThan(0.05);
    expect(Math.abs(after.energy - before.energy)).toBeGreaterThan(0.15);
  });
});
