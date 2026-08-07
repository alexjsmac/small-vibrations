import{a as y,R as S,L as T,b as O,H as G,V as p,c as m,S as P,O as R,d as D,e as w,M as N}from"./three-vlqji54k.js";import{m as X}from"./random-DL1jLgMw.js";import{O as Y}from"./onset-DHl140yf.js";const M=`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`,_=`
precision highp float;
void main() {
  gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0);
}
`,V=`
precision highp float;
varying vec2 vUv;
uniform sampler2D uPrev;
uniform vec2 uTexel;
uniform float uFeed, uKill, uDScale, uFeedNoise, uNoiseTime;
uniform vec2 uAniso;   // per-axis laplacian scale
uniform vec2 uAdvect;  // texels per step
uniform vec4 uSeeds[4]; // xy = pos (uv), z = radius (uv), w = strength (0 = inactive)

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1,0)), u.x),
             mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), u.x), u.y);
}

void main(){
  vec2 uv = vUv - uAdvect * uTexel;
  vec2 tx = uTexel * uAniso;
  vec2 c  = texture2D(uPrev, uv).rg;
  // 9-point laplacian
  vec2 lap = -c;
  lap += 0.2  * texture2D(uPrev, uv + vec2( tx.x, 0.0)).rg;
  lap += 0.2  * texture2D(uPrev, uv + vec2(-tx.x, 0.0)).rg;
  lap += 0.2  * texture2D(uPrev, uv + vec2(0.0,  tx.y)).rg;
  lap += 0.2  * texture2D(uPrev, uv + vec2(0.0, -tx.y)).rg;
  lap += 0.05 * texture2D(uPrev, uv + vec2( tx.x,  tx.y)).rg;
  lap += 0.05 * texture2D(uPrev, uv + vec2(-tx.x,  tx.y)).rg;
  lap += 0.05 * texture2D(uPrev, uv + vec2( tx.x, -tx.y)).rg;
  lap += 0.05 * texture2D(uPrev, uv + vec2(-tx.x, -tx.y)).rg;

  float f = uFeed * (1.0 + uFeedNoise * (vnoise(vUv * 4.0 + uNoiseTime) - 0.5) * 2.0);
  float A = c.r, B = c.g;
  float ABB = A * B * B;
  float dA = uDScale * 1.0 * lap.r - ABB + f * (1.0 - A);
  float dB = uDScale * 0.5 * lap.g + ABB - (uKill + f) * B;
  A = clamp(A + dA, 0.0, 1.0);
  B = clamp(B + dB, 0.0, 1.0);

  // Life injection: gaussian dabs of B where seeds are active.
  for (int i = 0; i < 4; i++) {
    vec4 s = uSeeds[i];
    if (s.w > 0.0) {
      vec2 d = vUv - s.xy;
      float g = exp(-dot(d, d) / (s.z * s.z));
      B = clamp(B + s.w * g, 0.0, 1.0);
      A = clamp(A - 0.5 * s.w * g, 0.0, 1.0);
    }
  }
  gl_FragColor = vec4(A, B, 0.0, 1.0);
}
`;class I{uniforms;renderer;targets;readIndex=0;scene;camera;quad;simMaterial;initMaterial;constructor(e,i,t){this.renderer=e;const a={type:G,format:O,minFilter:T,magFilter:T,wrapS:S,wrapT:S,depthBuffer:!1,stencilBuffer:!1};this.targets=[new y(i,t,a),new y(i,t,a)],this.uniforms={uPrev:{value:null},uTexel:{value:new m(1/i,1/t)},uFeed:{value:.03},uKill:{value:.0665},uDScale:{value:1},uFeedNoise:{value:.1},uNoiseTime:{value:0},uAniso:{value:new m(1,1)},uAdvect:{value:new m(0,0)},uSeeds:{value:[new p(0,0,.02,0),new p(0,0,.02,0),new p(0,0,.02,0),new p(0,0,.02,0)]}},this.scene=new P,this.camera=new R(-1,1,1,-1,0,1);const s=new D(2,2);this.simMaterial=new w({vertexShader:M,fragmentShader:V,uniforms:this.uniforms,depthTest:!1,depthWrite:!1}),this.initMaterial=new w({vertexShader:M,fragmentShader:_,depthTest:!1,depthWrite:!1}),this.quad=new N(s,this.initMaterial),this.scene.add(this.quad);const r=this.renderer.getRenderTarget();for(const o of this.targets)this.renderer.setRenderTarget(o),this.renderer.render(this.scene,this.camera);this.renderer.setRenderTarget(r),this.quad.material=this.simMaterial}step(e){const i=this.renderer.getRenderTarget();for(let t=0;t<e;t++){const a=this.targets[this.readIndex],s=this.targets[1-this.readIndex];this.uniforms.uPrev.value=a.texture,this.renderer.setRenderTarget(s),this.renderer.render(this.scene,this.camera),this.readIndex=1-this.readIndex}this.renderer.setRenderTarget(i??null)}get texture(){return this.targets[this.readIndex].texture}dispose(){this.targets[0].dispose(),this.targets[1].dispose(),this.simMaterial.dispose(),this.initMaterial.dispose(),this.quad.geometry.dispose()}}const f=[0,16,64,100,180,200,248,286.439],v=[{name:"void",feed:.034,kill:.0655,dScale:1,anisoX:1,anisoY:1,advectX:0,advectY:0,seedRate:6,fieldGain:.45,palMix:.05,nebula:.55,glow:.5,pulse:.2,feedNoise:.1},{name:"stirring",feed:.0367,kill:.0649,dScale:1,anisoX:1,anisoY:1,advectX:0,advectY:0,seedRate:10,fieldGain:.7,palMix:.15,nebula:.45,glow:.7,pulse:.35,feedNoise:.15},{name:"fragments",feed:.046,kill:.063,dScale:1.05,anisoX:1,anisoY:1,advectX:0,advectY:0,seedRate:14,fieldGain:.8,palMix:.3,nebula:.35,glow:.9,pulse:.5,feedNoise:.35},{name:"condensation",feed:.0545,kill:.062,dScale:1,anisoX:1,anisoY:1,advectX:0,advectY:0,seedRate:8,fieldGain:.95,palMix:.45,nebula:.3,glow:1,pulse:.45,feedNoise:.2},{name:"shift",feed:.029,kill:.057,dScale:1,anisoX:1.25,anisoY:.85,advectX:.08,advectY:0,seedRate:6,fieldGain:.9,palMix:.6,nebula:.3,glow:1.1,pulse:.5,feedNoise:.2},{name:"the-march",feed:.029,kill:.057,dScale:1,anisoX:1.6,anisoY:.7,advectX:.1,advectY:-.01,seedRate:6,fieldGain:1,palMix:.9,nebula:.25,glow:1.3,pulse:.6,feedNoise:.15},{name:"dissolve",feed:.03,kill:.0658,dScale:1,anisoX:1,anisoY:1,advectX:0,advectY:0,seedRate:2,fieldGain:.5,palMix:.35,nebula:.5,glow:.6,pulse:.25,feedNoise:.1}],L=6;function H(u){const e=Math.min(1,Math.max(0,u));return e*e*(3-2*e)}function C(u,e,i){if(i<=0)return u;if(i>=1)return e;const t={...u,name:i<.5?u.name:e.name};for(const a of Object.keys(u)){const s=u[a],r=e[a];typeof s=="number"&&typeof r=="number"&&(t[a]=s+(r-s)*i)}return t}function k(u){const e=f[f.length-1],i=Math.min(Math.max(u,0),e-.001);let t=0;for(;t<v.length-1&&i>=f[t+1];)t++;const a=f[t],s=f[t+1]??e,r=Math.min(1,Math.max(0,(i-a)/Math.max(.001,s-a))),o=t<v.length-1,c=s-i,n=o?H(1-Math.min(1,c/L)):0,d=v[t],h=o?v[t+1]:d;return{params:C(d,h,n),actIndex:t,localT:r,blend:n}}const W=`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`,z=`
precision highp float;
varying vec2 vUv;
uniform sampler2D uField;
uniform vec2 uTexel;    // sim texel size
uniform vec2 uCover;    // cover-fit uv scale
uniform vec2 uScroll;   // accumulated display drift (uv) — the "march"; sim texture wraps
uniform float uTime, uGain, uPalMix, uNebula, uGlow, uBass, uHigh, uPulse;
uniform vec4 uRipples[3]; // xy = field uv center, z = age (s), w = base amp (0 = inactive)

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1,0)), u.x),
             mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), u.x), u.y);
}
float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++){ v += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return v;
}

void main(){
  vec2 uv = (vUv - 0.5) * uCover + 0.5 - uScroll;

  // Poke ripples: distort uv before the field/lighting samples below so the
  // wave visibly warps both the organism and its shading, then add a glow
  // ring on top. Placed here (not after B/gradient sampling) deliberately.
  vec3 rippleGlow = vec3(0.0);
  for (int i = 0; i < 3; i++) {
    vec4 rp = uRipples[i];
    if (rp.w <= 0.0) continue;
    vec2 rd = uv - rp.xy;
    rd -= floor(rd + 0.5); // torus wrap: uv is unbounded (scroll drift) while rp.xy is wrapped to [0,1)
    float dist = length(rd);
    float amp = rp.w * exp(-rp.z * 3.2);
    float wave = sin(dist * 160.0 - rp.z * 7.0) * exp(-dist * 16.0) * amp;
    uv += normalize(rd + 1e-5) * wave * 0.012;
    float ring = exp(-pow((dist - rp.z * 0.14) * 26.0, 2.0)) * amp;
    rippleGlow += vec3(1.0, 0.96, 0.88) * ring;
  }

  float B = texture2D(uField, uv).g;

  // Gradient → fake lighting (wet, embossed organisms).
  float bx = texture2D(uField, uv + vec2(uTexel.x, 0.0)).g - texture2D(uField, uv - vec2(uTexel.x, 0.0)).g;
  float by = texture2D(uField, uv + vec2(0.0, uTexel.y)).g - texture2D(uField, uv - vec2(0.0, uTexel.y)).g;
  vec3 n = normalize(vec3(-bx * 6.0, -by * 6.0, 1.0));
  vec3 L = normalize(vec3(cos(uTime * 0.05), sin(uTime * 0.05), 0.9));
  float diff = max(dot(n, L), 0.0);
  float spec = pow(max(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0), 24.0);

  // Background nebula: domain-warped fbm, deep indigo → violet.
  vec2 w = vec2(fbm(vUv * 2.0 + uTime * 0.01), fbm(vUv * 2.0 + 5.2 - uTime * 0.008));
  float neb = fbm(vUv * 3.0 + w * 1.6);
  vec3 bg = mix(vec3(0.024, 0.016, 0.08), vec3(0.10, 0.03, 0.22), neb) * uNebula;
  bg += vec3(0.0, 0.02, 0.03) * fbm(vUv * 6.0 - w) * uNebula;

  // Organism palette ramp on B, morphed by uPalMix (cool → hot).
  vec3 c1 = mix(vec3(0.05, 0.15, 0.45), vec3(0.25, 0.06, 0.30), uPalMix); // body deep
  vec3 c2 = mix(vec3(0.00, 0.76, 0.78), vec3(1.00, 0.31, 0.47), uPalMix); // body main
  vec3 c3 = mix(vec3(0.48, 0.18, 0.97), vec3(1.00, 0.82, 0.40), uPalMix); // rim/hot
  // Regional hue drift so neighbouring colonies differ — kills the monochrome wash.
  vec3 c2b = mix(vec3(0.10, 0.95, 0.55), vec3(1.00, 0.55, 0.20), uPalMix); // alt body (bio-green → amber)
  float hueVar = vnoise(uv * 5.0 + 3.7);
  vec3 bodyCol = mix(c2, c2b, smoothstep(0.3, 0.7, hueVar));
  float body = smoothstep(0.12, 0.35, B);
  float core = smoothstep(0.30, 0.55, B);
  vec3 org = c1 * body + bodyCol * core * (0.7 + 0.5 * diff);
  float edge = length(vec2(bx, by)) * 4.0;
  org += c3 * edge * uGlow;
  org += vec3(1.0, 0.95, 0.85) * spec * core * 0.6;

  float pulse = 1.0 + uBass * uPulse * 0.5;
  vec3 col = bg + org * uGain * pulse;
  col += c3 * uHigh * 0.06 * hash(vUv * 731.0 + uTime); // high-band shimmer grain
  col += rippleGlow * 1.4; // near-white additive glow reads on both dark void acts and dense colony fields

  // Vignette + gentle filmic curve.
  float vig = smoothstep(1.25, 0.35, length(vUv - 0.5) * 1.6);
  col *= vig;
  col = 1.0 - exp(-col * 2.2);
  gl_FragColor = vec4(col, 1.0);
}
`,x=4,q=.4,K=.5,j=.25,$=.08,J=.06,Q=1.5,Z=.03,ee=.65,A=3,te=1.1,E=5e-4,ie=10,g=1.5;class se{renderer;sim;scene;camera;quad;material;rand;stepsPerFrame=14;forcedAct=null;rdOverride=null;bassE=0;highE=0;bassOnset=new Y({refRate:j,relMargin:$,absFloor:J,cooldown:Q});seeds=[];seedUniformValues;seedTimeToNext=0;ripples=[];rippleUniformValues;held=!1;dragDx=0;dragDy=0;velX=0;velY=0;firstUpdate=!0;aspect=16/9;simW=512;simH=512;init(e){const{renderer:i,seed:t,quality:a}=e;this.renderer=i;const s=new URLSearchParams(location.search),r=s.get("regime");if(r!==null){const l=Math.min(v.length-1,Math.max(0,parseInt(r,10)||0));this.forcedAct=v[l]}const o=s.get("rd");if(o){const[l,b]=o.split(",").map(Number);Number.isFinite(l)&&Number.isFinite(b)&&(this.rdOverride={feed:l,kill:b})}const c=s.get("steps");if(c){const l=parseInt(c,10);Number.isFinite(l)&&l>0&&(this.stepsPerFrame=l)}this.stepsPerFrame===14&&(this.stepsPerFrame=a.level==="full"?14:8),this.rand=X(t^2047975617);const n=i.domElement;this.aspect=n.clientWidth>0&&n.clientHeight>0?n.clientWidth/n.clientHeight:16/9;const d=Math.min(2.2,Math.max(1,this.aspect)),h=a.level==="full"?512:256;if(this.simW=Math.round(h*d),this.simH=h,this.aspect<1){const l=this.simW;this.simW=this.simH,this.simH=l}this.sim=new I(i,this.simW,this.simH);for(let l=0;l<x;l++)this.seeds.push({age:0,active:!1,strength:0});this.seedUniformValues=this.sim.uniforms.uSeeds.value;for(let l=0;l<A;l++)this.ripples.push({age:0,active:!1});this.rippleUniformValues=[];for(let l=0;l<A;l++)this.rippleUniformValues.push(new p(0,0,0,0));this.scene=new P,this.camera=new R(-1,1,1,-1,0,1);const F=new D(2,2);this.material=new w({vertexShader:W,fragmentShader:z,depthTest:!1,depthWrite:!1,uniforms:{uField:{value:this.sim.texture},uTexel:{value:new m(1/this.simW,1/this.simH)},uCover:{value:new m(1,1)},uScroll:{value:new m(0,0)},uTime:{value:0},uGain:{value:.5},uPalMix:{value:0},uNebula:{value:.5},uGlow:{value:.5},uBass:{value:0},uHigh:{value:0},uPulse:{value:.3},uRipples:{value:this.rippleUniformValues}}}),this.quad=new N(F,this.material),this.scene.add(this.quad);const U=n.clientWidth||1,B=n.clientHeight||1;this.resize(U,B)}applyActParams(e){const i=this.sim.uniforms;i.uFeed.value=this.rdOverride?this.rdOverride.feed:e.feed,i.uKill.value=this.rdOverride?this.rdOverride.kill:e.kill,i.uDScale.value=e.dScale,i.uAniso.value.set(e.anisoX,e.anisoY),i.uAdvect.value.set(0,0),i.uFeedNoise.value=e.feedNoise;const t=this.material.uniforms;t.uGain.value=e.fieldGain,t.uPalMix.value=e.palMix,t.uNebula.value=e.nebula,t.uGlow.value=e.glow,t.uPulse.value=e.pulse}activateSeed(e,i,t=.006+this.rand()*.012,a=K){let s=this.seeds.findIndex(o=>!o.active);s<0&&(s=0);const r=this.seeds[s];r.active=!0,r.age=0,r.strength=a,this.seedUniformValues[s].set(e,i,t,a)}activateRipple(e,i){let t=this.ripples.findIndex(s=>!s.active);t<0&&(t=0);const a=this.ripples[t];a.active=!0,a.age=0,this.rippleUniformValues[t].set(e,i,0,1)}scheduleSeeds(e,i){const t=Math.max(0,i)/60;if(!(t<=0))for(this.seedTimeToNext-=e;this.seedTimeToNext<=0;){this.activateSeed(this.rand(),this.rand());const a=Math.max(1e-6,this.rand());this.seedTimeToNext+=-Math.log(a)/t}}updateSeedAges(e){for(let i=0;i<this.seeds.length;i++){const t=this.seeds[i];if(!t.active)continue;t.age+=e;const a=Math.min(1,t.age/q),s=t.strength*(1-a);this.seedUniformValues[i].w=s,a>=1&&(t.active=!1,this.seedUniformValues[i].w=0)}}updateRippleAges(e){for(let i=0;i<this.ripples.length;i++){const t=this.ripples[i];t.active&&(t.age+=e,t.age>=te?(t.active=!1,this.rippleUniformValues[i].w=0):this.rippleUniformValues[i].z=t.age)}}warmup(){for(let e=0;e<24;e++){for(let i=0;i<x;i++)this.seedUniformValues[i].set(this.rand(),this.rand(),.004+this.rand()*.01,.35);this.sim.step(8)}for(let e=0;e<x;e++)this.seedUniformValues[e].w=0;this.sim.step(900)}update(e,i){const t=this.forcedAct??k(i.time).params;this.firstUpdate&&(this.firstUpdate=!1,this.applyActParams(t),this.warmup()),this.applyActParams(t),this.sim.uniforms.uNoiseTime.value+=e*.15;const a=this.bassE;this.bassE+=(i.bass-this.bassE)*Math.min(1,e*8),this.highE+=(i.high-this.highE)*Math.min(1,e*8),this.scheduleSeeds(e,t.seedRate),this.bassOnset.update(e,this.bassE,a,t.seedRate)&&this.activateSeed(this.rand(),this.rand()),this.updateSeedAges(e),this.updateRippleAges(e);const s=this.material.uniforms;s.uTime.value+=e,s.uBass.value=this.bassE,s.uHigh.value=this.highE;const r=s.uScroll.value,o=.25*(1+i.mid*.5);r.x+=t.advectX*e*o,r.y+=t.advectY*e*o;const c=s.uCover.value;if(this.held){if(e>1e-5){const n=Math.min(1,e*ie),d=Math.min(g,Math.max(-g,this.dragDx/e)),h=Math.min(g,Math.max(-g,this.dragDy/e));this.velX+=(d-this.velX)*n,this.velY+=(h-this.velY)*n}this.dragDx=0,this.dragDy=0}else if(this.velX!==0||this.velY!==0){r.x+=this.velX*c.x*e,r.y+=this.velY*c.y*e;const n=Math.exp(-2.5*e);this.velX*=n,this.velY*=n,Math.abs(this.velX)<E&&(this.velX=0),Math.abs(this.velY)<E&&(this.velY=0)}}pointer(e){const i=this.material.uniforms,t=i.uCover.value,a=i.uScroll.value;if(e.type==="down"){this.held=!0,this.dragDx=0,this.dragDy=0,this.velX=0,this.velY=0;let s=(e.x-.5)*t.x+.5-a.x,r=(e.y-.5)*t.y+.5-a.y;s-=Math.floor(s),r-=Math.floor(r),this.activateSeed(s,r,Z,ee),this.activateRipple(s,r);return}if(e.type==="move"){if(!this.held)return;a.x+=e.dx*t.x,a.y+=e.dy*t.y,this.dragDx+=e.dx,this.dragDy+=e.dy;return}if(e.type==="up"){this.held=!1;return}this.held=!1,this.velX=0,this.velY=0,this.dragDx=0,this.dragDy=0}render(){this.sim.step(this.stepsPerFrame),this.material.uniforms.uField.value=this.sim.texture,this.renderer.setRenderTarget(null),this.renderer.render(this.scene,this.camera)}resize(e,i){if(!this.material||e<=0||i<=0)return;const t=e/i,a=this.simW/this.simH,s=this.material.uniforms.uCover.value;t>a?s.set(1,a/t):s.set(t/a,1)}dispose(){this.sim.dispose(),this.material.dispose(),this.quad.geometry.dispose(),this.renderer.setRenderTarget(null)}}const ae={default:()=>new se},oe=ae.default;export{oe as default};
//# sourceMappingURL=index--n3qOutz.js.map
