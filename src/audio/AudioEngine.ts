import type { AudioFrame } from '../viz/types';
import type { TrackEntry } from './dsp';
import type { CycleMessage, WorkerOut } from './match-worker';
import { MicInput } from './MicInput';
import { TrackLock } from './tracking';
import { TRACKS } from '../tracks';

export type MicState = 'off' | 'starting' | 'listening' | 'matched' | 'error';

export interface TrackMatch {
  trackId: string;
  /** Seconds into the track, estimated as of the match cycle. */
  position: number;
  votes: number;
}

/**
 * Orchestrates mic → match-worker and exposes:
 *  - `state` + 'state' events for the mic indicator
 *  - 'match' events (detail: TrackMatch | null) when the confirmed track changes
 *  - `frame` — a live AudioFrame for visualizations, refreshed via tick()
 */
export class AudioEngine extends EventTarget {
  state: MicState = 'off';
  current: TrackMatch | null = null;
  /**
   * Last match cycle's raw numbers, for the `?debug=1` HUD — null until the
   * worker has analysed its first window. Together with `inputLevel` this
   * distinguishes the three ways detection can fail: no cycles at all (worker
   * or mic dead), cycles with a silent input (`inputLevel` ~0), or cycles with
   * real audio that just don't clear the vote gate.
   */
  lastCycle: {
    votes: number;
    runnerUpVotes: number;
    windowSeconds: number;
    ratio: number;
    speedMode: 'search' | 'refine' | 'lock';
    /** Missed cycles being coasted through; 0 while cleanly matched. */
    misses: number;
  } | null = null;

  readonly frame: AudioFrame = {
    frequency: new Float32Array(64),
    bass: 0, mid: 0, high: 0,
    matched: false,
    time: 0,
  };

  private mic: MicInput | null = null;
  private worker: Worker | null = null;
  private bytes = new Uint8Array(1024);
  /**
   * All of the hold/drop/deck-speed logic. Lives in its own module because
   * nothing in this class can be unit-tested (Worker + import.meta).
   */
  private readonly lock = new TrackLock();

  /**
   * Measured playback speed of the deck — 1.03 means the record is running 3%
   * fast. Turntables drift, and about 1% is enough to break matching outright,
   * so the matcher refines this after every lock and then tracks it from the
   * position stream rather than trusting the acquisition grid.
   */
  get playbackRatio(): number {
    return this.lock.speed;
  }

  /** True while the visuals are being held open on extrapolation alone. */
  get coasting(): boolean {
    return this.lock.coasting;
  }

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
    this.lastCycle = null;
    this.lock.reset();
    this.setState('off');
  }

  /** Refresh `frame` from the analyser. Call once per render tick. */
  tick() {
    const mic = this.mic;
    const f = this.frame;
    f.matched = this.state === 'matched';
    if (f.matched && this.current) {
      // Extrapolate at the deck's measured speed: on a fast deck the track's
      // own clock advances faster than wall time between cycle re-anchors, and
      // while coasting through missed cycles this is the only clock there is.
      f.time = this.lock.predict(performance.now() / 1000);
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

  /** RMS of the audio reaching the matcher; 0 while the mic is off. */
  get inputLevel(): number {
    return this.mic?.level ?? 0;
  }

  private onCycle(c: CycleMessage) {
    const update = this.lock.observe({
      now: performance.now() / 1000,
      trackIndex: c.top?.trackIndex ?? null,
      votes: c.top?.votes ?? 0,
      runnerUpVotes: c.runnerUpVotes,
      position: c.positionSeconds,
      ratio: c.ratio,
      level: this.inputLevel,
    });

    this.lastCycle = {
      votes: c.top?.votes ?? 0,
      runnerUpVotes: c.runnerUpVotes,
      windowSeconds: c.windowSeconds,
      ratio: c.ratio,
      speedMode: c.speedMode,
      misses: this.lock.misses,
    };

    if (update.speed) {
      this.worker?.postMessage(
        update.speed.kind === 'unlock'
          ? { type: 'unlockSpeed' }
          : { type: 'lockSpeed', ratio: update.speed.ratio, refine: update.speed.refine },
      );
    }

    // A held cycle re-anchors the track we're already showing; only 'confirm'
    // and 'drop' are visible to listeners.
    if (update.held && this.current && update.event !== 'confirm') {
      this.current.position = this.lock.position;
      this.current.votes = this.lock.votes;
    }

    if (update.event === 'confirm') {
      this.current = {
        trackId: trackIdOf(this.lock.trackIndex!),
        position: this.lock.position,
        votes: this.lock.votes,
      };
      this.setState('matched');
      this.dispatchEvent(new CustomEvent<TrackMatch | null>('match', { detail: this.current }));
    } else if (update.event === 'drop') {
      this.current = null;
      this.setState('listening');
      this.dispatchEvent(new CustomEvent<TrackMatch | null>('match', { detail: null }));
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
