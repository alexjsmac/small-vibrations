# Small Vibrations — Three.js Audio-Reactive Visual Techniques Catalogue

*A reference for AI coding agents implementing per-track visualizations. Matches the `alexjsmac/small-vibrations` stack: Vite + TypeScript, WebGLRenderer + GLSL only, QualityManager (Full/Lite), VizHost persistent canvas, per-play seed, AudioFrame (bass/mid/high + frequency[64] + onsets + time).*

## TL;DR
- Build every entry on **WebGL2 + GLSL/WebGLRenderer** — the project explicitly abandoned a WebGPU/TSL migration (it produced silent black frames on real hardware with zero errors), so all techniques below are specified WebGL2-safe; WebGPU/TSL-only options are flagged as *do-not-use here* references only.
- The proven house pattern is **stateless GPU particles** (position = pure function of seeded attributes + accumulated time uniforms in the vertex shader — 150k points at 120fps, no FBO/ping-pong needed), plus **staged acts** driven by `audio.time` and a **sporadic events layer** driven by onsets. Prefer these before reaching for heavier machinery.
- Match technique to track arc: a1 emergence = curl-noise particles + MarchingCubes; a2 Homemakers = instanced accretion + hex/L-system growth; a3 Biome Dominoes = Rapier chain-reaction or Verlet spring network; b1 Icky Sticky = iridescent/transmission blobs + reaction-diffusion skins + swarms; b2 Terminal Taxonomy = troika MSDF labels + wireframe/x-ray + rust grading; b3 Sterile Breath = fog + sparse slow particles + near-empty negative space.

## Key Findings

### The project's hard constraints (read first)
- **WebGLRenderer + GLSL only.** The `webgpu-tsl-experiment` branch was built and abandoned. Any catalogue technique that is WebGPU/TSL-only (e.g. `three/webgpu` compute Boids via `@three-blocks/core`, TSL raymarchers) is **out of scope for implementation** — noted only as conceptual reference.
- **Budgets are baked at init per quality level.** VizHost rebuilds the scene on quality change (same seed, same song clock). Read `quality.level` at construction; never mid-frame.
- **Zero per-frame allocations** in choreography code (module-scope scratch vectors, object pools). GC hitches read as dropped beats.
- **`audio.time` is the master clock** (never null — extrapolated from matcher or a fallback clock). It drives act staging, the single most important input.
- **Proven a1 budgets** to anchor new work: dust 20k (Lite) / 150k (Full); MarchingCubes resolution 28 (Lite) / 48 (Full) for ~14 balls; 7 pooled filaments. Palette: cream `#ece4cf`, teal `#1f5d7a`, deep teal `#14465e`, ink `#05141c` (background), dim cyan `#9fd8c8`, rust accent `#c44d3a` (precious — follows the decay arc; in a1 it rises from 0 in the void to 0.45 at The March).
- Bloom: use **WebGL `UnrealBloomPass`** via the optional `Viz.render()` hook, **Full quality only**. Do not re-attempt the TSL bloom path.
- **Module anatomy** (copy this): `index.ts` (composes layers, camera choreography, lights, implements `Viz`), `sections.ts` (measured cue table + per-act parameter keyframes + `paramsAt()` with ~6s crossfade and per-act `localT`), one `<layer>.ts` per visual layer. Dev tools: `?t=140` (seed clock), `?q=full|lite`, `?debug=1` (fps HUD), `?solo=<layer>`, `?<layer>=always` (force sporadic events for screenshots).

---

### 1. GPU particle systems (a1 emergence, b1 swarms)

**Stateless GPU particles (HOUSE DEFAULT — use this first).**
- What it looks like: luminous drifting dust, haze, condensing swarms.
- Approach: `THREE.Points` + custom `ShaderMaterial`. Each particle's position is computed every frame in the **vertex shader** as a pure function of a seeded base attribute + accumulated time uniforms (`uFlowTime += dt * speed` on the CPU so parameter changes glide, not jump). No FBO, no compute, nothing to allocate. Soft round sprites via `gl_PointCoord` radial falloff + additive blending make overlapping dust read as luminous haze.
- Noise: hash-based value noise + **forward-difference curl (4 taps, not 6)** for divergence-free flow. Curl fields look alive; plain gradient fields look like draining water.
- Audio hooks: `audio.bass` + onsets → particle size "breath" and flash lift; `audio.mid` → flow speed; `audio.high` → sparkle.
- Full/Lite: 150k / 20k points is proven. Cap `devicePixelRatio` (≤2 Full, ≤1.5 Lite). Additive blending is cheap; keep the fragment shader trivial.

**GPGPU / FBO ping-pong (GPUComputationRenderer) — heavier fallback.**
- What it looks like: swarms whose motion depends on *previous* state (true integration, trails, mutual influence, morph/condensation targets).
- Approach: `GPUComputationRenderer` (`three/addons/misc/GPUComputationRenderer.js`) stores position/velocity in RGBA float textures with two render targets per variable for ping-pong; a fragment shader per variable computes the next state; textures feed the render material's vertex shader. Curl-noise in the simulation shader gives smoke-like organic flow. Keep texture sizes power-of-two; particle count = width × height.
- When to use over stateless: only when you need **state-dependent** behavior the stateless trick can't express (persistent trails, particle-to-target morphing/condensation into first forms for a1, inter-particle forces). Costs allocation + extra passes.
- Quality/mobile: use **half-float** render targets where supported; drop simulation texture resolution on Lite (e.g. 256² Lite / 512²+ Full). Check float-render-target support; fall back to stateless on failure.
- Sources: Codrops "Crafting a Dreamy Particle Effect with Three.js and GPGPU" (Dominik Fojcik, Dec 2024); Maxime Heckel "The magical world of Particles"; three.js `GPUComputationRenderer` docs; `cabbibo/PhysicsRenderer`.

### 2. Flocking / boids & swarm behavior (a1 march, b1 teeming)
- What it looks like: murmurations, marching columns, teeming crowds.
- **WebGL2-safe approach:** the classic three.js `webgl_gpgpu_birds` example uses `GPUComputationRenderer` to hold bird position/velocity and computes the three Reynolds rules (separation, alignment, cohesion) in fragment shaders — no compute shaders required. This is the pattern to port.
- Cheaper march alternative: for a1's "march," a directed **curl/flow field** biased along a march axis (stateless particles) reads as marching without O(N²) neighbor queries. Prefer this on mobile.
- **Do NOT use here:** `@three-blocks/core` `Boids`, and TSL/WGSL compute boids (`three/webgpu`, `instanceIndex`, `Loop`) — these are WebGPU-only and violate the project's WebGLRenderer constraint. Reference only.
- Audio hooks: onset → predator impulse / scatter; `audio.mid` → flock speed; bass → cohesion swell.
- Full/Lite: cap bird texture resolution; naive O(N²) neighbor search is fine only at low counts — spatial-grid hashing is hard in fragment-shader land, so keep counts modest on Lite.

### 3. Procedural growth & accretion (a2 Homemakers)
- What it looks like: cells, honeycombs, tunnels assembling; geometry accreting piece by piece.
- **Instanced accretion (recommended core for a2):** one `THREE.InstancedMesh` of a cell/comb unit; reveal instances progressively via `setMatrixAt` driven by an act envelope (`localT`) or `audio.frequency[64]` bins (spectrum-shaped growth — an open register the briefing explicitly flags for a2+). A per-instance "birth time" attribute + vertex-shader scale-in (0→1 with an ease) makes pieces *grow* into place rather than pop. `instanceMatrix.needsUpdate = true` after writes. One draw call for thousands of cells.
- **Hex/honeycomb tiling:** generate axial hex coordinates on the CPU; place instances on the lattice; grow outward from seed cells by ring index for the "comb assembling" read.
- **MarchingCubes accretion (organic tunnels/forms):** `three/addons/objects/MarchingCubes.js` (`addBall`, `addPlaneX/Y/Z`). CPU-bound at res³ — proven range res 28 (Lite) / 48 (Full) for ~14 balls; cap `maxPolyCount`. Move balls to accrete/merge organic chambers.
- **Space colonization & L-systems:** space colonization (attractors + nodes, kill distance) grows tunnel/vein networks that fill space organically — better-looking than blind L-system replacement and naturally "aware" of space. Precompute the skeleton on the CPU (seeded), then reveal segments over song time as `TubeGeometry`/instanced segments. `nicknikolov/pex-space-colonization` gives points decoupled from drawing (Runions/Lane/Prusinkiewicz, "Modeling Trees with a Space Colonization Algorithm," 2007). L-systems are simpler but symmetric/less organic.
- Audio hooks: onset → place next accretion batch; `audio.frequency` bins → which cells grow; bass swell → global scale breath.
- Full/Lite: fewer instances + lower MarchingCubes res on Lite; precompute geometry at init (baked per quality).

### 4. Physics cascades & chain reactions (a3 Biome Dominoes)
- What it looks like: chains of elements triggering one another; one falls, others follow.
- **Rapier (recommended) — free rigid-body toppling.** Use `@dimforge/rapier3d-compat` (base64-embedded WASM, `await RAPIER.init()`) to sidestep Vite WASM bundler issues; the non-compat `@dimforge/rapier3d` needs `vite-plugin-wasm` + `vite-plugin-top-level-await`. Renderer-agnostic — works fine under WebGLRenderer. Per-frame: `world.step()`, then for each body read `rigidBody.translation()` (`{x,y,z}`) and `rigidBody.rotation()` (quaternion) into a reusable dummy `Object3D` → `instancedMesh.setMatrixAt(i, dummy.matrix)`; set `instanceMatrix.needsUpdate = true`.
  - **The domino mechanism is Rapier's sleeping/islands system:** bodies that stop moving are marked sleeping and skipped by the pipeline; they wake **automatically** when a non-sleeping body's collider contacts them. So everything sleeps until you push the first domino with `applyImpulse(vec, true)`, and the wake-ups propagate down the chain for free. Skip `setMatrixAt` for `rigidBody.isSleeping()` bodies (and set their meshes' `matrixAutoUpdate=false`).
  - Body-count budget: roughly 500–1000 active dynamic bodies at 60fps on modern desktop; a few hundred on mobile (rule-of-thumb from jobcannon.io, **not** an official Dimforge benchmark). Dimforge's own large numbers are native-Rust CPU tests and will be lower in WASM — e.g. their "Announcing the Rapier physics engine" blog (Aug 25, 2020) describes the KEVA-tower stress test: *"In this benchmark, 5230 rectangular rigid bodies are used to form a tower, much like what can be achieved with real-world KEVA wood planks. During the simulation, the tower breaks down to end up with a large pile."* Total scene count can be much higher since sleeping bodies are near-free. Stack stability depends on velocity iterations — Dimforge notes: *"the tower breaks down because only 4 velocity iterations are used for this simulation. With about 15 velocity iterations, the tower would remain stable when using Rapier."*
- **ConvexObjectBreaker (optional shatter flourish).** `three/addons/misc/ConvexObjectBreaker.js` — fully WebGLRenderer-compatible, engine-independent geometry math. `prepareBreakableObject(object, mass, velocity, angularVelocity, breakable)` then `subdivideByImpact(object, point, normal, maxRadialIterations, maxRandomIterations)` returns an array of debris meshes. Requires convex buffer geometry with planar (non-smoothed) normals. The official `physics_ammo_break` example gates breaking on an impulse threshold (`fractureImpulse = 250`).
- **Authored wave (beat-syncable, not physics-accurate).** For a controllable cascade timed to the music, copy Junichi Kasahara's Codrops "How to Create a Pixel-to-Voxel Video Drop Effect with Three.js and Rapier" (Jan 5, 2026, repo `1kkaku-KJ/Codrops-Pixel-Voxel-Drop`) approach: a distance-from-origin wavefront where `targetVal` per instance = distance from the wave origin to the farthest instance, so the ripple spreads outward and you trigger transitions in time with onsets. This is the closest reputable recent chain-reaction+InstancedMesh tutorial; it flattens box instances in the vertex shader (depth ≈ 0) so they read as tiles, then wakes them into voxels along the wavefront.
- **Verlet spring network (lightweight, no WASM).** If the "chain" is linked/rope-like rather than free colliding bodies, a Verlet points+sticks network is far cheaper, renderer-agnostic, and trivially audio-reactive (perturb a point on a beat; the wave propagates through constraints). `VerletExpressJS` (matthewmain) supports 3D natively (points, spans, skins); constraint-iteration count tunes stiffness. Push positions into `InstancedMesh.setMatrixAt`.
- **Engine choice (2024–2026):** Rapier is the clear recommendation (Rust→WASM, actively maintained by Dimforge, SIMD build, and the sleeping/wake semantics you need). Its `@dimforge/rapier3d-compat` package reports roughly 3.7–3.9M weekly npm downloads. cannon-es is pure-JS/no-WASM-hassle but slower and effectively low-maintenance, fine for low counts. ammo.js is most feature-complete (powers the official break demo) but unmaintained, no npm package, manual memory management. Jolt (`JoltPhysics.js`) is a modern maintained WASM alternative.
- Audio hooks: onset (bass) → topple impulse on the lead element; `audio.time` act → cascade region; high onsets → shatter events.
- Full/Lite: reduce body count on Lite (or fall back to the authored-wave / Verlet approach with no physics engine at all); keep colliders as simple primitives (cuboids) — convex hulls are CPU-expensive.

### 5. Wet / organic / slimy surface rendering (b1 Icky, Sticky, & Thriving)
- What it looks like: dense, wet, swarming, glistening biomass; the album's peak.
- **`MeshPhysicalMaterial` wet look:** `transmission` (glass/wet), `thickness` + `ior` (~1.4 for wet flesh), `sheen`/`sheenColor` (velvet/mucus), `iridescence` + `iridescenceIOR` (~1.3) + `iridescenceThicknessRange` [100,400] for oil-slick/beetle-shell thin-film. Iridescence maps beautifully onto the duotone palette (thin-film hue shifts between the two album colors).
- **Vertex-displacement blobs:** noise-driven vertex displacement on a sphere (custom shader or `three-custom-shader-material` over `MeshPhysicalMaterial` to keep PBR lighting) for pulsing, breathing organic masses. Combine with MarchingCubes (§3/§6) for merging blobs.
- **Reaction-diffusion "skins":** Gray-Scott in a ping-pong FBO (two render targets, several iterations/frame) produces Turing spots/coral/mitosis patterns; sample the concentration texture as an emissive/roughness/color map on b1 forms. The briefing's unused `skinPattern` act param is explicitly waiting for exactly this on b1/b2. Sources: `pmneila/jsexp` grayscott, `artemhlezin/reaction-diffusion` (ping-pong FBO in three.js), Karl Sims tutorial.
- **CRITICAL mobile gotcha:** `transmission` and heavy transparency cause an extra scene render pass and severe **overdraw** on mobile GPUs. On Lite: **drop transmission entirely**, fake wetness with a matcap or fresnel rim + sheen on an opaque `MeshStandardMaterial`; reserve `MeshPhysicalMaterial` transmission for Full. `MeshTransmissionMaterial` (drei) is even more expensive (extra render pass; use tiny 32×32 buffer resolution if at all).
- Audio hooks: bass → blob swell/displacement amplitude; reaction-diffusion feed rate nudged by `audio.mid`; onset → iridescence flash.

### 6. Raymarching & SDF inside three.js (artist's TouchDesigner GLSL background)
- What it looks like: gloopy fused metaballs, liquid forms, volumetric SDF scenes — the TouchDesigner-native idiom, ported to a fragment shader.
- Approach: fullscreen quad (`PlaneGeometry` or a big triangle) with a `ShaderMaterial`; per-pixel sphere-tracing loop over an SDF `scene()` built from primitives combined with Inigo Quilez's polynomial `smin` (smooth minimum) for organic fusion. Normals via central differences; add diffuse + fresnel + rim for depth. `glslVersion: THREE.GLSL3` for WebGL2.
- Hybrid raster+raymarch: write `gl_FragDepth` from the raymarcher to intersect SDF blobs with regular meshes (advanced; useful for embedding raymarched biomass in a lit scene).
- Helper libs (WebGL, safe): `nicoptere/raymarching-for-THREE`, `danielesteban/three-raymarcher` (has `resolution` downsample knob — set 0.5 for 2× perf). Reference: Iñigo Quilez distance-functions articles; Maxime Heckel "Painting with Math: A Gentle Study of Raymarching" (the GLSL portions).
- **Do NOT use here:** the Codrops "Liquid Raymarching with TSL" tutorial is WebGPU/TSL — port its *math*, not its API.
- Performance/mobile: raymarching is fragment-heavy → cap step count, use `resolution` downsampling (render at 0.5× then upscale), reduce max steps on Lite. This is the single most expensive category on mobile — gate the full-res version behind Full.
- Audio hooks: `smin` blend factor and sphere radii driven by bass/onsets; camera or domain warp by `audio.mid`.

### 7. Noise & organic motion (album-wide)
- **Curl noise:** divergence-free flow for particles (see §1) — 4-tap forward-difference curl is the cheap house recipe.
- **Simplex/periodic noise:** `glsl-noise` (Ashima/`webgl-noise`), `psrdnoise` (periodic, analytic derivatives — good for seamless looping fields). Import as GLSL chunks into `ShaderMaterial`.
- **FBM:** stack 4–6 octaves of noise for cloud/haze/organic texture; fewer octaves on Lite.
- **Reaction-diffusion & differential growth:** ping-pong FBO Gray-Scott (§5) for skins; differential growth (points repel neighbors + attract along a curve, subdividing when stretched) for writhing organic outlines — CPU-precompute or GPU.
- Performance: noise is ALU-heavy; precompute to a texture when static; reduce octaves and skip derivatives on Lite.

### 8. Post-processing for mood (album-wide, mobile-costed)
- **Composer choice:** the project already commits to WebGL `UnrealBloomPass` via `EffectComposer` (`three/addons`) on the `Viz.render()` hook, Full only. `pmndrs/postprocessing` is a valid alternative (merges effects into fewer passes → generally faster; `SelectiveBloomEffect`, `BloomEffect` with `mipmapBlur`), but introduces a dependency; for consistency with a1, prefer the addons `EffectComposer` path unless a viz needs several stacked effects.
- **Selective bloom:** cheapest approach is the pmndrs idiom — set `luminanceThreshold` high and lift chosen materials' emissive **above 1.0** (with `toneMapped=false`) so only they bloom; avoids managing layers/second composer. The rust accent lifting into bloom on onsets is an ideal "flash" channel.
- **Duotone/gradient-map grading (fits the two-color palette perfectly):** a final `ShaderPass` that converts the frame to luminance (`dot(rgb, vec3(0.299,0.587,0.114))`) then `mix()`es between two palette colors by brightness — this *is* the album's visual language as a post effect. Optionally a 3-stop ramp (shadow/mid/highlight = ink → teal → cream, with rust injected on the arc). Cheap, mobile-safe, apply on both quality tiers.
- **Film grain / vignette / chromatic aberration:** cheap fullscreen fragment ops; grain and vignette suit the decay arc (b2/b3). Chromatic aberration in moderation on onsets.
- **Feedback / trail effects:** ping-pong the previous frame with slight fade/offset for motion trails (good for a1 dissolve, b1 wet smears). Costs one buffer.
- **Depth of field:** expensive; Full only, and generally skip on mobile.
- **Mobile costs:** every fullscreen pass costs fill-rate; on Lite, keep to duotone grade (+ optional vignette/grain) and **no bloom/DoF**. Use `HalfFloatType` frame buffers for bloom; disable renderer MSAA when using a composer (use FXAA/SMAA in-pass if needed).

### 9. Audio-reactivity architecture (all tracks)
- **AnalyserNode setup:** `fftSize` 2048 is the standard music-viz compromise (1024 bins); use 1024 for snappier latency, 4096/8192 for finer spectral geometry. `smoothingTimeConstant` 0.8 (the MDN default) smooths values; lower toward 0.6 for punchier transients. Reuse a single `Uint8Array(frequencyBinCount)`; never allocate per frame.
- **Band splitting:** either slice `getByteFrequencyData` bins into bass/mid/high ranges (note the data is linear in frequency, so highs occupy most bins — weight accordingly), or run parallel `BiquadFilter` (bandpass, Q≈1.2) → per-band `AnalyserNode` chains for cleaner separation. Normalize each band to 0..1 against a rolling max.
- **Beat/onset detection (the a1 recipe):** keep a slow EMA of a band; trigger when the band exceeds `EMA + margin` with a cooldown. Bass onsets → big gestures; high-band onsets → fine gestures. `web-audio-beat-detector` is a ready library for BPM if needed.
- **Flash envelope:** a scalar with instant attack + ~100–150ms exponential decay, threaded into emissive/brightness/background lift, makes the whole scene breathe for near-zero cost.
- **Mapping to shaders:** update uniforms once per frame from the `AudioFrame`; accumulate phase on the CPU (`uFlowTime += dt * speed`) rather than multiplying `time*speed` in-shader so parameter changes glide. `audio.frequency[64]` → spectrum-shaped geometry (unused so far; open for a2+).
- **Live vs pre-analyzed + mic:** the project already has a mic-fingerprinting pipeline (Shazam-style landmark hashing, AudioWorklet capture, Web Worker matching) feeding live band energies + playback position; visuals must also run **without a mic** via the per-act Poisson event schedule + `audio.time` fallback clock, so the arc plays regardless. `audio.matched` is true only while the matcher is confident.
- Sources: MDN `AnalyserNode`; Codrops "Coding a 3D Audio Visualizer with Three.js, GSAP & Web Audio API" (Jun 2025); ARKx/Codrops "Creating Audio-Reactive Visuals with Dynamic Particles" (uses `web-audio-beat-detector`).

### 10. Typography / specimen aesthetics (b2 Terminal Taxonomy)
- What it looks like: specimens isolated, pinned, labeled; museum-catalogue order imposed as life drains; rust ascendant.
- **`troika-three-text` (recommended):** crisp SDF text rendered from any `.ttf/.otf/.woff` at runtime (no pre-baked atlas), antialiased via standard derivatives, parsing/layout/SDF in a web worker (no frame drops). Supports any three.js material (including custom `ShaderMaterial`), strokes, per-glyph SDF. Call `preloadFont` at init to avoid first-display pauses; `configureTextBuilder({useWorker:false})` if CSP blocks the worker. Use for specimen labels, catalog numbers, Latin binomials.
- **Pinning/label aesthetics:** thin `LineSegments` "pins" + small `troika` labels anchored to specimens; a slow authored reveal (label drawing itself in, per the a1 filament lesson) reads better than popping.
- **Wireframe / x-ray / dissection shaders:** `wireframe:true` or a barycentric-coordinate edge shader for clean wireframe; fresnel-based x-ray (emissive ∝ `1 - dot(N,V)`, additive) for specimen "dissection" transparency.
- **Rust/decay transitions:** lerp material params over the track — desaturate (toward grayscale via the luminance weights), raise roughness, blend in the rust accent `#c44d3a` as an emissive/color overlay driven by `localT`. This is where the album's rust "goes ascendant."
- Audio hooks: onset → new specimen pinned/labeled; `audio.time` → global desaturation + rust rise.
- Full/Lite: `troika` is efficient; cap simultaneous label count on Lite; lower `sdfGlyphSize` (power-of-two) to save memory.

### 11. Minimalism (b3 Sterile Breath)
- What it looks like: the emptied world; the a1 void revisited but hollow instead of expectant; almost no events.
- **Atmospheric depth:** `scene.fog = new THREE.FogExp2(color, density)` (exponential, physically-nicer) or `Fog` (near/far) tinted ink/teal; fog is the cheapest way to add depth and swallow sparse elements. `PointsMaterial`/custom points need fog handled in-shader for `ShaderMaterial` (the built-ins get it automatically).
- **Sparse slow particles:** reuse the stateless-particle engine (§1) at drastically reduced count (e.g. hundreds), large soft sprites, near-still curl flow, long fades. Negative space is the composition.
- **Event scarcity:** invert the a1 events layer — the Poisson schedule fires rarely; a single slow filament or a lone drifting mote every many seconds. `audio.time` still stages a slow arc (density → near-zero toward the end = extinction/sterility).
- Audio hooks: rare onset → a single subtle event; overall energy → fog density / particle count (both trending down).
- Full/Lite: trivially cheap on both; this track is the performance floor — spend the headroom on subtle atmospheric grading, not event count.

### 12. Mobile performance (maps to QualityManager Full/Lite)
- **Instancing:** `InstancedMesh` (one draw call for N copies; `setMatrixAt`/`setColorAt`) is the backbone for a2/a3/b2. `BatchedMesh` (r156+) for mixed geometries sharing a material.
- **Draw-call & shader budget:** share materials (per-mesh materials break batching); merge static geometry (`mergeGeometries`); mobile GPUs prefer `mediump` (≈2× `highp` throughput) — use `highp` only for positions/depth; keep varyings ≤ ~3 (pack into vec4s); prefer branchless `mix(a,b,step(...))` over `if`; pack data into texture channels to cut fetches.
- **Texture sizes & FBOs:** power-of-two; **half-float** FBOs for simulations/bloom; smaller sim resolutions on Lite (§1/§5).
- **devicePixelRatio capping & adaptive resolution:** cap DPR (≤2 Full, ≤1.5 Lite); render post/raymarch passes at fractional resolution and upscale.
- **Avoid transmission/transparency overdraw** on mobile (§5) — the #1 mobile killer here; drop to opaque + fresnel/matcap on Lite.
- **QualityManager pattern:** Lite default on touch devices; `?q=full` opt-in; FPS-based emergency auto-drop; scene rebuilt on change (budgets baked at init). Target 100+ fps Lite (captivation dies at 20fps).

### 13. Reference works & inspiration (insect/organic-themed, audio-reactive)
- **Codrops** is the richest source for portable, WebGL2 techniques: GPGPU particles (Fojcik 2024), droplet metaballs with GLSL raymarching (2025), reaction-diffusion, audio-reactive particles (ARKx, 2023), 3D audio visualizer (2025), pixel-to-voxel Rapier drop (Kasahara, Jan 2026).
- **Maxime Heckel** (blog.maximeheckel.com): deep, careful GLSL write-ups on FBO particles, raymarching ("Painting with Math"), refraction/dispersion — excellent for the wet/organic and raymarch entries (port GLSL, ignore any TSL).
- **Yuri Artiukh (akella):** YouTube streams recreating award-site shader effects (FBO particles, UV distortion) — the FBO-particles pattern underlies several audio-reactive music visualizers (e.g. the ARKx Coala Music work).
- **Bruno Simon** (Three.js Journey) and the **pmndrs** ecosystem (postprocessing, drei materials, react-three-rapier as a *pattern* reference) for architecture and effects.
- **Iñigo Quilez** (iquilezles.org): the canonical SDF/raymarching/`smin`/noise-derivative reference for §6/§7.
- **Inspiration to study for the insect/biomass arc:** reaction-diffusion Turing patterns (Karl Sims, `pmneila/jsexp`) for skins/biomass; space-colonization vein/tunnel growth for a2; iridescent thin-film (beetle shells) for b1; museum-specimen SDF-text layouts for b2. Keep everything in the duotone palette with rust as the arc's scarce, rising accent so the work reads as *this album* rather than a generic visualizer.

## Recommendations (staged)

**Stage 1 — reuse the a1 engine (fastest path, covers a1/b1-swarm/b3).**
Start every new track from the stateless-particle + staged-acts + events-layer template. b3 Sterile Breath and much of a1/b1's swarm layer need nothing more than reparametrizing dust density, fog, curl speed, and event rate. Ship these first.

**Stage 2 — add one signature system per remaining track.**
- a2 Homemakers: InstancedMesh accretion on a hex lattice + `audio.frequency[64]`-driven growth; optional MarchingCubes chambers (res 28/48).
- b1 Icky Sticky: iridescent/transmission blobs (Full) / matcap-fresnel (Lite) + a reaction-diffusion skin texture (wires up the dormant `skinPattern` param).
- b2 Terminal Taxonomy: `troika-three-text` labels + pins + wireframe/x-ray + rust-rising grade.
- a3 Biome Dominoes: pick the cascade tier by budget (below).

**Stage 3 — post-processing & polish.**
Add the duotone grade pass to every track (both tiers). Add `UnrealBloomPass` Full-only via `Viz.render()`. Verify with `?solo=`, `?t=`, and the FPS HUD at each act; then get an artist taste pass with real audio through the real mic (flashes landing on actual kicks can't be simulated in the harness).

**Decision thresholds that change the plan:**
- If a technique can't hold **100+ fps on Lite**, demote it to Full-only and ship a cheaper Lite variant (e.g. transmission→matcap, raymarch→lower-res, physics→authored wave).
- For a3, choose the cascade engine by count: **> ~300 active bodies or mobile-critical → skip Rapier**, use the authored distance-wave (Kasahara pattern) or a Verlet spring network; **desktop-Full with rich physical topple → Rapier** (`rapier3d-compat`, sleeping-driven propagation, ≤~1000 active bodies).
- If any float/half-float FBO or transmission feature fails a capability check on a device, fall back to the stateless/opaque path rather than shipping black frames.
- Keep the **rust accent rare**; if it stops feeling scarce, dial it back — it must read as precious across the whole arc.

## Caveats
- **WebGPU/TSL is off the table** for implementation in this repo (empirically produced silent black frames). Several state-of-the-art 2024–2026 references (compute-shader boids, TSL raymarchers, `@three-blocks/core`) are WebGPU-only and included as *conceptual* reference only — do not import them.
- The **500–1000 Rapier bodies at 60fps** figure is a secondary-source rule of thumb (jobcannon.io), not an official Dimforge benchmark; Dimforge's published numbers (e.g. the 5,230-body KEVA tower) are native-Rust CPU tests and will be lower in-browser via WASM. Profile on target hardware.
- **Mobile is not yet fully verified** in this project (flagged as pending in the briefing) — treat all Lite budgets as starting guesses to be confirmed on real phones, and check with the artist before assuming mobile is proven.
- `transmission`/`MeshTransmissionMaterial`, raymarching, and multi-pass post are the three biggest mobile risks; always ship a Lite fallback.
- The Codrops pixel-to-voxel article page blocks automated fetching; its technique specifics here come from search extracts + the author's GitHub README (consistent, but not read verbatim in full).
- Confirm float-render-target and half-float support at runtime before using GPGPU/reaction-diffusion; fall back to stateless particles on failure.