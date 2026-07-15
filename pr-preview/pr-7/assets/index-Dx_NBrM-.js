import{a as _,n as E,N as Y,b as Q,F as xe,H as $,L as Z,O as ue,V as p,S as C,d as N,e as T,M as O,g as Te,c as b,B as ce,f as F,o as P,Z as ye,p as Ae,q as we,h as de,C as ve,A as Be}from"./three-vlqji54k.js";import{m as fe}from"./random-DL1jLgMw.js";const S=.48,De=512,_e=256,me=1024,pe=512,K=6,Ee=4,q=4,Me=3,J=2,Re=1,Ce=180,Fe=60,Ue=1/30,L=[2.4,2.8,3.2],I=[.35,.45,.55],Pe=15,z=`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`,ge=`
float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
// Species is derived from the agent texel's own y-coordinate (thirds of the
// texture), never stored — this function is the single source of truth
// every pass (update, deposit) calls, so they can never drift apart.
float speciesOf(vec2 auv) { return floor(clamp(auv.y, 0.0, 0.999999) * 3.0); }
// Dormant agents (hash over activeFrac threshold) neither move nor deposit.
bool isActiveAgent(vec2 auv, float activeFrac) { return hash21(auv + 41.7) <= activeFrac; }
`;function Le(d){return`
precision highp float;
varying vec2 vUv;
uniform sampler2D uAgentPrev;
uniform sampler2D uTrail;
uniform float uDt;
uniform vec4 uSpeciesA[3]; // sensorDist, sensorAngle, turnRate, speed
uniform vec4 uSpeciesB[3]; // deposit (unused here), activeFrac, jitter, spare
uniform vec4 uFood[${d}]; // xy pos (dish-uv), z radius, w strength (0 = inactive)
uniform float uFoodPull;
uniform vec4 uBurst; // xy pos (dish-uv), z radius (unused), w strength (0 = inactive)
uniform float uBurstSeed;

const float DISH_R = ${S.toFixed(4)};
const vec2 DISH_C = vec2(0.5, 0.5);
const float PI = 3.14159265;
const float TWO_PI = 6.2831853;

${ge}

float foodAt(vec2 p) {
  float f = 0.0;
  for (int i = 0; i < ${d}; i++) {
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
`}const Ie=`
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
`,ze=`
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
`,Ve=`
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

${ge}

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
`,ke=`
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
`;class Ne{renderer;agentTexSize;trailTexSize;foodSlots;agentTargets;agentReadIndex=0;trailTargets;trailReadIndex=0;agentScene;trailScene;depositScene;orthoCam;agentQuad;agentMaterial;seedMaterial;trailQuad;trailMaterial;depositPoints;depositMaterial;speciesA;speciesB;params=null;speedMod=1;constructor(e,t,s,i){this.renderer=e,this.foodSlots=s,this.agentTexSize=t?De:_e,this.trailTexSize=t?me:pe;const h={type:!!e.extensions.get("EXT_color_buffer_float")?xe:$,format:Q,minFilter:Y,magFilter:Y,wrapS:E,wrapT:E,depthBuffer:!1,stencilBuffer:!1};this.agentTargets=[new _(this.agentTexSize,this.agentTexSize,h),new _(this.agentTexSize,this.agentTexSize,h)];const r={type:$,format:Q,minFilter:Z,magFilter:Z,wrapS:E,wrapT:E,depthBuffer:!1,stencilBuffer:!1};this.trailTargets=[new _(this.trailTexSize,this.trailTexSize,r),new _(this.trailTexSize,this.trailTexSize,r)],this.orthoCam=new ue(-1,1,1,-1,0,1),this.speciesA=[new p,new p,new p],this.speciesB=[new p,new p,new p],this.agentScene=new C;const n=new N(2,2);this.agentMaterial=new T({vertexShader:z,fragmentShader:Le(s),depthTest:!1,depthWrite:!1,uniforms:{uAgentPrev:{value:null},uTrail:{value:null},uDt:{value:0},uSpeciesA:{value:this.speciesA},uSpeciesB:{value:this.speciesB},uFood:{value:i},uFoodPull:{value:0},uBurst:{value:new p(0,0,0,0)},uBurstSeed:{value:0}}}),this.seedMaterial=new T({vertexShader:z,fragmentShader:Ie,depthTest:!1,depthWrite:!1,uniforms:{uSeed:{value:0}}}),this.agentQuad=new O(n,this.agentMaterial),this.agentScene.add(this.agentQuad),this.trailScene=new C,this.trailMaterial=new T({vertexShader:z,fragmentShader:ze,depthTest:!1,depthWrite:!1,uniforms:{uTrailPrev:{value:null},uTexel:{value:new b(1/this.trailTexSize,1/this.trailTexSize)},uDecay:{value:new Te(1,1,1)},uDecayFruit:{value:1},uFruitGain:{value:0}}}),this.trailQuad=new O(new N(2,2),this.trailMaterial),this.trailScene.add(this.trailQuad);const l=this.agentTexSize,c=new Float32Array(l*l*2);let u=0;for(let v=0;v<l;v++)for(let f=0;f<l;f++)c[u++]=(f+.5)/l,c[u++]=(v+.5)/l;const m=new ce;m.setAttribute("aUv",new F(c,2)),m.setAttribute("position",new F(new Float32Array(l*l*3),3)),this.depositMaterial=new T({vertexShader:Ve,fragmentShader:ke,depthTest:!1,depthWrite:!1,transparent:!0,blending:we,blendEquation:Ae,blendSrc:P,blendDst:P,blendSrcAlpha:ye,blendDstAlpha:P,uniforms:{uAgentTex:{value:null},uSpeciesB:{value:this.speciesB},uDt:{value:0}}}),this.depositPoints=new de(m,this.depositMaterial),this.depositPoints.frustumCulled=!1,this.depositScene=new C,this.depositScene.add(this.depositPoints),this.clearTrail()}setActParams(e){this.params=e}setSpeedMod(e){this.speedMod=e}setBurst(e,t,s,i,o){this.agentMaterial.uniforms.uBurst.value.set(e,t,s,i),this.agentMaterial.uniforms.uBurstSeed.value=o}updateAgentUniforms(e,t){const s=e.speed*this.speedMod;this.speciesA[0].set(e.sensDistA,e.sensAngleA,L[0],s),this.speciesA[1].set(e.sensDistB,e.sensAngleB,L[1],s),this.speciesA[2].set(e.sensDistC,e.sensAngleC,L[2],s),this.speciesB[0].set(e.deposit,e.activeA,I[0],0),this.speciesB[1].set(e.deposit,e.activeB,I[1],0),this.speciesB[2].set(e.deposit,e.activeC,I[2],0),this.agentMaterial.uniforms.uDt.value=t,this.agentMaterial.uniforms.uFoodPull.value=e.foodPull}updateTrailUniforms(e,t){const s=Math.exp(-e.decay*t);this.trailMaterial.uniforms.uDecay.value.set(s,s,s),this.trailMaterial.uniforms.uDecayFruit.value=Math.exp(-t/Pe),this.trailMaterial.uniforms.uFruitGain.value=e.fruitGain*t}step(e,t){const s=this.params;if(!s||t<=0)return;const i=e/t,o=this.renderer.getRenderTarget(),a=this.renderer.autoClear;for(let h=0;h<t;h++){this.updateAgentUniforms(s,i);const r=this.agentTargets[this.agentReadIndex],n=this.agentTargets[1-this.agentReadIndex];this.agentMaterial.uniforms.uAgentPrev.value=r.texture,this.agentMaterial.uniforms.uTrail.value=this.trailTargets[this.trailReadIndex].texture,this.renderer.setRenderTarget(n),this.renderer.autoClear=!0,this.renderer.render(this.agentScene,this.orthoCam),this.agentReadIndex=1-this.agentReadIndex,this.updateTrailUniforms(s,i);const l=this.trailTargets[this.trailReadIndex],c=this.trailTargets[1-this.trailReadIndex];this.trailMaterial.uniforms.uTrailPrev.value=l.texture,this.renderer.setRenderTarget(c),this.renderer.autoClear=!0,this.renderer.render(this.trailScene,this.orthoCam),this.depositMaterial.uniforms.uAgentTex.value=this.agentTargets[this.agentReadIndex].texture,this.depositMaterial.uniforms.uDt.value=i,this.renderer.autoClear=!1,this.renderer.render(this.depositScene,this.orthoCam),this.trailReadIndex=1-this.trailReadIndex}this.renderer.autoClear=a,this.renderer.setRenderTarget(o??null)}seedAgents(e){const t=e();this.seedMaterial.uniforms.uSeed.value=t;const s=this.renderer.getRenderTarget();this.agentQuad.material=this.seedMaterial;for(const i of this.agentTargets)this.renderer.setRenderTarget(i),this.renderer.render(this.agentScene,this.orthoCam);this.renderer.setRenderTarget(s??null),this.agentQuad.material=this.agentMaterial}clearTrail(){const e=this.renderer.getRenderTarget(),t=new ve;this.renderer.getClearColor(t);const s=this.renderer.getClearAlpha();this.renderer.setClearColor(0,0);for(const i of this.trailTargets)this.renderer.setRenderTarget(i),this.renderer.clear(!0,!1,!1);this.renderer.setClearColor(t,s),this.renderer.setRenderTarget(e??null)}get trailTexture(){return this.trailTargets[this.trailReadIndex].texture}dispose(){this.agentTargets[0].dispose(),this.agentTargets[1].dispose(),this.trailTargets[0].dispose(),this.trailTargets[1].dispose(),this.agentMaterial.dispose(),this.seedMaterial.dispose(),this.trailMaterial.dispose(),this.depositMaterial.dispose(),this.agentQuad.geometry.dispose(),this.trailQuad.geometry.dispose(),this.depositPoints.geometry.dispose()}}const Oe=`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;function Ge(d,e,t,s){return`
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
uniform vec4 uFood[${e}];
// Visual burst-flash pool (composite-only; distinct from physarum.ts's
// single sim-side uBurst/uBurstSeed teleport uniform — see physarum.ts's
// class doc for why these are two separate structures). Bubble spawns also
// fire into this same pool (index.ts's activateBurstVis), so a daughter's
// birth reads as a small flash at its spawn point for free.
uniform vec4 uBurstVis[${t}];
// Daughter-cell bubble pool (index.ts, full-biosphere act only): xy = dish-
// uv centre, z = current radius (<= 0 means the slot is inactive), w = a
// per-spawn hash seed driving this bubble's own trail-sample offset,
// rotation, and hue lean. Pooled Vector4s mutated in place by index.ts, zero
// per-frame allocation on either side.
uniform vec4 uBubble[${s}];
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
${d?`  p = p * 2.07 + 11.3;
  v += 0.25 * vnoise(p);`:""}
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

void main() {
  vec2 dishUv = (vUv - 0.5) * uCover / uZoom + 0.5 + uPan;
  float distC = length(dishUv - vec2(0.5));

${d?"  float aa = fwidth(distC) * 1.5;":"  float aa = 0.006;"} // fixed epsilon on Lite: no derivatives on that path

  float throbAmt = 1.0 + uThrob * uBass * 0.6;
  // Energy lift (see uEnergy above): 1.0 at the climax, dimmer elsewhere.
  float energyLift = 0.55 + 0.45 * uEnergy;

  // ---- ground: deep aubergine ink, subtle fbm mottling, edge darkening +
  // a faint glass-rim highlight (sells "petri dish"). Solo modes (veins/
  // fruit isolation) override to a flat neutral so the additive layer
  // above reads on contrast instead of near-black. Mother-only — daughters
  // get their own ground inside cellRender in the bubble loop below. ----
  vec3 ground;
  if (uSoloMode > 0.5) {
    ground = vec3(0.5, 0.5, 0.5);
  } else {
    ground = groundAt(dishUv, DISH_R - distC, aa, 1.0, uTime);
  }

  // ---- veins: the mother's own sample of the shared veinsAt above (hueLean
  // 0 = the plain, unleaned palette). ----
  vec3 veins = veinsAt(dishUv, throbAmt, uShimmer, uHigh, energyLift, 0.0, uTime);

  // ---- fruiting bodies: from the trail's A channel (the slow persistence
  // integrator, physarum.ts's trail-diffuse pass) — soft glowing colonies
  // with a slow breathing pulse; brightness also lifts on uFlash.
  // Mother-only (the plan's daughter spec covers ground+veins+rim only). ----
  vec4 trailSample = texture2D(uTrail, dishUv);
  float fruit = trailSample.a;
  float fruitBand = smoothstep(0.35, 0.75, fruit);
  float breathe = 0.7 + 0.3 * sin(uTime * 0.6 + dishUv.x * 12.0 + dishUv.y * 7.0);
  vec3 fruitCol = vec3(1.0, 0.85, 0.35) * fruitBand * breathe * uFruitGlow * (1.0 + uFlash * 0.7) * (0.6 + 0.4 * uEnergy);

  // ---- events: burst flashes (radial gold ring, ~0.5s attack/decay) and
  // faint warm glow at nutrient drops. Mother-only. ----
  vec3 events = vec3(0.0);
  for (int i = 0; i < ${t}; i++) {
    vec4 b = uBurstVis[i];
    if (b.w <= 0.0) continue;
    float d = length(dishUv - b.xy);
    float ring = exp(-pow((d - b.z * 0.5) * 22.0, 2.0)) * b.w * exp(-b.z * 3.4);
    events += vec3(1.0, 0.85, 0.35) * ring;
  }
  for (int i = 0; i < ${e}; i++) {
    vec4 fo = uFood[i];
    if (fo.w <= 0.0) continue;
    float d = length(dishUv - fo.xy);
    events += vec3(1.0, 0.7, 0.3) * exp(-d * d / (fo.z * fo.z)) * fo.w * 0.35;
  }

  // ---- dish-interior mask: life stays under the glass. Agents deposit
  // right up to the rim and the trail blur bleeds a little past it, so
  // unmasked veins smear ugly gold blobs OUTSIDE the dish (verified live at
  // the climax — a growth escaping at 3 o'clock). Trail-derived layers
  // (veins, fruit) are clipped just past DISH_R; EVENTS are exempt — burst
  // rings are momentary flashes, not trail smear, and daughter bubbles
  // spawn (and flash) OUTSIDE the mother's rim by construction. ----
  float inside = 1.0 - smoothstep(DISH_R - 0.004, DISH_R + 0.012, distC);
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
    for (int i = 0; i < ${s}; i++) {
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

  float vig = smoothstep(1.25, 0.35, length(vUv - 0.5) * 1.6);
  col *= vig;
  col = 1.0 - exp(-col * 2.2);
  gl_FragColor = vec4(col, 1.0);
}
`}const He=4e3,We=1200;class Xe{constructor(e,t,s){this.renderer=s;const i=fe(e^93360613),o=Math.min(t.particleBudget,t.level==="full"?He:We),a=new Float32Array(o*3),h=new Float32Array(o);for(let r=0;r<o;r++)a[r*3+0]=(i()*2-1)*.62,a[r*3+1]=(i()*2-1)*.62,a[r*3+2]=(i()*2-1)*.4,h[r]=i();this.geometry=new ce,this.geometry.setAttribute("position",new F(a,3)),this.geometry.setAttribute("aSeed",new F(h,1)),this.uniforms={uFlowTime:{value:0},uTurbulence:{value:.6},uFlowAmount:{value:.5},uDensity:{value:1},uBrightness:{value:.65},uHigh:{value:0},uBass:{value:0},uScale:{value:90},uSeedShift:{value:i()*100},uFlash:{value:0},uZoom:{value:1},uCover:{value:new b(1,1)},uPan:{value:new b(0,0)}},this.material=new T({uniforms:this.uniforms,transparent:!0,depthTest:!1,depthWrite:!1,blending:Be,vertexShader:`
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
      `}),this.object=new de(this.geometry,this.material),this.object.frustumCulled=!1}object;material;geometry;uniforms;update(e,t,s,i,o,a,h=0){const r=s.params,n=this.uniforms;n.uFlowTime.value+=e*.5,n.uDensity.value=r.sporeDensity,n.uHigh.value=t.high,n.uBass.value=t.bass,n.uFlash.value=h,n.uZoom.value=i,n.uCover.value.copy(o),n.uPan.value.copy(a),n.uScale.value=this.renderer.domElement.height*.1}dispose(){this.geometry.dispose(),this.material.dispose()}}const g=[0,54,106,130,154,178,234,251.238],w=[{name:"spores",activeA:.35,activeB:0,activeC:0,sensDistA:.035,sensDistB:.03,sensDistC:.03,sensAngleA:.5,sensAngleB:.4,sensAngleC:.4,speed:.05,deposit:.15,decay:.25,fruitGain:.05,fruitGlow:.1,sporeDensity:1,burstRate:2,throb:.2,shimmer:.15,sat:.9,palMix:.1,zoom:1,foodPull:.3,bubbles:0},{name:"first-bloom",activeA:.8,activeB:.1,activeC:0,sensDistA:.04,sensDistB:.03,sensDistC:.03,sensAngleA:.55,sensAngleB:.4,sensAngleC:.4,speed:.09,deposit:.45,decay:.2,fruitGain:.25,fruitGlow:.4,sporeDensity:.5,burstRate:10,throb:.6,shimmer:.3,sat:1,palMix:.2,zoom:1,foodPull:.4,bubbles:0},{name:"rot",activeA:.55,activeB:.1,activeC:0,sensDistA:.04,sensDistB:.03,sensDistC:.03,sensAngleA:.5,sensAngleB:.4,sensAngleC:.4,speed:.06,deposit:.15,decay:.55,fruitGain:.1,fruitGlow:.2,sporeDensity:.3,burstRate:1.5,throb:.25,shimmer:.15,sat:.45,palMix:.55,zoom:1,foodPull:.2,bubbles:0},{name:"stirring",activeA:.5,activeB:.7,activeC:0,sensDistA:.04,sensDistB:.07,sensDistC:.03,sensAngleA:.5,sensAngleB:.9,sensAngleC:.4,speed:.08,deposit:.3,decay:.3,fruitGain:.15,fruitGlow:.25,sporeDensity:.35,burstRate:4,throb:.35,shimmer:.25,sat:.7,palMix:.35,zoom:1,foodPull:.35,bubbles:0},{name:"convergence",activeA:.7,activeB:.75,activeC:.4,sensDistA:.04,sensDistB:.07,sensDistC:.025,sensAngleA:.5,sensAngleB:.9,sensAngleC:.3,speed:.09,deposit:.4,decay:.25,fruitGain:.2,fruitGlow:.3,sporeDensity:.3,burstRate:6,throb:.4,shimmer:.3,sat:.55,palMix:.3,zoom:1,foodPull:.45,bubbles:0},{name:"full-biosphere",activeA:.95,activeB:.9,activeC:.6,sensDistA:.045,sensDistB:.075,sensDistC:.028,sensAngleA:.55,sensAngleB:.95,sensAngleC:.32,speed:.11,deposit:.55,decay:.2,fruitGain:.3,fruitGlow:.55,sporeDensity:.6,burstRate:16,throb:.85,shimmer:.6,sat:1,palMix:.15,zoom:.72,foodPull:.5,bubbles:1},{name:"exhale",activeA:.15,activeB:.05,activeC:.02,sensDistA:.035,sensDistB:.03,sensDistC:.025,sensAngleA:.5,sensAngleB:.4,sensAngleC:.3,speed:.04,deposit:.08,decay:.7,fruitGain:.05,fruitGlow:.15,sporeDensity:.9,burstRate:1,throb:.15,shimmer:.1,sat:.6,palMix:.1,zoom:1,foodPull:.2,bubbles:0}],x=[[0,.1],[40,.25],[53.8,.3],[54.3,.55],[90,.5],[106,.35],[130,.4],[154,.55],[177.8,.62],[178.3,.95],[210,1],[234,.5],[251.238,.12]],ee={energy:0};function je(d){const e=Math.min(Math.max(d,0),x[x.length-1][0]);let t=0;for(;t<x.length-2&&e>=x[t+1][0];)t++;const s=x[t],i=x[t+1],o=Math.min(1,Math.max(0,(e-s[0])/Math.max(.001,i[0]-s[0])));return ee.energy=s[1]+(i[1]-s[1])*o,ee}const Ye=6;function Qe(d){const e=Math.min(1,Math.max(0,d));return e*e*(3-2*e)}function $e(d,e,t){if(t<=0)return d;if(t>=1)return e;const s={...d,name:t<.5?d.name:e.name};for(const i of Object.keys(d)){const o=d[i],a=e[i];typeof o=="number"&&typeof a=="number"&&(s[i]=o+(a-o)*t)}return s}function Ze(d){const e=g[g.length-1],t=Math.min(Math.max(d,0),e-.001);let s=0;for(;s<w.length-1&&t>=g[s+1];)s++;const i=g[s],o=g[s+1]??e,a=Math.min(1,Math.max(0,(t-i)/Math.max(.001,o-i))),h=s<w.length-1,r=o-t,n=h?Qe(1-Math.min(1,r/Ye)):0,l=w[s],c=h?w[s+1]:l;return{params:$e(l,c,n),actIndex:s,localT:a,blend:n}}const Ke=.12,qe=1.1,Je=.4,et=.25,tt=1.1,st=1.6,it=.5,at=.18,te=.05,se=.12,ot=.09,rt=.45,nt=1.2,lt=50,ie=.06,ae=6,ht=20,oe=5e-4,ut=10,M=1.5,V=.16,re=14,ct=10,A=.03,ne=.09,dt=.16,vt=2.5,ft=.07,le=2.5,mt=.7,pt=.6,gt=.55,he=.015,bt=7,St=10,k=1.1,be=w.findIndex(d=>d.name==="full-biosphere"),R=g[be],xt=g[be+1];class Tt{renderer;scene;camera;sim;dishQuad;dishMaterial;spores;rand;soloDish=!0;soloSpores=!0;forceBurstAlways=!1;forceFoodAlways=!1;full=!0;foodSlotCount=K;burstVisSlotCount=q;stepsPerFrame=J;cover=new b(1,1);pan=new b(0,0);bassE=0;midE=0;highE=0;bassSlowE=0;onsetCooldown=0;flash=0;burstTimeToNext=0;burstActive=!1;burstTimeLeft=0;foodTimeToNext=0;foodSlots=[];foodValues;burstVisSlots=[];burstVisValues;bubbleSlotCount=re;bubbleSlots=[];bubbleValues;bubbleTimeToNext=0;firstUpdate=!0;lastDt=0;lastSongTime=-1;held=!1;dragDx=0;dragDy=0;velX=0;velY=0;init(e){const{renderer:t,seed:s,quality:i}=e;this.renderer=t,this.rand=fe(s^2969960014);const o=new URLSearchParams(location.search),a=o.get("solo");this.soloDish=!a||a==="veins"||a==="fruit",this.soloSpores=!a||a==="spores",this.forceBurstAlways=o.get("burst")==="always",this.forceFoodAlways=o.get("food")==="always";const h=a==="veins"?1:a==="fruit"?2:0;this.full=i.level==="full",this.foodSlotCount=this.full?K:Ee,this.burstVisSlotCount=this.full?q:Me,this.stepsPerFrame=this.full?J:Re;for(let u=0;u<this.foodSlotCount;u++)this.foodSlots.push({age:0,active:!1});this.foodValues=[];for(let u=0;u<this.foodSlotCount;u++)this.foodValues.push(new p(0,0,ie,0));for(let u=0;u<this.burstVisSlotCount;u++)this.burstVisSlots.push({age:0,active:!1});this.burstVisValues=[];for(let u=0;u<this.burstVisSlotCount;u++)this.burstVisValues.push(new p(0,0,0,0));this.bubbleSlotCount=this.full?re:ct;for(let u=0;u<this.bubbleSlotCount;u++)this.bubbleSlots.push({active:!1,growTargetR:0,vx:0,vy:0,age:0});this.bubbleValues=[];for(let u=0;u<this.bubbleSlotCount;u++)this.bubbleValues.push(new p(0,0,0,0));this.scene=new C,this.camera=new ue(-1,1,1,-1,0,1),a&&(this.scene.background=new ve(3813440)),this.sim=new Ne(t,this.full,this.foodSlotCount,this.foodValues);const r=this.full?me:pe;this.dishMaterial=new T({vertexShader:Oe,fragmentShader:Ge(this.full,this.foodSlotCount,this.burstVisSlotCount,this.bubbleSlotCount),depthTest:!1,depthWrite:!1,uniforms:{uTrail:{value:null},uTrailTexel:{value:new b(1/r,1/r)},uCover:{value:new b(1,1)},uPan:{value:this.pan},uZoom:{value:1},uTime:{value:0},uBass:{value:0},uHigh:{value:0},uFlash:{value:0},uThrob:{value:0},uShimmer:{value:0},uSat:{value:1},uPalMix:{value:0},uEnergy:{value:0},uFruitGlow:{value:0},uFood:{value:this.foodValues},uBurstVis:{value:this.burstVisValues},uBubble:{value:this.bubbleValues},uSoloMode:{value:h}}}),this.dishQuad=new O(new N(2,2),this.dishMaterial),this.soloDish&&this.scene.add(this.dishQuad),this.spores=new Xe(s,i,t),this.soloSpores&&this.scene.add(this.spores.object);const n=t.domElement,l=n.clientWidth||1,c=n.clientHeight||1;this.resize(l,c)}kickFlash(e){this.flash=Math.min(st,this.flash+e)}randomDishPoint(){const e=S*Math.sqrt(this.rand()),t=this.rand()*Math.PI*2;return[.5+Math.cos(t)*e,.5+Math.sin(t)*e]}activateBurstVis(e,t,s){let i=this.burstVisSlots.findIndex(a=>!a.active);i<0&&(i=0);const o=this.burstVisSlots[i];o.active=!0,o.age=0,this.burstVisValues[i].set(e,t,0,s)}updateBurstVisAges(e){for(let t=0;t<this.burstVisSlots.length;t++){const s=this.burstVisSlots[t];s.active&&(s.age+=e,s.age>=nt?(s.active=!1,this.burstVisValues[t].w=0):this.burstVisValues[t].z=s.age)}}triggerBurst(e,t,s,i){this.burstActive=!0,this.burstTimeLeft=at,this.sim.setBurst(e,t,s,i,this.rand()),this.activateBurstVis(e,t,1)}updateBurstActive(e){this.burstActive&&(this.burstTimeLeft-=e,this.burstTimeLeft<=0&&(this.burstActive=!1,this.sim.setBurst(0,0,0,0,0)))}scheduleBursts(e,t){const s=Math.max(0,t)/60;if(!(s<=0))for(this.burstTimeToNext-=e;this.burstTimeToNext<=0;){const[i,o]=this.randomDishPoint();this.triggerBurst(i,o,te,se),this.kickFlash(et);const a=Math.max(1e-6,this.rand());this.burstTimeToNext+=-Math.log(a)/s}}scriptedMassBurst(){this.triggerBurst(.5,.5,ot,rt);for(let e=0;e<3;e++){const[t,s]=this.randomDishPoint();this.activateBurstVis(t,s,1)}this.kickFlash(tt)}activateFood(e,t){let s=this.foodSlots.findIndex(o=>!o.active);s<0&&(s=0);const i=this.foodSlots[s];i.active=!0,i.age=0,this.foodValues[s].set(e,t,ie,1)}updateFoodAges(e){for(let t=0;t<this.foodSlots.length;t++){const s=this.foodSlots[t];s.active&&(s.age+=e,s.age>=ae?(s.active=!1,this.foodValues[t].w=0):this.foodValues[t].w=1-s.age/ae)}}scheduleFood(e,t){const s=Math.max(0,t)/60;if(!(s<=0))for(this.foodTimeToNext-=e;this.foodTimeToNext<=0;){const[i,o]=this.randomDishPoint();this.activateFood(i,o);const a=Math.max(1e-6,this.rand());this.foodTimeToNext+=-Math.log(a)/s}}trySpawnBubble(){let e=-1;for(let h=0;h<this.bubbleSlots.length;h++)if(!this.bubbleSlots[h].active){e=h;break}if(e<0)return;let t=-1;if(this.rand()<.5){let h=0;for(let r=0;r<this.bubbleSlots.length;r++)this.bubbleSlots[r].active&&this.bubbleValues[r].z>ft&&(h++,this.rand()<1/h&&(t=r))}const s=this.rand()*Math.PI*2;let i,o;if(t>=0){const h=this.bubbleValues[t];i=h.x+Math.cos(s)*(h.z+.5*A),o=h.y+Math.sin(s)*(h.z+.5*A)}else i=.5+Math.cos(s)*(S+.5*A),o=.5+Math.sin(s)*(S+.5*A);const a=this.bubbleSlots[e];a.active=!0,a.age=0,a.growTargetR=ne+this.rand()*(dt-ne),a.vx=0,a.vy=0,this.bubbleValues[e].set(i,o,A,this.rand()),this.activateBurstVis(i,o,gt)}scheduleBubbleSpawns(e,t,s){if(t.bubbles<=.001)return;const i=Math.min(1,Math.max(0,(s-R)/Math.max(.001,xt-R))),a=1/(le+(mt-le)*Math.min(1,i/pt));for(this.bubbleTimeToNext-=e;this.bubbleTimeToNext<=0;){this.trySpawnBubble();const h=Math.max(1e-6,this.rand());this.bubbleTimeToNext+=-Math.log(h)/a}}updateBubbles(e,t){const s=this.bubbleSlots,i=this.bubbleValues,o=s.length,a=1-Math.exp(-e/vt);for(let r=0;r<o;r++){const n=s[r];if(!n.active)continue;n.age+=e;const l=i[r],c=n.growTargetR*t.bubbles;l.z+=(c-l.z)*a,l.z<.01&&n.age>.1&&(n.active=!1,l.set(0,0,0,0))}for(let r=0;r<o;r++){if(!s[r].active)continue;const n=i[r];for(let v=r+1;v<o;v++){if(!s[v].active)continue;const f=i[v],y=f.x-n.x,G=f.y-n.y,B=Math.max(1e-5,Math.hypot(y,G)),H=n.z+f.z+he;if(B>=H)continue;const W=y/B,X=G/B,Se=H-B,U=n.z*n.z/(n.z*n.z+f.z*f.z+1e-6),j=1-U,D=Se*bt*e;s[r].vx-=W*D*j,s[r].vy-=X*D*j,s[v].vx+=W*D*U,s[v].vy+=X*D*U}const l=n.x-.5,c=n.y-.5,u=Math.max(1e-5,Math.hypot(l,c)),m=S+n.z+he;if(u<m){const v=l/u,f=c/u,y=(m-u)*St*e;s[r].vx+=v*y,s[r].vy+=f*y}}const h=Math.exp(-4*e);for(let r=0;r<o;r++){const n=s[r];if(!n.active)continue;const l=i[r];l.x+=n.vx*e,l.y+=n.vy*e,n.vx*=h,n.vy*=h;const c=l.x-.5,u=l.y-.5,m=Math.hypot(c,u);m>k&&(l.x=.5+c/m*k,l.y=.5+u/m*k,n.vx=0,n.vy=0)}}resetBubbles(){for(let e=0;e<this.bubbleSlots.length;e++){const t=this.bubbleSlots[e];t.active=!1,t.vx=0,t.vy=0,t.age=0,this.bubbleValues[e].set(0,0,0,0)}this.bubbleTimeToNext=0}warmup(e,t,s){s&&this.sim.seedAgents(this.rand),this.sim.setActParams(e),this.sim.step(Ue*t,t)}update(e,t){const s=Ze(t.time),i=s.params;if(this.lastDt=e,this.firstUpdate&&(this.firstUpdate=!1,this.warmup(i,Ce,!0),i.bubbles>.001&&t.time>R))for(let c=R;c<t.time;c+=.25)this.scheduleBubbleSpawns(.25,i,c),this.updateBubbles(.25,i),this.updateBurstVisAges(.25);this.lastSongTime>=0&&t.time<this.lastSongTime-10&&(this.sim.clearTrail(),this.warmup(i,Fe,!0),this.resetBubbles()),this.lastSongTime>=0&&t.time-this.lastSongTime>=0&&t.time-this.lastSongTime<.5&&(this.lastSongTime<54&&t.time>=54&&this.scriptedMassBurst(),this.lastSongTime<178&&t.time>=178&&this.scriptedMassBurst()),this.lastSongTime=t.time;const o=Math.min(1,e*8);if(this.bassE+=(t.bass-this.bassE)*o,this.midE+=(t.mid-this.midE)*o,this.highE+=(t.high-this.highE)*o,this.bassSlowE+=(t.bass-this.bassSlowE)*Math.min(1,e*1.5),this.onsetCooldown-=e,this.onsetCooldown<=0&&this.bassE-this.bassSlowE>Ke){const[l,c]=this.randomDishPoint();this.triggerBurst(l,c,te,se),this.kickFlash(Je),i.bubbles>.001&&this.trySpawnBubble(),this.onsetCooldown=qe}this.scheduleBursts(e,this.forceBurstAlways?lt:i.burstRate),this.updateBurstActive(e),this.updateBurstVisAges(e),this.scheduleFood(e,this.forceFoodAlways?ht:0),this.updateFoodAges(e),this.scheduleBubbleSpawns(e,i,t.time),this.updateBubbles(e,i),this.flash*=Math.exp(-3.2*e),this.sim.setSpeedMod(1+this.midE*it),this.sim.setActParams(i);const a=this.dishMaterial.uniforms;a.uTime.value+=e,a.uBass.value=this.bassE,a.uHigh.value=this.highE,a.uFlash.value=this.flash,a.uThrob.value=i.throb,a.uShimmer.value=i.shimmer,a.uSat.value=i.sat,a.uPalMix.value=i.palMix,a.uFruitGlow.value=i.fruitGlow,a.uEnergy.value=je(t.time).energy;const h=i.zoom;a.uZoom.value=h;const r=this.cover;if(this.held){if(e>1e-5){const l=Math.min(1,e*ut),c=Math.min(M,Math.max(-M,this.dragDx/e)),u=Math.min(M,Math.max(-M,this.dragDy/e));this.velX+=(c-this.velX)*l,this.velY+=(u-this.velY)*l}this.dragDx=0,this.dragDy=0}else if(this.velX!==0||this.velY!==0){this.pan.x+=this.velX*r.x/h*e,this.pan.y+=this.velY*r.y/h*e;const l=Math.exp(-2.5*e);this.velX*=l,this.velY*=l,Math.abs(this.velX)<oe&&(this.velX=0),Math.abs(this.velY)<oe&&(this.velY=0)}const n=Math.hypot(this.pan.x,this.pan.y);n>V&&(this.pan.x*=V/n,this.pan.y*=V/n,this.velX=0,this.velY=0),this.spores.update(e,t,s,h,r,this.pan,this.flash)}pointer(e){const t=this.dishMaterial.uniforms.uZoom.value,s=this.cover;if(e.type==="down"){this.held=!0,this.dragDx=0,this.dragDy=0,this.velX=0,this.velY=0;const i=(e.x-.5)*s.x/t+.5+this.pan.x,o=(e.y-.5)*s.y/t+.5+this.pan.y;this.activateFood(i,o);return}if(e.type==="move"){if(!this.held)return;this.pan.x+=e.dx*s.x/t,this.pan.y+=e.dy*s.y/t,this.dragDx+=e.dx,this.dragDy+=e.dy;return}if(e.type==="up"){this.held=!1;return}this.held=!1,this.velX=0,this.velY=0,this.dragDx=0,this.dragDy=0}render(){this.sim.step(this.lastDt,this.stepsPerFrame),this.dishMaterial.uniforms.uTrail.value=this.sim.trailTexture,this.renderer.setRenderTarget(null),this.renderer.render(this.scene,this.camera)}resize(e,t){if(!this.dishMaterial||e<=0||t<=0)return;const s=Math.min(3.5,Math.max(.28,e/t));s>=1?this.cover.set(s,1):this.cover.set(1,1/s),this.dishMaterial.uniforms.uCover.value.copy(this.cover)}dispose(){this.sim.dispose(),this.dishMaterial.dispose(),this.dishQuad.geometry.dispose(),this.spores.dispose(),this.renderer.setRenderTarget(null)}}const yt={default:()=>new Tt},Bt=yt.default;export{Bt as default};
//# sourceMappingURL=index-Dx_NBrM-.js.map
