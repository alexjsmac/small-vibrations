import * as THREE from 'three';
import type { Viz, VizContext, AudioFrame, VizModule } from '../types';
import { Dust } from './dust';
import { Lattice } from './lattice';
import { Movers } from './movers';
import { arcAt, paramsAt } from './sections';
import { mulberry32 } from '../random';

const SPECTRUM_BINS = 16;

/**
 * "Homemakers" — bees and humans as parallel homemakers: hexagonal comb and
 * rectangular rooms growing from one shared, gently curved wall. Staged by
 * song position (sections.ts): seed cells → the comb raised in the first
 * drop (with ghost-room foreshadows) → a hushed pass inside the structure
 * where cells slide around like furniture → the climax where both homes
 * interlock and finish → windows going dark one by one.
 *
 * Layers: dual-lattice instanced accretion (lattice.ts, the signature
 * element), pollen/bee dust (dust.ts), furniture-move events + flashes
 * (movers.ts). Debug: ?solo=lattice|dust|movers, ?movers=always.
 */
class Homemakers implements Viz {
  private lattice!: Lattice;
  private dust!: Dust;
  private movers!: Movers;
  private camera!: THREE.PerspectiveCamera;
  private camPhase = 0;
  private camSeedA = 0;
  private camSeedB = 0;
  private bgBase = new THREE.Color(0x05141c);
  private bgFlash = new THREE.Color(0x123243);
  private forceMovers = false;
  private sceneRef!: THREE.Scene;
  /** Smoothed 16-bin spectrum fed to the lattice shimmer. */
  private spectrum = new Float32Array(SPECTRUM_BINS);
  private lastT = -1;
  private bgWarm = new THREE.Color(0x0e2430);
  private _pos = new THREE.Vector3();
  private _tgt = new THREE.Vector3();
  private _jPos = new THREE.Vector3();
  private _jTgt = new THREE.Vector3();

  async init(ctx: VizContext) {
    const { scene, camera, renderer, seed, quality } = ctx;
    scene.fog = null;
    this.camera = camera;

    const params = new URLSearchParams(location.search);
    const solo = params.get('solo');
    this.forceMovers = params.get('movers') === 'always';
    if (solo) this.bgBase.setHex(0x1f5d7a);
    scene.background = this.bgBase.clone();

    const rand = mulberry32(seed ^ 0x3c6ef372);
    this.camSeedA = rand() * Math.PI * 2;
    this.camSeedB = rand() * Math.PI * 2;

    this.lattice = new Lattice(seed, quality);
    if (!solo || solo === 'lattice') scene.add(this.lattice.group);

    this.dust = new Dust(seed, quality, renderer);
    if (!solo || solo === 'dust') scene.add(this.dust.object);

    this.movers = new Movers(seed, this.lattice);
    if (!solo || solo === 'movers') scene.add(this.movers.group);
    this.sceneRef = scene;
  }

  update(dt: number, audio: AudioFrame) {
    const section = paramsAt(audio.time);
    const arc = arcAt(audio.time);

    // The two drops land as discrete hits, not crossfades (ARC.md §3.1 type 3).
    if (this.lastT >= 0 && audio.time - this.lastT < 0.5) {
      if (this.lastT < 54 && audio.time >= 54) this.movers.impulse(0.9);
      if (this.lastT < 188 && audio.time >= 188) this.movers.impulse(1.2);
    }
    this.lastT = audio.time;

    // 64 analyser bins → 16 smoothed bands for the lattice shimmer
    const k = Math.min(1, dt * 8);
    const groups = Math.max(1, Math.floor(audio.frequency.length / SPECTRUM_BINS));
    for (let i = 0; i < SPECTRUM_BINS; i++) {
      let sum = 0;
      for (let j = 0; j < groups; j++) sum += audio.frequency[i * groups + j] ?? 0;
      this.spectrum[i] += (sum / groups - this.spectrum[i]) * k;
    }

    this.movers.update(dt, audio, section, this.lattice, this.forceMovers, arc.energy);
    const flash = this.movers.flash;

    this.lattice.update(dt, audio, section, arc, flash, this.spectrum);
    this.dust.update(dt, audio, section, arc, flash);

    // Flashes lift the whole scene toward a paler teal for a beat; the
    // background also warms with the track's energy envelope.
    (this.sceneRef.background as THREE.Color)
      .copy(this.bgBase)
      .lerp(this.bgWarm, arc.energy * 0.6)
      .lerp(this.bgFlash, Math.min(1, flash));

    // Camera: the wall faces +Z, so the drift is a slow swing across its
    // front hemisphere (never edge-on), a breathing dolly, and an act-staged
    // distance — far for the whole structure, inside it for the ambient act.
    // Two regimes are blended: the orbit (default) and, during the inside
    // act (camJourney), a slow forward drift along the wall face.
    const p = section.params;
    this.camPhase += dt * (0.04 + p.camDrift * 0.07 + arc.energy * 0.035 + audio.mid * 0.012);
    const still = Math.min(1, p.camDrift * 2.5);
    const az = Math.sin(this.camPhase * 0.5 + this.camSeedA) * 0.45;
    const dist = p.camDist * (1 + Math.sin(this.camPhase * 0.23 + this.camSeedB) * 0.08 * still);
    this._pos.set(
      Math.sin(az) * dist,
      p.camHeight + Math.sin(this.camPhase * 0.31 + this.camSeedB) * 0.3 * still,
      Math.cos(az) * dist,
    );
    this._tgt.set(
      Math.sin(this.camPhase * 0.17 + this.camSeedB) * 0.25,
      Math.sin(this.camPhase * 0.11 + this.camSeedA) * 0.15,
      0,
    );
    // inside act: the orbit gives way to a slow drift along the wall face,
    // camera looking where it's heading (journey regime)
    if (p.camJourney > 0.001) {
      const jx = Math.sin(this.camPhase * 0.22 + this.camSeedA) * 1.4;
      const heading = Math.cos(this.camPhase * 0.22 + this.camSeedA);
      this._jPos.set(jx, p.camHeight + Math.sin(this.camPhase * 0.13 + this.camSeedB) * 0.2, p.camDist);
      this._jTgt.set(jx + heading * 1.3, 0, -0.3);
      this._pos.lerp(this._jPos, p.camJourney);
      this._tgt.lerp(this._jTgt, p.camJourney);
    }
    this.camera.position.copy(this._pos);
    this.camera.lookAt(this._tgt);
  }

  resize(_w: number, _h: number) {}

  dispose() {
    this.lattice.dispose();
    this.dust.dispose();
    this.movers.dispose();
    // Hand the camera back where the shell expects it.
    this.camera.position.set(0, 0, 4);
    this.camera.lookAt(0, 0, 0);
  }
}

const mod: VizModule = { default: () => new Homemakers() };
export default mod.default;
