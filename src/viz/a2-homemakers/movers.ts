import * as THREE from 'three';
import type { AudioFrame } from '../types';
import type { Lattice } from './lattice';
import type { SectionState } from './sections';
import { mulberry32 } from '../random';

/**
 * The sporadic events layer for "Homemakers":
 *
 *  - FLASHES — the a1 pattern: brief full-scene pulses on bass onsets plus a
 *    per-act Poisson schedule. index.ts threads `flash` into every layer.
 *
 *  - FURNITURE MOVES — the track's own event: a glowing cell frame pulls out
 *    of the wall, glides through the air, and re-seats itself in another
 *    spot — the home rearranging itself around you. Fired by high-band
 *    onsets (the household sounds in the ambient act) and a per-act Poisson
 *    schedule (`moverRate`). A small pool of meshes animated on the CPU.
 *
 *  - PATHWAYS — glowing lines that draw themselves as smooth arcs bridging
 *    two built cells: the wall's own nervous system, lighting up as bees and
 *    humans move between rooms. Adapted from a1's filament pool (sparks.ts)
 *    but smoother — a single bezier arc rather than jagged lightning — and
 *    never trigger a flash. Staged by `pathRate`.
 *
 * Dev switch `?movers=always` forces continuous moves and pathways for
 * screenshots.
 */

const MOVER_POOL = 7;
const PATHWAY_POOL = 8;
const PATHWAY_POINTS = 40;
const DIM_CYAN = 0x9fd8c8;

const CREAM = new THREE.Color(0xece4cf);
const RUST = new THREE.Color(0xc44d3a);
const CYAN = new THREE.Color(DIM_CYAN);

interface Mover {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  from: THREE.Vector3;
  to: THREE.Vector3;
  /** Seconds since spawn; negative = inactive. */
  age: number;
  dur: number;
  lift: number;
  wobble: number;
}

interface Pathway {
  /** Holds 3 Line copies of the same geometry at tiny offsets — fake thickness/glow for 1px GL lines. */
  holder: THREE.Group;
  geometry: THREE.BufferGeometry;
  material: THREE.ShaderMaterial;
  /** Seconds since spawn; negative = inactive. */
  age: number;
  life: number;
}

const _sample = new THREE.Vector3();
const _pa = new THREE.Vector3();
const _pb = new THREE.Vector3();
const _ctrl = new THREE.Vector3();

export class Movers {
  readonly group = new THREE.Group();
  /** Current flash intensity, fast decay. Read by index.ts every frame. */
  flash = 0;

  private rand: () => number;
  private movers: Mover[] = [];
  private geometry: THREE.BufferGeometry;
  private pathways: Pathway[] = [];
  private bassAvg = 0;
  private highAvg = 0;
  private flashCooldown = 0;
  private moverCooldown = 0;
  private pathCooldown = 0;

  constructor(seed: number, lattice: Lattice) {
    this.rand = mulberry32(seed ^ 0x9e3779b9);

    // one hex cell frame, matching the lattice's comb geometry
    const g = new THREE.CylinderGeometry(
      lattice.hexRadius * 0.94, lattice.hexRadius * 0.94, lattice.hexDepth, 6, 1, true, (2 * Math.PI) / 3,
    );
    g.rotateX(Math.PI / 2);
    this.geometry = g;

    for (let i = 0; i < MOVER_POOL; i++) {
      const material = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uFade: { value: 0 },
          uColor: { value: CREAM.clone() },
        },
        vertexShader: /* glsl */ `
          varying vec3 vNormal;
          varying vec3 vViewDir;
          void main() {
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            vNormal = normalize(normalMatrix * normal);
            vViewDir = normalize(-mv.xyz);
            gl_Position = projectionMatrix * mv;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uFade;
          uniform vec3 uColor;
          varying vec3 vNormal;
          varying vec3 vViewDir;
          void main() {
            float rim = pow(1.0 - abs(dot(normalize(vNormal), normalize(vViewDir))), 1.2);
            gl_FragColor = vec4(uColor, (0.1 + rim * 0.75) * uFade);
          }
        `,
      });
      const mesh = new THREE.Mesh(this.geometry, material);
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.movers.push({
        mesh, material,
        from: new THREE.Vector3(), to: new THREE.Vector3(),
        age: -1, dur: 1.6, lift: 0.5, wobble: 0,
      });
    }

    for (let i = 0; i < PATHWAY_POOL; i++) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(PATHWAY_POINTS * 3), 3));
      const ts = new Float32Array(PATHWAY_POINTS);
      for (let j = 0; j < PATHWAY_POINTS; j++) ts[j] = j / (PATHWAY_POINTS - 1);
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
      this.pathways.push({ holder, geometry, material, age: -1, life: 0.9 });
    }
  }

  /** Hard boundary hit (the 0:54 and 3:08 drops) — index.ts fires this on cue crossings. */
  impulse(strength: number) {
    this.flash = Math.max(this.flash, strength);
  }

  update(dt: number, audio: AudioFrame, section: SectionState, lattice: Lattice, force = false, energy = 0.5) {
    const p = section.params;

    // --- onset detection (slow EMAs as the reference floor) ---
    const ema = Math.min(1, dt / 2);
    this.bassAvg += (audio.bass - this.bassAvg) * ema;
    this.highAvg += (audio.high - this.highAvg) * ema;
    this.flashCooldown -= dt;
    this.moverCooldown -= dt;
    this.pathCooldown -= dt;

    // --- flashes ---
    this.flash *= Math.exp(-dt * 6); // ~115ms half-life
    const bassOnset = audio.bass > this.bassAvg + 0.12 && audio.bass > 0.2;
    const scheduled = this.rand() < (p.flashRate / 60) * dt;
    if ((bassOnset || scheduled || force) && this.flashCooldown <= 0 && p.flashRate > 0) {
      const strength = bassOnset
        ? Math.min(1.2, 0.5 + (audio.bass - this.bassAvg) * 3)
        : (0.4 + this.rand() * 0.4) * (0.7 + 0.5 * energy);
      this.flash = Math.max(this.flash, strength);
      this.flashCooldown = force ? 1.2 : 0.5;
    }

    // --- furniture moves ---
    const highOnset = audio.high > this.highAvg + 0.1 && audio.high > 0.15;
    const moverScheduled = this.rand() < (p.moverRate / 60) * dt;
    if ((highOnset || moverScheduled || force) && this.moverCooldown <= 0 && p.moverRate > 0) {
      this.spawnMove(lattice, p.accent);
      this.moverCooldown = force ? 0.6 : 0.4;
    }

    // --- pathways: glowing lines bridging built cells ---
    const pathScheduled = this.rand() < (p.pathRate / 60) * dt;
    if ((highOnset || pathScheduled || force) && this.pathCooldown <= 0 && p.pathRate > 0) {
      this.spawnPathway(lattice, p.accent);
      this.pathCooldown = force ? 0.5 : 0.25;
    }

    for (const pw of this.pathways) {
      if (pw.age < 0) continue;
      pw.age += dt;
      const grow = Math.min(1, pw.age / 0.22);            // drawn in over 220ms
      const fade = 1 - Math.max(0, (pw.age - 0.3) / (pw.life - 0.3));
      pw.material.uniforms.uProgress.value = grow;
      pw.material.uniforms.uFade.value = Math.max(0, fade);
      if (pw.age >= pw.life) {
        pw.age = -1;
        pw.holder.visible = false;
      }
    }

    for (const m of this.movers) {
      if (m.age < 0) continue;
      m.age += dt;
      const t = Math.min(1, m.age / m.dur);
      // dwell at both ends, glide between
      const glide = smoothstep(0.18, 0.82, t);
      m.mesh.position.lerpVectors(m.from, m.to, glide);
      // pull out of the wall toward the viewer, then push back in
      m.mesh.position.z += Math.sin(Math.PI * t) * m.lift;
      m.mesh.rotation.z = Math.sin(t * Math.PI * 2) * m.wobble;
      m.mesh.rotation.x = Math.sin(t * Math.PI) * m.wobble * 0.6;
      const fade = smoothstep(0, 0.12, t) * (1 - smoothstep(0.88, 1, t));
      m.material.uniforms.uFade.value = fade;
      if (t >= 1) {
        m.age = -1;
        m.mesh.visible = false;
        // re-seating announces itself with a small scene flash
        this.flash = Math.max(this.flash, 0.25);
      }
    }
  }

  private spawnMove(lattice: Lattice, accent: number) {
    const m = this.movers.find((x) => x.age < 0);
    if (!m) return;
    if (!lattice.sampleBuiltCell(this.rand, m.from)) return;
    // destination: another built cell, a decent distance away
    for (let tries = 0; tries < 4; tries++) {
      if (!lattice.sampleBuiltCell(this.rand, _sample)) return;
      if (_sample.distanceToSquared(m.from) > 0.16) break;
    }
    m.to.copy(_sample);
    m.age = 0;
    m.dur = 1.4 + this.rand() * 0.9;
    m.lift = 0.4 + this.rand() * 0.25;
    m.wobble = 0.15 + this.rand() * 0.2;
    (m.material.uniforms.uColor.value as THREE.Color)
      .copy(this.rand() < accent ? RUST : CREAM);
    m.mesh.visible = true;
  }

  private spawnPathway(lattice: Lattice, accent: number) {
    const pw = this.pathways.find((x) => x.age < 0);
    if (!pw) return;
    if (!lattice.sampleBuiltCell(this.rand, _pa)) return;
    // destination: another built cell, a decent distance away
    for (let tries = 0; tries < 4; tries++) {
      if (!lattice.sampleBuiltCell(this.rand, _sample)) return;
      if (_sample.distanceToSquared(_pa) > 0.09) break;
    }
    _pb.copy(_sample);

    // control point: midpoint pushed out of the wall + lateral jitter
    _ctrl.set(
      (_pa.x + _pb.x) * 0.5 + (this.rand() - 0.5) * 0.5,
      (_pa.y + _pb.y) * 0.5 + (this.rand() - 0.5) * 0.5,
      (_pa.z + _pb.z) * 0.5 + 0.5 + this.rand() * 0.5,
    );

    const pos = pw.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let k = 0; k < PATHWAY_POINTS; k++) {
      const t = k / (PATHWAY_POINTS - 1);
      const it = 1 - t;
      // quadratic bezier: smooth flight path, not jagged lightning
      const x = it * it * _pa.x + 2 * it * t * _ctrl.x + t * t * _pb.x;
      const y = it * it * _pa.y + 2 * it * t * _ctrl.y + t * t * _pb.y;
      const z = it * it * _pa.z + 2 * it * t * _ctrl.z + t * t * _pb.z;
      pos.setXYZ(k, x, y, z);
    }
    pos.needsUpdate = true;

    const roll = this.rand();
    (pw.material.uniforms.uColor.value as THREE.Color)
      .copy(roll < accent ? RUST : roll < accent + 0.5 ? CREAM : CYAN);
    pw.life = 0.9 + this.rand() * 0.8;
    pw.age = 0;
    pw.holder.visible = true;
    // Pathways are the wall's ambient nervous system — no flash on completion.
  }

  dispose() {
    this.geometry.dispose();
    for (const m of this.movers) m.material.dispose();
    this.movers = [];
    for (const pw of this.pathways) {
      pw.geometry.dispose();
      pw.material.dispose();
    }
    this.pathways = [];
  }
}

function smoothstep(a: number, b: number, x: number): number {
  const c = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return c * c * (3 - 2 * c);
}
