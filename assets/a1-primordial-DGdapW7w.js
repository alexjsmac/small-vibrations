import{A as e,D as t,E as n,O as r,T as i,f as a,g as o,h as s,j as c,w as l,x as u,y as d}from"./three-BrpLoc7e.js";import{t as f}from"./random-gG32nY7D.js";import{t as p}from"./onset-BQ22vJ7j.js";var m=`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`,h=`
precision highp float;
void main() {
  gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0);
}
`,g=`
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
`,_=class{uniforms;renderer;targets;readIndex=0;scene;camera;quad;simMaterial;initMaterial;constructor(f,p,_){this.renderer=f;let v={type:a,format:l,minFilter:s,magFilter:s,wrapS:i,wrapT:i,depthBuffer:!1,stencilBuffer:!1};this.targets=[new c(p,_,v),new c(p,_,v)],this.uniforms={uPrev:{value:null},uTexel:{value:new r(1/p,1/_)},uFeed:{value:.03},uKill:{value:.0665},uDScale:{value:1},uFeedNoise:{value:.1},uNoiseTime:{value:0},uAniso:{value:new r(1,1)},uAdvect:{value:new r(0,0)},uSeeds:{value:[new e(0,0,.02,0),new e(0,0,.02,0),new e(0,0,.02,0),new e(0,0,.02,0)]}},this.scene=new n,this.camera=new d(-1,1,1,-1,0,1);let y=new u(2,2);this.simMaterial=new t({vertexShader:m,fragmentShader:g,uniforms:this.uniforms,depthTest:!1,depthWrite:!1}),this.initMaterial=new t({vertexShader:m,fragmentShader:h,depthTest:!1,depthWrite:!1}),this.quad=new o(y,this.initMaterial),this.scene.add(this.quad);let b=this.renderer.getRenderTarget();for(let e of this.targets)this.renderer.setRenderTarget(e),this.renderer.render(this.scene,this.camera);this.renderer.setRenderTarget(b),this.quad.material=this.simMaterial}step(e){let t=this.renderer.getRenderTarget();for(let t=0;t<e;t++){let e=this.targets[this.readIndex],t=this.targets[1-this.readIndex];this.uniforms.uPrev.value=e.texture,this.renderer.setRenderTarget(t),this.renderer.render(this.scene,this.camera),this.readIndex=1-this.readIndex}this.renderer.setRenderTarget(t??null)}get texture(){return this.targets[this.readIndex].texture}dispose(){this.targets[0].dispose(),this.targets[1].dispose(),this.simMaterial.dispose(),this.initMaterial.dispose(),this.quad.geometry.dispose()}},v=[0,16,64,100,180,200,248,286.439],y=[{name:`void`,feed:.034,kill:.0655,dScale:1,anisoX:1,anisoY:1,advectX:0,advectY:0,seedRate:6,fieldGain:.45,palMix:.05,nebula:.55,glow:.5,pulse:.2,feedNoise:.1},{name:`stirring`,feed:.0367,kill:.0649,dScale:1,anisoX:1,anisoY:1,advectX:0,advectY:0,seedRate:10,fieldGain:.7,palMix:.15,nebula:.45,glow:.7,pulse:.35,feedNoise:.15},{name:`fragments`,feed:.046,kill:.063,dScale:1.05,anisoX:1,anisoY:1,advectX:0,advectY:0,seedRate:14,fieldGain:.8,palMix:.3,nebula:.35,glow:.9,pulse:.5,feedNoise:.35},{name:`condensation`,feed:.0545,kill:.062,dScale:1,anisoX:1,anisoY:1,advectX:0,advectY:0,seedRate:8,fieldGain:.95,palMix:.45,nebula:.3,glow:1,pulse:.45,feedNoise:.2},{name:`shift`,feed:.029,kill:.057,dScale:1,anisoX:1.25,anisoY:.85,advectX:.08,advectY:0,seedRate:6,fieldGain:.9,palMix:.6,nebula:.3,glow:1.1,pulse:.5,feedNoise:.2},{name:`the-march`,feed:.029,kill:.057,dScale:1,anisoX:1.6,anisoY:.7,advectX:.1,advectY:-.01,seedRate:6,fieldGain:1,palMix:.9,nebula:.25,glow:1.3,pulse:.6,feedNoise:.15},{name:`dissolve`,feed:.03,kill:.0658,dScale:1,anisoX:1,anisoY:1,advectX:0,advectY:0,seedRate:2,fieldGain:.5,palMix:.35,nebula:.5,glow:.6,pulse:.25,feedNoise:.1}],b=6;function x(e){let t=Math.min(1,Math.max(0,e));return t*t*(3-2*t)}function S(e,t,n){if(n<=0)return e;if(n>=1)return t;let r={...e,name:n<.5?e.name:t.name};for(let i of Object.keys(e)){let a=e[i],o=t[i];typeof a==`number`&&typeof o==`number`&&(r[i]=a+(o-a)*n)}return r}function C(e){let t=v[v.length-1],n=Math.min(Math.max(e,0),t-.001),r=0;for(;r<y.length-1&&n>=v[r+1];)r++;let i=v[r],a=v[r+1]??t,o=Math.min(1,Math.max(0,(n-i)/Math.max(.001,a-i))),s=r<y.length-1,c=a-n,l=s?x(1-Math.min(1,c/b)):0,u=y[r];return{params:S(u,s?y[r+1]:u,l),actIndex:r,localT:o,blend:l}}var w=`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`,T=`
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
`,E=4,D=.4,O=.5,k=.25,A=.08,j=.06,M=1.5,N=.03,P=.65,F=3,I=1.1,L=5e-4,R=10,z=1.5,B=class{renderer;sim;scene;camera;quad;material;rand;stepsPerFrame=14;forcedAct=null;rdOverride=null;bassE=0;highE=0;bassOnset=new p({refRate:k,relMargin:A,absFloor:j,cooldown:M});seeds=[];seedUniformValues;seedTimeToNext=0;ripples=[];rippleUniformValues;held=!1;dragDx=0;dragDy=0;velX=0;velY=0;firstUpdate=!0;aspect=16/9;simW=512;simH=512;init(i){let{renderer:a,seed:s,quality:c}=i;this.renderer=a;let l=new URLSearchParams(location.search),p=l.get(`regime`);if(p!==null){let e=Math.min(y.length-1,Math.max(0,parseInt(p,10)||0));this.forcedAct=y[e]}let m=l.get(`rd`);if(m){let[e,t]=m.split(`,`).map(Number);Number.isFinite(e)&&Number.isFinite(t)&&(this.rdOverride={feed:e,kill:t})}let h=l.get(`steps`);if(h){let e=parseInt(h,10);Number.isFinite(e)&&e>0&&(this.stepsPerFrame=e)}this.stepsPerFrame===14&&(this.stepsPerFrame=c.level===`full`?14:8),this.rand=f(s^2047975617);let g=a.domElement;this.aspect=g.clientWidth>0&&g.clientHeight>0?g.clientWidth/g.clientHeight:16/9;let v=Math.min(2.2,Math.max(1,this.aspect)),b=c.level===`full`?512:256;if(this.simW=Math.round(b*v),this.simH=b,this.aspect<1){let e=this.simW;this.simW=this.simH,this.simH=e}this.sim=new _(a,this.simW,this.simH);for(let e=0;e<E;e++)this.seeds.push({age:0,active:!1,strength:0});this.seedUniformValues=this.sim.uniforms.uSeeds.value;for(let e=0;e<F;e++)this.ripples.push({age:0,active:!1});this.rippleUniformValues=[];for(let t=0;t<F;t++)this.rippleUniformValues.push(new e(0,0,0,0));this.scene=new n,this.camera=new d(-1,1,1,-1,0,1);let x=new u(2,2);this.material=new t({vertexShader:w,fragmentShader:T,depthTest:!1,depthWrite:!1,uniforms:{uField:{value:this.sim.texture},uTexel:{value:new r(1/this.simW,1/this.simH)},uCover:{value:new r(1,1)},uScroll:{value:new r(0,0)},uTime:{value:0},uGain:{value:.5},uPalMix:{value:0},uNebula:{value:.5},uGlow:{value:.5},uBass:{value:0},uHigh:{value:0},uPulse:{value:.3},uRipples:{value:this.rippleUniformValues}}}),this.quad=new o(x,this.material),this.scene.add(this.quad);let S=g.clientWidth||1,C=g.clientHeight||1;this.resize(S,C)}applyActParams(e){let t=this.sim.uniforms;t.uFeed.value=this.rdOverride?this.rdOverride.feed:e.feed,t.uKill.value=this.rdOverride?this.rdOverride.kill:e.kill,t.uDScale.value=e.dScale,t.uAniso.value.set(e.anisoX,e.anisoY),t.uAdvect.value.set(0,0),t.uFeedNoise.value=e.feedNoise;let n=this.material.uniforms;n.uGain.value=e.fieldGain,n.uPalMix.value=e.palMix,n.uNebula.value=e.nebula,n.uGlow.value=e.glow,n.uPulse.value=e.pulse}activateSeed(e,t,n=.006+this.rand()*.012,r=O){let i=this.seeds.findIndex(e=>!e.active);i<0&&(i=0);let a=this.seeds[i];a.active=!0,a.age=0,a.strength=r,this.seedUniformValues[i].set(e,t,n,r)}activateRipple(e,t){let n=this.ripples.findIndex(e=>!e.active);n<0&&(n=0);let r=this.ripples[n];r.active=!0,r.age=0,this.rippleUniformValues[n].set(e,t,0,1)}scheduleSeeds(e,t){let n=Math.max(0,t)/60;if(!(n<=0))for(this.seedTimeToNext-=e;this.seedTimeToNext<=0;){this.activateSeed(this.rand(),this.rand());let e=Math.max(1e-6,this.rand());this.seedTimeToNext+=-Math.log(e)/n}}updateSeedAges(e){for(let t=0;t<this.seeds.length;t++){let n=this.seeds[t];if(!n.active)continue;n.age+=e;let r=Math.min(1,n.age/D),i=n.strength*(1-r);this.seedUniformValues[t].w=i,r>=1&&(n.active=!1,this.seedUniformValues[t].w=0)}}updateRippleAges(e){for(let t=0;t<this.ripples.length;t++){let n=this.ripples[t];n.active&&(n.age+=e,n.age>=I?(n.active=!1,this.rippleUniformValues[t].w=0):this.rippleUniformValues[t].z=n.age)}}warmup(){for(let e=0;e<24;e++){for(let e=0;e<E;e++)this.seedUniformValues[e].set(this.rand(),this.rand(),.004+this.rand()*.01,.35);this.sim.step(8)}for(let e=0;e<E;e++)this.seedUniformValues[e].w=0;this.sim.step(900)}update(e,t){let n=this.forcedAct??C(t.time).params;this.firstUpdate&&(this.firstUpdate=!1,this.applyActParams(n),this.warmup()),this.applyActParams(n),this.sim.uniforms.uNoiseTime.value+=e*.15;let r=this.bassE;this.bassE+=(t.bass-this.bassE)*Math.min(1,e*8),this.highE+=(t.high-this.highE)*Math.min(1,e*8),this.scheduleSeeds(e,n.seedRate),this.bassOnset.update(e,this.bassE,r,n.seedRate)&&this.activateSeed(this.rand(),this.rand()),this.updateSeedAges(e),this.updateRippleAges(e);let i=this.material.uniforms;i.uTime.value+=e,i.uBass.value=this.bassE,i.uHigh.value=this.highE;let a=i.uScroll.value,o=.25*(1+t.mid*.5);a.x+=n.advectX*e*o,a.y+=n.advectY*e*o;let s=i.uCover.value;if(this.held){if(e>1e-5){let t=Math.min(1,e*R),n=Math.min(z,Math.max(-1.5,this.dragDx/e)),r=Math.min(z,Math.max(-1.5,this.dragDy/e));this.velX+=(n-this.velX)*t,this.velY+=(r-this.velY)*t}this.dragDx=0,this.dragDy=0}else if(this.velX!==0||this.velY!==0){a.x+=this.velX*s.x*e,a.y+=this.velY*s.y*e;let t=Math.exp(-2.5*e);this.velX*=t,this.velY*=t,Math.abs(this.velX)<L&&(this.velX=0),Math.abs(this.velY)<L&&(this.velY=0)}}pointer(e){let t=this.material.uniforms,n=t.uCover.value,r=t.uScroll.value;if(e.type===`down`){this.held=!0,this.dragDx=0,this.dragDy=0,this.velX=0,this.velY=0;let t=(e.x-.5)*n.x+.5-r.x,i=(e.y-.5)*n.y+.5-r.y;t-=Math.floor(t),i-=Math.floor(i),this.activateSeed(t,i,N,P),this.activateRipple(t,i);return}if(e.type===`move`){if(!this.held)return;r.x+=e.dx*n.x,r.y+=e.dy*n.y,this.dragDx+=e.dx,this.dragDy+=e.dy;return}if(e.type===`up`){this.held=!1;return}this.held=!1,this.velX=0,this.velY=0,this.dragDx=0,this.dragDy=0}render(){this.sim.step(this.stepsPerFrame),this.material.uniforms.uField.value=this.sim.texture,this.renderer.setRenderTarget(null),this.renderer.render(this.scene,this.camera)}resize(e,t){if(!this.material||e<=0||t<=0)return;let n=e/t,r=this.simW/this.simH,i=this.material.uniforms.uCover.value;n>r?i.set(1,r/n):i.set(n/r,1)}dispose(){this.sim.dispose(),this.material.dispose(),this.quad.geometry.dispose(),this.renderer.setRenderTarget(null)}},V={default:()=>new B}.default;export{V as default};
//# sourceMappingURL=a1-primordial-DGdapW7w.js.map