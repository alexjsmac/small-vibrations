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

/** Phones/tablets start on Lite; the manual toggle can still force Full. */
function defaultLevel(): QualityLevel {
  return typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches
    ? 'lite'
    : 'full';
}

export class QualityManager extends EventTarget {
  private _state: QualityState = { ...PRESETS[defaultLevel()] };
  private manualOverride = false;

  /** Rolling FPS samples for the auto-detect. */
  private samples: number[] = [];
  private lastT = performance.now();

  get state() { return this._state; }

  set(level: QualityLevel, manual = true) {
    if (this._state.level === level) return;
    this._state = { ...PRESETS[level] };
    if (manual) this.manualOverride = true;
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
    const fps = 1000 / dt;
    this.samples.push(fps);
    if (this.samples.length > 180) this.samples.shift(); // ~3s @ 60fps

    if (this.manualOverride || this._state.level === 'lite') return;
    if (this.samples.length < 180) return;
    const avg = this.samples.reduce((a, b) => a + b, 0) / this.samples.length;
    if (avg < 45) {
      console.warn(`[quality] avg ${avg.toFixed(1)}fps — dropping to lite`);
      this.set('lite', /* manual */ false);
    }
  }
}
