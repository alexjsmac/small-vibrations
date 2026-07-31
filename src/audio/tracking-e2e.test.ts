/**
 * End-to-end proof that the lock survives a real off-speed, drifting deck.
 *
 * tracking.test.ts checks the decision logic against hand-fed numbers; this
 * runs the whole loop — RatioScheduler → matchAtSpeeds → TrackLock — over the
 * genuine fingerprint pipeline, driven by a synthetic "turntable" whose speed
 * is both wrong and moving. Synthetic tracks (like dsp-e2e.test.ts) so CI never
 * needs the masters.
 *
 * This is the failure the whole module exists for: acquisition already worked,
 * but the lock was pinned to a coarse 1%-grid ratio forever, and a deck that
 * wandered half a percent off it lost the track — silently, mid-side.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import {
  DSP, FFT, hannWindow, fingerprint, serializeDB, deserializeDB, queryDB,
  matchAtSpeeds, correctSpeed, VALUE_FRAME_BITS,
  type FingerprintDB, type TrackEntry,
} from './dsp';
import { RatioScheduler, TrackLock, ACQUIRE_VOTES } from './tracking';
import { mulberry32 } from '../viz/random';

const fft = new FFT(DSP.fftSize);
const window = hannWindow(DSP.fftSize);

const TRACK_SECONDS = 260;
const CYCLE_SECONDS = 1.5;
const WINDOW_SECONDS = 12;

/** Spectrally-rich synthetic "music" — enough landmarks to match reliably. */
function makeTrack(seed: number, seconds: number): Float32Array {
  const rnd = mulberry32(seed);
  const n = seconds * DSP.sampleRate;
  const x = new Float32Array(n);
  for (let ev = 0; ev < seconds * 6; ev++) {
    const t0 = Math.floor(rnd() * n);
    const f0 = 110 * Math.pow(2, Math.floor(rnd() * 30) / 12);
    const dur = Math.floor((0.3 + rnd() * 1.5) * DSP.sampleRate);
    for (let h = 1; h <= 6; h++) {
      const f = f0 * h;
      if (f > 5500) break;
      const a = (0.5 / h) * (0.5 + rnd());
      const ph = rnd() * 2 * Math.PI;
      for (let i = 0; i < dur && t0 + i < n; i++) {
        x[t0 + i] += a * Math.exp((-3 * i) / dur) * Math.sin((2 * Math.PI * f * i) / DSP.sampleRate + ph);
      }
    }
  }
  for (let i = 0; i < n; i++) x[i] += (rnd() - 0.5) * 0.02;
  return x;
}

/**
 * What a turntable actually emits: `track`, read back at a speed that is both
 * off nominal and slowly moving. Returns the emitted signal plus the true track
 * position at each wall-clock sample, so the test can check where the matcher
 * thinks the needle is against where it really is.
 */
function playOnDeck(track: Float32Array, seconds: number, speedAt: (t: number) => number) {
  const n = seconds * DSP.sampleRate;
  const out = new Float32Array(n);
  const truePos = new Float32Array(n);
  let pos = 0; // fractional read position, in track samples
  for (let i = 0; i < n; i++) {
    truePos[i] = pos / DSP.sampleRate;
    const j = Math.floor(pos);
    if (j + 1 >= track.length) break;
    const f = pos - j;
    out[i] = track[j] * (1 - f) + track[j + 1] * f;
    pos += speedAt(i / DSP.sampleRate);
  }
  return { out, truePos };
}

let db: FingerprintDB;

beforeAll(() => {
  const tracks = [makeTrack(1, TRACK_SECONDS), makeTrack(2, TRACK_SECONDS)];
  const entries: TrackEntry[] = tracks.map((t, i) => ({
    id: `t${i}`,
    frames: Math.floor(t.length / DSP.hop),
  }));
  const rows: { hash: number; value: number }[] = [];
  tracks.forEach((t, i) => {
    for (const lm of fingerprint(t, fft, window)) {
      rows.push({ hash: lm.hash, value: (i << VALUE_FRAME_BITS) | lm.t });
    }
  });
  rows.sort((a, b) => a.hash - b.hash);
  db = deserializeDB(
    serializeDB({
      version: DSP.version,
      tracks: entries,
      hashes: Uint32Array.from(rows.map((r) => r.hash)),
      values: Uint32Array.from(rows.map((r) => r.value)),
    }),
    entries,
  );
});

function rms(x: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < x.length; i++) sum += x[i] * x[i];
  return Math.sqrt(sum / (x.length || 1));
}

/** Drive the full matcher loop over a deck recording, cycle by cycle. */
function run(deck: Float32Array, truePos: Float32Array, seconds: number) {
  const speeds = new RatioScheduler();
  const lock = new TrackLock();
  const log: { t: number; votes: number; ratio: number; held: boolean }[] = [];
  let confirmedAt: number | null = null;
  let drops = 0;
  let worstPositionError = 0;

  for (let t = WINDOW_SECONDS; t <= seconds; t += CYCLE_SECONDS) {
    const end = Math.floor(t * DSP.sampleRate);
    const samples = deck.subarray(end - WINDOW_SECONDS * DSP.sampleRate, end);
    const best = matchAtSpeeds(db, samples, fft, window, speeds.next());
    speeds.report(best.ratio, best.top?.votes ?? 0);

    const position = best.top
      ? (best.top.offsetFrames * DSP.hop + best.correctedSamples) / DSP.sampleRate
      : null;
    const update = lock.observe({
      now: t,
      trackIndex: best.top?.trackIndex ?? null,
      votes: best.top?.votes ?? 0,
      runnerUpVotes: best.runnerUpVotes,
      position,
      ratio: best.ratio,
      level: rms(samples),
    });

    if (update.speed?.kind === 'lock') {
      if (update.speed.refine) speeds.lock(update.speed.ratio);
      else speeds.setRatio(update.speed.ratio);
    } else if (update.speed?.kind === 'unlock') {
      speeds.unlock();
    }

    if (update.event === 'confirm' && confirmedAt === null) confirmedAt = t;
    if (update.event === 'drop') drops++;
    if (lock.trackIndex !== null) {
      // Where the visuals think the needle is, vs. where it truly is.
      worstPositionError = Math.max(
        worstPositionError,
        Math.abs(lock.predict(t) - truePos[Math.min(end, truePos.length - 1)]),
      );
    }
    log.push({ t, votes: best.top?.votes ?? 0, ratio: best.ratio, held: update.held });
  }
  return { lock, speeds, log, confirmedAt, drops, worstPositionError };
}

describe('matcher loop on a real off-speed deck', () => {
  const RUN_SECONDS = 240;
  /** 3.4% fast at the drop, wandering another 0.5% over four minutes. */
  const speedAt = (t: number) => 1.034 + 0.005 * (t / RUN_SECONDS);

  // One simulation, shared — each run is a full four minutes through the real
  // fingerprint pipeline and is by far the slowest thing in the unit suite.
  let drift: ReturnType<typeof run>;
  let deck: Float32Array;

  beforeAll(() => {
    const played = playOnDeck(makeTrack(1, TRACK_SECONDS), RUN_SECONDS, speedAt);
    deck = played.out;
    drift = run(played.out, played.truePos, RUN_SECONDS);
  }, 120_000);

  it('locks on, then holds through the drift without a single drop', () => {
    expect(drift.confirmedAt).not.toBeNull();
    expect(drift.confirmedAt!).toBeLessThan(24); // a handful of cycles from the start
    expect(drift.drops).toBe(0);
    expect(drift.lock.trackIndex).toBe(0);
    // The visuals' clock stays tight to the real needle position throughout.
    expect(drift.worstPositionError).toBeLessThan(1.0);
  });

  it('ends up tracking the deck far more accurately than the coarse grid could', () => {
    const finalSpeed = speedAt(RUN_SECONDS);
    // The 1% grid can only ever say 1.03 or 1.04; we should be well inside that.
    expect(Math.abs(drift.lock.ratio - finalSpeed)).toBeLessThan(0.005);
    expect(Math.abs(drift.lock.ratio - finalSpeed)).toBeLessThan(Math.abs(1.03 - finalSpeed));
  });

  it('holds a far bigger vote margin than a ratio pinned to the grid would', () => {
    // The counterfactual, measured rather than assumed: score the last 30 s of
    // windows both at the coarse ratio a grid lock would have frozen at and at
    // the ratio the tracker actually reached. Worst-case matters more than
    // median — a lock dies on its thinnest window, not its average one.
    const votesAt = (samples: Float32Array, ratio: number) =>
      queryDB(db, fingerprint(correctSpeed(samples, ratio), fft, window))
        .find((r) => r.trackIndex === 0)?.votes ?? 0;

    const pinned: number[] = [];
    const tracked: number[] = [];
    for (let t = RUN_SECONDS - 30; t <= RUN_SECONDS; t += CYCLE_SECONDS) {
      const end = Math.floor(t * DSP.sampleRate);
      const samples = deck.subarray(end - WINDOW_SECONDS * DSP.sampleRate, end);
      pinned.push(votesAt(samples, 1.03));
      tracked.push(votesAt(samples, drift.lock.ratio));
    }
    const worstPinned = Math.min(...pinned);
    const worstTracked = Math.min(...tracked);

    // Pinned isn't dead at this much drift — it's marginal, hovering near the
    // gate with no headroom left for a sparse passage. (This synthetic track is
    // denser and more uniform than real music, so real thin windows fare worse.)
    expect(worstPinned).toBeLessThan(ACQUIRE_VOTES * 2.5);
    expect(worstTracked).toBeGreaterThan(ACQUIRE_VOTES * 4);
    expect(worstTracked).toBeGreaterThan(worstPinned * 3);
  }, 60_000);

  it('keeps a correctly-calibrated deck on the fast path', () => {
    const track = makeTrack(1, TRACK_SECONDS);
    const { out, truePos } = playOnDeck(track, 60, () => 1);
    const { lock, speeds, confirmedAt, drops } = run(out, truePos, 60);

    expect(confirmedAt).not.toBeNull();
    expect(drops).toBe(0);
    expect(lock.trackIndex).toBe(0);
    // Nominal speed is tried first, so this should never leave the 1.0 region.
    expect(Math.abs(lock.ratio - 1)).toBeLessThan(0.005);
    expect(speeds.state.kind).toBe('lock');
  }, 60_000);

  it('does not latch onto the wrong track', () => {
    const track = makeTrack(2, TRACK_SECONDS); // the *other* track
    const { out, truePos } = playOnDeck(track, 60, speedAt);
    const { lock } = run(out, truePos, 60);
    expect(lock.trackIndex).toBe(1);
  }, 60_000);

  /** Overwrite `seconds` of the deck signal starting at `from`. */
  function interrupt(deckOut: Float32Array, from: number, seconds: number, fill: (i: number) => number) {
    const out = Float32Array.from(deckOut);
    const a = Math.floor(from * DSP.sampleRate);
    const b = Math.min(out.length, Math.floor((from + seconds) * DSP.sampleRate));
    for (let i = a; i < b; i++) out[i] = fill(i);
    return out;
  }

  it('coasts through a long interruption instead of withdrawing the visuals', () => {
    // Ten seconds of loud non-matching noise over the top of the record — the
    // old four-cycle drop would have torn the visuals down and re-swept.
    const played = playOnDeck(makeTrack(1, TRACK_SECONDS), 100, speedAt);
    const rnd = mulberry32(7);
    const noisy = interrupt(played.out, 55, 10, () => (rnd() - 0.5) * 0.6);
    const { lock, drops, worstPositionError } = run(noisy, played.truePos, 100);

    expect(drops).toBe(0);
    expect(lock.trackIndex).toBe(0);
    // Extrapolation carried the timeline across the gap and re-anchored cleanly.
    expect(worstPositionError).toBeLessThan(1.0);
  }, 60_000);

  it('gives up quickly once the input goes silent — the needle was lifted', () => {
    const played = playOnDeck(makeTrack(1, TRACK_SECONDS), 100, speedAt);
    const silent = interrupt(played.out, 55, 45, () => 0);
    const { drops, log } = run(silent, played.truePos, 100);

    expect(drops).toBe(1);
    // Within a few cycles of the silence reaching the window, not twenty.
    const droppedAt = log.find((l) => l.t > 55 && !l.held && l.votes === 0)?.t ?? Infinity;
    expect(droppedAt).toBeLessThan(80);
  }, 60_000);
});
