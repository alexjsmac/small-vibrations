import * as THREE from 'three';
import type { Viz, VizContext, AudioFrame, VizModule } from '../types';
import { mulberry32 } from '../random';

/**
 * The pre-detection ambient scene for listening mode: a near-black void with
 * very subtle drifting dust, shown behind the "Listening for Small
 * Vibrations…" message until the matcher identifies a track. Deliberately
 * quiet — the reveal of a real track visualization should feel like an
 * arrival — but it breathes faintly with whatever the mic hears.
 */
class ListeningAmbient implements Viz {
  private group!: THREE.Group;
  private material!: THREE.PointsMaterial;
  private disposables: Array<{ dispose: () => void }> = [];

  init(ctx: VizContext) {
    const { scene, seed, quality } = ctx;
    scene.background = new THREE.Color(0x05141c);
    scene.fog = null;

    const rand = mulberry32(seed);
    const count = quality.level === 'full' ? 2500 : 1200;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const r = Math.pow(rand(), 0.5) * 5;
      const theta = rand() * Math.PI * 2;
      positions[i * 3 + 0] = Math.cos(theta) * r;
      positions[i * 3 + 1] = (rand() * 2 - 1) * 1.8;
      positions[i * 3 + 2] = Math.sin(theta) * r;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.disposables.push(geometry);

    this.material = new THREE.PointsMaterial({
      color: 0xece4cf,
      size: 0.018,
      transparent: true,
      opacity: 0.25,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.disposables.push(this.material);

    this.group = new THREE.Group();
    this.group.add(new THREE.Points(geometry, this.material));
    scene.add(this.group);
  }

  update(dt: number, audio: AudioFrame) {
    this.group.rotation.y += dt * 0.015;
    // Faint shimmer with the room's sound while we listen.
    this.material.opacity = 0.2 + Math.min(0.2, (audio.mid + audio.bass) * 0.25);
  }

  resize(_w: number, _h: number) {}

  dispose() {
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
  }
}

const mod: VizModule = { default: () => new ListeningAmbient() };
export default mod.default;
