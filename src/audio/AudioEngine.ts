import type { AudioFrame } from '../viz/types';
import type { TrackEntry } from './dsp';
import type { CycleMessage, WorkerOut } from './match-worker';
import { MicInput } from './MicInput';
import { TRACKS } from '../tracks';

export type MicState = 'off' | 'starting' | 'listening' | 'matched' | 'error';

export interface TrackMatch {
  trackId: string;
  /** Seconds into the track, estimated as of the match cycle. */
  position: number;
  votes: number;
}

/** A cycle must clear both bars to count as a hit for its track. */
const MIN_VOTES = 12;
const MIN_RATIO = 2.0; // top votes vs best other-track votes
/** Consecutive agreeing cycles before we announce a (new) track. */
const CONFIRM_CYCLES = 2;
/** Consecutive missed cycles before we drop back to "listening". */
const DROP_CYCLES = 4;

/**
 * Orchestrates mic → match-worker and exposes:
 *  - `state` + 'state' events for the mic indicator
 *  - 'match' events (detail: TrackMatch | null) when the confirmed track changes
 *  - `frame` — a live AudioFrame for visualizations, refreshed via tick()
 */
export class AudioEngine extends EventTarget {
  state: MicState = 'off';
  current: TrackMatch | null = null;

  readonly frame: AudioFrame = {
    frequency: new Float32Array(64),
    bass: 0, mid: 0, high: 0,
    matched: false,
    time: 0,
  };

  private mic: MicInput | null = null;
  private worker: Worker | null = null;
  private bytes = new Uint8Array(1024);
  private candidateTrack: number | null = null;
  private hits = 0;
  private misses = 0;
  /** performance.now() (ms) at which `current.position` was last set, for extrapolating `frame.time`. */
  private positionAnchorMs = 0;

  /** Fetch + parse the fingerprint DB and spin up the worker. */
  private async loadWorker(): Promise<Worker> {
    const base = import.meta.env.BASE_URL;
    const [dbBuf, manifest] = await Promise.all([
      fetch(base + 'fp/db.bin').then((r) => {
        if (!r.ok) throw new Error(`fp/db.bin: HTTP ${r.status}`);
        return r.arrayBuffer();
      }),
      fetch(base + 'fp/manifest.json').then((r) => {
        if (!r.ok) throw new Error(`fp/manifest.json: HTTP ${r.status}`);
        return r.json() as Promise<{ tracks: TrackEntry[] }>;
      }),
    ]);

    const worker = new Worker(new URL('./match-worker.ts', import.meta.url), { type: 'module' });
    await new Promise<void>((resolve, reject) => {
      worker.onmessage = (e: MessageEvent<WorkerOut>) => {
        if (e.data.type === 'ready') resolve();
      };
      worker.onerror = (e) => reject(e.error ?? new Error('match worker failed'));
      worker.postMessage({ type: 'init', db: dbBuf, tracks: manifest.tracks }, [dbBuf]);
    });
    worker.onmessage = (e: MessageEvent<WorkerOut>) => {
      if (e.data.type === 'cycle') this.onCycle(e.data);
    };
    return worker;
  }

  /** Call from a user gesture. Resolves once the mic is live. */
  async start(): Promise<void> {
    if (this.state !== 'off' && this.state !== 'error') return;
    this.setState('starting');
    try {
      // Mic permission prompt and DB download run in parallel.
      const [mic, worker] = await Promise.all([MicInput.open(), this.loadWorker()]);
      this.mic = mic;
      this.worker = worker;
      mic.onSamples = (chunk) => {
        // chunk's buffer is fresh per call (resampler output) — transferable.
        this.worker?.postMessage({ type: 'samples', samples: chunk }, [chunk.buffer]);
      };
      this.setState('listening');
    } catch (err) {
      console.warn('[audio] mic start failed:', err);
      this.stop();
      this.setState('error');
    }
  }

  stop() {
    this.mic?.close();
    this.mic = null;
    this.worker?.terminate();
    this.worker = null;
    this.current = null;
    this.candidateTrack = null;
    this.hits = 0; this.misses = 0;
    this.setState('off');
  }

  /** Refresh `frame` from the analyser. Call once per render tick. */
  tick() {
    const mic = this.mic;
    const f = this.frame;
    f.matched = this.state === 'matched';
    if (f.matched && this.current) {
      f.time = this.current.position + (performance.now() - this.positionAnchorMs) / 1000;
    }
    if (!mic) {
      f.frequency.fill(0);
      f.bass = f.mid = f.high = 0;
      return;
    }
    const analyser = mic.analyser;
    analyser.getByteFrequencyData(this.bytes);

    // 1024 analyser bins → 64 viz bins
    for (let i = 0; i < 64; i++) {
      let sum = 0;
      for (let j = 0; j < 16; j++) sum += this.bytes[i * 16 + j];
      f.frequency[i] = sum / (16 * 255);
    }

    // Band energies by Hz range at the device sample rate.
    const hzPerBin = mic.ctx.sampleRate / 2 / this.bytes.length;
    f.bass = bandAvg(this.bytes, 20, 250, hzPerBin);
    f.mid = bandAvg(this.bytes, 250, 2000, hzPerBin);
    f.high = bandAvg(this.bytes, 2000, 6000, hzPerBin);
  }

  private onCycle(c: CycleMessage) {
    const hit =
      c.top !== null &&
      c.top.votes >= MIN_VOTES &&
      c.top.votes >= c.runnerUpVotes * MIN_RATIO;

    if (hit) {
      const t = c.top!.trackIndex;
      this.misses = 0;
      this.hits = t === this.candidateTrack ? this.hits + 1 : 1;
      this.candidateTrack = t;
      if (this.hits >= CONFIRM_CYCLES && this.current?.trackId !== trackIdOf(t)) {
        this.current = {
          trackId: trackIdOf(t),
          position: c.positionSeconds ?? 0,
          votes: c.top!.votes,
        };
        this.positionAnchorMs = performance.now();
        this.setState('matched');
        this.dispatchEvent(new CustomEvent<TrackMatch | null>('match', { detail: this.current }));
      } else if (this.current?.trackId === trackIdOf(t)) {
        this.current.position = c.positionSeconds ?? this.current.position;
        this.current.votes = c.top!.votes;
        this.positionAnchorMs = performance.now();
      }
    } else {
      this.hits = 0;
      this.misses++;
      if (this.current && this.misses >= DROP_CYCLES) {
        this.current = null;
        this.candidateTrack = null;
        this.setState('listening');
        this.dispatchEvent(new CustomEvent<TrackMatch | null>('match', { detail: null }));
      }
    }
  }

  private setState(s: MicState) {
    if (this.state === s) return;
    this.state = s;
    this.dispatchEvent(new CustomEvent<MicState>('state', { detail: s }));
  }
}

/** Track index in the DB == index in TRACKS (build script uses TRACKS order). */
function trackIdOf(index: number): string {
  return TRACKS[index]?.id ?? `#${index}`;
}

function bandAvg(bytes: Uint8Array, loHz: number, hiHz: number, hzPerBin: number): number {
  const lo = Math.max(0, Math.floor(loHz / hzPerBin));
  const hi = Math.min(bytes.length - 1, Math.ceil(hiHz / hzPerBin));
  if (hi <= lo) return 0;
  let sum = 0;
  for (let i = lo; i <= hi; i++) sum += bytes[i];
  return sum / ((hi - lo + 1) * 255);
}
