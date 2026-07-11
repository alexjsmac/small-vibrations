import{B as fe,f as q,e as U,A as W,h as pe,G as se,M as J,n as ve,I as we,o as R,p as de,C as H,g as y,k as be}from"./three-x2hcUJYx.js";import{m as Y}from"./random-DL1jLgMw.js";class ye{constructor(s,t,e){this.renderer=e;const a=Y(s),i=Math.min(t.particleBudget,t.level==="full"?22e3:1e4),r=new Float32Array(i*3),o=new Float32Array(i);for(let n=0;n<i;n++)r[n*3+0]=(a()*2-1)*3.2,r[n*3+1]=(a()*2-1)*2,r[n*3+2]=(a()*2-1)*2.4,o[n]=a();this.geometry=new fe,this.geometry.setAttribute("position",new q(r,3)),this.geometry.setAttribute("aSeed",new q(o,1)),this.uniforms={uFlowTime:{value:0},uTurbulence:{value:.7},uFlowAmount:{value:1.1},uSwarm:{value:0},uSettle:{value:0},uDensity:{value:1},uBrightness:{value:.6},uHigh:{value:0},uBass:{value:0},uScale:{value:540},uSeedShift:{value:a()*100},uFlash:{value:0},uAccent:{value:0},uFog:{value:.1}},this.material=new U({uniforms:this.uniforms,transparent:!0,depthWrite:!1,blending:W,vertexShader:`
        uniform float uFlowTime;
        uniform float uTurbulence;
        uniform float uFlowAmount;
        uniform float uSwarm;
        uniform float uSettle;
        uniform float uDensity;
        uniform float uBass;
        uniform float uScale;
        uniform float uSeedShift;
        attribute float aSeed;
        varying float vVisible;
        varying float vSparkle;
        varying float vDist;

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

          // swarm: circulate around the structure like returning foragers
          float phase = aSeed * 6.2831853;
          float rho = 1.3 + aSeed * 1.5;
          float ang = phase + uFlowTime * (0.25 + aSeed * 0.35);
          vec3 orbitPos = vec3(
            cos(ang) * rho,
            sin(phase * 3.1 + uFlowTime * 0.6) * (0.5 + aSeed * 0.7),
            sin(ang) * rho * 0.75
          );
          // fine fast jitter — wings, not orbits
          orbitPos += curl(orbitPos * 3.0 + uFlowTime * 4.0) * 0.05;
          vec3 finalPos = mix(flowPos, orbitPos, uSwarm);

          // moving in: once the home is finished the swarm settles onto it
          vec3 settlePos = vec3(orbitPos.x * 0.5, orbitPos.y * 0.5, 0.18 + sin(phase * 5.0) * 0.12);
          finalPos = mix(finalPos, settlePos, uSettle * (0.4 + 0.6 * aSeed));

          vVisible = 1.0 - step(uDensity, aSeed);
          vSparkle = aSeed;

          vec4 mv = modelViewMatrix * vec4(finalPos, 1.0);
          vDist = -mv.z;
          float size = (0.012 + aSeed * 0.022) * (1.0 + uBass * 0.7);
          gl_PointSize = size * uScale / max(0.1, -mv.z);
          gl_Position = projectionMatrix * mv;
        }
      `,fragmentShader:`
        uniform float uBrightness;
        uniform float uHigh;
        uniform float uFlash;
        uniform float uAccent;
        uniform float uFog;
        varying float vVisible;
        varying float vSparkle;
        varying float vDist;

        void main() {
          if (vVisible < 0.5) discard;
          float d = length(gl_PointCoord - 0.5);
          float falloff = smoothstep(0.5, 0.08, d);
          float brightness = clamp(uBrightness + uHigh * 0.5 + vSparkle * 0.15 + uFlash * 0.5, 0.0, 1.5);
          vec3 dim = vec3(0.624, 0.847, 0.784);   // #9fd8c8
          vec3 hot = vec3(0.925, 0.894, 0.812);   // #ece4cf
          vec3 col = mix(dim, hot, clamp(brightness, 0.0, 1.0));
          float warm = step(0.82, fract(vSparkle * 7.13)) * uAccent;
          col = mix(col, vec3(0.769, 0.302, 0.227), warm); // #c44d3a
          float alpha = falloff * clamp(brightness, 0.1, 1.0) * 0.65;
          alpha *= exp(-max(0.0, vDist - 1.2) * uFog);
          gl_FragColor = vec4(col, alpha);
        }
      `}),this.object=new pe(this.geometry,this.material),this.object.frustumCulled=!1}object;material;geometry;uniforms;update(s,t,e,a,i=0){const r=e.params,o=this.uniforms;o.uFlowTime.value+=s*r.flowSpeed,o.uTurbulence.value=r.turbulence,o.uFlowAmount.value=.9+r.turbulence*.5,o.uSwarm.value=r.swarm,o.uSettle.value=a.settle,o.uDensity.value=r.dustDensity,o.uBrightness.value=r.dustBrightness,o.uHigh.value=t.high,o.uBass.value=t.bass,o.uFlash.value=i,o.uAccent.value=r.accent,o.uFog.value=r.fog,o.uScale.value=this.renderer.domElement.height*.5}dispose(){this.geometry.dispose(),this.material.dispose()}}const V=16,ce=6,xe=`
  attribute vec3 aOffset;
  attribute vec2 aSize;
  attribute float aDepth;
  attribute float aBirth;
  attribute float aSeed;
  attribute float aBin;
  uniform float uBuild;
  uniform float uTime;
  uniform float uBass;
  uniform float uBreath;
  uniform float uGhost;
  uniform float uTrace;
  uniform float uSpectrumAmt;
  uniform float uSpectrum[${V}];
  uniform float uLife;
  varying vec3 vNormal;
  varying vec3 vViewDir;
  varying float vSeed;
  varying float vShimmer;
  varying float vDist;
  varying float vBuilt;
  varying float vGhostBase;
  varying float vGate;
  varying float vBirth;
  varying float vTrace;
  varying vec3 vTraceCol;
  varying float vPulse;

  void main() {
    float since = uBuild - aBirth;
    float built = step(0.0, since);
    // grow into place over a slice of the build curve (~a couple seconds)
    float grow = smoothstep(0.0, 0.035, since);
    grow = 1.0 - (1.0 - grow) * (1.0 - grow); // ease-out
    float scl = mix(1.0, grow, built);
    vShimmer = uSpectrum[int(aBin)] * uSpectrumAmt;
    // each cell breathes on its own rhythm — the hive is alive
    vPulse = uLife * (0.5 + 0.5 * sin(uTime * (0.5 + aSeed * 0.9) + aSeed * 6.2831853));
    scl *= 1.0 + uBass * uBreath * 0.06 * (0.6 + 0.4 * sin(aSeed * 6.2831853))
               + vPulse * 0.10
               + vShimmer * uLife * 0.12;

    vec3 p = position * vec3(aSize * scl, aDepth);
    vec3 world = p + aOffset;

    // ghost flicker gate: sparse time-hashed blips per cell
    float gate = fract(sin(floor(uTime * 7.0) + aSeed * 78.233) * 43758.5453);
    vGate = step(0.93, gate);
    vGhostBase = (1.0 - built) * uGhost;
    // blueprint residue: unbuilt rooms accumulate a faint persistent trace,
    // firming up as their construction moment approaches
    vTrace = (1.0 - built) * uTrace * (0.3 + 0.7 * fract(aSeed * 3.77))
           * smoothstep(-0.45, -0.02, since);
    float pick = fract(aSeed * 9.31);
    vTraceCol = pick < 0.45 ? vec3(0.624, 0.847, 0.784)   // dim cyan
              : pick < 0.8  ? vec3(0.35, 0.62, 0.66)      // pale teal
              :               vec3(0.769, 0.302, 0.227);  // rust (rare)
    vBuilt = built;
    vSeed = aSeed;
    vBirth = aBirth;

    vec4 mv = modelViewMatrix * vec4(world, 1.0);
    vDist = -mv.z;
    vNormal = normalize(normalMatrix * normal);
    vViewDir = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`,Me=`
  uniform float uBrightness;
  uniform float uFlash;
  uniform float uHigh;
  uniform float uAccent;
  uniform float uFog;
  uniform float uDim;
  varying vec3 vNormal;
  varying vec3 vViewDir;
  varying float vSeed;
  varying float vShimmer;
  varying float vDist;
  varying float vBuilt;
  varying float vGhostBase;
  varying float vGate;
  varying float vBirth;
  varying float vTrace;
  varying vec3 vTraceCol;
  varying float vPulse;

  void main() {
    // walls glow strongest at glancing angles — drawn/x-ray architecture
    float rim = pow(1.0 - abs(dot(normalize(vNormal), normalize(vViewDir))), 1.4);
    // Lights Out in reverse construction order — the first-built seed cells
    // are the last windows to go dark (loop closure with the intro)
    float dieAt = clamp(1.0 - vBirth * 0.95 + (fract(vSeed * 13.7) - 0.5) * 0.15, 0.0, 1.0);
    float alive = 1.0 - step(dieAt, uDim);
    float b = uBrightness * (0.55 + 0.45 * fract(vSeed * 5.1))
            + vShimmer * 0.5 + uFlash * 0.35 + uHigh * 0.15;
    b += vPulse * 0.25;
    b *= alive;
    vec3 teal = vec3(0.122, 0.365, 0.478);   // #1f5d7a
    vec3 cream = vec3(0.925, 0.894, 0.812);  // #ece4cf
    vec3 col = mix(teal, cream, pow(clamp(b, 0.0, 1.0), 1.6));
    // living cells cycle toward the sleeve's dim cyan as they pulse
    col = mix(col, vec3(0.624, 0.847, 0.784), vPulse * 0.35 * vBuilt);
    // a seeded subset of cells carries the rust accent, scaled per act
    float warm = step(0.86, fract(vSeed * 7.13)) * uAccent;
    col = mix(col, vec3(0.769, 0.302, 0.227), warm); // #c44d3a

    // blueprint residue tints the unbuilt room its own palette colour
    col = mix(col, vTraceCol, (1.0 - vBuilt) * min(vTrace, 1.0) * 0.85);
    // ghosts: unbuilt rooms flicker faintly and surge on flashes, paler
    float ghost = vGhostBase * (0.55 * vGate + 0.7 * uFlash);
    col = mix(col, cream, ghost * 0.5);

    float alpha = rim * (clamp(b, 0.0, 1.2) * 0.55 * vBuilt + ghost + vTrace * 0.35);
    // manual depth haze (mystery register for Inside the House)
    alpha *= exp(-max(0.0, vDist - 1.2) * uFog);
    if (alpha < 0.004) discard;
    gl_FragColor = vec4(col, alpha);
  }
`;function ue(f,s){const t=new ve(1,1,1,f,1,!0,s);return t.rotateX(Math.PI/2),t}function $(){return new U({uniforms:{uBuild:{value:0},uTime:{value:0},uBass:{value:0},uBreath:{value:0},uGhost:{value:0},uTrace:{value:0},uSpectrumAmt:{value:0},uSpectrum:{value:new Float32Array(V)},uLife:{value:0},uBrightness:{value:.6},uFlash:{value:0},uHigh:{value:0},uAccent:{value:0},uFog:{value:.1},uDim:{value:0}},vertexShader:xe,fragmentShader:Me,transparent:!0,depthWrite:!1,side:de,blending:W})}function K(f,s){const t=new we;t.index=f.index,t.setAttribute("position",f.getAttribute("position")),t.setAttribute("normal",f.getAttribute("normal"));const e=s.length,a=new Float32Array(e*3),i=new Float32Array(e*2),r=new Float32Array(e),o=new Float32Array(e),n=new Float32Array(e),m=new Float32Array(e);for(let c=0;c<e;c++){const v=s[c];a[c*3]=v.x,a[c*3+1]=v.y,a[c*3+2]=v.z,i[c*2]=v.w,i[c*2+1]=v.h,r[c]=v.depth,o[c]=v.birth,n[c]=v.seed,m[c]=v.bin}return t.setAttribute("aOffset",new R(a,3)),t.setAttribute("aSize",new R(i,2)),t.setAttribute("aDepth",new R(r,1)),t.setAttribute("aBirth",new R(o,1)),t.setAttribute("aSeed",new R(n,1)),t.setAttribute("aBin",new R(m,1)),t.instanceCount=e,t}function Z(f,s,t){return(Math.sin(f*1.7+t)*Math.cos(s*2.3+t*1.3)+Math.sin(f*3.9+s*2.9+t*2.1)*.5)*.333+.5}class Se{group=new se;hexRadius;hexDepth;hexMat;roomMat;hexGeo;roomGeo;baseHex;baseRoom;macroGeo;macroMat;hexBirths;hexCenters;hexBuild=0;traceLevel=0;constructor(s,t){const e=Y(s^1779033703),a=t.level==="full",i=a?.062:.1,r=Math.sqrt(3)*i,o=e()*100,n=r*3,m=[],c=[],v=a?5:4;for(let l=0;l<v;l++){const g=(e()*2-1)*1.5,d=(e()*2-1)*.9,b=e()<.45?2:1,T=2+Math.floor(e()*3),B=n*(.85+e()*.35);let j=d;for(let M=0;M<b;M++){let he=g-T*n*.55;for(let Q=0;Q<T;Q++){const k=n*(1+e()*.5),F=he+k/2,L=j;he+=k;const ge=-(F*F)/(2*ce)+(Z(F,L,o)-.5)*.14;m.push({x:F,y:L,z:ge,w:k/2/Math.SQRT1_2*.97,h:B/2/Math.SQRT1_2*.97,depth:.3+e()*.15,birth:(l+.15+Q/T*.6+M*.25)/v,seed:e(),bin:Math.floor(e()*V)}),c.push({x0:F-k/2,x1:F+k/2,y0:L-B/2,y1:L+B/2})}j+=B}}const u=2.7,x=Math.sqrt(3)*u,h=[];for(let l=-2;l<=2;l++)for(let g=-2;g<=2;g++){const d=(Math.abs(g)+Math.abs(l)+Math.abs(g+l))/2;if(d>2)continue;const b=x*(g+l/2),T=u*1.5*l;h.push({x:b,y:T,z:-.4-d*.9-e()*.5,w:u*.94,h:u*.94,depth:1.4+e()*.4,birth:d===0?.05:d===1?.3+e()*.2:.6+e()*.35,seed:e(),bin:Math.floor(e()*V)})}const p=2.3,C=1.5,D=i*.9,w=[],ae=Math.ceil(p/r)+4,oe=Math.ceil(C/(i*1.5))+4;for(let l=-oe;l<=oe;l++)for(let g=-ae;g<=ae;g++){const d=r*(g+l/2),b=i*1.5*l;if((d/p)**2+(b/C)**2+(Z(d,b,o)-.5)*.5>1)continue;let B=!1;for(const M of c)if(d>M.x0-D&&d<M.x1+D&&b>M.y0-D&&b<M.y1+D){B=!0;break}if(B)continue;const j=-(d*d)/(2*ce)+(Z(d*2.1,b*2.1,o+7)-.5)*.16;w.push({x:d,y:b,z:j,w:i*.94,h:i*.94,depth:.2+e()*.12,birth:0,seed:e(),bin:Math.floor(e()*V)})}const ie=[];for(let l=0;l<3;l++)ie.push({x:(e()*2-1)*.9,y:-.1-e()*.6});let X=0;for(const l of w){let g=1/0;for(const d of ie)g=Math.min(g,Math.hypot(l.x-d.x,l.y-d.y));l.birth=g+e()*.35,X=Math.max(X,l.birth)}for(const l of w)l.birth/=X;w.sort((l,g)=>l.birth-g.birth),this.hexBirths=new Float32Array(w.length),this.hexCenters=new Float32Array(w.length*3);for(let l=0;l<w.length;l++)this.hexBirths[l]=w[l].birth,this.hexCenters[l*3]=w[l].x,this.hexCenters[l*3+1]=w[l].y,this.hexCenters[l*3+2]=w[l].z;this.hexRadius=i,this.hexDepth=.24,this.baseHex=ue(6,2*Math.PI/3),this.baseRoom=ue(4,3*Math.PI/4),this.hexGeo=K(this.baseHex,w),this.roomGeo=K(this.baseRoom,m),this.hexMat=$(),this.roomMat=$();const re=new J(this.hexGeo,this.hexMat),ne=new J(this.roomGeo,this.roomMat);re.frustumCulled=!1,ne.frustumCulled=!1,this.group.add(re,ne),this.macroGeo=K(this.baseHex,h),this.macroMat=$();const le=new J(this.macroGeo,this.macroMat);le.frustumCulled=!1,this.group.add(le)}sampleBuiltCell(s,t){let e=0,a=this.hexBirths.length;for(;e<a;){const r=e+a>>1;this.hexBirths[r]<=this.hexBuild?e=r+1:a=r}if(e<8)return!1;const i=Math.floor(s()*e);return t.set(this.hexCenters[i*3],this.hexCenters[i*3+1],this.hexCenters[i*3+2]),!0}update(s,t,e,a,i,r){const o=e.params;this.hexBuild=a.hexBuild,this.traceLevel=Math.min(1,this.traceLevel+s*o.roomGhost*.03),this.apply(this.hexMat,o,t,i,r,a.hexBuild,0,0,a.dim,s,o.life),this.apply(this.roomMat,o,t,i,r,a.roomBuild,o.roomGhost,this.traceLevel,a.dim,s,o.life),this.apply(this.macroMat,o,t,i,r,a.macro,0,0,a.dim,s,o.life*.4),this.macroMat.uniforms.uBrightness.value=o.latticeBrightness*.3,this.macroMat.uniforms.uAccent.value=0,this.macroMat.uniforms.uSpectrumAmt.value=o.spectrum*.3,this.roomMat.uniforms.uAccent.value=Math.min(1,o.accent*(1+a.settle*1.5)),this.roomMat.uniforms.uBrightness.value=o.latticeBrightness*(1+a.settle*.25)}apply(s,t,e,a,i,r,o,n,m,c,v){const u=s.uniforms;u.uBuild.value=r,u.uTime.value+=c,u.uBass.value=e.bass,u.uBreath.value=t.breath,u.uGhost.value=o,u.uTrace.value=n,u.uSpectrumAmt.value=t.spectrum,u.uSpectrum.value.set(i),u.uLife.value=v,u.uBrightness.value=t.latticeBrightness,u.uFlash.value=a,u.uHigh.value=e.high,u.uAccent.value=t.accent,u.uFog.value=t.fog,u.uDim.value=m}dispose(){this.hexGeo.dispose(),this.roomGeo.dispose(),this.baseHex.dispose(),this.baseRoom.dispose(),this.hexMat.dispose(),this.roomMat.dispose(),this.macroGeo.dispose(),this.macroMat.dispose()}}const Be=7,Ae=8,z=40,Pe=10475720,N=new H(15525071),me=new H(12864826),Ce=new H(Pe),_=new y,S=new y,A=new y,O=new y;class De{group=new se;flash=0;rand;movers=[];geometry;pathways=[];bassAvg=0;highAvg=0;flashCooldown=0;moverCooldown=0;pathCooldown=0;constructor(s,t){this.rand=Y(s^2654435769);const e=new ve(t.hexRadius*.94,t.hexRadius*.94,t.hexDepth,6,1,!0,2*Math.PI/3);e.rotateX(Math.PI/2),this.geometry=e;for(let a=0;a<Be;a++){const i=new U({transparent:!0,depthWrite:!1,side:de,blending:W,uniforms:{uFade:{value:0},uColor:{value:N.clone()}},vertexShader:`
          varying vec3 vNormal;
          varying vec3 vViewDir;
          void main() {
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            vNormal = normalize(normalMatrix * normal);
            vViewDir = normalize(-mv.xyz);
            gl_Position = projectionMatrix * mv;
          }
        `,fragmentShader:`
          uniform float uFade;
          uniform vec3 uColor;
          varying vec3 vNormal;
          varying vec3 vViewDir;
          void main() {
            float rim = pow(1.0 - abs(dot(normalize(vNormal), normalize(vViewDir))), 1.2);
            gl_FragColor = vec4(uColor, (0.1 + rim * 0.75) * uFade);
          }
        `}),r=new J(this.geometry,i);r.visible=!1,r.frustumCulled=!1,this.group.add(r),this.movers.push({mesh:r,material:i,from:new y,to:new y,age:-1,dur:1.6,lift:.5,wobble:0})}for(let a=0;a<Ae;a++){const i=new fe;i.setAttribute("position",new q(new Float32Array(z*3),3));const r=new Float32Array(z);for(let m=0;m<z;m++)r[m]=m/(z-1);i.setAttribute("aT",new q(r,1));const o=new U({transparent:!0,depthWrite:!1,blending:W,uniforms:{uProgress:{value:0},uFade:{value:0},uColor:{value:N.clone()}},vertexShader:`
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
        `}),n=new se;for(const m of[[0,0,0],[.014,.011,0],[-.012,-.009,.012]]){const c=new be(i,o);c.position.set(m[0],m[1],m[2]),c.frustumCulled=!1,n.add(c)}n.visible=!1,this.group.add(n),this.pathways.push({holder:n,geometry:i,material:o,age:-1,life:.9})}}impulse(s){this.flash=Math.max(this.flash,s)}update(s,t,e,a,i=!1,r=.5){const o=e.params,n=Math.min(1,s/2);this.bassAvg+=(t.bass-this.bassAvg)*n,this.highAvg+=(t.high-this.highAvg)*n,this.flashCooldown-=s,this.moverCooldown-=s,this.pathCooldown-=s,this.flash*=Math.exp(-s*6);const m=t.bass>this.bassAvg+.12&&t.bass>.2,c=this.rand()<o.flashRate/60*s;if((m||c||i)&&this.flashCooldown<=0&&o.flashRate>0){const h=m?Math.min(1.2,.5+(t.bass-this.bassAvg)*3):(.4+this.rand()*.4)*(.7+.5*r);this.flash=Math.max(this.flash,h),this.flashCooldown=i?1.2:.5}const v=t.high>this.highAvg+.1&&t.high>.15,u=this.rand()<o.moverRate/60*s;(v||u||i)&&this.moverCooldown<=0&&o.moverRate>0&&(this.spawnMove(a,o.accent),this.moverCooldown=i?.6:.4);const x=this.rand()<o.pathRate/60*s;(v||x||i)&&this.pathCooldown<=0&&o.pathRate>0&&(this.spawnPathway(a,o.accent),this.pathCooldown=i?.5:.25);for(const h of this.pathways){if(h.age<0)continue;h.age+=s;const p=Math.min(1,h.age/.22),C=1-Math.max(0,(h.age-.3)/(h.life-.3));h.material.uniforms.uProgress.value=p,h.material.uniforms.uFade.value=Math.max(0,C),h.age>=h.life&&(h.age=-1,h.holder.visible=!1)}for(const h of this.movers){if(h.age<0)continue;h.age+=s;const p=Math.min(1,h.age/h.dur),C=ee(.18,.82,p);h.mesh.position.lerpVectors(h.from,h.to,C),h.mesh.position.z+=Math.sin(Math.PI*p)*h.lift,h.mesh.rotation.z=Math.sin(p*Math.PI*2)*h.wobble,h.mesh.rotation.x=Math.sin(p*Math.PI)*h.wobble*.6;const D=ee(0,.12,p)*(1-ee(.88,1,p));h.material.uniforms.uFade.value=D,p>=1&&(h.age=-1,h.mesh.visible=!1,this.flash=Math.max(this.flash,.25))}}spawnMove(s,t){const e=this.movers.find(a=>a.age<0);if(e&&s.sampleBuiltCell(this.rand,e.from)){for(let a=0;a<4;a++){if(!s.sampleBuiltCell(this.rand,_))return;if(_.distanceToSquared(e.from)>.16)break}e.to.copy(_),e.age=0,e.dur=1.4+this.rand()*.9,e.lift=.4+this.rand()*.25,e.wobble=.15+this.rand()*.2,e.material.uniforms.uColor.value.copy(this.rand()<t?me:N),e.mesh.visible=!0}}spawnPathway(s,t){const e=this.pathways.find(r=>r.age<0);if(!e||!s.sampleBuiltCell(this.rand,S))return;for(let r=0;r<4;r++){if(!s.sampleBuiltCell(this.rand,_))return;if(_.distanceToSquared(S)>.09)break}A.copy(_),O.set((S.x+A.x)*.5+(this.rand()-.5)*.5,(S.y+A.y)*.5+(this.rand()-.5)*.5,(S.z+A.z)*.5+.5+this.rand()*.5);const a=e.geometry.getAttribute("position");for(let r=0;r<z;r++){const o=r/(z-1),n=1-o,m=n*n*S.x+2*n*o*O.x+o*o*A.x,c=n*n*S.y+2*n*o*O.y+o*o*A.y,v=n*n*S.z+2*n*o*O.z+o*o*A.z;a.setXYZ(r,m,c,v)}a.needsUpdate=!0;const i=this.rand();e.material.uniforms.uColor.value.copy(i<t?me:i<t+.5?N:Ce),e.life=.9+this.rand()*.8,e.age=0,e.holder.visible=!0}dispose(){this.geometry.dispose();for(const s of this.movers)s.material.dispose();this.movers=[];for(const s of this.pathways)s.geometry.dispose(),s.material.dispose();this.pathways=[]}}function ee(f,s,t){const e=Math.min(1,Math.max(0,(t-f)/(s-f)));return e*e*(3-2*e)}const I=[0,54,101,132,188,252,267,294.124],E=[{name:"groundbreaking",dustDensity:.25,flowSpeed:.4,turbulence:.7,dustBrightness:.5,swarm:.1,roomGhost:0,latticeBrightness:.55,spectrum:0,breath:.25,moverRate:.5,flashRate:1.5,life:.15,pathRate:.5,accent:.02,fog:.1,camDist:4.6,camDrift:.25,camHeight:.2,camJourney:0},{name:"raising-the-frame",dustDensity:.45,flowSpeed:.9,turbulence:1,dustBrightness:.5,swarm:.25,roomGhost:.85,latticeBrightness:.65,spectrum:.15,breath:.5,moverRate:1,flashRate:8,life:.5,pathRate:4,accent:.08,fog:.08,camDist:3.6,camDrift:.5,camHeight:.3,camJourney:0},{name:"settling-in",dustDensity:.35,flowSpeed:.45,turbulence:.7,dustBrightness:.55,swarm:.2,roomGhost:.15,latticeBrightness:.6,spectrum:0,breath:.3,moverRate:2,flashRate:2,life:.35,pathRate:2,accent:.06,fog:.14,camDist:2.4,camDrift:.3,camHeight:.1,camJourney:0},{name:"inside-the-house",dustDensity:.35,flowSpeed:.3,turbulence:.5,dustBrightness:.45,swarm:.15,roomGhost:.25,latticeBrightness:.5,spectrum:.1,breath:.25,moverRate:10,flashRate:3,life:.45,pathRate:6,accent:.1,fog:.3,camDist:1.05,camDrift:.18,camHeight:0,camJourney:1},{name:"two-homes-one-wall",dustDensity:.8,flowSpeed:1.1,turbulence:.9,dustBrightness:.7,swarm:.85,roomGhost:0,latticeBrightness:.8,spectrum:1,breath:.7,moverRate:4,flashRate:9,life:1,pathRate:16,accent:.3,fog:.05,camDist:4.3,camDrift:.6,camHeight:.5,camJourney:0},{name:"housewarming",dustDensity:.45,flowSpeed:.5,turbulence:.6,dustBrightness:.7,swarm:.5,roomGhost:0,latticeBrightness:.75,spectrum:.4,breath:.4,moverRate:1.5,flashRate:3,life:.8,pathRate:9,accent:.22,fog:.08,camDist:3.2,camDrift:.3,camHeight:.3,camJourney:0},{name:"lights-out",dustDensity:.15,flowSpeed:.25,turbulence:.5,dustBrightness:.3,swarm:.1,roomGhost:0,latticeBrightness:.5,spectrum:0,breath:.15,moverRate:0,flashRate:.3,life:.08,pathRate:0,accent:.08,fog:.2,camDist:4.4,camDrift:.06,camHeight:.15,camJourney:0}],G=[[0,.05,0,0,0,0,.15],[53.8,.24,0,0,0,0,.4],[54.3,.3,0,0,0,0,.75],[95,.58,0,0,0,0,.7],[101,.6,0,0,0,0,.35],[132,.6,0,0,0,0,.3],[150,.63,.12,0,0,0,.35],[187.8,.7,.38,0,0,0,.5],[188.4,.78,.5,0,.1,0,1],[215,.93,.85,0,1,0,1],[225,1,1,0,1,0,.95],[248,1,1,0,1,.9,.85],[252,1,1,0,1,.95,.7],[267,1,1,0,1,1,.4],[290,1,1,.97,1,1,.08],[294.124,1,1,1,1,1,0]],P={hexBuild:0,roomBuild:0,dim:0,macro:0,settle:0,energy:0};function Te(f){const s=Math.min(Math.max(f,0),G[G.length-1][0]);let t=0;for(;t<G.length-2&&s>=G[t+1][0];)t++;const e=G[t],a=G[t+1],i=Math.min(1,Math.max(0,(s-e[0])/Math.max(.001,a[0]-e[0])));return P.hexBuild=e[1]+(a[1]-e[1])*i,P.roomBuild=e[2]+(a[2]-e[2])*i,P.dim=e[3]+(a[3]-e[3])*i,P.macro=e[4]+(a[4]-e[4])*i,P.settle=e[5]+(a[5]-e[5])*i,P.energy=e[6]+(a[6]-e[6])*i,P}const Fe=6;function Re(f){const s=Math.min(1,Math.max(0,f));return s*s*(3-2*s)}function ze(f,s,t){if(t<=0)return f;if(t>=1)return s;const e={...f,name:t<.5?f.name:s.name};for(const a of Object.keys(f)){const i=f[a],r=s[a];typeof i=="number"&&typeof r=="number"&&(e[a]=i+(r-i)*t)}return e}function _e(f){const s=I[I.length-1],t=Math.min(Math.max(f,0),s-.001);let e=0;for(;e<E.length-1&&t>=I[e+1];)e++;const a=I[e],i=I[e+1]??s,r=Math.min(1,Math.max(0,(t-a)/Math.max(.001,i-a))),o=e<E.length-1,n=i-t,m=o?Re(1-Math.min(1,n/Fe)):0,c=E[e],v=o?E[e+1]:c;return{params:ze(c,v,m),actIndex:e,localT:r,blend:m}}const te=16;class Ge{lattice;dust;movers;camera;camPhase=0;camSeedA=0;camSeedB=0;bgBase=new H(332828);bgFlash=new H(1192515);forceMovers=!1;sceneRef;spectrum=new Float32Array(te);lastT=-1;bgWarm=new H(926768);_pos=new y;_tgt=new y;_jPos=new y;_jTgt=new y;async init(s){const{scene:t,camera:e,renderer:a,seed:i,quality:r}=s;t.fog=null,this.camera=e;const o=new URLSearchParams(location.search),n=o.get("solo");this.forceMovers=o.get("movers")==="always",n&&this.bgBase.setHex(2055546),t.background=this.bgBase.clone();const m=Y(i^1013904242);this.camSeedA=m()*Math.PI*2,this.camSeedB=m()*Math.PI*2,this.lattice=new Se(i,r),(!n||n==="lattice")&&t.add(this.lattice.group),this.dust=new ye(i,r,a),(!n||n==="dust")&&t.add(this.dust.object),this.movers=new De(i,this.lattice),(!n||n==="movers")&&t.add(this.movers.group),this.sceneRef=t}update(s,t){const e=_e(t.time),a=Te(t.time);this.lastT>=0&&t.time-this.lastT<.5&&(this.lastT<54&&t.time>=54&&this.movers.impulse(.9),this.lastT<188&&t.time>=188&&this.movers.impulse(1.2)),this.lastT=t.time;const i=Math.min(1,s*8),r=Math.max(1,Math.floor(t.frequency.length/te));for(let u=0;u<te;u++){let x=0;for(let h=0;h<r;h++)x+=t.frequency[u*r+h]??0;this.spectrum[u]+=(x/r-this.spectrum[u])*i}this.movers.update(s,t,e,this.lattice,this.forceMovers,a.energy);const o=this.movers.flash;this.lattice.update(s,t,e,a,o,this.spectrum),this.dust.update(s,t,e,a,o),this.sceneRef.background.copy(this.bgBase).lerp(this.bgWarm,a.energy*.6).lerp(this.bgFlash,Math.min(1,o));const n=e.params;this.camPhase+=s*(.04+n.camDrift*.07+a.energy*.035+t.mid*.012);const m=Math.min(1,n.camDrift*2.5),c=Math.sin(this.camPhase*.5+this.camSeedA)*.45,v=n.camDist*(1+Math.sin(this.camPhase*.23+this.camSeedB)*.08*m);if(this._pos.set(Math.sin(c)*v,n.camHeight+Math.sin(this.camPhase*.31+this.camSeedB)*.3*m,Math.cos(c)*v),this._tgt.set(Math.sin(this.camPhase*.17+this.camSeedB)*.25,Math.sin(this.camPhase*.11+this.camSeedA)*.15,0),n.camJourney>.001){const u=Math.sin(this.camPhase*.22+this.camSeedA)*1.4,x=Math.cos(this.camPhase*.22+this.camSeedA);this._jPos.set(u,n.camHeight+Math.sin(this.camPhase*.13+this.camSeedB)*.2,n.camDist),this._jTgt.set(u+x*1.3,0,-.3),this._pos.lerp(this._jPos,n.camJourney),this._tgt.lerp(this._jTgt,n.camJourney)}this.camera.position.copy(this._pos),this.camera.lookAt(this._tgt)}resize(s,t){}dispose(){this.lattice.dispose(),this.dust.dispose(),this.movers.dispose(),this.camera.position.set(0,0,4),this.camera.lookAt(0,0,0)}}const He={default:()=>new Ge},Ve=He.default;export{Ve as default};
//# sourceMappingURL=index-6eS4r-Vh.js.map
