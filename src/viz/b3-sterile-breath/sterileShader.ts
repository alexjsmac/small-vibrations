/**
 * Fullscreen display shader for b3 "Sterile Breath". Increment 3 landed the
 * real signed sterility field S(p) and the full sterile side, replacing
 * increment 1's placeholder vertical split and increment 2's flat pale
 * "blank". Increment 4 landed swab strikes -- bass-driven ellipse "wounds"
 * smax'd into S itself (see sbSterility's strike loop) -- the EXTENSION
 * POINT that increment-3 doc promised. Increment 5 lands the other two
 * event systems that same extension point promised, plus pointer
 * interaction (index.ts's `pointer()`): condensation BLOOMS (uBloom, the
 * track's recurring breath motif -- a soft cool misty lift + faint droplet
 * sparkle over living ground, drawn post-overlay in main()) and pointer
 * POKES (uPoke, a rebloom -- sbPokeRadius's grow/hold/re-scrub envelope
 * smin'd into S, pushing the boundary back OUT instead of carving in, the
 * opposite of a strike) plus their ripple feedback ring (uRipple, house
 * idiom). Shares b2's passthrough vertex shader shape and the house
 * screen->field mapping formula (b1's dish shader, b2's
 * catalogueShader.ts):
 *
 *   field = (vUv - 0.5) * uCover / uZoom + 0.5 + uPan
 *
 * The S-field (`sbSterility`): a signed distance-ish potential around the
 * pocket (the LAST living place) -- positive = sterile, the zero-crossing
 * IS the scrub line. `phi(p) = length((p - uPocket) * uStretch) * wobble`,
 * `wobble` a low-frequency fbm modulation (`sbFbm`) driving an irregular
 * organic boundary, `S = phi - R`, `R = uRMax * (1 - uSterile)`: as
 * uSterile climbs from 0 to 1, R shrinks from uRMax to 0, so the living
 * island (phi < R) shrinks from covering the whole visible field down to a
 * single point at the pocket -- exactly the "condenses to a single seed
 * point" arc the sections.ts doc describes. Every active swab strike (a
 * rotated-ellipse SDF, index.ts's SlotPool-backed uStrikeA/uStrikeB) is then
 * smax'd into that same value with a shared blend radius (K_BLEND), so every
 * caller below (biomass truncation, the diagnostic solo modes, the scrub
 * line) reads the strike-augmented S through that one function and never
 * needs to know strikes exist as a separate thing. Increment 5's pokes
 * (`sbPokeRadius`'s grow/hold/re-scrub envelope, uPoke) fold in here the
 * same way -- smin, pushing the boundary back OUT instead of carving in.
 *
 * uRMax (increment 4 follow-up, replacing the old global-worst-case R_MAX
 * const): a PER-SEED value computed on the CPU (index.ts's rMaxEff, see its
 * own doc) from the act-1 camera's visible-corner distance to THIS play's
 * own uPocket/uStretch draw, times the wobble's exact analytic upper bound
 * (derived from FRONT_NOISE_AMP, not hardcoded) plus a small epsilon --
 * every seed's sterileAt now lands at the SAME visual moment instead of the
 * old fixed worst-case constant leaving most (non-worst-case) seeds with a
 * huge unused margin. Recomputed in index.ts's resize() since it depends on
 * uCover.
 *
 * Sterile side (`sbSterileSide`): layered and deliberately subtle --
 * (1) a cold blue-white base, (2) a slow-drifting specular ramp plus a
 * broad darker corner falloff (screen-space, a vignette on the viewport,
 * not the world), (3) WATERMARKS (`sbWatermarkSd`) -- ultra-faint prints of
 * erased biomass sampled from the SAME clump union SDF as the living side
 * but with a FROZEN lifecycle (constant life clock, full presence, zero
 * breath) so they read as fixed ghosts, never living forms: no rim, no
 * speckle, no breathing. sbClumpLife/sbClumpSd take lifeClock/presence/
 * breath as explicit parameters (rather than reading uLifeClock/uPresence/
 * uBreath directly) precisely so the watermark pass can freeze them without
 * duplicating the geometry functions.
 *
 * Biomass renders only where S < 0 (`sbBiomass`'s new `livingMask`
 * parameter, multiplied into both edgeMask and rim): a clump half-overtaken
 * by the front shows its scrubbed half gone, revealing the sterile ground
 * beneath instead of biomass.
 *
 * The scrub line + droplet glints (main(), drawn LAST so they pop over
 * everything): a bright cold-white band straddling the S=0 zero-crossing,
 * sparse hash-driven glints hashed by arc-position (angle * current
 * radius) that twinkle on a breath-phase epoch, plus a faint glow bleeding
 * into the living side only.
 *
 * uSoloMode: 0 = full composed scene; 1 = biomass shaded field alone over a
 * flat mid-gray background across the WHOLE frame, ignoring S entirely
 * (unchanged from increment 2); 2 = S-field diagnostic (living side dark
 * gray, sterile side light gray, scrub line + glints forced to full
 * strength, no biomass); 3 = events diagnostic (NEW this increment,
 * index.ts pins uSterile to 0 in this mode) -- neutral mid-gray field, no
 * biomass, no front (R stays at uRMax so it essentially never trips inside
 * the frame), ONLY strikes carve visible sterile territory, scrub-line rims
 * + young-strike tick pops forced to full strength alongside mode 2; 4
 * ghosts has no dedicated layer yet and falls through to the composed
 * scene; 5 = the real sterile-side treatment forced full-screen (was a flat
 * placeholder in increments 1-2; now the genuine layered `sbSterileSide`).
 *
 * NO backticks anywhere in the GLSL strings below (template-literal
 * truncation trap, a2 lesson) -- not even inside GLSL comments. All loops
 * have compile-time constant bounds. Reserved-word identifiers (active,
 * input, output, filter) are avoided throughout.
 */

export const STERILE_VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/**
 * Baseline relative amplitude of the S-field's noise wobble (see
 * sbSterility's doc) -- exported (rather than left as a GLSL-only literal)
 * so index.ts's rMaxEff derivation can compute the EXACT wobble upper bound
 * (1 + FRONT_NOISE_AMP * 1.0 * 0.5, uFrontNoise's max being 1.0) from this
 * single source of truth instead of a separately-typed mirror that could
 * silently drift if this value ever changes.
 */
export const FRONT_NOISE_AMP = 0.6;

/**
 * Slot/quality budgets for the layers landing in increments 2-8 -- baked
 * into the shader source as compile-time `const int` so every later loop
 * bound is a literal, matching b2's builder pattern (buildCatalogueFragment
 * bakes reticleSlots/reach/glyphStrokes the same way). `lobes` and `fbmOct`
 * were unused placeholders in increment 1; increment 2 was their first real
 * consumer (LOBES drives sbClumpSd's per-clump lobe count, FBM_OCT drives
 * sbFbm's octave count). `strikeSlots` became real in increment 4
 * (uStrikeA/uStrikeB); `bloomSlots`/`pokeSlots`/`rippleSlots` become real in
 * increment 5 (uBloom, uPoke, uRipple) -- every field of this config now has
 * a real compiled use, no placeholder checksum needed anymore.
 */
export interface SterileShaderConfig {
  strikeSlots: number;
  bloomSlots: number;
  pokeSlots: number;
  rippleSlots: number;
  lobes: number;
  fbmOct: number;
}

export function buildSterileFragment(cfg: SterileShaderConfig): string {
  const STRIKE_SLOTS = Math.max(1, Math.floor(cfg.strikeSlots));
  const BLOOM_SLOTS = Math.max(1, Math.floor(cfg.bloomSlots));
  const POKE_SLOTS = Math.max(1, Math.floor(cfg.pokeSlots));
  const RIPPLE_SLOTS = Math.max(1, Math.floor(cfg.rippleSlots));
  const LOBES = Math.max(1, Math.floor(cfg.lobes));
  const FBM_OCT = Math.max(1, Math.floor(cfg.fbmOct));
  return `
precision highp float;
varying vec2 vUv;

uniform vec2 uCover;
uniform float uZoom;
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

// Increment 2-8 layer budgets, baked as compile-time constants. Every
// budget is now a real consumed constant (LOBES/FBM_OCT since increment 2,
// STRIKE_SLOTS since increment 4, BLOOM_SLOTS/POKE_SLOTS/RIPPLE_SLOTS as of
// this increment -- see uBloom/uPoke/uRipple below and sbSterility's poke
// loop) -- no more inert placeholders left to guard with a checksum.
const int STRIKE_SLOTS = ${STRIKE_SLOTS};
const int BLOOM_SLOTS = ${BLOOM_SLOTS};
const int POKE_SLOTS = ${POKE_SLOTS};
const int RIPPLE_SLOTS = ${RIPPLE_SLOTS};
const int LOBES = ${LOBES};
const int FBM_OCT = ${FBM_OCT};

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
const float FRONT_NOISE_AMP = ${FRONT_NOISE_AMP};

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

  vec2 cellCenter = (cc + vec2(0.5)) / CLUMP_FREQ;
  vec2 jitterH = sbHash22(cc + vec2(epoch * 5.1 + 3.3, epoch * 2.7 + 8.8));
  vec2 anchor = cellCenter + (jitterH - 0.5) * (0.5 / CLUMP_FREQ);

  float baseHash = sbHash21(cc + vec2(41.1, 19.3));
  float baseR = (0.55 / CLUMP_FREQ) * mix(0.55, 1.05, baseHash);

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

// Watermark residue SDF (increment 3): the SAME clump union search as
// sbBiomass, but sampled with a FROZEN lifecycle (WM_LIFE_CLOCK,
// WM_PRESENCE, zero breath) — so the returned distance is a fixed snapshot
// of "biomass that was recently here", never a live/breathing shape. No
// crowd tracking, no nearest/second-nearest colour bookkeeping — the caller
// only wants the union silhouette's interior mask.
float sbWatermarkSd(vec2 fieldUv) {
  vec2 n0 = floor(fieldUv * CLUMP_FREQ);
  float sdUnion = 9.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 cc = n0 + vec2(float(i), float(j));
      float sdC = sbClumpSd(fieldUv, cc, WM_LIFE_CLOCK, WM_PRESENCE, 0.0);
      if (sdC > 5.0) continue;
      sdUnion = sbSmin(sdUnion, sdC, SMIN_K);
    }
  }
  return sdUnion;
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
vec3 sbBiomass(vec2 fieldUv, vec3 ground, float livingMask) {
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
  float edgeAA = fwidth(sdUnion) * 0.75 + 0.0004;
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
  float rimAA = fwidth(sdUnion) * 1.5 + 0.0006;
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
  vec3 biomassCol = mix(interior, crown, hHot) * mix(1.0, 1.1, uHeat);

  // Interior speckle: 2(+)-octave value noise, domain drifting by the
  // CPU-accumulated uMotionPhase (not raw time) — interior only (gated by h,
  // excluded from the rim band).
  vec2 noiseP = fieldUv * CLUMP_FREQ * 9.0 + vec2(uMotionPhase * 0.35, -uMotionPhase * 0.27);
  float speck = sbFbm(noiseP);
  biomassCol += (speck - 0.5) * 0.28 * h * (1.0 - rim);

  // Crowding: darkens valleys where several clumps' edges meet (many nearby
  // present clumps AND this fragment sits between two near-equidistant
  // ones).
  float crowdWeight = smoothstep(2.0, 6.0, float(crowdCount));
  float valley = 1.0 - clamp((sdSecond - sdNearest) / 0.05, 0.0, 1.0);
  biomassCol *= 1.0 - crowdWeight * valley * 0.3;

  // Paleness: mixes the biomass's OWN colour (not the bare ground) toward
  // the chalky remission tone.
  vec3 pale = vec3(0.72, 0.70, 0.66);
  biomassCol = mix(biomassCol, pale, uPaleness);

  vec3 col = mix(ground, biomassCol, edgeMask);

  // Rim: slightly brighter, cooler highlight right at the silhouette edge —
  // applied to the FINAL composited colour rather than folded into
  // biomassCol before the ground mix, because h/edgeMask (the coverage/alpha
  // terms) are near zero exactly where the rim lives (both peak at
  // sdUnion ~ 0); mixing it in beforehand let the ground mix wash the
  // highlight back out.
  vec3 rimTone = mix(crown, vec3(0.75, 0.55, 0.62), 0.5);
  col = mix(col, rimTone * 1.25, rim * 0.55);

  return col;
}

// Strike geometry & envelope constants (increment 4). K_BLEND is THE smax
// blend radius shared by every strike merge below (front<->strike AND, since
// strikes accumulate into S one at a time, strike<->strike where two
// overlap) -- one constant so every rim reads as the same material seaming
// into itself, never a per-strike-tuned blend. STRIKE_GROW/STRIKE_SETTLE
// shape the age->radius envelope: 0->1.08x rMax over [0, STRIKE_GROW]
// (punch-in overshoot), eased back 1.08x->1.0x over [STRIKE_GROW,
// STRIKE_SETTLE] (settle), holding at 1.0x from then on -- healRate (if > 0)
// then shrinks from that settled 1.0x, exactly matching the CPU's own
// healed-radius-reaches-zero bookkeeping (index.ts's ageStrikes) so a slot
// frees the instant its GPU radius would hit 0.
const float K_BLEND = 0.05;
const float STRIKE_GROW = 0.18;
const float STRIKE_SETTLE = 0.3;
const float STRIKE_RIM_YOUNG = 0.5; // seconds -- the young-strike rim-pop window

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

// Rotated-ellipse SDF: rotate (p - center) by angle, scale the rotated y by
// aspect, then a plain circle SDF -- exactly the construction the increment
// spec calls for (aspect > 1 narrows the ellipse along its LOCAL y-axis
// relative to x, since scaling a coordinate UP shrinks that axis's
// semi-length at a fixed radius r). Standard SDF sign convention: negative
// inside, positive outside.
float sbStrikeSd(vec2 p, vec2 center, float r, float aspect, float angle) {
  vec2 d = p - center;
  float ca = cos(angle);
  float sa = sin(angle);
  vec2 rp = vec2(ca * d.x + sa * d.y, -sa * d.x + ca * d.y);
  rp.y *= aspect;
  return length(rp) - r;
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
// active strike is a rotated-ellipse "wound": its OWN sdf (sbStrikeSd,
// negative inside) is negated (positive inside, i.e. sterile) and smax'd
// into the running S with sbSmax/K_BLEND, exactly the SDF-subtraction
// identity max(a, -b) = a MINUS shape-b's interior -- so a strike always
// pushes its interior toward sterile regardless of what the front alone
// would say there, and its rim reads as a genuine (smax-rounded) S=0
// boundary, which is why the scrub line automatically traces it with no
// separate drawing pass. w (index.ts's fade-on-expiry for failed,
// unhealed strikes) blends the WHOLE smax'd result back toward the
// pre-strike S rather than scaling the raw sdf contribution directly --
// scaling the raw contribution would drag S toward 0 everywhere (not just
// near the strike) as w shrinks, since an unbounded sdf value far from the
// strike shrinks right along with it; blending the final scalar has no such
// footgun and still satisfies "scale the strike's effect by w" (w=0 is an
// exact no-op, w=1 is the full smax). Increment 5's pokes then fold in with
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
float sbSterility(vec2 p, out float eventRimD) {
  vec2 d = (p - uPocket) * uStretch;
  float fineN = sbFbm(p * 3.0 + uFrontDrift) - 0.5;
  float coarseN = sbFbm(p * 1.2 + uFrontDrift * 0.6) - 0.5;
  float wobbleN = (coarseN * 2.0 + fineN) / 3.0;
  float wobble = 1.0 + FRONT_NOISE_AMP * uFrontNoise * wobbleN;
  float phi = length(d) * wobble;
  float R = uRMax * (1.0 - uSterile);
  float s = phi - R;

  eventRimD = 9.0;
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
    }
    if (r <= 0.0001) continue; // fully healed -- no wound left to merge

    float strikeSd = sbStrikeSd(p, center, r, aspect, angle);
    float sWithStrike = sbSmax(s, -strikeSd, K_BLEND);
    s = mix(s, sWithStrike, w);

    if (age < STRIKE_RIM_YOUNG) {
      eventRimD = min(eventRimD, abs(strikeSd));
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
  // union SDF with a FROZEN life clock / full presence / zero breath —
  // frozen ghosts, not living forms (no rim, no speckle).
  float wmSd = sbWatermarkSd(fieldUv);
  float wmAA = fwidth(wmSd) * 0.75 + 0.0004;
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
  float S = sbSterility(field, eventRimD);
  float sEdge = fwidth(S) * 0.75 + 0.0004; // tight fwidth-based S_EDGE
  // 1.0 living (S<0), 0.0 sterile (S>0). Written as 1.0 - smoothstep(-sEdge,
  // sEdge, S) rather than the mirrored smoothstep(sEdge, -sEdge, S) — both
  // are mathematically the same inverted ramp, but the GLSL spec leaves
  // edge0 > edge1 undefined, and this form keeps edge0 < edge1 always true.
  float livingMask = 1.0 - smoothstep(-sEdge, sEdge, S);

  // uSoloMode switch: each branch computes only what it needs (sbBiomass
  // and sbWatermarkSd are both full 3x3 neighbourhood searches — cheap
  // enough for one composed-scene pass, expensive enough that a debug-only
  // solo mode must not force a second one every frame of normal playback).
  vec3 color;
  if (uSoloMode == 1) {
    // Biomass field alone over a flat mid-gray background, across the
    // WHOLE frame, ignoring S entirely (unchanged from increment 2).
    color = sbBiomass(field, vec3(0.5), 1.0);
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
  } else {
    // Composed scene (mode 0, and 4's fallthrough): the ground itself
    // transitions from the dark living ground to the cold sterile side at
    // the same S boundary that truncates the biomass silhouette, so a
    // scrubbed clump reveals sterile ground beneath it, not the old dark
    // ground.
    vec3 groundLiving = vec3(0.045, 0.022, 0.04);
    vec3 sterileBase = sbSterileSide(field, S);
    vec3 ground = mix(groundLiving, sterileBase, 1.0 - livingMask);
    color = sbBiomass(field, ground, livingMask);
  }

  // --- Scrub line + droplet glints, drawn LAST so they pop over
  // everything above. Skipped for the two solo modes that isolate a single
  // layer's own colour (1 biomass-only, 5 sterile-only); the diagnostic
  // modes 2 (front) and 3 (events) both want it forced to full strength
  // regardless of the current act's glow/glint knobs, so debugging never
  // depends on song position.
  if (uSoloMode != 1 && uSoloMode != 5) {
    bool diagFront = (uSoloMode == 2 || uSoloMode == 3);
    float glowStrength = diagFront ? 1.0 : (0.35 + uScrubGlow);
    float glintStrength = diagFront ? 1.0 : uGlint;

    // Narrow, fwidth-scaled band (~2-3 screen px) straddling the S=0
    // zero-crossing.
    float lineAA = fwidth(S) * 1.25 + 0.0004;
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

    // Young-event rim pop (strikes since increment 4, pokes since
    // increment 5): an extra brightness kick, scaled by uTick (the CPU
    // bass-onset / poke-tap decay scalar), wherever the visible scrub line
    // (lineMask) is ALSO tracing a strike younger than STRIKE_RIM_YOUNG or a
    // poke younger than POKE_RIM_YOUNG (eventRimD, written by sbSterility's
    // strike + poke loops). Gated by lineMask rather than standing alone so
    // an event rim already swallowed by the front (deep in already-sterile
    // territory, no S=0 crossing left to trace) never shows a floating
    // ghost ring.
    float rimBoostAA = fwidth(eventRimD) * 1.25 + 0.0004;
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

  gl_FragColor = vec4(color, 1.0);
}
`;
}
