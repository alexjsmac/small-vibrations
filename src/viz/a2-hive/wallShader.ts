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

/** Knock pool sizes (both boost and glow use the same count): Lite halves Full. */
export const KNOCK_SLOTS_FULL = 4;
export const KNOCK_SLOTS_LITE = 2;

/** Knock-boost slot lifetime (seconds) — matches the shader's exp(-age*2) decay window. */
export const KNOCK_BOOST_LIFETIME = 0.5;
/** Knock-glow ring lifetime (seconds) — matches the shader's exp(-age*3.2) decay window. */
export const KNOCK_GLOW_LIFETIME = 1.1;

/** Trivial fullscreen-quad passthrough — identical idiom to a1-primordial's VERT. */
export const WALL_VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/**
 * Builds the wall fragment shader source. `full` bakes in fwidth()-based AA
 * and a 2-octave honey wobble (vs. a fixed-epsilon AA and 1 octave on Lite);
 * `knockSlots` bakes the uKnockBoost/uKnockGlow array length and loop bound.
 */
export function buildWallFragmentShader(full: boolean, knockSlots: number): string {
  return `
precision highp float;
varying vec2 vUv;

uniform float uTime, uSeed;
uniform float uHexR, uRoomSize;
uniform vec2 uCover, uScroll;
uniform float uZoom;
uniform float uHexBuild, uRoomBuild, uMacro, uDim;
uniform float uWallGlow, uHoneyFill, uRoomLight, uShimmer, uPalMix, uHueVar;
uniform float uBass, uMid, uHigh, uFlash;
uniform vec4 uKnockBoost[${knockSlots}];
uniform vec4 uKnockGlow[${knockSlots}];

const float HEX_WALL_HALF = ${HEX_WALL_HALF.toFixed(4)};
const float ROOM_WALL_HALF = ${ROOM_WALL_HALF.toFixed(4)};

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

  vec2 seedA = vec2(0.0, 0.0), seedB = vec2(7.0, -5.0), seedC = vec2(-5.0, 7.0);
  float hexRing = min(hexDist(hexId, seedA), min(hexDist(hexId, seedB), hexDist(hexId, seedC)));
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

  float hexInterior = (1.0 - smoothstep(-aa, aa, hexEdge)) * hexGrow;
  float hexWallMask = (smoothstep(-aa, aa, hexEdge) - smoothstep(HEX_WALL_HALF - aa, HEX_WALL_HALF + aa, hexEdge)) * hexGrow;

  // ---- rect room lattice ----
  vec2 roomId = floor(wallUv / uRoomSize);
  vec2 roomLocal = wallUv - (roomId + 0.5) * uRoomSize;
  float roomHalf = uRoomSize * 0.5 - ROOM_WALL_HALF;
  float roomEdge = sdBox(roomLocal, vec2(roomHalf));
  float roomHash = hash21(roomId * 2.3 + uSeed + 91.7);
  float roomRing = max(abs(roomId.x), abs(roomId.y));
  float roomBirth = clamp((roomRing + roomHash * ${ROOM_JITTER.toFixed(2)}) / ${ROOM_MAX_RING.toFixed(1)}, 0.0, 1.0);
  float roomGrow = 1.0 - smoothstep(uRoomBuild, uRoomBuild + ${GROW_BAND.toFixed(3)}, roomBirth);

  float roomInterior = (1.0 - smoothstep(-aa, aa, roomEdge)) * roomGrow;
  float roomWallMask = (smoothstep(-aa, aa, roomEdge) - smoothstep(ROOM_WALL_HALF - aa, ROOM_WALL_HALF + aa, roomEdge)) * roomGrow;

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
  honey *= 0.75 * uHoneyFill * hexAlive;

  // ---- windowLight: light seen through the wall from inside — brightest
  // just inside the room's own walls, dark at center. A flat cream fill
  // (first attempt) washed the whole frame and occluded the comb. ----
  float winRim = smoothstep(-uRoomSize * 0.22, 0.0, roomEdge);
  vec3 win = mix(COL_WIN_DIM, COL_WIN_HOT, winRim * 0.85);
  win *= 1.0 + uFlash * 0.5;
  win *= uRoomLight * roomAlive;

  // ---- negotiation compositing (the signature call) ----
  vec3 col = COL_DEEP;
  col = mix(col, honey, hexInterior);
  col += hexWallMask * COL_WALL_GLOW * uWallGlow * (1.0 + uBass * 0.3);

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

  // ---- knocks: expanding ring, masked by the lattice so light travels along it ----
  float latticeMask = max(hexWallMask, roomWallMask);
  for (int i = 0; i < ${knockSlots}; i++) {
    vec4 kg = uKnockGlow[i];
    if (kg.w <= 0.0) continue;
    float d = length(wallUv - kg.xy);
    float ring = exp(-pow((d - kg.z * 1.6) * 14.0, 2.0)) * kg.w * exp(-kg.z * 3.2);
    col += COL_KNOCK_GOLD * ring * latticeMask * 1.6;
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
