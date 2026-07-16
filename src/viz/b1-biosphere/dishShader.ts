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
 *
 * Climax-act addition (full-biosphere, 178-234s): a daughter-cell bubble
 * colony (index.ts's CPU pool, `uBubble`) — each active bubble is an
 * independent circular WINDOW into the SAME trail texture, with its own
 * rotate/scale/offset, so it shows a visibly different living network
 * without a second sim. `groundAt`/`veinsAt`/`cellRender` below are the ONE
 * shared implementation both the mother dish and every daughter render
 * through — no copy-pasted second vein pipeline.
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
 * (Full 6/4, Lite 4/3 — see physarum.ts's constants table). `bubbleSlots`
 * bakes the uBubble array length and loop bound for the daughter-cell colony
 * (Full 14, Lite 10 — see index.ts's BUBBLE_SLOTS_FULL/LITE).
 */
export function buildDishFragmentShader(full: boolean, foodSlots: number, burstSlots: number, bubbleSlots: number): string {
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
// class doc for why these are two separate structures). Bubble spawns also
// fire into this same pool (index.ts's activateBurstVis), so a daughter's
// birth reads as a small flash at its spawn point for free.
uniform vec4 uBurstVis[${burstSlots}];
// Daughter-cell bubble pool (index.ts, full-biosphere act only): xy = dish-
// uv centre, z = current radius (<= 0 means the slot is inactive), w = a
// per-spawn hash seed driving this bubble's own trail-sample offset,
// rotation, and hue lean. Pooled Vector4s mutated in place by index.ts, zero
// per-frame allocation on either side.
uniform vec4 uBubble[${bubbleSlots}];
// Mother physics body (index.ts's updateMother, round-2 taste pass): xy =
// current dish-uv centre (spring-anchored to (0.5,0.5), displaced by
// daughter jostle), z = current (crowd-eased) radius, w unused. Default
// (0.5, 0.5, DISH_R, 0) — every mother formula below is written so that
// default value reduces algebraically to the pre-round-2 fixed-dish code
// (offset 0, scale 1), so acts 1-5 and solo modes stay pixel-identical.
uniform vec4 uMother;
// 0 = all layers (ground+veins+fruit+events), 1 = veins-only isolation
// (?solo=veins), 2 = fruit-only isolation (?solo=fruit) — both isolation
// modes force a flat neutral ground so the additive layer reads on
// contrast, per the house "isolate on a bright background" convention. The
// daughter-bubble colony is skipped entirely in solo modes (a mother-only
// debug affordance).
uniform float uSoloMode;

const float DISH_R = ${DISH_R.toFixed(4)};
// Fixed AA epsilon for daughter-bubble rims — daughters never have screen-
// space derivatives of their own distance-to-edge computed the way the
// mother's fwidth(distC) does (that would need a non-uniform-flow fwidth()
// call inside the bubble-selection branch, which gives incorrect results at
// branch boundaries), so a small fixed epsilon stands in — visually a thin
// glass-rim look scaled to the daughters' much smaller radius.
const float DAUGHTER_AA = 0.01;

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

// ---- shared circular-window renderer: ground mottle + edge darkening +
// glass-rim highlight, used for the mother dish AND every daughter bubble —
// the ONE implementation the plan calls for. edgeDist is the window's OWN
// radius minus the pixel's distance from the window's OWN centre (dish-uv
// units): positive inside, 0 at the rim, negative outside. The mother
// passes DISH_R - distC; a daughter passes its own interior depth (b.z -
// length(dishUv - b.xy)) — same formula, same units, so both read as the
// same kind of glass dish regardless of physical size. darker dims a
// daughter's ground base a touch so it reads as a distinct pocket, not just
// more of the mother's own surface. ----
vec3 groundAt(vec2 noiseUv, float edgeDist, float aaAmt, float darker, float timeSec) {
  vec3 groundBase = vec3(0.055, 0.02, 0.07) * darker;
  float mottle = fbm(noiseUv * 6.0 + timeSec * 0.01);
  vec3 g = groundBase * (0.85 + 0.3 * mottle);
  float edge = 1.0 - smoothstep(-0.015, 0.02, edgeDist);
  g = mix(g, vec3(0.01, 0.006, 0.015) * darker, edge);
  float rim = exp(-pow(edgeDist / max(aaAmt, 0.006) * 0.25, 2.0));
  g += vec3(0.5, 0.42, 0.55) * rim * 0.4;
  return g;
}

// ---- shared vein renderer: per-channel palette ramp (R->gold, G->orchid,
// B->chartreuse, rare/precious so weighted down) with the hue-preserving
// intensity-compression fix (see the module doc's "additive multi-channel
// palettes wash to white" lesson) — the ONE vein implementation shared by
// the mother and every daughter. hueLean (-1..1, per-bubble from its own
// seed; the mother always passes 0) nudges the species weighting a touch
// toward gold(+)/chartreuse(-) without breaking the compression — at 0 this
// reduces algebraically to the original plain formula. throb = bass
// brightness swell, shimmer = hash flicker + a cheap iridescent hue tilt
// from the trail's own screen-space gradient magnitude (thin-film feel
// without transmission — TECHNIQUES.md sec.5 mobile rule). ----
vec3 veinsAt(vec2 sampleUv, float throbAmt, float shimmerAmt, float highAmt, float energyLift, float hueLean, float timeSec) {
  vec4 trailSample = texture2D(uTrail, sampleUv);
  float rI = pow(clamp(trailSample.r, 0.0, 1.0), 0.7);
  float gI = pow(clamp(trailSample.g, 0.0, 1.0), 0.7);
  float bI = pow(clamp(trailSample.b, 0.0, 1.0), 0.7);
  vec3 colGold = vec3(1.0, 0.78, 0.25);
  vec3 colOrchid = vec3(0.75, 0.35, 0.95);
  vec3 colChartreuse = vec3(0.65, 0.95, 0.25);
  float leanGold = 1.0 + max(0.0, hueLean) * 0.35;
  float leanChart = 1.0 + max(0.0, -hueLean) * 0.35;
  float totI = rI * leanGold + gI + bI * 0.7 * leanChart;
  vec3 veinHue = totI > 1e-4
    ? (colGold * rI * leanGold + colOrchid * gI + colChartreuse * bI * 0.7 * leanChart) / totI
    : vec3(0.0);
  vec3 veins = veinHue * min(totI, 1.15) * throbAmt;
  veins += vec3(1.0, 0.96, 0.82) * smoothstep(1.5, 2.6, totI) * 0.25;

  vec3 dx = texture2D(uTrail, sampleUv + vec2(uTrailTexel.x, 0.0)).rgb - texture2D(uTrail, sampleUv - vec2(uTrailTexel.x, 0.0)).rgb;
  vec3 dy = texture2D(uTrail, sampleUv + vec2(0.0, uTrailTexel.y)).rgb - texture2D(uTrail, sampleUv - vec2(0.0, uTrailTexel.y)).rgb;
  float gradMag = length(dx) + length(dy);
  float flicker = hash21(sampleUv * 800.0 + timeSec * 3.0) * step(0.4, rI + gI + bI);
  veins += vec3(1.0) * flicker * shimmerAmt * highAmt * 0.18;
  float hueTilt = clamp(gradMag * 6.0, 0.0, 1.0) * shimmerAmt * 0.35;
  veins = mix(veins, veins.brg, hueTilt);
  veins *= energyLift;
  return veins;
}

// Convenience combinator for one full "cell" (ground + veins) — used ONLY by
// the daughter-bubble loop in main() below; the mother keeps calling
// groundAt/veinsAt separately so its solo-mode isolation paths (which need
// ground and veins as independently selectable layers) stay untouched.
vec3 cellRender(vec2 sampleUv, float edgeDist, float aaAmt, float darker, float throbAmt, float shimmerAmt, float highAmt, float energyLift, float hueLean, float timeSec) {
  return groundAt(sampleUv, edgeDist, aaAmt, darker, timeSec) + veinsAt(sampleUv, throbAmt, shimmerAmt, highAmt, energyLift, hueLean, timeSec);
}

// Cheap 2D hash in [-1, 1] — a daughter bubble's own trail-sample-window
// centre offset (see main()'s bubble loop below).
vec2 hash2(float p) {
  float a = hash21(vec2(p, p * 1.734 + 3.1));
  float b = hash21(vec2(p * 3.271 + 7.1, p * 0.531 + 2.9));
  return vec2(a, b) * 2.0 - 1.0;
}

// Culture medium — the living substrate the dish sits IN, filling the
// negative space instead of collapsing to black. Slow-churning aubergine fbm
// plus faint "ghosted hyphae": a shrunken, heavily-dimmed sample of the same
// trail network spread across the whole field, so the biosphere reads as
// extending beyond the glass. Tuned ~30% below the evaluation prototype so it
// stays well under the dish's own brightness and never competes with the
// colony — the dish is always the in-focus subject.
vec3 cultureMedium(vec2 p, float t) {
  float m = fbm(p * 3.0 + t * 0.02);
  float m2 = fbm(p * 6.5 - t * 0.015);
  vec3 base = vec3(0.056, 0.025, 0.072) * (0.55 + 1.0 * m);
  base += vec3(0.028, 0.013, 0.04) * m2;
  vec3 ghost = texture2D(uTrail, p * 0.42 + 0.29).rgb;
  float gl = ghost.r + ghost.g + ghost.b * 0.7;
  base += vec3(0.22, 0.15, 0.08) * gl * 0.28;
  return base;
}

void main() {
  vec2 dishUv = (vUv - 0.5) * uCover / uZoom + 0.5 + uPan;
  // distC is now measured from the mother's CURRENT centre (uMother.xy),
  // not the fixed (0.5, 0.5) — at the default uMother this is identical to
  // round-1's distC.
  float distC = length(dishUv - uMother.xy);

${full ? `  float aa = fwidth(distC) * 1.5;` : `  float aa = 0.006;`} // fixed epsilon on Lite: no derivatives on that path

  float throbAmt = 1.0 + uThrob * uBass * 0.6;
  // Energy lift (see uEnergy above): 1.0 at the climax, dimmer elsewhere.
  float energyLift = 0.55 + 0.45 * uEnergy;

  // ---- ground: deep aubergine ink, subtle fbm mottling, edge darkening +
  // a faint glass-rim highlight (sells "petri dish"). Solo modes (veins/
  // fruit isolation) override to a flat neutral so the additive layer
  // above reads on contrast instead of near-black. Mother-only — daughters
  // get their own ground inside cellRender in the bubble loop below. edgeDist
  // uses uMother.z (the mother's current, crowd-eased radius) in place of
  // the fixed DISH_R; noise sampling (dishUv) is left in screen/dish space,
  // NOT remapped — only the trail-derived veins/fruit sample below rides the
  // mother's jostle+shrink. ----
  vec3 ground;
  if (uSoloMode > 0.5) {
    ground = vec3(0.5, 0.5, 0.5);
  } else {
    ground = groundAt(dishUv, uMother.z - distC, aa, 1.0, uTime);
    // Outside the dish rim, blend the near-black ground toward the living
    // culture medium so the negative space is substrate, not void.
    float outside = smoothstep(uMother.z - 0.01, uMother.z + 0.06, distC);
    ground = mix(ground, cultureMedium(dishUv, uTime), outside);
  }

  // Mother trail-sample uv: the shrunken/displaced mother window remapped
  // back into the trail's fixed DISH_R sim space, so the vein/fruit network
  // compresses INTO the shrunken dish and rides its jostle (the sim itself
  // stays in fixed space — physarum.ts is untouched). At the default uMother
  // (0.5, 0.5, DISH_R) this reduces to dishUv exactly (offset 0, scale 1).
  vec2 motherSampleUv = vec2(0.5) + (dishUv - uMother.xy) * (DISH_R / uMother.z);

  // ---- veins: the mother's own sample of the shared veinsAt above (hueLean
  // 0 = the plain, unleaned palette). ----
  vec3 veins = veinsAt(motherSampleUv, throbAmt, uShimmer, uHigh, energyLift, 0.0, uTime);

  // ---- fruiting bodies: from the trail's A channel (the slow persistence
  // integrator, physarum.ts's trail-diffuse pass) — soft glowing colonies
  // with a slow breathing pulse; brightness also lifts on uFlash.
  // Mother-only (the plan's daughter spec covers ground+veins+rim only). ----
  vec4 trailSample = texture2D(uTrail, motherSampleUv);
  float fruit = trailSample.a;
  float fruitBand = smoothstep(0.35, 0.75, fruit);
  float breathe = 0.7 + 0.3 * sin(uTime * 0.6 + dishUv.x * 12.0 + dishUv.y * 7.0);
  vec3 fruitCol = vec3(1.0, 0.85, 0.35) * fruitBand * breathe * uFruitGlow * (1.0 + uFlash * 0.7) * (0.6 + 0.4 * uEnergy);

  // ---- events: burst flashes (radial gold ring, ~0.5s attack/decay) and
  // faint warm glow at nutrient drops. Mother-only. Positions (b.xy/fo.xy)
  // stay in FIXED sim space (index.ts's randomDishPoint/pointer mapping,
  // unremapped) rather than following uMother — their sub-pixel display
  // drift under the mother's small (<=0.05) offset is acceptable, and these
  // are momentary flashes, not the persistent trail network that needs to
  // visually compress with the dish. ----
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
  // the climax — a growth escaping at 3 o'clock). Trail-derived layers
  // (veins, fruit) are clipped just past uMother.z (the mother's current
  // radius, replacing the fixed DISH_R); EVENTS are exempt — burst rings
  // are momentary flashes, not trail smear, and daughter bubbles spawn (and
  // flash) OUTSIDE the mother's rim by construction. ----
  float inside = 1.0 - smoothstep(uMother.z - 0.004, uMother.z + 0.012, distC);
  veins *= inside;
  fruitCol *= inside;

  // ---- mother composite (solo modes isolate a single additive layer) ----
  vec3 motherCol = ground;
  if (uSoloMode < 0.5) {
    motherCol += veins + fruitCol + events;
  } else if (uSoloMode < 1.5) {
    motherCol += veins;
  } else {
    motherCol += fruitCol;
  }

  // ---- daughter-cell bubbles (full-biosphere act only): independent
  // circular windows into the SAME trail texture, each with its own
  // rotate/scale/offset (see cellRender above) — "many of them fighting for
  // the space", not a second sim. Skipped entirely in any solo-isolation
  // mode (a mother-only debug affordance). Finds the DEEPEST bubble under
  // this pixel so overlapping daughters (and a daughter overlapping the
  // mother's own edge) flatten their contact boundary like pressed foam,
  // per the plan; a slot with b.z <= 0.0 is inactive and skipped. With every
  // uBubble slot inactive (acts 1-5, and the exhale act once the colony has
  // fully drained) this whole block is a no-op and col falls straight
  // through to motherCol — pixel-identical to the pre-bubble shader. ----
  vec3 col = motherCol;
  if (uSoloMode < 0.5) {
    float bestDepth = 0.0;
    vec4 bestB = vec4(0.0);
    bool foundBubble = false;
    for (int i = 0; i < ${bubbleSlots}; i++) {
      vec4 b = uBubble[i];
      if (b.z <= 0.0) continue;
      float depth = b.z - length(dishUv - b.xy);
      if (depth > 0.0 && depth > bestDepth) {
        bestDepth = depth;
        bestB = b;
        foundBubble = true;
      }
    }
    if (foundBubble) {
      // growthFrac: b.z ranges 0.03 (just spawned) .. 0.16 (full target) —
      // matches index.ts's BUBBLE_TARGET_R_MAX literal.
      float growthFrac = clamp(bestB.z / 0.16, 0.0, 1.0);
      float windowR = mix(0.10, 0.22, growthFrac);
      vec2 sampleCenter = vec2(0.5, 0.5) + hash2(bestB.w) * 0.18;
      vec2 localUnit = (dishUv - bestB.xy) / bestB.z;
      float ang = bestB.w * 6.2831853;
      float ca = cos(ang), sa = sin(ang);
      vec2 rotated = vec2(localUnit.x * ca - localUnit.y * sa, localUnit.x * sa + localUnit.y * ca);
      vec2 sampleUv = sampleCenter + rotated * windowR;
      float hueLean = hash21(vec2(bestB.w * 9.13, bestB.w * 2.71 + 4.7)) * 2.0 - 1.0;
      vec3 daughterCol = cellRender(sampleUv, bestDepth, DAUGHTER_AA, 0.65, throbAmt, uShimmer, uHigh, energyLift, hueLean, uTime);
      // Feather the last DAUGHTER_AA of depth into the mother's own
      // composite underneath, instead of a hard binary switch at the rim
      // ("edge AA with the existing aa", per the plan).
      float edgeBlend = smoothstep(-DAUGHTER_AA, DAUGHTER_AA, bestDepth);
      col = mix(motherCol, daughterCol, edgeBlend);
    }
  }

  // ---- grade: per-act desaturation (the rot act bruises the palette),
  // palette lean, vignette, filmic. ----
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(lum), col, uSat);
  col = mix(col, col * vec3(1.08, 0.85, 1.12), uPalMix);

  // Microscope optic over the whole frame: aspect-corrected so the vignette
  // and rings are truly circular on a wide canvas (uCover is (aspect, 1)).
  // Faint concentric lens rings + a cool chromatic fringe at the periphery +
  // a circular optic vignette — the negative space becomes the eyepiece, and
  // the whole frame reads as "specimen under the scope". Rings/fringe tuned
  // ~30% below the evaluation prototype so they frame without competing.
  vec2 fp = (vUv - 0.5) * uCover;
  float rf = length(fp);
  float rings = 0.5 + 0.5 * sin(rf * 90.0);
  col += vec3(0.55, 0.5, 0.7) * pow(rings, 6.0) * 0.026 * smoothstep(0.05, 0.5, rf);
  col = mix(col, col * vec3(0.8, 0.9, 1.2), smoothstep(0.4, 0.95, rf) * 0.48);
  float vig = smoothstep(1.02, 0.32, rf * 1.35);
  col *= vig;
  col = 1.0 - exp(-col * 2.2);
  gl_FragColor = vec4(col, 1.0);
}
`;
}
