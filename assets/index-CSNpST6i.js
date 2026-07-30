import{V as $,c as g,S as ee,O as te,e as ae,M as se,d as oe}from"./three-vlqji54k.js";import{m as ie}from"./random-DL1jLgMw.js";import{O as D,P as B}from"./poisson-DpzmwpWi.js";const ne=`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`,J=.6;function re(i){const e=Math.max(1,Math.floor(i.strikeSlots)),s=Math.max(1,Math.floor(i.bloomSlots)),a=Math.max(1,Math.floor(i.pokeSlots)),t=Math.max(1,Math.floor(i.rippleSlots)),n=Math.max(1,Math.floor(i.lobes)),o=Math.max(1,Math.floor(i.fbmOct)),r=Math.max(1,Math.floor(i.fissures)),h=i.grain?`
    float grainH = sbHash21(gl_FragCoord.xy + vec2(uTime * 37.13, uTime * 19.71));
    color += (grainH - 0.5) * 0.016;`:"";return`
precision highp float;
varying vec2 vUv;

uniform vec2 uCover;
uniform float uZoom;
uniform float uFieldPxScale; // field-uv units per screen pixel THIS frame (increment 9) — analytic replacement for fwidth()-based AA; recomputed every frame in index.ts's update() (uZoom itself moves every frame). See sbAA()'s own doc below.
uniform vec2 uPan;
uniform float uTime;
uniform float uSterile;
uniform int uSoloMode;

// Biomass lifecycle + reactivity (increment 2).
uniform float uLifeClock; // CPU-side lifeClockAt(songTime) + beatBonus (index.ts) — drives sbClumpLife's appear/disappear epoch cycle
uniform float uPresence; // 0..1 fraction of clumps present per lifecycle epoch (ActParams.clumpPresence)
uniform float uBreath; // smoothed-bass breathing amplitude, scales lobe radii
uniform float uBreathPhase; // CPU-accumulated breathing phase (seconds * rate, NOT raw time) — per-clump hash offsets it further so the field doesn't pump in unison
uniform float uMotionPhase; // CPU-accumulated interior-speckle drift phase (NOT raw time)
uniform float uGroundPhase; // songTime * GROUND_PHASE_RATE (index.ts's update(), NOT accumulated -- a pure function of songTime like finalEnvAt, matching that precedent so ?t= deep links reproduce exactly) -- drives sbDeepGround's downward-drifting sampling domains. Loop-wrap (songTime resetting to 0) causes a phase jump here, which is acceptable: the world is reborn at the loop point anyway.
uniform float uHeat; // 0..1 hot/decayed palette lean (ActParams.heat)
uniform float uPaleness; // 0..1 chalky pale remission mix (ActParams.paleness)

// Sterility front + sterile-side reactivity (increment 3).
uniform vec2 uPocket; // field-uv centre of the S-field — the LAST living place
uniform vec2 uStretch; // per-axis elongation of the S-field's potential
uniform vec2 uFrontDrift; // CPU-accumulated domain offset for the front's noise wobble (NOT raw time)
uniform float uFrontNoise; // 0..1 turbulence/roughness of the front edge (ActParams.frontNoise)
uniform float uRMax; // per-seed S-field radius at uSterile=0 (index.ts's rMaxEff) -- REPLACES the old global-worst-case R_MAX const (increment 4 follow-up); see sbSterility's doc
uniform float uScrubGlow; // scrub-line glow strength, bass-reactive (index.ts)
uniform float uGlint; // droplet-glint amplitude on the scrub line, fast-highs-reactive (index.ts)
uniform float uWatermark; // 0..1 residual stain/watermark opacity (ActParams.watermark)
uniform float uSterileSpec; // 0..1 clinical specular sheen of the sterile surface (ActParams.sterileSpec)

// Swab-strike events (increment 4). uTick is a CPU-decayed scalar
// (tick *= exp(-7*dt)) kicked to 1 on every bass onset (index.ts) --
// independent of any existing scalar, feeds the young-strike rim pop only.
uniform float uTick;

// Winner-clump ghost stamps (increment 6) -- see this file's top doc for
// the full mechanism. uGhostAmp rides ActParams.ghostAmp (0..1, already 0
// in the final two acts); uGhostForce is the '?ghost=always' debug flag's
// force switch, read as a bool via the house >0.5 convention (no GLSL
// uniform-bool plumbing needed) rather than a compile-time constant, since
// every other runtime debug toggle in this shader (uSoloMode, the
// pinned-value uniforms) is a uniform too, not a template-baked literal.
uniform float uGhostAmp;
uniform float uGhostForce;

// Increment 7: act discipline (act-held ActParams -- no shader change, all
// index.ts), camera choreography (no shader change -- drift/breath/shake
// all fold into the existing uPan/uZoom uniforms above), scripted hits,
// crackle, and the final display grade. uEnergy rides arcAt(songTime)
// (index.ts) -- exposure lift + (via index.ts's Poisson-rate multiplier)
// crackle's ambient rate. uGrade/uVignette ride ActParams.grade/vignette.
// uFlash is a NEW CPU decay scalar (index.ts, exp(-3.4*dt)) kicked by the
// track's five scripted hits (140/144/168/174/180/184s) -- independent of
// uTick, which stays the bass-onset/poke rim-pop channel. uCrackle is
// another independent CPU decay scalar (exp(-7*dt)) for the high-band
// crackle event; uCrackleSeed is a plain incrementing counter (cast to
// float) that re-rolls the crackle hash cells on every fire so the spark
// pattern never repeats.
uniform float uEnergy;
uniform float uGrade;
uniform float uVignette;
uniform float uFlash;
uniform float uCrackle;
uniform float uCrackleSeed;

// Increment 8: the final condensation-to-seed sequence (the album's closing
// image) -- a scripted overlay computed PURELY from songTime (index.ts's
// finalEnvAt, NOT edge-triggered like increment 7's scripted hits, so it
// renders correctly from any ?t= deep link into act 6). uFinalPhase is 0
// off/gone, 1 swell, 2 condense, 3 seed (read via the house >0.5/<1.5/etc.
// float-as-enum convention, matching uSoloMode/uGhostForce above -- no GLSL
// int uniform plumbing needed). uFinalT is 0..1 progress WITHIN the current
// phase (CPU-eased for swell/condense, see finalEnvAt's own doc -- this
// shader just lerps with it directly, no re-easing here). uSeedFade is the
// SEED phase's own 1->0 fade (harmlessly pinned to 1 outside SEED, where it
// is never read). uFinalPos is a fixed seeded point (index.ts's init(),
// within +-0.06 field-uv of frame centre) -- the SAME spot every phase,
// quoting a1's "lone point in the void" seed image, value-inverted for this
// pale ground.
uniform float uFinalPhase;
uniform float uFinalT;
uniform float uSeedFade;
uniform vec2 uFinalPos;

// Increment 2-10 layer budgets, baked as compile-time constants. Every
// budget is now a real consumed constant (LOBES/FBM_OCT since increment 2,
// STRIKE_SLOTS since increment 4, BLOOM_SLOTS/POKE_SLOTS/RIPPLE_SLOTS since
// increment 5, SPLINTERS since increment 10 (sbFractureSd's radiating
// splinter count) -- see uBloom/uPoke/uRipple below and sbSterility's poke
// loop) -- no more inert placeholders left to guard with a checksum.
const int STRIKE_SLOTS = ${e};
const int BLOOM_SLOTS = ${s};
const int POKE_SLOTS = ${a};
const int RIPPLE_SLOTS = ${t};
const int LOBES = ${n};
const int FBM_OCT = ${o};
const int SPLINTERS = ${r};

// Swab-strike display arrays (increment 4), index-parallel with index.ts's
// SlotPool(STRIKE_SLOTS) (uStrikeA IS that pool's own Vector4 slots, bound by
// reference) plus a second, hand-maintained Vector4 array for the values
// baked once at fire time (uStrikeB). xy/z/w on A follow the SlotPool
// convention (z = age seconds, w = active/fade 0..1); B's four fields are
// all fire-time constants for that strike's lifetime -- see sbSterility's
// strike loop below and index.ts's fireStrike.
uniform vec4 uStrikeA[STRIKE_SLOTS]; // xy = centre (field-uv), z = age (s), w = active 0/1, fades 1->0 over a failed strike's last 1.5s before freeing
uniform vec4 uStrikeB[STRIKE_SLOTS]; // x = rMax (field-uv), y = ellipse aspect 1.15-1.65, z = orientation angle (radians), w = healRate (1/s; 0 = holds rMax forever, CPU frees it after 14s)

// Condensation blooms (increment 5) -- the track's recurring breath motif:
// a soft cool misty lift + faint droplet sparkle over LIVING ground only,
// drawn post-overlay in main() (after the composite + scrub line). Fired by
// index.ts's fireBloom (slow-bass threshold crossing + ambient Poisson,
// always centre-biased so a bloom reads as the frame's subject) or
// fireBloomAt (act 6's poke-births-a-bloom route, exact tap point, no
// bias) -- index-parallel with index.ts's SlotPool(BLOOM_SLOTS).
uniform vec4 uBloom[BLOOM_SLOTS]; // xy = centre (field-uv), z = age (s), w = active 0/1
uniform float uBloomAmp; // 0..1 bloom event amplitude (ActParams.bloomAmp)

// Pointer pokes (increment 5) -- a REBLOOM: sbPokeRadius's grow/hold/
// re-scrub circle is smin'd into S (sbSterility's poke loop) so a scrubbed
// patch of ground carves back into living territory, then closes again --
// biomass regrows automatically wherever S<0 (sbBiomass already keys off
// livingMask, no change needed there). Fired unconditionally on pointer
// 'down' (index.ts's pointer()), no tap-vs-drag threshold -- EXCEPT in act
// 6 ('last-breath'), where a tap fires a bloom (uBloom) instead, since the
// world is gone by then. Index-parallel with index.ts's
// SlotPool(POKE_SLOTS); a fixed envelope (unlike strikes' per-instance
// healRate) means the CPU pool needs no extra baked-constants array.
uniform vec4 uPoke[POKE_SLOTS]; // xy = centre (field-uv), z = age (s), w = active 0/1

// Poke ripple (increment 5) -- a thin expanding near-white ring, the
// display-side half of every tap (house idiom, verbatim shape from b2's
// activateRipple/uRipple). Drawn post-overlay, unmasked by livingMask -- a
// tap's feedback reads the same whether it lands on living or sterile
// ground. Index-parallel with index.ts's SlotPool(RIPPLE_SLOTS).
uniform vec4 uRipple[RIPPLE_SLOTS]; // xy = centre (field-uv), z = age (s), w = active 0/1

// Biomass field constants: CLUMP_FREQ cells across field-uv, SMIN_K the iq
// smooth-min blend radius for fusing a clump's lobes into one mounded body.
const float CLUMP_FREQ = 7.0;
const float SMIN_K = 0.045;

// FRONT_NOISE_AMP: baseline relative amplitude of the S-field's noise
// wobble (see sbSterility below). Composition round: raised 0.35 -> 0.6 and
// the wobble itself made TWO-SCALE (a coarse, low-frequency fbm term
// weighted 2x a finer one) so the front reads as an advancing bleach stain
// with whole fingers reaching ahead/behind, never a smooth shrinking
// conic/circle (the "petri-dish" composition that collides with b1) — at
// uFrontNoise=1 the combined wobble now swings roughly plus-or-minus 30%,
// still never inverting the monotonic radial falloff (no disconnected
// islands), just a much more irregular boundary. Interpolated from the
// TS-exported FRONT_NOISE_AMP (this file's own module scope, above
// buildSterileFragment) rather than a separate GLSL literal, so index.ts's
// rMaxEff wobble-bound derivation can never silently drift from the value
// actually compiled into the shader.
const float FRONT_NOISE_AMP = ${J};

// Watermark sampling constants (sbWatermarkSd / sbSterileSide): a FROZEN
// snapshot of the clump lifecycle — constant life clock, full presence, no
// breathing — so residue prints read as fixed ghosts rather than live
// forms. WM_FALL shapes how quickly the print fades with depth into the
// sterile field (near the front looks recently scrubbed, deep blank looks
// clean).
const float WM_LIFE_CLOCK = 0.35;
const float WM_PRESENCE = 0.92;
const float WM_FALL = 2.2;

// --- hash / noise (sb-prefixed so concatenation with any other shader's
// own hash21 etc. never collides, matching b2's tt-prefix convention) ---
float sbHash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec2 sbHash22(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453);
}
float sbVnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(sbHash21(i), sbHash21(i + vec2(1.0, 0.0)), u.x),
             mix(sbHash21(i + vec2(0.0, 1.0)), sbHash21(i + vec2(1.0, 1.0)), u.x), u.y);
}
float sbFbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < FBM_OCT; i++) { s += a * sbVnoise(p); p *= 2.0; a *= 0.5; }
  return s;
}

// Antialiasing-width safety clamp (increment 7 bug fix -- see this file's
// top doc addendum below). fwidth() can spike anomalously large at
// specific screen locations tied to the fullscreen quad's own internal
// triangle-split seam (a GPU derivative-estimation hazard, most
// reproducible where fwidth() follows branchy, data-dependent code --
// sbBiomass's 3x3 clump search with its early 'continue's is exactly that
// shape). Confirmed by direct pixel inspection (a headless GPU-readback
// harness, not a screenshot): a faint, PERFECTLY SCREEN-SPACE-FIXED
// (invariant to uPan -- panning the world left the line exactly where it
// was, proving it is not a world-space feature) diagonal band, running
// corner-to-corner through the frame centre at ~45 degrees, was visible in
// every mode that calls sbBiomass (composed, '?solo=biomass', '?solo=
// ghosts') but never in '?solo=front' (which never touches sdUnion) or at
// any song time before the front itself entered frame -- ruling out the
// original suspect (the scrub-line glint hash, which IS correctly gated by
// lineMask; confirmed clean by the same harness). Live-patching the
// compiled fragment shader to clamp ONLY fwidth(sdUnion) (sbBiomass's
// edgeAA/rimAA) reproduced the artifact at a loose 0.02 clamp, then
// eliminated it completely at 0.003 -- pinning the true cause to an
// unclamped derivative spike there making edgeMask/rim falsely nonzero far
// from any real clump silhouette. SB_MAX_FWIDTH sits comfortably above any
// legitimate single-pixel-scale AA width at any in-range zoom (zoomAt's
// floor is 0.30, sections.ts) yet well below the observed spike. sbAA()
// wraps every fwidth()-derived AA width in this file (not just the proven
// two) so the same class of artifact can never resurface at a different
// call site -- the ghost-motif SDFs and the S-field/watermark ones share
// the identical "branchy code feeding fwidth()" shape.
const float SB_MAX_FWIDTH = 0.003;

// Increment 9: sbAA() no longer touches fwidth() at all -- every AA width in
// this file now rides uFieldPxScale, a per-frame CPU-computed analytic value
// (field-uv units per screen pixel, index.ts's update()) derived from the
// SAME field=(vUv-0.5)*uCover/uZoom+0.5+uPan mapping main() uses:
// d(field)/d(pixel) per axis = uCover_axis / (uZoom * canvasSize_axis_px);
// max(uCover.x,uCover.y) over min(canvasWidth_px,canvasHeight_px) is a
// conservative (worst-axis) isotropic bound, matching fwidth()'s own
// multi-pixel-conservative estimate under the SDFs' |gradient|~=1
// assumption. Forced by this increment's OTHER change (side-gating the
// biomass/watermark clump searches on S, sbBiomass/sbSterileSide below):
// fwidth()/dFdx/dFdy are undefined in non-uniform control flow, and a
// branch on a per-fragment value like S is exactly that shape. Welcome side
// effect: this also permanently removes the triangle-seam fwidth()
// artifact class the increment-7 doc above diagnosed -- SB_MAX_FWIDTH's
// clamp is kept verbatim as an upper-bound safety net (now normally
// redundant, since uFieldPxScale never spikes the way a derivative-
// estimation hazard could, but harmless to keep).
float sbAA() { return min(uFieldPxScale, SB_MAX_FWIDTH); }

// Increment 9: shared side-gate threshold for the biomass/watermark clump
// searches below -- a couple of AA-widths beyond sbAA() itself (comfortably
// past the widest AA band either search's own output feeds, rimAA's 1.5x),
// so a search is skipped only once its result is PROVABLY invisible (see
// sbBiomass's gate doc for the exact argument). One shared function, not a
// duplicated literal, so the two gates can never drift apart.
const float SEARCH_GATE_MULT = 3.0;
float sbSearchGate() { return sbAA() * SEARCH_GATE_MULT + 0.001; }

// Increment 9: sentinel sGate value solo modes 1/4 (?solo=biomass,
// ?solo=ghosts) pass to sbBiomass to force its search to always run,
// matching their "ignore S entirely" convention -- comfortably below any
// -sbSearchGate() this shader will ever compute.
const float FORCE_SEARCH_S = -1.0;

// iq's polynomial smooth-min: fuses two SDFs with a rounded blend of radius k.
float sbSmin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

// iq's polynomial smooth-max, built on sbSmin (standard identity: max(a,b) =
// -min(-a,-b)) -- used to smoothly UNION a strike's sterile wound into S
// (see sbSterility's strike loop) so its rim merges with the front's own
// zero-crossing instead of a hard crease.
float sbSmax(float a, float b, float k) { return -sbSmin(-a, -b, k); }

// This cell (integer clump-grid coord, floor(fieldUv * CLUMP_FREQ)) nearest
// field-uv (0.5, 0.5) — the HERO clump, always present (sbClumpLife bypasses
// its presence check entirely): a stable loop-identity anchor, same role as
// catalogueShader.ts's cc==(0,0) hero override.
vec2 sbHeroCell() { return floor(vec2(0.5 * CLUMP_FREQ)); }

// Beat-coupled appear/disappear lifecycle for clump cc (b2's specLife
// recipe): returns the current epoch's presence/scale envelope (0 absent,
// ~1 fully present, briefly >1 on pop-in) and writes the epoch number so the
// caller can re-roll the clump's lobe layout per epoch (a respawned clump
// lands with a freshly hashed lobe arrangement). HERO OVERRIDE: sbHeroCell()
// is pinned present at epoch 0 forever. lifeClock/presence are taken as
// EXPLICIT parameters (increment 3) rather than read from the uLifeClock/
// uPresence uniforms directly, so the watermark pass (sbWatermarkSd) can
// call this with a FROZEN snapshot instead of the live values — every other
// caller (sbBiomass's search) just passes the real uniforms through.
float sbClumpLife(vec2 cc, out float epoch, float lifeClock, float presence) {
  if (cc == sbHeroCell()) { epoch = 0.0; return 1.0; }
  float cycle = lifeClock + sbHash21(cc + vec2(17.9, 4.4));
  float e = floor(cycle);
  float k = fract(cycle);
  float presentE = step(sbHash21(cc + vec2(e * 7.7, 2.9)), presence);
  float presentE1 = step(sbHash21(cc + vec2((e + 1.0) * 7.7, 2.9)), presence);
  // Scale-out crossfade over the last 15% of the cycle toward next epoch's presence.
  float x = smoothstep(0.85, 1.0, k);
  float s = mix(presentE, presentE1, x);
  // Scale-in pop-in overshoot (~1.06 peak, settling by k=0.12) over the
  // first 12% of THIS epoch's cycle — gated by presentE so an absent epoch
  // never pops.
  s *= 1.0 + 0.06 * sin(3.14159265 * smoothstep(0.0, 0.12, k)) * presentE;
  epoch = e;
  return s;
}

// Crown colour for clump cc: a hot magenta-amber ramp picked per clump by
// hash, with ~25% of clumps replaced entirely by a rust-green variant.
vec3 sbClumpCrown(vec2 cc) {
  vec3 magenta = vec3(0.85, 0.18, 0.42);
  vec3 amber = vec3(0.95, 0.55, 0.16);
  vec3 rustGreen = vec3(0.45, 0.50, 0.12);
  float rampH = sbHash21(cc + vec2(12.1, 44.4));
  vec3 hotCrown = mix(magenta, amber, rampH);
  float familyH = sbHash21(cc + vec2(51.3, 7.7));
  return mix(hotCrown, rustGreen, step(familyH, 0.25));
}

// Per-clump base silhouette radius (0.55/CLUMP_FREQ scaled per clump by a
// hash in [0.55, 1.05]) -- factored out of sbClumpSd (increment 6) so the
// ghost-stamp winner lookup (sbBiomass, after its 3x3 search) can recover
// the SAME radius for exactly one cell (the winner) without re-deriving the
// hash literal a second time, guaranteeing the stamp's size budget can never
// silently drift from the clump's own silhouette scale.
float sbClumpBaseR(vec2 cc) {
  float baseHash = sbHash21(cc + vec2(41.1, 19.3));
  return (0.55 / CLUMP_FREQ) * mix(0.55, 1.05, baseHash);
}

// Per-clump anchor point (cell-centre plus a small per-epoch jitter) --
// same extraction reasoning as sbClumpBaseR above; epoch is passed in
// (rather than re-derived) since every caller already has it from its own
// sbClumpLife call.
vec2 sbClumpAnchor(vec2 cc, float epoch) {
  vec2 cellCenter = (cc + vec2(0.5)) / CLUMP_FREQ;
  vec2 jitterH = sbHash22(cc + vec2(epoch * 5.1 + 3.3, epoch * 2.7 + 8.8));
  return cellCenter + (jitterH - 0.5) * (0.5 / CLUMP_FREQ);
}

// Signed distance to clump cc's silhouette at field-uv point p: a smin union
// of LOBES circular lobes hashed around the cell's anchor. Lobe centre
// spread is kept SMALLER than the lobe radii (offsets within 0.55 x base
// radius; radii 0.45-1.0 x base) so the union always reads as one compact
// mounded cushion, never a chain or filament. Base clump radius is
// 0.55/CLUMP_FREQ scaled per clump by a hash in [0.55, 1.05]. Breathing
// scales every lobe's radius together, with a per-clump hashed phase offset
// so the whole field doesn't pump in unison. Absent clumps (sbClumpLife's
// envelope near 0) return a large sentinel so they drop out of the search
// entirely. lifeClock/presence/breath are explicit parameters
// (increment 3, see sbClumpLife's doc) so sbWatermarkSd can pass a FROZEN
// snapshot (constant life clock, full presence, zero breath) for the
// residue prints, while sbBiomass's search passes the live uniforms.
float sbClumpSd(vec2 fieldUv, vec2 cc, float lifeClock, float presence, float breath) {
  float epoch;
  float scaleEnv = sbClumpLife(cc, epoch, lifeClock, presence);
  if (scaleEnv < 0.01) return 9.0;

  vec2 anchor = sbClumpAnchor(cc, epoch);
  float baseR = sbClumpBaseR(cc);

  float clumpPhaseHash = sbHash21(cc + vec2(6.6, 22.2));
  float breathScale = 1.0 + 0.06 * breath * sin(6.2831853 * (uBreathPhase + clumpPhaseHash));

  float sd = 9.0;
  for (int i = 0; i < LOBES; i++) {
    float fi = float(i);
    vec2 hOff = sbHash22(cc + vec2(fi * 7.3 + 1.0, epoch * 3.1 + 2.0));
    float angle = hOff.x * 6.2831853;
    float offMag = hOff.y * 0.55 * baseR;
    vec2 lobeCentre = anchor + vec2(cos(angle), sin(angle)) * offMag;
    float rHash = sbHash21(cc + vec2(fi * 5.1 + 3.0, epoch * 1.7 + 9.0));
    float lobeR = baseR * mix(0.45, 1.0, rHash) * breathScale * scaleEnv;
    float dLobe = length(fieldUv - lobeCentre) - lobeR;
    sd = sbSmin(sd, dLobe, SMIN_K);
  }
  return sd;
}

// Watermark residue SDF: samples the SAME per-cell clump SDF sbBiomass's own
// search uses, with a FROZEN lifecycle (WM_LIFE_CLOCK, WM_PRESENCE, zero
// breath) — so the returned distance is a fixed snapshot of "biomass that
// was recently here", never a live/breathing shape. Increment 9: reduced
// from the original 3x3-cell union down to the fragment's own 2x2 NEAREST
// cells — the fixed cell (n0) plus its true nearest neighbour on each axis,
// picked by which half of the cell fieldUv falls in (dir), not always the
// fixed +1 direction — a real screenshot comparison at t=170 (sections.ts's
// 'sterile' act, watermark=0.7, its own peak) first tried the fragment's OWN
// cell only (1x1): visibly blockier / grid-tiled against the original 3x3
// union's smooth organic blobs, a real regression, not a barely-perceptible
// seam. 2x2-nearest reads indistinguishably close to the original 3x3 union
// in the same comparison while still only sampling 4 cells instead of 9.
// Paired with the caller-side gate in sbSterileSide (increment 9): this
// function is now only ever invoked when s > -sbSearchGate(), so the living
// side never pays for it at all.
float sbWatermarkSd(vec2 fieldUv) {
  vec2 scaled = fieldUv * CLUMP_FREQ;
  vec2 n0 = floor(scaled);
  vec2 fr = scaled - n0;
  vec2 dir = vec2(fr.x < 0.5 ? -1.0 : 1.0, fr.y < 0.5 ? -1.0 : 1.0);
  float sdUnion = 9.0;
  for (int j = 0; j <= 1; j++) {
    for (int i = 0; i <= 1; i++) {
      vec2 cc = n0 + vec2(dir.x * float(i), dir.y * float(j));
      float sdC = sbClumpSd(fieldUv, cc, WM_LIFE_CLOCK, WM_PRESENCE, 0.0);
      if (sdC > 5.0) continue;
      sdUnion = sbSmin(sdUnion, sdC, SMIN_K);
    }
  }
  return sdUnion;
}

// Ghost-stamp constants (increment 6) -- see this file's top doc for the
// full winner-clump mechanism. GHOST_PROB is the per-epoch hosting chance;
// GHOST_STAMP_FRAC bounds a stamp's footprint to a fraction of its clump's
// own base radius; GHOST_INSET_FRAC (also relative to baseR) is the width
// of the soft fade band keeping every stamp off the silhouette edge;
// GHOST_ALPHA is the composed scene's ink-mix strength (scaled further by
// uGhostAmp). GHOST_DEBUG_GRAY/GHOST_DEBUG_CREAM are solo-mode-4-only
// (uSoloMode == 4): a flat dark-gray silhouette so the four motifs read at
// a glance, and a bright warm cream for the stamp itself at full alpha --
// never used in the composed scene, where the stamp always mixes toward
// the clump's OWN interior tone instead of a new colour (the anti-goal:
// stamps must never read as importing another track's geometry).
const float GHOST_PROB = 0.07;
const float GHOST_STAMP_FRAC = 0.6;
const float GHOST_INSET_FRAC = 0.28;
const float GHOST_ALPHA = 0.18;
const vec3 GHOST_DEBUG_GRAY = vec3(0.2);
const vec3 GHOST_DEBUG_CREAM = vec3(0.97, 0.93, 0.78);

// Unsigned distance from p to segment a-b (iq's standard construction) --
// shared by every ghost motif that needs a capsule-like stroke (the vein
// filament's chained bows below).
float sbSdSegment(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}

// iq's hexagon SDF (flat-top, takes the APOTHEM/inradius) -- the same
// construction as a2-hive's wallShader.ts sdHexagon, sb-prefixed per house
// convention since it is its own independent copy here, not a shared
// import.
float sbSdHexagon(vec2 p, float r) {
  const vec3 k = vec3(-0.8660254, 0.5, 0.5773503);
  p = abs(p);
  p -= 2.0 * min(dot(k.xy, p), 0.0) * k.xy;
  p -= vec2(clamp(p.x, -k.z * r, k.z * r), r);
  return length(p) * sign(p.y);
}

// Motif 0 -- COMB CELL (a2-hive echo): one hexagon outline plus a partial
// arc of a neighbouring hex, suggesting the golden lattice without drawing
// enough of it to read as an imported grid.
float sbCombMotif(vec2 rp, float stampR) {
  float apothem = stampR * 0.5;
  float lineW = stampR * 0.09;
  float d0 = abs(sbSdHexagon(rp, apothem)) - lineW;
  float aa0 = sbAA() * 1.25 + 0.0006;
  float m0 = 1.0 - smoothstep(0.0, aa0, d0);

  vec2 nOff = vec2(apothem * 1.85, 0.0);
  vec2 rp2 = rp - nOff;
  float ang2 = atan(rp2.y, rp2.x);
  float arcGate = smoothstep(1.6, 2.2, abs(ang2));
  float d1 = abs(sbSdHexagon(rp2, apothem)) - lineW;
  float aa1 = sbAA() * 1.25 + 0.0006;
  float m1 = (1.0 - smoothstep(0.0, aa1, d1)) * arcGate;

  return max(m0, m1);
}

// Motif 1 -- VEIN FILAMENT (b1-biosphere echo): a chain of 3 bowed capsule
// segments, each thinner than the last, tapering toward its tip.
float sbVeinMotif(vec2 rp, float stampR) {
  vec2 p0 = vec2(-stampR * 0.55, -stampR * 0.10);
  vec2 p1 = vec2(-stampR * 0.05, stampR * 0.18);
  vec2 p2 = vec2(stampR * 0.40, stampR * 0.05);
  vec2 p3 = vec2(stampR * 0.75, -stampR * 0.12);
  float r0 = stampR * 0.10;
  float r1 = stampR * 0.065;
  float r2 = stampR * 0.035;

  float d = min(
    sbSdSegment(rp, p0, p1) - mix(r0, r1, 0.5),
    min(sbSdSegment(rp, p1, p2) - mix(r1, r2, 0.5), sbSdSegment(rp, p2, p3) - r2)
  );
  float aa = sbAA() * 1.25 + 0.0006;
  return 1.0 - smoothstep(0.0, aa, d);
}

// Motif 2 -- SPECIMEN SILHOUETTE (b2-terminal-taxonomy echo): a small
// ellipse outline with one interior horizontal band, suggesting a specimen
// plate.
float sbSpecimenMotif(vec2 rp, float stampR) {
  vec2 axes = vec2(stampR * 0.62, stampR * 0.38);
  float dEllipse = length(rp / axes) - 1.0;
  float ringW = 0.16;
  float dRing = abs(dEllipse) - ringW;
  float aaR = sbAA() * 1.25 + 0.0006;
  float ring = 1.0 - smoothstep(0.0, aaR, dRing);

  float bandHalf = stampR * 0.05;
  float aaBY = sbAA() * 1.25 + 0.0006;
  float bandY = 1.0 - smoothstep(bandHalf, bandHalf + aaBY, abs(rp.y));
  float bandX = 1.0 - smoothstep(axes.x * 0.75, axes.x * 0.75 + 0.01, abs(rp.x));

  return max(ring, bandY * bandX);
}

// Motif 3 -- FALLING CHAIN (a3-biome-dominoes echo): three diminishing
// filled dots along a slight arc, suggesting the domino cascade.
float sbChainMotif(vec2 rp, float stampR) {
  vec2 c0 = vec2(-stampR * 0.5, stampR * 0.28);
  vec2 c1 = vec2(stampR * 0.02, -stampR * 0.04);
  vec2 c2 = vec2(stampR * 0.48, -stampR * 0.32);
  float r0 = stampR * 0.16;
  float r1 = stampR * 0.11;
  float r2 = stampR * 0.07;

  float d = min(length(rp - c0) - r0, min(length(rp - c1) - r1, length(rp - c2) - r2));
  float aa = sbAA() * 1.25 + 0.0006;
  return 1.0 - smoothstep(0.0, aa, d);
}

// Picks the winner clump's motif by id (0-3, see sbBiomass's ghost-stamp
// block for how motifId is hashed) -- an if/if/if chain rather than a
// GLSL ES 1.00-incompatible switch statement.
float sbGhostMotifMask(int motifId, vec2 rp, float stampR) {
  if (motifId == 0) return sbCombMotif(rp, stampR);
  if (motifId == 1) return sbVeinMotif(rp, stampR);
  if (motifId == 2) return sbSpecimenMotif(rp, stampR);
  return sbChainMotif(rp, stampR);
}

// Full biomass field composited over ground at field-uv point fieldUv:
// searches the 3x3 clump-cell neighbourhood, smin-unions every present
// clump's SDF for the coverage field, tracks the two nearest clumps for a
// soft colour blend across overlaps plus a crowding count for the valley-
// darkening term, then shades interior->crown by height with a rim band and
// interior speckle. Shared between the composed scene (ground = the
// living/sterile field, see main()) and solo-mode 1 (ground = flat
// mid-gray) so the two paths can never drift apart. livingMask (increment
// 3, ActParams.uSterile-driven — 1.0 = fully living, 0.0 = fully sterile,
// see main()'s S-field) truncates the biomass silhouette itself: multiplied
// into edgeMask and rim so a clump half-overtaken by the sterilization front
// shows its scrubbed half gone, revealing bare ground instead of biomass.
// Solo mode 1 passes a constant 1.0 here to ignore S entirely, as before.
// ghostDebug (increment 6, true only for uSoloMode == 4) swaps the crown-
// shaded biomassCol for a flat dark-gray silhouette (skipping the
// speckle/crowd/paleness modifiers too, so the four ghost motifs read
// cleanly against a plain ground) and draws the winner-clump stamp at FULL
// alpha in a bright cream rather than the composed scene's faint ink mix —
// see the ghost-stamp block at the end of this function.
vec3 sbBiomass(vec2 fieldUv, vec3 ground, float livingMask, float sGate, bool ghostDebug) {
  // Side-gate (increment 9): every consumer of this search's result below
  // (edgeMask, rim, the ghost-stamp's stampCoverage) is multiplied by
  // livingMask before ever touching col -- and livingMask (main()'s own
  // 1.0 - smoothstep(-sEdge, sEdge, S)) has ALREADY saturated to exactly 0
  // by the time S clears sEdge, let alone sbSearchGate()'s couple-of-
  // AA-widths-wider margin. Past that point the search's output is
  // PROVABLY invisible, not an approximation -- skipping it outright is a
  // pure perf win. Solo modes 1/4 (?solo=biomass / ?solo=ghosts) pass
  // FORCE_SEARCH_S, comfortably below any -sbSearchGate() ever reaches, so
  // the gate never trips for their "ignore S entirely" convention.
  if (sGate >= sbSearchGate()) return ground;

  vec2 n0 = floor(fieldUv * CLUMP_FREQ);

  float sdUnion = 9.0;
  float sdNearest = 9.0;
  float sdSecond = 9.0;
  vec2 ccNearest = vec2(0.0);
  vec2 ccSecond = vec2(0.0);
  int crowdCount = 0;

  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 cc = n0 + vec2(float(i), float(j));
      float sdC = sbClumpSd(fieldUv, cc, uLifeClock, uPresence, uBreath);
      if (sdC > 5.0) continue;
      crowdCount++;
      sdUnion = sbSmin(sdUnion, sdC, SMIN_K);
      if (sdC < sdNearest) {
        sdSecond = sdNearest; ccSecond = ccNearest;
        sdNearest = sdC; ccNearest = cc;
      } else if (sdC < sdSecond) {
        sdSecond = sdC; ccSecond = cc;
      }
    }
  }

  // Silhouette edge: a CRISP, fwidth-derived pixel-scale coverage mask (~1.5
  // screen pixels wide) — the ONLY term (besides livingMask) that decides
  // ground vs biomass in the final composite below. fwidth ties the
  // transition to actual screen pixels instead of a field-uv constant, so
  // it stays crisp regardless of zoom/resolution.
  float edgeAA = sbAA() * 0.75 + 0.0004;
  float edgeMask = clamp(1.0 - smoothstep(-edgeAA, edgeAA, sdUnion), 0.0, 1.0);
  // Increment 3: the sterilization front truncates the biomass silhouette
  // itself — a clump half-overtaken by the front shows its scrubbed half
  // gone (ground shows through), never a lingering biomass tint past S=0.
  edgeMask *= livingMask;
  // Interior height: a GENTLER gradient than the edge, used only for the
  // mounded crown/interior colour falloff WITHIN the silhouette (never for
  // the ground/biomass boundary itself, which is edgeMask's job).
  float h = clamp(1.0 - smoothstep(-0.051, 0.006, sdUnion), 0.0, 1.0);
  // Thin rim: a narrow, fwidth-scaled |SDF| band hugging the silhouette — a
  // bright line, not a halo. Also truncated by livingMask so the rim never
  // ghosts past the front either.
  float rimAA = sbAA() * 1.5 + 0.0006;
  float rim = (1.0 - smoothstep(0.0, rimAA, abs(sdUnion))) * livingMask;

  vec3 interior = vec3(0.30, 0.06, 0.14);
  vec3 crownNearest = sbClumpCrown(ccNearest);
  vec3 crownSecond = sbClumpCrown(ccSecond);
  // Blend toward the second-nearest clump's crown where the two are close
  // in distance (a boundary between overlapping clumps), so the seam reads
  // as a soft handoff rather than a hard colour split.
  float boundaryBlend = 1.0 - clamp((sdSecond - sdNearest) / 0.05, 0.0, 1.0);
  vec3 crown = mix(crownNearest, crownSecond, 0.5 * boundaryBlend);

  float hHot = clamp(h * mix(0.85, 1.3, uHeat), 0.0, 1.0);
  vec3 biomassCol = ghostDebug ? GHOST_DEBUG_GRAY : mix(interior, crown, hHot) * mix(1.0, 1.1, uHeat);

  // Interior speckle/crowding/paleness modifiers are skipped in ghostDebug
  // (uSoloMode == 4): the flat silhouette above is deliberately plain so the
  // four ghost motifs read at a glance, with no competing texture.
  if (!ghostDebug) {
    // Interior speckle: 2(+)-octave value noise, domain drifting by the
    // CPU-accumulated uMotionPhase (not raw time) — interior only (gated by
    // h, excluded from the rim band).
    vec2 noiseP = fieldUv * CLUMP_FREQ * 9.0 + vec2(uMotionPhase * 0.35, -uMotionPhase * 0.27);
    float speck = sbFbm(noiseP);
    biomassCol += (speck - 0.5) * 0.28 * h * (1.0 - rim);

    // Crowding: darkens valleys where several clumps' edges meet (many
    // nearby present clumps AND this fragment sits between two
    // near-equidistant ones).
    float crowdWeight = smoothstep(2.0, 6.0, float(crowdCount));
    float valley = 1.0 - clamp((sdSecond - sdNearest) / 0.05, 0.0, 1.0);
    biomassCol *= 1.0 - crowdWeight * valley * 0.3;

    // Paleness: mixes the biomass's OWN colour (not the bare ground) toward
    // the chalky remission tone.
    vec3 pale = vec3(0.72, 0.70, 0.66);
    biomassCol = mix(biomassCol, pale, uPaleness);
  }

  vec3 col = mix(ground, biomassCol, edgeMask);

  // Rim: slightly brighter, cooler highlight right at the silhouette edge —
  // applied to the FINAL composited colour rather than folded into
  // biomassCol before the ground mix, because h/edgeMask (the coverage/alpha
  // terms) are near zero exactly where the rim lives (both peak at
  // sdUnion ~ 0); mixing it in beforehand let the ground mix wash the
  // highlight back out.
  vec3 rimTone = mix(crown, vec3(0.75, 0.55, 0.62), 0.5);
  col = mix(col, rimTone * 1.25, rim * 0.55);

  // Ghost stamp (increment 6): the winner clump is exactly the nearest one
  // already tracked above -- sdNearest/ccNearest are the running MINIMUM
  // clump SDF across the 3x3 neighbourhood, and since a clump SDF is
  // negative INSIDE, that minimum is, by construction, the DEEPEST (most-
  // interior) present clump at this fragment. Aliased as winnerCell purely
  // for readability here; no second tracking pass needed. Guarded on
  // sdNearest < 5.0 (the same "was a real clump, not the search's own empty
  // sentinel" test sbBiomass already uses above) so an all-absent 3x3
  // neighbourhood never hosts a stamp.
  if (sdNearest < 5.0) {
    vec2 winnerCell = ccNearest;
    // A cheap post-loop sbClumpLife re-call on just this one cell recovers
    // its epoch (needed to re-roll the hosts-a-ghost decision and the motif
    // choice every time the clump respawns, not just once ever) and its
    // lifecycle envelope scaleEnvW (the stamp scales in/out with the SAME
    // value that already scales the clump's own lobe radii, see sbClumpSd).
    float epochW;
    float scaleEnvW = sbClumpLife(winnerCell, epochW, uLifeClock, uPresence);

    float ghostH = sbHash21(winnerCell + vec2(31.7 + epochW * 7.7, 77.3));
    bool hostsGhost = ghostDebug || uGhostForce > 0.5 || ghostH < GHOST_PROB;

    if (hostsGhost) {
      // Two more hash draws: which of the four motifs, and its rotation.
      float motifH = sbHash21(winnerCell + vec2(52.1 + epochW * 7.7, 9.4));
      int motifId = int(min(3.0, floor(motifH * 4.0)));
      float angleH = sbHash21(winnerCell + vec2(83.3 + epochW * 7.7, 15.2));
      float stampAngle = angleH * 6.2831853;

      vec2 anchorW = sbClumpAnchor(winnerCell, epochW);
      float baseRW = sbClumpBaseR(winnerCell);
      float stampR = baseRW * GHOST_STAMP_FRAC * scaleEnvW;

      vec2 lp = fieldUv - anchorW;
      float ca = cos(stampAngle);
      float sa = sin(stampAngle);
      vec2 rp = vec2(ca * lp.x + sa * lp.y, -sa * lp.x + ca * lp.y);
      float motifMask = sbGhostMotifMask(motifId, rp, stampR);

      // Inset band on the winner clump's OWN sdf (sdNearest, already in
      // hand) keeps the stamp off the silhouette edge entirely -- never a
      // stamp bisected by its own clump's rim, only by the (separate)
      // sterility front via livingMask below.
      float insetBand = baseRW * GHOST_INSET_FRAC;
      float interiorMask = 1.0 - smoothstep(-insetBand, 0.0, sdNearest);

      // livingMask here is the SAME multiply edgeMask/rim already apply
      // above -- a clump half-scrubbed by the front shows only the stamp's
      // living-side half, automatically, with no extra bookkeeping.
      float stampCoverage = motifMask * interiorMask * livingMask;

      if (ghostDebug) {
        col = mix(col, GHOST_DEBUG_CREAM, stampCoverage);
      } else {
        // INK, not a new colour: mix-darken toward the clump's own deep
        // interior tone at a low, further uGhostAmp-scaled alpha -- "half-
        // remembered in the tissue", never an imported bright shape.
        col = mix(col, interior, stampCoverage * GHOST_ALPHA * uGhostAmp);
      }
    }
  }

  return col;
}

// Strike geometry & envelope constants (increment 4, fracture shape landed
// increment 10). K_BLEND is now POKE-ONLY (sbSterility's poke loop below) --
// a rebloom stays soft and organic, unlike a fracture's own tight K_STRIKE
// blend (see its own doc just below): the two merges read as genuinely
// different materials meeting S, which is the point -- a poke pushes the
// boundary back out with a rounded, living-tissue seam, while a fracture
// carves in with a hairline crack seam. STRIKE_GROW/STRIKE_SETTLE shape the
// age->radius envelope: 0->1.08x rMax over [0, STRIKE_GROW] (punch-in
// overshoot), eased back 1.08x->1.0x over [STRIKE_GROW, STRIKE_SETTLE]
// (settle), holding at 1.0x from then on -- healRate (if > 0) then shrinks
// from that settled 1.0x, exactly matching the CPU's own healed-radius-
// reaches-zero bookkeeping (index.ts's ageStrikes) so a slot frees the
// instant its GPU radius would hit 0.
const float K_BLEND = 0.05;
const float STRIKE_GROW = 0.18;
const float STRIKE_SETTLE = 0.3;
const float STRIKE_RIM_YOUNG = 0.5; // seconds -- the young-strike rim-pop window

// Fracture shape constants (increment 10, "shattered chip" revision of the
// old smooth rotated-ellipse wound -- artist note: the white ovals should
// read as cracks in the scene, not clean wounds; revised a second time
// after a first-cut review found neither half of the shape actually read as
// a fracture -- see sbFractureSd's own doc for both fixes' reasoning).
// FACET_SECTORS (an int, since it now bounds a loop -- see sbFractureSd)
// is the count of hashed half-planes whose intersection forms the faceted
// core; FACET_MIN/MAX bound each half-plane's offset (apothem) as a
// fraction of r. SPLINT_LEN_MIN/MAX bound each radiating splinter's total
// length (x r), split 55/45 across its two kinked legs. SPLINT_W is a
// splinter's half-width (x r) at its base, tapering to 0 at its tip;
// SPLINT_SMIN is the tight blend fusing each splinter into the core (small,
// so splinters read as distinct shards, not a fused starburst). K_STRIKE is
// the fracture<->S merge blend -- deliberately far tighter than K_BLEND
// (5-10x a fissure's own width would smooth the splinters out of existence
// or bloat them into a blob; see sbFractureSd's own doc for the exact width
// comparison). STRIKE_CREEP_RATE is the failed-crack widening rate
// (sbSterility's strike loop, else branch) -- ~25% wider over a failed
// strike's STRIKE_FAIL_HOLD-second hold (index.ts), the artist's "creep
// wider over their life" note.
const int FACET_SECTORS = 7;
const float FACET_MIN = 0.55;
const float FACET_MAX = 0.95;
const float SPLINT_LEN_MIN = 1.35;
const float SPLINT_LEN_MAX = 2.15;
const float SPLINT_W = 0.11;
const float SPLINT_SMIN = 0.004;
const float K_STRIKE = 0.008;
const float STRIKE_CREEP_RATE = 0.018;

// Age -> radius fraction of rMax (0..~1.08), the punch-in/overshoot/settle
// curve described above. Healing (age past STRIKE_SETTLE, healRate > 0) is
// applied by the caller on top of this, matching the task's literal
// r = rMax * max(0, 1 - healRate * max(0, age - STRIKE_SETTLE)) formula --
// at STRIKE_SETTLE this curve is already exactly 1.0, so the two pieces
// connect continuously.
float sbStrikeRadiusNorm(float age) {
  if (age < STRIKE_GROW) {
    float t = age / STRIKE_GROW;
    float te = t * t * (3.0 - 2.0 * t);
    return te * 1.08;
  } else if (age < STRIKE_SETTLE) {
    float t = (age - STRIKE_GROW) / (STRIKE_SETTLE - STRIKE_GROW);
    float te = t * t * (3.0 - 2.0 * t);
    return mix(1.08, 1.0, te);
  }
  return 1.0;
}

// Shattered-chip SDF (increment 10, second revision -- a first cut missed
// the "crack" read on BOTH halves, per direct review of a ?crack=4
// screenshot; each fix documented at its own site below). Built in the SAME
// local frame as the old ellipse (rotate (p - center) by angle, then scale
// the rotated y by aspect) so the call site barely changes. fseed (a
// per-strike hash derived by the caller from values already baked at fire
// time -- center/angle/rMax -- so it is STABLE for a strike's whole life
// and distinct per strike, with no new uniform needed) reseeds the facet
// planes and the splinter layout so no two strikes look identical. Standard
// SDF sign convention: negative inside, positive outside.
float sbFractureSd(vec2 p, vec2 center, float r, float aspect, float angle, float fseed) {
  vec2 d = p - center;
  float ca = cos(angle);
  float sa = sin(angle);
  vec2 rp = vec2(ca * d.x + sa * d.y, -sa * d.x + ca * d.y);
  rp.y *= aspect;

  // Faceted core: the intersection of FACET_SECTORS hashed half-planes
  // (sd = max over all i of dot(rp,nrm_i) - h_i), NOT the first cut's
  // radius-linear-in-theta interpolation. That first cut WAS linear (not
  // smoothstep, as the spec demanded) but still produced a smooth ARC
  // between sample angles, not a straight chord: interpolating a RADIUS is
  // interpolating a point that stays on a circle of that radius, i.e.
  // parameterizing an arc, regardless of how the interpolation weight
  // itself is computed -- at 4x scale (?crack=4) it read as a plain egg. A
  // half-plane's boundary is by definition a straight LINE, so intersecting
  // several of them (each constraining rp to stay on one side) yields
  // genuinely flat facet edges meeting at sharp corners -- the actual
  // geometric primitive "faceted" requires. Each half-plane's outward
  // normal angle is jittered within its own 1/FACET_SECTORS wedge of the
  // circle (0.5 * hh.x keeps the jitter inside the first half of that
  // wedge, so adjacent normals can never cross past each other or coincide
  // -- the minimum angular gap between neighbours is a full half-wedge,
  // pi/FACET_SECTORS, which keeps every vertex distance close to its
  // apothem, never blowing up), and its offset (apothem) hashed within
  // [FACET_MIN, FACET_MAX] * r. Bonus: each half-plane's gradient is
  // exactly unit-length (grad of dot(rp,nrm) is nrm, |nrm|=1), so this is
  // cheaper than the old atan/mix chain too.
  float sd = -9.0;
  for (int i = 0; i < FACET_SECTORS; i++) {
    float fi = float(i);
    vec2 hh = sbHash22(vec2(fi * 7.7 + 2.0, fseed * 31.7));
    float a = (fi + 0.5 * hh.x) / float(FACET_SECTORS) * 6.28318531;
    vec2 nrm = vec2(cos(a), sin(a));
    float h = r * mix(FACET_MIN, FACET_MAX, hh.y);
    sd = max(sd, dot(rp, nrm) - h);
  }

  // Radiating splinters: SPLINTERS (quality-baked, see SterileShaderConfig)
  // two-segment KINKED tapered capsules from the centre, angles spread
  // evenly (with per-shard jitter) so they never bunch on one side. A
  // single straight tapered capsule (the first cut) reads as a drawn
  // needle/antenna, not a crack; a kink partway along -- direction changes
  // once, by a hashed +/-~25.8 degree turn (0.9 rad half-range) at 55% of
  // the shard's length -- reads as a crack that PROPAGATED, tearing off in
  // a new direction, which is what actually sells "fracture" over "spike."
  // Both segments' t (and therefore taper) are computed inline, same
  // reasoning as the first cut for not using sbSdSegment.
  for (int i = 0; i < SPLINTERS; i++) {
    float fi = float(i);
    vec2 hs = sbHash22(vec2(fi * 13.3 + 1.0, fseed * 57.1));
    float sAng = (fi + hs.x) / float(SPLINTERS) * 6.28318531;
    float sLen = r * mix(SPLINT_LEN_MIN, SPLINT_LEN_MAX, hs.y);

    vec2 dir = vec2(cos(sAng), sin(sAng));
    float kink = (sbHash21(vec2(fi * 3.1 + 5.5, fseed * 71.3)) - 0.5) * 0.9;
    vec2 mid = dir * (sLen * 0.55);
    float ck = cos(kink);
    float sk = sin(kink);
    vec2 dir2 = vec2(ck * dir.x - sk * dir.y, sk * dir.x + ck * dir.y);
    vec2 tip = mid + dir2 * (sLen * 0.45);

    float wBase = r * SPLINT_W;
    float wMid = wBase * 0.45;

    // Leg 1: base (rp local origin) -> mid, taper wBase -> wMid.
    float t1 = clamp(dot(rp, mid) / dot(mid, mid), 0.0, 1.0);
    float wid1 = mix(wBase, wMid, t1);
    float dSeg1 = length(rp - mid * t1) - wid1;
    sd = sbSmin(sd, dSeg1, SPLINT_SMIN);

    // Leg 2: mid -> tip, taper wMid -> 0.
    vec2 leg2 = tip - mid;
    float t2 = clamp(dot(rp - mid, leg2) / dot(leg2, leg2), 0.0, 1.0);
    float wid2 = mix(wMid, 0.0, t2);
    float dSeg2 = length(rp - (mid + leg2 * t2)) - wid2;
    sd = sbSmin(sd, dSeg2, SPLINT_SMIN);
  }
  return sd;
}

// Poke (rebloom) geometry & envelope constants (increment 5). Unlike a
// strike's per-instance rMax/healRate (uStrikeB), every poke shares the
// exact same fixed age->radius envelope, so index.ts's CPU pool needs no
// second baked-constants array -- just a plain fixed-lifetime SlotPool.age()
// call timed to POKE_GROW+POKE_HOLD+POKE_RESCRUB (index.ts's POKE_LIFETIME),
// which MUST mirror the spans below exactly so the CPU frees the slot the
// instant this curve reaches back to 0. POKE_RIM_YOUNG mirrors
// STRIKE_RIM_YOUNG's role (main()'s tick-driven rim-pop boost).
const float POKE_R_MAX = 0.09;
const float POKE_GROW = 0.3;
const float POKE_HOLD_END = 4.3; // POKE_GROW + 4.0s hold
const float POKE_RESCRUB_END = 7.3; // POKE_HOLD_END + 3.0s re-scrub
const float POKE_RIM_YOUNG = 0.5; // seconds -- the young-poke rim-pop window

// Age -> radius (field-uv), the poke's fixed grow/hold/re-scrub curve: an
// ease-out cubic climb to POKE_R_MAX over POKE_GROW, a hold at POKE_R_MAX,
// then an eased (smoothstep) close back to 0 over the final POKE_RESCRUB
// seconds -- the ground scrubbing itself shut again once the tap's living
// patch has had its moment.
float sbPokeRadius(float age) {
  if (age < POKE_GROW) {
    float t = age / POKE_GROW;
    return POKE_R_MAX * (1.0 - pow(1.0 - t, 3.0));
  } else if (age < POKE_HOLD_END) {
    return POKE_R_MAX;
  } else if (age < POKE_RESCRUB_END) {
    float t = (age - POKE_HOLD_END) / (POKE_RESCRUB_END - POKE_HOLD_END);
    float te = t * t * (3.0 - 2.0 * t);
    return POKE_R_MAX * (1.0 - te);
  }
  return 0.0;
}

// The signed sterility field S(p): positive = sterile, negative = living,
// the zero-crossing IS the scrub line. phi is a stretched, noise-wobbled
// distance from the pocket (the LAST living place); R shrinks from uRMax
// toward 0 as uSterile climbs from 0 to 1, so the living island (phi < R)
// shrinks from the whole visible field down to a single point. The wobble
// is TWO-SCALE (composition round): a coarse, low-frequency fbm term (p *
// 1.2, drifting at 0.6x the fine term's rate) weighted 2x a finer term (p *
// 3.0, the original increment-3 frequency), averaged 2:1 so FRONT_NOISE_AMP
// stays a comparable amplitude knob. The coarse term is what makes whole
// LOBES of the front finger ahead of or lag behind the mean radius (an
// advancing bleach stain, not a smoothly shrinking circle); the fine term
// keeps the edge itself from reading as a bare polygon.
//
// Increment 4: swab strikes fold in here, the EXTENSION POINT the increment-
// 3 doc promised -- every caller below (biomass truncation, the diagnostic
// solo modes, the scrub line) reads S through this one function, so a
// strike carving into it is automatically visible everywhere at once. Each
// active strike is now (increment 10, the "shattered chip" artist revision)
// a fracture: its OWN sdf (sbFractureSd, negative inside) is negated
// (positive inside, i.e. sterile) and smax'd into the running S with
// sbSmax/K_STRIKE -- a much TIGHTER blend than a poke's K_BLEND (see
// K_STRIKE's own doc for why: a fracture's splinters are only a fraction of
// K_BLEND wide and would smooth away entirely at that radius) -- exactly
// the SDF-subtraction identity max(a, -b) = a MINUS shape-b's interior --
// so a strike always pushes its interior toward sterile regardless of what
// the front alone would say there, and its rim reads as a genuine
// (smax-rounded) S=0 boundary, which is why the scrub line automatically
// traces it (facets, splinters and all) with no separate drawing pass. w
// (index.ts's fade-on-expiry for failed, unhealed strikes) blends the WHOLE
// smax'd result back toward the pre-strike S rather than scaling the raw
// sdf contribution directly -- scaling the raw contribution would drag S
// toward 0 everywhere (not just near the strike) as w shrinks, since an
// unbounded sdf value far from the strike shrinks right along with it;
// blending the final scalar has no such footgun and still satisfies "scale
// the strike's effect by w" (w=0 is an exact no-op, w=1 is the full smax).
// A failed (healRate == 0) strike's radius CREEPS wider over its hold
// instead of holding fixed (STRIKE_CREEP_RATE, the strike loop's else
// branch below) -- the artist's "creep wider" note; this is purely a GPU
// radius-envelope change and does not touch index.ts's ageStrikes free
// timing, which for a failed strike already frees on a fixed
// STRIKE_FAIL_HOLD-second timer regardless of radius (see ageStrikes' own
// doc). Increment 5's pokes then fold in with
// the OPPOSITE operator: sbSmin (not smax) pulls S toward whichever is
// SMALLER (more living), so a poke's circle always pushes its interior
// toward living regardless of what the front/strikes alone would say there
// -- pushing the boundary back OUT instead of carving in. No w-blend is
// needed for pokes the way strikes need one: a poke's own radius envelope
// (sbPokeRadius) already returns exactly 0 at both its birth and its
// re-scrubbed end, so skipping the merge below r<=0.0001 is already a clean
// no-op at both ends. eventRimD (out param, renamed from increment 4's
// strike-only strikeRimD now that pokes contribute too) is written to the
// closest approach, in local sdf units, to any currently active strike
// younger than STRIKE_RIM_YOUNG OR poke younger than POKE_RIM_YOUNG --
// consumed by main()'s young-event rim-pop boost so that pass doesn't need
// its own second loop over STRIKE_SLOTS/POKE_SLOTS.
float sbSterility(vec2 p, out float eventRimD, out float strikeIn) {
  vec2 d = (p - uPocket) * uStretch;
  float fineN = sbFbm(p * 3.0 + uFrontDrift) - 0.5;
  float coarseN = sbFbm(p * 1.2 + uFrontDrift * 0.6) - 0.5;
  float wobbleN = (coarseN * 2.0 + fineN) / 3.0;
  float wobble = 1.0 + FRONT_NOISE_AMP * uFrontNoise * wobbleN;
  float phi = length(d) * wobble;
  float R = uRMax * (1.0 - uSterile);
  float s = phi - R;

  // Front crazing (increment 10, artist note: give the front's own leading
  // edge a slight fracture/crazing so it's family-resemblant to the
  // strikes' cracks). Hashed on ARC POSITION (theta * R, the same idiom as
  // main()'s scrub-line glint/crackle hash just below) rather than a radial
  // wedge count, so the chatter cells stay a roughly CONSTANT physical size
  // along the boundary regardless of how far out it currently sits. Mean-
  // zero (hash - 0.5) and tiny (~0.4% of R), confined to within ~0.05 sdf
  // units of the boundary by the exp() falloff -- so the front's overall
  // silhouette, pacing, and the CPU's rMaxEff calibration (which reasons
  // about the noise-free front) are all unaffected; only the edge itself
  // reads slightly crazed.
  const float FRONT_CRAZE_CELLS = 90.0;
  const float FRONT_CRAZE_AMP = 0.004;
  const float FRONT_CRAZE_FALL = 60.0;
  float crazeTheta = atan(d.y, d.x);
  float crazeCell = floor(crazeTheta * R * FRONT_CRAZE_CELLS);
  float craze = sbHash21(vec2(crazeCell, 5.5)) - 0.5;
  s += craze * FRONT_CRAZE_AMP * uFrontNoise * exp(-abs(s) * FRONT_CRAZE_FALL);

  eventRimD = 9.0;
  // Round-2 artist note ("could the crack contents be a warped mixture of
  // the other colours nearby instead?"): strikeIn tracks the deepest any
  // active STRIKE (never a poke -- see the poke loop below, which never
  // touches this) currently reaches into its own fracture interior, so
  // main() can shade that interior as a warped biomass smear instead of
  // plain sterile blank. Large negative default (not 0) so "no active
  // strike reaches here" reads unambiguously below any real fracture's
  // -fractureSd*w, which is always >= 0 wherever a strike is live.
  strikeIn = -9.0;
  for (int i = 0; i < STRIKE_SLOTS; i++) {
    float w = uStrikeA[i].w;
    if (w <= 0.0) continue;
    vec2 center = uStrikeA[i].xy;
    float age = uStrikeA[i].z;
    float rMax = uStrikeB[i].x;
    float aspect = uStrikeB[i].y;
    float angle = uStrikeB[i].z;
    float healRate = uStrikeB[i].w;

    float r = rMax * sbStrikeRadiusNorm(age);
    if (healRate > 0.0) {
      r *= max(0.0, 1.0 - healRate * max(0.0, age - STRIKE_SETTLE));
    } else {
      // Failed (permanently unhealed) crack: creeps ~25% wider over its
      // STRIKE_FAIL_HOLD-second hold rather than sitting static -- the
      // artist's "creep wider" note. Safe for index.ts's ageStrikes free
      // timing: that closed-form calc only applies to the healRate > 0
      // branch above; a failed strike frees on ageStrikes' own fixed
      // STRIKE_FAIL_HOLD timer regardless of this radius.
      r *= 1.0 + STRIKE_CREEP_RATE * max(0.0, age - STRIKE_SETTLE);
    }
    if (r <= 0.0001) continue; // fully healed -- no wound left to merge

    // Perf cull (increment 10, recomputed for the kinked two-segment
    // splinters): skip strikes whose fracture SDF cannot possibly reach
    // this fragment. aspect >= 1.15 only ever SHRINKS the shape along local
    // y, so bound the max world extent from center in the UNSCALED local
    // frame (a conservative superset of the actual aspect-shrunk shape).
    // SPLINTER REACH: a splinter's tip is base + mid-leg (length 0.55*sLen)
    // + rotated tip-leg (length 0.45*sLen); by the triangle inequality
    // |tip| <= 0.55*sLen + 0.45*sLen = sLen regardless of the kink angle
    // (rotating the second leg can only shorten the straight-line reach
    // versus the unkinked case, never lengthen it -- equality only at zero
    // kink), and sLen <= SPLINT_LEN_MAX * r. Every point on either leg's
    // capsule is within one leg's own half-width of that leg's segment, and
    // a segment's own farthest point from the origin is always one of its
    // two endpoints (squared distance along a straight segment is a convex
    // function of the segment parameter), so no interior point of either
    // capsule can exceed endpoint-reach + width-there. Adding the single
    // largest width anywhere on the shard (SPLINT_W * r, at the base, even
    // though that point's own reach is ~0) is a deliberately loose
    // over-count that keeps this a one-line bound without a tighter
    // per-leg case split: max reach <= (SPLINT_LEN_MAX + SPLINT_W) * r =
    // (2.15 + 0.11) * r = 2.26 * r. FACET REACH: the faceted core's
    // vertices (where two adjacent half-planes cross) sit at apothem /
    // cos(half the angular gap between their normals); the construction's
    // minimum angular gap is pi/FACET_SECTORS = pi/7 (~25.7 deg, see
    // sbFractureSd's own doc), giving a worst-case vertex distance of
    // FACET_MAX * r / cos(pi/14) = 0.95r / 0.975 ~= 0.974 * r -- well under
    // the splinter bound above, so splinters alone drive the cull. The 2.4
    // multiplier below sits comfortably above the derived 2.26 (a little
    // extra headroom for the informal, non-tight per-leg width argument
    // above); +0.04 covers K_STRIKE's own blend radius plus slop. This
    // cannot cause a visible discontinuity: at that distance sbFractureSd
    // is provably >= 0.04, sbSmax with k = K_STRIKE (0.008) has negligible
    // influence far beyond k, and a fragment's S is only visibly perturbed
    // where strikeSd is within ~K_STRIKE of -s (i.e. right at the
    // boundary) -- a culled, deep-living shift in S is invisible because
    // every consumer (livingMask, sbSearchGate) only ever reads S near
    // zero.
    if (length(p - center) > r * 2.4 + 0.04) continue;

    // Per-strike shape seed (increment 10): derived from values already
    // baked at fire time (center/angle/rMax), stable for the strike's whole
    // life and distinct per strike -- no new uniform needed since
    // uStrikeA/uStrikeB are already fully packed (8/8 components).
    float fseed = sbHash21(center * 41.7 + vec2(angle * 3.3, rMax * 97.1));
    float fractureSd = sbFractureSd(p, center, r, aspect, angle, fseed);
    // -fractureSd is positive INSIDE this strike's fracture (fractureSd's
    // own sign convention, negative inside); scaled by w (this strike's own
    // fade) so an expiring, fading-out strike's interior fades its warp-
    // smear contribution right along with it. max'd across every active
    // strike (not summed) so overlapping fractures read as "whichever is
    // deepest here", matching how the S-field itself already unions them.
    strikeIn = max(strikeIn, -fractureSd * w);
    float sWithStrike = sbSmax(s, -fractureSd, K_STRIKE);
    s = mix(s, sWithStrike, w);

    if (age < STRIKE_RIM_YOUNG) {
      eventRimD = min(eventRimD, abs(fractureSd));
    }
  }

  for (int i = 0; i < POKE_SLOTS; i++) {
    float pw = uPoke[i].w;
    if (pw <= 0.0) continue;
    vec2 center = uPoke[i].xy;
    float age = uPoke[i].z;
    float r = sbPokeRadius(age);
    if (r <= 0.0001) continue; // not yet grown / already re-scrubbed shut

    float pokeSd = length(p - center) - r; // circle SDF, negative inside
    s = sbSmin(s, pokeSd, K_BLEND);

    if (age < POKE_RIM_YOUNG) {
      eventRimD = min(eventRimD, abs(pokeSd));
    }
  }

  return s;
}

// Living-side ground churn (artist note, this increment): "instead of just a
// pure black background, there could be some more interesting dark gradients
// bubbling behind and adding more to the atmosphere". Replaces the old flat
// groundLiving constant on the living side ONLY (the sterile side keeps
// sbSterileSide below, untouched) with a slow-churning warm-dark field: masses
// visibly RISING (the sampling domains drift DOWNWARD in p, so noise features
// appear to climb) and bubbling in the gaps between clumps, cooling toward ash
// near the sterilization front. Deliberately differentiated from the album's
// other two dark atmospheric grounds by all three axes an artist reads as a
// "treatment family", not just a palette: HUE (warm oxblood/umber here, vs
// a1-primordial's indigo/violet domain-warped nebula and b1-biosphere's dark
// plum dish ground), MOTION (masses rising/bubbling, vs a1's drifting cloud
// or b1's near-static mottle), and SPATIAL COUPLING (cools toward
// GROUND_ASH as it nears the S=0 front via the nearFront term below — a move
// only b3 can make, since only b3 has an advancing boundary). uGroundPhase
// (index.ts) is a pure function of songTime, not accumulated, matching
// finalEnvAt's precedent so ?t= deep links reproduce exactly. A hard luma
// ceiling (GROUND_LUMA_CAP) at the end is ENFORCED, not merely tuned-in, so
// this can never accidentally out-brighten sbBiomass's own interior tone
// (vec3(0.30,0.06,0.14)) regardless of what upstream mixes do.
//
// Palette revision (post-review): the first-cut anchors (oxblood at luma
// ~0.026) were chosen by intuition and measured functionally invisible
// without an artificial brightness boost -- the same "light-on-dark/dark-
// on-dark values chosen by eye read as near-black in a real screenshot"
// failure this file's own increment-8 doc already flagged once for the
// final-fog tone. Root cause: warm dark reds carry very little luma (the
// luma dot's red coefficient is only 0.2126), so a "dark warm red" that
// LOOKS reasonable as an RGB triple can still measure far under any
// reasonable cap, leaving the cap never the binding constraint -- the
// anchors were. Raised so the anchors themselves clear visibility WITHOUT
// any boost, verified against a real unboosted framebuffer readback:
// red-channel bubble crests in the composed gaps land ~30-45/255, the
// trough-to-crest luma ratio is >=2.5x (so the churn reads as structure/
// motion, not a flat wash), and the brightest measured ground luma still
// sits under GROUND_LUMA_CAP (0.10, itself comfortably under the biomass
// interior tone's own ~0.11 luma) -- the cap is now genuinely load-bearing
// at GROUND_UMBER's peak instead of every anchor already sitting far
// beneath it.
//
// Round-2 palette revision (artist taste pass: "make the background richer
// as well -- it still reads as pretty much black"). Anchors raised roughly
// 1.8-2x again (OXBLOOD/UMBER red channel ~0.165 -> ~0.40-0.44) and
// GROUND_LUMA_CAP raised 0.10 -> 0.17; a third hue anchor (GROUND_MOSS, a
// dark green-brown) was added purely for patch-to-patch variety -- chosen,
// per the task's own instruction, to stay clear of a1-primordial's
// indigo/violet nebula (index.ts: vec3(0.024,0.016,0.08) ->
// vec3(0.10,0.03,0.22), B-channel-led) and b1-biosphere's plum dish ground
// (dishShader.ts's groundAt: vec3(0.055,0.02,0.07), B > R) -- moss leans
// green/brown, neither blue nor magenta, so the family still reads warm
// and unmistakably b3's own. A single extra high-frequency sbVnoise sample
// (nDetail below) layers a third octave of detail into n independent of
// FBM_OCT, so Lite (2 sbFbm octaves) still gets the finer churn structure;
// the bubble band was also narrowed (0.44-0.74 -> 0.40-0.66) and given its
// own crest-highlight multiply for sharper trough-to-crest contrast, per
// the "rich churn, not gentle mottle" note. Verified against a real
// UNBOOSTED framebuffer readback (see this increment's own report): red-
// channel ground crests land ~80-88/255 across the acts' actual heat range
// (0.45-1.0, sections.ts), trough-to-crest luma ratio stays >=10x (far
// past the >=3x bar), and peak ground luma sits at the 0.17 cap -- still
// well under the biomass CROWN tones (sbClumpCrown: magenta/amber/rust-
// green, luma ~0.34-0.6) that must keep dominating the composition, even
// though it can now sit at or fractionally above the biomass interior
// base tone's own ~0.117 luma at the ground's very brightest crest pixels
// -- the crowns, rim highlights and speckle are what read as "the
// clumps", and they still clear the ground by a wide margin.
const vec3 GROUND_DEEP = vec3(0.022, 0.011, 0.017);
const vec3 GROUND_OXBLOOD = vec3(0.44, 0.075, 0.088);
const vec3 GROUND_UMBER = vec3(0.40, 0.120, 0.048);
const vec3 GROUND_MOSS = vec3(0.075, 0.105, 0.040);
const vec3 GROUND_ASH = vec3(0.075, 0.105, 0.120);
const vec3 GROUND_CHALK = vec3(0.125, 0.120, 0.115);
const float GROUND_LUMA_CAP = 0.17;

vec3 sbDeepGround(vec2 p, float s) {
  float t = uGroundPhase;
  vec2 q = p * 2.05;
  // Sampling domains drift DOWNWARD so features appear to rise.
  vec2 w = vec2(sbFbm(q * 0.85 + vec2(0.0, -t * 0.32)),
                sbFbm(q * 0.85 + vec2(4.7, 2.1) + vec2(0.0, -t * 0.27)));
  // Round-2: one extra, independent high-frequency octave (a single
  // sbVnoise sample, not another sbFbm call) layered into n on top of
  // sbFbm's own Full/Lite-budgeted octaves (FBM_OCT) -- cheap (one noise
  // call), earns its cost by keeping fine churn detail present even on
  // Lite's 2-octave sbFbm.
  float nBase = sbFbm(q + w * 1.15 + vec2(0.0, -t * 0.45));
  float nDetail = sbVnoise(q * 4.3 + w * 1.6 + vec2(0.0, -t * 0.6));
  float n = mix(nBase, nDetail, 0.22);
  // Bubbles: higher-contrast masses rising FASTER than the murk behind
  // them -- band narrowed (was 0.44-0.74) for sharper crest/trough
  // contrast, the "rich churn, not gentle mottle" note.
  float bub = smoothstep(0.40, 0.66, sbFbm(q * 1.55 + w * 0.55 + vec2(0.0, -t * 0.72)));

  vec3 g = mix(GROUND_DEEP, GROUND_OXBLOOD, smoothstep(0.28, 0.72, n));
  g = mix(g, GROUND_UMBER, bub * 0.65);
  // Third hue anchor (moss, round 2): a separate, slower-drifting domain
  // (hueVar) so patches of ground occasionally lean green-brown instead of
  // red/amber, for variety, without diluting the family's overall warm
  // read (weight capped at 0.4, only where hueVar itself runs high).
  float hueVar = sbFbm(q * 0.6 + vec2(11.3, -5.7) + vec2(0.0, -t * 0.18));
  g = mix(g, GROUND_MOSS, smoothstep(0.55, 0.85, hueVar) * 0.4);
  // Crest highlight (round 2): bubbling masses read brighter, not just
  // differently hued, sharpening the trough-to-crest ratio further.
  g *= 1.0 + bub * 0.15;
  g *= mix(0.85, 1.15, uHeat);
  float nearFront = clamp(1.0 - smoothstep(0.0, 0.20, -s), 0.0, 1.0);
  g = mix(g, GROUND_ASH, nearFront * 0.45);
  g *= 1.0 + 0.12 * uBreath * (n - 0.5);
  g = mix(g, GROUND_CHALK, uPaleness * 0.4);
  // Hard ceiling: this must never compete with the biomass CROWN tones
  // (sbClumpCrown, luma ~0.34-0.6). Enforced, not merely intended. Raised
  // (round 2) from 0.10 to 0.17.
  float luma = dot(g, vec3(0.2126, 0.7152, 0.0722));
  g *= min(1.0, GROUND_LUMA_CAP / max(luma, 1e-4));
  return g;
}

// Crack-interior warp smear (round-2 artist note): a swab strike's own
// fracture interior no longer reads as the flat sterile blank -- that read
// as "pasted on" and disconnected from everything around it. Instead it
// samples the LIVING biomass field at a domain-warped + rotationally
// sheared offset of the same point, over the deep ground (not the sterile
// one), so the interior shows a wrenched, deranged smear of the tissue
// colours actually nearby rather than an imported blank. sbDeepGround is
// called with s=-1.0 (deep living) rather than the real S, so the ash-
// near-front cooling term never kicks in here -- gaps in the warped
// biomass sample read as murk, not pale sterile ground, EXCEPT for the
// deliberate depth-scaled bleach mixed in at the very end (still caused by
// sterility, just legible as glass rather than blank). Only ever called
// from main()'s strikeIn > 0.0 gate (see that call site's own doc) -- the
// second sbBiomass call here is real cost, so it must never run on a
// fragment outside an active fracture.
vec3 sbCrackFill(vec2 p, float strikeIn) {
  // Warp: a swirl (rotational shear, so the smear reads as WRENCHED, not
  // merely offset) plus two-channel fbm noise. Round-2b (artist re-review):
  // clump spacing is 1/CLUMP_FREQ ~= 0.143 field-uv, and the original
  // warpAmp=0.055 (0.11 field-uv of displacement, * 2.0 below) was nearly a
  // full cell wide -- the warped sample frequently landed in the GAP
  // between clumps, reading near-black at normal crack size (the same
  // "reads as pretty much black" note the artist gave the background).
  // Cut to 0.022 (0.044 field-uv, ~a third of a cell) so the sample stays
  // inside the local neighbourhood and usually lands on tissue; the swirl
  // factor is scaled down to match (0.02 -> 0.011) so the shear still reads
  // as a wrench at the smaller displacement rather than dominating it.
  float warpAmp = 0.022;
  vec2 wq = p * 3.1;
  vec2 warp = vec2(sbFbm(wq + vec2(0.0, uGroundPhase * 0.2)) - 0.5,
                    sbFbm(wq + vec2(7.3, 2.9) - vec2(uGroundPhase * 0.17, 0.0)) - 0.5);
  float sh = 1.15;
  vec2 rel = p - 0.5;
  vec2 swirl = vec2(-rel.y, rel.x) * sh * 0.011;
  vec2 pw = p + warp * warpAmp * 2.0 + swirl;

  // Sample the living biomass field at the warped point, forced-search
  // (FORCE_SEARCH_S, same sentinel solo modes 1/4 use) and full living
  // mask, over the deep ground evaluated at s=-1.0 (see this function's own
  // doc) so a warped sample landing in a gap between clumps reads as murk.
  vec3 c = sbBiomass(pw, sbDeepGround(pw, -1.0), 1.0, FORCE_SEARCH_S, false);

  // Round-2b: guarantee some local hue even when the (now much shorter)
  // warp still lands on a gap -- the unwarped neighbourhood's own crown
  // colour, recovered cheaply from the fragment's own cell (no second
  // search: sbClumpCrown is a pure per-cell hash, not a distance query, so
  // this doesn't need to know whether that cell's clump is even currently
  // present/alive), mixed in at low weight, dimmed to 0.55x so it reads as
  // a tint hinting at the neighbourhood rather than a bright patch
  // competing with real biomass. Applied BEFORE the contrast lift/bleach
  // below so it rides along with the rest of the shading.
  vec3 crownHint = sbClumpCrown(floor(p * CLUMP_FREQ));
  c = mix(c, crownHint * 0.55, 0.30);

  // Fractured-glass treatment: a modest contrast lift, then a depth-scaled
  // push toward the sterile pale (deeper into the crack = slightly more
  // bleached, since sterility is still what tore it open) plus a faint
  // cool sheen -- kept small (0.28 ceiling) so the result stays legibly a
  // warped colour MIXTURE dominated by the surrounding hues, never a pale
  // field on its own.
  c = mix(c, c * 1.18, 0.6);
  c = mix(c, vec3(0.80, 0.86, 0.90), clamp(strikeIn * 4.0, 0.0, 1.0) * 0.28);
  return c;
}

// The sterile side's layered appearance (increment 3): (1) a cold
// blue-white base — this must stay clearly COLD, never warm bone/cream
// (that's b2's ground); (2) a slow-drifting specular dot-product ramp
// (strength x uSterileSpec) plus a broad darker corner falloff (SCREEN
// space — a vignette on the viewport, not the world); (3) watermarks —
// ultra-faint frozen prints of erased biomass (sbWatermarkSd), fading with
// depth into the sterile field via WM_FALL. s is the caller's already-
// computed sbSterility(fieldUv) value, reused here for the watermark's
// near-front-vs-deep-blank falloff. The scrub line itself (layer 4) is
// drawn separately, LAST, in main().
vec3 sbSterileSide(vec2 fieldUv, float s) {
  vec3 col = vec3(0.875, 0.914, 0.933);

  // Slow-moving specular gradient: one dot-product ramp against a slowly
  // drifting direction, brightening toward a near-white highlight.
  vec2 specDir = normalize(vec2(sin(uTime * 0.05), cos(uTime * 0.037)));
  float specRamp = clamp(dot(fieldUv - 0.5, specDir) * 1.6 + 0.5, 0.0, 1.0);
  col = mix(col, vec3(0.957, 0.976, 0.988), specRamp * uSterileSpec);

  // Broad darker corner fall (screen-space, always present at a fixed
  // subtle weight — a structural vignette, not a specular effect).
  float cornerDist = length((vUv - 0.5) * uCover);
  float cornerFall = smoothstep(0.35, 0.95, cornerDist);
  col = mix(col, vec3(0.788, 0.847, 0.886), cornerFall * 0.35);

  // Watermarks: faint prints of erased biomass, sampled from the SAME clump
  // cell SDF with a FROZEN life clock / full presence / zero breath —
  // frozen ghosts, not living forms (no rim, no speckle). Side-gated
  // (increment 9): skipped once s clears -sbSearchGate() on the living
  // side, where a watermark could never show -- this composed-scene call's
  // contribution there is already zeroed by main()'s own outer
  // mix(groundLiving, sterileBase, 1-livingMask) anyway. Mode 5
  // (?solo=sterile, this function's only other caller) is a debug-only
  // diagnostic where the gate additionally trims a pre-existing quirk: the
  // un-gated wmAlpha formula below never zeroed on the living side either,
  // so that mode used to show a faint watermark ghost even where S said
  // "living" -- gating removes that debug-only artifact, nothing
  // composed-scene-visible.
  float wmSd = 9.0;
  if (s > -sbSearchGate()) {
    wmSd = sbWatermarkSd(fieldUv);
  }
  float wmAA = sbAA() * 0.75 + 0.0004;
  float wmMask = clamp(1.0 - smoothstep(-wmAA, wmAA, wmSd), 0.0, 1.0);
  float wmAlpha = clamp(uWatermark * 0.35 * exp(-max(s, 0.0) * WM_FALL) * wmMask, 0.0, 1.0);
  col = mix(col, vec3(0.80, 0.86, 0.89), wmAlpha);

  return col;
}

// Condensation bloom render constants (increment 5) -- BLOOM_LIFETIME MUST
// mirror index.ts's own BLOOM_LIFETIME (the CPU pool's SlotPool.age()
// deactivation span). BLOOM_FADE_RATE is tuned so the exponential fade
// starting at BLOOM_FADE_START has decayed to a visually negligible ~2% by
// BLOOM_LIFETIME, so the slot's CPU-side deactivation never reads as a pop.
const float BLOOM_R_MIN = 0.05;
const float BLOOM_R_MAX = 0.14;
const float BLOOM_LIFETIME = 2.5;
const float BLOOM_INTRO = 0.35;
const float BLOOM_FADE_START = 1.2;
const float BLOOM_FADE_RATE = 3.0;
const vec3 BLOOM_TINT = vec3(0.82, 0.90, 0.93);

// Poke ripple render constants (increment 5) -- RIPPLE_LIFETIME MUST mirror
// index.ts's own RIPPLE_LIFETIME (the CPU pool's SlotPool.age() span).
const float RIPPLE_R_MAX = 0.12;
const float RIPPLE_LIFETIME = 1.2;

// Final condensation-to-seed sequence render constants (increment 8,
// SCREEN-relative revision -- see this file's top doc addendum for the
// full derivation). Sizes below are SCREEN fractions of the frame's
// reference (shorter) dimension, NOT field-uv: act 6's zoomAt is pulled
// back to as low as 0.28-0.30 (sections.ts), so a field-uv-only radius
// (the pre-revision FINAL_SEED_R = 0.006 field-uv) rendered as ~2 screen
// px -- invisible, for what is the album's closing image. Converted to a
// field-uv radius at DRAW TIME via screenFrac / uZoom (derived from
// main()'s own field = (vUv-0.5)*uCover/uZoom+0.5+uPan mapping: a
// field-space circle of radius R renders as a screen circle of radius
// R*uZoom*min(canvas.width,canvas.height) px REGARDLESS of aspect --
// uCover's per-axis stretch exactly cancels out of that product -- so
// screenFrac = R*uZoom and R = screenFrac/uZoom). FINAL_SEED_RING_FRAC and
// FINAL_SEED_HALO_MULT are plain ratios against the (already
// zoom-corrected) core radius, so they need no separate conversion.
// FINAL_SWELL_SCREEN_R is the SWELL phase's fully-grown radius;
// FINAL_CONDENSE_SCREEN_R is CONDENSE's end radius (close to, but
// deliberately not identical to, FINAL_SEED_SCREEN_R -- the fog visibly
// hands off to the SEED mote's tighter core + halo, not a perfectly
// seamless splice, see main()'s SEED branch).
const float FINAL_SWELL_SCREEN_R = 0.22;
const float FINAL_CONDENSE_SCREEN_R = 0.008;
const float FINAL_SEED_SCREEN_R = 0.006;
const float FINAL_SEED_RING_FRAC = 0.28;
const float FINAL_SEED_HALO_MULT = 2.5;
const vec3 FINAL_SEED_CORE = vec3(0.72, 0.28, 0.16);
const vec3 FINAL_SEED_RING = vec3(0.25, 0.12, 0.08);
// SWELL's alpha ceiling (also CONDENSE's clamp FLOOR, so the two phases
// hand off continuously) -- see FINAL_FOG_TONE's own doc for why a real
// screenshot needs this to be a genuinely dark mix, not the ~0.5 a naive
// reading of the spec might suggest: measured against the actual sterile
// ground tone at frame centre, 0.5 alone landed under the "unmistakable at
// a glance" bar, so this sits a little higher.
const float FINAL_SWELL_PEAK_ALPHA = 0.65;
// Ink-side condensation-fog tone (revision): the sterile ground is already
// pale/pastel, so mixing toward an additive-leaning near-white tone (the
// pooled bloom's own BLOOM_TINT, the pre-revision choice here) has almost
// no value contrast there -- measured peak delta ~2-6/255, imperceptible
// in a real screenshot (the b2 lesson: light-on-light dies). Mixing toward
// a COOLER, DARKER tone instead reads as an unmistakable fog on the pale
// blank while staying atmospheric (cool blue-gray, not black/gray-disc).
const vec3 FINAL_FOG_TONE = vec3(0.60, 0.71, 0.78);

void main() {
  // Screen uv -> field uv (house formula, shared with index.ts's pointer()).
  vec2 field = (vUv - 0.5) * uCover / uZoom + 0.5 + uPan;

  // Signed sterility field, computed once and shared by every mode below
  // (biomass truncation, the sterile-side ground colour, the diagnostic
  // solo mode, and the scrub line) so they can never disagree about where
  // the front actually is. eventRimD (strikes since increment 4, pokes since
  // increment 5) rides along for the young-event rim-pop boost, drawn with
  // the scrub line below.
  float eventRimD;
  float strikeIn;
  float S = sbSterility(field, eventRimD, strikeIn);
  float sEdge = sbAA() * 0.75 + 0.0004; // tight analytic S_EDGE (increment 9: was fwidth-based)
  // 1.0 living (S<0), 0.0 sterile (S>0). Written as 1.0 - smoothstep(-sEdge,
  // sEdge, S) rather than the mirrored smoothstep(sEdge, -sEdge, S) — both
  // are mathematically the same inverted ramp, but the GLSL spec leaves
  // edge0 > edge1 undefined, and this form keeps edge0 < edge1 always true.
  float livingMask = 1.0 - smoothstep(-sEdge, sEdge, S);

  // uSoloMode switch: each branch computes only what it needs. sbBiomass's
  // own 3x3 neighbourhood search and sbWatermarkSd's 2x2-nearest-cell sample
  // (increment 9: both now side-gated on S, and watermark's own search
  // width cut from 3x3 to 2x2 — see each function's own doc) are still
  // expensive enough that a debug-only solo mode must not force a second
  // pass of either every frame of normal playback.
  vec3 color;
  if (uSoloMode == 1) {
    // Biomass field alone over a flat mid-gray background, across the
    // WHOLE frame, ignoring S entirely (unchanged from increment 2;
    // FORCE_SEARCH_S, increment 9, keeps the search unconditional here).
    color = sbBiomass(field, vec3(0.5), 1.0, FORCE_SEARCH_S, false);
  } else if (uSoloMode == 5) {
    // The real sterile-side treatment, forced full-screen.
    color = sbSterileSide(field, S);
  } else if (uSoloMode == 2) {
    // S-field diagnostic: living side dark gray, sterile side light gray,
    // no biomass — the scrub line + glints (below) are forced to full
    // strength on this branch.
    color = mix(vec3(0.85), vec3(0.2), livingMask);
  } else if (uSoloMode == 3) {
    // Events diagnostic (increment 4): uSterile is pinned to 0 CPU-side in
    // this mode (index.ts), so R stays at uRMax and the front's own S
    // essentially never trips inside the visible frame -- ONLY strikes
    // carve real sterile territory into livingMask here. Neutral mid-gray
    // base (deliberately NOT the living/sterile palette) so the event
    // grammar -- strike shape, heal shrink, rim traces, tick pops (below,
    // forced to full strength alongside mode 2) -- reads in isolation, with
    // no biomass and no front to compete with it.
    color = mix(vec3(0.5), vec3(0.82), 1.0 - livingMask);
  } else if (uSoloMode == 4) {
    // Ghost-stamp diagnostic (increment 6): biomass alone over a flat
    // mid-gray ground across the WHOLE frame, ignoring S entirely (same
    // "ignore S" convention as mode 1) -- sbBiomass's ghostDebug=true both
    // flattens the clump silhouette to dark gray AND forces every present
    // clump to host a stamp this epoch (drawn at full alpha, bright cream),
    // so the four motifs are visible immediately on load with no need for
    // the '?ghost=always' debug flag (that flag still works here too,
    // harmlessly redundant with ghostDebug's own force). FORCE_SEARCH_S
    // (increment 9) keeps the search unconditional here.
    color = sbBiomass(field, vec3(0.5), 1.0, FORCE_SEARCH_S, true);
  } else if (uSoloMode == 6) {
    // Living-side ground churn diagnostic (this increment): sbDeepGround
    // alone, full-frame, ignoring biomass and the sterile side entirely, so
    // the atmosphere can be judged on its own -- same "ignore everything
    // else" convention as modes 1/4/5. s is passed straight through (rather
    // than forced to a sentinel) so the near-front ash-cooling term is still
    // visible here, which is part of what this mode exists to judge.
    color = sbDeepGround(field, S);
  } else {
    // Composed scene (mode 0): the ground itself transitions from the dark
    // living ground to the cold sterile side at the same S boundary that
    // truncates the biomass silhouette, so a scrubbed clump reveals sterile
    // ground beneath it, not the old dark ground.
    // Living-side ground churn (this increment's artist note, see
    // sbDeepGround's own doc): gated on livingMask > 0.002 (rather than
    // called unconditionally) since sbDeepGround is a real cost per fragment
    // and the very next line already mixes it away entirely on the sterile
    // side -- non-uniform branching here is SAFE, this file's only fwidth()
    // dependency (sbAA()) was removed and replaced with the analytic
    // uFieldPxScale in increment 9.
    vec3 groundLiving = (livingMask > 0.002) ? sbDeepGround(field, S) : GROUND_DEEP;
    vec3 sterileBase = sbSterileSide(field, S);
    // Crack-interior warp smear (round-2 artist note, see sbCrackFill's own
    // doc): gated on strikeIn > 0.0 -- the ONLY fragments actually inside a
    // fracture -- so the extra sbBiomass evaluation sbCrackFill needs never
    // runs on the vast majority of a frame with no (or distant) active
    // strikes. Blended into sterileBase, BEFORE the living/sterile ground
    // mix and BEFORE the biomass composite below, so a crack that happens
    // to straddle the front still shows the smear on its sterile side the
    // same way the front's own blank would otherwise show there. A tight,
    // one-sided analytic-AA edge (sbAA()-scaled, epsilon-padded so
    // edge0 < edge1 always holds) keeps the boundary from fringing.
    if (strikeIn > 0.0) {
      float crackAA = sbAA() * 2.0 + 0.0006;
      float crackMask = smoothstep(0.0, crackAA, strikeIn);
      sterileBase = mix(sterileBase, sbCrackFill(field, strikeIn), crackMask);
    }
    vec3 ground = mix(groundLiving, sterileBase, 1.0 - livingMask);
    color = sbBiomass(field, ground, livingMask, S, false);
  }

  // --- Energy / grade / vignette / film grain (increment 7) -- applied
  // ONLY to the composed scene (mode 0), the same precedent b2's own
  // grade/vignette pipeline sets: every numbered solo/diagnostic mode there
  // bypasses the whole post pipeline and outputs its raw diagnostic colour
  // directly, so debugging never depends on the current act's exposure/
  // grade/vignette. Everything below this block -- scrub line, glints,
  // crackle, blooms, ripples, strike/poke rim pops -- draws AFTER it (the
  // b2 lesson: overlays that must pop draw post-grade, never pre-grade
  // where they'd be crushed into the same graded/desaturated colour as
  // everything else).
  if (uSoloMode == 0) {
    // (uSoloMode == 6, the ground diagnostic, is excluded from this block the
    // same way modes 1/4/5 are -- see the scrub-line gate just below for the
    // shared reasoning.)
    // Exposure lift: rides the energy envelope (arcAt, index.ts) so the
    // purge's 1.0 peak reads brighter than the remission's restraint dip.
    color *= (0.92 + 0.28 * uEnergy);

    // Clinical cold grade (ActParams.grade): desaturate toward luminance,
    // then lerp toward a cold blue-white tint -- both scaled by uGrade, so
    // the piece reads progressively colder/more clinical as the front wins
    // (0.05 at the opening breath, 0.8 by last-breath).
    float gradeLuma = dot(color, vec3(0.299, 0.587, 0.114));
    color = mix(color, vec3(gradeLuma), uGrade * 0.45);
    color *= mix(vec3(1.0), vec3(0.94, 1.0, 1.06), uGrade);

    // Vignette (ActParams.vignette): radial darkening from frame centre,
    // screen-space (matching sbSterileSide's own corner-fall convention),
    // maxing at 0.32 at the corners when uVignette == 1.
    float vigDist = length((vUv - 0.5) * uCover);
    float vigRamp = smoothstep(0.3, 1.0, vigDist);
    color *= 1.0 - 0.32 * uVignette * vigRamp;

    // uFlash (scripted hits, index.ts): a faint whole-frame lift, on top of
    // the strong scrub-line brightening the block below applies via
    // glowStrength.
    color += vec3(0.08) * uFlash;
${h}
  }

  // --- Scrub line + droplet glints, drawn LAST so they pop over
  // everything above. Skipped for the four solo modes that isolate a
  // single layer's own colour and deliberately ignore S entirely (1
  // biomass-only, 4 ghost-stamp diagnostic, 5 sterile-only, 6 ground-churn
  // diagnostic) — mode 4's sbBiomass call above already passes a constant
  // livingMask=1.0 the same way mode 1 does, so drawing a real S=0 scrub
  // line over it would contradict that "ignore S" framing and clutter the
  // motif screenshot with an unrelated line; mode 6 is meant to show
  // sbDeepGround in isolation, and a bright scrub line drawn over it would
  // swamp the very atmosphere it exists to judge. The diagnostic modes 2
  // (front) and 3 (events) both want it forced to full strength regardless
  // of the current act's glow/glint knobs, so debugging never depends on
  // song position.
  if (uSoloMode != 1 && uSoloMode != 4 && uSoloMode != 5 && uSoloMode != 6) {
    bool diagFront = (uSoloMode == 2 || uSoloMode == 3);
    // uFlash (increment 7, scripted hits) lifts the scrub line's own
    // brightness strongly -- excluded from the diagFront branch since that
    // branch already forces full strength regardless of song position, the
    // same "debugging never depends on song position" rule uScrubGlow/
    // uGlint already follow just below.
    float glowStrength = diagFront ? 1.0 : (0.35 + uScrubGlow + uFlash * 1.2);
    float glintStrength = diagFront ? 1.0 : uGlint;

    // Narrow, fwidth-scaled band (~2-3 screen px) straddling the S=0
    // zero-crossing.
    float lineAA = sbAA() * 1.25 + 0.0004;
    float lineMask = 1.0 - smoothstep(0.0, lineAA, abs(S));

    // Droplet glints: sparse hash-driven bright points ON the line.
    // Arc-position is approximated as angle * current radius (field-uv
    // units), hashed at ~40 cells per unit so the cell pitch stays a
    // consistent physical spacing as R shrinks over the piece. Each cell's
    // twinkle re-hashes on a breath-phase epoch offset by its own base hash
    // so glints never sync across the line.
    vec2 sd0 = (field - uPocket) * uStretch;
    float theta = atan(sd0.y, sd0.x);
    float rNow = uRMax * (1.0 - uSterile);
    float arcPos = theta * rNow;
    float glintCell = floor(arcPos * 40.0);
    float glintBaseH = sbHash21(vec2(glintCell, 3.3));
    float glintExists = step(glintBaseH, 0.3);
    float glintEpoch = floor(uBreathPhase * 6.0 + glintBaseH);
    float glintTwinkle = sbHash21(vec2(glintCell, glintEpoch + 11.1));
    float glint = glintExists * glintTwinkle * glintStrength * lineMask;

    vec3 lineColor = vec3(0.97, 1.0, 1.0);
    color = mix(color, lineColor, lineMask * clamp(glowStrength, 0.0, 1.0));
    color += lineColor * glint;

    // Crackle sparks (increment 7, the high-band event): 2-3 micro-flashes
    // hugging the scrub line, gated to a band 3x the line's OWN AA width
    // (lineAA) so they can never bleed past it -- the exact "fix so glints
    // exist ONLY within the tight scrub-line band" discipline this
    // increment's diagonal-line bug review called for, applied to the new
    // event too. Reuses the glint hash idiom (arc-position cell hash) at a
    // different frequency (70 cells/unit vs glint's 40) so the two never
    // sync, re-rolled by uCrackleSeed (a plain incrementing counter,
    // index.ts) every time a crackle fires so the spark pattern never
    // repeats -- unlike glintEpoch's breath-phase cycle, which glints keep
    // re-using because they ride the breath motif, not a discrete event.
    float crackleBandW = lineAA * 3.0;
    float crackleBand = 1.0 - smoothstep(0.0, crackleBandW, abs(S));
    float crackleCell = floor(arcPos * 70.0);
    float crackleBaseH = sbHash21(vec2(crackleCell, 71.7 + uCrackleSeed * 13.13));
    float crackleExists = step(crackleBaseH, 0.22);
    float crackleTwinkle = sbHash21(vec2(crackleCell, uCrackleSeed * 7.77 + 3.3));
    float crackleSpeck = crackleExists * crackleTwinkle * crackleBand * uCrackle;
    color += vec3(1.0, 0.97, 0.88) * crackleSpeck * 1.1;

    // Young-event rim pop (strikes since increment 4, pokes since
    // increment 5): an extra brightness kick, scaled by uTick (the CPU
    // bass-onset / poke-tap decay scalar), wherever the visible scrub line
    // (lineMask) is ALSO tracing a strike younger than STRIKE_RIM_YOUNG or a
    // poke younger than POKE_RIM_YOUNG (eventRimD, written by sbSterility's
    // strike + poke loops). Gated by lineMask rather than standing alone so
    // an event rim already swallowed by the front (deep in already-sterile
    // territory, no S=0 crossing left to trace) never shows a floating
    // ghost ring.
    float rimBoostAA = sbAA() * 1.25 + 0.0004;
    float eventRimMask = 1.0 - smoothstep(0.0, rimBoostAA, eventRimD);
    color += lineColor * lineMask * eventRimMask * uTick * 0.85;

    // Faint interior glow bleeding ~2x the line width into the LIVING side
    // only — the front "heats" what it's about to consume.
    float bleedWidth = lineAA * 2.0;
    float livingBleed = (1.0 - smoothstep(0.0, bleedWidth, -S)) * step(S, 0.0);
    color += lineColor * livingBleed * glowStrength * 0.18;
  }

  // --- Condensation blooms (increment 5, the breath motif), drawn
  // post-overlay (after the composite + scrub line above): a soft cool
  // misty lift, radius growing 0.05->0.14 field-uv over its 2.5s life
  // (ease-out), intensity ramping in over 0.35s then exponential-fading
  // past 1.2s, masked to LIVING ground only (livingMask, already computed
  // above) and scaled by uBloomAmp -- plus a faint droplet-bead sparkle in
  // the disc's inner half, the scrub line's own glint hash idiom (cell hash
  // + breath-phase-epoch twinkle) at a lower existence density so it reads
  // as a quieter cousin, not a second scrub line.
  for (int i = 0; i < BLOOM_SLOTS; i++) {
    vec4 bl = uBloom[i];
    if (bl.w <= 0.0) continue;
    vec2 bloomCenter = bl.xy;
    float bloomAge = bl.z;

    float lifeT = clamp(bloomAge / BLOOM_LIFETIME, 0.0, 1.0);
    float growT = 1.0 - pow(1.0 - lifeT, 3.0); // ease-out across the whole life
    float bloomR = mix(BLOOM_R_MIN, BLOOM_R_MAX, growT);

    float introEnv = smoothstep(0.0, BLOOM_INTRO, bloomAge);
    float fadeEnv = bloomAge > BLOOM_FADE_START
      ? exp(-(bloomAge - BLOOM_FADE_START) * BLOOM_FADE_RATE)
      : 1.0;
    float envelope = introEnv * fadeEnv * uBloomAmp;

    float bloomDist = length(field - bloomCenter);
    float disc = 1.0 - smoothstep(0.0, bloomR, bloomDist);
    float bloomAlpha = clamp(envelope * disc, 0.0, 1.0) * livingMask;
    color = mix(color, BLOOM_TINT, bloomAlpha);

    float innerGate = 1.0 - smoothstep(bloomR * 0.35, bloomR * 0.5, bloomDist);
    vec2 sparkleCell = floor(field * 70.0);
    float sparkleBaseH = sbHash21(sparkleCell + bloomCenter * 13.0 + vec2(5.5, 9.1));
    float sparkleExists = step(sparkleBaseH, 0.12);
    float sparkleEpoch = floor(uBreathPhase * 6.0 + sparkleBaseH);
    float sparkleTwinkle = sbHash21(sparkleCell + vec2(sparkleEpoch + 31.7, 2.2));
    float sparkle = sparkleExists * sparkleTwinkle * innerGate * envelope * livingMask;
    color += vec3(0.97, 1.0, 1.0) * sparkle * 0.6;
  }

  // --- Poke ripple (increment 5): a thin expanding near-white ring, house
  // idiom (verbatim shape from b2's activateRipple/uRipple), drawn
  // post-overlay. Unmasked by livingMask -- a tap's feedback should read
  // the same whether it lands on living or already-sterile ground.
  for (int i = 0; i < RIPPLE_SLOTS; i++) {
    vec4 rp = uRipple[i];
    if (rp.w <= 0.0) continue;
    float rippleAge = rp.z;
    float rippleT = clamp(rippleAge / RIPPLE_LIFETIME, 0.0, 1.0);
    float ringR = mix(0.0, RIPPLE_R_MAX, rippleT);
    float ringDist = length(field - rp.xy);
    float ring = exp(-pow((ringDist - ringR) * 70.0, 2.0)) * rp.w * (1.0 - rippleT);
    color += vec3(0.92, 0.97, 1.0) * ring;
  }

  // --- Final condensation-to-seed sequence (increment 8, the album's
  // closing image), drawn LAST of all -- post-grade, after every other
  // overlay above (scrub line, blooms, ripples) -- so nothing can ever draw
  // over it. uFinalPhase 0 (off/gone) skips this block entirely; the S>0
  // smoothstep gate is a defensive guard (act 6 is fully sterile by 188s
  // regardless -- R has already shrunk to 0, see sbSterility's own doc --
  // so this gate is a no-op under normal playback, kept only so the
  // sequence can never bleed onto the living side if that assumption is
  // ever wrong).
  //
  // Bug fix (found while adding solo mode 6, this increment): this block was
  // previously UNGATED on uSoloMode, so from ~188s onward it drew its fog/
  // seed overlay on top of every diagnostic mode too -- caught live when
  // ?solo=ground&t=190 showed the SWELL fog's cool tone at frame centre
  // instead of pure sbDeepGround, polluting the very diagnostic meant to
  // isolate the ground layer. Every other diagnostic already excludes itself
  // from the composed-only post pipeline just above (the uSoloMode == 0
  // grade/exposure/vignette block); this one had no such gate. Added the
  // same additional uSoloMode == 0 guard so debugging the final sequence's
  // own solo modes (were any ever added) or any of modes 1-6 never depends
  // on whether the album happens to be past 188s.
  if (uFinalPhase > 0.5 && uSoloMode == 0) {
    float finalSGate = smoothstep(-0.01, 0.01, S);

    if (uFinalPhase < 2.5) {
      // SWELL (1) / CONDENSE (2): an INK-SIDE condensation fog -- mixes the
      // ground toward FINAL_FOG_TONE (cooler AND DARKER than the pale
      // sterile ground -- see its own doc for why the original additive
      // BLOOM_TINT approach was a measured no-op here) with a Gaussian-ish
      // radial falloff (dense core, softly feathered edge -- NOT a single
      // smoothstep disc, which read as a flat gray coin rather than mist)
      // as a SINGLE scripted instance at the fixed uFinalPos, sized in
      // SCREEN fractions (FINAL_SWELL_SCREEN_R/FINAL_CONDENSE_SCREEN_R,
      // converted to field-uv via /uZoom just below -- see those constants'
      // own doc) rather than a uBloom slot (this is a one-off cue, not a
      // pooled event). Bead sparkle draws ADDITIVELY on top afterward, so
      // it pops against the now-dark fog.
      float finalScreenR;
      float finalIntensity;
      float finalSparkleAmt;
      if (uFinalPhase < 1.5) {
        // SWELL: screen radius grows 0 -> FINAL_SWELL_SCREEN_R; alpha rides
        // an ease-out-cubic (front-loaded, NOT linear-in-t) climb to
        // FINAL_SWELL_PEAK_ALPHA so the fog already reads clearly well
        // before the phase's very end, not only at its last instant.
        finalScreenR = mix(0.0, FINAL_SWELL_SCREEN_R, uFinalT);
        finalIntensity = FINAL_SWELL_PEAK_ALPHA * (1.0 - pow(1.0 - uFinalT, 3.0));
        finalSparkleAmt = uFinalT;
      } else {
        // CONDENSE: screen radius eases FINAL_SWELL_SCREEN_R ->
        // FINAL_CONDENSE_SCREEN_R while intensity concentrates by the
        // inverse AREA ratio (screen-radius squared -- a pure ratio, so it
        // is identical whether computed in screen or field units) up to a
        // near-opaque ceiling, so the fog visibly DENSENS AND DARKENS as it
        // shrinks -- reads as condensing, not fading. Bead sparkle dies
        // away over the same span.
        finalScreenR = mix(FINAL_SWELL_SCREEN_R, FINAL_CONDENSE_SCREEN_R, uFinalT);
        float areaRatio = (FINAL_SWELL_SCREEN_R * FINAL_SWELL_SCREEN_R)
          / max(finalScreenR * finalScreenR, FINAL_CONDENSE_SCREEN_R * FINAL_CONDENSE_SCREEN_R);
        finalIntensity = clamp(FINAL_SWELL_PEAK_ALPHA * areaRatio, FINAL_SWELL_PEAK_ALPHA, 1.0);
        finalSparkleAmt = 1.0 - uFinalT;
      }
      // Screen-fraction radius -> field-uv radius (FINAL_SWELL_SCREEN_R's
      // own doc: R = screenFrac / uZoom). A tiny floor avoids a degenerate
      // zero-radius shape at uFinalT==0 feeding the falloff's division
      // below (matching sbAA's own "never hand a degenerate zero-width
      // band to a dependent calc" discipline).
      float finalRadiusSafe = max(finalScreenR / uZoom, 1e-5);

      float finalDist = length(field - uFinalPos);
      float finalNormDist = finalDist / finalRadiusSafe;
      // Gaussian-ish falloff: near 1.0 at the core, feathering smoothly
      // outward with no hard edge -- the "atmospheric fog" shape.
      float shapeFalloff = exp(-3.2 * finalNormDist * finalNormDist);
      float finalAlpha = clamp(finalIntensity * shapeFalloff, 0.0, 1.0) * finalSGate;
      color = mix(color, FINAL_FOG_TONE, finalAlpha);

      // Bead sparkle -- the pooled bloom loop's own inner-gate hash idiom
      // (sparkleCell/sparkleBaseH/sparkleTwinkle), a single instance keyed
      // off uFinalPos instead of a per-slot centre, added on TOP of the
      // fog so it pops against the new dark backdrop.
      float finalInnerGate = 1.0 - smoothstep(finalRadiusSafe * 0.35, finalRadiusSafe * 0.5, finalDist);
      vec2 finalSparkleCell = floor(field * 70.0);
      float finalSparkleBaseH = sbHash21(finalSparkleCell + uFinalPos * 13.0 + vec2(41.7, 7.3));
      float finalSparkleExists = step(finalSparkleBaseH, 0.12);
      float finalSparkleEpoch = floor(uBreathPhase * 6.0 + finalSparkleBaseH);
      float finalSparkleTwinkle = sbHash21(finalSparkleCell + vec2(finalSparkleEpoch + 61.1, 4.4));
      float finalSparkle = finalSparkleExists * finalSparkleTwinkle * finalInnerGate
        * finalIntensity * finalSparkleAmt * finalSGate;
      color += vec3(0.97, 1.0, 1.0) * finalSparkle * 0.6;
    } else {
      // SEED (3): the condensed seed point -- a warm rust core with a thin
      // darker ink ring just outside it, plus a soft warm halo bleeding
      // further out, quoting a1's "lone point in the void" seed image,
      // value-inverted for this pale ground (ink-dark edge, warm heart).
      // Sized in SCREEN fractions (FINAL_SEED_SCREEN_R, converted via
      // /uZoom -- see its own doc: the pre-revision field-uv-only radius
      // rendered as ~2 screen px at act 6's pulled-back zoom, effectively
      // invisible). Ring+core drawn as two layered filled discs (ring
      // first, full-size; core on top, slightly smaller) so only the
      // ring's outer band stays visible as a rim -- simpler and more
      // robust than an explicit annulus SDF; the halo is a third, wider,
      // much softer Gaussian-ish glow drawn first (underneath both).
      float finalDist = length(field - uFinalPos);
      float coreR = FINAL_SEED_SCREEN_R / uZoom;
      float ringOuterR = coreR * (1.0 + FINAL_SEED_RING_FRAC);
      float haloR = coreR * FINAL_SEED_HALO_MULT;
      float finalHaloAA = sbAA() * 2.0 + 0.0006; // "soft 2px" edge AA
      float seedAlpha = uSeedFade * finalSGate;

      // Halo: a soft warm glow bleeding out to FINAL_SEED_HALO_MULT x the
      // core radius, the same feathered Gaussian-ish shape as the
      // swell/condense fog above, so it reads as a gentle warmth around
      // the mote rather than a second hard ring.
      float haloNormDist = finalDist / haloR;
      float haloShape = exp(-3.0 * haloNormDist * haloNormDist);
      color = mix(color, FINAL_SEED_CORE, haloShape * 0.3 * seedAlpha);

      float ringDisc = 1.0 - smoothstep(ringOuterR, ringOuterR + finalHaloAA, finalDist);
      color = mix(color, FINAL_SEED_RING, ringDisc * seedAlpha);

      float coreDisc = 1.0 - smoothstep(coreR, coreR + finalHaloAA, finalDist);
      color = mix(color, FINAL_SEED_CORE, coreDisc * seedAlpha);
    }
  }

  gl_FragColor = vec4(color, 1.0);
}
`}const m=[0,12,78,104,140,162,184,200.042],S=[{name:"breath",breathAmp:1,clumpPresence:.85,lifeRate:.06,motionSpeed:.5,heat:.7,paleness:0,ghostAmp:.25,frontNoise:0,scrubGlow:0,glintAmp:0,crackleRate:0,strikeRate:0,strikeHeal:.22,strikeSize:.05,bloomRate:10,bloomAmp:1,watermark:0,sterileSpec:.2,grade:.05,vignette:.15,driftSpeed:.4,shake:0},{name:"the-front-appears",breathAmp:.8,clumpPresence:.9,lifeRate:.1,motionSpeed:.7,heat:.8,paleness:0,ghostAmp:.35,frontNoise:.5,scrubGlow:.5,glintAmp:.4,crackleRate:4,strikeRate:9,strikeHeal:.2,strikeSize:.07,bloomRate:0,bloomAmp:.5,watermark:.25,sterileSpec:.35,grade:.1,vignette:.2,driftSpeed:.5,shake:0},{name:"losing-ground",breathAmp:.7,clumpPresence:.9,lifeRate:.14,motionSpeed:.9,heat:1,paleness:.05,ghostAmp:.3,frontNoise:.65,scrubGlow:.65,glintAmp:.55,crackleRate:8,strikeRate:14,strikeHeal:.12,strikeSize:.08,bloomRate:0,bloomAmp:.3,watermark:.35,sterileSpec:.4,grade:.15,vignette:.25,driftSpeed:.6,shake:0},{name:"remission",breathAmp:.55,clumpPresence:.75,lifeRate:.05,motionSpeed:.4,heat:.45,paleness:.55,ghostAmp:.3,frontNoise:.45,scrubGlow:.4,glintAmp:.35,crackleRate:2,strikeRate:2,strikeHeal:.06,strikeSize:.06,bloomRate:4,bloomAmp:.7,watermark:.3,sterileSpec:.35,grade:.12,vignette:.3,driftSpeed:0,shake:0},{name:"the-purge",breathAmp:.5,clumpPresence:.8,lifeRate:.3,motionSpeed:1.2,heat:.9,paleness:.15,ghostAmp:.15,frontNoise:1,scrubGlow:1,glintAmp:1,crackleRate:18,strikeRate:22,strikeHeal:0,strikeSize:.11,bloomRate:0,bloomAmp:.2,watermark:.45,sterileSpec:.5,grade:.2,vignette:.35,driftSpeed:.8,shake:1},{name:"sterile",breathAmp:.25,clumpPresence:.5,lifeRate:.06,motionSpeed:.3,heat:.6,paleness:.3,ghostAmp:0,frontNoise:.6,scrubGlow:.7,glintAmp:.5,crackleRate:3,strikeRate:3,strikeHeal:0,strikeSize:.08,bloomRate:0,bloomAmp:.3,watermark:.7,sterileSpec:.8,grade:.5,vignette:.25,driftSpeed:0,shake:0},{name:"last-breath",breathAmp:.15,clumpPresence:.25,lifeRate:.02,motionSpeed:.1,heat:.5,paleness:.4,ghostAmp:0,frontNoise:.3,scrubGlow:.2,glintAmp:0,crackleRate:0,strikeRate:0,strikeHeal:0,strikeSize:.05,bloomRate:1.5,bloomAmp:.9,watermark:.3,sterileSpec:1,grade:.8,vignette:.4,driftSpeed:0,shake:0}],le=6;function ce(i){const e=Math.min(1,Math.max(0,i));return e*e*(3-2*e)}function he(i,e,s){if(s<=0)return i;if(s>=1)return e;const a={...i,name:s<.5?i.name:e.name};for(const t of Object.keys(i)){const n=i[t],o=e[t];typeof n=="number"&&typeof o=="number"&&(a[t]=n+(o-n)*s)}return a}function C(i,e){const s=Math.min(Math.max(e,0),i[i.length-1][0]);let a=0;for(;a<i.length-2&&s>=i[a+1][0];)a++;const t=i[a],n=i[a+1],o=Math.min(1,Math.max(0,(s-t[0])/Math.max(.001,n[0]-t[0])));return t[1]+(n[1]-t[1])*o}function de(i){const e=m[m.length-1],s=Math.min(Math.max(i,0),e-.001);let a=0;for(;a<S.length-1&&s>=m[a+1];)a++;const t=m[a],n=m[a+1]??e,o=Math.min(1,Math.max(0,(s-t)/Math.max(.001,n-t))),r=a<S.length-1,h=n-s,u=r?ce(1-Math.min(1,h/le)):0,f=S[a],d=r?S[a+1]:f;return{params:he(f,d,u),actIndex:a,localT:o,blend:u}}const fe=[[0,0],[12,.03],[30,.12],[78,.28],[104,.44],[110,.41],[118,.34],[128,.33],[139.7,.33],[140.3,.52],[143.8,.56],[144.4,.66],[150,.72],[162,.86],[167.8,.87],[168.3,.905],[173.7,.91],[174.3,.945],[179.7,.95],[180.3,.975],[183.7,.98],[184.3,1],[200.042,1]];function ue(i){return C(fe,i)}const me=[[0,1.45],[12,1.45],[40,1.25],[78,1.15],[104,1.22],[139.7,1.22],[140.3,1.08],[162,1.02],[164,1],[178,.3],[184,.28],[200.042,.28]];function G(i){return C(me,i)}const pe=[[0,.25],[12,.4],[40,.5],[78,.65],[104,.55],[105.5,.3],[108,.35],[126,.4],[139.7,.45],[140.3,.9],[144,1],[148,.95],[161.7,.9],[162.3,.55],[168,.45],[174,.35],[180,.25],[184,.12],[196,.02],[200.042,0]];function ge(i){return C(pe,i)}const be=(()=>{const i=[0];for(let e=0;e<S.length;e++){const s=m[e+1]-m[e];i.push(i[e]+S[e].lifeRate*s)}return i})();function ve(i){const e=m[m.length-1],s=Math.min(Math.max(i,0),e);let a=0;for(;a<S.length-1&&s>=m[a+1];)a++;return be[a]+S[a].lifeRate*(s-m[a])}class A{slots;constructor(e){this.slots=[];for(let s=0;s<e;s++)this.slots.push(new $(0,0,0,0))}fire(){let e=this.slots.findIndex(a=>a.w<=0);if(e<0){e=0;let a=this.slots[0].z;for(let t=1;t<this.slots.length;t++)this.slots[t].z>a&&(a=this.slots[t].z,e=t)}const s=this.slots[e];return s.z=0,s.w=1,e}age(e,s){for(let a=0;a<this.slots.length;a++){const t=this.slots[a];t.w<=0||(t.z+=e,s>0&&t.z>=s&&(t.w=0))}}clearAll(){for(let e=0;e<this.slots.length;e++)this.slots[e].w=0}}function Se(i,e){if(e<=0)return 1/0;const s=e/60;return-Math.log(1-i())/s}const we=12,Ee=1.5,ke=.18,ye=.035,H=.008,Re=8,_e=8,Ae=.25,xe=.22,Te=.06,Le=.28,Oe=1.02,Me=1+J*1*.5,Ne=.3,Pe=8,U=14,K=1.5,Ce=10,Ie=2.5,W=.45,Fe=1.2,De=30,Be=.6,Ge=.3,He=4,Ue=3,Ke=Ge+He+Ue,We=.6,ze=1.2,Xe=10,x=1.5,z=5e-4,E=.35,Ye=6,X=.0035,qe=.05,je=.012,Ve=.8,Y=.006,Ze=4,q=140,j=144,Qe=[168,174,180],V=184,T=.5,$e=1,Je=.7,et=.45,tt=.6,at=1.6,st=.5,ot=.25,it=.16,nt=.05,rt=.15,lt=.5,P=188,L=191,O=194,Z=199;function Q(i){const e=Math.min(1,Math.max(0,i));return e*e*(3-2*e)}function ct(i){if(i<P)return{phase:0,t:0,seedFade:1};if(i<L){const e=(i-P)/(L-P);return{phase:1,t:Q(e),seedFade:1}}if(i<O){const e=(i-L)/(O-L);return{phase:2,t:Q(e),seedFade:1}}if(i<Z){const e=(i-O)/(Z-O);return{phase:3,t:e,seedFade:1-e}}return{phase:0,t:0,seedFade:0}}class ht{renderer;scene;camera;quad;material;rand;full=!0;cover=new g(1,1);canvasPxW=1;canvasPxH=1;section=null;forceLifeFast=!1;pinnedBreath=null;pinnedSterile=null;pinnedGlint=null;seedOff=new g;beatBonus=0;bassSlow=0;highFast=0;breathPhase=0;motionPhase=0;soloMode=0;strikePool;strikeB=[];forceStrikeAlways=!1;healOverride=null;forceGhostAlways=!1;bassFast=0;bassOnset=new D({refRate:Ae,relMargin:xe,absFloor:Te,cooldown:Le});tick=0;strikeSchedule=new B;lastSongTime=0;rMaxEff=0;bloomPool;bloomCooldown=0;bloomTimeToNext=0;forceBloomAlways=!1;pokePool;ripplePool;pan=new g(0,0);panDisplay=new g(0,0);driftAngle=0;held=!1;dragDx=0;dragDy=0;velX=0;velY=0;shake=0;flash=0;crackle=0;crackleSeed=0;crackleOnset=new D({refRate:ot,relMargin:it,absFloor:nt,cooldown:rt});crackleSchedule=new B;forceCrackleAlways=!1;crackleDebugTimer=0;forceSeedPointAlways=!1;crackMult=1;init(e){const{renderer:s,seed:a,quality:t}=e;this.renderer=s,this.rand=ie(a^3009248801),this.full=t.level==="full";const n=new URLSearchParams(location.search),o=n.get("solo");let r=0;if(o==="biomass")r=1;else if(o==="front")r=2;else if(o==="events")r=3;else if(o==="ghosts")r=4;else if(o==="ground")r=6;else{const c=o!==null?parseInt(o,10):NaN;r=Number.isFinite(c)?c:0}this.soloMode=r,this.forceLifeFast=n.get("life")==="fast",this.forceStrikeAlways=n.get("strike")==="always",this.forceBloomAlways=n.get("bloom")==="always",this.forceGhostAlways=n.get("ghost")==="always",this.forceCrackleAlways=n.get("crackle")==="always",this.forceSeedPointAlways=n.get("seedpt")==="always";const h=n.get("heal");h==="off"?this.healOverride=0:h==="on"&&(this.healOverride=.22);const u=n.get("breath");if(u!==null){const c=parseFloat(u);Number.isNaN(c)||(this.pinnedBreath=Math.min(1,Math.max(0,c)))}const f=n.get("sterile");if(f!==null){const c=parseFloat(f);Number.isNaN(c)||(this.pinnedSterile=Math.min(1,Math.max(0,c)))}const d=n.get("glint");if(d!==null){const c=parseFloat(d);Number.isNaN(c)||(this.pinnedGlint=Math.min(1,Math.max(0,c)))}const p=n.get("crack");if(p!==null){const c=parseFloat(p);Number.isNaN(c)||(this.crackMult=Math.min(6,Math.max(.25,c)))}const b=()=>(this.rand()<.5?-1:1)*(.1+this.rand()*.14),v=new g(.5+b(),.5+b()),k=this.rand()*.55,y=this.rand()*.35,M=this.rand()<.5?new g(1+k,1-y):new g(1-y,1+k);this.seedOff.set(this.rand()*10,this.rand()*10),this.driftAngle=this.rand()*Math.PI*2;const N=new g(.5+(this.rand()-.5)*.12,.5+(this.rand()-.5)*.12),l=this.full?8:6;this.strikePool=new A(l);for(let c=0;c<l;c++)this.strikeB.push(new $(0,0,0,0));const w=3,R=4,I=4;this.bloomPool=new A(w),this.pokePool=new A(R),this.ripplePool=new A(I),this.scene=new ee,this.camera=new te(-1,1,1,-1,0,1),this.material=new ae({vertexShader:ne,fragmentShader:re({strikeSlots:l,bloomSlots:w,pokeSlots:R,rippleSlots:I,lobes:this.full?5:3,fbmOct:this.full?3:2,grain:this.full,fissures:this.full?4:3}),depthTest:!1,depthWrite:!1,uniforms:{uCover:{value:new g(1,1)},uZoom:{value:1},uFieldPxScale:{value:0},uPan:{value:this.panDisplay},uTime:{value:0},uSterile:{value:0},uSoloMode:{value:r},uLifeClock:{value:0},uPresence:{value:0},uBreath:{value:0},uBreathPhase:{value:0},uMotionPhase:{value:0},uGroundPhase:{value:0},uHeat:{value:0},uPaleness:{value:0},uPocket:{value:v},uStretch:{value:M},uFrontDrift:{value:new g(0,0)},uFrontNoise:{value:0},uRMax:{value:0},uScrubGlow:{value:0},uGlint:{value:0},uWatermark:{value:0},uSterileSpec:{value:0},uTick:{value:0},uStrikeA:{value:this.strikePool.slots},uStrikeB:{value:this.strikeB},uBloom:{value:this.bloomPool.slots},uBloomAmp:{value:0},uPoke:{value:this.pokePool.slots},uRipple:{value:this.ripplePool.slots},uGhostAmp:{value:0},uGhostForce:{value:this.forceGhostAlways?1:0},uEnergy:{value:0},uGrade:{value:0},uVignette:{value:0},uFlash:{value:0},uCrackle:{value:0},uCrackleSeed:{value:0},uFinalPhase:{value:0},uFinalT:{value:0},uSeedFade:{value:0},uFinalPos:{value:N}}}),this.quad=new se(new oe(2,2),this.material),this.scene.add(this.quad);const F=s.domElement;this.resize(F.clientWidth||1,F.clientHeight||1)}update(e,s){const a=s.time,t=this.material.uniforms;t.uTime.value+=e,t.uSterile.value=this.soloMode===3?0:this.pinnedSterile!==null?this.pinnedSterile:ue(a),t.uZoom.value=G(a);const n=de(a),o=n.actIndex===3||n.actIndex===4?S[n.actIndex]:n.params;this.section=n;const r=ge(a);t.uEnergy.value=r,t.uGrade.value=o.grade,t.uVignette.value=o.vignette,Math.abs(a-this.lastSongTime)>Ce&&(this.strikePool.clearAll(),this.strikeSchedule.reset(),this.bloomPool.clearAll(),this.bloomTimeToNext=0,this.pokePool.clearAll(),this.ripplePool.clearAll(),this.crackleSchedule.reset()),this.lastSongTime<q&&a>=q&&a-this.lastSongTime<T&&(this.flash=Math.max(this.flash,$e)),this.lastSongTime<j&&a>=j&&a-this.lastSongTime<T&&(this.fireStrike(o,at,st,!0),this.flash=Math.max(this.flash,Je));for(const l of Qe)this.lastSongTime<l&&a>=l&&a-this.lastSongTime<T&&(this.flash=Math.max(this.flash,et));this.lastSongTime<V&&a>=V&&a-this.lastSongTime<T&&(this.flash=Math.max(this.flash,tt)),this.lastSongTime=a;const h=this.forceSeedPointAlways?{phase:3,t:0,seedFade:1}:ct(a);t.uFinalPhase.value=h.phase,t.uFinalT.value=h.t,t.uSeedFade.value=h.seedFade;const u=this.forceLifeFast?we:1;t.uLifeClock.value=ve(a)*u+this.beatBonus,t.uPresence.value=o.clumpPresence;const f=this.bassSlow;this.bassSlow+=(s.bass-this.bassSlow)*Math.min(1,e*Ee),t.uBreath.value=this.pinnedBreath!==null?this.pinnedBreath:this.bassSlow*o.breathAmp,t.uZoom.value=t.uZoom.value*(1-je*t.uBreath.value);{const l=t.uZoom.value,w=Math.max(this.cover.x,this.cover.y),R=Math.max(1,Math.min(this.canvasPxW,this.canvasPxH));t.uFieldPxScale.value=w/(Math.max(1e-4,l)*R)}this.breathPhase+=e*ke,t.uBreathPhase.value=this.breathPhase,this.motionPhase+=e*o.motionSpeed*(.5+s.mid),t.uMotionPhase.value=this.motionPhase,t.uGroundPhase.value=a*ye,t.uHeat.value=o.heat,t.uPaleness.value=o.paleness,t.uGhostAmp.value=this.forceGhostAlways?1:o.ghostAmp;const d=t.uFrontDrift.value;d.x+=e*H,d.y+=e*H*.83,t.uFrontNoise.value=o.frontNoise,t.uScrubGlow.value=o.scrubGlow*(.6+.8*this.bassSlow);const p=this.highFast;if(this.highFast+=(s.high-this.highFast)*Math.min(1,e*Re),t.uGlint.value=this.pinnedGlint!==null?this.pinnedGlint:o.glintAmp*this.highFast,this.crackleOnset.update(e,this.highFast,p,o.crackleRate)&&this.fireCrackle(),this.forceCrackleAlways)this.crackleDebugTimer-=e,this.crackleDebugTimer<=0&&(this.fireCrackle(),this.crackleDebugTimer=lt);else{const l=o.crackleRate*(.5+r);this.crackleSchedule.update(e,l,this.rand,()=>this.fireCrackle())}this.crackle*=Math.exp(-7*e),t.uCrackle.value=this.crackle,t.uCrackleSeed.value=this.crackleSeed,t.uWatermark.value=o.watermark,t.uSterileSpec.value=o.sterileSpec;const b=this.bassFast;this.bassFast+=(s.bass-this.bassFast)*Math.min(1,e*_e),this.bassOnset.update(e,this.bassFast,b,o.strikeRate)&&(this.tick=1,this.fireStrike(o)),this.tick*=Math.exp(-7*e),t.uTick.value=this.tick,this.flash*=Math.exp(-3.4*e),t.uFlash.value=this.flash;const v=this.forceStrikeAlways?60:o.strikeRate;this.strikeSchedule.update(e,v,this.rand,()=>this.fireStrike(o)),this.ageStrikes(e),this.bloomCooldown=Math.max(0,this.bloomCooldown-e),this.bloomCooldown<=0&&f<W&&this.bassSlow>=W&&(this.bloomCooldown=Fe,this.fireBloom());const k=this.forceBloomAlways?De:o.bloomRate;if(k>0)for(this.bloomTimeToNext-=e;this.bloomTimeToNext<=0;)this.fireBloom(),this.bloomTimeToNext+=Se(this.rand,k);t.uBloomAmp.value=o.bloomAmp,this.bloomPool.age(e,Ie),this.pokePool.age(e,Ke),this.ripplePool.age(e,ze);const y=t.uZoom.value;if(this.held){if(e>1e-5){const l=Math.min(1,e*Xe),w=Math.min(x,Math.max(-x,this.dragDx/e)),R=Math.min(x,Math.max(-x,this.dragDy/e));this.velX+=(w-this.velX)*l,this.velY+=(R-this.velY)*l}this.dragDx=0,this.dragDy=0}else if(this.velX!==0||this.velY!==0){this.pan.x+=this.velX*this.cover.x/y*e,this.pan.y+=this.velY*this.cover.y/y*e;const l=Math.exp(-2.5*e);this.velX*=l,this.velY*=l,Math.abs(this.velX)<z&&(this.velX=0),Math.abs(this.velY)<z&&(this.velY=0)}else{this.driftAngle+=e*qe;const l=Math.cos(this.driftAngle),w=Math.sin(this.driftAngle);this.pan.x+=l*o.driftSpeed*X*e,this.pan.y+=w*o.driftSpeed*X*e}this.pan.x>E?(this.pan.x=E,this.velX=0):this.pan.x<-E&&(this.pan.x=-E,this.velX=0),this.pan.y>E?(this.pan.y=E,this.velY=0):this.pan.y<-E&&(this.pan.y=-E,this.velY=0),this.shake*=Math.exp(-6*e);const _=t.uTime.value,M=Math.sin(_*41)*this.shake*Y,N=Math.sin(_*53+1.3)*this.shake*Y;this.panDisplay.set(this.pan.x+M,this.pan.y+N)}pickLivingPoint(e=1){const s=this.material.uniforms,a=s.uCover.value,t=s.uZoom.value,n=this.pan,o=s.uPocket.value,r=s.uStretch.value,h=s.uSterile.value,u=this.rMaxEff*(1-h);for(let f=0;f<Pe;f++){let d=this.rand(),p=this.rand();d=.5+(d-.5)*e,p=.5+(p-.5)*e;const b=(d-.5)*a.x/t+.5+n.x,v=(p-.5)*a.y/t+.5+n.y,k=(b-o.x)*r.x,y=(v-o.y)*r.y;if(Math.hypot(k,y)-u<-.06)return{x:b,y:v}}return null}fireStrike(e,s=1,a=1,t=!1){const n=this.pickLivingPoint(a);if(!n)return;const o=this.strikePool.fire(),r=this.strikePool.slots[o];r.x=n.x,r.y=n.y,s*=this.crackMult;const h=e.strikeSize*s*(.8+this.rand()*.5),u=1.15+this.rand()*.5,f=this.rand()*Math.PI*2,d=t?0:this.healOverride!==null?this.healOverride:e.strikeHeal;this.strikeB[o].set(h,u,f,d),this.section&&this.section.actIndex===Ze&&(this.shake=e.shake*Ve)}fireBloom(){const e=this.pickLivingPoint(Be);if(!e)return;const s=this.bloomPool.fire(),a=this.bloomPool.slots[s];a.x=e.x,a.y=e.y}fireBloomAt(e,s){const a=this.bloomPool.fire(),t=this.bloomPool.slots[a];t.x=e,t.y=s}firePoke(e,s){const a=this.pokePool.fire(),t=this.pokePool.slots[a];t.x=e,t.y=s}fireRipple(e,s){const a=this.ripplePool.fire(),t=this.ripplePool.slots[a];t.x=e,t.y=s}fireCrackle(){this.crackle=1,this.crackleSeed++}ageStrikes(e){this.strikePool.age(e,0);const s=this.strikePool.slots;for(let a=0;a<s.length;a++){const t=s[a];if(t.w<=0)continue;const n=this.strikeB[a].w,o=t.z;if(n>0){const r=Ne+1/n;o>=r&&(t.w=0)}else{const r=U-K;o>=U?t.w=0:o>=r&&(t.w=Math.max(0,1-(o-r)/K))}}}resize(e,s){if(!this.material||e<=0||s<=0)return;const a=Math.min(3.5,Math.max(.28,e/s));a>=1?this.cover.set(a,1):this.cover.set(1,1/a),this.material.uniforms.uCover.value.copy(this.cover),this.canvasPxW=this.renderer.domElement.width||1,this.canvasPxH=this.renderer.domElement.height||1,this.rMaxEff=this.computeRMaxEff(),this.material.uniforms.uRMax.value=this.rMaxEff}computeRMaxEff(){const e=this.material.uniforms,s=e.uPocket.value,a=e.uStretch.value,t=G(0),n=.5*this.cover.x/t,o=.5*this.cover.y/t;let r=0;for(const h of[-1,1])for(const u of[-1,1]){const f=.5+h*n,d=.5+u*o,p=(f-s.x)*a.x,b=(d-s.y)*a.y,v=Math.hypot(p,b);v>r&&(r=v)}return r*Me*Oe}pointer(e){const s=this.material.uniforms.uZoom.value,a=this.cover;if(e.type==="down"){this.held=!0,this.dragDx=0,this.dragDy=0,this.velX=0,this.velY=0;const t=(e.x-.5)*a.x/s+.5+this.pan.x,n=(e.y-.5)*a.y/s+.5+this.pan.y;(this.section?this.section.actIndex:0)===Ye?this.fireBloomAt(t,n):(this.firePoke(t,n),this.tick=Math.max(this.tick,We)),this.fireRipple(t,n);return}if(e.type==="move"){if(!this.held)return;this.pan.x+=e.dx*a.x/s,this.pan.y+=e.dy*a.y/s,this.dragDx+=e.dx,this.dragDy+=e.dy;return}if(e.type==="up"){this.held=!1;return}this.held=!1,this.velX=0,this.velY=0,this.dragDx=0,this.dragDy=0}render(){this.renderer.setRenderTarget(null),this.renderer.render(this.scene,this.camera)}dispose(){this.material.dispose(),this.quad.geometry.dispose(),this.renderer.setRenderTarget(null)}}const dt={default:()=>new ht},pt=dt.default;export{pt as default};
//# sourceMappingURL=index-CSNpST6i.js.map
