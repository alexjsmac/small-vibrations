import{B as D,f as A,c as k,e as I,A as G,h as W,V as w,S as U,O as z,d as P,M as V}from"./three-D-rRGwWh.js";import{m as N}from"./random-DL1jLgMw.js";const L=.055,K=16,X=3.5,Y=.6,$=4,q=1.2,R=.05,j=.005,Z=.008,J=.006,E=.08,Q=7,ee=3*L,S=4,te=2,oe=.5,ae=1.1,O=6,ie=3,le=1.6,se=.3,ne=`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;function re(c,e,o){return`
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
uniform vec4 uKnockBoost[${e}];
uniform vec4 uKnockGlow[${e}];
uniform vec4 uLineA[${o}];
uniform vec4 uLineMeta[${o}];

const float HEX_WALL_HALF = ${j.toFixed(4)};
const float ROOM_WALL_HALF = ${Z.toFixed(4)};
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
  vec2 seedA = vec2(0.0, 0.0), seedB = vec2(7.0, -5.0), seedC = vec2(-5.0, 7.0);
  vec2 seedD = vec2(9.0, 2.0), seedE = vec2(-8.0, -3.0);
  float hexRing = min(hexDist(hexId, seedA), min(hexDist(hexId, seedB), min(hexDist(hexId, seedC), min(hexDist(hexId, seedD), hexDist(hexId, seedE)))));
  float hexBirth = clamp((hexRing + hexHash * ${X.toFixed(1)}) / ${K.toFixed(1)}, 0.0, 1.0);
  float hexGrow = 1.0 - smoothstep(uHexBuild, uHexBuild + ${R.toFixed(3)}, hexBirth);

  // Knock boost: a tap (or ambient knock) pre-builds the neighbourhood
  // early, proximity-weighted and decaying — never permanently, so the
  // birth-order field is still the source of truth once the pulse fades.
  for (int i = 0; i < ${e}; i++) {
    vec4 kb = uKnockBoost[i];
    if (kb.w <= 0.0) continue;
    float d = length(wallUv - kb.xy);
    float prox = clamp(1.0 - d / ${ee.toFixed(4)}, 0.0, 1.0);
    hexGrow = max(hexGrow, kb.w * exp(-kb.z * 2.0) * prox);
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
  float roomBirth = clamp((roomRing + roomHash * ${q.toFixed(2)}) / ${$.toFixed(1)}, 0.0, 1.0);
  float roomGrow = 1.0 - smoothstep(uRoomBuild, uRoomBuild + ${R.toFixed(3)}, roomBirth);

  float roomInterior = (1.0 - smoothstep(-aa, aa, roomEdge)) * roomGrow;
  float roomWallMask = (smoothstep(-aa, aa, roomEdge) - smoothstep(ROOM_WALL_HALF - aa, ROOM_WALL_HALF + aa, roomEdge)) * roomGrow;

  // ---- lights-out: latest-built edge cells die first, seed cells die last ----
  float hexAlive = 1.0 - smoothstep(1.0 - uDim - ${E.toFixed(2)}, 1.0 - uDim, hexBirth);
  float roomAlive = 1.0 - smoothstep(1.0 - uDim - ${E.toFixed(2)}, 1.0 - uDim, roomBirth);

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
  float coincide = 1.0 - smoothstep(0.0, ${J.toFixed(3)}, abs(hexEdge - roomEdge));
  float boundaryMask = coincide * hexWallMask * roomWallMask;
  col += boundaryMask * COL_ACCENT * uShimmer * (0.5 + 0.5 * sin(uTime * 3.0 + hexHash * 30.0)) * (0.7 + 0.3 * uHigh);

  // ---- beat pulse: each flash event (kickFlash, i.e. every beat/onset) re-
  // rolls which built cells light and in what colour — warm family (vivid
  // orange/rust-red/cream/amber) with a rare verdigris contrast pop
  // (~1-in-12 cells·beats). Rides uFlash's decay envelope so pulses land on
  // the beat rather than lingering. ----
  float beatRoll = hash21(hexId * 3.1 + uFlashCount * 13.7);
  float beatSel = step(1.0 - uBeatPulse * 0.4, beatRoll);
  float hueRoll = hash21(hexId * 5.3 + uFlashCount * 7.7);
  vec3 pulseCol = hueRoll < 0.30 ? vec3(1.0, 0.55, 0.10)
               : hueRoll < 0.55 ? vec3(0.95, 0.20, 0.10)
               : hueRoll < 0.80 ? vec3(1.0, 0.9, 0.55)
               : hueRoll < 0.92 ? vec3(1.0, 0.75, 0.20)
               : vec3(0.25, 0.85, 0.65);
  col += pulseCol * beatSel * uFlash * uBeatPulse * hexInterior * hexAlive * 0.9;

  // ---- macro comb: climax scale shift, coordinated with the zoom pull-back.
  // Guarded: uMacro is 0 for ~85% of the track — skip the second lattice
  // evaluation entirely outside the climax. Same pointy-top/apothem fix as
  // the main lattice. ----
  if (uMacro > 0.001) {
    float macroR = uHexR * ${Q.toFixed(1)};
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
`}class he{constructor(e,o,t){this.renderer=t;const i=N(e^11746099),a=Math.min(o.particleBudget,o.level==="full"?2e4:6e3),n=new Float32Array(a*3),l=new Float32Array(a);for(let h=0;h<a;h++)n[h*3+0]=(i()*2-1)*3.2,n[h*3+1]=(i()*2-1)*2,n[h*3+2]=(i()*2-1)*2.4,l[h]=i();this.geometry=new D,this.geometry.setAttribute("position",new A(n,3)),this.geometry.setAttribute("aSeed",new A(l,1)),this.uniforms={uFlowTime:{value:0},uTurbulence:{value:.7},uFlowAmount:{value:1.1},uSwarm:{value:0},uSettle:{value:0},uDensity:{value:1},uBrightness:{value:.6},uHigh:{value:0},uBass:{value:0},uScale:{value:96},uSeedShift:{value:i()*100},uFlash:{value:0},uAccent:{value:.25},uZoom:{value:1},uCover:{value:new k(1,1)}},this.material=new I({uniforms:this.uniforms,transparent:!0,depthTest:!1,depthWrite:!1,blending:G,vertexShader:`
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
      `}),this.object=new W(this.geometry,this.material),this.object.frustumCulled=!1}object;material;geometry;uniforms;update(e,o,t,i,a,n,l=0){const h=t.params,r=this.uniforms;r.uFlowTime.value+=e*(.4+h.beeSwarm*.6),r.uTurbulence.value=.6+i.energy*.4,r.uFlowAmount.value=.9+i.energy*.5,r.uSwarm.value=h.beeSwarm,r.uSettle.value=i.settle,r.uDensity.value=h.beeDensity,r.uHigh.value=o.high,r.uBass.value=o.bass,r.uFlash.value=l,r.uZoom.value=a,r.uCover.value.copy(n),r.uScale.value=this.renderer.domElement.height*.12}dispose(){this.geometry.dispose(),this.material.dispose()}}const g=[0,54,101,132,188,252,267,294.124],y=[{name:"groundbreaking",wallGlow:.4,honeyFill:.15,roomLight:0,shimmer:0,beeDensity:.35,beeSwarm:.1,flashRate:2.5,knockRate:4,driftX:.02,driftY:.01,palMix:.1,hueVar:.4,zoom:1,ghost:.8,beatPulse:.15,lineRate:0},{name:"raising-the-frame",wallGlow:.65,honeyFill:.5,roomLight:.2,shimmer:.15,beeDensity:.4,beeSwarm:.25,flashRate:8,knockRate:4,driftX:.05,driftY:.02,palMix:.3,hueVar:.55,zoom:1,ghost:.5,beatPulse:.8,lineRate:6},{name:"settling-in",wallGlow:.55,honeyFill:.4,roomLight:.15,shimmer:0,beeDensity:.3,beeSwarm:.2,flashRate:2,knockRate:2,driftX:.015,driftY:.01,palMix:.25,hueVar:.5,zoom:1,ghost:.2,beatPulse:.2,lineRate:1},{name:"inside-the-house",wallGlow:.5,honeyFill:.45,roomLight:.4,shimmer:.1,beeDensity:.3,beeSwarm:.15,flashRate:3,knockRate:6,driftX:.01,driftY:.04,palMix:.4,hueVar:.6,zoom:1.6,ghost:.15,beatPulse:.35,lineRate:2},{name:"two-homes-one-wall",wallGlow:.9,honeyFill:.85,roomLight:.6,shimmer:1,beeDensity:.85,beeSwarm:.85,flashRate:9,knockRate:16,driftX:.08,driftY:.03,palMix:.6,hueVar:.8,zoom:.55,ghost:.3,beatPulse:1,lineRate:20},{name:"housewarming",wallGlow:.75,honeyFill:.75,roomLight:.5,shimmer:.4,beeDensity:.5,beeSwarm:.5,flashRate:3,knockRate:9,driftX:.03,driftY:.015,palMix:.5,hueVar:.65,zoom:.85,ghost:0,beatPulse:.25,lineRate:3},{name:"lights-out",wallGlow:.3,honeyFill:.2,roomLight:.05,shimmer:0,beeDensity:.1,beeSwarm:.1,flashRate:.3,knockRate:0,driftX:.005,driftY:.005,palMix:.2,hueVar:.3,zoom:1,ghost:0,beatPulse:0,lineRate:0}],x=[[0,.05,0,0,0,0,.15],[53.8,.24,0,0,0,0,.4],[54.3,.3,0,0,0,0,.75],[95,.58,0,0,0,0,.7],[101,.6,0,0,0,0,.35],[132,.6,0,0,0,0,.3],[150,.63,.12,0,0,0,.35],[187.8,.7,.38,0,0,0,.5],[188.4,.78,.5,0,.1,0,1],[215,.93,.85,0,1,0,1],[225,1,1,0,1,0,.95],[248,1,1,0,1,.9,.85],[252,1,1,0,1,.95,.7],[267,1,1,0,0,1,.4],[290,1,1,.97,0,1,.08],[294.124,1,1,1,0,1,0]],v={hexBuild:0,roomBuild:0,dim:0,macro:0,settle:0,energy:0};function ce(c){const e=Math.min(Math.max(c,0),x[x.length-1][0]);let o=0;for(;o<x.length-2&&e>=x[o+1][0];)o++;const t=x[o],i=x[o+1],a=Math.min(1,Math.max(0,(e-t[0])/Math.max(.001,i[0]-t[0])));return v.hexBuild=t[1]+(i[1]-t[1])*a,v.roomBuild=t[2]+(i[2]-t[2])*a,v.dim=t[3]+(i[3]-t[3])*a,v.macro=t[4]+(i[4]-t[4])*a,v.settle=t[5]+(i[5]-t[5])*a,v.energy=t[6]+(i[6]-t[6])*a,v}const ue=6;function me(c){const e=Math.min(1,Math.max(0,c));return e*e*(3-2*e)}function fe(c,e,o){if(o<=0)return c;if(o>=1)return e;const t={...c,name:o<.5?c.name:e.name};for(const i of Object.keys(c)){const a=c[i],n=e[i];typeof a=="number"&&typeof n=="number"&&(t[i]=a+(n-a)*o)}return t}function de(c){const e=g[g.length-1],o=Math.min(Math.max(c,0),e-.001);let t=0;for(;t<y.length-1&&o>=g[t+1];)t++;const i=g[t],a=g[t+1]??e,n=Math.min(1,Math.max(0,(o-i)/Math.max(.001,a-i))),l=t<y.length-1,h=a-o,r=l?me(1-Math.min(1,h/ue)):0,f=y[t],u=l?y[t+1]:f;return{params:fe(f,u,r),actIndex:t,localT:n,blend:r}}const ve=.12,xe=1.5,ge=.5,pe=.9,we=1.2,ye=.4,be=1.5,C=1.4,T=1,ke=60,Me=40,B=.6,F=.33,Le=6,_e=8,H=5e-4,Ae=10,b=1.5,M=8*L;class Re{renderer;scene;camera;quad;material;bees;rand;soloWall=!0;soloBees=!0;forceKnockAlways=!1;forceLinesAlways=!1;arcOverride=null;cover=new k(1,1);bassE=0;midE=0;highE=0;bassSlowE=0;onsetCooldown=0;flash=0;flashCount=0;flashTimeToNext=0;knockTimeToNext=0;lineTimeToNext=0;lastSongTime=-1;knockSlotCount=S;knockBoosts=[];knockBoostUniformValues;knockGlows=[];knockGlowUniformValues;lineSlotCount=O;lines=[];lineAUniformValues;lineMetaUniformValues;held=!1;dragDx=0;dragDy=0;velX=0;velY=0;init(e){const{renderer:o,seed:t,quality:i}=e;this.renderer=o,this.rand=N(t^1085400558);const a=new URLSearchParams(location.search),n=a.get("solo");this.soloWall=!n||n==="wall",this.soloBees=!n||n==="bees",this.forceKnockAlways=a.get("knock")==="always",this.forceLinesAlways=a.get("lines")==="always";const l=a.get("arc");if(l){const s=l.split(",").map(Number);s.length===4&&s.every(Number.isFinite)&&(this.arcOverride={hexBuild:s[0],roomBuild:s[1],macro:s[2],dim:s[3]})}const h=i.level==="full";this.knockSlotCount=h?S:te;for(let s=0;s<this.knockSlotCount;s++)this.knockBoosts.push({age:0,active:!1});this.knockBoostUniformValues=[];for(let s=0;s<this.knockSlotCount;s++)this.knockBoostUniformValues.push(new w(0,0,0,0));for(let s=0;s<this.knockSlotCount;s++)this.knockGlows.push({age:0,active:!1});this.knockGlowUniformValues=[];for(let s=0;s<this.knockSlotCount;s++)this.knockGlowUniformValues.push(new w(0,0,0,0));this.lineSlotCount=h?O:ie;for(let s=0;s<this.lineSlotCount;s++)this.lines.push({age:0,active:!1});this.lineAUniformValues=[];for(let s=0;s<this.lineSlotCount;s++)this.lineAUniformValues.push(new w(0,0,0,0));this.lineMetaUniformValues=[];for(let s=0;s<this.lineSlotCount;s++)this.lineMetaUniformValues.push(new w(0,0,0,0));this.scene=new U,this.camera=new z(-1,1,1,-1,0,1);const r=new P(2,2),f=(t>>>0)%1e5/1e5;this.material=new I({vertexShader:ne,fragmentShader:re(h,this.knockSlotCount,this.lineSlotCount),depthTest:!1,depthWrite:!1,uniforms:{uTime:{value:0},uSeed:{value:f},uHexR:{value:L},uRoomSize:{value:Y},uCover:{value:new k(1,1)},uScroll:{value:new k(0,0)},uZoom:{value:1},uHexBuild:{value:0},uRoomBuild:{value:0},uMacro:{value:0},uDim:{value:0},uWallGlow:{value:0},uHoneyFill:{value:0},uRoomLight:{value:0},uShimmer:{value:0},uPalMix:{value:0},uHueVar:{value:0},uBass:{value:0},uMid:{value:0},uHigh:{value:0},uFlash:{value:0},uFlashCount:{value:0},uGhost:{value:0},uBeatPulse:{value:0},uKnockBoost:{value:this.knockBoostUniformValues},uKnockGlow:{value:this.knockGlowUniformValues},uLineA:{value:this.lineAUniformValues},uLineMeta:{value:this.lineMetaUniformValues}}}),this.quad=new V(r,this.material),this.soloWall&&this.scene.add(this.quad),this.bees=new he(t,i,o),this.soloBees&&this.scene.add(this.bees.object);const u=o.domElement,d=u.clientWidth||1,m=u.clientHeight||1;this.resize(d,m)}kickFlash(e){this.flash=Math.min(be,this.flash+e),this.flashCount++}activateKnockBoost(e,o,t=1){let i=this.knockBoosts.findIndex(n=>!n.active);i<0&&(i=0);const a=this.knockBoosts[i];a.active=!0,a.age=0,this.knockBoostUniformValues[i].set(e,o,0,t)}activateKnockGlow(e,o,t=1){let i=this.knockGlows.findIndex(n=>!n.active);i<0&&(i=0);const a=this.knockGlows[i];a.active=!0,a.age=0,this.knockGlowUniformValues[i].set(e,o,0,t)}updateKnockAges(e){for(let o=0;o<this.knockBoosts.length;o++){const t=this.knockBoosts[o];t.active&&(t.age+=e,t.age>=oe?(t.active=!1,this.knockBoostUniformValues[o].w=0):this.knockBoostUniformValues[o].z=t.age)}for(let o=0;o<this.knockGlows.length;o++){const t=this.knockGlows[o];t.active&&(t.age+=e,t.age>=ae?(t.active=!1,this.knockGlowUniformValues[o].w=0):this.knockGlowUniformValues[o].z=t.age)}}scheduleFlash(e,o){const t=Math.max(0,o)/60;if(!(t<=0))for(this.flashTimeToNext-=e;this.flashTimeToNext<=0;){this.kickFlash(ye);const i=Math.max(1e-6,this.rand());this.flashTimeToNext+=-Math.log(i)/t}}scheduleKnocks(e,o){const t=Math.max(0,o)/60;if(!(t<=0))for(this.knockTimeToNext-=e;this.knockTimeToNext<=0;){const i=(this.rand()*2-1)*C,a=(this.rand()*2-1)*T;this.activateKnockBoost(i,a,.6),this.activateKnockGlow(i,a,.6);const n=Math.max(1e-6,this.rand());this.knockTimeToNext+=-Math.log(n)/t}}activateLine(){let e=this.lines.findIndex(d=>!d.active);e<0&&(e=0);const o=this.lines[e],t=this.cover,i=this.material.uniforms.uZoom.value,a=this.material.uniforms.uScroll.value,n=t.x/i*B,l=t.y/i*B;let h=0,r=0,f=0,u=0;for(let d=0;d<Le;d++){const m=a.x+(this.rand()*2-1)*n*F,s=a.y+(this.rand()*2-1)*l*F,p=a.x+(this.rand()*2-1)*n,_=a.y+(this.rand()*2-1)*l;if(this.rand()<.5?(h=m,r=s,f=p,u=_):(h=p,r=_,f=m,u=s),Math.hypot(f-h,u-r)>=se)break}o.active=!0,o.age=0,this.lineAUniformValues[e].set(h,r,f,u),this.lineMetaUniformValues[e].set(0,1,this.rand(),0)}updateLineAges(e){for(let o=0;o<this.lines.length;o++){const t=this.lines[o];t.active&&(t.age+=e,t.age>=le?(t.active=!1,this.lineMetaUniformValues[o].y=0):this.lineMetaUniformValues[o].x=t.age)}}scheduleLines(e,o){const t=Math.max(0,o)/60;if(!(t<=0))for(this.lineTimeToNext-=e;this.lineTimeToNext<=0;){this.activateLine();const i=Math.max(1e-6,this.rand());this.lineTimeToNext+=-Math.log(i)/t}}update(e,o){const t=de(o.time),i=ce(o.time),a=t.params;this.lastSongTime>=0&&o.time-this.lastSongTime>=0&&o.time-this.lastSongTime<.5&&(this.lastSongTime<54&&o.time>=54&&this.kickFlash(pe),this.lastSongTime<188&&o.time>=188&&this.kickFlash(we)),this.lastSongTime=o.time;const n=Math.min(1,e*8);if(this.bassE+=(o.bass-this.bassE)*n,this.midE+=(o.mid-this.midE)*n,this.highE+=(o.high-this.highE)*n,this.bassSlowE+=(o.bass-this.bassSlowE)*Math.min(1,e*1.5),this.onsetCooldown-=e,this.onsetCooldown<=0&&this.bassE-this.bassSlowE>ve){this.kickFlash(ge);const m=(this.rand()*2-1)*C,s=(this.rand()*2-1)*T;this.activateKnockBoost(m,s),this.activateKnockGlow(m,s),a.lineRate>=_e&&this.activateLine(),this.onsetCooldown=xe}this.scheduleFlash(e,a.flashRate),this.flash*=Math.exp(-3*e),this.scheduleKnocks(e,this.forceKnockAlways?ke:a.knockRate),this.updateKnockAges(e),this.scheduleLines(e,this.forceLinesAlways?Me:a.lineRate),this.updateLineAges(e);const l=this.material.uniforms;l.uTime.value+=e,l.uBass.value=this.bassE,l.uMid.value=this.midE,l.uHigh.value=this.highE,l.uFlash.value=this.flash,l.uFlashCount.value=this.flashCount,l.uGhost.value=a.ghost,l.uBeatPulse.value=a.beatPulse,l.uHexBuild.value=this.arcOverride?.hexBuild??i.hexBuild,l.uRoomBuild.value=this.arcOverride?.roomBuild??i.roomBuild,l.uMacro.value=this.arcOverride?.macro??i.macro,l.uDim.value=this.arcOverride?.dim??i.dim,l.uWallGlow.value=a.wallGlow,l.uHoneyFill.value=a.honeyFill,l.uRoomLight.value=a.roomLight,l.uShimmer.value=a.shimmer,l.uPalMix.value=a.palMix,l.uHueVar.value=a.hueVar;const h=a.zoom;l.uZoom.value=h;const r=l.uScroll.value,f=1+o.mid*.3;r.x+=a.driftX*e*f,r.y+=a.driftY*e*f;const u=this.cover;if(this.held){if(e>1e-5){const m=Math.min(1,e*Ae),s=Math.min(b,Math.max(-b,this.dragDx/e)),p=Math.min(b,Math.max(-b,this.dragDy/e));this.velX+=(s-this.velX)*m,this.velY+=(p-this.velY)*m}this.dragDx=0,this.dragDy=0}else if(this.velX!==0||this.velY!==0){r.x+=this.velX*u.x/h*e,r.y+=this.velY*u.y/h*e;const m=Math.exp(-2.5*e);this.velX*=m,this.velY*=m,Math.abs(this.velX)<H&&(this.velX=0),Math.abs(this.velY)<H&&(this.velY=0)}const d=Math.hypot(r.x,r.y);d>M&&(r.x*=M/d,r.y*=M/d,this.velX=0,this.velY=0),this.bees.update(e,o,t,i,h,u,this.flash)}pointer(e){const o=this.material.uniforms,t=this.cover,i=o.uZoom.value,a=o.uScroll.value;if(e.type==="down"){this.held=!0,this.dragDx=0,this.dragDy=0,this.velX=0,this.velY=0;const n=(e.x-.5)*t.x/i+a.x,l=(e.y-.5)*t.y/i+a.y;this.activateKnockBoost(n,l),this.activateKnockGlow(n,l);return}if(e.type==="move"){if(!this.held)return;a.x+=e.dx*t.x/i,a.y+=e.dy*t.y/i,this.dragDx+=e.dx,this.dragDy+=e.dy;return}if(e.type==="up"){this.held=!1;return}this.held=!1,this.velX=0,this.velY=0,this.dragDx=0,this.dragDy=0}render(){this.renderer.setRenderTarget(null),this.renderer.render(this.scene,this.camera)}resize(e,o){if(!this.material||e<=0||o<=0)return;const t=e/o;t>=1?this.cover.set(t,1):this.cover.set(1,1/t),this.material.uniforms.uCover.value.copy(this.cover)}dispose(){this.material.dispose(),this.quad.geometry.dispose(),this.bees.dispose(),this.renderer.setRenderTarget(null)}}const Ee={default:()=>new Re},Ce=Ee.default;export{Ce as default};
//# sourceMappingURL=index-C_JBw6Cy.js.map
