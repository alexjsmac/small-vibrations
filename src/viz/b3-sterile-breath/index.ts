import * as THREE from 'three';
import type { Viz, VizContext, AudioFrame, VizModule, VizPointerEvent } from '../types';
import { STERILE_VERT, buildSterileFragment, FRONT_NOISE_AMP } from './sterileShader';
import { paramsAt, sterileAt, zoomAt, arcAt, lifeClockAt, ACTS, type ActParams } from './sections';
import { mulberry32 } from '../random';
import { SlotPool } from './pools';
import { OnsetDetector } from '../lib/onset';
import { PoissonSchedule } from '../lib/poisson';

/** `?life=fast` multiplier on uLifeClock's advance (see update()'s doc). */
const LIFE_FAST_MUL = 12;

/** Slow-smoothed-bass -> breathing amplitude EMA rate (1/s), a1/a2/a3/b1/b2 idiom. */
const BASS_SLOW_RATE = 1.5;

/** uBreathPhase advance rate (cycles/s-ish; see sbClumpSd's breathing formula, sterileShader.ts). */
const BREATH_PHASE_RATE = 0.18;

/**
 * uGroundPhase advance rate (this increment, the living-side ground-churn
 * artist note) -- unlike uBreathPhase/uMotionPhase above, uGroundPhase is
 * NOT a CPU accumulator: it's derived directly as `songTime *
 * GROUND_PHASE_RATE` every frame in update(), the same "pure function of
 * songTime" precedent as finalEnvAt (module scope, below), so `?t=` deep
 * links reproduce the ground churn exactly rather than depending on how
 * long the viz has been running. Loop-wrap (songTime resetting to 0 at the
 * track's end) causes a one-frame phase jump, which is acceptable since the
 * whole world is reborn at the loop point anyway.
 */
const GROUND_PHASE_RATE = 0.035;

/** uFrontDrift advance rate (field-uv/s-ish, x-axis; y-axis runs at x0.83 — see update()'s doc). */
const FRONT_DRIFT_RATE = 0.008;

/** Fast-smoothed-highs EMA rate (1/s) feeding uGlint — quicker than BASS_SLOW_RATE so droplet glints track transients, not just sustained energy. */
const HIGH_FAST_RATE = 8;

/**
 * Bass onset detector (increment 4, house recipe; increment 11 fix; stage-1
 * lib extraction: now backed by `OnsetDetector` from `../lib/onset`, which
 * carries the full mechanism doc and postmortem — read it there for WHY a
 * fast EMA (BASS_FAST_RATE, tau ~0.125s) needs a reference EMA this much
 * slower (BASS_ONSET_EMA_RATE, tau ~4s) plus a relative margin, an absolute
 * floor, and a rising edge). This module only owns bassFast (BASS_FAST_RATE)
 * since it's onset-only here, unlike b2's shared bassE — see the lib's own
 * "why the caller owns the fast EMA" doc.
 *
 * Fires a swab strike AND kicks `this.tick` (see its own doc) — two
 * independent effects of the same onset, not the same scalar. `this.bassOnset
 * .update()` is called with `p.strikeRate` (see `OnsetDetector.update`'s
 * `ratePerMinute` doc): it both gates whether strikeRate===0 acts (0 and 6)
 * fire any onset strikes at all, AND re-arms the cooldown to
 * `rateGapSeconds(BASS_ONSET_COOLDOWN, p.strikeRate)` on a fire, so onset
 * TIMING snaps to real kicks while onset DENSITY still follows the act's arc.
 */
const BASS_FAST_RATE = 8;
const BASS_ONSET_EMA_RATE = 0.25;
const BASS_ONSET_REL_MARGIN = 0.22;
const BASS_ONSET_ABS_FLOOR = 0.06;
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
 * Condensation-bloom lifetime (s) — SlotPool(3) auto-deactivates via
 * `this.bloomPool.age(dt, BLOOM_LIFETIME)`; MUST mirror sterileShader.ts's
 * own BLOOM_LIFETIME exactly (the GPU's radius/intensity envelope is
 * derived from the same span, so the slot must never free before the GPU
 * curve has already faded to ~0).
 */
const BLOOM_LIFETIME = 2.5;

/**
 * Slow-bass threshold-crossing bloom trigger (index.ts's own `this.bassSlow`
 * EMA, the same one driving uBreath) — a simpler cousin of the strike
 * onset detector (BASS_ONSET_*, above): a level crossing with a cooldown,
 * not a fast/slow EMA gap, since blooms are the breath motif (sustained
 * swells), not a percussive hit.
 */
const BLOOM_ONSET_THRESHOLD = 0.45;
const BLOOM_ONSET_COOLDOWN = 1.2;

/** `?bloom=always` forces the ambient Poisson bloom rate to this (events/min), same debug idiom as `?strike=always`. */
const BLOOM_DEBUG_RATE = 30;

/**
 * Bloom placement bias (fireBloom -> pickLivingPoint(true)): the random
 * screen-uv offset from centre is scaled by this before mapping to
 * field-uv, so blooms land inside the frame's centre third rather than
 * anywhere in the visible field — they read as THE subject when they fire.
 */
const BLOOM_CENTER_BIAS = 0.6;

/**
 * Poke (rebloom) lifecycle spans (s): 0->POKE_R_MAX ease-out grow over
 * POKE_GROW, hold POKE_HOLD, then eased back to 0 over POKE_RESCRUB.
 * POKE_LIFETIME (their sum) MUST mirror sterileShader.ts's own
 * POKE_GROW/POKE_HOLD_END/POKE_RESCRUB_END spans exactly — the CPU pool
 * (SlotPool.age's fixed-lifetime path) deactivates the slot the instant the
 * GPU radius curve has eased back to exactly 0.
 */
const POKE_GROW = 0.3;
const POKE_HOLD = 4.0;
const POKE_RESCRUB = 3.0;
const POKE_LIFETIME = POKE_GROW + POKE_HOLD + POKE_RESCRUB; // 7.3

/** Small uTick kick on every poke (vs. the bass onset's full 1) — the SAME decay scalar (TICK_DECAY_RATE) drives both, so a poke's rim-pop reads as a quieter cousin of a strike's. `Math.max`'d against the current tick rather than overwritten, so a poke landing during a bass onset never dims an already-hotter tick. */
const POKE_TICK_KICK = 0.6;

/** Poke ripple lifetime (s) — SlotPool(4) auto-deactivates via `this.ripplePool.age(dt, RIPPLE_LIFETIME)`; MUST mirror sterileShader.ts's own RIPPLE_LIFETIME (radius/alpha envelope span). */
const RIPPLE_LIFETIME = 1.2;

/**
 * Drag-pan momentum constants — the verbatim a1/a2/a3/b1/b2 house idiom
 * (BRIEFING.md's Interaction section), replicated exactly rather than
 * re-derived: EMA the instantaneous velocity while held, integrate with
 * exponential friction after release, snap to 0 below the stop speed.
 */
const VEL_EMA_RATE = 10;
const VEL_MAX = 1.5;
const MOMENTUM_FRICTION = 2.5;
const MOMENTUM_STOP_SPEED = 0.0005;

/**
 * Per-axis pan clamp (field-uv) — keeps the pocket region draggable but
 * never fully offscreen. b2 uses a circular MAX_PAN radius instead; b3's
 * off-centre pocket + anisotropic uStretch make a simple per-axis box bound
 * the better fit (the task's own spec), applied every frame after momentum
 * integration (zeroing velocity on the clamped axis so momentum doesn't keep
 * fighting the wall), mirroring b2's clamp-after-integrate placement.
 */
const PAN_CLAMP = 0.35;

/** Act index (paramsAt's SectionState.actIndex) at which a poke births a condensation bloom instead of a poke-carve — 'last-breath' (ACTS[6] in sections.ts): the world is gone by then, only breath remains. */
const BLOOM_ONLY_ACT_INDEX = 6;

/**
 * Ambient camera drift (increment 7): when the pointer is neither held nor
 * still carrying release momentum, `this.pan` wanders slowly at up to
 * `p.driftSpeed * DRIFT_SPEED_SCALE` field-uv/s, in a direction that itself
 * slowly rotates (`this.driftAngle`, seeded once per play). driftSpeed=0
 * acts (remission, sterile, last-breath — sections.ts's ACTS[3]/[5]/[6])
 * go dead still for free: the formula scales by p.driftSpeed, so 0 is an
 * exact no-op there — no special-casing, and user-thrown momentum (a
 * SEPARATE branch below) still decays naturally regardless of the current
 * act's driftSpeed.
 */
const DRIFT_SPEED_SCALE = 0.0035;
const DRIFT_ANGLE_RATE = 0.05;

/** Breathing zoom (increment 7): a subtle inhale/exhale scale layered on top of zoomAt's own envelope, `uZoom *= 1 - BREATH_ZOOM_AMOUNT * uBreath`. */
const BREATH_ZOOM_AMOUNT = 0.012;

/**
 * Act-4 ('the-purge') camera shake (increment 7): `this.shake` is a NEW
 * decay scalar (exp(-SHAKE_DECAY_RATE*dt) per frame), kicked on every
 * strike fire (any channel — onset, ambient Poisson, or the 144s scripted
 * peak strike) WHILE the current act is the purge only (see fireStrike's
 * doc). Applied as a small pan JITTER on a SEPARATE uPan-bound Vector2
 * (`this.panDisplay`) written fresh every frame — never mutated into
 * `this.pan` itself, which stays the clean, un-jittered camera position
 * pointer()/pickLivingPoint reason about.
 */
const SHAKE_DECAY_RATE = 6;
const SHAKE_KICK_MULT = 0.8;
const SHAKE_JITTER_AMP = 0.006;
const SHAKE_ACT_INDEX = 4;

/**
 * Scripted hits (increment 7, edge-triggered on the boundary crossing — the
 * b2 idiom: `lastSongTime < T && songTime >= T && songTime - lastSongTime <
 * SCRIPTED_HIT_GUARD` rejects a `?t=` seek or a track loop as a false
 * trigger, since either produces a jump far bigger than one real frame's
 * dt could ever be).
 */
const PURGE_TIME = 140;
const PEAK_STRIKE_TIME = 144;
const STEP_TIMES: readonly number[] = [168, 174, 180];
const LAST_POCKET_TIME = 184;
const SCRIPTED_HIT_GUARD = 0.5;

/** uFlash decay scalar (1/s, index.ts) and per-hit kick sizes (increment 7) — feeds sterileShader.ts's uFlash (scrub-line brightness lift + a faint whole-frame lift, both post-grade). Math.max'd at each kick (never overwritten) so a closely-following smaller kick can't dim an already-hot flash. */
const FLASH_DECAY_RATE = 3.4;
const FLASH_KICK_PURGE = 1.0;
const FLASH_KICK_PEAK_STRIKE = 0.7;
const FLASH_KICK_STEP = 0.45;
const FLASH_KICK_LAST_POCKET = 0.6;

/** The 144s scripted strike (increment 7): oversized vs. the act's own strikeSize and centre-biased (tighter than a bloom's own BLOOM_CENTER_BIAS) so it lands somewhere unmissable — see pickLivingPoint's numeric centerBias doc. */
const PEAK_STRIKE_SIZE_MULT = 1.6;
const PEAK_STRIKE_CENTER_BIAS = 0.5;

/**
 * Crackle (increment 7, the high-band event; increment 11 fix, same defect
 * and same cure as the bass onset detector above, also now an
 * `OnsetDetector` from `../lib/onset`) — chases `this.highFast` (already
 * EMA'd at HIGH_FAST_RATE for uGlint, so no second fast-highs EMA is
 * needed) against its OWN reference EMA, entirely inside `this.crackleOnset`.
 * The high band sits at a lower absolute level than bass in practice, so
 * its margin/floor are tuned separately below. `this.crackleOnset.update()`
 * is called with p.crackleRate — same enable-gate + rate-derived cooldown
 * idiom as the bass detector, see OnsetDetector.update's doc.
 */
const CRACKLE_ONSET_EMA_RATE = 0.25;
const CRACKLE_ONSET_REL_MARGIN = 0.16;
const CRACKLE_ONSET_ABS_FLOOR = 0.05;
const CRACKLE_ONSET_COOLDOWN = 0.15;
/** `this.crackle`'s exponential decay rate (1/s) feeding uCrackle. */
const CRACKLE_DECAY_RATE = 7;
/** `?crackle=always` debug affordance: a plain repeating fixed-interval kick (not a Poisson rate override like `?strike=always` — crackle's ambient rate is already `p.crackleRate * (0.5 + energy)`, a formula rather than one constant, so mirroring that idiom doesn't fit as cleanly here). */
const CRACKLE_DEBUG_INTERVAL = 0.5;

/**
 * Final condensation-to-seed sequence (increment 8, the album's closing
 * image): scripted boundaries in song-seconds driving `finalEnvAt` (below).
 * OFF before FINAL_SWELL_START, SWELL until FINAL_CONDENSE_START, CONDENSE
 * until FINAL_SEED_START, SEED until FINAL_GONE_START, GONE from there to
 * the album's true silence at 200.042s (sections.ts's CUES) — the record
 * ends on the empty blank.
 */
const FINAL_SWELL_START = 188;
const FINAL_CONDENSE_START = 191;
const FINAL_SEED_START = 194;
const FINAL_GONE_START = 199;

/** Plain smoothstep ease-in-out on [0,1] — finalEnvAt's own easing for the SWELL/CONDENSE phases' uFinalT (kept local rather than importing sections.ts's own, unexported `smoothstep01`). */
function finalPhaseEase(x: number): number {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
}

/**
 * Song-time (seconds) -> the final condensation-to-seed sequence's current
 * phase/progress — a PURE function of songTime (unlike increment 7's
 * edge-triggered scripted hits above), so it renders correctly from ANY
 * `?t=` deep link into act 6, not just from continuous playback out of the
 * track's start. Four phases (matches uFinalPhase's shader-side convention:
 * 0 off/gone, 1 swell, 2 condense, 3 seed):
 *  - OFF (< FINAL_SWELL_START): phase 0, nothing drawn.
 *  - SWELL (FINAL_SWELL_START..FINAL_CONDENSE_START): phase 1, t eased
 *    (ease-in-out) 0->1 — the condensation bloom grows in.
 *  - CONDENSE (FINAL_CONDENSE_START..FINAL_SEED_START): phase 2, t eased
 *    0->1 — the bloom's radius collapses toward the seed point.
 *  - SEED (FINAL_SEED_START..FINAL_GONE_START): phase 3, t LINEAR 0->1 and
 *    seedFade = 1 - t — the seed mote holds, then fades.
 *  - GONE (>= FINAL_GONE_START): phase 0 again — same as OFF (the shader's
 *    `uFinalPhase > 0.5` gate skips both identically) — seedFade 0.
 * t/seedFade are inert defaults (0/1) for OFF, since the shader never reads
 * either while phase is 0. Eased (not raw linear) t for SWELL/CONDENSE
 * gives every phase boundary a zero-velocity RADIUS handoff (ease-in-out is
 * 0 at both ends) so SWELL->CONDENSE and CONDENSE->SEED never pop in size —
 * CONDENSE->SEED still deliberately swaps the cool mist tint for the warm
 * seed-mote colours right at that handoff (sterileShader.ts's SEED branch),
 * which is the intended reveal, not a continuity bug.
 */
function finalEnvAt(songTime: number): { phase: number; t: number; seedFade: number } {
  if (songTime < FINAL_SWELL_START) return { phase: 0, t: 0, seedFade: 1 };
  if (songTime < FINAL_CONDENSE_START) {
    const raw = (songTime - FINAL_SWELL_START) / (FINAL_CONDENSE_START - FINAL_SWELL_START);
    return { phase: 1, t: finalPhaseEase(raw), seedFade: 1 };
  }
  if (songTime < FINAL_SEED_START) {
    const raw = (songTime - FINAL_CONDENSE_START) / (FINAL_SEED_START - FINAL_CONDENSE_START);
    return { phase: 2, t: finalPhaseEase(raw), seedFade: 1 };
  }
  if (songTime < FINAL_GONE_START) {
    const raw = (songTime - FINAL_SEED_START) / (FINAL_GONE_START - FINAL_SEED_START);
    return { phase: 3, t: raw, seedFade: 1 - raw };
  }
  return { phase: 0, t: 0, seedFade: 0 };
}

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
 * (`this.bassFast` + `this.bassOnset`, house recipe, `../lib/onset`) for beat-locked hits
 * plus an independent Poisson process (`nextPoissonDelay`, pools.ts) for
 * ambient strikes so the scene still punches without a mic. Both channels
 * share one `SlotPool(STRIKE_SLOTS)` (`this.strikePool`, bound as
 * `uStrikeA`) plus a hand-rolled parallel `THREE.Vector4[]` for the values
 * baked once at fire time (`this.strikeB`, bound as `uStrikeB`) — see
 * `fireStrike`'s doc for the CPU living-point rejection sampler and
 * `ageStrikes`'s doc for the heal/fail/free lifecycle. `this.tick` is a NEW,
 * independent decay scalar (kicked to 1 on every bass onset, `uTick`) for
 * the shader's young-strike rim pop — it does NOT reuse `beatBonus` below.
 *
 * Increment 5 lands the two other event systems and pointer interaction:
 * condensation BLOOMS — the track's recurring breath motif — fire on a
 * slow-bass threshold crossing (`this.bassSlow` vs. BLOOM_ONSET_THRESHOLD,
 * a simpler cousin of the strike onset detector) plus an independent
 * Poisson process, both routed through `fireBloom` (center-biased via
 * `pickLivingPoint(true)` so a bloom reads as the frame's subject); one
 * `SlotPool(BLOOM_SLOTS)` (`this.bloomPool`, bound as `uBloom`). Pointer
 * POKES — a rebloom carving a living patch back into scrubbed ground — fire
 * unconditionally on `pointer()`'s 'down' (no drag threshold; a pure tap
 * fires no 'move', so pan/momentum never trigger, the a1/b2 disambiguation-
 * for-free idiom); one `SlotPool(POKE_SLOTS)` (`this.pokePool`, bound as
 * `uPoke`) with a FIXED grow/hold/re-scrub envelope (unlike a strike's
 * per-instance heal rate), so `ageStrikes`'s hand-rolled heal/fail logic has
 * no poke equivalent — `this.pokePool.age(dt, POKE_LIFETIME)` alone frees
 * the slot. Every poke also fires a near-white RIPPLE ring (house idiom,
 * `this.ripplePool`/`uRipple`) and kicks `this.tick` by POKE_TICK_KICK (the
 * same decay scalar strikes use, so a poke's rim pop reads as a quieter
 * cousin). In act 6 ('last-breath', BLOOM_ONLY_ACT_INDEX) a tap fires a
 * bloom (`fireBloomAt`, the exact tap point, no living-search/centre-bias)
 * INSTEAD of a poke-carve — the world is gone, only breath remains. Drag
 * pans `this.pan` (now a live field, not the fixed (0,0) increment 4's docs
 * described) with the verbatim a1/a2/a3/b1/b2 momentum idiom, clamped per-
 * axis to ±PAN_CLAMP.
 *
 * Increment 6 lands winner-clump ghost stamps: rare, small, low-contrast
 * ink marks inside a clump's own interior, hinting at the other four
 * tracks' visual motifs (comb cell / vein filament / specimen silhouette /
 * falling chain — a2/b1/b2/a3's echoes respectively) before that clump gets
 * scrubbed away. All the actual mechanism — winner-clump tracking, the
 * per-epoch hosting hash, the four motif SDFs — lives in sterileShader.ts
 * (see its own top doc); index.ts's only job is wiring `uGhostAmp` from
 * `ActParams.ghostAmp` every frame and parsing the two new debug params
 * below. The scripted camera remains for a later increment on top of this.
 *
 * Debug: `?solo=<0-6>` selects a solo layer (0 = full composed scene,
 * default; `?solo=biomass` -> mode 1, the biomass field alone over a flat
 * mid-gray background across the whole frame, ignoring S entirely; `?solo=
 * front` -> mode 2, the S-field diagnostic (living side dark gray, sterile
 * side light gray, scrub line + glints at full strength, no biomass);
 * `?solo=events` -> mode 3, uSterile pinned to 0 here so ONLY strikes carve
 * — neutral mid-gray field, no biomass, no front, strike interiors +
 * scrub-line rims + tick pops at full visibility; `?solo=ghosts` -> mode 4
 * (NEW this increment), biomass alone over a flat mid-gray ground (same
 * "ignore S" convention as mode 1) with every clump forced to host a stamp
 * every epoch, drawn at full alpha in bright cream instead of the composed
 * scene's faint ink mix — all four motifs visible immediately on load; 5
 * sterile forces the real sterile-side treatment full-screen; `?solo=ground`
 * -> mode 6 (NEW this increment, the artist's "more interesting dark
 * gradients bubbling behind" note), the living-side ground-churn diagnostic —
 * `sbDeepGround` alone, full-frame, ignoring biomass and the sterile side
 * entirely, same "ignore everything else" convention as modes 1/4/5), `?life=fast`
 * multiplies the lifecycle clock's advance by LIFE_FAST_MUL (12) so clump
 * birth/death is visible in seconds, `?breath=<0..1>` pins uBreath to a
 * constant (bypassing audio), `?sterile=<0..1>` pins uSterile to a constant
 * (bypassing sterileAt's envelope), `?glint=<0..1>` pins uGlint to a
 * constant (bypassing audio), `?strike=always` forces the ambient Poisson
 * strike rate to 60/min regardless of act, `?heal=off`/`?heal=on` overrides
 * EVERY newly-fired strike's baked healRate to 0 / 0.22 regardless of act
 * (existing strikes keep whatever they were baked with), `?bloom=always`
 * forces the ambient Poisson bloom rate to BLOOM_DEBUG_RATE (30/min)
 * regardless of act, `?ghost=always` (NEW this increment) forces every
 * winner clump to host a ghost stamp every epoch (sterileShader.ts's
 * uGhostForce) and uGhostAmp to 1.0 regardless of act — all for
 * deterministic screenshots — `?crack=<mult>` (increment 10) multiplies
 * every NEWLY-fired strike's size (clamped [0.25, 6], stacking with the
 * 144s scripted peak strike's own 1.6x override) so a single fracture can
 * be inspected up close — plus the standard `?t=`, `?q=`, `?debug=1`
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

  /** Drawing-buffer pixel dimensions (post dpr/quality-scale — renderer.domElement.width/height, NOT the CSS w/h resize() receives), cached at resize() — feeds uFieldPxScale's per-frame recompute in update() (increment 9, see sterileShader.ts's sbAA() doc). */
  private canvasPxW = 1;
  private canvasPxH = 1;

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

  /** `?ghost=always` (increment 6) — forces sterileShader.ts's uGhostForce uniform true (every winner clump hosts a stamp every epoch) AND uGhostAmp to 1.0 in update(), regardless of the current act's ghostAmp. */
  private forceGhostAlways = false;

  /** Fast-smoothed bass (BASS_FAST_RATE), onset-only here (unlike b2's shared bassE) — chased by `this.bassOnset`'s own internal reference EMA (see the BASS_FAST_RATE constant's doc). */
  private bassFast = 0;
  /** Bass onset detector (stage-1 lib extraction, `../lib/onset`) — owns the reference EMA + cooldown; see BASS_FAST_RATE's doc for the call-site wiring. */
  private bassOnset = new OnsetDetector({
    refRate: BASS_ONSET_EMA_RATE,
    relMargin: BASS_ONSET_REL_MARGIN,
    absFloor: BASS_ONSET_ABS_FLOOR,
    cooldown: BASS_ONSET_COOLDOWN,
  });
  /** Bass-onset decay scalar (tick *= exp(-TICK_DECAY_RATE*dt) per frame, kicked to 1 on every onset) feeding uTick — independent of beatBonus, see its own doc above. */
  private tick = 0;

  /** Ambient Poisson strike schedule (stage-1 lib extraction, `../lib/poisson`) — independent of the onset channel's cooldown. */
  private strikeSchedule = new PoissonSchedule();

  /** Last frame's song time, used only to detect a `?t=` seek or a track loop (see update()'s doc) — NOT the fallback clock itself, VizHost owns that. */
  private lastSongTime = 0;

  /** Per-seed S-field radius at uSterile=0 (uRMax's CPU-side source of truth) — computeRMaxEff's doc; recomputed in resize() since it depends on uCover. Also feeds pickLivingPoint's own CPU S-estimate, so both sides of the front agree on where it is. */
  private rMaxEff = 0;

  /** Condensation-bloom slot pool (increment 5): `slots` IS uBloom (xy/z/w set here, bound by reference) — see fireBloom/fireBloomAt's docs. */
  private bloomPool!: SlotPool;
  /** Seconds remaining before another slow-bass-threshold-crossing bloom may fire (BLOOM_ONSET_COOLDOWN idiom). */
  private bloomCooldown = 0;
  /**
   * Ambient Poisson bloom schedule (stage-2 fix, `../lib/poisson`) —
   * independent of the onset channel's cooldown. This is the latent bug
   * poisson.ts's own MIGRATION NOTE flagged and deliberately left alone
   * during the behaviour-identical stage-1 extraction: `bloomRate` cycles
   * 10 -> 0 -> 0 -> 4 -> 0 -> 0 -> 1.5 across the act table (the breath
   * motif seeded in act 0, returning in the remission (act 3) and closing
   * the record in act 6), and the old bare `nextPoissonDelay` countdown
   * (pools.ts) had no schedule-rate tracking at all, so it never got the
   * rescale fix strikeTimeToNext/crackleTimeToNext did. Two rising-through-
   * epsilon crossings (act 2->3, act 5->6) each baked a multi-hour delay on
   * arrival — the ambient channel then only ever fired in act 0, silencing
   * both of the motif's returns even though the closing bloom-to-seed image
   * itself stayed safe (a separate scripted sequence, `finalEnvAt`, not
   * this channel). `reactivateDueNow: true` because bloomRate genuinely
   * cycles off and on more than once (unlike strike/crackle, which only
   * ever go off once at the very end — see `PoissonSchedule`'s own doc for
   * why that option is opt-in). No `epsilonFloor` — `nextPoissonDelay`
   * already used `1 - rand()`, `PoissonSchedule`'s own default derivation.
   */
  private bloomSchedule = new PoissonSchedule({ reactivateDueNow: true });
  /** `?bloom=always` — forces the ambient Poisson bloom rate to BLOOM_DEBUG_RATE regardless of the current act. */
  private forceBloomAlways = false;

  /** Pointer-poke (rebloom) slot pool (increment 5): `slots` IS uPoke (xy/z/w set here, bound by reference) — see firePoke's doc. Fixed grow/hold/re-scrub envelope (sterileShader.ts's sbPokeRadius), so unlike strikes no parallel baked-constants array is needed. */
  private pokePool!: SlotPool;

  /** Poke-ripple slot pool (increment 5): `slots` IS uRipple (xy/z/w set here, bound by reference) — see fireRipple's doc. */
  private ripplePool!: SlotPool;

  /**
   * Field-space pan offset — pointer-drag + ambient drift (increments 5/7),
   * the a1/a2/a3/b1/b2 momentum idiom. Increment 7: no longer bound
   * directly as uPan's uniform value — `this.panDisplay` (below) is, so
   * act-4 camera shake can add a jitter on top without mutating this
   * "true" pan (which pointer()/pickLivingPoint still reason about
   * directly). Clamped per-axis to ±PAN_CLAMP (update()'s momentum block).
   */
  private pan = new THREE.Vector2(0, 0);
  /** uPan's actual bound uniform value (increment 7) — `this.pan` plus the act-4 shake jitter, written fresh every frame in update() (never accumulated). See SHAKE_* constants' doc. */
  private panDisplay = new THREE.Vector2(0, 0);
  /** Ambient-drift direction phase (increment 7), seeded once per play in init() via this.rand; advances at DRIFT_ANGLE_RATE while the camera is idle (update()'s camera-choreography block). */
  private driftAngle = 0;
  /** True while the primary pointer is down (pointer()'s 'down'/'up'/'cancel'). */
  private held = false;
  /** This frame's accumulated drag delta (uv), consumed + zeroed by update()'s velocity EMA every frame. */
  private dragDx = 0;
  private dragDy = 0;
  /** EMA'd drag velocity (uv/s) while held; integrates `pan` with exponential friction after release (update()'s momentum block). */
  private velX = 0;
  private velY = 0;

  /** Act-4 camera-shake decay scalar (increment 7) — see SHAKE_* constants' doc; kicked in fireStrike, decayed + consumed (as a uPan jitter) in update(). */
  private shake = 0;

  /** uFlash decay scalar (increment 7, scripted hits) — see FLASH_* constants' doc. */
  private flash = 0;

  /** uCrackle decay scalar (increment 7, the high-band event) — kicked to 1 in fireCrackle, decays exp(-CRACKLE_DECAY_RATE*dt). */
  private crackle = 0;
  /** Plain incrementing counter (increment 7) feeding uCrackleSeed (cast to float) — bumped on every fireCrackle so the shader's spark-cell hash re-rolls a fresh pattern per event. */
  private crackleSeed = 0;
  /** Crackle onset detector (stage-1 lib extraction, `../lib/onset`) — owns its own reference EMA + cooldown, chasing `this.highFast` (already EMA'd for uGlint, see the CRACKLE_ONSET_* constants' doc). */
  private crackleOnset = new OnsetDetector({
    refRate: CRACKLE_ONSET_EMA_RATE,
    relMargin: CRACKLE_ONSET_REL_MARGIN,
    absFloor: CRACKLE_ONSET_ABS_FLOOR,
    cooldown: CRACKLE_ONSET_COOLDOWN,
  });
  /** Ambient Poisson crackle schedule (stage-1 lib extraction, `../lib/poisson`) — independent of the onset channel's cooldown, same shape as strikeSchedule. */
  private crackleSchedule = new PoissonSchedule();
  /** `?crackle=always` — forces a repeating synthetic crackle every CRACKLE_DEBUG_INTERVAL seconds regardless of act/audio. */
  private forceCrackleAlways = false;
  /** `?crackle=always` debug affordance timer (seconds to next forced crackle). */
  private crackleDebugTimer = 0;

  /** `?seedpt=always` (increment 8) — forces the final condensation sequence's SEED phase (uFinalPhase=3, t=0, uSeedFade=1) regardless of songTime, so the closing seed-point image is screenshot-able from any deep link without waiting for the real 194s+ window. */
  private forceSeedPointAlways = false;

  /** `?crack=<mult>` (increment 10) — a multiplier (clamped [0.25, 6]) on every NEWLY-fired strike's rMax (applied in fireStrike via sizeMult), so a single big fracture can be inspected up close. Default 1 (no override); existing strikes keep whatever size they were baked with. */
  private crackMult = 1;

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
    } else if (soloParam === 'ghosts') {
      soloMode = 4;
    } else if (soloParam === 'ground') {
      soloMode = 6;
    } else {
      const parsedSolo = soloParam !== null ? parseInt(soloParam, 10) : NaN;
      soloMode = Number.isFinite(parsedSolo) ? parsedSolo : 0;
    }
    this.soloMode = soloMode;
    this.forceLifeFast = params.get('life') === 'fast';
    this.forceStrikeAlways = params.get('strike') === 'always';
    this.forceBloomAlways = params.get('bloom') === 'always';
    // `?ghost=always` (increment 6): forces sterileShader.ts's per-epoch
    // ghost-hosting hash check to always-true (uGhostForce) AND uGhostAmp to
    // 1.0 below (update()) regardless of the current act's ghostAmp — the
    // same "deterministic for screenshots" idiom as forceStrikeAlways/
    // forceBloomAlways above.
    this.forceGhostAlways = params.get('ghost') === 'always';
    // `?crackle=always` (increment 7) — see forceCrackleAlways's own doc.
    this.forceCrackleAlways = params.get('crackle') === 'always';
    // `?seedpt=always` (increment 8) — see forceSeedPointAlways's own doc.
    this.forceSeedPointAlways = params.get('seedpt') === 'always';
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
    // `?crack=<mult>` (increment 10) — see crackMult's own doc.
    const crackParam = params.get('crack');
    if (crackParam !== null) {
      const v = parseFloat(crackParam);
      if (!Number.isNaN(v)) this.crackMult = Math.min(6, Math.max(0.25, v));
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

    // Ambient drift's rotating direction phase (increment 7) — seeded once
    // per play so different plays wander in different starting directions.
    this.driftAngle = this.rand() * Math.PI * 2;

    // uFinalPos (increment 8): the final condensation-to-seed sequence's
    // fixed landing point — a small, seeded jitter (+-0.06 field-uv per
    // axis) off frame centre, drawn once per play so it's deterministic
    // across every phase (swell/condense/seed all converge on the exact
    // same spot, per the increment's spec).
    const finalPos = new THREE.Vector2(
      0.5 + (this.rand() - 0.5) * 0.12,
      0.5 + (this.rand() - 0.5) * 0.12,
    );

    // Swab-strike pool (increment 4): sized to match the SAME strikeSlots
    // budget passed to buildSterileFragment below (8 Full / 6 Lite) — the
    // array lengths must agree or the uStrikeA/uStrikeB uniform arrays
    // won't line up with the shader's compile-time STRIKE_SLOTS.
    const strikeSlots = this.full ? 8 : 6;
    this.strikePool = new SlotPool(strikeSlots);
    for (let i = 0; i < strikeSlots; i++) this.strikeB.push(new THREE.Vector4(0, 0, 0, 0));

    // Bloom/poke/ripple pools (increment 5): sized to match the SAME
    // bloomSlots/pokeSlots/rippleSlots budgets passed to buildSterileFragment
    // below — same array-length-must-agree rule as strikeSlots above. No
    // secondary baked-constants array needed for any of the three (unlike
    // strikes' uStrikeB): bloom's amplitude rides the shared uBloomAmp
    // uniform, poke's envelope is a fixed shader-side curve, and ripple has
    // no per-instance parameters at all.
    const bloomSlots = 3;
    const pokeSlots = 4;
    const rippleSlots = 4;
    this.bloomPool = new SlotPool(bloomSlots);
    this.pokePool = new SlotPool(pokeSlots);
    this.ripplePool = new SlotPool(rippleSlots);

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this.material = new THREE.ShaderMaterial({
      vertexShader: STERILE_VERT,
      fragmentShader: buildSterileFragment({
        strikeSlots,
        bloomSlots,
        pokeSlots,
        rippleSlots,
        lobes: this.full ? 5 : 3,
        fbmOct: this.full ? 3 : 2,
        // Full-only film grain (increment 7) — see SterileShaderConfig's own doc.
        grain: this.full,
        // Fracture splinter count (increment 10) — same Full/Lite split idiom as lobes/fbmOct above.
        fissures: this.full ? 4 : 3,
      }),
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uCover: { value: new THREE.Vector2(1, 1) },
        uZoom: { value: 1 },
        // Increment 9: field-uv units per screen pixel THIS frame — analytic
        // AA replacement for fwidth(), recomputed every frame in update()
        // (uZoom itself moves every frame; see sterileShader.ts's sbAA() doc).
        uFieldPxScale: { value: 0 },
        // uPan is bound to panDisplay (increment 7), NOT this.pan directly —
        // see panDisplay's own doc (act-4 shake jitter without mutating the
        // "true" pan pointer()/pickLivingPoint reason about).
        uPan: { value: this.panDisplay },
        uTime: { value: 0 },
        uSterile: { value: 0 },
        uSoloMode: { value: soloMode },
        uLifeClock: { value: 0 },
        uPresence: { value: 0 },
        uBreath: { value: 0 },
        uBreathPhase: { value: 0 },
        uMotionPhase: { value: 0 },
        // This increment: living-side ground-churn phase -- see
        // GROUND_PHASE_RATE's own doc (module scope, above) for why this is
        // derived fresh from songTime every frame rather than accumulated.
        uGroundPhase: { value: 0 },
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
        uBloom: { value: this.bloomPool.slots },
        uBloomAmp: { value: 0 },
        uPoke: { value: this.pokePool.slots },
        uRipple: { value: this.ripplePool.slots },
        // Winner-clump ghost stamps (increment 6). uGhostAmp is set every
        // frame in update() (ActParams.ghostAmp, or 1.0 under
        // forceGhostAlways); uGhostForce is set once here since
        // forceGhostAlways never changes after init()'s URL parse.
        uGhostAmp: { value: 0 },
        uGhostForce: { value: this.forceGhostAlways ? 1 : 0 },
        // Increment 7: act discipline / camera / scripted hits / crackle /
        // grade — see this class's own top doc addendum and each field's
        // private-property doc for the full mechanism.
        uEnergy: { value: 0 },
        uGrade: { value: 0 },
        uVignette: { value: 0 },
        uFlash: { value: 0 },
        uCrackle: { value: 0 },
        uCrackleSeed: { value: 0 },
        // Increment 8: the final condensation-to-seed sequence (the album's
        // closing image) — see finalEnvAt's own doc (module scope, above)
        // for the phase/progress mechanism; uFinalPos is the fixed seeded
        // landing point computed just above, constant for the whole play.
        uFinalPhase: { value: 0 },
        uFinalT: { value: 0 },
        uSeedFade: { value: 0 },
        uFinalPos: { value: finalPos },
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

    // Act-hold discipline (increment 7, the b2 crossfade-leak fix): acts 3
    // (remission) and 4 (purge) use the PURE act object so neither leaks
    // into its neighbours through the 6s crossfade — remission's restraint
    // must never be softened by losing-ground's still-elevated rates
    // bleeding in early, and the purge's album-max intensity must land as a
    // genuine discrete jump, not a fade (ARC.md's "discrete state changes,
    // not crossfades" rule for the biggest hits). Every other act keeps the
    // house 6s crossfade. this.section still holds the FULL SectionState
    // (actIndex/localT/blend all correct either way, only .params differs)
    // for pointer()'s act-6 check and fireStrike's act-4 shake check below.
    const sec = paramsAt(songTime);
    const p = sec.actIndex === 3 || sec.actIndex === 4 ? ACTS[sec.actIndex] : sec.params;
    this.section = sec;

    // uEnergy (increment 7): arcAt's continuous 0..1 energy envelope —
    // exposure lift (sterileShader.ts main()) and the crackle Poisson
    // channel's rate multiplier below both ride this SAME read-don't-hold
    // local so they can never disagree about "now". uGrade/uVignette ride
    // ActParams.grade/vignette straight through (act-held where applicable,
    // via `p` above).
    const energy = arcAt(songTime);
    u.uEnergy.value = energy;
    u.uGrade.value = p.grade;
    u.uVignette.value = p.vignette;

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
      // Increment 11: PoissonSchedule.reset() zeroes both the countdown and
      // the schedule-rate, so the post-jump "due now" fire doesn't get
      // rescaled against a stale pre-jump rate on its very first frame.
      this.strikeSchedule.reset();
      // Increment 5: the bloom/poke/ripple pools and the bloom Poisson
      // schedule are equally stale across a seek/loop — same "due now" reset
      // idiom as the strike pool above. Stage 2: bloomSchedule.reset() (like
      // strikeSchedule's) zeroes both the countdown and the schedule-rate,
      // so the post-jump "due now" fire doesn't get rescaled against a
      // stale pre-jump rate on its very first frame.
      this.bloomPool.clearAll();
      this.bloomSchedule.reset();
      this.pokePool.clearAll();
      this.ripplePool.clearAll();
      // Increment 7: the crackle Poisson schedule is equally stale.
      this.crackleSchedule.reset();
    }

    // Scripted hits (increment 7, edge-triggered on the boundary crossing —
    // the b2 idiom: `lastSongTime < T && songTime >= T && songTime -
    // lastSongTime < SCRIPTED_HIT_GUARD` rejects a `?t=` seek or a track
    // loop as a false trigger, since either produces a jump far bigger than
    // one real frame's dt could ever be). Checked against this.lastSongTime
    // BEFORE it's overwritten below, same as the seek-jump reset just above.
    if (
      this.lastSongTime < PURGE_TIME &&
      songTime >= PURGE_TIME &&
      songTime - this.lastSongTime < SCRIPTED_HIT_GUARD
    ) {
      this.flash = Math.max(this.flash, FLASH_KICK_PURGE);
    }
    if (
      this.lastSongTime < PEAK_STRIKE_TIME &&
      songTime >= PEAK_STRIKE_TIME &&
      songTime - this.lastSongTime < SCRIPTED_HIT_GUARD
    ) {
      // ONE scripted strike, oversized and centre-biased so it's
      // unmistakably the album-max hit, healRate forced to 0 regardless of
      // act (the purge's own rule anyway, but pinned explicitly so this one
      // strike can never NOT scar even under `?heal=on`).
      this.fireStrike(p, PEAK_STRIKE_SIZE_MULT, PEAK_STRIKE_CENTER_BIAS, true);
      this.flash = Math.max(this.flash, FLASH_KICK_PEAK_STRIKE);
    }
    for (const stepTime of STEP_TIMES) {
      if (this.lastSongTime < stepTime && songTime >= stepTime && songTime - this.lastSongTime < SCRIPTED_HIT_GUARD) {
        this.flash = Math.max(this.flash, FLASH_KICK_STEP);
      }
    }
    if (
      this.lastSongTime < LAST_POCKET_TIME &&
      songTime >= LAST_POCKET_TIME &&
      songTime - this.lastSongTime < SCRIPTED_HIT_GUARD
    ) {
      this.flash = Math.max(this.flash, FLASH_KICK_LAST_POCKET);
    }
    this.lastSongTime = songTime;

    // Final condensation-to-seed sequence (increment 8, the album's closing
    // image) — a PURE function of songTime (finalEnvAt, module scope
    // above), deliberately NOT edge-triggered like the scripted hits just
    // above: it must render correctly from any `?t=` deep link into act 6,
    // not just from continuous playback, and a loop/seek jump needs no
    // reset of its own (there is no CPU state to go stale — next frame's
    // songTime alone determines the phase). `?seedpt=always` pins the SEED
    // phase at full fade for deterministic screenshots, bypassing songTime
    // entirely — the same "debug override wins" precedent as
    // pinnedBreath/pinnedSterile/pinnedGlint above.
    const finalEnv = this.forceSeedPointAlways ? { phase: 3, t: 0, seedFade: 1 } : finalEnvAt(songTime);
    u.uFinalPhase.value = finalEnv.phase;
    u.uFinalT.value = finalEnv.t;
    u.uSeedFade.value = finalEnv.seedFade;

    // uLifeClock: lifeClockAt(songTime) is a pure monotonic integral of
    // lifeRate over song time, so scaling its OUTPUT by a constant scales
    // its instantaneous rate of advance by that same constant — no CPU
    // accumulation needed to make `?life=fast` speed up clump birth/death.
    // beatBonus (see its own doc) is a folded-in placeholder, 0 this
    // increment.
    const lifeMul = this.forceLifeFast ? LIFE_FAST_MUL : 1;
    u.uLifeClock.value = lifeClockAt(songTime) * lifeMul + this.beatBonus;
    u.uPresence.value = p.clumpPresence;

    // prevBassSlow captured BEFORE this frame's EMA update — the condensation
    // bloom onset detector (below) needs the pre-update value to test a
    // threshold CROSSING, not just "currently above".
    const prevBassSlow = this.bassSlow;
    this.bassSlow += (audio.bass - this.bassSlow) * Math.min(1, dt * BASS_SLOW_RATE);
    u.uBreath.value = this.pinnedBreath !== null ? this.pinnedBreath : this.bassSlow * p.breathAmp;
    // Breathing zoom (increment 7): a subtle inhale/exhale scale layered on
    // top of zoomAt's own envelope (already uploaded above, before uBreath
    // was ready this frame) — verified the existing wiring had NO breath
    // term; this multiply is the whole addition.
    u.uZoom.value = (u.uZoom.value as number) * (1 - BREATH_ZOOM_AMOUNT * (u.uBreath.value as number));

    // uFieldPxScale (increment 9): field-uv units per screen pixel THIS
    // frame — analytic replacement for fwidth()-based AA (sterileShader.ts's
    // sbAA()), recomputed every frame since uZoom itself changes every frame
    // (zoomAt + the breathing multiply just above). Derived from the SAME
    // field=(vUv-0.5)*uCover/uZoom+0.5+uPan mapping the shader uses:
    // d(field)/d(pixel) per axis = uCover_axis/(uZoom*canvasPx_axis); the
    // worst-axis (max cover, min canvas px) combination is a conservative
    // isotropic bound, matching fwidth()'s own multi-pixel-conservative
    // estimate. cover/canvasPx are cached in resize() (rare); only uZoom
    // moves every frame.
    {
      const zoomFinal = u.uZoom.value as number;
      const coverMax = Math.max(this.cover.x, this.cover.y);
      const minCanvasPx = Math.max(1, Math.min(this.canvasPxW, this.canvasPxH));
      u.uFieldPxScale.value = coverMax / (Math.max(1e-4, zoomFinal) * minCanvasPx);
    }

    this.breathPhase += dt * BREATH_PHASE_RATE;
    u.uBreathPhase.value = this.breathPhase;

    this.motionPhase += dt * p.motionSpeed * (0.5 + audio.mid);
    u.uMotionPhase.value = this.motionPhase;

    // uGroundPhase: NOT accumulated (unlike breathPhase/motionPhase above) --
    // a pure function of songTime, the finalEnvAt precedent, so `?t=` deep
    // links reproduce the ground churn exactly. See GROUND_PHASE_RATE's own doc.
    u.uGroundPhase.value = songTime * GROUND_PHASE_RATE;

    u.uHeat.value = p.heat;
    u.uPaleness.value = p.paleness;
    // uGhostAmp: winner-clump ghost-stamp ink strength (increment 6) — rides
    // ActParams.ghostAmp (already 0 in the last two acts, by data) unless
    // `?ghost=always` forces it to 1.0 for deterministic screenshots.
    u.uGhostAmp.value = this.forceGhostAlways ? 1.0 : p.ghostAmp;

    // uFrontDrift: CPU-accumulated domain offset for the S-field's noise
    // wobble (sbSterility, sterileShader.ts) — slightly different per-axis
    // rates so the wobble drifts rather than translating uniformly.
    const drift = u.uFrontDrift.value as THREE.Vector2;
    drift.x += dt * FRONT_DRIFT_RATE;
    drift.y += dt * FRONT_DRIFT_RATE * 0.83;

    u.uFrontNoise.value = p.frontNoise;
    u.uScrubGlow.value = p.scrubGlow * (0.6 + 0.8 * this.bassSlow);

    const prevHighFast = this.highFast;
    this.highFast += (audio.high - this.highFast) * Math.min(1, dt * HIGH_FAST_RATE);
    u.uGlint.value = this.pinnedGlint !== null ? this.pinnedGlint : p.glintAmp * this.highFast;

    // Crackle high-band onset detector (increment 7; increment 11 fix; now
    // `this.crackleOnset`, an OnsetDetector — see BASS_FAST_RATE/
    // CRACKLE_ONSET_* constants' docs). Chases this.highFast (already EMA'd
    // above at HIGH_FAST_RATE for uGlint); the ratePerMinute argument gates
    // crackleRate===0 acts (0 and 6) to zero onset crackles and re-arms the
    // cooldown to rateGapSeconds(CRACKLE_ONSET_COOLDOWN, p.crackleRate) on a
    // fire, so onset density follows the composition.
    if (this.crackleOnset.update(dt, this.highFast, prevHighFast, p.crackleRate)) {
      this.fireCrackle();
    }

    // Poisson ambient crackle (independent channel, so the effect still
    // fires without a mic): p.crackleRate/min scaled by (0.5 + energy) so
    // the purge's peak energy visibly crackles more than the act's rate
    // alone would. `?crackle=always` forces a fixed-interval synthetic
    // stream instead of a Poisson rate override (see forceCrackleAlways's
    // own doc for why the strike/bloom idiom doesn't fit as cleanly here).
    //
    // Increment-11 fix, now `this.crackleSchedule` (PoissonSchedule,
    // `../lib/poisson`): rescales against the last effective rate whenever
    // it changes (same fix, same reasoning as strikeSchedule below — see
    // its doc for the postmortem) — otherwise a schedule made mid-
    // crossfade, while crackleRatePerMin is still a tiny blended fraction
    // of the next act's rate, bakes in a multi-minute delay that the
    // channel then never recovers from for the rest of the song.
    if (this.forceCrackleAlways) {
      this.crackleDebugTimer -= dt;
      if (this.crackleDebugTimer <= 0) {
        this.fireCrackle();
        this.crackleDebugTimer = CRACKLE_DEBUG_INTERVAL;
      }
    } else {
      const crackleRatePerMin = p.crackleRate * (0.5 + energy);
      this.crackleSchedule.update(dt, crackleRatePerMin, this.rand, () => this.fireCrackle());
    }
    this.crackle *= Math.exp(-CRACKLE_DECAY_RATE * dt);
    u.uCrackle.value = this.crackle;
    u.uCrackleSeed.value = this.crackleSeed;

    u.uWatermark.value = p.watermark;
    u.uSterileSpec.value = p.sterileSpec;

    // Bass onset detector (house recipe; increment 11 fix; now
    // `this.bassOnset`, an OnsetDetector — see BASS_FAST_RATE's doc). The
    // ratePerMinute argument gates strikeRate===0 acts (0 and 6) to zero
    // onset strikes and re-arms the cooldown to
    // rateGapSeconds(BASS_ONSET_COOLDOWN, p.strikeRate) on a fire, so onset
    // TIMING snaps to real kicks while onset DENSITY still follows the
    // act's own arc. Each onset both fires a strike AND kicks `this.tick`
    // (independent effects — see tick's own doc, it does not reuse
    // beatBonus).
    const prevBassFast = this.bassFast;
    this.bassFast += (audio.bass - this.bassFast) * Math.min(1, dt * BASS_FAST_RATE);
    if (this.bassOnset.update(dt, this.bassFast, prevBassFast, p.strikeRate)) {
      this.tick = 1;
      this.fireStrike(p);
    }
    this.tick *= Math.exp(-TICK_DECAY_RATE * dt);
    u.uTick.value = this.tick;

    // uFlash decay (increment 7, scripted hits) — kicked above (this
    // frame's scripted-hit block) or on prior frames; decayed every frame
    // regardless of whether a kick just landed.
    this.flash *= Math.exp(-FLASH_DECAY_RATE * dt);
    u.uFlash.value = this.flash;

    // Poisson ambient strikes: an independent channel from the onset one
    // above, so the scene still punches without a mic. `?strike=always`
    // overrides the act's own strikeRate for debugging.
    //
    // Increment-11 fix, now `this.strikeSchedule` (PoissonSchedule,
    // `../lib/poisson`): the crossfade-leak/"due now" idiom above (see the
    // seek-jump reset's doc) assumed a rate turning on from 0 always meant
    // the NEW act's full rate was immediately in effect. That's false during
    // a 6s crossfade — strikeRatePerMin ramps from ~0 up to the next act's
    // rate, so the FIRST scheduled delay after the "due now" fire was baked
    // in against a near-zero rate (tens of thousands of seconds) and the
    // channel then silently never fired again for the rest of the song —
    // exactly the artist's "a few, then none" symptom, and entirely
    // independent of the onset-detector defect above. Fixed by rescaling
    // the remaining countdown every time the effective rate changes: the
    // "due now" single bonus strike on arrival still happens, but the
    // absurd delay it schedules gets continuously shrunk back down in step
    // with the crossfade over the next few frames instead of freezing.
    const strikeRatePerMin = this.forceStrikeAlways ? 60 : p.strikeRate;
    this.strikeSchedule.update(dt, strikeRatePerMin, this.rand, () => this.fireStrike(p));

    this.ageStrikes(dt);

    // Condensation bloom firing (increment 5, the breath motif): a
    // slow-bass threshold CROSSING (prevBassSlow below BLOOM_ONSET_THRESHOLD,
    // this.bassSlow now at/above it), cooldown-gated so a sustained loud
    // passage births one bloom per swell rather than one per frame — meant
    // to catch the intro's alternating lo pulses, one bloom each. PLUS an
    // independent Poisson ambient channel (p.bloomRate/min, `?bloom=always`
    // forces BLOOM_DEBUG_RATE for screenshots) so the motif still breathes
    // without a mic. Both channels share fireBloom's centre-biased
    // pickLivingPoint draw.
    this.bloomCooldown = Math.max(0, this.bloomCooldown - dt);
    if (
      this.bloomCooldown <= 0 &&
      prevBassSlow < BLOOM_ONSET_THRESHOLD &&
      this.bassSlow >= BLOOM_ONSET_THRESHOLD
    ) {
      this.bloomCooldown = BLOOM_ONSET_COOLDOWN;
      this.fireBloom();
    }
    // Stage-2 fix: `this.bloomSchedule` (PoissonSchedule, `../lib/poisson`)
    // replaces the old bare countdown — see bloomSchedule's own doc for the
    // postmortem (the motif's act-3/act-6 returns were silently dead).
    const bloomRatePerMin = this.forceBloomAlways ? BLOOM_DEBUG_RATE : p.bloomRate;
    this.bloomSchedule.update(dt, bloomRatePerMin, this.rand, () => this.fireBloom());
    u.uBloomAmp.value = p.bloomAmp;

    // Fixed-lifetime pools (increment 5): unlike strikePool's hand-rolled
    // heal/fail deactivation (ageStrikes), bloom/poke/ripple each have one
    // fixed CPU-side lifetime that already mirrors their GPU envelope's own
    // span exactly, so SlotPool's own lifetime-based auto-deactivation
    // (age()'s `lifetime > 0` path) is sufficient — no per-slot bookkeeping
    // needed here.
    this.bloomPool.age(dt, BLOOM_LIFETIME);
    this.pokePool.age(dt, POKE_LIFETIME);
    this.ripplePool.age(dt, RIPPLE_LIFETIME);

    // Pointer drag momentum (increment 5, verbatim a1/a2/a3/b1/b2 house
    // idiom): held — EMA the instantaneous velocity from this frame's
    // accumulated drag delta (pointer()'s 'move' already applied the 1:1
    // pan directly; this branch only tracks velocity for the release fling).
    // Released with momentum still live — integrate `pan` by the decaying
    // velocity. Released AND idle (increment 7) — ambient drift instead
    // (see DRIFT_* constants' doc): the two are mutually exclusive per
    // frame so a fling's momentum is never double-nudged by drift on top.
    const zoom = u.uZoom.value as number;
    if (this.held) {
      if (dt > 1e-5) {
        const kv = Math.min(1, dt * VEL_EMA_RATE);
        const instVelX = Math.min(VEL_MAX, Math.max(-VEL_MAX, this.dragDx / dt));
        const instVelY = Math.min(VEL_MAX, Math.max(-VEL_MAX, this.dragDy / dt));
        this.velX += (instVelX - this.velX) * kv;
        this.velY += (instVelY - this.velY) * kv;
      }
      this.dragDx = 0;
      this.dragDy = 0;
    } else if (this.velX !== 0 || this.velY !== 0) {
      this.pan.x += (this.velX * this.cover.x / zoom) * dt;
      this.pan.y += (this.velY * this.cover.y / zoom) * dt;
      const friction = Math.exp(-MOMENTUM_FRICTION * dt);
      this.velX *= friction;
      this.velY *= friction;
      if (Math.abs(this.velX) < MOMENTUM_STOP_SPEED) this.velX = 0;
      if (Math.abs(this.velY) < MOMENTUM_STOP_SPEED) this.velY = 0;
    } else {
      // Ambient drift (increment 7): pan wanders slowly at up to
      // p.driftSpeed * DRIFT_SPEED_SCALE field-uv/s, direction slowly
      // rotating. driftSpeed=0 acts (remission/sterile/last-breath) go dead
      // still for free — the formula scales by p.driftSpeed, so 0 is an
      // exact no-op, no special-casing needed.
      this.driftAngle += dt * DRIFT_ANGLE_RATE;
      const driftDirX = Math.cos(this.driftAngle);
      const driftDirY = Math.sin(this.driftAngle);
      this.pan.x += driftDirX * p.driftSpeed * DRIFT_SPEED_SCALE * dt;
      this.pan.y += driftDirY * p.driftSpeed * DRIFT_SPEED_SCALE * dt;
    }

    // Per-axis clamp (not b2's circular MAX_PAN — see PAN_CLAMP's doc): zero
    // velocity on a clamped axis so momentum doesn't keep fighting the wall.
    if (this.pan.x > PAN_CLAMP) { this.pan.x = PAN_CLAMP; this.velX = 0; }
    else if (this.pan.x < -PAN_CLAMP) { this.pan.x = -PAN_CLAMP; this.velX = 0; }
    if (this.pan.y > PAN_CLAMP) { this.pan.y = PAN_CLAMP; this.velY = 0; }
    else if (this.pan.y < -PAN_CLAMP) { this.pan.y = -PAN_CLAMP; this.velY = 0; }

    // Act-4 ('the-purge') camera shake (increment 7): this.shake decays
    // exponentially every frame (kicked in fireStrike, see its own doc);
    // consumed here as a small pan JITTER written into panDisplay — NOT
    // mutated into this.pan itself, which stays the clean, un-jittered
    // camera position pointer()/pickLivingPoint reason about. Two
    // different-frequency sines of the CPU-accumulated uTime (NOT
    // Math.random per frame) trace a lissajous-ish wobble rather than a
    // straight back-and-forth jitter.
    this.shake *= Math.exp(-SHAKE_DECAY_RATE * dt);
    const shakeT = u.uTime.value as number;
    const jitterX = Math.sin(shakeT * 41.0) * this.shake * SHAKE_JITTER_AMP;
    const jitterY = Math.sin(shakeT * 53.0 + 1.3) * this.shake * SHAKE_JITTER_AMP;
    this.panDisplay.set(this.pan.x + jitterX, this.pan.y + jitterY);
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
   *
   * `centerBias` (increment 5, consumed by fireBloom; increment 7,
   * consumed by the peak scripted strike) — a direct multiplier (1 = no
   * bias, the default) on the random screen-uv sample's offset from centre,
   * before mapping to field-uv: BLOOM_CENTER_BIAS (0.6) biases a
   * condensation bloom toward the frame's centre third so it reads as THE
   * subject when it fires; PEAK_STRIKE_CENTER_BIAS (0.5, tighter still)
   * does the same for the 144s scripted strike, so the album-max hit lands
   * somewhere unmissable rather than anywhere in the visible field the way
   * an ordinary strike can. Was a boolean (increment 5); widened to a plain
   * number (increment 7) once a SECOND, DIFFERENT bias strength was needed
   * — `centerBias ? BLOOM_CENTER_BIAS : 1` would only ever have given two
   * fixed values, and callers now just pass the exact multiplier they want.
   *
   * Reads `this.pan` directly (increment 7), NOT `u.uPan.value` (which is
   * now `this.panDisplay`, `this.pan` plus the act-4 shake jitter — see its
   * own doc): strike/bloom placement must never depend on a cosmetic camera
   * wobble, only the real camera position.
   */
  private pickLivingPoint(centerBias = 1): { x: number; y: number } | null {
    const u = this.material.uniforms;
    const cover = u.uCover.value as THREE.Vector2;
    const zoom = u.uZoom.value as number;
    const pan = this.pan;
    const pocket = u.uPocket.value as THREE.Vector2;
    const stretch = u.uStretch.value as THREE.Vector2;
    const sterile = u.uSterile.value as number;
    const R = this.rMaxEff * (1 - sterile);
    for (let i = 0; i < STRIKE_PICK_TRIES; i++) {
      let sx = this.rand();
      let sy = this.rand();
      sx = 0.5 + (sx - 0.5) * centerBias;
      sy = 0.5 + (sy - 0.5) * centerBias;
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
   *
   * `sizeMult`/`centerBias`/`forceHealZero` (increment 7): the 144s scripted
   * peak strike's three overrides — 1.6x rMax, a tight centre bias so it
   * lands somewhere visible, and a hard-pinned healRate=0 regardless of act
   * or `?heal=`. Every other caller (the bass-onset channel, the ambient
   * Poisson channel) uses the defaults (1, 1, false), unchanged from
   * increments 4-6.
   *
   * Act-4 ('the-purge') camera shake (increment 7): every strike fired
   * while `this.section` is CURRENTLY the purge kicks `this.shake` to
   * `p.shake * SHAKE_KICK_MULT` — regardless of which channel fired it
   * (onset, ambient Poisson, or this method's own peak-strike caller above)
   * — so the shake reads as the purge's own strikes landing, not a
   * separate scripted camera cue. Uses `this.section` rather than a passed
   * flag since every fireStrike call already happens after this frame's
   * `this.section` assignment in update().
   */
  private fireStrike(p: ActParams, sizeMult = 1, centerBias = 1, forceHealZero = false) {
    const point = this.pickLivingPoint(centerBias);
    if (!point) return;
    const idx = this.strikePool.fire();
    const a = this.strikePool.slots[idx];
    a.x = point.x;
    a.y = point.y;
    // `?crack=<mult>` (increment 10) — multiplies into sizeMult so it stacks
    // with the 144s scripted peak strike's own 1.6x override too.
    sizeMult *= this.crackMult;
    const rMax = p.strikeSize * sizeMult * (0.8 + this.rand() * 0.5);
    const aspect = 1.15 + this.rand() * 0.5;
    const angle = this.rand() * Math.PI * 2;
    const healRate = forceHealZero ? 0 : this.healOverride !== null ? this.healOverride : p.strikeHeal;
    this.strikeB[idx].set(rMax, aspect, angle, healRate);

    if (this.section && this.section.actIndex === SHAKE_ACT_INDEX) {
      this.shake = p.shake * SHAKE_KICK_MULT;
    }
  }

  /**
   * Fires one condensation bloom (increment 5) at a RANDOM living point,
   * centre-biased (pickLivingPoint(BLOOM_CENTER_BIAS)) so it reads as
   * the frame's subject — the slow-bass-onset and Poisson-ambient trigger
   * channels in update() both share this one entry point. Skips entirely on
   * a pickLivingPoint failure, same "late acts are mostly sterile" behaviour
   * as fireStrike. No baked constants beyond xy: uBloomAmp (shared, not
   * per-instance) and the shader's own fixed grow/fade envelope cover the
   * rest.
   */
  private fireBloom() {
    const point = this.pickLivingPoint(BLOOM_CENTER_BIAS);
    if (!point) return;
    const idx = this.bloomPool.fire();
    const a = this.bloomPool.slots[idx];
    a.x = point.x;
    a.y = point.y;
  }

  /**
   * Fires one condensation bloom at an EXACT field-uv point — act 6's
   * poke-births-a-bloom route (pointer()'s 'down' handler): no living-point
   * search, no centre bias, the tap itself IS the point.
   */
  private fireBloomAt(fx: number, fy: number) {
    const idx = this.bloomPool.fire();
    const a = this.bloomPool.slots[idx];
    a.x = fx;
    a.y = fy;
  }

  /**
   * Fires one rebloom poke (increment 5) at field-uv (fx, fy) — exactly the
   * tap point, no living-point search (unlike strikes/blooms, a poke is
   * placed wherever the user touched, living or already sterile). Only xy
   * needs setting: SlotPool.fire() already resets z/w, and the shader's
   * sbPokeRadius envelope is fixed (no per-instance uStrikeB-style constants
   * to bake).
   */
  private firePoke(fx: number, fy: number) {
    const idx = this.pokePool.fire();
    const a = this.pokePool.slots[idx];
    a.x = fx;
    a.y = fy;
  }

  /**
   * Fires one near-white expanding ripple ring at field-uv (fx, fy) — the
   * display-side feedback half of every tap (house idiom, b2's
   * activateRipple), regardless of whether the tap carved a poke or (act 6)
   * birthed a bloom.
   */
  private fireRipple(fx: number, fy: number) {
    const idx = this.ripplePool.fire();
    const a = this.ripplePool.slots[idx];
    a.x = fx;
    a.y = fy;
  }

  /**
   * Fires one crackle event (increment 7, the high-band event): kicks
   * `this.crackle` to 1 (decays exp(-CRACKLE_DECAY_RATE*dt) -> uCrackle)
   * and bumps `this.crackleSeed` (-> uCrackleSeed) so the shader's
   * spark-cell hash re-rolls a fresh pattern every time. Pure event
   * bookkeeping, no CPU-side placement needed — the GPU already knows
   * where the scrub line is (sterileShader.ts's crackle block reuses the
   * glint's own arcPos/lineAA), so a crackle needs no field-uv coordinate
   * the way a strike/bloom/poke does.
   */
  private fireCrackle() {
    this.crackle = 1;
    this.crackleSeed++;
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

    // Increment 9: actual drawing-buffer pixel dimensions (post dpr/quality
    // scaling — renderer.domElement.width/height, NOT the CSS w/h this
    // method receives) feed uFieldPxScale's per-frame recompute in update();
    // fwidth() measured real rendered-pixel derivatives, so its analytic
    // replacement must use the same physical resolution, not CSS px. Safe
    // to read here: VizHost.resize() always calls renderer.setSize() before
    // this.current.resize(w, h).
    this.canvasPxW = this.renderer.domElement.width || 1;
    this.canvasPxH = this.renderer.domElement.height || 1;

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
   * zoom), pan=(0,0) (the rect's ORIGINAL framing at open, deliberately
   * evaluated independent of any later pointer-driven uPan — increment 5's
   * drag pans the live scene but never retroactively changes where "the
   * front was invisible at t=0" was calibrated), the CURRENT
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

  /**
   * Canvas pointer/touch gestures (increment 5), the BRIEFING.md Interaction
   * contract: poke on 'down' (no tap-vs-drag threshold — a pure tap fires no
   * 'move', so pan/momentum never trigger, disambiguation falls out free),
   * drag pans 1:1 (b2's verbatim sign convention: `pan += e.d * cover /
   * zoom`, NOT the naively-derived negation — replicated exactly since it's
   * the tested, shipped a1/a2/a3/b1/b2 house behaviour), momentum after
   * release handled entirely in update() (this method only tracks
   * held/dragDx/dragDy/velocity state).
   */
  pointer(e: VizPointerEvent) {
    const zoom = this.material.uniforms.uZoom.value as number;
    const cover = this.cover;

    if (e.type === 'down') {
      this.held = true;
      this.dragDx = 0;
      this.dragDy = 0;
      this.velX = 0;
      this.velY = 0;

      // Screen uv -> field uv, the house formula (shared with the display
      // shader itself, sterileShader.ts's main()). No wrap: b3's S-field is
      // a fixed pocket, not a toroidal/tiled page like b2's catalogue.
      const fx = (e.x - 0.5) * cover.x / zoom + 0.5 + this.pan.x;
      const fy = (e.y - 0.5) * cover.y / zoom + 0.5 + this.pan.y;

      const actIndex = this.section ? this.section.actIndex : 0;
      if (actIndex === BLOOM_ONLY_ACT_INDEX) {
        // Act 6 ('last-breath'): the world is gone, only breath remains — a
        // tap births a condensation bloom exactly at the tap point instead
        // of carving a poke.
        this.fireBloomAt(fx, fy);
      } else {
        this.firePoke(fx, fy);
        // Small uTick kick so the poke's rim pops (sterileShader.ts's
        // eventRimD/POKE_RIM_YOUNG) — Math.max'd, never overwritten, so a
        // poke landing during a hot bass onset doesn't dim the tick.
        this.tick = Math.max(this.tick, POKE_TICK_KICK);
      }
      // Ripple fires unconditionally — a tap's feedback reads the same
      // whether it carved a poke or (act 6) birthed a bloom.
      this.fireRipple(fx, fy);
      return;
    }

    if (e.type === 'move') {
      if (!this.held) return;
      this.pan.x += (e.dx * cover.x) / zoom;
      this.pan.y += (e.dy * cover.y) / zoom;
      this.dragDx += e.dx;
      this.dragDy += e.dy;
      return;
    }

    if (e.type === 'up') {
      this.held = false;
      return;
    }

    // 'cancel': no fling from an interrupted gesture.
    this.held = false;
    this.velX = 0;
    this.velY = 0;
    this.dragDx = 0;
    this.dragDy = 0;
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
