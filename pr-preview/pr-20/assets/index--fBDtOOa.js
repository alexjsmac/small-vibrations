import{a as N,R as B,L as V,b as we,H as xe,V as v,c as A,S as fe,O as me,d as pe,e as M,M as ve}from"./three-vlqji54k.js";import{m as ke}from"./random-DL1jLgMw.js";import{O as U,r as C}from"./onset-DHl140yf.js";import{P as T}from"./poisson-BRMs42Pw.js";const be=512,ye=256,z=2,Se=1,W=6,Ae=4,R=4,Me=240,Re=60,F=1/30,K=256,Ce=.05,E=`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`,Te=`
precision highp float;
void main() { gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0); }
`,ge=`
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
`;function Fe(c){return`
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
uniform vec4 uPokes[${R}];  // xy field-uv, z radius, w strength (0 = inactive)
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
  for (int i = 0; i < ${R}; i++) {
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
`}function Ee(c){return`
precision highp float;
varying vec2 vUv;
uniform float uSeedFloor;
uniform float uSeedVitality;
uniform float uCommFreq;
uniform float uSeedOrder;
const float FIELD_SIZE = ${c.toFixed(1)};

${ge}

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
`}class Pe{uniforms;stamps;pokes;wave;renderer;texSize;targets;readIndex=0;scene;camera;quad;simMaterial;initMaterial;seedMaterial;params=null;vitalityMod=1;constructor(e,a,t){this.renderer=e,this.texSize=a?be:ye;const i={type:xe,format:we,minFilter:V,magFilter:V,wrapS:B,wrapT:B,depthBuffer:!1,stencilBuffer:!1};this.targets=[new N(this.texSize,this.texSize,i),new N(this.texSize,this.texSize,i)],this.stamps=[];for(let r=0;r<t;r++)this.stamps.push(new v(0,0,.05,0));this.pokes=[];for(let r=0;r<R;r++)this.pokes.push(new v(0,0,.035,0));this.wave=new v(.5,.5,0,0),this.uniforms={uPrev:{value:null},uTexel:{value:new A(1/this.texSize,1/this.texSize)},uDt:{value:0},uDiff:{value:Ce*(this.texSize/K)*(this.texSize/K)},uVitalityTarget:{value:0},uVitalityMod:{value:1},uClassifyPressure:{value:0},uStamps:{value:this.stamps},uPokes:{value:this.pokes},uWave:{value:this.wave}},this.scene=new fe,this.camera=new me(-1,1,1,-1,0,1);const s=new pe(2,2);this.simMaterial=new M({vertexShader:E,fragmentShader:Fe(t),uniforms:this.uniforms,depthTest:!1,depthWrite:!1}),this.initMaterial=new M({vertexShader:E,fragmentShader:Te,depthTest:!1,depthWrite:!1});const o={uSeedFloor:{value:0},uSeedVitality:{value:.8},uCommFreq:{value:6},uSeedOrder:{value:0}};this.seedMaterial=new M({vertexShader:E,fragmentShader:Ee(this.texSize),uniforms:o,depthTest:!1,depthWrite:!1}),this.quad=new ve(s,this.initMaterial),this.scene.add(this.quad),this.clearField(),this.quad.material=this.simMaterial}setActParams(e){this.params=e}setVitalityMod(e){this.vitalityMod=e}applyParams(e){this.uniforms.uVitalityTarget.value=e.vitalityTarget,this.uniforms.uVitalityMod.value=this.vitalityMod,this.uniforms.uClassifyPressure.value=e.classifyPressure}step(e,a){const t=this.params;if(!t||a<=0)return;this.applyParams(t),this.uniforms.uDt.value=e/a;const i=this.renderer.getRenderTarget();for(let s=0;s<a;s++){const o=this.targets[this.readIndex],r=this.targets[1-this.readIndex];this.uniforms.uPrev.value=o.texture,this.renderer.setRenderTarget(r),this.renderer.render(this.scene,this.camera),this.readIndex=1-this.readIndex}this.renderer.setRenderTarget(i??null)}seedField(e,a,t){const i=this.seedMaterial.uniforms;i.uSeedFloor.value=e,i.uSeedVitality.value=this.params?.vitalityTarget??.8,i.uCommFreq.value=a,i.uSeedOrder.value=t;const s=this.renderer.getRenderTarget(),o=this.quad.material;this.quad.material=this.seedMaterial;for(const r of this.targets)this.renderer.setRenderTarget(r),this.renderer.render(this.scene,this.camera);this.renderer.setRenderTarget(s??null),this.quad.material=o}clearField(){const e=this.renderer.getRenderTarget(),a=this.quad.material;this.quad.material=this.initMaterial;for(const t of this.targets)this.renderer.setRenderTarget(t),this.renderer.render(this.scene,this.camera);this.renderer.setRenderTarget(e??null),this.quad.material=a}get texture(){return this.targets[this.readIndex].texture}dispose(){this.targets[0].dispose(),this.targets[1].dispose(),this.simMaterial.dispose(),this.initMaterial.dispose(),this.seedMaterial.dispose(),this.quad.geometry.dispose()}}const De=`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;function Ie(c,e,a,t){const i=Math.max(1,Math.floor(a)),s=2*i+1,o=Math.max(1,Math.floor(t));return`
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
uniform vec4 uRipple[${c}]; // xy field-uv, z age (s), w strength (0 = inactive)
uniform float uEventVivid; // 0..1 how strongly events (link strikes, waves) restore specimens' vivid pre-flattening color
uniform vec4 uLinkA[3]; // xy field-uv A (source), z age (s), w strength (0 = inactive)
uniform vec4 uLinkB[3]; // xy field-uv B (target/struck), z label seed, w unused
uniform vec4 uRunner[4]; // x axis (0 horizontal / 1 vertical), y line coordinate (screen-space grid gv), z age (s), w strength (0 = inactive)
uniform vec4 uKill[4]; // xy field-uv centre (the STRUCK specimen's own anchor position), z age (s), w strength (0 = inactive) — instant-kill zones fired by link strikes
uniform float uBeatCount; // running beat counter (bass onsets + ambient scans) — drives the living grid background's per-cell re-roll phase
uniform float uBeatFlash; // 0..1 per-beat decay envelope (kicked to 1 on every beatCount increment, index.ts decays it ~2.8/s) — the beat-pop color-restore trigger
uniform float uBeatPop; // 0..1 act-level strength of the beat-pop color-restore effect (ActParams.beatPop)
uniform float uGridLife; // 0..1 ambient grid-background animation amount (beat-synced cell fills + edge traces)
uniform int uGridMode; // 0 scatter / 1 row cascade / 2 ring pulse / 3 checker — which cells the living grid background fills; rotates on a beat-gated timer in index.ts so the background's behavior visibly changes over the track
uniform float uAura; // 0..1 act-4 ambient aura-ring strength (the quiet-zoom spotlight's breathing reaction)
uniform float uAuraPulse; // 0..1 bass-energy modulation of the aura's breathing amplitude
uniform int uFxMode; // 0 soft-focus blur / 1 echo trails / 2 pulse-warp — which scheduled global-effect interlude is (potentially) running, see index.ts's fx scheduler doc
uniform float uFxAmt; // 0..1 current envelope-scaled interlude strength (0 whenever no episode is active, or in the branches for the two modes not currently selected)

const vec3 RUST = vec3(0.769, 0.302, 0.227);
const vec3 MACHINE_TONE = vec3(0.62, 0.50, 0.44);

${ge}

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

// Shared species-plan params: the SINGLE source of truth for family, base
// angle, elongation and base radius, so the cheap 9-cell search (via
// specimenSd's silhouette bias) and the winner-only detail ink drawn once
// in main() can never disagree. fam: 0 beetle, 1 leaf, 2 diatom,
// 3 bacterium, 4 lichen. R0base excludes the lifecycle scaleEnv factor —
// callers multiply that in themselves (specimenSd already has scaleEnv on
// hand; the detail block reads winScale).
void specParams(vec2 cc, float o, out float fam, out float ang, out float elong, out float R0base) {
  fam = floor(ttHash21(cc + vec2(6.2, 14.8)) * 5.0);
  fam = clamp(fam, 0.0, 4.0);
  float h1 = ttHash21(cc + vec2(21.0, 8.8));
  float h2 = ttHash21(cc + vec2(33.0, 1.2));
  float h3 = ttHash21(cc + vec2(41.0, 6.6));
  ang = mix(h3 * 6.2831853, 0.0, o);
  if (fam < 0.5) {
    elong = mix(1.15, 1.4, h2); // beetle: compact oval
  } else if (fam < 1.5) {
    elong = mix(1.8, 2.4, h2); // leaf: long blade
  } else if (fam < 2.5) {
    elong = mix(0.95, 1.05, h2); // diatom: near-circular frustule
  } else if (fam < 3.5) {
    elong = mix(1.6, 2.0, h2); // bacterium: rod/capsule
  } else {
    elong = mix(0.62, 1.55, h2); // lichen: irregular crust (unchanged)
  }
  elong = mix(elong, clamp(elong, 0.85, 1.2), o);
  R0base = (0.21 + 0.13 * h1) * mix(1.0, 0.9, o);
}

// Kill-zone envelope: a struck specimen is annihilated instantly at its OWN
// anchor position (not wherever the strike itself fired) — multiple
// overlapping kill slots take the MINIMUM (deepest) envelope. Shared between
// specimenSd (every search candidate, so a killed specimen also loses search
// ownership as its silhouette shrinks) and main()'s separate winScale
// recompute (specLife alone doesn't know the anchor, so that call can't
// apply this itself).
float killEnv(vec2 anchorFieldUv) {
  float env = 1.0;
  for (int i = 0; i < 4; i++) {
    vec4 kz = uKill[i];
    if (kz.w <= 0.0) continue;
    vec2 d = anchorFieldUv - kz.xy;
    d -= floor(d + 0.5);
    // Half a community cell (commFreq 6 -> cell = 0.167 field-uv): the kill
    // point is the strike's random visible target, not the specimen's exact
    // anchor, which can sit up to ~0.08 away — a tighter radius let struck
    // specimens survive their own X.
    if (length(d) < 0.085) {
      env = min(env, 1.0 - smoothstep(0.0, 0.22, kz.z));
    }
  }
  return env;
}

// Signed distance to community cc's SPECIMEN silhouette at community-space
// point p: an organic, elongated, wobble-outlined blob around the cell's
// anchor. This deliberately replaces any Voronoi-cell rendering — b2's
// world is discrete organisms laid out on catalogue paper, never a tiling
// lattice (that geometry belongs to a3). As the machine order rises the
// blob's rotation aligns to the page axes, its proportions normalize, and
// its outline simplifies — a living form becoming a filed entry. Absent
// specimens (mid-cycle, not this epoch's roll) return a large constant so
// they drop out of the nearest-specimen search entirely. The outline wobble
// is now FAMILY-SPECIFIC (specParams picks fam) so the silhouette alone
// hints at the body plan cheaply; the recognizable ink detail is drawn once
// for the winner only, in main().
float specimenSd(vec2 p, vec2 cc, float order) {
  float epoch;
  float scaleEnv = specLife(cc, epoch);
  if (scaleEnv < 0.01) return 9.0;
  vec2 anchor = specAnchor(cc, epoch);
  // Kill-zone: a struck specimen shrinks to nothing over 0.22s (then stays
  // gone for the rest of the kill slot's hold) — the hero (cc==(0,0)) is
  // IMMUNE, same as its lifecycle pin above.
  if (cc != vec2(0.0)) {
    vec2 anchorFieldUv = (cc + anchor) / uCommFreq + 0.5;
    scaleEnv *= killEnv(anchorFieldUv);
  }
  vec2 local = p - (cc + anchor);
  float o = commOrderAmt(cc, order);
  float fam, ang, elong, R0base;
  specParams(cc, o, fam, ang, elong, R0base);
  float h1 = ttHash21(cc + vec2(21.0, 8.8));
  float h2 = ttHash21(cc + vec2(33.0, 1.2));
  float h3 = ttHash21(cc + vec2(41.0, 6.6));
  vec2 sl = ttRot(-ang) * local;
  sl.x /= elong;
  float th = atan(sl.y, sl.x);
  // Time-animated wriggle: phase motion per wobble harmonic, amplitude
  // scaled by the act's wriggle knob (ordered specimens still calm).
  float wobAmp = mix(1.0, 0.3, o) * mix(0.35, 1.0, uWriggle);
  float wob;
  if (fam < 0.5) {
    // beetle: bilateral symmetry - even harmonics only (cos(k*th) with th
    // measured from the body axis gives left/right mirror symmetry).
    float t1 = h1 * 6.2831853 + uTime * 1.3;
    float t2 = h2 * 6.2831853 - uTime * 1.7;
    wob = (0.05 * cos(2.0 * th + t1) + 0.03 * cos(4.0 * th + t2)) * wobAmp;
  } else if (fam < 1.5) {
    // leaf: teardrop taper (one pole broader) + fine serration + one low harmonic.
    wob = (0.16 * cos(th)
         + 0.025 * sin(13.0 * th + uTime * 1.1)
         + 0.07 * sin(3.0 * th + h1 * 6.2831853 + uTime * 1.3)) * wobAmp;
  } else if (fam < 2.5) {
    // diatom: n-fold radial scallop only (frustule symmetry); n must match
    // the spoke count drawn in the winner-only detail block.
    float n = 5.0 + floor(ttHash21(cc + vec2(9.7, 3.4)) * 4.0);
    wob = 0.05 * cos(n * th + uTime * 0.6) * wobAmp;
  } else if (fam < 3.5) {
    // bacterium: near-smooth capsule - current harmonics heavily damped.
    wob = (0.07 * sin(3.0 * th + h1 * 6.2831853 + uTime * 1.3)
         + 0.045 * sin(5.0 * th + h2 * 6.2831853 - uTime * 1.7)
         + 0.028 * sin(7.0 * th + h3 * 6.2831853 + uTime * 2.3)) * 0.15 * wobAmp;
  } else {
    // lichen: current wobble unchanged.
    wob = (0.07 * sin(3.0 * th + h1 * 6.2831853 + uTime * 1.3)
         + 0.045 * sin(5.0 * th + h2 * 6.2831853 - uTime * 1.7)
         + 0.028 * sin(7.0 * th + h3 * 6.2831853 + uTime * 2.3)) * wobAmp;
  }
  float R0 = R0base * scaleEnv;
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
  for (int j = -${i}; j <= ${i}; j++) {
    for (int i = -${i}; i <= ${i}; i++) {
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

  // --- scheduled global-effect interlude (index.ts's fx scheduler): mode 0
  // widens every fwidth-derived AA window for a soft-focus blur (aaMul,
  // used at every AA site below); mode 2 bends the whole page with a slow
  // radial ripple BEFORE the specimen search, so it feeds everything
  // downstream (search, glyphs, species detail) — this is deliberate.
  float aaMul = 1.0 + ((uFxMode == 0) ? uFxAmt * 3.5 : 0.0);
  float fx2 = (uFxMode == 2) ? uFxAmt : 0.0;
  vec2 worg = vec2(sin(uTime * 0.07), cos(uTime * 0.061)) * 1.5;
  vec2 wd = p - worg;
  float wr = length(wd);
  p += (wd / max(wr, 0.3)) * 0.05 * fx2 * sin(wr * 3.0 - uTime * 2.2);

  vec2 cc, cellPoint;
  float sd;
  specimenSearch(p, uMachineOrder, cc, cellPoint, sd);
  float ordAmt = commOrderAmt(cc, uMachineOrder);
  // Winner's own lifecycle scale — gates the pin+tag ink below (an absent
  // specimen mid-cycle must not carry a label). Mirrors specimenSd's
  // kill-zone envelope: this is a SEPARATE specLife call (not specimenSd),
  // so the kill check must be re-applied here too, at cellPoint's field-uv
  // (== the winning anchor's field-uv) — hero stays immune.
  float winEpoch;
  float winScale = specLife(cc, winEpoch);
  if (cc != vec2(0.0)) {
    winScale *= killEnv(cellPoint / uCommFreq + 0.5);
  }

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
  // vividCol is the community's TRUE living colour, captured BEFORE the
  // vitality satPull and the machine flattening — every event that
  // "restores colour" (beat pops, link flashes, wave washes, auras, the
  // outro flicker) restores THIS. Capturing it after satPull made every
  // climax flash pale gray: at act-5 vitality the hue was already washed
  // out before any event could bring it back.
  vec3 vividCol = commCol;
  // Gentle floor on the vitality term: living-but-not-maximal communities
  // (mid acts) keep most of their hue, so the mid-track doesn't read as
  // already dying — the real desaturation is the classified/grade path.
  float satPull = 1.0 - uHueSat * mix(0.6, 1.0, cellVitality);
  commCol = mix(commCol, vec3(lumaC), clamp(satPull, 0.0, 1.0));

  // Machine flattening: the per-cell classified ratchet OR the global
  // classification pressure pulls every community toward the drained tone.
  float classFlat = max(cellClassified, uClassified * 0.7);
  commCol = mix(commCol, MACHINE_TONE, classFlat * 0.85);

  // --- event color restore: link-strike endpoints and the classification
  // wave ring pull this winner specimen's hue back toward its living
  // pre-flattening color — the climax's connections and waves visibly
  // un-flatten what the machine just drained. anchorFieldUv is cellUv
  // (already computed above: the winner's own field-uv anchor). ---
  float linkGlow = 0.0;
  for (int i = 0; i < 3; i++) {
    vec4 la = uLinkA[i];
    float strength = la.w;
    if (strength <= 0.0) continue;
    vec4 lb = uLinkB[i];
    float age = la.z;
    float envelope = 1.0 - smoothstep(0.0, 1.0, age); // rises instantly, decays by 1.0s
    float dA2 = dot(cellUv - la.xy, cellUv - la.xy);
    float dB2 = dot(cellUv - lb.xy, cellUv - lb.xy);
    linkGlow += (exp(-dA2 / 0.0035) + exp(-dB2 / 0.0035)) * strength * envelope;
  }
  commCol = mix(commCol, vividCol * 1.2, clamp(linkGlow, 0.0, 1.0) * uEventVivid);

  vec2 wpDelta = cellUv - uWaveVis.xy;
  wpDelta -= floor(wpDelta + 0.5);
  float wpCol = exp(-pow((length(wpDelta) - uWaveVis.z) * 18.0, 2.0)) * uWaveVis.w;
  commCol = mix(commCol, vividCol * 1.15, wpCol * uEventVivid);
  // Where events are glowing, the restored color must SURVIVE the grade —
  // the grade section reads this and locally backs off desat/rust, so the
  // vivid flashes punch through the drained climax instead of being
  // re-crushed to monochrome two blocks later.
  float eventGlow = clamp(linkGlow + wpCol, 0.0, 1.0) * uEventVivid;

  // Beat-pop: a different hash-picked ~28% of specimens flashes back to
  // full living colour on every beat (uBeatCount rotates the subset,
  // uBeatFlash is the per-beat decay envelope) — the monochrome breaks
  // rhythmically instead of sitting unbroken over the whole climax.
  float popSel = step(0.72, ttHash21(cc + vec2(floor(uBeatCount) * 5.3, 9.9)));
  float pop = popSel * uBeatFlash * uBeatPop;
  commCol = mix(commCol, vividCol * 1.2, min(1.0, pop));
  eventGlow = clamp(eventGlow + pop * 0.8, 0.0, 1.0);

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
  float fx0 = (uFxMode == 0) ? uFxAmt : 0.0;
  float patternContrast = band * cellVitality * (1.0 - classFlat) * (1.0 - fx0 * 0.5);

  // --- specimen-on-paper compositing: organic ink-rimmed silhouette with
  // a soft cast shadow, bone paper everywhere between specimens ---
  float saa = fwidth(sd) * 1.2 * aaMul + 0.001;
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

  // --- winner-only species detail: engraved field-guide ink (legs, veins,
  // spokes, flagella) drawn ONCE for the winning specimen only — the cheap
  // 9-cell search above only ever biases the silhouette; this is where the
  // budget goes on the recognizable per-family strokes. specParams is
  // recomputed here (not stored from the search) so it can never drift
  // from the silhouette that produced this fragment's sd/cellPoint. ---
  {
    float dfam, dang, delong, dR0;
    specParams(cc, ordAmt, dfam, dang, delong, dR0);
    vec2 sl = ttRot(-dang) * (p - cellPoint);
    sl.x /= delong;
    float rr = length(sl);
    float th = atan(sl.y, sl.x);
    float R0 = dR0 * winScale;

    // Interior strokes (seams, veins, spokes, granules) show only inside
    // the silhouette; appendages (legs, antennae, flagella, stem) show only
    // in a thin just-outside band, so they read as limbs on paper without
    // leaking into neighbouring specimens or the open ground.
    float insideMask = specimenMask;
    float outsideBand = smoothstep(-saa * 1.5, saa * 1.5, sd)
                       * (1.0 - smoothstep(R0 * 0.4, R0 * 0.55, sd));

    float dInk = 999.0;

    if (dfam < 0.5) {
      // --- beetle: centre seam, two SHORT wing-case division ticks, 3
      // legs/side, antennae. The ticks deliberately stop well short of the
      // silhouette edge: full-width crossing arcs made every beetle read as
      // an already-struck-out X, colliding with the link-strike grammar. ---
      float dSeam = ttSegDist(sl, vec2(-0.75, 0.0) * R0, vec2(0.8, 0.0) * R0, 0.0);
      dInk = min(dInk, mix(999.0, dSeam, insideMask));
      for (int k = 0; k < 2; k++) {
        float dx = k == 0 ? 0.15 : 0.45;
        float dArc = ttSegDist(sl, vec2(dx, -0.42) * R0, vec2(dx, 0.42) * R0, 0.0);
        dInk = min(dInk, mix(999.0, dArc, insideMask));
      }
      for (int i = 0; i < 3; i++) {
        float xi = mix(-0.45, 0.5, float(i) / 2.0) * R0;
        vec2 aP = vec2(xi, 0.6 * R0);
        vec2 bP = vec2(xi - 0.35 * R0, 1.25 * R0);
        float dLegP = ttSegDist(sl, aP, bP, 0.0);
        float dLegM = ttSegDist(sl, vec2(aP.x, -aP.y), vec2(bP.x, -bP.y), 0.0);
        dInk = min(dInk, mix(999.0, min(dLegP, dLegM), outsideBand));
      }
      vec2 antA = vec2(0.8, 0.12) * R0;
      vec2 antB = vec2(1.35, 0.5) * R0;
      float dAntP = ttSegDist(sl, antA, antB, 0.06);
      float dAntM = ttSegDist(sl, vec2(antA.x, -antA.y), vec2(antB.x, -antB.y), 0.06);
      dInk = min(dInk, mix(999.0, min(dAntP, dAntM), outsideBand));
    } else if (dfam < 1.5) {
      // --- leaf: midrib, 5 vein pairs, stem ---
      float dMid = ttSegDist(sl, vec2(-0.85, 0.0) * R0, vec2(0.9, 0.0) * R0, 0.0);
      dInk = min(dInk, mix(999.0, dMid, insideMask));
      for (int i = 0; i < 5; i++) {
        float xi = mix(-0.6, 0.6, float(i) / 4.0) * R0;
        vec2 vA = vec2(xi, 0.0);
        vec2 vB = vec2(xi + 0.35 * R0, 0.55 * R0);
        vec2 vBm = vec2(xi + 0.35 * R0, -0.55 * R0);
        float dVeinP = ttSegDist(sl, vA, vB, 0.0);
        float dVeinM = ttSegDist(sl, vA, vBm, 0.0);
        dInk = min(dInk, mix(999.0, min(dVeinP, dVeinM), insideMask));
      }
      float dStem = ttSegDist(sl, vec2(-1.3, 0.0) * R0, vec2(-0.88, 0.0) * R0, 0.0);
      dInk = min(dInk, mix(999.0, dStem, outsideBand));
    } else if (dfam < 2.5) {
      // --- diatom: two ring contours + n-fold radial spoke comb ---
      float dRing = min(abs(rr - 0.5 * R0), abs(rr - 0.78 * R0));
      dInk = min(dInk, mix(999.0, dRing, insideMask));
      float n = 5.0 + floor(ttHash21(cc + vec2(9.7, 3.4)) * 4.0);
      float sect = abs(fract(th * n / 6.2831853 + 0.5) - 0.5) * 6.2831853 / n * rr;
      float rgAA = fwidth(rr) + 0.001;
      float radialGate = smoothstep(0.25 * R0 - rgAA, 0.25 * R0 + rgAA, rr)
                        * (1.0 - smoothstep(0.85 * R0 - rgAA, 0.85 * R0 + rgAA, rr));
      dInk = min(dInk, mix(999.0, sect, insideMask * radialGate));
    } else if (dfam < 3.5) {
      // --- bacterium: 2 flagella (3 chained segments each) + 5 interior granules ---
      for (int k = 0; k < 2; k++) {
        vec2 dir = k == 0 ? vec2(1.0, 0.0) : vec2(-1.0, 0.0);
        vec2 perp = vec2(-dir.y, dir.x);
        vec2 pole = dir * R0;
        vec2 fp0 = pole + perp * (0.1 * R0 * sin(0.0 * 7.0 + uTime * 2.0));
        vec2 fp1 = pole + dir * (0.33 * 0.55 * R0) + perp * (0.1 * R0 * sin(0.33 * 7.0 + uTime * 2.0));
        vec2 fp2 = pole + dir * (0.66 * 0.55 * R0) + perp * (0.1 * R0 * sin(0.66 * 7.0 + uTime * 2.0));
        vec2 fp3 = pole + dir * (1.0 * 0.55 * R0) + perp * (0.1 * R0 * sin(1.0 * 7.0 + uTime * 2.0));
        float dFlag = ttSegDist(sl, fp0, fp1, 0.0);
        dFlag = min(dFlag, ttSegDist(sl, fp1, fp2, 0.0));
        dFlag = min(dFlag, ttSegDist(sl, fp2, fp3, 0.0));
        dInk = min(dInk, mix(999.0, dFlag, outsideBand));
      }
      for (int i = 0; i < 5; i++) {
        vec2 gp = (ttHash22(cc + vec2(float(i) * 5.3 + 1.0, 4.4)) - 0.5) * 2.0 * 0.6 * R0;
        float dGran = length(sl - gp) - 0.055 * R0;
        dInk = min(dInk, mix(999.0, dGran, insideMask));
      }
    }
    // fam 4 (lichen): no engraved detail — skin + glyph script only, as before.

    float inkAA = fwidth(rr) * 1.6 * aaMul + 0.002;
    float detailGate = winScale * (1.0 - ordAmt * 0.5) * mix(1.0, 0.7, classFlat);
    float detailAlpha = smoothstep(inkAA, inkAA * 0.4, dInk) * detailGate;
    patchworkCol = mix(patchworkCol, inkLine, detailAlpha);
  }

  patchworkCol += commCol * fragState.b * 0.6; // local poke re-ignition glow

  vec3 col = patchworkCol;
  vec3 machineCol = GROUND;

  // --- fx mode 1 (echo trails): two ghost taps lagging behind the winner
  // specimen along a fixed offset direction, drawn as translucent
  // afterimages — a fixed lag direction reads as motion smear (community
  // units; see index.ts's fx scheduler doc). Declared here (winner-only,
  // right after the specimen composite) so it stays in scope for the grid
  // block's double-exposure sample below.
  float fx1 = (uFxMode == 1) ? uFxAmt : 0.0;
  vec2 echoOff = vec2(0.16, 0.07) * fx1;
  float g1 = specimenSd(p - echoOff, cc, uMachineOrder);
  float g2 = specimenSd(p - echoOff * 2.0, cc, uMachineOrder);
  float ghostMask1 = smoothstep(saa * 3.0, -saa * 3.0, g1);
  float ghostMask2 = smoothstep(saa * 3.0, -saa * 3.0, g2);
  col = mix(col, commCol, ghostMask1 * fx1 * 0.28);
  col = mix(col, commCol, ghostMask2 * fx1 * 0.16);

  // --- act-4 ambient auras: soft concentric rings breathing outward from
  // the winner specimen (uSurvivorFocus's quiet-zoom spotlight reaction).
  // Winner-only, masked implicitly to this specimen's territory by aq/
  // auraFall — NOT gated by classFlat (drained survivors still radiate;
  // in act 4 they're the unclassified holdout anyway). R0 is recomputed
  // via specParams (the single source of truth for family/radius) since
  // the species-detail block's own R0 above is scoped to its own block;
  // survM is a local copy of the grade section's spotlight term (a pure
  // function of vUv/uCover, no winner dependency) so the aura can read it
  // before the grade does. eventGlow (declared above, in the event-color-
  // restore section) picks up this aura's contribution so the grade
  // locally backs off and the vivid color drawn here survives it. ---
  if (sd > 0.0) {
    float afam, aang, aelong, aR0base;
    specParams(cc, ordAmt, afam, aang, aelong, aR0base);
    float R0 = aR0base * winScale;
    float aq = sd / max(R0, 0.05);
    float rings = 0.5 + 0.5 * sin((aq - uTime * 0.35) * 7.0);
    rings = pow(rings, 3.0);                       // thin soft bands
    float auraFall = 1.0 - smoothstep(0.0, 2.2, aq); // fade by ~2.2 R0 out
    float survM = smoothstep(0.18, 0.55, length((vUv - 0.5) * uCover));
    float auraAmp = uAura * (0.55 + 0.45 * uAuraPulse) * mix(1.0, 1.0 - survM * 0.85, uSurvivorFocus);
    float auraA = rings * auraFall * auraAmp * winScale;
    col = mix(col, vividCol, auraA * 0.5);
    col += vividCol * auraA * 0.12;
    eventGlow = clamp(eventGlow + auraA * 0.6, 0.0, 1.0);
  }

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
  float w = max(fwg.x, fwg.y) * 1.4 * aaMul + 0.001;

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
  float wMach = max(fwm.x, fwm.y) * 1.4 * aaMul + 0.001;
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

  // Carried past the grade to AFTER the "--- grade ---" section (see the
  // living grid background below, and its draw beside the runner block) —
  // the vivid cos-palette cell fill must not be crushed to monochrome.
  float vividFill = 0.0;
  vec3 vividFillCol = vec3(0.0);

  // --- machine grid (screen space - does NOT pan/zoom with the world) ---
  vec2 gv = (vUv - 0.5) * uCover;
  vec2 gm1 = gv * 14.0;
  vec2 dist1 = min(fract(gm1), 1.0 - fract(gm1));
  vec2 aa1 = fwidth(gm1) * 1.5 * aaMul + 0.0005;
  vec2 lineMask1 = 1.0 - smoothstep(vec2(0.0), aa1, dist1);
  float mainLine = max(lineMask1.x, lineMask1.y);

  vec2 gm2 = gv * 14.0 * 4.0;
  vec2 dist2 = min(fract(gm2), 1.0 - fract(gm2));
  vec2 aa2 = fwidth(gm2) * 1.5 * aaMul + 0.0005;
  vec2 lineMask2 = 1.0 - smoothstep(vec2(0.0), aa2, dist2);
  float fineLine = max(lineMask2.x, lineMask2.y) * uGridFine;

  // fx mode 1 (echo trails) grid double-exposure: a second line-mask sample
  // offset by the same echo direction as the specimen ghost taps, folded in
  // at reduced weight below.
  vec2 gvEcho = gv + vec2(0.012, 0.006) * fx1;
  vec2 gm1Echo = gvEcho * 14.0;
  vec2 dist1Echo = min(fract(gm1Echo), 1.0 - fract(gm1Echo));
  vec2 lineMask1Echo = 1.0 - smoothstep(vec2(0.0), aa1, dist1Echo);
  float mainLineEcho = max(lineMask1Echo.x, lineMask1Echo.y);

  float gridIntensity = uGridStrength + uGridSlam;
  // fx mode 2 (pulse-warp): the grid brightens slightly with the wavefront.
  float gridMask = clamp(
    mainLine + fineLine * 0.6 + mainLineEcho * 0.4
      + fx2 * 0.15 * (0.5 + 0.5 * sin(length(gv) * 4.0 - uTime * 2.2)),
    0.0, 1.0
  ) * gridIntensity;
  // Print-sweep: the machine printing rows top-to-bottom, brightening on beats.
  float sweepPos = fract(uTime * 0.4);
  float sweepD = abs(vUv.y - (1.0 - sweepPos));
  float sweep = exp(-sweepD * sweepD * 900.0) * uGridStrength * (0.3 + uFlash * 0.7);
  gridMask = clamp(gridMask + sweep * 0.5, 0.0, 1.0);
  col = mix(col, col * RUST * 0.5, gridMask * 0.7);
  col += RUST * gridMask * 0.15;
  machineCol = mix(machineCol, machineCol * RUST * 0.5, gridMask * 0.7);
  machineCol += RUST * gridMask * 0.15;

  // --- living grid background: beat-synced cell fills + edge traces, both
  // scaled by uGridLife and masked to paper (specimens carry their own ink
  // instead) — additional movement, not wallpaper takeover (alpha budget
  // capped well below the machine-grid lines themselves). ---
  vec2 gcid = floor(gm1);
  float gphase = uTime * 0.5 + uBeatCount * 0.8;
  float pagerMask = 1.0 - specimenMask * 0.8;

  // Cell fills: the SELECTION of which cells fill is mode-dependent
  // (uGridMode, rotated on a beat-gated timer by index.ts so the
  // background's behavior visibly changes over the track) — the envelope/
  // tint/vivid pipeline below is shared and untouched by the mode.
  //   0 scatter: hashed per-cell membership, staggered re-roll (original).
  //   1 row cascade: the active row sweeps downward with the beat phase.
  //   2 ring pulse: an expanding beat-driven band from a slow-drifting origin.
  //   3 checker: parity alternates each beat.
  float fillOn;
  if (uGridMode == 1) {
    float nRows = 14.0;
    float activeRow = floor(mod(gphase * 2.0, nRows));
    fillOn = step(abs(mod(gcid.y - activeRow, nRows)), 1.5)
           * step(ttHash21(gcid + floor(gphase) * 3.7), 0.55);
  } else if (uGridMode == 2) {
    vec2 org = vec2(sin(uTime * 0.05), cos(uTime * 0.043)) * 3.0;
    float ringDist = abs(length(gcid + 0.5 - org) - mod(gphase * 3.0, 16.0));
    fillOn = step(ringDist, 1.6) * step(ttHash21(gcid + floor(gphase) * 7.3), 0.7);
  } else if (uGridMode == 3) {
    fillOn = step(mod(gcid.x + gcid.y + floor(gphase), 2.0), 0.5)
           * step(ttHash21(gcid + floor(gphase) * 7.3), 0.6);
  } else {
    fillOn = step(ttHash21(gcid + floor(gphase) * 7.3), 0.14 + 0.25 * uGridLife);
  }
  // Staggered sin envelope so re-rolls never land on every cell at once,
  // mostly a paper-tone tint — a rare vivid cos-palette hue is carried past
  // the grade instead (see vividFill/vividFillCol above), scaled there by
  // uEventVivid.
  float fillEnv = sin(3.14159 * fract(gphase + ttHash21(gcid + 4.4)));
  float fillAlpha = fillOn * max(fillEnv, 0.0) * uGridLife * pagerMask * 0.55;
  float vividH = ttHash21(gcid + 8.8);
  if (vividH > 0.88) {
    vividFillCol = 0.55 + 0.38 * cos(6.2831853 * (ttHash21(gcid + 12.1) + vec3(0.0, 0.33, 0.67)));
    vividFill = fillAlpha * uEventVivid;
  } else {
    float tintH = ttHash21(gcid + 6.6);
    vec3 fillTint = tintH > 0.3 ? GROUND * 0.86 : mix(col, RUST, 0.22);
    col = mix(col, fillTint, fillAlpha);
  }

  // Edge traces: two hashes (one per axis), re-rolling twice as fast as the
  // fill phase, brighten this cell's own grid-line segments — dashes
  // tracing along the grid.
  float traceRoll = floor(gphase * 2.0);
  float traceGateX = step(0.6, ttHash21(gcid + vec2(traceRoll * 3.1, 11.0)));
  float traceGateY = step(0.6, ttHash21(gcid + vec2(traceRoll * 3.1, 17.0)));
  float traceAlpha = (lineMask1.x * traceGateX + lineMask1.y * traceGateY) * uGridLife * pagerMask;
  col = mix(col, RUST * 0.4, clamp(traceAlpha, 0.0, 1.0) * 0.7);

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

  // --- grade (locally suppressed where events glow — see eventGlow) ---
  float gradeK = 1.0 - eventGlow;
  float luma = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(col, vec3(luma), uDesat * gradeK);
  col = mix(col, RUST * (0.35 + 0.65 * luma), uRustMix * (0.4 + 0.6 * uClassified) * gradeK);
  float survM = smoothstep(0.18, 0.55, length((vUv - 0.5) * uCover));
  col = mix(col, mix(col, vec3(luma) * 0.92, 0.85), survM * uSurvivorFocus);

  // --- events draw AFTER the grade: they are the machine's live overlay
  // and the track's color anomalies — drawn pre-grade they were crushed to
  // the same dusty monochrome as everything else (the same reason poke
  // ripples always drew post-grade). ---
  // --- grid line runners: bright heads racing the FULL grid lines, the
  // "lines running through the field" high-onset hit — hot against
  // everything. ---
  for (int i = 0; i < 4; i++) {
    vec4 rn = uRunner[i];
    float rStrength = rn.w;
    if (rStrength <= 0.0) continue;
    float axis = rn.x;
    float rCoord = rn.y;
    float rAge = rn.z;
    float pr = clamp(rAge / 0.5, 0.0, 1.0);
    float runGlow;
    if (axis < 0.5) {
      float lineProx = exp(-pow(abs(gv.y - rCoord) * 60.0, 2.0));
      float hx = mix(-uCover.x * 0.55, uCover.x * 0.55, pr);
      float headWindow = exp(-pow((gv.x - hx) * 9.0, 2.0));
      runGlow = lineProx * headWindow * rStrength;
    } else {
      float lineProx = exp(-pow(abs(gv.x - rCoord) * 60.0, 2.0));
      float hy = mix(-uCover.y * 0.55, uCover.y * 0.55, pr);
      float headWindow = exp(-pow((gv.y - hy) * 9.0, 2.0));
      runGlow = lineProx * headWindow * rStrength;
    }
    col = mix(col, vec3(1.0, 0.93, 0.88), runGlow * 0.65);
    col += RUST * runGlow * 0.3;
  }

  // --- living grid background's vivid cell fill (accumulated pre-grade
  // above, drawn here post-grade so the beat-synced squares that "change
  // colour" don't get crushed to monochrome two blocks earlier). ---
  col = mix(col, vividFillCol, clamp(vividFill, 0.0, 1.0));

  // Beat-pop sparkle: a tiny additive kick echoing the popped specimens'
  // restored colour, drawn post-grade so it isn't crushed back to monochrome.
  col += vividCol * pop * 0.08;

  // --- link-strike events: the machine connects two specimens with a
  // racing line, then strikes the far one out with a scale-pop X — the
  // climax's "connects and collides" hit. A/B are field-uv, CPU-guaranteed
  // non-wrapping (this pair's line math never torus-wraps). ---
  for (int i = 0; i < 3; i++) {
    vec4 la = uLinkA[i];
    float strength = la.w;
    if (strength <= 0.0) continue;
    vec4 lb = uLinkB[i];
    vec2 A = la.xy;
    vec2 B = lb.xy;
    float age = la.z;

    float fade = 1.0 - smoothstep(1.25, 1.55, age);
    if (fade <= 0.0) continue;

    // Cell hues at A and B, same cos-palette formula as commCol — the
    // racing line's color travels from the source specimen's hue to the
    // target's.
    vec2 ccA = commCell((A - 0.5) * uCommFreq, uMachineOrder);
    vec2 ccB = commCell((B - 0.5) * uCommFreq, uMachineOrder);
    float hA = ttHash21(ccA + vec2(3.7, 1.3));
    float hB = ttHash21(ccB + vec2(3.7, 1.3));
    vec3 hueA = 0.55 + 0.38 * cos(6.2831853 * (hA + vec3(0.0, 0.33, 0.67)));
    vec3 hueB = 0.55 + 0.38 * cos(6.2831853 * (hB + vec3(0.0, 0.33, 0.67)));

    float pr = clamp(age / 0.35, 0.0, 1.0);
    vec2 head = mix(A, B, pr);
    float dLine = ttSegDist(field, A, head, 0.0);
    float lineAA = fwidth(dLine) * 1.5 + 0.0008;
    float lineAlpha = (1.0 - smoothstep(0.004, 0.004 + lineAA, dLine)) * strength;
    float headDist = length(field - head);
    float headGlow = smoothstep(0.012, 0.0, headDist) * strength;

    vec2 abVec = B - A;
    float lt = clamp(dot(field - A, abVec) / max(1e-5, dot(abVec, abVec)), 0.0, 1.0);
    vec3 lcol = mix(hueA, hueB, lt);

    col = mix(col, lcol * 1.25, lineAlpha * fade);
    col += lcol * headGlow * fade * 0.5;

    // X strike over B (X phase 0.35-1.1s): dark ink, mix-darken, a quick
    // scale-pop from 1.4x down to 1.0x over the phase's first 0.12s. The X
    // must be UNMISSABLE: a pale halo goes down first so the near-black
    // strokes carry on any background, then (first 0.15s of the phase only)
    // a bright white impact burst, then the X ink itself.
    float xAge = max(age - 0.35, 0.0);
    float xGate = step(0.35, age);
    float distB = length(field - B);

    // Pale halo under the X.
    float haloAlpha = (1.0 - smoothstep(0.0, 0.085, distB)) * xGate * strength * fade;
    col = mix(col, vec3(0.93, 0.9, 0.85), haloAlpha * 0.55);

    // Impact shock: a bright white burst in the X phase's first 0.15s only —
    // a small disc plus one expanding thin ring (the tap-ripple idiom).
    float shockGate = xGate * (1.0 - step(0.15, xAge)) * strength * fade;
    float shockK = clamp(xAge / 0.15, 0.0, 1.0);
    float shockDisc = (1.0 - smoothstep(0.0, 0.02, distB)) * 0.9 * shockGate;
    float shockRingR = mix(0.02, 0.09, shockK);
    float shockRing = exp(-pow((distB - shockRingR) * 70.0, 2.0)) * shockGate;
    col += vec3(1.0, 0.98, 0.95) * (shockDisc + shockRing);

    float xs = mix(1.4, 1.0, smoothstep(0.0, 0.12, xAge));
    vec2 xl = ttRot(-0.7853982) * ((field - B) / xs);
    float xHalf = 0.06;
    float dX = min(ttSegDist(xl, vec2(-xHalf, 0.0), vec2(xHalf, 0.0), 0.0),
                   ttSegDist(xl, vec2(0.0, -xHalf), vec2(0.0, xHalf), 0.0));
    float xAA = fwidth(dX) * 1.5 + 0.001;
    float xAlpha = (1.0 - smoothstep(0.009, 0.009 + xAA, dX)) * xGate * strength * fade;
    col = mix(col, vec3(0.05, 0.03, 0.02), xAlpha);
  }


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
  col *= 1.0 + uEnergy * 0.25 + uFlash * (0.35 + 0.35 * uEventVivid);
  // fx mode 0 (soft-focus): a slight exposure lift + a softened vignette —
  // the blur reads as a gentle overexposed drift, not just wider AA.
  col *= 1.0 + fx0 * 0.12;
  float vig = smoothstep(0.35, 1.05, length(vUv - 0.5));
  col = mix(col, GROUND * 0.55, vig * uVignette * (1.0 - fx0 * 0.5));
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
`}const p=[0,56,128,172,232,316,336.998],f=[{name:"thriving-field",vitalityTarget:.95,churn:.9,presence:.8,lifeRate:.1,wriggle:1,drift:1,scanRate:0,scanDrain:0,misProb:0,classifyPressure:0,waveRate:0,linkRate:0,runnerRate:0,gridLife:.45,fxAmount:.7,aura:0,beatPop:0,eventVivid:0,gridStrength:0,gridFine:0,glyphDensity:.85,chatterRate:1.2,machineFrac:0,classifiedFloor:0,commFreq:6,zoom:1.18,survivorFocus:0,hueSat:1,warmth:.55,rustMix:.05,inkPersist:0,vignette:.3,motes:.15,groundLight:.9},{name:"first-scans",vitalityTarget:.85,churn:.8,presence:.85,lifeRate:.12,wriggle:.8,drift:.8,scanRate:5,scanDrain:.5,misProb:.3,classifyPressure:0,waveRate:0,linkRate:0,runnerRate:0,gridLife:.7,fxAmount:.8,aura:0,beatPop:.25,eventVivid:.3,gridStrength:.18,gridFine:.25,glyphDensity:.8,chatterRate:1,machineFrac:.08,classifiedFloor:.06,commFreq:6,zoom:1.05,survivorFocus:0,hueSat:.92,warmth:.5,rustMix:.15,inkPersist:.5,vignette:.32,motes:.08,groundLight:.9},{name:"accelerating-catalogue",vitalityTarget:.7,churn:.75,presence:.8,lifeRate:.16,wriggle:.7,drift:.6,scanRate:16,scanDrain:.7,misProb:.15,classifyPressure:0,waveRate:0,linkRate:2,runnerRate:4,gridLife:.7,fxAmount:.6,aura:0,beatPop:.4,eventVivid:.5,gridStrength:.42,gridFine:.5,glyphDensity:.7,chatterRate:.9,machineFrac:.3,classifiedFloor:.28,commFreq:6,zoom:.98,survivorFocus:0,hueSat:.8,warmth:.45,rustMix:.35,inkPersist:.8,vignette:.35,motes:.05,groundLight:.9},{name:"last-unclassified",vitalityTarget:.9,churn:.6,presence:.75,lifeRate:.08,wriggle:1,drift:.7,scanRate:1.5,scanDrain:.4,misProb:0,classifyPressure:0,waveRate:0,linkRate:0,runnerRate:0,gridLife:.3,fxAmount:.5,aura:1,beatPop:.3,eventVivid:.4,gridStrength:.1,gridFine:.15,glyphDensity:.9,chatterRate:.7,machineFrac:.35,classifiedFloor:.34,commFreq:6,zoom:2.9,survivorFocus:1,hueSat:.85,warmth:.5,rustMix:.3,inkPersist:.5,vignette:.5,motes:.05,groundLight:.9},{name:"total-classification",vitalityTarget:.25,churn:.5,presence:.9,lifeRate:.3,wriggle:.35,drift:.25,scanRate:34,scanDrain:1,misProb:0,classifyPressure:.35,waveRate:10,linkRate:14,runnerRate:22,gridLife:1,fxAmount:.35,aura:0,beatPop:1,eventVivid:1,gridStrength:1,gridFine:1,glyphDensity:.55,chatterRate:1.4,machineFrac:.9,classifiedFloor:.9,commFreq:6,zoom:.82,survivorFocus:0,hueSat:.4,warmth:.35,rustMix:.55,inkPersist:1,vignette:.42,motes:.02,groundLight:.9},{name:"residue",vitalityTarget:.1,churn:.25,presence:.22,lifeRate:.04,wriggle:.15,drift:.1,scanRate:0,scanDrain:0,misProb:0,classifyPressure:0,waveRate:0,linkRate:0,runnerRate:0,gridLife:.3,fxAmount:.5,aura:0,beatPop:.15,eventVivid:.2,gridStrength:.06,gridFine:0,glyphDensity:.08,chatterRate:.3,machineFrac:1,classifiedFloor:.93,commFreq:6,zoom:1.15,survivorFocus:0,hueSat:.2,warmth:.3,rustMix:.45,inkPersist:.35,vignette:.45,motes:.5,groundLight:1}],k=[[0,.22],[30,.34],[36,.28],[54,.3],[56,.36],[100,.45],[126,.5],[128,.58],[167.8,.68],[168.3,.78],[171,.74],[174,.42],[200,.38],[228,.5],[231.7,.55],[232.2,.96],[246,1],[300,.82],[315.6,.7],[316.4,.18],[330,.08],[336.998,.04]],q={energy:0};function Le(c){const e=Math.min(Math.max(c,0),k[k.length-1][0]);let a=0;for(;a<k.length-2&&e>=k[a+1][0];)a++;const t=k[a],i=k[a+1],s=Math.min(1,Math.max(0,(e-t[0])/Math.max(.001,i[0]-t[0])));return q.energy=t[1]+(i[1]-t[1])*s,q}const b=[[0,0],[128,0],[172,.22],[232,.25],[300,.95],[316,1],[336.998,1]],X={order:0};function Oe(c){const e=Math.min(Math.max(c,0),b[b.length-1][0]);let a=0;for(;a<b.length-2&&e>=b[a+1][0];)a++;const t=b[a],i=b[a+1],s=Math.min(1,Math.max(0,(e-t[0])/Math.max(.001,i[0]-t[0])));return X.order=t[1]+(i[1]-t[1])*s,X}const _e=6;function Ge(c){const e=Math.min(1,Math.max(0,c));return e*e*(3-2*e)}function He(c,e,a){if(a<=0)return c;if(a>=1)return e;const t={...c,name:a<.5?c.name:e.name};for(const i of Object.keys(c)){const s=c[i],o=e[i];typeof s=="number"&&typeof o=="number"&&(t[i]=s+(o-s)*a)}return t}function Ne(c){const e=p[p.length-1],a=Math.min(Math.max(c,0),e-.001);let t=0;for(;t<f.length-1&&a>=p[t+1];)t++;const i=p[t],s=p[t+1]??e,o=Math.min(1,Math.max(0,(a-i)/Math.max(.001,s-i))),r=t<f.length-1,h=s-a,u=r?Ge(1-Math.min(1,h/_e)):0,d=f[t],w=r?f[t+1]:d;return{params:He(d,w,u),actIndex:t,localT:o,blend:u}}const P=90,Be=.25,Ve=.08,Ue=.06,D=.5,ze=.25,We=.06,Ke=.05,Y=.22,I=.35,qe=.18,L=1.2,Xe=1.6,Ye=.75,je=1.2,$e=.5,j=4,Ze=1.2,Je=2,Qe=1,et=4,tt=2,it=.5,O=1.4,at=2.2,st=.42,ot=.12,lt=.012,nt=1.2,_=1.6,rt=.8,ct=1,ht=3,$=.35,dt=1.6,ut=1.6,ft=4,mt=8,pt=2,vt=4,gt=.5,wt=.7,Z=168,J=232,Q=316,ee=330,xt=.6,kt=1,bt=1.5,yt=6,St=.5,te=4,ie=16,ae=8,At=6,se=14,oe=8,Mt=5,Rt=3,le=3,ne=9.5,Ct=40,Tt=8,re=.45,Ft=.015,Et=.22;function Pt(c,e){const a=c*127.1+e*311.7,t=c*269.5+e*183.3,i=Math.sin(a)*43758.5453,s=Math.sin(t)*43758.5453;return[i-Math.floor(i),s-Math.floor(s)]}const[Dt,It]=Pt(0,0),ce={x:.22+.56*Dt,y:.22+.56*It},he=6,de={x:ce.x/he,y:ce.y/he},ue=5e-4,Lt=10,S=1.5,G=.6,Ot=.35,_t=.05,Gt=1;class Ht{renderer;scene;camera;field;quad;material;rand;forceScanAlways=!1;forceMisAlways=!1;forceWaveAlways=!1;forceFlickerAlways=!1;forceSparkAlways=!1;forceLinkAlways=!1;forceRunAlways=!1;forceLifeFast=!1;forceKillAlways=!1;forceAuraAlways=!1;forcePopAlways=!1;pinnedClassified=null;pinnedOrder=null;pinnedGridMode=null;gridMode=0;gridModeTimer=0;gridModePending=!1;gridModePendingElapsed=0;fxMode=0;fxActive=!1;fxAge=0;fxDuration=0;fxTimeToNext=0;pinnedFx=null;full=!0;stampSlotCount=W;stepsPerFrame=z;cover=new A(1,1);pan=new A(0,0);userPanned=!1;bassE=0;midE=0;highE=0;bassOnset=new U({refRate:Be,relMargin:Ve,absFloor:Ue,cooldown:D});highOnset=new U({refRate:ze,relMargin:We,absFloor:Ke,cooldown:Y});scanOnsetCooldown=0;linkOnsetCooldown=0;runnerOnsetCooldown=0;flash=0;beatPulse=0;lifeClock=0;beatCount=0;beatFlash=0;spark=0;sparkSeed=0;sparkDebugTimer=0;scanSlots=[];scanA=[];scanB=[];scanSchedule=new T({maxGapSeconds:P,reactivateDueNow:!0,epsilonFloor:1e-6});scanDebugTimer=0;pendingBurst=0;burstTimer=0;waveActive=!1;waveAge=0;waveCx=.5;waveCy=.5;waveTimeToNext=0;waveDebugTimer=0;rippleSlots=[];rippleValues=[];pokeSlots=[];linkSlots=[];linkA=[];linkB=[];linkSchedule=new T({maxGapSeconds:P,reactivateDueNow:!0,epsilonFloor:1e-6});linkDebugTimer=0;onsetCount=0;runnerSlots=[];runnerValues=[];runnerSchedule=new T({maxGapSeconds:P,reactivateDueNow:!0,epsilonFloor:1e-6});runDebugTimer=0;killSlots=[];killValues=[];killDebugTimer=0;popDebugTimer=0;classified=0;gridSlam=0;flickerEnv=0;breathPhase=0;firstUpdate=!0;lastDt=0;lastSongTime=-1;held=!1;dragDx=0;dragDy=0;velX=0;velY=0;init(e){const{renderer:a,seed:t,quality:i}=e;this.renderer=a,this.rand=ke(t^2999220761);const s=new URLSearchParams(location.search),o=s.get("solo"),r=o==="field"?1:o==="patch"?2:o==="glyphs"?3:o==="machine"?4:0;this.forceScanAlways=s.get("scan")==="always",this.forceMisAlways=s.get("mis")==="always",this.forceWaveAlways=s.get("wave")==="always",this.forceFlickerAlways=s.get("flicker")==="always",this.forceSparkAlways=s.get("spark")==="always",this.forceLinkAlways=s.get("link")==="always",this.forceRunAlways=s.get("run")==="always",this.forceLifeFast=s.get("life")==="fast",this.forceKillAlways=s.get("kill")==="always",this.forcePopAlways=s.get("pop")==="always";const h=s.get("classified");if(h!==null){const l=parseFloat(h);Number.isNaN(l)||(this.pinnedClassified=Math.min(1,Math.max(0,l)))}const u=s.get("order");if(u!==null){const l=parseFloat(u);Number.isNaN(l)||(this.pinnedOrder=Math.min(1,Math.max(0,l)))}const d=s.get("gridmode");if(d!==null){const l=parseInt(d,10);!Number.isNaN(l)&&l>=0&&l<te&&(this.pinnedGridMode=l)}this.forceAuraAlways=s.get("aura")==="always";const w=s.get("fx");if(w!==null){const l=parseInt(w,10);!Number.isNaN(l)&&l>=0&&l<le&&(this.pinnedFx=l)}this.full=i.level==="full",this.stampSlotCount=this.full?W:Ae;const n=this.full?Je:Qe,y=this.full?et:tt;this.stepsPerFrame=this.full?z:Se;for(let l=0;l<this.stampSlotCount;l++)this.scanSlots.push({age:0,active:!1,mislabel:!1}),this.scanA.push(new v(0,0,0,0)),this.scanB.push(new v(0,0,0,0));for(let l=0;l<j;l++)this.rippleSlots.push({age:0,active:!1}),this.rippleValues.push(new v(0,0,0,0));for(let l=0;l<R;l++)this.pokeSlots.push({age:0,active:!1});for(let l=0;l<ht;l++)this.linkSlots.push({age:0,active:!1,struck:!1}),this.linkA.push(new v(0,0,0,0)),this.linkB.push(new v(0,0,0,0));for(let l=0;l<vt;l++)this.runnerSlots.push({age:0,active:!1}),this.runnerValues.push(new v(0,0,0,0));for(let l=0;l<ft;l++)this.killSlots.push({age:0,active:!1}),this.killValues.push(new v(0,0,0,0));this.breathPhase=this.rand()*Math.PI*2,this.pinnedGridMode!==null&&(this.gridMode=this.pinnedGridMode),this.gridModeTimer=ie+this.rand()*ae,this.fxTimeToNext=oe+this.rand()*se,this.scene=new fe,this.camera=new me(-1,1,1,-1,0,1),this.field=new Pe(a,this.full,this.stampSlotCount),this.material=new M({vertexShader:De,fragmentShader:Ie(j,this.stampSlotCount,n,y),depthTest:!1,depthWrite:!1,uniforms:{uField:{value:null},uTime:{value:0},uCover:{value:new A(1,1)},uZoom:{value:1},uPan:{value:this.pan},uCommFreq:{value:6},uEnergy:{value:0},uFlash:{value:0},uSparkle:{value:0},uGlyphKick:{value:0},uGlyphSeed:{value:0},uChurn:{value:0},uChatter:{value:0},uGlyphDensity:{value:0},uMachineFrac:{value:0},uMachineOrder:{value:0},uClassified:{value:0},uGridStrength:{value:0},uGridFine:{value:0},uGridSlam:{value:0},uHueSat:{value:0},uWarmth:{value:0},uRustMix:{value:0},uInkPersist:{value:0},uVignette:{value:0},uMotes:{value:0},uGroundLight:{value:0},uSurvivorFocus:{value:0},uDesat:{value:0},uSoloMode:{value:r},uFlicker:{value:0},uLifeClock:{value:0},uPresence:{value:0},uWriggle:{value:0},uDrift:{value:0},uWaveVis:{value:this.field.wave},uScanA:{value:this.scanA},uScanB:{value:this.scanB},uRipple:{value:this.rippleValues},uEventVivid:{value:0},uLinkA:{value:this.linkA},uLinkB:{value:this.linkB},uRunner:{value:this.runnerValues},uKill:{value:this.killValues},uBeatCount:{value:0},uBeatFlash:{value:0},uBeatPop:{value:0},uGridLife:{value:0},uGridMode:{value:0},uAura:{value:0},uAuraPulse:{value:0},uFxMode:{value:0},uFxAmt:{value:0}}}),this.quad=new ve(new pe(2,2),this.material),this.scene.add(this.quad);const x=a.domElement;this.resize(x.clientWidth||1,x.clientHeight||1)}sst(e){const a=Math.min(1,Math.max(0,e));return a*a*(3-2*a)}kickFlash(e){this.flash=Math.min(Xe,this.flash+e)}kickSpark(){this.spark=Math.min(je,this.spark+Ye),this.sparkSeed++}advanceGridMode(){if(this.pinnedGridMode!==null)return;let e=this.gridMode;for(;e===this.gridMode;)e=Math.floor(this.rand()*te);this.gridMode=e,this.gridModeTimer=ie+this.rand()*ae,this.gridModePending=!1,this.gridModePendingElapsed=0}updateFx(e,a){const t=this.material.uniforms;if(this.pinnedFx!==null){t.uFxMode.value=this.pinnedFx,t.uFxAmt.value=a.fxAmount;return}if(!this.fxActive&&(this.fxTimeToNext-=e,this.fxTimeToNext<=0)){this.fxActive=!0,this.fxAge=0,this.fxDuration=Mt+this.rand()*Rt;let i=this.fxMode;for(;i===this.fxMode;)i=Math.floor(this.rand()*le);this.fxMode=i}if(this.fxActive){this.fxAge+=e;const i=this.sst(Math.min(1,this.fxAge/.9)),s=1-this.sst(Math.max(0,(this.fxAge-(this.fxDuration-1.2))/1.2));t.uFxAmt.value=i*s*a.fxAmount,this.fxAge>=this.fxDuration&&(this.fxActive=!1,this.fxTimeToNext=oe+this.rand()*se)}else t.uFxAmt.value=0;t.uFxMode.value=this.fxMode}startScan(e,a,t){let i=this.scanSlots.findIndex(r=>!r.active);if(i<0){i=0;let r=this.scanSlots[0].age;for(let h=1;h<this.scanSlots.length;h++)this.scanSlots[h].age>r&&(r=this.scanSlots[h].age,i=h)}const s=this.scanSlots[i];s.active=!0,s.age=0;const o=this.forceMisAlways||this.rand()<t.misProb;s.mislabel=o,this.scanA[i].set(e,a,0,1),this.scanB[i].set(st+this.rand()*ot,o?1:0,this.rand(),0)}pickVisiblePoint(e){const a=this.cover,t=this.material.uniforms.uZoom.value;let i=0,s=0;const o=e.survivorFocus>.5;for(let u=0;u<4&&(i=(this.rand()-.5)*.85,s=(this.rand()-.5)*.85,!(!o||Math.hypot(i,s)>.3));u++);const r=.5+this.pan.x+i*a.x/t,h=.5+this.pan.y+s*a.y/t;return{x:r,y:h}}fireScan(e){const{x:a,y:t}=this.pickVisiblePoint(e);this.startScan(a-Math.floor(a),t-Math.floor(t),e)}scheduleScans(e,a,t){this.scanSchedule.update(e,a,this.rand,()=>{this.fireScan(t),this.kickFlash(qe),this.beatCount++,this.beatFlash=1})}ageScans(e,a){for(let t=0;t<this.scanSlots.length;t++){const i=this.scanSlots[t];if(!i.active)continue;const s=i.age;i.age+=e;const o=i.age;if(this.scanA[t].z=o,s<O&&o>=O&&(this.classified+=lt),o>=at)i.active=!1,this.scanA[t].w=0,this.field.stamps[t].w=0;else{const r=this.scanB[t].x,h=o>=it&&o<O;this.field.stamps[t].set(this.scanA[t].x,this.scanA[t].y,r/a.commFreq,h?a.scanDrain:0)}}}fireLink(e){let a=this.linkSlots.findIndex(u=>!u.active);if(a<0){a=0;let u=this.linkSlots[0].age;for(let d=1;d<this.linkSlots.length;d++)this.linkSlots[d].age>u&&(u=this.linkSlots[d].age,a=d)}const t=this.pickVisiblePoint(e);let i=this.pickVisiblePoint(e),s=i.x-t.x,o=i.y-t.y;Math.hypot(s,o)>.35&&(i=this.pickVisiblePoint(e),s=i.x-t.x,o=i.y-t.y);const r=Math.hypot(s,o);if(r>.35){const u=.35/r;i={x:t.x+s*u,y:t.y+o*u}}const h=this.linkSlots[a];h.active=!0,h.struck=!1,h.age=0,this.linkA[a].set(t.x,t.y,0,1),this.linkB[a].set(i.x,i.y,this.rand(),0)}scheduleLinks(e,a,t){this.linkSchedule.update(e,a,this.rand,()=>this.fireLink(t))}ageLinks(e,a){for(let t=0;t<this.linkSlots.length;t++){const i=this.linkSlots[t];if(!i.active)continue;const s=i.age;i.age+=e;const o=i.age;if(this.linkA[t].z=o,!i.struck&&s<$&&o>=$){i.struck=!0;const r=this.linkB[t].x,h=this.linkB[t].y,u=r-Math.floor(r),d=h-Math.floor(h);this.startScan(u,d,a),this.fireKill(u,d),this.kickFlash(I)}o>=dt&&(i.active=!1,this.linkA[t].w=0)}}scriptedMassScan(){this.pendingBurst=this.stampSlotCount,this.burstTimer=0,this.startWave(),this.kickFlash(L)}scriptedDrop(){this.kickFlash(L),this.gridSlam=xt,this.startWave()}startWave(){this.waveCx=this.rand(),this.waveCy=this.rand(),this.waveActive=!0,this.waveAge=0}scheduleWaves(e,a){if(this.waveActive)if(this.waveAge+=e,this.waveAge>=_)this.waveActive=!1,this.field.wave.w=0;else{const i=this.sst(this.waveAge/_);this.field.wave.set(this.waveCx,this.waveCy,i*rt,ct*(1-this.waveAge/_))}const t=Math.max(0,a)/60;if(!(t<=0))for(this.waveTimeToNext-=e;this.waveTimeToNext<=0;){this.startWave();const i=Math.max(1e-6,this.rand());this.waveTimeToNext+=-Math.log(i)/t}}fireRunner(){let e=this.runnerSlots.findIndex(o=>!o.active);if(e<0){e=0;let o=this.runnerSlots[0].age;for(let r=1;r<this.runnerSlots.length;r++)this.runnerSlots[r].age>o&&(o=this.runnerSlots[r].age,e=r)}const a=this.cover,t=this.rand()<.5?0:1,i=t===0?(this.rand()-.5)*a.y:(this.rand()-.5)*a.x,s=this.runnerSlots[e];s.active=!0,s.age=0,this.runnerValues[e].set(t,i,0,1)}ageRunners(e){for(let a=0;a<this.runnerSlots.length;a++){const t=this.runnerSlots[a];t.active&&(t.age+=e,t.age>=gt?(t.active=!1,this.runnerValues[a].w=0):this.runnerValues[a].z=t.age)}}scheduleRunners(e,a){this.runnerSchedule.update(e,a,this.rand,()=>this.fireRunner())}fireKill(e,a){let t=this.killSlots.findIndex(s=>!s.active);if(t<0){t=0;let s=this.killSlots[0].age;for(let o=1;o<this.killSlots.length;o++)this.killSlots[o].age>s&&(s=this.killSlots[o].age,t=o)}const i=this.killSlots[t];i.active=!0,i.age=0,this.killValues[t].set(e,a,0,1)}ageKills(e){for(let a=0;a<this.killSlots.length;a++){const t=this.killSlots[a];t.active&&(t.age+=e,t.age>=mt?(t.active=!1,this.killValues[a].w=0):this.killValues[a].z=t.age)}}activatePoke(e,a){let t=this.pokeSlots.findIndex(s=>!s.active);t<0&&(t=0);const i=this.pokeSlots[t];i.active=!0,i.age=0,this.field.pokes[t].set(e,a,_t,Gt)}updatePokeAges(e){for(let a=0;a<this.pokeSlots.length;a++){const t=this.pokeSlots[a];t.active&&(t.age+=e,t.age>=Ot&&(t.active=!1,this.field.pokes[a].w=0))}}activateRipple(e,a){let t=this.rippleSlots.findIndex(s=>!s.active);t<0&&(t=0);const i=this.rippleSlots[t];i.active=!0,i.age=0,this.rippleValues[t].set(e-Math.floor(e),a-Math.floor(a),0,1)}updateRippleAges(e){for(let a=0;a<this.rippleSlots.length;a++){const t=this.rippleSlots[a];t.active&&(t.age+=e,t.age>=Ze?(t.active=!1,this.rippleValues[a].w=0):this.rippleValues[a].z=t.age)}}warmup(e,a,t){this.field.clearField(),this.field.setActParams(e);const i=this.pinnedClassified??e.classifiedFloor;this.field.seedField(i,e.commFreq,t),this.classified=i;for(let s=0;s<a;s++)this.scheduleScans(F,e.scanRate,e),this.ageScans(F,e),this.field.step(F,1)}update(e,a){const t=Ne(a.time),i=t.actIndex===3||t.actIndex===4?f[t.actIndex]:t.params;this.lastDt=e;const s=this.pinnedOrder??Oe(a.time).order;this.firstUpdate&&(this.firstUpdate=!1,this.warmup(i,Me,s)),this.lastSongTime>=0&&a.time<this.lastSongTime-10&&this.warmup(i,Re,s),this.lastSongTime>=0&&a.time-this.lastSongTime>=0&&a.time-this.lastSongTime<.5&&(this.lastSongTime<Z&&a.time>=Z&&this.scriptedMassScan(),this.lastSongTime<J&&a.time>=J&&this.scriptedDrop(),this.lastSongTime<Q&&a.time>=Q&&this.kickFlash(L),this.lastSongTime<ee&&a.time>=ee&&(this.flickerEnv=1)),this.lastSongTime=a.time;const o=this.bassE,r=this.highE,h=Math.min(1,e*8);if(this.bassE+=(a.bass-this.bassE)*h,this.midE+=(a.mid-this.midE)*h,this.highE+=(a.high-this.highE)*h,this.scanOnsetCooldown-=e,this.linkOnsetCooldown-=e,this.bassOnset.update(e,this.bassE,o)&&(this.scanOnsetCooldown<=0&&i.scanRate>.5&&(this.fireScan(i),this.kickFlash(I),this.scanOnsetCooldown=C(D,i.scanRate)),this.beatCount++,this.beatFlash=1,this.onsetCount++,this.onsetCount%2===0?t.actIndex===4&&!this.waveActive&&this.startWave():this.linkOnsetCooldown<=0&&i.linkRate>.5&&(this.fireLink(i),this.linkOnsetCooldown=C(D,i.linkRate)),this.beatPulse=Math.min(bt,this.beatPulse+kt),this.gridModePending&&this.advanceGridMode()),this.runnerOnsetCooldown-=e,this.highOnset.update(e,this.highE,r)&&(this.kickSpark(),this.runnerOnsetCooldown<=0&&i.runnerRate>.5&&(this.fireRunner(),this.runnerOnsetCooldown=C(Y,i.runnerRate))),this.forceSparkAlways&&(this.sparkDebugTimer-=e,this.sparkDebugTimer<=0&&(this.kickSpark(),this.sparkDebugTimer=$e)),this.spark*=Math.exp(-7*e),this.forceScanAlways&&(this.scanDebugTimer-=e,this.scanDebugTimer<=0&&(this.fireScan(i),this.scanDebugTimer=nt)),this.scheduleScans(e,i.scanRate,i),this.scheduleWaves(e,i.waveRate),this.forceWaveAlways&&(this.waveDebugTimer-=e,this.waveDebugTimer<=0&&(this.startWave(),this.waveDebugTimer=3)),this.scheduleLinks(e,i.linkRate,i),this.ageLinks(e,i),this.forceLinkAlways&&(this.linkDebugTimer-=e,this.linkDebugTimer<=0&&(this.fireLink(i),this.linkDebugTimer=ut)),this.scheduleRunners(e,i.runnerRate),this.ageRunners(e),this.forceRunAlways&&(this.runDebugTimer-=e,this.runDebugTimer<=0&&(this.fireRunner(),this.runDebugTimer=wt)),this.ageKills(e),this.forceKillAlways&&(this.killDebugTimer-=e,this.killDebugTimer<=0)){const{x:l,y:m}=this.pickVisiblePoint(i);this.fireKill(l-Math.floor(l),m-Math.floor(m)),this.killDebugTimer=pt}if(this.forcePopAlways&&(this.popDebugTimer-=e,this.popDebugTimer<=0&&(this.beatFlash=1,this.beatCount++,this.popDebugTimer=St)),this.pendingBurst>0)for(this.burstTimer-=e;this.burstTimer<=0&&this.pendingBurst>0;)this.fireScan(i),this.pendingBurst--,this.burstTimer+=.18;this.pinnedClassified!==null?this.classified=this.pinnedClassified:this.classified=Math.max(this.classified,i.classifiedFloor),this.ageScans(e,i),this.updatePokeAges(e),this.updateRippleAges(e),this.classified=Math.min(1,this.classified),this.pinnedClassified!==null&&(this.classified=this.pinnedClassified),this.flash*=Math.exp(-3.4*e),this.gridSlam*=Math.exp(-2.5*e),this.beatPulse*=Math.exp(-4*e),this.beatFlash*=Math.exp(-2.8*e),this.updateFx(e,i),this.pinnedGridMode===null&&(this.gridModeTimer-=e,this.gridModeTimer<=0&&!this.gridModePending&&(this.gridModePending=!0,this.gridModePendingElapsed=0),this.gridModePending&&(this.gridModePendingElapsed+=e,this.gridModePendingElapsed>=At&&this.advanceGridMode())),this.forceFlickerAlways?this.flickerEnv=1:this.flickerEnv*=Math.exp(-.6*e);const u=this.forceLifeFast?yt:1;this.lifeClock+=e*i.lifeRate*u*(1+this.beatPulse*3),this.field.setVitalityMod(1+this.bassE*.5),this.field.setActParams(i);let d;if(t.actIndex===0){const l=p[1]-p[0],m=t.localT*l,g=this.sst(Math.min(1,m/Ct)),H=ne+(f[0].zoom-ne)*g;d=H+(f[1].zoom-H)*t.blend,this.userPanned||this.pan.set(de.x*(1-g),de.y*(1-g))}else if(t.actIndex===2)d=f[2].zoom;else if(t.actIndex===3){const l=p[4]-p[3],m=t.localT*l,g=this.sst(Math.min(1,m/Tt));d=f[2].zoom+(f[3].zoom-f[2].zoom)*g}else if(t.actIndex===4){const l=p[5]-p[4],m=t.localT*l;m<re?d=f[3].zoom+(f[4].zoom-f[3].zoom)*this.sst(m/re):d=i.zoom}else d=i.zoom;const w=Ft*(1-.7*i.survivorFocus);d*=1+w*Math.sin(a.time*Et+this.breathPhase);const n=this.material.uniforms;n.uTime.value+=e,n.uZoom.value=d,n.uCommFreq.value=i.commFreq,n.uChurn.value=i.churn,n.uChatter.value=i.chatterRate*(1+this.midE*.8),n.uWarmth.value=i.warmth,n.uSparkle.value=this.highE,n.uGlyphKick.value=this.spark,n.uGlyphSeed.value=this.sparkSeed,n.uEnergy.value=Le(a.time).energy,n.uFlash.value=this.flash,n.uClassified.value=this.classified,n.uDesat.value=Math.min(1,this.classified*.6),n.uMachineFrac.value=i.machineFrac,n.uMachineOrder.value=s,n.uGridStrength.value=i.gridStrength,n.uGridFine.value=i.gridFine,n.uGlyphDensity.value=i.glyphDensity,n.uHueSat.value=i.hueSat,n.uRustMix.value=i.rustMix,n.uInkPersist.value=i.inkPersist,n.uVignette.value=i.vignette,n.uMotes.value=i.motes,n.uGroundLight.value=i.groundLight,n.uSurvivorFocus.value=i.survivorFocus,n.uGridSlam.value=this.gridSlam,n.uFlicker.value=this.flickerEnv,n.uLifeClock.value=this.lifeClock,n.uPresence.value=i.presence,n.uWriggle.value=i.wriggle,n.uDrift.value=i.drift,n.uEventVivid.value=i.eventVivid,n.uBeatCount.value=this.beatCount,n.uBeatFlash.value=this.beatFlash,n.uBeatPop.value=i.beatPop,n.uGridLife.value=i.gridLife,n.uGridMode.value=this.pinnedGridMode??this.gridMode,n.uAura.value=this.forceAuraAlways?1:i.aura,n.uAuraPulse.value=this.bassE;const y=this.cover;if(this.held){if(e>1e-5){const l=Math.min(1,e*Lt),m=Math.min(S,Math.max(-S,this.dragDx/e)),g=Math.min(S,Math.max(-S,this.dragDy/e));this.velX+=(m-this.velX)*l,this.velY+=(g-this.velY)*l}this.dragDx=0,this.dragDy=0}else if(this.velX!==0||this.velY!==0){this.pan.x+=this.velX*y.x/d*e,this.pan.y+=this.velY*y.y/d*e;const l=Math.exp(-2.5*e);this.velX*=l,this.velY*=l,Math.abs(this.velX)<ue&&(this.velX=0),Math.abs(this.velY)<ue&&(this.velY=0)}const x=Math.hypot(this.pan.x,this.pan.y);x>G&&(this.pan.x*=G/x,this.pan.y*=G/x,this.velX=0,this.velY=0)}pointer(e){const a=this.material.uniforms.uZoom.value,t=this.cover;if(e.type==="down"){this.held=!0,this.dragDx=0,this.dragDy=0,this.velX=0,this.velY=0;const i=(e.x-.5)*t.x/a+.5+this.pan.x,s=(e.y-.5)*t.y/a+.5+this.pan.y,o=i-Math.floor(i),r=s-Math.floor(s);this.activatePoke(o,r),this.activateRipple(o,r),this.kickFlash(I);return}if(e.type==="move"){if(!this.held)return;this.userPanned=!0,this.pan.x+=e.dx*t.x/a,this.pan.y+=e.dy*t.y/a,this.dragDx+=e.dx,this.dragDy+=e.dy;return}if(e.type==="up"){this.held=!1;return}this.held=!1,this.velX=0,this.velY=0,this.dragDx=0,this.dragDy=0}render(){this.field.step(this.lastDt,this.stepsPerFrame),this.material.uniforms.uField.value=this.field.texture,this.renderer.setRenderTarget(null),this.renderer.render(this.scene,this.camera)}resize(e,a){if(!this.material||e<=0||a<=0)return;const t=Math.min(3.5,Math.max(.28,e/a));t>=1?this.cover.set(t,1):this.cover.set(1,1/t),this.material.uniforms.uCover.value.copy(this.cover)}dispose(){this.field.dispose(),this.material.dispose(),this.quad.geometry.dispose(),this.renderer.setRenderTarget(null)}}const Nt={default:()=>new Ht},Wt=Nt.default;export{Wt as default};
//# sourceMappingURL=index--fBDtOOa.js.map
