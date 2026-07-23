import{a as I,R as A,L as _,b as J,H as Z,V as E,c as T,S as K,O as V,d as X,e as k,M as Y}from"./three-vlqji54k.js";import{m as Q}from"./random-DL1jLgMw.js";const $=1024,j=512,D=256,C=6,ee=4,P=3,te=2,ie=300,ae=60,R=1/30,G=`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`,se=`
precision highp float;
void main() { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); }
`;function re(n){return`
precision highp float;
varying vec2 vUv;
uniform sampler2D uPrev;
uniform vec2 uTexel;
uniform float uDt;
uniform float uDiff;   // activation diffusion (wave speed/spread)
uniform float uEps;    // reaction timescale (front sharpness / excitation speed)
uniform float uA;      // excitation threshold slope (higher = easier to excite)
uniform float uB;      // excitation threshold offset (higher = harder to excite)
uniform float uVRate;  // recovery/refractory rate (higher = recharge sooner)
uniform float uDrive;  // global drive toward firing (synchrony act only)
uniform float uRewireRate; // lattice-rewire phase speed (1/s); 0 = frozen lattice
uniform vec4 uSeeds[${n}]; // xy pos, z radius (uv), w strength (0 = inactive)
uniform vec4 uSuppress; // xy centre, z radius, w strength (collapse de-activation ring)

// Activation level a cell must cross UPWARD to count as "fired" (and re-wire
// the display lattice). Well above the Barkley rest threshold ((v+uB)/uA ~
// 0.03-0.07) so a gaussian ignition SKIRT that lifts a marginal/refractory
// texel a little then decays does not count; well below the ~1.0 excited
// plateau, and u rises monotonically through it, so a real firing crosses
// exactly once regardless of substep count.
const float FIRE_T = 0.6;

void main() {
  vec4 c = texture2D(uPrev, vUv);
  float prevU = c.r;
  float u = c.r;
  float v = c.g;
  // .b = integer rewire GENERATION counter, .a = 0..1 transition PHASE — see
  // the firing-edge block below and latticeShader.ts's anchor+jump offsets.
  float genB = c.b;
  float phaseA = c.a;
  // uTexel is the FIXED virtual sim-grid spacing (1/SIM_GRID), not the
  // storage texel size — see SIM_GRID's doc.
  vec2 tx = uTexel;

  // 5-tap laplacian of u (activation diffuses; recovery does not).
  float lap =
      texture2D(uPrev, vUv + vec2(tx.x, 0.0)).r
    + texture2D(uPrev, vUv - vec2(tx.x, 0.0)).r
    + texture2D(uPrev, vUv + vec2(0.0, tx.y)).r
    + texture2D(uPrev, vUv - vec2(0.0, tx.y)).r
    - 4.0 * u;

  float thresh = (v + uB) / uA;
  float du = uEps * u * (1.0 - u) * (u - thresh) + uDiff * lap + uDrive;
  float dv = (u - v) * uVRate;
  u += du * uDt;
  v += dv * uDt;

  // Ignition: gaussian dabs of u where seeds are active — a new chain leaps.
  // Deliberately NOT dt-scaled (exception to the b1 per-tick-rate rule): u
  // clamps to 1.0 below, so extra ticks inside the seed window saturate
  // instead of accumulating — warmup, Lite and Full all land on the same
  // fired cell.
  for (int i = 0; i < ${n}; i++) {
    vec4 s = uSeeds[i];
    if (s.w > 0.0) {
      vec2 d = vUv - s.xy;
      float g = exp(-dot(d, d) / (s.z * s.z));
      u += s.w * g;
    }
  }

  // Collapse de-activation ring: force u (and, more gently, v) toward 0
  // inside a growing radius so the field darkens cell-by-cell.
  if (uSuppress.w > 0.0) {
    float d = distance(vUv, uSuppress.xy);
    float inside = 1.0 - smoothstep(uSuppress.z * 0.85, uSuppress.z, d);
    float k = inside * uSuppress.w;
    u *= (1.0 - k);
    v *= (1.0 - 0.5 * k);
  }

  u = clamp(u, 0.0, 1.0);
  v = clamp(v, 0.0, 2.0);

  // Lattice rewiring state. A cell "fires" on the upward crossing of FIRE_T,
  // but ONLY once its previous slide has settled (phaseA >= 0.999) — that gate
  // caps one pending transition per cell, so a rapid re-fire mid-slide can
  // never pop the display nucleus. On firing: bump the generation counter and
  // restart the phase; otherwise ease the phase toward settled (dt-scaled, so
  // warmup / Lite / Full advance the same rewire per wall-second). Suppression
  // only lowers u, so collapse dead zones never fire and freeze for free.
  if (prevU < FIRE_T && u >= FIRE_T && phaseA >= 0.999) {
    genB += 1.0;
    phaseA = 0.0;
  } else {
    phaseA = min(1.0, phaseA + uRewireRate * uDt);
  }
  gl_FragColor = vec4(u, v, genB, phaseA);
}
`}class oe{uniforms;seeds;suppress;renderer;texSize;targets;readIndex=0;scene;camera;quad;simMaterial;initMaterial;params=null;diffMod=1;rewireMod=1;constructor(e,t,i){this.renderer=e,this.texSize=t?$:j;const a={type:Z,format:J,minFilter:_,magFilter:_,wrapS:A,wrapT:A,depthBuffer:!1,stencilBuffer:!1};this.targets=[new I(this.texSize,this.texSize,a),new I(this.texSize,this.texSize,a)],this.seeds=[];for(let r=0;r<i;r++)this.seeds.push(new E(0,0,.03,0));this.suppress=new E(.5,.5,0,0),this.uniforms={uPrev:{value:null},uTexel:{value:new T(1/D,1/D)},uDt:{value:0},uDiff:{value:.12},uEps:{value:10},uA:{value:.7},uB:{value:.02},uVRate:{value:1.6},uDrive:{value:0},uRewireRate:{value:0},uSeeds:{value:this.seeds},uSuppress:{value:this.suppress}},this.scene=new K,this.camera=new V(-1,1,1,-1,0,1);const s=new X(2,2);this.simMaterial=new k({vertexShader:G,fragmentShader:re(i),uniforms:this.uniforms,depthTest:!1,depthWrite:!1}),this.initMaterial=new k({vertexShader:G,fragmentShader:se,depthTest:!1,depthWrite:!1}),this.quad=new Y(s,this.initMaterial),this.scene.add(this.quad),this.clearField(),this.quad.material=this.simMaterial}setActParams(e){this.params=e}setDiffMod(e){this.diffMod=e}setRewireMod(e){this.rewireMod=e}applyParams(e){this.uniforms.uDiff.value=e.diff*this.diffMod,this.uniforms.uEps.value=e.eps,this.uniforms.uA.value=e.exA,this.uniforms.uB.value=e.exB,this.uniforms.uVRate.value=e.vRate,this.uniforms.uDrive.value=e.drive,this.uniforms.uRewireRate.value=e.rewireRate*this.rewireMod}step(e,t){const i=this.params;if(!i||t<=0)return;this.applyParams(i),this.uniforms.uDt.value=e/t;const a=this.renderer.getRenderTarget();for(let s=0;s<t;s++){const r=this.targets[this.readIndex],l=this.targets[1-this.readIndex];this.uniforms.uPrev.value=r.texture,this.renderer.setRenderTarget(l),this.renderer.render(this.scene,this.camera),this.readIndex=1-this.readIndex}this.renderer.setRenderTarget(a??null)}clearField(){const e=this.renderer.getRenderTarget(),t=this.quad.material;this.quad.material=this.initMaterial;for(const i of this.targets)this.renderer.setRenderTarget(i),this.renderer.render(this.scene,this.camera);this.renderer.setRenderTarget(e??null),this.quad.material=t}get texture(){return this.targets[this.readIndex].texture}dispose(){this.targets[0].dispose(),this.targets[1].dispose(),this.simMaterial.dispose(),this.initMaterial.dispose(),this.quad.geometry.dispose()}}const ne=`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;function le(n,e=2){const t=Math.max(1,Math.floor(e)),i=2*t+1,a=i*i;return`
precision highp float;
varying vec2 vUv;

uniform sampler2D uField;
uniform vec2 uCover;
uniform vec2 uPan;
uniform float uZoom;
uniform float uCellFreq;
uniform float uFieldSize;   // storage texels per side of the field target (for texel-snapped .ba reads)
uniform float uRewireJump;  // 0..1 nucleus travel amplitude (lattice rewiring)
uniform float uRewireCrack; // 0..1 edge break/crack-shimmer intensity
uniform float uTime;
uniform float uFlash;     // full-scene event flash (0..~1.6, slow channel)
uniform float uSparkle;   // smoothed high-band shimmer (0..1)
uniform float uSparkKick; // high-ONSET fast kick+decay channel (a2 tempo-separation idiom)
uniform float uSparkSeed; // per-spark-event counter — re-rolls WHICH cells flash each event
uniform vec4 uRipple[${n}]; // tap ripples: xy field pos, z age (s), w strength (0 = inactive)
uniform vec4 uRing;       // collapse de-activation ring: xy centre (field uv), z radius, w strength — shared BY REFERENCE with the sim's uSuppress
uniform float uEnergy;   // arcAt continuous energy envelope (0..1)
uniform float uBloomGain;
uniform float uSat;
uniform float uFrontGain;
uniform float uRefractGlow;
uniform float uFilament;
uniform float uMicroTex;
uniform float uWarmth;
uniform float uDust;
uniform int uSoloMode;

const vec3 SUBSTRATE = vec3(0.055, 0.028, 0.13);   // deep indigo
const vec3 SUBSTRATE_HOT = vec3(0.10, 0.030, 0.085); // bruised maroon (strain lean)
const vec3 BLOOM     = vec3(0.55, 1.0, 0.12);      // electric chartreuse (life)
const vec3 FRONT     = vec3(0.16, 0.94, 0.86);     // hot cyan leading edge
const vec3 REFRACT   = vec3(0.70, 0.28, 0.95);     // magenta-violet afterglow
const vec3 WARM      = vec3(1.0, 0.26, 0.52);       // hot-pink warmth accent

float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec2 hash22(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
             mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * vnoise(p); p *= 2.0; a *= 0.5; }
  return s;
}

// Lattice rewiring: a cell's feature point (nucleus) = a static organic ANCHOR
// plus an activation-driven JUMP. The sim (excitableField.ts) writes a per-cell
// generation counter (.b) and transition phase (.a) each time a wave fires the
// cell; here the nucleus slides from the previous generation's target to the
// current one's over the phase, so walls flex and adjacencies change while the
// cell is refractory ("the fallen domino is rebuilt in a new orientation").
// jump=0 -> nucleus stays at the anchor for every generation -> frozen AND
// organic (matches the shipped lattice).
const float RW_MAXJUMP = 0.30;
const vec2 RW_KEY = vec2(13.73, 7.51);

// Returns the cell's current feature offset (within-cell, confined to
// [0.12,0.88] so the ${i}x${i} search stays exact) and its transition phase.
vec2 cellOffset(vec2 cc, out float phase) {
  vec2 anchor = vec2(0.12) + 0.76 * hash22(cc);
  // Read rewire state at the cell's STATIC home centre (never the moving
  // nucleus - that would be circular), snapped to the storage-texel centre so
  // LINEAR filtering can't bilinearly blend the integer generation counter
  // across a wave seam (which would flicker / replay the slide backward).
  vec2 home = (cc + 0.5) / uCellFreq + 0.5;
  vec2 snapped = (floor(home * uFieldSize) + 0.5) / uFieldSize;
  vec2 ba = texture2D(uField, snapped).ba;
  float gen = floor(ba.x + 0.5);
  phase = smoothstep(0.0, 1.0, ba.y);
  float jumpR = uRewireJump * RW_MAXJUMP;
  // Per-generation target: anchor + a hashed unit-vector step, clamped in-window
  // (the clamp is what guarantees the search stays exact at any jump amplitude).
  // mod(gen, 64) keeps the hash argument small (float32 sin precision).
  float ang0 = hash21(cc + mod(gen - 1.0, 64.0) * RW_KEY) * 6.2831853;
  float ang1 = hash21(cc + mod(gen, 64.0) * RW_KEY) * 6.2831853;
  vec2 t0 = clamp(anchor + jumpR * vec2(cos(ang0), sin(ang0)), vec2(0.12), vec2(0.88));
  vec2 t1 = clamp(anchor + jumpR * vec2(cos(ang1), sin(ang1)), vec2(0.12), vec2(0.88));
  return mix(t0, t1, phase);
}

// iq Voronoi with edge distance (2007), over a single n-centred ${i}x${i} window
// (offsets precomputed once into offs[] so both the nearest-search and the
// edge-distance pass read the same rewired feature points). Also returns the
// winning cell's transition phase for the break-and-reform rendering.
void voronoi(vec2 p, out vec2 cellCoord, out vec2 cellPoint, out float edgeDist, out float winPhase) {
  vec2 n = floor(p);
  vec2 f = fract(p);
  vec2 offs[${a}];
  vec2 mg = vec2(0.0);
  vec2 mr = vec2(0.0);
  vec2 winOff = vec2(0.5);
  float md = 8.0;
  float winPh = 1.0;
  for (int j = -${t}; j <= ${t}; j++) {
    for (int i = -${t}; i <= ${t}; i++) {
      vec2 g = vec2(float(i), float(j));
      float ph;
      vec2 o = cellOffset(n + g, ph);
      offs[(i + ${t}) + (j + ${t}) * ${i}] = o;
      vec2 r = g + o - f;
      float d = dot(r, r);
      if (d < md) { md = d; mr = r; mg = g; winOff = o; winPh = ph; }
    }
  }
  float mdEdge = 8.0;
  for (int j = -${t}; j <= ${t}; j++) {
    for (int i = -${t}; i <= ${t}; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 o = offs[(i + ${t}) + (j + ${t}) * ${i}];
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
  winPhase = winPh;
}

void main() {
  // Screen uv -> field uv (house formula, shared with the pointer inverse).
  vec2 field = (vUv - 0.5) * uCover / uZoom + 0.5 + uPan;
  // Centre-anchored Voronoi scaling: when uCellFreq animates (the synchrony
  // pull-back lerps 10 -> 17), the pattern must recede from the VIEW CENTRE,
  // not slide diagonally away from the field's (0,0) corner.
  vec2 p = (field - 0.5) * uCellFreq;

  vec2 cellCoord, cellPoint;
  float edgeDist;
  float winPhase;
  voronoi(p, cellCoord, cellPoint, edgeDist, winPhase);
  // Peaks mid-slide (0 when settled): drives the visible break-and-reform.
  float rearr = winPhase * (1.0 - winPhase) * 4.0;

  // Sample the excitable field at the CELL's feature point (whole cell shares
  // one activation value -> the domino read) and at the FRAGMENT (continuous,
  // for filament continuity across a shared border between two firing cells).
  // Invert the centre-anchored scaling above; RepeatWrapping handles out-of-[0,1].
  vec2 cellUv = cellPoint / uCellFreq + 0.5;
  vec4 cellF = texture2D(uField, cellUv);
  vec4 fragF = texture2D(uField, field);
  float u = cellF.r;          // cell activation
  float v = cellF.g;          // cell recovery (refractory)
  float fragU = fragF.r;      // fragment activation (border blend)

  if (uSoloMode == 1) {
    // Raw field heat for sim debugging: u->red/orange, v->green.
    gl_FragColor = vec4(fragF.r, fragF.g * 0.7, fragF.r * 0.3, 1.0);
    return;
  }
  if (uSoloMode == 2) {
    // Rewire debug: generation counter (.b) as a cycling hue, phase (.a) green.
    float g = texture2D(uField, cellUv).b;
    vec3 gcol = 0.5 + 0.5 * cos(6.2831853 * (g * 0.16 + vec3(0.0, 0.33, 0.67)));
    gl_FragColor = vec4(gcol * (0.4 + 0.6 * winPhase), 1.0);
    return;
  }

  float cellRand = hash21(cellCoord + 3.17);

  // --- cell fill ---
  // Substrate leans from cool indigo toward bruised maroon as warmth rises
  // (strain must read HOT, not bleached).
  vec3 base = mix(SUBSTRATE, SUBSTRATE_HOT, uWarmth * 0.6);
  vec3 col = base;
  // Faint idle breathing so dormant cells aren't dead-flat.
  col += base * 0.5 * (0.4 + 0.6 * vnoise(cellCoord * 1.3 + uTime * 0.05));

  // Micro-biome interior texture: fbm keyed to the cell, modulating the bloom.
  float interior = fbm(cellCoord * 2.0 + p * 0.6 + cellRand * 10.0);
  float micro = mix(1.0, 0.55 + 0.9 * interior, uMicroTex);

  // Activation colour: chartreuse life-bloom in the body, shifting to hot cyan
  // ONLY at the fresh front. The excited plateau holds u~1 for the whole
  // active window, so keying the cyan on high-u alone turns every fired cell
  // pale cyan-white. Instead key it on the FRONT — high u AND recovery v not
  // yet risen (v climbs within a fraction of a second of firing) — so an
  // established excited cell reads as saturated lime and only the just-arrived
  // wavefront is cyan. Built as a hue MIX, not two bright colours summed, so a
  // fully excited cell never washes to white (the b1 lesson).
  float bloom = smoothstep(0.1, 0.72, u);
  float front = smoothstep(0.5, 0.85, u) * (1.0 - smoothstep(0.12, 0.4, v));
  vec3 hot = mix(BLOOM, FRONT, front * 0.85 * uFrontGain);
  // Warmth is a true HUE rotation of the excited body toward hot pink — the
  // old additive pink accent whitened through the tone-map and strain read
  // bleached instead of hot.
  hot = mix(hot, WARM, uWarmth * 0.55);
  col += hot * uBloomGain * bloom * micro;

  // A small near-white kiss at the very leading edge (kept subtle — it is
  // the main whitening pressure on excited cells).
  col += vec3(0.85, 1.0, 0.92) * uFrontGain * front * 0.3;

  // Magenta-violet refractory afterglow: v high while u has decayed away.
  // Loose threshold (1.1, was 1.3) — the recharge state is half the domino
  // concept ("standing back up") and deserves screen time.
  float refractory = clamp(v - u * 1.1, 0.0, 1.0);
  col += REFRACT * uRefractGlow * refractory;

  // --- break apart: open a black seam along a rewiring cell's borders (widest
  // mid-slide), knitting closed as it settles. The nucleus is already sliding
  // (cellPoint moved) so the tessellation is genuinely reorganizing; this makes
  // the fracture legible. Zero when the lattice is frozen (rearr = 0).
  float gapW = rearr * uRewireCrack * 0.03;
  col *= smoothstep(gapW, gapW + 0.008, edgeDist);

  // --- edge filaments (the "chain links") ---
  // A thin bright line along cell borders, brightened where the border is
  // active (fragU high) so links between firing cells read as connections.
  // Low resting base so the idle lattice stays indigo and active chains pop.
  float line = smoothstep(0.055, 0.0, edgeDist);
  float linkGlow = 0.08 + 1.7 * fragU;
  // High-onset spark events lift the filament web for a beat — kept modest
  // (the a2 strobe trap: a fast channel must not slam everything it touches;
  // the per-cell constellation below carries the event's identity).
  linkGlow += uSparkKick * 0.5;
  vec3 filColor = mix(FRONT, vec3(0.9, 1.0, 0.95), front);
  col += filColor * uFilament * line * linkGlow;

  // Crack-shimmer: a hot hairline tracing the reforming boundary of a fracturing
  // cell (a bit wider than the filament line so it reads as the fresh fracture,
  // not the settled wall). Peaks mid-slide with rearr; zero when frozen.
  col += FRONT * rearr * uRewireCrack * smoothstep(0.05, 0.0, edgeDist);

  // --- sparkle: smoothed high-band twinkle on active cell interiors ---
  float tw = hash21(cellCoord * 7.3 + floor(uTime * 12.0));
  col += BLOOM * uSparkle * bloom * step(0.85, tw) * 0.8;

  // --- high-ONSET spark events: the fast channel. Each event re-rolls which
  // cells flash (hash keyed by the per-event counter — the a2 idiom), so
  // consecutive hi-hat hits light different constellations.
  float twk = hash21(cellCoord * 5.1 + uSparkSeed * 17.0);
  col += vec3(0.85, 1.0, 0.95) * uSparkKick * step(0.78, twk) * (0.3 + 0.7 * bloom);

  // --- atmospheric dust haze (very cheap; drifts) ---
  float haze = fbm(field * 3.5 + uTime * 0.03);
  col += vec3(0.10, 0.06, 0.18) * uDust * (haze - 0.4);
  // Sparse bright motes.
  float mote = hash21(floor(field * 60.0) + floor(uTime * 0.7));
  col += vec3(0.5, 0.7, 0.9) * uDust * 0.6 * bloom * step(0.995, mote);

  // --- tap ripple rings: near-WHITE so they read on dark AND refractory-
  // dense acts (the BRIEFING interaction rule) — a refractory cell can't
  // re-fire, so without this a tap on recently-active tissue is invisible.
  // Distance is torus-wrapped (d -= floor(d + 0.5)) per the BRIEFING poke
  // rule, since the view spans wrapped copies of the field tile.
  for (int i = 0; i < ${n}; i++) {
    vec4 rp = uRipple[i];
    if (rp.w <= 0.0) continue;
    vec2 rd = field - rp.xy;
    rd -= floor(rd + 0.5);
    float d = length(rd);
    float r = 0.02 + rp.z * 0.30;
    float ring = exp(-pow((d - r) * 70.0, 2.0)) * rp.w * exp(-rp.z * 2.8);
    col += vec3(0.92, 0.97, 1.0) * ring;
  }

  // --- collapse death-front rim: a thin hot edge on the advancing
  // de-activation ring, so the sweep itself is a visible object crossing the
  // web (the killed darkness alone reads as "already off"). Torus-wrapped
  // like the ripples; fades naturally once the radius outgrows the tile.
  if (uRing.w > 0.0) {
    vec2 rgd = field - uRing.xy;
    rgd -= floor(rgd + 0.5);
    float rgDist = length(rgd);
    // Thin and restrained: a hot hairline where cells are dying, not a neon
    // ring (the first pass at 42.0/0.85 dominated the whole frame).
    float rim = exp(-pow((rgDist - uRing.z) * 110.0, 2.0)) * uRing.w;
    col += WARM * rim * 0.38;
    col += vec3(0.95, 0.9, 1.0) * rim * 0.07;
  }

  // --- global lifts ---
  col *= (0.85 + 0.5 * uEnergy);         // energy envelope brightens the whole field
  col += col * uFlash * 0.7;             // full-scene event flash

  // Saturation control (toward luminance).
  float luma = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(luma), col, uSat);

  // Hue-preserving exposure tone-map (the b1 "additive washes to white"
  // lesson): summed bloom + front + filament would clip a fully excited cell
  // to pure white; 1 - exp(-col) compresses toward 1 per-channel WITHOUT
  // collapsing the hue, so the excited core stays hot lime instead of blowing
  // out. Darks (col << 1) are essentially unchanged.
  col = vec3(1.0) - exp(-col * 1.15);

  // Soft vignette to seat the lattice in the dark.
  float vig = smoothstep(1.25, 0.35, length(vUv - 0.5));
  col *= mix(0.72, 1.0, vig);

  gl_FragColor = vec4(col, 1.0);
}
`}const d=[0,34,78,120,152,188,204,244,259.835],u=[{name:"seed",ignitionRate:14,diff:.35,eps:11,exA:.7,exB:.02,vRate:1,drive:0,cellFreq:8,zoom:1.35,bloomGain:.55,sat:.7,frontGain:.5,refractGlow:.4,filament:.35,microTex:.2,warmth:.05,suppress:0,dust:.25,rewireRate:0,rewireJump:0,rewireCrack:0},{name:"first-chains",ignitionRate:80,diff:.45,eps:12,exA:.8,exB:.02,vRate:1.1,drive:0,cellFreq:9,zoom:1.2,bloomGain:.75,sat:.82,frontGain:.7,refractGlow:.5,filament:.55,microTex:.35,warmth:.1,suppress:0,dust:.3,rewireRate:.6,rewireJump:.25,rewireCrack:.1},{name:"wiring-up",ignitionRate:110,diff:.65,eps:13,exA:.88,exB:.02,vRate:1.2,drive:0,cellFreq:10,zoom:1.08,bloomGain:.9,sat:.9,frontGain:.85,refractGlow:.6,filament:.7,microTex:.5,warmth:.2,suppress:0,dust:.3,rewireRate:1,rewireJump:.45,rewireCrack:.3},{name:"synchrony",ignitionRate:70,diff:.7,eps:15,exA:.9,exB:.02,vRate:1.3,drive:.006,cellFreq:17,zoom:.72,bloomGain:1,sat:1,frontGain:1,refractGlow:.7,filament:.95,microTex:.6,warmth:.3,suppress:0,dust:.35,rewireRate:1.5,rewireJump:.8,rewireCrack:.7},{name:"strain",ignitionRate:95,diff:.6,eps:14,exA:.86,exB:.03,vRate:1.2,drive:0,cellFreq:15,zoom:.85,bloomGain:.85,sat:.88,frontGain:.8,refractGlow:.75,filament:.75,microTex:.45,warmth:.6,suppress:0,dust:.4,rewireRate:1.4,rewireJump:.75,rewireCrack:.85},{name:"fraying",ignitionRate:70,diff:.45,eps:12,exA:.78,exB:.05,vRate:1.1,drive:0,cellFreq:14,zoom:.92,bloomGain:.65,sat:.78,frontGain:.6,refractGlow:.65,filament:.5,microTex:.35,warmth:.55,suppress:0,dust:.45,rewireRate:.8,rewireJump:.5,rewireCrack:.4},{name:"collapse",ignitionRate:55,diff:.5,eps:13,exA:.82,exB:.02,vRate:1.3,drive:0,cellFreq:12,zoom:1,bloomGain:.85,sat:.8,frontGain:.7,refractGlow:.65,filament:.55,microTex:.4,warmth:.5,suppress:1,dust:.4,rewireRate:0,rewireJump:0,rewireCrack:0},{name:"cold-lattice",ignitionRate:5,diff:.3,eps:10,exA:.66,exB:.04,vRate:1,drive:0,cellFreq:9,zoom:1.3,bloomGain:.45,sat:.55,frontGain:.45,refractGlow:.45,filament:.3,microTex:.15,warmth:.15,suppress:0,dust:.25,rewireRate:0,rewireJump:0,rewireCrack:0}],v=[[0,.1],[30,.18],[33.8,.2],[34.3,.46],[76,.52],[78,.5],[116,.8],[119.8,.84],[120.3,.98],[138,1],[152,.9],[188,.74],[203.6,.66],[204.3,.26],[230,.14],[244,.1],[259.835,.02]],O={energy:0};function he(n){const e=Math.min(Math.max(n,0),v[v.length-1][0]);let t=0;for(;t<v.length-2&&e>=v[t+1][0];)t++;const i=v[t],a=v[t+1],s=Math.min(1,Math.max(0,(e-i[0])/Math.max(.001,a[0]-i[0])));return O.energy=i[1]+(a[1]-i[1])*s,O}const ce=6;function ue(n){const e=Math.min(1,Math.max(0,n));return e*e*(3-2*e)}function fe(n,e,t){if(t<=0)return n;if(t>=1)return e;const i={...n,name:t<.5?n.name:e.name};for(const a of Object.keys(n)){const s=n[a],r=e[a];typeof s=="number"&&typeof r=="number"&&(i[a]=s+(r-s)*t)}return i}function de(n){const e=d[d.length-1],t=Math.min(Math.max(n,0),e-.001);let i=0;for(;i<u.length-1&&t>=d[i+1];)i++;const a=d[i],s=d[i+1]??e,r=Math.min(1,Math.max(0,(t-a)/Math.max(.001,s-a))),l=i<u.length-1,o=s-t,c=l?ue(1-Math.min(1,o/ce)):0,m=u[i],h=l?u[i+1]:m;return{params:fe(m,h,c),actIndex:i,localT:r,blend:c}}const me=.12,pe=.5,y=.35,ve=.18,N=1.2,ge=1.6,we=.5,xe=.12,w=.028,x=.9,Se=1,Te=.045,L=120,z=4,Re=1.2,ye=.09,be=.22,Ee=.75,ke=1.2,Fe=.5,U=248,Me=9,B=1.1,Ie=1.46,Ae=.02,_e=.26,f=u.findIndex(n=>n.name==="synchrony"),q=5e-4,De=10,S=1.5,b=.6,W=d[3],H=d[6],Ce=u.findIndex(n=>n.name==="collapse"),Pe=1.6;class Ge{renderer;scene;camera;field;quad;material;rand;forceIgniteAlways=!1;full=!0;igniteSlotCount=C;stepsPerFrame=P;cover=new T(1,1);pan=new T(0,0);bassE=0;midE=0;highE=0;bassSlowE=0;highSlowE=0;onsetCooldown=0;highOnsetCooldown=0;flash=0;spark=0;sparkSeed=0;forceSparkAlways=!1;forceRewireFast=!1;sparkDebugTimer=0;igniteTimeToNext=0;igniteSlots=[];rippleSlots=[];rippleValues=[];breathPhase=0;collapseCx=.5;collapseCy=.5;firstUpdate=!0;lastDt=0;lastSongTime=-1;held=!1;dragDx=0;dragDy=0;velX=0;velY=0;init(e){const{renderer:t,seed:i,quality:a}=e;this.renderer=t,this.rand=Q(i^2748366359);const s=new URLSearchParams(location.search),r=s.get("solo"),l=r==="field"?1:r==="rewire"?2:0;this.forceIgniteAlways=s.get("ignite")==="always",this.forceSparkAlways=s.get("spark")==="always",this.forceRewireFast=s.get("rewire")==="fast",this.full=a.level==="full",this.igniteSlotCount=this.full?C:ee,this.stepsPerFrame=this.full?P:te;for(let c=0;c<this.igniteSlotCount;c++)this.igniteSlots.push({age:0,active:!1});for(let c=0;c<z;c++)this.rippleSlots.push({age:0,active:!1}),this.rippleValues.push(new E(0,0,0,0));this.collapseCx=.4+this.rand()*.2,this.collapseCy=.4+this.rand()*.2,this.breathPhase=this.rand()*Math.PI*2,this.scene=new K,this.camera=new V(-1,1,1,-1,0,1),this.field=new oe(t,this.full,this.igniteSlotCount),this.material=new k({vertexShader:ne,fragmentShader:le(z),depthTest:!1,depthWrite:!1,uniforms:{uField:{value:null},uCover:{value:new T(1,1)},uPan:{value:this.pan},uZoom:{value:1},uCellFreq:{value:9},uFieldSize:{value:this.full?$:j},uRewireJump:{value:0},uRewireCrack:{value:0},uTime:{value:0},uFlash:{value:0},uSparkle:{value:0},uSparkKick:{value:0},uSparkSeed:{value:0},uRipple:{value:this.rippleValues},uRing:{value:this.field.suppress},uEnergy:{value:0},uBloomGain:{value:.6},uSat:{value:.8},uFrontGain:{value:.6},uRefractGlow:{value:.3},uFilament:{value:.4},uMicroTex:{value:.3},uWarmth:{value:0},uDust:{value:.3},uSoloMode:{value:l}}}),this.quad=new Y(new X(2,2),this.material),this.scene.add(this.quad);const o=t.domElement;this.resize(o.clientWidth||1,o.clientHeight||1)}kickFlash(e){this.flash=Math.min(ge,this.flash+e)}ignite(e,t,i,a){let s=this.igniteSlots.findIndex(c=>!c.active);s<0&&(s=0);const r=this.igniteSlots[s];r.active=!0,r.age=0;const l=e-Math.floor(e),o=t-Math.floor(t);this.field.seeds[s].set(l,o,i,a)}updateIgniteAges(e){for(let t=0;t<this.igniteSlots.length;t++){const i=this.igniteSlots[t];i.active&&(i.age+=e,i.age>=xe&&(i.active=!1,this.field.seeds[t].w=0))}}activateRipple(e,t){let i=this.rippleSlots.findIndex(s=>!s.active);i<0&&(i=0);const a=this.rippleSlots[i];a.active=!0,a.age=0,this.rippleValues[i].set(e-Math.floor(e),t-Math.floor(t),0,1)}updateRippleAges(e){for(let t=0;t<this.rippleSlots.length;t++){const i=this.rippleSlots[t];i.active&&(i.age+=e,i.age>=Re?(i.active=!1,this.rippleValues[t].w=0):this.rippleValues[t].z=i.age)}}kickSpark(){this.spark=Math.min(ke,this.spark+Ee),this.sparkSeed++}scriptedFinalBlip(){const e=.35+this.rand()*.3,t=.35+this.rand()*.3;this.ignite(e,t,w*1.2,x),this.kickFlash(y)}sst(e){const t=Math.min(1,Math.max(0,e));return t*t*(3-2*t)}scheduleIgnitions(e,t){const i=Math.max(0,t)/60;if(!(i<=0))for(this.igniteTimeToNext-=e;this.igniteTimeToNext<=0;){this.ignite(this.rand(),this.rand(),w,x),this.kickFlash(ve);const a=Math.max(1e-6,this.rand());this.igniteTimeToNext+=-Math.log(a)/i}}scriptedSynchronyHit(){const e=this.full?5:3;for(let t=0;t<e;t++)this.ignite(this.rand(),this.rand(),w*1.6,x);this.kickFlash(N)}warmup(e,t){this.field.clearField(),this.field.setActParams(e);for(let i=0;i<t;i++)this.scheduleIgnitions(R,this.forceIgniteAlways?L:e.ignitionRate),this.field.step(R,1),this.updateIgniteAges(R)}update(e,t){const i=de(t.time),a=i.params;this.lastDt=e,this.firstUpdate&&(this.firstUpdate=!1,this.warmup(a,ie)),this.lastSongTime>=0&&t.time<this.lastSongTime-10&&this.warmup(a,ae),this.lastSongTime>=0&&t.time-this.lastSongTime>=0&&t.time-this.lastSongTime<.5&&(this.lastSongTime<W&&t.time>=W&&this.scriptedSynchronyHit(),this.lastSongTime<H&&t.time>=H&&this.kickFlash(N),this.lastSongTime<U&&t.time>=U&&this.scriptedFinalBlip()),this.lastSongTime=t.time;const s=Math.min(1,e*8);if(this.bassE+=(t.bass-this.bassE)*s,this.midE+=(t.mid-this.midE)*s,this.highE+=(t.high-this.highE)*s,this.bassSlowE+=(t.bass-this.bassSlowE)*Math.min(1,e*1.5),this.highSlowE+=(t.high-this.highSlowE)*Math.min(1,e*1.5),this.onsetCooldown-=e,this.onsetCooldown<=0&&this.bassE-this.bassSlowE>me&&(this.ignite(this.rand(),this.rand(),w,x),this.kickFlash(y),this.onsetCooldown=pe),this.highOnsetCooldown-=e,this.highOnsetCooldown<=0&&this.highE-this.highSlowE>ye&&(this.kickSpark(),this.highOnsetCooldown=be),this.forceSparkAlways&&(this.sparkDebugTimer-=e,this.sparkDebugTimer<=0&&(this.kickSpark(),this.sparkDebugTimer=Fe)),this.spark*=Math.exp(-7*e),this.scheduleIgnitions(e,this.forceIgniteAlways?L:a.ignitionRate),this.updateIgniteAges(e),this.updateRippleAges(e),i.actIndex===Ce){const h=i.localT*Pe;this.field.suppress.set(this.collapseCx,this.collapseCy,h,a.suppress)}else this.field.suppress.w=0;this.flash*=Math.exp(-3.4*e),this.field.setDiffMod(1+this.midE*we),this.field.setRewireMod(this.forceRewireFast?8:1),this.field.setActParams(a);let r=a.zoom,l=a.cellFreq;if(i.actIndex===0){const h=B+(Ie-B)*this.sst(i.localT);r=h+(u[1].zoom-h)*i.blend}else if(i.actIndex===f-1)r=u[f-1].zoom,l=u[f-1].cellFreq;else if(i.actIndex===f){const h=d[f+1]-d[f],g=this.sst(Math.min(1,i.localT*h/Me)),p=u[f-1],F=u[f],M=u[f+1];r=p.zoom+(F.zoom-p.zoom)*g,l=p.cellFreq+(F.cellFreq-p.cellFreq)*g,r+=(M.zoom-r)*i.blend,l+=(M.cellFreq-l)*i.blend}r*=1+Ae*Math.sin(t.time*_e+this.breathPhase);const o=this.material.uniforms;o.uTime.value+=e,o.uZoom.value=r,o.uCellFreq.value=l,o.uBloomGain.value=a.bloomGain,o.uSat.value=a.sat,o.uFrontGain.value=a.frontGain,o.uRefractGlow.value=a.refractGlow,o.uFilament.value=a.filament,o.uMicroTex.value=a.microTex,o.uWarmth.value=a.warmth,o.uDust.value=a.dust,o.uRewireJump.value=a.rewireJump,o.uRewireCrack.value=a.rewireCrack,o.uFlash.value=this.flash,o.uSparkle.value=this.highE,o.uSparkKick.value=this.spark,o.uSparkSeed.value=this.sparkSeed,o.uEnergy.value=he(t.time).energy;const c=this.cover;if(this.held){if(e>1e-5){const h=Math.min(1,e*De),g=Math.min(S,Math.max(-S,this.dragDx/e)),p=Math.min(S,Math.max(-S,this.dragDy/e));this.velX+=(g-this.velX)*h,this.velY+=(p-this.velY)*h}this.dragDx=0,this.dragDy=0}else if(this.velX!==0||this.velY!==0){this.pan.x+=this.velX*c.x/r*e,this.pan.y+=this.velY*c.y/r*e;const h=Math.exp(-2.5*e);this.velX*=h,this.velY*=h,Math.abs(this.velX)<q&&(this.velX=0),Math.abs(this.velY)<q&&(this.velY=0)}const m=Math.hypot(this.pan.x,this.pan.y);m>b&&(this.pan.x*=b/m,this.pan.y*=b/m,this.velX=0,this.velY=0)}pointer(e){const t=this.material.uniforms.uZoom.value,i=this.cover;if(e.type==="down"){this.held=!0,this.dragDx=0,this.dragDy=0,this.velX=0,this.velY=0;const a=(e.x-.5)*i.x/t+.5+this.pan.x,s=(e.y-.5)*i.y/t+.5+this.pan.y;this.ignite(a,s,Te,Se),this.activateRipple(a,s),this.kickFlash(y);return}if(e.type==="move"){if(!this.held)return;this.pan.x+=e.dx*i.x/t,this.pan.y+=e.dy*i.y/t,this.dragDx+=e.dx,this.dragDy+=e.dy;return}if(e.type==="up"){this.held=!1;return}this.held=!1,this.velX=0,this.velY=0,this.dragDx=0,this.dragDy=0}render(){this.field.step(this.lastDt,this.stepsPerFrame),this.material.uniforms.uField.value=this.field.texture,this.renderer.setRenderTarget(null),this.renderer.render(this.scene,this.camera)}resize(e,t){if(!this.material||e<=0||t<=0)return;const i=Math.min(3.5,Math.max(.28,e/t));i>=1?this.cover.set(i,1):this.cover.set(1,1/i),this.material.uniforms.uCover.value.copy(this.cover)}dispose(){this.field.dispose(),this.material.dispose(),this.quad.geometry.dispose(),this.renderer.setRenderTarget(null)}}const Oe={default:()=>new Ge},ze=Oe.default;export{ze as default};
//# sourceMappingURL=index-BdIUXFx2.js.map
