import { COMM_CELL_GLSL } from './communityField';

/**
 * Fullscreen display shader for b2 "Terminal Taxonomy": a pale-bone catalogue
 * world where a patchwork of living micro-communities (each with its own
 * hue, Turing-ish interior pattern, and unreadable glyph script) is scanned,
 * labeled, and flattened by a rust-toned machine. Sibling of a3's
 * latticeShader.ts — same vertex-shader shape, same n-window Voronoi search
 * (here over community anchors from communityField.ts's `commAnchor`), same
 * `1.0 - exp(-col * k)` hue-preserving tonemap, same house screen->field
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
uniform vec4 uScanA[${reticleSlots}]; // xy field-uv centre, z age (s), w strength (0 = inactive)
uniform vec4 uScanB[${reticleSlots}]; // x radius, y mislabel flag, z label seed, w unused
uniform vec4 uRipple[${rippleSlots}]; // xy field-uv, z age (s), w strength (0 = inactive)

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

// iq Voronoi with edge distance (F2-F1 style, a3's idiom) over a single
// n-centred ${W}x${W} window of community anchors (commAnchor). The second
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
  for (int j = -${R}; j <= ${R}; j++) {
    for (int i = -${R}; i <= ${R}; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 o = commAnchor(n + g);
      vec2 r = g + o - f;
      float d = dot(r, r);
      if (d < md) { md = d; mr = r; mg = g; winOff = o; }
    }
  }
  float mdEdge = 8.0;
  for (int j = -${R}; j <= ${R}; j++) {
    for (int i = -${R}; i <= ${R}; i++) {
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

  // --- grade ---
  float luma = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(col, vec3(luma), uDesat);
  col = mix(col, RUST * (0.35 + 0.65 * luma), uRustMix * (0.4 + 0.6 * uClassified));
  float survM = smoothstep(0.18, 0.55, length((vUv - 0.5) * uCover));
  col = mix(col, mix(col, vec3(luma) * 0.92, 0.85), survM * uSurvivorFocus);

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
`;
}
