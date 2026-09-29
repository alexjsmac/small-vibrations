import{A as e,D as t,E as n,O as r,S as i,a,f as o,g as s,h as c,i as l,j as u,k as d,l as f,o as p,s as m,v as h,w as g,x as _,y as v}from"./three-BrpLoc7e.js";import{t as y}from"./random-gG32nY7D.js";import{n as b,t as x}from"./onset-BQ22vJ7j.js";var S=.48,C=1024,w=1/30,T=[2.4,2.8,3.2],E=[.35,.45,.55],D=15,O=`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`,k=`
float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
// Species is derived from the agent texel's own y-coordinate (thirds of the
// texture), never stored — this function is the single source of truth
// every pass (update, deposit) calls, so they can never drift apart.
float speciesOf(vec2 auv) { return floor(clamp(auv.y, 0.0, 0.999999) * 3.0); }
// Dormant agents (hash over activeFrac threshold) neither move nor deposit.
bool isActiveAgent(vec2 auv, float activeFrac) { return hash21(auv + 41.7) <= activeFrac; }
`;function ee(e){return`
precision highp float;
varying vec2 vUv;
uniform sampler2D uAgentPrev;
uniform sampler2D uTrail;
uniform float uDt;
uniform vec4 uSpeciesA[3]; // sensorDist, sensorAngle, turnRate, speed
uniform vec4 uSpeciesB[3]; // deposit (unused here), activeFrac, jitter, spare
uniform vec4 uFood[${e}]; // xy pos (dish-uv), z radius, w strength (0 = inactive)
uniform float uFoodPull;
uniform vec4 uBurst; // xy pos (dish-uv), z radius (unused), w strength (0 = inactive)
uniform float uBurstSeed;

const float DISH_R = ${S.toFixed(4)};
const vec2 DISH_C = vec2(0.5, 0.5);
const float PI = 3.14159265;
const float TWO_PI = 6.2831853;

${k}

float foodAt(vec2 p) {
  float f = 0.0;
  for (int i = 0; i < ${e}; i++) {
    vec4 fo = uFood[i];
    if (fo.w <= 0.0) continue;
    vec2 d = p - fo.xy;
    f += exp(-dot(d, d) / (fo.z * fo.z)) * fo.w;
  }
  return f;
}

// Turns 'heading' toward 'target' by at most 'rate' radians, taking the
// shortest angular path (wrapped into [-PI, PI] first).
float turnToward(float heading, float target, float rate) {
  float diff = mod(target - heading + PI, TWO_PI) - PI;
  return heading + clamp(diff, -rate, rate);
}

void main() {
  vec4 state = texture2D(uAgentPrev, vUv);
  vec2 pos = state.xy;
  float heading = state.z;

  float s = speciesOf(vUv);
  vec4 sA; vec4 sB;
  if (s < 0.5) { sA = uSpeciesA[0]; sB = uSpeciesB[0]; }
  else if (s < 1.5) { sA = uSpeciesA[1]; sB = uSpeciesB[1]; }
  else { sA = uSpeciesA[2]; sB = uSpeciesB[2]; }
  float sensorDist = sA.x, sensorAngle = sA.y, turnRate = sA.z, speed = sA.w;
  float activeFrac = sB.y, jitter = sB.z;

  // Burst teleport: independent of active/dormant state, so a burst visibly
  // erupts across the whole population rather than only where agents
  // already happened to be awake. Single-shot per tick this uniform is
  // active — index.ts owns the activation window.
  float burstHash = hash21(vUv * 913.73 + uBurstSeed);
  if (uBurst.w > 0.0 && burstHash < uBurst.w) {
    pos = uBurst.xy;
    heading = burstHash * TWO_PI; // random "outward" heading per agent
    gl_FragColor = vec4(pos, heading, 0.0);
    return;
  }

  if (!isActiveAgent(vUv, activeFrac)) {
    // Dormant: hold position and heading exactly.
    gl_FragColor = vec4(pos, heading, 0.0);
    return;
  }

  // Sense-and-turn: 3 sensors (ahead/left/right) read the trail's OWN
  // species channel plus the analytic food field (strongly weighted).
  vec2 dirF = vec2(cos(heading), sin(heading));
  vec2 dirL = vec2(cos(heading + sensorAngle), sin(heading + sensorAngle));
  vec2 dirR = vec2(cos(heading - sensorAngle), sin(heading - sensorAngle));
  vec2 pF = pos + dirF * sensorDist;
  vec2 pL = pos + dirL * sensorDist;
  vec2 pR = pos + dirR * sensorDist;

  vec3 trailF = texture2D(uTrail, pF).rgb;
  vec3 trailL = texture2D(uTrail, pL).rgb;
  vec3 trailR = texture2D(uTrail, pR).rgb;
  float chanF = s < 0.5 ? trailF.r : (s < 1.5 ? trailF.g : trailF.b);
  float chanL = s < 0.5 ? trailL.r : (s < 1.5 ? trailL.g : trailL.b);
  float chanR = s < 0.5 ? trailR.r : (s < 1.5 ? trailR.g : trailR.b);

  float valF = chanF + foodAt(pF) * uFoodPull;
  float valL = chanL + foodAt(pL) * uFoodPull;
  float valR = chanR + foodAt(pR) * uFoodPull;

  float jitterAmt = (hash21(vUv * 77.31 + heading * 3.1 + uBurstSeed * 0.01) - 0.5) * jitter;
  if (valF >= valL && valF >= valR) {
    heading += jitterAmt;
  } else if (valL > valR) {
    heading = turnToward(heading, heading + sensorAngle, turnRate) + jitterAmt;
  } else {
    heading = turnToward(heading, heading - sensorAngle, turnRate) + jitterAmt;
  }

  // Dish boundary: steer back toward centre when outside the inscribed
  // circle — no teleport.
  vec2 toCenter = DISH_C - pos;
  float distC = length(pos - DISH_C);
  if (distC > DISH_R) {
    float targetAngle = atan(toCenter.y, toCenter.x);
    heading = turnToward(heading, targetAngle, turnRate * 2.0);
  }

  pos += vec2(cos(heading), sin(heading)) * speed * uDt;

  // Hard clamp fallback: a fast agent can never escape the dish outright
  // while the steer-back above is still catching up over several ticks.
  vec2 fromCenter = pos - DISH_C;
  float d2 = length(fromCenter);
  if (d2 > DISH_R + 0.03) {
    pos = DISH_C + fromCenter * ((DISH_R + 0.03) / max(1e-5, d2));
  }

  gl_FragColor = vec4(pos, heading, 0.0);
}
`}var te=`
precision highp float;
varying vec2 vUv;
uniform float uSeed;
const float DISH_R = ${S.toFixed(4)};
float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  float h1 = hash21(vUv * 913.71 + uSeed);
  float h2 = hash21(vUv * 457.13 + uSeed * 1.37 + 11.7);
  float h3 = hash21(vUv * 77.31 + uSeed * 2.11 + 31.9);
  // Uniform-area sampling inside the inscribed dish circle (sqrt(h1), not
  // h1 directly — otherwise agents cluster toward the centre).
  float r = DISH_R * sqrt(h1);
  float theta = h2 * 6.2831853;
  vec2 pos = vec2(0.5) + vec2(cos(theta), sin(theta)) * r;
  float heading = h3 * 6.2831853;
  gl_FragColor = vec4(pos, heading, 0.0);
}
`,ne=`
precision highp float;
varying vec2 vUv;
uniform sampler2D uTrailPrev;
uniform vec2 uTexel;
uniform vec3 uDecay; // per-channel retention multiplier this tick, exp(-decayRate*dt)
uniform float uDecayFruit; // fruiting accumulator retention multiplier this tick
uniform float uFruitGain; // already pre-scaled by this substep's dt (TS side, see PhysarumSim.updateTrailUniforms) — a per-second rate, not a flat per-tick gain

void main() {
  vec4 prev = texture2D(uTrailPrev, vUv);
  vec2 tx = uTexel;
  // 3x3 tent blur of the RGB (species density) channels.
  vec3 sum = prev.rgb * 4.0;
  sum += texture2D(uTrailPrev, vUv + vec2(tx.x, 0.0)).rgb * 2.0;
  sum += texture2D(uTrailPrev, vUv - vec2(tx.x, 0.0)).rgb * 2.0;
  sum += texture2D(uTrailPrev, vUv + vec2(0.0, tx.y)).rgb * 2.0;
  sum += texture2D(uTrailPrev, vUv - vec2(0.0, tx.y)).rgb * 2.0;
  sum += texture2D(uTrailPrev, vUv + vec2(tx.x, tx.y)).rgb;
  sum += texture2D(uTrailPrev, vUv + vec2(-tx.x, tx.y)).rgb;
  sum += texture2D(uTrailPrev, vUv + vec2(tx.x, -tx.y)).rgb;
  sum += texture2D(uTrailPrev, vUv + vec2(-tx.x, -tx.y)).rgb;
  vec3 blurred = sum / 16.0;
  vec3 newRgb = blurred * uDecay;

  // Fruiting-body integrator: a slow accumulator of sustained local
  // density — fruiting bodies live where the network has PERSISTED, not
  // merely passed through.
  float a = clamp(prev.a * uDecayFruit + dot(newRgb, vec3(1.0 / 3.0)) * uFruitGain, 0.0, 1.0);
  gl_FragColor = vec4(newRgb, a);
}
`,re=`
precision highp float;
attribute vec2 aUv; // static texel-centre uv into the agent texture
uniform sampler2D uAgentTex;
uniform vec4 uSpeciesB[3]; // deposit, activeFrac, jitter, spare
// Deposit is a per-SECOND rate (matching uDecay's exp(-decayRate*dt) in the
// trail shader, also per-second) — scaling by the substep's own dt here is
// load-bearing: an unscaled flat deposit-per-tick vastly outruns decay
// whenever more ticks run per second (warmup's fixed-dt loop, or Lite's 1
// vs Full's 2 steps/frame), saturating the whole trail to solid white
// within seconds (caught live: readback showed every visited texel
// clamped to 1.0 after warmup).
uniform float uDt;
varying float vSpecies;
varying float vDeposit;
varying float vActive;

${k}

void main() {
  vec4 state = texture2D(uAgentTex, aUv);
  vec2 pos = state.xy;
  float s = speciesOf(aUv);
  vec4 sB;
  if (s < 0.5) sB = uSpeciesB[0];
  else if (s < 1.5) sB = uSpeciesB[1];
  else sB = uSpeciesB[2];
  // NOTE: 'active' is a GLSL reserved word (illegal as an identifier even
  // though it isn't used by any current stage) — named agentAwake instead.
  bool agentAwake = isActiveAgent(aUv, sB.y);
  vSpecies = s;
  vDeposit = sB.x * uDt;
  vActive = agentAwake ? 1.0 : 0.0;

  vec2 clip = pos * 2.0 - 1.0;
  // Dormant agents: push off-clip so nothing rasterizes for them — cheaper
  // than relying solely on the fragment-stage discard below, which would
  // still pay rasterization cost for a degenerate on-screen point.
  if (!agentAwake) clip = vec2(2.0, 2.0);
  gl_Position = vec4(clip, 0.0, 1.0);
  gl_PointSize = 1.0;
}
`,ie=`
precision highp float;
varying float vSpecies;
varying float vDeposit;
varying float vActive;
void main() {
  if (vActive < 0.5) discard;
  vec3 mask = vSpecies < 0.5 ? vec3(1.0, 0.0, 0.0)
            : vSpecies < 1.5 ? vec3(0.0, 1.0, 0.0)
            : vec3(0.0, 0.0, 1.0);
  gl_FragColor = vec4(mask * vDeposit, 0.0);
}
`,A=class{renderer;agentTexSize;trailTexSize;foodSlots;agentTargets;agentReadIndex=0;trailTargets;trailReadIndex=0;agentScene;trailScene;depositScene;orthoCam;agentQuad;agentMaterial;seedMaterial;trailQuad;trailMaterial;depositPoints;depositMaterial;speciesA;speciesB;params=null;speedMod=1;constructor(m,y,b,x){this.renderer=m,this.foodSlots=b,this.agentTexSize=y?512:256,this.trailTexSize=y?C:512;let S={type:m.extensions.get(`EXT_color_buffer_float`)?f:o,format:g,minFilter:h,magFilter:h,wrapS:p,wrapT:p,depthBuffer:!1,stencilBuffer:!1};this.agentTargets=[new u(this.agentTexSize,this.agentTexSize,S),new u(this.agentTexSize,this.agentTexSize,S)];let w={type:o,format:g,minFilter:c,magFilter:c,wrapS:p,wrapT:p,depthBuffer:!1,stencilBuffer:!1};this.trailTargets=[new u(this.trailTexSize,this.trailTexSize,w),new u(this.trailTexSize,this.trailTexSize,w)],this.orthoCam=new v(-1,1,1,-1,0,1),this.speciesA=[new e,new e,new e],this.speciesB=[new e,new e,new e],this.agentScene=new n;let T=new _(2,2);this.agentMaterial=new t({vertexShader:O,fragmentShader:ee(b),depthTest:!1,depthWrite:!1,uniforms:{uAgentPrev:{value:null},uTrail:{value:null},uDt:{value:0},uSpeciesA:{value:this.speciesA},uSpeciesB:{value:this.speciesB},uFood:{value:x},uFoodPull:{value:0},uBurst:{value:new e(0,0,0,0)},uBurstSeed:{value:0}}}),this.seedMaterial=new t({vertexShader:O,fragmentShader:te,depthTest:!1,depthWrite:!1,uniforms:{uSeed:{value:0}}}),this.agentQuad=new s(T,this.agentMaterial),this.agentScene.add(this.agentQuad),this.trailScene=new n,this.trailMaterial=new t({vertexShader:O,fragmentShader:ne,depthTest:!1,depthWrite:!1,uniforms:{uTrailPrev:{value:null},uTexel:{value:new r(1/this.trailTexSize,1/this.trailTexSize)},uDecay:{value:new d(1,1,1)},uDecayFruit:{value:1},uFruitGain:{value:0}}}),this.trailQuad=new s(new _(2,2),this.trailMaterial),this.trailScene.add(this.trailQuad);let E=this.agentTexSize,D=new Float32Array(E*E*2),k=0;for(let e=0;e<E;e++)for(let t=0;t<E;t++)D[k++]=(t+.5)/E,D[k++]=(e+.5)/E;let A=new a;A.setAttribute(`aUv`,new l(D,2)),A.setAttribute(`position`,new l(new Float32Array(E*E*3),3)),this.depositMaterial=new t({vertexShader:re,fragmentShader:ie,depthTest:!1,depthWrite:!1,transparent:!0,blending:5,blendEquation:100,blendSrc:201,blendDst:201,blendSrcAlpha:200,blendDstAlpha:201,uniforms:{uAgentTex:{value:null},uSpeciesB:{value:this.speciesB},uDt:{value:0}}}),this.depositPoints=new i(A,this.depositMaterial),this.depositPoints.frustumCulled=!1,this.depositScene=new n,this.depositScene.add(this.depositPoints),this.clearTrail()}setActParams(e){this.params=e}setSpeedMod(e){this.speedMod=e}setBurst(e,t,n,r,i){this.agentMaterial.uniforms.uBurst.value.set(e,t,n,r),this.agentMaterial.uniforms.uBurstSeed.value=i}updateAgentUniforms(e,t){let n=e.speed*this.speedMod;this.speciesA[0].set(e.sensDistA,e.sensAngleA,T[0],n),this.speciesA[1].set(e.sensDistB,e.sensAngleB,T[1],n),this.speciesA[2].set(e.sensDistC,e.sensAngleC,T[2],n),this.speciesB[0].set(e.deposit,e.activeA,E[0],0),this.speciesB[1].set(e.deposit,e.activeB,E[1],0),this.speciesB[2].set(e.deposit,e.activeC,E[2],0),this.agentMaterial.uniforms.uDt.value=t,this.agentMaterial.uniforms.uFoodPull.value=e.foodPull}updateTrailUniforms(e,t){let n=Math.exp(-e.decay*t);this.trailMaterial.uniforms.uDecay.value.set(n,n,n),this.trailMaterial.uniforms.uDecayFruit.value=Math.exp(-t/D),this.trailMaterial.uniforms.uFruitGain.value=e.fruitGain*t}step(e,t){let n=this.params;if(!n||t<=0)return;let r=e/t,i=this.renderer.getRenderTarget(),a=this.renderer.autoClear;for(let e=0;e<t;e++){this.updateAgentUniforms(n,r);let e=this.agentTargets[this.agentReadIndex],t=this.agentTargets[1-this.agentReadIndex];this.agentMaterial.uniforms.uAgentPrev.value=e.texture,this.agentMaterial.uniforms.uTrail.value=this.trailTargets[this.trailReadIndex].texture,this.renderer.setRenderTarget(t),this.renderer.autoClear=!0,this.renderer.render(this.agentScene,this.orthoCam),this.agentReadIndex=1-this.agentReadIndex,this.updateTrailUniforms(n,r);let i=this.trailTargets[this.trailReadIndex],a=this.trailTargets[1-this.trailReadIndex];this.trailMaterial.uniforms.uTrailPrev.value=i.texture,this.renderer.setRenderTarget(a),this.renderer.autoClear=!0,this.renderer.render(this.trailScene,this.orthoCam),this.depositMaterial.uniforms.uAgentTex.value=this.agentTargets[this.agentReadIndex].texture,this.depositMaterial.uniforms.uDt.value=r,this.renderer.autoClear=!1,this.renderer.render(this.depositScene,this.orthoCam),this.trailReadIndex=1-this.trailReadIndex}this.renderer.autoClear=a,this.renderer.setRenderTarget(i??null)}seedAgents(e){let t=e();this.seedMaterial.uniforms.uSeed.value=t;let n=this.renderer.getRenderTarget();this.agentQuad.material=this.seedMaterial;for(let e of this.agentTargets)this.renderer.setRenderTarget(e),this.renderer.render(this.agentScene,this.orthoCam);this.renderer.setRenderTarget(n??null),this.agentQuad.material=this.agentMaterial}clearTrail(){let e=this.renderer.getRenderTarget(),t=new m;this.renderer.getClearColor(t);let n=this.renderer.getClearAlpha();this.renderer.setClearColor(0,0);for(let e of this.trailTargets)this.renderer.setRenderTarget(e),this.renderer.clear(!0,!1,!1);this.renderer.setClearColor(t,n),this.renderer.setRenderTarget(e??null)}get trailTexture(){return this.trailTargets[this.trailReadIndex].texture}dispose(){this.agentTargets[0].dispose(),this.agentTargets[1].dispose(),this.trailTargets[0].dispose(),this.trailTargets[1].dispose(),this.agentMaterial.dispose(),this.seedMaterial.dispose(),this.trailMaterial.dispose(),this.depositMaterial.dispose(),this.agentQuad.geometry.dispose(),this.trailQuad.geometry.dispose(),this.depositPoints.geometry.dispose()}},ae=`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;function oe(e,t,n,r){return`
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
uniform vec4 uFood[${t}];
// Visual burst-flash pool (composite-only; distinct from physarum.ts's
// single sim-side uBurst/uBurstSeed teleport uniform — see physarum.ts's
// class doc for why these are two separate structures). Bubble spawns also
// fire into this same pool (index.ts's activateBurstVis), so a daughter's
// birth reads as a small flash at its spawn point for free.
uniform vec4 uBurstVis[${n}];
// Daughter-cell bubble pool (index.ts, full-biosphere act only): xy = dish-
// uv centre, z = current radius (<= 0 means the slot is inactive), w = a
// per-spawn hash seed driving this bubble's own trail-sample offset,
// rotation, and hue lean. Pooled Vector4s mutated in place by index.ts, zero
// per-frame allocation on either side.
uniform vec4 uBubble[${r}];
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

const float DISH_R = ${S.toFixed(4)};
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
${e?`  p = p * 2.07 + 11.3;
  v += 0.25 * vnoise(p);`:``}
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

${e?`  float aa = fwidth(distC) * 1.5;`:`  float aa = 0.006;`} // fixed epsilon on Lite: no derivatives on that path

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
  for (int i = 0; i < ${n}; i++) {
    vec4 b = uBurstVis[i];
    if (b.w <= 0.0) continue;
    float d = length(dishUv - b.xy);
    float ring = exp(-pow((d - b.z * 0.5) * 22.0, 2.0)) * b.w * exp(-b.z * 3.4);
    events += vec3(1.0, 0.85, 0.35) * ring;
  }
  for (int i = 0; i < ${t}; i++) {
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
    for (int i = 0; i < ${r}; i++) {
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
`}var se=4e3,ce=1200,le=class{renderer;object;material;geometry;uniforms;constructor(e,n,o){this.renderer=o;let s=y(e^93360613),c=Math.min(n.particleBudget,n.level===`full`?se:ce),u=new Float32Array(c*3),d=new Float32Array(c);for(let e=0;e<c;e++)u[e*3+0]=(s()*2-1)*.62,u[e*3+1]=(s()*2-1)*.62,u[e*3+2]=(s()*2-1)*.4,d[e]=s();this.geometry=new a,this.geometry.setAttribute(`position`,new l(u,3)),this.geometry.setAttribute(`aSeed`,new l(d,1)),this.uniforms={uFlowTime:{value:0},uTurbulence:{value:.6},uFlowAmount:{value:.5},uDensity:{value:1},uBrightness:{value:.65},uHigh:{value:0},uBass:{value:0},uScale:{value:90},uSeedShift:{value:s()*100},uFlash:{value:0},uZoom:{value:1},uCover:{value:new r(1,1)},uPan:{value:new r(0,0)}},this.material=new t({uniforms:this.uniforms,transparent:!0,depthTest:!1,depthWrite:!1,blending:2,vertexShader:`
        precision highp float;
        uniform float uFlowTime;
        uniform float uTurbulence;
        uniform float uFlowAmount;
        uniform float uDensity;
        uniform float uBass;
        uniform float uScale;
        uniform float uSeedShift;
        uniform float uZoom;
        uniform vec2 uCover;
        uniform vec2 uPan;
        attribute float aSeed;
        varying float vVisible;
        varying float vSparkle;

        float hash(vec3 p) {
          p = fract(p * 0.3183099 + uSeedShift);
          p *= 17.0;
          return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
        }
        float noise(vec3 p) {
          vec3 i = floor(p);
          vec3 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
                mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
            mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y),
            f.z);
        }
        vec3 noise3(vec3 p) {
          return vec3(noise(p), noise(p + 31.416), noise(p + 78.54));
        }
        // forward-difference curl of the noise3 potential — divergence-free drift
        vec3 curl(vec3 p) {
          const float e = 0.1;
          vec3 n0 = noise3(p);
          vec3 nx = noise3(p + vec3(e, 0.0, 0.0));
          vec3 ny = noise3(p + vec3(0.0, e, 0.0));
          vec3 nz = noise3(p + vec3(0.0, 0.0, e));
          return vec3(
            (ny.z - n0.z) - (nz.y - n0.y),
            (nz.x - n0.x) - (nx.z - n0.z),
            (nx.y - n0.y) - (ny.x - n0.x)
          ) / e;
        }

        void main() {
          vec3 noiseP = position * uTurbulence + aSeed * 10.0 + uFlowTime;
          vec3 driftPos = position + curl(noiseP) * uFlowAmount * 0.35;

          vVisible = 1.0 - step(uDensity, aSeed);
          vSparkle = aSeed;

          // Inverse of dishShader.ts's dishUv = (vUv-0.5)*uCover/uZoom+0.5+uPan:
          // a dish-space point (0.5 + driftPos.xy, offset from centre) maps
          // back to clip space via vUv = 0.5 + (dishPos-0.5-uPan)*uZoom/uCover,
          // and dishPos-0.5 is exactly driftPos.xy by construction here.
          vec2 clipUv = (driftPos.xy - uPan) * uZoom / uCover;
          gl_Position = vec4(clipUv * 2.0, 0.0, 1.0);

          float size = (0.010 + aSeed * 0.022) * (1.0 + uBass * 0.6);
          gl_PointSize = size * uScale;
        }
      `,fragmentShader:`
        precision highp float;
        uniform float uBrightness;
        uniform float uHigh;
        uniform float uFlash;
        varying float vVisible;
        varying float vSparkle;

        void main() {
          if (vVisible < 0.5) discard;
          float d = length(gl_PointCoord - 0.5);
          float falloff = smoothstep(0.5, 0.08, d);
          float brightness = clamp(uBrightness + uHigh * 0.4 + vSparkle * 0.15 + uFlash * 0.5, 0.0, 1.5);
          vec3 dim = vec3(0.45, 0.30, 0.08);   // dim amber-brown
          vec3 hot = vec3(1.0, 0.86, 0.42);    // spore gold
          vec3 col = mix(dim, hot, clamp(brightness, 0.0, 1.0));
          float alpha = falloff * clamp(brightness, 0.1, 1.0) * 0.7;
          gl_FragColor = vec4(col, alpha);
        }
      `}),this.object=new i(this.geometry,this.material),this.object.frustumCulled=!1}update(e,t,n,r,i,a,o=0){let s=n.params,c=this.uniforms;c.uFlowTime.value+=e*.5,c.uDensity.value=s.sporeDensity,c.uHigh.value=t.high,c.uBass.value=t.bass,c.uFlash.value=o,c.uZoom.value=r,c.uCover.value.copy(i),c.uPan.value.copy(a),c.uScale.value=this.renderer.domElement.height*.1}dispose(){this.geometry.dispose(),this.material.dispose()}},j=[0,54,106,130,154,178,234,251.238],M=[{name:`spores`,activeA:.35,activeB:0,activeC:0,sensDistA:.035,sensDistB:.03,sensDistC:.03,sensAngleA:.5,sensAngleB:.4,sensAngleC:.4,speed:.05,deposit:.15,decay:.25,fruitGain:.05,fruitGlow:.1,sporeDensity:1,burstRate:2,throb:.2,shimmer:.15,sat:.9,palMix:.1,zoom:1,foodPull:.3,bubbles:0},{name:`first-bloom`,activeA:.8,activeB:.1,activeC:0,sensDistA:.04,sensDistB:.03,sensDistC:.03,sensAngleA:.55,sensAngleB:.4,sensAngleC:.4,speed:.09,deposit:.45,decay:.2,fruitGain:.25,fruitGlow:.4,sporeDensity:.5,burstRate:10,throb:.6,shimmer:.3,sat:1,palMix:.2,zoom:1,foodPull:.4,bubbles:0},{name:`rot`,activeA:.55,activeB:.1,activeC:0,sensDistA:.04,sensDistB:.03,sensDistC:.03,sensAngleA:.5,sensAngleB:.4,sensAngleC:.4,speed:.06,deposit:.15,decay:.55,fruitGain:.1,fruitGlow:.2,sporeDensity:.3,burstRate:1.5,throb:.25,shimmer:.15,sat:.45,palMix:.55,zoom:1,foodPull:.2,bubbles:0},{name:`stirring`,activeA:.5,activeB:.7,activeC:0,sensDistA:.04,sensDistB:.07,sensDistC:.03,sensAngleA:.5,sensAngleB:.9,sensAngleC:.4,speed:.08,deposit:.3,decay:.3,fruitGain:.15,fruitGlow:.25,sporeDensity:.35,burstRate:4,throb:.35,shimmer:.25,sat:.7,palMix:.35,zoom:1,foodPull:.35,bubbles:0},{name:`convergence`,activeA:.7,activeB:.75,activeC:.4,sensDistA:.04,sensDistB:.07,sensDistC:.025,sensAngleA:.5,sensAngleB:.9,sensAngleC:.3,speed:.09,deposit:.4,decay:.25,fruitGain:.2,fruitGlow:.3,sporeDensity:.3,burstRate:6,throb:.4,shimmer:.3,sat:.55,palMix:.3,zoom:1,foodPull:.45,bubbles:0},{name:`full-biosphere`,activeA:.95,activeB:.9,activeC:.6,sensDistA:.045,sensDistB:.075,sensDistC:.028,sensAngleA:.55,sensAngleB:.95,sensAngleC:.32,speed:.11,deposit:.55,decay:.2,fruitGain:.3,fruitGlow:.55,sporeDensity:.6,burstRate:16,throb:.85,shimmer:.6,sat:1,palMix:.15,zoom:.72,foodPull:.5,bubbles:1},{name:`exhale`,activeA:.15,activeB:.05,activeC:.02,sensDistA:.035,sensDistB:.03,sensDistC:.025,sensAngleA:.5,sensAngleB:.4,sensAngleC:.3,speed:.04,deposit:.08,decay:.7,fruitGain:.05,fruitGlow:.15,sporeDensity:.9,burstRate:1,throb:.15,shimmer:.1,sat:.6,palMix:.1,zoom:1,foodPull:.2,bubbles:0}],N=[[0,.1],[40,.25],[53.8,.3],[54.3,.55],[90,.5],[106,.35],[130,.4],[154,.55],[177.8,.62],[178.3,.95],[210,1],[234,.5],[251.238,.12]],P={energy:0};function ue(e){let t=Math.min(Math.max(e,0),N[N.length-1][0]),n=0;for(;n<N.length-2&&t>=N[n+1][0];)n++;let r=N[n],i=N[n+1],a=Math.min(1,Math.max(0,(t-r[0])/Math.max(.001,i[0]-r[0])));return P.energy=r[1]+(i[1]-r[1])*a,P}var de=6;function fe(e){let t=Math.min(1,Math.max(0,e));return t*t*(3-2*t)}function pe(e,t,n){if(n<=0)return e;if(n>=1)return t;let r={...e,name:n<.5?e.name:t.name};for(let i of Object.keys(e)){let a=e[i],o=t[i];typeof a==`number`&&typeof o==`number`&&(r[i]=a+(o-a)*n)}return r}function me(e){let t=j[j.length-1],n=Math.min(Math.max(e,0),t-.001),r=0;for(;r<M.length-1&&n>=j[r+1];)r++;let i=j[r],a=j[r+1]??t,o=Math.min(1,Math.max(0,(n-i)/Math.max(.001,a-i))),s=r<M.length-1,c=a-n,l=s?fe(1-Math.min(1,c/de)):0,u=M[r];return{params:pe(u,s?M[r+1]:u,l),actIndex:r,localT:o,blend:l}}var he=.25,ge=.08,_e=.06,F=1.1,ve=.4,ye=.25,be=1.1,xe=1.6,Se=.5,Ce=.18,I=.05,L=.12,we=.09,Te=.45,Ee=1.2,De=50,R=.06,z=6,Oe=20,B=5e-4,ke=10,V=1.5,H=.16,U=14,Ae=10,W=.03,je=.09,Me=2.5,Ne=.07,Pe=2.5,Fe=.6,Ie=.55,G=.015,Le=7,Re=10,K=.1,q=.08,J=.14,Y=1.1,X=M.findIndex(e=>e.name===`full-biosphere`),Z=j[X],ze=j[X+1],Q=.03,Be=.12,Ve=.1,He=3;function $(e){let t=Math.sin(e*12.9898)*43758.5453;return t-Math.floor(t)}var Ue=class{renderer;scene;camera;sim;dishQuad;dishMaterial;spores;rand;soloDish=!0;soloSpores=!0;forceBurstAlways=!1;forceFoodAlways=!1;full=!0;foodSlotCount=6;burstVisSlotCount=4;stepsPerFrame=2;cover=new r(1,1);pan=new r(0,0);bassE=0;midE=0;highE=0;bassOnset=new x({refRate:he,relMargin:ge,absFloor:_e,cooldown:F});burstOnsetCooldown=0;flash=0;burstTimeToNext=0;burstActive=!1;burstTimeLeft=0;foodTimeToNext=0;foodSlots=[];foodValues;burstVisSlots=[];burstVisValues;bubbleSlotCount=U;bubbleSlots=[];bubbleValues;bubbleTimeToNext=0;motherX=.5;motherY=.5;motherVX=0;motherVY=0;motherR=S;motherUniformVec=new e(.5,.5,S,0);firstUpdate=!0;lastDt=0;lastSongTime=-1;held=!1;dragDx=0;dragDy=0;velX=0;velY=0;init(i){let{renderer:a,seed:o,quality:c}=i;this.renderer=a,this.rand=y(o^2969960014);let l=new URLSearchParams(location.search),u=l.get(`solo`);this.soloDish=!u||u===`veins`||u===`fruit`,this.soloSpores=!u||u===`spores`,this.forceBurstAlways=l.get(`burst`)===`always`,this.forceFoodAlways=l.get(`food`)===`always`;let d=u===`veins`?1:u===`fruit`?2:0;this.full=c.level===`full`,this.foodSlotCount=this.full?6:4,this.burstVisSlotCount=this.full?4:3,this.stepsPerFrame=this.full?2:1;for(let e=0;e<this.foodSlotCount;e++)this.foodSlots.push({age:0,active:!1});this.foodValues=[];for(let t=0;t<this.foodSlotCount;t++)this.foodValues.push(new e(0,0,R,0));for(let e=0;e<this.burstVisSlotCount;e++)this.burstVisSlots.push({age:0,active:!1});this.burstVisValues=[];for(let t=0;t<this.burstVisSlotCount;t++)this.burstVisValues.push(new e(0,0,0,0));this.bubbleSlotCount=this.full?U:Ae;for(let e=0;e<this.bubbleSlotCount;e++)this.bubbleSlots.push({active:!1,growTargetR:0,vx:0,vy:0,age:0});this.bubbleValues=[];for(let t=0;t<this.bubbleSlotCount;t++)this.bubbleValues.push(new e(0,0,0,0));this.scene=new n,this.camera=new v(-1,1,1,-1,0,1),u&&(this.scene.background=new m(3813440)),this.sim=new A(a,this.full,this.foodSlotCount,this.foodValues);let f=this.full?C:512;this.dishMaterial=new t({vertexShader:ae,fragmentShader:oe(this.full,this.foodSlotCount,this.burstVisSlotCount,this.bubbleSlotCount),depthTest:!1,depthWrite:!1,uniforms:{uTrail:{value:null},uTrailTexel:{value:new r(1/f,1/f)},uCover:{value:new r(1,1)},uPan:{value:this.pan},uZoom:{value:1},uTime:{value:0},uBass:{value:0},uHigh:{value:0},uFlash:{value:0},uThrob:{value:0},uShimmer:{value:0},uSat:{value:1},uPalMix:{value:0},uEnergy:{value:0},uFruitGlow:{value:0},uFood:{value:this.foodValues},uBurstVis:{value:this.burstVisValues},uBubble:{value:this.bubbleValues},uMother:{value:this.motherUniformVec},uSoloMode:{value:d}}}),this.dishQuad=new s(new _(2,2),this.dishMaterial),this.soloDish&&this.scene.add(this.dishQuad),this.spores=new le(o,c,a),this.soloSpores&&this.scene.add(this.spores.object);let p=a.domElement,h=p.clientWidth||1,g=p.clientHeight||1;this.resize(h,g)}kickFlash(e){this.flash=Math.min(xe,this.flash+e)}randomDishPoint(){let e=S*Math.sqrt(this.rand()),t=this.rand()*Math.PI*2;return[.5+Math.cos(t)*e,.5+Math.sin(t)*e]}activateBurstVis(e,t,n){let r=this.burstVisSlots.findIndex(e=>!e.active);r<0&&(r=0);let i=this.burstVisSlots[r];i.active=!0,i.age=0,this.burstVisValues[r].set(e,t,0,n)}updateBurstVisAges(e){for(let t=0;t<this.burstVisSlots.length;t++){let n=this.burstVisSlots[t];n.active&&(n.age+=e,n.age>=Ee?(n.active=!1,this.burstVisValues[t].w=0):this.burstVisValues[t].z=n.age)}}triggerBurst(e,t,n,r){this.burstActive=!0,this.burstTimeLeft=Ce,this.sim.setBurst(e,t,n,r,this.rand()),this.activateBurstVis(e,t,1)}updateBurstActive(e){this.burstActive&&(this.burstTimeLeft-=e,this.burstTimeLeft<=0&&(this.burstActive=!1,this.sim.setBurst(0,0,0,0,0)))}scheduleBursts(e,t){let n=Math.max(0,t)/60;if(!(n<=0))for(this.burstTimeToNext-=e;this.burstTimeToNext<=0;){let[e,t]=this.randomDishPoint();this.triggerBurst(e,t,I,L),this.kickFlash(ye);let r=Math.max(1e-6,this.rand());this.burstTimeToNext+=-Math.log(r)/n}}scriptedMassBurst(){this.triggerBurst(.5,.5,we,Te);for(let e=0;e<3;e++){let[e,t]=this.randomDishPoint();this.activateBurstVis(e,t,1)}this.kickFlash(be)}activateFood(e,t){let n=this.foodSlots.findIndex(e=>!e.active);n<0&&(n=0);let r=this.foodSlots[n];r.active=!0,r.age=0,this.foodValues[n].set(e,t,R,1)}updateFoodAges(e){for(let t=0;t<this.foodSlots.length;t++){let n=this.foodSlots[t];n.active&&(n.age+=e,n.age>=z?(n.active=!1,this.foodValues[t].w=0):this.foodValues[t].w=1-n.age/z)}}scheduleFood(e,t){let n=Math.max(0,t)/60;if(!(n<=0))for(this.foodTimeToNext-=e;this.foodTimeToNext<=0;){let[e,t]=this.randomDishPoint();this.activateFood(e,t);let r=Math.max(1e-6,this.rand());this.foodTimeToNext+=-Math.log(r)/n}}trySpawnBubble(){let e=-1;for(let t=0;t<this.bubbleSlots.length;t++)if(!this.bubbleSlots[t].active){e=t;break}if(e<0)return;let t=-1;if(this.rand()<.5){let e=0;for(let n=0;n<this.bubbleSlots.length;n++)this.bubbleSlots[n].active&&this.bubbleValues[n].z>Ne&&(e++,this.rand()<1/e&&(t=n))}let n=this.rand()*Math.PI*2,r,i;if(t>=0){let e=this.bubbleValues[t];r=e.x+Math.cos(n)*(e.z+.5*W),i=e.y+Math.sin(n)*(e.z+.5*W)}else r=this.motherX+Math.cos(n)*(this.motherR+.5*W),i=this.motherY+Math.sin(n)*(this.motherR+.5*W);let a=this.bubbleSlots[e];a.active=!0,a.age=0,a.growTargetR=je+this.rand()*.07,a.vx=0,a.vy=0,this.bubbleValues[e].set(r,i,W,this.rand()),this.activateBurstVis(r,i,Ie)}scheduleBubbleSpawns(e,t,n){if(t.bubbles<=.001)return;let r=Math.min(1,Math.max(0,(n-Z)/Math.max(.001,ze-Z))),i=1/(Pe+-1.8*Math.min(1,r/Fe));for(this.bubbleTimeToNext-=e;this.bubbleTimeToNext<=0;){this.trySpawnBubble();let e=Math.max(1e-6,this.rand());this.bubbleTimeToNext+=-Math.log(e)/i}}updateBubbles(e,t,n){let r=this.bubbleSlots,i=this.bubbleValues,a=r.length,o=1-Math.exp(-e/Me);for(let n=0;n<a;n++){let a=r[n];if(!a.active)continue;a.age+=e;let s=i[n],c=a.growTargetR*t.bubbles;s.z+=(c-s.z)*o,s.z<.01&&a.age>.1&&(a.active=!1,s.set(0,0,0,0))}for(let t=0;t<a;t++){if(!r[t].active)continue;let o=i[t];for(let n=t+1;n<a;n++){if(!r[n].active)continue;let a=i[n],s=a.x-o.x,c=a.y-o.y,l=Math.max(1e-5,Math.hypot(s,c)),u=o.z+a.z+G;if(l>=u)continue;let d=s/l,f=c/l,p=u-l,m=o.z*o.z/(o.z*o.z+a.z*a.z+1e-6),h=1-m,g=p*Le*e;r[t].vx-=d*g*h,r[t].vy-=f*g*h,r[n].vx+=d*g*m,r[n].vy+=f*g*m}let s=o.x-this.motherX,c=o.y-this.motherY,l=Math.max(1e-5,Math.hypot(s,c)),u=this.motherR+o.z+G;if(l<u){let n=s/l,i=c/l,a=(u-l)*Re*e;r[t].vx+=n*a,r[t].vy+=i*a;let d=o.z*o.z/(this.motherR*this.motherR);this.motherVX-=n*a*d,this.motherVY-=i*a*d}let d=o.x-this.motherX,f=o.y-this.motherY,p=Math.max(1e-5,Math.hypot(d,f)),m=$(o.w*3.7+1.1)<.5?1:-1,h=-f/p*m,g=d/p*m;r[t].vx+=h*K*e,r[t].vy+=g*K*e;let _=.5+$(o.w*5.21+2.3)*.8,v=.5+$(o.w*7.77+9.4)*.8,y=$(o.w*3.14+6.6)*Math.PI*2,b=$(o.w*4.44+8.8)*Math.PI*2,x=Math.sin(n*_+y),S=Math.cos(n*v+b);r[t].vx+=x*q*e,r[t].vy+=S*q*e}let s=Math.exp(-2.2*e);for(let t=0;t<a;t++){let n=r[t];if(!n.active)continue;let a=i[t];a.x+=n.vx*e,a.y+=n.vy*e,n.vx*=s,n.vy*=s;let o=Math.hypot(n.vx,n.vy);if(o>J){let e=J/o;n.vx*=e,n.vy*=e}let c=a.x-.5,l=a.y-.5,u=Math.hypot(c,l);u>Y&&(a.x=.5+c/u*Y,a.y=.5+l/u*Y,n.vx=0,n.vy=0)}}updateMother(e){let t=0,n=0,r=0,i=0,a=this.bubbleSlots,o=this.bubbleValues;for(let e=0;e<a.length;e++){if(!a[e].active)continue;let s=o[e],c=s.z*s.z;t+=c,n+=s.x*c,r+=s.y*c,i+=c}let s=.5,c=.5;i>1e-6&&(s=.5-Be*(n/i-.5),c=.5-Be*(r/i-.5));let l=this.motherX-s,u=this.motherY-c;this.motherVX+=-3*l*e,this.motherVY+=-3*u*e,this.motherX+=this.motherVX*e,this.motherY+=this.motherVY*e;let d=Math.exp(-2.5*e);this.motherVX*=d,this.motherVY*=d;let f=this.motherX-.5,p=this.motherY-.5,m=Math.hypot(f,p);m>Q&&(this.motherX=.5+f/m*Q,this.motherY=.5+p/m*Q,this.motherVX=0,this.motherVY=0),t/=S*S;let h=S*(1-Ve*Math.min(1,t)),g=1-Math.exp(-e/He);this.motherR+=(h-this.motherR)*g,this.motherUniformVec.set(this.motherX,this.motherY,this.motherR,0)}resetBubbles(){for(let e=0;e<this.bubbleSlots.length;e++){let t=this.bubbleSlots[e];t.active=!1,t.vx=0,t.vy=0,t.age=0,this.bubbleValues[e].set(0,0,0,0)}this.bubbleTimeToNext=0,this.motherX=.5,this.motherY=.5,this.motherVX=0,this.motherVY=0,this.motherR=S,this.motherUniformVec.set(.5,.5,S,0)}warmup(e,t,n){n&&this.sim.seedAgents(this.rand),this.sim.setActParams(e),this.sim.step(w*t,t)}update(e,t){let n=me(t.time),r=n.params;if(this.lastDt=e,this.firstUpdate&&(this.firstUpdate=!1,this.warmup(r,180,!0),r.bubbles>.001&&t.time>Z)){let e=.25;for(let n=Z;n<t.time;n+=e)this.scheduleBubbleSpawns(e,r,n),this.updateBubbles(e,r,n),this.updateMother(e),this.updateBurstVisAges(e)}this.lastSongTime>=0&&t.time<this.lastSongTime-10&&(this.sim.clearTrail(),this.warmup(r,60,!0),this.resetBubbles()),this.lastSongTime>=0&&t.time-this.lastSongTime>=0&&t.time-this.lastSongTime<.5&&(this.lastSongTime<54&&t.time>=54&&this.scriptedMassBurst(),this.lastSongTime<178&&t.time>=178&&this.scriptedMassBurst()),this.lastSongTime=t.time;let i=Math.min(1,e*8),a=this.bassE;if(this.bassE+=(t.bass-this.bassE)*i,this.midE+=(t.mid-this.midE)*i,this.highE+=(t.high-this.highE)*i,this.burstOnsetCooldown-=e,this.bassOnset.update(e,this.bassE,a)){if(this.burstOnsetCooldown<=0){let[e,t]=this.randomDishPoint();this.triggerBurst(e,t,I,L),this.burstOnsetCooldown=b(F,r.burstRate)}this.kickFlash(ve),r.bubbles>.001&&this.trySpawnBubble()}this.scheduleBursts(e,this.forceBurstAlways?De:r.burstRate),this.updateBurstActive(e),this.updateBurstVisAges(e),this.scheduleFood(e,this.forceFoodAlways?Oe:0),this.updateFoodAges(e),this.scheduleBubbleSpawns(e,r,t.time),this.updateBubbles(e,r,t.time),this.updateMother(e),this.flash*=Math.exp(-3.2*e),this.sim.setSpeedMod(1+this.midE*Se),this.sim.setActParams(r);let o=this.dishMaterial.uniforms;o.uTime.value+=e,o.uBass.value=this.bassE,o.uHigh.value=this.highE,o.uFlash.value=this.flash,o.uThrob.value=r.throb,o.uShimmer.value=r.shimmer,o.uSat.value=r.sat,o.uPalMix.value=r.palMix,o.uFruitGlow.value=r.fruitGlow,o.uEnergy.value=ue(t.time).energy;let s=r.zoom;o.uZoom.value=s;let c=this.cover;if(this.held){if(e>1e-5){let t=Math.min(1,e*ke),n=Math.min(V,Math.max(-1.5,this.dragDx/e)),r=Math.min(V,Math.max(-1.5,this.dragDy/e));this.velX+=(n-this.velX)*t,this.velY+=(r-this.velY)*t}this.dragDx=0,this.dragDy=0}else if(this.velX!==0||this.velY!==0){this.pan.x+=this.velX*c.x/s*e,this.pan.y+=this.velY*c.y/s*e;let t=Math.exp(-2.5*e);this.velX*=t,this.velY*=t,Math.abs(this.velX)<B&&(this.velX=0),Math.abs(this.velY)<B&&(this.velY=0)}let l=Math.hypot(this.pan.x,this.pan.y);l>H&&(this.pan.x*=H/l,this.pan.y*=H/l,this.velX=0,this.velY=0),this.spores.update(e,t,n,s,c,this.pan,this.flash)}pointer(e){let t=this.dishMaterial.uniforms.uZoom.value,n=this.cover;if(e.type===`down`){this.held=!0,this.dragDx=0,this.dragDy=0,this.velX=0,this.velY=0;let r=(e.x-.5)*n.x/t+.5+this.pan.x,i=(e.y-.5)*n.y/t+.5+this.pan.y;this.activateFood(r,i);return}if(e.type===`move`){if(!this.held)return;this.pan.x+=e.dx*n.x/t,this.pan.y+=e.dy*n.y/t,this.dragDx+=e.dx,this.dragDy+=e.dy;return}if(e.type===`up`){this.held=!1;return}this.held=!1,this.velX=0,this.velY=0,this.dragDx=0,this.dragDy=0}render(){this.sim.step(this.lastDt,this.stepsPerFrame),this.dishMaterial.uniforms.uTrail.value=this.sim.trailTexture,this.renderer.setRenderTarget(null),this.renderer.render(this.scene,this.camera)}resize(e,t){if(!this.dishMaterial||e<=0||t<=0)return;let n=Math.min(3.5,Math.max(.28,e/t));n>=1?this.cover.set(n,1):this.cover.set(1,1/n),this.dishMaterial.uniforms.uCover.value.copy(this.cover)}dispose(){this.sim.dispose(),this.dishMaterial.dispose(),this.dishQuad.geometry.dispose(),this.spores.dispose(),this.renderer.setRenderTarget(null)}},We={default:()=>new Ue}.default;export{We as default};
//# sourceMappingURL=b1-biosphere-DAL_UGXQ.js.map