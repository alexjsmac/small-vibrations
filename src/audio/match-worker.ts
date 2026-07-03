/// <reference lib="webworker" />
/**
 * Fingerprint matching off the main thread. Receives 12 kHz mono PCM chunks,
 * keeps a rolling window, and every ~1.5 s of new audio fingerprints the
 * window and votes it against the track database.
 */
import {
  DSP, FFT, hannWindow, fingerprint, deserializeDB, queryDB,
  type FingerprintDB, type TrackEntry, type MatchResult,
} from './dsp';

export type WorkerIn =
  | { type: 'init'; db: ArrayBuffer; tracks: TrackEntry[] }
  | { type: 'samples'; samples: Float32Array }
  | { type: 'reset' };

export interface CycleMessage {
  type: 'cycle';
  /** Best-scoring track bin, or null if the window was empty. */
  top: MatchResult | null;
  /** Votes of the best bin belonging to a *different* track. */
  runnerUpVotes: number;
  /** Seconds of audio in the analyzed window. */
  windowSeconds: number;
  /** Estimated playback position (seconds into the track) as of "now". */
  positionSeconds: number | null;
}

export type WorkerOut = { type: 'ready' } | CycleMessage;

const WINDOW_SECONDS = 12;
const MIN_SECONDS = 4;     // don't try to match on less than this
const CYCLE_SECONDS = 1.5; // new audio between match attempts

const ringLen = WINDOW_SECONDS * DSP.sampleRate;
const ring = new Float32Array(ringLen);
let writePos = 0;
let totalWritten = 0;
let sinceCycle = 0;

let db: FingerprintDB | null = null;
const fft = new FFT(DSP.fftSize);
const window = hannWindow(DSP.fftSize);

function pushSamples(samples: Float32Array) {
  for (let i = 0; i < samples.length; i++) {
    ring[writePos] = samples[i];
    writePos = (writePos + 1) % ringLen;
  }
  totalWritten += samples.length;
  sinceCycle += samples.length;
}

/** Oldest→newest copy of the buffered window. */
function linearize(): Float32Array {
  const n = Math.min(totalWritten, ringLen);
  const out = new Float32Array(n);
  const start = (writePos - n + ringLen * 2) % ringLen;
  const firstPart = Math.min(n, ringLen - start);
  out.set(ring.subarray(start, start + firstPart), 0);
  if (firstPart < n) out.set(ring.subarray(0, n - firstPart), firstPart);
  return out;
}

function cycle() {
  if (!db) return;
  const samples = linearize();
  const landmarks = fingerprint(samples, fft, window);
  const results = queryDB(db, landmarks);
  const top = results[0] ?? null;
  const runnerUp = top ? results.find((r) => r.trackIndex !== top.trackIndex) : null;
  const positionSeconds = top
    ? (top.offsetFrames * DSP.hop + samples.length) / DSP.sampleRate
    : null;
  const msg: CycleMessage = {
    type: 'cycle',
    top,
    runnerUpVotes: runnerUp?.votes ?? 0,
    windowSeconds: samples.length / DSP.sampleRate,
    positionSeconds,
  };
  postMessage(msg);
}

self.onmessage = (e: MessageEvent<WorkerIn>) => {
  const msg = e.data;
  if (msg.type === 'init') {
    db = deserializeDB(msg.db, msg.tracks);
    postMessage({ type: 'ready' } satisfies WorkerOut);
  } else if (msg.type === 'samples') {
    pushSamples(msg.samples);
    if (totalWritten >= MIN_SECONDS * DSP.sampleRate && sinceCycle >= CYCLE_SECONDS * DSP.sampleRate) {
      sinceCycle = 0;
      cycle();
    }
  } else if (msg.type === 'reset') {
    writePos = 0; totalWritten = 0; sinceCycle = 0;
    ring.fill(0);
  }
};
