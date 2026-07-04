import * as THREE from 'three';
import type { QualityState } from '../quality/QualityManager';

/**
 * Audio data shared with each visualization. Stubbed out until the mic
 * fingerprinting pipeline is wired up — visualizations should already be
 * authored against this interface so they can react when real data arrives.
 */
export interface AudioFrame {
  /** Linear 0..1 frequency bins from the AnalyserNode. */
  frequency: Float32Array;
  /** Coarse band energies, useful for kick/snare/hi reactivity. */
  bass: number;
  mid: number;
  high: number;
  /** Whether the matcher currently believes the correct track is playing. */
  matched: boolean;
  /** Seconds into the current track: matcher-extrapolated when matched, otherwise VizHost's looping fallback clock. Never null — a viz can always stage itself by song position. */
  time: number;
}

export interface VizContext {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** Stable seed unique to this play (track id + Date.now). */
  seed: number;
  quality: QualityState;
  trackId: string;
}

export interface Viz {
  init(ctx: VizContext): void | Promise<void>;
  update(dt: number, audio: AudioFrame): void;
  resize(width: number, height: number): void;
  dispose(): void;
  /** Optional: take over rendering the frame (e.g. an EffectComposer chain). If omitted, VizHost does a plain renderer.render(scene, camera). */
  render?(): void;
}

/** Per-track viz module shape (default export). */
export interface VizModule {
  default: () => Viz;
}
