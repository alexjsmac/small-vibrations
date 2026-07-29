import * as THREE from 'three';
import type { Viz, VizContext, AudioFrame, VizModule } from '../types';
import { STERILE_VERT, buildSterileFragment } from './sterileShader';
import { paramsAt, sterileAt, zoomAt, lifeClockAt } from './sections';
import { mulberry32 } from '../random';

/** `?life=fast` multiplier on uLifeClock's advance (see update()'s doc). */
const LIFE_FAST_MUL = 12;

/** Slow-smoothed-bass -> breathing amplitude EMA rate (1/s), a1/a2/a3/b1/b2 idiom. */
const BASS_SLOW_RATE = 1.5;

/** uBreathPhase advance rate (cycles/s-ish; see sbClumpSd's breathing formula, sterileShader.ts). */
const BREATH_PHASE_RATE = 0.18;

/**
 * "Sterile Breath" — a living, breathing dark field is slowly, irreversibly
 * overtaken by a cold sterile blank: the track's antiseptic erasure of
 * life, rendered as an advancing bleach front across the frame.
 *
 * Increment 2: the real living side lands — a cushion-clump biomass field
 * (sterileShader.ts's sbBiomass) replaces increment 1's placeholder
 * dark-ground gradient, driven by `this.section.params` (paramsAt, now
 * actually consumed) plus a handful of CPU-accumulated envelopes (breathing
 * phase, motion phase, the lifecycle clock). The sterile side stays
 * increment 1's vertical-split placeholder; increment 3 replaces it with the
 * real S-field. Strike/bloom/poke/ripple events, ghost trails, and the
 * scripted camera land in increments 3-8 on top of this.
 *
 * Debug: `?solo=<0-5>` selects a solo layer (0 = full composed scene,
 * default; `?solo=biomass` -> mode 1, the biomass field alone over a flat
 * mid-gray background across the whole frame, for isolated screenshots; 2
 * front / 3 events / 4 ghosts land in later increments and currently fall
 * through to the composed scene; 5 sterile forces the cold blank
 * full-screen), `?life=fast` multiplies the lifecycle clock's advance by
 * LIFE_FAST_MUL (12) so clump birth/death is visible in seconds,
 * `?breath=<0..1>` pins uBreath to a constant (bypassing audio) for
 * deterministic screenshots, plus the standard `?t=`, `?q=`, `?debug=1`
 * handled outside this module (VizHost / QualityManager).
 */
class SterileBreath implements Viz {
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.OrthographicCamera;
  private quad!: THREE.Mesh;
  private material!: THREE.ShaderMaterial;

  private rand!: () => number;
  private full = true;

  /** Cover-fit scale (keeps the world square regardless of viewport aspect) — same idiom as b2's `cover`. */
  private cover = new THREE.Vector2(1, 1);

  /** Latest paramsAt(songTime) result — read every frame via `this.section.params` to drive the biomass field's uniforms. */
  private section: ReturnType<typeof paramsAt> | null = null;

  /** `?life=fast` — multiplies uLifeClock's advance by LIFE_FAST_MUL (see update()'s doc). */
  private forceLifeFast = false;
  /** `?breath=<0..1>` — pins uBreath to a constant, bypassing audio (deterministic screenshots). */
  private pinnedBreath: number | null = null;

  /**
   * Placeholder beat-driven accelerant folded additively into uLifeClock
   * (mirrors b2's beatPulse role, see catalogueShader.ts's uLifeClock).
   * Stays 0 this increment — a later increment wires bass onsets into it so
   * beats visibly speed up clump birth/death, same as b2's lifeClock.
   */
  private beatBonus = 0;

  /** Slow-smoothed bass (a1/a2/a3/b1/b2 idiom) — feeds uBreath (breathing amplitude) alongside the act's breathAmp. */
  private bassSlow = 0;
  /** CPU-accumulated breathing phase (seconds, BREATH_PHASE_RATE-scaled) — feeds uBreathPhase. */
  private breathPhase = 0;
  /** CPU-accumulated interior-speckle motion phase (seconds, mid-scaled) — feeds uMotionPhase. */
  private motionPhase = 0;

  init(ctx: VizContext) {
    const { renderer, seed, quality } = ctx;
    this.renderer = renderer;
    this.rand = mulberry32(seed ^ 0xb35d7e21);
    this.full = quality.level === 'full';

    const params = new URLSearchParams(location.search);
    const soloParam = params.get('solo');
    let soloMode = 0;
    if (soloParam === 'biomass') {
      soloMode = 1;
    } else {
      const parsedSolo = soloParam !== null ? parseInt(soloParam, 10) : NaN;
      soloMode = Number.isFinite(parsedSolo) ? parsedSolo : 0;
    }
    this.forceLifeFast = params.get('life') === 'fast';
    const breathParam = params.get('breath');
    if (breathParam !== null) {
      const v = parseFloat(breathParam);
      if (!Number.isNaN(v)) this.pinnedBreath = Math.min(1, Math.max(0, v));
    }

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this.material = new THREE.ShaderMaterial({
      vertexShader: STERILE_VERT,
      fragmentShader: buildSterileFragment({
        strikeSlots: this.full ? 8 : 6,
        bloomSlots: 3,
        pokeSlots: 4,
        rippleSlots: 4,
        lobes: this.full ? 5 : 3,
        fbmOct: this.full ? 3 : 2,
      }),
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uCover: { value: new THREE.Vector2(1, 1) },
        uZoom: { value: 1 },
        uPan: { value: new THREE.Vector2(0, 0) },
        uTime: { value: 0 },
        uSterile: { value: 0 },
        uSoloMode: { value: soloMode },
        uLifeClock: { value: 0 },
        uPresence: { value: 0 },
        uBreath: { value: 0 },
        uBreathPhase: { value: 0 },
        uMotionPhase: { value: 0 },
        uHeat: { value: 0 },
        uPaleness: { value: 0 },
      },
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.scene.add(this.quad);

    const canvas = renderer.domElement;
    this.resize(canvas.clientWidth || 1, canvas.clientHeight || 1);
  }

  update(dt: number, audio: AudioFrame) {
    const songTime = audio.time;
    const u = this.material.uniforms;
    u.uTime.value += dt;
    u.uSterile.value = sterileAt(songTime);
    u.uZoom.value = zoomAt(songTime);

    this.section = paramsAt(songTime);
    const p = this.section.params;

    // uLifeClock: lifeClockAt(songTime) is a pure monotonic integral of
    // lifeRate over song time, so scaling its OUTPUT by a constant scales
    // its instantaneous rate of advance by that same constant — no CPU
    // accumulation needed to make `?life=fast` speed up clump birth/death.
    // beatBonus (see its own doc) is a folded-in placeholder, 0 this
    // increment.
    const lifeMul = this.forceLifeFast ? LIFE_FAST_MUL : 1;
    u.uLifeClock.value = lifeClockAt(songTime) * lifeMul + this.beatBonus;
    u.uPresence.value = p.clumpPresence;

    this.bassSlow += (audio.bass - this.bassSlow) * Math.min(1, dt * BASS_SLOW_RATE);
    u.uBreath.value = this.pinnedBreath !== null ? this.pinnedBreath : this.bassSlow * p.breathAmp;

    this.breathPhase += dt * BREATH_PHASE_RATE;
    u.uBreathPhase.value = this.breathPhase;

    this.motionPhase += dt * p.motionSpeed * (0.5 + audio.mid);
    u.uMotionPhase.value = this.motionPhase;

    u.uHeat.value = p.heat;
    u.uPaleness.value = p.paleness;
  }

  resize(w: number, h: number) {
    if (!this.material || w <= 0 || h <= 0) return;
    const aspect = Math.min(3.5, Math.max(0.28, w / h));
    // Keep the world square regardless of viewport aspect (b2's uCover idiom).
    if (aspect >= 1) this.cover.set(aspect, 1);
    else this.cover.set(1, 1 / aspect);
    (this.material.uniforms.uCover.value as THREE.Vector2).copy(this.cover);
  }

  render() {
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.material.dispose();
    this.quad.geometry.dispose();
    this.renderer.setRenderTarget(null);
  }
}

const mod: VizModule = { default: () => new SterileBreath() };
export default mod.default;
