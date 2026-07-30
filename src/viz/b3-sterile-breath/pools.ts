import * as THREE from 'three';

/**
 * Generic fixed-size event-slot pool, shared by b3's later one-shot event
 * systems (lightning strikes, bleach blooms, pointer pokes, ripples — see
 * BRIEFING.md's pool idiom, verbatim shape from b2's scanSlots/linkSlots/
 * runnerSlots/killSlots but factored out since b3 needs FOUR parallel pools
 * from increment 2 onward). Each slot is a single THREE.Vector4 uniform
 * entry; this class only manages the slot LIFECYCLE (fire/age/clear) — the
 * xyzw payload layout (e.g. xy = field-uv position, z = age in seconds,
 * w = active flag 0/1, or whatever a given event system needs) is entirely
 * up to the caller, which is why `w` doubles as both "active" and whatever
 * strength/flag value the caller wants once activated (the pool only ever
 * reads/writes w as a 0-inactive / >0-active gate; z as the age clock).
 *
 * No allocation after construction: `fire()`/`age()`/`clearAll()` only
 * mutate the preallocated Vector4s and loop over `slots` — no arrays,
 * objects, or closures are created per call.
 */
export class SlotPool {
  /** Preallocated, index-stable for the pool's lifetime. Layout (xy/z/w) is defined by the caller — this class only touches z (age) and w (active). */
  readonly slots: THREE.Vector4[];

  constructor(n: number) {
    this.slots = [];
    for (let i = 0; i < n; i++) this.slots.push(new THREE.Vector4(0, 0, 0, 0));
  }

  /**
   * Activates one slot and returns its index: the first inactive slot (w
   * <= 0), or — if every slot is already active — the OLDEST active one
   * (largest z), recycled early (b2's "steal the oldest" idiom for bounded
   * pools under sustained event pressure). Resets age (z) to 0 and marks
   * active (w) to 1; the caller still owns xy (and w's final strength
   * value, if different from 1) and must set those itself right after.
   */
  fire(): number {
    let idx = this.slots.findIndex((s) => s.w <= 0);
    if (idx < 0) {
      idx = 0;
      let maxAge = this.slots[0].z;
      for (let i = 1; i < this.slots.length; i++) {
        if (this.slots[i].z > maxAge) {
          maxAge = this.slots[i].z;
          idx = i;
        }
      }
    }
    const slot = this.slots[idx];
    slot.z = 0;
    slot.w = 1;
    return idx;
  }

  /**
   * Advances every active slot's age (z) by dt. When `lifetime` is > 0,
   * slots whose age reaches it are deactivated (w set to 0) here; pass
   * `lifetime <= 0` when the caller deactivates slots itself on its own
   * schedule instead (b2's ageLinks idiom: an edge-triggered event fires
   * partway through the slot's life, deactivation happens elsewhere) — in
   * that case age() only advances the clock and never touches w.
   */
  age(dt: number, lifetime: number): void {
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i];
      if (slot.w <= 0) continue;
      slot.z += dt;
      if (lifetime > 0 && slot.z >= lifetime) slot.w = 0;
    }
  }

  /** Deactivates every slot (w = 0) — the loop-wrap reset idiom, so a fresh play doesn't inherit stale in-flight events from the previous one. */
  clearAll(): void {
    for (let i = 0; i < this.slots.length; i++) this.slots[i].w = 0;
  }
}

/**
 * Seconds until the next event of a Poisson process running at
 * `ratePerMinute` events/minute (the house scheduling idiom — verbatim
 * shape from b2's scheduleScans/scheduleWaves/scheduleLinks/scheduleRunners,
 * factored out here since b3 needs it for at least four independent event
 * streams). Returns Infinity when the rate is <= 0 (never fires), so
 * callers can unconditionally `timeToNext -= dt` against the result without
 * special-casing the off case.
 */
export function nextPoissonDelay(rand: () => number, ratePerMinute: number): number {
  if (ratePerMinute <= 0) return Infinity;
  const rate = ratePerMinute / 60;
  return -Math.log(1 - rand()) / rate;
}
