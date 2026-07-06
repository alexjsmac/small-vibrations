#!/usr/bin/env node
/**
 * Profile a track master for visualization staging: RMS + low/high band
 * energy per window, printed as a timeline. Used to find section boundaries
 * (the CUES table in a track's sections.ts).
 *
 *   node scripts/profile-track.mjs "<path-to-master.wav>" [windowSeconds=2]
 *
 * Reads 16/24/32-bit PCM and 32-bit float RIFF WAVs, any channel count.
 * The low band is a one-pole lowpass at ~200 Hz (bass line / kick);
 * "hi" is everything above it. Boundaries show up as sustained level
 * steps — read the bar chart, not individual rows.
 */
import { readFileSync } from 'node:fs';

const path = process.argv[2];
const windowSec = Number(process.argv[3] ?? 2);
if (!path) {
  console.error('usage: node scripts/profile-track.mjs <master.wav> [windowSeconds]');
  process.exit(1);
}

const buf = readFileSync(path);
const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
if (view.getUint32(0, false) !== 0x52494646 || view.getUint32(8, false) !== 0x57415645) {
  console.error('not a RIFF/WAVE file');
  process.exit(1);
}

let fmt = null, dataOff = -1, dataSize = 0;
let p = 12;
while (p + 8 <= view.byteLength) {
  const id = view.getUint32(p, false);
  const size = view.getUint32(p + 4, true);
  if (id === 0x666d7420) { // 'fmt '
    let format = view.getUint16(p + 8, true);
    const channels = view.getUint16(p + 10, true);
    const sampleRate = view.getUint32(p + 12, true);
    const bits = view.getUint16(p + 22, true);
    if (format === 0xfffe) format = view.getUint16(p + 32, true);
    fmt = { format, channels, sampleRate, bits };
  } else if (id === 0x64617461) { // 'data'
    dataOff = p + 8;
    dataSize = size;
  }
  p += 8 + size + (size & 1);
}
if (!fmt || dataOff < 0) { console.error('missing fmt/data chunk'); process.exit(1); }

const { format, channels, sampleRate, bits } = fmt;
const bytesPer = bits / 8;
const frames = Math.floor(dataSize / (bytesPer * channels));

function sample(off) {
  if (format === 3 && bits === 32) return view.getFloat32(off, true);
  if (bits === 16) return view.getInt16(off, true) / 32768;
  if (bits === 24) {
    const b0 = view.getUint8(off), b1 = view.getUint8(off + 1), b2 = view.getUint8(off + 2);
    return (((b2 << 24) | (b1 << 16) | (b0 << 8)) >> 8) / 8388608;
  }
  if (bits === 32) return view.getInt32(off, true) / 2147483648;
  throw new Error(`unsupported format ${format}/${bits}-bit`);
}

const win = Math.round(sampleRate * windowSec);
const nWin = Math.floor(frames / win);
const alpha = 1 - Math.exp((-2 * Math.PI * 200) / sampleRate);
let lp = 0;
const rows = [];

for (let w = 0; w < nWin; w++) {
  let sumSq = 0, sumLo = 0, sumHi = 0;
  for (let i = 0; i < win; i++) {
    let v = 0;
    const frame = w * win + i;
    for (let c = 0; c < channels; c++) v += sample(dataOff + (frame * channels + c) * bytesPer);
    v /= channels;
    lp += alpha * (v - lp);
    const hi = v - lp;
    sumSq += v * v; sumLo += lp * lp; sumHi += hi * hi;
  }
  rows.push({ t: w * windowSec, rms: Math.sqrt(sumSq / win), lo: Math.sqrt(sumLo / win), hi: Math.sqrt(sumHi / win) });
}

const max = Math.max(...rows.map((r) => r.rms));
console.log(`# ${path.split('/').pop()}`);
console.log(`# ${(frames / sampleRate).toFixed(1)}s · ${sampleRate}Hz · ${bits}-bit · ${channels}ch · window ${windowSec}s\n`);
for (const r of rows) {
  const db = 20 * Math.log10(r.rms / max + 1e-9);
  const bar = '#'.repeat(Math.max(0, Math.round(40 + db)));
  const m = Math.floor(r.t / 60), s = String(Math.round(r.t % 60)).padStart(2, '0');
  console.log(`${m}:${s} ${db.toFixed(0).padStart(4)}dB lo=${(r.lo / max).toFixed(2)} hi=${(r.hi / max).toFixed(2)} ${bar}`);
}
