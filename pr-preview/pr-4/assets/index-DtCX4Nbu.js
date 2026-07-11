import{B as T,f as L,c as k,e as B,A as C,h as W,V as _,S as D,O as G,d as N,M as z}from"./three-D-rRGwWh.js";import{m as F}from"./random-DL1jLgMw.js";const b=.055,I=16,K=3.5,U=.6,P=4,V=1.2,S=.05,X=.005,Y=.008,$=.006,M=.08,q=7,Z=3*b,O=4,j=2,J=.5,Q=1.1,ee=`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;function oe(c,e){return`
precision highp float;
varying vec2 vUv;

uniform float uTime, uSeed;
uniform float uHexR, uRoomSize;
uniform vec2 uCover, uScroll;
uniform float uZoom;
uniform float uHexBuild, uRoomBuild, uMacro, uDim;
uniform float uWallGlow, uHoneyFill, uRoomLight, uShimmer, uPalMix, uHueVar;
uniform float uBass, uMid, uHigh, uFlash;
uniform vec4 uKnockBoost[${e}];
uniform vec4 uKnockGlow[${e}];

const float HEX_WALL_HALF = ${X.toFixed(4)};
const float ROOM_WALL_HALF = ${Y.toFixed(4)};

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

  vec2 seedA = vec2(0.0, 0.0), seedB = vec2(7.0, -5.0), seedC = vec2(-5.0, 7.0);
  float hexRing = min(hexDist(hexId, seedA), min(hexDist(hexId, seedB), hexDist(hexId, seedC)));
  float hexBirth = clamp((hexRing + hexHash * ${K.toFixed(1)}) / ${I.toFixed(1)}, 0.0, 1.0);
  float hexGrow = 1.0 - smoothstep(uHexBuild, uHexBuild + ${S.toFixed(3)}, hexBirth);

  // Knock boost: a tap (or ambient knock) pre-builds the neighbourhood
  // early, proximity-weighted and decaying — never permanently, so the
  // birth-order field is still the source of truth once the pulse fades.
  for (int i = 0; i < ${e}; i++) {
    vec4 kb = uKnockBoost[i];
    if (kb.w <= 0.0) continue;
    float d = length(wallUv - kb.xy);
    float prox = clamp(1.0 - d / ${Z.toFixed(4)}, 0.0, 1.0);
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
  float roomBirth = clamp((roomRing + roomHash * ${V.toFixed(2)}) / ${P.toFixed(1)}, 0.0, 1.0);
  float roomGrow = 1.0 - smoothstep(uRoomBuild, uRoomBuild + ${S.toFixed(3)}, roomBirth);

  float roomInterior = (1.0 - smoothstep(-aa, aa, roomEdge)) * roomGrow;
  float roomWallMask = (smoothstep(-aa, aa, roomEdge) - smoothstep(ROOM_WALL_HALF - aa, ROOM_WALL_HALF + aa, roomEdge)) * roomGrow;

  // ---- lights-out: latest-built edge cells die first, seed cells die last ----
  float hexAlive = 1.0 - smoothstep(1.0 - uDim - ${M.toFixed(2)}, 1.0 - uDim, hexBirth);
  float roomAlive = 1.0 - smoothstep(1.0 - uDim - ${M.toFixed(2)}, 1.0 - uDim, roomBirth);

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
  float coincide = 1.0 - smoothstep(0.0, ${$.toFixed(3)}, abs(hexEdge - roomEdge));
  float boundaryMask = coincide * hexWallMask * roomWallMask;
  col += boundaryMask * COL_ACCENT * uShimmer * (0.5 + 0.5 * sin(uTime * 3.0 + hexHash * 30.0)) * (0.7 + 0.3 * uHigh);

  // ---- macro comb: climax scale shift, coordinated with the zoom pull-back.
  // Guarded: uMacro is 0 for ~85% of the track — skip the second lattice
  // evaluation entirely outside the climax. Same pointy-top/apothem fix as
  // the main lattice. ----
  if (uMacro > 0.001) {
    float macroR = uHexR * ${q.toFixed(1)};
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

  // ---- finish: grain, vignette, filmic ----
  col += (hash21(gl_FragCoord.xy) - 0.5) * 0.02;
  float vig = smoothstep(1.25, 0.35, length(vUv - 0.5) * 1.6);
  col *= vig;
  col = 1.0 - exp(-col * 2.2);
  gl_FragColor = vec4(col, 1.0);
}
`}class te{constructor(e,t,o){this.renderer=o;const a=F(e^11746099),i=Math.min(t.particleBudget,t.level==="full"?2e4:6e3),l=new Float32Array(i*3),s=new Float32Array(i);for(let h=0;h<i;h++)l[h*3+0]=(a()*2-1)*3.2,l[h*3+1]=(a()*2-1)*2,l[h*3+2]=(a()*2-1)*2.4,s[h]=a();this.geometry=new T,this.geometry.setAttribute("position",new L(l,3)),this.geometry.setAttribute("aSeed",new L(s,1)),this.uniforms={uFlowTime:{value:0},uTurbulence:{value:.7},uFlowAmount:{value:1.1},uSwarm:{value:0},uSettle:{value:0},uDensity:{value:1},uBrightness:{value:.6},uHigh:{value:0},uBass:{value:0},uScale:{value:96},uSeedShift:{value:a()*100},uFlash:{value:0},uAccent:{value:.25},uZoom:{value:1},uCover:{value:new k(1,1)}},this.material=new B({uniforms:this.uniforms,transparent:!0,depthTest:!1,depthWrite:!1,blending:C,vertexShader:`
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
      `}),this.object=new W(this.geometry,this.material),this.object.frustumCulled=!1}object;material;geometry;uniforms;update(e,t,o,a,i,l,s=0){const h=o.params,n=this.uniforms;n.uFlowTime.value+=e*(.4+h.beeSwarm*.6),n.uTurbulence.value=.6+a.energy*.4,n.uFlowAmount.value=.9+a.energy*.5,n.uSwarm.value=h.beeSwarm,n.uSettle.value=a.settle,n.uDensity.value=h.beeDensity,n.uHigh.value=t.high,n.uBass.value=t.bass,n.uFlash.value=s,n.uZoom.value=i,n.uCover.value.copy(l),n.uScale.value=this.renderer.domElement.height*.12}dispose(){this.geometry.dispose(),this.material.dispose()}}const g=[0,54,101,132,188,252,267,294.124],p=[{name:"groundbreaking",wallGlow:.4,honeyFill:.15,roomLight:0,shimmer:0,beeDensity:.2,beeSwarm:.1,flashRate:1.5,knockRate:.5,driftX:.02,driftY:.01,palMix:.1,hueVar:.4,zoom:1},{name:"raising-the-frame",wallGlow:.65,honeyFill:.5,roomLight:.2,shimmer:.15,beeDensity:.4,beeSwarm:.25,flashRate:8,knockRate:4,driftX:.05,driftY:.02,palMix:.3,hueVar:.55,zoom:1},{name:"settling-in",wallGlow:.55,honeyFill:.4,roomLight:.15,shimmer:0,beeDensity:.3,beeSwarm:.2,flashRate:2,knockRate:2,driftX:.015,driftY:.01,palMix:.25,hueVar:.5,zoom:1},{name:"inside-the-house",wallGlow:.5,honeyFill:.45,roomLight:.4,shimmer:.1,beeDensity:.3,beeSwarm:.15,flashRate:3,knockRate:6,driftX:.01,driftY:.04,palMix:.4,hueVar:.6,zoom:1.6},{name:"two-homes-one-wall",wallGlow:.9,honeyFill:.85,roomLight:.6,shimmer:1,beeDensity:.85,beeSwarm:.85,flashRate:9,knockRate:16,driftX:.08,driftY:.03,palMix:.6,hueVar:.8,zoom:.55},{name:"housewarming",wallGlow:.75,honeyFill:.75,roomLight:.5,shimmer:.4,beeDensity:.5,beeSwarm:.5,flashRate:3,knockRate:9,driftX:.03,driftY:.015,palMix:.5,hueVar:.65,zoom:.85},{name:"lights-out",wallGlow:.3,honeyFill:.2,roomLight:.05,shimmer:0,beeDensity:.1,beeSwarm:.1,flashRate:.3,knockRate:0,driftX:.005,driftY:.005,palMix:.2,hueVar:.3,zoom:1}],v=[[0,.05,0,0,0,0,.15],[53.8,.24,0,0,0,0,.4],[54.3,.3,0,0,0,0,.75],[95,.58,0,0,0,0,.7],[101,.6,0,0,0,0,.35],[132,.6,0,0,0,0,.3],[150,.63,.12,0,0,0,.35],[187.8,.7,.38,0,0,0,.5],[188.4,.78,.5,0,.1,0,1],[215,.93,.85,0,1,0,1],[225,1,1,0,1,0,.95],[248,1,1,0,1,.9,.85],[252,1,1,0,1,.95,.7],[267,1,1,0,0,1,.4],[290,1,1,.97,0,1,.08],[294.124,1,1,1,0,1,0]],f={hexBuild:0,roomBuild:0,dim:0,macro:0,settle:0,energy:0};function ae(c){const e=Math.min(Math.max(c,0),v[v.length-1][0]);let t=0;for(;t<v.length-2&&e>=v[t+1][0];)t++;const o=v[t],a=v[t+1],i=Math.min(1,Math.max(0,(e-o[0])/Math.max(.001,a[0]-o[0])));return f.hexBuild=o[1]+(a[1]-o[1])*i,f.roomBuild=o[2]+(a[2]-o[2])*i,f.dim=o[3]+(a[3]-o[3])*i,f.macro=o[4]+(a[4]-o[4])*i,f.settle=o[5]+(a[5]-o[5])*i,f.energy=o[6]+(a[6]-o[6])*i,f}const ie=6;function se(c){const e=Math.min(1,Math.max(0,c));return e*e*(3-2*e)}function le(c,e,t){if(t<=0)return c;if(t>=1)return e;const o={...c,name:t<.5?c.name:e.name};for(const a of Object.keys(c)){const i=c[a],l=e[a];typeof i=="number"&&typeof l=="number"&&(o[a]=i+(l-i)*t)}return o}function ne(c){const e=g[g.length-1],t=Math.min(Math.max(c,0),e-.001);let o=0;for(;o<p.length-1&&t>=g[o+1];)o++;const a=g[o],i=g[o+1]??e,l=Math.min(1,Math.max(0,(t-a)/Math.max(.001,i-a))),s=o<p.length-1,h=i-t,n=s?se(1-Math.min(1,h/ie)):0,d=p[o],m=s?p[o+1]:d;return{params:le(d,m,n),actIndex:o,localT:l,blend:n}}const re=.12,he=1.5,ce=.5,ue=.9,me=1.2,de=.4,fe=1.5,A=1.4,R=1,ve=60,E=5e-4,xe=10,w=1.5,y=8*b;class ge{renderer;scene;camera;quad;material;bees;rand;soloWall=!0;soloBees=!0;forceKnockAlways=!1;arcOverride=null;cover=new k(1,1);bassE=0;midE=0;highE=0;bassSlowE=0;onsetCooldown=0;flash=0;flashTimeToNext=0;knockTimeToNext=0;lastSongTime=-1;knockSlotCount=O;knockBoosts=[];knockBoostUniformValues;knockGlows=[];knockGlowUniformValues;held=!1;dragDx=0;dragDy=0;velX=0;velY=0;init(e){const{renderer:t,seed:o,quality:a}=e;this.renderer=t,this.rand=F(o^1085400558);const i=new URLSearchParams(location.search),l=i.get("solo");this.soloWall=!l||l==="wall",this.soloBees=!l||l==="bees",this.forceKnockAlways=i.get("knock")==="always";const s=i.get("arc");if(s){const r=s.split(",").map(Number);r.length===4&&r.every(Number.isFinite)&&(this.arcOverride={hexBuild:r[0],roomBuild:r[1],macro:r[2],dim:r[3]})}const h=a.level==="full";this.knockSlotCount=h?O:j;for(let r=0;r<this.knockSlotCount;r++)this.knockBoosts.push({age:0,active:!1});this.knockBoostUniformValues=[];for(let r=0;r<this.knockSlotCount;r++)this.knockBoostUniformValues.push(new _(0,0,0,0));for(let r=0;r<this.knockSlotCount;r++)this.knockGlows.push({age:0,active:!1});this.knockGlowUniformValues=[];for(let r=0;r<this.knockSlotCount;r++)this.knockGlowUniformValues.push(new _(0,0,0,0));this.scene=new D,this.camera=new G(-1,1,1,-1,0,1);const n=new N(2,2),d=(o>>>0)%1e5/1e5;this.material=new B({vertexShader:ee,fragmentShader:oe(h,this.knockSlotCount),depthTest:!1,depthWrite:!1,uniforms:{uTime:{value:0},uSeed:{value:d},uHexR:{value:b},uRoomSize:{value:U},uCover:{value:new k(1,1)},uScroll:{value:new k(0,0)},uZoom:{value:1},uHexBuild:{value:0},uRoomBuild:{value:0},uMacro:{value:0},uDim:{value:0},uWallGlow:{value:0},uHoneyFill:{value:0},uRoomLight:{value:0},uShimmer:{value:0},uPalMix:{value:0},uHueVar:{value:0},uBass:{value:0},uMid:{value:0},uHigh:{value:0},uFlash:{value:0},uKnockBoost:{value:this.knockBoostUniformValues},uKnockGlow:{value:this.knockGlowUniformValues}}}),this.quad=new z(n,this.material),this.soloWall&&this.scene.add(this.quad),this.bees=new te(o,a,t),this.soloBees&&this.scene.add(this.bees.object);const m=t.domElement,x=m.clientWidth||1,u=m.clientHeight||1;this.resize(x,u)}kickFlash(e){this.flash=Math.min(fe,this.flash+e)}activateKnockBoost(e,t,o=1){let a=this.knockBoosts.findIndex(l=>!l.active);a<0&&(a=0);const i=this.knockBoosts[a];i.active=!0,i.age=0,this.knockBoostUniformValues[a].set(e,t,0,o)}activateKnockGlow(e,t,o=1){let a=this.knockGlows.findIndex(l=>!l.active);a<0&&(a=0);const i=this.knockGlows[a];i.active=!0,i.age=0,this.knockGlowUniformValues[a].set(e,t,0,o)}updateKnockAges(e){for(let t=0;t<this.knockBoosts.length;t++){const o=this.knockBoosts[t];o.active&&(o.age+=e,o.age>=J?(o.active=!1,this.knockBoostUniformValues[t].w=0):this.knockBoostUniformValues[t].z=o.age)}for(let t=0;t<this.knockGlows.length;t++){const o=this.knockGlows[t];o.active&&(o.age+=e,o.age>=Q?(o.active=!1,this.knockGlowUniformValues[t].w=0):this.knockGlowUniformValues[t].z=o.age)}}scheduleFlash(e,t){const o=Math.max(0,t)/60;if(!(o<=0))for(this.flashTimeToNext-=e;this.flashTimeToNext<=0;){this.kickFlash(de);const a=Math.max(1e-6,this.rand());this.flashTimeToNext+=-Math.log(a)/o}}scheduleKnocks(e,t){const o=Math.max(0,t)/60;if(!(o<=0))for(this.knockTimeToNext-=e;this.knockTimeToNext<=0;){const a=(this.rand()*2-1)*A,i=(this.rand()*2-1)*R;this.activateKnockBoost(a,i,.6),this.activateKnockGlow(a,i,.6);const l=Math.max(1e-6,this.rand());this.knockTimeToNext+=-Math.log(l)/o}}update(e,t){const o=ne(t.time),a=ae(t.time),i=o.params;this.lastSongTime>=0&&t.time-this.lastSongTime>=0&&t.time-this.lastSongTime<.5&&(this.lastSongTime<54&&t.time>=54&&this.kickFlash(ue),this.lastSongTime<188&&t.time>=188&&this.kickFlash(me)),this.lastSongTime=t.time;const l=Math.min(1,e*8);if(this.bassE+=(t.bass-this.bassE)*l,this.midE+=(t.mid-this.midE)*l,this.highE+=(t.high-this.highE)*l,this.bassSlowE+=(t.bass-this.bassSlowE)*Math.min(1,e*1.5),this.onsetCooldown-=e,this.onsetCooldown<=0&&this.bassE-this.bassSlowE>re){this.kickFlash(ce);const u=(this.rand()*2-1)*A,r=(this.rand()*2-1)*R;this.activateKnockBoost(u,r),this.activateKnockGlow(u,r),this.onsetCooldown=he}this.scheduleFlash(e,i.flashRate),this.flash*=Math.exp(-3*e),this.scheduleKnocks(e,this.forceKnockAlways?ve:i.knockRate),this.updateKnockAges(e);const s=this.material.uniforms;s.uTime.value+=e,s.uBass.value=this.bassE,s.uMid.value=this.midE,s.uHigh.value=this.highE,s.uFlash.value=this.flash,s.uHexBuild.value=this.arcOverride?.hexBuild??a.hexBuild,s.uRoomBuild.value=this.arcOverride?.roomBuild??a.roomBuild,s.uMacro.value=this.arcOverride?.macro??a.macro,s.uDim.value=this.arcOverride?.dim??a.dim,s.uWallGlow.value=i.wallGlow,s.uHoneyFill.value=i.honeyFill,s.uRoomLight.value=i.roomLight,s.uShimmer.value=i.shimmer,s.uPalMix.value=i.palMix,s.uHueVar.value=i.hueVar;const h=i.zoom;s.uZoom.value=h;const n=s.uScroll.value,d=1+t.mid*.3;n.x+=i.driftX*e*d,n.y+=i.driftY*e*d;const m=this.cover;if(this.held){if(e>1e-5){const u=Math.min(1,e*xe),r=Math.min(w,Math.max(-w,this.dragDx/e)),H=Math.min(w,Math.max(-w,this.dragDy/e));this.velX+=(r-this.velX)*u,this.velY+=(H-this.velY)*u}this.dragDx=0,this.dragDy=0}else if(this.velX!==0||this.velY!==0){n.x+=this.velX*m.x/h*e,n.y+=this.velY*m.y/h*e;const u=Math.exp(-2.5*e);this.velX*=u,this.velY*=u,Math.abs(this.velX)<E&&(this.velX=0),Math.abs(this.velY)<E&&(this.velY=0)}const x=Math.hypot(n.x,n.y);x>y&&(n.x*=y/x,n.y*=y/x,this.velX=0,this.velY=0),this.bees.update(e,t,o,a,h,m,this.flash)}pointer(e){const t=this.material.uniforms,o=this.cover,a=t.uZoom.value,i=t.uScroll.value;if(e.type==="down"){this.held=!0,this.dragDx=0,this.dragDy=0,this.velX=0,this.velY=0;const l=(e.x-.5)*o.x/a+i.x,s=(e.y-.5)*o.y/a+i.y;this.activateKnockBoost(l,s),this.activateKnockGlow(l,s);return}if(e.type==="move"){if(!this.held)return;i.x+=e.dx*o.x/a,i.y+=e.dy*o.y/a,this.dragDx+=e.dx,this.dragDy+=e.dy;return}if(e.type==="up"){this.held=!1;return}this.held=!1,this.velX=0,this.velY=0,this.dragDx=0,this.dragDy=0}render(){this.renderer.setRenderTarget(null),this.renderer.render(this.scene,this.camera)}resize(e,t){if(!this.material||e<=0||t<=0)return;const o=e/t;o>=1?this.cover.set(o,1):this.cover.set(1,1/o),this.material.uniforms.uCover.value.copy(this.cover)}dispose(){this.material.dispose(),this.quad.geometry.dispose(),this.bees.dispose(),this.renderer.setRenderTarget(null)}}const pe={default:()=>new ge},ye=pe.default;export{ye as default};
//# sourceMappingURL=index-DtCX4Nbu.js.map
