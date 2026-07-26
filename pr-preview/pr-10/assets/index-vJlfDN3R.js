import{a as I,R as O,L,b as se,H as oe,V as x,c as k,S as J,O as ee,d as te,e as C,M as ae}from"./three-vlqji54k.js";import{m as le}from"./random-DL1jLgMw.js";const re=512,ne=256,_=2,ce=1,H=6,he=4,M=4,ue=240,fe=60,T=1/30,N=256,me=.05,F=`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`,de=`
precision highp float;
void main() { gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0); }
`,ie=`
float ttHash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec2 ttHash22(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453);
}
// Per-community machine-order amount: how far THIS community has drifted
// from its organic placement toward the aligned museum-drawer grid, given
// the global order knob (hash-staggered so communities align at different
// moments, never all at once).
float commOrderAmt(vec2 cc, float order) {
  return clamp(order * (0.75 + 0.5 * ttHash21(cc + vec2(5.5, 2.2))), 0.0, 1.0);
}
// Feature point (nucleus) inside integer community cell cc. Organic scatter
// confined to [0.22, 0.78] of the cell, sliding toward the cell CENTRE
// (aligned drawer rows) as the machine order rises — the flattening enacted
// spatially.
vec2 commAnchor(vec2 cc, float order) {
  vec2 organic = vec2(0.22) + 0.56 * ttHash22(cc);
  return mix(organic, vec2(0.5), commOrderAmt(cc, order));
}
// Stable 0..1 classification order for a community — the ratchet's global
// "how early does this community get classified" schedule.
float commOrder(vec2 cc) { return ttHash21(cc + vec2(7.31, 3.77)); }
// Nearest community to p (p already in community space = fieldUv * uCommFreq):
// 3x3 search over integer cells around p, returns the WINNING cell's integer
// coordinate (not the fractional nucleus position).
vec2 commCell(vec2 p, float order) {
  vec2 n = floor(p);
  vec2 f = fract(p);
  vec2 best = n;
  float bestD = 1.0e6;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 cc = n + g;
      vec2 anchor = commAnchor(cc, order);
      vec2 r = g + anchor - f;
      float d = dot(r, r);
      if (d < bestD) { bestD = d; best = cc; }
    }
  }
  return best;
}
`;function pe(n){return`
precision highp float;
varying vec2 vUv;
uniform sampler2D uPrev;
uniform vec2 uTexel;
uniform float uDt;
uniform float uDiff;              // vitality bleed, pre-scaled to SIM_GRID (see uDiff doc above)
uniform float uVitalityTarget;    // act's baseline vitality regrow target
uniform float uVitalityMod;       // smoothed-bass multiplier from index.ts (1 = no change)
uniform float uClassifyPressure;  // global classification creep per second (act 5 only)
uniform vec4 uStamps[${n}]; // xy field-uv, z radius, w drain strength (0 = inactive)
uniform vec4 uPokes[${M}];  // xy field-uv, z radius, w strength (0 = inactive)
uniform vec4 uWave;                   // xy centre, z ring radius, w strength (0 = off)

float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
  vec4 prev = texture2D(uPrev, vUv);
  float v = prev.r;
  float c = prev.g;
  float glow = prev.b;
  float ink = prev.a;
  vec2 tx = uTexel;

  // 4-neighbour laplacian of vitality (real texel spacing — see the uDiff
  // resolution-independence note above).
  float lap =
      texture2D(uPrev, vUv + vec2(tx.x, 0.0)).r
    + texture2D(uPrev, vUv - vec2(tx.x, 0.0)).r
    + texture2D(uPrev, vUv + vec2(0.0, tx.y)).r
    + texture2D(uPrev, vUv - vec2(0.0, tx.y)).r
    - 4.0 * v;

  // Scan stamps: gaussian drain well per active stamp, plus a sparse
  // label-row mask in a band beneath the stamp centre (reads as catalogue
  // text rows, not a solid block) that drives the archive-ink write below.
  float stampDrain = 0.0;
  float stampActive = 0.0;
  for (int i = 0; i < ${n}; i++) {
    vec4 s = uStamps[i];
    if (s.w > 0.0) {
      vec2 d = vUv - s.xy;
      d -= floor(d + vec2(0.5));
      float g = exp(-dot(d, d) / (s.z * s.z));
      stampDrain += g * s.w;

      vec2 db = d - vec2(0.0, 0.35 * s.z);
      float halfW = 0.7 * s.z;
      float halfH = 0.06 * s.z;
      if (abs(db.x) < halfW && abs(db.y) < halfH) {
        float rowT = (db.y + halfH) / max(1.0e-4, 2.0 * halfH) * 5.0;
        float rowId = floor(rowT);
        float rowOn = step(0.5, hash21(s.xy * 41.0 + rowId * 3.1 + float(i) * 11.0));
        float colId = floor((db.x + halfW) / max(1.0e-4, halfW * 0.18));
        float colOn = step(0.55, hash21(s.xy * 17.0 + vec2(colId, rowId) * 1.7 + float(i) * 5.3));
        stampActive += rowOn * colOn;
      }
    }
  }

  // Pokes: gaussian re-ignition bump, weighted by strength.
  float pokeG = 0.0;
  for (int i = 0; i < ${M}; i++) {
    vec4 p = uPokes[i];
    if (p.w > 0.0) {
      vec2 d = vUv - p.xy;
      d -= floor(d + vec2(0.5));
      pokeG += exp(-dot(d, d) / (p.z * p.z)) * p.w;
    }
  }

  // Mass-classification ring wave: gaussian band around the wrapped
  // distance to the ring, |dist - radius| within a fixed band width.
  float waveG = 0.0;
  if (uWave.w > 0.0) {
    vec2 d = vUv - uWave.xy;
    d -= floor(d + vec2(0.5));
    float band = abs(length(d) - uWave.z);
    waveG = exp(-(band * band) / (0.04 * 0.04)) * uWave.w;
  }

  // Vitality: regrow toward the act's target, laplacian bleed, drain from
  // active stamps + classified suppression, poke re-ignition.
  v += (uVitalityTarget * uVitalityMod - v) * (1.0 - exp(-0.4 * uDt));
  v += lap * uDiff * uDt;
  v -= v * (stampDrain * 1.2 + c * 0.35) * uDt;
  v = max(v, pokeG * 0.9);
  v = clamp(v, 0.0, 1.0);

  // Classified ratchet: multiplicative relaxation toward 1 (never a bare
  // additive tiny*dt — half-float precision dies near 1.0). Pokes are the
  // ONLY thing that reduces it (the resistance mechanic).
  float cRate = stampDrain * 2.5 + uClassifyPressure + waveG * 3.0;
  c += (1.0 - c) * (1.0 - exp(-cRate * uDt));
  c *= 1.0 - min(1.0, pokeG * 0.8);
  c = clamp(c, 0.0, 1.0);

  // Poke glow: fast exponential decay, gaussian re-ignition.
  glow = max(glow * exp(-2.2 * uDt), pokeG);
  glow = clamp(glow, 0.0, 1.0);

  // Archive ink: write-toward-1 relaxation inside an active stamp's label
  // row band. NO decay term, ever — the catalogue only accumulates.
  ink += (1.0 - ink) * (1.0 - exp(-2.0 * uDt * stampActive));
  ink = clamp(ink, 0.0, 1.0);

  gl_FragColor = vec4(v, c, glow, ink);
}
`}function ve(n){return`
precision highp float;
varying vec2 vUv;
uniform float uSeedFloor;
uniform float uSeedVitality;
uniform float uCommFreq;
uniform float uSeedOrder;
const float FIELD_SIZE = ${n.toFixed(1)};

${ie}

void main() {
  vec2 cc = commCell(vUv * uCommFreq, uSeedOrder);
  float ord = commOrder(cc);
  // Communities with commOrder(cc) < uSeedFloor are already classified.
  float c0 = 1.0 - smoothstep(uSeedFloor - 0.05, uSeedFloor + 0.05, ord);
  float v = mix(uSeedVitality, 0.12, c0);

  // Sparse horizontal-row ink mask: rows every ~8 texels, hash-jittered per
  // community so classified patches carry faint accumulated label rows
  // rather than an aligned grid.
  vec2 texel = floor(vUv * FIELD_SIZE);
  float rowSpan = 8.0;
  float jitter = floor(ttHash21(cc + vec2(3.1, 9.7)) * rowSpan);
  float rowLine = mod(texel.y + jitter, rowSpan);
  float isRow = 1.0 - step(0.5, rowLine);
  float colBucket = floor(texel.x / 3.0);
  float colHash = ttHash21(cc * 3.7 + vec2(colBucket, jitter) * 1.3);
  float colOn = step(0.6, colHash);
  float ink = c0 * isRow * colOn;

  gl_FragColor = vec4(v, c0, 0.0, ink);
}
`}class ge{uniforms;stamps;pokes;wave;renderer;texSize;targets;readIndex=0;scene;camera;quad;simMaterial;initMaterial;seedMaterial;params=null;vitalityMod=1;constructor(e,i,t){this.renderer=e,this.texSize=i?re:ne;const a={type:oe,format:se,minFilter:L,magFilter:L,wrapS:O,wrapT:O,depthBuffer:!1,stencilBuffer:!1};this.targets=[new I(this.texSize,this.texSize,a),new I(this.texSize,this.texSize,a)],this.stamps=[];for(let r=0;r<t;r++)this.stamps.push(new x(0,0,.05,0));this.pokes=[];for(let r=0;r<M;r++)this.pokes.push(new x(0,0,.035,0));this.wave=new x(.5,.5,0,0),this.uniforms={uPrev:{value:null},uTexel:{value:new k(1/this.texSize,1/this.texSize)},uDt:{value:0},uDiff:{value:me*(this.texSize/N)*(this.texSize/N)},uVitalityTarget:{value:0},uVitalityMod:{value:1},uClassifyPressure:{value:0},uStamps:{value:this.stamps},uPokes:{value:this.pokes},uWave:{value:this.wave}},this.scene=new J,this.camera=new ee(-1,1,1,-1,0,1);const s=new te(2,2);this.simMaterial=new C({vertexShader:F,fragmentShader:pe(t),uniforms:this.uniforms,depthTest:!1,depthWrite:!1}),this.initMaterial=new C({vertexShader:F,fragmentShader:de,depthTest:!1,depthWrite:!1});const o={uSeedFloor:{value:0},uSeedVitality:{value:.8},uCommFreq:{value:6},uSeedOrder:{value:0}};this.seedMaterial=new C({vertexShader:F,fragmentShader:ve(this.texSize),uniforms:o,depthTest:!1,depthWrite:!1}),this.quad=new ae(s,this.initMaterial),this.scene.add(this.quad),this.clearField(),this.quad.material=this.simMaterial}setActParams(e){this.params=e}setVitalityMod(e){this.vitalityMod=e}applyParams(e){this.uniforms.uVitalityTarget.value=e.vitalityTarget,this.uniforms.uVitalityMod.value=this.vitalityMod,this.uniforms.uClassifyPressure.value=e.classifyPressure}step(e,i){const t=this.params;if(!t||i<=0)return;this.applyParams(t),this.uniforms.uDt.value=e/i;const a=this.renderer.getRenderTarget();for(let s=0;s<i;s++){const o=this.targets[this.readIndex],r=this.targets[1-this.readIndex];this.uniforms.uPrev.value=o.texture,this.renderer.setRenderTarget(r),this.renderer.render(this.scene,this.camera),this.readIndex=1-this.readIndex}this.renderer.setRenderTarget(a??null)}seedField(e,i,t){const a=this.seedMaterial.uniforms;a.uSeedFloor.value=e,a.uSeedVitality.value=this.params?.vitalityTarget??.8,a.uCommFreq.value=i,a.uSeedOrder.value=t;const s=this.renderer.getRenderTarget(),o=this.quad.material;this.quad.material=this.seedMaterial;for(const r of this.targets)this.renderer.setRenderTarget(r),this.renderer.render(this.scene,this.camera);this.renderer.setRenderTarget(s??null),this.quad.material=o}clearField(){const e=this.renderer.getRenderTarget(),i=this.quad.material;this.quad.material=this.initMaterial;for(const t of this.targets)this.renderer.setRenderTarget(t),this.renderer.render(this.scene,this.camera);this.renderer.setRenderTarget(e??null),this.quad.material=i}get texture(){return this.targets[this.readIndex].texture}dispose(){this.targets[0].dispose(),this.targets[1].dispose(),this.simMaterial.dispose(),this.initMaterial.dispose(),this.seedMaterial.dispose(),this.quad.geometry.dispose()}}const we=`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;function Se(n,e,i,t){const a=Math.max(1,Math.floor(i)),s=2*a+1,o=Math.max(1,Math.floor(t));return`
precision highp float;
varying vec2 vUv;

uniform sampler2D uField;
uniform float uTime;
uniform vec2 uCover;
uniform float uZoom;
uniform vec2 uPan;
uniform float uCommFreq;
uniform float uEnergy;
uniform float uFlash;
uniform float uSparkle;
uniform float uGlyphKick;
uniform float uGlyphSeed;
uniform float uChurn;
uniform float uChatter;
uniform float uGlyphDensity;
uniform float uMachineFrac;
uniform float uMachineOrder;
uniform float uClassified;
uniform float uGridStrength;
uniform float uGridFine;
uniform float uGridSlam;
uniform float uHueSat;
uniform float uWarmth;
uniform float uRustMix;
uniform float uInkPersist;
uniform float uVignette;
uniform float uMotes;
uniform float uGroundLight;
uniform float uSurvivorFocus;
uniform float uDesat;
uniform int uSoloMode;
uniform float uFlicker;
uniform float uLifeClock; // CPU-accumulated lifecycle clock (epochs, beat-accelerated) — drives specLife's appear/disappear cycle
uniform float uPresence; // 0..1 fraction of specimens present per lifecycle epoch
uniform float uWriggle; // 0..1 living-outline wriggle amplitude
uniform float uDrift; // 0..1 anchor micro-wander amount
uniform vec4 uWaveVis; // xy field-uv centre, z ring radius, w strength (0 = inactive) — the classification wave, shared with the sim's uWave
uniform vec4 uScanA[${e}]; // xy field-uv centre, z age (s), w strength (0 = inactive)
uniform vec4 uScanB[${e}]; // x radius, y mislabel flag, z label seed, w unused
uniform vec4 uRipple[${n}]; // xy field-uv, z age (s), w strength (0 = inactive)

const vec3 RUST = vec3(0.769, 0.302, 0.227);
const vec3 MACHINE_TONE = vec3(0.62, 0.50, 0.44);

${ie}

float ttVnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(ttHash21(i), ttHash21(i + vec2(1.0, 0.0)), u.x),
             mix(ttHash21(i + vec2(0.0, 1.0)), ttHash21(i + vec2(1.0, 1.0)), u.x), u.y);
}
float ttFbm3(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 3; i++) { s += a * ttVnoise(p); p *= 2.0; a *= 0.5; }
  return s;
}

mat2 ttRot(float a) {
  float c = cos(a);
  float s = sin(a);
  return mat2(c, s, -s, c);
}

vec2 ttLatPos(vec2 idx) { return vec2(0.2) + idx * 0.3; }

// Bowed line-segment SDF: bow adds a slight sin-shaped perpendicular
// offset along the segment (the glyph script's curvature flag).
float ttSegDist(vec2 p, vec2 a, vec2 b, float bow) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float bl2 = dot(ba, ba);
  float h = bl2 > 0.0000001 ? clamp(dot(pa, ba) / bl2, 0.0, 1.0) : 0.0;
  vec2 closest = a + ba * h;
  vec2 perp = normalize(vec2(-ba.y, ba.x) + 0.000001);
  closest += perp * bow * sin(h * 3.14159265);
  return length(p - closest);
}

// Beat-coupled appear/disappear lifecycle for community cc: returns the
// current epoch's presence/scale envelope (0 = absent, ~1 = fully present,
// briefly >1 on pop-in) and writes the epoch number (out param) so callers
// can re-roll the anchor per-epoch (a respawned specimen appears in a NEW
// spot). HERO OVERRIDE: cc==(0,0) (the opening image / loop-closure
// identity) is pinned present at epoch 0 forever — it never blinks.
float specLife(vec2 cc, out float epoch) {
  if (cc == vec2(0.0)) { epoch = 0.0; return 1.0; }
  float cycle = uLifeClock + ttHash21(cc + vec2(17.9, 4.4));
  float e = floor(cycle);
  float k = fract(cycle);
  float presentE = step(ttHash21(cc + vec2(e * 7.7, 2.9)), uPresence);
  float presentE1 = step(ttHash21(cc + vec2((e + 1.0) * 7.7, 2.9)), uPresence);
  // Crossfade during the last 0.15 of the cycle so a respawn never pops
  // instantaneously, plus a pop-in overshoot on the incoming epoch.
  float x = smoothstep(0.85, 1.0, k);
  float s = mix(presentE, presentE1, x);
  s *= 1.0 + 0.15 * sin(3.14159 * smoothstep(0.0, 0.25, k)) * presentE;
  epoch = e;
  return s;
}

// Display-side anchor for community cc in its given lifecycle epoch — the
// display must never call commAnchor directly (that's the sim's stable,
// non-respawning placement). Organic base is RE-ROLLED PER EPOCH (a
// respawned specimen lands in a new spot in its cell), drifts with a slow
// micro-wander that fades out as machine order rises, then the order-mix
// happens LAST so rows stay rows regardless of epoch/drift.
vec2 specAnchor(vec2 cc, float epoch) {
  float o = commOrderAmt(cc, uMachineOrder);
  vec2 organic = vec2(0.22) + 0.56 * ttHash22(cc + vec2(epoch * 3.3, epoch * 1.7));
  float h = ttHash21(cc + vec2(2.6, 8.1));
  organic += 0.035 * vec2(sin(uTime * 0.13 + h * 6.2831853), cos(uTime * 0.11 + h * 4.1)) * uDrift * (1.0 - o);
  organic = clamp(organic, vec2(0.06), vec2(0.94));
  return mix(organic, vec2(0.5), o);
}

// Signed distance to community cc's SPECIMEN silhouette at community-space
// point p: an organic, elongated, wobble-outlined blob around the cell's
// anchor. This deliberately replaces any Voronoi-cell rendering — b2's
// world is discrete organisms laid out on catalogue paper, never a tiling
// lattice (that geometry belongs to a3). As the machine order rises the
// blob's rotation aligns to the page axes, its proportions normalize, and
// its outline simplifies — a living form becoming a filed entry. Absent
// specimens (mid-cycle, not this epoch's roll) return a large constant so
// they drop out of the nearest-specimen search entirely.
float specimenSd(vec2 p, vec2 cc, float order) {
  float epoch;
  float scaleEnv = specLife(cc, epoch);
  if (scaleEnv < 0.01) return 9.0;
  vec2 anchor = specAnchor(cc, epoch);
  vec2 local = p - (cc + anchor);
  float o = commOrderAmt(cc, order);
  float h1 = ttHash21(cc + vec2(21.0, 8.8));
  float h2 = ttHash21(cc + vec2(33.0, 1.2));
  float h3 = ttHash21(cc + vec2(41.0, 6.6));
  float ang = mix(h3 * 6.2831853, 0.0, o);
  float elong = mix(0.62, 1.55, h2);
  elong = mix(elong, clamp(elong, 0.85, 1.2), o);
  vec2 sl = ttRot(-ang) * local;
  sl.x /= elong;
  float th = atan(sl.y, sl.x);
  // Time-animated wriggle: phase motion per wobble harmonic, amplitude
  // scaled by the act's wriggle knob (ordered specimens still calm).
  float wobAmp = mix(1.0, 0.3, o) * mix(0.35, 1.0, uWriggle);
  float wob = (0.07 * sin(3.0 * th + h1 * 6.2831853 + uTime * 1.3)
             + 0.045 * sin(5.0 * th + h2 * 6.2831853 - uTime * 1.7)
             + 0.028 * sin(7.0 * th + h3 * 6.2831853 + uTime * 2.3)) * wobAmp;
  float R0 = (0.21 + 0.13 * h1) * mix(1.0, 0.9, o) * scaleEnv;
  float sd = length(sl) - R0 * (1.0 + wob);

  // Wave pulse: specimens swell as the classification wave ring crosses
  // them. uWaveVis.xy/z are FIELD-UV; the specimen anchor's field-uv is
  // (cc + anchor) / uCommFreq + 0.5 (the house screen->field mapping run
  // in reverse for a single community-space point).
  vec2 wd = (cc + anchor) / uCommFreq + 0.5 - uWaveVis.xy;
  wd -= floor(wd + 0.5);
  float wp = exp(-pow((length(wd) - uWaveVis.z) * 18.0, 2.0)) * uWaveVis.w;
  sd -= R0 * 0.06 * wp;

  return sd;
}

// Nearest-specimen search over the ${s}x${s} window: the fragment belongs
// to whichever specimen silhouette it is deepest inside (or nearest to).
// No perpendicular-bisector clipping — blobs are drawn whole, and where
// two organic neighbours reach each other they layer like leaves instead
// of cutting a straight Voronoi chord. The winner's epoch/anchor are
// resolved once more after the loop (specLife is cheap, and this keeps the
// per-candidate inner loop free of an unused out-param write).
void specimenSearch(vec2 p, float order, out vec2 cellCoord, out vec2 cellPoint, out float sd) {
  vec2 n = floor(p);
  cellCoord = n;
  cellPoint = n + vec2(0.5);
  sd = 9.0;
  for (int j = -${a}; j <= ${a}; j++) {
    for (int i = -${a}; i <= ${a}; i++) {
      vec2 cc = n + vec2(float(i), float(j));
      float d = specimenSd(p, cc, order);
      if (d < sd) { sd = d; cellCoord = cc; }
    }
  }
  float winEpoch;
  specLife(cellCoord, winEpoch);
  cellPoint = cellCoord + specAnchor(cellCoord, winEpoch);
}

void main() {
  // Screen uv -> field uv (house formula, shared with pointer.ts's inverse).
  vec2 field = (vUv - 0.5) * uCover / uZoom + 0.5 + uPan;
  // Centre-anchored Voronoi scaling: the community lattice recedes from the
  // VIEW CENTRE when uCommFreq or uZoom animate.
  vec2 p = (field - 0.5) * uCommFreq;

  vec2 cc, cellPoint;
  float sd;
  specimenSearch(p, uMachineOrder, cc, cellPoint, sd);
  float ordAmt = commOrderAmt(cc, uMachineOrder);
  // Winner's own lifecycle scale — gates the pin+tag ink below (an absent
  // specimen mid-cycle must not carry a label).
  float winEpoch;
  float winScale = specLife(cc, winEpoch);

  // Whole-patch read (anchor's field-uv - the "flattening" read, every
  // fragment in a community shares one vitality/classified value) and the
  // fragment's own read (continuous, for local poke glow + archive ink).
  vec2 cellUv = cellPoint / uCommFreq + 0.5;
  vec4 cellState = texture2D(uField, fract(cellUv));
  vec4 fragState = texture2D(uField, fract(field));
  float cellVitality = cellState.r;
  float cellClassified = cellState.g;

  vec3 GROUND = mix(vec3(0.086, 0.070, 0.055), vec3(0.910, 0.878, 0.812), uGroundLight);

  // --- community hue ---
  float h = ttHash21(cc + vec2(3.7, 1.3));
  vec3 commCol = 0.55 + 0.38 * cos(6.2831853 * (h + vec3(0.0, 0.33, 0.67)));
  commCol = mix(commCol, commCol * vec3(1.05, 0.92, 0.78), uWarmth);
  float lumaC = dot(commCol, vec3(0.299, 0.587, 0.114));
  // Gentle floor on the vitality term: living-but-not-maximal communities
  // (mid acts) keep most of their hue, so the mid-track doesn't read as
  // already dying — the real desaturation is the classified/grade path.
  float satPull = 1.0 - uHueSat * mix(0.6, 1.0, cellVitality);
  commCol = mix(commCol, vec3(lumaC), clamp(satPull, 0.0, 1.0));

  // Machine flattening: the per-cell classified ratchet OR the global
  // classification pressure pulls every community toward the drained tone.
  // vividCol keeps the pre-flattening hue alive for the outro's final
  // flicker — the loop-closure motif must speak in a LIVING community
  // color even after the whole field has been drained.
  vec3 vividCol = commCol;
  float classFlat = max(cellClassified, uClassified * 0.7);
  commCol = mix(commCol, MACHINE_TONE, classFlat * 0.85);

  // --- interior pattern (Turing-ish, stateless) ---
  float patH1 = ttHash21(cc + 11.3);
  float patH2 = ttHash21(cc + 27.9);
  float patH3 = ttHash21(cc + 51.7);
  float patFreq = 6.0 + 10.0 * patH1;
  float patStretch = 0.4 + 1.8 * patH2;
  float patRotA = patH3 * 6.2831853;
  vec2 local = p - cellPoint;
  vec2 rl = ttRot(patRotA) * local;
  rl *= vec2(patFreq, patFreq * patStretch);
  vec2 advect = vec2(cos(patH1 * 6.2831853), sin(patH1 * 6.2831853)) * uTime * 0.03 * uChurn;
  float nI = ttFbm3(rl + advect);
  float band = smoothstep(0.46, 0.54, nI);
  float patternContrast = band * cellVitality * (1.0 - classFlat);

  // --- specimen-on-paper compositing: organic ink-rimmed silhouette with
  // a soft cast shadow, bone paper everywhere between specimens ---
  float saa = fwidth(sd) * 1.2 + 0.001;
  float specimenMask = smoothstep(saa, -saa, sd);
  float rim = 1.0 - smoothstep(0.0, saa * 3.0, abs(sd));
  // Shadow: the winner's own silhouette shifted down-right, drawn only on
  // the paper (an object resting on the page, not a glow).
  float sdSh = specimenSd(p - vec2(0.05, -0.06), cc, uMachineOrder);
  float shadow = (1.0 - smoothstep(-0.02, 0.1, sdSh)) * (1.0 - specimenMask) * 0.2;

  vec3 paper = mix(GROUND, GROUND * vec3(0.8, 0.76, 0.72), shadow);
  vec3 skinCol = commCol * mix(0.8, 1.22, patternContrast);
  // Field-guide outline ink: dark, leaning toward the community's own hue.
  vec3 inkLine = mix(vec3(0.16, 0.1, 0.08), commCol * 0.35, 0.4);
  vec3 patchworkCol = mix(paper, skinCol, specimenMask);
  patchworkCol = mix(patchworkCol, inkLine, rim * mix(0.85, 0.55, classFlat));
  patchworkCol += commCol * fragState.b * 0.6; // local poke re-ignition glow

  vec3 col = patchworkCol;
  vec3 machineCol = GROUND;

  // Archive ink: faint rust label-rows on the PAPER where scans have
  // happened (persistent, independent of current vitality).
  float inkRow = step(0.5, fract(field.y * 40.0)) * step(fract(field.x * 3.0), 0.6);
  float inkAlpha = fragState.a * uInkPersist * inkRow * (1.0 - specimenMask * 0.85);
  col = mix(col, RUST * 0.32, inkAlpha * 0.7);
  machineCol = mix(machineCol, RUST * 0.32, inkAlpha * 0.7);

  // --- glyph script: each community's language from stable hashed bits ---
  float lbFamily = ttHash21(cc + vec2(9.1, 0.0));
  float lbCurveH = ttHash21(cc + vec2(9.1, 4.0));
  float lbColsH = ttHash21(cc + vec2(9.1, 8.0));
  float lbBaseH = ttHash21(cc + vec2(9.1, 12.0));
  bool lbOrtho = lbFamily < 0.5;
  bool lbCurve = lbCurveH > 0.5;
  float cols = 2.0 + step(0.5, lbColsH);
  float baseIdx = floor(lbBaseH * 4.0);
  float langAngle = baseIdx < 0.5 ? 0.0 : (baseIdx < 1.5 ? 0.26 : (baseIdx < 2.5 ? -0.26 : 0.52));
  // The script's baseline straightens to the page axes as this community is
  // pulled into machine order — even the writing loses its slant.
  langAngle = mix(langAngle, 0.0, ordAmt);

  vec2 gg = (ttRot(langAngle) * local) * 10.0;
  vec2 gid = floor(gg);
  vec2 q = fract(gg);
  vec2 fwg = fwidth(gg);
  float w = max(fwg.x, fwg.y) * 1.4 + 0.001;

  // Column gating: glyph cells outside the community's 2-3 writing columns
  // stay empty, so the script reads as columns of writing.
  const float COL_PITCH = 2.4;
  float colSpan = (cols - 1.0) * COL_PITCH;
  float colIdxF = (gid.x + colSpan * 0.5) / COL_PITCH;
  float colIdxFloor = floor(colIdxF);
  float colFrac = fract(colIdxF);
  float colGate = step(colFrac, 0.62) * step(0.0, colIdxFloor) * step(colIdxFloor, cols - 0.5);

  // Script lives INSIDE the specimen, clear of the outline rim.
  float marginMask = smoothstep(0.015, 0.05, -sd);

  // Per-glyph staggered re-roll (the "chatter") - ttHash21(gid) offsets each
  // cell's re-roll phase so consecutive re-rolls never land on every glyph
  // at once (no global strobe).
  float ch = ttHash21(gid + cc * 17.0 + floor(uTime * uChatter + ttHash21(gid)) * 0.37);

  float dmin = 999.0;
  for (int s = 0; s < ${o}; s++) {
    float fs = float(s);
    vec2 hAB = ttHash22(gid + vec2(fs * 3.7 + 1.0, ch * 5.0 + 2.0));
    vec2 hCD = ttHash22(gid + vec2(fs * 3.7 + 5.0, ch * 5.0 + 9.0));
    vec2 ia = floor(clamp(hAB, 0.0, 0.999) * 3.0);
    vec2 delta;
    if (lbOrtho) {
      float horiz = step(0.5, hCD.x);
      float mag = 1.0 + floor(hCD.y * 2.0);
      float sgn = ttHash21(gid + vec2(fs, 13.0) + ch) < 0.5 ? -1.0 : 1.0;
      delta = mix(vec2(0.0, mag), vec2(mag, 0.0), horiz) * sgn;
    } else {
      float sx = hCD.x < 0.5 ? -1.0 : 1.0;
      float sy = hCD.y < 0.5 ? -1.0 : 1.0;
      delta = vec2(sx, sy);
    }
    vec2 ib = clamp(ia + delta, vec2(0.0), vec2(2.0));
    if (ib == ia) { ib = clamp(ia - delta, vec2(0.0), vec2(2.0)); }
    vec2 pa = ttLatPos(ia);
    vec2 pb = ttLatPos(ib);
    float bow = lbCurve ? (0.08 * sin(ch * 37.0 + fs * 2.1 + cc.x)) : 0.0;
    float sd = ttSegDist(q, pa, pb, bow);
    dmin = min(dmin, sd);
  }

  float coverage = step(ttHash21(gid + cc), uGlyphDensity) * colGate;
  float livingAlpha = smoothstep(w, w * 0.5, dmin) * coverage * marginMask * cellVitality;
  vec3 livingInkColor = commCol * 0.32;
  float kickSel = step(0.7, ttHash21(gid + floor(uGlyphSeed)));
  livingInkColor = mix(livingInkColor, commCol * 1.5, uGlyphKick * kickSel);

  // --- machine code: fixed grammar, single column, raster-order row pulse ---
  vec2 gm = local * 10.0;
  vec2 gmid = floor(gm);
  vec2 gmq = fract(gm);
  float inCol = gmid.x == 0.0 ? 1.0 : 0.0;
  float rowIndex = gmid.y + commOrder(cc) * 23.0;
  // Code flickers faster on high onsets (uGlyphKick).
  float rowPhase = fract(uTime * 0.5 * (1.0 + uGlyphKick * 2.0) - rowIndex * 0.07);
  float pulse = max(0.0, smoothstep(0.0, 0.08, rowPhase) - smoothstep(0.08, 0.22, rowPhase));
  float machCov = step(ttHash21(gmid + cc + 9.0), 0.55);
  float isDot = step(0.6, ttHash21(gmid + cc + 5.0));
  float dTick = ttSegDist(gmq, vec2(0.5, 0.15), vec2(0.5, 0.85), 0.0);
  float dDot = length(gmq - vec2(0.5)) - 0.12;
  float dMach = mix(dTick, dDot, isDot);
  vec2 fwm = fwidth(gm);
  float wMach = max(fwm.x, fwm.y) * 1.4 + 0.001;
  float machAlpha = smoothstep(wMach, wMach * 0.5, dMach) * inCol * machCov * marginMask * (0.4 + 0.6 * pulse);
  // Dark stamped print, pulsing toward bright rust on the raster sweep —
  // rust-on-rust vanished under the act-5 grade; the catalogue's code must
  // keep VALUE contrast against both the bone ground and the rust field.
  vec3 machineInkColor = mix(vec3(0.24, 0.11, 0.08), RUST * 1.25, pulse);

  float glyphMix = smoothstep(0.35, 0.75, max(cellClassified, uMachineFrac));
  float glyphAlpha = mix(livingAlpha, machAlpha, glyphMix);
  vec3 glyphColor = mix(livingInkColor, machineInkColor, glyphMix);

  col = mix(col, glyphColor, glyphAlpha);

  // --- pin + tag: a classified, still-present specimen is pinned and
  // labeled on the page — drawn as ink (mix-darken), not glow, so it holds
  // VALUE contrast on both the bone and rust-graded ground. ---
  float pinGate = smoothstep(0.5, 0.65, cellClassified) * winScale * uInkPersist;
  vec2 pl = p - cellPoint;
  float R0est = 0.27;
  float pinOn = step(abs(pl.x), 0.012) * step(R0est, pl.y) * step(pl.y, R0est + 0.16);
  vec2 tagLocal = pl - vec2(0.05, R0est + 0.2);
  float tagOn = step(abs(tagLocal.x), 0.07) * step(abs(tagLocal.y), 0.045);
  float tickBin = floor((tagLocal.x + 0.07) / 0.14 * 3.0);
  float tickOn = tagOn * step(0.5, ttHash21(vec2(tickBin, cc.x + cc.y * 7.0))) * step(abs(tagLocal.y), 0.02);
  vec3 pinTagCol = mix(RUST * 0.5, vec3(0.16, 0.1, 0.08), tickOn);
  float pinTagAlpha = clamp(pinOn + tagOn, 0.0, 1.0) * pinGate;
  col = mix(col, pinTagCol, pinTagAlpha);

  // --- machine grid (screen space - does NOT pan/zoom with the world) ---
  vec2 gv = (vUv - 0.5) * uCover;
  vec2 gm1 = gv * 14.0;
  vec2 dist1 = min(fract(gm1), 1.0 - fract(gm1));
  vec2 aa1 = fwidth(gm1) * 1.5 + 0.0005;
  vec2 lineMask1 = 1.0 - smoothstep(vec2(0.0), aa1, dist1);
  float mainLine = max(lineMask1.x, lineMask1.y);

  vec2 gm2 = gv * 14.0 * 4.0;
  vec2 dist2 = min(fract(gm2), 1.0 - fract(gm2));
  vec2 aa2 = fwidth(gm2) * 1.5 + 0.0005;
  vec2 lineMask2 = 1.0 - smoothstep(vec2(0.0), aa2, dist2);
  float fineLine = max(lineMask2.x, lineMask2.y) * uGridFine;

  float gridIntensity = uGridStrength + uGridSlam;
  float gridMask = clamp(mainLine + fineLine * 0.6, 0.0, 1.0) * gridIntensity;
  // Print-sweep: the machine printing rows top-to-bottom, brightening on beats.
  float sweepPos = fract(uTime * 0.4);
  float sweepD = abs(vUv.y - (1.0 - sweepPos));
  float sweep = exp(-sweepD * sweepD * 900.0) * uGridStrength * (0.3 + uFlash * 0.7);
  gridMask = clamp(gridMask + sweep * 0.5, 0.0, 1.0);
  col = mix(col, col * RUST * 0.5, gridMask * 0.7);
  col += RUST * gridMask * 0.15;
  machineCol = mix(machineCol, machineCol * RUST * 0.5, gridMask * 0.7);
  machineCol += RUST * gridMask * 0.15;

  // --- classification reticles ---
  for (int i = 0; i < ${e}; i++) {
    vec4 sa = uScanA[i];
    if (sa.w <= 0.0) continue;
    vec4 sb = uScanB[i];
    vec2 rd = field - sa.xy;
    rd -= floor(rd + 0.5); // torus wrap
    vec2 dc = rd * uCommFreq; // field-space -> community-unit space
    float age = sa.z;
    float strength = sa.w;
    float radius = max(sb.x, 0.05);
    float mis = sb.y;
    float labelSeed = sb.z;

    float ap = clamp(age / 0.5, 0.0, 1.0);
    float curR = mix(radius * 1.6, radius, ap);
    float fadeOut = 1.0 - smoothstep(1.4, 2.2, age);
    float bracketEnv = age < 1.4 ? smoothstep(0.0, 0.08, age) : fadeOut;

    float bracketDist = 999.0;
    for (int k = 0; k < 4; k++) {
      vec2 sgn;
      if (k == 0) sgn = vec2(-1.0, -1.0);
      else if (k == 1) sgn = vec2(1.0, -1.0);
      else if (k == 2) sgn = vec2(1.0, 1.0);
      else sgn = vec2(-1.0, 1.0);
      vec2 corner = sgn * curR;
      float armLen = curR * 0.4;
      vec2 armA1 = corner - vec2(sgn.x * armLen, 0.0);
      vec2 armB1 = corner - vec2(0.0, sgn.y * armLen);
      float db = min(ttSegDist(dc, corner, armA1, 0.0), ttSegDist(dc, corner, armB1, 0.0));
      bracketDist = min(bracketDist, db);
    }
    vec2 aaB2 = fwidth(dc) * 1.5 + 0.002;
    float aaB = max(aaB2.x, aaB2.y);
    float bracketAlpha = (1.0 - smoothstep(0.0, aaB * 3.0, bracketDist)) * bracketEnv * strength;

    float lockT = clamp((age - 0.5) / 0.9, 0.0, 1.0);
    float sweepY = mix(curR, -curR, lockT);
    float lineDistY = abs(dc.y - sweepY);
    float inBoxX = step(abs(dc.x), curR);
    float sweepAA = max(fwidth(dc.y), 0.002) * 4.0;
    float sweepGate = step(0.5, age) * (1.0 - step(1.4, age));
    float sweepAlpha = (1.0 - smoothstep(0.0, sweepAA, lineDistY)) * inBoxX * sweepGate * (0.5 + 0.5 * uSparkle) * strength;

    col = mix(col, RUST * 0.55, clamp(bracketAlpha + sweepAlpha, 0.0, 1.0));
    col += RUST * 0.12 * sweepAlpha;
    machineCol = mix(machineCol, RUST * 0.55, clamp(bracketAlpha + sweepAlpha, 0.0, 1.0));
    machineCol += RUST * 0.12 * sweepAlpha;

    vec2 labelLocal = dc - vec2(0.0, -curR - radius * 0.6);
    float jitter = mis > 0.5 ? (ttHash21(vec2(floor(uTime * 24.0), labelSeed)) - 0.5) * 0.15 * radius : 0.0;
    labelLocal.x += jitter;
    float labelHalfW = radius * 0.9;
    float inLabelBox = step(abs(labelLocal.x), labelHalfW) * step(abs(labelLocal.y), radius * 0.14);
    float lx = clamp(labelLocal.x / labelHalfW * 0.5 + 0.5, 0.0, 1.0);
    float tickCellF = floor(lx * 10.0);
    float tickOn = step(0.5, ttHash21(vec2(tickCellF, labelSeed * 13.0)));
    float tickLocal = fract(lx * 10.0);
    float tickShape = step(0.15, tickLocal) * step(tickLocal, 0.75);
    float labelInk = inLabelBox * tickOn * tickShape;
    float invFlash = mis > 0.5 ? step(0.97, ttHash21(vec2(floor(uTime * 24.0) + labelSeed * 7.0, 3.0))) : 0.0;
    labelInk = mix(labelInk, inLabelBox * (1.0 - tickOn) * tickShape, invFlash);
    float labelEnv = smoothstep(1.4, 1.8, age) * strength;

    vec3 wrongHue = 0.55 + 0.38 * cos(6.2831853 * (labelSeed * 7.0 + vec3(0.0, 0.33, 0.67)));
    vec3 labelColor = mis > 0.5 ? wrongHue : RUST;

    float labelFinal = labelInk * labelEnv;
    col = mix(col, labelColor * 0.8, labelFinal);
    col += labelColor * labelFinal * 0.3;
    machineCol = mix(machineCol, labelColor * 0.8, labelFinal);
    machineCol += labelColor * labelFinal * 0.3;
  }

  // --- grade ---
  float luma = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(col, vec3(luma), uDesat);
  col = mix(col, RUST * (0.35 + 0.65 * luma), uRustMix * (0.4 + 0.6 * uClassified));
  float survM = smoothstep(0.18, 0.55, length((vUv - 0.5) * uCover));
  col = mix(col, mix(col, vec3(luma) * 0.92, 0.85), survM * uSurvivorFocus);

  // --- tap ripples: near-white expanding rings, torus-wrapped (a3's idiom) ---
  for (int i = 0; i < ${n}; i++) {
    vec4 rp = uRipple[i];
    if (rp.w <= 0.0) continue;
    vec2 rrd = field - rp.xy;
    rrd -= floor(rrd + 0.5);
    float rdist = length(rrd);
    float rr = 0.02 + rp.z * 0.30;
    float ring = exp(-pow((rdist - rr) * 70.0, 2.0)) * rp.w * exp(-rp.z * 2.8);
    col += vec3(0.92, 0.97, 1.0) * ring;
  }

  // --- classification wave ring: a traveling rust scan-sheen, shared
  // centre/radius/strength with the sim's uWave via uWaveVis. Darken +
  // rust-tint (VALUE contrast, not glow) so it reads on both the bone and
  // rust-graded ground alike — the pale-ground lesson. ---
  vec2 wvd = field - uWaveVis.xy;
  wvd -= floor(wvd + 0.5);
  float wdist = length(wvd);
  float wring = exp(-pow((wdist - uWaveVis.z) * 26.0, 2.0)) * uWaveVis.w;
  col = mix(col, RUST * 0.45, wring * 0.5);
  col += RUST * wring * 0.12;

  // --- motes: sparse drifting specks, the unclassified survivors' echo ---
  vec2 driftGv = gv * 24.0 + vec2(uTime * 1.3, -uTime * 0.7);
  vec2 moteCell = floor(driftGv);
  float moteH = ttHash21(moteCell);
  float moteOn = step(0.996, moteH) * uMotes;
  vec2 moteLocal = fract(driftGv) - 0.5;
  float moteD = length(moteLocal);
  float moteAlpha = (1.0 - smoothstep(0.0, 0.14, moteD)) * moteOn;
  col += vec3(0.95, 0.9, 0.85) * moteAlpha * 0.85;

  // --- final glyph flicker: one LIVING-language cluster near a fixed margin
  // position. Deliberately bypasses the density/vitality gates and the
  // machine-code crossfade (by act 6 those have all flattened the script to
  // machine code) — the loop-closure motif is a forgotten language briefly
  // speaking again, in its community's vivid pre-flattening hue. ---
  float flickerMask = smoothstep(0.09, 0.0, length(vUv - vec2(0.13, 0.15)));
  float flickAlpha = smoothstep(w, w * 0.5, dmin) * colGate;
  // Drawn as vivid INK (mix), not additive light — additive vanishes on the
  // bleached bone ground, and this one beat must be unmissable.
  float flickInk = flickAlpha * flickerMask * uFlicker * (0.55 + 0.45 * sin(uTime * 9.0));
  col = mix(col, vividCol, min(1.0, flickInk * 1.6));

  // --- finishers ---
  col *= 1.0 + uEnergy * 0.25 + uFlash * 0.35;
  float vig = smoothstep(0.35, 1.05, length(vUv - 0.5));
  col = mix(col, GROUND * 0.55, vig * uVignette);
  col = vec3(1.0) - exp(-col * 1.15);

  if (uSoloMode == 1) {
    gl_FragColor = vec4(fragState.r, fragState.g, fragState.b, 1.0);
  } else if (uSoloMode == 2) {
    gl_FragColor = vec4(vec3(1.0) - exp(-patchworkCol * 1.15), 1.0);
  } else if (uSoloMode == 3) {
    vec3 g3 = mix(vec3(0.5), glyphColor, glyphAlpha);
    gl_FragColor = vec4(vec3(1.0) - exp(-g3 * 1.15), 1.0);
  } else if (uSoloMode == 4) {
    gl_FragColor = vec4(vec3(1.0) - exp(-machineCol * 1.15), 1.0);
  } else {
    gl_FragColor = vec4(col, 1.0);
  }
}
`}const d=[0,56,128,172,232,316,336.998],f=[{name:"thriving-field",vitalityTarget:.95,churn:.9,presence:.8,lifeRate:.1,wriggle:1,drift:1,scanRate:0,scanDrain:0,misProb:0,classifyPressure:0,waveRate:0,gridStrength:0,gridFine:0,glyphDensity:.85,chatterRate:1.2,machineFrac:0,classifiedFloor:0,commFreq:6,zoom:1.18,survivorFocus:0,hueSat:1,warmth:.55,rustMix:.05,inkPersist:0,vignette:.3,motes:.15,groundLight:.9},{name:"first-scans",vitalityTarget:.85,churn:.8,presence:.85,lifeRate:.12,wriggle:.8,drift:.8,scanRate:5,scanDrain:.5,misProb:.3,classifyPressure:0,waveRate:0,gridStrength:.18,gridFine:.25,glyphDensity:.8,chatterRate:1,machineFrac:.08,classifiedFloor:.06,commFreq:6,zoom:1.05,survivorFocus:0,hueSat:.92,warmth:.5,rustMix:.15,inkPersist:.5,vignette:.32,motes:.08,groundLight:.9},{name:"accelerating-catalogue",vitalityTarget:.7,churn:.75,presence:.8,lifeRate:.16,wriggle:.7,drift:.6,scanRate:16,scanDrain:.7,misProb:.15,classifyPressure:0,waveRate:0,gridStrength:.42,gridFine:.5,glyphDensity:.7,chatterRate:.9,machineFrac:.3,classifiedFloor:.28,commFreq:6,zoom:.98,survivorFocus:0,hueSat:.8,warmth:.45,rustMix:.35,inkPersist:.8,vignette:.35,motes:.05,groundLight:.9},{name:"last-unclassified",vitalityTarget:.9,churn:.6,presence:.75,lifeRate:.08,wriggle:1,drift:.7,scanRate:1.5,scanDrain:.4,misProb:0,classifyPressure:0,waveRate:0,gridStrength:.1,gridFine:.15,glyphDensity:.9,chatterRate:.7,machineFrac:.35,classifiedFloor:.34,commFreq:6,zoom:2.9,survivorFocus:1,hueSat:.85,warmth:.5,rustMix:.3,inkPersist:.5,vignette:.5,motes:.05,groundLight:.9},{name:"total-classification",vitalityTarget:.25,churn:.5,presence:.9,lifeRate:.3,wriggle:.35,drift:.25,scanRate:34,scanDrain:1,misProb:0,classifyPressure:.35,waveRate:10,gridStrength:1,gridFine:1,glyphDensity:.55,chatterRate:1.4,machineFrac:.9,classifiedFloor:.9,commFreq:6,zoom:.82,survivorFocus:0,hueSat:.4,warmth:.35,rustMix:.62,inkPersist:1,vignette:.38,motes:.02,groundLight:.9},{name:"residue",vitalityTarget:.1,churn:.25,presence:.22,lifeRate:.04,wriggle:.15,drift:.1,scanRate:0,scanDrain:0,misProb:0,classifyPressure:0,waveRate:0,gridStrength:.06,gridFine:0,glyphDensity:.08,chatterRate:.3,machineFrac:1,classifiedFloor:.93,commFreq:6,zoom:1.15,survivorFocus:0,hueSat:.2,warmth:.3,rustMix:.45,inkPersist:.35,vignette:.45,motes:.5,groundLight:1}],w=[[0,.22],[30,.34],[36,.28],[54,.3],[56,.36],[100,.45],[126,.5],[128,.58],[167.8,.68],[168.3,.78],[171,.74],[174,.42],[200,.38],[228,.5],[231.7,.55],[232.2,.96],[246,1],[300,.82],[315.6,.7],[316.4,.18],[330,.08],[336.998,.04]],G={energy:0};function xe(n){const e=Math.min(Math.max(n,0),w[w.length-1][0]);let i=0;for(;i<w.length-2&&e>=w[i+1][0];)i++;const t=w[i],a=w[i+1],s=Math.min(1,Math.max(0,(e-t[0])/Math.max(.001,a[0]-t[0])));return G.energy=t[1]+(a[1]-t[1])*s,G}const S=[[0,0],[128,0],[172,.22],[232,.25],[300,.95],[316,1],[336.998,1]],U={order:0};function ye(n){const e=Math.min(Math.max(n,0),S[S.length-1][0]);let i=0;for(;i<S.length-2&&e>=S[i+1][0];)i++;const t=S[i],a=S[i+1],s=Math.min(1,Math.max(0,(e-t[0])/Math.max(.001,a[0]-t[0])));return U.order=t[1]+(a[1]-t[1])*s,U}const be=6;function ke(n){const e=Math.min(1,Math.max(0,n));return e*e*(3-2*e)}function Ce(n,e,i){if(i<=0)return n;if(i>=1)return e;const t={...n,name:i<.5?n.name:e.name};for(const a of Object.keys(n)){const s=n[a],o=e[a];typeof s=="number"&&typeof o=="number"&&(t[a]=s+(o-s)*i)}return t}function Me(n){const e=d[d.length-1],i=Math.min(Math.max(n,0),e-.001);let t=0;for(;t<f.length-1&&i>=d[t+1];)t++;const a=d[t],s=d[t+1]??e,o=Math.min(1,Math.max(0,(i-a)/Math.max(.001,s-a))),r=t<f.length-1,h=s-i,c=r?ke(1-Math.min(1,h/be)):0,g=f[t],l=r?f[t+1]:g;return{params:Ce(g,l,c),actIndex:t,localT:o,blend:c}}const Te=.12,Fe=.5,Ae=.09,Ee=.22,W=.35,Re=.18,A=1.2,De=1.6,Pe=.75,Ie=1.2,Oe=.5,V=4,Le=1.2,_e=2,He=1,Ne=4,Ge=2,Ue=.5,E=1.4,We=2.2,Ve=.42,ze=.12,qe=.012,Be=1.2,R=1.6,Ke=.8,Ye=1,z=168,q=232,B=316,K=330,Xe=.6,$e=1,je=1.5,Ze=6,Y=9.5,Qe=40,Je=8,X=.45,et=.015,tt=.22;function at(n,e){const i=n*127.1+e*311.7,t=n*269.5+e*183.3,a=Math.sin(i)*43758.5453,s=Math.sin(t)*43758.5453;return[a-Math.floor(a),s-Math.floor(s)]}const[it,st]=at(0,0),$={x:.22+.56*it,y:.22+.56*st},j=6,Z={x:$.x/j,y:$.y/j},Q=5e-4,ot=10,b=1.5,D=.6,lt=.35,rt=.05,nt=1;class ct{renderer;scene;camera;field;quad;material;rand;forceScanAlways=!1;forceMisAlways=!1;forceWaveAlways=!1;forceFlickerAlways=!1;forceSparkAlways=!1;forceLifeFast=!1;pinnedClassified=null;pinnedOrder=null;full=!0;stampSlotCount=H;stepsPerFrame=_;cover=new k(1,1);pan=new k(0,0);userPanned=!1;bassE=0;midE=0;highE=0;bassSlowE=0;highSlowE=0;onsetCooldown=0;highOnsetCooldown=0;flash=0;beatPulse=0;lifeClock=0;spark=0;sparkSeed=0;sparkDebugTimer=0;scanSlots=[];scanA=[];scanB=[];scanTimeToNext=0;scanDebugTimer=0;pendingBurst=0;burstTimer=0;waveActive=!1;waveAge=0;waveCx=.5;waveCy=.5;waveTimeToNext=0;waveDebugTimer=0;rippleSlots=[];rippleValues=[];pokeSlots=[];classified=0;gridSlam=0;flickerEnv=0;breathPhase=0;firstUpdate=!0;lastDt=0;lastSongTime=-1;held=!1;dragDx=0;dragDy=0;velX=0;velY=0;init(e){const{renderer:i,seed:t,quality:a}=e;this.renderer=i,this.rand=le(t^2999220761);const s=new URLSearchParams(location.search),o=s.get("solo"),r=o==="field"?1:o==="patch"?2:o==="glyphs"?3:o==="machine"?4:0;this.forceScanAlways=s.get("scan")==="always",this.forceMisAlways=s.get("mis")==="always",this.forceWaveAlways=s.get("wave")==="always",this.forceFlickerAlways=s.get("flicker")==="always",this.forceSparkAlways=s.get("spark")==="always",this.forceLifeFast=s.get("life")==="fast";const h=s.get("classified");if(h!==null){const u=parseFloat(h);Number.isNaN(u)||(this.pinnedClassified=Math.min(1,Math.max(0,u)))}const c=s.get("order");if(c!==null){const u=parseFloat(c);Number.isNaN(u)||(this.pinnedOrder=Math.min(1,Math.max(0,u)))}this.full=a.level==="full",this.stampSlotCount=this.full?H:he;const g=this.full?_e:He,l=this.full?Ne:Ge;this.stepsPerFrame=this.full?_:ce;for(let u=0;u<this.stampSlotCount;u++)this.scanSlots.push({age:0,active:!1,mislabel:!1}),this.scanA.push(new x(0,0,0,0)),this.scanB.push(new x(0,0,0,0));for(let u=0;u<V;u++)this.rippleSlots.push({age:0,active:!1}),this.rippleValues.push(new x(0,0,0,0));for(let u=0;u<M;u++)this.pokeSlots.push({age:0,active:!1});this.breathPhase=this.rand()*Math.PI*2,this.scene=new J,this.camera=new ee(-1,1,1,-1,0,1),this.field=new ge(i,this.full,this.stampSlotCount),this.material=new C({vertexShader:we,fragmentShader:Se(V,this.stampSlotCount,g,l),depthTest:!1,depthWrite:!1,uniforms:{uField:{value:null},uTime:{value:0},uCover:{value:new k(1,1)},uZoom:{value:1},uPan:{value:this.pan},uCommFreq:{value:6},uEnergy:{value:0},uFlash:{value:0},uSparkle:{value:0},uGlyphKick:{value:0},uGlyphSeed:{value:0},uChurn:{value:0},uChatter:{value:0},uGlyphDensity:{value:0},uMachineFrac:{value:0},uMachineOrder:{value:0},uClassified:{value:0},uGridStrength:{value:0},uGridFine:{value:0},uGridSlam:{value:0},uHueSat:{value:0},uWarmth:{value:0},uRustMix:{value:0},uInkPersist:{value:0},uVignette:{value:0},uMotes:{value:0},uGroundLight:{value:0},uSurvivorFocus:{value:0},uDesat:{value:0},uSoloMode:{value:r},uFlicker:{value:0},uLifeClock:{value:0},uPresence:{value:0},uWriggle:{value:0},uDrift:{value:0},uWaveVis:{value:this.field.wave},uScanA:{value:this.scanA},uScanB:{value:this.scanB},uRipple:{value:this.rippleValues}}}),this.quad=new ae(new te(2,2),this.material),this.scene.add(this.quad);const y=i.domElement;this.resize(y.clientWidth||1,y.clientHeight||1)}sst(e){const i=Math.min(1,Math.max(0,e));return i*i*(3-2*i)}kickFlash(e){this.flash=Math.min(De,this.flash+e)}kickSpark(){this.spark=Math.min(Ie,this.spark+Pe),this.sparkSeed++}startScan(e,i,t){let a=this.scanSlots.findIndex(r=>!r.active);if(a<0){a=0;let r=this.scanSlots[0].age;for(let h=1;h<this.scanSlots.length;h++)this.scanSlots[h].age>r&&(r=this.scanSlots[h].age,a=h)}const s=this.scanSlots[a];s.active=!0,s.age=0;const o=this.forceMisAlways||this.rand()<t.misProb;s.mislabel=o,this.scanA[a].set(e,i,0,1),this.scanB[a].set(Ve+this.rand()*ze,o?1:0,this.rand(),0)}fireScan(e){const i=this.cover,t=this.material.uniforms.uZoom.value;let a=0,s=0;const o=e.survivorFocus>.5;for(let c=0;c<4&&(a=(this.rand()-.5)*.85,s=(this.rand()-.5)*.85,!(!o||Math.hypot(a,s)>.3));c++);let r=.5+this.pan.x+a*i.x/t,h=.5+this.pan.y+s*i.y/t;r-=Math.floor(r),h-=Math.floor(h),this.startScan(r,h,e)}scheduleScans(e,i,t){const a=Math.max(0,i)/60;if(!(a<=0))for(this.scanTimeToNext-=e;this.scanTimeToNext<=0;){this.fireScan(t),this.kickFlash(Re);const s=Math.max(1e-6,this.rand());this.scanTimeToNext+=-Math.log(s)/a}}ageScans(e,i){for(let t=0;t<this.scanSlots.length;t++){const a=this.scanSlots[t];if(!a.active)continue;const s=a.age;a.age+=e;const o=a.age;if(this.scanA[t].z=o,s<E&&o>=E&&(this.classified+=qe),o>=We)a.active=!1,this.scanA[t].w=0,this.field.stamps[t].w=0;else{const r=this.scanB[t].x,h=o>=Ue&&o<E;this.field.stamps[t].set(this.scanA[t].x,this.scanA[t].y,r/i.commFreq,h?i.scanDrain:0)}}}scriptedMassScan(){this.pendingBurst=this.stampSlotCount,this.burstTimer=0,this.startWave(),this.kickFlash(A)}scriptedDrop(){this.kickFlash(A),this.gridSlam=Xe,this.startWave()}startWave(){this.waveCx=this.rand(),this.waveCy=this.rand(),this.waveActive=!0,this.waveAge=0}scheduleWaves(e,i){if(this.waveActive)if(this.waveAge+=e,this.waveAge>=R)this.waveActive=!1,this.field.wave.w=0;else{const a=this.sst(this.waveAge/R);this.field.wave.set(this.waveCx,this.waveCy,a*Ke,Ye*(1-this.waveAge/R))}const t=Math.max(0,i)/60;if(!(t<=0))for(this.waveTimeToNext-=e;this.waveTimeToNext<=0;){this.startWave();const a=Math.max(1e-6,this.rand());this.waveTimeToNext+=-Math.log(a)/t}}activatePoke(e,i){let t=this.pokeSlots.findIndex(s=>!s.active);t<0&&(t=0);const a=this.pokeSlots[t];a.active=!0,a.age=0,this.field.pokes[t].set(e,i,rt,nt)}updatePokeAges(e){for(let i=0;i<this.pokeSlots.length;i++){const t=this.pokeSlots[i];t.active&&(t.age+=e,t.age>=lt&&(t.active=!1,this.field.pokes[i].w=0))}}activateRipple(e,i){let t=this.rippleSlots.findIndex(s=>!s.active);t<0&&(t=0);const a=this.rippleSlots[t];a.active=!0,a.age=0,this.rippleValues[t].set(e-Math.floor(e),i-Math.floor(i),0,1)}updateRippleAges(e){for(let i=0;i<this.rippleSlots.length;i++){const t=this.rippleSlots[i];t.active&&(t.age+=e,t.age>=Le?(t.active=!1,this.rippleValues[i].w=0):this.rippleValues[i].z=t.age)}}warmup(e,i,t){this.field.clearField(),this.field.setActParams(e);const a=this.pinnedClassified??e.classifiedFloor;this.field.seedField(a,e.commFreq,t),this.classified=a;for(let s=0;s<i;s++)this.scheduleScans(T,e.scanRate,e),this.ageScans(T,e),this.field.step(T,1)}update(e,i){const t=Me(i.time),a=t.actIndex===3||t.actIndex===4?f[t.actIndex]:t.params;this.lastDt=e;const s=this.pinnedOrder??ye(i.time).order;this.firstUpdate&&(this.firstUpdate=!1,this.warmup(a,ue,s)),this.lastSongTime>=0&&i.time<this.lastSongTime-10&&this.warmup(a,fe,s),this.lastSongTime>=0&&i.time-this.lastSongTime>=0&&i.time-this.lastSongTime<.5&&(this.lastSongTime<z&&i.time>=z&&this.scriptedMassScan(),this.lastSongTime<q&&i.time>=q&&this.scriptedDrop(),this.lastSongTime<B&&i.time>=B&&this.kickFlash(A),this.lastSongTime<K&&i.time>=K&&(this.flickerEnv=1)),this.lastSongTime=i.time;const o=Math.min(1,e*8);this.bassE+=(i.bass-this.bassE)*o,this.midE+=(i.mid-this.midE)*o,this.highE+=(i.high-this.highE)*o;const r=Math.min(1,e*1.5);if(this.bassSlowE+=(i.bass-this.bassSlowE)*r,this.highSlowE+=(i.high-this.highSlowE)*r,this.onsetCooldown-=e,this.onsetCooldown<=0&&this.bassE-this.bassSlowE>Te&&(a.scanRate>.5&&this.fireScan(a),this.kickFlash(W),t.actIndex===4&&!this.waveActive&&this.startWave(),this.beatPulse=Math.min(je,this.beatPulse+$e),this.onsetCooldown=Fe),this.highOnsetCooldown-=e,this.highOnsetCooldown<=0&&this.highE-this.highSlowE>Ae&&(this.kickSpark(),this.highOnsetCooldown=Ee),this.forceSparkAlways&&(this.sparkDebugTimer-=e,this.sparkDebugTimer<=0&&(this.kickSpark(),this.sparkDebugTimer=Oe)),this.spark*=Math.exp(-7*e),this.forceScanAlways&&(this.scanDebugTimer-=e,this.scanDebugTimer<=0&&(this.fireScan(a),this.scanDebugTimer=Be)),this.scheduleScans(e,a.scanRate,a),this.scheduleWaves(e,a.waveRate),this.forceWaveAlways&&(this.waveDebugTimer-=e,this.waveDebugTimer<=0&&(this.startWave(),this.waveDebugTimer=3)),this.pendingBurst>0)for(this.burstTimer-=e;this.burstTimer<=0&&this.pendingBurst>0;)this.fireScan(a),this.pendingBurst--,this.burstTimer+=.18;this.pinnedClassified!==null?this.classified=this.pinnedClassified:this.classified=Math.max(this.classified,a.classifiedFloor),this.ageScans(e,a),this.updatePokeAges(e),this.updateRippleAges(e),this.classified=Math.min(1,this.classified),this.pinnedClassified!==null&&(this.classified=this.pinnedClassified),this.flash*=Math.exp(-3.4*e),this.gridSlam*=Math.exp(-2.5*e),this.beatPulse*=Math.exp(-4*e),this.forceFlickerAlways?this.flickerEnv=1:this.flickerEnv*=Math.exp(-.6*e);const h=this.forceLifeFast?Ze:1;this.lifeClock+=e*a.lifeRate*h*(1+this.beatPulse*3),this.field.setVitalityMod(1+this.bassE*.5),this.field.setActParams(a);let c;if(t.actIndex===0){const m=d[1]-d[0],p=t.localT*m,v=this.sst(Math.min(1,p/Qe)),P=Y+(f[0].zoom-Y)*v;c=P+(f[1].zoom-P)*t.blend,this.userPanned||this.pan.set(Z.x*(1-v),Z.y*(1-v))}else if(t.actIndex===2)c=f[2].zoom;else if(t.actIndex===3){const m=d[4]-d[3],p=t.localT*m,v=this.sst(Math.min(1,p/Je));c=f[2].zoom+(f[3].zoom-f[2].zoom)*v}else if(t.actIndex===4){const m=d[5]-d[4],p=t.localT*m;p<X?c=f[3].zoom+(f[4].zoom-f[3].zoom)*this.sst(p/X):c=a.zoom}else c=a.zoom;const g=et*(1-.7*a.survivorFocus);c*=1+g*Math.sin(i.time*tt+this.breathPhase);const l=this.material.uniforms;l.uTime.value+=e,l.uZoom.value=c,l.uCommFreq.value=a.commFreq,l.uChurn.value=a.churn,l.uChatter.value=a.chatterRate*(1+this.midE*.8),l.uWarmth.value=a.warmth,l.uSparkle.value=this.highE,l.uGlyphKick.value=this.spark,l.uGlyphSeed.value=this.sparkSeed,l.uEnergy.value=xe(i.time).energy,l.uFlash.value=this.flash,l.uClassified.value=this.classified,l.uDesat.value=Math.min(1,this.classified*.6),l.uMachineFrac.value=a.machineFrac,l.uMachineOrder.value=s,l.uGridStrength.value=a.gridStrength,l.uGridFine.value=a.gridFine,l.uGlyphDensity.value=a.glyphDensity,l.uHueSat.value=a.hueSat,l.uRustMix.value=a.rustMix,l.uInkPersist.value=a.inkPersist,l.uVignette.value=a.vignette,l.uMotes.value=a.motes,l.uGroundLight.value=a.groundLight,l.uSurvivorFocus.value=a.survivorFocus,l.uGridSlam.value=this.gridSlam,l.uFlicker.value=this.flickerEnv,l.uLifeClock.value=this.lifeClock,l.uPresence.value=a.presence,l.uWriggle.value=a.wriggle,l.uDrift.value=a.drift;const y=this.cover;if(this.held){if(e>1e-5){const m=Math.min(1,e*ot),p=Math.min(b,Math.max(-b,this.dragDx/e)),v=Math.min(b,Math.max(-b,this.dragDy/e));this.velX+=(p-this.velX)*m,this.velY+=(v-this.velY)*m}this.dragDx=0,this.dragDy=0}else if(this.velX!==0||this.velY!==0){this.pan.x+=this.velX*y.x/c*e,this.pan.y+=this.velY*y.y/c*e;const m=Math.exp(-2.5*e);this.velX*=m,this.velY*=m,Math.abs(this.velX)<Q&&(this.velX=0),Math.abs(this.velY)<Q&&(this.velY=0)}const u=Math.hypot(this.pan.x,this.pan.y);u>D&&(this.pan.x*=D/u,this.pan.y*=D/u,this.velX=0,this.velY=0)}pointer(e){const i=this.material.uniforms.uZoom.value,t=this.cover;if(e.type==="down"){this.held=!0,this.dragDx=0,this.dragDy=0,this.velX=0,this.velY=0;const a=(e.x-.5)*t.x/i+.5+this.pan.x,s=(e.y-.5)*t.y/i+.5+this.pan.y,o=a-Math.floor(a),r=s-Math.floor(s);this.activatePoke(o,r),this.activateRipple(o,r),this.kickFlash(W);return}if(e.type==="move"){if(!this.held)return;this.userPanned=!0,this.pan.x+=e.dx*t.x/i,this.pan.y+=e.dy*t.y/i,this.dragDx+=e.dx,this.dragDy+=e.dy;return}if(e.type==="up"){this.held=!1;return}this.held=!1,this.velX=0,this.velY=0,this.dragDx=0,this.dragDy=0}render(){this.field.step(this.lastDt,this.stepsPerFrame),this.material.uniforms.uField.value=this.field.texture,this.renderer.setRenderTarget(null),this.renderer.render(this.scene,this.camera)}resize(e,i){if(!this.material||e<=0||i<=0)return;const t=Math.min(3.5,Math.max(.28,e/i));t>=1?this.cover.set(t,1):this.cover.set(1,1/t),this.material.uniforms.uCover.value.copy(this.cover)}dispose(){this.field.dispose(),this.material.dispose(),this.quad.geometry.dispose(),this.renderer.setRenderTarget(null)}}const ht={default:()=>new ct},mt=ht.default;export{mt as default};
//# sourceMappingURL=index-vJlfDN3R.js.map
