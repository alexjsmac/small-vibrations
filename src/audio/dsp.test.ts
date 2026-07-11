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
