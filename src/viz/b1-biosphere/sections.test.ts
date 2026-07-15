import { describe, it, expect } from 'vitest';
import { paramsAt, arcAt, CUES, ACTS, type ActParams } from './sections';

const NUMERIC_KEYS = Object.keys(ACTS[0]).filter((k) => k !== 'name') as (keyof ActParams)[];

describe('b1-biosphere sections', () => {
  it('has 8 cues for 7 acts', () => {
    expect(CUES.length).toBe(8);
    expect(ACTS.length).toBe(7);
    expect(CUES[CUES.length - 1]).toBeCloseTo(251.238, 3);
  });

  it('starts at act 0 (spores) with localT 0 and blend 0', () => {
    const s = paramsAt(0);
    expect(s.actIndex).toBe(0);
    expect(s.params.name).toBe('spores');
    expect(s.localT).toBe(0);
    expect(s.blend).toBe(0);
  });

  it('is mid-crossfade a few seconds before the 54s boundary', () => {
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
    expect(s.params.name).toBe('exhale');
    expect(s.blend).toBe(0);
  });

  it('does not throw for negative t, and clamps to the first act', () => {
    expect(() => paramsAt(-10)).not.toThrow();
    const s = paramsAt(-10);
    expect(s.actIndex).toBe(0);
    expect(s.localT).toBe(0);
  });

  it('every numeric ActParams field stays within a sane [0, 1.5] range (catches typo-scale mistakes)', () => {
    for (const act of ACTS) {
      for (const key of NUMERIC_KEYS) {
        const v = act[key] as number;
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        // sensor distances/angles and speed live in small dish-uv/radian
        // units well under 1.5; burstRate is events/minute (0..~20) so is
        // excluded from the upper bound.
        if (key !== 'burstRate') expect(v).toBeLessThanOrEqual(1.5);
      }
    }
  });

  it('full-biosphere (the climax) is the single maximum for sat/throb/deposit, and convergence (the act before it) is held back by comparison', () => {
    // Arc discipline check (plan §3): the climax act is the single
    // saturated maximum — every other act sits well below it, and the act
    // immediately preceding it is deliberately restrained.
    const climax = ACTS.find((a) => a.name === 'full-biosphere')!;
    const convergence = ACTS.find((a) => a.name === 'convergence')!;
    expect(climax.sat).toBe(1.0);
    for (const act of ACTS) {
      if (act.name === 'full-biosphere') continue;
      expect(act.sat).toBeLessThanOrEqual(1.0);
    }
    expect(convergence.sat).toBeLessThan(climax.sat);
    expect(convergence.sat).toBeLessThan(ACTS.find((a) => a.name === 'first-bloom')!.sat);
  });

  it('act 6 (full-biosphere) is the only zoom pull-back (<1) — the back-half scale shift', () => {
    for (const act of ACTS) {
      if (act.name === 'full-biosphere') {
        expect(act.zoom).toBeLessThan(1);
      } else {
        expect(act.zoom).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('exhale resolves toward the spores act — loop closure (sporeDensity climbs back up, zoom returns to 1)', () => {
    const spores = ACTS.find((a) => a.name === 'spores')!;
    const exhale = ACTS.find((a) => a.name === 'exhale')!;
    expect(exhale.zoom).toBeCloseTo(spores.zoom, 5);
    expect(exhale.sporeDensity).toBeGreaterThan(0.5);
  });

  it('stirring gives species B distinctly different sensing params from species A (a different network texture)', () => {
    const stirring = ACTS.find((a) => a.name === 'stirring')!;
    expect(stirring.sensDistB).not.toBeCloseTo(stirring.sensDistA, 2);
    expect(stirring.sensAngleB).not.toBeCloseTo(stirring.sensAngleA, 2);
  });

  it('rot raises decay and lowers deposit relative to the act before it (withering veins)', () => {
    const firstBloom = ACTS.find((a) => a.name === 'first-bloom')!;
    const rot = ACTS.find((a) => a.name === 'rot')!;
    expect(rot.decay).toBeGreaterThan(firstBloom.decay);
    expect(rot.deposit).toBeLessThan(firstBloom.deposit);
    expect(rot.sat).toBeLessThan(firstBloom.sat);
  });
});

describe('b1-biosphere arcAt', () => {
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
    expect(end.energy).toBeCloseTo(0.12, 5);
    expect(end.energy).toBeLessThan(0.3);
  });

  it('reaches its single maximum (1.0) once, inside the full-biosphere act window', () => {
    // arcAt returns a reused/mutated singleton (see its own doc comment) —
    // spread-copy immediately or `peak` silently aliases later calls.
    const peak = { ...arcAt(210) };
    expect(peak.energy).toBeCloseTo(1.0, 5);
    // Outside the climax window energy must sit below the peak.
    expect(arcAt(0).energy).toBeLessThan(peak.energy);
    expect(arcAt(251.238).energy).toBeLessThan(peak.energy);
  });

  it('has a discrete jump (not a crossfade) at the 54s drop', () => {
    // arcAt returns a reused/mutated object (see its own doc comment) —
    // snapshot each call with a spread before taking the next, or `before`
    // silently aliases `after`'s values.
    const before = { ...arcAt(54 - 0.5) };
    const after = { ...arcAt(54 + 0.5) };
    expect(after.energy - before.energy).toBeGreaterThan(0.15);
  });

  it('has a discrete jump (not a crossfade) at the 178s drop', () => {
    const before = { ...arcAt(178 - 0.5) };
    const after = { ...arcAt(178 + 0.5) };
    expect(after.energy - before.energy).toBeGreaterThan(0.15);
  });
});
