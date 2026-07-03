/**
 * Shared fingerprinting DSP used by BOTH the offline build script
 * (scripts/build-fingerprints.ts) and the in-browser matcher. Any change to
 * the parameters or algorithms here changes the fingerprints — bump
 * DSP.version and rebuild public/fp/ when that happens.
 *
 * Pipeline: mono PCM @ 12 kHz → STFT (2048/512 Hann) → constellation peaks →
 * landmark pairs hashed as (f1:9 | f2:9 | dt:6). Frequencies are quantized to
 * 2-bin steps in the hash so small turntable speed error (±0.5%) still lands
 * on the same hash for most of the spectrum.
 */

export const DSP = {
  version: 1,
  /** Working sample rate for all fingerprinting. */
  sampleRate: 12000,
  fftSize: 2048,
  hop: 512,
  /** Ignore spectrogram content below/above these bins (5.86 Hz per bin). */
  minBin: 17,   // ~100 Hz
  maxBin: 1023, // 6 kHz
  /** Peak picking. */
  peaksPerFrame: 3,
  neighborT: 2, // frames each side that a peak must dominate
  neighborF: 5, // bins each side
  /** Peak must exceed frame mean log-magnitude by this much (ln units). */
  peakFloor: 1.5,
  /** Landmark pairing (anchor → targets in a forward zone). */
  fanout: 2,
  minDt: 3,
  maxDt: 63,
  maxDf: 255, // bins
} as const;

export const FRAMES_PER_SECOND = DSP.sampleRate / DSP.hop; // 23.4375
/** Offsets are voted into bins of this many frames (~85 ms). */
export const OFFSET_BIN_FRAMES = 2;

// ---------------------------------------------------------------------------
// FFT
// ---------------------------------------------------------------------------

/** Iterative radix-2 complex FFT with precomputed twiddle/bit-reversal tables. */
export class FFT {
  private cos: Float32Array;
  private sin: Float32Array;
  private rev: Uint32Array;

  constructor(readonly size: number) {
    if ((size & (size - 1)) !== 0) throw new Error('FFT size must be a power of 2');
    this.cos = new Float32Array(size / 2);
    this.sin = new Float32Array(size / 2);
    for (let i = 0; i < size / 2; i++) {
      this.cos[i] = Math.cos((-2 * Math.PI * i) / size);
      this.sin[i] = Math.sin((-2 * Math.PI * i) / size);
    }
    this.rev = new Uint32Array(size);
    const bits = Math.log2(size);
    for (let i = 0; i < size; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.rev[i] = r;
    }
  }

  /** In-place transform of interleaved re/im arrays of length `size`. */
  transform(re: Float32Array, im: Float32Array) {
    const n = this.size;
    const rev = this.rev;
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const half = len >> 1;
      const step = n / len;
      for (let i = 0; i < n; i += len) {
        for (let k = 0; k < half; k++) {
          const tw = k * step;
          const c = this.cos[tw], s = this.sin[tw];
          const a = i + k, b = a + half;
          const tr = re[b] * c - im[b] * s;
          const ti = re[b] * s + im[b] * c;
          re[b] = re[a] - tr;
          im[b] = im[a] - ti;
          re[a] += tr;
          im[a] += ti;
        }
      }
    }
  }
}

export function hannWindow(size: number): Float32Array {
  const w = new Float32Array(size);
  for (let i = 0; i < size; i++) w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)));
  return w;
}

/**
 * Log-magnitude spectrogram of `samples` (12 kHz mono). Returns one
 * Float32Array of fftSize/2 bins per hop. `firstFrame` lets callers keep
 * absolute frame numbering across a rolling buffer.
 */
export function spectrogram(samples: Float32Array, fft: FFT, window: Float32Array): Float32Array[] {
  const { fftSize, hop } = DSP;
  const frames: Float32Array[] = [];
  const re = new Float32Array(fftSize);
  const im = new Float32Array(fftSize);
  for (let start = 0; start + fftSize <= samples.length; start += hop) {
    for (let i = 0; i < fftSize; i++) re[i] = samples[start + i] * window[i];
    im.fill(0);
    fft.transform(re, im);
    const mags = new Float32Array(fftSize / 2);
    for (let k = 0; k < fftSize / 2; k++) {
      mags[k] = Math.log(1e-9 + Math.hypot(re[k], im[k]));
    }
    frames.push(mags);
  }
  return frames;
}

// ---------------------------------------------------------------------------
// Constellation peaks & landmarks
// ---------------------------------------------------------------------------

export interface Peak { t: number; f: number; m: number }
export interface Landmark { hash: number; t: number }

/** Local-maxima peaks over the spectrogram, at most peaksPerFrame per frame. */
export function extractPeaks(frames: Float32Array[]): Peak[] {
  const { minBin, maxBin, neighborT, neighborF, peaksPerFrame, peakFloor } = DSP;
  const peaks: Peak[] = [];
  const candidates: Peak[] = [];

  for (let t = 0; t < frames.length; t++) {
    const frame = frames[t];
    let mean = 0;
    for (let k = minBin; k <= maxBin; k++) mean += frame[k];
    mean /= maxBin - minBin + 1;
    const floor = mean + peakFloor;

    candidates.length = 0;
    for (let k = minBin; k <= maxBin; k++) {
      const v = frame[k];
      if (v < floor) continue;
      let isMax = true;
      for (let dt = -neighborT; isMax && dt <= neighborT; dt++) {
        const other = frames[t + dt];
        if (!other) continue;
        const lo = Math.max(0, k - neighborF);
        const hi = Math.min(frame.length - 1, k + neighborF);
        for (let j = lo; j <= hi; j++) {
          if (dt === 0 && j === k) continue;
          const o = other[j];
          // Strict > on one side of the tie so two equal bins don't both win.
          if (o > v || (o === v && (dt < 0 || (dt === 0 && j < k)))) { isMax = false; break; }
        }
      }
      if (isMax) candidates.push({ t, f: k, m: v });
    }

    if (candidates.length > peaksPerFrame) {
      candidates.sort((a, b) => b.m - a.m);
      candidates.length = peaksPerFrame;
      candidates.sort((a, b) => a.f - b.f);
    }
    peaks.push(...candidates);
  }
  return peaks;
}

/** Pack a landmark hash: f1/f2 quantized to 9 bits (2-bin steps), dt 6 bits. */
export function packHash(f1: number, f2: number, dt: number): number {
  return (((f1 >> 1) & 0x1ff) << 15) | (((f2 >> 1) & 0x1ff) << 6) | (dt & 0x3f);
}

/** Pair each anchor peak with up to `fanout` peaks in its forward target zone. */
export function pairLandmarks(peaks: Peak[]): Landmark[] {
  const { fanout, minDt, maxDt, maxDf } = DSP;
  const landmarks: Landmark[] = [];
  for (let i = 0; i < peaks.length; i++) {
    const a = peaks[i];
    let paired = 0;
    for (let j = i + 1; j < peaks.length && paired < fanout; j++) {
      const b = peaks[j];
      const dt = b.t - a.t;
      if (dt < minDt) continue;
      if (dt > maxDt) break;
      if (Math.abs(b.f - a.f) > maxDf) continue;
      landmarks.push({ hash: packHash(a.f, b.f, dt), t: a.t });
      paired++;
    }
  }
  return landmarks;
}

/** Convenience: samples (12 kHz mono) → landmarks. */
export function fingerprint(samples: Float32Array, fft: FFT, window: Float32Array): Landmark[] {
  return pairLandmarks(extractPeaks(spectrogram(samples, fft, window)));
}

// ---------------------------------------------------------------------------
// Resampling (anything → 12 kHz mono)
// ---------------------------------------------------------------------------

/** Windowed-sinc low-pass FIR. `cutoff` is in Hz relative to `rate`. */
function designLowpass(taps: number, cutoff: number, rate: number): Float32Array {
  const h = new Float32Array(taps);
  const fc = cutoff / rate;
  const mid = (taps - 1) / 2;
  let sum = 0;
  for (let i = 0; i < taps; i++) {
    const x = i - mid;
    const sinc = x === 0 ? 2 * Math.PI * fc : Math.sin(2 * Math.PI * fc * x) / x;
    const blackman =
      0.42 - 0.5 * Math.cos((2 * Math.PI * i) / (taps - 1)) + 0.08 * Math.cos((4 * Math.PI * i) / (taps - 1));
    h[i] = sinc * blackman;
    sum += h[i];
  }
  for (let i = 0; i < taps; i++) h[i] /= sum;
  return h;
}

/**
 * Streaming resampler: low-pass at ~5.4 kHz then linear-interpolate down to
 * 12 kHz. Keeps filter/phase state across process() calls so it can consume
 * arbitrary mic chunks.
 */
export class StreamResampler {
  private taps: Float32Array;
  private carry: Float32Array = new Float32Array(0);
  /** Fractional read position into the filtered signal, in input samples. */
  private pos = 0;
  private ratio: number;

  constructor(readonly inputRate: number, readonly outputRate = DSP.sampleRate, taps = 96) {
    if (inputRate < outputRate) throw new Error('upsampling not supported');
    this.ratio = inputRate / outputRate;
    this.taps = designLowpass(taps, 0.45 * outputRate, inputRate);
  }

  process(chunk: Float32Array): Float32Array {
    const taps = this.taps;
    const n = taps.length;
    // input = carry (unconsumed tail) + new chunk
    const input = new Float32Array(this.carry.length + chunk.length);
    input.set(this.carry, 0);
    input.set(chunk, this.carry.length);

    // filtered[i] is valid for i in [0, input.length - n]
    const validEnd = input.length - n;
    if (validEnd < 1) { this.carry = input; return new Float32Array(0); }

    const out: number[] = [];
    while (this.pos + 1 <= validEnd) {
      const i = Math.floor(this.pos);
      const frac = this.pos - i;
      let a = 0, b = 0;
      for (let k = 0; k < n; k++) {
        a += input[i + k] * taps[k];
        b += input[i + 1 + k] * taps[k];
      }
      out.push(a * (1 - frac) + b * frac);
      this.pos += this.ratio;
    }

    // Drop fully-consumed input; keep what future outputs still need.
    const keepFrom = Math.min(Math.floor(this.pos), validEnd);
    this.carry = input.slice(keepFrom);
    this.pos -= keepFrom;
    return Float32Array.from(out);
  }
}

/** One-shot resample for offline use. */
export function resampleTo12k(samples: Float32Array, inputRate: number): Float32Array {
  if (inputRate === DSP.sampleRate) return samples;
  const rs = new StreamResampler(inputRate, DSP.sampleRate);
  return rs.process(samples);
}

// ---------------------------------------------------------------------------
// Fingerprint database + matching
// ---------------------------------------------------------------------------

const DB_MAGIC = 0x53564650; // 'SVFP'
/** value = trackIndex (upper bits) | frame (lower VALUE_FRAME_BITS bits) */
export const VALUE_FRAME_BITS = 19;

export interface TrackEntry { id: string; frames: number }

export interface FingerprintDB {
  version: number;
  tracks: TrackEntry[];
  /** Sorted ascending; parallel to values. */
  hashes: Uint32Array;
  values: Uint32Array;
}

export function serializeDB(db: FingerprintDB): ArrayBuffer {
  const count = db.hashes.length;
  const buf = new ArrayBuffer(16 + count * 8);
  const head = new DataView(buf);
  head.setUint32(0, DB_MAGIC, true);
  head.setUint32(4, db.version, true);
  head.setUint32(8, count, true);
  head.setUint32(12, db.tracks.length, true);
  new Uint32Array(buf, 16, count).set(db.hashes);
  new Uint32Array(buf, 16 + count * 4, count).set(db.values);
  return buf;
}

/** `tracks` comes from the manifest JSON that ships next to db.bin. */
export function deserializeDB(buf: ArrayBuffer, tracks: TrackEntry[]): FingerprintDB {
  const head = new DataView(buf);
  if (head.getUint32(0, true) !== DB_MAGIC) throw new Error('bad fingerprint DB magic');
  const version = head.getUint32(4, true);
  if (version !== DSP.version) throw new Error(`fingerprint DB version ${version} != DSP version ${DSP.version} — rerun npm run fingerprints`);
  const count = head.getUint32(8, true);
  if (head.getUint32(12, true) !== tracks.length) throw new Error('fingerprint DB track count mismatch');
  return {
    version,
    tracks,
    hashes: new Uint32Array(buf.slice(16, 16 + count * 4)),
    values: new Uint32Array(buf.slice(16 + count * 4, 16 + count * 8)),
  };
}

export interface MatchResult {
  trackIndex: number;
  /** Track frame at query frame 0 (i.e. dbFrame - queryFrame), in frames. */
  offsetFrames: number;
  votes: number;
}

/**
 * Query landmarks against the DB: every hash hit votes for
 * (track, dbFrame - queryFrame); a real match piles votes into one offset bin.
 * Returns per-track best bins, sorted by votes descending.
 */
export function queryDB(db: FingerprintDB, landmarks: Landmark[]): MatchResult[] {
  const { hashes, values } = db;
  const votes = new Map<number, number>();
  const frameMask = (1 << VALUE_FRAME_BITS) - 1;

  for (const lm of landmarks) {
    // binary search for first occurrence of lm.hash
    let lo = 0, hi = hashes.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (hashes[mid] < lm.hash) lo = mid + 1;
      else hi = mid;
    }
    for (let i = lo; i < hashes.length && hashes[i] === lm.hash; i++) {
      const trackIndex = values[i] >>> VALUE_FRAME_BITS;
      const dbFrame = values[i] & frameMask;
      const offsetBin = Math.round((dbFrame - lm.t) / OFFSET_BIN_FRAMES);
      // key packs track + offset bin (offset bin shifted to stay positive)
      const key = trackIndex * 2_000_000 + offsetBin + 1_000_000;
      votes.set(key, (votes.get(key) ?? 0) + 1);
    }
  }

  const bestPerTrack = new Map<number, MatchResult>();
  for (const [key, count] of votes) {
    const trackIndex = Math.floor(key / 2_000_000);
    const offsetBin = (key % 2_000_000) - 1_000_000;
    const cur = bestPerTrack.get(trackIndex);
    if (!cur || count > cur.votes) {
      bestPerTrack.set(trackIndex, { trackIndex, offsetFrames: offsetBin * OFFSET_BIN_FRAMES, votes: count });
    }
  }
  return [...bestPerTrack.values()].sort((a, b) => b.votes - a.votes);
}
