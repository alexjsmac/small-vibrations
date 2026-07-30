/**
 * Fast-EMA-vs-slow-reference-EMA onset detector — the album-wide fix for
 * bug class #1 (BRIEFING.md "Lessons from b3", the July 2026 audit),
 * extracted from b3-sterile-breath/index.ts (the house recipe) and
 * b2-terminal-taxonomy/index.ts (the second, independently-tuned fix), the
 * first two of nine detectors in the album to actually work. Pure
 * TypeScript, no three.js/DOM — same "stays unit-testable" shape as
 * random.ts.
 *
 * THE BUG THIS REPLACES: the pre-fix house recipe kept a fast EMA of a
 * band (tau ~0.125s) and fired on an ABSOLUTE gap over a reference EMA of
 * that fast EMA running at only ~5.3x slower (rate 1.5, tau ~0.67s). At
 * musical tempos the reference tracks the beat envelope almost as closely
 * as the fast EMA, so the gap collapses once both have climbed past the
 * cold-start transient — measured on b3 as 7 strikes in the first 10s of a
 * continuous 120bpm kick, then EXACTLY ZERO for the remaining ~190s. An
 * audit found all nine detectors across the five previously-shipped
 * tracks had the identical defect (a1/a2/b1 fire exactly once per play).
 *
 * THE FIX, all three parts required together:
 *  1. Slow the reference DRASTICALLY — b3/b2 both land on refRate 0.25
 *     (tau ~4s), a 32x ratio to the fast EMA's rate 8 (tau ~0.125s), so
 *     per-beat peaks actually stand out against the passage average
 *     instead of being tracked almost 1:1.
 *  2. A RELATIVE threshold (`fast > ref * (1 + relMargin)`), not an
 *     absolute gap, so the same margin fires correctly at any playback
 *     level (quiet passage or loud one) — plus a small absolute floor so
 *     silence/noise alone never trips it.
 *  3. A RISING-EDGE gate (`fast > prevFast`) so it fires on attacks, not
 *     anywhere on a sustained plateau once the reference has caught up to
 *     a steady level.
 *
 * relMargin/absFloor are NOT portable constants — they depend on how far
 * the caller's own fast EMA actually swings above its own steady-state
 * average against realistic input, which depends on the fast EMA's own
 * rate and on how much of a "shared" role it plays (see each field's own
 * call-site doc). b3's bass fast EMA (rate 8, dedicated to onset only)
 * reaches ~1.106x its converged average against the verification
 * harness's synthetic 120bpm kick, so its 0.22 margin sits comfortably
 * below that ~10.6% ceiling. b2's bassE (also rate 8, but ALSO feeds
 * continuous uAuraPulse/vitality-mod uniforms so its rate can't be tuned
 * independently) only reaches ~1.08x — b3's 0.22 never fires there past
 * warmup, hence b2's own re-measured 0.08. Any new caller MUST re-measure
 * against its own real fast-EMA behaviour rather than copying a number.
 *
 * WHY THE CALLER OWNS THE FAST EMA (this module does not): in every real
 * call site the fast EMA is either shared with an unrelated continuous
 * uniform (b2's bassE/highE also drive uAuraPulse/vitality-mod/uSparkle;
 * b3's highFast also drives uGlint) or, even when onset-only (b3's
 * bassFast), computed with the exact same one-line EMA idiom used
 * everywhere else in these modules (breathing amplitude, chatter rate,
 * motion phase). Owning it here would mean either duplicating a uniform's
 * source of truth or adding a rate knob nothing else needs. The caller
 * updates its own fast EMA every frame (the standard
 * `x += (raw - x) * Math.min(1, dt * rate)` one-liner) and hands both the
 * new and previous value to `update()`.
 *
 * RAW DETECTION vs PER-EFFECT GATING (b2's split, the API's one
 * non-obvious shape): b2 fires ONE physical channel (its bass onset) but
 * needs the RAW "a beat was felt" signal to reach `beatCount`/`beatFlash`
 * (the living-grid background's re-roll clock) on EVERY recognized beat,
 * while the two effects that beat can also trigger — a classification
 * scan, a link-strike — must additionally respect their OWN cooldown
 * derived from the act's own scanRate/linkRate, so their FIRE RATE follows
 * the composition instead of every felt beat (mic-path counts ran ~6x the
 * no-mic Poisson totals without this split — measured on the album audit's
 * own harness). `update()` therefore returns the RAW fire only, debounced
 * by its own fixed `tuning.cooldown` (b2's ONSET_COOLDOWN/
 * HIGH_ONSET_COOLDOWN, unrelated to any act rate); callers that need
 * several independently-gated consumers off the same raw signal keep
 * their own per-effect cooldown fields (plain seconds-remaining numbers)
 * and arm each via `rateGapSeconds` below on a raw fire, exactly the b2
 * shape. b3 has only one consumer per detector (bass -> strike, highFast
 * -> crackle), so its "cooldown" and "effect gate" are the SAME thing —
 * `update()`'s optional `ratePerMinute` argument fuses them: passing it
 * both gates whether the detector may fire at all (enabled iff rate > 0)
 * AND replaces the fixed cooldown with `rateGapSeconds(tuning.cooldown,
 * ratePerMinute)` on that fire, the exact onsetCooldownGap/
 * crackleCooldownGap idiom (b3's strikeRate===0/crackleRate===0 acts then
 * fire no onset events at all, by construction).
 */
export interface OnsetTuning {
  /** Reference EMA's smoothing rate (1/s), chasing the fast EMA. The fix's own number is ~0.25 (tau ~4s, a ~32x ratio off a rate-8 fast EMA) — see this file's top doc for why the pre-fix 1.5 (5.3x) went deaf. */
  refRate: number;
  /** Relative margin: fires only once `fast` clears `ref * (1 + relMargin)`. Must be re-measured per fast-EMA shape, not copied — see top doc. */
  relMargin: number;
  /** Absolute floor: fires only once `fast` clears this, so silence/noise alone never trips a detector whose reference hasn't caught up yet. */
  absFloor: number;
  /** Fixed cooldown floor (seconds) after a raw fire — b2's ONSET_COOLDOWN/HIGH_ONSET_COOLDOWN (used verbatim, no rate involved) or b3's BASS_ONSET_COOLDOWN/CRACKLE_ONSET_COOLDOWN (the floor `rateGapSeconds` maxes against — see `update()`'s `ratePerMinute` doc). */
  cooldown: number;
}

/**
 * `Math.max(floorSeconds, ratePerMinute > 0 ? 60 / ratePerMinute : Infinity)`
 * — the "onset TIMING snaps to real kicks while onset DENSITY still follows
 * the act's own arc" idiom (b3's onsetCooldownGap/crackleCooldownGap, b2's
 * scanOnsetCooldown/linkOnsetCooldown/runnerOnsetCooldown): the minimum gap
 * between fires of one EFFECT, derived from how often the current act wants
 * that effect to happen (60/ratePerMinute), but never faster than
 * `floorSeconds` even at an absurdly high rate, and never armed at all
 * (Infinity) once the rate is 0 — so a channel whose act rate is
 * momentarily 0 doesn't fire on a stale, still-counting-down gap left over
 * from before. `update()` uses this internally for its own optional
 * `ratePerMinute`-gated form (see its doc); b2's per-effect cooldowns
 * (fields it keeps itself, not owned by any OnsetDetector — see this
 * file's top doc for why the split can't live inside one detector
 * instance) call it directly on every raw fire.
 */
export function rateGapSeconds(floorSeconds: number, ratePerMinute: number): number {
  return Math.max(floorSeconds, ratePerMinute > 0 ? 60 / ratePerMinute : Infinity);
}

export class OnsetDetector {
  private refEma = 0;
  private cooldown = 0;

  constructor(private readonly tuning: OnsetTuning) {}

  /**
   * Advances the reference EMA toward `fast` (always, every call — the
   * reference must keep tracking even while the detector is disabled, so
   * it isn't stale when re-enabled) and the cooldown countdown (likewise
   * always decremented, clamped to 0, regardless of `ratePerMinute` — b2's
   * per-effect cooldowns rely on the identical "always decrement" shape,
   * replicated here for the detector's own raw cooldown so a channel that
   * goes quiet for a while doesn't come back with a stale non-zero
   * cooldown frozen mid-count).
   *
   * Fires (returns true) iff: cooldown has elapsed, AND rising edge
   * (`fast > prevFast`), AND `fast > tuning.absFloor`, AND
   * `fast > ref * (1 + tuning.relMargin)`.
   *
   * `ratePerMinute` (optional) fuses the "should this channel even be
   * active" gate with the cooldown's re-arm value, the b3 single-consumer
   * shape (see top doc): omitted (b2's raw-detector call sites) — always
   * enabled, cooldown re-arms to the fixed `tuning.cooldown`. Provided
   * (b3's call sites) — enabled iff `ratePerMinute > 0` (so a
   * `strikeRate===0`/`crackleRate===0` act fires no onset events at all),
   * and on fire the cooldown re-arms to
   * `rateGapSeconds(tuning.cooldown, ratePerMinute)` instead of the bare
   * floor, so onset DENSITY still follows the act's own rate even though
   * onset TIMING is beat-locked.
   */
  update(dt: number, fast: number, prevFast: number, ratePerMinute?: number): boolean {
    this.refEma += (fast - this.refEma) * Math.min(1, dt * this.tuning.refRate);
    this.cooldown = Math.max(0, this.cooldown - dt);

    const enabled = ratePerMinute === undefined || ratePerMinute > 0;
    if (
      enabled &&
      this.cooldown <= 0 &&
      fast > prevFast &&
      fast > this.tuning.absFloor &&
      fast > this.refEma * (1 + this.tuning.relMargin)
    ) {
      this.cooldown =
        ratePerMinute === undefined ? this.tuning.cooldown : rateGapSeconds(this.tuning.cooldown, ratePerMinute);
      return true;
    }
    return false;
  }
}
