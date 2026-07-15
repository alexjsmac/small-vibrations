import{a as S,n as T,N as U,b as L,F as se,H as V,L as z,O as Q,V as v,S as b,d as P,e as g,M as I,g as ie,c as f,B as Z,f as A,o as M,Z as ae,p as re,q as oe,h as $,C as K,A as ne}from"./three-vlqji54k.js";import{m as q}from"./random-DL1jLgMw.js";const w=.48,le=512,he=256,J=1024,ee=512,O=6,ue=4,k=4,ce=3,H=2,de=1,ve=180,fe=60,pe=1/30,C=[2.4,2.8,3.2],R=[.35,.45,.55],ge=15,_=`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`,te=`
float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
// Species is derived from the agent texel's own y-coordinate (thirds of the
// texture), never stored — this function is the single source of truth
// every pass (update, deposit) calls, so they can never drift apart.
float speciesOf(vec2 auv) { return floor(clamp(auv.y, 0.0, 0.999999) * 3.0); }
// Dormant agents (hash over activeFrac threshold) neither move nor deposit.
bool isActiveAgent(vec2 auv, float activeFrac) { return hash21(auv + 41.7) <= activeFrac; }
`;function me(h){return`
precision highp float;
varying vec2 vUv;
uniform sampler2D uAgentPrev;
uniform sampler2D uTrail;
uniform float uDt;
uniform vec4 uSpeciesA[3]; // sensorDist, sensorAngle, turnRate, speed
uniform vec4 uSpeciesB[3]; // deposit (unused here), activeFrac, jitter, spare
uniform vec4 uFood[${h}]; // xy pos (dish-uv), z radius, w strength (0 = inactive)
uniform float uFoodPull;
uniform vec4 uBurst; // xy pos (dish-uv), z radius (unused), w strength (0 = inactive)
uniform float uBurstSeed;

const float DISH_R = ${w.toFixed(4)};
const vec2 DISH_C = vec2(0.5, 0.5);
const float PI = 3.14159265;
const float TWO_PI = 6.2831853;

${te}

float foodAt(vec2 p) {
  float f = 0.0;
  for (int i = 0; i < ${h}; i++) {
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
`}const Se=`
precision highp float;
varying vec2 vUv;
uniform float uSeed;
const float DISH_R = ${w.toFixed(4)};
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
`,Te=`
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
`,xe=`
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

${te}

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
`,ye=`
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
`;class be{renderer;agentTexSize;trailTexSize;foodSlots;agentTargets;agentReadIndex=0;trailTargets;trailReadIndex=0;agentScene;trailScene;depositScene;orthoCam;agentQuad;agentMaterial;seedMaterial;trailQuad;trailMaterial;depositPoints;depositMaterial;speciesA;speciesB;params=null;speedMod=1;constructor(e,t,s,i){this.renderer=e,this.foodSlots=s,this.agentTexSize=t?le:he,this.trailTexSize=t?J:ee;const u={type:!!e.extensions.get("EXT_color_buffer_float")?se:V,format:L,minFilter:U,magFilter:U,wrapS:T,wrapT:T,depthBuffer:!1,stencilBuffer:!1};this.agentTargets=[new S(this.agentTexSize,this.agentTexSize,u),new S(this.agentTexSize,this.agentTexSize,u)];const l={type:V,format:L,minFilter:z,magFilter:z,wrapS:T,wrapT:T,depthBuffer:!1,stencilBuffer:!1};this.trailTargets=[new S(this.trailTexSize,this.trailTexSize,l),new S(this.trailTexSize,this.trailTexSize,l)],this.orthoCam=new Q(-1,1,1,-1,0,1),this.speciesA=[new v,new v,new v],this.speciesB=[new v,new v,new v],this.agentScene=new b;const o=new P(2,2);this.agentMaterial=new g({vertexShader:_,fragmentShader:me(s),depthTest:!1,depthWrite:!1,uniforms:{uAgentPrev:{value:null},uTrail:{value:null},uDt:{value:0},uSpeciesA:{value:this.speciesA},uSpeciesB:{value:this.speciesB},uFood:{value:i},uFoodPull:{value:0},uBurst:{value:new v(0,0,0,0)},uBurstSeed:{value:0}}}),this.seedMaterial=new g({vertexShader:_,fragmentShader:Se,depthTest:!1,depthWrite:!1,uniforms:{uSeed:{value:0}}}),this.agentQuad=new I(o,this.agentMaterial),this.agentScene.add(this.agentQuad),this.trailScene=new b,this.trailMaterial=new g({vertexShader:_,fragmentShader:Te,depthTest:!1,depthWrite:!1,uniforms:{uTrailPrev:{value:null},uTexel:{value:new f(1/this.trailTexSize,1/this.trailTexSize)},uDecay:{value:new ie(1,1,1)},uDecayFruit:{value:1},uFruitGain:{value:0}}}),this.trailQuad=new I(new P(2,2),this.trailMaterial),this.trailScene.add(this.trailQuad);const n=this.agentTexSize,d=new Float32Array(n*n*2);let c=0;for(let B=0;B<n;B++)for(let F=0;F<n;F++)d[c++]=(F+.5)/n,d[c++]=(B+.5)/n;const D=new Z;D.setAttribute("aUv",new A(d,2)),D.setAttribute("position",new A(new Float32Array(n*n*3),3)),this.depositMaterial=new g({vertexShader:xe,fragmentShader:ye,depthTest:!1,depthWrite:!1,transparent:!0,blending:oe,blendEquation:re,blendSrc:M,blendDst:M,blendSrcAlpha:ae,blendDstAlpha:M,uniforms:{uAgentTex:{value:null},uSpeciesB:{value:this.speciesB},uDt:{value:0}}}),this.depositPoints=new $(D,this.depositMaterial),this.depositPoints.frustumCulled=!1,this.depositScene=new b,this.depositScene.add(this.depositPoints),this.clearTrail()}setActParams(e){this.params=e}setSpeedMod(e){this.speedMod=e}setBurst(e,t,s,i,r){this.agentMaterial.uniforms.uBurst.value.set(e,t,s,i),this.agentMaterial.uniforms.uBurstSeed.value=r}updateAgentUniforms(e,t){const s=e.speed*this.speedMod;this.speciesA[0].set(e.sensDistA,e.sensAngleA,C[0],s),this.speciesA[1].set(e.sensDistB,e.sensAngleB,C[1],s),this.speciesA[2].set(e.sensDistC,e.sensAngleC,C[2],s),this.speciesB[0].set(e.deposit,e.activeA,R[0],0),this.speciesB[1].set(e.deposit,e.activeB,R[1],0),this.speciesB[2].set(e.deposit,e.activeC,R[2],0),this.agentMaterial.uniforms.uDt.value=t,this.agentMaterial.uniforms.uFoodPull.value=e.foodPull}updateTrailUniforms(e,t){const s=Math.exp(-e.decay*t);this.trailMaterial.uniforms.uDecay.value.set(s,s,s),this.trailMaterial.uniforms.uDecayFruit.value=Math.exp(-t/ge),this.trailMaterial.uniforms.uFruitGain.value=e.fruitGain*t}step(e,t){const s=this.params;if(!s||t<=0)return;const i=e/t,r=this.renderer.getRenderTarget(),a=this.renderer.autoClear;for(let u=0;u<t;u++){this.updateAgentUniforms(s,i);const l=this.agentTargets[this.agentReadIndex],o=this.agentTargets[1-this.agentReadIndex];this.agentMaterial.uniforms.uAgentPrev.value=l.texture,this.agentMaterial.uniforms.uTrail.value=this.trailTargets[this.trailReadIndex].texture,this.renderer.setRenderTarget(o),this.renderer.autoClear=!0,this.renderer.render(this.agentScene,this.orthoCam),this.agentReadIndex=1-this.agentReadIndex,this.updateTrailUniforms(s,i);const n=this.trailTargets[this.trailReadIndex],d=this.trailTargets[1-this.trailReadIndex];this.trailMaterial.uniforms.uTrailPrev.value=n.texture,this.renderer.setRenderTarget(d),this.renderer.autoClear=!0,this.renderer.render(this.trailScene,this.orthoCam),this.depositMaterial.uniforms.uAgentTex.value=this.agentTargets[this.agentReadIndex].texture,this.depositMaterial.uniforms.uDt.value=i,this.renderer.autoClear=!1,this.renderer.render(this.depositScene,this.orthoCam),this.trailReadIndex=1-this.trailReadIndex}this.renderer.autoClear=a,this.renderer.setRenderTarget(r??null)}seedAgents(e){const t=e();this.seedMaterial.uniforms.uSeed.value=t;const s=this.renderer.getRenderTarget();this.agentQuad.material=this.seedMaterial;for(const i of this.agentTargets)this.renderer.setRenderTarget(i),this.renderer.render(this.agentScene,this.orthoCam);this.renderer.setRenderTarget(s??null),this.agentQuad.material=this.agentMaterial}clearTrail(){const e=this.renderer.getRenderTarget(),t=new K;this.renderer.getClearColor(t);const s=this.renderer.getClearAlpha();this.renderer.setClearColor(0,0);for(const i of this.trailTargets)this.renderer.setRenderTarget(i),this.renderer.clear(!0,!1,!1);this.renderer.setClearColor(t,s),this.renderer.setRenderTarget(e??null)}get trailTexture(){return this.trailTargets[this.trailReadIndex].texture}dispose(){this.agentTargets[0].dispose(),this.agentTargets[1].dispose(),this.trailTargets[0].dispose(),this.trailTargets[1].dispose(),this.agentMaterial.dispose(),this.seedMaterial.dispose(),this.trailMaterial.dispose(),this.depositMaterial.dispose(),this.agentQuad.geometry.dispose(),this.trailQuad.geometry.dispose(),this.depositPoints.geometry.dispose()}}const Ae=`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;function we(h,e,t){return`
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
// class doc for why these are two separate structures).
uniform vec4 uBurstVis[${t}];
// 0 = all layers (ground+veins+fruit+events), 1 = veins-only isolation
// (?solo=veins), 2 = fruit-only isolation (?solo=fruit) — both isolation
// modes force a flat neutral ground so the additive layer reads on
// contrast, per the house "isolate on a bright background" convention.
uniform float uSoloMode;

const float DISH_R = ${w.toFixed(4)};

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
${h?`  p = p * 2.07 + 11.3;
  v += 0.25 * vnoise(p);`:""}
  return v;
}

void main() {
  vec2 dishUv = (vUv - 0.5) * uCover / uZoom + 0.5 + uPan;
  float distC = length(dishUv - vec2(0.5));

${h?"  float aa = fwidth(distC) * 1.5;":"  float aa = 0.006;"} // fixed epsilon on Lite: no derivatives on that path

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
`}const De=4e3,Be=1200;class Fe{constructor(e,t,s){this.renderer=s;const i=q(e^93360613),r=Math.min(t.particleBudget,t.level==="full"?De:Be),a=new Float32Array(r*3),u=new Float32Array(r);for(let l=0;l<r;l++)a[l*3+0]=(i()*2-1)*.62,a[l*3+1]=(i()*2-1)*.62,a[l*3+2]=(i()*2-1)*.4,u[l]=i();this.geometry=new Z,this.geometry.setAttribute("position",new A(a,3)),this.geometry.setAttribute("aSeed",new A(u,1)),this.uniforms={uFlowTime:{value:0},uTurbulence:{value:.6},uFlowAmount:{value:.5},uDensity:{value:1},uBrightness:{value:.65},uHigh:{value:0},uBass:{value:0},uScale:{value:90},uSeedShift:{value:i()*100},uFlash:{value:0},uZoom:{value:1},uCover:{value:new f(1,1)},uPan:{value:new f(0,0)}},this.material=new g({uniforms:this.uniforms,transparent:!0,depthTest:!1,depthWrite:!1,blending:ne,vertexShader:`
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
      `}),this.object=new $(this.geometry,this.material),this.object.frustumCulled=!1}object;material;geometry;uniforms;update(e,t,s,i,r,a,u=0){const l=s.params,o=this.uniforms;o.uFlowTime.value+=e*.5,o.uDensity.value=l.sporeDensity,o.uHigh.value=t.high,o.uBass.value=t.bass,o.uFlash.value=u,o.uZoom.value=i,o.uCover.value.copy(r),o.uPan.value.copy(a),o.uScale.value=this.renderer.domElement.height*.1}dispose(){this.geometry.dispose(),this.material.dispose()}}const m=[0,54,106,130,154,178,234,251.238],x=[{name:"spores",activeA:.35,activeB:0,activeC:0,sensDistA:.035,sensDistB:.03,sensDistC:.03,sensAngleA:.5,sensAngleB:.4,sensAngleC:.4,speed:.05,deposit:.15,decay:.25,fruitGain:.05,fruitGlow:.1,sporeDensity:1,burstRate:2,throb:.2,shimmer:.15,sat:.9,palMix:.1,zoom:1,foodPull:.3},{name:"first-bloom",activeA:.8,activeB:.1,activeC:0,sensDistA:.04,sensDistB:.03,sensDistC:.03,sensAngleA:.55,sensAngleB:.4,sensAngleC:.4,speed:.09,deposit:.45,decay:.2,fruitGain:.25,fruitGlow:.4,sporeDensity:.5,burstRate:10,throb:.6,shimmer:.3,sat:1,palMix:.2,zoom:1,foodPull:.4},{name:"rot",activeA:.55,activeB:.1,activeC:0,sensDistA:.04,sensDistB:.03,sensDistC:.03,sensAngleA:.5,sensAngleB:.4,sensAngleC:.4,speed:.06,deposit:.15,decay:.55,fruitGain:.1,fruitGlow:.2,sporeDensity:.3,burstRate:1.5,throb:.25,shimmer:.15,sat:.45,palMix:.55,zoom:1,foodPull:.2},{name:"stirring",activeA:.5,activeB:.7,activeC:0,sensDistA:.04,sensDistB:.07,sensDistC:.03,sensAngleA:.5,sensAngleB:.9,sensAngleC:.4,speed:.08,deposit:.3,decay:.3,fruitGain:.15,fruitGlow:.25,sporeDensity:.35,burstRate:4,throb:.35,shimmer:.25,sat:.7,palMix:.35,zoom:1,foodPull:.35},{name:"convergence",activeA:.7,activeB:.75,activeC:.4,sensDistA:.04,sensDistB:.07,sensDistC:.025,sensAngleA:.5,sensAngleB:.9,sensAngleC:.3,speed:.09,deposit:.4,decay:.25,fruitGain:.2,fruitGlow:.3,sporeDensity:.3,burstRate:6,throb:.4,shimmer:.3,sat:.55,palMix:.3,zoom:1,foodPull:.45},{name:"full-biosphere",activeA:.95,activeB:.9,activeC:.6,sensDistA:.045,sensDistB:.075,sensDistC:.028,sensAngleA:.55,sensAngleB:.95,sensAngleC:.32,speed:.11,deposit:.55,decay:.2,fruitGain:.3,fruitGlow:.55,sporeDensity:.6,burstRate:16,throb:.85,shimmer:.6,sat:1,palMix:.15,zoom:.72,foodPull:.5},{name:"exhale",activeA:.15,activeB:.05,activeC:.02,sensDistA:.035,sensDistB:.03,sensDistC:.025,sensAngleA:.5,sensAngleB:.4,sensAngleC:.3,speed:.04,deposit:.08,decay:.7,fruitGain:.05,fruitGlow:.15,sporeDensity:.9,burstRate:1,throb:.15,shimmer:.1,sat:.6,palMix:.1,zoom:1,foodPull:.2}],p=[[0,.1],[40,.25],[53.8,.3],[54.3,.55],[90,.5],[106,.35],[130,.4],[154,.55],[177.8,.62],[178.3,.95],[210,1],[234,.5],[251.238,.12]],G={energy:0};function Me(h){const e=Math.min(Math.max(h,0),p[p.length-1][0]);let t=0;for(;t<p.length-2&&e>=p[t+1][0];)t++;const s=p[t],i=p[t+1],r=Math.min(1,Math.max(0,(e-s[0])/Math.max(.001,i[0]-s[0])));return G.energy=s[1]+(i[1]-s[1])*r,G}const Ce=6;function Re(h){const e=Math.min(1,Math.max(0,h));return e*e*(3-2*e)}function _e(h,e,t){if(t<=0)return h;if(t>=1)return e;const s={...h,name:t<.5?h.name:e.name};for(const i of Object.keys(h)){const r=h[i],a=e[i];typeof r=="number"&&typeof a=="number"&&(s[i]=r+(a-r)*t)}return s}function Ee(h){const e=m[m.length-1],t=Math.min(Math.max(h,0),e-.001);let s=0;for(;s<x.length-1&&t>=m[s+1];)s++;const i=m[s],r=m[s+1]??e,a=Math.min(1,Math.max(0,(t-i)/Math.max(.001,r-i))),u=s<x.length-1,l=r-t,o=u?Re(1-Math.min(1,l/Ce)):0,n=x[s],d=u?x[s+1]:n;return{params:_e(n,d,o),actIndex:s,localT:a,blend:o}}const Pe=.12,Ie=1.1,Ue=.4,Le=.25,Ve=1.1,ze=1.6,Oe=.5,ke=.18,N=.05,W=.12,He=.09,Ge=.45,Ne=1.2,We=50,X=.06,Y=6,Xe=20,j=5e-4,Ye=10,y=1.5,E=.16;class je{renderer;scene;camera;sim;dishQuad;dishMaterial;spores;rand;soloDish=!0;soloSpores=!0;forceBurstAlways=!1;forceFoodAlways=!1;full=!0;foodSlotCount=O;burstVisSlotCount=k;stepsPerFrame=H;cover=new f(1,1);pan=new f(0,0);bassE=0;midE=0;highE=0;bassSlowE=0;onsetCooldown=0;flash=0;burstTimeToNext=0;burstActive=!1;burstTimeLeft=0;foodTimeToNext=0;foodSlots=[];foodValues;burstVisSlots=[];burstVisValues;firstUpdate=!0;lastDt=0;lastSongTime=-1;held=!1;dragDx=0;dragDy=0;velX=0;velY=0;init(e){const{renderer:t,seed:s,quality:i}=e;this.renderer=t,this.rand=q(s^2969960014);const r=new URLSearchParams(location.search),a=r.get("solo");this.soloDish=!a||a==="veins"||a==="fruit",this.soloSpores=!a||a==="spores",this.forceBurstAlways=r.get("burst")==="always",this.forceFoodAlways=r.get("food")==="always";const u=a==="veins"?1:a==="fruit"?2:0;this.full=i.level==="full",this.foodSlotCount=this.full?O:ue,this.burstVisSlotCount=this.full?k:ce,this.stepsPerFrame=this.full?H:de;for(let c=0;c<this.foodSlotCount;c++)this.foodSlots.push({age:0,active:!1});this.foodValues=[];for(let c=0;c<this.foodSlotCount;c++)this.foodValues.push(new v(0,0,X,0));for(let c=0;c<this.burstVisSlotCount;c++)this.burstVisSlots.push({age:0,active:!1});this.burstVisValues=[];for(let c=0;c<this.burstVisSlotCount;c++)this.burstVisValues.push(new v(0,0,0,0));this.scene=new b,this.camera=new Q(-1,1,1,-1,0,1),a&&(this.scene.background=new K(3813440)),this.sim=new be(t,this.full,this.foodSlotCount,this.foodValues);const l=this.full?J:ee;this.dishMaterial=new g({vertexShader:Ae,fragmentShader:we(this.full,this.foodSlotCount,this.burstVisSlotCount),depthTest:!1,depthWrite:!1,uniforms:{uTrail:{value:null},uTrailTexel:{value:new f(1/l,1/l)},uCover:{value:new f(1,1)},uPan:{value:this.pan},uZoom:{value:1},uTime:{value:0},uBass:{value:0},uHigh:{value:0},uFlash:{value:0},uThrob:{value:0},uShimmer:{value:0},uSat:{value:1},uPalMix:{value:0},uEnergy:{value:0},uFruitGlow:{value:0},uFood:{value:this.foodValues},uBurstVis:{value:this.burstVisValues},uSoloMode:{value:u}}}),this.dishQuad=new I(new P(2,2),this.dishMaterial),this.soloDish&&this.scene.add(this.dishQuad),this.spores=new Fe(s,i,t),this.soloSpores&&this.scene.add(this.spores.object);const o=t.domElement,n=o.clientWidth||1,d=o.clientHeight||1;this.resize(n,d)}kickFlash(e){this.flash=Math.min(ze,this.flash+e)}randomDishPoint(){const e=w*Math.sqrt(this.rand()),t=this.rand()*Math.PI*2;return[.5+Math.cos(t)*e,.5+Math.sin(t)*e]}activateBurstVis(e,t,s){let i=this.burstVisSlots.findIndex(a=>!a.active);i<0&&(i=0);const r=this.burstVisSlots[i];r.active=!0,r.age=0,this.burstVisValues[i].set(e,t,0,s)}updateBurstVisAges(e){for(let t=0;t<this.burstVisSlots.length;t++){const s=this.burstVisSlots[t];s.active&&(s.age+=e,s.age>=Ne?(s.active=!1,this.burstVisValues[t].w=0):this.burstVisValues[t].z=s.age)}}triggerBurst(e,t,s,i){this.burstActive=!0,this.burstTimeLeft=ke,this.sim.setBurst(e,t,s,i,this.rand()),this.activateBurstVis(e,t,1)}updateBurstActive(e){this.burstActive&&(this.burstTimeLeft-=e,this.burstTimeLeft<=0&&(this.burstActive=!1,this.sim.setBurst(0,0,0,0,0)))}scheduleBursts(e,t){const s=Math.max(0,t)/60;if(!(s<=0))for(this.burstTimeToNext-=e;this.burstTimeToNext<=0;){const[i,r]=this.randomDishPoint();this.triggerBurst(i,r,N,W),this.kickFlash(Le);const a=Math.max(1e-6,this.rand());this.burstTimeToNext+=-Math.log(a)/s}}scriptedMassBurst(){this.triggerBurst(.5,.5,He,Ge);for(let e=0;e<3;e++){const[t,s]=this.randomDishPoint();this.activateBurstVis(t,s,1)}this.kickFlash(Ve)}activateFood(e,t){let s=this.foodSlots.findIndex(r=>!r.active);s<0&&(s=0);const i=this.foodSlots[s];i.active=!0,i.age=0,this.foodValues[s].set(e,t,X,1)}updateFoodAges(e){for(let t=0;t<this.foodSlots.length;t++){const s=this.foodSlots[t];s.active&&(s.age+=e,s.age>=Y?(s.active=!1,this.foodValues[t].w=0):this.foodValues[t].w=1-s.age/Y)}}scheduleFood(e,t){const s=Math.max(0,t)/60;if(!(s<=0))for(this.foodTimeToNext-=e;this.foodTimeToNext<=0;){const[i,r]=this.randomDishPoint();this.activateFood(i,r);const a=Math.max(1e-6,this.rand());this.foodTimeToNext+=-Math.log(a)/s}}warmup(e,t,s){s&&this.sim.seedAgents(this.rand),this.sim.setActParams(e),this.sim.step(pe*t,t)}update(e,t){const s=Ee(t.time),i=s.params;this.lastDt=e,this.firstUpdate&&(this.firstUpdate=!1,this.warmup(i,ve,!0)),this.lastSongTime>=0&&t.time<this.lastSongTime-10&&(this.sim.clearTrail(),this.warmup(i,fe,!0)),this.lastSongTime>=0&&t.time-this.lastSongTime>=0&&t.time-this.lastSongTime<.5&&(this.lastSongTime<54&&t.time>=54&&this.scriptedMassBurst(),this.lastSongTime<178&&t.time>=178&&this.scriptedMassBurst()),this.lastSongTime=t.time;const r=Math.min(1,e*8);if(this.bassE+=(t.bass-this.bassE)*r,this.midE+=(t.mid-this.midE)*r,this.highE+=(t.high-this.highE)*r,this.bassSlowE+=(t.bass-this.bassSlowE)*Math.min(1,e*1.5),this.onsetCooldown-=e,this.onsetCooldown<=0&&this.bassE-this.bassSlowE>Pe){const[n,d]=this.randomDishPoint();this.triggerBurst(n,d,N,W),this.kickFlash(Ue),this.onsetCooldown=Ie}this.scheduleBursts(e,this.forceBurstAlways?We:i.burstRate),this.updateBurstActive(e),this.updateBurstVisAges(e),this.scheduleFood(e,this.forceFoodAlways?Xe:0),this.updateFoodAges(e),this.flash*=Math.exp(-3.2*e),this.sim.setSpeedMod(1+this.midE*Oe),this.sim.setActParams(i);const a=this.dishMaterial.uniforms;a.uTime.value+=e,a.uBass.value=this.bassE,a.uHigh.value=this.highE,a.uFlash.value=this.flash,a.uThrob.value=i.throb,a.uShimmer.value=i.shimmer,a.uSat.value=i.sat,a.uPalMix.value=i.palMix,a.uFruitGlow.value=i.fruitGlow,a.uEnergy.value=Me(t.time).energy;const u=i.zoom;a.uZoom.value=u;const l=this.cover;if(this.held){if(e>1e-5){const n=Math.min(1,e*Ye),d=Math.min(y,Math.max(-y,this.dragDx/e)),c=Math.min(y,Math.max(-y,this.dragDy/e));this.velX+=(d-this.velX)*n,this.velY+=(c-this.velY)*n}this.dragDx=0,this.dragDy=0}else if(this.velX!==0||this.velY!==0){this.pan.x+=this.velX*l.x/u*e,this.pan.y+=this.velY*l.y/u*e;const n=Math.exp(-2.5*e);this.velX*=n,this.velY*=n,Math.abs(this.velX)<j&&(this.velX=0),Math.abs(this.velY)<j&&(this.velY=0)}const o=Math.hypot(this.pan.x,this.pan.y);o>E&&(this.pan.x*=E/o,this.pan.y*=E/o,this.velX=0,this.velY=0),this.spores.update(e,t,s,u,l,this.pan,this.flash)}pointer(e){const t=this.dishMaterial.uniforms.uZoom.value,s=this.cover;if(e.type==="down"){this.held=!0,this.dragDx=0,this.dragDy=0,this.velX=0,this.velY=0;const i=(e.x-.5)*s.x/t+.5+this.pan.x,r=(e.y-.5)*s.y/t+.5+this.pan.y;this.activateFood(i,r);return}if(e.type==="move"){if(!this.held)return;this.pan.x+=e.dx*s.x/t,this.pan.y+=e.dy*s.y/t,this.dragDx+=e.dx,this.dragDy+=e.dy;return}if(e.type==="up"){this.held=!1;return}this.held=!1,this.velX=0,this.velY=0,this.dragDx=0,this.dragDy=0}render(){this.sim.step(this.lastDt,this.stepsPerFrame),this.dishMaterial.uniforms.uTrail.value=this.sim.trailTexture,this.renderer.setRenderTarget(null),this.renderer.render(this.scene,this.camera)}resize(e,t){if(!this.dishMaterial||e<=0||t<=0)return;const s=Math.min(3.5,Math.max(.28,e/t));s>=1?this.cover.set(s,1):this.cover.set(1,1/s),this.dishMaterial.uniforms.uCover.value.copy(this.cover)}dispose(){this.sim.dispose(),this.dishMaterial.dispose(),this.dishQuad.geometry.dispose(),this.spores.dispose(),this.renderer.setRenderTarget(null)}}const Qe={default:()=>new je},Ke=Qe.default;export{Ke as default};
//# sourceMappingURL=index-BZMGneVW.js.map
