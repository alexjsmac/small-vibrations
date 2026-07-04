export type QualityLevel = 'full' | 'lite';

export interface QualityState {
  level: QualityLevel;
  /** 0..1 — DPR multiplier for the renderer. */
  resolutionScale: number;
  /** Approximate particle count budget visualizations should respect. */
  particleBudget: number;
  /** Raymarch step budget for shaders that use it. */
  raymarchSteps: number;
  /** Whether expensive post-processing should run. */
  postProcessing: boolean;
}

const PRESETS: Record<QualityLevel, QualityState> = {
  full: {
    level: 'full',
    resolutionScale: 1.0,
    particleBudget: 1_000_000,
    raymarchSteps: 128,
    postProcessing: true,
  },
  lite: {
    level: 'lite',
    resolutionScale: 0.66,
    particleBudget: 100_000,
    raymarchSteps: 32,
    postProcessing: false,
  },
};

/**
 * Everyone starts on Lite — Full is opt-in. The site's primary audience is
 * phones from the sleeve QR code, and even fine-pointer laptops choke on the
 * Full scene; the one machine that genuinely wants Full (the projection
 * workstation) opens with ?q=full or clicks the Quality button.
 */
function defaultLevel(): QualityLevel {
  if (typeof location !== 'undefined') {
    const q = new URLSearchParams(location.search).get('q');
    if (q === 'full' || q === 'lite') return q;
  }
  return 'lite';
}

export class QualityManager extends EventTarget {
  private _state: QualityState = { ...PRESETS[defaultLevel()] };
  private manualOverride = false;

  /** Rolling FPS samples for the sustained auto-drop. */
  private samples: number[] = [];
  private lastT = performance.now();
  /** Wall-clock window for the emergency drop — counts real time, not frames, so it fires promptly even at 2fps. */
  private windowStart = performance.now();
  private windowFrames = 0;

  get state() { return this._state; }

  /** Rolling average FPS over the last ~1s of samples (0 until warmed up). Used by the ?debug HUD. */
  avgFps(): number {
    const n = Math.min(this.samples.length, 60);
    if (n === 0) return 0;
    let sum = 0;
    for (let i = this.samples.length - n; i < this.samples.length; i++) sum += this.samples[i];
    return sum / n;
  }

  set(level: QualityLevel, manual = true) {
    if (this._state.level === level) return;
    this._state = { ...PRESETS[level] };
    if (manual) this.manualOverride = true;
    // Old samples describe the previous quality level — start fresh.
    this.samples.length = 0;
    this.windowStart = performance.now();
    this.windowFrames = 0;
    this.dispatchEvent(new CustomEvent('change', { detail: this._state }));
  }

  toggle() {
    this.set(this._state.level === 'full' ? 'lite' : 'full');
  }

  /** Call once per frame. Auto-drops to 'lite' if FPS sustains under threshold. */
  tick() {
    const now = performance.now();
    const dt = now - this.lastT;
    this.lastT = now;
    if (dt <= 0) return;
    this.samples.push(1000 / dt);
    if (this.samples.length > 180) this.samples.shift(); // ~3s @ 60fps
    this.windowFrames++;

    if (this.manualOverride || this._state.level === 'lite') return;

    // Emergency drop, time-based: after 1.5s of real time on this level, if
    // we averaged under ~22fps, bail immediately. A frame-count window would
    // scale with the very slowness it's trying to detect (60 frames at 2fps
    // = 30 seconds of a frozen machine).
    const elapsed = (now - this.windowStart) / 1000;
    if (elapsed >= 1.5 && this.windowFrames >= 3) {
      const avgFps = this.windowFrames / elapsed;
      if (avgFps < 22) {
        console.warn(`[quality] ${avgFps.toFixed(1)}fps over ${elapsed.toFixed(1)}s — emergency drop to lite`);
        this.set('lite', /* manual */ false);
        return;
      }
      // Healthy-enough window: restart it so the check stays recent.
      this.windowStart = now;
      this.windowFrames = 0;
    }

    if (this.samples.length < 180) return;
    const avg = this.samples.reduce((a, b) => a + b, 0) / this.samples.length;
    if (avg < 45) {
      console.warn(`[quality] avg ${avg.toFixed(1)}fps — dropping to lite`);
      this.set('lite', /* manual */ false);
    }
  }
}
