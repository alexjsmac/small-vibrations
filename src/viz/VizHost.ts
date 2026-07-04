import * as THREE from 'three';
import type { Viz, VizContext, AudioFrame, VizModule } from './types';
import type { QualityManager } from '../quality/QualityManager';
import type { Track } from '../tracks';

/**
 * Persistent renderer + scene shell. Loads per-track viz modules dynamically
 * and swaps them in/out without recreating the canvas.
 *
 * Deliberately on WebGLRenderer + GLSL: a WebGPU/TSL migration was attempted
 * (see branch webgpu-tsl-experiment) and produced silent black frames on
 * real hardware — WebGL is the proven path for this project's launch.
 */
export class VizHost {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private current: Viz | null = null;
  private currentTrackId: string | null = null;
  private rafId = 0;
  private lastT = performance.now();

  /** Live audio source (AudioEngine.frame); stub zeros until the mic starts. */
  private audioSource: (() => AudioFrame) | null = null;
  /** Fallback song clock (seconds) used while nothing is matched — loops at trackDuration so manual/at-home viewers still see a track's full staged arc. */
  private fallbackClock = 0;
  private trackDuration = 0;
  private stubAudio: AudioFrame = {
    frequency: new Float32Array(64),
    bass: 0, mid: 0, high: 0,
    matched: false,
    time: 0,
  };

  constructor(
    private container: HTMLElement,
    private quality: QualityManager,
  ) {
    this.canvas = document.createElement('canvas');
    container.appendChild(this.canvas);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setClearColor(0x000000, 1);
    this.applyResolution();

    this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
    this.camera.position.set(0, 0, 4);

    this.quality.addEventListener('change', () => {
      this.applyResolution();
      // Particle counts etc. are baked into a viz at init — a quality change
      // must rebuild the scene, not just rescale the framebuffer.
      this.reloadCurrent();
    });
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  private applyResolution() {
    const dpr = Math.min(window.devicePixelRatio, 2) * this.quality.state.resolutionScale;
    this.renderer.setPixelRatio(dpr);
  }

  resize() {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.current?.resize(w, h);
  }

  /**
   * Loads never interleave: each call queues behind the previous one, and a
   * queued call that's been superseded (fast Prev/Next clicks, a mic match
   * landing mid-navigation) exits before touching the scene.
   */
  private loadGen = 0;
  private loadChain: Promise<void> = Promise.resolve();
  private currentTrack: Track | null = null;
  private currentSeed = 0;

  load(track: Track): Promise<void> {
    const gen = ++this.loadGen;
    this.loadChain = this.loadChain
      .catch(() => {}) // one failed load shouldn't wedge the queue
      .then(() => this.doLoad(track, gen, null));
    return this.loadChain;
  }

  /** Rebuild the active viz in place (same track, same per-play seed, same song clock) — used when the quality level changes. */
  private reloadCurrent() {
    const track = this.currentTrack;
    if (!track) return;
    const gen = ++this.loadGen;
    this.loadChain = this.loadChain
      .catch(() => {})
      .then(() => this.doLoad(track, gen, { seed: this.currentSeed, clock: this.fallbackClock }));
  }

  private async doLoad(track: Track, gen: number, preserved: { seed: number; clock: number } | null) {
    if (gen !== this.loadGen) return;
    if (!preserved && this.currentTrackId === track.id) return;
    if (this.current) {
      this.current.dispose();
      this.scene.clear();
      this.current = null;
      this.currentTrackId = null;
    }

    // Dynamic import → Vite code-splits each viz module.
    const mod = (await import(`./${track.viz}/index.ts`)) as VizModule;
    const viz = mod.default();

    const seed = preserved?.seed ?? hashSeed(track.id + ':' + Date.now());
    const ctx: VizContext = {
      renderer: this.renderer,
      scene: this.scene,
      camera: this.camera,
      seed,
      quality: this.quality.state,
      trackId: track.id,
    };
    await viz.init(ctx);
    viz.resize(this.container.clientWidth, this.container.clientHeight);

    this.current = viz;
    this.currentTrack = track;
    this.currentTrackId = track.id;
    this.currentSeed = seed;
    this.trackDuration = track.duration;
    if (preserved) {
      this.fallbackClock = preserved.clock;
    } else {
      // Dev affordance: ?t=140 seeds the song clock so any act of a staged
      // viz is reachable instantly without audio.
      const seedT = Number(new URLSearchParams(location.search).get('t'));
      this.fallbackClock = Number.isFinite(seedT) && seedT > 0 ? seedT : 0;
    }
  }

  start() {
    const tick = () => {
      this.rafId = requestAnimationFrame(tick);
      const now = performance.now();
      const dt = (now - this.lastT) / 1000;
      this.lastT = now;
      this.quality.tick();
      if (this.current) {
        const audio = this.resolveAudioFrame(dt);
        try {
          this.current.update(dt, audio);
          if (this.current.render) this.current.render();
          else this.renderer.render(this.scene, this.camera);
        } catch (err) {
          // Live event failure mode: skip the bad frame, keep the loop (and
          // navigation/matching) alive rather than taking down the app.
          console.error('[viz] frame failed:', err);
        }
      }
    };
    tick();
  }

  /**
   * Live audio (bands + extrapolated song time) when matched; otherwise
   * still passes through live bands if the mic is on, but overrides `time`
   * with the looping fallback clock.
   */
  private resolveAudioFrame(dt: number): AudioFrame {
    const frame = this.audioSource ? this.audioSource() : this.stubAudio;
    if (frame.matched) return frame;
    if (this.trackDuration > 0) {
      this.fallbackClock = (this.fallbackClock + dt) % this.trackDuration;
    }
    frame.time = this.fallbackClock;
    return frame;
  }

  setAudioSource(source: (() => AudioFrame) | null) {
    this.audioSource = source;
  }

  stop() {
    cancelAnimationFrame(this.rafId);
  }
}

/** Tiny deterministic 32-bit string hash. */
function hashSeed(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}
