import * as THREE from 'three';
import type { QualityState } from '../../quality/QualityManager';
import type { AudioFrame } from '../types';
import type { SectionState } from './sections';
import { mulberry32 } from '../random';

/** Spore mote particle budget — the a1 stateless-dust recipe at a tiny count (carries acts 1 and 7 nearly alone; a background layer everywhere else). */
export const SPORES_FULL = 4000;
export const SPORES_LITE = 1200;

/**
 * Drifting gold motes — the a1 stateless-Points dust recipe (curl drift,
 * soft round sprites, additive), reprojected into the dish's 2D screen
 * space exactly like a2-hive's bees.ts (no camera, no modelViewMatrix;
 * `finalPos.xy` is interpreted as a dish-space offset from the dish
 * centre). The screen projection REPLICATES dishShader.ts's own
 * `dishUv = (vUv-0.5)*uCover/uZoom+0.5+uPan` transform (inverted), the same
 * way bees.ts documents its relationship to wallShader.ts — never a
 * parallel reimplementation invented from scratch, an algebraic inverse of
 * the one source of truth.
 */
export class Spores {
  readonly object: THREE.Points;
  private material: THREE.ShaderMaterial;
  private geometry: THREE.BufferGeometry;
  private uniforms: {
    uFlowTime: { value: number };
    uTurbulence: { value: number };
    uFlowAmount: { value: number };
    uDensity: { value: number };
    uBrightness: { value: number };
    uHigh: { value: number };
    uBass: { value: number };
    uScale: { value: number };
    uSeedShift: { value: number };
    uFlash: { value: number };
    uZoom: { value: number };
    uCover: { value: THREE.Vector2 };
    uPan: { value: THREE.Vector2 };
  };

  constructor(seed: number, quality: QualityState, private renderer: THREE.WebGLRenderer) {
    const rand = mulberry32(seed ^ 0x59091e5);
    const count = Math.min(quality.particleBudget, quality.level === 'full' ? SPORES_FULL : SPORES_LITE);

    const positions = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      // A shell around and inside the dish (dish-space offset from centre,
      // uv units) — motes drift both within the dish and just beyond its
      // rim, reading as atmosphere around the glass.
      positions[i * 3 + 0] = (rand() * 2 - 1) * 0.62;
      positions[i * 3 + 1] = (rand() * 2 - 1) * 0.62;
      positions[i * 3 + 2] = (rand() * 2 - 1) * 0.4; // noise-field depth only, never projected
      seeds[i] = rand();
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));

    this.uniforms = {
      uFlowTime: { value: 0 },
      uTurbulence: { value: 0.6 },
      uFlowAmount: { value: 0.5 },
      uDensity: { value: 1 },
      uBrightness: { value: 0.65 },
      uHigh: { value: 0 },
      uBass: { value: 0 },
      uScale: { value: 90 },
      uSeedShift: { value: rand() * 100 },
      uFlash: { value: 0 },
      uZoom: { value: 1 },
      uCover: { value: new THREE.Vector2(1, 1) },
      uPan: { value: new THREE.Vector2(0, 0) },
    };

    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        precision highp float;
        uniform float uFlowTime;
        uniform float uTurbulence;
        uniform float uFlowAmount;
        uniform float uDensity;
        uniform float uBass;
        uniform float uScale;
        uniform float uSeedShift;
        uniform float uZoom;
        uniform vec2 uCover;
        uniform vec2 uPan;
        attribute float aSeed;
        varying float vVisible;
        varying float vSparkle;

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
          vec3 noiseP = position * uTurbulence + aSeed * 10.0 + uFlowTime;
          vec3 driftPos = position + curl(noiseP) * uFlowAmount * 0.35;

          vVisible = 1.0 - step(uDensity, aSeed);
          vSparkle = aSeed;

          // Inverse of dishShader.ts's dishUv = (vUv-0.5)*uCover/uZoom+0.5+uPan:
          // a dish-space point (0.5 + driftPos.xy, offset from centre) maps
          // back to clip space via vUv = 0.5 + (dishPos-0.5-uPan)*uZoom/uCover,
          // and dishPos-0.5 is exactly driftPos.xy by construction here.
          vec2 clipUv = (driftPos.xy - uPan) * uZoom / uCover;
          gl_Position = vec4(clipUv * 2.0, 0.0, 1.0);

          float size = (0.010 + aSeed * 0.022) * (1.0 + uBass * 0.6);
          gl_PointSize = size * uScale;
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform float uBrightness;
        uniform float uHigh;
        uniform float uFlash;
        varying float vVisible;
        varying float vSparkle;

        void main() {
          if (vVisible < 0.5) discard;
          float d = length(gl_PointCoord - 0.5);
          float falloff = smoothstep(0.5, 0.08, d);
          float brightness = clamp(uBrightness + uHigh * 0.4 + vSparkle * 0.15 + uFlash * 0.5, 0.0, 1.5);
          vec3 dim = vec3(0.45, 0.30, 0.08);   // dim amber-brown
          vec3 hot = vec3(1.0, 0.86, 0.42);    // spore gold
          vec3 col = mix(dim, hot, clamp(brightness, 0.0, 1.0));
          float alpha = falloff * clamp(brightness, 0.1, 1.0) * 0.7;
          gl_FragColor = vec4(col, alpha);
        }
      `,
    });

    this.object = new THREE.Points(this.geometry, this.material);
    this.object.frustumCulled = false;
  }

  /**
   * `zoom`/`cover`/`pan` are copied by value from the dish composite's own
   * uZoom/uCover/uPan each frame (not shared by object reference) — mirrors
   * bees.ts's independently-owned-but-numerically-identical uniform copy.
   */
  update(dt: number, audio: AudioFrame, section: SectionState, zoom: number, cover: THREE.Vector2, pan: THREE.Vector2, flash = 0) {
    const p = section.params;
    const u = this.uniforms;
    u.uFlowTime.value += dt * 0.5;
    u.uDensity.value = p.sporeDensity;
    u.uHigh.value = audio.high;
    u.uBass.value = audio.bass;
    u.uFlash.value = flash;
    u.uZoom.value = zoom;
    u.uCover.value.copy(cover);
    u.uPan.value.copy(pan);
    u.uScale.value = this.renderer.domElement.height * 0.1;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}
