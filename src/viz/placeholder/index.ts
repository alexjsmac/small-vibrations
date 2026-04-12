import * as THREE from 'three';
import type { Viz, VizContext, AudioFrame, VizModule } from '../types';

/**
 * Shared placeholder visualization used by every track until per-track viz
 * modules are authored. It's a low-cost generative scene that already obeys
 * the seed (so each play looks different) and reads the quality preset.
 *
 * Visual concept: a slowly rotating cracked-marble icosahedron suspended in a
 * cream-on-teal duotone — a nod to the Small Vibrations sleeve. Particles
 * orbit it. Replaced per-track later.
 */
class Placeholder implements Viz {
  private group!: THREE.Group;
  private mesh!: THREE.Mesh;
  private points!: THREE.Points;
  private uniforms!: { uTime: { value: number } };
  private disposables: Array<{ dispose: () => void }> = [];

  async init(ctx: VizContext) {
    const { scene, seed, quality } = ctx;

    const rand = mulberry32(seed);
    const hueShift = rand() * 0.2 - 0.1;

    scene.background = new THREE.Color(0x14465e);
    scene.fog = new THREE.Fog(0x0a2230, 4, 12);

    this.group = new THREE.Group();
    scene.add(this.group);

    // --- central icosahedron with stippled shader ---
    const geo = new THREE.IcosahedronGeometry(1.2, 4);
    this.disposables.push(geo);

    this.uniforms = { uTime: { value: 0 } };
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        ...this.uniforms,
        uCream: { value: new THREE.Color(0xece4cf) },
        uTeal:  { value: new THREE.Color(0x1f5d7a).offsetHSL(hueShift, 0, 0) },
        uSeed:  { value: rand() * 100 },
      },
      vertexShader: /* glsl */ `
        uniform float uTime;
        uniform float uSeed;
        varying vec3 vNormal;
        varying float vNoise;

        // hash & noise
        float hash(vec3 p) {
          p = fract(p * 0.3183099 + uSeed);
          p *= 17.0;
          return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
        }
        float noise(vec3 p) {
          vec3 i = floor(p);
          vec3 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
                mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
            mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y),
            f.z);
        }

        void main() {
          vec3 p = position;
          float n = noise(p * 1.6 + uTime * 0.15);
          p += normal * (n - 0.5) * 0.35;
          vNormal = normalize(normalMatrix * normal);
          vNoise = n;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uCream;
        uniform vec3 uTeal;
        varying vec3 vNormal;
        varying float vNoise;

        void main() {
          float l = clamp(dot(vNormal, normalize(vec3(0.4, 0.7, 0.6))) * 0.5 + 0.5, 0.0, 1.0);
          // duotone halftone-ish shading
          float band = smoothstep(0.35, 0.65, l + (vNoise - 0.5) * 0.5);
          vec3 col = mix(uTeal, uCream, band);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.disposables.push(mat);

    this.mesh = new THREE.Mesh(geo, mat);
    this.group.add(this.mesh);

    // --- orbiting particles (count scaled by quality) ---
    const count = Math.min(quality.particleBudget, quality.level === 'full' ? 12000 : 2000);
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const r = 1.6 + rand() * 1.6;
      const t = rand() * Math.PI * 2;
      const p = Math.acos(2 * rand() - 1);
      positions[i * 3 + 0] = r * Math.sin(p) * Math.cos(t);
      positions[i * 3 + 1] = r * Math.sin(p) * Math.sin(t);
      positions[i * 3 + 2] = r * Math.cos(p);
    }
    const pgeo = new THREE.BufferGeometry();
    pgeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.disposables.push(pgeo);

    const pmat = new THREE.PointsMaterial({
      color: 0xece4cf,
      size: 0.015,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
    });
    this.disposables.push(pmat);

    this.points = new THREE.Points(pgeo, pmat);
    this.group.add(this.points);
  }

  update(dt: number, audio: AudioFrame) {
    this.uniforms.uTime.value += dt;
    // Reactivity hooks already in place — currently audio is zeros until the
    // mic pipeline lands. Bass will swell the mesh; mids spin the particles.
    const swell = 1 + audio.bass * 0.4;
    this.mesh.scale.setScalar(swell);
    this.group.rotation.y += dt * (0.15 + audio.mid * 0.6);
    this.group.rotation.x += dt * 0.05;
    this.points.rotation.y -= dt * 0.08;
  }

  resize(_w: number, _h: number) { /* uses camera aspect from VizHost */ }

  dispose() {
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
  }
}

function mulberry32(a: number) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const mod: VizModule = { default: () => new Placeholder() };
export default mod.default;
