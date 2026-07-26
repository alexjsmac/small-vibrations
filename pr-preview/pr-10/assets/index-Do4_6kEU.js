import{a as E,R,L as I,b as Z,H as J,V as g,c as w,S as K,O as $,d as Y,e as y,M as j}from"./three-vlqji54k.js";import{m as Q}from"./random-DL1jLgMw.js";const ee=512,te=256,P=2,ae=1,_=6,ie=4,b=4,se=240,oe=60,k=1/30,L=256,le=.05,C=`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`,re=`
precision highp float;
void main() { gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0); }
`,X=`
float ttHash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec2 ttHash22(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453);
}
// Feature point (nucleus) inside integer community cell cc, confined to
// [0.12, 0.88] within the cell (matches a3-biome-dominoes' anchor idiom).
vec2 commAnchor(vec2 cc) { return vec2(0.12) + 0.76 * ttHash22(cc); }
// Stable 0..1 classification order for a community — the ratchet's global
// "how early does this community get classified" schedule.
float commOrder(vec2 cc) { return ttHash21(cc + vec2(7.31, 3.77)); }
// Nearest community to p (p already in community space = fieldUv * uCommFreq):
// 3x3 search over integer cells around p, returns the WINNING cell's integer
// coordinate (not the fractional nucleus position).
vec2 commCell(vec2 p) {
  vec2 n = floor(p);
  vec2 f = fract(p);
  vec2 best = n;
  float bestD = 1.0e6;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 cc = n + g;
      vec2 anchor = commAnchor(cc);
      vec2 r = g + anchor - f;
      float d = dot(r, r);
      if (d < bestD) { bestD = d; best = cc; }
    }
  }
  return best;
}
`;function ne(c){return`
precision highp float;
varying vec2 vUv;
uniform sampler2D uPrev;
uniform vec2 uTexel;
uniform float uDt;
uniform float uDiff;              // vitality bleed, pre-scaled to SIM_GRID (see uDiff doc above)
uniform float uVitalityTarget;    // act's baseline vitality regrow target
uniform float uVitalityMod;       // smoothed-bass multiplier from index.ts (1 = no change)
uniform float uClassifyPressure;  // global classification creep per second (act 5 only)
uniform vec4 uStamps[${c}]; // xy field-uv, z radius, w drain strength (0 = inactive)
uniform vec4 uPokes[${b}];  // xy field-uv, z radius, w strength (0 = inactive)
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
  for (int i = 0; i < ${c}; i++) {
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
  for (int i = 0; i < ${b}; i++) {
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
`}function ce(c){return`
precision highp float;
varying vec2 vUv;
uniform float uSeedFloor;
uniform float uSeedVitality;
uniform float uCommFreq;
const float FIELD_SIZE = ${c.toFixed(1)};

${X}

void main() {
  vec2 cc = commCell(vUv * uCommFreq);
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
`}class he{uniforms;stamps;pokes;wave;renderer;texSize;targets;readIndex=0;scene;camera;quad;simMaterial;initMaterial;seedMaterial;params=null;vitalityMod=1;constructor(e,i,t){this.renderer=e,this.texSize=i?ee:te;const a={type:J,format:Z,minFilter:I,magFilter:I,wrapS:R,wrapT:R,depthBuffer:!1,stencilBuffer:!1};this.targets=[new E(this.texSize,this.texSize,a),new E(this.texSize,this.texSize,a)],this.stamps=[];for(let o=0;o<t;o++)this.stamps.push(new g(0,0,.05,0));this.pokes=[];for(let o=0;o<b;o++)this.pokes.push(new g(0,0,.035,0));this.wave=new g(.5,.5,0,0),this.uniforms={uPrev:{value:null},uTexel:{value:new w(1/this.texSize,1/this.texSize)},uDt:{value:0},uDiff:{value:le*(this.texSize/L)*(this.texSize/L)},uVitalityTarget:{value:0},uVitalityMod:{value:1},uClassifyPressure:{value:0},uStamps:{value:this.stamps},uPokes:{value:this.pokes},uWave:{value:this.wave}},this.scene=new K,this.camera=new $(-1,1,1,-1,0,1);const s=new Y(2,2);this.simMaterial=new y({vertexShader:C,fragmentShader:ne(t),uniforms:this.uniforms,depthTest:!1,depthWrite:!1}),this.initMaterial=new y({vertexShader:C,fragmentShader:re,depthTest:!1,depthWrite:!1});const l={uSeedFloor:{value:0},uSeedVitality:{value:.8},uCommFreq:{value:6}};this.seedMaterial=new y({vertexShader:C,fragmentShader:ce(this.texSize),uniforms:l,depthTest:!1,depthWrite:!1}),this.quad=new j(s,this.initMaterial),this.scene.add(this.quad),this.clearField(),this.quad.material=this.simMaterial}setActParams(e){this.params=e}setVitalityMod(e){this.vitalityMod=e}applyParams(e){this.uniforms.uVitalityTarget.value=e.vitalityTarget,this.uniforms.uVitalityMod.value=this.vitalityMod,this.uniforms.uClassifyPressure.value=e.classifyPressure}step(e,i){const t=this.params;if(!t||i<=0)return;this.applyParams(t),this.uniforms.uDt.value=e/i;const a=this.renderer.getRenderTarget();for(let s=0;s<i;s++){const l=this.targets[this.readIndex],o=this.targets[1-this.readIndex];this.uniforms.uPrev.value=l.texture,this.renderer.setRenderTarget(o),this.renderer.render(this.scene,this.camera),this.readIndex=1-this.readIndex}this.renderer.setRenderTarget(a??null)}seedField(e,i){const t=this.seedMaterial.uniforms;t.uSeedFloor.value=e,t.uSeedVitality.value=this.params?.vitalityTarget??.8,t.uCommFreq.value=i;const a=this.renderer.getRenderTarget(),s=this.quad.material;this.quad.material=this.seedMaterial;for(const l of this.targets)this.renderer.setRenderTarget(l),this.renderer.render(this.scene,this.camera);this.renderer.setRenderTarget(a??null),this.quad.material=s}clearField(){const e=this.renderer.getRenderTarget(),i=this.quad.material;this.quad.material=this.initMaterial;for(const t of this.targets)this.renderer.setRenderTarget(t),this.renderer.render(this.scene,this.camera);this.renderer.setRenderTarget(e??null),this.quad.material=i}get texture(){return this.targets[this.readIndex].texture}dispose(){this.targets[0].dispose(),this.targets[1].dispose(),this.simMaterial.dispose(),this.initMaterial.dispose(),this.seedMaterial.dispose(),this.quad.geometry.dispose()}}const me=`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;function fe(c,e,i,t){const a=Math.max(1,Math.floor(i)),s=2*a+1,l=Math.max(1,Math.floor(t));return`
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
uniform vec4 uScanA[${e}]; // xy field-uv centre, z age (s), w strength (0 = inactive)
uniform vec4 uScanB[${e}]; // x radius, y mislabel flag, z label seed, w unused
uniform vec4 uRipple[${c}]; // xy field-uv, z age (s), w strength (0 = inactive)

const vec3 RUST = vec3(0.769, 0.302, 0.227);
const vec3 MACHINE_TONE = vec3(0.62, 0.50, 0.44);

${X}

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

// iq Voronoi with edge distance (F2-F1 style, a3's idiom) over a single
// n-centred ${s}x${s} window of community anchors (commAnchor). The second
// pass RECOMPUTES each anchor instead of caching into a local array — same
// as a3's two-pass search: local arrays indexed in loops can spill to
// memory on some drivers, and the redundant hashes are cheaper than that
// risk.
void commVoronoi(vec2 p, out vec2 cellCoord, out vec2 cellPoint, out float edgeDist) {
  vec2 n = floor(p);
  vec2 f = fract(p);
  vec2 mg = vec2(0.0);
  vec2 mr = vec2(0.0);
  vec2 winOff = vec2(0.5);
  float md = 8.0;
  for (int j = -${a}; j <= ${a}; j++) {
    for (int i = -${a}; i <= ${a}; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 o = commAnchor(n + g);
      vec2 r = g + o - f;
      float d = dot(r, r);
      if (d < md) { md = d; mr = r; mg = g; winOff = o; }
    }
  }
  float mdEdge = 8.0;
  for (int j = -${a}; j <= ${a}; j++) {
    for (int i = -${a}; i <= ${a}; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 o = commAnchor(n + g);
      vec2 r = g + o - f;
      vec2 diff = mr - r;
      if (dot(diff, diff) > 0.00001) {
        mdEdge = min(mdEdge, dot(0.5 * (mr + r), normalize(r - mr)));
      }
    }
  }
  cellCoord = n + mg;
  cellPoint = n + mg + winOff;
  edgeDist = mdEdge;
}

void main() {
  // Screen uv -> field uv (house formula, shared with pointer.ts's inverse).
  vec2 field = (vUv - 0.5) * uCover / uZoom + 0.5 + uPan;
  // Centre-anchored Voronoi scaling: the community lattice recedes from the
  // VIEW CENTRE when uCommFreq or uZoom animate.
  vec2 p = (field - 0.5) * uCommFreq;

  vec2 cc, cellPoint;
  float edgeDist;
  commVoronoi(p, cc, cellPoint, edgeDist);

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
  commCol *= mix(0.8, 1.22, patternContrast);

  // --- ground compositing: communities occupy their patch, ground shows
  // through near patch edges (the "specimens on paper" read) ---
  float patchEdgeMask = smoothstep(0.0, 0.05, edgeDist);
  float patchStrength = mix(0.35, 1.0, cellVitality) * patchEdgeMask;
  vec3 patchworkCol = mix(GROUND, commCol, patchStrength);
  patchworkCol += commCol * fragState.b * 0.6; // local poke re-ignition glow

  vec3 col = patchworkCol;
  vec3 machineCol = GROUND;

  // Archive ink: faint rust label-rows on the ground where a community has
  // been scanned before (persistent, independent of current vitality).
  float inkRow = step(0.5, fract(field.y * 40.0)) * step(fract(field.x * 3.0), 0.6);
  float inkAlpha = fragState.a * uInkPersist * inkRow * patchEdgeMask;
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

  vec2 gg = (ttRot(langAngle) * local) * 7.0;
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

  float marginMask = smoothstep(0.02, 0.07, edgeDist);

  // Per-glyph staggered re-roll (the "chatter") - ttHash21(gid) offsets each
  // cell's re-roll phase so consecutive re-rolls never land on every glyph
  // at once (no global strobe).
  float ch = ttHash21(gid + cc * 17.0 + floor(uTime * uChatter + ttHash21(gid)) * 0.37);

  float dmin = 999.0;
  for (int s = 0; s < ${l}; s++) {
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
  vec2 gm = local * 7.0;
  vec2 gmid = floor(gm);
  vec2 gmq = fract(gm);
  float inCol = gmid.x == 0.0 ? 1.0 : 0.0;
  float rowIndex = gmid.y + commOrder(cc) * 23.0;
  float rowPhase = fract(uTime * 0.5 - rowIndex * 0.07);
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
  for (int i = 0; i < ${c}; i++) {
    vec4 rp = uRipple[i];
    if (rp.w <= 0.0) continue;
    vec2 rrd = field - rp.xy;
    rrd -= floor(rrd + 0.5);
    float rdist = length(rrd);
    float rr = 0.02 + rp.z * 0.30;
    float ring = exp(-pow((rdist - rr) * 70.0, 2.0)) * rp.w * exp(-rp.z * 2.8);
    col += vec3(0.92, 0.97, 1.0) * ring;
  }

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
`}const f=[0,56,128,172,232,316,336.998],m=[{name:"thriving-field",vitalityTarget:.95,churn:.9,scanRate:0,scanDrain:0,misProb:0,classifyPressure:0,waveRate:0,gridStrength:0,gridFine:0,glyphDensity:.85,chatterRate:1.2,machineFrac:0,classifiedFloor:0,commFreq:6,zoom:1.18,survivorFocus:0,hueSat:1,warmth:.55,rustMix:.05,inkPersist:0,vignette:.3,motes:.15,groundLight:.9},{name:"first-scans",vitalityTarget:.85,churn:.8,scanRate:5,scanDrain:.5,misProb:.3,classifyPressure:0,waveRate:0,gridStrength:.18,gridFine:.25,glyphDensity:.8,chatterRate:1,machineFrac:.08,classifiedFloor:.06,commFreq:6,zoom:1.05,survivorFocus:0,hueSat:.92,warmth:.5,rustMix:.15,inkPersist:.5,vignette:.32,motes:.08,groundLight:.9},{name:"accelerating-catalogue",vitalityTarget:.7,churn:.75,scanRate:16,scanDrain:.7,misProb:.15,classifyPressure:0,waveRate:0,gridStrength:.42,gridFine:.5,glyphDensity:.7,chatterRate:.9,machineFrac:.3,classifiedFloor:.28,commFreq:6,zoom:.98,survivorFocus:0,hueSat:.8,warmth:.45,rustMix:.35,inkPersist:.8,vignette:.35,motes:.05,groundLight:.9},{name:"last-unclassified",vitalityTarget:.9,churn:.6,scanRate:1.5,scanDrain:.4,misProb:0,classifyPressure:0,waveRate:0,gridStrength:.1,gridFine:.15,glyphDensity:.9,chatterRate:.7,machineFrac:.35,classifiedFloor:.34,commFreq:6,zoom:2.9,survivorFocus:1,hueSat:.85,warmth:.5,rustMix:.3,inkPersist:.5,vignette:.5,motes:.05,groundLight:.9},{name:"total-classification",vitalityTarget:.25,churn:.5,scanRate:34,scanDrain:1,misProb:0,classifyPressure:.35,waveRate:10,gridStrength:1,gridFine:1,glyphDensity:.55,chatterRate:1.4,machineFrac:.9,classifiedFloor:.9,commFreq:6,zoom:.82,survivorFocus:0,hueSat:.4,warmth:.35,rustMix:.62,inkPersist:1,vignette:.38,motes:.02,groundLight:.9},{name:"residue",vitalityTarget:.1,churn:.25,scanRate:0,scanDrain:0,misProb:0,classifyPressure:0,waveRate:0,gridStrength:.06,gridFine:0,glyphDensity:.08,chatterRate:.3,machineFrac:1,classifiedFloor:.93,commFreq:6,zoom:1.15,survivorFocus:0,hueSat:.2,warmth:.3,rustMix:.45,inkPersist:.35,vignette:.45,motes:.5,groundLight:1}],p=[[0,.22],[30,.34],[36,.28],[54,.3],[56,.36],[100,.45],[126,.5],[128,.58],[167.8,.68],[168.3,.78],[171,.74],[174,.42],[200,.38],[228,.5],[231.7,.55],[232.2,.96],[246,1],[300,.82],[315.6,.7],[316.4,.18],[330,.08],[336.998,.04]],O={energy:0};function ue(c){const e=Math.min(Math.max(c,0),p[p.length-1][0]);let i=0;for(;i<p.length-2&&e>=p[i+1][0];)i++;const t=p[i],a=p[i+1],s=Math.min(1,Math.max(0,(e-t[0])/Math.max(.001,a[0]-t[0])));return O.energy=t[1]+(a[1]-t[1])*s,O}const de=6;function ve(c){const e=Math.min(1,Math.max(0,c));return e*e*(3-2*e)}function pe(c,e,i){if(i<=0)return c;if(i>=1)return e;const t={...c,name:i<.5?c.name:e.name};for(const a of Object.keys(c)){const s=c[a],l=e[a];typeof s=="number"&&typeof l=="number"&&(t[a]=s+(l-s)*i)}return t}function ge(c){const e=f[f.length-1],i=Math.min(Math.max(c,0),e-.001);let t=0;for(;t<m.length-1&&i>=f[t+1];)t++;const a=f[t],s=f[t+1]??e,l=Math.min(1,Math.max(0,(i-a)/Math.max(.001,s-a))),o=t<m.length-1,h=s-i,r=o?ve(1-Math.min(1,h/de)):0,v=m[t],u=o?m[t+1]:v;return{params:pe(v,u,r),actIndex:t,localT:l,blend:r}}const Se=.12,xe=.5,we=.09,ye=.22,H=.35,be=.18,T=1.2,ke=1.6,Ce=.75,Te=1.2,Me=.5,G=4,Fe=1.2,Ae=2,De=1,Ee=4,Re=2,Ie=.5,M=1.4,Pe=2.2,_e=.42,Le=.12,Oe=.012,He=1.2,F=1.6,Ge=.8,Ue=1,U=168,N=232,z=316,V=330,Ne=.6,ze=36,W=1.3,Ve=8,q=.45,We=.015,qe=.22,B=5e-4,Be=10,x=1.5,A=.6,Ke=.35,$e=.05,Ye=1;class je{renderer;scene;camera;field;quad;material;rand;forceScanAlways=!1;forceMisAlways=!1;forceWaveAlways=!1;forceFlickerAlways=!1;forceSparkAlways=!1;pinnedClassified=null;full=!0;stampSlotCount=_;stepsPerFrame=P;cover=new w(1,1);pan=new w(0,0);bassE=0;midE=0;highE=0;bassSlowE=0;highSlowE=0;onsetCooldown=0;highOnsetCooldown=0;flash=0;spark=0;sparkSeed=0;sparkDebugTimer=0;scanSlots=[];scanA=[];scanB=[];scanTimeToNext=0;scanDebugTimer=0;pendingBurst=0;burstTimer=0;waveActive=!1;waveAge=0;waveCx=.5;waveCy=.5;waveTimeToNext=0;waveDebugTimer=0;rippleSlots=[];rippleValues=[];pokeSlots=[];classified=0;gridSlam=0;flickerEnv=0;breathPhase=0;firstUpdate=!0;lastDt=0;lastSongTime=-1;held=!1;dragDx=0;dragDy=0;velX=0;velY=0;init(e){const{renderer:i,seed:t,quality:a}=e;this.renderer=i,this.rand=Q(t^2999220761);const s=new URLSearchParams(location.search),l=s.get("solo"),o=l==="field"?1:l==="patch"?2:l==="glyphs"?3:l==="machine"?4:0;this.forceScanAlways=s.get("scan")==="always",this.forceMisAlways=s.get("mis")==="always",this.forceWaveAlways=s.get("wave")==="always",this.forceFlickerAlways=s.get("flicker")==="always",this.forceSparkAlways=s.get("spark")==="always";const h=s.get("classified");if(h!==null){const n=parseFloat(h);Number.isNaN(n)||(this.pinnedClassified=Math.min(1,Math.max(0,n)))}this.full=a.level==="full",this.stampSlotCount=this.full?_:ie;const r=this.full?Ae:De,v=this.full?Ee:Re;this.stepsPerFrame=this.full?P:ae;for(let n=0;n<this.stampSlotCount;n++)this.scanSlots.push({age:0,active:!1,mislabel:!1}),this.scanA.push(new g(0,0,0,0)),this.scanB.push(new g(0,0,0,0));for(let n=0;n<G;n++)this.rippleSlots.push({age:0,active:!1}),this.rippleValues.push(new g(0,0,0,0));for(let n=0;n<b;n++)this.pokeSlots.push({age:0,active:!1});this.breathPhase=this.rand()*Math.PI*2,this.scene=new K,this.camera=new $(-1,1,1,-1,0,1),this.field=new he(i,this.full,this.stampSlotCount),this.material=new y({vertexShader:me,fragmentShader:fe(G,this.stampSlotCount,r,v),depthTest:!1,depthWrite:!1,uniforms:{uField:{value:null},uTime:{value:0},uCover:{value:new w(1,1)},uZoom:{value:1},uPan:{value:this.pan},uCommFreq:{value:6},uEnergy:{value:0},uFlash:{value:0},uSparkle:{value:0},uGlyphKick:{value:0},uGlyphSeed:{value:0},uChurn:{value:0},uChatter:{value:0},uGlyphDensity:{value:0},uMachineFrac:{value:0},uClassified:{value:0},uGridStrength:{value:0},uGridFine:{value:0},uGridSlam:{value:0},uHueSat:{value:0},uWarmth:{value:0},uRustMix:{value:0},uInkPersist:{value:0},uVignette:{value:0},uMotes:{value:0},uGroundLight:{value:0},uSurvivorFocus:{value:0},uDesat:{value:0},uSoloMode:{value:o},uFlicker:{value:0},uScanA:{value:this.scanA},uScanB:{value:this.scanB},uRipple:{value:this.rippleValues}}}),this.quad=new j(new Y(2,2),this.material),this.scene.add(this.quad);const u=i.domElement;this.resize(u.clientWidth||1,u.clientHeight||1)}sst(e){const i=Math.min(1,Math.max(0,e));return i*i*(3-2*i)}kickFlash(e){this.flash=Math.min(ke,this.flash+e)}kickSpark(){this.spark=Math.min(Te,this.spark+Ce),this.sparkSeed++}startScan(e,i,t){let a=this.scanSlots.findIndex(o=>!o.active);if(a<0){a=0;let o=this.scanSlots[0].age;for(let h=1;h<this.scanSlots.length;h++)this.scanSlots[h].age>o&&(o=this.scanSlots[h].age,a=h)}const s=this.scanSlots[a];s.active=!0,s.age=0;const l=this.forceMisAlways||this.rand()<t.misProb;s.mislabel=l,this.scanA[a].set(e,i,0,1),this.scanB[a].set(_e+this.rand()*Le,l?1:0,this.rand(),0)}fireScan(e){const i=this.cover,t=this.material.uniforms.uZoom.value;let a=0,s=0;const l=e.survivorFocus>.5;for(let r=0;r<4&&(a=(this.rand()-.5)*.85,s=(this.rand()-.5)*.85,!(!l||Math.hypot(a,s)>.3));r++);let o=.5+this.pan.x+a*i.x/t,h=.5+this.pan.y+s*i.y/t;o-=Math.floor(o),h-=Math.floor(h),this.startScan(o,h,e)}scheduleScans(e,i,t){const a=Math.max(0,i)/60;if(!(a<=0))for(this.scanTimeToNext-=e;this.scanTimeToNext<=0;){this.fireScan(t),this.kickFlash(be);const s=Math.max(1e-6,this.rand());this.scanTimeToNext+=-Math.log(s)/a}}ageScans(e,i){for(let t=0;t<this.scanSlots.length;t++){const a=this.scanSlots[t];if(!a.active)continue;const s=a.age;a.age+=e;const l=a.age;if(this.scanA[t].z=l,s<M&&l>=M&&(this.classified+=Oe),l>=Pe)a.active=!1,this.scanA[t].w=0,this.field.stamps[t].w=0;else{const o=this.scanB[t].x,h=l>=Ie&&l<M;this.field.stamps[t].set(this.scanA[t].x,this.scanA[t].y,o/i.commFreq,h?i.scanDrain:0)}}}scriptedMassScan(){this.pendingBurst=this.stampSlotCount,this.burstTimer=0,this.startWave(),this.kickFlash(T)}scriptedDrop(){this.kickFlash(T),this.gridSlam=Ne,this.startWave()}startWave(){this.waveCx=this.rand(),this.waveCy=this.rand(),this.waveActive=!0,this.waveAge=0}scheduleWaves(e,i){if(this.waveActive)if(this.waveAge+=e,this.waveAge>=F)this.waveActive=!1,this.field.wave.w=0;else{const a=this.sst(this.waveAge/F);this.field.wave.set(this.waveCx,this.waveCy,a*Ge,Ue*(1-this.waveAge/F))}const t=Math.max(0,i)/60;if(!(t<=0))for(this.waveTimeToNext-=e;this.waveTimeToNext<=0;){this.startWave();const a=Math.max(1e-6,this.rand());this.waveTimeToNext+=-Math.log(a)/t}}activatePoke(e,i){let t=this.pokeSlots.findIndex(s=>!s.active);t<0&&(t=0);const a=this.pokeSlots[t];a.active=!0,a.age=0,this.field.pokes[t].set(e,i,$e,Ye)}updatePokeAges(e){for(let i=0;i<this.pokeSlots.length;i++){const t=this.pokeSlots[i];t.active&&(t.age+=e,t.age>=Ke&&(t.active=!1,this.field.pokes[i].w=0))}}activateRipple(e,i){let t=this.rippleSlots.findIndex(s=>!s.active);t<0&&(t=0);const a=this.rippleSlots[t];a.active=!0,a.age=0,this.rippleValues[t].set(e-Math.floor(e),i-Math.floor(i),0,1)}updateRippleAges(e){for(let i=0;i<this.rippleSlots.length;i++){const t=this.rippleSlots[i];t.active&&(t.age+=e,t.age>=Fe?(t.active=!1,this.rippleValues[i].w=0):this.rippleValues[i].z=t.age)}}warmup(e,i){this.field.clearField(),this.field.setActParams(e);const t=this.pinnedClassified??e.classifiedFloor;this.field.seedField(t,e.commFreq),this.classified=t;for(let a=0;a<i;a++)this.scheduleScans(k,e.scanRate,e),this.ageScans(k,e),this.field.step(k,1)}update(e,i){const t=ge(i.time),a=t.actIndex===3||t.actIndex===4?m[t.actIndex]:t.params;this.lastDt=e,this.firstUpdate&&(this.firstUpdate=!1,this.warmup(a,se)),this.lastSongTime>=0&&i.time<this.lastSongTime-10&&this.warmup(a,oe),this.lastSongTime>=0&&i.time-this.lastSongTime>=0&&i.time-this.lastSongTime<.5&&(this.lastSongTime<U&&i.time>=U&&this.scriptedMassScan(),this.lastSongTime<N&&i.time>=N&&this.scriptedDrop(),this.lastSongTime<z&&i.time>=z&&this.kickFlash(T),this.lastSongTime<V&&i.time>=V&&(this.flickerEnv=1)),this.lastSongTime=i.time;const s=Math.min(1,e*8);this.bassE+=(i.bass-this.bassE)*s,this.midE+=(i.mid-this.midE)*s,this.highE+=(i.high-this.highE)*s;const l=Math.min(1,e*1.5);if(this.bassSlowE+=(i.bass-this.bassSlowE)*l,this.highSlowE+=(i.high-this.highSlowE)*l,this.onsetCooldown-=e,this.onsetCooldown<=0&&this.bassE-this.bassSlowE>Se&&(a.scanRate>.5&&this.fireScan(a),this.kickFlash(H),t.actIndex===4&&!this.waveActive&&this.startWave(),this.onsetCooldown=xe),this.highOnsetCooldown-=e,this.highOnsetCooldown<=0&&this.highE-this.highSlowE>we&&(this.kickSpark(),this.highOnsetCooldown=ye),this.forceSparkAlways&&(this.sparkDebugTimer-=e,this.sparkDebugTimer<=0&&(this.kickSpark(),this.sparkDebugTimer=Me)),this.spark*=Math.exp(-7*e),this.forceScanAlways&&(this.scanDebugTimer-=e,this.scanDebugTimer<=0&&(this.fireScan(a),this.scanDebugTimer=He)),this.scheduleScans(e,a.scanRate,a),this.scheduleWaves(e,a.waveRate),this.forceWaveAlways&&(this.waveDebugTimer-=e,this.waveDebugTimer<=0&&(this.startWave(),this.waveDebugTimer=3)),this.pendingBurst>0)for(this.burstTimer-=e;this.burstTimer<=0&&this.pendingBurst>0;)this.fireScan(a),this.pendingBurst--,this.burstTimer+=.18;this.pinnedClassified!==null?this.classified=this.pinnedClassified:this.classified=Math.max(this.classified,a.classifiedFloor),this.ageScans(e,a),this.updatePokeAges(e),this.updateRippleAges(e),this.classified=Math.min(1,this.classified),this.pinnedClassified!==null&&(this.classified=this.pinnedClassified),this.flash*=Math.exp(-3.4*e),this.gridSlam*=Math.exp(-2.5*e),this.forceFlickerAlways?this.flickerEnv=1:this.flickerEnv*=Math.exp(-.6*e),this.field.setVitalityMod(1+this.bassE*.5),this.field.setActParams(a);let o;if(t.actIndex===0){const n=f[1]-f[0],d=t.localT*n,S=this.sst(Math.min(1,d/ze)),D=W+(m[0].zoom-W)*S;o=D+(m[1].zoom-D)*t.blend}else if(t.actIndex===2)o=m[2].zoom;else if(t.actIndex===3){const n=f[4]-f[3],d=t.localT*n,S=this.sst(Math.min(1,d/Ve));o=m[2].zoom+(m[3].zoom-m[2].zoom)*S}else if(t.actIndex===4){const n=f[5]-f[4],d=t.localT*n;d<q?o=m[3].zoom+(m[4].zoom-m[3].zoom)*this.sst(d/q):o=a.zoom}else o=a.zoom;const h=We*(1-.7*a.survivorFocus);o*=1+h*Math.sin(i.time*qe+this.breathPhase);const r=this.material.uniforms;r.uTime.value+=e,r.uZoom.value=o,r.uCommFreq.value=a.commFreq,r.uChurn.value=a.churn,r.uChatter.value=a.chatterRate*(1+this.midE*.8),r.uWarmth.value=a.warmth,r.uSparkle.value=this.highE,r.uGlyphKick.value=this.spark,r.uGlyphSeed.value=this.sparkSeed,r.uEnergy.value=ue(i.time).energy,r.uFlash.value=this.flash,r.uClassified.value=this.classified,r.uDesat.value=Math.min(1,this.classified*.6),r.uMachineFrac.value=a.machineFrac,r.uGridStrength.value=a.gridStrength,r.uGridFine.value=a.gridFine,r.uGlyphDensity.value=a.glyphDensity,r.uHueSat.value=a.hueSat,r.uRustMix.value=a.rustMix,r.uInkPersist.value=a.inkPersist,r.uVignette.value=a.vignette,r.uMotes.value=a.motes,r.uGroundLight.value=a.groundLight,r.uSurvivorFocus.value=a.survivorFocus,r.uGridSlam.value=this.gridSlam,r.uFlicker.value=this.flickerEnv;const v=this.cover;if(this.held){if(e>1e-5){const n=Math.min(1,e*Be),d=Math.min(x,Math.max(-x,this.dragDx/e)),S=Math.min(x,Math.max(-x,this.dragDy/e));this.velX+=(d-this.velX)*n,this.velY+=(S-this.velY)*n}this.dragDx=0,this.dragDy=0}else if(this.velX!==0||this.velY!==0){this.pan.x+=this.velX*v.x/o*e,this.pan.y+=this.velY*v.y/o*e;const n=Math.exp(-2.5*e);this.velX*=n,this.velY*=n,Math.abs(this.velX)<B&&(this.velX=0),Math.abs(this.velY)<B&&(this.velY=0)}const u=Math.hypot(this.pan.x,this.pan.y);u>A&&(this.pan.x*=A/u,this.pan.y*=A/u,this.velX=0,this.velY=0)}pointer(e){const i=this.material.uniforms.uZoom.value,t=this.cover;if(e.type==="down"){this.held=!0,this.dragDx=0,this.dragDy=0,this.velX=0,this.velY=0;const a=(e.x-.5)*t.x/i+.5+this.pan.x,s=(e.y-.5)*t.y/i+.5+this.pan.y,l=a-Math.floor(a),o=s-Math.floor(s);this.activatePoke(l,o),this.activateRipple(l,o),this.kickFlash(H);return}if(e.type==="move"){if(!this.held)return;this.pan.x+=e.dx*t.x/i,this.pan.y+=e.dy*t.y/i,this.dragDx+=e.dx,this.dragDy+=e.dy;return}if(e.type==="up"){this.held=!1;return}this.held=!1,this.velX=0,this.velY=0,this.dragDx=0,this.dragDy=0}render(){this.field.step(this.lastDt,this.stepsPerFrame),this.material.uniforms.uField.value=this.field.texture,this.renderer.setRenderTarget(null),this.renderer.render(this.scene,this.camera)}resize(e,i){if(!this.material||e<=0||i<=0)return;const t=Math.min(3.5,Math.max(.28,e/i));t>=1?this.cover.set(t,1):this.cover.set(1,1/t),this.material.uniforms.uCover.value.copy(this.cover)}dispose(){this.field.dispose(),this.material.dispose(),this.quad.geometry.dispose(),this.renderer.setRenderTarget(null)}}const Xe={default:()=>new je},Qe=Xe.default;export{Qe as default};
//# sourceMappingURL=index-Do4_6kEU.js.map
