import { describe, it, expect } from 'vitest';
import {
  paramsAt,
  sterileAt,
  zoomAt,
  arcAt,
  lifeClockAt,
  CUES,
  ACTS,
  CROSSFADE_SECONDS,
  type ActParams,
} from './sections';

const NUMERIC_KEYS = Object.keys(ACTS[0]).filter((k) => k !== 'name') as (keyof ActParams)[];
const DURATION = CUES[CUES.length - 1];

describe('b3-sterile-breath sections', () => {
  it('has 8 cues for 7 acts, strictly increasing, ending at 200.042', () => {
    expect(CUES.length).toBe(8);
    expect(ACTS.length).toBe(7);
    for (let i = 1; i < CUES.length; i++) {
      expect(CUES[i]).toBeGreaterThan(CUES[i - 1]);
    }
    expect(CUES[CUES.length - 1]).toBeCloseTo(200.042, 3);
  });

  it('CROSSFADE_SECONDS is 6', () => {
    expect(CROSSFADE_SECONDS).toBe(6);
  });

  it('starts at act 0 (breath) with localT 0 and blend 0', () => {
    const s = paramsAt(0);
    expect(s.actIndex).toBe(0);
    expect(s.params.name).toBe('breath');
    expect(s.localT).toBe(0);
    expect(s.blend).toBe(0);
  });

  it('is mid-crossfade a few seconds before the 140s (the-purge) boundary', () => {
    const boundary = CUES[4]; // 140
    const s = paramsAt(boundary - 3);
    expect(s.blend).toBeGreaterThan(0);
    expect(s.blend).toBeLessThan(1);
  });

  it('does not throw for t beyond the last cue, and clamps to the final act', () => {
    expect(() => paramsAt(1000)).not.toThrow();
    const s = paramsAt(1000);
    expect(s.actIndex).toBe(ACTS.length - 1);
    expect(s.params.name).toBe('last-breath');
    expect(s.blend).toBe(0);
  });

  it('does not throw for negative t, and clamps to the first act', () => {
    expect(() => paramsAt(-5)).not.toThrow();
    const s = paramsAt(-5);
    expect(s.actIndex).toBe(0);
    expect(s.localT).toBe(0);
    expect(s.blend).toBe(0);
  });

  it('keeps localT/actIndex in range and every numeric field finite and non-negative across a full sweep', () => {
    for (let t = 0; t <= DURATION + 5; t += 0.5) {
      const s = paramsAt(t);
      expect(s.localT).toBeGreaterThanOrEqual(0);
      expect(s.localT).toBeLessThanOrEqual(1);
      expect(s.actIndex).toBeGreaterThanOrEqual(0);
      expect(s.actIndex).toBeLessThan(ACTS.length);
      for (const key of NUMERIC_KEYS) {
        const v = s.params[key] as number;
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('every numeric ActParams field is finite and non-negative on the raw ACTS table', () => {
    for (const act of ACTS) {
      for (const key of NUMERIC_KEYS) {
        const v = act[key] as number;
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('the-purge (act 4) strictly owns the max of strikeRate, crackleRate, lifeRate, frontNoise, scrubGlow, glintAmp, motionSpeed', () => {
    const purge = ACTS[4];
    expect(purge.name).toBe('the-purge');
    for (let i = 0; i < ACTS.length; i++) {
      if (i === 4) continue;
      expect(ACTS[i].strikeRate).toBeLessThan(purge.strikeRate);
      expect(ACTS[i].crackleRate).toBeLessThan(purge.crackleRate);
      expect(ACTS[i].lifeRate).toBeLessThan(purge.lifeRate);
      expect(ACTS[i].frontNoise).toBeLessThan(purge.frontNoise);
      expect(ACTS[i].scrubGlow).toBeLessThan(purge.scrubGlow);
      expect(ACTS[i].glintAmp).toBeLessThan(purge.glintAmp);
      expect(ACTS[i].motionSpeed).toBeLessThan(purge.motionSpeed);
    }
  });

  it('shake is nonzero ONLY in the-purge (act 4)', () => {
    for (let i = 0; i < ACTS.length; i++) {
      if (i === 4) {
        expect(ACTS[i].shake).toBeGreaterThan(0);
      } else {
        expect(ACTS[i].shake).toBe(0);
      }
    }
  });

  it('healing law: strikeHeal is non-increasing 0->6, strictly decreasing 1->2->3, and exactly 0 in acts 4-6', () => {
    for (let i = 1; i < ACTS.length; i++) {
      expect(ACTS[i].strikeHeal).toBeLessThanOrEqual(ACTS[i - 1].strikeHeal);
    }
    expect(ACTS[2].strikeHeal).toBeLessThan(ACTS[1].strikeHeal);
    expect(ACTS[3].strikeHeal).toBeLessThan(ACTS[2].strikeHeal);
    for (const i of [4, 5, 6]) {
      expect(ACTS[i].strikeHeal).toBe(0);
    }
  });

  it('restraint: remission (act 3) is held below losing-ground (act 2) on strikeRate, lifeRate, motionSpeed', () => {
    expect(ACTS[3].name).toBe('remission');
    expect(ACTS[2].name).toBe('losing-ground');
    expect(ACTS[3].strikeRate).toBeLessThan(ACTS[2].strikeRate);
    expect(ACTS[3].lifeRate).toBeLessThan(ACTS[2].lifeRate);
    expect(ACTS[3].motionSpeed).toBeLessThan(ACTS[2].motionSpeed);
  });

  it('driftSpeed is exactly 0 in acts 3, 5, 6 (remission, sterile, last-breath)', () => {
    for (const i of [3, 5, 6]) {
      expect(ACTS[i].driftSpeed).toBe(0);
    }
  });

  it('paleness is strictly max in remission (act 3)', () => {
    const remission = ACTS[3];
    for (let i = 0; i < ACTS.length; i++) {
      if (i === 3) continue;
      expect(ACTS[i].paleness).toBeLessThan(remission.paleness);
    }
  });

  it('breath opens: breathAmp is strictly max in act 0', () => {
    const opener = ACTS[0];
    expect(opener.name).toBe('breath');
    for (let i = 1; i < ACTS.length; i++) {
      expect(ACTS[i].breathAmp).toBeLessThan(opener.breathAmp);
    }
  });

  it('bloomRate is strictly max in act 0 and nonzero ONLY in acts 0, 3, 6', () => {
    const opener = ACTS[0];
    for (let i = 1; i < ACTS.length; i++) {
      expect(ACTS[i].bloomRate).toBeLessThan(opener.bloomRate);
    }
    const bloomActs = new Set([0, 3, 6]);
    for (let i = 0; i < ACTS.length; i++) {
      if (bloomActs.has(i)) {
        expect(ACTS[i].bloomRate).toBeGreaterThan(0);
      } else {
        expect(ACTS[i].bloomRate).toBe(0);
      }
    }
  });

  it('erasure: ghostAmp is exactly 0 in acts 5-6 (sterile, last-breath)', () => {
    expect(ACTS[5].ghostAmp).toBe(0);
    expect(ACTS[6].ghostAmp).toBe(0);
  });

  it('watermark is strictly max in sterile (act 5)', () => {
    const sterile = ACTS[5];
    expect(sterile.name).toBe('sterile');
    for (let i = 0; i < ACTS.length; i++) {
      if (i === 5) continue;
      expect(ACTS[i].watermark).toBeLessThan(sterile.watermark);
    }
  });

  it('grade is strictly max in last-breath (act 6), with grade[6] > grade[5] > grade[4]', () => {
    const last = ACTS[6];
    expect(last.name).toBe('last-breath');
    for (let i = 0; i < ACTS.length; i++) {
      if (i === 6) continue;
      expect(ACTS[i].grade).toBeLessThan(last.grade);
    }
    expect(ACTS[6].grade).toBeGreaterThan(ACTS[5].grade);
    expect(ACTS[5].grade).toBeGreaterThan(ACTS[4].grade);
  });

  it('sterileSpec is strictly max in last-breath (act 6)', () => {
    const last = ACTS[6];
    for (let i = 0; i < ACTS.length; i++) {
      if (i === 6) continue;
      expect(ACTS[i].sterileSpec).toBeLessThan(last.sterileSpec);
    }
  });
});

describe('b3-sterile-breath sterileAt', () => {
  it('is 0 at t=0', () => {
    expect(sterileAt(0)).toBe(0);
  });

  it('stays <= 0.05 through act 0 (sample 0..12)', () => {
    for (let t = 0; t <= 12; t += 1) {
      expect(sterileAt(t)).toBeLessThanOrEqual(0.05);
    }
  });

  it('is bounded [0, 1] over a full 0.25s sweep, without throwing', () => {
    for (let t = -10; t <= 210; t += 0.25) {
      const v = sterileAt(t);
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('has a discrete jump > 0.15 at the 140s purge onset (139.7 -> 140.3)', () => {
    expect(sterileAt(140.3) - sterileAt(139.7)).toBeGreaterThan(0.15);
  });

  it('has a discrete jump > 0.08 at 143.8 -> 144.4 (healing-collapse follow-through)', () => {
    expect(sterileAt(144.4) - sterileAt(143.8)).toBeGreaterThan(0.08);
  });

  it('has small discrete steps > 0.02 on the way into act 5', () => {
    expect(sterileAt(168.3) - sterileAt(167.8)).toBeGreaterThan(0.02);
    expect(sterileAt(174.3) - sterileAt(173.7)).toBeGreaterThan(0.02);
    expect(sterileAt(180.3) - sterileAt(179.7)).toBeGreaterThan(0.02);
  });

  it('has a final step >= 0.015 at 183.7 -> 184.3, locking sterile', () => {
    expect(sterileAt(184.3) - sterileAt(183.7)).toBeGreaterThanOrEqual(0.015);
  });

  it('is exactly 1 for t >= 185', () => {
    for (let t = 185; t <= 210; t += 3) {
      expect(sterileAt(t)).toBe(1);
    }
  });

  it('strictly decreases somewhere in [108, 130] (the remission dip)', () => {
    expect(sterileAt(118)).toBeLessThan(sterileAt(110));
  });

  it('is flat between 128 and 139.7', () => {
    expect(sterileAt(128)).toBeCloseTo(sterileAt(139.7), 5);
    expect(sterileAt(134)).toBeCloseTo(sterileAt(128), 5);
  });

  it('is non-decreasing outside [104, 140] across a sweep', () => {
    let prev = sterileAt(0);
    for (let t = 0.5; t <= 104; t += 0.5) {
      const cur = sterileAt(t);
      expect(cur).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = cur;
    }
    prev = sterileAt(140);
    for (let t = 140.5; t <= 210; t += 0.5) {
      const cur = sterileAt(t);
      expect(cur).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = cur;
    }
  });
});

describe('b3-sterile-breath zoomAt', () => {
  it('is at its maximum at t=0', () => {
    const max = Math.max(...Array.from({ length: 401 }, (_, i) => zoomAt(i * 0.5)));
    expect(zoomAt(0)).toBeCloseTo(max, 5);
  });

  it('is flat from 104 to 139.7', () => {
    expect(zoomAt(104)).toBeCloseTo(zoomAt(139.7), 5);
    expect(zoomAt(120)).toBeCloseTo(zoomAt(104), 5);
  });

  it('the reveal pull-out: zoomAt(178) < 0.35 * zoomAt(162)', () => {
    expect(zoomAt(178)).toBeLessThan(0.35 * zoomAt(162));
  });

  it('is >= 1 for all t in [0, 162] (only drops below 1 after the reveal starts)', () => {
    for (let t = 0; t <= 162; t += 1) {
      expect(zoomAt(t)).toBeGreaterThanOrEqual(1);
    }
  });

  it('drops below 1 for some t > 162', () => {
    expect(zoomAt(170)).toBeLessThan(1);
  });

  it('is flat after 184', () => {
    expect(zoomAt(184)).toBeCloseTo(zoomAt(200.042), 5);
    expect(zoomAt(190)).toBeCloseTo(zoomAt(184), 5);
  });

  it('is bounded in (0, 2] across a sweep, without throwing', () => {
    for (let t = -10; t <= 210; t += 0.5) {
      const v = zoomAt(t);
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThanOrEqual(2);
    }
  });
});

describe('b3-sterile-breath arcAt', () => {
  it('is within [0, 1] over a sweep, without throwing', () => {
    for (let t = -10; t <= 210; t += 0.37) {
      const v = arcAt(t);
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('equals 1.0 only at t=144, and is < 1 everywhere else on a 0.5s sweep', () => {
    expect(arcAt(144)).toBe(1);
    for (let t = 0; t <= 210; t += 0.5) {
      if (Math.abs(t - 144) < 1) continue; // exclude the peak's immediate neighborhood
      expect(arcAt(t)).toBeLessThan(1);
    }
  });

  it('dips mid-remission: arcAt(106) < arcAt(103)', () => {
    expect(arcAt(106)).toBeLessThan(arcAt(103));
  });

  it('steps up > 0.3 across the 140s purge onset (139.7 -> 140.3)', () => {
    expect(arcAt(140.3) - arcAt(139.7)).toBeGreaterThan(0.3);
  });

  it('steps down > 0.25 across the purge release (161.7 -> 162.3)', () => {
    expect(arcAt(161.7) - arcAt(162.3)).toBeGreaterThan(0.25);
  });

  it('is 0 (or effectively 0) at true silence, t=200.042', () => {
    expect(arcAt(200.042)).toBeLessThan(0.01);
  });
});

describe('b3-sterile-breath lifeClockAt', () => {
  it('is 0 at t=0', () => {
    expect(lifeClockAt(0)).toBe(0);
  });

  it('is strictly increasing over a sweep (every act has positive lifeRate)', () => {
    let prev = lifeClockAt(0);
    for (let t = 0.5; t <= DURATION; t += 0.5) {
      const cur = lifeClockAt(t);
      expect(cur).toBeGreaterThan(prev);
      prev = cur;
    }
  });

  it('does not throw and clamps for t outside [0, duration]', () => {
    expect(() => lifeClockAt(-5)).not.toThrow();
    expect(() => lifeClockAt(1000)).not.toThrow();
    expect(lifeClockAt(-5)).toBe(lifeClockAt(0));
    expect(lifeClockAt(1000)).toBeCloseTo(lifeClockAt(DURATION), 5);
  });

  it('matches the hand-summed integral of lifeRate * actDuration at each CUE', () => {
    let expected = 0;
    expect(lifeClockAt(CUES[0])).toBeCloseTo(expected, 5);
    for (let i = 0; i < ACTS.length; i++) {
      const dt = CUES[i + 1] - CUES[i];
      expected += ACTS[i].lifeRate * dt;
      expect(lifeClockAt(CUES[i + 1])).toBeCloseTo(expected, 5);
    }
  });

  it('has a steeper slope inside the-purge (act 4) than inside remission (act 3)', () => {
    const slopeIn = (t0: number, t1: number) => (lifeClockAt(t1) - lifeClockAt(t0)) / (t1 - t0);
    const slopeRemission = slopeIn(110, 115); // inside act 3 [104, 140)
    const slopePurge = slopeIn(145, 150); // inside act 4 [140, 162)
    expect(slopePurge).toBeGreaterThan(slopeRemission);
  });
});
