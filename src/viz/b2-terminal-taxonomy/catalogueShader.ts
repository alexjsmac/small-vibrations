import { COMM_CELL_GLSL } from './communityField';

/**
 * Fullscreen display shader for b2 "Terminal Taxonomy": a pale-bone catalogue
 * world where discrete SPECIMENS — living micro-communities, each with its
 * own hue, Turing-ish skin, and unreadable glyph script — lie on paper and
 * are scanned, labeled, and flattened by a rust-toned machine. Deliberately
 * NOT a tiling cell lattice (that geometry is a3's): communities render as
 * organic ink-rimmed silhouettes via a nearest-specimen-SDF search
 * (`specimenSearch`), with real bone ground between them, and their
 * placement drifts from natural scatter to aligned museum-drawer rows as
 * `uMachineOrder` rises. Shares a3's vertex-shader shape, the
 * `1.0 - exp(-col * k)` hue-preserving tonemap, and the house screen->field
 * mapping formula (b1's dish shader, shared with pointer.ts / index.ts):
 *
 *   field = (vUv - 0.5) * uCover / uZoom + 0.5 + uPan
 *   p = (field - 0.5) * uCommFreq   (centre-anchored Voronoi scaling)
 *
 * Sim texture channels (written by the field sim, sampled here):
 *   .r = vitality   (0..1 living energy — regrows, drained by scans)
 *   .g = classified  (0..1 machine ratchet — only moves forward)
 *   .b = poke glow   (0..1 local re-ignition glow from a tap)
 *   .a = archive ink (0..1 persistent scan-label residue)
 *
 * Two coupled reads per community cell: the WHOLE cell is sampled at its
 * anchor's field-uv (the "whole-patch flattening" read, same idiom as a3
 * sampling the excitable field at the cell's feature point) and the
 * fragment's OWN field-uv is sampled again for the local poke glow / ink
 * (continuous, sub-cell resolution).
 *
 * Glyph script: each community's "language" is a stable set of hashed bits
 * (stroke-angle family, curvature flag, column count, baseline rotation);
 * character identity re-rolls on a staggered per-glyph-cell schedule (the
 * "chatter") so writing never strobes as one global event. A second, fixed
 * "machine code" grammar (vertical ticks/dots, single column, raster-order
 * row pulse) crossfades in as a community is classified.
 *
 * uSoloMode: 0 = full composed scene; 1 = raw sim channels (r/g/b -> R/G/B);
 * 2 = patchwork only (hue + interior pattern, no glyphs/machine/grade);
 * 3 = glyph ink only on neutral mid-gray; 4 = machine layer only (grid +
 * reticles + labels + archive ink on the bone ground). All four solo layers
 * are computed unconditionally alongside the composed scene; the branch at
 * the end of main() only picks which one to output (a3's solo-mode idiom:
 * clarity over micro-optimization).
 *
 * NO backticks anywhere in the GLSL strings (template-literal truncation
 * trap, a2 lesson). All loops have compile-time constant bounds, baked from
 * the builder's arguments exactly like a3's Voronoi window / ripple pool.
 */

export const CATALOGUE_VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/**
 * Builds the catalogue fragment shader source.
 *   rippleSlots   - size of the uRipple pool (tap-poke feedback rings).
 *   reticleSlots  - size of the uScanA/uScanB pool (classification scans).
 *   reach         - Voronoi search window half-width: 2 -> 5x5 (Full,
 *                   exact), 1 -> 3x3 (Lite, cheaper, rare edge gaps at
 *                   triple junctions) - same tradeoff as a3's `reach`.
 *   glyphStrokes  - line-segment SDFs drawn per living glyph cell: 4 (Full)
 *                   for legible multi-stroke characters, 2 (Lite) for a
 *                   cheaper sparser script.
 */
export function buildCatalogueFragment(
  rippleSlots: number,
  reticleSlots: number,
  reach: number,
  glyphStrokes: number,
): string {
  const R = Math.max(1, Math.floor(reach));
  const W = 2 * R + 1;
  const STROKES = Math.max(1, Math.floor(glyphStrokes));
  return `
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
uniform vec4 uScanA[${reticleSlots}]; // xy field-uv centre, z age (s), w strength (0 = inactive)
uniform vec4 uScanB[${reticleSlots}]; // x radius, y mislabel flag, z label seed, w unused
uniform vec4 uRipple[${rippleSlots}]; // xy field-uv, z age (s), w strength (0 = inactive)
uniform float uEventVivid; // 0..1 how strongly events (link strikes, waves) restore specimens' vivid pre-flattening color
uniform vec4 uLinkA[3]; // xy field-uv A (source), z age (s), w strength (0 = inactive)
uniform vec4 uLinkB[3]; // xy field-uv B (target/struck), z label seed, w unused
uniform vec4 uRunner[4]; // x axis (0 horizontal / 1 vertical), y line coordinate (screen-space grid gv), z age (s), w strength (0 = inactive)

const vec3 RUST = vec3(0.769, 0.302, 0.227);
const vec3 MACHINE_TONE = vec3(0.62, 0.50, 0.44);

${COMM_CELL_GLSL}

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

// Nearest-specimen search over the ${W}x${W} window: the fragment belongs
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
  for (int j = -${R}; j <= ${R}; j++) {
    for (int i = -${R}; i <= ${R}; i++) {
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

    float inkAA = fwidth(rr) * 1.6 + 0.002;
    float detailGate = winScale * (1.0 - ordAmt * 0.5) * mix(1.0, 0.7, classFlat);
    float detailAlpha = smoothstep(inkAA, inkAA * 0.4, dInk) * detailGate;
    patchworkCol = mix(patchworkCol, inkLine, detailAlpha);
  }

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
  for (int s = 0; s < ${STROKES}; s++) {
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
  for (int i = 0; i < ${reticleSlots}; i++) {
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

    float fade = 1.0 - smoothstep(1.0, 1.4, age);
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
    // scale-pop from 1.4x down to 1.0x over the phase's first 0.12s.
    float xAge = max(age - 0.35, 0.0);
    float xGate = step(0.35, age);
    float xs = mix(1.4, 1.0, smoothstep(0.0, 0.12, xAge));
    vec2 xl = ttRot(-0.7853982) * ((field - B) / xs);
    float xHalf = 0.035;
    float dX = min(ttSegDist(xl, vec2(-xHalf, 0.0), vec2(xHalf, 0.0), 0.0),
                   ttSegDist(xl, vec2(0.0, -xHalf), vec2(0.0, xHalf), 0.0));
    float xAA = fwidth(dX) * 1.5 + 0.001;
    float xAlpha = (1.0 - smoothstep(0.005, 0.005 + xAA, dX)) * xGate * strength * fade;
    col = mix(col, vec3(0.13, 0.07, 0.05), xAlpha);
  }


  // --- tap ripples: near-white expanding rings, torus-wrapped (a3's idiom) ---
  for (int i = 0; i < ${rippleSlots}; i++) {
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
`;
}
