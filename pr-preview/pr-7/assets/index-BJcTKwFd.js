import{a as L,n as V,N as se,b as ie,F as ke,H as ae,L as oe,O as we,V as g,S as O,d as Z,e as _,M as K,g as Oe,c as A,B as Ae,f as N,o as G,Z as Ne,p as He,q as Ge,h as Be,C as De,A as Xe}from"./three-vlqji54k.js";import{m as Me}from"./random-DL1jLgMw.js";const p=.48,Ye=512,We=256,_e=1024,Ee=512,re=6,je=4,ne=4,Qe=3,le=2,$e=1,Ze=180,Ke=60,qe=1/30,X=[2.4,2.8,3.2],Y=[.35,.45,.55],Je=15,W=`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`,Re=`
float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
// Species is derived from the agent texel's own y-coordinate (thirds of the
// texture), never stored — this function is the single source of truth
// every pass (update, deposit) calls, so they can never drift apart.
float speciesOf(vec2 auv) { return floor(clamp(auv.y, 0.0, 0.999999) * 3.0); }
// Dormant agents (hash over activeFrac threshold) neither move nor deposit.
bool isActiveAgent(vec2 auv, float activeFrac) { return hash21(auv + 41.7) <= activeFrac; }
`;function et(d){return`
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

const float DISH_R = ${p.toFixed(4)};
const vec2 DISH_C = vec2(0.5, 0.5);
const float PI = 3.14159265;
const float TWO_PI = 6.2831853;

${Re}

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
`}const tt=`
precision highp float;
varying vec2 vUv;
uniform float uSeed;
const float DISH_R = ${p.toFixed(4)};
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
`,st=`
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
`,it=`
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

${Re}

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
`,at=`
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
`;class ot{renderer;agentTexSize;trailTexSize;foodSlots;agentTargets;agentReadIndex=0;trailTargets;trailReadIndex=0;agentScene;trailScene;depositScene;orthoCam;agentQuad;agentMaterial;seedMaterial;trailQuad;trailMaterial;depositPoints;depositMaterial;speciesA;speciesB;params=null;speedMod=1;constructor(e,t,s,i){this.renderer=e,this.foodSlots=s,this.agentTexSize=t?Ye:We,this.trailTexSize=t?_e:Ee;const l={type:!!e.extensions.get("EXT_color_buffer_float")?ke:ae,format:ie,minFilter:se,magFilter:se,wrapS:V,wrapT:V,depthBuffer:!1,stencilBuffer:!1};this.agentTargets=[new L(this.agentTexSize,this.agentTexSize,l),new L(this.agentTexSize,this.agentTexSize,l)];const u={type:ae,format:ie,minFilter:oe,magFilter:oe,wrapS:V,wrapT:V,depthBuffer:!1,stencilBuffer:!1};this.trailTargets=[new L(this.trailTexSize,this.trailTexSize,u),new L(this.trailTexSize,this.trailTexSize,u)],this.orthoCam=new we(-1,1,1,-1,0,1),this.speciesA=[new g,new g,new g],this.speciesB=[new g,new g,new g],this.agentScene=new O;const n=new Z(2,2);this.agentMaterial=new _({vertexShader:W,fragmentShader:et(s),depthTest:!1,depthWrite:!1,uniforms:{uAgentPrev:{value:null},uTrail:{value:null},uDt:{value:0},uSpeciesA:{value:this.speciesA},uSpeciesB:{value:this.speciesB},uFood:{value:i},uFoodPull:{value:0},uBurst:{value:new g(0,0,0,0)},uBurstSeed:{value:0}}}),this.seedMaterial=new _({vertexShader:W,fragmentShader:tt,depthTest:!1,depthWrite:!1,uniforms:{uSeed:{value:0}}}),this.agentQuad=new K(n,this.agentMaterial),this.agentScene.add(this.agentQuad),this.trailScene=new O,this.trailMaterial=new _({vertexShader:W,fragmentShader:st,depthTest:!1,depthWrite:!1,uniforms:{uTrailPrev:{value:null},uTexel:{value:new A(1/this.trailTexSize,1/this.trailTexSize)},uDecay:{value:new Oe(1,1,1)},uDecayFruit:{value:1},uFruitGain:{value:0}}}),this.trailQuad=new K(new Z(2,2),this.trailMaterial),this.trailScene.add(this.trailQuad);const a=this.agentTexSize,h=new Float32Array(a*a*2);let c=0;for(let m=0;m<a;m++)for(let f=0;f<a;f++)h[c++]=(f+.5)/a,h[c++]=(m+.5)/a;const v=new Ae;v.setAttribute("aUv",new N(h,2)),v.setAttribute("position",new N(new Float32Array(a*a*3),3)),this.depositMaterial=new _({vertexShader:it,fragmentShader:at,depthTest:!1,depthWrite:!1,transparent:!0,blending:Ge,blendEquation:He,blendSrc:G,blendDst:G,blendSrcAlpha:Ne,blendDstAlpha:G,uniforms:{uAgentTex:{value:null},uSpeciesB:{value:this.speciesB},uDt:{value:0}}}),this.depositPoints=new Be(v,this.depositMaterial),this.depositPoints.frustumCulled=!1,this.depositScene=new O,this.depositScene.add(this.depositPoints),this.clearTrail()}setActParams(e){this.params=e}setSpeedMod(e){this.speedMod=e}setBurst(e,t,s,i,r){this.agentMaterial.uniforms.uBurst.value.set(e,t,s,i),this.agentMaterial.uniforms.uBurstSeed.value=r}updateAgentUniforms(e,t){const s=e.speed*this.speedMod;this.speciesA[0].set(e.sensDistA,e.sensAngleA,X[0],s),this.speciesA[1].set(e.sensDistB,e.sensAngleB,X[1],s),this.speciesA[2].set(e.sensDistC,e.sensAngleC,X[2],s),this.speciesB[0].set(e.deposit,e.activeA,Y[0],0),this.speciesB[1].set(e.deposit,e.activeB,Y[1],0),this.speciesB[2].set(e.deposit,e.activeC,Y[2],0),this.agentMaterial.uniforms.uDt.value=t,this.agentMaterial.uniforms.uFoodPull.value=e.foodPull}updateTrailUniforms(e,t){const s=Math.exp(-e.decay*t);this.trailMaterial.uniforms.uDecay.value.set(s,s,s),this.trailMaterial.uniforms.uDecayFruit.value=Math.exp(-t/Je),this.trailMaterial.uniforms.uFruitGain.value=e.fruitGain*t}step(e,t){const s=this.params;if(!s||t<=0)return;const i=e/t,r=this.renderer.getRenderTarget(),o=this.renderer.autoClear;for(let l=0;l<t;l++){this.updateAgentUniforms(s,i);const u=this.agentTargets[this.agentReadIndex],n=this.agentTargets[1-this.agentReadIndex];this.agentMaterial.uniforms.uAgentPrev.value=u.texture,this.agentMaterial.uniforms.uTrail.value=this.trailTargets[this.trailReadIndex].texture,this.renderer.setRenderTarget(n),this.renderer.autoClear=!0,this.renderer.render(this.agentScene,this.orthoCam),this.agentReadIndex=1-this.agentReadIndex,this.updateTrailUniforms(s,i);const a=this.trailTargets[this.trailReadIndex],h=this.trailTargets[1-this.trailReadIndex];this.trailMaterial.uniforms.uTrailPrev.value=a.texture,this.renderer.setRenderTarget(h),this.renderer.autoClear=!0,this.renderer.render(this.trailScene,this.orthoCam),this.depositMaterial.uniforms.uAgentTex.value=this.agentTargets[this.agentReadIndex].texture,this.depositMaterial.uniforms.uDt.value=i,this.renderer.autoClear=!1,this.renderer.render(this.depositScene,this.orthoCam),this.trailReadIndex=1-this.trailReadIndex}this.renderer.autoClear=o,this.renderer.setRenderTarget(r??null)}seedAgents(e){const t=e();this.seedMaterial.uniforms.uSeed.value=t;const s=this.renderer.getRenderTarget();this.agentQuad.material=this.seedMaterial;for(const i of this.agentTargets)this.renderer.setRenderTarget(i),this.renderer.render(this.agentScene,this.orthoCam);this.renderer.setRenderTarget(s??null),this.agentQuad.material=this.agentMaterial}clearTrail(){const e=this.renderer.getRenderTarget(),t=new De;this.renderer.getClearColor(t);const s=this.renderer.getClearAlpha();this.renderer.setClearColor(0,0);for(const i of this.trailTargets)this.renderer.setRenderTarget(i),this.renderer.clear(!0,!1,!1);this.renderer.setClearColor(t,s),this.renderer.setRenderTarget(e??null)}get trailTexture(){return this.trailTargets[this.trailReadIndex].texture}dispose(){this.agentTargets[0].dispose(),this.agentTargets[1].dispose(),this.trailTargets[0].dispose(),this.trailTargets[1].dispose(),this.agentMaterial.dispose(),this.seedMaterial.dispose(),this.trailMaterial.dispose(),this.depositMaterial.dispose(),this.agentQuad.geometry.dispose(),this.trailQuad.geometry.dispose(),this.depositPoints.geometry.dispose()}}const rt=`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;function nt(d,e,t,s){return`
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

const float DISH_R = ${p.toFixed(4)};
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
  // distC is now measured from the mother's CURRENT centre (uMother.xy),
  // not the fixed (0.5, 0.5) — at the default uMother this is identical to
  // round-1's distC.
  float distC = length(dishUv - uMother.xy);

${d?"  float aa = fwidth(distC) * 1.5;":"  float aa = 0.006;"} // fixed epsilon on Lite: no derivatives on that path

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
`}const lt=4e3,ht=1200;class ut{constructor(e,t,s){this.renderer=s;const i=Me(e^93360613),r=Math.min(t.particleBudget,t.level==="full"?lt:ht),o=new Float32Array(r*3),l=new Float32Array(r);for(let u=0;u<r;u++)o[u*3+0]=(i()*2-1)*.62,o[u*3+1]=(i()*2-1)*.62,o[u*3+2]=(i()*2-1)*.4,l[u]=i();this.geometry=new Ae,this.geometry.setAttribute("position",new N(o,3)),this.geometry.setAttribute("aSeed",new N(l,1)),this.uniforms={uFlowTime:{value:0},uTurbulence:{value:.6},uFlowAmount:{value:.5},uDensity:{value:1},uBrightness:{value:.65},uHigh:{value:0},uBass:{value:0},uScale:{value:90},uSeedShift:{value:i()*100},uFlash:{value:0},uZoom:{value:1},uCover:{value:new A(1,1)},uPan:{value:new A(0,0)}},this.material=new _({uniforms:this.uniforms,transparent:!0,depthTest:!1,depthWrite:!1,blending:Xe,vertexShader:`
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
      `}),this.object=new Be(this.geometry,this.material),this.object.frustumCulled=!1}object;material;geometry;uniforms;update(e,t,s,i,r,o,l=0){const u=s.params,n=this.uniforms;n.uFlowTime.value+=e*.5,n.uDensity.value=u.sporeDensity,n.uHigh.value=t.high,n.uBass.value=t.bass,n.uFlash.value=l,n.uZoom.value=i,n.uCover.value.copy(r),n.uPan.value.copy(o),n.uScale.value=this.renderer.domElement.height*.1}dispose(){this.geometry.dispose(),this.material.dispose()}}const w=[0,54,106,130,154,178,234,251.238],U=[{name:"spores",activeA:.35,activeB:0,activeC:0,sensDistA:.035,sensDistB:.03,sensDistC:.03,sensAngleA:.5,sensAngleB:.4,sensAngleC:.4,speed:.05,deposit:.15,decay:.25,fruitGain:.05,fruitGlow:.1,sporeDensity:1,burstRate:2,throb:.2,shimmer:.15,sat:.9,palMix:.1,zoom:1,foodPull:.3,bubbles:0},{name:"first-bloom",activeA:.8,activeB:.1,activeC:0,sensDistA:.04,sensDistB:.03,sensDistC:.03,sensAngleA:.55,sensAngleB:.4,sensAngleC:.4,speed:.09,deposit:.45,decay:.2,fruitGain:.25,fruitGlow:.4,sporeDensity:.5,burstRate:10,throb:.6,shimmer:.3,sat:1,palMix:.2,zoom:1,foodPull:.4,bubbles:0},{name:"rot",activeA:.55,activeB:.1,activeC:0,sensDistA:.04,sensDistB:.03,sensDistC:.03,sensAngleA:.5,sensAngleB:.4,sensAngleC:.4,speed:.06,deposit:.15,decay:.55,fruitGain:.1,fruitGlow:.2,sporeDensity:.3,burstRate:1.5,throb:.25,shimmer:.15,sat:.45,palMix:.55,zoom:1,foodPull:.2,bubbles:0},{name:"stirring",activeA:.5,activeB:.7,activeC:0,sensDistA:.04,sensDistB:.07,sensDistC:.03,sensAngleA:.5,sensAngleB:.9,sensAngleC:.4,speed:.08,deposit:.3,decay:.3,fruitGain:.15,fruitGlow:.25,sporeDensity:.35,burstRate:4,throb:.35,shimmer:.25,sat:.7,palMix:.35,zoom:1,foodPull:.35,bubbles:0},{name:"convergence",activeA:.7,activeB:.75,activeC:.4,sensDistA:.04,sensDistB:.07,sensDistC:.025,sensAngleA:.5,sensAngleB:.9,sensAngleC:.3,speed:.09,deposit:.4,decay:.25,fruitGain:.2,fruitGlow:.3,sporeDensity:.3,burstRate:6,throb:.4,shimmer:.3,sat:.55,palMix:.3,zoom:1,foodPull:.45,bubbles:0},{name:"full-biosphere",activeA:.95,activeB:.9,activeC:.6,sensDistA:.045,sensDistB:.075,sensDistC:.028,sensAngleA:.55,sensAngleB:.95,sensAngleC:.32,speed:.11,deposit:.55,decay:.2,fruitGain:.3,fruitGlow:.55,sporeDensity:.6,burstRate:16,throb:.85,shimmer:.6,sat:1,palMix:.15,zoom:.72,foodPull:.5,bubbles:1},{name:"exhale",activeA:.15,activeB:.05,activeC:.02,sensDistA:.035,sensDistB:.03,sensDistC:.025,sensAngleA:.5,sensAngleB:.4,sensAngleC:.3,speed:.04,deposit:.08,decay:.7,fruitGain:.05,fruitGlow:.15,sporeDensity:.9,burstRate:1,throb:.15,shimmer:.1,sat:.6,palMix:.1,zoom:1,foodPull:.2,bubbles:0}],M=[[0,.1],[40,.25],[53.8,.3],[54.3,.55],[90,.5],[106,.35],[130,.4],[154,.55],[177.8,.62],[178.3,.95],[210,1],[234,.5],[251.238,.12]],he={energy:0};function ct(d){const e=Math.min(Math.max(d,0),M[M.length-1][0]);let t=0;for(;t<M.length-2&&e>=M[t+1][0];)t++;const s=M[t],i=M[t+1],r=Math.min(1,Math.max(0,(e-s[0])/Math.max(.001,i[0]-s[0])));return he.energy=s[1]+(i[1]-s[1])*r,he}const dt=6;function vt(d){const e=Math.min(1,Math.max(0,d));return e*e*(3-2*e)}function ft(d,e,t){if(t<=0)return d;if(t>=1)return e;const s={...d,name:t<.5?d.name:e.name};for(const i of Object.keys(d)){const r=d[i],o=e[i];typeof r=="number"&&typeof o=="number"&&(s[i]=r+(o-r)*t)}return s}function mt(d){const e=w[w.length-1],t=Math.min(Math.max(d,0),e-.001);let s=0;for(;s<U.length-1&&t>=w[s+1];)s++;const i=w[s],r=w[s+1]??e,o=Math.min(1,Math.max(0,(t-i)/Math.max(.001,r-i))),l=s<U.length-1,u=r-t,n=l?vt(1-Math.min(1,u/dt)):0,a=U[s],h=l?U[s+1]:a;return{params:ft(a,h,n),actIndex:s,localT:o,blend:n}}const pt=.12,gt=1.1,bt=.4,xt=.25,St=1.1,yt=1.6,Tt=.5,wt=.18,ue=.05,ce=.12,At=.09,Bt=.45,Dt=1.2,Mt=50,de=.06,ve=6,_t=20,fe=5e-4,Et=10,z=1.5,j=.16,me=14,Rt=10,R=.03,pe=.09,Ct=.16,Ut=2.5,Ft=.07,ge=2.5,Pt=.7,It=.6,Lt=.55,be=.015,Vt=7,zt=10,xe=.1,Se=.08,ye=.14,Q=1.1,Ce=U.findIndex(d=>d.name==="full-biosphere"),k=w[Ce],kt=w[Ce+1],$=.03,Te=.12,Ot=.1,Nt=3;function C(d){const e=Math.sin(d*12.9898)*43758.5453;return e-Math.floor(e)}class Ht{renderer;scene;camera;sim;dishQuad;dishMaterial;spores;rand;soloDish=!0;soloSpores=!0;forceBurstAlways=!1;forceFoodAlways=!1;full=!0;foodSlotCount=re;burstVisSlotCount=ne;stepsPerFrame=le;cover=new A(1,1);pan=new A(0,0);bassE=0;midE=0;highE=0;bassSlowE=0;onsetCooldown=0;flash=0;burstTimeToNext=0;burstActive=!1;burstTimeLeft=0;foodTimeToNext=0;foodSlots=[];foodValues;burstVisSlots=[];burstVisValues;bubbleSlotCount=me;bubbleSlots=[];bubbleValues;bubbleTimeToNext=0;motherX=.5;motherY=.5;motherVX=0;motherVY=0;motherR=p;motherUniformVec=new g(.5,.5,p,0);firstUpdate=!0;lastDt=0;lastSongTime=-1;held=!1;dragDx=0;dragDy=0;velX=0;velY=0;init(e){const{renderer:t,seed:s,quality:i}=e;this.renderer=t,this.rand=Me(s^2969960014);const r=new URLSearchParams(location.search),o=r.get("solo");this.soloDish=!o||o==="veins"||o==="fruit",this.soloSpores=!o||o==="spores",this.forceBurstAlways=r.get("burst")==="always",this.forceFoodAlways=r.get("food")==="always";const l=o==="veins"?1:o==="fruit"?2:0;this.full=i.level==="full",this.foodSlotCount=this.full?re:je,this.burstVisSlotCount=this.full?ne:Qe,this.stepsPerFrame=this.full?le:$e;for(let c=0;c<this.foodSlotCount;c++)this.foodSlots.push({age:0,active:!1});this.foodValues=[];for(let c=0;c<this.foodSlotCount;c++)this.foodValues.push(new g(0,0,de,0));for(let c=0;c<this.burstVisSlotCount;c++)this.burstVisSlots.push({age:0,active:!1});this.burstVisValues=[];for(let c=0;c<this.burstVisSlotCount;c++)this.burstVisValues.push(new g(0,0,0,0));this.bubbleSlotCount=this.full?me:Rt;for(let c=0;c<this.bubbleSlotCount;c++)this.bubbleSlots.push({active:!1,growTargetR:0,vx:0,vy:0,age:0});this.bubbleValues=[];for(let c=0;c<this.bubbleSlotCount;c++)this.bubbleValues.push(new g(0,0,0,0));this.scene=new O,this.camera=new we(-1,1,1,-1,0,1),o&&(this.scene.background=new De(3813440)),this.sim=new ot(t,this.full,this.foodSlotCount,this.foodValues);const u=this.full?_e:Ee;this.dishMaterial=new _({vertexShader:rt,fragmentShader:nt(this.full,this.foodSlotCount,this.burstVisSlotCount,this.bubbleSlotCount),depthTest:!1,depthWrite:!1,uniforms:{uTrail:{value:null},uTrailTexel:{value:new A(1/u,1/u)},uCover:{value:new A(1,1)},uPan:{value:this.pan},uZoom:{value:1},uTime:{value:0},uBass:{value:0},uHigh:{value:0},uFlash:{value:0},uThrob:{value:0},uShimmer:{value:0},uSat:{value:1},uPalMix:{value:0},uEnergy:{value:0},uFruitGlow:{value:0},uFood:{value:this.foodValues},uBurstVis:{value:this.burstVisValues},uBubble:{value:this.bubbleValues},uMother:{value:this.motherUniformVec},uSoloMode:{value:l}}}),this.dishQuad=new K(new Z(2,2),this.dishMaterial),this.soloDish&&this.scene.add(this.dishQuad),this.spores=new ut(s,i,t),this.soloSpores&&this.scene.add(this.spores.object);const n=t.domElement,a=n.clientWidth||1,h=n.clientHeight||1;this.resize(a,h)}kickFlash(e){this.flash=Math.min(yt,this.flash+e)}randomDishPoint(){const e=p*Math.sqrt(this.rand()),t=this.rand()*Math.PI*2;return[.5+Math.cos(t)*e,.5+Math.sin(t)*e]}activateBurstVis(e,t,s){let i=this.burstVisSlots.findIndex(o=>!o.active);i<0&&(i=0);const r=this.burstVisSlots[i];r.active=!0,r.age=0,this.burstVisValues[i].set(e,t,0,s)}updateBurstVisAges(e){for(let t=0;t<this.burstVisSlots.length;t++){const s=this.burstVisSlots[t];s.active&&(s.age+=e,s.age>=Dt?(s.active=!1,this.burstVisValues[t].w=0):this.burstVisValues[t].z=s.age)}}triggerBurst(e,t,s,i){this.burstActive=!0,this.burstTimeLeft=wt,this.sim.setBurst(e,t,s,i,this.rand()),this.activateBurstVis(e,t,1)}updateBurstActive(e){this.burstActive&&(this.burstTimeLeft-=e,this.burstTimeLeft<=0&&(this.burstActive=!1,this.sim.setBurst(0,0,0,0,0)))}scheduleBursts(e,t){const s=Math.max(0,t)/60;if(!(s<=0))for(this.burstTimeToNext-=e;this.burstTimeToNext<=0;){const[i,r]=this.randomDishPoint();this.triggerBurst(i,r,ue,ce),this.kickFlash(xt);const o=Math.max(1e-6,this.rand());this.burstTimeToNext+=-Math.log(o)/s}}scriptedMassBurst(){this.triggerBurst(.5,.5,At,Bt);for(let e=0;e<3;e++){const[t,s]=this.randomDishPoint();this.activateBurstVis(t,s,1)}this.kickFlash(St)}activateFood(e,t){let s=this.foodSlots.findIndex(r=>!r.active);s<0&&(s=0);const i=this.foodSlots[s];i.active=!0,i.age=0,this.foodValues[s].set(e,t,de,1)}updateFoodAges(e){for(let t=0;t<this.foodSlots.length;t++){const s=this.foodSlots[t];s.active&&(s.age+=e,s.age>=ve?(s.active=!1,this.foodValues[t].w=0):this.foodValues[t].w=1-s.age/ve)}}scheduleFood(e,t){const s=Math.max(0,t)/60;if(!(s<=0))for(this.foodTimeToNext-=e;this.foodTimeToNext<=0;){const[i,r]=this.randomDishPoint();this.activateFood(i,r);const o=Math.max(1e-6,this.rand());this.foodTimeToNext+=-Math.log(o)/s}}trySpawnBubble(){let e=-1;for(let l=0;l<this.bubbleSlots.length;l++)if(!this.bubbleSlots[l].active){e=l;break}if(e<0)return;let t=-1;if(this.rand()<.5){let l=0;for(let u=0;u<this.bubbleSlots.length;u++)this.bubbleSlots[u].active&&this.bubbleValues[u].z>Ft&&(l++,this.rand()<1/l&&(t=u))}const s=this.rand()*Math.PI*2;let i,r;if(t>=0){const l=this.bubbleValues[t];i=l.x+Math.cos(s)*(l.z+.5*R),r=l.y+Math.sin(s)*(l.z+.5*R)}else i=this.motherX+Math.cos(s)*(this.motherR+.5*R),r=this.motherY+Math.sin(s)*(this.motherR+.5*R);const o=this.bubbleSlots[e];o.active=!0,o.age=0,o.growTargetR=pe+this.rand()*(Ct-pe),o.vx=0,o.vy=0,this.bubbleValues[e].set(i,r,R,this.rand()),this.activateBurstVis(i,r,Lt)}scheduleBubbleSpawns(e,t,s){if(t.bubbles<=.001)return;const i=Math.min(1,Math.max(0,(s-k)/Math.max(.001,kt-k))),o=1/(ge+(Pt-ge)*Math.min(1,i/It));for(this.bubbleTimeToNext-=e;this.bubbleTimeToNext<=0;){this.trySpawnBubble();const l=Math.max(1e-6,this.rand());this.bubbleTimeToNext+=-Math.log(l)/o}}updateBubbles(e,t,s){const i=this.bubbleSlots,r=this.bubbleValues,o=i.length,l=1-Math.exp(-e/Ut);for(let n=0;n<o;n++){const a=i[n];if(!a.active)continue;a.age+=e;const h=r[n],c=a.growTargetR*t.bubbles;h.z+=(c-h.z)*l,h.z<.01&&a.age>.1&&(a.active=!1,h.set(0,0,0,0))}for(let n=0;n<o;n++){if(!i[n].active)continue;const a=r[n];for(let b=n+1;b<o;b++){if(!i[b].active)continue;const x=r[b],T=x.x-a.x,E=x.y-a.y,P=Math.max(1e-5,Math.hypot(T,E)),q=a.z+x.z+be;if(P>=q)continue;const J=T/P,ee=E/P,ze=q-P,H=a.z*a.z/(a.z*a.z+x.z*x.z+1e-6),te=1-H,I=ze*Vt*e;i[n].vx-=J*I*te,i[n].vy-=ee*I*te,i[b].vx+=J*I*H,i[b].vy+=ee*I*H}const h=a.x-this.motherX,c=a.y-this.motherY,v=Math.max(1e-5,Math.hypot(h,c)),m=this.motherR+a.z+be;if(v<m){const b=h/v,x=c/v,T=(m-v)*zt*e;i[n].vx+=b*T,i[n].vy+=x*T;const E=a.z*a.z/(this.motherR*this.motherR);this.motherVX-=b*T*E,this.motherVY-=x*T*E}const f=a.x-this.motherX,S=a.y-this.motherY,F=Math.max(1e-5,Math.hypot(f,S)),y=C(a.w*3.7+1.1)<.5?1:-1,B=-S/F*y,D=f/F*y;i[n].vx+=B*xe*e,i[n].vy+=D*xe*e;const Ue=.5+C(a.w*5.21+2.3)*.8,Fe=.5+C(a.w*7.77+9.4)*.8,Pe=C(a.w*3.14+6.6)*Math.PI*2,Ie=C(a.w*4.44+8.8)*Math.PI*2,Le=Math.sin(s*Ue+Pe),Ve=Math.cos(s*Fe+Ie);i[n].vx+=Le*Se*e,i[n].vy+=Ve*Se*e}const u=Math.exp(-2.2*e);for(let n=0;n<o;n++){const a=i[n];if(!a.active)continue;const h=r[n];h.x+=a.vx*e,h.y+=a.vy*e,a.vx*=u,a.vy*=u;const c=Math.hypot(a.vx,a.vy);if(c>ye){const S=ye/c;a.vx*=S,a.vy*=S}const v=h.x-.5,m=h.y-.5,f=Math.hypot(v,m);f>Q&&(h.x=.5+v/f*Q,h.y=.5+m/f*Q,a.vx=0,a.vy=0)}}updateMother(e){let t=0,s=0,i=0,r=0;const o=this.bubbleSlots,l=this.bubbleValues;for(let y=0;y<o.length;y++){if(!o[y].active)continue;const B=l[y],D=B.z*B.z;t+=D,s+=B.x*D,i+=B.y*D,r+=D}let u=.5,n=.5;r>1e-6&&(u=.5-Te*(s/r-.5),n=.5-Te*(i/r-.5));const a=this.motherX-u,h=this.motherY-n;this.motherVX+=-3*a*e,this.motherVY+=-3*h*e,this.motherX+=this.motherVX*e,this.motherY+=this.motherVY*e;const c=Math.exp(-2.5*e);this.motherVX*=c,this.motherVY*=c;const v=this.motherX-.5,m=this.motherY-.5,f=Math.hypot(v,m);f>$&&(this.motherX=.5+v/f*$,this.motherY=.5+m/f*$,this.motherVX=0,this.motherVY=0),t/=p*p;const S=p*(1-Ot*Math.min(1,t)),F=1-Math.exp(-e/Nt);this.motherR+=(S-this.motherR)*F,this.motherUniformVec.set(this.motherX,this.motherY,this.motherR,0)}resetBubbles(){for(let e=0;e<this.bubbleSlots.length;e++){const t=this.bubbleSlots[e];t.active=!1,t.vx=0,t.vy=0,t.age=0,this.bubbleValues[e].set(0,0,0,0)}this.bubbleTimeToNext=0,this.motherX=.5,this.motherY=.5,this.motherVX=0,this.motherVY=0,this.motherR=p,this.motherUniformVec.set(.5,.5,p,0)}warmup(e,t,s){s&&this.sim.seedAgents(this.rand),this.sim.setActParams(e),this.sim.step(qe*t,t)}update(e,t){const s=mt(t.time),i=s.params;if(this.lastDt=e,this.firstUpdate&&(this.firstUpdate=!1,this.warmup(i,Ze,!0),i.bubbles>.001&&t.time>k))for(let h=k;h<t.time;h+=.25)this.scheduleBubbleSpawns(.25,i,h),this.updateBubbles(.25,i,h),this.updateMother(.25),this.updateBurstVisAges(.25);this.lastSongTime>=0&&t.time<this.lastSongTime-10&&(this.sim.clearTrail(),this.warmup(i,Ke,!0),this.resetBubbles()),this.lastSongTime>=0&&t.time-this.lastSongTime>=0&&t.time-this.lastSongTime<.5&&(this.lastSongTime<54&&t.time>=54&&this.scriptedMassBurst(),this.lastSongTime<178&&t.time>=178&&this.scriptedMassBurst()),this.lastSongTime=t.time;const r=Math.min(1,e*8);if(this.bassE+=(t.bass-this.bassE)*r,this.midE+=(t.mid-this.midE)*r,this.highE+=(t.high-this.highE)*r,this.bassSlowE+=(t.bass-this.bassSlowE)*Math.min(1,e*1.5),this.onsetCooldown-=e,this.onsetCooldown<=0&&this.bassE-this.bassSlowE>pt){const[a,h]=this.randomDishPoint();this.triggerBurst(a,h,ue,ce),this.kickFlash(bt),i.bubbles>.001&&this.trySpawnBubble(),this.onsetCooldown=gt}this.scheduleBursts(e,this.forceBurstAlways?Mt:i.burstRate),this.updateBurstActive(e),this.updateBurstVisAges(e),this.scheduleFood(e,this.forceFoodAlways?_t:0),this.updateFoodAges(e),this.scheduleBubbleSpawns(e,i,t.time),this.updateBubbles(e,i,t.time),this.updateMother(e),this.flash*=Math.exp(-3.2*e),this.sim.setSpeedMod(1+this.midE*Tt),this.sim.setActParams(i);const o=this.dishMaterial.uniforms;o.uTime.value+=e,o.uBass.value=this.bassE,o.uHigh.value=this.highE,o.uFlash.value=this.flash,o.uThrob.value=i.throb,o.uShimmer.value=i.shimmer,o.uSat.value=i.sat,o.uPalMix.value=i.palMix,o.uFruitGlow.value=i.fruitGlow,o.uEnergy.value=ct(t.time).energy;const l=i.zoom;o.uZoom.value=l;const u=this.cover;if(this.held){if(e>1e-5){const a=Math.min(1,e*Et),h=Math.min(z,Math.max(-z,this.dragDx/e)),c=Math.min(z,Math.max(-z,this.dragDy/e));this.velX+=(h-this.velX)*a,this.velY+=(c-this.velY)*a}this.dragDx=0,this.dragDy=0}else if(this.velX!==0||this.velY!==0){this.pan.x+=this.velX*u.x/l*e,this.pan.y+=this.velY*u.y/l*e;const a=Math.exp(-2.5*e);this.velX*=a,this.velY*=a,Math.abs(this.velX)<fe&&(this.velX=0),Math.abs(this.velY)<fe&&(this.velY=0)}const n=Math.hypot(this.pan.x,this.pan.y);n>j&&(this.pan.x*=j/n,this.pan.y*=j/n,this.velX=0,this.velY=0),this.spores.update(e,t,s,l,u,this.pan,this.flash)}pointer(e){const t=this.dishMaterial.uniforms.uZoom.value,s=this.cover;if(e.type==="down"){this.held=!0,this.dragDx=0,this.dragDy=0,this.velX=0,this.velY=0;const i=(e.x-.5)*s.x/t+.5+this.pan.x,r=(e.y-.5)*s.y/t+.5+this.pan.y;this.activateFood(i,r);return}if(e.type==="move"){if(!this.held)return;this.pan.x+=e.dx*s.x/t,this.pan.y+=e.dy*s.y/t,this.dragDx+=e.dx,this.dragDy+=e.dy;return}if(e.type==="up"){this.held=!1;return}this.held=!1,this.velX=0,this.velY=0,this.dragDx=0,this.dragDy=0}render(){this.sim.step(this.lastDt,this.stepsPerFrame),this.dishMaterial.uniforms.uTrail.value=this.sim.trailTexture,this.renderer.setRenderTarget(null),this.renderer.render(this.scene,this.camera)}resize(e,t){if(!this.dishMaterial||e<=0||t<=0)return;const s=Math.min(3.5,Math.max(.28,e/t));s>=1?this.cover.set(s,1):this.cover.set(1,1/s),this.dishMaterial.uniforms.uCover.value.copy(this.cover)}dispose(){this.sim.dispose(),this.dishMaterial.dispose(),this.dishQuad.geometry.dispose(),this.spores.dispose(),this.renderer.setRenderTarget(null)}}const Gt={default:()=>new Ht},Wt=Gt.default;export{Wt as default};
//# sourceMappingURL=index-BJcTKwFd.js.map
