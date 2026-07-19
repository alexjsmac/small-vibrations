import * as THREE from 'three';
import type { Viz, VizContext, AudioFrame, VizModule, VizPointerEvent } from '../types';
import {
  ExcitableField,
  IGNITE_SLOTS_FULL, IGNITE_SLOTS_LITE,
  SIM_STEPS_FULL, SIM_STEPS_LITE,
  WARMUP_STEPS_INIT, WARMUP_STEPS_LOOP, WARMUP_TICK_DT,
} from './excitableField';
import { LATTICE_VERT, buildLatticeFragment } from './latticeShader';
import { paramsAt, arcAt, ACTS, CUES, type ActParams } from './sections';
import { mulberry32 } from '../random';

/** Bass-onset detector (a1/a2/b1 EMA + margin + cooldown recipe): excess over its own slow EMA fires an ignition + flash. */
const ONSET_THRESHOLD = 0.12;
const ONSET_COOLDOWN = 0.5;

/** uFlash exponential decay rate (1/s) and per-event kick sizes. */
const FLASH_DECAY = 3.4;
const FLASH_KICK_ONSET = 0.35;
const FLASH_KICK_AMBIENT = 0.18;
const FLASH_KICK_BOUNDARY = 1.2;
const FLASH_CEILING = 1.6;

/** Smoothed audio.mid -> activation-diffusion (wave-speed) modulation gain (mid's one job). */
const MID_DIFF_GAIN = 0.5;

/** Ignition injection: gaussian dab lifetime (short — a handful of ticks), radius (field-uv), and strength (must tip a cell over threshold). */
const IGNITE_LIFETIME = 0.12;
const IGNITE_RADIUS = 0.028;
const IGNITE_STRENGTH_AMBIENT = 0.9;
const IGNITE_STRENGTH_TAP = 1.0;
const IGNITE_RADIUS_TAP = 0.045;
/** `?ignite=always` debug affordance rate (events/min). */
const DEBUG_IGNITE_RATE = 120;

/** Tap ripple-ring pool (latticeShader's uRipple): near-white display-side rings, because the injected sim wave alone is INVISIBLE where cells are refractory — the a1/BRIEFING rule that a poke must read on dark AND dense acts. */
const RIPPLE_SLOTS = 4;
const RIPPLE_LIFETIME = 1.2;

/**
 * High-band ONSET detector — the fast half of high's job in the audio map
 * ("sparkle, shimmer, edge-filament flashes — direct, fast"). Gets its own
 * kick+decay scalar (uSparkKick) separate from the slow uFlash channel: the
 * a2 lesson that one decaying scalar can't serve both few-per-minute scene
 * hits and per-beat sparkle without strobing everything it touches.
 */
const HIGH_ONSET_THRESHOLD = 0.09;
const HIGH_ONSET_COOLDOWN = 0.22;
const SPARK_KICK = 0.75;
const SPARK_DECAY = 7;
const SPARK_CEILING = 1.2;
/** `?spark=always` force switch for the sporadic spark events (house rule: every sporadic element gets one the moment it exists). Interval in seconds. */
const DEBUG_SPARK_INTERVAL = 0.5;

/** Scripted final blip — the outro's "one last lonely blip" (loop closure). Edge-triggered like the 120s/204s hits: the motif the arc closes on must not be left to cold-lattice's sparse Poisson draw. */
const FINAL_BLIP_TIME = 248;

/**
 * Camera choreography. The synchrony pull-back (zoom out + cellFreq up — the
 * micro->macro reveal) runs AFTER the 120s hit across PULLBACK_SECONDS,
 * instead of riding the generic pre-boundary crossfade: ARC's rule is that
 * camera regime changes ON section boundaries — the drop reveals the larger
 * web, it doesn't arrive with it already revealed. The seed act performs the
 * act table's slow zoom-in via its own localT envelope, and a gentle global
 * zoom breath keeps even the sparsest acts from sitting perfectly still
 * (the art-direction "fast evolution" rule).
 */
const PULLBACK_SECONDS = 9;
const SEED_ZOOM_START = 1.1;
const SEED_ZOOM_END = 1.46;
const BREATH_AMP = 0.02;
const BREATH_RATE = 0.26;
const SYNC_ACT_INDEX = ACTS.findIndex((a) => a.name === 'synchrony');

/** Drag-release momentum (a1/a2/b1 idiom, verbatim shape). */
const MOMENTUM_FRICTION = 2.5;
const MOMENTUM_STOP_SPEED = 0.0005;
const VEL_EMA_RATE = 10;
const VEL_MAX = 1.5;
/** Soft pan radius (field-uv) — generous, since the lattice tiles (RepeatWrapping); hitting it zeroes momentum. */
const MAX_PAN = 0.6;

/** Discrete scripted hits (edge-triggered on the boundary crossing, like b1). */
const SYNCHRONY_TIME = CUES[3]; // 120 — the peak lock
const COLLAPSE_TIME = CUES[6];  // 204 — the de-activation cascade
const COLLAPSE_ACT_INDEX = ACTS.findIndex((a) => a.name === 'collapse');
/** De-activation ring: max radius (field-uv) — comfortably past the field diagonal so the sweep clears the whole visible lattice by the act's end. */
const COLLAPSE_RING_MAX = 1.6;

interface AgeSlot {
  age: number;
  active: boolean;
}

/**
 * "Biome Dominoes" — the excitable-medium biome lattice. Composes
 * ExcitableField (excitableField.ts, the GPU reaction sim) + a fullscreen
 * Voronoi display quad (latticeShader.ts) in one self-owned orthographic
 * scene/camera (VizHost's ctx.scene/ctx.camera are unused — same fullscreen-
 * shader pattern as a1/a2/b1; `render()` is implemented so VizHost's default
 * render is bypassed).
 *
 * Debug: `?solo=field` renders the raw sim heat (the default view IS the
 * composed lattice — there is no separate lattice solo), `?ignite=always`
 * forces a steady ignition stream, `?spark=always` forces the high-onset
 * spark events, plus the standard `?t=`, `?q=`, `?debug=1`.
 */
class BiomeDominoes implements Viz {
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.OrthographicCamera;
  private field!: ExcitableField;
  private quad!: THREE.Mesh;
  private material!: THREE.ShaderMaterial;

  private rand!: () => number;
  private forceIgniteAlways = false;

  private full = true;
  private igniteSlotCount = IGNITE_SLOTS_FULL;
  private stepsPerFrame = SIM_STEPS_FULL;

  /** Cover-fit scale (keeps cells square regardless of viewport aspect). */
  private cover = new THREE.Vector2(1, 1);
  /** Field-space pan offset — pointer-drag only. */
  private pan = new THREE.Vector2(0, 0);

  private bassE = 0;
  private midE = 0;
  private highE = 0;
  private bassSlowE = 0;
  private highSlowE = 0;
  private onsetCooldown = 0;
  private highOnsetCooldown = 0;
  private flash = 0;
  /** Fast spark channel (high onsets): kick+decay scalar + per-event counter. */
  private spark = 0;
  private sparkSeed = 0;
  private forceSparkAlways = false;
  private sparkDebugTimer = 0;

  private igniteTimeToNext = 0;
  private igniteSlots: AgeSlot[] = [];

  private rippleSlots: AgeSlot[] = [];
  private rippleValues: THREE.Vector4[] = [];

  /** Per-play phase for the global zoom breath. */
  private breathPhase = 0;

  /** Collapse ring centre, seeded once per play. */
  private collapseCx = 0.5;
  private collapseCy = 0.5;

  private firstUpdate = true;
  private lastDt = 0;
  private lastSongTime = -1;

  /** Pointer/drag-pan state — all scalars, zero per-frame allocation. */
  private held = false;
  private dragDx = 0;
  private dragDy = 0;
  private velX = 0;
  private velY = 0;

  init(ctx: VizContext) {
    const { renderer, seed, quality } = ctx;
    this.renderer = renderer;
    this.rand = mulberry32(seed ^ 0xa3d0be17);

    const params = new URLSearchParams(location.search);
    const solo = params.get('solo');
    const soloMode = solo === 'field' ? 1 : 0;
    this.forceIgniteAlways = params.get('ignite') === 'always';
    this.forceSparkAlways = params.get('spark') === 'always';

    this.full = quality.level === 'full';
    this.igniteSlotCount = this.full ? IGNITE_SLOTS_FULL : IGNITE_SLOTS_LITE;
    this.stepsPerFrame = this.full ? SIM_STEPS_FULL : SIM_STEPS_LITE;

    for (let i = 0; i < this.igniteSlotCount; i++) this.igniteSlots.push({ age: 0, active: false });

    for (let i = 0; i < RIPPLE_SLOTS; i++) {
      this.rippleSlots.push({ age: 0, active: false });
      this.rippleValues.push(new THREE.Vector4(0, 0, 0, 0));
    }

    // Collapse ring centre: a seeded point near centre so each play's cascade
    // originates somewhere slightly different.
    this.collapseCx = 0.4 + this.rand() * 0.2;
    this.collapseCy = 0.4 + this.rand() * 0.2;

    this.breathPhase = this.rand() * Math.PI * 2;

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this.field = new ExcitableField(renderer, this.full, this.igniteSlotCount);

    this.material = new THREE.ShaderMaterial({
      vertexShader: LATTICE_VERT,
      fragmentShader: buildLatticeFragment(RIPPLE_SLOTS),
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uField: { value: null },
        uCover: { value: new THREE.Vector2(1, 1) },
        uPan: { value: this.pan },
        uZoom: { value: 1 },
        uCellFreq: { value: 9 },
        uTime: { value: 0 },
        uFlash: { value: 0 },
        uSparkle: { value: 0 },
        uSparkKick: { value: 0 },
        uSparkSeed: { value: 0 },
        uRipple: { value: this.rippleValues },
        uEnergy: { value: 0 },
        uBloomGain: { value: 0.6 },
        uSat: { value: 0.8 },
        uFrontGain: { value: 0.6 },
        uRefractGlow: { value: 0.3 },
        uFilament: { value: 0.4 },
        uMicroTex: { value: 0.3 },
        uWarmth: { value: 0 },
        uDust: { value: 0.3 },
        uSoloMode: { value: soloMode },
      },
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.scene.add(this.quad);

    const canvas = renderer.domElement;
    this.resize(canvas.clientWidth || 1, canvas.clientHeight || 1);
  }

  private kickFlash(amount: number) {
    this.flash = Math.min(FLASH_CEILING, this.flash + amount);
  }

  /** Injects one ignition (a u-spike) at field-uv (x,y), wrapped into [0,1) so it lands on the RepeatWrapping torus. */
  private ignite(x: number, y: number, radius: number, strength: number) {
    let idx = this.igniteSlots.findIndex((s) => !s.active);
    if (idx < 0) idx = 0;
    const slot = this.igniteSlots[idx];
    slot.active = true;
    slot.age = 0;
    const wx = x - Math.floor(x);
    const wy = y - Math.floor(y);
    this.field.seeds[idx].set(wx, wy, radius, strength);
  }

  private updateIgniteAges(dt: number) {
    for (let i = 0; i < this.igniteSlots.length; i++) {
      const slot = this.igniteSlots[i];
      if (!slot.active) continue;
      slot.age += dt;
      if (slot.age >= IGNITE_LIFETIME) {
        slot.active = false;
        this.field.seeds[i].w = 0;
      }
    }
  }

  /** Near-white expanding ripple ring at field-uv (x,y) — the display-side half of a tap (visible even where refractory cells can't re-fire). Coords wrapped into [0,1); the shader torus-wraps its distance to match. */
  private activateRipple(x: number, y: number) {
    let idx = this.rippleSlots.findIndex((s) => !s.active);
    if (idx < 0) idx = 0;
    const slot = this.rippleSlots[idx];
    slot.active = true;
    slot.age = 0;
    this.rippleValues[idx].set(x - Math.floor(x), y - Math.floor(y), 0, 1);
  }

  private updateRippleAges(dt: number) {
    for (let i = 0; i < this.rippleSlots.length; i++) {
      const slot = this.rippleSlots[i];
      if (!slot.active) continue;
      slot.age += dt;
      if (slot.age >= RIPPLE_LIFETIME) {
        slot.active = false;
        this.rippleValues[i].w = 0;
      } else {
        this.rippleValues[i].z = slot.age;
      }
    }
  }

  /** Fires the fast spark channel: kick the decay scalar and re-roll which cells flash (the counter feeds the shader's hash). */
  private kickSpark() {
    this.spark = Math.min(SPARK_CEILING, this.spark + SPARK_KICK);
    this.sparkSeed++;
  }

  /** The outro's scripted "one last lonely blip": a single ignition near centre + a soft flash, edge-triggered at FINAL_BLIP_TIME so loop closure is guaranteed on every play. */
  private scriptedFinalBlip() {
    const x = 0.35 + this.rand() * 0.3;
    const y = 0.35 + this.rand() * 0.3;
    this.ignite(x, y, IGNITE_RADIUS * 1.2, IGNITE_STRENGTH_AMBIENT);
    this.kickFlash(FLASH_KICK_ONSET);
  }

  private sst(x: number): number {
    const c = Math.min(1, Math.max(0, x));
    return c * c * (3 - 2 * c);
  }

  private scheduleIgnitions(dt: number, ratePerMinute: number) {
    const rate = Math.max(0, ratePerMinute) / 60;
    if (rate <= 0) return;
    this.igniteTimeToNext -= dt;
    while (this.igniteTimeToNext <= 0) {
      this.ignite(this.rand(), this.rand(), IGNITE_RADIUS, IGNITE_STRENGTH_AMBIENT);
      this.kickFlash(FLASH_KICK_AMBIENT);
      const u = Math.max(1e-6, this.rand());
      this.igniteTimeToNext += -Math.log(u) / rate;
    }
  }

  /** Scripted synchrony lock (120s): the whole lattice fires — a burst of ignitions spread across the field, plus a big flash. */
  private scriptedSynchronyHit() {
    const n = this.full ? 5 : 3;
    for (let i = 0; i < n; i++) this.ignite(this.rand(), this.rand(), IGNITE_RADIUS * 1.6, IGNITE_STRENGTH_AMBIENT);
    this.kickFlash(FLASH_KICK_BOUNDARY);
  }

  /** Runs the staged warmup: clear the field, then replay the real ignition + step path at fixed WARMUP_TICK_DT so the lattice lands already mid-propagation (regardless of frame rate / `?t=` deep link). */
  private warmup(p: ActParams, steps: number) {
    this.field.clearField();
    this.field.setActParams(p);
    for (let i = 0; i < steps; i++) {
      this.scheduleIgnitions(WARMUP_TICK_DT, this.forceIgniteAlways ? DEBUG_IGNITE_RATE : p.ignitionRate);
      this.field.step(WARMUP_TICK_DT, 1);
      this.updateIgniteAges(WARMUP_TICK_DT);
    }
  }

  update(dt: number, audio: AudioFrame) {
    const section = paramsAt(audio.time);
    const p = section.params;
    this.lastDt = dt;

    if (this.firstUpdate) {
      this.firstUpdate = false;
      // Covers cold loads, `?t=` deep links, AND mid-song quality toggles —
      // all land on a formed, mid-propagation field.
      this.warmup(p, WARMUP_STEPS_INIT);
    }

    // Loop-wrap: song time jumping backward by >10s means the track looped —
    // clear + re-warm so a new play doesn't inherit the previous field.
    if (this.lastSongTime >= 0 && audio.time < this.lastSongTime - 10) {
      this.warmup(p, WARMUP_STEPS_LOOP);
    }

    // Scripted discrete hits (edge-triggered; the < 0.5 guard rejects the ?t=
    // seed jump and the loop wrap as false triggers — a normal frame's dt
    // never approaches that).
    if (this.lastSongTime >= 0 && audio.time - this.lastSongTime >= 0 && audio.time - this.lastSongTime < 0.5) {
      if (this.lastSongTime < SYNCHRONY_TIME && audio.time >= SYNCHRONY_TIME) this.scriptedSynchronyHit();
      if (this.lastSongTime < COLLAPSE_TIME && audio.time >= COLLAPSE_TIME) this.kickFlash(FLASH_KICK_BOUNDARY);
      if (this.lastSongTime < FINAL_BLIP_TIME && audio.time >= FINAL_BLIP_TIME) this.scriptedFinalBlip();
    }
    this.lastSongTime = audio.time;

    // Smooth audio bands (a1/a2/b1 idiom) so reactivity isn't jittery.
    const k = Math.min(1, dt * 8);
    this.bassE += (audio.bass - this.bassE) * k;
    this.midE += (audio.mid - this.midE) * k;
    this.highE += (audio.high - this.highE) * k;
    this.bassSlowE += (audio.bass - this.bassSlowE) * Math.min(1, dt * 1.5);
    this.highSlowE += (audio.high - this.highSlowE) * Math.min(1, dt * 1.5);

    // Bass-onset detector: excess over its own slow EMA fires an ignition +
    // flash — a new chain leaps on the beat.
    this.onsetCooldown -= dt;
    if (this.onsetCooldown <= 0 && this.bassE - this.bassSlowE > ONSET_THRESHOLD) {
      this.ignite(this.rand(), this.rand(), IGNITE_RADIUS, IGNITE_STRENGTH_AMBIENT);
      this.kickFlash(FLASH_KICK_ONSET);
      this.onsetCooldown = ONSET_COOLDOWN;
    }

    // High-onset detector — the fast spark channel (high's other job).
    this.highOnsetCooldown -= dt;
    if (this.highOnsetCooldown <= 0 && this.highE - this.highSlowE > HIGH_ONSET_THRESHOLD) {
      this.kickSpark();
      this.highOnsetCooldown = HIGH_ONSET_COOLDOWN;
    }
    if (this.forceSparkAlways) {
      this.sparkDebugTimer -= dt;
      if (this.sparkDebugTimer <= 0) {
        this.kickSpark();
        this.sparkDebugTimer = DEBUG_SPARK_INTERVAL;
      }
    }
    this.spark *= Math.exp(-SPARK_DECAY * dt);

    this.scheduleIgnitions(dt, this.forceIgniteAlways ? DEBUG_IGNITE_RATE : p.ignitionRate);
    this.updateIgniteAges(dt);
    this.updateRippleAges(dt);

    // Collapse de-activation ring: only while inside the collapse act, grow
    // the suppression radius across its localT so the field goes dark
    // cell-by-cell (the travelling-wave motif inverted).
    if (section.actIndex === COLLAPSE_ACT_INDEX) {
      const radius = section.localT * COLLAPSE_RING_MAX;
      this.field.suppress.set(this.collapseCx, this.collapseCy, radius, p.suppress);
    } else {
      this.field.suppress.w = 0;
    }

    this.flash *= Math.exp(-FLASH_DECAY * dt);

    // mid's one job: smoothed wave-speed (diffusion) modulation.
    this.field.setDiffMod(1 + this.midE * MID_DIFF_GAIN);
    this.field.setActParams(p);

    // Camera choreography (see the PULLBACK/SEED/BREATH constants' doc).
    // Default: the act-crossfaded values. Seed act: its own slow zoom-in
    // envelope. Wiring-up: HOLD through the pre-boundary crossfade so the
    // pull-back doesn't leak in early. Synchrony: the pull-back runs across
    // PULLBACK_SECONDS AFTER the 120s hit (localT envelope), then hands off
    // to the normal outgoing crossfade (at k=1 the math below equals p.zoom).
    let zoom = p.zoom;
    let cellFreq = p.cellFreq;
    if (section.actIndex === 0) {
      const base = SEED_ZOOM_START + (SEED_ZOOM_END - SEED_ZOOM_START) * this.sst(section.localT);
      zoom = base + (ACTS[1].zoom - base) * section.blend;
    } else if (section.actIndex === SYNC_ACT_INDEX - 1) {
      zoom = ACTS[SYNC_ACT_INDEX - 1].zoom;
      cellFreq = ACTS[SYNC_ACT_INDEX - 1].cellFreq;
    } else if (section.actIndex === SYNC_ACT_INDEX) {
      const dur = CUES[SYNC_ACT_INDEX + 1] - CUES[SYNC_ACT_INDEX];
      const kPull = this.sst(Math.min(1, (section.localT * dur) / PULLBACK_SECONDS));
      const prev = ACTS[SYNC_ACT_INDEX - 1];
      const cur = ACTS[SYNC_ACT_INDEX];
      const next = ACTS[SYNC_ACT_INDEX + 1];
      zoom = prev.zoom + (cur.zoom - prev.zoom) * kPull;
      cellFreq = prev.cellFreq + (cur.cellFreq - prev.cellFreq) * kPull;
      zoom += (next.zoom - zoom) * section.blend;
      cellFreq += (next.cellFreq - cellFreq) * section.blend;
    }
    // Gentle global breath — the scene never sits perfectly still.
    zoom *= 1 + BREATH_AMP * Math.sin(audio.time * BREATH_RATE + this.breathPhase);

    // Display uniforms.
    const u = this.material.uniforms;
    u.uTime.value += dt;
    u.uZoom.value = zoom;
    u.uCellFreq.value = cellFreq;
    u.uBloomGain.value = p.bloomGain;
    u.uSat.value = p.sat;
    u.uFrontGain.value = p.frontGain;
    u.uRefractGlow.value = p.refractGlow;
    u.uFilament.value = p.filament;
    u.uMicroTex.value = p.microTex;
    u.uWarmth.value = p.warmth;
    u.uDust.value = p.dust;
    u.uFlash.value = this.flash;
    u.uSparkle.value = this.highE;
    u.uSparkKick.value = this.spark;
    u.uSparkSeed.value = this.sparkSeed;
    u.uEnergy.value = arcAt(audio.time).energy;

    // Drag momentum (a1/a2/b1 idiom, verbatim shape). No ambient drift.
    // Uses the effective (envelope+breath) zoom so glide speed matches what
    // the pointer formula and the display actually use.
    const cover = this.cover;
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
      this.pan.x += (this.velX * cover.x / zoom) * dt;
      this.pan.y += (this.velY * cover.y / zoom) * dt;
      const friction = Math.exp(-MOMENTUM_FRICTION * dt);
      this.velX *= friction;
      this.velY *= friction;
      if (Math.abs(this.velX) < MOMENTUM_STOP_SPEED) this.velX = 0;
      if (Math.abs(this.velY) < MOMENTUM_STOP_SPEED) this.velY = 0;
    }

    const panDist = Math.hypot(this.pan.x, this.pan.y);
    if (panDist > MAX_PAN) {
      this.pan.x *= MAX_PAN / panDist;
      this.pan.y *= MAX_PAN / panDist;
      this.velX = 0;
      this.velY = 0;
    }
  }

  pointer(e: VizPointerEvent) {
    const zoom = this.material.uniforms.uZoom.value as number;
    const cover = this.cover;

    if (e.type === 'down') {
      this.held = true;
      this.dragDx = 0;
      this.dragDy = 0;
      this.velX = 0;
      this.velY = 0;
      // Screen uv -> field uv via the display shader's own formula — a tap
      // injects an ignition (a spark leaps into the lattice) + a flash.
      const fx = (e.x - 0.5) * cover.x / zoom + 0.5 + this.pan.x;
      const fy = (e.y - 0.5) * cover.y / zoom + 0.5 + this.pan.y;
      this.ignite(fx, fy, IGNITE_RADIUS_TAP, IGNITE_STRENGTH_TAP);
      this.activateRipple(fx, fy);
      this.kickFlash(FLASH_KICK_ONSET);
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
    this.field.step(this.lastDt, this.stepsPerFrame);
    this.material.uniforms.uField.value = this.field.texture;
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.scene, this.camera);
  }

  resize(w: number, h: number) {
    if (!this.material || w <= 0 || h <= 0) return;
    const aspect = Math.min(3.5, Math.max(0.28, w / h));
    // Keep cells square regardless of viewport aspect.
    if (aspect >= 1) this.cover.set(aspect, 1);
    else this.cover.set(1, 1 / aspect);
    (this.material.uniforms.uCover.value as THREE.Vector2).copy(this.cover);
  }

  dispose() {
    this.field.dispose();
    this.material.dispose();
    this.quad.geometry.dispose();
    this.renderer.setRenderTarget(null);
  }
}

const mod: VizModule = { default: () => new BiomeDominoes() };
export default mod.default;
