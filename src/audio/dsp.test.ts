import { describe, it, expect } from 'vitest';
import {
  DSP,
  FFT,
  hannWindow,
  extractPeaks,
  packHash,
  fingerprint,
  StreamResampler,
  resampleTo12k,
  serializeDB,
  deserializeDB,
  queryDB,
  correctSpeed,
  matchAtSpeeds,
  SPEED_RATIOS,
  VALUE_FRAME_BITS,
  type FingerprintDB,
} from './dsp';
import { mulberry32 } from '../viz/random';

/** Small spectrally-rich synthetic signal — a couple of seconds of summed
 * sine partials with seeded jitter, enough to produce landmarks without
 * needing a real track master. */
function synthSignal(seed: number, seconds: number, partials: number[]): Float32Array {
  const rng = mulberry32(seed);
  const sr = DSP.sampleRate;
  const n = Math.round(seconds * sr);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let v = 0;
    for (const f of partials) {
      const jitter = 1 + (rng() - 0.5) * 0.002; // ±0.1% freq jitter
      v += Math.sin((2 * Math.PI * f * jitter * i) / sr);
    }
    out[i] = (v / partials.length) * 0.8;
  }
  return out;
}

/** Build a queryable DB from one landmark list per track, sorted by hash the
 * way the offline build script and `deserializeDB` both guarantee. */
function dbFrom(perTrack: Array<Array<{ hash: number; t: number }>>): FingerprintDB {
  const total = perTrack.reduce((n, l) => n + l.length, 0);
  const hashes = new Uint32Array(total);
  const values = new Uint32Array(total);
  let i = 0;
  perTrack.forEach((landmarks, trackIndex) => {
    for (const lm of landmarks) {
      hashes[i] = lm.hash;
      values[i] = (trackIndex << VALUE_FRAME_BITS) | lm.t;
      i++;
    }
  });
  const order = Array.from(hashes.keys()).sort((a, b) => hashes[a] - hashes[b]);
  const sh = new Uint32Array(total), sv = new Uint32Array(total);
  order.forEach((src, dst) => { sh[dst] = hashes[src]; sv[dst] = values[src]; });
  return {
    version: DSP.version,
    tracks: perTrack.map((_, k) => ({ id: `t${k}`, frames: 1 << 16 })),
    hashes: sh,
    values: sv,
  };
}

describe('hannWindow', () => {
  it('has the requested length', () => {
    expect(hannWindow(2048).length).toBe(2048);
  });

  it('is symmetric', () => {
    const w = hannWindow(2048);
    for (let i = 0; i < 10; i++) {
      expect(w[i]).toBeCloseTo(w[w.length - 1 - i], 5);
    }
  });

  it('has endpoints at ~0', () => {
    const w = hannWindow(2048);
    expect(w[0]).toBeCloseTo(0, 6);
    expect(w[w.length - 1]).toBeCloseTo(0, 6);
  });
});

describe('FFT', () => {
  it('finds the peak bin for a pure 1kHz sine at 12kHz/2048pt', () => {
    const size = 2048;
    const sr = DSP.sampleRate;
    const freq = 1000;
    const re = new Float32Array(size);
    const im = new Float32Array(size);
    const window = hannWindow(size);
    for (let i = 0; i < size; i++) re[i] = Math.sin((2 * Math.PI * freq * i) / sr) * window[i];

    const fft = new FFT(size);
    fft.transform(re, im);

    const half = size / 2;
    let bestBin = 0, bestMag = -Infinity;
    for (let k = 0; k < half; k++) {
      const mag = Math.hypot(re[k], im[k]);
      if (mag > bestMag) { bestMag = mag; bestBin = k; }
    }
    const expectedBin = (freq * size) / sr; // 170.67
    expect(Math.abs(bestBin - expectedBin)).toBeLessThanOrEqual(1);
  });
});

describe('packHash', () => {
  it('round-trips the 9/9/6 bit layout', () => {
    const f1 = 200, f2 = 300, dt = 10;
    const hash = packHash(f1, f2, dt);
    const unpackedF1 = (hash >>> 15) & 0x1ff;
    const unpackedF2 = (hash >>> 6) & 0x1ff;
    const unpackedDt = hash & 0x3f;
    expect(unpackedF1).toBe((f1 >> 1) & 0x1ff);
    expect(unpackedF2).toBe((f2 >> 1) & 0x1ff);
    expect(unpackedDt).toBe(dt & 0x3f);
  });

  it('quantizes frequency to 2-bin steps (f and f+1 collide)', () => {
    expect(packHash(200, 300, 10)).toBe(packHash(201, 300, 10));
  });

  it('masks dt to 6 bits', () => {
    expect(packHash(0, 0, 64)).toBe(packHash(0, 0, 0));
  });
});

describe('extractPeaks', () => {
  it('finds a planted hot bin', () => {
    const frameLen = DSP.fftSize / 2; // 1024
    const frames: Float32Array[] = [];
    for (let t = 0; t < 5; t++) frames.push(new Float32Array(frameLen));
    // Plant a single dominant spike in the middle frame, well inside [minBin,maxBin].
    frames[2][500] = 10;

    const peaks = extractPeaks(frames);
    expect(peaks).toHaveLength(1);
    expect(peaks[0].t).toBe(2);
    expect(peaks[0].f).toBe(500);
  });

  it('never returns more than peaksPerFrame peaks for a single frame', () => {
    const frameLen = DSP.fftSize / 2;
    const frames: Float32Array[] = [];
    for (let t = 0; t < 5; t++) frames.push(new Float32Array(frameLen));
    // Plant several widely-spaced spikes in the middle frame so they don't
    // suppress each other via the neighborF window.
    for (const bin of [100, 300, 500, 700, 900]) frames[2][bin] = 10;

    const peaks = extractPeaks(frames);
    const middleFramePeaks = peaks.filter((p) => p.t === 2);
    expect(middleFramePeaks.length).toBeLessThanOrEqual(DSP.peaksPerFrame);
  });
});

describe('fingerprint', () => {
  const fft = new FFT(DSP.fftSize);
  const window = hannWindow(DSP.fftSize);

  it('is deterministic for identical input', () => {
    const samples = synthSignal(1, 3, [220, 440, 880, 1760]);
    const a = fingerprint(samples, fft, window);
    const b = fingerprint(samples, fft, window);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
  });

  it('differs for different input', () => {
    const samplesA = synthSignal(1, 3, [220, 440, 880, 1760]);
    const samplesB = synthSignal(2, 3, [330, 550, 990, 1980]);
    const a = fingerprint(samplesA, fft, window);
    const b = fingerprint(samplesB, fft, window);
    const hashesA = a.map((l) => l.hash).sort();
    const hashesB = b.map((l) => l.hash).sort();
    expect(hashesA).not.toEqual(hashesB);
  });
});

describe('StreamResampler / resampleTo12k', () => {
  it('resamples 44100 -> 12000 with the expected duration ratio', () => {
    const inputRate = 44100;
    const seconds = 2;
    const n = Math.round(inputRate * seconds);
    const samples = new Float32Array(n);
    for (let i = 0; i < n; i++) samples[i] = Math.sin((2 * Math.PI * 440 * i) / inputRate);

    const out = resampleTo12k(samples, inputRate);
    const expectedLen = (n * DSP.sampleRate) / inputRate;
    // A one-shot call can't produce output for the last ~taps/ratio input
    // samples (the FIR kernel needs `taps` future samples it doesn't have),
    // so the true tolerance is that startup/tail cost, not a single sample.
    const ratio = inputRate / DSP.sampleRate;
    const filterTailSamples = 96 / ratio;
    expect(Math.abs(out.length - expectedLen)).toBeLessThanOrEqual(filterTailSamples + 1);
    for (let i = 0; i < out.length; i++) expect(Number.isNaN(out[i])).toBe(false);
  });

  it('passes samples through unchanged when already at 12kHz', () => {
    const samples = new Float32Array([0.1, 0.2, 0.3]);
    expect(resampleTo12k(samples, DSP.sampleRate)).toBe(samples);
  });

  it('throws on upsampling', () => {
    expect(() => new StreamResampler(8000, DSP.sampleRate)).toThrow('upsampling not supported');
  });

  it('streaming process() across chunks produces no NaNs and roughly matches one-shot length', () => {
    const inputRate = 44100;
    const seconds = 2;
    const n = Math.round(inputRate * seconds);
    const samples = new Float32Array(n);
    for (let i = 0; i < n; i++) samples[i] = Math.sin((2 * Math.PI * 220 * i) / inputRate);

    const rs = new StreamResampler(inputRate, DSP.sampleRate);
    const chunkSize = 4096;
    let total = 0;
    for (let i = 0; i < n; i += chunkSize) {
      const chunk = samples.slice(i, Math.min(n, i + chunkSize));
      const out = rs.process(chunk);
      for (let k = 0; k < out.length; k++) expect(Number.isNaN(out[k])).toBe(false);
      total += out.length;
    }
    const oneShot = resampleTo12k(samples, inputRate);
    expect(Math.abs(total - oneShot.length)).toBeLessThanOrEqual(2);
  });
});

describe('correctSpeed', () => {
  it('returns the input untouched at ratio 1', () => {
    const x = new Float32Array([0.1, 0.2, 0.3]);
    expect(correctSpeed(x, 1)).toBe(x);
  });

  it('scales length by the ratio and produces no NaNs', () => {
    const x = synthSignal(0x11, 1, [220, 440, 880]);
    for (const ratio of [0.94, 0.97, 1.03, 1.06]) {
      const out = correctSpeed(x, ratio);
      expect(Math.abs(out.length - x.length * ratio)).toBeLessThanOrEqual(1);
      for (let i = 0; i < out.length; i++) expect(Number.isNaN(out[i])).toBe(false);
    }
  });

  it('undoes a speed error: a sped-up signal fingerprints back to the original', () => {
    const original = synthSignal(0x22, 6, [180, 300, 520, 900, 1500, 2400]);
    const fft = new FFT(DSP.fftSize);
    const win = hannWindow(DSP.fftSize);

    // Simulate a deck running 3% fast, then correct it back.
    const fast = correctSpeed(original, 1 / 1.03);
    const restored = correctSpeed(fast, 1.03);

    const db = dbFrom([fingerprint(original, fft, win)]);
    const before = queryDB(db, fingerprint(fast, fft, win))[0];
    const after = queryDB(db, fingerprint(restored, fft, win))[0];

    // 3% off is well outside the ~1% the hashes tolerate; correction recovers it.
    expect(after.votes).toBeGreaterThan((before?.votes ?? 0) * 5);
  });
});

describe('matchAtSpeeds', () => {
  const fft = new FFT(DSP.fftSize);
  const win = hannWindow(DSP.fftSize);

  it('finds the ratio a sped-up query needs, and the right track', () => {
    const trackA = synthSignal(0x33, 8, [150, 260, 430, 700, 1200, 2100]);
    const trackB = synthSignal(0x44, 8, [190, 320, 510, 830, 1400, 2600]);
    const db = dbFrom([fingerprint(trackA, fft, win), fingerprint(trackB, fft, win)]);

    // trackA as heard from a deck running 3% fast.
    const heard = correctSpeed(trackA, 1 / 1.03);
    const best = matchAtSpeeds(db, heard, fft, win, SPEED_RATIOS);

    expect(best.top?.trackIndex).toBe(0);
    expect(best.ratio).toBeCloseTo(1.03, 2);
    expect(best.top!.votes).toBeGreaterThan(best.runnerUpVotes * 2);
    expect(best.correctedSamples).toBe(correctSpeed(heard, best.ratio).length);
  });

  it('picks ratio 1 for an unshifted query', () => {
    const track = synthSignal(0x55, 8, [170, 290, 460, 780, 1300, 2200]);
    const db = dbFrom([fingerprint(track, fft, win)]);
    const best = matchAtSpeeds(db, track, fft, win, SPEED_RATIOS);
    expect(best.ratio).toBe(1);
  });

  it('is honest about an empty ratio list rather than throwing', () => {
    const track = synthSignal(0x66, 2, [200, 400]);
    const db = dbFrom([fingerprint(track, fft, win)]);
    const best = matchAtSpeeds(db, track, fft, win, []);
    expect(best.top).toBeNull();
    expect(best.ratio).toBe(1);
  });
});

describe('SPEED_RATIOS', () => {
  it('starts at nominal and stays within ±6% on a 1% grid', () => {
    expect(SPEED_RATIOS[0]).toBe(1);
    for (const r of SPEED_RATIOS) {
      expect(Math.abs(r - 1)).toBeLessThanOrEqual(0.0601);
      expect(Math.abs(Math.round((r - 1) * 1000) % 10)).toBe(0); // whole-percent steps
    }
    expect(new Set(SPEED_RATIOS).size).toBe(SPEED_RATIOS.length);
  });

  it('leaves no gap wider than the ~1% the hashes tolerate', () => {
    const sorted = [...SPEED_RATIOS].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i] - sorted[i - 1]).toBeLessThanOrEqual(0.0101);
    }
  });
});

describe('serializeDB / deserializeDB', () => {
  const tracks = [{ id: 'a', frames: 100 }, { id: 'b', frames: 50 }];
  const hashes = Uint32Array.from([5, 10, 20, 30]);
  const values = Uint32Array.from([
    (0 << VALUE_FRAME_BITS) | 1,
    (0 << VALUE_FRAME_BITS) | 2,
    (1 << VALUE_FRAME_BITS) | 3,
    (1 << VALUE_FRAME_BITS) | 4,
  ]);
  const db: FingerprintDB = { version: DSP.version, tracks, hashes, values };

  it('round-trips exactly', () => {
    const buf = serializeDB(db);
    expect(buf.byteLength).toBe(16 + hashes.length * 8);
    const restored = deserializeDB(buf, tracks);
    expect(restored.version).toBe(DSP.version);
    expect(restored.tracks).toBe(tracks);
    expect(Array.from(restored.hashes)).toEqual(Array.from(hashes));
    expect(Array.from(restored.values)).toEqual(Array.from(values));
  });

  it('throws on bad magic', () => {
    const buf = new ArrayBuffer(16);
    expect(() => deserializeDB(buf, tracks)).toThrow('bad fingerprint DB magic');
  });

  it('throws on a version mismatch', () => {
    const badDb: FingerprintDB = { ...db, version: DSP.version + 1 };
    const buf = serializeDB(badDb);
    expect(() => deserializeDB(buf, tracks)).toThrow(/DSP version/);
  });

  it('throws on a track-count mismatch', () => {
    const buf = serializeDB(db);
    expect(() => deserializeDB(buf, [tracks[0]])).toThrow('fingerprint DB track count mismatch');
  });
});

describe('queryDB', () => {
  it('hits an exact landmark against a tiny hand-built DB', () => {
    const tracks = [{ id: 'x', frames: 1000 }];
    const hashes = Uint32Array.from([5, 10, 20]);
    const values = Uint32Array.from([
      (0 << VALUE_FRAME_BITS) | 100,
      (0 << VALUE_FRAME_BITS) | 200,
      (0 << VALUE_FRAME_BITS) | 300,
    ]);
    const db: FingerprintDB = { version: DSP.version, tracks, hashes, values };

    const results = queryDB(db, [{ hash: 10, t: 150 }]);
    expect(results).toHaveLength(1);
    expect(results[0].trackIndex).toBe(0);
    expect(results[0].offsetFrames).toBe(50); // round((200-150)/2)*2
    expect(results[0].votes).toBe(1);
  });

  it('returns no results for a hash that is not in the DB', () => {
    const tracks = [{ id: 'x', frames: 1000 }];
    const db: FingerprintDB = {
      version: DSP.version,
      tracks,
      hashes: Uint32Array.from([5, 10, 20]),
      values: Uint32Array.from([1, 2, 3]),
    };
    expect(queryDB(db, [{ hash: 999, t: 0 }])).toHaveLength(0);
  });
});
