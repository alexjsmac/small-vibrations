import{C as l,F as x,G as w,I as y,e as M,M as b,B as S,f as N,o as z,h as T}from"./three-3OWXJ662.js";class C{group;mesh;points;uniforms;disposables=[];async init(e){const{scene:s,seed:a,quality:c}=e,o=P(a),g=o()*.2-.1;s.background=new l(1328734),s.fog=new x(664112,4,12),this.group=new w,s.add(this.group);const p=new y(1.2,4);this.disposables.push(p),this.uniforms={uTime:{value:0}};const f=new M({uniforms:{...this.uniforms,uCream:{value:new l(15525071)},uTeal:{value:new l(2055546).offsetHSL(g,0,0)},uSeed:{value:o()*100}},vertexShader:`
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
      `});this.disposables.push(f),this.mesh=new b(p,f),this.group.add(this.mesh);const m=Math.min(c.particleBudget,c.level==="full"?12e3:2e3),i=new Float32Array(m*3);for(let t=0;t<m;t++){const r=1.6+o()*1.6,d=o()*Math.PI*2,h=Math.acos(2*o()-1);i[t*3+0]=r*Math.sin(h)*Math.cos(d),i[t*3+1]=r*Math.sin(h)*Math.sin(d),i[t*3+2]=r*Math.cos(h)}const n=new S;n.setAttribute("position",new N(i,3)),this.disposables.push(n);const v=new z({color:15525071,size:.015,transparent:!0,opacity:.7,depthWrite:!1});this.disposables.push(v),this.points=new T(n,v),this.group.add(this.points)}update(e,s){this.uniforms.uTime.value+=e;const a=1+s.bass*.4;this.mesh.scale.setScalar(a),this.group.rotation.y+=e*(.15+s.mid*.6),this.group.rotation.x+=e*.05,this.points.rotation.y-=e*.08}resize(e,s){}dispose(){for(const e of this.disposables)e.dispose();this.disposables=[]}}function P(u){return function(){let e=u+=1831565813;return e=Math.imul(e^e>>>15,e|1),e^=e+Math.imul(e^e>>>7,e|61),((e^e>>>14)>>>0)/4294967296}}const B={default:()=>new C},G=B.default;export{G as default};
//# sourceMappingURL=index-CtwiqXMY.js.map
