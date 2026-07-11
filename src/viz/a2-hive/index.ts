import * as THREE from 'three';
import type { Viz, VizContext, AudioFrame, VizModule, VizPointerEvent } from '../types';
import {
  WALL_VERT, buildWallFragmentShader,
  HEX_R, ROOM_SIZE,
  KNOCK_SLOTS_FULL, KNOCK_SLOTS_LITE, KNOCK_BOOST_LIFETIME, KNOCK_GLOW_LIFETIME,
} from './wallShader';
import { Bees } from './bees';
import { paramsAt, arcAt } from './sections';
import { mulberry32 } from '../random';

/** Bass-onset detector: excess over its own slow EMA that kicks a flash + an ambient knock. */
const ONSET_THRESHOLD = 0.12;
const ONSET_COOLDOWN = 1.5;

/** uFlash exponential decay rate (1/s) and the size of a single kick. */
const FLASH_DECAY = 3.0;
const FLASH_KICK_ONSET = 0.5;
const FLASH_KICK_BOUNDARY_54 = 0.9;
const FLASH_KICK_BOUNDARY_188 = 1.2;
const FLASH_KICK_AMBIENT = 0.4;
const FLASH_CEILING = 1.5;

/** Ambient-knock reach (wall-uv) — comparable to the wall-space span the cover-fit transform produces. */
const AMBIENT_KNOCK_SPAN_X = 1.4;
const AMBIENT_KNOCK_SPAN_Y = 1.0;
/** Continuous rate (knocks/min) used for the `?knock=always` debug affordance. */
const DEBUG_KNOCK_RATE = 60;

/** Drag-release momentum: friction decay rate and the speed floor below which we snap to a stop (a1 idiom). */
const MOMENTUM_FRICTION = 2.5;
const MOMENTUM_STOP_SPEED = 0.0005;
/** Velocity EMA smoothing rate and clamp (wall-uv/s) — keeps a jittery drag from producing a wild fling. */
const VEL_EMA_RATE = 10;
const VEL_MAX = 1.5;
/**
 * Soft pan radius (wall-uv) — hitting it zeroes momentum. Wrapping (a1's
 * approach) was rejected: the wall is an unbounded plane grown outward from
 * fixed seed cells, and wrapping would silently teleport the view back over
 * already-dead ground, breaking "seed cells die last" at lights-out.
 */
const MAX_PAN = 8 * HEX_R;

interface KnockSlot {
  age: number;
  active: boolean;
}

interface ArcOverride {
  hexBuild: number;
  roomBuild: number;
  macro: number;
  dim: number;
}

/**
 * "Homemakers" (hive rebuild) — the golden wax wall. One fullscreen
 * fragment shader (wallShader.ts) composites a hex comb lattice and a rect
 * room lattice negotiating every shared edge, plus an additive bees layer
 * (bees.ts) reprojected into the same view-relative space. Deterministic:
 * no sim, no warmup — every `?t=` lands exactly on the staged arc
 * (sections.ts).
 *
 * Debug: `?solo=wall|bees` isolates a layer, `?knock=always` forces a
 * steady ambient knock stream (verification affordance for the knock-glow
 * travel + boost pre-build), `?arc=hexBuild,roomBuild,macro,dim` force-
 * overrides those four continuous arc values (comma list of floats).
 */
class HiveWall implements Viz {
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.OrthographicCamera;
  private quad!: THREE.Mesh;
  private material!: THREE.ShaderMaterial;
  private bees!: Bees;

  private rand!: () => number;
  private soloWall = true;
  private soloBees = true;
  private forceKnockAlways = false;
  private arcOverride: ArcOverride | null = null;

  /** Cover-fit scale, computed in resize() — copied by value into both the wall and bees uniforms each frame/resize (see bees.ts's uCover doc comment on why not shared by reference). */
  private cover = new THREE.Vector2(1, 1);

  private bassE = 0;
  private midE = 0;
  private highE = 0;
  private bassSlowE = 0;
  private onsetCooldown = 0;
  private flash = 0;
  private flashTimeToNext = 0;
  private knockTimeToNext = 0;
  /** Previous frame's song time, for edge-triggered 54s/188s boundary detection (old a2-homemakers/index.ts idiom). */
  private lastSongTime = -1;

  private knockSlotCount = KNOCK_SLOTS_FULL;
  private knockBoosts: KnockSlot[] = [];
  private knockBoostUniformValues!: THREE.Vector4[];
  private knockGlows: KnockSlot[] = [];
  private knockGlowUniformValues!: THREE.Vector4[];

  /** Pointer/drag-pan state — all scalars, zero per-frame allocation (a1 momentum block, verbatim shape). */
  private held = false;
  private dragDx = 0;
  private dragDy = 0;
  private velX = 0;
  private velY = 0;

  init(ctx: VizContext) {
    const { renderer, seed, quality } = ctx;
    this.renderer = renderer;
    this.rand = mulberry32(seed ^ 0x40b1e5ee);

    const params = new URLSearchParams(location.search);
    const solo = params.get('solo');
    this.soloWall = !solo || solo === 'wall';
    this.soloBees = !solo || solo === 'bees';
    this.forceKnockAlways = params.get('knock') === 'always';
    const arcParam = params.get('arc');
    if (arcParam) {
      const parts = arcParam.split(',').map(Number);
      if (parts.length === 4 && parts.every(Number.isFinite)) {
        this.arcOverride = { hexBuild: parts[0], roomBuild: parts[1], macro: parts[2], dim: parts[3] };
      }
    }

    const full = quality.level === 'full';
    this.knockSlotCount = full ? KNOCK_SLOTS_FULL : KNOCK_SLOTS_LITE;
    for (let i = 0; i < this.knockSlotCount; i++) this.knockBoosts.push({ age: 0, active: false });
    this.knockBoostUniformValues = [];
    for (let i = 0; i < this.knockSlotCount; i++) this.knockBoostUniformValues.push(new THREE.Vector4(0, 0, 0, 0));
    for (let i = 0; i < this.knockSlotCount; i++) this.knockGlows.push({ age: 0, active: false });
    this.knockGlowUniformValues = [];
    for (let i = 0; i < this.knockSlotCount; i++) this.knockGlowUniformValues.push(new THREE.Vector4(0, 0, 0, 0));

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    const geometry = new THREE.PlaneGeometry(2, 2);
    const seedFloat = ((seed >>> 0) % 100000) / 100000;
    this.material = new THREE.ShaderMaterial({
      vertexShader: WALL_VERT,
      fragmentShader: buildWallFragmentShader(full, this.knockSlotCount),
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uSeed: { value: seedFloat },
        uHexR: { value: HEX_R },
        uRoomSize: { value: ROOM_SIZE },
        uCover: { value: new THREE.Vector2(1, 1) },
        uScroll: { value: new THREE.Vector2(0, 0) },
        uZoom: { value: 1 },
        uHexBuild: { value: 0 },
        uRoomBuild: { value: 0 },
        uMacro: { value: 0 },
        uDim: { value: 0 },
        uWallGlow: { value: 0 },
        uHoneyFill: { value: 0 },
        uRoomLight: { value: 0 },
        uShimmer: { value: 0 },
        uPalMix: { value: 0 },
        uHueVar: { value: 0 },
        uBass: { value: 0 },
        uMid: { value: 0 },
        uHigh: { value: 0 },
        uFlash: { value: 0 },
        uKnockBoost: { value: this.knockBoostUniformValues },
        uKnockGlow: { value: this.knockGlowUniformValues },
      },
    });
    this.quad = new THREE.Mesh(geometry, this.material);
    if (this.soloWall) this.scene.add(this.quad);

    this.bees = new Bees(seed, quality, renderer);
    if (this.soloBees) this.scene.add(this.bees.object);

    const canvas = renderer.domElement;
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    this.resize(w, h);
  }

  private kickFlash(amount: number) {
    this.flash = Math.min(FLASH_CEILING, this.flash + amount);
  }

  private activateKnockBoost(x: number, y: number, strength = 1) {
    // Reuse-or-steal idiom, mirroring a1's SeedSlot/RippleSlot pools.
    let idx = this.knockBoosts.findIndex((s) => !s.active);
    if (idx < 0) idx = 0;
    const slot = this.knockBoosts[idx];
    slot.active = true;
    slot.age = 0;
    this.knockBoostUniformValues[idx].set(x, y, 0, strength);
  }

  private activateKnockGlow(x: number, y: number, strength = 1) {
    let idx = this.knockGlows.findIndex((s) => !s.active);
    if (idx < 0) idx = 0;
    const slot = this.knockGlows[idx];
    slot.active = true;
    slot.age = 0;
    this.knockGlowUniformValues[idx].set(x, y, 0, strength);
  }

  /**
   * Ages both knock pools. `w` is left constant at its activation strength
   * for the shader's own exp(-age*k) curves to decay (matching a1's
   * RippleSlot pattern, not its linearly-decayed SeedSlot pattern) — a
   * hard cutoff at the lifetime just retires the slot for reuse.
   */
  private updateKnockAges(dt: number) {
    for (let i = 0; i < this.knockBoosts.length; i++) {
      const slot = this.knockBoosts[i];
      if (!slot.active) continue;
      slot.age += dt;
      if (slot.age >= KNOCK_BOOST_LIFETIME) {
        slot.active = false;
        this.knockBoostUniformValues[i].w = 0;
      } else {
        this.knockBoostUniformValues[i].z = slot.age;
      }
    }
    for (let i = 0; i < this.knockGlows.length; i++) {
      const slot = this.knockGlows[i];
      if (!slot.active) continue;
      slot.age += dt;
      if (slot.age >= KNOCK_GLOW_LIFETIME) {
        slot.active = false;
        this.knockGlowUniformValues[i].w = 0;
      } else {
        this.knockGlowUniformValues[i].z = slot.age;
      }
    }
  }

  private scheduleFlash(dt: number, ratePerMinute: number) {
    // Poisson process, same idiom as a1's scheduleSeeds.
    const rate = Math.max(0, ratePerMinute) / 60;
    if (rate <= 0) return;
    this.flashTimeToNext -= dt;
    while (this.flashTimeToNext <= 0) {
      this.kickFlash(FLASH_KICK_AMBIENT);
      const u = Math.max(1e-6, this.rand());
      this.flashTimeToNext += -Math.log(u) / rate;
    }
  }

  private scheduleKnocks(dt: number, ratePerMinute: number) {
    const rate = Math.max(0, ratePerMinute) / 60;
    if (rate <= 0) return;
    this.knockTimeToNext -= dt;
    while (this.knockTimeToNext <= 0) {
      const wx = (this.rand() * 2 - 1) * AMBIENT_KNOCK_SPAN_X;
      const wy = (this.rand() * 2 - 1) * AMBIENT_KNOCK_SPAN_Y;
      this.activateKnockBoost(wx, wy, 0.6);
      this.activateKnockGlow(wx, wy, 0.6);
      const u = Math.max(1e-6, this.rand());
      this.knockTimeToNext += -Math.log(u) / rate;
    }
  }

  update(dt: number, audio: AudioFrame) {
    const section = paramsAt(audio.time);
    const arc = arcAt(audio.time);
    const p = section.params;

    // The two drops land as discrete hits, not crossfades — same edge-
    // triggered detection as the old a2-homemakers/index.ts. The `< 0.5`
    // guard rejects the ?t= dev-seed jump and the 294->0 loop wrap as
    // false triggers (a normal frame's dt never approaches that).
    if (this.lastSongTime >= 0 && audio.time - this.lastSongTime >= 0 && audio.time - this.lastSongTime < 0.5) {
      if (this.lastSongTime < 54 && audio.time >= 54) this.kickFlash(FLASH_KICK_BOUNDARY_54);
      if (this.lastSongTime < 188 && audio.time >= 188) this.kickFlash(FLASH_KICK_BOUNDARY_188);
    }
    this.lastSongTime = audio.time;

    // Smooth audio bands with EMAs (a1 idiom) so reactivity isn't jittery.
    const k = Math.min(1, dt * 8);
    this.bassE += (audio.bass - this.bassE) * k;
    this.midE += (audio.mid - this.midE) * k;
    this.highE += (audio.high - this.highE) * k;
    this.bassSlowE += (audio.bass - this.bassSlowE) * Math.min(1, dt * 1.5);

    // Bass-onset detector: excess over its own slow EMA kicks the flash
    // and an ambient knock (a1's ONSET_THRESHOLD/ONSET_COOLDOWN pattern).
    this.onsetCooldown -= dt;
    if (this.onsetCooldown <= 0 && this.bassE - this.bassSlowE > ONSET_THRESHOLD) {
      this.kickFlash(FLASH_KICK_ONSET);
      const wx = (this.rand() * 2 - 1) * AMBIENT_KNOCK_SPAN_X;
      const wy = (this.rand() * 2 - 1) * AMBIENT_KNOCK_SPAN_Y;
      this.activateKnockBoost(wx, wy);
      this.activateKnockGlow(wx, wy);
      this.onsetCooldown = ONSET_COOLDOWN;
    }

    this.scheduleFlash(dt, p.flashRate);
    this.flash *= Math.exp(-FLASH_DECAY * dt);

    this.scheduleKnocks(dt, this.forceKnockAlways ? DEBUG_KNOCK_RATE : p.knockRate);
    this.updateKnockAges(dt);

    const du = this.material.uniforms;
    du.uTime.value += dt;
    du.uBass.value = this.bassE;
    du.uMid.value = this.midE;
    du.uHigh.value = this.highE;
    du.uFlash.value = this.flash;

    du.uHexBuild.value = this.arcOverride?.hexBuild ?? arc.hexBuild;
    du.uRoomBuild.value = this.arcOverride?.roomBuild ?? arc.roomBuild;
    du.uMacro.value = this.arcOverride?.macro ?? arc.macro;
    du.uDim.value = this.arcOverride?.dim ?? arc.dim;

    du.uWallGlow.value = p.wallGlow;
    du.uHoneyFill.value = p.honeyFill;
    du.uRoomLight.value = p.roomLight;
    du.uShimmer.value = p.shimmer;
    du.uPalMix.value = p.palMix;
    du.uHueVar.value = p.hueVar;

    const zoom = p.zoom;
    du.uZoom.value = zoom;

    // Ambient wall-space scroll drift — mid nudges pace, matching a1's march.
    const scroll = du.uScroll.value as THREE.Vector2;
    const driftPace = 1 + audio.mid * 0.3;
    scroll.x += p.driftX * dt * driftPace;
    scroll.y += p.driftY * dt * driftPace;

    // Drag momentum: composes additively on top of the act's drift above.
    // While held, EMA this frame's accumulated drag into an instantaneous
    // velocity; after release, integrate it into scroll with exponential
    // friction so a flung drag glides to a stop (a1 idiom, verbatim shape).
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
      scroll.x += (this.velX * cover.x / zoom) * dt;
      scroll.y += (this.velY * cover.y / zoom) * dt;
      const friction = Math.exp(-MOMENTUM_FRICTION * dt);
      this.velX *= friction;
      this.velY *= friction;
      if (Math.abs(this.velX) < MOMENTUM_STOP_SPEED) this.velX = 0;
      if (Math.abs(this.velY) < MOMENTUM_STOP_SPEED) this.velY = 0;
    }

    // Pan clamp: soft radius around the seed origin — hitting it zeroes
    // momentum rather than letting a fling coast past it.
    const panDist = Math.hypot(scroll.x, scroll.y);
    if (panDist > MAX_PAN) {
      scroll.x *= MAX_PAN / panDist;
      scroll.y *= MAX_PAN / panDist;
      this.velX = 0;
      this.velY = 0;
    }

    this.bees.update(dt, audio, section, arc, zoom, cover, this.flash);
  }

  pointer(e: VizPointerEvent) {
    const du = this.material.uniforms;
    const cover = this.cover;
    const zoom = du.uZoom.value as number;
    const scroll = du.uScroll.value as THREE.Vector2;

    if (e.type === 'down') {
      this.held = true;
      this.dragDx = 0;
      this.dragDy = 0;
      this.velX = 0; // grabbing kills any in-flight momentum glide
      this.velY = 0;

      // Screen uv -> wall-space, via the wall shader's own formula
      // ((vUv-0.5)*uCover/uZoom + uScroll). No wrap here (unlike a1's
      // field-uv poke) — the wall is unbounded, so a raw wall-space
      // position is always valid.
      const wx = (e.x - 0.5) * cover.x / zoom + scroll.x;
      const wy = (e.y - 0.5) * cover.y / zoom + scroll.y;
      this.activateKnockBoost(wx, wy);
      this.activateKnockGlow(wx, wy);
      return;
    }

    if (e.type === 'move') {
      if (!this.held) return;
      // 1:1 finger tracking, derived directly from the wall-space formula.
      scroll.x += (e.dx * cover.x) / zoom;
      scroll.y += (e.dy * cover.y) / zoom;
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

  resize(w: number, h: number) {
    if (!this.material || w <= 0 || h <= 0) return;
    const aspect = w / h;
    // Hexes stay regular regardless of viewport aspect.
    if (aspect >= 1) this.cover.set(aspect, 1);
    else this.cover.set(1, 1 / aspect);
    (this.material.uniforms.uCover.value as THREE.Vector2).copy(this.cover);
  }

  dispose() {
    this.material.dispose();
    this.quad.geometry.dispose();
    this.bees.dispose();
    this.renderer.setRenderTarget(null);
  }
}

const mod: VizModule = { default: () => new HiveWall() };
export default mod.default;
