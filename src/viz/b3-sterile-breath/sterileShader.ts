/**
 * Fullscreen display shader for b3 "Sterile Breath". Increment-1 scaffold
 * ONLY: a real but deliberately trivial fragment — dark living ground on
 * the left, a hard vertical split into cold pale blank on the right, the
 * split position driven by uSterile so `?t=` seeks visibly move it. The
 * real layers (biomass field, advancing bleach front, strike/bloom/poke/
 * ripple events, ghost trails) land in increments 2-8; this file only
 * proves the plumbing (uniforms, domain transform, solo-mode switch, slot
 * budgets baked at build time) end to end.
 *
 * Shares b2's passthrough vertex shader shape and the house screen->field
 * mapping formula (b1's dish shader, b2's catalogueShader.ts):
 *
 *   field = (vUv - 0.5) * uCover / uZoom + 0.5 + uPan
 *
 * uSoloMode: 0 = full composed scene (trivial in this increment); future
 * mapping once the real layers land — 1 biomass / 2 front / 3 events /
 * 4 ghosts / 5 sterile (the cold blank forced full-screen, already wired
 * here so the switch itself is proven real, not just declared).
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
 * bakes reticleSlots/reach/glyphStrokes the same way). Unused by any real
 * layer YET (this increment has none), so they're referenced here in a
 * harmless, dead-code-free checksum (`futureLayerBudget()`, folded into the
 * output at zero weight) purely so they're real declared-and-used GLSL
 * constants rather than inert string interpolation nobody reads.
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

// Increment 2-8 layer budgets, baked as compile-time constants (unused by
// any real layer yet — see futureLayerBudget() below, the harmless
// declared-and-used checksum that keeps them real GLSL constants instead
// of inert string interpolation).
const int STRIKE_SLOTS = ${STRIKE_SLOTS};
const int BLOOM_SLOTS = ${BLOOM_SLOTS};
const int POKE_SLOTS = ${POKE_SLOTS};
const int RIPPLE_SLOTS = ${RIPPLE_SLOTS};
const int LOBES = ${LOBES};
const int FBM_OCT = ${FBM_OCT};

// Sums the future-layer budget constants into a single float. Folded into
// the final color at zero weight in main() — a real, compiled use of every
// constant above (not a no-op the compiler could complain is unused),
// while having no visible effect in this increment's trivial scene.
float futureLayerBudget() {
  float acc = 0.0;
  for (int i = 0; i < STRIKE_SLOTS; i++) acc += 1.0;
  for (int i = 0; i < BLOOM_SLOTS; i++) acc += 1.0;
  for (int i = 0; i < POKE_SLOTS; i++) acc += 1.0;
  for (int i = 0; i < RIPPLE_SLOTS; i++) acc += 1.0;
  for (int i = 0; i < LOBES; i++) acc += 1.0;
  for (int i = 0; i < FBM_OCT; i++) acc += 1.0;
  return acc;
}

void main() {
  // Screen uv -> field uv (house formula, shared with the later pointer.ts).
  vec2 field = (vUv - 0.5) * uCover / uZoom + 0.5 + uPan;

  // Dark living ground: deep warm near-black with a slow, subtle drifting
  // gradient — a placeholder for increment 2's real biomass field.
  vec3 ground = vec3(0.06, 0.03, 0.05);
  ground += vec3(0.02, 0.012, 0.006) * (0.5 + 0.5 * sin(uTime * 0.05 + field.x * 2.2));
  ground += vec3(0.01, 0.006, 0.01) * (0.5 + 0.5 * cos(uTime * 0.037 - field.y * 1.7));

  // Cold pale blank: the sterile front's eventual destination colour.
  vec3 blank = vec3(0.87, 0.91, 0.93);

  // Vertical split at field.x > 1.0 - uSterile — an obviously-b3 placeholder
  // image: as uSterile rises (sterileAt(songTime), sections.ts), the pale
  // blank eats the frame from the right. A hard step (no feather) on
  // purpose for this increment: it must be unmistakable in a screenshot
  // that a ?t= seek moved the boundary.
  float splitMask = step(1.0 - uSterile, field.x);
  vec3 color = mix(ground, blank, splitMask);

  // uSoloMode switch: mode 5 forces the cold blank full-screen (future
  // "sterile" solo layer) — proves the uniform path is real end to end.
  // Modes 1-4 (biomass / front / events / ghosts) have no dedicated layer
  // yet in this increment, so they fall through to the composed scene.
  if (uSoloMode == 5) {
    color = blank;
  }

  color += vec3(0.0) * futureLayerBudget();

  gl_FragColor = vec4(color, 1.0);
}
`;
}
