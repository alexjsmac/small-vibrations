import{C as e,D as t,S as n,a as r,d as i,g as a,i as o,p as s,s as c,u as l}from"./three-BrpLoc7e.js";var u=class{group;mesh;points;uniforms;disposables=[];async init(u){let{scene:f,seed:p,quality:m}=u,h=d(p),g=h()*.2-.1;f.background=new c(1328734),f.fog=new l(664112,4,12),this.group=new i,f.add(this.group);let _=new s(1.2,4);this.disposables.push(_),this.uniforms={uTime:{value:0}};let v=new t({uniforms:{...this.uniforms,uCream:{value:new c(15525071)},uTeal:{value:new c(2055546).offsetHSL(g,0,0)},uSeed:{value:h()*100}},vertexShader:`
        uniform float uTime;
        uniform float uSeed;
        varying vec3 vNormal;
        varying float vNoise;

        // hash & noise
        float hash(vec3 p) {
          p = fract(p * 0.3183099 + uSeed);
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

        void main() {
          vec3 p = position;
          float n = noise(p * 1.6 + uTime * 0.15);
          p += normal * (n - 0.5) * 0.35;
          vNormal = normalize(normalMatrix * normal);
          vNoise = n;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }
      `,fragmentShader:`
        uniform vec3 uCream;
        uniform vec3 uTeal;
        varying vec3 vNormal;
        varying float vNoise;

        void main() {
          float l = clamp(dot(vNormal, normalize(vec3(0.4, 0.7, 0.6))) * 0.5 + 0.5, 0.0, 1.0);
          // duotone halftone-ish shading
          float band = smoothstep(0.35, 0.65, l + (vNoise - 0.5) * 0.5);
          vec3 col = mix(uTeal, uCream, band);
          gl_FragColor = vec4(col, 1.0);
        }
      `});this.disposables.push(v),this.mesh=new a(_,v),this.group.add(this.mesh);let y=Math.min(m.particleBudget,m.level===`full`?12e3:2e3),b=new Float32Array(y*3);for(let e=0;e<y;e++){let t=1.6+h()*1.6,n=h()*Math.PI*2,r=Math.acos(2*h()-1);b[e*3+0]=t*Math.sin(r)*Math.cos(n),b[e*3+1]=t*Math.sin(r)*Math.sin(n),b[e*3+2]=t*Math.cos(r)}let x=new r;x.setAttribute(`position`,new o(b,3)),this.disposables.push(x);let S=new e({color:15525071,size:.015,transparent:!0,opacity:.7,depthWrite:!1});this.disposables.push(S),this.points=new n(x,S),this.group.add(this.points)}update(e,t){this.uniforms.uTime.value+=e;let n=1+t.bass*.4;this.mesh.scale.setScalar(n),this.group.rotation.y+=e*(.15+t.mid*.6),this.group.rotation.x+=e*.05,this.points.rotation.y-=e*.08}resize(e,t){}dispose(){for(let e of this.disposables)e.dispose();this.disposables=[]}};function d(e){return function(){let t=e+=1831565813;return t=Math.imul(t^t>>>15,t|1),t^=t+Math.imul(t^t>>>7,t|61),((t^t>>>14)>>>0)/4294967296}}var f={default:()=>new u}.default;export{f as default};
//# sourceMappingURL=placeholder-IQClbS14.js.map