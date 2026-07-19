import { describe, it, expect } from 'vitest';
import { paramsAt, arcAt, CUES, ACTS, type ActParams } from './sections';

const NUMERIC_KEYS = Object.keys(ACTS[0]).filter((k) => k !== 'name') as (keyof ActParams)[];

describe('a3-biome-dominoes sections', () => {
  it('has 9 cues for 8 acts', () => {
    expect(CUES.length).toBe(9);
    expect(ACTS.length).toBe(8);
    expect(CUES[CUES.length - 1]).toBeCloseTo(259.835, 3);
  });

  it('starts at act 0 (seed) with localT 0 and blend 0', () => {
    const s = paramsAt(0);
    expect(s.actIndex).toBe(0);
    expect(s.params.name).toBe('seed');
    expect(s.localT).toBe(0);
    expect(s.blend).toBe(0);
  });

  it('is mid-crossfade a few seconds before the 120s (synchrony) boundary', () => {
    const boundary = CUES[3]; // 120
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
    expect(s.params.name).toBe('cold-lattice');
    expect(s.blend).toBe(0);
  });

  it('does not throw for negative t, and clamps to the first act', () => {
    expect(() => paramsAt(-10)).not.toThrow();
    const s = paramsAt(-10);
    expect(s.actIndex).toBe(0);
    expect(s.localT).toBe(0);
  });

  it('every numeric ActParams field is finite and non-negative (catches typo-scale mistakes)', () => {
    for (const act of ACTS) {
      for (const key of NUMERIC_KEYS) {
        const v = act[key] as number;
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        // Most knobs are 0..1.5, but eps (reaction timescale) and the rate
        // knobs (ignitionRate events/min, cellFreq cells across the field,
        // vRate 1/s) live in larger units — excluded from the upper bound.
        if (key !== 'eps' && key !== 'ignitionRate' && key !== 'cellFreq' && key !== 'vRate') {
          expect(v).toBeLessThanOrEqual(1.5);
        }
      }
    }
  });

  it('synchrony (the climax) is the single maximum for sat/bloom/front, and wiring-up (the act before it) is held back', () => {
    // Arc discipline: the climax is the single saturated maximum — every
    // other act sits at or below it, and the act immediately preceding it is
    // deliberately restrained (restraint before the peak).
    const climax = ACTS.find((a) => a.name === 'synchrony')!;
    const build = ACTS.find((a) => a.name === 'wiring-up')!;
    expect(climax.sat).toBe(1.0);
    for (const act of ACTS) {
      if (act.name === 'synchrony') continue;
      expect(act.sat).toBeLessThanOrEqual(1.0);
    }
    expect(build.sat).toBeLessThan(climax.sat);
    expect(build.bloomGain).toBeLessThan(climax.bloomGain);
  });

  it('synchrony is the only zoom pull-back (<1) — the back-half scale shift', () => {
    for (const act of ACTS) {
      if (act.name === 'synchrony') {
        expect(act.zoom).toBeLessThan(1);
      }
    }
    // And it has the highest cell frequency (the "reveal a larger web" jump).
    const climax = ACTS.find((a) => a.name === 'synchrony')!;
    for (const act of ACTS) {
      if (act.name === 'synchrony') continue;
      expect(act.cellFreq).toBeLessThanOrEqual(climax.cellFreq);
    }
  });

  it('a global drive exists ONLY in synchrony (coordinated auto-firing)', () => {
    for (const act of ACTS) {
      if (act.name === 'synchrony') {
        expect(act.drive).toBeGreaterThan(0);
      } else {
        expect(act.drive).toBe(0);
      }
    }
  });

  it('suppress (the de-activation ring gate) is nonzero ONLY in collapse', () => {
    for (const act of ACTS) {
      if (act.name === 'collapse') {
        expect(act.suppress).toBeGreaterThan(0);
      } else {
        expect(act.suppress).toBe(0);
      }
    }
  });

  it('collapse keeps the field excitable so the growing suppression ring (not a global floor) drives the sweep', () => {
    // The de-activation must read as a wave sweeping cell-by-cell: the
    // un-swept region has to stay ALIVE while the ring advances, so
    // excitability stays high and the ring (suppress) is the sole killer.
    const collapse = ACTS.find((a) => a.name === 'collapse')!;
    expect(collapse.suppress).toBe(1);
    expect(collapse.exA).toBeGreaterThanOrEqual(0.7);
    expect(collapse.ignitionRate).toBeGreaterThan(20);
  });

  it('cold-lattice resolves toward the seed act — loop closure (zoom returns close, ignition near zero)', () => {
    const seed = ACTS.find((a) => a.name === 'seed')!;
    const cold = ACTS.find((a) => a.name === 'cold-lattice')!;
    expect(cold.zoom).toBeGreaterThan(1);
    expect(Math.abs(cold.zoom - seed.zoom)).toBeLessThan(0.15);
    expect(cold.ignitionRate).toBeLessThan(seed.ignitionRate);
  });
});

describe('a3-biome-dominoes arcAt', () => {
  it('is well-shaped (energy in [0,1]) across a full sweep, without throwing', () => {
    const totalEnd = CUES[CUES.length - 1];
    for (let t = -10; t <= totalEnd + 1000; t += 2.3) {
      const a = arcAt(t);
      expect(a.energy).toBeGreaterThanOrEqual(0);
      expect(a.energy).toBeLessThanOrEqual(1);
      expect(Number.isFinite(a.energy)).toBe(true);
    }
  });

  it('starts low and resolves back down near the start level (loop closure)', () => {
    const start = arcAt(0);
    expect(start.energy).toBeCloseTo(0.10, 5);

    const totalEnd = CUES[CUES.length - 1];
    const end = arcAt(totalEnd);
    expect(end.energy).toBeLessThan(0.3);
  });

  it('reaches its single maximum (1.0) once, inside the synchrony act window', () => {
    // arcAt returns a reused/mutated singleton (see its own doc comment) —
    // spread-copy immediately or `peak` silently aliases later calls.
    const peak = { ...arcAt(138) };
    expect(peak.energy).toBeCloseTo(1.0, 5);
    expect(arcAt(0).energy).toBeLessThan(peak.energy);
    expect(arcAt(259.835).energy).toBeLessThan(peak.energy);
  });

  it('has a discrete UPWARD jump (not a crossfade) at the 120s synchrony lock', () => {
    const before = { ...arcAt(120 - 0.5) };
    const after = { ...arcAt(120 + 0.5) };
    expect(after.energy - before.energy).toBeGreaterThan(0.1);
  });

  it('has a discrete DOWNWARD jump (not a crossfade) at the 204s collapse', () => {
    const before = { ...arcAt(204 - 0.5) };
    const after = { ...arcAt(204 + 0.5) };
    expect(before.energy - after.energy).toBeGreaterThan(0.15);
  });
});
