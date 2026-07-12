import{a as Q,n as j,L as Z,b as Le,H as _e,S as de,O as fe,d as ve,e as U,M as ge,B as Me,f as J,c as D,A as ke,h as Ee,V as _}from"./three-3OWXJ662.js";import{m as we}from"./random-DL1jLgMw.js";const m=.055,pe=16,xe=3.5,k=.6,Ae=4,Se=1.2,ee=.05,Oe=.005,Ce=.008,Te=.006,te=.08,Be=7,Fe=3*m,V=2.6,oe=4,Ne=2,Ie=.5,He=1.1,z=[[0,0],[7,-5],[-5,7],[9,2],[-8,-3]],ae=10,De=5,Ue=.5*m,Pe=.22*m,We=1.6*m,Ge=.5*m,ze=1.5*m,se=6,Ve=3,Ke=1.6,Xe=.3,$e=`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`,be=`
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
  roomBirth = clamp((roomRing + roomHash * ${Se.toFixed(2)}) / ${Ae.toFixed(1)}, 0.0, 1.0);
}
`;function Ye(u){function e(t){return t===u-1?`hexDist(hexId, seed${t})`:`min(hexDist(hexId, seed${t}), ${e(t+1)})`}return e(0)}function qe(u,e,t,o){return`
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
uniform vec4 uLineA[${t}];
uniform vec4 uLineMeta[${t}];
// Homemakers: xy wall pos, z heading (rad), w strength 0..1.
uniform vec4 uCrawler[${o}];
// xy cell-center wall pos, z age (s), w strength 0..1 — dedicated array, NOT
// a reuse of uKnockBoost: knock is user-tap-facing feedback, and folding
// crawler pre-build into the same pool would let ambient crawler traffic
// steal/overwrite a tap's boost slot.
uniform vec4 uCrawlerBoost[${o}];
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

const float HEX_WALL_HALF = ${Oe.toFixed(4)};
const float ROOM_WALL_HALF = ${Ce.toFixed(4)};
const float REGION_HALF = ${V.toFixed(2)};
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
${u?`  p = p * 2.03 + 17.1;
  v += 0.25 * vnoise(p);`:""}
  return v;
}

${be}

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

${u?"  float aa = fwidth(wallUv.x) * 1.5;":"  float aa = 0.0035;"} // fixed epsilon on Lite: no derivatives on that path

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
${z.map((a,s)=>`  vec2 seed${s} = vec2(${a[0].toFixed(1)}, ${a[1].toFixed(1)});`).join(`
`)}
  float hexRing = ${Ye(z.length)};
  float hexBirth = clamp((hexRing + hexHash * ${xe.toFixed(1)}) / ${pe.toFixed(1)}, 0.0, 1.0);
  float hexGrow = 1.0 - smoothstep(uHexBuild, uHexBuild + ${ee.toFixed(3)}, hexBirth);

  // Knock boost: a tap (or ambient knock) pre-builds the neighbourhood
  // early, proximity-weighted and decaying — never permanently, so the
  // birth-order field is still the source of truth once the pulse fades.
  for (int i = 0; i < ${e}; i++) {
    vec4 kb = uKnockBoost[i];
    if (kb.w <= 0.0) continue;
    float d = length(wallUv - kb.xy);
    float prox = clamp(1.0 - d / ${Fe.toFixed(4)}, 0.0, 1.0);
    hexGrow = max(hexGrow, kb.w * exp(-kb.z * 2.0) * prox);
  }

  // Crawler boost: each Homemaker pre-builds the single cell it's standing
  // on (+ a tight rim) as it passes, same decay shape as the knock boost
  // above but a much smaller radius (CRAWLER_BOOST_RADIUS = 1.5*HEX_R vs.
  // knock's 3*HEX_R — only the cell underfoot should visibly "finish") and
  // its own array (see uCrawlerBoost's declaration for why it isn't folded
  // into uKnockBoost).
  for (int i = 0; i < ${o}; i++) {
    vec4 cb = uCrawlerBoost[i];
    if (cb.w <= 0.0) continue;
    float d = length(wallUv - cb.xy);
    float prox = clamp(1.0 - d / ${ze.toFixed(4)}, 0.0, 1.0);
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
  float roomGrow = 1.0 - smoothstep(uRoomBuild, uRoomBuild + ${ee.toFixed(3)}, roomBirth);

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
  float hexAlive = 1.0 - smoothstep(1.0 - uDim - ${te.toFixed(2)}, 1.0 - uDim, hexBirth);
  float roomAlive = 1.0 - smoothstep(1.0 - uDim - ${te.toFixed(2)}, 1.0 - uDim, roomBirth);

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
  float coincide = 1.0 - smoothstep(0.0, ${Te.toFixed(3)}, abs(hexEdge - roomEdge));
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
    float macroR = uHexR * ${Be.toFixed(1)};
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
  const float CRAWLER_LEN = ${Ue.toFixed(5)};
  const float CRAWLER_WID = ${Pe.toFixed(5)};
  const float WAKE_LEN = ${We.toFixed(5)};
  const float WAKE_WID = ${Ge.toFixed(5)};
  // Ember, deliberately NOT COL_WALL_GLOW — the wake needs to read as the
  // crawler's own trail, not just more of the wall's ambient gold glow (the
  // two would visually merge into one indistinct color on a built cell).
  const vec3 COL_CRAWLER_WAKE = vec3(0.95, 0.55, 0.18);
  for (int i = 0; i < ${o}; i++) {
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
  for (int i = 0; i < ${t}; i++) {
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
`}const ie=`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`,Qe=.012,je=8,Ze=3,Je=1024,et=512,tt=.4*m,ot=.55*m;function at(u,e,t){return`
precision highp float;
varying vec2 vUv;
uniform sampler2D uPrev;
uniform float uDecayR, uDecayG;
uniform vec4 uLineA[${u}];
uniform vec4 uLineMeta[${u}];
uniform vec4 uCrawler[${e}];

const float REGION_HALF = ${V.toFixed(2)};
const float LINE_HALF_DEPOSIT = ${Qe.toFixed(4)};
const float CRAWLER_SPLAT_R = ${t.toFixed(6)};

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
  for (int i = 0; i < ${u}; i++) {
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
  for (int i = 0; i < ${e}; i++) {
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
`}function st(){return`
precision highp float;
varying vec2 vUv;
uniform float uRoomBuildAtSeed;
uniform float uSeed, uRoomSize;

const float REGION_HALF = ${V.toFixed(2)};

float hash21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

${be}

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
`}class it{renderer;targets;readIndex=0;scene;camera;quad;depositMaterial;seedMaterial;constructor(e,t,o,a,s,r,c,h){this.renderer=e;const l=t?Je:et,i={type:_e,format:Le,minFilter:Z,magFilter:Z,wrapS:j,wrapT:j,depthBuffer:!1,stencilBuffer:!1};this.targets=[new Q(l,l,i),new Q(l,l,i)];const f=t?tt:ot;this.scene=new de,this.camera=new fe(-1,1,1,-1,0,1);const d=new ve(2,2);this.depositMaterial=new U({vertexShader:ie,fragmentShader:at(o,a,f),depthTest:!1,depthWrite:!1,uniforms:{uPrev:{value:null},uDecayR:{value:1},uDecayG:{value:1},uLineA:{value:r},uLineMeta:{value:c},uCrawler:{value:h}}}),this.seedMaterial=new U({vertexShader:ie,fragmentShader:st(),depthTest:!1,depthWrite:!1,uniforms:{uRoomBuildAtSeed:{value:0},uSeed:{value:s},uRoomSize:{value:k}}}),this.quad=new ge(d,this.depositMaterial),this.scene.add(this.quad)}step(e){this.depositMaterial.uniforms.uDecayR.value=Math.exp(-e/je),this.depositMaterial.uniforms.uDecayG.value=Math.exp(-e/Ze);const t=this.renderer.getRenderTarget(),o=this.targets[this.readIndex],a=this.targets[1-this.readIndex];this.depositMaterial.uniforms.uPrev.value=o.texture,this.quad.material=this.depositMaterial,this.renderer.setRenderTarget(a),this.renderer.render(this.scene,this.camera),this.readIndex=1-this.readIndex,this.renderer.setRenderTarget(t??null)}seed(e){this.seedMaterial.uniforms.uRoomBuildAtSeed.value=e;const t=this.renderer.getRenderTarget();this.quad.material=this.seedMaterial;for(const o of this.targets)this.renderer.setRenderTarget(o),this.renderer.render(this.scene,this.camera);this.renderer.setRenderTarget(t??null),this.quad.material=this.depositMaterial}get texture(){return this.targets[this.readIndex].texture}dispose(){this.targets[0].dispose(),this.targets[1].dispose(),this.depositMaterial.dispose(),this.seedMaterial.dispose(),this.quad.geometry.dispose()}}class lt{constructor(e,t,o){this.renderer=o;const a=we(e^11746099),s=Math.min(t.particleBudget,t.level==="full"?2e4:6e3),r=new Float32Array(s*3),c=new Float32Array(s);for(let h=0;h<s;h++)r[h*3+0]=(a()*2-1)*3.2,r[h*3+1]=(a()*2-1)*2,r[h*3+2]=(a()*2-1)*2.4,c[h]=a();this.geometry=new Me,this.geometry.setAttribute("position",new J(r,3)),this.geometry.setAttribute("aSeed",new J(c,1)),this.uniforms={uFlowTime:{value:0},uTurbulence:{value:.7},uFlowAmount:{value:1.1},uSwarm:{value:0},uSettle:{value:0},uDensity:{value:1},uBrightness:{value:.6},uHigh:{value:0},uBass:{value:0},uScale:{value:96},uSeedShift:{value:a()*100},uFlash:{value:0},uAccent:{value:.25},uZoom:{value:1},uCover:{value:new D(1,1)}},this.material=new U({uniforms:this.uniforms,transparent:!0,depthTest:!1,depthWrite:!1,blending:ke,vertexShader:`
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
      `}),this.object=new Ee(this.geometry,this.material),this.object.frustumCulled=!1}object;material;geometry;uniforms;update(e,t,o,a,s,r,c=0){const h=o.params,l=this.uniforms;l.uFlowTime.value+=e*(.4+h.beeSwarm*.6),l.uTurbulence.value=.6+a.energy*.4,l.uFlowAmount.value=.9+a.energy*.5,l.uSwarm.value=h.beeSwarm,l.uSettle.value=a.settle,l.uDensity.value=h.beeDensity,l.uHigh.value=t.high,l.uBass.value=t.bass,l.uFlash.value=c,l.uZoom.value=s,l.uCover.value.copy(r),l.uScale.value=this.renderer.domElement.height*.12}dispose(){this.geometry.dispose(),this.material.dispose()}}const O=[0,54,101,132,188,252,267,294.124],I=[{name:"groundbreaking",wallGlow:.4,honeyFill:.15,roomLight:0,shimmer:0,beeDensity:.35,beeSwarm:.1,flashRate:2.5,knockRate:4,driftX:.02,driftY:.01,palMix:.1,hueVar:.4,zoom:1,ghost:.8,beatPulse:.15,lineRate:0,pulseRate:8,crawlers:.2,damage:.35},{name:"raising-the-frame",wallGlow:.65,honeyFill:.5,roomLight:.2,shimmer:.15,beeDensity:.4,beeSwarm:.25,flashRate:8,knockRate:4,driftX:.05,driftY:.02,palMix:.3,hueVar:.55,zoom:1,ghost:.5,beatPulse:.8,lineRate:6,pulseRate:60,crawlers:.5,damage:.6},{name:"settling-in",wallGlow:.55,honeyFill:.4,roomLight:.15,shimmer:.12,beeDensity:.3,beeSwarm:.2,flashRate:2,knockRate:5,driftX:.015,driftY:.01,palMix:.25,hueVar:.5,zoom:1,ghost:.2,beatPulse:.2,lineRate:3,pulseRate:30,crawlers:.35,damage:.5},{name:"inside-the-house",wallGlow:.5,honeyFill:.45,roomLight:.4,shimmer:.18,beeDensity:.3,beeSwarm:.15,flashRate:3,knockRate:8,driftX:.01,driftY:.04,palMix:.4,hueVar:.6,zoom:1.6,ghost:.15,beatPulse:.35,lineRate:4,pulseRate:45,crawlers:.6,damage:.55},{name:"two-homes-one-wall",wallGlow:.9,honeyFill:.85,roomLight:.6,shimmer:1,beeDensity:.85,beeSwarm:.85,flashRate:9,knockRate:16,driftX:.08,driftY:.03,palMix:.6,hueVar:.8,zoom:.55,ghost:.3,beatPulse:1,lineRate:20,pulseRate:90,crawlers:.9,damage:1},{name:"housewarming",wallGlow:.75,honeyFill:.75,roomLight:.5,shimmer:.4,beeDensity:.5,beeSwarm:.5,flashRate:3,knockRate:9,driftX:.03,driftY:.015,palMix:.5,hueVar:.65,zoom:.85,ghost:0,beatPulse:.25,lineRate:3,pulseRate:25,crawlers:.55,damage:.4},{name:"lights-out",wallGlow:.3,honeyFill:.2,roomLight:.05,shimmer:0,beeDensity:.1,beeSwarm:.1,flashRate:.3,knockRate:0,driftX:.005,driftY:.005,palMix:.2,hueVar:.3,zoom:1,ghost:0,beatPulse:0,lineRate:0,pulseRate:4,crawlers:.1,damage:.15}],M=[[0,.05,0,0,0,0,.15],[53.8,.24,0,0,0,0,.4],[54.3,.3,0,0,0,0,.75],[95,.58,0,0,0,0,.7],[101,.6,0,0,0,0,.35],[132,.6,0,0,0,0,.3],[150,.63,.12,0,0,0,.35],[187.8,.7,.38,0,0,0,.5],[188.4,.78,.5,0,.1,0,1],[215,.93,.85,0,1,0,1],[225,1,1,0,1,0,.95],[248,1,1,0,1,.9,.85],[252,1,1,0,1,.95,.7],[267,1,1,0,0,1,.4],[290,1,1,.97,0,1,.08],[294.124,1,1,1,0,1,0]],R={hexBuild:0,roomBuild:0,dim:0,macro:0,settle:0,energy:0};function rt(u){const e=Math.min(Math.max(u,0),M[M.length-1][0]);let t=0;for(;t<M.length-2&&e>=M[t+1][0];)t++;const o=M[t],a=M[t+1],s=Math.min(1,Math.max(0,(e-o[0])/Math.max(.001,a[0]-o[0])));return R.hexBuild=o[1]+(a[1]-o[1])*s,R.roomBuild=o[2]+(a[2]-o[2])*s,R.dim=o[3]+(a[3]-o[3])*s,R.macro=o[4]+(a[4]-o[4])*s,R.settle=o[5]+(a[5]-o[5])*s,R.energy=o[6]+(a[6]-o[6])*s,R}const nt=6;function ct(u){const e=Math.min(1,Math.max(0,u));return e*e*(3-2*e)}function ht(u,e,t){if(t<=0)return u;if(t>=1)return e;const o={...u,name:t<.5?u.name:e.name};for(const a of Object.keys(u)){const s=u[a],r=e[a];typeof s=="number"&&typeof r=="number"&&(o[a]=s+(r-s)*t)}return o}function ut(u){const e=O[O.length-1],t=Math.min(Math.max(u,0),e-.001);let o=0;for(;o<I.length-1&&t>=O[o+1];)o++;const a=O[o],s=O[o+1]??e,r=Math.min(1,Math.max(0,(t-a)/Math.max(.001,s-a))),c=o<I.length-1,h=s-t,l=c?ct(1-Math.min(1,h/nt)):0,i=I[o],f=c?I[o+1]:i;return{params:ht(i,f,l),actIndex:o,localT:r,blend:l}}const mt=.12,dt=1.5,ft=.5,vt=.9,gt=1.2,wt=.4,pt=1.5,xt=.6,bt=.5,yt=1.2,Rt=.06,Lt=.3,_t=.12,le=.5,Mt=.9,kt=.006,Et=.08,At=1.8,St=1.1,Ot=1.5,Ct=3,Tt=.04,x=[[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]];function b(u,e,t){return t*(1.7320508*u+.8660254*e)}function y(u,e,t){return t*1.5*e}function Bt(u,e,t,o){const a=u,s=-u-e,r=e,c=t,h=-t-o,l=o;return Math.max(Math.abs(a-c),Math.abs(s-h),Math.abs(r-l))}function Ft(u){return u-Math.floor(u)}function re(u,e,t){let o=1/0;for(const[h,l]of z){const i=Bt(u,e,h,l);i<o&&(o=i)}const a=u*1.7+t,s=e*1.7+t,r=Ft(Math.sin(a*127.1+s*311.7)*43758.5453),c=(o+r*xe)/pe;return Math.min(1,Math.max(0,c))}const ne=1.4,ce=1,Nt=60,It=40,he=.6,ue=.33,Ht=6,Dt=8,me=5e-4,Ut=10,H=1.5,G=8*m;class Pt{renderer;scene;camera;quad;material;bees;traceField;rand;soloWall=!0;soloBees=!0;forceKnockAlways=!1;forceLinesAlways=!1;arcOverride=null;forceCrawlers=null;forceTraceOff=!1;firstUpdate=!0;lastDt=0;cover=new D(1,1);currentZoom=1;bassE=0;midE=0;highE=0;bassSlowE=0;onsetCooldown=0;flash=0;flashCount=0;flashTimeToNext=0;knockTimeToNext=0;lineTimeToNext=0;lastSongTime=-1;pulse=0;pulseCount=0;pulseOnsetCooldown=0;pulseTimeToNext=0;knockSlotCount=oe;knockBoosts=[];knockBoostUniformValues;knockGlows=[];knockGlowUniformValues;lineSlotCount=se;lines=[];lineAUniformValues;lineMetaUniformValues;crawlerSlotCount=ae;crawlers=[];crawlerUniformValues;crawlerBoosts=[];crawlerBoostUniformValues;hexSeedFloat=0;held=!1;dragDx=0;dragDy=0;velX=0;velY=0;init(e){const{renderer:t,seed:o,quality:a}=e;this.renderer=t,this.rand=we(o^1085400558);const s=new URLSearchParams(location.search),r=s.get("solo");this.soloWall=!r||r==="wall",this.soloBees=!r||r==="bees",this.forceKnockAlways=s.get("knock")==="always",this.forceLinesAlways=s.get("lines")==="always",this.forceTraceOff=s.get("trace")==="off";const c=s.get("arc");if(c){const n=c.split(",").map(Number);n.length===4&&n.every(Number.isFinite)&&(this.arcOverride={hexBuild:n[0],roomBuild:n[1],macro:n[2],dim:n[3]})}const h=s.get("crawlers");if(h!==null){const n=Number(h);Number.isFinite(n)&&(this.forceCrawlers=Math.min(1,Math.max(0,n)))}const l=a.level==="full";this.knockSlotCount=l?oe:Ne;for(let n=0;n<this.knockSlotCount;n++)this.knockBoosts.push({age:0,active:!1});this.knockBoostUniformValues=[];for(let n=0;n<this.knockSlotCount;n++)this.knockBoostUniformValues.push(new _(0,0,0,0));for(let n=0;n<this.knockSlotCount;n++)this.knockGlows.push({age:0,active:!1});this.knockGlowUniformValues=[];for(let n=0;n<this.knockSlotCount;n++)this.knockGlowUniformValues.push(new _(0,0,0,0));this.lineSlotCount=l?se:Ve;for(let n=0;n<this.lineSlotCount;n++)this.lines.push({age:0,active:!1});this.lineAUniformValues=[];for(let n=0;n<this.lineSlotCount;n++)this.lineAUniformValues.push(new _(0,0,0,0));this.lineMetaUniformValues=[];for(let n=0;n<this.lineSlotCount;n++)this.lineMetaUniformValues.push(new _(0,0,0,0));this.crawlerSlotCount=l?ae:De,this.crawlerUniformValues=[];for(let n=0;n<this.crawlerSlotCount;n++)this.crawlerUniformValues.push(new _(0,0,0,0));for(let n=0;n<this.crawlerSlotCount;n++)this.crawlerBoosts.push({age:0,lifetime:0,active:!1});this.crawlerBoostUniformValues=[];for(let n=0;n<this.crawlerSlotCount;n++)this.crawlerBoostUniformValues.push(new _(0,0,0,0));this.scene=new de,this.camera=new fe(-1,1,1,-1,0,1);const i=new ve(2,2),f=(o>>>0)%1e5/1e5;this.hexSeedFloat=f,this.material=new U({vertexShader:$e,fragmentShader:qe(l,this.knockSlotCount,this.lineSlotCount,this.crawlerSlotCount),depthTest:!1,depthWrite:!1,uniforms:{uTime:{value:0},uSeed:{value:f},uHexR:{value:m},uRoomSize:{value:k},uCover:{value:new D(1,1)},uScroll:{value:new D(0,0)},uZoom:{value:1},uHexBuild:{value:0},uRoomBuild:{value:0},uMacro:{value:0},uDim:{value:0},uWallGlow:{value:0},uHoneyFill:{value:0},uRoomLight:{value:0},uShimmer:{value:0},uPalMix:{value:0},uHueVar:{value:0},uBass:{value:0},uMid:{value:0},uHigh:{value:0},uFlash:{value:0},uFlashCount:{value:0},uPulse:{value:0},uPulseCount:{value:0},uGhost:{value:0},uBeatPulse:{value:0},uKnockBoost:{value:this.knockBoostUniformValues},uKnockGlow:{value:this.knockGlowUniformValues},uLineA:{value:this.lineAUniformValues},uLineMeta:{value:this.lineMetaUniformValues},uCrawler:{value:this.crawlerUniformValues},uCrawlerBoost:{value:this.crawlerBoostUniformValues},uTrace:{value:null},uDamage:{value:0},uTraceOff:{value:this.forceTraceOff?1:0}}}),this.quad=new ge(i,this.material),this.soloWall&&this.scene.add(this.quad),this.bees=new lt(o,a,t),this.soloBees&&this.scene.add(this.bees.object),this.traceField=new it(t,l,this.lineSlotCount,this.crawlerSlotCount,f,this.lineAUniformValues,this.lineMetaUniformValues,this.crawlerUniformValues),this.initCrawlers();const d=t.domElement,v=d.clientWidth||1,g=d.clientHeight||1;this.resize(v,g)}kickFlash(e){this.flash=Math.min(pt,this.flash+e),this.flashCount++}kickPulse(e){this.pulse=Math.min(yt,this.pulse+e),this.pulseCount++}activateKnockBoost(e,t,o=1){let a=this.knockBoosts.findIndex(r=>!r.active);a<0&&(a=0);const s=this.knockBoosts[a];s.active=!0,s.age=0,this.knockBoostUniformValues[a].set(e,t,0,o)}activateKnockGlow(e,t,o=1){let a=this.knockGlows.findIndex(r=>!r.active);a<0&&(a=0);const s=this.knockGlows[a];s.active=!0,s.age=0,this.knockGlowUniformValues[a].set(e,t,0,o)}updateKnockAges(e){for(let t=0;t<this.knockBoosts.length;t++){const o=this.knockBoosts[t];o.active&&(o.age+=e,o.age>=Ie?(o.active=!1,this.knockBoostUniformValues[t].w=0):this.knockBoostUniformValues[t].z=o.age)}for(let t=0;t<this.knockGlows.length;t++){const o=this.knockGlows[t];o.active&&(o.age+=e,o.age>=He?(o.active=!1,this.knockGlowUniformValues[t].w=0):this.knockGlowUniformValues[t].z=o.age)}}scheduleFlash(e,t){const o=Math.max(0,t)/60;if(!(o<=0))for(this.flashTimeToNext-=e;this.flashTimeToNext<=0;){this.kickFlash(wt);const a=Math.max(1e-6,this.rand());this.flashTimeToNext+=-Math.log(a)/o}}schedulePulse(e,t){const o=Math.max(0,t)/60;if(!(o<=0))for(this.pulseTimeToNext-=e;this.pulseTimeToNext<=0;){this.kickPulse(bt);const a=Math.max(1e-6,this.rand());this.pulseTimeToNext+=Math.max(_t,-Math.log(a)/o)}}scheduleKnocks(e,t){const o=Math.max(0,t)/60;if(!(o<=0))for(this.knockTimeToNext-=e;this.knockTimeToNext<=0;){const a=(this.rand()*2-1)*ne,s=(this.rand()*2-1)*ce;this.activateKnockBoost(a,s,.6),this.activateKnockGlow(a,s,.6);const r=Math.max(1e-6,this.rand());this.knockTimeToNext+=-Math.log(r)/o}}activateLine(){let e=this.lines.findIndex(d=>!d.active);e<0&&(e=0);const t=this.lines[e],o=this.cover,a=this.material.uniforms.uZoom.value,s=this.material.uniforms.uScroll.value,r=o.x/a*he,c=o.y/a*he;let h=0,l=0,i=0,f=0;for(let d=0;d<Ht;d++){const v=s.x+(this.rand()*2-1)*r*ue,g=s.y+(this.rand()*2-1)*c*ue,n=s.x+(this.rand()*2-1)*r,w=s.y+(this.rand()*2-1)*c;if(this.rand()<.5?(h=v,l=g,i=n,f=w):(h=n,l=w,i=v,f=g),Math.hypot(i-h,f-l)>=Xe)break}t.active=!0,t.age=0,this.lineAUniformValues[e].set(h,l,i,f),this.lineMetaUniformValues[e].set(0,1,this.rand(),0)}updateLineAges(e){for(let t=0;t<this.lines.length;t++){const o=this.lines[t];o.active&&(o.age+=e,o.age>=Ke?(o.active=!1,this.lineMetaUniformValues[t].y=0):this.lineMetaUniformValues[t].x=o.age)}}scheduleLines(e,t){const o=Math.max(0,t)/60;if(!(o<=0))for(this.lineTimeToNext-=e;this.lineTimeToNext<=0;){this.activateLine();const a=Math.max(1e-6,this.rand());this.lineTimeToNext+=-Math.log(a)/o}}initCrawlers(){for(let e=0;e<this.crawlerSlotCount;e++){let t=0,o=0,a=1/0;for(let c=0;c<12;c++){const h=Math.round((this.rand()*2-1)*4),l=Math.round((this.rand()*2-1)*4),i=re(h,l,this.hexSeedFloat);i<a&&(a=i,t=h,o=l)}const s=x[Math.min(x.length-1,Math.floor(this.rand()*x.length))],r={fromQ:t,fromR:o,toQ:t+s[0],toR:o+s[1],heading:0,t:this.rand(),stepDur:le+this.rand()*(Mt-le),strength:0};r.heading=Math.atan2(y(r.toQ,r.toR,m)-y(r.fromQ,r.fromR,m),b(r.toQ,r.toR,m)-b(r.fromQ,r.fromR,m)),this.crawlers.push(r)}}chooseNeighbor(e,t,o,a,s){const r=b(e.toQ,e.toR,m),c=y(e.toQ,e.toR,m),h=Math.cos(e.heading),l=Math.sin(e.heading),i=o-r,f=a-c,d=Math.hypot(i,f),v=Math.max(this.cover.x,this.cover.y)/Math.max(.3,this.currentZoom)*.5,g=Math.min(St,v*.85),n=Math.max(0,d-g),w=d>1e-6?i/d:0,E=d>1e-6?f/d:0,A=[];let C=0;for(const[p,B]of x){const F=e.toQ+p,N=e.toR+B,P=b(F,N,m),W=y(F,N,m),K=P-r,X=W-c,$=Math.hypot(K,X),Y=K/$,q=X/$;let L=.35+Math.max(0,Y*h+q*l);if(F===e.fromQ&&N===e.fromR&&(L*=Et),re(F,N,this.hexSeedFloat)<=t&&(L*=At),L*=1+n*Ot*Math.max(0,Y*w+q*E),s){const ye=Math.abs(P-Math.round(P/k)*k),Re=Math.abs(W-Math.round(W/k)*k);Math.min(ye,Re)<Tt&&(L*=Ct)}A.push(L),C+=L}let T=this.rand()*C;for(let p=0;p<x.length;p++)if(T-=A[p],T<=0)return[e.toQ+x[p][0],e.toR+x[p][1]];const S=x[x.length-1];return[e.toQ+S[0],e.toR+S[1]]}activateCrawlerBoost(e,t,o,a,s){const r=this.crawlerBoosts[e];r.active=!0,r.age=0,r.lifetime=a,this.crawlerBoostUniformValues[e].set(t,o,0,s)}updateCrawlerAges(e){for(let t=0;t<this.crawlerBoosts.length;t++){const o=this.crawlerBoosts[t];o.active&&(o.age+=e,o.age>=o.lifetime?(o.active=!1,this.crawlerBoostUniformValues[t].w=0):this.crawlerBoostUniformValues[t].z=o.age)}}updateCrawlers(e,t,o,a,s,r){const c=this.crawlers.length,h=Math.min(1,e*3);for(let l=0;l<c;l++){const i=this.crawlers[l],f=l<t*c?1:0;for(i.strength+=(f-i.strength)*h,i.t+=e/i.stepDur;i.t>=1;){i.t-=1;const S=b(i.toQ,i.toR,m),p=y(i.toQ,i.toR,m);this.activateCrawlerBoost(l,S,p,i.stepDur,i.strength);const B=this.chooseNeighbor(i,o,a,s,r);i.fromQ=i.toQ,i.fromR=i.toR,i.toQ=B[0],i.toR=B[1],i.heading=Math.atan2(y(i.toQ,i.toR,m)-p,b(i.toQ,i.toR,m)-S)}const d=i.t,v=d*d*(3-2*d),g=b(i.fromQ,i.fromR,m),n=y(i.fromQ,i.fromR,m),w=b(i.toQ,i.toR,m),E=y(i.toQ,i.toR,m),A=Math.sin(d*Math.PI*2+l*2.399)*kt,C=g+(w-g)*v-Math.sin(i.heading)*A,T=n+(E-n)*v+Math.cos(i.heading)*A;this.crawlerUniformValues[l].set(C,T,i.heading,i.strength)}}update(e,t){const o=ut(t.time),a=rt(t.time),s=o.params;this.lastDt=e,this.firstUpdate&&(this.firstUpdate=!1,this.traceField.seed(this.arcOverride?.roomBuild??a.roomBuild)),this.lastSongTime>=0&&t.time<this.lastSongTime-10&&this.traceField.seed(this.arcOverride?.roomBuild??a.roomBuild),this.lastSongTime>=0&&t.time-this.lastSongTime>=0&&t.time-this.lastSongTime<.5&&(this.lastSongTime<54&&t.time>=54&&this.kickFlash(vt),this.lastSongTime<188&&t.time>=188&&this.kickFlash(gt)),this.lastSongTime=t.time;const r=Math.min(1,e*8);if(this.bassE+=(t.bass-this.bassE)*r,this.midE+=(t.mid-this.midE)*r,this.highE+=(t.high-this.highE)*r,this.bassSlowE+=(t.bass-this.bassSlowE)*Math.min(1,e*1.5),this.onsetCooldown-=e,this.onsetCooldown<=0&&this.bassE-this.bassSlowE>mt){this.kickFlash(ft);const n=(this.rand()*2-1)*ne,w=(this.rand()*2-1)*ce;this.activateKnockBoost(n,w),this.activateKnockGlow(n,w),s.lineRate>=Dt&&this.activateLine(),this.onsetCooldown=dt}this.pulseOnsetCooldown-=e,this.pulseOnsetCooldown<=0&&this.bassE-this.bassSlowE>Rt&&(this.kickPulse(xt),this.pulseOnsetCooldown=Lt),this.scheduleFlash(e,s.flashRate),this.flash*=Math.exp(-3*e),this.schedulePulse(e,s.pulseRate),this.pulse*=Math.exp(-6*e),this.scheduleKnocks(e,this.forceKnockAlways?Nt:s.knockRate),this.updateKnockAges(e),this.scheduleLines(e,this.forceLinesAlways?It:s.lineRate),this.updateLineAges(e);const c=this.material.uniforms;c.uTime.value+=e,c.uBass.value=this.bassE,c.uMid.value=this.midE,c.uHigh.value=this.highE,c.uFlash.value=this.flash,c.uFlashCount.value=this.flashCount,c.uPulse.value=this.pulse,c.uPulseCount.value=this.pulseCount,c.uGhost.value=s.ghost,c.uBeatPulse.value=s.beatPulse,c.uDamage.value=s.damage,c.uHexBuild.value=this.arcOverride?.hexBuild??a.hexBuild,c.uRoomBuild.value=this.arcOverride?.roomBuild??a.roomBuild,c.uMacro.value=this.arcOverride?.macro??a.macro,c.uDim.value=this.arcOverride?.dim??a.dim,c.uWallGlow.value=s.wallGlow,c.uHoneyFill.value=s.honeyFill,c.uRoomLight.value=s.roomLight,c.uShimmer.value=s.shimmer,c.uPalMix.value=s.palMix,c.uHueVar.value=s.hueVar;const h=s.zoom;c.uZoom.value=h,this.currentZoom=h;const l=c.uScroll.value,i=1+t.mid*.3;l.x+=s.driftX*e*i,l.y+=s.driftY*e*i;const f=this.cover;if(this.held){if(e>1e-5){const n=Math.min(1,e*Ut),w=Math.min(H,Math.max(-H,this.dragDx/e)),E=Math.min(H,Math.max(-H,this.dragDy/e));this.velX+=(w-this.velX)*n,this.velY+=(E-this.velY)*n}this.dragDx=0,this.dragDy=0}else if(this.velX!==0||this.velY!==0){l.x+=this.velX*f.x/h*e,l.y+=this.velY*f.y/h*e;const n=Math.exp(-2.5*e);this.velX*=n,this.velY*=n,Math.abs(this.velX)<me&&(this.velX=0),Math.abs(this.velY)<me&&(this.velY=0)}const d=Math.hypot(l.x,l.y);d>G&&(l.x*=G/d,l.y*=G/d,this.velX=0,this.velY=0);const v=this.arcOverride?.roomBuild??a.roomBuild,g=v>0&&v<1;this.updateCrawlers(e,this.forceCrawlers??s.crawlers,this.arcOverride?.hexBuild??a.hexBuild,l.x,l.y,g),this.updateCrawlerAges(e),this.bees.update(e,t,o,a,h,f,this.flash)}pointer(e){const t=this.material.uniforms,o=this.cover,a=t.uZoom.value,s=t.uScroll.value;if(e.type==="down"){this.held=!0,this.dragDx=0,this.dragDy=0,this.velX=0,this.velY=0;const r=(e.x-.5)*o.x/a+s.x,c=(e.y-.5)*o.y/a+s.y;this.activateKnockBoost(r,c),this.activateKnockGlow(r,c);return}if(e.type==="move"){if(!this.held)return;s.x+=e.dx*o.x/a,s.y+=e.dy*o.y/a,this.dragDx+=e.dx,this.dragDy+=e.dy;return}if(e.type==="up"){this.held=!1;return}this.held=!1,this.velX=0,this.velY=0,this.dragDx=0,this.dragDy=0}render(){this.traceField.step(this.lastDt),this.material.uniforms.uTrace.value=this.traceField.texture,this.renderer.setRenderTarget(null),this.renderer.render(this.scene,this.camera)}resize(e,t){if(!this.material||e<=0||t<=0)return;const o=Math.min(3.5,Math.max(.28,e/t));o>=1?this.cover.set(o,1):this.cover.set(1,1/o),this.material.uniforms.uCover.value.copy(this.cover)}dispose(){this.material.dispose(),this.quad.geometry.dispose(),this.bees.dispose(),this.traceField.dispose(),this.renderer.setRenderTarget(null)}}const Wt={default:()=>new Pt},Vt=Wt.default;export{Vt as default};
//# sourceMappingURL=index-Du48_6Cz.js.map
