import * as THREE from 'three';
import type { Viz, VizContext, AudioFrame, VizModule } from './types';
import type { QualityManager } from '../quality/QualityManager';
import type { Track } from '../tracks';

/**
 * Persistent renderer + scene shell. Loads per-track viz modules dynamically
 * and swaps them in/out without recreating the canvas.
 *
 * NOTE: starts on WebGLRenderer for broad compatibility while we scaffold;
 * per-track viz modules will eventually be authored against WebGPURenderer
 * (three/webgpu) once we start building the real generative passes.
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

  /** Stub audio frame until the fingerprint pipeline is wired up. */
  private audio: AudioFrame = {
    frequency: new Float32Array(64),
    bass: 0, mid: 0, high: 0,
    matched: false,
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

    this.quality.addEventListener('change', () => this.applyResolution());
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  private applyResolution() {
    const dpr = Math.min(window.devicePixelRatio, 2) * this.quality.state.resolutionScale;
    this.renderer.setPixelRatio(dpr);
  }

  resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
    this.current?.resize(w, h);
  }

  async load(track: Track) {
    if (this.currentTrackId === track.id) return;
    if (this.current) {
      this.current.dispose();
      this.scene.clear();
      this.current = null;
    }

    // Dynamic import → Vite code-splits each viz module.
    const mod = (await import(`./${track.viz}/index.ts`)) as VizModule;
    const viz = mod.default();

    const ctx: VizContext = {
      renderer: this.renderer,
      scene: this.scene,
      camera: this.camera,
      seed: hashSeed(track.id + ':' + Date.now()),
      quality: this.quality.state,
      trackId: track.id,
    };
    await viz.init(ctx);
    viz.resize(this.container.clientWidth, this.container.clientHeight);

    this.current = viz;
    this.currentTrackId = track.id;
  }

  start() {
    const tick = () => {
      this.rafId = requestAnimationFrame(tick);
      const now = performance.now();
      const dt = (now - this.lastT) / 1000;
      this.lastT = now;
      this.quality.tick();
      if (this.current) {
        this.current.update(dt, this.audio);
        this.renderer.render(this.scene, this.camera);
      }
    };
    tick();
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
