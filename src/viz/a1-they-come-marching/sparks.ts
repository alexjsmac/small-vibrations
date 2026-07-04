import * as THREE from 'three';
import type { AudioFrame } from '../types';
import type { SectionState } from './sections';
import { mulberry32 } from '../random';

/**
 * The sporadic "events" layer for "They Come Marching":
 *
 *  - FLASHES — brief full-scene light pulses with a fast exponential decay,
 *    like distant lightning over the primordial soup. Triggered by bass
 *    onsets when the mic is live, and by a per-act Poisson schedule so the
 *    scene stays alive without audio. index.ts reads `flash` each frame and
 *    threads it into dust brightness, blob emissive, and the background.
 *
 *  - FILAMENTS — jagged glowing lines that draw themselves between the
 *    condensing masses in a fraction of a second, hold, and fade: proto-
 *    connections crackling through the forming life. A small pool of Line
 *    objects is rebuilt in place on each spawn (no allocation churn).
 *
 * Both are staged by the act keyframes (flashRate / filamentRate / accent
 * in sections.ts); the rust accent color appears with per-act probability.
 */

const FILAMENT_POOL = 7;
const FILAMENT_POINTS = 40;

const CREAM = new THREE.Color(0xece4cf);
const RUST = new THREE.Color(0xc44d3a);

interface Filament {
  /** Holds 3 Line copies of the same geometry at tiny offsets — fake thickness/glow for 1px GL lines. */
  holder: THREE.Group;
  geometry: THREE.BufferGeometry;
  material: THREE.ShaderMaterial;
  /** Seconds since spawn; negative = inactive. */
  age: number;
  life: number;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _perp1 = new THREE.Vector3();
const _perp2 = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

export class Sparks {
  readonly group = new THREE.Group();
  /** Current flash intensity, 0..~1.2, fast decay. Read by index.ts every frame. */
  flash = 0;

  private rand: () => number;
  private filaments: Filament[] = [];
  private bassAvg = 0;
  private highAvg = 0;
  private flashCooldown = 0;
  private filamentCooldown = 0;

  constructor(seed: number) {
    this.rand = mulberry32(seed ^ 0x2fa4b1c7);

    for (let i = 0; i < FILAMENT_POOL; i++) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(FILAMENT_POINTS * 3), 3));
      const ts = new Float32Array(FILAMENT_POINTS);
      for (let j = 0; j < FILAMENT_POINTS; j++) ts[j] = j / (FILAMENT_POINTS - 1);
      geometry.setAttribute('aT', new THREE.BufferAttribute(ts, 1));

      const material = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uProgress: { value: 0 },
          uFade: { value: 0 },
          uColor: { value: CREAM.clone() },
        },
        vertexShader: /* glsl */ `
          attribute float aT;
          varying float vT;
          void main() {
            vT = aT;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uProgress;
          uniform float uFade;
          uniform vec3 uColor;
          varying float vT;
          void main() {
            if (vT > uProgress) discard;
            // bright head where the line is currently being drawn
            float head = smoothstep(uProgress - 0.18, uProgress, vT);
            gl_FragColor = vec4(uColor * (0.7 + head * 0.5), uFade * (0.6 + 0.4 * head));
          }
        `,
      });

      // Three copies at sub-pixel-ish world offsets: reads as a glowing
      // stroke instead of a 1px hairline.
      const holder = new THREE.Group();
      for (const off of [[0, 0, 0], [0.014, 0.011, 0], [-0.012, -0.009, 0.012]] as const) {
        const line = new THREE.Line(geometry, material);
        line.position.set(off[0], off[1], off[2]);
        line.frustumCulled = false;
        holder.add(line);
      }
      holder.visible = false;
      this.group.add(holder);
      this.filaments.push({ holder, geometry, material, age: -1, life: 0.8 });
    }
  }

  /**
   * `attractors` — world-space anchor points (the blob masses) filaments arc
   * between; when they're all near the origin (early acts, no blobs yet) the
   * endpoints scatter through the dust volume instead.
   * `force` — dev switch (?sparks=always): continuous events for screenshots.
   */
  update(dt: number, audio: AudioFrame, section: SectionState, attractors: THREE.Vector3[], force = false) {
    const p = section.params;

    // --- onset detection (slow EMAs as the reference floor) ---
    const ema = Math.min(1, dt / 2);
    this.bassAvg += (audio.bass - this.bassAvg) * ema;
    this.highAvg += (audio.high - this.highAvg) * ema;
    this.flashCooldown -= dt;
    this.filamentCooldown -= dt;

    // --- flashes ---
    this.flash *= Math.exp(-dt * 6); // ~115ms half-life
    const bassOnset = audio.bass > this.bassAvg + 0.12 && audio.bass > 0.2;
    const scheduled = this.rand() < (p.flashRate / 60) * dt;
    if ((bassOnset || scheduled || force) && this.flashCooldown <= 0 && p.flashRate > 0) {
      const strength = bassOnset ? Math.min(1.2, 0.5 + (audio.bass - this.bassAvg) * 3) : 0.4 + this.rand() * 0.4;
      this.flash = Math.max(this.flash, strength);
      this.flashCooldown = force ? 1.2 : 0.5;
    }

    // --- filaments ---
    const highOnset = audio.high > this.highAvg + 0.1 && audio.high > 0.15;
    const filamentScheduled = this.rand() < (p.filamentRate / 60) * dt;
    if ((highOnset || filamentScheduled || force) && this.filamentCooldown <= 0 && p.filamentRate > 0) {
      this.spawnFilament(attractors, p.accent);
      this.filamentCooldown = force ? 0.35 : 0.25;
    }

    for (const f of this.filaments) {
      if (f.age < 0) continue;
      f.age += dt;
      const grow = Math.min(1, f.age / 0.16);            // drawn in over 160ms
      const fade = 1 - Math.max(0, (f.age - 0.26) / (f.life - 0.26));
      f.material.uniforms.uProgress.value = grow;
      f.material.uniforms.uFade.value = Math.max(0, fade);
      if (f.age >= f.life) {
        f.age = -1;
        f.holder.visible = false;
      }
    }
  }

  private spawnFilament(attractors: THREE.Vector3[], accent: number) {
    const f = this.filaments.find((x) => x.age < 0);
    if (!f) return;

    // Endpoints: arc between two blob masses when they exist, otherwise
    // scatter through the open dust volume.
    const spread = attractors.reduce((m, v) => Math.max(m, v.length()), 0);
    if (spread > 0.3 && attractors.length >= 2) {
      const i = Math.floor(this.rand() * attractors.length);
      let j = Math.floor(this.rand() * attractors.length);
      if (j === i) j = (j + 1) % attractors.length;
      _a.copy(attractors[i]);
      _b.copy(attractors[j]);
      // Overshoot well past the surfaces: the masses sit close together, so
      // without this the lines hide inside the cream blob instead of arcing
      // out through the dark dust field where they read.
      _a.addScaledVector(randUnit(this.rand, _perp1), 0.7 + this.rand() * 0.9);
      _b.addScaledVector(randUnit(this.rand, _perp1), 0.7 + this.rand() * 0.9);
    } else {
      randUnit(this.rand, _a).multiplyScalar(0.8 + this.rand() * 1.8);
      randUnit(this.rand, _b).multiplyScalar(0.8 + this.rand() * 1.8);
    }

    // Jagged path: linear interpolation + perpendicular jitter enveloped by
    // sin(pi*t) so the endpoints stay anchored.
    _dir.subVectors(_b, _a);
    const len = _dir.length();
    _perp1.crossVectors(_dir, _up).normalize();
    if (_perp1.lengthSq() < 0.5) _perp1.set(1, 0, 0);
    _perp2.crossVectors(_dir, _perp1).normalize();
    const amp = Math.max(0.22, len * 0.24);

    const pos = f.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let k = 0; k < FILAMENT_POINTS; k++) {
      const t = k / (FILAMENT_POINTS - 1);
      const env = Math.sin(Math.PI * t) * amp;
      // two jitter octaves — one broad arc, one fine crackle
      const j1 = (this.rand() - 0.5) * 0.5 + Math.sin(t * Math.PI * 2 + this.rand() * 6) * 0.5;
      const j2 = (this.rand() - 0.5) * 0.7;
      pos.setXYZ(
        k,
        _a.x + _dir.x * t + (_perp1.x * j1 + _perp2.x * j2) * env,
        _a.y + _dir.y * t + (_perp1.y * j1 + _perp2.y * j2) * env,
        _a.z + _dir.z * t + (_perp1.z * j1 + _perp2.z * j2) * env,
      );
    }
    pos.needsUpdate = true;

    (f.material.uniforms.uColor.value as THREE.Color)
      .copy(this.rand() < accent ? RUST : CREAM);
    f.life = 0.55 + this.rand() * 0.7;
    f.age = 0;
    f.holder.visible = true;
    // A filament firing announces itself with a small scene flash.
    this.flash = Math.max(this.flash, 0.25);
  }

  dispose() {
    for (const f of this.filaments) {
      f.geometry.dispose();
      f.material.dispose();
    }
    this.filaments = [];
  }
}

function randUnit(rand: () => number, out: THREE.Vector3): THREE.Vector3 {
  const t = rand() * Math.PI * 2;
  const z = rand() * 2 - 1;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return out.set(Math.cos(t) * r, z, Math.sin(t) * r);
}
