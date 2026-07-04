import * as THREE from 'three';
import { MarchingCubes } from 'three/addons/objects/MarchingCubes.js';
import type { QualityState } from '../../quality/QualityManager';
import type { AudioFrame } from '../types';
import type { SectionState } from './sections';
import { mulberry32 } from '../random';

/** Fixed pool of ball "slots" — every act positions/strengths all of them (0 = inactive), so crossfading between acts is a simple per-slot lerp instead of reconciling variable-length ball lists. */
const SLOT_COUNT = 14;

interface Ball { x: number; y: number; z: number; strength: number }

/** A slot's fixed identity: which cluster it belongs to and its phase within it — gives each act's choreography something stable to work from. */
interface SlotSeed {
  cluster: number; // 0..2 — which of 3 condensation clusters this slot favors
  phase: number;   // 0..1 random phase, reused for flicker/orbit timing
  radius: number;  // 0..1 orbit radius within its cluster
}

const CLUSTER_COUNT = 3;

function makeSlotSeeds(rand: () => number): SlotSeed[] {
  return Array.from({ length: SLOT_COUNT }, (_, i) => ({
    cluster: i % CLUSTER_COUNT,
    phase: rand(),
    radius: 0.08 + rand() * 0.1,
  }));
}

// Scratch vectors reused across every choreography call — this runs up to
// twice per frame (act + crossfade target), so it stays allocation-free.
const _center = new THREE.Vector3();
const _orbit = new THREE.Vector3();

/** Cluster centers in field space [0,1]^3, spread around the middle; `spread` 0..1 pulls them together as clusters merge. Writes into `out`. */
function clusterCenter(cluster: number, spread: number, out: THREE.Vector3): THREE.Vector3 {
  const a = (cluster / CLUSTER_COUNT) * Math.PI * 2;
  const r = 0.22 * spread;
  return out.set(0.5 + Math.cos(a) * r, 0.5 + Math.sin(a) * r * 0.6, 0.5 + Math.sin(a * 1.3) * r);
}

function setBall(ball: Ball, x: number, y: number, z: number, strength: number) {
  ball.x = x; ball.y = y; ball.z = z; ball.strength = strength;
}

/** Per-act ball choreography, filled into `out` in place. All positions in field space [0,1]^3 (0.5 = center). `t` = act.localT, `clock` = seconds since load (for flicker/orbit motion, not staged). */
function ballsForAct(out: Ball[], actIndex: number, seeds: SlotSeed[], t: number, clock: number, bass: number): Ball[] {
  const swell = 1 + bass * 0.5;

  for (let i = 0; i < seeds.length; i++) {
    const s = seeds[i];
    const ball = out[i];
    const orbitA = s.phase * Math.PI * 2 + clock * (0.3 + s.phase * 0.2);
    _orbit.set(Math.cos(orbitA), Math.sin(orbitA * 1.3) * 0.6, Math.sin(orbitA)).multiplyScalar(s.radius);

    switch (actIndex) {
      case 0: // void — nothing yet
      case 1: // stirring — nothing yet
        setBall(ball, 0.5, 0.5, 0.5, 0);
        break;

      case 2: { // fragments — a few slots flicker in on a hashed pulse
        if (i >= 6) { setBall(ball, 0.5, 0.5, 0.5, 0); break; }
        const flicker = Math.max(0, Math.sin(clock * (1.5 + s.phase * 2) + s.phase * 20));
        const scatterA = s.phase * Math.PI * 2;
        setBall(ball,
          0.5 + Math.cos(scatterA) * 0.3,
          0.5 + (s.phase - 0.5) * 0.4,
          0.5 + Math.sin(scatterA) * 0.3,
          flicker > 0.6 ? 0.5 * swell : 0);
        break;
      }

      case 3: { // condensation — clusters drift together and grow
        if (i >= 10) { setBall(ball, 0.5, 0.5, 0.5, 0); break; }
        const spread = 1 - t * 0.6; // clusters pull inward over the act
        clusterCenter(s.cluster, spread, _center).add(_orbit);
        setBall(ball, _center.x, _center.y, _center.z, (0.35 + t * 0.35) * swell);
        break;
      }

      case 4: { // shift — reorganize into a vertical column
        clusterCenter(s.cluster, 0.4, _center);
        const columnY = 0.2 + (i / SLOT_COUNT) * 0.6;
        _center.x += (0.5 + _orbit.x * 0.4 - _center.x) * t;
        _center.y += (columnY - _center.y) * t;
        _center.z += (0.5 + _orbit.z * 0.4 - _center.z) * t;
        setBall(ball, _center.x, _center.y, _center.z, 0.65 * swell);
        break;
      }

      case 5: { // the march — a procession line streaming in +x (mirrors dust's march wrap)
        const bound = 0.9;
        const lineX = (((0.5 + i * 0.06 + clock * 0.12) % bound) + bound) % bound;
        setBall(ball, lineX, 0.5 + _orbit.y * 0.5, 0.5 + _orbit.z * 0.5, 0.8 * swell);
        break;
      }

      case 6: { // dissolve — fade out and scatter back
        if (i >= 10) { setBall(ball, 0.5, 0.5, 0.5, 0); break; }
        const spread = 0.4 + t * 1.4;
        clusterCenter(s.cluster, spread, _center).add(_orbit);
        setBall(ball, _center.x, _center.y, _center.z, Math.max(0, 0.6 * (1 - t)) * swell);
        break;
      }

      default:
        setBall(ball, 0.5, 0.5, 0.5, 0);
    }
  }
  return out;
}

/** Lerp `b` into `a` in place by k. */
function lerpBalls(a: Ball[], b: Ball[], k: number): Ball[] {
  if (k <= 0) return a;
  for (let i = 0; i < a.length; i++) {
    a[i].x += (b[i].x - a[i].x) * k;
    a[i].y += (b[i].y - a[i].y) * k;
    a[i].z += (b[i].z - a[i].z) * k;
    a[i].strength += (b[i].strength - a[i].strength) * k;
  }
  return a;
}

/**
 * The metaball "forms" — organic masses that grow, merge, and process
 * across the track (per-act choreography above, staged by sections.ts).
 * Uses the three.js MarchingCubes addon with a plain MeshStandardMaterial
 * and real scene lights (added by index.ts) — the exact recipe from
 * three's own marching-cubes example, chosen for reliability.
 */
export class Blobs {
  readonly object: InstanceType<typeof MarchingCubes>;
  private material: THREE.MeshStandardMaterial;
  private seeds: SlotSeed[];
  private clock = 0;
  private worldScale = 1.5;

  /** This frame's balls (persistent objects, filled in place by update()). */
  private frameBalls: Ball[] = Array.from({ length: SLOT_COUNT }, () => ({ x: 0.5, y: 0.5, z: 0.5, strength: 0 }));
  private nextBalls: Ball[] = Array.from({ length: SLOT_COUNT }, () => ({ x: 0.5, y: 0.5, z: 0.5, strength: 0 }));
  private attractorPool: THREE.Vector3[] = [];

  constructor(seed: number, quality: QualityState) {
    const rand = mulberry32(seed ^ 0x9e3779b9);
    this.seeds = makeSlotSeeds(rand);

    const resolution = quality.level === 'full' ? 48 : 28;
    const hueShift = rand() * 0.15 - 0.075;

    this.material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(0xece4cf),
      emissive: new THREE.Color(0x1f5d7a).offsetHSL(hueShift, 0, -0.15),
      roughness: 0.45,
      metalness: 0.05,
    });

    this.object = new MarchingCubes(resolution, this.material, false, false, 65_000);
    this.object.isolation = 60;
    this.object.scale.setScalar(this.worldScale);
  }

  /** World-space positions of the strongest active balls this frame, for dust.ts's condensation attractors. Reuses pooled vectors — consumers must copy, not hold. */
  getAttractorWorldPositions(count: number): THREE.Vector3[] {
    while (this.attractorPool.length < count) this.attractorPool.push(new THREE.Vector3());
    const active = this.frameBalls.filter((b) => b.strength > 0.01).sort((a, b) => b.strength - a.strength);
    const list = active.length > 0 ? active : this.frameBalls;
    const out: THREE.Vector3[] = [];
    for (let i = 0; i < count; i++) {
      const b = list[i % list.length];
      out.push(this.attractorPool[i].set(
        (b.x - 0.5) * 2 * this.worldScale,
        (b.y - 0.5) * 2 * this.worldScale,
        (b.z - 0.5) * 2 * this.worldScale,
      ));
    }
    return out;
  }

  update(dt: number, audio: AudioFrame, section: SectionState) {
    this.clock += dt;

    ballsForAct(this.frameBalls, section.actIndex, this.seeds, section.localT, this.clock, audio.bass);
    if (section.blend > 0) {
      const nextIndex = Math.min(section.actIndex + 1, 6);
      ballsForAct(this.nextBalls, nextIndex, this.seeds, 0, this.clock, audio.bass);
      lerpBalls(this.frameBalls, this.nextBalls, section.blend);
    }

    this.object.reset();
    for (const ball of this.frameBalls) {
      if (ball.strength <= 0.001) continue;
      this.object.addBall(ball.x, ball.y, ball.z, ball.strength, 12);
    }
    this.object.update();
  }

  dispose() {
    this.object.geometry.dispose();
    this.material.dispose();
  }
}
