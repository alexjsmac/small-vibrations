import * as THREE from 'three';
import type { QualityState } from '../../quality/QualityManager';
import type { AudioFrame } from '../types';
import type { ArcState, SectionState } from './sections';
import { mulberry32 } from '../random';

/**
 * Bees for the hive rebuild: a port of a2-homemakers/dust.ts's stateless
 * curl-noise + orbit + settle blend, recolored from teal/cream to warm
 * cream/gold with a rust-amber accent subset, with 3D depth fog dropped and
 * the projection changed from a perspective camera to direct 2D screen
 * space (see the vertex shader comment on why uScroll is never read here).
 */
export class Bees {
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
    uZoom: { value: number };
    uCover: { value: THREE.Vector2 };
  };

  constructor(seed: number, quality: QualityState, private renderer: THREE.WebGLRenderer) {
    const rand = mulberry32(seed ^ 0xb33b33);
    // Hard constraint: min(particleBudget, full ? 20000 : 6000).
    const count = Math.min(quality.particleBudget, quality.level === 'full' ? 20_000 : 6_000);

    const positions = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      // Same spread as the ported dust.ts — a shell that reads sensibly once
      // curl-drifted or orbited, regardless of the 2D reprojection below.
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
      uScale: { value: 96 },
      uSeedShift: { value: rand() * 100 },
      uFlash: { value: 0 },
      uAccent: { value: 0.25 },
      uZoom: { value: 1 },
      uCover: { value: new THREE.Vector2(1, 1) },
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
        uniform float uSwarm;
        uniform float uSettle;
        uniform float uDensity;
        uniform float uBass;
        uniform float uHigh;
        uniform float uScale;
        uniform float uSeedShift;
        uniform float uZoom;
        uniform vec2 uCover;
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

          // swarm: circulate around the hive like returning foragers
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

          // moving in: once the wall is finished the swarm settles onto it
          vec3 settlePos = vec3(orbitPos.x * 0.5, orbitPos.y * 0.5, 0.18 + sin(phase * 5.0) * 0.12);
          finalPos = mix(finalPos, settlePos, uSettle * (0.4 + 0.6 * aSeed));

          vVisible = 1.0 - step(uDensity, aSeed);
          vSparkle = aSeed;

          // View-relative 2D projection, matching the wall shader's own
          // cover-fit and zoom (no camera, no modelViewMatrix): bees never
          // read uScroll — they live directly in screen space, so panning
          // the wall underneath them costs nothing extra here. This is a
          // deliberate omission, not a missing term: tying bee position to
          // wall-space (scrolled) coordinates would require the same
          // unbounded-plane bookkeeping the wall has, for a layer that's
          // meant to read as hovering over the whole view instead.
          vec2 screenUv = finalPos.xy * uZoom / uCover + 0.5;
          gl_Position = vec4((screenUv - 0.5) * 2.0, 0.0, 1.0);

          float size = (0.014 + aSeed * 0.03) * (1.0 + uBass * 0.7) * (1.0 + uHigh * 0.4);
          gl_PointSize = size * uScale;
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform float uBrightness;
        uniform float uHigh;
        uniform float uFlash;
        uniform float uAccent;
        varying float vVisible;
        varying float vSparkle;

        void main() {
          if (vVisible < 0.5) discard;
          float d = length(gl_PointCoord - 0.5);
          float falloff = smoothstep(0.5, 0.08, d);
          float brightness = clamp(uBrightness + uHigh * 0.5 + vSparkle * 0.15 + uFlash * 0.5, 0.0, 1.5);
          vec3 dim = vec3(0.42, 0.24, 0.10);   // warm amber-brown, consistent with the wall's base palette
          vec3 hot = vec3(0.97, 0.87, 0.62);   // cream/gold
          vec3 col = mix(dim, hot, clamp(brightness, 0.0, 1.0));
          float rust = step(0.82, fract(vSparkle * 7.13)) * uAccent;
          col = mix(col, vec3(0.769, 0.478, 0.180), rust); // #c47a2e rust-amber subset
          float alpha = falloff * clamp(brightness, 0.1, 1.0) * 0.65;
          gl_FragColor = vec4(col, alpha);
        }
      `,
    });

    this.object = new THREE.Points(this.geometry, this.material);
    this.object.frustumCulled = false;
  }

  /**
   * `zoom`/`cover` are copied by value from the wall shader's own uZoom/
   * uCover each frame (not shared by object reference) — two independently
   * owned uniforms kept numerically identical, so either module could later
   * diverge (e.g. a bee-only parallax factor) without an implicit coupling.
   */
  update(dt: number, audio: AudioFrame, section: SectionState, arc: ArcState, zoom: number, cover: THREE.Vector2, flash = 0) {
    const p = section.params;
    const u = this.uniforms;
    u.uFlowTime.value += dt * (0.4 + p.beeSwarm * 0.6);
    u.uTurbulence.value = 0.6 + arc.energy * 0.4;
    u.uFlowAmount.value = 0.9 + arc.energy * 0.5;
    u.uSwarm.value = p.beeSwarm;
    u.uSettle.value = arc.settle;
    u.uDensity.value = p.beeDensity;
    u.uHigh.value = audio.high;
    u.uBass.value = audio.bass;
    u.uFlash.value = flash;
    u.uZoom.value = zoom;
    u.uCover.value.copy(cover);
    u.uScale.value = this.renderer.domElement.height * 0.12;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}
