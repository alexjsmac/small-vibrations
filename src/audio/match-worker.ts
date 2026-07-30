/// <reference lib="webworker" />
/**
 * Fingerprint matching off the main thread. Receives 12 kHz mono PCM chunks,
 * keeps a rolling window, and every ~1.5 s of new audio fingerprints the
 * window and votes it against the track database.
 */
import {
  DSP, FFT, hannWindow, deserializeDB, matchAtSpeeds, SPEED_RATIOS,
  type FingerprintDB, type TrackEntry, type MatchResult,
} from './dsp';

export type WorkerIn =
  | { type: 'init'; db: ArrayBuffer; tracks: TrackEntry[] }
  | { type: 'samples'; samples: Float32Array }
  /** Stop searching speeds — the engine confirmed a track at this ratio. */
  | { type: 'lockSpeed'; ratio: number }
  /** Signal lost; resume searching. */
  | { type: 'unlockSpeed' }
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
  /** Playback ratio this cycle's result came from (1 = nominal speed). */
  ratio: number;
}

export type WorkerOut = { type: 'ready' } | CycleMessage;

const WINDOW_SECONDS = 12;
const MIN_SECONDS = 4;     // don't try to match on less than this
const CYCLE_SECONDS = 1.5; // new audio between match attempts

/**
 * How many candidate playback ratios to try per cycle while unlocked. Each
 * costs a full fingerprint+query (~80 ms for a 12 s window on a laptop, call
 * it 3x that on a phone), so 3 keeps a cycle well inside its 1.5 s budget
 * while sweeping all of SPEED_RATIOS in ~5 cycles.
 */
const RATIOS_PER_CYCLE = 3;
/**
 * Votes at which a ratio is worth re-testing next cycle instead of rotating
 * past it. The engine owns the real match gate; this only decides where to
 * spend the next cycle's budget, so it is deliberately loose — but without it,
 * rotation would test a different ratio each cycle and the engine's
 * consecutive-agreement rule could never be satisfied on an off-speed deck.
 */
const RATIO_HINT_VOTES = 10;

const ringLen = WINDOW_SECONDS * DSP.sampleRate;
const ring = new Float32Array(ringLen);
let writePos = 0;
let totalWritten = 0;
let sinceCycle = 0;

let db: FingerprintDB | null = null;
const fft = new FFT(DSP.fftSize);
const window = hannWindow(DSP.fftSize);

/** Ratio the engine confirmed a track at; null while still searching. */
let lockedRatio: number | null = null;
/** Ratio that scored well last cycle and is worth re-testing first. */
let hintedRatio: number | null = null;
/** Rotation cursor into SPEED_RATIOS. */
let ratioCursor = 0;

/**
 * Ratios to try this cycle: the locked one alone once a track is confirmed,
 * otherwise last cycle's promising ratio (so the engine can see the same track
 * on consecutive cycles) plus the next few from the rotation.
 */
function ratiosForCycle(): number[] {
  if (lockedRatio !== null) return [lockedRatio];
  const batch: number[] = [];
  if (hintedRatio !== null) batch.push(hintedRatio);
  while (batch.length < RATIOS_PER_CYCLE) {
    const ratio = SPEED_RATIOS[ratioCursor % SPEED_RATIOS.length];
    ratioCursor++;
    if (!batch.includes(ratio)) batch.push(ratio);
  }
  return batch;
}

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
  const best = matchAtSpeeds(db, samples, fft, window, ratiosForCycle());

  // Worth re-testing first next cycle? (Ignored once the engine locks.)
  hintedRatio = (best.top?.votes ?? 0) >= RATIO_HINT_VOTES ? best.ratio : null;

  // Position comes off the speed-corrected window, so it is in the track's
  // own timeline rather than the (faster or slower) wall-clock one.
  const positionSeconds = best.top
    ? (best.top.offsetFrames * DSP.hop + best.correctedSamples) / DSP.sampleRate
    : null;
  const msg: CycleMessage = {
    type: 'cycle',
    top: best.top,
    runnerUpVotes: best.runnerUpVotes,
    windowSeconds: samples.length / DSP.sampleRate,
    positionSeconds,
    ratio: best.ratio,
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
  } else if (msg.type === 'lockSpeed') {
    lockedRatio = msg.ratio;
  } else if (msg.type === 'unlockSpeed') {
    lockedRatio = null;
    hintedRatio = null;
  } else if (msg.type === 'reset') {
    writePos = 0; totalWritten = 0; sinceCycle = 0;
    ring.fill(0);
    lockedRatio = null; hintedRatio = null; ratioCursor = 0;
  }
};
