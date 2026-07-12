/**
 * The golden wax wall — one fullscreen fragment shader combining a pointy-top
 * hex comb lattice with a rectangular human-room lattice, negotiating every
 * shared edge (the signature "dual-lattice negotiation" element). Both
 * lattices share the same wall-space uv and birth-order growth idiom;
 * everything else (which one wins where, the boundary shimmer, the macro
 * background comb, the knock pulses) is composited in `wallFragmentSource`.
 *
 * Quality is baked at shader-source build time (`buildWallFragmentShader`),
 * not read via a uniform branch: the AA method (fwidth vs a fixed epsilon),
 * honey-fill octave count, and knock slot count are all string-interpolated
 * into the source once at init, matching the "quality baked at init" rule —
 * a mid-song quality change rebuilds the whole module (VizHost.reloadCurrent),
 * so there's never a need for a live uniform toggle here.
 */

/** Pointy-top hex cell radius (wall-uv units) — ~12 hexes across the frame at zoom 1 (dense micro-ecosystem, per the art-direction reset). */
export const HEX_R = 0.055;
/** Chebyshev hex-ring distance at which birth order saturates to 1 (fully built).
 * Scaled to the VISIBLE field: the viewport spans ~7 rings at zoom 1 (hexR
 * 0.055) and the pan clamp adds ~5 more — 16 keeps the build wave crossing
 * on-screen territory for the whole track instead of outrunning it early. */
export const HEX_MAX_RING = 16;
/** Per-cell birth-order jitter (in ring units) so same-ring cells don't all pop together. */
export const HEX_JITTER = 3.5;
/** Rect room half-cell size (wall-uv units) — several hexes across, per plan. */
export const ROOM_SIZE = 0.6;
/** Chebyshev room-ring distance at which birth order saturates — rooms are
 * coarse (0.6 wall units), so only ~2 rings are ever visible: keep this small
 * or every visible room is built the moment roomBuild leaves zero. */
export const ROOM_MAX_RING = 4;
/** Per-cell birth-order jitter for rooms, in ring units. */
export const ROOM_JITTER = 1.2;
/** Growth crossfade band (in birth-order units) — cells grow in, never pop. */
export const GROW_BAND = 0.05;
/** Half-width of the drawn hex wall line (wall-uv units). */
export const HEX_WALL_HALF = 0.005;
/** Half-width of the drawn room wall line (wall-uv units) — slightly thicker, blockier construction. */
export const ROOM_WALL_HALF = 0.008;
/** Max |hexEdge - roomEdge| for the boundary-shimmer accent to fire — "nearly coincide". */
export const BOUNDARY_BAND = 0.006;
/** Lights-out dim crossfade band (birth-order units) — matches GROW_BAND's role in reverse. */
export const DIM_BAND = 0.08;
/** Macro background comb scale relative to HEX_R, revealed by uMacro at the climax. */
export const MACRO_SCALE = 7.0;
/** Radius (wall-uv units) within which a knock-boost slot pre-builds neighbouring cells. */
export const KNOCK_BOOST_RADIUS = 3.0 * HEX_R;

/**
 * Half-width (wall-uv units) of the bounded region traceField.ts's ping-pong
 * FBO covers; texUv = (wallUv + REGION_HALF) / (2*REGION_HALF). The wall
 * itself is an unbounded plane (index.ts never wraps it), but the reachable
 * territory is bounded by index.ts's pan clamp (`MAX_PAN = 8*HEX_R ≈ 0.44`)
 * combined with the widest cover-fit/zoom combination the camera ever
 * shows: worst case ≈ `0.5*cover/zoomMin + MAX_PAN ≈ 2.62`. 2.6 covers that
 * with a hair of margin. index.ts's resize() additionally clamps aspect to
 * [0.28, 3.5]; the true unclamped extreme (~3.69, a rare degenerate-resize
 * case) is accepted as soft ClampToEdge degradation at the far periphery
 * rather than inflating the region (and its resolution cost) for everyone —
 * do not raise this to chase that last edge case. Defined here (not in
 * traceField.ts) so both wallShader.ts's own texture-fetch math and
 * traceField.ts's inverse mapping read from one source of truth.
 */
export const REGION_HALF = 2.6;

/** Knock pool sizes (both boost and glow use the same count): Lite halves Full. */
export const KNOCK_SLOTS_FULL = 4;
export const KNOCK_SLOTS_LITE = 2;

/** Knock-boost slot lifetime (seconds) — matches the shader's exp(-age*2) decay window. */
export const KNOCK_BOOST_LIFETIME = 0.5;
/** Knock-glow ring lifetime (seconds) — matches the shader's exp(-age*3.2) decay window. */
export const KNOCK_GLOW_LIFETIME = 1.1;

/**
 * The five hex-lattice seed cells (axial q,r), source of truth for both the
 * shader's birth-order field (`hexRing`) and the CPU crawler system's
 * `hexBirthApprox` neighbour-choice heuristic (index.ts). Exported as data
 * rather than left as inline GLSL literals — before this change the shader
 * and any CPU-side hex math had no shared source, and a CPU replication
 * would silently drift out of sync the next time someone tuned a seed.
 */
export const HEX_SEEDS: readonly [number, number][] = [[0, 0], [7, -5], [-5, 7], [9, 2], [-8, -3]];

/** Homemakers crawler slot count: Full 10 / Lite 5, baked into the shader like knockSlots/lineSlots. */
export const CRAWLER_SLOTS_FULL = 10;
export const CRAWLER_SLOTS_LITE = 5;

/** Crawler silhouette half-length/width (wall-uv units) — small dark elongated body. */
export const CRAWLER_LEN = 0.5 * HEX_R;
export const CRAWLER_WID = 0.22 * HEX_R;
/** Crawler ember wake half-length/width (wall-uv units) — trails behind the heading. */
export const WAKE_LEN = 1.6 * HEX_R;
export const WAKE_WID = 0.5 * HEX_R;

/**
 * Radius (wall-uv units) within which a crawler-boost slot pre-builds the
 * cell it's currently standing on (+ a small rim) — much tighter than
 * KNOCK_BOOST_RADIUS because only the single cell underfoot should visibly
 * "finish" as the crawler passes, not a whole neighbourhood.
 */
export const CRAWLER_BOOST_RADIUS = 1.5 * HEX_R;

/** Chalk-line pool sizes: Lite halves (rounds down from) Full. */
export const LINE_SLOTS_FULL = 6;
export const LINE_SLOTS_LITE = 3;

/** Chalk-line lifetime (seconds) — head travels A->B in the first 0.5s, then the line persists and fades (shader's exp(-max(age-0.5,0)*2.5) curve); the slot is freed once it's visually gone. */
export const LINE_LIFETIME = 1.6;
/** Minimum accepted spawn length (wall-uv units) — shorter segments are rejected and resampled. */
export const LINE_MIN_LENGTH = 0.3;

/** Trivial fullscreen-quad passthrough — identical idiom to a1-primordial's VERT. */
export const WALL_VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/**
 * The rect-room lattice's irregular hierarchical binary split — a floor
 * plan, not graph paper. Each uRoomSize block optionally splits once
 * (level 1, either axis) and, within that sub-cell, optionally splits again
 * (level 2, FORCED to the other axis so a block never slivers along one
 * direction). Both levels carry a MIN_ROOM_DIM guard: a split that would
 * leave either resulting piece thinner than a closet is skipped, and the
 * block/sub-cell stays whole. Two levels max — a third level was tried and
 * rejected (wall-dominated slivers).
 *
 * Factored out of buildWallFragmentShader (taste round 3) so traceField.ts's
 * seed pass can interpolate the SAME source text — it needs to know which
 * cells "should" be built by a given roomBuild value to pre-trace deep
 * links, and only identical GLSL run on the same GPU is guaranteed to agree
 * bit-for-bit with what the wall shader itself draws. Requires `hash21` and
 * the `uSeed`/`uRoomSize` uniforms already declared in scope; produces the
 * `cellMin`/`cellMax` bounds the wall shader needs for its box SDF plus this
 * cell's birth-order value (roomGrow's smoothstep against uRoomBuild is left
 * to the caller — the seed shader compares against a different uniform name).
 */
export const ROOM_SPLIT_GLSL_CHUNK = `
void computeRoomBirth(vec2 wallUv, out vec2 cellMin, out vec2 cellMax, out float roomBirth) {
  vec2 baseId = floor(wallUv / uRoomSize);
  cellMin = baseId * uRoomSize; cellMax = cellMin + uRoomSize;
  const float MIN_ROOM_DIM = 0.14;
  float h1 = hash21(baseId + uSeed);
  bool splitX = h1 < 0.4;
  if (h1 < 0.8) {
    float ratio = 0.35 + fract(h1 * 7.31) * 0.3;
    if (splitX) {
      float cut = cellMin.x + (cellMax.x - cellMin.x) * ratio;
      float dimA = cut - cellMin.x, dimB = cellMax.x - cut;
      if (dimA >= MIN_ROOM_DIM && dimB >= MIN_ROOM_DIM) {
        if (wallUv.x < cut) cellMax.x = cut; else cellMin.x = cut;
      }
    } else {
      float cut = cellMin.y + (cellMax.y - cellMin.y) * ratio;
      float dimA = cut - cellMin.y, dimB = cellMax.y - cut;
      if (dimA >= MIN_ROOM_DIM && dimB >= MIN_ROOM_DIM) {
        if (wallUv.y < cut) cellMax.y = cut; else cellMin.y = cut;
      }
    }

    // Level 2: forced to the axis level 1 did NOT use, sampled from the
    // level-1 sub-cell (so it's independent per sub-cell, not per block).
    float h2 = hash21(cellMin * 31.7 + uSeed);
    if (h2 < 0.5) {
      float ratio2 = 0.4 + fract(h2 * 11.3) * 0.2;
      if (!splitX) {
        float cut2 = cellMin.x + (cellMax.x - cellMin.x) * ratio2;
        float dimA2 = cut2 - cellMin.x, dimB2 = cellMax.x - cut2;
        if (dimA2 >= MIN_ROOM_DIM && dimB2 >= MIN_ROOM_DIM) {
          if (wallUv.x < cut2) cellMax.x = cut2; else cellMin.x = cut2;
        }
      } else {
        float cut2 = cellMin.y + (cellMax.y - cellMin.y) * ratio2;
        float dimA2 = cut2 - cellMin.y, dimB2 = cellMax.y - cut2;
        if (dimA2 >= MIN_ROOM_DIM && dimB2 >= MIN_ROOM_DIM) {
          if (wallUv.y < cut2) cellMax.y = cut2; else cellMin.y = cut2;
        }
      }
    }
  }

  vec2 roomIdEff = cellMin; // unique per room; do NOT quantize
  float roomHash = hash21(roomIdEff * 2.3 + uSeed + 91.7);
  float roomRing = max(abs(baseId.x), abs(baseId.y)); // birth wave stays keyed to the coarse block
  roomBirth = clamp((roomRing + roomHash * ${ROOM_JITTER.toFixed(2)}) / ${ROOM_MAX_RING.toFixed(1)}, 0.0, 1.0);
}
`;

/** Nested `min(hexDist(hexId, seed0), min(hexDist(hexId, seed1), ...))` GLSL expression over all `n` generated seed vars — mirrors the hand-written chain this replaced, just generated so it always matches HEX_SEEDS' length. */
function hexSeedMinChain(n: number): string {
  function build(i: number): string {
    if (i === n - 1) return `hexDist(hexId, seed${i})`;
    return `min(hexDist(hexId, seed${i}), ${build(i + 1)})`;
  }
  return build(0);
}

/**
 * Builds the wall fragment shader source. `full` bakes in fwidth()-based AA
 * and a 2-octave honey wobble (vs. a fixed-epsilon AA and 1 octave on Lite);
 * `knockSlots` bakes the uKnockBoost/uKnockGlow array length and loop bound;
 * `lineSlots` bakes the uLineA/uLineMeta array length and loop bound for the
 * chalk-line events (Full 6 / Lite 3); `crawlerSlots` bakes the
 * uCrawler/uCrawlerBoost array length and loop bound for the Homemakers
 * (Full 10 / Lite 5).
 */
export function buildWallFragmentShader(full: boolean, knockSlots: number, lineSlots: number, crawlerSlots: number): string {
  return `
precision highp float;
varying vec2 vUv;

uniform float uTime, uSeed;
uniform float uHexR, uRoomSize;
uniform vec2 uCover, uScroll;
uniform float uZoom;
uniform float uHexBuild, uRoomBuild, uMacro, uDim;
uniform float uWallGlow, uHoneyFill, uRoomLight, uShimmer, uPalMix, uHueVar;
uniform float uBass, uMid, uHigh, uFlash, uFlashCount;
uniform float uGhost, uBeatPulse;
// Dense beat-pulse channel: a second, faster event counter than uFlash,
// driving ONLY the beat-pulse cell-selection block below. uFlash stays as-is
// for windows/bees/big scene lifts — raising ITS rate to pulse-channel
// speeds (60-90/min) would strobe everything, not just the comb.
uniform float uPulse, uPulseCount;
uniform vec4 uKnockBoost[${knockSlots}];
uniform vec4 uKnockGlow[${knockSlots}];
uniform vec4 uLineA[${lineSlots}];
uniform vec4 uLineMeta[${lineSlots}];
// Homemakers: xy wall pos, z heading (rad), w strength 0..1.
uniform vec4 uCrawler[${crawlerSlots}];
// xy cell-center wall pos, z age (s), w strength 0..1 — dedicated array, NOT
// a reuse of uKnockBoost: knock is user-tap-facing feedback, and folding
// crawler pre-build into the same pool would let ambient crawler traffic
// steal/overwrite a tap's boost slot.
uniform vec4 uCrawlerBoost[${crawlerSlots}];
// Trace field (taste round 3): R = healing line-cut damage, G = fading
// crawler-dim trail, B = permanent room-build trace. uDamage scales how
// deep a fresh scar cuts (an ActParams-driven severity knob — see
// sections.ts's 'damage' field); the field's own healing/fade timescales
// live in traceField.ts and are NOT further modulated by uDamage.
uniform sampler2D uTrace;
uniform float uDamage;
// '?trace=off' debug isolation: forces the sampled trace to (0,0,1) below —
// zero damage, zero crawler-dim, roomReveal pinned to 1 — without skipping
// the texture2D() call itself (a real GPU op either way; the branch below
// is cheap uniform-driven select, not a shader recompile).
uniform float uTraceOff;

const float HEX_WALL_HALF = ${HEX_WALL_HALF.toFixed(4)};
const float ROOM_WALL_HALF = ${ROOM_WALL_HALF.toFixed(4)};
const float REGION_HALF = ${REGION_HALF.toFixed(2)};
// Chalk-line marks: a physical scratch (LINE_HALF) thinner than either wall
// line, a bbox reject margin (LINE_REACH), and a constant-screen-size head.
const float LINE_HALF = 0.005;
const float LINE_REACH = 0.03;
const float HEAD_R_SCREEN = 0.03;

// ---- hex lattice math (pointy-top axial) ----
vec2 pixelToAxial(vec2 p, float R){ return vec2((0.57735027*p.x - 0.33333333*p.y)/R, (0.66666667*p.y)/R); }
vec2 axialRound(vec2 qr){ float x=qr.x,z=qr.y,y=-x-z; float rx=floor(x+.5),ry=floor(y+.5),rz=floor(z+.5);
  float dx=abs(rx-x),dy=abs(ry-y),dz=abs(rz-z);
  if(dx>dy&&dx>dz)rx=-ry-rz; else if(dy>dz)ry=-rx-rz; else rz=-rx-ry; return vec2(rx,rz); }
vec2 axialToPixel(vec2 qr, float R){ return vec2(R*(1.7320508*qr.x+0.8660254*qr.y), R*1.5*qr.y); }
float hexDist(vec2 a, vec2 b){ vec3 ac=vec3(a.x,-a.x-a.y,a.y),bc=vec3(b.x,-b.x-b.y,b.y); vec3 d=abs(ac-bc); return max(d.x,max(d.y,d.z)); }
float sdHexagon(vec2 p, float r){ const vec3 k=vec3(-0.8660254,0.5,0.5773503); p=abs(p);
  p-=2.0*min(dot(k.xy,p),0.0)*k.xy; p-=vec2(clamp(p.x,-k.z*r,k.z*r),r); return length(p)*sign(p.y); }

// ---- rect room math ----
float sdBox(vec2 p, vec2 b){ vec2 d=abs(p)-b; return length(max(d,0.0))+min(max(d.x,d.y),0.0); }

// ---- chalk-line math ----
// Distance from p to the segment a->b, but only tracing it up to 'prog'
// (0..1) of the way — the travelling-head reveal. abLen2 == 0 guard covers
// a degenerate (zero-length, rejected-at-spawn-but-still-fading) segment so
// t never divides by zero and NaNs the whole line invisible.
float segDistProgress(vec2 p, vec2 a, vec2 b, float prog) {
  vec2 ab = b - a;
  float abLen2 = dot(ab, ab);
  float t = abLen2 > 1e-8 ? clamp(dot(p - a, ab) / abLen2, 0.0, prog) : 0.0;
  return length(p - (a + ab * t));
}

// ---- noise ----
float hash21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1,0)), u.x),
             mix(hash21(i + vec2(0,1)), hash21(i + vec2(1,1)), u.x), u.y);
}
// Honey wobble: 2 octaves on Full, 1 on Lite (baked — the costliest per-pixel
// term after the two lattice SDFs, so it's first in the perf cut order).
float honeyFbm(vec2 p){
  float v = 0.5 * vnoise(p);
${full ? `  p = p * 2.03 + 17.1;
  v += 0.25 * vnoise(p);` : ''}
  return v;
}

${ROOM_SPLIT_GLSL_CHUNK}

// Amber / honey / brown regional anchors — anti-monochrome (a1 lesson: flat
// palettes read as a wash from a distance; neighbouring cells must differ).
const vec3 COL_BROWN = vec3(0.30, 0.16, 0.06);
const vec3 COL_AMBER = vec3(0.72, 0.40, 0.06);
const vec3 COL_HONEY = vec3(0.92, 0.70, 0.28);
const vec3 COL_DEEP  = vec3(0.05, 0.03, 0.015);
const vec3 COL_WALL_GLOW = vec3(1.0, 0.78, 0.35);
const vec3 COL_ROOM_GLOW = vec3(1.0, 0.92, 0.72);
const vec3 COL_WIN_DIM = vec3(0.12, 0.08, 0.04);
const vec3 COL_WIN_HOT = vec3(1.0, 0.90, 0.68);
const vec3 COL_ACCENT = vec3(1.0, 0.85, 0.45);
const vec3 COL_KNOCK_GOLD = vec3(1.0, 0.80, 0.30);

/** Regional anchor pick + palMix lean, blended by hueVar strength (0 = uniform honey). */
vec3 honeyAnchor(vec2 cellId){
  float hv = hash21(cellId + 7.0);
  vec3 base = hv < 0.5
    ? mix(COL_BROWN, COL_AMBER, hv * 2.0)
    : mix(COL_AMBER, COL_HONEY, (hv - 0.5) * 2.0);
  base = mix(base, COL_HONEY, uPalMix * 0.4); // palMix leans the whole wall toward honey-gold
  return mix(COL_HONEY, base, uHueVar);
}

void main(){
  // Wall-space transform: unbounded plane, NO wrapping anywhere (unlike
  // a1's sim texture) — the wall grows outward from fixed seed cells and
  // must never fold back on itself.
  vec2 wallUv = (vUv - 0.5) * uCover / uZoom + uScroll;

${full ? `  float aa = fwidth(wallUv.x) * 1.5;` : `  float aa = 0.0035;`} // fixed epsilon on Lite: no derivatives on that path

  // Trace field sample: R = damage, G = crawler-dim trail, B = build trace.
  // Fetched once here (not per-use-site below) — same texUv mapping as
  // traceField.ts's inverse (REGION_HALF is the single shared constant).
  // uTraceOff > 0.5 overrides to (0,0,1) — see its declaration above.
  vec3 trace = mix(texture2D(uTrace, (wallUv + REGION_HALF) / (2.0 * REGION_HALF)).rgb, vec3(0.0, 0.0, 1.0), step(0.5, uTraceOff));

  // ---- hex lattice ----
  vec2 hexId = axialRound(pixelToAxial(wallUv, uHexR));
  vec2 hexCenter = axialToPixel(hexId, uHexR);
  // iq's sdHexagon is FLAT-top and takes the APOTHEM (inradius). Our grid is
  // pointy-top with circumradius uHexR, so: swap xy (30deg rotation) and pass
  // apothem = R*sqrt(3)/2. Passing the circumradius unrotated makes neighbour
  // SDF hexes overlap — the walls collapse into triangle slivers (seen once).
  vec2 hexLocal = wallUv - hexCenter;
  float hexEdge = sdHexagon(vec2(hexLocal.y, hexLocal.x), uHexR * 0.8660254 - HEX_WALL_HALF);
  float hexHash = hash21(hexId * 1.7 + uSeed);

  // Five seed cells (taste round 1: 3 was too sparse — Act 1 read as empty).
  // Generated from the exported HEX_SEEDS array (not hand-duplicated here)
  // so the CPU crawler system's hexBirthApprox() can never silently drift
  // from what the GPU actually renders.
${HEX_SEEDS.map((s, i) => `  vec2 seed${i} = vec2(${s[0].toFixed(1)}, ${s[1].toFixed(1)});`).join('\n')}
  float hexRing = ${hexSeedMinChain(HEX_SEEDS.length)};
  float hexBirth = clamp((hexRing + hexHash * ${HEX_JITTER.toFixed(1)}) / ${HEX_MAX_RING.toFixed(1)}, 0.0, 1.0);
  float hexGrow = 1.0 - smoothstep(uHexBuild, uHexBuild + ${GROW_BAND.toFixed(3)}, hexBirth);

  // Knock boost: a tap (or ambient knock) pre-builds the neighbourhood
  // early, proximity-weighted and decaying — never permanently, so the
  // birth-order field is still the source of truth once the pulse fades.
  for (int i = 0; i < ${knockSlots}; i++) {
    vec4 kb = uKnockBoost[i];
    if (kb.w <= 0.0) continue;
    float d = length(wallUv - kb.xy);
    float prox = clamp(1.0 - d / ${KNOCK_BOOST_RADIUS.toFixed(4)}, 0.0, 1.0);
    hexGrow = max(hexGrow, kb.w * exp(-kb.z * 2.0) * prox);
  }

  // Crawler boost: each Homemaker pre-builds the single cell it's standing
  // on (+ a tight rim) as it passes, same decay shape as the knock boost
  // above but a much smaller radius (CRAWLER_BOOST_RADIUS = 1.5*HEX_R vs.
  // knock's 3*HEX_R — only the cell underfoot should visibly "finish") and
  // its own array (see uCrawlerBoost's declaration for why it isn't folded
  // into uKnockBoost).
  for (int i = 0; i < ${crawlerSlots}; i++) {
    vec4 cb = uCrawlerBoost[i];
    if (cb.w <= 0.0) continue;
    float d = length(wallUv - cb.xy);
    float prox = clamp(1.0 - d / ${CRAWLER_BOOST_RADIUS.toFixed(4)}, 0.0, 1.0);
    hexGrow = max(hexGrow, cb.w * exp(-cb.z * 2.0) * prox);
  }

  // Raw wall mask (pre-hexGrow) kept alongside the grown one: the ghost
  // flicker below needs to paint on cells that AREN'T built yet, so it reads
  // hexWallMask0 rather than the *hexGrow-multiplied hexWallMask.
  float hexWallMask0 = smoothstep(-aa, aa, hexEdge) - smoothstep(HEX_WALL_HALF - aa, HEX_WALL_HALF + aa, hexEdge);
  float hexInterior = (1.0 - smoothstep(-aa, aa, hexEdge)) * hexGrow;
  float hexWallMask = hexWallMask0 * hexGrow;

  // Pre-birth ghost flicker: unbuilt cells just beyond the build front
  // shimmer faintly, as if the site is being surveyed ahead of construction
  // (the old module's "roomGhost/blueprint" idea, reborn for hexes).
  float ghost = (1.0 - hexGrow) * (1.0 - smoothstep(uHexBuild, uHexBuild + 0.10, hexBirth)) * (0.3 + 0.7 * abs(sin(uTime * 1.7 + hexHash * 20.0)));

  // ---- rect room lattice: split math lives in ROOM_SPLIT_GLSL_CHUNK
  // (computeRoomBirth), shared verbatim with traceField.ts's seed pass. ----
  vec2 cellMin, cellMax;
  float roomBirth;
  computeRoomBirth(wallUv, cellMin, cellMax, roomBirth);

  vec2 roomHalfV = (cellMax - cellMin) * 0.5 - vec2(ROOM_WALL_HALF);
  float roomEdge = sdBox(wallUv - (cellMin + cellMax) * 0.5, roomHalfV);
  float roomGrow = 1.0 - smoothstep(uRoomBuild, uRoomBuild + ${GROW_BAND.toFixed(3)}, roomBirth);

  float roomInterior = (1.0 - smoothstep(-aa, aa, roomEdge)) * roomGrow;
  float roomWallMask = (smoothstep(-aa, aa, roomEdge) - smoothstep(ROOM_WALL_HALF - aa, ROOM_WALL_HALF + aa, roomEdge)) * roomGrow;

  // Room-reveal gate: rooms only actually show where a crawler has walked
  // (trace.b), on top of birth-order eligibility (roomGrow above) — "rooms
  // appear only where crawlers have actually walked" is the narrative, not
  // a bug to fix. Gates roomInterior/roomWallMask (the two blend WEIGHTS
  // used below), deliberately NOT winRim: winRim is a colour interpolant
  // computed from roomEdge/roomHalfV further down, and if it were gated too
  // an unrevealed room would composite as dark fill (still visibly a room-
  // shaped hole) rather than staying fully invisible — the interior/wall
  // masks already being zero is what makes the room vanish. Boundary
  // shimmer, room glow, and window visibility all inherit this gate
  // downstream automatically since they're built from these two masks. The
  // wide 0.15->0.6 band is deliberate: trace.b accumulates gradually as a
  // crawler crosses a cell, so a narrow band would pop the room in instead
  // of it gradually resolving ("under construction").
  float roomReveal = smoothstep(0.15, 0.6, trace.b);
  roomInterior *= roomReveal;
  roomWallMask *= roomReveal;

  // ---- lights-out: latest-built edge cells die first, seed cells die last ----
  float hexAlive = 1.0 - smoothstep(1.0 - uDim - ${DIM_BAND.toFixed(2)}, 1.0 - uDim, hexBirth);
  float roomAlive = 1.0 - smoothstep(1.0 - uDim - ${DIM_BAND.toFixed(2)}, 1.0 - uDim, roomBirth);

  // ---- honeyFill: deep-amber -> honey-gold, noise wobble, rim highlight, slow drip ----
  float wobble = honeyFbm(wallUv * 4.0 + hexId * 0.35 + uTime * 0.02);
  float drip = honeyFbm(vec2(wallUv.x * 3.0, wallUv.y * 0.6 - uTime * (0.03 + uMid * 0.02)) + hexId * 0.5);
  float rim = smoothstep(-uHexR * 0.5, 0.0, hexEdge); // 0 at cell center -> 1 near the cell edge
  vec3 honey = honeyAnchor(hexId);
  honey *= 0.82 + 0.28 * wobble;
  honey *= 0.9 + 0.15 * drip;
  // Waxy depth: cells darken toward their walls (recessed comb), with a soft
  // center gleam — flat fills read as a beige wash from any distance.
  honey *= mix(1.0, 0.45, rim);
  honey += COL_HONEY * (1.0 - rim) * 0.10 * wobble;
  honey *= 1.0 + uBass * 0.15; // smoothed bass -> honey glow breath
  // Contrast-inverted crawler path (round-3 note 3): trace.g dims bright
  // honey cells the crawler has recently crossed. Multiplicative, so it's a
  // no-op on dark/unbuilt cells (honey is already near zero there — their
  // reveal comes from the existing crawler-BOOST mechanic above, a
  // separate term) and a visible dimming on bright ones, giving the path a
  // consistent readable cue regardless of what it's crossing. windowLight
  // deliberately stays untouched by trace.g below: rooms live on the reveal
  // gate above, not this dimming mechanic.
  honey *= 0.75 * uHoneyFill * hexAlive * (1.0 - trace.g * 0.55);

  // ---- windowLight: light seen through the wall from inside — brightest
  // just inside the room's own walls, dark at center. A flat cream fill
  // (first attempt) washed the whole frame and occluded the comb.
  // Companion fix for irregular rooms: the falloff used to key off the
  // global uRoomSize, so a small split-off room would render uniformly dim
  // (a silent look regression once rooms stopped being uniform) — key off
  // each room's own half-dimension instead. ----
  float roomHalfEff = min(roomHalfV.x, roomHalfV.y);
  float winRim = smoothstep(-roomHalfEff * 0.45, 0.0, roomEdge);
  vec3 win = mix(COL_WIN_DIM, COL_WIN_HOT, winRim * 0.85);
  win *= 1.0 + uFlash * 0.5;
  win *= uRoomLight * roomAlive;

  // ---- negotiation compositing (the signature call) ----
  vec3 col = COL_DEEP;
  col = mix(col, honey, hexInterior);
  col += hexWallMask * COL_WALL_GLOW * uWallGlow * (1.0 + uBass * 0.3);
  // Pre-birth ghost flicker on the raw (not-yet-grown) wall mask — surveying
  // the site ahead of construction.
  col += COL_WALL_GLOW * hexWallMask0 * ghost * uGhost * 0.25;

  // Built rooms take priority, but hex walls bleed through at 0.35 —
  // x-ray cohabitation, so the comb underneath a finished room is still
  // legible rather than fully occluded.
  col = mix(col, win, roomInterior * 0.65); // rooms lead but never fully occlude the comb
  col += hexWallMask * roomInterior * COL_WALL_GLOW * uWallGlow * 0.35;
  col += roomWallMask * COL_ROOM_GLOW * uWallGlow;

  // Boundary accent shimmer where the two lattices' edges nearly coincide
  // and both wall masks are hot — the negotiation's visible handshake.
  float coincide = 1.0 - smoothstep(0.0, ${BOUNDARY_BAND.toFixed(3)}, abs(hexEdge - roomEdge));
  float boundaryMask = coincide * hexWallMask * roomWallMask;
  col += boundaryMask * COL_ACCENT * uShimmer * (0.5 + 0.5 * sin(uTime * 3.0 + hexHash * 30.0)) * (0.7 + 0.3 * uHigh);

  // ---- beat pulse: driven by the DENSE pulse channel (uPulse/uPulseCount),
  // not uFlash — uFlash stays reserved for windows/bees/big scene lifts,
  // which would strobe if raised to the pulse channel's 60-90/min rate.
  // Each pulse event re-rolls which built cells light and in what colour —
  // warm family (vivid orange/rust-red/cream/amber) with a rare verdigris
  // contrast pop (~1-in-12 cells·pulses). Selection width is 0.20, not the
  // 0.4 an uFlash-driven version used: at ~90 events/min, 40%-of-comb
  // re-rolls every event read as noise rather than pulses; 20% reads clean.
  // Rides uPulse's decay envelope so pulses land on the beat, not linger. ----
  float beatRoll = hash21(hexId * 3.1 + uPulseCount * 13.7);
  float beatSel = step(1.0 - uBeatPulse * 0.20, beatRoll);
  float hueRoll = hash21(hexId * 5.3 + uPulseCount * 7.7);
  vec3 pulseCol = hueRoll < 0.30 ? vec3(1.0, 0.55, 0.10)
               : hueRoll < 0.55 ? vec3(0.95, 0.20, 0.10)
               : hueRoll < 0.80 ? vec3(1.0, 0.9, 0.55)
               : hueRoll < 0.92 ? vec3(1.0, 0.75, 0.20)
               : vec3(0.25, 0.85, 0.65);
  col += pulseCol * beatSel * uPulse * uBeatPulse * hexInterior * hexAlive * 0.9;

  // ---- macro comb: climax scale shift, coordinated with the zoom pull-back.
  // Guarded: uMacro is 0 for ~85% of the track — skip the second lattice
  // evaluation entirely outside the climax. Same pointy-top/apothem fix as
  // the main lattice. ----
  if (uMacro > 0.001) {
    float macroR = uHexR * ${MACRO_SCALE.toFixed(1)};
    vec2 macroId = axialRound(pixelToAxial(wallUv, macroR));
    vec2 macroLocal = wallUv - axialToPixel(macroId, macroR);
    float macroEdge = sdHexagon(vec2(macroLocal.y, macroLocal.x), macroR * 0.8660254 - HEX_WALL_HALF * 6.0);
    float macroAa = aa * 3.0;
    float macroWallMask = smoothstep(-macroAa, macroAa, macroEdge) - smoothstep(HEX_WALL_HALF * 6.0 - macroAa, HEX_WALL_HALF * 6.0 + macroAa, macroEdge);
    col *= 1.0 - 0.4 * uMacro; // background darkens as the giant comb reveals behind the wall
    col += macroWallMask * COL_WALL_GLOW * 0.35 * uMacro;
  }

  // ---- Homemakers: small dark crawler entities walking the comb, each
  // leaving a warm ember wake behind its heading. Placed AFTER beat-pulse/
  // macro (crawlers are wall-surface — part of "how the built wall looks
  // right now", same layer as the honey/glow terms above) but BEFORE
  // knocks/chalk-lines below (those are drawn ACROSS everything, the
  // topmost "mark on top of the whole scene" layer, and must stay on top of
  // the crawlers rather than being walked over). ----
  const float CRAWLER_LEN = ${CRAWLER_LEN.toFixed(5)};
  const float CRAWLER_WID = ${CRAWLER_WID.toFixed(5)};
  const float WAKE_LEN = ${WAKE_LEN.toFixed(5)};
  const float WAKE_WID = ${WAKE_WID.toFixed(5)};
  // Ember, deliberately NOT COL_WALL_GLOW — the wake needs to read as the
  // crawler's own trail, not just more of the wall's ambient gold glow (the
  // two would visually merge into one indistinct color on a built cell).
  const vec3 COL_CRAWLER_WAKE = vec3(0.95, 0.55, 0.18);
  for (int i = 0; i < ${crawlerSlots}; i++) {
    vec4 cw = uCrawler[i];
    if (cw.w <= 0.0) continue;
    vec2 d = wallUv - cw.xy;
    if (dot(d, d) > WAKE_LEN * WAKE_LEN * 2.0) continue; // early reject before the trig below
    float ch = cos(cw.z), sh = sin(cw.z);
    vec2 local = vec2(d.x * ch + d.y * sh, -d.x * sh + d.y * ch);
    float legWobble = 1.0 + 0.12 * sin(uTime * 9.0 + cw.z * 3.7 + float(i) * 12.9);
    vec2 bn = local / vec2(CRAWLER_LEN, CRAWLER_WID * legWobble);
    float body = exp(-dot(bn, bn) * 2.2) * cw.w;
    col *= 1.0 - body * 0.65; // dark silhouette
    col += COL_ACCENT * body * 0.10; // faint warm rim
    vec2 wn = (local + vec2(WAKE_LEN * 0.5, 0.0)) / vec2(WAKE_LEN, WAKE_WID);
    col += COL_CRAWLER_WAKE * exp(-dot(wn, wn) * 1.6) * cw.w * 0.35; // wake trails BEHIND heading
  }

  // Line-cut damage: the whole composite so far dims under accumulated
  // scars (round-3 note 1). Placed AFTER crawlers but BEFORE knocks/chalk
  // lines below, so a fresh bright stroke (a new knock or the chalk line
  // that CAUSED this scar) still draws on top and reads clearly, while a
  // faded stroke leaves the dimmed scar visible underneath, healing over
  // traceField.ts's ~8s R-channel decay.
  col *= 1.0 - trace.r * uDamage;

  // ---- knocks: expanding ring, masked by the lattice so light travels along it ----
  float latticeMask = max(hexWallMask, roomWallMask);
  for (int i = 0; i < ${knockSlots}; i++) {
    vec4 kg = uKnockGlow[i];
    if (kg.w <= 0.0) continue;
    float d = length(wallUv - kg.xy);
    float ring = exp(-pow((d - kg.z * 1.6) * 14.0, 2.0)) * kg.w * exp(-kg.z * 3.2);
    col += COL_KNOCK_GOLD * ring * latticeMask * 1.6;
  }

  // ---- chalk lines: straight architectural marks with a travelling bright
  // head, cutting through the hexagons — additive and NOT lattice-masked
  // (unlike the knock ring above), since these are drawn across everything,
  // not light travelling along a wall. lm.x is raw age in seconds; the head
  // reaches B at age 0.5s, then the line persists and fades. ----
  for (int i = 0; i < ${lineSlots}; i++) {
    vec4 la = uLineA[i]; vec4 lm = uLineMeta[i];
    if (lm.y <= 0.0) continue;
    vec2 bmin = min(la.xy, la.zw) - LINE_REACH, bmax = max(la.xy, la.zw) + LINE_REACH;
    if (wallUv.x < bmin.x || wallUv.x > bmax.x || wallUv.y < bmin.y || wallUv.y > bmax.y) continue;
    float prog = clamp(lm.x * 2.0, 0.0, 1.0);
    float fade = exp(-max(lm.x - 0.5, 0.0) * 2.5) * lm.y;
    float d = segDistProgress(wallUv, la.xy, la.zw, prog);
    float core = (1.0 - smoothstep(LINE_HALF, LINE_HALF * 2.5, d)) * fade;
    vec2 headPos = mix(la.xy, la.zw, prog);
    float headR = HEAD_R_SCREEN / uZoom;
    float head = exp(-pow(length(wallUv - headPos) / headR, 2.0) * 8.0) * lm.y * step(lm.x, 0.55);
    col += vec3(1.0, 0.93, 0.7) * (core * 0.8 + head * 1.2);
  }

  // ---- finish: grain, vignette, filmic ----
  col += (hash21(gl_FragCoord.xy) - 0.5) * 0.02;
  float vig = smoothstep(1.25, 0.35, length(vUv - 0.5) * 1.6);
  col *= vig;
  col = 1.0 - exp(-col * 2.2);
  gl_FragColor = vec4(col, 1.0);
}
`;
}
