import * as THREE from 'three';
import type { Viz, VizContext, AudioFrame, VizModule } from '../types';
import { Dust, ATTRACTOR_COUNT } from './dust';
import { Blobs } from './blobs';
import { Sparks } from './sparks';
import { paramsAt } from './sections';
import { mulberry32 } from '../random';

/**
 * "They Come Marching" — the album opener. Theme: the beginning of time,
 * vast empty space, scattered matter condensing into the earliest forms of
 * life. Staged by song position (see sections.ts) rather than looping.
 *
 * Layers: stateless curl-noise dust (dust.ts) + marching-cubes metaball
 * forms (blobs.ts), tied together with an act-aware drifting camera.
 * Debug: ?solo=dust|blobs isolates one layer on a bright background.
 */
class TheyComeMarching implements Viz {
  private dust!: Dust;
  private blobs!: Blobs;
  private sparks!: Sparks;
  private camera!: THREE.PerspectiveCamera;
  private lights: THREE.Light[] = [];
  private camPhase = 0;
  private camSeedA = 0;
  private camSeedB = 0;
  private bgBase = new THREE.Color(0x05141c);
  private bgFlash = new THREE.Color(0x123243);
  private forceSparks = false;
  private sceneRef!: THREE.Scene;

  async init(ctx: VizContext) {
    const { scene, camera, renderer, seed, quality } = ctx;
    scene.fog = null;
    this.camera = camera;

    const params = new URLSearchParams(location.search);
    const solo = params.get('solo');
    this.forceSparks = params.get('sparks') === 'always';
    if (solo) this.bgBase.setHex(0x1f5d7a);
    scene.background = this.bgBase.clone();

    const rand = mulberry32(seed ^ 0x51ed270b);
    this.camSeedA = rand() * Math.PI * 2;
    this.camSeedB = rand() * Math.PI * 2;

    this.dust = new Dust(seed, quality, renderer);
    if (!solo || solo === 'dust') scene.add(this.dust.object);

    this.blobs = new Blobs(seed, quality);
    if (!solo || solo === 'blobs') scene.add(this.blobs.object);

    this.sparks = new Sparks(seed);
    if (!solo || solo === 'sparks') scene.add(this.sparks.group);
    this.sceneRef = scene;

    // Blobs use MeshStandardMaterial — light the scene in the sleeve palette:
    // warm cream key from above, cool teal fill from below.
    const key = new THREE.DirectionalLight(0xece4cf, 2.2);
    key.position.set(2, 3, 2.5);
    const fill = new THREE.DirectionalLight(0x1f5d7a, 1.2);
    fill.position.set(-2, -1.5, -2);
    const ambient = new THREE.AmbientLight(0x14465e, 1.4);
    this.lights = [key, fill, ambient];
    scene.add(key, fill, ambient);
  }

  update(dt: number, audio: AudioFrame) {
    const section = paramsAt(audio.time);

    const attractors = this.blobs.getAttractorWorldPositions(ATTRACTOR_COUNT);
    this.sparks.update(dt, audio, section, attractors, this.forceSparks);
    const flash = this.sparks.flash;

    this.blobs.update(dt, audio, section, flash);
    this.dust.setAttractors(attractors);
    this.dust.update(dt, audio, section, flash);

    // Flashes lift the whole scene toward a paler teal for a beat.
    (this.sceneRef.background as THREE.Color).copy(this.bgBase).lerp(this.bgFlash, Math.min(1, flash));

    // Act-aware camera drift: a slow orbit whose pace follows the act's
    // cameraDrift param, with a gentle breathing dolly. Mids nudge the pace.
    this.camPhase += dt * (0.02 + section.params.cameraDrift * 0.055 + audio.mid * 0.01);
    const r = 4.0 + Math.sin(this.camPhase * 0.7 + this.camSeedA) * 0.6;
    this.camera.position.set(
      Math.sin(this.camPhase + this.camSeedA) * r,
      Math.sin(this.camPhase * 0.43 + this.camSeedB) * 0.9,
      Math.cos(this.camPhase + this.camSeedA) * r,
    );
    this.camera.lookAt(0, 0, 0);
  }

  resize(_w: number, _h: number) {}

  dispose() {
    this.dust.dispose();
    this.blobs.dispose();
    this.sparks.dispose();
    for (const l of this.lights) l.dispose();
    this.lights = [];
    // Hand the camera back where the shell expects it.
    this.camera.position.set(0, 0, 4);
    this.camera.lookAt(0, 0, 0);
  }
}

const mod: VizModule = { default: () => new TheyComeMarching() };
export default mod.default;
