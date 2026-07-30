# Track Visuals Briefing

Lessons and working patterns from building the "They Come Marching" (a1)
visualization — the template for the remaining five tracks. Read this before
starting any new track module.

Companion documents:
- **[ARC.md](ARC.md)** — the full-track visual-arc manual (Max Cooper /
  generative-audiovisual tradition): premise→development→payoff structure,
  arc archetypes, energy envelopes, audio-mapping discipline ("each band
  has one job"), camera regimes, pacing, and failure modes. Consult it when
  designing a track's act table and when self-reviewing a contact sheet.
- **[TECHNIQUES.md](TECHNIQUES.md)** — the researched technique catalogue
  (GPU particles, GPGPU, boids, accretion/growth, physics cascades, wet
  surfaces, raymarching, post-processing, typography, minimalism), each
  entry WebGL2-vetted with per-track recommendations, Full/Lite costs,
  mobile gotchas, and library choices. Consult it when picking a track's
  signature element — don't reinvent research that's already done.
- The `/track-viz` skill (`.claude/skills/track-viz/`) — the authoring
  process itself.

## ART DIRECTION RESET — July 2026 (supersedes anything below that conflicts)

Alex reviewed the shipped a1 and the a2 branch build and rejected the
direction as "very basic" — lifeless, colorless, not representing the music.
A structured taste interview produced these governing rules:

1. **Vibrancy is a requirement.** The muted cyanotype lock was a core
   failure. **Each track owns its own bold, saturated palette.** The
   cyanotype survives only in the app chrome and sleeve.
2. **Density over scale.** Many simple elements in patterned motion —
   micro-ecosystems, tiling/growing patterns — beat a few large slow 3D
   objects. His words: "even simpler shapes moving more often in these
   micro ecosystems, and patterns would be better."
3. **Fast evolution.** No hard cuts, but the scene must never sit still
   for more than ~15–20 seconds — something is always arriving, growing,
   or dying off. (He chose this over VJ-style hard cuts.)
4. **Living painting.** Mood-first atmosphere that breathes with the music;
   reactivity stays subtle, never beat-slaved.
5. **Suggestive-to-recognizable insect imagery** — comb cells, wing
   venation, swarms, specimen plates. Legible in the gut.
6. **One medium per song; media vary across the album.** Organic/analog,
   precise/minimal, lush/painterly, illustrated/graphic are all approved —
   match medium to track. Never mix 2D and 3D scenes inside one song.
7. **Shader-first, three.js host.** Fullscreen fragment-shader worlds are
   the primary medium (a quad in the existing VizHost — all infra
   unchanged). 3D scenes remain available where a track calls for them.
8. **Prove looks with rendered prototypes before full builds.** Both
   rejections came after complete builds. Concept → prototype screenshot →
   user approval → then stage the arc.

The pre-reset a1 module (`a1-they-come-marching/`, now unused) embodies the
rejected direction — use it for infrastructure patterns only, not
aesthetics. The pre-reset a2 build (`a2-homemakers/`) embodied it too and
has since been deleted, rebuilt as `a2-hive/` (the golden-wax-wall dual
lattice) and approved; its infrastructure patterns (module shape,
pointer/momentum, `arcAt`/act-crossfade machinery, measured song staging)
live on there and in a2-hive's own port of them. Everything below about
staging, performance, and workflow still stands; palette rules below are
superseded. ARC.md's structural craft (premise/arc/motif/camera
discipline) remains fully in force — it's aesthetics-agnostic.

## The bar

Every track visual must be three things at once:

1. **Beautiful** — gallery-grade generative art in the album's visual
   language, not a tech demo. It will be projected wall-sized at the
   listening party and looked at on phones from the sleeve QR code.
2. **Staged** — the scene *changes as the song plays through*. A visual that
   loops the same state for five minutes is a failure. Use the measured
   structure of the actual track.
3. **Performant** — 100+ fps on Lite (phones, laptops), headroom to spare on
   Full (the RTX 5080 projection rig). Captivation dies at 20fps.

## Non-negotiables

- **WebGLRenderer + GLSL only.** A full WebGPURenderer/TSL migration was
  built and abandoned (branch `webgpu-tsl-experiment`) — it produced silent
  black frames on real hardware with zero errors and cost most of a day.
  Do not relitigate this before the album cycle is over. Modern ≠ newest
  API; modern = making the proven API saturate the hardware.
- **No visual change is "done" without a verified screenshot.** The preview
  harness screenshots WebGL canvases reliably. Walk every act cue with
  `?t=` and look. When an element is sporadic, add a force switch (see
  `?sparks=always`) so screenshots can catch it. Adjectives from memory or
  imagination don't count; only pixels count.
- **A hidden preview tab freezes the whole app** — browsers pause
  `requestAnimationFrame` entirely, so the song clock stops, sporadic events
  never spawn, and screenshots return the stale last-composited frame. If
  the scene looks mysteriously dead mid-verification, check
  `document.visibilityState` FIRST before debugging the viz (the a2 session
  lost an hour to this). Workaround while hidden: drive
  `host.current.update(dt, fakeFrame)` in a loop via eval and verify state
  numerically; fresh pixels require the tab visible.
- **Isolate before you debug.** `?solo=<layer>` renders one layer against a
  bright background. Building a new module: get each layer on screen alone
  before composing.
- **Budgets are per quality level and baked at init.** VizHost rebuilds the
  scene on quality change (same seed, same song clock) — so read
  `quality.level` at construction and never mid-frame.

## Module anatomy (copy this structure)

```
src/viz/<track-id>-<slug>/
  index.ts     composes layers, owns camera choreography + scene lights,
               implements Viz (init/update/resize/dispose)
  sections.ts  measured cue table + per-act parameter keyframes + paramsAt()
  <layer>.ts   one file per visual layer (a1: dust.ts, blobs.ts, sparks.ts)
```

Then point the track's `viz:` field at the folder in `src/tracks.ts`.

### The staging system (sections.ts pattern)

- **Measure the real track first.** RMS/band profile of the master WAV at 2s
  resolution is enough to find section boundaries (the a1 session used a
  ~40-line `node -e` RIFF parser; masters live in
  `~/Downloads/Sunntack - Small Vibrations EP/`). Turn the profile into a
  `CUES` array (seconds) and one named act per section.
- **Acts are parameter keyframes, not scene swaps.** One continuous scene;
  each act is a bag of scalars (densities, speeds, blend weights, rates,
  colors). `paramsAt(songTime)` lerps across a ~6s crossfade window before
  each boundary and exposes `localT` (0..1 through the act) for within-act
  envelopes (growth, decay). This is robust to imprecise match positions
  and makes transitions feel intentional.
- `lerpParams` iterates keys — adding a field to `ActParams` automatically
  crossfades. Add per-act knobs freely.
- **`audio.time` is the master clock.** It's the fingerprint matcher's
  playback position (extrapolated between match cycles) or VizHost's
  looping fallback clock — never null, so the arc plays with or without a
  mic. Dev override: `?t=140`.

### States + events (the captivation lesson)

A staged scene alone still reads as a screensaver. The a1 breakthrough was a
**sporadic events layer** (sparks.ts): flashes and drawn-in filament lines
that fire on audio onsets *and* on a per-act Poisson schedule (so the scene
stays alive without a mic). Every track needs its own idea of an "event" —
something that happens *now*, at a moment, and is gone.

- Onset detection: keep a slow EMA of a band; trigger when the band exceeds
  EMA + margin, with a cooldown. Bass onsets → big gestures; high-band
  onsets → fine gestures.
- A "flash" scalar with instant attack and ~100–150ms exponential decay,
  threaded into layer brightness/emissive/background lift, makes the whole
  scene breathe with the music for almost zero cost.
- Progressive reveal (a line drawing itself in over ~160ms with a bright
  head) reads far better than something appearing fully formed.

### Audio reactivity map (what drives what)

| Signal | Use for |
|---|---|
| `audio.time` | act staging — the macro arc (THE most important input) |
| `audio.bass` + onsets | swell/pulse of masses, particle size breath, flashes |
| `audio.mid` | motion pace (flow speed, camera drift nudge) |
| `audio.high` + onsets | sparkle, fine events (filaments) |
| `audio.frequency[64]` | unused so far — available for spectrum-shaped ideas |
| `audio.matched` | true only while the matcher is confident |

## Performance playbook

- **Stateless GPU particles**: position = pure function of (seeded base
  attribute, accumulated time uniforms) computed in the vertex shader every
  frame. No ping-pong buffers, no compute, nothing to allocate. 150k
  particles at 120fps this way. `THREE.Points` costs 1 vertex per particle;
  soft round sprites via `gl_PointCoord` falloff + additive blending is what
  makes overlapping dust read as luminous haze.
- **Cheap noise**: hash-based value noise (see dust.ts GLSL) + forward-
  difference curl (4 taps, not 6) for divergence-free flow. Curl fields look
  alive; gradient fields look like draining water.
- **Accumulate phase on the CPU** (`uFlowTime += dt * speed`) instead of
  multiplying `time * speed` in the shader — parameter changes glide instead
  of jumping.
- **Zero per-frame allocations in choreography code.** Module-scope scratch
  Vector3s, persistent object pools filled in place (see blobs.ts
  `ballsForAct`/`lerpBalls`, sparks.ts filament pool). GC hitches read as
  dropped beats.
- **MarchingCubes is CPU-bound at res³** — 28 (Lite) / 48 (Full) is the
  proven range for ~14 balls. Cap `maxPolyCount`.
- **Budgets that shipped for a1**: dust 20k Lite / 35k Full; MC res 28/48;
  7 pooled filaments. Start new tracks near these numbers. Full's dust budget
  was cut from 150k after artist feedback — high DPR already makes Full
  particles bigger and brighter, so Full needs *fewer* particles than raw
  budget allows, not more; treat ~2× Lite as the ceiling.
- Uniform-array lookups (4 attractors) are fine; keep shader-visible state
  tiny and fixed-size.
- Quality system already handles the rest: Lite default, `?q=full` opt-in
  (projection rig), time-based emergency drop, rebuild-on-change.

## Aesthetic system

- **Palette: per-track, bold, saturated** (see ART DIRECTION RESET above —
  the album-wide cyanotype lock is dead). The cyanotype family (cream
  `#ece4cf`, teal `#1f5d7a`, ink `#05141c`, rust `#c44d3a`) remains the
  app-chrome palette only. A track palette should feel like it belongs on
  a festival screen: 3–5 anchor colors, real saturation, real contrast.
- Album-arc color idea (optional, not a lock): early tracks luminous and
  cool-to-warm, later tracks hotter and more decayed — rust/heat can still
  ascend across the album as life declines.
- Materials: unlit custom GLSL for particles/lines; `MeshStandardMaterial` +
  two directional lights (warm cream key from above, cool teal fill from
  below) + teal ambient for solid forms. Emissive intensity is the flash
  channel for lit forms.
- **Camera is choreography**: slow seeded orbit with a breathing dolly,
  pace tied to a per-act `cameraDrift` param and nudged by mids. Reset the
  camera to `(0,0,4)` looking at origin in `dispose()` — the shell owns it
  between tracks.
- Per-play `ctx.seed` (mulberry32 from `src/viz/random.ts`) drives all
  randomness — every play unique, every play internally coherent.

## Lessons from a2 "Homemakers" (the golden wall — ratchet, July 2026)

- **Persistence via a bounded trace field.** When taste notes need memory
  (scars that heal, structures that stay built, trails that linger), a
  pure-function-of-uniforms shader isn't enough — add ONE ping-pong FBO in
  wall/world space (`a2-hive/traceField.ts`, modeled on a1's RDSim). The
  pan clamp is what makes it possible: bounded reachable territory = a
  fixed-region texture. Channels: fast-decay, slow-decay, and permanent
  (permanent = literally no decay term; reset via a seed pass). Always
  build the **seed pass** (analytically pre-fill "what should exist by
  now") or `?t=` deep links and quality reloads break — and re-seed on
  loop wrap.
- **Agents beat ambience.** The single biggest captivation jump came from
  ~10 CPU-animated entities (crawlers walking the lattice, biased random
  walk + steering) with visible AGENCY — they build the world (boost the
  cells they pass, trace the rooms into existence) and interact with it
  in both directions (brighten the dark, dim the bright — contrast
  inversion keeps their paths legible everywhere). Cost: one vec4[10]
  uniform array + a cheap oriented-blob loop.
- **Separate event channels by tempo.** One decaying "flash" scalar can't
  serve both full-scene hits (few/min) and per-beat pulses (60-90/min) —
  the fast rate strobes everything the scalar touches. Give each tempo
  its own scalar + counter (`uFlash/uFlashCount` vs `uPulse/uPulseCount`);
  a per-event counter hashed with cell ids re-rolls which cells light and
  in what colour each beat.
- **Two GLSL template-literal traps** (both caught by the house rule of
  rendering generated shader source to a file and READING it): interpolated
  constants that were never declared, and backticks inside GLSL comments
  silently truncating the template string. `npm run build` catches neither.
- **iq's sdHexagon is flat-top and takes the apothem.** Pointy-top axial
  grids need `p.yx` + `R*0.866` or neighbouring SDF hexes overlap and the
  walls collapse into triangle slivers.
- **Scale birth/build pacing to the VISIBLE field** (viewport + pan clamp),
  not to abstract lattice units — a build wave that outruns the viewport
  reads as "already done" for the whole track.
- **Deterministic shader worlds beat sims for iteration**: no warmup, every
  `?t=` lands exactly, contact sheets are trivial. Reach for a sim (or the
  trace field) only when notes demand memory.
- **CPU/GPU hash divergence is total, not approximate** (measured up to
  0.87 on `fract(sin(dot))` at float32 vs float64): CPU replicas of shader
  hashes are ring/structure-dominated heuristics only — never gate a hard
  visual on one. Share structural constants (seed cells, split chunks) as
  exported source-of-truth data/GLSL text instead.

## Lessons from a3 "Biome Dominoes" (the excitable lattice — ratchet, July 2026)

- **Excitable medium is a new house pattern** (`a3-biome-dominoes/
  excitableField.ts`): a Barkley/FitzHugh-Nagumo reaction in a single ping-pong
  half-float FBO — `.r`=activation `u` (diffuses → travelling waves), `.g`=
  recovery `v` (the refractory "dominoes stand back up" channel). ONE fragment
  pass/tick (no agent/deposit passes — simpler than Physarum). Clamp `u` to
  [0,1] each tick so the reaction term stays bounded/stable. **Fixed virtual
  laplacian grid** (`SIM_GRID`, `uTexel = 1/256`) decoupled from storage
  resolution keeps wave speed/chain-length identical across Lite/Full/warmup —
  tie the laplacian to texel size and doubling resolution halves uv-space wave
  speed (retunes the whole piece). Rendered per-cell through a Voronoi shader
  (whole cell samples the field at its feature point → a continuous wave reads
  as discrete domino hops).
- **Spare texture channels carry per-cell state cheaply.** The lattice-rewire
  feature (walls that break apart + reform as waves pass) reuses the field
  FBO's unused `.b`/`.a`: `.b` = an integer GENERATION counter (bumped on the
  upward `u` crossing of `FIRE_T=0.6`), `.a` = a 0..1 transition PHASE. Zero new
  passes/targets. The display slides each cell's nucleus between generation
  targets over the phase → the tessellation genuinely reorganizes. `INIT_FRAG`'s
  `(0,0,0,1)` = generation 0 settled, so clearField/loop-wrap reset for free,
  and a `rate=0` act freezes the lattice by construction (offset ≡ anchor). 25
  cache-friendly `.ba` fetches for a moved-feature-point Voronoi cost nothing
  measurable (413 fps Lite at the densest act).
- **Texel-SNAP any per-cell read of an integer stored in a LINEAR texture.**
  Reading a generation counter at a cell's home uv bilinearly blends the 4
  covering texels; across a wave seam that blends e.g. 3↔4 → `floor()` flickers
  and replays the slide backward. Snap to the storage-texel centre (`(floor(uv*
  size)+0.5)/size`) and `round()` — then every fragment of the cell reads one
  coherent value. (Needs a `uFieldSize` = storage texels uniform.)
- **Gate a per-cell transition on the previous one finishing** (`phase>=0.999`
  before re-triggering) so a rapid re-fire mid-slide can't pop the animated
  quantity — caps one pending transition per cell by construction.
- **Confine hash-placed Voronoi feature points to ~[0.12,0.88]** (clamp, not a
  smaller hash range) — the clamp is what keeps an n±2 5×5 search window exact
  and feature points non-coincident *at any jump magnitude*, so the motion
  amplitude stays a free taste knob. Restructure the two Voronoi passes into one
  n-centred window that precomputes offsets into a `vec2 offs[N]` array (capture
  the winner in scalars inside the `d<md` branch — never post-loop dynamic-index
  the array). three ^0.169 is WebGL2-only (dropped WebGL1 at r163), so ES3
  dynamic array indexing is legal, but loop-index-only indexing is the robust
  choice.

## Lessons from b1 "Icky, Sticky, & Thriving" (the petri dish — ratchet, July 2026)

- **GPU Physarum is now a proven house pattern** (`b1-biosphere/physarum.ts`):
  agent state in a ping-pong FBO (one texel per agent), a trail FBO with
  3×3 diffuse + per-channel decay, and deposits written by a `THREE.Points`
  draw whose VERTEX shader texture-fetches the agent texture (one static
  `aUv` attribute; the `webgl_gpgpu_birds` idiom). 262k agents Full / 65k
  Lite runs at 380/180 fps in the throttled dev pane. Species can be
  DERIVED from the texel coordinate (`floor(vUv.y * 3)`) instead of stored
  — every pass agrees for free.
- **`THREE.AdditiveBlending` multiplies source RGB by source ALPHA**
  (`SrcAlphaFactor`). A data-texture pass that deliberately writes alpha
  0 (to protect a channel owned by another pass) silently zeroes its whole
  output under the preset. Use `CustomBlending` with ONE/ONE on RGB and
  ZERO/ONE on alpha. Symptom: an all-zero readback from a pass that
  "obviously" writes.
- **dt-scale every accumulation rate in a multi-tick sim.** Decay used
  `exp(-rate*dt)` but deposit/gain were flat per-tick amounts — so the
  equilibrium depended on tick RATE, and the fixed-dt warmup loop (plus
  Lite-vs-Full substep counts) saturated the trail to solid white in
  seconds. Every "amount added per tick" must be a per-second rate × the
  substep's own dt, or warmup, Lite, and Full all live in different worlds.
- **Additive multi-channel palettes wash to white at saturation.** Summing
  three species colours where all channels clamp to 1 turned the climax
  into a pale plasma ball. Fix: hue-preserving intensity compression —
  blend the HUE by per-channel weight, cap the total intensity, and add a
  small cream lift only above a high total. Below the cap it is
  algebraically identical to the plain sum, so sparse acts are untouched.
- **Mask additive layers to the world's physical bounds.** The trail blur
  bleeds past the dish rim; the ground darkened out there but the additive
  vein layer didn't care, smearing glow outside the glass. One
  `smoothstep` interior mask on every additive term.
- **An authored envelope needs a named consumer.** `arcAt` (the energy
  curve with the discrete boundary steps) was built, exported, and fully
  unit-tested — and consumed by nothing; every check passed. When
  reviewing: for each exported curve/param, name the uniform it feeds.
- **Browser-pane clock advances ONLY while fronted, and only screenshots
  front it.** `wait` does not run rAF; a "wait 3s then read state" plan
  reads the same frame twice. To verify time-gated events: either force
  the event via the instance handle (`__sv.host.current` — private methods
  are callable from JS) and screenshot immediately, or deep-link past the
  boundary with `?t=` and read uniforms. Clicks in the pane land in
  SCREENSHOT-pixel space, not native canvas pixels.
- **Sim + seeded-warmup answers the `?t=` deep-link problem for
  self-organizing systems**: ~180 fixed-dt ticks at the current act's
  params lands every cold load / quality reload on a formed network
  (fresh per-play seed means each load is a different specimen — a
  feature, not a bug).

## Lessons from b2 "Terminal Taxonomy" (the catalogue — ratchet, July 2026)

- **Audit new tracks against SHIPPED tracks, not just against ARC.md.**
  b2's first build rendered communities as a wall-to-wall Voronoi
  tessellation — technically distinct from a3 in every system, yet Alex
  immediately read it as "the Biome Dominoes lattice," because the
  underlying GEOMETRY LANGUAGE (tiling polygon cells + bright walls) was
  the same. The per-track failure-mode review can't catch this; add a
  cross-track check to every contact sheet: put the new act stills next
  to each shipped track's and ask what geometry family each reads as
  (a1 fluid fields, a2 dual lattice, a3 Voronoi cell tissue, b1 vein
  networks, b2 discrete silhouettes on ground, b3 an advancing boundary
  between two media). Each track must own its geometry, not just its
  palette — and per the b3 ratchet, its GROUND treatment too. The fix that worked: replace territory
  tiling with a nearest-SDF search over discrete silhouettes — blobs
  drawn whole on visible ground, layering like leaves instead of
  clipping at bisectors.
- **A textual GLSL audit is not a compile.** Round 5 shipped `float
  active = ...` — `active` is a GLSL ES reserved word — through an
  agent's brace-balance/backtick audit, tsc, eslint, vitest, AND
  `npm run build` (the shader is just a string to all of them); only the
  browser's shader compile caught it (black stage, console error). The
  Playwright smoke test IS the automated gate that would catch this —
  never skip it before claiming a shader change works, and screenshot
  the live scene after every shader-touching task. Avoid GLSL reserved
  words in generated code: active, input, output, filter, superp, etc.
- **Single-pass "post" effects for an SDF world** (no framebuffers, no
  post pipeline, measured at zero frame-cost when idle): BLUR = multiply
  every fwidth-derived AA width by one shared factor (+ drop pattern
  contrast, lift exposure) — a genuine soft-focus; FEEDBACK/echo = 1-2
  extra winner-only silhouette taps at lagged offsets drawn translucent
  (+ an offset second grid sample); LENS RIPPLE = radial domain warp of
  community space before the search so the whole world bends coherently.
  Schedule as occasional enveloped interludes (Poisson ~30s, 4-7s,
  smooth in/out) — periodic global effects hold interest through
  static-camera stretches without a persistent look change.
- **Winner-only detail is how a nearest-SDF search affords rich per-item
  art.** b2's species body plans (beetle legs/antennae, leaf veins, diatom
  spokes, bacterium flagella) would have blown the budget inside the
  9-cell search; instead the search silhouette only gets cheap per-family
  BIAS (elongation + wobble character from a shared `specParams` helper —
  one source of truth so search and detail never disagree), and the
  recognizable ink detail draws once per fragment for the winner. Median
  frame cost was unchanged. Also: keep event grammars visually disjoint —
  the beetle's first full-width crossing marks read as pre-applied
  strike-out X's; interior marks must stop short of the silhouette edge.
- **Overlays that must POP draw AFTER the grade.** b2's link lines,
  strike X's, and grid runners drew before the desat/rust grade and came
  out the same dusty monochrome as the field — the same reason poke
  ripples always drew post-grade. Events are the machine's live overlay:
  draw them after grading, and where events restore color to specimens
  (which ARE graded), carry an `eventGlow` scalar into the grade and
  locally suppress desat/rust so the restored color survives.
- **Exempt envelopes whose MOTION is the content from the act-hold idiom.**
  The hold fix (below) applied to b2's spatial machine-order made the
  scatter→drawer assembly TELEPORT in one frame at the drop — Alex never
  saw it move ("the morphs appear briefly early and then never again").
  If watching a parameter change IS the payoff, drive it as a continuous
  song-time envelope (`orderAt(t)`, an arcAt clone with its own keys)
  ramping across the act, not an act keyframe. Discrete cliffs for
  arrivals; continuous ramps for processes.
- **Static = dead, even when every system is technically animated.** A
  hash-of-position world reads as wallpaper the moment nothing is born or
  dies. The b2 lifecycle recipe (cheap, deterministic, beat-coupled):
  CPU-accumulated `uLifeClock` (rate × act param, tripled briefly by a
  bass-onset beatPulse scalar) → per-specimen `cycle = clock + hash
  phase`; presence per epoch = `hash(cc, epoch) < uPresence`; the organic
  anchor RE-ROLLS per epoch so respawns land in new places; crossfade the
  last 15% of each cycle + pop-in overshoot. Pin one hero cell always-
  present for openings/loop identity. Also: events that only write an
  already-saturated sim channel are INVISIBLE — every event needs a
  display-side representation (b2's wave got a ring sheen + specimen
  swell only in round 2).
- **The 6s crossfade LEAKS the next act's maximum into a quiet act.**
  paramsAt's generic pre-boundary lerp is right for gradual arrivals but
  fatally wrong for a restraint-act → drop-act boundary: act 5's
  grid/rust/drain crept into the withheld act 4 and the scripted drop
  arrived pre-spent (ARC failure mode 7, caught on screen at t≈231.7).
  Fix idiom: while inside a held act, use the PURE `ACTS[i]` object
  instead of `section.params` (b2 index.ts holds indices 3 and 4) — the
  boundary becomes a true cliff, amplified by the edge-triggered hit.
  Generalize a3's zoom-hold to ALL params whenever a discrete boundary
  matters.
- **The embedded Browser pane's fps HUD is NOT a benchmark.** The pane's
  rAF pauses when occluded and runs UNCAPPED (300-1300fps) during
  screenshot-forced composites, so the HUD's EMA mixes paused/uncapped/
  vsynced windows and reads anywhere from 17 to 344 for the same shader.
  A whole false "6x regression" was chased before spotting it. Protocol:
  monkey-patch `render()` from the console to record
  `performance.now()` per frame, force composites with 2-3 screenshots,
  and take the MEDIAN inter-frame delta inside bursts (<100ms) — b2 Lite
  measured 8.0ms median (≥120Hz vsync-met) while the HUD said 45. The
  fallback song clock also FREEZES while the pane is occluded — nudge
  `__sv.host.fallbackClock` from the console to cross scripted
  boundaries instead of waiting.
- **Additive light dies on a pale ground.** The album's first light-ground
  track inverted several habits: accents that read as glow on dark
  grounds (additive rings, rust-on-rust code) vanish on bone — draw
  marks as INK (mix-darken toward a vivid or dark color) and keep VALUE
  contrast, not just hue contrast, in every overlay (dark-stamp machine
  code pulsing bright; the outro flicker drawn as ink).
- **Per-community procedural glyph "languages" are cheap and legible as
  writing**: a 3x3-endpoint stroke lattice per glyph cell, language =
  4 hash bits (stroke-angle family, curvature, column count, baseline
  rotation), chatter = per-cell hash-staggered re-rolls
  (`floor(uTime*rate + hash(gid))`) so script writes without strobing.
  2 strokes on Lite still reads as script. A second fixed grammar
  (axis-aligned ticks/dots, raster row pulse) reads unmistakably as
  machine code against it.

## Lessons from b3 "Sterile Breath" (the scrub — ratchet, July 2026)

- **Album-wide audio-reactivity bug #1: an EMA-vs-EMA onset detector goes
  DEAF after warmup unless its reference is DRASTICALLY slower.** The
  house recipe (fast EMA rate 8, reference 1.5, absolute gap threshold)
  has only a 5.3x ratio, so at musical tempos the reference tracks the
  beat envelope almost as closely as the fast EMA and the gap collapses.
  It fires only during the cold-start transient while both climb from 0.
  Measured on b3 with a continuous 120bpm kick: 7 strikes in the first
  10s, then ZERO for the next 80s (steady-state gap −0.038 against a
  required +0.09). An audit found **all nine detectors in all five
  previously-shipped tracks had the identical defect** — a1/a2/b1 fire
  exactly ONCE per play. The cure: reference rate 1.5 → **0.25** (32x
  ratio, tau ~4s), a **relative** threshold (`fast > ref * (1 + margin)`)
  so it works at any playback level, a small absolute floor so silence
  never triggers, and a **rising-edge** gate (`fast > prevFast`) so it
  fires on attacks not plateaus. b3 landed margin 0.22 / floor 0.06
  (bass), 0.16 / 0.05 (high).
- **Album-wide audio-reactivity bug #2: a Poisson schedule LATCHES when a
  crossfaded rate passes through zero.** The house idiom bakes the next
  delay from the CURRENT blended rate. Because `paramsAt` lerps every
  numeric key across a 6s crossfade, an act with rate 0 blending into a
  nonzero act passes through ~2.3e-5 on the first frame — and since the
  countdown is initialised to 0 and the `rate <= 0` early-return FREEZES
  it there, that first epsilon frame fires immediately and bakes a delay
  of order 1e5 seconds. That channel is then dead for the rest of the
  track, every play. Affects any module where an act rate sits at 0
  adjacent to a nonzero one. Cure: **rescale the pending countdown when
  the effective rate changes** (`timeToNext *= oldRate / newRate` — the
  quantile-preserving rescale for an Exponential), plus clamp the baked
  delay as a backstop.
- **Debug switches that BYPASS the real code path hide bugs in the real
  code path.** Both bugs above survived every review, every test, and
  every taste pass because `?strike=always`, `?scan=always`, `?lines=always`
  and friends feed a constant rate or a separate fixed-interval timer —
  so the Poisson path and the onset path were never once exercised under
  any debug flag. Force switches should ACCELERATE the real mechanism
  (raise its rate, lower its threshold), not replace it. If a switch
  replaces the path, add a second check that runs the real one.
- **Verify event CHANNELS by counting over the full runtime, not by
  screenshotting a moment.** Both bugs are invisible in code review and
  invisible in any single still. What found them: wrap the fire method in
  a counter, drive `viz.update()` across the whole track with synthetic
  audio, and print events per 10-20s window. A healthy channel shows
  counts that track the act table; a latched one shows a burst then
  zeros. Make this part of the contact-sheet step for any track with
  scheduled or onset-driven events.
- **Angular radius interpolation does NOT make facets.** Modulating an
  SDF radius as a function of angle (interpolating hashed per-sector
  radii) traces spiral ARCS, not straight chords — a "faceted" shape
  built that way renders as a smooth blob no matter the interpolation
  law. For real facets, sharp corners and an exactly unit gradient,
  intersect hashed half-planes instead: `sd = max_i(dot(p, n_i) - h_i)`.
  Cheaper, too.
- **Size a smooth-min/max blend radius against the THINNEST feature it
  will merge, not against the scene.** b3's strikes initially shared the
  front's `K_BLEND = 0.05` while a fissure is ~0.005-0.011 wide — the
  shared blend would have silently rounded every crack out of existence.
  Events whose geometry is thin need their own tighter constant; organic
  events keep the soft one.
- **Warm dark colours read far darker than their numbers suggest —
  specify brightness as MEASURED TARGETS, not constants.** Bit twice on
  this track. Red contributes only ~21% of perceived luminance, so an
  "oxblood" at luma 0.026 (≈7/255) is functionally black; the first
  atmosphere cut needed 18x gain to see at all, and an earlier
  light-on-light ending fog measured a 2-6/255 delta. If a subagent's
  evidence requires brightness boosting, the thing is not there. Brief
  colour work as outcomes to hit and report — "crests 80-100/255 in the
  red channel, trough-to-crest ratio >= 3x, peak luma <= cap" — verified
  on an UNBOOSTED framebuffer.
- **Add a force-SCALE switch for any small shape whose silhouette is the
  point.** `?crack=<mult>` made a geometry error obvious in one
  screenshot that was completely invisible at shipping size. Same role
  `?ghost=always` played for the motif stamps. Add it the moment the
  shape lands, not after a taste round bounces.
- **The cross-track check must cover GROUNDS, not just geometry
  families.** a1 already owns a dark indigo fbm nebula and b1 a dark plum
  dish ground; b3's flat near-black was already sitting close to b1's, so
  "add fbm to the black" would have landed straight on a shipped track.
  Differentiate a new atmosphere on hue, MOTION (b3's masses rise and
  bubble; a1's cloud drifts; b1's mottle is near-static), and ideally a
  spatial coupling only that track can have (b3's murk cools toward ash
  as it nears its own advancing front).
- **Per-seed envelope normalization beats a global worst-case constant.**
  b3's front radius was first calibrated to the worst-case seed, which
  left most seeds with a huge unused margin and made `sterileAt` mean
  something different on screen for every play. Computing the seed's own
  max-visible extent at init (`rMaxEff`) and normalizing against it makes
  a staged envelope land at the SAME visual moment for every seed, and
  makes "nothing visible at t=0" true by construction rather than by
  safety margin.
- **Side-gate expensive per-fragment searches on a scalar you already
  have.** b3 ran its biomass clump search AND a near-identical watermark
  search unconditionally on every fragment regardless of which side of
  the front it sat on — together ~75% of the Lite frame (17ms → 4ms with
  both ablated). Gating each on the S field cut Lite to 2.6ms. This
  required replacing every `fwidth()` with an analytic per-frame
  pixel-scale uniform first (derivatives are undefined in non-uniform
  control flow) — which also permanently retired a triangle-seam
  derivative artifact that had previously only been clamped.

## Lessons from the album-wide audio-reactivity fix (ratchet, July 2026)

The two bug classes in the b3 ratchet above turned out to affect EVERY
track on the record. Fixing all six produced its own lessons — mostly
about how to verify this kind of work, and how it hides.

- **The whole thing started from one artist observation.** "I see a few
  cracks emerge, but then after that, none at all." That sentence was the
  only signal anything was wrong; it turned out to be two systemic bugs
  that had been silently killing every onset-driven event on every track
  since launch. Nothing in code review, no screenshot, and no test we
  had would have found them. **When someone says an element "stops
  happening," treat it as a measurement request, not a taste note.**
- **Detector tuning does NOT transplant between modules — measure it per
  call site.** b3's cure used relative margin 0.22; applying that literal
  value to b2 produced a detector that STILL only fired during warmup,
  because b2's fast EMA is shared with continuous uniforms and swings
  less. Measured ceilings: b2/a1/a2/a3/b1's rate-8 bass EMA peaks at only
  ~1.104x its reference against a real kick, and a high-band EMA at
  ~1.089x — so the workable bass margin is ~0.08 and the high ~0.06, far
  below b3's. A "transplant the fix" instruction, followed literally,
  would have shipped four more deaf detectors that LOOKED fixed. Measure
  the actual swing ceiling of each fast EMA, then pick a margin under it.
- **Gate every event-channel change on counts per window across the FULL
  runtime, before and after, against the unfixed baseline.** A single
  count, or a count from only the fixed build, proves nothing: the
  failure signature here is specifically "correct for the first ~10s,
  then zero forever," which any short test or any single screenshot
  passes cleanly. Both the b2 fix and the four-track fix had a round
  where the first attempt looked identical to the bug under this harness
  and would otherwise have shipped as a confident false fix.
- **`VizHost.doLoad()` no-ops on a same-track reload — harnesses that
  re-load the same track silently reuse a stale, already-mutated
  instance.** This produced a completely convincing phantom during
  verification: a Poisson countdown ballooning to ~2.25e14 seconds, which
  looks exactly like the latch bug being fixed but was actually RNG-stream
  divergence across reused state. Null `host.currentTrackId` before each
  harness load. Generally: when a measurement produces an absurd number,
  suspect the harness before the product.
- **This project's audio path fails quietly in BOTH directions, and
  neither is visible without instrumentation.** The visuals can go deaf
  while audio flows fine (these bugs), and the capture path can go deaf
  while the visuals dance (the stereo/sample-rate capture bug fixed in
  the same week, whose `MicInput.level` readout exists precisely so a
  level pinned at 0 is visible in the `?debug=1` HUD). Any new
  audio-driven feature should ship with a way to see that its input is
  alive — a HUD readout, a counter, or a force switch that exercises the
  REAL path.
- **Shared code is the actual fix for a class of bug, not just tidiness.**
  Nine hand-copied onset detectors meant one bad recipe reached every
  track and each fix had to be applied nine times. `lib/onset.ts` and
  `lib/poisson.ts` now hold both mechanisms with unit tests that pin the
  regressions in CI — the first time either could be tested at all,
  because neither needed three.js or a browser once extracted. Prefer
  extracting the MECHANISM that broke over whatever is merely duplicated.
- **Prove a refactor is behaviour-neutral with identical numbers, not
  with reasoning.** The extraction migrated b2 and b3 first precisely
  because both were already fixed and measured, so identity could be
  demonstrated (every 20s window matched exactly) before four unfixed
  tracks were touched. Two modules' near-identical RNG epsilon formulas
  (`Math.max(1e-6, rand())` vs `1 - rand()`) had to be preserved rather
  than unified: statistically equivalent, numerically different for the
  same input, and unifying them turned exact identity into "close."
- **Density must follow the composition, not the beat rate.** Once a
  detector works, an ungated one fires on ~80% of beats, which is a
  different kind of broken — b2's first fixed cut was ~6x denser than its
  own act table asks for. Gate each effect's cooldown with
  `rateGapSeconds(floor, actRate)` so turning a mic on changes the TIMING
  of events, not their quantity; verify mic-vs-ambient totals land within
  ~2x per channel. Keep fixed cooldowns only for effects with no act rate
  of their own, and never rate-gate a raw beat signal that other systems
  clock off (b2's `beatCount`/`beatFlash` drive the living grid's re-roll).

## Workflow: from master WAV to shipped visuals

1. Profile the track's master (2s RMS + low/high bands) → section table.
2. Write `sections.ts`: cues, named acts, first-guess parameter values.
3. Build layers one at a time; verify each with `?solo=` + screenshots.
4. Compose in `index.ts` (camera, lights); add the events layer last.
5. Walk every act: screenshot at each cue midpoint + one boundary
   crossfade. Check the fps HUD stays high on Lite.
6. Ask the user for a taste pass (they run real audio through the real
   mic — flashes landing on actual kicks can't be simulated here).
7. `npm run build` + commit; deploy only when asked.

## Interaction (pointer contract)

Every track scene should invite touch. VizHost owns the plumbing: it
captures the primary pointer on its canvas and forwards
`{ type: 'down'|'move'|'up'|'cancel', x, y, dx, dy, down }` (canvas uv,
y-up, deltas per event) to the active module's optional
`Viz.pointer?(e)` — modules that don't implement it are untouched.

- **The principle: interaction = injecting life/energy into the scene,
  never a UI widget.** In a1, a tap pokes the petri dish (a hot seed +
  a near-white ripple ring — white so it reads on dark AND dense acts)
  and a drag pans the wrapping field with momentum after release.
- Screen→field mapping reuses the display shader's own formula
  (`field = (screen − 0.5) * uCover + 0.5 − uScroll`) — never maintain a
  parallel inverse. **Wrap the result into [0,1) (`x -= floor(x)`) before
  writing it into any sim/effect uniform**: `uScroll` grows unboundedly
  and the shader-side distance math must also torus-wrap
  (`d -= floor(d + 0.5)`), or pokes/ripples silently miss after minutes.
- 1:1 drag tracking is exactly `scroll += d · uCover` (solve the display
  formula for a fixed field point under a moving finger).
- Poke on `down` immediately — no tap-vs-drag threshold. A pure tap fires
  no `move`, so pan/momentum never trigger; disambiguation falls out free.
- Momentum: EMA the drag velocity while held (`Math.min(1, dt*10)` idiom),
  integrate with `exp(-2.5·dt)` friction after release, snap to 0 below
  ~0.0005 uv/s. `cancel` (iOS system gestures) zeroes velocity — no fling.
- **VizHost clamps dt to 100ms** — a backgrounded tab's rAF pause would
  otherwise deliver one minutes-long dt that teleports every integrated
  quantity (glide, drift, fallback clock) on resume. Found the hard way.

## Dev tools reference

| Tool | What |
|---|---|
| `?t=140` | seed the song clock — jump to any act instantly |
| `?q=full` / `?q=lite` | force quality (Lite is default everywhere) |
| `?debug=1` | fps + quality HUD in the stage corner |
| `?solo=dust\|blobs\|sparks` | isolate a layer on a bright background (per-module) |
| `?sparks=always` | force sporadic events continuously (a1) |
| `window.__sv` | console handle: `host`, `engine`, `quality`, `mode` |

App modes (main.ts): `choose` (start overlay over the ambient
`src/viz/listening` scene) → `listening` (mic-driven; visuals revealed only
on a confirmed match, withdrawn on signal loss; no manual nav) or `browse`
(manual Prev/Next). New track modules need no mode awareness — implement
`Viz`, read `audio`, done.

## Track concepts (album arc: insect life from emergence to extinction)

Starting sketches only — concept per track is decided with the user:

- **a1 They Come Marching** ✅ — void → stirring dust → fragments →
  condensation into first forms → the march → dissolve.
- **a2 Homemakers** ✅ — the golden wall: hex comb + human rooms negotiating
  one wax surface; crawler agents build it; chalk-line wounds heal.
- **a3 Biome Dominoes** — interdependence and cascade: chains of elements
  triggering one another; one falls, others follow.
- **b1 Icky, Sticky, & Thriving** ✅ — the petri-dish biosphere: GPU
  Physarum vein networks (spore gold/orchid/chartreuse on aubergine),
  fruiting bodies, spore bursts; tap drops a nutrient. Alex's premise:
  "full life... many components and forms coming together, with all the
  ugliness... a full biosphere."
- **b2 Terminal Taxonomy** ✅ — misclassification as devastation (Alex's
  premise: AI systems evolving past small forgotten languages, erasing the
  distinction between micro-communities). Discrete SPECIMENS on catalogue
  paper — organic ink-rimmed silhouettes, each with its own hue,
  Turing-blotch skin, and unreadable procedural glyph script — scanned,
  labeled, and flattened into one rust machine catalogue on pale bone
  (the album's one light ground). `machineOrder` morphs the page from
  natural scatter to aligned museum-drawer rows as the catalogue wins.
  Signature: classification reticles + per-community glyph languages
  (hash-bit grammars: stroke-angle family, curvature, columns, rotation)
  collapsing to one fixed machine code. Poke = resistance (un-classifies).
  The long-orphaned `skinPattern` idea landed here as the stateless
  per-community fbm banding.
- **b3 Sterile Breath** ✅ — life scrubbed away (Alex's premise: "the
  album's ecosystems end here: a world sterilized, cleanliness as loss,
  the biosphere wiped to a clinical blank"). NOTE the shipped track
  deliberately inverts the sketch below: the piece is about the
  SCRUBBING, not the emptiness, so it stays dense and vibrant for ~87% of
  its runtime and the blank is the earned ending. Cushion-clump biomass
  (hot magenta/amber/rust-green on a bubbling warm-oxblood murk) is eaten
  by an advancing sterilization front; bass onsets fracture the tissue
  into shattered chips whose interiors show the surrounding colours
  warped out of alignment; healing fails discretely at 2:20 and failed
  cracks creep wider. Signature: the advancing boundary between two media.
  Closes on a1's lone-point seed image, value-inverted for the pale
  ground. Poke = re-bloom scrubbed ground (in the last act, only breath).
  - *Superseded sketch (kept as a warning): "the emptied world: barely
    anything left; the a1 void revisited, but hollow instead of
    expectant. Almost no events." That sketch, and TECHNIQUES.md §11's
    matching sparse/minimal recommendation, both PREDATE the July 2026
    art-direction reset and directly contradict its rules 1-3 (vibrancy
    required, density over scale, never still >15-20s). Building it
    literally would have shipped a screensaver. When an old per-track
    sketch conflicts with the reset, the reset wins — and say so out loud
    at concept time rather than quietly splitting the difference.*

## Known gaps / next opportunities

- **Bloom**: not yet added. Use the battle-tested WebGL `UnrealBloomPass`
  (EffectComposer) via the optional `Viz.render()` hook, Full quality only.
  Do NOT re-attempt the TSL bloom path.
- ~~`skinPattern` act param~~ — the Turing-spots-via-fragment-noise idea
  found its home as b2's per-community interior banding.
- `audio.frequency` (64 bins) untouched — spectrum-driven geometry is an
  open register for a2+.
- Phone verification of the full experience is still pending as of the a1
  ship — check with the user before assuming mobile is proven.
- ~~OPEN: the two album-wide audio-reactivity bugs are fixed in b3 only~~ —
  **DONE.** All six tracks are fixed and now run on `src/viz/lib/onset.ts`
  and `src/viz/lib/poisson.ts`. See the album-wide ratchet section above.
- **`src/viz/lib/` now exists** — `onset.ts` and `poisson.ts`, both pure
  TS and unit-tested. Still copy-and-adapted across modules: the
  `paramsAt`/`lerpParams`/`CROSSFADE_SECONDS` machinery, the momentum
  block, and the ping-pong sim class. The slot pool
  (`b3/pools.ts`) is on its second use and is the obvious next extraction;
  the onset detector should follow it, so the next fix happens once.
