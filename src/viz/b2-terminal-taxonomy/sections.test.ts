import { describe, it, expect } from 'vitest';
import { paramsAt, arcAt, orderAt, CUES, ACTS, type ActParams } from './sections';

const NUMERIC_KEYS = Object.keys(ACTS[0]).filter((k) => k !== 'name') as (keyof ActParams)[];

describe('b2-terminal-taxonomy sections', () => {
  it('has 7 cues for 6 acts', () => {
    expect(CUES.length).toBe(7);
    expect(ACTS.length).toBe(6);
    expect(CUES[CUES.length - 1]).toBeCloseTo(336.998, 3);
  });

  it('starts at act 0 (thriving-field) with localT 0 and blend 0', () => {
    const s = paramsAt(0);
    expect(s.actIndex).toBe(0);
    expect(s.params.name).toBe('thriving-field');
    expect(s.localT).toBe(0);
    expect(s.blend).toBe(0);
  });

  it('is mid-crossfade a few seconds before the 232s (total-classification) boundary', () => {
    const boundary = CUES[4]; // 232
    const s = paramsAt(boundary - 3);
    expect(s.blend).toBeGreaterThan(0);
    expect(s.blend).toBeLessThan(1);
  });

  it('keeps localT within [0, 1] and actIndex in range across a full sweep', () => {
    for (let t = 0; t <= 340; t += 0.5) {
      const s = paramsAt(t);
      expect(s.localT).toBeGreaterThanOrEqual(0);
      expect(s.localT).toBeLessThanOrEqual(1);
      expect(s.actIndex).toBeGreaterThanOrEqual(0);
      expect(s.actIndex).toBeLessThan(ACTS.length);
    }
  });

  it('does not throw for t beyond the last cue, and clamps to the final act', () => {
    expect(() => paramsAt(1000)).not.toThrow();
    const s = paramsAt(1000);
    expect(s.actIndex).toBe(ACTS.length - 1);
    expect(s.params.name).toBe('residue');
    expect(s.blend).toBe(0);
  });

  it('does not throw for negative t, and clamps to the first act', () => {
    expect(() => paramsAt(-5)).not.toThrow();
    const s = paramsAt(-5);
    expect(s.actIndex).toBe(0);
    expect(s.localT).toBe(0);
    expect(s.blend).toBe(0);
  });

  it('every numeric ActParams field is finite and non-negative (catches typo-scale mistakes)', () => {
    for (const act of ACTS) {
      for (const key of NUMERIC_KEYS) {
        const v = act[key] as number;
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        // Most knobs are 0..1.5, but scanRate/waveRate/linkRate/runnerRate
        // (events per minute), chatterRate (a multiplier that can run hot),
        // commFreq (cells across the field), and zoom (>1 closer, up to the
        // act-4 deep zoom) live in larger units — excluded from the upper
        // bound.
        if (
          key !== 'scanRate' &&
          key !== 'waveRate' &&
          key !== 'linkRate' &&
          key !== 'runnerRate' &&
          key !== 'chatterRate' &&
          key !== 'commFreq' &&
          key !== 'zoom'
        ) {
          expect(v).toBeLessThanOrEqual(1.5);
        }
      }
    }
  });

  it('total-classification (index 4) strictly owns the maximum gridStrength, scanRate, and rustMix', () => {
    const climax = ACTS[4];
    expect(climax.name).toBe('total-classification');
    for (let i = 0; i < ACTS.length; i++) {
      if (i === 4) continue;
      expect(ACTS[i].gridStrength).toBeLessThan(climax.gridStrength);
      expect(ACTS[i].scanRate).toBeLessThan(climax.scanRate);
      expect(ACTS[i].rustMix).toBeLessThan(climax.rustMix);
    }
  });

  it('classifyPressure and waveRate are nonzero ONLY in total-classification (index 4)', () => {
    for (let i = 0; i < ACTS.length; i++) {
      if (i === 4) {
        expect(ACTS[i].classifyPressure).toBeGreaterThan(0);
        expect(ACTS[i].waveRate).toBeGreaterThan(0);
      } else {
        expect(ACTS[i].classifyPressure).toBe(0);
        expect(ACTS[i].waveRate).toBe(0);
      }
    }
  });

  it('linkRate and runnerRate strictly peak in total-classification (index 4) and are silent in acts 0, 1, 3, 5', () => {
    const climax = ACTS[4];
    expect(climax.name).toBe('total-classification');
    for (let i = 0; i < ACTS.length; i++) {
      if (i === 4) continue;
      expect(ACTS[i].linkRate).toBeLessThan(climax.linkRate);
      expect(ACTS[i].runnerRate).toBeLessThan(climax.runnerRate);
    }
    for (const i of [0, 1, 3, 5]) {
      expect(ACTS[i].linkRate).toBe(0);
      expect(ACTS[i].runnerRate).toBe(0);
    }
  });

  it('eventVivid strictly peaks (=== 1.0) in total-classification (index 4) and is 0 in thriving-field (index 0)', () => {
    const climax = ACTS[4];
    expect(climax.eventVivid).toBe(1.0);
    for (let i = 0; i < ACTS.length; i++) {
      if (i === 4) continue;
      expect(ACTS[i].eventVivid).toBeLessThan(climax.eventVivid);
    }
    expect(ACTS[0].eventVivid).toBe(0);
  });

  it('total-classification (index 4) is the sole pull-back: the strict minimum zoom of all acts', () => {
    // The narrative "only zoom < 1" doesn't hold literally — accelerating-
    // catalogue (index 2) also dips to 0.98 as scanning intensifies. What's
    // actually unique to total-classification is that it pulls back FURTHER
    // than every other act (the strict minimum), which is the real signature
    // of "the back half reveals the whole catalogue".
    const climax = ACTS[4];
    for (let i = 0; i < ACTS.length; i++) {
      if (i === 4) continue;
      expect(ACTS[i].zoom).toBeGreaterThan(climax.zoom);
    }
  });

  it('restraint before peak: last-unclassified (3) is held below accelerating-catalogue (2), which is held below total-classification (4)', () => {
    const restrained = ACTS[3]; // last-unclassified
    const build = ACTS[2]; // accelerating-catalogue
    const climax = ACTS[4]; // total-classification
    expect(restrained.name).toBe('last-unclassified');
    expect(build.name).toBe('accelerating-catalogue');
    expect(climax.name).toBe('total-classification');

    expect(restrained.gridStrength).toBeLessThan(build.gridStrength);
    expect(restrained.scanRate).toBeLessThan(build.scanRate);
    expect(build.gridStrength).toBeLessThan(climax.gridStrength);
    expect(build.scanRate).toBeLessThan(climax.scanRate);
  });

  it('last-unclassified (index 3) is the only deep zoom (>2) and the only survivor spotlight (survivorFocus > 0)', () => {
    for (let i = 0; i < ACTS.length; i++) {
      if (i === 3) {
        expect(ACTS[i].zoom).toBeGreaterThan(2);
        expect(ACTS[i].survivorFocus).toBeGreaterThan(0);
      } else {
        expect(ACTS[i].zoom).toBeLessThanOrEqual(2);
        expect(ACTS[i].survivorFocus).toBe(0);
      }
    }
  });

  it('machineFrac and classifiedFloor are non-decreasing across ACTS in order (the machine never retreats)', () => {
    for (let i = 1; i < ACTS.length; i++) {
      expect(ACTS[i].machineFrac).toBeGreaterThanOrEqual(ACTS[i - 1].machineFrac);
      expect(ACTS[i].classifiedFloor).toBeGreaterThanOrEqual(ACTS[i - 1].classifiedFloor);
    }
  });

  it('thriving-field (act 0) is machine-free, and holds the maximum hueSat', () => {
    const first = ACTS[0];
    expect(first.name).toBe('thriving-field');
    expect(first.scanRate).toBe(0);
    expect(first.gridStrength).toBe(0);
    expect(first.machineFrac).toBe(0);
    expect(first.classifiedFloor).toBe(0);
    expect(first.misProb).toBe(0);
    for (const act of ACTS) {
      expect(act.hueSat).toBeLessThanOrEqual(first.hueSat);
    }
  });

  it('misProb peaks in first-scans (index 1) and is exactly 0 in acts 0, 3, 4, 5', () => {
    const maxMisProb = Math.max(...ACTS.map((a) => a.misProb));
    expect(ACTS[1].misProb).toBe(maxMisProb);
    expect(ACTS[1].name).toBe('first-scans');
    for (const i of [0, 3, 4, 5]) {
      expect(ACTS[i].misProb).toBe(0);
    }
  });

  it('residue (act 5) resolves toward thriving-field (act 0) in zoom, but holds the max motes — loop closure', () => {
    expect(Math.abs(ACTS[5].zoom - ACTS[0].zoom)).toBeLessThan(0.2);
    const maxMotes = Math.max(...ACTS.map((a) => a.motes));
    expect(ACTS[5].motes).toBe(maxMotes);
    expect(ACTS[5].scanRate).toBe(0);
    expect(ACTS[5].groundLight).toBe(1);
  });

  it('total-classification (index 4) strictly owns the maximum lifeRate: filing accelerates hardest at the drop', () => {
    const climax = ACTS[4];
    for (let i = 0; i < ACTS.length; i++) {
      if (i === 4) continue;
      expect(ACTS[i].lifeRate).toBeLessThan(climax.lifeRate);
    }
  });

  it('restraint before the peak: last-unclassified (3) lifeRate is held below accelerating-catalogue (2)', () => {
    expect(ACTS[3].lifeRate).toBeLessThan(ACTS[2].lifeRate);
  });

  it('residue (index 5) strictly owns the minimum presence: the sparsest the field ever gets', () => {
    const sparsest = ACTS[5];
    for (let i = 0; i < ACTS.length; i++) {
      if (i === 5) continue;
      expect(ACTS[i].presence).toBeGreaterThan(sparsest.presence);
    }
  });

  it('total-classification (index 4) strictly owns the maximum gridLife, at exactly 1.0', () => {
    const climax = ACTS[4];
    expect(climax.gridLife).toBe(1.0);
    for (let i = 0; i < ACTS.length; i++) {
      if (i === 4) continue;
      expect(ACTS[i].gridLife).toBeLessThan(climax.gridLife);
    }
  });

  it('gridLife is nonzero in every act: the ambient grid background breathes throughout', () => {
    for (const act of ACTS) {
      expect(act.gridLife).toBeGreaterThan(0);
    }
  });

  it('restraint: last-unclassified (3) gridLife is held below accelerating-catalogue (2)', () => {
    expect(ACTS[3].gridLife).toBeLessThan(ACTS[2].gridLife);
  });

  it('fxAmount is nonzero in every act, with a strict maximum in first-scans (index 1) — the stillest camera stretch', () => {
    const stillest = ACTS[1];
    expect(stillest.name).toBe('first-scans');
    for (const act of ACTS) {
      expect(act.fxAmount).toBeGreaterThan(0);
    }
    for (let i = 0; i < ACTS.length; i++) {
      if (i === 1) continue;
      expect(ACTS[i].fxAmount).toBeLessThan(stillest.fxAmount);
    }
  });

  it('aura is nonzero ONLY in last-unclassified (index 3), at exactly 1.0 — the act-4 quiet-zoom reaction', () => {
    for (let i = 0; i < ACTS.length; i++) {
      if (i === 3) {
        expect(ACTS[i].name).toBe('last-unclassified');
        expect(ACTS[i].aura).toBe(1.0);
      } else {
        expect(ACTS[i].aura).toBe(0);
      }
    }
  });

  it('beatPop strictly peaks (=== 1.0) in total-classification (index 4) and is 0 in thriving-field (index 0)', () => {
    const climax = ACTS[4];
    expect(climax.name).toBe('total-classification');
    expect(climax.beatPop).toBe(1.0);
    for (let i = 0; i < ACTS.length; i++) {
      if (i === 4) continue;
      expect(ACTS[i].beatPop).toBeLessThan(climax.beatPop);
    }
    expect(ACTS[0].beatPop).toBe(0);
  });
});

describe('b2-terminal-taxonomy arcAt', () => {
  it('is well-shaped (energy in [0,1]) across a full sweep, without throwing', () => {
    for (let t = -10; t <= 350; t += 2.3) {
      const a = arcAt(t);
      expect(a.energy).toBeGreaterThanOrEqual(0);
      expect(a.energy).toBeLessThanOrEqual(1);
      expect(Number.isFinite(a.energy)).toBe(true);
    }
  });

  it('starts near the opening level and ends low', () => {
    expect(arcAt(0).energy).toBeCloseTo(0.22, 5);
    expect(arcAt(336.998).energy).toBeLessThan(0.15);
  });

  it('reaches its single maximum (1.0) once, inside the total-classification act window', () => {
    // arcAt returns a reused/mutated singleton (see its own doc comment) —
    // spread-copy immediately or comparisons silently alias later calls.
    const peak = { ...arcAt(246) };
    expect(peak.energy).toBeCloseTo(1.0, 5);
    expect(arcAt(200).energy).toBeLessThan(peak.energy);
    expect(arcAt(300).energy).toBeLessThan(peak.energy);
  });

  it('has a discrete jump at the 168s mass-scan cascade', () => {
    const before = { ...arcAt(167.8) };
    const after = { ...arcAt(168.3) };
    expect(after.energy - before.energy).toBeGreaterThan(0.05);
  });

  it('has a discrete UPWARD jump (not a crossfade) at the 232s THE drop', () => {
    const before = { ...arcAt(231.7) };
    const after = { ...arcAt(232.2) };
    expect(after.energy - before.energy).toBeGreaterThan(0.3);
  });

  it('has a discrete DOWNWARD jump (not a crossfade) at the 316s power-down', () => {
    const before = { ...arcAt(315.6) };
    const after = { ...arcAt(316.4) };
    expect(before.energy - after.energy).toBeGreaterThan(0.4);
  });

  it('has a settle dip just after the opening (t=36 < t=30)', () => {
    expect(arcAt(36).energy).toBeLessThan(arcAt(30).energy);
  });
});

describe('b2-terminal-taxonomy orderAt', () => {
  it('is well-shaped (order in [0,1]) across a full sweep, without throwing', () => {
    for (let t = -10; t <= 350; t += 2.3) {
      const o = orderAt(t);
      expect(o.order).toBeGreaterThanOrEqual(0);
      expect(o.order).toBeLessThanOrEqual(1);
      expect(Number.isFinite(o.order)).toBe(true);
    }
  });

  it('is zero through the opening: t=0 and t=128 (pure living scatter, acts 1-2)', () => {
    expect(orderAt(0).order).toBe(0);
    expect(orderAt(128).order).toBe(0);
  });

  it('is at the act-5 starting point (0.25) at t=232, THE drop', () => {
    expect(orderAt(232).order).toBeCloseTo(0.25, 2);
  });

  it('rises strictly inside act 5, the long visible assembly', () => {
    expect(orderAt(280).order).toBeGreaterThan(orderAt(240).order);
  });

  it('is fully ordered (1) at t=316 (power-down) and stays locked through the end at t=336.998', () => {
    expect(orderAt(316).order).toBe(1);
    expect(orderAt(336.998).order).toBe(1);
  });

  it('is non-decreasing across a 0.5s sweep of the whole track (the drawer never un-assembles)', () => {
    // orderAt returns a reused/mutated singleton (see its own doc comment) —
    // spread-copy immediately or comparisons silently alias later calls.
    let prev = { ...orderAt(0) };
    for (let t = 0.5; t <= 336.998; t += 0.5) {
      const cur = { ...orderAt(t) };
      expect(cur.order).toBeGreaterThanOrEqual(prev.order);
      prev = cur;
    }
  });
});
