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

/** uFrontDrift advance rate (field-uv/s-ish, x-axis; y-axis runs at x0.83 — see update()'s doc). */
const FRONT_DRIFT_RATE = 0.008;

/** Fast-smoothed-highs EMA rate (1/s) feeding uGlint — quicker than BASS_SLOW_RATE so droplet glints track transients, not just sustained energy. */
const HIGH_FAST_RATE = 8;

/**
 * "Sterile Breath" — a living, breathing dark field is slowly, irreversibly
 * overtaken by a cold sterile blank: the track's antiseptic erasure of
 * life, rendered as an advancing bleach front across the frame.
 *
 * Increment 3: the real signed sterility field S(p) and the full sterile
 * side land (sterileShader.ts's sbSterility / sbSterileSide), replacing
 * increment 1's placeholder vertical split. `uPocket`/`uStretch` (the
 * field's centre and per-axis elongation) are seeded once per play from
 * `this.rand`; `uFrontDrift` accumulates every frame to drift the front's
 * noise wobble; `uScrubGlow`/`uGlint` ride smoothed bass and a NEW
 * fast-smoothed-highs EMA (`this.highFast`) respectively. Strike/bloom/poke/
 * ripple events, ghost trails, and the scripted camera land in increments
 * 4-8 on top of this.
 *
 * Debug: `?solo=<0-5>` selects a solo layer (0 = full composed scene,
 * default; `?solo=biomass` -> mode 1, the biomass field alone over a flat
 * mid-gray background across the whole frame, ignoring S entirely; `?solo=
 * front` -> mode 2, the S-field diagnostic (living side dark gray, sterile
 * side light gray, scrub line + glints at full strength, no biomass); 3
 * events / 4 ghosts land in later increments and currently fall through to
 * the composed scene; 5 sterile forces the real sterile-side treatment
 * full-screen), `?life=fast` multiplies the lifecycle clock's advance by
 * LIFE_FAST_MUL (12) so clump birth/death is visible in seconds, `?breath=
 * <0..1>` pins uBreath to a constant (bypassing audio), `?sterile=<0..1>`
 * pins uSterile to a constant (bypassing sterileAt's envelope), `?glint=
 * <0..1>` pins uGlint to a constant (bypassing audio) — all for
 * deterministic screenshots — plus the standard `?t=`, `?q=`, `?debug=1`
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
  /** `?sterile=<0..1>` — pins uSterile to a constant, bypassing sterileAt's envelope (deterministic screenshots). */
  private pinnedSterile: number | null = null;
  /** `?glint=<0..1>` — pins uGlint to a constant, bypassing audio (deterministic screenshots). */
  private pinnedGlint: number | null = null;

  /**
   * Per-play random offset reserved for a future increment's spatial
   * randomization (strikes/pokes placement) — not yet read anywhere or
   * wired to a uniform, same "stays inert this increment" role as
   * `beatBonus` below. Seeded once in init() via `this.rand` so it stays
   * reproducible within a play once it IS consumed.
   */
  private seedOff = new THREE.Vector2();

  /**
   * Placeholder beat-driven accelerant folded additively into uLifeClock
   * (mirrors b2's beatPulse role, see catalogueShader.ts's uLifeClock).
   * Stays 0 this increment — a later increment wires bass onsets into it so
   * beats visibly speed up clump birth/death, same as b2's lifeClock.
   */
  private beatBonus = 0;

  /** Slow-smoothed bass (a1/a2/a3/b1/b2 idiom) — feeds uBreath (breathing amplitude) alongside the act's breathAmp. */
  private bassSlow = 0;
  /** Fast-smoothed highs (HIGH_FAST_RATE) — feeds uGlint (droplet-glint amplitude) alongside the act's glintAmp. */
  private highFast = 0;
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
    } else if (soloParam === 'front') {
      soloMode = 2;
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
    const sterileParam = params.get('sterile');
    if (sterileParam !== null) {
      const v = parseFloat(sterileParam);
      if (!Number.isNaN(v)) this.pinnedSterile = Math.min(1, Math.max(0, v));
    }
    const glintParam = params.get('glint');
    if (glintParam !== null) {
      const v = parseFloat(glintParam);
      if (!Number.isNaN(v)) this.pinnedGlint = Math.min(1, Math.max(0, v));
    }

    // uPocket: the S-field's centre (the LAST living place). Composition
    // round: widened from a mild ±0.08 jitter to a substantial 0.10-0.24
    // field-uv offset per axis, each axis independently signed — the pocket
    // now sits VISIBLY off-centre (sometimes near a corner), so the front
    // reads as an advancing stain entering from one side rather than a
    // centred island shrinking symmetrically (the "petri-dish" composition
    // that collides with b1's actual petri look).
    const pocketOffset = () => {
      const sign = this.rand() < 0.5 ? -1 : 1;
      return sign * (0.10 + this.rand() * 0.14);
    };
    const pocket = new THREE.Vector2(0.5 + pocketOffset(), 0.5 + pocketOffset());
    // uStretch: per-axis elongation of the S-field — one axis stretches
    // (>1), the other squishes (<1); a coin flip picks WHICH axis
    // stretches. Composition round: the STRETCHED (dominant) axis's range
    // widened from 1.0 + rand*0.35 to 1.0 + rand*0.55 (the squished axis's
    // range is unchanged) for more pronounced anisotropy, reinforcing the
    // off-centre pocket's asymmetric read.
    const stretchMagDominant = this.rand() * 0.55;
    const stretchMagOther = this.rand() * 0.35;
    const stretchFlip = this.rand() < 0.5;
    const stretch = stretchFlip
      ? new THREE.Vector2(1.0 + stretchMagDominant, 1.0 - stretchMagOther)
      : new THREE.Vector2(1.0 - stretchMagOther, 1.0 + stretchMagDominant);
    this.seedOff.set(this.rand() * 10, this.rand() * 10);

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
        uPocket: { value: pocket },
        uStretch: { value: stretch },
        uFrontDrift: { value: new THREE.Vector2(0, 0) },
        uFrontNoise: { value: 0 },
        uScrubGlow: { value: 0 },
        uGlint: { value: 0 },
        uWatermark: { value: 0 },
        uSterileSpec: { value: 0 },
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
    u.uSterile.value = this.pinnedSterile !== null ? this.pinnedSterile : sterileAt(songTime);
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

    // uFrontDrift: CPU-accumulated domain offset for the S-field's noise
    // wobble (sbSterility, sterileShader.ts) — slightly different per-axis
    // rates so the wobble drifts rather than translating uniformly.
    const drift = u.uFrontDrift.value as THREE.Vector2;
    drift.x += dt * FRONT_DRIFT_RATE;
    drift.y += dt * FRONT_DRIFT_RATE * 0.83;

    u.uFrontNoise.value = p.frontNoise;
    u.uScrubGlow.value = p.scrubGlow * (0.6 + 0.8 * this.bassSlow);

    this.highFast += (audio.high - this.highFast) * Math.min(1, dt * HIGH_FAST_RATE);
    u.uGlint.value = this.pinnedGlint !== null ? this.pinnedGlint : p.glintAmp * this.highFast;

    u.uWatermark.value = p.watermark;
    u.uSterileSpec.value = p.sterileSpec;
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
