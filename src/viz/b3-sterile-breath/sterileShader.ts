/**
 * Fullscreen display shader for b3 "Sterile Breath". Increment 2: the real
 * living side lands here — a cushion-clump BIOMASS field (`sbBiomass`) on a
 * near-black warm ground, replacing increment 1's placeholder gradient. The
 * sterile side stays the increment-1 vertical-split placeholder (`uSterile`
 * still just steps field.x); increment 3 replaces that half with the real
 * S-field. Shares b2's passthrough vertex shader shape and the house
 * screen->field mapping formula (b1's dish shader, b2's catalogueShader.ts):
 *
 *   field = (vUv - 0.5) * uCover / uZoom + 0.5 + uPan
 *
 * Biomass geometry (this track's family — NEVER chains/filaments/branching,
 * those belong to other tracks): a DENSE hash-jittered grid at CLUMP_FREQ
 * cells across field-uv (many small cushions carpeting the field, not a
 * handful of large ones — the art-direction reset's density-over-scale
 * rule) (`sbBiomass`'s 3x3 neighbourhood search over
 * `sbClumpSd`). Each present cell hosts one CLUMP — an iq-smin union of
 * LOBES circular lobe SDFs (`sbClumpSd`) hashed around the cell's anchor,
 * offsets kept smaller than the lobe radii so clumps read as compact mounded
 * cushions, never thin chains. Presence/appear/disappear follows b2's
 * beat-coupled lifecycle idiom (`sbClumpLife`, mirrors catalogueShader.ts's
 * specLife): a hero cell (nearest field-uv (0.5,0.5)) is always present,
 * every other cell rolls presence per lifecycle epoch with a pop-in
 * overshoot and a crossfade scale-out. Shading (`sbBiomass`) turns the union
 * SDF into a soft height/coverage value h (deep interior -> bright crown by
 * h), adds a thin rim band at the silhouette edge, 2-octave value-noise
 * interior speckle (domain drifting by the CPU-accumulated uMotionPhase, not
 * raw time), and a crowding term that darkens valleys where several clumps'
 * edges meet. uHeat leans the palette hot, uPaleness mixes the whole
 * biomass patch toward a chalky pale remission tone.
 *
 * uSoloMode: 0 = full composed scene (biomass + the increment-1 sterile
 * split); 1 = biomass shaded field alone over a flat mid-gray background,
 * across the WHOLE frame (ignores the sterile split entirely — isolates the
 * geometry for screenshots); 5 = the cold blank forced full-screen (already
 * wired in increment 1). Modes 2-4 (front / events / ghosts) have no
 * dedicated layer yet and fall through to the composed scene.
 *
 * NO backticks anywhere in the GLSL strings below (template-literal
 * truncation trap, a2 lesson) — not even inside GLSL comments. All loops
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
 * Slot/quality budgets for the layers landing in increments 2-8 — baked
 * into the shader source as compile-time `const int` so every later loop
 * bound is a literal, matching b2's builder pattern (buildCatalogueFragment
 * bakes reticleSlots/reach/glyphStrokes the same way). `lobes` and `fbmOct`
 * were unused placeholders in increment 1; this increment is the first real
 * consumer (LOBES drives sbClumpSd's per-clump lobe count, FBM_OCT drives
 * sbFbm's octave count) — they're dropped from `futureLayerBudget`'s
 * checksum below accordingly, since they now have real compiled uses.
 * strike/bloom/poke/rippleSlots remain unused until their own increments and
 * stay in the checksum.
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

// Increment 2-8 layer budgets, baked as compile-time constants. LOBES/
// FBM_OCT are real consumed constants now (sbClumpSd / sbFbm below); the
// event-slot budgets below remain unused until their own increments, so
// they're still folded into futureLayerBudget() to keep them real,
// declared-and-used GLSL constants rather than inert string interpolation.
const int STRIKE_SLOTS = ${STRIKE_SLOTS};
const int BLOOM_SLOTS = ${BLOOM_SLOTS};
const int POKE_SLOTS = ${POKE_SLOTS};
const int RIPPLE_SLOTS = ${RIPPLE_SLOTS};
const int LOBES = ${LOBES};
const int FBM_OCT = ${FBM_OCT};

// Biomass field constants: CLUMP_FREQ cells across field-uv, SMIN_K the iq
// smooth-min blend radius for fusing a clump's lobes into one mounded body.
// CLUMP_FREQ raised 4.0 -> 7.0 (art-direction tuning round): the reset's
// density-over-scale rule rejects a handful of large clumps filling the
// frame in favour of many smaller cushions carpeting the field. baseR in
// sbClumpSd stays proportional to 1.0 / CLUMP_FREQ, so raising this alone
// shrinks every clump and packs more of them in without changing coverage
// fraction.
const float CLUMP_FREQ = 7.0;
const float SMIN_K = 0.045;

float futureLayerBudget() {
  float acc = 0.0;
  for (int i = 0; i < STRIKE_SLOTS; i++) acc += 1.0;
  for (int i = 0; i < BLOOM_SLOTS; i++) acc += 1.0;
  for (int i = 0; i < POKE_SLOTS; i++) acc += 1.0;
  for (int i = 0; i < RIPPLE_SLOTS; i++) acc += 1.0;
  return acc;
}

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
// is pinned present at epoch 0 forever.
float sbClumpLife(vec2 cc, out float epoch) {
  if (cc == sbHeroCell()) { epoch = 0.0; return 1.0; }
  float cycle = uLifeClock + sbHash21(cc + vec2(17.9, 4.4));
  float e = floor(cycle);
  float k = fract(cycle);
  float presentE = step(sbHash21(cc + vec2(e * 7.7, 2.9)), uPresence);
  float presentE1 = step(sbHash21(cc + vec2((e + 1.0) * 7.7, 2.9)), uPresence);
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
// radius; radii 0.45-1.0 x base, widened from the increment-2 0.55-1.0 range
// so smaller clumps at the higher CLUMP_FREQ still read as organic lumpy
// mounds instead of near-circular blobs) so the union always reads as one
// compact mounded cushion, never a chain or filament. Base clump radius is
// 0.55/CLUMP_FREQ scaled per clump by a hash in [0.55, 1.05]. Breathing
// scales every lobe's radius together, with a per-clump hashed phase offset
// so the whole field doesn't pump in unison. Absent clumps (sbClumpLife's
// envelope near 0) return a large sentinel so they drop out of the search
// entirely.
float sbClumpSd(vec2 fieldUv, vec2 cc) {
  float epoch;
  float scaleEnv = sbClumpLife(cc, epoch);
  if (scaleEnv < 0.01) return 9.0;

  vec2 cellCenter = (cc + vec2(0.5)) / CLUMP_FREQ;
  vec2 jitterH = sbHash22(cc + vec2(epoch * 5.1 + 3.3, epoch * 2.7 + 8.8));
  vec2 anchor = cellCenter + (jitterH - 0.5) * (0.5 / CLUMP_FREQ);

  float baseHash = sbHash21(cc + vec2(41.1, 19.3));
  float baseR = (0.55 / CLUMP_FREQ) * mix(0.55, 1.05, baseHash);

  float clumpPhaseHash = sbHash21(cc + vec2(6.6, 22.2));
  float breathScale = 1.0 + 0.06 * uBreath * sin(6.2831853 * (uBreathPhase + clumpPhaseHash));

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

// Full biomass field composited over ground at field-uv point fieldUv:
// searches the 3x3 clump-cell neighbourhood, smin-unions every present
// clump's SDF for the coverage field, tracks the two nearest clumps for a
// soft colour blend across overlaps plus a crowding count for the valley-
// darkening term, then shades interior->crown by height with a rim band and
// interior speckle. Shared between the composed scene (ground = near-black)
// and solo-mode 1 (ground = flat mid-gray) so the two paths can never drift
// apart.
vec3 sbBiomass(vec2 fieldUv, vec3 ground) {
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
      float sdC = sbClumpSd(fieldUv, cc);
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
  // screen pixels wide) — the ONLY term that decides ground vs biomass in
  // the final composite below. Art-direction tuning round: this used to be
  // a wide fixed 0.09 field-uv soft gradient, which read as out-of-focus/
  // milky (drifting toward b1's petri look); fwidth ties the transition to
  // actual screen pixels instead of a field-uv constant, so it stays crisp
  // regardless of zoom/resolution.
  float edgeAA = fwidth(sdUnion) * 0.75 + 0.0004;
  float edgeMask = clamp(1.0 - smoothstep(-edgeAA, edgeAA, sdUnion), 0.0, 1.0);
  // Interior height: a GENTLER gradient than the edge, used only for the
  // mounded crown/interior colour falloff WITHIN the silhouette (never for
  // the ground/biomass boundary itself, which is edgeMask's job). Width
  // scaled down from increment 2's fixed 0.09/0.01 field-uv values in
  // proportion to CLUMP_FREQ's 4.0 -> 7.0 increase, so the gradient still
  // covers the same FRACTION of a clump now that clumps are smaller.
  float h = clamp(1.0 - smoothstep(-0.051, 0.006, sdUnion), 0.0, 1.0);
  // Thin rim: a narrow, fwidth-scaled |SDF| band hugging the silhouette — a
  // bright line, not a halo. The old fixed 0.018 field-uv band read as a
  // soft glow once clumps shrank at the new CLUMP_FREQ; fwidth keeps it a
  // near-constant pixel width instead.
  float rimAA = fwidth(sdUnion) * 1.5 + 0.0006;
  float rim = 1.0 - smoothstep(0.0, rimAA, abs(sdUnion));

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
  // excluded from the rim band). Art-direction tuning round: frequency now
  // scales WITH CLUMP_FREQ (so a clump interior always spans the same
  // number of speckle cycles regardless of clump size) and amplitude is
  // more than doubled (0.12 -> 0.28) — at the old fixed 26.0 frequency and
  // 0.12 amplitude the granular texture was invisible.
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

void main() {
  // Screen uv -> field uv (house formula, shared with the later pointer.ts).
  vec2 field = (vUv - 0.5) * uCover / uZoom + 0.5 + uPan;

  // Near-black warm living ground; the biomass field composites onto it.
  vec3 ground = vec3(0.045, 0.022, 0.04);
  vec3 biomassOnGround = sbBiomass(field, ground);

  // Cold pale blank: the sterile front's eventual destination colour.
  vec3 blank = vec3(0.87, 0.91, 0.93);

  // Vertical split at field.x > 1.0 - uSterile — still the increment-1
  // placeholder image (increment 3 replaces this with the real S-field): as
  // uSterile rises (sterileAt(songTime), sections.ts), the pale blank eats
  // the frame from the right, now revealing the real biomass on the living
  // side instead of the old gradient.
  float splitMask = step(1.0 - uSterile, field.x);
  vec3 color = mix(biomassOnGround, blank, splitMask);

  // uSoloMode switch: mode 5 forces the cold blank full-screen; mode 1
  // forces the biomass field alone over a flat mid-gray background across
  // the WHOLE frame (ignores the sterile split) so screenshots isolate the
  // geometry. Modes 2-4 (front / events / ghosts) have no dedicated layer
  // yet, so they fall through to the composed scene.
  if (uSoloMode == 5) {
    color = blank;
  } else if (uSoloMode == 1) {
    color = sbBiomass(field, vec3(0.5));
  }

  color += vec3(0.0) * futureLayerBudget();

  gl_FragColor = vec4(color, 1.0);
}
`;
}
