import{D as e,S as t,_ as n,a as r,c as i,d as a,i as o,k as s,m as c,r as l,s as u,t as d}from"./three-BrpLoc7e.js";import{t as f}from"./random-gG32nY7D.js";var p=class{renderer;object;material;geometry;attractors;uniforms;constructor(n,i,a){this.renderer=a;let c=f(n),l=Math.min(i.particleBudget,i.level===`full`?35e3:2e4),u=new Float32Array(l*3),d=new Float32Array(l),p=new Float32Array(l);for(let e=0;e<l;e++){let t=c()**.5*5.5,n=c()*Math.PI*2;u[e*3+0]=Math.cos(n)*t,u[e*3+1]=(c()*2-1)*1.6,u[e*3+2]=Math.sin(n)*t,d[e]=c(),p[e]=Math.floor(c()*4)}this.geometry=new r,this.geometry.setAttribute(`position`,new o(u,3)),this.geometry.setAttribute(`aSeed`,new o(d,1)),this.geometry.setAttribute(`aAttractor`,new o(p,1)),this.attractors=Array.from({length:4},()=>new s),this.uniforms={uFlowTime:{value:0},uMarchTime:{value:0},uTurbulence:{value:.8},uFlowAmount:{value:1.2},uCondensation:{value:0},uMarchDrift:{value:0},uDensity:{value:1},uBrightness:{value:.7},uHigh:{value:0},uBass:{value:0},uScale:{value:540},uAttractors:{value:this.attractors},uSeedShift:{value:c()*100},uFlash:{value:0},uAccent:{value:0}},this.material=new e({uniforms:this.uniforms,transparent:!0,depthWrite:!1,blending:2,vertexShader:`
        uniform float uFlowTime;
        uniform float uMarchTime;
        uniform float uTurbulence;
        uniform float uFlowAmount;
        uniform float uCondensation;
        uniform float uMarchDrift;
        uniform float uDensity;
        uniform float uBass;
        uniform float uScale;
        uniform float uSeedShift;
        uniform vec3 uAttractors[4];
        attribute float aSeed;
        attribute float aAttractor;
        varying float vVisible;
        varying float vSparkle;

        // hash & value noise (same family as the shared placeholder shader)
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
        // vec3-valued noise via channel offsets
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
          // free flow: base position advected by curl noise
          vec3 noiseP = position * uTurbulence + aSeed * 10.0 + uFlowTime;
          vec3 flowPos = position + curl(noiseP) * uFlowAmount * 0.35;

          // condensation: orbit this particle's assigned attractor
          vec3 attractor = uAttractors[int(aAttractor + 0.5)];
          float phase = aSeed * 6.2831853;
          float orbitR = aSeed * 0.4 + 0.15;
          vec3 orbit = vec3(
            cos(phase + uFlowTime * 0.5),
            sin(phase + uFlowTime * 0.62) * 0.6,
            sin(phase + uFlowTime * 0.53)
          ) * orbitR;
          vec3 condensed = mix(flowPos, attractor + orbit, uCondensation);

          // marching: directional stream along +x, wrapped to loop through frame
          float bound = 5.5;
          float marchX = mod(position.x + uMarchTime + aSeed * 4.0 + bound, bound * 2.0) - bound;
          vec3 marched = vec3(marchX, condensed.y, condensed.z);
          vec3 finalPos = mix(condensed, marched, uMarchDrift);

          vVisible = 1.0 - step(uDensity, aSeed);
          vSparkle = aSeed;

          vec4 mv = modelViewMatrix * vec4(finalPos, 1.0);
          float size = (0.013 + aSeed * 0.024) * (1.0 + uBass * 0.7);
          gl_PointSize = size * uScale / max(0.1, -mv.z);
          gl_Position = projectionMatrix * mv;
        }
      `,fragmentShader:`
        uniform float uBrightness;
        uniform float uHigh;
        uniform float uFlash;
        uniform float uAccent;
        varying float vVisible;
        varying float vSparkle;

        void main() {
          if (vVisible < 0.5) discard;
          // soft round falloff — additive glow dots, not hard squares
          float d = length(gl_PointCoord - 0.5);
          float falloff = smoothstep(0.5, 0.08, d);
          float brightness = clamp(uBrightness + uHigh * 0.5 + vSparkle * 0.15 + uFlash * 0.5, 0.0, 1.5);
          vec3 dim = vec3(0.624, 0.847, 0.784);   // #9fd8c8
          vec3 hot = vec3(0.925, 0.894, 0.812);   // #ece4cf
          vec3 col = mix(dim, hot, clamp(brightness, 0.0, 1.0));
          // a seeded subset of particles carries the rust accent, scaled per act
          float warm = step(0.82, fract(vSparkle * 7.13)) * uAccent;
          col = mix(col, vec3(0.769, 0.302, 0.227), warm); // #c44d3a
          gl_FragColor = vec4(col, falloff * clamp(brightness, 0.1, 1.0) * 0.72);
        }
      `}),this.object=new t(this.geometry,this.material),this.object.frustumCulled=!1}setAttractors(e){for(let t=0;t<4;t++){let n=e[t]??e[e.length-1];n&&this.attractors[t].copy(n)}}update(e,t,n,r=0){let i=n.params,a=this.uniforms;a.uFlowTime.value+=e*i.flowSpeed,a.uMarchTime.value+=e*1.3,a.uTurbulence.value=i.turbulence,a.uFlowAmount.value=.9+i.turbulence*.5,a.uCondensation.value=i.condensation,a.uMarchDrift.value=i.marchDrift,a.uDensity.value=i.dustDensity,a.uBrightness.value=i.dustBrightness,a.uHigh.value=t.high,a.uBass.value=t.bass,a.uFlash.value=r,a.uAccent.value=i.accent,a.uScale.value=this.renderer.domElement.height*.5}dispose(){this.geometry.dispose(),this.material.dispose()}},m=14,h=3;function g(e){return Array.from({length:m},(t,n)=>({cluster:n%h,phase:e(),radius:.08+e()*.1}))}var _=new s,v=new s;function y(e,t,n){let r=e/h*Math.PI*2,i=.22*t;return n.set(.5+Math.cos(r)*i,.5+Math.sin(r)*i*.6,.5+Math.sin(r*1.3)*i)}function b(e,t,n,r,i){e.x=t,e.y=n,e.z=r,e.strength=i}function x(e,t,n,r,i,a){let o=1+a*.5;for(let a=0;a<n.length;a++){let s=n[a],c=e[a],l=s.phase*Math.PI*2+i*(.3+s.phase*.2);switch(v.set(Math.cos(l),Math.sin(l*1.3)*.6,Math.sin(l)).multiplyScalar(s.radius),t){case 0:case 1:b(c,.5,.5,.5,0);break;case 2:{if(a>=6){b(c,.5,.5,.5,0);break}let e=Math.max(0,Math.sin(i*(1.5+s.phase*2)+s.phase*20)),t=s.phase*Math.PI*2;b(c,.5+Math.cos(t)*.3,.5+(s.phase-.5)*.4,.5+Math.sin(t)*.3,e>.6?.5*o:0);break}case 3:{if(a>=10){b(c,.5,.5,.5,0);break}let e=1-r*.6;y(s.cluster,e,_).add(v),b(c,_.x,_.y,_.z,(.35+r*.35)*o);break}case 4:{y(s.cluster,.4,_);let e=.2+a/m*.6;_.x+=(.5+v.x*.4-_.x)*r,_.y+=(e-_.y)*r,_.z+=(.5+v.z*.4-_.z)*r,b(c,_.x,_.y,_.z,.65*o);break}case 5:{let e=.9;b(c,((.5+a*.06+i*.12)%e+e)%e,.5+v.y*.5,.5+v.z*.5,.8*o);break}case 6:{if(a>=10){b(c,.5,.5,.5,0);break}let e=.4+r*1.4;y(s.cluster,e,_).add(v),b(c,_.x,_.y,_.z,Math.max(0,.6*(1-r))*o);break}default:b(c,.5,.5,.5,0)}}return e}function S(e,t,n){if(n<=0)return e;for(let r=0;r<e.length;r++)e[r].x+=(t[r].x-e[r].x)*n,e[r].y+=(t[r].y-e[r].y)*n,e[r].z+=(t[r].z-e[r].z)*n,e[r].strength+=(t[r].strength-e[r].strength)*n;return e}var C=class{object;material;baseEmissive;accentEmissive=new u(12864826);seeds;clock=0;worldScale=1.5;frameBalls=Array.from({length:m},()=>({x:.5,y:.5,z:.5,strength:0}));nextBalls=Array.from({length:m},()=>({x:.5,y:.5,z:.5,strength:0}));attractorPool=[];constructor(e,t){let r=f(e^2654435769);this.seeds=g(r);let i=t.level===`full`?48:28,a=r()*.15-.075;this.baseEmissive=new u(2055546).offsetHSL(a,0,-.15),this.material=new n({color:new u(15525071),emissive:this.baseEmissive.clone(),roughness:.45,metalness:.05}),this.object=new d(i,this.material,!1,!1,65e3),this.object.isolation=60,this.object.scale.setScalar(this.worldScale)}getAttractorWorldPositions(e){for(;this.attractorPool.length<e;)this.attractorPool.push(new s);let t=this.frameBalls.filter(e=>e.strength>.01).sort((e,t)=>t.strength-e.strength),n=t.length>0?t:this.frameBalls,r=[];for(let t=0;t<e;t++){let e=n[t%n.length];r.push(this.attractorPool[t].set((e.x-.5)*2*this.worldScale,(e.y-.5)*2*this.worldScale,(e.z-.5)*2*this.worldScale))}return r}update(e,t,n,r=0){this.clock+=e;let i=Math.min(1,n.params.accent*(.5+r));if(this.material.emissive.copy(this.baseEmissive).lerp(this.accentEmissive,i),this.material.emissiveIntensity=.6+r*1.6,x(this.frameBalls,n.actIndex,this.seeds,n.localT,this.clock,t.bass),n.blend>0){let e=Math.min(n.actIndex+1,6);x(this.nextBalls,e,this.seeds,0,this.clock,t.bass),S(this.frameBalls,this.nextBalls,n.blend)}this.object.reset();for(let e of this.frameBalls)e.strength<=.001||this.object.addBall(e.x,e.y,e.z,e.strength,12);this.object.update()}dispose(){this.object.geometry.dispose(),this.material.dispose()}},w=7,T=40,E=new u(15525071),D=new u(12864826),O=new s,k=new s,A=new s,j=new s,M=new s,N=new s(0,1,0),P=class{group=new a;flash=0;rand;filaments=[];bassAvg=0;highAvg=0;flashCooldown=0;filamentCooldown=0;constructor(t){this.rand=f(t^799322567);for(let t=0;t<w;t++){let t=new r;t.setAttribute(`position`,new o(new Float32Array(120),3));let n=new Float32Array(T);for(let e=0;e<T;e++)n[e]=e/39;t.setAttribute(`aT`,new o(n,1));let i=new e({transparent:!0,depthWrite:!1,blending:2,uniforms:{uProgress:{value:0},uFade:{value:0},uColor:{value:E.clone()}},vertexShader:`
          attribute float aT;
          varying float vT;
          void main() {
            vT = aT;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,fragmentShader:`
          uniform float uProgress;
          uniform float uFade;
          uniform vec3 uColor;
          varying float vT;
          void main() {
            if (vT > uProgress) discard;
            // bright head where the line is currently being drawn
            float head = smoothstep(uProgress - 0.18, uProgress, vT);
            gl_FragColor = vec4(uColor * (0.7 + head * 0.5), uFade * (0.6 + 0.4 * head));
          }
        `}),s=new a;for(let e of[[0,0,0],[.014,.011,0],[-.012,-.009,.012]]){let n=new c(t,i);n.position.set(e[0],e[1],e[2]),n.frustumCulled=!1,s.add(n)}s.visible=!1,this.group.add(s),this.filaments.push({holder:s,geometry:t,material:i,age:-1,life:.8})}}update(e,t,n,r,i=!1){let a=n.params,o=Math.min(1,e/2);this.bassAvg+=(t.bass-this.bassAvg)*o,this.highAvg+=(t.high-this.highAvg)*o,this.flashCooldown-=e,this.filamentCooldown-=e,this.flash*=Math.exp(-e*6);let s=t.bass>this.bassAvg+.12&&t.bass>.2,c=this.rand()<a.flashRate/60*e;if((s||c||i)&&this.flashCooldown<=0&&a.flashRate>0){let e=s?Math.min(1.2,.5+(t.bass-this.bassAvg)*3):.4+this.rand()*.4;this.flash=Math.max(this.flash,e),this.flashCooldown=i?1.2:.5}let l=t.high>this.highAvg+.1&&t.high>.15,u=this.rand()<a.filamentRate/60*e;(l||u||i)&&this.filamentCooldown<=0&&a.filamentRate>0&&(this.spawnFilament(r,a.accent),this.filamentCooldown=i?.35:.25);for(let t of this.filaments){if(t.age<0)continue;t.age+=e;let n=Math.min(1,t.age/.16),r=1-Math.max(0,(t.age-.26)/(t.life-.26));t.material.uniforms.uProgress.value=n,t.material.uniforms.uFade.value=Math.max(0,r),t.age>=t.life&&(t.age=-1,t.holder.visible=!1)}}spawnFilament(e,t){let n=this.filaments.find(e=>e.age<0);if(!n)return;if(e.reduce((e,t)=>Math.max(e,t.length()),0)>.3&&e.length>=2){let t=Math.floor(this.rand()*e.length),n=Math.floor(this.rand()*e.length);n===t&&(n=(n+1)%e.length),O.copy(e[t]),k.copy(e[n]),O.addScaledVector(F(this.rand,j),.7+this.rand()*.9),k.addScaledVector(F(this.rand,j),.7+this.rand()*.9)}else F(this.rand,O).multiplyScalar(.8+this.rand()*1.8),F(this.rand,k).multiplyScalar(.8+this.rand()*1.8);A.subVectors(k,O);let r=A.length();j.crossVectors(A,N).normalize(),j.lengthSq()<.5&&j.set(1,0,0),M.crossVectors(A,j).normalize();let i=Math.max(.22,r*.24),a=n.geometry.getAttribute(`position`);for(let e=0;e<T;e++){let t=e/39,n=Math.sin(Math.PI*t)*i,r=(this.rand()-.5)*.5+Math.sin(t*Math.PI*2+this.rand()*6)*.5,o=(this.rand()-.5)*.7;a.setXYZ(e,O.x+A.x*t+(j.x*r+M.x*o)*n,O.y+A.y*t+(j.y*r+M.y*o)*n,O.z+A.z*t+(j.z*r+M.z*o)*n)}a.needsUpdate=!0,n.material.uniforms.uColor.value.copy(this.rand()<t?D:E),n.life=.55+this.rand()*.7,n.age=0,n.holder.visible=!0,this.flash=Math.max(this.flash,.25)}dispose(){for(let e of this.filaments)e.geometry.dispose(),e.material.dispose();this.filaments=[]}};function F(e,t){let n=e()*Math.PI*2,r=e()*2-1,i=Math.sqrt(Math.max(0,1-r*r));return t.set(Math.cos(n)*i,r,Math.sin(n)*i)}var I=[0,16,64,100,180,200,248,286.439],L=[{name:`void`,dustDensity:.12,flowSpeed:.25,turbulence:.6,condensation:0,marchDrift:0,dustBrightness:.35,blobPresence:0,blobStrength:0,cameraDrift:.15,skinPattern:0,flashRate:.5,filamentRate:.5,accent:0},{name:`stirring`,dustDensity:1,flowSpeed:.6,turbulence:.8,condensation:.15,marchDrift:0,dustBrightness:.75,blobPresence:0,blobStrength:0,cameraDrift:.3,skinPattern:0,flashRate:2,filamentRate:2,accent:.05},{name:`fragments`,dustDensity:.85,flowSpeed:1.1,turbulence:1.4,condensation:.35,marchDrift:0,dustBrightness:.85,blobPresence:.5,blobStrength:.35,cameraDrift:.45,skinPattern:0,flashRate:10,filamentRate:8,accent:.15},{name:`condensation`,dustDensity:.8,flowSpeed:.55,turbulence:.7,condensation:.7,marchDrift:0,dustBrightness:.85,blobPresence:1,blobStrength:.55,cameraDrift:.3,skinPattern:.15,flashRate:4,filamentRate:6,accent:.2},{name:`shift`,dustDensity:.6,flowSpeed:.9,turbulence:.9,condensation:.8,marchDrift:.25,dustBrightness:.8,blobPresence:1,blobStrength:.75,cameraDrift:.55,skinPattern:.4,flashRate:6,filamentRate:8,accent:.3},{name:`the-march`,dustDensity:1,flowSpeed:1.2,turbulence:.75,condensation:.5,marchDrift:1,dustBrightness:1,blobPresence:1,blobStrength:.9,cameraDrift:.7,skinPattern:1,flashRate:8,filamentRate:10,accent:.45},{name:`dissolve`,dustDensity:.5,flowSpeed:.4,turbulence:.6,condensation:.1,marchDrift:0,dustBrightness:.4,blobPresence:0,blobStrength:0,cameraDrift:.2,skinPattern:.2,flashRate:1,filamentRate:2,accent:.1}],R=6;function z(e){let t=Math.min(1,Math.max(0,e));return t*t*(3-2*t)}function B(e,t,n){if(n<=0)return e;if(n>=1)return t;let r={...e,name:n<.5?e.name:t.name};for(let i of Object.keys(e)){let a=e[i],o=t[i];typeof a==`number`&&typeof o==`number`&&(r[i]=a+(o-a)*n)}return r}function V(e){let t=I[I.length-1],n=Math.min(Math.max(e,0),t-.001),r=0;for(;r<L.length-1&&n>=I[r+1];)r++;let i=I[r],a=I[r+1]??t,o=Math.min(1,Math.max(0,(n-i)/Math.max(.001,a-i))),s=r<L.length-1,c=a-n,l=s?z(1-Math.min(1,c/R)):0,u=L[r];return{params:B(u,s?L[r+1]:u,l),actIndex:r,localT:o,blend:l}}var H=class{dust;blobs;sparks;camera;lights=[];camPhase=0;camSeedA=0;camSeedB=0;bgBase=new u(332828);bgFlash=new u(1192515);forceSparks=!1;sceneRef;async init(e){let{scene:t,camera:n,renderer:r,seed:a,quality:o}=e;t.fog=null,this.camera=n;let s=new URLSearchParams(location.search),c=s.get(`solo`);this.forceSparks=s.get(`sparks`)===`always`,c&&this.bgBase.setHex(2055546),t.background=this.bgBase.clone();let u=f(a^1374496523);this.camSeedA=u()*Math.PI*2,this.camSeedB=u()*Math.PI*2,this.dust=new p(a,o,r),(!c||c===`dust`)&&t.add(this.dust.object),this.blobs=new C(a,o),(!c||c===`blobs`)&&t.add(this.blobs.object),this.sparks=new P(a),(!c||c===`sparks`)&&t.add(this.sparks.group),this.sceneRef=t;let d=new i(15525071,2.2);d.position.set(2,3,2.5);let m=new i(2055546,1.2);m.position.set(-2,-1.5,-2);let h=new l(1328734,1.4);this.lights=[d,m,h],t.add(d,m,h)}update(e,t){let n=V(t.time),r=this.blobs.getAttractorWorldPositions(4);this.sparks.update(e,t,n,r,this.forceSparks);let i=this.sparks.flash;this.blobs.update(e,t,n,i),this.dust.setAttractors(r),this.dust.update(e,t,n,i),this.sceneRef.background.copy(this.bgBase).lerp(this.bgFlash,Math.min(1,i)),this.camPhase+=e*(.02+n.params.cameraDrift*.055+t.mid*.01);let a=4+Math.sin(this.camPhase*.7+this.camSeedA)*.6;this.camera.position.set(Math.sin(this.camPhase+this.camSeedA)*a,Math.sin(this.camPhase*.43+this.camSeedB)*.9,Math.cos(this.camPhase+this.camSeedA)*a),this.camera.lookAt(0,0,0)}resize(e,t){}dispose(){this.dust.dispose(),this.blobs.dispose(),this.sparks.dispose();for(let e of this.lights)e.dispose();this.lights=[],this.camera.position.set(0,0,4),this.camera.lookAt(0,0,0)}},U={default:()=>new H}.default;export{U as default};
//# sourceMappingURL=a1-they-come-marching-u6vY5TcB.js.map