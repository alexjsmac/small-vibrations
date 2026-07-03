/**
 * Offline fingerprint builder. Reads the track masters (WAV), computes the
 * landmark fingerprint database, and writes public/fp/db.bin + manifest.json.
 *
 *   npm run fingerprints                      # build from the default masters dir
 *   npm run fingerprints -- /path/to/masters  # explicit dir
 *   npm run fingerprints -- --selftest        # verify DB against noisy excerpts
 *
 * Masters are read in place and never copied into the repo.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DSP, FFT, hannWindow, fingerprint, resampleTo12k,
  serializeDB, deserializeDB, queryDB,
  FRAMES_PER_SECOND, VALUE_FRAME_BITS,
  type FingerprintDB, type TrackEntry, type Landmark,
} from '../src/audio/dsp';
import { TRACKS } from '../src/tracks';

const DEFAULT_MASTERS_DIR = '/Users/amaclean/Downloads/Sunntack - Small Vibrations EP';

/** Track id → filename prefix in the masters dir ("01 " etc.). */
const FILE_PREFIX: Record<string, string> = {
  a1: '01', a2: '02', a3: '03', b1: '04', b2: '05', b3: '06',
};

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(repoRoot, 'public', 'fp');

// ---------------------------------------------------------------------------
// WAV parsing (PCM 16/24/32-bit int + 32-bit float, mono/stereo)
// ---------------------------------------------------------------------------

interface WavData { sampleRate: number; mono: Float32Array }

function readWav(path: string): WavData {
  const buf = readFileSync(path);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (view.getUint32(0, false) !== 0x52494646 /* RIFF */ || view.getUint32(8, false) !== 0x57415645 /* WAVE */) {
    throw new Error(`${path}: not a RIFF/WAVE file`);
  }

  let fmt: { format: number; channels: number; sampleRate: number; bits: number } | null = null;
  let dataOffset = -1, dataSize = 0;

  let p = 12;
  while (p + 8 <= view.byteLength) {
    const id = view.getUint32(p, false);
    const size = view.getUint32(p + 4, true);
    if (id === 0x666d7420 /* 'fmt ' */) {
      let format = view.getUint16(p + 8, true);
      const channels = view.getUint16(p + 10, true);
      const sampleRate = view.getUint32(p + 12, true);
      const bits = view.getUint16(p + 22, true);
      if (format === 0xfffe) format = view.getUint16(p + 32, true); // WAVE_FORMAT_EXTENSIBLE
      fmt = { format, channels, sampleRate, bits };
    } else if (id === 0x64617461 /* 'data' */) {
      dataOffset = p + 8;
      dataSize = size;
    }
    p += 8 + size + (size & 1);
  }
  if (!fmt || dataOffset < 0) throw new Error(`${path}: missing fmt/data chunk`);

  const { format, channels, bits } = fmt;
  const bytesPerSample = bits / 8;
  const frameCount = Math.floor(dataSize / (bytesPerSample * channels));
  const mono = new Float32Array(frameCount);

  for (let i = 0; i < frameCount; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) {
      const off = dataOffset + (i * channels + c) * bytesPerSample;
      let s: number;
      if (format === 3 && bits === 32) {
        s = view.getFloat32(off, true);
      } else if (bits === 16) {
        s = view.getInt16(off, true) / 32768;
      } else if (bits === 24) {
        const b0 = view.getUint8(off), b1 = view.getUint8(off + 1), b2 = view.getUint8(off + 2);
        s = (((b2 << 24) | (b1 << 16) | (b0 << 8)) >> 8) / 8388608;
      } else if (bits === 32) {
        s = view.getInt32(off, true) / 2147483648;
      } else {
        throw new Error(`${path}: unsupported format ${format}/${bits}-bit`);
      }
      sum += s;
    }
    mono[i] = sum / channels;
  }
  return { sampleRate: fmt.sampleRate, mono };
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

function findMasterFile(dir: string, trackId: string): string {
  const prefix = FILE_PREFIX[trackId];
  const hit = readdirSync(dir).find((f) => f.startsWith(prefix) && f.toLowerCase().endsWith('.wav'));
  if (!hit) throw new Error(`no WAV starting with "${prefix}" in ${dir}`);
  return join(dir, hit);
}

interface BuiltTrack { entry: TrackEntry; landmarks: Landmark[]; samples12k: Float32Array }

function buildTrack(dir: string, trackId: string, fft: FFT, window: Float32Array): BuiltTrack {
  const path = findMasterFile(dir, trackId);
  process.stdout.write(`  ${trackId}  ${path.split('/').pop()} … `);
  const t0 = Date.now();
  const wav = readWav(path);
  const samples12k = resampleTo12k(wav.mono, wav.sampleRate);
  const landmarks = fingerprint(samples12k, fft, window);
  const frames = Math.floor((samples12k.length - DSP.fftSize) / DSP.hop) + 1;
  if (frames >= 1 << VALUE_FRAME_BITS) throw new Error(`${trackId}: too many frames for value packing`);
  console.log(`${(wav.mono.length / wav.sampleRate).toFixed(0)}s, ${landmarks.length} landmarks (${(Date.now() - t0) / 1000}s)`);
  return { entry: { id: trackId, frames }, landmarks, samples12k };
}

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
  // sort both arrays by hash
  const order = Array.from(hashes.keys()).sort((a, b) => hashes[a] - hashes[b]);
  const sh = new Uint32Array(total), sv = new Uint32Array(total);
  order.forEach((src, dst) => { sh[dst] = hashes[src]; sv[dst] = values[src]; });
  return { version: DSP.version, tracks: built.map((b) => b.entry), hashes: sh, values: sv };
}

// ---------------------------------------------------------------------------
// Self-test: noisy excerpts must identify the right track + offset
// ---------------------------------------------------------------------------

function selftest(db: FingerprintDB, built: BuiltTrack[], fft: FFT, window: Float32Array) {
  const excerptLen = Math.round(10 * DSP.sampleRate);
  let pass = 0, fail = 0;
  const rng = mulberry32(0xC0FFEE);

  const cases: Array<{ label: string; degrade: (x: Float32Array) => Float32Array }> = [
    { label: 'clean       ', degrade: (x) => x },
    { label: 'gain 0.3    ', degrade: (x) => x.map((v) => v * 0.3) },
    {
      label: 'noise 10dB  ',
      degrade: (x) => {
        const rms = Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length);
        const noiseAmp = rms / Math.sqrt(10); // ~10 dB SNR
        return x.map((v) => v + (rng() * 2 - 1) * noiseAmp * 1.73);
      },
    },
  ];

  console.log('\nself-test (10s excerpts):');
  for (let ti = 0; ti < built.length; ti++) {
    const b = built[ti];
    for (const c of cases) {
      const maxStart = b.samples12k.length - excerptLen;
      const start = Math.floor(rng() * maxStart);
      const excerpt = c.degrade(b.samples12k.slice(start, start + excerptLen));
      const results = queryDB(db, fingerprint(excerpt, fft, window));
      const top = results[0];
      const expectedOffset = Math.round(start / DSP.hop);
      const runnerUp = results.find((r) => r.trackIndex !== ti);
      const okTrack = top && top.trackIndex === ti;
      const okOffset = okTrack && Math.abs(top.offsetFrames - expectedOffset) <= 4;
      const status = okTrack && okOffset ? 'PASS' : 'FAIL';
      if (status === 'PASS') pass++; else fail++;
      console.log(
        `  ${status}  ${b.entry.id} ${c.label} votes=${String(top?.votes ?? 0).padStart(4)}  ` +
        `runner-up=${String(runnerUp?.votes ?? 0).padStart(3)}  ` +
        `offset ${top?.offsetFrames ?? '—'} vs ${expectedOffset} (@${(start / DSP.sampleRate).toFixed(0)}s)`
      );
    }
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

function mulberry32(a: number) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const runSelftest = args.includes('--selftest');
const dir = args.find((a) => !a.startsWith('--')) ?? DEFAULT_MASTERS_DIR;

if (!existsSync(dir)) {
  console.error(`masters dir not found: ${dir}\nusage: npm run fingerprints -- [dir] [--selftest]`);
  process.exit(1);
}

console.log(`building fingerprints (DSP v${DSP.version}) from: ${dir}`);
const fft = new FFT(DSP.fftSize);
const window = hannWindow(DSP.fftSize);
const built = TRACKS.map((t) => buildTrack(dir, t.id, fft, window));
const db = buildDB(built);

mkdirSync(outDir, { recursive: true });
const bin = serializeDB(db);
writeFileSync(join(outDir, 'db.bin'), Buffer.from(bin));
writeFileSync(join(outDir, 'manifest.json'), JSON.stringify({
  version: DSP.version,
  count: db.hashes.length,
  tracks: db.tracks,
}, null, 2));
console.log(`\nwrote public/fp/db.bin (${(bin.byteLength / 1024 / 1024).toFixed(2)} MB, ${db.hashes.length} landmarks) + manifest.json`);

if (runSelftest) {
  // round-trip through serialization so we test exactly what the browser loads
  const roundTripped = deserializeDB(bin, db.tracks);
  selftest(roundTripped, built, fft, window);
}
