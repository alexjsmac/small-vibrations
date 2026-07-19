/**
 * Voronoi biome-cell display shader for a3 "Biome Dominoes". Renders the
 * excitable field (excitableField.ts) as a lattice of biome cells: each cell
 * samples the activation field at its OWN feature point, so the whole cell
 * lights uniformly as the wave crosses it — a continuous travelling wave read
 * per-cell as sequential domino hops. Edge filaments between adjacent firing
 * cells are the visible "chain links".
 *
 * Screen -> field mapping is the house formula (b1's dish shader):
 *   field = (vUv - 0.5) * uCover / uZoom + 0.5 + uPan
 * pointer.ts / index.ts reuse the SAME formula for screen->field, never a
 * parallel inverse. The field target is RepeatWrapping, so field-space past
 * [0,1] tiles seamlessly (the synchrony pull-back).
 *
 * Palette (electric neural — transmission/signal, distinct from b1's organic
 * wetness): deep indigo substrate; life-bloom chartreuse; hot cyan leading
 * edge; magenta-violet refractory afterglow; hot-pink warmth accent.
 *
 * Channels read from the field texture: .r = u (activation), .g = v
 * (recovery/refractory). NO backticks inside the GLSL (template-literal
 * truncation trap — a2 lesson); the built source is rendered to a file and
 * read during the build.
 *
 * uSoloMode: 0 = full lattice render; 1 = raw field heat (u->red, v->green)
 * for isolating/debugging the sim itself (?solo=field).
 */

export const LATTICE_VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export function buildLatticeFragment(rippleSlots: number): string {
  return `
precision highp float;
varying vec2 vUv;

uniform sampler2D uField;
uniform vec2 uCover;
uniform vec2 uPan;
uniform float uZoom;
uniform float uCellFreq;
uniform float uTime;
uniform float uFlash;     // full-scene event flash (0..~1.6, slow channel)
uniform float uSparkle;   // smoothed high-band shimmer (0..1)
uniform float uSparkKick; // high-ONSET fast kick+decay channel (a2 tempo-separation idiom)
uniform float uSparkSeed; // per-spark-event counter — re-rolls WHICH cells flash each event
uniform vec4 uRipple[${rippleSlots}]; // tap ripples: xy field pos, z age (s), w strength (0 = inactive)
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
const vec3 BLOOM     = vec3(0.68, 1.0, 0.20);      // chartreuse / lime (life)
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

// iq Voronoi with edge distance (2007). Returns the nearest feature point's
// integer cell coords (out cellCoord), the feature point position in the
// SAME scaled space (out cellPoint), and the distance to the nearest cell
// border (out edgeDist).
void voronoi(vec2 p, out vec2 cellCoord, out vec2 cellPoint, out float edgeDist) {
  vec2 n = floor(p);
  vec2 f = fract(p);
  vec2 mg = vec2(0.0);
  vec2 mr = vec2(0.0);
  float md = 8.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 o = hash22(n + g);
      vec2 r = g + o - f;
      float d = dot(r, r);
      if (d < md) { md = d; mr = r; mg = g; }
    }
  }
  float mdEdge = 8.0;
  for (int j = -2; j <= 2; j++) {
    for (int i = -2; i <= 2; i++) {
      vec2 g = mg + vec2(float(i), float(j));
      vec2 o = hash22(n + g);
      vec2 r = g + o - f;
      vec2 diff = mr - r;
      if (dot(diff, diff) > 0.00001) {
        mdEdge = min(mdEdge, dot(0.5 * (mr + r), normalize(r - mr)));
      }
    }
  }
  cellCoord = n + mg;
  cellPoint = n + mg + hash22(n + mg);
  edgeDist = mdEdge;
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
  voronoi(p, cellCoord, cellPoint, edgeDist);

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

  float cellRand = hash21(cellCoord + 3.17);

  // --- cell fill ---
  vec3 col = SUBSTRATE;
  // Faint idle breathing so dormant cells aren't dead-flat.
  col += SUBSTRATE * 0.5 * (0.4 + 0.6 * vnoise(cellCoord * 1.3 + uTime * 0.05));

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
  col += hot * uBloomGain * bloom * micro;

  // A small near-white kiss at the very leading edge.
  col += vec3(0.85, 1.0, 0.92) * uFrontGain * front * 0.3;

  // Magenta-violet refractory afterglow: v high while u has decayed away.
  float refractory = clamp(v - u * 1.3, 0.0, 1.0);
  col += REFRACT * uRefractGlow * refractory;

  // Warmth lean: push blooming/active cells toward hot pink as warmth rises.
  col = mix(col, col + WARM * (bloom * 0.5 + front * 0.4), uWarmth);

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
  for (int i = 0; i < ${rippleSlots}; i++) {
    vec4 rp = uRipple[i];
    if (rp.w <= 0.0) continue;
    vec2 rd = field - rp.xy;
    rd -= floor(rd + 0.5);
    float d = length(rd);
    float r = 0.02 + rp.z * 0.30;
    float ring = exp(-pow((d - r) * 70.0, 2.0)) * rp.w * exp(-rp.z * 2.8);
    col += vec3(0.92, 0.97, 1.0) * ring;
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
`;
}
