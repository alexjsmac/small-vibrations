/**
 * Poisson ambient-event scheduler — the album-wide fix for bug class #2
 * (BRIEFING.md "Lessons from b3" / the b2 album-audit), extracted from
 * b3-sterile-breath/index.ts's strike/crackle channels and
 * b2-terminal-taxonomy/index.ts's scan/link/runner channels. Pure
 * TypeScript, no three.js/DOM — same shape as random.ts/onset.ts.
 *
 * THE BUG THIS REPLACES: the house scheduling idiom bakes the NEXT
 * inter-arrival delay from the CURRENT rate at fire time. `paramsAt` lerps
 * every ActParams key across a 6s crossfade, so an act whose rate is 0
 * blending into a nonzero act passes through a near-zero blended rate
 * (~2.3e-5) on the boundary's first frame. Because the countdown starts at
 * 0 and the old `if (rate <= 0) return;` early-return FROZE it there, that
 * first epsilon-rate frame fired immediately (correct — a channel turning
 * on should fire on arrival) and then baked its NEXT delay from
 * `-ln(u)/rate` against that near-zero rate: order 1e5 seconds, i.e. dead
 * for the rest of the track. b2 was the severe case (scans are its PRIMARY
 * content and the sole carrier of beatCount/beatFlash, the living-grid
 * background's clock — the module went effectively inert from ~50s).
 *
 * THE FIX has three independent parts, all captured here:
 *  1. RESCALE the pending countdown whenever the effective rate changes
 *     while still armed (`timeToNext *= oldRate / newRate` — the
 *     quantile-preserving rescale for an Exponential distribution under a
 *     rate change: it maps the CURRENT draw's quantile onto what it would
 *     have been at the new rate, rather than discarding it). The "due now"
 *     bonus fire on arrival still happens; the delay it then schedules
 *     keeps shrinking in step with the crossfade instead of freezing.
 *  2. REACTIVATE due-now, not from a stale countdown, when a channel comes
 *     back from a genuine OFF period (as opposed to merely a crossfade
 *     epsilon blip). Found in round 2 of the b2 fix: linkRate/runnerRate
 *     cycle on->off->on more than once across the act table (unlike scan,
 *     which only ever turns on once), and reactivating from an off period
 *     skipped the rescale branch (scheduleRate was already 0, so the
 *     rescale's own precondition never held) and resumed whatever
 *     `timeToNext` happened to be left over from BEFORE the channel went
 *     quiet — occasionally tens of seconds, from an unlucky exponential
 *     tail draw. Measured: a stale ~90s countdown survived the entire
 *     off-span and then ate a big chunk of the FOLLOWING on-period too,
 *     silencing the Poisson channel through most of the album-max act.
 *     `reactivateDueNow` is opt-in (default off) because it only matters
 *     for channels whose rate genuinely cycles off->on->off->on — b3's
 *     strike/crackle channels only ever go off ONCE, at the very end of
 *     the track (never reactivate), so their pre-extraction code never had
 *     this branch and enabling it here unconditionally would be adding new
 *     behaviour, not preserving old — see MIGRATION NOTE below.
 *  3. CLAMP a single drawn delay (`maxGapSeconds`) as a belt-and-braces
 *     backstop so a pathological near-zero rate can never bake in an
 *     absurd wait even before the rescale above has a chance to shrink it.
 *     Opt-in (default Infinity/unclamped) for the same reason as (2): b3's
 *     pre-extraction `nextPoissonDelay` never clamped; b2's did
 *     (MAX_POISSON_GAP_SECONDS = 90, ~3x its slowest channel's own mean gap
 *     at its lowest realistic nonzero rate).
 *
 * MIGRATION NOTE (why b3's bloom channel is NOT migrated onto
 * `PoissonSchedule`): bloomRate cycles off->on repeatedly across b3's act
 * table (10 -> 0 -> 0 -> 4 -> 0 -> 0 -> 1.5), the exact shape that needs
 * fix (2) — but the pre-extraction code never got it (no scheduleRate
 * field at all, just a bare `if (rate>0) { countdown -= dt; while
 * countdown<=0 fire() }`), apparently missed by the original fix's scope.
 * This IS a real latent bug, but fixing it is out of scope for a
 * behaviour-identical refactor — flagged for stage 2 instead of silently
 * changed here. b2's `scheduleWaves` is the same story for a different
 * reason (its own doc: waveRate only ever steps discretely via the
 * act-hold, never crosses an epsilon, so the team deliberately left it
 * untouched "out of caution/scope discipline" — replicated here).
 *
 * WHY `epsilonFloor` EXISTS (`poissonInterArrival`'s U derivation): both
 * pre-extraction formulas were valid inverse-CDF exponential sampling,
 * `-ln(U)/rate` for U uniform on (0,1], differing only in how they kept U
 * off exactly 0 — b3's `nextPoissonDelay` used `U = 1 - rand()` (rand() is
 * [0,1), so this is always in (0,1] with no epsilon needed, the default
 * here); b2's `poissonDelay` used `U = Math.max(1e-6, rand())`. Both are
 * statistically valid, but NOT numerically interchangeable for the same
 * rand() output — picking one canonical derivation for both modules would
 * shift b2's exact draws (and therefore its exact fire windows/totals) away
 * from its pre-extraction behaviour for no functional reason. `epsilonFloor`
 * preserves each module's real formula exactly instead: omitted (b3's call
 * sites) — `U = 1 - rand()`; a number (b2's call sites: 1e-6) —
 * `U = Math.max(epsilonFloor, rand())`. Both migrations are therefore
 * bit-for-bit identical to their pre-extraction draws — verified by the
 * migration's own proof-of-identity harness.
 */

export interface PoissonScheduleOptions {
  /** Clamps a single drawn inter-arrival delay (seconds) — see fix (3) above. Default Infinity (b3's unclamped shape); b2 passes 90 (MAX_POISSON_GAP_SECONDS). */
  maxGapSeconds?: number;
  /** Reactivating from a genuine OFF period (schedule rate was 0) fires due-now instead of resuming a stale leftover countdown — see fix (2) above. Default false (b3's shape, never exercised by its act table); b2 passes true. */
  reactivateDueNow?: boolean;
  /** Preserves the exact pre-extraction U-derivation for a module that didn't use `1 - rand()` — see the top doc's `epsilonFloor` explanation. Omitted (default) = b3's shape; b2 passes 1e-6. */
  epsilonFloor?: number;
}

/**
 * Draws one Poisson inter-arrival delay (seconds) at `ratePerMinute`
 * events/minute. Returns Infinity when `ratePerMinute <= 0` (never fires),
 * so callers can unconditionally schedule off the result without
 * special-casing the off case — the b3 `nextPoissonDelay` precedent.
 */
export function poissonInterArrival(
  rand: () => number,
  ratePerMinute: number,
  maxGapSeconds = Infinity,
  epsilonFloor?: number,
): number {
  if (ratePerMinute <= 0) return Infinity;
  const rate = ratePerMinute / 60;
  const u = epsilonFloor === undefined ? 1 - rand() : Math.max(epsilonFloor, rand());
  return Math.min(maxGapSeconds, -Math.log(u) / rate);
}

/**
 * Stateful ambient-event scheduler wrapping the three fixes above around
 * one countdown. One instance per independent event channel (b3: one each
 * for strike/crackle; b2: one each for scan/link/runner) — `update()` is
 * meant to be called exactly once per frame with that channel's current
 * (already crossfaded) `ratePerMinute`.
 */
export class PoissonSchedule {
  private timeToNext = 0;
  private scheduleRate = 0;

  constructor(private readonly opts: PoissonScheduleOptions = {}) {}

  /**
   * Zeroes the countdown AND the schedule-rate — the "everything about this
   * channel's ambient schedule is stale" reset a `?t=` seek or a track loop
   * needs (b3's own seek-jump doc): a fresh call to `update()` afterward
   * fires due-now at whatever rate is current then, exactly like a first-
   * ever activation, and never rescales against the stale pre-reset rate.
   */
  reset(): void {
    this.timeToNext = 0;
    this.scheduleRate = 0;
  }

  /**
   * Advances the countdown by `dt` and calls `onFire()` once per elapsed
   * event (a while-loop, so a large `dt` or a very high rate can fire more
   * than once per call — the house shape, unchanged). `rate <= 0` turns
   * the channel off (resets the internal schedule-rate, touches nothing
   * else) rather than freezing a live countdown, the root fix for bug
   * class #2's original defect.
   */
  update(dt: number, ratePerMinute: number, rand: () => number, onFire: () => void): void {
    const rate = Math.max(0, ratePerMinute);
    if (rate <= 0) {
      this.scheduleRate = 0;
      return;
    }
    const maxGap = this.opts.maxGapSeconds ?? Infinity;
    if (this.scheduleRate > 0 && this.timeToNext > 0) {
      this.timeToNext = Math.min(maxGap, this.timeToNext * (this.scheduleRate / rate));
    } else if (this.opts.reactivateDueNow && this.scheduleRate <= 0) {
      this.timeToNext = 0;
    }
    this.scheduleRate = rate;
    this.timeToNext -= dt;
    while (this.timeToNext <= 0) {
      onFire();
      this.timeToNext += poissonInterArrival(rand, rate, maxGap, this.opts.epsilonFloor);
      this.scheduleRate = rate;
    }
  }
}
