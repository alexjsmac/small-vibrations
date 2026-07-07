import * as THREE from 'three';
import type { QualityState } from '../../quality/QualityManager';
import type { AudioFrame } from '../types';
import type { ArcState, SectionState } from './sections';
import { mulberry32 } from '../random';

/**
 * Pollen/bee dust for "Homemakers": the a1 stateless-particle pattern
 * (position = pure function of seeded base + accumulated flow time in the
 * vertex shader) with a new behavior blend — free curl drift vs. circulating
 * around the structure like foragers returning to the hive (`swarm`), with a
 * fine fast jitter so swarming particles read as wings, not orbits.
 */
export class Dust {
  readonly object: THREE.Points;
  private material: THREE.ShaderMaterial;
  private geometry: THREE.BufferGeometry;
  private uniforms: {
    uFlowTime: { value: number };
    uTurbulence: { value: number };
    uFlowAmount: { value: number };
    uSwarm: { value: number };
    uSettle: { value: number };
    uDensity: { value: number };
    uBrightness: { value: number };
    uHigh: { value: number };
    uBass: { value: number };
    uScale: { value: number };
    uSeedShift: { value: number };
    uFlash: { value: number };
    uAccent: { value: number };
    uFog: { value: number };
  };

  constructor(seed: number, quality: QualityState, private renderer: THREE.WebGLRenderer) {
    const rand = mulberry32(seed);
    const count = Math.min(quality.particleBudget, quality.level === 'full' ? 22_000 : 10_000);

    const positions = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      // shell around the wall — denser near it, thinning outward
      positions[i * 3 + 0] = (rand() * 2 - 1) * 3.2;
      positions[i * 3 + 1] = (rand() * 2 - 1) * 2.0;
      positions[i * 3 + 2] = (rand() * 2 - 1) * 2.4;
      seeds[i] = rand();
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));

    this.uniforms = {
      uFlowTime: { value: 0 },
      uTurbulence: { value: 0.7 },
      uFlowAmount: { value: 1.1 },
      uSwarm: { value: 0 },
      uSettle: { value: 0 },
      uDensity: { value: 1 },
      uBrightness: { value: 0.6 },
      uHigh: { value: 0 },
      uBass: { value: 0 },
      uScale: { value: 540 },
      uSeedShift: { value: rand() * 100 },
      uFlash: { value: 0 },
      uAccent: { value: 0 },
      uFog: { value: 0.1 },
    };

    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        uniform float uFlowTime;
        uniform float uTurbulence;
        uniform float uFlowAmount;
        uniform float uSwarm;
        uniform float uSettle;
        uniform float uDensity;
        uniform float uBass;
        uniform float uScale;
        uniform float uSeedShift;
        attribute float aSeed;
        varying float vVisible;
        varying float vSparkle;
        varying float vDist;

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
        vec3 noise3(vec3 p) {
          return vec3(noise(p), noise(p + 31.416), noise(p + 78.54));
        }
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

          // swarm: circulate around the structure like returning foragers
          float phase = aSeed * 6.2831853;
          float rho = 1.3 + aSeed * 1.5;
          float ang = phase + uFlowTime * (0.25 + aSeed * 0.35);
          vec3 orbitPos = vec3(
            cos(ang) * rho,
            sin(phase * 3.1 + uFlowTime * 0.6) * (0.5 + aSeed * 0.7),
            sin(ang) * rho * 0.75
          );
          // fine fast jitter — wings, not orbits
          orbitPos += curl(orbitPos * 3.0 + uFlowTime * 4.0) * 0.05;
          vec3 finalPos = mix(flowPos, orbitPos, uSwarm);

          // moving in: once the home is finished the swarm settles onto it
          vec3 settlePos = vec3(orbitPos.x * 0.5, orbitPos.y * 0.5, 0.18 + sin(phase * 5.0) * 0.12);
          finalPos = mix(finalPos, settlePos, uSettle * (0.4 + 0.6 * aSeed));

          vVisible = 1.0 - step(uDensity, aSeed);
          vSparkle = aSeed;

          vec4 mv = modelViewMatrix * vec4(finalPos, 1.0);
          vDist = -mv.z;
          float size = (0.012 + aSeed * 0.022) * (1.0 + uBass * 0.7);
          gl_PointSize = size * uScale / max(0.1, -mv.z);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uBrightness;
        uniform float uHigh;
        uniform float uFlash;
        uniform float uAccent;
        uniform float uFog;
        varying float vVisible;
        varying float vSparkle;
        varying float vDist;

        void main() {
          if (vVisible < 0.5) discard;
          float d = length(gl_PointCoord - 0.5);
          float falloff = smoothstep(0.5, 0.08, d);
          float brightness = clamp(uBrightness + uHigh * 0.5 + vSparkle * 0.15 + uFlash * 0.5, 0.0, 1.5);
          vec3 dim = vec3(0.624, 0.847, 0.784);   // #9fd8c8
          vec3 hot = vec3(0.925, 0.894, 0.812);   // #ece4cf
          vec3 col = mix(dim, hot, clamp(brightness, 0.0, 1.0));
          float warm = step(0.82, fract(vSparkle * 7.13)) * uAccent;
          col = mix(col, vec3(0.769, 0.302, 0.227), warm); // #c44d3a
          float alpha = falloff * clamp(brightness, 0.1, 1.0) * 0.65;
          alpha *= exp(-max(0.0, vDist - 1.2) * uFog);
          gl_FragColor = vec4(col, alpha);
        }
      `,
    });

    this.object = new THREE.Points(this.geometry, this.material);
    this.object.frustumCulled = false;
  }

  update(dt: number, audio: AudioFrame, section: SectionState, arc: ArcState, flash = 0) {
    const p = section.params;
    const u = this.uniforms;
    u.uFlowTime.value += dt * p.flowSpeed;
    u.uTurbulence.value = p.turbulence;
    u.uFlowAmount.value = 0.9 + p.turbulence * 0.5;
    u.uSwarm.value = p.swarm;
    u.uSettle.value = arc.settle;
    u.uDensity.value = p.dustDensity;
    u.uBrightness.value = p.dustBrightness;
    u.uHigh.value = audio.high;
    u.uBass.value = audio.bass;
    u.uFlash.value = flash;
    u.uAccent.value = p.accent;
    u.uFog.value = p.fog;
    u.uScale.value = this.renderer.domElement.height * 0.5;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}
