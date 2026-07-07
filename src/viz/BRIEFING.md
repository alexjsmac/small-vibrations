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

- **Palette** (cyanotype sleeve, already in styles.css): cream `#ece4cf`,
  teal `#1f5d7a`, deep teal `#14465e`, ink `#05141c` (scene background),
  dim cyan `#9fd8c8` (particle low end), **rust accent `#c44d3a`**.
- The rust accent is precious — it follows the album's arc. In a1 it rises
  from 0 (void) to 0.45 (The March). Later tracks can own more of it
  (the album moves toward decay/heat), but it must never stop feeling rare.
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
- **a2 Homemakers** — construction/architecture: cells, combs, tunnels
  assembling; geometry accreting piece by piece.
- **a3 Biome Dominoes** — interdependence and cascade: chains of elements
  triggering one another; one falls, others follow.
- **b1 Icky, Sticky, & Thriving** — maximal teeming life: dense, wet,
  swarming textures; the album's peak of biomass.
- **b2 Terminal Taxonomy** — cataloguing the dying: specimens isolated,
  pinned, labeled; order imposed as life drains; rust ascendant.
- **b3 Sterile Breath** — the emptied world: barely anything left; the a1
  void revisited, but hollow instead of expectant. Almost no events.

## Known gaps / next opportunities

- **Bloom**: not yet added. Use the battle-tested WebGL `UnrealBloomPass`
  (EffectComposer) via the optional `Viz.render()` hook, Full quality only.
  Do NOT re-attempt the TSL bloom path.
- `skinPattern` act param exists but is unused since the WebGL rebuild —
  a surface-pattern idea (Turing spots via fragment noise) waiting for a
  home on b1/b2 forms.
- `audio.frequency` (64 bins) untouched — spectrum-driven geometry is an
  open register for a2+.
- Phone verification of the full experience is still pending as of the a1
  ship — check with the user before assuming mobile is proven.
