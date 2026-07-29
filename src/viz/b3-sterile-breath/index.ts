import * as THREE from 'three';
import type { Viz, VizContext, AudioFrame, VizModule } from '../types';
import { STERILE_VERT, buildSterileFragment, FRONT_NOISE_AMP } from './sterileShader';
import { paramsAt, sterileAt, zoomAt, lifeClockAt, type ActParams } from './sections';
import { mulberry32 } from '../random';
import { SlotPool, nextPoissonDelay } from './pools';

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
 * Bass onset detector (increment 4, house recipe — a fast EMA of the bass
 * band chasing a slower EMA of itself; the fast-minus-slow gap crossing
 * BASS_ONSET_THRESHOLD is the onset, BASS_ONSET_COOLDOWN keeps a sustained
 * loud passage from re-triggering every frame). Fires a swab strike AND
 * kicks `this.tick` (see its own doc) — two independent effects of the same
 * onset, not the same scalar.
 */
const BASS_FAST_RATE = 8;
const BASS_ONSET_EMA_RATE = 1.5;
const BASS_ONSET_THRESHOLD = 0.09;
const BASS_ONSET_COOLDOWN = 0.28;

/** `this.tick`'s exponential decay rate (1/s) — see its own doc. */
const TICK_DECAY_RATE = 7;

/**
 * Safety-margin multiplier applied on top of the wobble upper bound when
 * deriving rMaxEff (see computeRMaxEff's doc) — a small epsilon so
 * floating-point slop never lets uSterile=0 show a sliver of sterile right
 * at the farthest corner.
 */
const R_MAX_EFF_EPS = 1.02;

/**
 * The exact analytic upper bound of sbSterility's wobble multiplier
 * (sterileShader.ts): `wobble = 1 + FRONT_NOISE_AMP * uFrontNoise *
 * wobbleN`, where `wobbleN = (coarseN*2 + fineN) / 3` and coarseN/fineN are
 * each `sbFbm(...) - 0.5`, conservatively bounded to [-0.5, 0.5] (sbFbm's
 * full [0,1) support, treated as reachable even though multi-octave sums
 * are usually a bit under that — the SAFE bound, not the tight one). A
 * weighted AVERAGE of two terms each bounded to +-0.5 is itself bounded to
 * +-0.5 regardless of the specific weights (2:1 here) — so |wobbleN| <= 0.5
 * always, and uFrontNoise's documented max is 1.0 (ActParams.frontNoise).
 * Derived from the ACTUAL exported FRONT_NOISE_AMP (sterileShader.ts)
 * rather than a hand-typed literal, so this can never silently drift from
 * what's actually compiled into the shader.
 */
const WOBBLE_MAX_MULT = 1 + FRONT_NOISE_AMP * 1.0 * 0.5;

/**
 * MUST mirror sterileShader.ts's STRIKE_SETTLE exactly — ageStrikes uses it
 * to compute, in closed form, the age at which a healing strike's GPU radius
 * envelope reaches exactly 0 (age = STRIKE_SETTLE + 1/healRate, since the
 * shrink phase is linear past STRIKE_SETTLE), so the CPU can free that slot
 * the instant the shrink is visually complete.
 */
const STRIKE_SETTLE = 0.3;

/**
 * CPU S-estimate safety margin (field-uv units) for pickLivingPoint: a
 * candidate point must clear the NOISE-FREE front by at least this much
 * (phi_no_noise - R < -STRIKE_LIVING_MARGIN) before a strike is allowed to
 * spawn there — comfortably inside living territory even though the CPU
 * estimate ignores the GPU's noise wobble entirely.
 */
const STRIKE_LIVING_MARGIN = 0.06;

/** Rejection-sampling attempts before fireStrike gives up (late acts are mostly sterile — skipping is correct then, not a bug). */
const STRIKE_PICK_TRIES = 8;

/** Failed (healRate === 0) strikes hold at full radius this long before freeing, fading `w` 1->0 over the FAIL_FADE seconds before that. */
const STRIKE_FAIL_HOLD = 14;
const STRIKE_FAIL_FADE = 1.5;

/** Loop/seek detection: a |songTime jump| beyond this many seconds is a `?t=` seek or a track loop, not normal playback (see update()'s doc). */
const SEEK_JUMP_SECONDS = 10;

/**
 * "Sterile Breath" — a living, breathing dark field is slowly, irreversibly
 * overtaken by a cold sterile blank: the track's antiseptic erasure of
 * life, rendered as an advancing bleach front across the frame.
 *
 * Increment 3 landed the real signed sterility field S(p) and the full
 * sterile side (sterileShader.ts's sbSterility / sbSterileSide), replacing
 * increment 1's placeholder vertical split. `uPocket`/`uStretch` (the
 * field's centre and per-axis elongation) are seeded once per play from
 * `this.rand`; `uFrontDrift` accumulates every frame to drift the front's
 * noise wobble; `uScrubGlow`/`uGlint` ride smoothed bass and a
 * fast-smoothed-highs EMA (`this.highFast`) respectively.
 *
 * Increment 4: swab strikes — bass-driven ellipse "wounds" punched into the
 * living field, healing shut (or, once an act's `strikeHeal` is 0, held
 * open and eventually abandoned) — land via a bass ONSET detector
 * (`this.bassFast`/`this.bassOnsetEma`, house recipe) for beat-locked hits
 * plus an independent Poisson process (`nextPoissonDelay`, pools.ts) for
 * ambient strikes so the scene still punches without a mic. Both channels
 * share one `SlotPool(STRIKE_SLOTS)` (`this.strikePool`, bound as
 * `uStrikeA`) plus a hand-rolled parallel `THREE.Vector4[]` for the values
 * baked once at fire time (`this.strikeB`, bound as `uStrikeB`) — see
 * `fireStrike`'s doc for the CPU living-point rejection sampler and
 * `ageStrikes`'s doc for the heal/fail/free lifecycle. `this.tick` is a NEW,
 * independent decay scalar (kicked to 1 on every bass onset, `uTick`) for
 * the shader's young-strike rim pop — it does NOT reuse `beatBonus` below.
 * Bloom/poke/ripple events, ghost trails, and the scripted camera remain for
 * later increments on top of this.
 *
 * Debug: `?solo=<0-5>` selects a solo layer (0 = full composed scene,
 * default; `?solo=biomass` -> mode 1, the biomass field alone over a flat
 * mid-gray background across the whole frame, ignoring S entirely; `?solo=
 * front` -> mode 2, the S-field diagnostic (living side dark gray, sterile
 * side light gray, scrub line + glints at full strength, no biomass);
 * `?solo=events` -> mode 3 (NEW this increment), uSterile pinned to 0 here
 * so ONLY strikes carve — neutral mid-gray field, no biomass, no front,
 * strike interiors + scrub-line rims + tick pops at full visibility; 4
 * ghosts lands in a later increment and currently falls through to the
 * composed scene; 5 sterile forces the real sterile-side treatment
 * full-screen), `?life=fast` multiplies the lifecycle clock's advance by
 * LIFE_FAST_MUL (12) so clump birth/death is visible in seconds, `?breath=
 * <0..1>` pins uBreath to a constant (bypassing audio), `?sterile=<0..1>`
 * pins uSterile to a constant (bypassing sterileAt's envelope), `?glint=
 * <0..1>` pins uGlint to a constant (bypassing audio), `?strike=always`
 * forces the ambient Poisson strike rate to 60/min regardless of act,
 * `?heal=off`/`?heal=on` overrides EVERY newly-fired strike's baked
 * healRate to 0 / 0.22 regardless of act (existing strikes keep whatever
 * they were baked with) — all for deterministic screenshots — plus the
 * standard `?t=`, `?q=`, `?debug=1` handled outside this module (VizHost /
 * QualityManager).
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

  /** `this.soloMode` mirrors the shader's uSoloMode (see init()'s parsing) — kept CPU-side too so update() can special-case mode 3 (events: uSterile pinned to 0). */
  private soloMode = 0;

  /** Swab-strike slot pool (increment 4): `slots` IS uStrikeA (xy/z/w set here, bound by reference); `strikeB` is a parallel, hand-maintained array for the values baked once at fire time (uStrikeB) — see fireStrike's doc. */
  private strikePool!: SlotPool;
  private strikeB: THREE.Vector4[] = [];

  /** `?strike=always` — forces the ambient Poisson strike rate to 60/min regardless of the current act. */
  private forceStrikeAlways = false;
  /** `?heal=off` / `?heal=on` — overrides every NEWLY-fired strike's baked healRate (0 / 0.22) regardless of act; null = use the act's own ActParams.strikeHeal. */
  private healOverride: number | null = null;

  /** Fast-smoothed bass (BASS_FAST_RATE) chasing a slower EMA of itself (BASS_ONSET_EMA_RATE) — the bass onset detector's two EMAs (house recipe, see update()'s doc). */
  private bassFast = 0;
  private bassOnsetEma = 0;
  /** Seconds remaining before another onset-triggered strike may fire (BASS_ONSET_COOLDOWN idiom). */
  private onsetCooldown = 0;
  /** Bass-onset decay scalar (tick *= exp(-TICK_DECAY_RATE*dt) per frame, kicked to 1 on every onset) feeding uTick — independent of beatBonus, see its own doc above. */
  private tick = 0;

  /** Seconds until the next Poisson-scheduled ambient strike (nextPoissonDelay, pools.ts) — independent of the onset channel's cooldown. */
  private strikeTimeToNext = 0;

  /** Last frame's song time, used only to detect a `?t=` seek or a track loop (see update()'s doc) — NOT the fallback clock itself, VizHost owns that. */
  private lastSongTime = 0;

  /** Per-seed S-field radius at uSterile=0 (uRMax's CPU-side source of truth) — computeRMaxEff's doc; recomputed in resize() since it depends on uCover. Also feeds pickLivingPoint's own CPU S-estimate, so both sides of the front agree on where it is. */
  private rMaxEff = 0;

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
    } else if (soloParam === 'events') {
      soloMode = 3;
    } else {
      const parsedSolo = soloParam !== null ? parseInt(soloParam, 10) : NaN;
      soloMode = Number.isFinite(parsedSolo) ? parsedSolo : 0;
    }
    this.soloMode = soloMode;
    this.forceLifeFast = params.get('life') === 'fast';
    this.forceStrikeAlways = params.get('strike') === 'always';
    const healParam = params.get('heal');
    if (healParam === 'off') this.healOverride = 0;
    else if (healParam === 'on') this.healOverride = 0.22;
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

    // Swab-strike pool (increment 4): sized to match the SAME strikeSlots
    // budget passed to buildSterileFragment below (8 Full / 6 Lite) — the
    // array lengths must agree or the uStrikeA/uStrikeB uniform arrays
    // won't line up with the shader's compile-time STRIKE_SLOTS.
    const strikeSlots = this.full ? 8 : 6;
    this.strikePool = new SlotPool(strikeSlots);
    for (let i = 0; i < strikeSlots; i++) this.strikeB.push(new THREE.Vector4(0, 0, 0, 0));

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this.material = new THREE.ShaderMaterial({
      vertexShader: STERILE_VERT,
      fragmentShader: buildSterileFragment({
        strikeSlots,
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
        uRMax: { value: 0 }, // real value computed + uploaded by resize()'s first call below, once uPocket/uStretch (just above) exist on this same uniforms object
        uScrubGlow: { value: 0 },
        uGlint: { value: 0 },
        uWatermark: { value: 0 },
        uSterileSpec: { value: 0 },
        uTick: { value: 0 },
        uStrikeA: { value: this.strikePool.slots },
        uStrikeB: { value: this.strikeB },
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
    // uSterile: `?solo=events` (mode 3) pins it to 0 so R stays at uRMax and
    // the front essentially never trips inside the frame — ONLY strikes
    // carve visible sterile territory in that mode (see sterileShader.ts's
    // mode-3 doc). Takes priority over `?sterile=` since the whole point of
    // that solo mode is isolating the strike grammar from the front.
    u.uSterile.value =
      this.soloMode === 3 ? 0 : this.pinnedSterile !== null ? this.pinnedSterile : sterileAt(songTime);
    u.uZoom.value = zoomAt(songTime);

    this.section = paramsAt(songTime);
    const p = this.section.params;

    // Loop/seek reset: a large songTime jump (a `?t=` seek, or the track
    // looping back to 0) means every in-flight strike and the Poisson
    // ambient schedule's countdown are stale — clear the pool and re-seed
    // the schedule. Zeroing strikeTimeToNext (rather than leaving a stale
    // value) is the same "due now" idiom schedulePoissonStrikes already
    // uses when a rate turns on from 0 (b2's scheduleScans idiom): the very
    // next call fires once immediately at the NEW act's rate, then resumes
    // normal Poisson spacing — never a burst, just a single on-arrival
    // strike instead of either a long stale silence or a pile of overdue
    // ones. The onset channel has no schedule state of its own to reset
    // (independent of the Poisson one).
    if (Math.abs(songTime - this.lastSongTime) > SEEK_JUMP_SECONDS) {
      this.strikePool.clearAll();
      this.strikeTimeToNext = 0;
    }
    this.lastSongTime = songTime;

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

    // Bass onset detector (house recipe): a fast EMA of the bass band
    // chasing a slower EMA of itself — the gap crossing BASS_ONSET_THRESHOLD
    // is the onset. Cooldown-gated so a sustained loud passage fires once,
    // not every frame. Each onset both fires a strike AND kicks `this.tick`
    // (independent effects — see tick's own doc, it does not reuse
    // beatBonus).
    this.bassFast += (audio.bass - this.bassFast) * Math.min(1, dt * BASS_FAST_RATE);
    this.bassOnsetEma += (this.bassFast - this.bassOnsetEma) * Math.min(1, dt * BASS_ONSET_EMA_RATE);
    this.onsetCooldown = Math.max(0, this.onsetCooldown - dt);
    if (this.onsetCooldown <= 0 && this.bassFast - this.bassOnsetEma > BASS_ONSET_THRESHOLD) {
      this.onsetCooldown = BASS_ONSET_COOLDOWN;
      this.tick = 1;
      this.fireStrike(p);
    }
    this.tick *= Math.exp(-TICK_DECAY_RATE * dt);
    u.uTick.value = this.tick;

    // Poisson ambient strikes: an independent channel from the onset one
    // above, so the scene still punches without a mic. `?strike=always`
    // overrides the act's own strikeRate for debugging.
    const strikeRatePerMin = this.forceStrikeAlways ? 60 : p.strikeRate;
    if (strikeRatePerMin > 0) {
      this.strikeTimeToNext -= dt;
      while (this.strikeTimeToNext <= 0) {
        this.fireStrike(p);
        this.strikeTimeToNext += nextPoissonDelay(this.rand, strikeRatePerMin);
      }
    }

    this.ageStrikes(dt);
  }

  /**
   * Picks a random point inside the visible field rect (inverting the same
   * screen->field house formula the shader uses, for the CURRENT
   * uZoom/uPan/uCover) and rejection-samples up to STRIKE_PICK_TRIES times,
   * accepting the first candidate that lands comfortably on the LIVING side
   * of the front. The CPU estimate deliberately replicates ONLY the
   * noise-free part of sbSterility (phi_no_noise, no fbm wobble) — a strike
   * doesn't need pixel-perfect placement, just a safe margin
   * (STRIKE_LIVING_MARGIN) so it doesn't spawn straddling the real
   * (noise-wobbled) GPU boundary. Uses this.rMaxEff (computeRMaxEff's doc) —
   * the SAME per-seed R the shader itself uses — rather than a mirrored
   * global constant, so this estimate and the GPU's own boundary can never
   * disagree about where the front roughly is. Returns null after every try
   * fails — late acts are mostly sterile by then, so skipping the strike
   * entirely is the CORRECT behaviour, not a bug to work around.
   */
  private pickLivingPoint(): { x: number; y: number } | null {
    const u = this.material.uniforms;
    const cover = u.uCover.value as THREE.Vector2;
    const zoom = u.uZoom.value as number;
    const pan = u.uPan.value as THREE.Vector2;
    const pocket = u.uPocket.value as THREE.Vector2;
    const stretch = u.uStretch.value as THREE.Vector2;
    const sterile = u.uSterile.value as number;
    const R = this.rMaxEff * (1 - sterile);
    for (let i = 0; i < STRIKE_PICK_TRIES; i++) {
      const sx = this.rand();
      const sy = this.rand();
      const fx = (sx - 0.5) * cover.x / zoom + 0.5 + pan.x;
      const fy = (sy - 0.5) * cover.y / zoom + 0.5 + pan.y;
      const dx = (fx - pocket.x) * stretch.x;
      const dy = (fy - pocket.y) * stretch.y;
      const phiNoNoise = Math.hypot(dx, dy);
      if (phiNoNoise - R < -STRIKE_LIVING_MARGIN) return { x: fx, y: fy };
    }
    return null;
  }

  /**
   * Fires one swab strike: picks a visible living point (pickLivingPoint;
   * skips entirely on failure), activates a slot from the pool (xy/z/w =
   * uStrikeA, via SlotPool.fire()'s "steal the oldest" idiom), and bakes
   * uStrikeB's four fire-time constants — rMax, aspect, orientation angle,
   * and healRate — which then stay FIXED for that strike's whole lifetime
   * even if the current act's own strikeHeal changes later (so the act-4
   * healing-fails rule only ever affects strikes struck FROM that point on,
   * never retroactively scars an already-healing wound).
   */
  private fireStrike(p: ActParams) {
    const point = this.pickLivingPoint();
    if (!point) return;
    const idx = this.strikePool.fire();
    const a = this.strikePool.slots[idx];
    a.x = point.x;
    a.y = point.y;
    const rMax = p.strikeSize * (0.8 + this.rand() * 0.5);
    const aspect = 1.15 + this.rand() * 0.5;
    const angle = this.rand() * Math.PI * 2;
    const healRate = this.healOverride !== null ? this.healOverride : p.strikeHeal;
    this.strikeB[idx].set(rMax, aspect, angle, healRate);
  }

  /**
   * Ages every active strike slot (SlotPool.age with lifetime<=0: only the
   * clock advances, deactivation is entirely ours below — b2's ageLinks
   * idiom) and frees slots on one of two rules baked at fire time
   * (uStrikeB.w, healRate):
   *  - healRate > 0: mirrors the shader's OWN age->radius envelope in
   *    closed form (past STRIKE_SETTLE it's linear, so the radius hits
   *    exactly 0 at age = STRIKE_SETTLE + 1/healRate) and frees the slot the
   *    instant that happens — the GPU radius is already 0 there, so freeing
   *    is visually silent.
   *  - healRate === 0 (a failed strike — healing has permanently stopped):
   *    holds at full radius/opacity for STRIKE_FAIL_HOLD seconds, then fades
   *    `w` linearly 1->0 over the STRIKE_FAIL_FADE seconds before that (the
   *    shader scales its smax contribution by w — see sterileShader.ts's
   *    sbSterility doc), freeing outright at STRIKE_FAIL_HOLD.
   */
  private ageStrikes(dt: number) {
    this.strikePool.age(dt, 0);
    const slots = this.strikePool.slots;
    for (let i = 0; i < slots.length; i++) {
      const a = slots[i];
      if (a.w <= 0) continue;
      const healRate = this.strikeB[i].w;
      const age = a.z;
      if (healRate > 0) {
        const healedAge = STRIKE_SETTLE + 1 / healRate;
        if (age >= healedAge) a.w = 0;
      } else {
        const fadeStart = STRIKE_FAIL_HOLD - STRIKE_FAIL_FADE;
        if (age >= STRIKE_FAIL_HOLD) a.w = 0;
        else if (age >= fadeStart) a.w = Math.max(0, 1 - (age - fadeStart) / STRIKE_FAIL_FADE);
      }
    }
  }

  resize(w: number, h: number) {
    if (!this.material || w <= 0 || h <= 0) return;
    const aspect = Math.min(3.5, Math.max(0.28, w / h));
    // Keep the world square regardless of viewport aspect (b2's uCover idiom).
    if (aspect >= 1) this.cover.set(aspect, 1);
    else this.cover.set(1, 1 / aspect);
    (this.material.uniforms.uCover.value as THREE.Vector2).copy(this.cover);

    // rMaxEff depends on uCover (the visible field rect's corners), so it's
    // recomputed here every time cover changes — see computeRMaxEff's doc.
    this.rMaxEff = this.computeRMaxEff();
    this.material.uniforms.uRMax.value = this.rMaxEff;
  }

  /**
   * Per-seed replacement for the old global-worst-case R_MAX constant: the
   * max distance (phi, WITHOUT the front's noise wobble) from THIS play's
   * own uPocket/uStretch draw to any of the four corners of the act-1
   * camera's visible field rect — zoomAt(0) (=1.45, the opening act's
   * zoom), pan=(0,0) (uPan is always 0 this increment), the CURRENT
   * this.cover — times the wobble's exact analytic upper bound
   * (WOBBLE_MAX_MULT) and a small epsilon (R_MAX_EFF_EPS). Uploaded as
   * uRMax, this is the R the front starts at when uSterile=0 (see
   * sbSterility, sterileShader.ts): since it's derived to just clear every
   * visible corner's max POSSIBLE wobbled phi at t=0, sterile stays
   * invisible at the open BY CONSTRUCTION for every seed — the fix for the
   * old fixed worst-case R_MAX leaving most (non-worst-case) seeds with a
   * huge unused margin, which was hollowing out sterileAt's early acts for
   * most plays despite their retuned keys. Uses the same corner-distance
   * formula pickLivingPoint's own CPU S-estimate uses (via this.rMaxEff),
   * just evaluated at the four fixed corners here instead of a random
   * candidate point, so both sides of "where's the front" agree.
   */
  private computeRMaxEff(): number {
    const u = this.material.uniforms;
    const pocket = u.uPocket.value as THREE.Vector2;
    const stretch = u.uStretch.value as THREE.Vector2;
    const zoom = zoomAt(0);
    const ox = (0.5 * this.cover.x) / zoom;
    const oy = (0.5 * this.cover.y) / zoom;
    let maxPhi = 0;
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        const cx = 0.5 + sx * ox;
        const cy = 0.5 + sy * oy;
        const dx = (cx - pocket.x) * stretch.x;
        const dy = (cy - pocket.y) * stretch.y;
        const phi = Math.hypot(dx, dy);
        if (phi > maxPhi) maxPhi = phi;
      }
    }
    return maxPhi * WOBBLE_MAX_MULT * R_MAX_EFF_EPS;
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
