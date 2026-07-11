import { describe, it, expect } from 'vitest';
import { paramsAt, arcAt, CUES, ACTS } from './sections';

describe('a2-homemakers sections', () => {
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
});

describe('a2-homemakers arcAt', () => {
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

  it('starts near the first keyframe and ends at the last keyframe', () => {
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
});
