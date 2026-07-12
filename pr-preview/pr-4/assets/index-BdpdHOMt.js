import{B as ne,f as K,c as I,e as ae,A as re,h as he,V as M,S as ce,O as ue,d as me,M as fe}from"./three-D-rRGwWh.js";import{m as se}from"./random-DL1jLgMw.js";const m=.055,le=16,ie=3.5,de=.6,ve=4,xe=1.2,V=.05,we=.005,pe=.008,ge=.006,X=.08,be=7,ye=3*m,$=4,ke=2,Me=.5,_e=1.1,W=[[0,0],[7,-5],[-5,7],[9,2],[-8,-3]],Y=10,Le=5,Re=.5*m,Ee=.22*m,Ae=1.6*m,Ce=.5*m,Se=1.5*m,Q=6,Oe=3,Te=1.6,Be=.3,Ne=`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;function Fe(c){function e(o){return o===c-1?`hexDist(hexId, seed${o})`:`min(hexDist(hexId, seed${o}), ${e(o+1)})`}return e(0)}function Ie(c,e,o,t){return`
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
uniform vec4 uKnockBoost[${e}];
uniform vec4 uKnockGlow[${e}];
uniform vec4 uLineA[${o}];
uniform vec4 uLineMeta[${o}];
// Homemakers: xy wall pos, z heading (rad), w strength 0..1.
uniform vec4 uCrawler[${t}];
// xy cell-center wall pos, z age (s), w strength 0..1 — dedicated array, NOT
// a reuse of uKnockBoost: knock is user-tap-facing feedback, and folding
// crawler pre-build into the same pool would let ambient crawler traffic
// steal/overwrite a tap's boost slot.
uniform vec4 uCrawlerBoost[${t}];

const float HEX_WALL_HALF = ${we.toFixed(4)};
const float ROOM_WALL_HALF = ${pe.toFixed(4)};
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
${c?`  p = p * 2.03 + 17.1;
  v += 0.25 * vnoise(p);`:""}
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

${c?"  float aa = fwidth(wallUv.x) * 1.5;":"  float aa = 0.0035;"} // fixed epsilon on Lite: no derivatives on that path

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
${W.map((l,s)=>`  vec2 seed${s} = vec2(${l[0].toFixed(1)}, ${l[1].toFixed(1)});`).join(`
`)}
  float hexRing = ${Fe(W.length)};
  float hexBirth = clamp((hexRing + hexHash * ${ie.toFixed(1)}) / ${le.toFixed(1)}, 0.0, 1.0);
  float hexGrow = 1.0 - smoothstep(uHexBuild, uHexBuild + ${V.toFixed(3)}, hexBirth);

  // Knock boost: a tap (or ambient knock) pre-builds the neighbourhood
  // early, proximity-weighted and decaying — never permanently, so the
  // birth-order field is still the source of truth once the pulse fades.
  for (int i = 0; i < ${e}; i++) {
    vec4 kb = uKnockBoost[i];
    if (kb.w <= 0.0) continue;
    float d = length(wallUv - kb.xy);
    float prox = clamp(1.0 - d / ${ye.toFixed(4)}, 0.0, 1.0);
    hexGrow = max(hexGrow, kb.w * exp(-kb.z * 2.0) * prox);
  }

  // Crawler boost: each Homemaker pre-builds the single cell it's standing
  // on (+ a tight rim) as it passes, same decay shape as the knock boost
  // above but a much smaller radius (CRAWLER_BOOST_RADIUS = 1.5*HEX_R vs.
  // knock's 3*HEX_R — only the cell underfoot should visibly "finish") and
  // its own array (see uCrawlerBoost's declaration for why it isn't folded
  // into uKnockBoost).
  for (int i = 0; i < ${t}; i++) {
    vec4 cb = uCrawlerBoost[i];
    if (cb.w <= 0.0) continue;
    float d = length(wallUv - cb.xy);
    float prox = clamp(1.0 - d / ${Se.toFixed(4)}, 0.0, 1.0);
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

  // ---- rect room lattice: irregular hierarchical split — a floor plan, not
  // graph paper. Each uRoomSize block optionally splits once (level 1,
  // either axis) and, within that sub-cell, optionally splits again
  // (level 2, FORCED to the other axis so a block never slivers along one
  // direction). Both levels carry a MIN_ROOM_DIM guard: a split that would
  // leave either resulting piece thinner than a closet is skipped, and the
  // block/sub-cell stays whole. Two levels max — a third level was tried and
  // rejected (wall-dominated slivers). ----
  vec2 baseId = floor(wallUv / uRoomSize);
  vec2 cellMin = baseId * uRoomSize, cellMax = cellMin + uRoomSize;
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

  vec2 roomHalfV = (cellMax - cellMin) * 0.5 - vec2(ROOM_WALL_HALF);
  float roomEdge = sdBox(wallUv - (cellMin + cellMax) * 0.5, roomHalfV);
  vec2 roomIdEff = cellMin; // unique per room; do NOT quantize
  float roomHash = hash21(roomIdEff * 2.3 + uSeed + 91.7);
  float roomRing = max(abs(baseId.x), abs(baseId.y)); // birth wave stays keyed to the coarse block
  float roomBirth = clamp((roomRing + roomHash * ${xe.toFixed(2)}) / ${ve.toFixed(1)}, 0.0, 1.0);
  float roomGrow = 1.0 - smoothstep(uRoomBuild, uRoomBuild + ${V.toFixed(3)}, roomBirth);

  float roomInterior = (1.0 - smoothstep(-aa, aa, roomEdge)) * roomGrow;
  float roomWallMask = (smoothstep(-aa, aa, roomEdge) - smoothstep(ROOM_WALL_HALF - aa, ROOM_WALL_HALF + aa, roomEdge)) * roomGrow;

  // ---- lights-out: latest-built edge cells die first, seed cells die last ----
  float hexAlive = 1.0 - smoothstep(1.0 - uDim - ${X.toFixed(2)}, 1.0 - uDim, hexBirth);
  float roomAlive = 1.0 - smoothstep(1.0 - uDim - ${X.toFixed(2)}, 1.0 - uDim, roomBirth);

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
  float coincide = 1.0 - smoothstep(0.0, ${ge.toFixed(3)}, abs(hexEdge - roomEdge));
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
    float macroR = uHexR * ${be.toFixed(1)};
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
  const float CRAWLER_LEN = ${Re.toFixed(5)};
  const float CRAWLER_WID = ${Ee.toFixed(5)};
  const float WAKE_LEN = ${Ae.toFixed(5)};
  const float WAKE_WID = ${Ce.toFixed(5)};
  // Ember, deliberately NOT COL_WALL_GLOW — the wake needs to read as the
  // crawler's own trail, not just more of the wall's ambient gold glow (the
  // two would visually merge into one indistinct color on a built cell).
  const vec3 COL_CRAWLER_WAKE = vec3(0.95, 0.55, 0.18);
  for (int i = 0; i < ${t}; i++) {
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

  // ---- knocks: expanding ring, masked by the lattice so light travels along it ----
  float latticeMask = max(hexWallMask, roomWallMask);
  for (int i = 0; i < ${e}; i++) {
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
  for (int i = 0; i < ${o}; i++) {
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
`}class He{constructor(e,o,t){this.renderer=t;const l=se(e^11746099),s=Math.min(o.particleBudget,o.level==="full"?2e4:6e3),i=new Float32Array(s*3),n=new Float32Array(s);for(let h=0;h<s;h++)i[h*3+0]=(l()*2-1)*3.2,i[h*3+1]=(l()*2-1)*2,i[h*3+2]=(l()*2-1)*2.4,n[h]=l();this.geometry=new ne,this.geometry.setAttribute("position",new K(i,3)),this.geometry.setAttribute("aSeed",new K(n,1)),this.uniforms={uFlowTime:{value:0},uTurbulence:{value:.7},uFlowAmount:{value:1.1},uSwarm:{value:0},uSettle:{value:0},uDensity:{value:1},uBrightness:{value:.6},uHigh:{value:0},uBass:{value:0},uScale:{value:96},uSeedShift:{value:l()*100},uFlash:{value:0},uAccent:{value:.25},uZoom:{value:1},uCover:{value:new I(1,1)}},this.material=new ae({uniforms:this.uniforms,transparent:!0,depthTest:!1,depthWrite:!1,blending:re,vertexShader:`
        precision highp float;
        uniform float uFlowTime;
        uniform float uTurbulence;
        uniform float uFlowAmount;
        uniform float uSwarm;
        uniform float uSettle;
        uniform float uDensity;
        uniform float uBass;
        uniform float uHigh;
        uniform float uScale;
        uniform float uSeedShift;
        uniform float uZoom;
        uniform vec2 uCover;
        attribute float aSeed;
        varying float vVisible;
        varying float vSparkle;

        float hash(vec3 p) {
          p = fract(p * 0.3183099 + uSeedShift);
          p *= 17.0;
          return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
        }
        float noise(vec3 p) {
          vec3 i = floor(p);
          vec3 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
                mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
            mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y),
            f.z);
        }
        vec3 noise3(vec3 p) {
          return vec3(noise(p), noise(p + 31.416), noise(p + 78.54));
        }
        vec3 curl(vec3 p) {
          const float e = 0.1;
          vec3 n0 = noise3(p);
          vec3 nx = noise3(p + vec3(e, 0.0, 0.0));
          vec3 ny = noise3(p + vec3(0.0, e, 0.0));
          vec3 nz = noise3(p + vec3(0.0, 0.0, e));
          return vec3(
            (ny.z - n0.z) - (nz.y - n0.y),
            (nz.x - n0.x) - (nx.z - n0.z),
            (nx.y - n0.y) - (ny.x - n0.x)
          ) / e;
        }

        void main() {
          // free flow: base position advected by curl noise
          vec3 noiseP = position * uTurbulence + aSeed * 10.0 + uFlowTime;
          vec3 flowPos = position + curl(noiseP) * uFlowAmount * 0.35;

          // swarm: circulate around the hive like returning foragers
          float phase = aSeed * 6.2831853;
          float rho = 1.3 + aSeed * 1.5;
          float ang = phase + uFlowTime * (0.25 + aSeed * 0.35);
          vec3 orbitPos = vec3(
            cos(ang) * rho,
            sin(phase * 3.1 + uFlowTime * 0.6) * (0.5 + aSeed * 0.7),
            sin(ang) * rho * 0.75
          );
          // fine fast jitter — wings, not orbits
          orbitPos += curl(orbitPos * 3.0 + uFlowTime * 4.0) * 0.05;
          vec3 finalPos = mix(flowPos, orbitPos, uSwarm);

          // moving in: once the wall is finished the swarm settles onto it
          vec3 settlePos = vec3(orbitPos.x * 0.5, orbitPos.y * 0.5, 0.18 + sin(phase * 5.0) * 0.12);
          finalPos = mix(finalPos, settlePos, uSettle * (0.4 + 0.6 * aSeed));

          vVisible = 1.0 - step(uDensity, aSeed);
          vSparkle = aSeed;

          // View-relative 2D projection, matching the wall shader's own
          // cover-fit and zoom (no camera, no modelViewMatrix): bees never
          // read uScroll — they live directly in screen space, so panning
          // the wall underneath them costs nothing extra here. This is a
          // deliberate omission, not a missing term: tying bee position to
          // wall-space (scrolled) coordinates would require the same
          // unbounded-plane bookkeeping the wall has, for a layer that's
          // meant to read as hovering over the whole view instead.
          vec2 screenUv = finalPos.xy * uZoom / uCover + 0.5;
          gl_Position = vec4((screenUv - 0.5) * 2.0, 0.0, 1.0);

          float size = (0.014 + aSeed * 0.03) * (1.0 + uBass * 0.7) * (1.0 + uHigh * 0.4);
          gl_PointSize = size * uScale;
        }
      `,fragmentShader:`
        precision highp float;
        uniform float uBrightness;
        uniform float uHigh;
        uniform float uFlash;
        uniform float uAccent;
        varying float vVisible;
        varying float vSparkle;

        void main() {
          if (vVisible < 0.5) discard;
          float d = length(gl_PointCoord - 0.5);
          float falloff = smoothstep(0.5, 0.08, d);
          float brightness = clamp(uBrightness + uHigh * 0.5 + vSparkle * 0.15 + uFlash * 0.5, 0.0, 1.5);
          vec3 dim = vec3(0.42, 0.24, 0.10);   // warm amber-brown, consistent with the wall's base palette
          vec3 hot = vec3(0.97, 0.87, 0.62);   // cream/gold
          vec3 col = mix(dim, hot, clamp(brightness, 0.0, 1.0));
          float rust = step(0.82, fract(vSparkle * 7.13)) * uAccent;
          col = mix(col, vec3(0.769, 0.478, 0.180), rust); // #c47a2e rust-amber subset
          float alpha = falloff * clamp(brightness, 0.1, 1.0) * 0.65;
          gl_FragColor = vec4(col, alpha);
        }
      `}),this.object=new he(this.geometry,this.material),this.object.frustumCulled=!1}object;material;geometry;uniforms;update(e,o,t,l,s,i,n=0){const h=t.params,a=this.uniforms;a.uFlowTime.value+=e*(.4+h.beeSwarm*.6),a.uTurbulence.value=.6+l.energy*.4,a.uFlowAmount.value=.9+l.energy*.5,a.uSwarm.value=h.beeSwarm,a.uSettle.value=l.settle,a.uDensity.value=h.beeDensity,a.uHigh.value=o.high,a.uBass.value=o.bass,a.uFlash.value=n,a.uZoom.value=s,a.uCover.value.copy(i),a.uScale.value=this.renderer.domElement.height*.12}dispose(){this.geometry.dispose(),this.material.dispose()}}const A=[0,54,101,132,188,252,267,294.124],N=[{name:"groundbreaking",wallGlow:.4,honeyFill:.15,roomLight:0,shimmer:0,beeDensity:.35,beeSwarm:.1,flashRate:2.5,knockRate:4,driftX:.02,driftY:.01,palMix:.1,hueVar:.4,zoom:1,ghost:.8,beatPulse:.15,lineRate:0,pulseRate:8,crawlers:.2},{name:"raising-the-frame",wallGlow:.65,honeyFill:.5,roomLight:.2,shimmer:.15,beeDensity:.4,beeSwarm:.25,flashRate:8,knockRate:4,driftX:.05,driftY:.02,palMix:.3,hueVar:.55,zoom:1,ghost:.5,beatPulse:.8,lineRate:6,pulseRate:60,crawlers:.5},{name:"settling-in",wallGlow:.55,honeyFill:.4,roomLight:.15,shimmer:.12,beeDensity:.3,beeSwarm:.2,flashRate:2,knockRate:5,driftX:.015,driftY:.01,palMix:.25,hueVar:.5,zoom:1,ghost:.2,beatPulse:.2,lineRate:3,pulseRate:30,crawlers:.35},{name:"inside-the-house",wallGlow:.5,honeyFill:.45,roomLight:.4,shimmer:.18,beeDensity:.3,beeSwarm:.15,flashRate:3,knockRate:8,driftX:.01,driftY:.04,palMix:.4,hueVar:.6,zoom:1.6,ghost:.15,beatPulse:.35,lineRate:4,pulseRate:45,crawlers:.6},{name:"two-homes-one-wall",wallGlow:.9,honeyFill:.85,roomLight:.6,shimmer:1,beeDensity:.85,beeSwarm:.85,flashRate:9,knockRate:16,driftX:.08,driftY:.03,palMix:.6,hueVar:.8,zoom:.55,ghost:.3,beatPulse:1,lineRate:20,pulseRate:90,crawlers:.9},{name:"housewarming",wallGlow:.75,honeyFill:.75,roomLight:.5,shimmer:.4,beeDensity:.5,beeSwarm:.5,flashRate:3,knockRate:9,driftX:.03,driftY:.015,palMix:.5,hueVar:.65,zoom:.85,ghost:0,beatPulse:.25,lineRate:3,pulseRate:25,crawlers:.55},{name:"lights-out",wallGlow:.3,honeyFill:.2,roomLight:.05,shimmer:0,beeDensity:.1,beeSwarm:.1,flashRate:.3,knockRate:0,driftX:.005,driftY:.005,palMix:.2,hueVar:.3,zoom:1,ghost:0,beatPulse:0,lineRate:0,pulseRate:4,crawlers:.1}],_=[[0,.05,0,0,0,0,.15],[53.8,.24,0,0,0,0,.4],[54.3,.3,0,0,0,0,.75],[95,.58,0,0,0,0,.7],[101,.6,0,0,0,0,.35],[132,.6,0,0,0,0,.3],[150,.63,.12,0,0,0,.35],[187.8,.7,.38,0,0,0,.5],[188.4,.78,.5,0,.1,0,1],[215,.93,.85,0,1,0,1],[225,1,1,0,1,0,.95],[248,1,1,0,1,.9,.85],[252,1,1,0,1,.95,.7],[267,1,1,0,0,1,.4],[290,1,1,.97,0,1,.08],[294.124,1,1,1,0,1,0]],y={hexBuild:0,roomBuild:0,dim:0,macro:0,settle:0,energy:0};function We(c){const e=Math.min(Math.max(c,0),_[_.length-1][0]);let o=0;for(;o<_.length-2&&e>=_[o+1][0];)o++;const t=_[o],l=_[o+1],s=Math.min(1,Math.max(0,(e-t[0])/Math.max(.001,l[0]-t[0])));return y.hexBuild=t[1]+(l[1]-t[1])*s,y.roomBuild=t[2]+(l[2]-t[2])*s,y.dim=t[3]+(l[3]-t[3])*s,y.macro=t[4]+(l[4]-t[4])*s,y.settle=t[5]+(l[5]-t[5])*s,y.energy=t[6]+(l[6]-t[6])*s,y}const De=6;function Pe(c){const e=Math.min(1,Math.max(0,c));return e*e*(3-2*e)}function Ue(c,e,o){if(o<=0)return c;if(o>=1)return e;const t={...c,name:o<.5?c.name:e.name};for(const l of Object.keys(c)){const s=c[l],i=e[l];typeof s=="number"&&typeof i=="number"&&(t[l]=s+(i-s)*o)}return t}function Ge(c){const e=A[A.length-1],o=Math.min(Math.max(c,0),e-.001);let t=0;for(;t<N.length-1&&o>=A[t+1];)t++;const l=A[t],s=A[t+1]??e,i=Math.min(1,Math.max(0,(o-l)/Math.max(.001,s-l))),n=t<N.length-1,h=s-o,a=n?Pe(1-Math.min(1,h/De)):0,f=N[t],u=n?N[t+1]:f;return{params:Ue(f,u,a),actIndex:t,localT:i,blend:a}}const ze=.12,Ke=1.5,Ve=.5,Xe=.9,$e=1.2,Ye=.4,Qe=1.5,qe=.6,je=.5,Ze=1.2,Je=.06,et=.3,tt=.12,q=.5,ot=.9,at=.006,st=.08,lt=1.8,it=1.1,nt=1.5,p=[[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]];function g(c,e,o){return o*(1.7320508*c+.8660254*e)}function b(c,e,o){return o*1.5*e}function rt(c,e,o,t){const l=c,s=-c-e,i=e,n=o,h=-o-t,a=t;return Math.max(Math.abs(l-n),Math.abs(s-h),Math.abs(i-a))}function ht(c){return c-Math.floor(c)}function j(c,e,o){let t=1/0;for(const[h,a]of W){const f=rt(c,e,h,a);f<t&&(t=f)}const l=c*1.7+o,s=e*1.7+o,i=ht(Math.sin(l*127.1+s*311.7)*43758.5453),n=(t+i*ie)/le;return Math.min(1,Math.max(0,n))}const Z=1.4,J=1,ct=60,ut=40,ee=.6,te=.33,mt=6,ft=8,oe=5e-4,dt=10,F=1.5,H=8*m;class vt{renderer;scene;camera;quad;material;bees;rand;soloWall=!0;soloBees=!0;forceKnockAlways=!1;forceLinesAlways=!1;arcOverride=null;forceCrawlers=null;cover=new I(1,1);currentZoom=1;bassE=0;midE=0;highE=0;bassSlowE=0;onsetCooldown=0;flash=0;flashCount=0;flashTimeToNext=0;knockTimeToNext=0;lineTimeToNext=0;lastSongTime=-1;pulse=0;pulseCount=0;pulseOnsetCooldown=0;pulseTimeToNext=0;knockSlotCount=$;knockBoosts=[];knockBoostUniformValues;knockGlows=[];knockGlowUniformValues;lineSlotCount=Q;lines=[];lineAUniformValues;lineMetaUniformValues;crawlerSlotCount=Y;crawlers=[];crawlerUniformValues;crawlerBoosts=[];crawlerBoostUniformValues;hexSeedFloat=0;held=!1;dragDx=0;dragDy=0;velX=0;velY=0;init(e){const{renderer:o,seed:t,quality:l}=e;this.renderer=o,this.rand=se(t^1085400558);const s=new URLSearchParams(location.search),i=s.get("solo");this.soloWall=!i||i==="wall",this.soloBees=!i||i==="bees",this.forceKnockAlways=s.get("knock")==="always",this.forceLinesAlways=s.get("lines")==="always";const n=s.get("arc");if(n){const r=n.split(",").map(Number);r.length===4&&r.every(Number.isFinite)&&(this.arcOverride={hexBuild:r[0],roomBuild:r[1],macro:r[2],dim:r[3]})}const h=s.get("crawlers");if(h!==null){const r=Number(h);Number.isFinite(r)&&(this.forceCrawlers=Math.min(1,Math.max(0,r)))}const a=l.level==="full";this.knockSlotCount=a?$:ke;for(let r=0;r<this.knockSlotCount;r++)this.knockBoosts.push({age:0,active:!1});this.knockBoostUniformValues=[];for(let r=0;r<this.knockSlotCount;r++)this.knockBoostUniformValues.push(new M(0,0,0,0));for(let r=0;r<this.knockSlotCount;r++)this.knockGlows.push({age:0,active:!1});this.knockGlowUniformValues=[];for(let r=0;r<this.knockSlotCount;r++)this.knockGlowUniformValues.push(new M(0,0,0,0));this.lineSlotCount=a?Q:Oe;for(let r=0;r<this.lineSlotCount;r++)this.lines.push({age:0,active:!1});this.lineAUniformValues=[];for(let r=0;r<this.lineSlotCount;r++)this.lineAUniformValues.push(new M(0,0,0,0));this.lineMetaUniformValues=[];for(let r=0;r<this.lineSlotCount;r++)this.lineMetaUniformValues.push(new M(0,0,0,0));this.crawlerSlotCount=a?Y:Le,this.crawlerUniformValues=[];for(let r=0;r<this.crawlerSlotCount;r++)this.crawlerUniformValues.push(new M(0,0,0,0));for(let r=0;r<this.crawlerSlotCount;r++)this.crawlerBoosts.push({age:0,lifetime:0,active:!1});this.crawlerBoostUniformValues=[];for(let r=0;r<this.crawlerSlotCount;r++)this.crawlerBoostUniformValues.push(new M(0,0,0,0));this.scene=new ce,this.camera=new ue(-1,1,1,-1,0,1);const f=new me(2,2),u=(t>>>0)%1e5/1e5;this.hexSeedFloat=u,this.material=new ae({vertexShader:Ne,fragmentShader:Ie(a,this.knockSlotCount,this.lineSlotCount,this.crawlerSlotCount),depthTest:!1,depthWrite:!1,uniforms:{uTime:{value:0},uSeed:{value:u},uHexR:{value:m},uRoomSize:{value:de},uCover:{value:new I(1,1)},uScroll:{value:new I(0,0)},uZoom:{value:1},uHexBuild:{value:0},uRoomBuild:{value:0},uMacro:{value:0},uDim:{value:0},uWallGlow:{value:0},uHoneyFill:{value:0},uRoomLight:{value:0},uShimmer:{value:0},uPalMix:{value:0},uHueVar:{value:0},uBass:{value:0},uMid:{value:0},uHigh:{value:0},uFlash:{value:0},uFlashCount:{value:0},uPulse:{value:0},uPulseCount:{value:0},uGhost:{value:0},uBeatPulse:{value:0},uKnockBoost:{value:this.knockBoostUniformValues},uKnockGlow:{value:this.knockGlowUniformValues},uLineA:{value:this.lineAUniformValues},uLineMeta:{value:this.lineMetaUniformValues},uCrawler:{value:this.crawlerUniformValues},uCrawlerBoost:{value:this.crawlerBoostUniformValues}}}),this.quad=new fe(f,this.material),this.soloWall&&this.scene.add(this.quad),this.bees=new He(t,l,o),this.soloBees&&this.scene.add(this.bees.object),this.initCrawlers();const v=o.domElement,d=v.clientWidth||1,x=v.clientHeight||1;this.resize(d,x)}kickFlash(e){this.flash=Math.min(Qe,this.flash+e),this.flashCount++}kickPulse(e){this.pulse=Math.min(Ze,this.pulse+e),this.pulseCount++}activateKnockBoost(e,o,t=1){let l=this.knockBoosts.findIndex(i=>!i.active);l<0&&(l=0);const s=this.knockBoosts[l];s.active=!0,s.age=0,this.knockBoostUniformValues[l].set(e,o,0,t)}activateKnockGlow(e,o,t=1){let l=this.knockGlows.findIndex(i=>!i.active);l<0&&(l=0);const s=this.knockGlows[l];s.active=!0,s.age=0,this.knockGlowUniformValues[l].set(e,o,0,t)}updateKnockAges(e){for(let o=0;o<this.knockBoosts.length;o++){const t=this.knockBoosts[o];t.active&&(t.age+=e,t.age>=Me?(t.active=!1,this.knockBoostUniformValues[o].w=0):this.knockBoostUniformValues[o].z=t.age)}for(let o=0;o<this.knockGlows.length;o++){const t=this.knockGlows[o];t.active&&(t.age+=e,t.age>=_e?(t.active=!1,this.knockGlowUniformValues[o].w=0):this.knockGlowUniformValues[o].z=t.age)}}scheduleFlash(e,o){const t=Math.max(0,o)/60;if(!(t<=0))for(this.flashTimeToNext-=e;this.flashTimeToNext<=0;){this.kickFlash(Ye);const l=Math.max(1e-6,this.rand());this.flashTimeToNext+=-Math.log(l)/t}}schedulePulse(e,o){const t=Math.max(0,o)/60;if(!(t<=0))for(this.pulseTimeToNext-=e;this.pulseTimeToNext<=0;){this.kickPulse(je);const l=Math.max(1e-6,this.rand());this.pulseTimeToNext+=Math.max(tt,-Math.log(l)/t)}}scheduleKnocks(e,o){const t=Math.max(0,o)/60;if(!(t<=0))for(this.knockTimeToNext-=e;this.knockTimeToNext<=0;){const l=(this.rand()*2-1)*Z,s=(this.rand()*2-1)*J;this.activateKnockBoost(l,s,.6),this.activateKnockGlow(l,s,.6);const i=Math.max(1e-6,this.rand());this.knockTimeToNext+=-Math.log(i)/t}}activateLine(){let e=this.lines.findIndex(v=>!v.active);e<0&&(e=0);const o=this.lines[e],t=this.cover,l=this.material.uniforms.uZoom.value,s=this.material.uniforms.uScroll.value,i=t.x/l*ee,n=t.y/l*ee;let h=0,a=0,f=0,u=0;for(let v=0;v<mt;v++){const d=s.x+(this.rand()*2-1)*i*te,x=s.y+(this.rand()*2-1)*n*te,r=s.x+(this.rand()*2-1)*i,k=s.y+(this.rand()*2-1)*n;if(this.rand()<.5?(h=d,a=x,f=r,u=k):(h=r,a=k,f=d,u=x),Math.hypot(f-h,u-a)>=Be)break}o.active=!0,o.age=0,this.lineAUniformValues[e].set(h,a,f,u),this.lineMetaUniformValues[e].set(0,1,this.rand(),0)}updateLineAges(e){for(let o=0;o<this.lines.length;o++){const t=this.lines[o];t.active&&(t.age+=e,t.age>=Te?(t.active=!1,this.lineMetaUniformValues[o].y=0):this.lineMetaUniformValues[o].x=t.age)}}scheduleLines(e,o){const t=Math.max(0,o)/60;if(!(t<=0))for(this.lineTimeToNext-=e;this.lineTimeToNext<=0;){this.activateLine();const l=Math.max(1e-6,this.rand());this.lineTimeToNext+=-Math.log(l)/t}}initCrawlers(){for(let e=0;e<this.crawlerSlotCount;e++){let o=0,t=0,l=1/0;for(let n=0;n<12;n++){const h=Math.round((this.rand()*2-1)*4),a=Math.round((this.rand()*2-1)*4),f=j(h,a,this.hexSeedFloat);f<l&&(l=f,o=h,t=a)}const s=p[Math.min(p.length-1,Math.floor(this.rand()*p.length))],i={fromQ:o,fromR:t,toQ:o+s[0],toR:t+s[1],heading:0,t:this.rand(),stepDur:q+this.rand()*(ot-q),strength:0};i.heading=Math.atan2(b(i.toQ,i.toR,m)-b(i.fromQ,i.fromR,m),g(i.toQ,i.toR,m)-g(i.fromQ,i.fromR,m)),this.crawlers.push(i)}}chooseNeighbor(e,o,t,l){const s=g(e.toQ,e.toR,m),i=b(e.toQ,e.toR,m),n=Math.cos(e.heading),h=Math.sin(e.heading),a=t-s,f=l-i,u=Math.hypot(a,f),v=Math.max(this.cover.x,this.cover.y)/Math.max(.3,this.currentZoom)*.5,d=Math.min(it,v*.85),x=Math.max(0,u-d),r=u>1e-6?a/u:0,k=u>1e-6?f/u:0,L=[];let C=0;for(const[w,O]of p){const T=e.toQ+w,B=e.toR+O,D=g(T,B,m)-s,P=b(T,B,m)-i,U=Math.hypot(D,P),G=D/U,z=P/U;let E=.35+Math.max(0,G*n+z*h);T===e.fromQ&&B===e.fromR&&(E*=st),j(T,B,this.hexSeedFloat)<=o&&(E*=lt),E*=1+x*nt*Math.max(0,G*r+z*k),L.push(E),C+=E}let S=this.rand()*C;for(let w=0;w<p.length;w++)if(S-=L[w],S<=0)return[e.toQ+p[w][0],e.toR+p[w][1]];const R=p[p.length-1];return[e.toQ+R[0],e.toR+R[1]]}activateCrawlerBoost(e,o,t,l,s){const i=this.crawlerBoosts[e];i.active=!0,i.age=0,i.lifetime=l,this.crawlerBoostUniformValues[e].set(o,t,0,s)}updateCrawlerAges(e){for(let o=0;o<this.crawlerBoosts.length;o++){const t=this.crawlerBoosts[o];t.active&&(t.age+=e,t.age>=t.lifetime?(t.active=!1,this.crawlerBoostUniformValues[o].w=0):this.crawlerBoostUniformValues[o].z=t.age)}}updateCrawlers(e,o,t,l,s){const i=this.crawlers.length,n=Math.min(1,e*3);for(let h=0;h<i;h++){const a=this.crawlers[h],f=h<o*i?1:0;for(a.strength+=(f-a.strength)*n,a.t+=e/a.stepDur;a.t>=1;){a.t-=1;const R=g(a.toQ,a.toR,m),w=b(a.toQ,a.toR,m);this.activateCrawlerBoost(h,R,w,a.stepDur,a.strength);const O=this.chooseNeighbor(a,t,l,s);a.fromQ=a.toQ,a.fromR=a.toR,a.toQ=O[0],a.toR=O[1],a.heading=Math.atan2(b(a.toQ,a.toR,m)-w,g(a.toQ,a.toR,m)-R)}const u=a.t,v=u*u*(3-2*u),d=g(a.fromQ,a.fromR,m),x=b(a.fromQ,a.fromR,m),r=g(a.toQ,a.toR,m),k=b(a.toQ,a.toR,m),L=Math.sin(u*Math.PI*2+h*2.399)*at,C=d+(r-d)*v-Math.sin(a.heading)*L,S=x+(k-x)*v+Math.cos(a.heading)*L;this.crawlerUniformValues[h].set(C,S,a.heading,a.strength)}}update(e,o){const t=Ge(o.time),l=We(o.time),s=t.params;this.lastSongTime>=0&&o.time-this.lastSongTime>=0&&o.time-this.lastSongTime<.5&&(this.lastSongTime<54&&o.time>=54&&this.kickFlash(Xe),this.lastSongTime<188&&o.time>=188&&this.kickFlash($e)),this.lastSongTime=o.time;const i=Math.min(1,e*8);if(this.bassE+=(o.bass-this.bassE)*i,this.midE+=(o.mid-this.midE)*i,this.highE+=(o.high-this.highE)*i,this.bassSlowE+=(o.bass-this.bassSlowE)*Math.min(1,e*1.5),this.onsetCooldown-=e,this.onsetCooldown<=0&&this.bassE-this.bassSlowE>ze){this.kickFlash(Ve);const d=(this.rand()*2-1)*Z,x=(this.rand()*2-1)*J;this.activateKnockBoost(d,x),this.activateKnockGlow(d,x),s.lineRate>=ft&&this.activateLine(),this.onsetCooldown=Ke}this.pulseOnsetCooldown-=e,this.pulseOnsetCooldown<=0&&this.bassE-this.bassSlowE>Je&&(this.kickPulse(qe),this.pulseOnsetCooldown=et),this.scheduleFlash(e,s.flashRate),this.flash*=Math.exp(-3*e),this.schedulePulse(e,s.pulseRate),this.pulse*=Math.exp(-6*e),this.scheduleKnocks(e,this.forceKnockAlways?ct:s.knockRate),this.updateKnockAges(e),this.scheduleLines(e,this.forceLinesAlways?ut:s.lineRate),this.updateLineAges(e);const n=this.material.uniforms;n.uTime.value+=e,n.uBass.value=this.bassE,n.uMid.value=this.midE,n.uHigh.value=this.highE,n.uFlash.value=this.flash,n.uFlashCount.value=this.flashCount,n.uPulse.value=this.pulse,n.uPulseCount.value=this.pulseCount,n.uGhost.value=s.ghost,n.uBeatPulse.value=s.beatPulse,n.uHexBuild.value=this.arcOverride?.hexBuild??l.hexBuild,n.uRoomBuild.value=this.arcOverride?.roomBuild??l.roomBuild,n.uMacro.value=this.arcOverride?.macro??l.macro,n.uDim.value=this.arcOverride?.dim??l.dim,n.uWallGlow.value=s.wallGlow,n.uHoneyFill.value=s.honeyFill,n.uRoomLight.value=s.roomLight,n.uShimmer.value=s.shimmer,n.uPalMix.value=s.palMix,n.uHueVar.value=s.hueVar;const h=s.zoom;n.uZoom.value=h,this.currentZoom=h;const a=n.uScroll.value,f=1+o.mid*.3;a.x+=s.driftX*e*f,a.y+=s.driftY*e*f;const u=this.cover;if(this.held){if(e>1e-5){const d=Math.min(1,e*dt),x=Math.min(F,Math.max(-F,this.dragDx/e)),r=Math.min(F,Math.max(-F,this.dragDy/e));this.velX+=(x-this.velX)*d,this.velY+=(r-this.velY)*d}this.dragDx=0,this.dragDy=0}else if(this.velX!==0||this.velY!==0){a.x+=this.velX*u.x/h*e,a.y+=this.velY*u.y/h*e;const d=Math.exp(-2.5*e);this.velX*=d,this.velY*=d,Math.abs(this.velX)<oe&&(this.velX=0),Math.abs(this.velY)<oe&&(this.velY=0)}const v=Math.hypot(a.x,a.y);v>H&&(a.x*=H/v,a.y*=H/v,this.velX=0,this.velY=0),this.updateCrawlers(e,this.forceCrawlers??s.crawlers,this.arcOverride?.hexBuild??l.hexBuild,a.x,a.y),this.updateCrawlerAges(e),this.bees.update(e,o,t,l,h,u,this.flash)}pointer(e){const o=this.material.uniforms,t=this.cover,l=o.uZoom.value,s=o.uScroll.value;if(e.type==="down"){this.held=!0,this.dragDx=0,this.dragDy=0,this.velX=0,this.velY=0;const i=(e.x-.5)*t.x/l+s.x,n=(e.y-.5)*t.y/l+s.y;this.activateKnockBoost(i,n),this.activateKnockGlow(i,n);return}if(e.type==="move"){if(!this.held)return;s.x+=e.dx*t.x/l,s.y+=e.dy*t.y/l,this.dragDx+=e.dx,this.dragDy+=e.dy;return}if(e.type==="up"){this.held=!1;return}this.held=!1,this.velX=0,this.velY=0,this.dragDx=0,this.dragDy=0}render(){this.renderer.setRenderTarget(null),this.renderer.render(this.scene,this.camera)}resize(e,o){if(!this.material||e<=0||o<=0)return;const t=Math.min(3.5,Math.max(.28,e/o));t>=1?this.cover.set(t,1):this.cover.set(1,1/t),this.material.uniforms.uCover.value.copy(this.cover)}dispose(){this.material.dispose(),this.quad.geometry.dispose(),this.bees.dispose(),this.renderer.setRenderTarget(null)}}const xt={default:()=>new vt},gt=xt.default;export{gt as default};
//# sourceMappingURL=index-BdpdHOMt.js.map
