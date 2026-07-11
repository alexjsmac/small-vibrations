import { describe, it, expect } from 'vitest';
import * as primordial from './sections';
import * as marching from '../a1-they-come-marching/sections';

/** Both a1 modules share identical paramsAt/CUES machinery (the primordial
 * take reuses the marching module's staging shape) — exercise both with the
 * same assertions instead of duplicating the test twice. */
describe.each([
  ['a1-primordial', primordial],
  ['a1-they-come-marching', marching],
])('%s sections', (_name, mod) => {
  it('starts at act 0 with localT 0 and blend 0', () => {
    const s = mod.paramsAt(0);
    expect(s.actIndex).toBe(0);
    expect(s.localT).toBe(0);
    expect(s.blend).toBe(0);
  });

  it('is mid-crossfade a few seconds before a boundary', () => {
    const boundary = mod.CUES[1]; // 16
    const s = mod.paramsAt(boundary - 3);
    expect(s.blend).toBeGreaterThan(0);
    expect(s.blend).toBeLessThan(1);
  });

  it('keeps localT within [0, 1] across a full sweep', () => {
    const totalEnd = mod.CUES[mod.CUES.length - 1];
    for (let t = 0; t <= totalEnd; t += 1.7) {
      const s = mod.paramsAt(t);
      expect(s.localT).toBeGreaterThanOrEqual(0);
      expect(s.localT).toBeLessThanOrEqual(1);
    }
  });

  it('does not throw for t beyond the last cue, and clamps to the final act', () => {
    const totalEnd = mod.CUES[mod.CUES.length - 1];
    expect(() => mod.paramsAt(totalEnd + 1000)).not.toThrow();
    const s = mod.paramsAt(totalEnd + 1000);
    expect(s.actIndex).toBe(mod.ACTS.length - 1);
    expect(s.blend).toBe(0);
  });

  it('does not throw for negative t, and clamps to the first act', () => {
    expect(() => mod.paramsAt(-10)).not.toThrow();
    const s = mod.paramsAt(-10);
    expect(s.actIndex).toBe(0);
    expect(s.localT).toBe(0);
  });
});
