/**
 * End-to-end mirror of the offline selftest in
 * scripts/build-fingerprints.ts (~L145-186), but against synthetic
 * "tracks" instead of the real masters so CI never needs the WAVs.
 *
 * Two spectrally-rich synthetic tracks (sums of several sine partials with
 * mulberry32-seeded jitter — a single pure tone produces too few landmarks
 * to match reliably) stand in for the album masters. We build a DB from
 * them, round-trip it through serialize/deserialize exactly like the
 * browser does, then confirm 10s excerpts — clean, quiet, and noisy —
 * still resolve to the right track and offset.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import {
  DSP,
  FFT,
  hannWindow,
  fingerprint,
  serializeDB,
  deserializeDB,
  queryDB,
  VALUE_FRAME_BITS,
  type FingerprintDB,
  type TrackEntry,
} from './dsp';
import { mulberry32 } from '../viz/random';

const fft = new FFT(DSP.fftSize);
const window = hannWindow(DSP.fftSize);

/** A spectrally-rich synthetic "track": several simultaneous sine partials
 * with small seeded frequency jitter per-sample so the spectrogram isn't a
 * perfectly static comb (which would produce too few distinct landmarks). */
function synthTrack(seed: number, seconds: number, partials: number[]): Float32Array {
  const rng = mulberry32(seed);
  const sr = DSP.sampleRate;
  const n = Math.round(seconds * sr);
  const out = new Float32Array(n);
  // Slowly-varying jitter per partial (recomputed every ~50ms) rather than
  // per-sample noise, so the tone stays coherent enough to fingerprint.
  const jitterStep = Math.round(sr * 0.05);
  const jitters = new Float32Array(partials.length);
  for (let i = 0; i < n; i++) {
    if (i % jitterStep === 0) {
      for (let p = 0; p < partials.length; p++) jitters[p] = 1 + (rng() - 0.5) * 0.004;
    }
    let v = 0;
    for (let p = 0; p < partials.length; p++) {
      v += Math.sin((2 * Math.PI * partials[p] * jitters[p] * i) / sr);
    }
    out[i] = (v / partials.length) * 0.8;
  }
  return out;
}

function mulberry32Excerpt(rng: () => number, x: Float32Array): Float32Array {
  const rms = Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length);
  const noiseAmp = rms / Math.sqrt(10); // ~10 dB SNR
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = x[i] + (rng() * 2 - 1) * noiseAmp * 1.73;
  return out;
}

interface BuiltTrack { entry: TrackEntry; landmarks: ReturnType<typeof fingerprint>; samples: Float32Array }

function buildDB(built: BuiltTrack[]): FingerprintDB {
  const total = built.reduce((n, b) => n + b.landmarks.length, 0);
  const hashes = new Uint32Array(total);
  const values = new Uint32Array(total);
  let i = 0;
  built.forEach((b, trackIndex) => {
    for (const lm of b.landmarks) {
      hashes[i] = lm.hash;
      values[i] = (trackIndex << VALUE_FRAME_BITS) | lm.t;
      i++;
    }
  });
  const order = Array.from(hashes.keys()).sort((a, b) => hashes[a] - hashes[b]);
  const sh = new Uint32Array(total), sv = new Uint32Array(total);
  order.forEach((src, dst) => { sh[dst] = hashes[src]; sv[dst] = values[src]; });
  return { version: DSP.version, tracks: built.map((b) => b.entry), hashes: sh, values: sv };
}

describe('dsp end-to-end (synthetic tracks)', () => {
  let db: FingerprintDB;
  let built: BuiltTrack[];

  beforeAll(() => {
    const tracks = [
      { seed: 0x1234, partials: [110, 233, 349, 466, 587, 705] },
      { seed: 0x5678, partials: [147, 261, 392, 523, 660, 784] },
    ];
    built = tracks.map(({ seed, partials }) => {
      const samples = synthTrack(seed, 25, partials);
      const landmarks = fingerprint(samples, fft, window);
      const frames = Math.floor((samples.length - DSP.fftSize) / DSP.hop) + 1;
      return { entry: { id: `synth-${seed}`, frames }, landmarks, samples };
    });
    const rawDb = buildDB(built);
    // Round-trip through serialize/deserialize exactly like the browser loads it.
    db = deserializeDB(serializeDB(rawDb), rawDb.tracks);
  });

  it('builds a DB with landmarks for both tracks', () => {
    expect(built[0].landmarks.length).toBeGreaterThan(100);
    expect(built[1].landmarks.length).toBeGreaterThan(100);
  });

  const excerptSeconds = 10;

  const cases: Array<{ label: string; degrade: (rng: () => number, x: Float32Array) => Float32Array }> = [
    { label: 'clean', degrade: (_rng, x) => x },
    { label: 'gain 0.3', degrade: (_rng, x) => x.map((v) => v * 0.3) },
    { label: 'noise 10dB', degrade: mulberry32Excerpt },
  ];

  for (let ti = 0; ti < 2; ti++) {
    for (const c of cases) {
      it(`identifies track ${ti} (${c.label}) with the correct offset`, () => {
        const rng = mulberry32(0xc0ffee + ti * 7 + c.label.length);
        const b = built[ti];
        const excerptLen = Math.round(excerptSeconds * DSP.sampleRate);
        const maxStart = b.samples.length - excerptLen;
        const start = Math.floor(rng() * maxStart);
        const excerpt = c.degrade(rng, b.samples.slice(start, start + excerptLen));

        const results = queryDB(db, fingerprint(excerpt, fft, window));
        const top = results[0];
        const expectedOffset = Math.round(start / DSP.hop);
        const runnerUp = results.find((r) => r.trackIndex !== ti);

        expect(top).toBeDefined();
        expect(top.trackIndex).toBe(ti);
        expect(Math.abs(top.offsetFrames - expectedOffset)).toBeLessThanOrEqual(4);
        expect(top.votes).toBeGreaterThan(runnerUp?.votes ?? 0);
      });
    }
  }
});
