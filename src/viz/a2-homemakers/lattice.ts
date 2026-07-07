import * as THREE from 'three';
import type { QualityState } from '../../quality/QualityManager';
import type { AudioFrame } from '../types';
import type { ActParams, ArcState, SectionState } from './sections';
import { mulberry32 } from '../random';

/**
 * The signature element of "Homemakers": one gently curved wall shared by
 * two species of builder. Hexagonal comb cells (bees) and rectangular rooms
 * (humans) grow from the same lattice, sharing walls — you can't tell where
 * the hive ends and the house begins.
 *
 * Both lattices are a single InstancedBufferGeometry mesh of open tubes
 * (a hex tube and a square tube), rendered unlit/additive with a fresnel-rim
 * glow so cells read as luminous drawn architecture, x-ray style. All
 * placement is precomputed at init from the play seed; construction is a
 * per-instance birth order revealed by the continuous `arcAt` curve, with a
 * short vertex-shader scale-in so cells grow into place rather than pop.
 *
 * Extra registers:
 *  - ghost rooms (uGhost): unbuilt rooms flicker faintly and light up on
 *    flashes — act 2's foreshadow of the climax.
 *  - spectrum shimmer (uSpectrum[16]): each cell watches one band of
 *    audio.frequency and glows with it — the climax register.
 *  - dim (uDim): cells go dark one by one in Lights Out.
 */

const SPECTRUM_BINS = 16;

/** Gentle cylindrical curvature of the wall (radius of the arc). */
const CURVE_RADIUS = 6;

interface CellSpec {
  x: number; y: number; z: number;
  w: number; h: number; depth: number;
  birth: number; seed: number; bin: number;
}

const VERT = /* glsl */ `
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
  uniform float uSpectrum[${SPECTRUM_BINS}];
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
`;

const FRAG = /* glsl */ `
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
`;

/** Open tube base geometry: unit radius, unit depth along Z, oriented so flats face lattice neighbors. */
function tubeGeometry(sides: number, thetaStart: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(1, 1, 1, sides, 1, true, thetaStart);
  g.rotateX(Math.PI / 2);
  return g;
}

function makeMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uBuild: { value: 0 },
      uTime: { value: 0 },
      uBass: { value: 0 },
      uBreath: { value: 0 },
      uGhost: { value: 0 },
      uTrace: { value: 0 },
      uSpectrumAmt: { value: 0 },
      uSpectrum: { value: new Float32Array(SPECTRUM_BINS) },
      uLife: { value: 0 },
      uBrightness: { value: 0.6 },
      uFlash: { value: 0 },
      uHigh: { value: 0 },
      uAccent: { value: 0 },
      uFog: { value: 0.1 },
      uDim: { value: 0 },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
}

function buildInstanced(base: THREE.BufferGeometry, cells: CellSpec[]): THREE.InstancedBufferGeometry {
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute('position', base.getAttribute('position'));
  geo.setAttribute('normal', base.getAttribute('normal'));
  const n = cells.length;
  const offset = new Float32Array(n * 3);
  const size = new Float32Array(n * 2);
  const depth = new Float32Array(n);
  const birth = new Float32Array(n);
  const seed = new Float32Array(n);
  const bin = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const c = cells[i];
    offset[i * 3] = c.x; offset[i * 3 + 1] = c.y; offset[i * 3 + 2] = c.z;
    size[i * 2] = c.w; size[i * 2 + 1] = c.h;
    depth[i] = c.depth;
    birth[i] = c.birth;
    seed[i] = c.seed;
    bin[i] = c.bin;
  }
  geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offset, 3));
  geo.setAttribute('aSize', new THREE.InstancedBufferAttribute(size, 2));
  geo.setAttribute('aDepth', new THREE.InstancedBufferAttribute(depth, 1));
  geo.setAttribute('aBirth', new THREE.InstancedBufferAttribute(birth, 1));
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 1));
  geo.setAttribute('aBin', new THREE.InstancedBufferAttribute(bin, 1));
  geo.instanceCount = n;
  return geo;
}

/** cheap seeded 2D value-ish noise for wall silhouette + relief */
function noise2(x: number, y: number, shift: number): number {
  const s = Math.sin(x * 1.7 + shift) * Math.cos(y * 2.3 + shift * 1.3)
          + Math.sin(x * 3.9 + y * 2.9 + shift * 2.1) * 0.5;
  return s * 0.333 + 0.5; // ~0..1
}

export class Lattice {
  readonly group = new THREE.Group();
  /** Hex circumradius — movers reuse it to build a matching cell mesh. */
  readonly hexRadius: number;
  readonly hexDepth: number;

  private hexMat: THREE.ShaderMaterial;
  private roomMat: THREE.ShaderMaterial;
  private hexGeo: THREE.InstancedBufferGeometry;
  private roomGeo: THREE.InstancedBufferGeometry;
  private baseHex: THREE.BufferGeometry;
  private baseRoom: THREE.BufferGeometry;
  private macroGeo: THREE.InstancedBufferGeometry;
  private macroMat: THREE.ShaderMaterial;

  /** Hex cells sorted by birth — for sampling built cells (movers). */
  private hexBirths: Float32Array;
  private hexCenters: Float32Array;
  private hexBuild = 0;
  private traceLevel = 0;

  constructor(seed: number, quality: QualityState) {
    const rand = mulberry32(seed ^ 0x6a09e667);
    const full = quality.level === 'full';
    const S = full ? 0.062 : 0.1;        // hex circumradius
    const spacing = Math.sqrt(3) * S;    // neighbor distance
    const shift = rand() * 100;

    // --- room clusters on a coarse grid (rowhouses among the comb) ---
    const G = spacing * 3;
    const rooms: CellSpec[] = [];
    const rects: { x0: number; x1: number; y0: number; y1: number }[] = [];
    const nClusters = full ? 5 : 4;
    for (let c = 0; c < nClusters; c++) {
      const cx = (rand() * 2 - 1) * 1.5;
      const cy = (rand() * 2 - 1) * 0.9;
      const stories = rand() < 0.45 ? 2 : 1;
      const run = 2 + Math.floor(rand() * 3);
      const h = G * (0.85 + rand() * 0.35);
      let yCursor = cy;
      for (let s = 0; s < stories; s++) {
        let xCursor = cx - run * G * 0.55;
        for (let r = 0; r < run; r++) {
          const w = G * (1.0 + rand() * 0.5);
          const x = xCursor + w / 2;
          const y = yCursor;
          xCursor += w;
          const z = -(x * x) / (2 * CURVE_RADIUS) + (noise2(x, y, shift) - 0.5) * 0.14;
          rooms.push({
            x, y, z,
            // square tube circumradius→half-extent correction (cos 45°)
            w: (w / 2) / Math.SQRT1_2 * 0.97,
            h: (h / 2) / Math.SQRT1_2 * 0.97,
            depth: 0.3 + rand() * 0.15,
            birth: (c + 0.15 + r / run * 0.6 + s * 0.25) / nClusters,
            seed: rand(),
            bin: Math.floor(rand() * SPECTRUM_BINS),
          });
          rects.push({ x0: x - w / 2, x1: x + w / 2, y0: y - h / 2, y1: y + h / 2 });
        }
        yCursor += h;
      }
    }

    // --- the macro comb: the wall is one cell of a vastly larger lattice ---
    const SM = 2.7;
    const spacingM = Math.sqrt(3) * SM;
    const macros: CellSpec[] = [];
    for (let rr = -2; rr <= 2; rr++) {
      for (let q = -2; q <= 2; q++) {
        const dist = (Math.abs(q) + Math.abs(rr) + Math.abs(q + rr)) / 2;
        if (dist > 2) continue;
        const x = spacingM * (q + rr / 2);
        const y = SM * 1.5 * rr;
        macros.push({
          x, y, z: -0.4 - dist * 0.9 - rand() * 0.5,
          w: SM * 0.94, h: SM * 0.94,
          depth: 1.4 + rand() * 0.4,
          birth: dist === 0 ? 0.05 : dist === 1 ? 0.3 + rand() * 0.2 : 0.6 + rand() * 0.35,
          seed: rand(),
          bin: Math.floor(rand() * SPECTRUM_BINS),
        });
      }
    }

    // --- hex comb across the masked wall, minus room footprints ---
    const extentX = 2.3, extentY = 1.5;
    const margin = S * 0.9;
    const hexes: CellSpec[] = [];
    const qMax = Math.ceil(extentX / spacing) + 4;
    const rMax = Math.ceil(extentY / (S * 1.5)) + 4;
    for (let rr = -rMax; rr <= rMax; rr++) {
      for (let q = -qMax; q <= qMax; q++) {
        const x = spacing * (q + rr / 2);
        const y = S * 1.5 * rr;
        // organic silhouette: ellipse eaten into by noise
        const e = (x / extentX) ** 2 + (y / extentY) ** 2 + (noise2(x, y, shift) - 0.5) * 0.5;
        if (e > 1) continue;
        // carve room footprints out of the comb
        let inRoom = false;
        for (const rc of rects) {
          if (x > rc.x0 - margin && x < rc.x1 + margin && y > rc.y0 - margin && y < rc.y1 + margin) {
            inRoom = true;
            break;
          }
        }
        if (inRoom) continue;
        const z = -(x * x) / (2 * CURVE_RADIUS) + (noise2(x * 2.1, y * 2.1, shift + 7) - 0.5) * 0.16;
        hexes.push({
          x, y, z,
          w: S * 0.94, h: S * 0.94,
          depth: 0.2 + rand() * 0.12,
          birth: 0, // assigned below from growth seeds
          seed: rand(),
          bin: Math.floor(rand() * SPECTRUM_BINS),
        });
      }
    }

    // growth order: distance from a few seed cells (lower half), jittered
    const seedPts: { x: number; y: number }[] = [];
    for (let i = 0; i < 3; i++) {
      seedPts.push({ x: (rand() * 2 - 1) * 0.9, y: -0.1 - rand() * 0.6 });
    }
    let maxD = 0;
    for (const cell of hexes) {
      let d = Infinity;
      for (const sp of seedPts) d = Math.min(d, Math.hypot(cell.x - sp.x, cell.y - sp.y));
      cell.birth = d + rand() * 0.35;
      maxD = Math.max(maxD, cell.birth);
    }
    for (const cell of hexes) cell.birth /= maxD;
    hexes.sort((a, b) => a.birth - b.birth);

    this.hexBirths = new Float32Array(hexes.length);
    this.hexCenters = new Float32Array(hexes.length * 3);
    for (let i = 0; i < hexes.length; i++) {
      this.hexBirths[i] = hexes[i].birth;
      this.hexCenters[i * 3] = hexes[i].x;
      this.hexCenters[i * 3 + 1] = hexes[i].y;
      this.hexCenters[i * 3 + 2] = hexes[i].z;
    }

    this.hexRadius = S;
    this.hexDepth = 0.24;

    // pointy-top hexes: flats face the six lattice neighbors
    this.baseHex = tubeGeometry(6, (2 * Math.PI) / 3);
    this.baseRoom = tubeGeometry(4, (3 * Math.PI) / 4);
    this.hexGeo = buildInstanced(this.baseHex, hexes);
    this.roomGeo = buildInstanced(this.baseRoom, rooms);
    this.hexMat = makeMaterial();
    this.roomMat = makeMaterial();

    const hexMesh = new THREE.Mesh(this.hexGeo, this.hexMat);
    const roomMesh = new THREE.Mesh(this.roomGeo, this.roomMat);
    hexMesh.frustumCulled = false;
    roomMesh.frustumCulled = false;
    this.group.add(hexMesh, roomMesh);

    this.macroGeo = buildInstanced(this.baseHex, macros);
    this.macroMat = makeMaterial();
    const macroMesh = new THREE.Mesh(this.macroGeo, this.macroMat);
    macroMesh.frustumCulled = false;
    this.group.add(macroMesh);
  }

  /** Random built hex cell center in world space. False if nothing is built yet. */
  sampleBuiltCell(rand: () => number, out: THREE.Vector3): boolean {
    // binary search: count of cells with birth <= hexBuild
    let lo = 0, hi = this.hexBirths.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.hexBirths[mid] <= this.hexBuild) lo = mid + 1;
      else hi = mid;
    }
    if (lo < 8) return false;
    const i = Math.floor(rand() * lo);
    out.set(this.hexCenters[i * 3], this.hexCenters[i * 3 + 1], this.hexCenters[i * 3 + 2]);
    return true;
  }

  update(
    dt: number,
    audio: AudioFrame,
    section: SectionState,
    arc: ArcState,
    flash: number,
    spectrum: Float32Array,
  ) {
    const p: ActParams = section.params;
    this.hexBuild = arc.hexBuild;
    // ghost blips leave residue: the longer the foreshadow has run, the
    // firmer the blueprint traces (persistent within a play)
    this.traceLevel = Math.min(1, this.traceLevel + dt * p.roomGhost * 0.03);
    this.apply(this.hexMat, p, audio, flash, spectrum, arc.hexBuild, 0, 0, arc.dim, dt, p.life);
    this.apply(this.roomMat, p, audio, flash, spectrum, arc.roomBuild, p.roomGhost, this.traceLevel, arc.dim, dt, p.life);

    // macro comb: faint, accretes outward with the climax reveal
    this.apply(this.macroMat, p, audio, flash, spectrum, arc.macro, 0, 0, arc.dim, dt, p.life * 0.4);
    this.macroMat.uniforms.uBrightness.value = p.latticeBrightness * 0.3;
    this.macroMat.uniforms.uAccent.value = 0;
    this.macroMat.uniforms.uSpectrumAmt.value = p.spectrum * 0.3;
    // once the swarm moves in, the rooms glow warm from inside
    this.roomMat.uniforms.uAccent.value = Math.min(1, p.accent * (1 + arc.settle * 1.5));
    this.roomMat.uniforms.uBrightness.value = p.latticeBrightness * (1 + arc.settle * 0.25);
  }

  private apply(
    mat: THREE.ShaderMaterial,
    p: ActParams,
    audio: AudioFrame,
    flash: number,
    spectrum: Float32Array,
    build: number,
    ghost: number,
    trace: number,
    dim: number,
    dt: number,
    life: number,
  ) {
    const u = mat.uniforms;
    u.uBuild.value = build;
    u.uTime.value += dt;
    u.uBass.value = audio.bass;
    u.uBreath.value = p.breath;
    u.uGhost.value = ghost;
    u.uTrace.value = trace;
    u.uSpectrumAmt.value = p.spectrum;
    (u.uSpectrum.value as Float32Array).set(spectrum);
    u.uLife.value = life;
    u.uBrightness.value = p.latticeBrightness;
    u.uFlash.value = flash;
    u.uHigh.value = audio.high;
    u.uAccent.value = p.accent;
    u.uFog.value = p.fog;
    u.uDim.value = dim;
  }

  dispose() {
    this.hexGeo.dispose();
    this.roomGeo.dispose();
    this.baseHex.dispose();
    this.baseRoom.dispose();
    this.hexMat.dispose();
    this.roomMat.dispose();
    this.macroGeo.dispose();
    this.macroMat.dispose();
  }
}
