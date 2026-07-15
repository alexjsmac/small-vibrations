import { DISH_R } from './physarum';

/**
 * The petri dish — one fullscreen fragment shader compositing the Physarum
 * trail texture (physarum.ts) into a lit "under glass" scene: deep aubergine
 * ground with a glass rim, per-species vein palette ramp (gold/orchid/
 * chartreuse), fruiting-body glow colonies, and event flashes (bursts +
 * nutrient drops). Quality is baked at shader-source build time
 * (`buildDishFragmentShader`), matching a2-hive's wallShader.ts pattern —
 * fbm octave count and edge AA method differ Full vs Lite; everything else
 * is uniform-driven so a mid-song quality change never needs a live branch
 * (VizHost rebuilds the whole module on quality change anyway).
 */

/** Trivial fullscreen-quad passthrough — identical idiom to a1/a2's VERT. */
export const DISH_VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/**
 * Builds the dish composite fragment shader. `full` bakes in a 2-octave fbm
 * ground mottle + fwidth()-based edge AA (vs. 1 octave + a fixed epsilon on
 * Lite — mirrors wallShader.ts's honeyFbm/aa pattern verbatim). `foodSlots`/
 * `burstSlots` bake the uFood/uBurstVis array lengths and loop bounds
 * (Full 6/4, Lite 4/3 — see physarum.ts's constants table).
 */
export function buildDishFragmentShader(full: boolean, foodSlots: number, burstSlots: number): string {
  return `
precision highp float;
varying vec2 vUv;

uniform sampler2D uTrail;
uniform vec2 uTrailTexel;
uniform vec2 uCover;
uniform vec2 uPan;
uniform float uZoom;
uniform float uTime;
// Note: audio.mid deliberately does NOT drive anything here — its one job
// (per the plan's audio-map table) is agent speed, applied in physarum.ts
// via PhysarumSim.setSpeedMod(), not the composite grade.
uniform float uBass, uHigh, uFlash;
uniform float uThrob, uShimmer, uSat, uPalMix, uFruitGlow;
// arcAt's continuous energy envelope (sections.ts ARC_KEYS) — its
// near-vertical steps at 54s/178s land here as a visible brightness snap on
// veins + fruiting bodies, the "palette snap" half of the two scripted
// discrete hits (the mass spore-burst is the other half). At the climax
// (energy 1.0) the lift is exactly 1.0, so the act-6 hero look is
// untouched; early acts sit dimmer, which also serves act 1's
// "sparse first hyphae" intent.
uniform float uEnergy;
// Nutrient drops (tap-injected) — shared BY REFERENCE with physarum.ts's
// agent-update material (index.ts owns the pooled array), so a drop pulls
// agents AND glows in the composite from one write.
uniform vec4 uFood[${foodSlots}];
// Visual burst-flash pool (composite-only; distinct from physarum.ts's
// single sim-side uBurst/uBurstSeed teleport uniform — see physarum.ts's
// class doc for why these are two separate structures).
uniform vec4 uBurstVis[${burstSlots}];
// 0 = all layers (ground+veins+fruit+events), 1 = veins-only isolation
// (?solo=veins), 2 = fruit-only isolation (?solo=fruit) — both isolation
// modes force a flat neutral ground so the additive layer reads on
// contrast, per the house "isolate on a bright background" convention.
uniform float uSoloMode;

const float DISH_R = ${DISH_R.toFixed(4)};

float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1, 0)), u.x),
             mix(hash21(i + vec2(0, 1)), hash21(i + vec2(1, 1)), u.x), u.y);
}
// Ground mottle fbm: 2 octaves Full, 1 Lite (baked — costliest per-pixel
// term after the trail texture fetches, so first in the perf cut order).
float fbm(vec2 p) {
  float v = 0.5 * vnoise(p);
${full ? `  p = p * 2.07 + 11.3;
  v += 0.25 * vnoise(p);` : ''}
  return v;
}

void main() {
  vec2 dishUv = (vUv - 0.5) * uCover / uZoom + 0.5 + uPan;
  float distC = length(dishUv - vec2(0.5));

${full ? `  float aa = fwidth(distC) * 1.5;` : `  float aa = 0.006;`} // fixed epsilon on Lite: no derivatives on that path

  // ---- ground: deep aubergine ink, subtle fbm mottling, edge darkening +
  // a faint glass-rim highlight (sells "petri dish"). Solo modes (veins/
  // fruit isolation) override to a flat neutral so the additive layer
  // above reads on contrast instead of near-black. ----
  vec3 ground;
  if (uSoloMode > 0.5) {
    ground = vec3(0.5, 0.5, 0.5);
  } else {
    vec3 groundBase = vec3(0.055, 0.02, 0.07);
    float mottle = fbm(dishUv * 6.0 + uTime * 0.01);
    ground = groundBase * (0.85 + 0.3 * mottle);
    float edge = smoothstep(DISH_R - 0.02, DISH_R + 0.015, distC);
    ground = mix(ground, vec3(0.01, 0.006, 0.015), edge);
    float rim = exp(-pow((distC - DISH_R) / max(aa, 0.006) * 0.25, 2.0));
    ground += vec3(0.5, 0.42, 0.55) * rim * 0.4;
  }

  // ---- veins: per-channel palette ramp (R->gold, G->orchid, B->chartreuse,
  // rare/precious so weighted down), throb = bass brightness swell,
  // shimmer = hash flicker + a cheap iridescent hue tilt from the trail's
  // own screen-space gradient magnitude (thin-film feel without
  // transmission — TECHNIQUES.md sec.5 mobile rule). ----
  vec4 trailSample = texture2D(uTrail, dishUv);
  float rI = pow(clamp(trailSample.r, 0.0, 1.0), 0.7);
  float gI = pow(clamp(trailSample.g, 0.0, 1.0), 0.7);
  float bI = pow(clamp(trailSample.b, 0.0, 1.0), 0.7);
  vec3 colGold = vec3(1.0, 0.78, 0.25);
  vec3 colOrchid = vec3(0.75, 0.35, 0.95);
  vec3 colChartreuse = vec3(0.65, 0.95, 0.25);
  float throbAmt = 1.0 + uThrob * uBass * 0.6;
  // Hue-preserving intensity compression: a plain sum of the three species
  // colors blows out to white wherever the trail channels saturate together
  // (verified live at t=200 — the climax read as a pale plasma ball, not
  // the plan's saturated spore-gold). Blend the HUE by per-species weight,
  // cap the total intensity, and let only the very hottest cores lift
  // toward cream. Below the cap this is algebraically identical to the old
  // sum, so the sparse early acts are untouched.
  float totI = rI + gI + bI * 0.7;
  vec3 veinHue = totI > 1e-4
    ? (colGold * rI + colOrchid * gI + colChartreuse * bI * 0.7) / totI
    : vec3(0.0);
  vec3 veins = veinHue * min(totI, 1.15) * throbAmt;
  veins += vec3(1.0, 0.96, 0.82) * smoothstep(1.5, 2.6, totI) * 0.25;

  vec3 dx = texture2D(uTrail, dishUv + vec2(uTrailTexel.x, 0.0)).rgb - texture2D(uTrail, dishUv - vec2(uTrailTexel.x, 0.0)).rgb;
  vec3 dy = texture2D(uTrail, dishUv + vec2(0.0, uTrailTexel.y)).rgb - texture2D(uTrail, dishUv - vec2(0.0, uTrailTexel.y)).rgb;
  float gradMag = length(dx) + length(dy);
  float flicker = hash21(dishUv * 800.0 + uTime * 3.0) * step(0.4, rI + gI + bI);
  veins += vec3(1.0) * flicker * uShimmer * uHigh * 0.18;
  float hueTilt = clamp(gradMag * 6.0, 0.0, 1.0) * uShimmer * 0.35;
  veins = mix(veins, veins.brg, hueTilt);
  // Energy lift (see uEnergy above): 1.0 at the climax, dimmer elsewhere.
  float energyLift = 0.55 + 0.45 * uEnergy;
  veins *= energyLift;

  // ---- fruiting bodies: from the trail's A channel (the slow persistence
  // integrator, physarum.ts's trail-diffuse pass) — soft glowing colonies
  // with a slow breathing pulse; brightness also lifts on uFlash. ----
  float fruit = trailSample.a;
  float fruitBand = smoothstep(0.35, 0.75, fruit);
  float breathe = 0.7 + 0.3 * sin(uTime * 0.6 + dishUv.x * 12.0 + dishUv.y * 7.0);
  vec3 fruitCol = vec3(1.0, 0.85, 0.35) * fruitBand * breathe * uFruitGlow * (1.0 + uFlash * 0.7) * (0.6 + 0.4 * uEnergy);

  // ---- events: burst flashes (radial gold ring, ~0.5s attack/decay) and
  // faint warm glow at nutrient drops. ----
  vec3 events = vec3(0.0);
  for (int i = 0; i < ${burstSlots}; i++) {
    vec4 b = uBurstVis[i];
    if (b.w <= 0.0) continue;
    float d = length(dishUv - b.xy);
    float ring = exp(-pow((d - b.z * 0.5) * 22.0, 2.0)) * b.w * exp(-b.z * 3.4);
    events += vec3(1.0, 0.85, 0.35) * ring;
  }
  for (int i = 0; i < ${foodSlots}; i++) {
    vec4 fo = uFood[i];
    if (fo.w <= 0.0) continue;
    float d = length(dishUv - fo.xy);
    events += vec3(1.0, 0.7, 0.3) * exp(-d * d / (fo.z * fo.z)) * fo.w * 0.35;
  }

  // ---- dish-interior mask: life stays under the glass. Agents deposit
  // right up to the rim and the trail blur bleeds a little past it, so
  // unmasked veins smear ugly gold blobs OUTSIDE the dish (verified live at
  // the climax — a growth escaping at 3 o'clock). Everything additive is
  // clipped just past DISH_R; the rim highlight sits on top unaffected. ----
  float inside = 1.0 - smoothstep(DISH_R - 0.004, DISH_R + 0.012, distC);
  veins *= inside;
  fruitCol *= inside;
  events *= inside;

  // ---- composite (solo modes isolate a single additive layer) ----
  vec3 col = ground;
  if (uSoloMode < 0.5) {
    col += veins + fruitCol + events;
  } else if (uSoloMode < 1.5) {
    col += veins;
  } else {
    col += fruitCol;
  }

  // ---- grade: per-act desaturation (the rot act bruises the palette),
  // palette lean, vignette, filmic. ----
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(lum), col, uSat);
  col = mix(col, col * vec3(1.08, 0.85, 1.12), uPalMix);

  float vig = smoothstep(1.25, 0.35, length(vUv - 0.5) * 1.6);
  col *= vig;
  col = 1.0 - exp(-col * 2.2);
  gl_FragColor = vec4(col, 1.0);
}
`;
}
