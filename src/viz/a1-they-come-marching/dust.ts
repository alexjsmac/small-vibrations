import * as THREE from 'three';
import type { QualityState } from '../../quality/QualityManager';
import type { AudioFrame } from '../types';
import type { SectionState } from './sections';
import { mulberry32 } from '../random';

/** How many independent condensation targets dust particles can orbit — kept small so the shader lookup stays a fixed-size uniform array read. */
export const ATTRACTOR_COUNT = 4;

/**
 * Stateless dust field for "They Come Marching": every particle's position
 * is a pure function of its seeded base position + accumulated flow time,
 * computed fresh in the vertex shader each frame — no ping-pong buffers.
 * Blended per-act (see sections.ts) between free curl-noise drift, orbiting
 * a condensation attractor, and a directional "marching" stream.
 *
 * Classic THREE.Points + GLSL ShaderMaterial — the same proven pattern as
 * the shared placeholder (the WebGPU/TSL version lives on branch
 * webgpu-tsl-experiment; it rendered black on real hardware).
 */
export class Dust {
  readonly object: THREE.Points;
  private material: THREE.ShaderMaterial;
  private geometry: THREE.BufferGeometry;
  private attractors: THREE.Vector3[];
  private uniforms: {
    uFlowTime: { value: number };
    uMarchTime: { value: number };
    uTurbulence: { value: number };
    uFlowAmount: { value: number };
    uCondensation: { value: number };
    uMarchDrift: { value: number };
    uDensity: { value: number };
    uBrightness: { value: number };
    uHigh: { value: number };
    uBass: { value: number };
    uScale: { value: number };
    uAttractors: { value: THREE.Vector3[] };
    uSeedShift: { value: number };
    uFlash: { value: number };
    uAccent: { value: number };
  };

  constructor(seed: number, quality: QualityState, private renderer: THREE.WebGLRenderer) {
    const rand = mulberry32(seed);
    const count = Math.min(quality.particleBudget, quality.level === 'full' ? 150_000 : 20_000);

    const positions = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    const attractorIdx = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      // Scatter through a wide, flattened volume — "vast open space".
      const r = Math.pow(rand(), 0.5) * 5.5;
      const theta = rand() * Math.PI * 2;
      positions[i * 3 + 0] = Math.cos(theta) * r;
      positions[i * 3 + 1] = (rand() * 2 - 1) * 1.6;
      positions[i * 3 + 2] = Math.sin(theta) * r;
      seeds[i] = rand();
      attractorIdx[i] = Math.floor(rand() * ATTRACTOR_COUNT);
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    this.geometry.setAttribute('aAttractor', new THREE.BufferAttribute(attractorIdx, 1));

    this.attractors = Array.from({ length: ATTRACTOR_COUNT }, () => new THREE.Vector3());
    this.uniforms = {
      uFlowTime: { value: 0 },
      uMarchTime: { value: 0 },
      uTurbulence: { value: 0.8 },
      uFlowAmount: { value: 1.2 },
      uCondensation: { value: 0 },
      uMarchDrift: { value: 0 },
      uDensity: { value: 1 },
      uBrightness: { value: 0.7 },
      uHigh: { value: 0 },
      uBass: { value: 0 },
      uScale: { value: 540 },
      uAttractors: { value: this.attractors },
      uSeedShift: { value: rand() * 100 },
      uFlash: { value: 0 },
      uAccent: { value: 0 },
    };

    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        uniform float uFlowTime;
        uniform float uMarchTime;
        uniform float uTurbulence;
        uniform float uFlowAmount;
        uniform float uCondensation;
        uniform float uMarchDrift;
        uniform float uDensity;
        uniform float uBass;
        uniform float uScale;
        uniform float uSeedShift;
        uniform vec3 uAttractors[${ATTRACTOR_COUNT}];
        attribute float aSeed;
        attribute float aAttractor;
        varying float vVisible;
        varying float vSparkle;

        // hash & value noise (same family as the shared placeholder shader)
        float hash(vec3 p) {
          p = fract(p * 0.3183099 + uSeedShift);
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
        // vec3-valued noise via channel offsets
        vec3 noise3(vec3 p) {
          return vec3(noise(p), noise(p + 31.416), noise(p + 78.54));
        }
        // forward-difference curl of the noise3 potential — divergence-free drift
        vec3 curl(vec3 p) {
          const float e = 0.1;
          vec3 n0 = noise3(p);
          vec3 nx = noise3(p + vec3(e, 0.0, 0.0));
          vec3 ny = noise3(p + vec3(0.0, e, 0.0));
          vec3 nz = noise3(p + vec3(0.0, 0.0, e));
          return vec3(
            (ny.z - n0.z) - (nz.y - n0.y),
            (nz.x - n0.x) - (nx.z - n0.z),
            (nx.y - n0.y) - (ny.x - n0.x)
          ) / e;
        }

        void main() {
          // free flow: base position advected by curl noise
          vec3 noiseP = position * uTurbulence + aSeed * 10.0 + uFlowTime;
          vec3 flowPos = position + curl(noiseP) * uFlowAmount * 0.35;

          // condensation: orbit this particle's assigned attractor
          vec3 attractor = uAttractors[int(aAttractor + 0.5)];
          float phase = aSeed * 6.2831853;
          float orbitR = aSeed * 0.4 + 0.15;
          vec3 orbit = vec3(
            cos(phase + uFlowTime * 0.5),
            sin(phase + uFlowTime * 0.62) * 0.6,
            sin(phase + uFlowTime * 0.53)
          ) * orbitR;
          vec3 condensed = mix(flowPos, attractor + orbit, uCondensation);

          // marching: directional stream along +x, wrapped to loop through frame
          float bound = 5.5;
          float marchX = mod(position.x + uMarchTime + aSeed * 4.0 + bound, bound * 2.0) - bound;
          vec3 marched = vec3(marchX, condensed.y, condensed.z);
          vec3 finalPos = mix(condensed, marched, uMarchDrift);

          vVisible = 1.0 - step(uDensity, aSeed);
          vSparkle = aSeed;

          vec4 mv = modelViewMatrix * vec4(finalPos, 1.0);
          float size = (0.02 + aSeed * 0.035) * (1.0 + uBass * 0.7);
          gl_PointSize = size * uScale / max(0.1, -mv.z);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uBrightness;
        uniform float uHigh;
        uniform float uFlash;
        uniform float uAccent;
        varying float vVisible;
        varying float vSparkle;

        void main() {
          if (vVisible < 0.5) discard;
          // soft round falloff — additive glow dots, not hard squares
          float d = length(gl_PointCoord - 0.5);
          float falloff = smoothstep(0.5, 0.08, d);
          float brightness = clamp(uBrightness + uHigh * 0.5 + vSparkle * 0.15 + uFlash * 0.5, 0.0, 1.5);
          vec3 dim = vec3(0.624, 0.847, 0.784);   // #9fd8c8
          vec3 hot = vec3(0.925, 0.894, 0.812);   // #ece4cf
          vec3 col = mix(dim, hot, clamp(brightness, 0.0, 1.0));
          // a seeded subset of particles carries the rust accent, scaled per act
          float warm = step(0.82, fract(vSparkle * 7.13)) * uAccent;
          col = mix(col, vec3(0.769, 0.302, 0.227), warm); // #c44d3a
          gl_FragColor = vec4(col, falloff * clamp(brightness, 0.1, 1.0) * 0.85);
        }
      `,
    });

    this.object = new THREE.Points(this.geometry, this.material);
    this.object.frustumCulled = false;
  }

  /** Up to ATTRACTOR_COUNT condensation targets, in world space. Copies values — safe to pass pooled vectors. */
  setAttractors(points: THREE.Vector3[]) {
    for (let i = 0; i < ATTRACTOR_COUNT; i++) {
      const p = points[i] ?? points[points.length - 1];
      if (p) this.attractors[i].copy(p);
    }
  }

  update(dt: number, audio: AudioFrame, section: SectionState, flash = 0) {
    const p = section.params;
    const u = this.uniforms;
    // Accumulate flow phase so speed changes glide instead of jumping.
    u.uFlowTime.value += dt * p.flowSpeed;
    u.uMarchTime.value += dt * 1.3;
    u.uTurbulence.value = p.turbulence;
    u.uFlowAmount.value = 0.9 + p.turbulence * 0.5;
    u.uCondensation.value = p.condensation;
    u.uMarchDrift.value = p.marchDrift;
    u.uDensity.value = p.dustDensity;
    u.uBrightness.value = p.dustBrightness;
    u.uHigh.value = audio.high;
    u.uBass.value = audio.bass;
    u.uFlash.value = flash;
    u.uAccent.value = p.accent;
    // Point-size scale factor tracks the drawing buffer height (same rule as
    // three's own PointsMaterial size attenuation).
    u.uScale.value = this.renderer.domElement.height * 0.5;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}
