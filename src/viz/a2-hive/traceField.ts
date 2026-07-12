import * as THREE from 'three';
import { ROOM_SPLIT_GLSL_CHUNK, HEX_R, ROOM_SIZE, REGION_HALF } from './wallShader';

/**
 * The trace field — a persistent ping-pong FBO in bounded wall space that
 * lets the two worlds (chalk-line events, crawler wander) leave lasting
 * marks on the wall shader's otherwise pure-function-of-uniforms render.
 * Mirrors a1-primordial's `RDSim` class shape (own scene/camera/quad, two
 * half-float render targets, `step()`/`texture`/`dispose()`), but the sim
 * itself is much simpler than Gray-Scott: no neighbour sampling, no
 * diffusion — each texel just decays or gets max()'d against this frame's
 * deposits, so a single render pass per frame (not RDSim's step(n) tick
 * loop) is enough.
 *
 * Three channels, one texture:
 *  - R = line-cut damage. Chalk lines gouge a scar (segment-SDF deposit)
 *    that HEALS: `max(prev.r * uDecayR, deposit)`, uDecayR = exp(-dt/8) so
 *    a fresh scar fades back to invisible over ~8s even while new cuts keep
 *    landing elsewhere — "a conflict we heal from as progress is still
 *    being made" (Alex's round-3 note).
 *  - G = crawler-dim trail. Wherever a Homemaker has walked recently, a
 *    gaussian splat darkens bright honey cells (the contrast inversion:
 *    dark ground already reveals hexagons via the existing crawler-boost
 *    mechanic; BRIGHT ground needs the opposite cue for the path to keep
 *    reading). Fades faster than damage, uDecayG = exp(-dt/3).
 *  - B = room-build trace. THE SAME crawler splat also burns permanently
 *    into B — `max(prev.b, splat)` with NO decay term at all. This is the
 *    field the wall shader gates room reveal on: rooms appear only where a
 *    crawler has actually walked, which is the whole point ("rooms appear
 *    only where crawlers have actually walked — unvisited territory shows
 *    no boxes, that IS the narrative"). A decaying B would make finished
 *    construction flicker back to invisible ground, which reads as
 *    breakage, not narrative. The only way B resets is the seed pass.
 *
 * Bounded region, not the whole (unbounded) wall plane: `REGION_HALF = 2.6`
 * wall-uv units either side of the origin. Index.ts's pan clamp
 * (`MAX_PAN = 8*HEX_R`) plus the widest cover-fit/zoom combination bounds
 * the wall-space area the camera can ever actually show to
 * `0.5*cover/zoomMin + MAX_PAN ≈ 2.62` — REGION_HALF covers that with a
 * hair of margin. `resize()` additionally clamps aspect to [0.28, 3.5]; the
 * true unclamped extreme (~3.69) is a rare degenerate-resize case accepted
 * as soft ClampToEdge degradation at the far periphery rather than
 * inflating the region (and the resolution cost) for everyone. Do NOT
 * raise REGION_HALF to chase that last edge case.
 *
 * The deposit pass reads the SAME pooled Vector4 arrays (uLineA/uLineMeta/
 * uCrawler) index.ts already maintains for the wall material — passed into
 * this class's uniforms BY REFERENCE in the constructor, never copied, so
 * a single per-frame write in index.ts is visible to both shaders with
 * zero extra allocation or bookkeeping.
 */

const VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/** Deposit line half-width (wall-uv units) — wider than the wall shader's 0.005 visual chalk stroke so the scar reads clearly even before AA/decay softening. */
const LINE_HALF_DEPOSIT = 0.012;

/** Channel decay time constants (seconds) — R (damage) heals slower than G (crawler-dim trail); B (build trace) has no decay term at all (see class doc). */
const DECAY_TAU_R = 8;
const DECAY_TAU_G = 3;

/** Field resolution (square — the region is a bounded square in wall-uv space, not viewport-aspect-shaped). */
const RESOLUTION_FULL = 1024;
const RESOLUTION_LITE = 512;

/** Crawler splat radius (wall-uv units), as a multiple of HEX_R. Lite's is wider to compensate its coarser texel density rather than raising Lite's resolution (cost discipline — see the constants table in the plan). */
const CRAWLER_SPLAT_FULL = 0.4 * HEX_R;
const CRAWLER_SPLAT_LITE = 0.55 * HEX_R;

function depositFragmentSource(lineSlots: number, crawlerSlots: number, crawlerSplatR: number): string {
  return `
precision highp float;
varying vec2 vUv;
uniform sampler2D uPrev;
uniform float uDecayR, uDecayG;
uniform vec4 uLineA[${lineSlots}];
uniform vec4 uLineMeta[${lineSlots}];
uniform vec4 uCrawler[${crawlerSlots}];

const float REGION_HALF = ${REGION_HALF.toFixed(2)};
const float LINE_HALF_DEPOSIT = ${LINE_HALF_DEPOSIT.toFixed(4)};
const float CRAWLER_SPLAT_R = ${crawlerSplatR.toFixed(6)};

// Distance from p to the segment a->b, but only tracing it up to 'prog'
// (0..1) of the way — matches the wall shader's travelling-head reveal, so
// the scar only gouges the portion of the line actually drawn so far. The
// abLen2 == 0 guard covers a degenerate (zero-length) segment so t never
// divides by zero and NaNs the whole deposit invisible.
float segDistProgress(vec2 p, vec2 a, vec2 b, float prog) {
  vec2 ab = b - a;
  float abLen2 = dot(ab, ab);
  float t = abLen2 > 1e-8 ? clamp(dot(p - a, ab) / abLen2, 0.0, prog) : 0.0;
  return length(p - (a + ab * t));
}

void main() {
  vec2 wallUv = vUv * (2.0 * REGION_HALF) - REGION_HALF;
  vec4 prev = texture2D(uPrev, vUv);

  // ---- R: line-cut damage. Deposit strength ignores the wall shader's own
  // visual fade curve (that's the bright chalk stroke fading in ~1-2s) —
  // the scar's lifetime is governed entirely by uDecayR (~8s), independent
  // of how quickly the stroke itself fades from view. ----
  float rDeposit = 0.0;
  for (int i = 0; i < ${lineSlots}; i++) {
    vec4 la = uLineA[i]; vec4 lm = uLineMeta[i];
    if (lm.y <= 0.0) continue;
    float prog = clamp(lm.x * 2.0, 0.0, 1.0);
    float d = segDistProgress(wallUv, la.xy, la.zw, prog);
    float mark = (1.0 - smoothstep(LINE_HALF_DEPOSIT, LINE_HALF_DEPOSIT * 2.5, d)) * lm.y;
    rDeposit = max(rDeposit, mark);
  }
  float r = max(prev.r * uDecayR, rDeposit);

  // ---- G/B: crawler splat, shared between the fading dim-trail (G) and the
  // permanent build-trace (B) — same gaussian, different persistence. ----
  float splat = 0.0;
  for (int i = 0; i < ${crawlerSlots}; i++) {
    vec4 cw = uCrawler[i];
    if (cw.w <= 0.0) continue;
    vec2 d = wallUv - cw.xy;
    float g = exp(-dot(d, d) / (CRAWLER_SPLAT_R * CRAWLER_SPLAT_R)) * cw.w;
    splat = max(splat, g);
  }
  float gOut = max(prev.g * uDecayG, splat);
  // No decay term on B at all — permanent construction trace, reset only by
  // the seed pass (see class doc: a decaying B would make finished rooms
  // flicker back to invisible, which reads as breakage, not narrative).
  float bOut = max(prev.b, splat);

  gl_FragColor = vec4(r, gOut, bOut, 1.0);
}
`;
}

function seedFragmentSource(): string {
  return `
precision highp float;
varying vec2 vUv;
uniform float uRoomBuildAtSeed;
uniform float uSeed, uRoomSize;

const float REGION_HALF = ${REGION_HALF.toFixed(2)};

float hash21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

${ROOM_SPLIT_GLSL_CHUNK}

void main() {
  // Pre-trace B for every cell that "should" already be built at the
  // current uRoomBuildAtSeed — run once at init and again on every loop-wrap
  // so a '?t=210' deep link (or a mid-song quality-toggle reload, which
  // reruns init()) lands on a scene that already looks constructed instead
  // of a bare hex comb waiting for crawlers to catch up in real time. Uses
  // ROOM_SPLIT_GLSL_CHUNK — the SAME source text the wall shader compiles,
  // so on the same GPU this is bit-identical to "would the wall shader
  // currently draw this room interior".
  vec2 wallUv = vUv * (2.0 * REGION_HALF) - REGION_HALF;
  vec2 cellMin, cellMax;
  float roomBirth;
  computeRoomBirth(wallUv, cellMin, cellMax, roomBirth);
  gl_FragColor = vec4(0.0, 0.0, step(roomBirth, uRoomBuildAtSeed), 1.0);
}
`;
}

export class TraceField {
  private renderer: THREE.WebGLRenderer;
  private targets: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
  private readIndex = 0;
  private scene: THREE.Scene;
  private camera: THREE.OrthographicCamera;
  private quad: THREE.Mesh;
  private depositMaterial: THREE.ShaderMaterial;
  private seedMaterial: THREE.ShaderMaterial;

  constructor(
    renderer: THREE.WebGLRenderer,
    full: boolean,
    lineSlots: number,
    crawlerSlots: number,
    seedFloat: number,
    /** Pooled Vector4 arrays owned by index.ts's HiveWall — shared BY REFERENCE, never copied (see class doc comment). */
    lineAValues: THREE.Vector4[],
    lineMetaValues: THREE.Vector4[],
    crawlerValues: THREE.Vector4[],
  ) {
    this.renderer = renderer;

    const resolution = full ? RESOLUTION_FULL : RESOLUTION_LITE;
    const rtOpts: THREE.RenderTargetOptions = {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      // ClampToEdge, not Repeat: the region is a bounded rectangle in an
      // unbounded wall plane (see class doc's REGION_HALF derivation), so
      // there is no wraparound semantics to preserve — periphery texels
      // just hold their edge value, a soft (accepted) degradation for the
      // rare extreme-aspect case that falls outside REGION_HALF.
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      depthBuffer: false,
      stencilBuffer: false,
    };
    this.targets = [
      new THREE.WebGLRenderTarget(resolution, resolution, rtOpts),
      new THREE.WebGLRenderTarget(resolution, resolution, rtOpts),
    ];

    const crawlerSplatR = full ? CRAWLER_SPLAT_FULL : CRAWLER_SPLAT_LITE;

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const geometry = new THREE.PlaneGeometry(2, 2);

    this.depositMaterial = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: depositFragmentSource(lineSlots, crawlerSlots, crawlerSplatR),
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uPrev: { value: null },
        uDecayR: { value: 1 },
        uDecayG: { value: 1 },
        uLineA: { value: lineAValues },
        uLineMeta: { value: lineMetaValues },
        uCrawler: { value: crawlerValues },
      },
    });

    this.seedMaterial = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: seedFragmentSource(),
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uRoomBuildAtSeed: { value: 0 },
        uSeed: { value: seedFloat },
        uRoomSize: { value: ROOM_SIZE },
      },
    });

    this.quad = new THREE.Mesh(geometry, this.depositMaterial);
    this.scene.add(this.quad);

    // Field starts at (0,0,0,1) either way (WebGL clears new render targets
    // to transparent black) but seed() is always called explicitly by
    // index.ts on firstUpdate, so no seeding happens here in the
    // constructor — unlike RDSim, whose Gray-Scott field needs an inert
    // non-zero A=1 base to avoid undefined math on the first tick. This
    // field's decay/max formulas are well-defined starting from all-zero.
  }

  /**
   * Runs one deposit pass, advancing R/G's decay by `dt` and depositing this
   * frame's live line/crawler state. A single pass per frame is enough —
   * unlike RDSim's diffusion, which needs many ticks/frame to converge,
   * this field has no neighbour coupling (see class doc), so one texel-local
   * update per frame is already exact.
   */
  step(dt: number): void {
    this.depositMaterial.uniforms.uDecayR.value = Math.exp(-dt / DECAY_TAU_R);
    this.depositMaterial.uniforms.uDecayG.value = Math.exp(-dt / DECAY_TAU_G);

    const prevTarget = this.renderer.getRenderTarget();
    const read = this.targets[this.readIndex];
    const write = this.targets[1 - this.readIndex];
    this.depositMaterial.uniforms.uPrev.value = read.texture;
    this.quad.material = this.depositMaterial;
    this.renderer.setRenderTarget(write);
    this.renderer.render(this.scene, this.camera);
    this.readIndex = 1 - this.readIndex;
    this.renderer.setRenderTarget(prevTarget ?? null);
  }

  /**
   * Pre-traces B (room-build) for `roomBuildAtSeed`, writing into BOTH
   * targets so whichever one is "read" next is already correct regardless
   * of ping-pong parity. Called by index.ts on firstUpdate (covers cold
   * loads, deep links, and quality-toggle reloads, since those all rerun
   * init()) and again on loop-wrap detection, so scars/build state reset
   * with the song rather than persisting into a new play from a stale
   * field.
   */
  seed(roomBuildAtSeed: number): void {
    this.seedMaterial.uniforms.uRoomBuildAtSeed.value = roomBuildAtSeed;
    const prevTarget = this.renderer.getRenderTarget();
    this.quad.material = this.seedMaterial;
    for (const t of this.targets) {
      this.renderer.setRenderTarget(t);
      this.renderer.render(this.scene, this.camera);
    }
    this.renderer.setRenderTarget(prevTarget ?? null);
    this.quad.material = this.depositMaterial;
  }

  get texture(): THREE.Texture {
    return this.targets[this.readIndex].texture;
  }

  dispose(): void {
    this.targets[0].dispose();
    this.targets[1].dispose();
    this.depositMaterial.dispose();
    this.seedMaterial.dispose();
    this.quad.geometry.dispose();
  }
}
