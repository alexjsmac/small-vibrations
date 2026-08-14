# The Full-Track Visual Arc: A Reference Manual for Structuring Music Visuals in the Max Cooper / Generative-Audiovisual Tradition

**Purpose:** A durable design reference for AI coding agents building Three.js music visuals for the experimental electronic album *Small Vibrations* (themed on insect life cycles). It focuses on HIGH-LEVEL STRUCTURE — how to make a 4–8 minute audiovisual piece coherent and captivating across its whole duration — and secondarily on MID-LEVEL techniques (audio-reactivity mapping, camera, transitions, generative system design). It distills the working methods of Max Cooper and his collaborators (Maxime Causeret, Andy Lomas, Kevin McGloughlin, Nick Cobby, Jessica In, Thomas Vanz) and the broader audiovisual scene (Ryoji Ikeda, Weirdcore, Tarik Barri, Robert Hodgin, Memo Akten, Refik Anadol, Universal Everything, and the demoscene).

---

## PART 0 — TL;DR DIRECTIVES

1. **Score to a concept, not to the beat.** Max Cooper builds the idea/visual story first, then scores music to it. In his Electronic Groove interview about the *Earth* EP he states: "I generally build visual ideas and stories first, and then figure out the music from there." Every strong piece in this tradition has a *premise* (a system, a process, a transformation) that is established, developed, and paid off. Design the arc before the reactivity.
2. **Map structure to structure, not amplitude to brightness.** The single most important principle: musical *structure* (sections, motifs, development) should drive visual *structure* (system state, rule changes, recurring visual themes), while instantaneous audio features drive only surface detail.
3. **One system, transformed — not many systems, juxtaposed.** The most captivating works establish a single generative "world" and evolve its rules, scale, palette, and density over time, rather than cutting between unrelated eye-candy.

---

## PART 1 — HIGH-LEVEL STRUCTURE (primary focus)

### 1.1 The Premise → Development → Payoff spine

Across Max Cooper's audiovisual albums (*Emergence*, *One Hundred Billion Sparks*, *Yearning for the Infinite*, *Unspoken Words*, *On Being*), the recurring method is: **establish a simple visual system early, complicate it through the track, and resolve it.** Cooper describes his pipeline: "I start by writing stories that start from scientific concepts, then I go on to write the visual story that I communicate to visual artists and then I create music for that story." Crucially, the concept exists before the music, so the music and visuals enact the *same* underlying process.

The canonical example is **"Order from Chaos"** (video by Maxime Causeret/Teresuac, 2016), which is literally about the emergence of order from disorder. Cooper's brief to the artist (per Dezeen): "It's an emergent rhythm which I would like to mirror somehow in the visual, with an initially detailed and chaotic form which slowly develops into something with recognisable structure." Musically, Cooper seeded the track by recording rain on his skylight with binaural mics, then "gradually during the track force[d] them towards their nearest grid positions on a live-drum grid pattern" so "the initially random rain hits slowly produce an emergent rhythm." **The visual arc and the musical arc are the same arc.** This is the template: pick a process that has a natural beginning, middle, and end, and let both music and visuals enact it.

### 1.2 A structural blueprint agents can generalize (case study: "Order from Chaos")

Reconstructed phase order (timings approximate across the ~4-minute runtime; the *order* is documented by Cooper and reviewers on maxcooper.net, Colossal, Vice and Dezeen, but exact timecodes are not published):

1. **Opening — points/seeds on black (~0:00–0:30):** individual raindrop points/ripples ("fluorescent circles on a black backdrop"). Minimal, high-contrast, legible.
2. **Condensation into simple cells (~0:30–1:00):** ripples multiply and "squeeze together, forming cellular bodies."
3. **Cooperation → colonies (~1:00–1:30):** simple cells cluster into "more robust colonies of life."
4. **Endosymbiosis / integration (~1:30–2:00):** smaller organisms live inside larger cells, becoming interdependent.
5. **Competition for resources (~2:00–2:30):** organisms compete, "which spurs on their evolutionary development."
6. **Reaction–diffusion / Turing patterns (~2:30–3:00):** "simple chemical feedback mechanisms… yield complex flowing bands of colour."
7. **Swarming / flocking (~3:00–3:30):** "groups of individuals form beautiful dancing-like patterns."
8. **Climax — specialized complex forms (~3:30–end):** brain-like structures, jellyfish, plant/flower forms; per maxcooper.net, "a near-perfectly adapted form for every different ecological niche."

**Generalized arc:** disorder/points → simple units → aggregation → integration → differentiation/competition → pattern-formation & collective motion → climax of complex specialized organisms → resolution into ordered forms. This is a directly reusable skeleton — and it maps almost perfectly onto an insect life cycle (see Part 4).

### 1.3 Techniques for sustaining engagement over 4–8 minutes

- **Progressive revelation:** disclose the system gradually. Start legible and sparse; let complexity accrue. Never show your most complex state in the first 30 seconds.
- **Scale shifts (micro↔macro):** Cooper repeatedly exploits scale as a narrative device. In "Hope" (Thomas Vanz, *One Hundred Billion Sparks*), "something cosmological in appearance… turns out to be happening in a tiny part of just one of the one hundred billion neurones." A zoom that recontextualizes what you were looking at is one of the strongest single "moves" available.
- **Rule changes in generative systems:** the same system with one changed parameter yields a new "act." Andy Lomas, describing the "Seething" video to Dezeen (2014): "They all start with the same simple ball of cells, but by having slightly different rules and strengths of influences between the cells they transform into very different final forms." (He adds that the plant-like forms are "exactly the same system, but with one change… the light just comes from above.") Change rules on section boundaries.
- **Palette / material evolution:** treat color and material as a slow through-line that tracks the emotional arc, not a per-frame reactive parameter.
- **Density & complexity curves:** plan an explicit curve of visual density over the whole track (see Part 2), with deliberate returns to sparseness.
- **Restraint vs. saturation:** contrast is the engine of excitement. A saturated climax only reads as a climax if it was preceded by restraint. Cooper on "Repetition": "I kept it very stripped back to focus on the idea, with slow evolution and occasional variants to maintain some melodic engagement."

### 1.4 Mapping visual structure to musical structure

- **Section-level changes** (intro→build→drop→breakdown→outro) should trigger **system-level visual changes**: new rules, new palette, new camera regime, or a new spatial scale.
- **Phrase-level changes** (every 4/8/16 bars) should trigger **smaller variations**: seeding new agents, shifting a parameter, introducing a secondary element.
- **Visual motifs = musical motifs.** Establish a recognizable visual "theme" (a shape, a behavior, a color) and bring it back transformed, exactly as a musical motif recurs in variation. Recurrence-with-transformation is what makes a long piece feel composed rather than improvised. Kevin McGloughlin's "Repetition" is the extreme case: a single operation (repetition/nesting) is applied and escalated until it becomes "a form of infinity."

### 1.5 Narrative & quasi-narrative strategies in abstract work

Abstract work still benefits from an arc the viewer can *feel* even without a story. The strongest quasi-narratives in this tradition are **process arcs**:
- **Emergence / growth** (Lomas's Cellular Forms; "Order from Chaos"): from simplicity to complexity.
- **Decay / dissolution:** the reverse — from order back to disorder (useful for outros, and for the "death" phase of a life cycle; slime-mold decay is a natural fit).
- **Transformation / metamorphosis:** one coherent form becoming another. Cooper describes "Crystallis" as "this metamorphosis idea… all these growing pieces and reorganising… they're all a bit chaotic, but then it all comes together into this coherent harmonic structure."
- **Cause-and-effect within a system:** let visible events have visible consequences (a collision spawns growth; a swarm depletes a resource and disperses). This gives the viewer a sense of a world with its own physics.

### 1.6 Pacing principles

- **How long can one idea hold?** In this idiom, a single visual idea can hold roughly a musical section (~30–90s) before it needs a variation or complication. Beyond that without change, it reads as monotony.
- **When to introduce new elements:** on musical boundaries, and preferably one at a time. Introduce, let it register, then develop it.
- **Contrast & surprise:** reserve at least one genuine surprise (a scale flip, a rule inversion, a hard cut to negative space) for the back half.
- **Two failure poles to avoid:** monotony (nothing changes) and chaotic over-stimulation (everything changes at once). Aim for continuous, legible change.

### 1.7 A taxonomy of full-track visual arc archetypes

1. **The Emergence Arc** — sparse seeds → accreting complexity → specialized climax. (Order from Chaos; Lomas Cellular Forms.) Ideal for egg→adult.
2. **The Single-Object Contemplation** — one form, one continuous slow camera, growth over time; minimal cutting. (Lomas.) Ideal for pupa/metamorphosis.
3. **The Infinite/Repetition Arc** — a simple operation (repetition, nesting, symmetry) iterated toward the overwhelming. (McGloughlin's "Repetition," "Waves.") Ideal for swarms and mass behavior.
4. **The Data-Build Arc** — from single points to dense fields of structured data, using velocity and density as the excitement engine. (Ryoji Ikeda *datamatics/test pattern*, whose imagery moves "some hundreds of frames per second" as "a response test for the audience's perceptions.")
5. **The Journey-Through-Space Arc** — a continuous flight through a coherent 3D world where position determines what is seen/heard. (Tarik Barri's *Versum*.)
6. **The Transformation/Metamorphosis Arc** — coherent form A dissolves/reorganizes into coherent form B. (Cooper "Crystallis"; Universal Everything's transfiguration works.)
7. **The Controlled-Overload Arc** — escalating glitch/intensity toward sensory saturation. (Weirdcore for Aphex Twin — a deliberate "psychological overload"; use sparingly and with restraint elsewhere to earn it.)

---

## PART 2 — SECTION-BY-SECTION MAPPING GUIDE

Electronic tracks generally move through **intro → build → drop/peak → breakdown → (build → drop) → outro**, organized around tension-and-release energy cycles. Treat each section as a distinct visual regime:

- **Intro:** Establish the premise with maximum legibility and minimum density. One element, high contrast, often on black/negative space. Introduce the core visual motif that will recur. This is where you "seed" the system.
- **Build:** Rising energy = rising visual density/complexity. Add agents, open up spatial scale, accelerate motion, tighten camera. Use musical risers/filter sweeps as literal visual cues (a filter sweep opening = brightness/scale/particle-count ramp). Anticipation should be visible.
- **Drop / Peak:** The payoff. Maximum density, full palette, the system's most complex or fully-realized state. This is the moment the premise "pays off." Reserve your highest particle counts, strongest bloom, and boldest camera move here.
- **Breakdown:** Contrast and rest. Strip back to atmosphere. Return toward the sparseness of the intro (recurrence-with-transformation), giving the eye a reset and making the next drop hit harder. A great place for a scale shift or a quiet single-object moment.
- **Outro:** Resolution or decay. Either resolve to an ordered final form (arrival) or dissolve back toward the seed (return/death). Mirror the intro to close the loop.

**Energy-curve rule:** sketch a single 0–1 "energy" envelope for the whole track and bind macro visual parameters (global density, camera speed, palette temperature, post-processing intensity) to it. This guarantees the visuals breathe with the music at the structural level even before any per-frame reactivity is added. This mirrors the demoscene practice of a synchronized timeline (e.g. the "Rocket" tool), where keyframe tracks are placed on a beat-aligned grid so "audio cues trigger graphical effects precisely."

---

## PART 3 — MID-LEVEL TECHNIQUES

### 3.1 Audio-reactivity mapping — the core principle

**Map structure-to-structure, not just amplitude-to-brightness.** Everything reacting to one signal produces chaos where "everything moves at once, important musical moments get lost, and the visuals don't feel connected to the structure of the sound." Separate the audio into bands and give each a *job*. Three distinct response types:

1. **Direct / 1:1 (fast):** transients, kick, hi-hats → momentary events (flashes, particle spawns, camera shake). Use for high frequencies and percussive hits.
2. **Enveloped / smoothed (slow):** RMS energy, bass → sustained parameters (global scale, camera drift, emission rate). Apply per-band smoothing — slower smoothing on bass ("weighty, substantial feel"), faster on highs ("immediate, sparkly response").
3. **Event-triggered state changes:** detected section boundaries / onsets → discrete visual state transitions (rule changes, palette swaps, scene switches). **This is the layer most amateur visualizers omit, and it's what creates structure.**

### 3.2 Suggested mapping table

| Musical feature | Response type | Good visual targets | Avoid |
|---|---|---|---|
| Kick / downbeat | Direct, momentary | Scale pulse, ground ripple, bloom spike | Mapping to hue (jitter) |
| Sub-bass / RMS | Smoothed envelope | Global density, displacement amplitude, camera dolly speed | Instant 1:1 (looks twitchy) |
| Snare / clap | Event / momentary | Particle burst, vignette pull-in, chromatic offset | Continuous scale |
| Hi-hats / transients | Direct, fast-smoothed | Fine texture, sparkle, high-freq shader noise | Large-scale geometry |
| Mid-range / melody contour | Medium smoothing | Camera drift, color temperature, flow-field direction | Kick-speed pulsing |
| Spectral centroid / brightness | Smoothed | Palette temperature, emissive intensity | — |
| Section boundary (event) | Discrete trigger | Rule change, palette swap, camera regime change, scene cut | Gradual-only response |

**Tuning rule:** balance sensitivity and stability — "overreaction creates jitter; underreaction feels disconnected." Normalize each band to 0–1, then tune scaling curves, smoothing, and thresholds per mapping. Do not map every band to every parameter. Keep one normalized "audio_controls" object that all scenes read from, rather than each scene re-analyzing the raw signal.

### 3.3 Camera design

Camera is a narrative device, not a passive observer.
- **Single continuous move (contemplative):** Andy Lomas's morphogenetic pieces are the exemplar — one growing object, one slow camera, letting form develop over time. Lomas (to Dezeen): "Each animation is basically showing a simulated growth system as it develops over time." Best for pupa/metamorphosis and for breakdowns. Use slow dolly/orbit.
- **Kinetic montage (rapid-cut):** Kevin McGloughlin's style — rapid, rhythmic cuts, nested/repeated imagery, painstaking shape-masking, motion synced to the beat. Best for builds, swarms, high-energy peaks.
- **Choreograph camera to sections:** change camera *regime* (not just position) on section boundaries. A single continuous move across a whole section reads as confidence; cut only when the music cuts.
- **Journey-through-space:** Tarik Barri's *Versum* treats the camera flight itself as the composition. Barri (to Crack Magazine): "When I then fly through this space with a joystick, we hear all the sounds I fly towards, which in effect means that my path through 3D space determines the melodies and rhythms we hear." A continuous forward flight is a powerful spine for an entire track.

### 3.4 Scene & state transitions

- **Hard cuts on downbeats:** the safest, most musical cut. Align every scene change to a strong beat or section boundary.
- **Crossfade / morph between systems:** for smoother, organic transitions (metamorphosis).
- **Use musical transitions as visual transition cues:** a filter sweep, riser, or snare roll is an explicit instruction to transform the visuals. Bind them.
- **Feedback / trails** for continuity across a transition.

### 3.5 Generative system design for musicality

- **Design a "playable" parameter space:** expose a small set of high-level parameters (roughly 5–15) that meaningfully change the output. Lomas's system is the model — as documented in the deep-learning study by Grabe et al. (arXiv:2004.06874), "A vector of just 12 real valued parameters determines the resultant form, which grows from a single cell into complex forms often involving more than one million cells." These parameters become the "keys" you play across the track.
- **Prefer systems with inherent growth/decay dynamics** — they give you a built-in beginning/middle/end (cellular growth, reaction-diffusion, flocking, differential growth, slime mold). Note the scale these systems reach: per Lomas's 2014 Bridges Conference statement, "the simulation process is repeated over thousands of iterations and millions of particles, with typical final structures having over fifty million cells."
- **Seed variation so repetition stays fresh:** compute per-agent randomness from index/hash rather than fixed values (a common GPU technique that also saves memory); vary seeds each section so a returning motif is recognizable but not identical.
- **Let rules, not keyframes, carry the motion** — Robert Hodgin's "controlled form of randomness" is more alive than hand-animation and far cheaper to sustain over 8 minutes: "You're constantly surprised that this simple setup is able to turn into something sublime."

### 3.6 Color, light & material evolution

Treat palette as a slow narrative through-line bound to the energy envelope: cool/dark at the seed, warming and saturating toward the peak, resolving or desaturating at the outro. Reserve your most saturated palette and strongest emissive/bloom for the drop. Material evolution (matte→translucent→iridescent) can itself narrate a metamorphosis. Refik Anadol's fluid-dynamics "data paintings" are a reference for using continuous, flowing color transitions as a hypnotic through-line rather than reactive flicker.

### 3.7 Three.js-relevant implementation notes (design-level)

- **Particles at scale:** CPU particle updates bottleneck around ~50,000 particles; GPGPU / compute-shader approaches (Three.js `GPUComputationRenderer`, or WebGPU + TSL `instancedArray`/`storage`) push this to hundreds of thousands to millions by keeping position/velocity in "persistent GPU buffers that survive across frames." Use this for swarms, dust, spores.
- **Instanced meshes** (`InstancedMesh`) for repeated 3D bodies (cells, insects, debris) — one draw call for many objects sharing geometry/material.
- **Flow-field particles** (GPGPU, using a texture/FBO ping-pong so trajectories persist frame to frame) for organic drifting motion and swarm currents.
- **Post-processing as structural tool:** bloom (peaks), feedback/trails (continuity, organic smear), glitch/datamosh/chromatic aberration (controlled-overload sections, à la Weirdcore's "pixel sorting" and "datamoshing"). Bind post intensity to the energy envelope, not just to instantaneous amplitude.
- **Shader-driven displacement** for growth, breathing, and reaction-diffusion surfaces; reaction-diffusion and slime-mold (Physarum) simulations run well as ping-pong fragment shaders operating on textures.
- **Performance discipline:** render at stable frame rate; update audio analysis at lower frequency than render if needed (e.g. every other frame); avoid draw-call-heavy scenes.

---

## PART 4 — ORGANIC/BIOLOGICAL MOTIFS & THE INSECT LIFE CYCLE

### 4.1 The generative-biology toolkit (map each to a life stage)

- **Reaction–diffusion (Turing patterns):** chemical feedback yielding "complex flowing bands of colour"; among "the first methods to compellingly simulate natural pattern formation via PDEs, especially biological pigmentation patterns." Ideal for egg surfaces, wing-scale patterning, chrysalis textures.
- **Differential growth:** vertices moving under attraction/repulsion along curves/surfaces; ideal for larval body segmentation and folding.
- **L-systems:** recursive branching rules that "guide the growth and branching patterns of simulated plants through iterative processes"; ideal for antennae, tracheal networks, plant substrate.
- **Boids / flocking (Reynolds 1987):** alignment + cohesion + separation; ideal for swarm/adult phase. A documented mini-arc: begin with "separation dominates, creating erratic and fragmented movement," then "as the system develops, the forces balance, bringing order and shared direction" — chaos → development → harmony. Use this as a self-contained arc within the swarm section.
- **Cellular growth (Lomas model):** interconnected cells split on accumulated "nutrient" — "when the nutrient level in a cell exceeds a given threshold the cell splits into two." Ideal for pupal reorganization and emergence.
- **Slime mold (Physarum):** agents deposit/follow trails, reinforcing "optimal pathways"; "favorable conditions generate a positive response and an accelerated growth while poor conditions lead to decay." Ideal for nutrient-seeking larvae and decay networks.

### 4.2 The holometabolous life cycle as a ready-made full-track/album structure

Complete metamorphosis has four stages — **egg → larva → pupa → adult (imago)** — where, per NC State Entomology, "the larval stage is a period of active feeding and growth. The pupal stage is a period of reconstruction: larval tissues are broken down (histolyzed) and rebuilt according to the adult body plan. The adult stage is a period of dispersal and reproduction." This is a gift of a narrative spine because each stage has a distinct visual character AND a distinct energy level:

| Stage | Musical section | Visual regime | Generative system | Energy |
|---|---|---|---|---|
| **Egg** | Intro | Sparse points/spheres on black; reaction-diffusion surface patterning; slow | RD, single instanced sphere | Low |
| **Larva** | Build 1 | Segmented growth, feeding, accumulation; density rising | Differential growth, slime-mold nutrient seeking | Rising |
| **Pupa** | Breakdown / contemplative | Single object, slow continuous camera; internal dissolution & reorganization (histolysis) — matter breaking down then re-forming | Cellular growth, morphing/feedback | Low-tense (suspended) |
| **Emergence (eclosion)** | Build 2 → drop | Unfolding, expansion, first flight; palette warms and saturates | Differential growth → particle unfurl | Peak |
| **Swarm / adult** | Peak / climax | Mass flight, flocking "dancing-like patterns," repetition toward the overwhelming | Boids/GPGPU particles | Highest |
| **Death / rebirth** | Outro | Dispersal, decay networks, return to seeds/points (loop closure) | Slime-mold decay, particle dissolution | Falling → resolve |

This gives *Small Vibrations* a natural per-track template (a single metamorphosis) and a natural album template (the cycle across tracks, ending where it began — egg → … → new eggs). Note that hemimetabolous insects (egg → nymph → adult, no pupa) offer a simpler three-act variant for shorter/less climactic tracks.

### 4.3 Motif recurrence for the album

Establish a recurring visual "gene" — e.g., a specific point/particle that is the egg, the ion, the seed — and let it reappear at every scale and stage, transformed. Cooper's whole practice is built on "looking for foundations" and on the observation that simple systems "contain a huge amount of visual richness, and for me they are more meaningful than more recognisable everyday scale imagery." The point-that-becomes-everything is your unifying motif across the whole record.

---

## PART 5 — COMMON FAILURE MODES TO AVOID

1. **Amplitude-to-brightness reductionism:** everything pulsing to overall volume. Fix: band-split + structure-driven state changes.
2. **Structureless noodling:** endlessly pretty but going nowhere; no premise, no development, no payoff. Fix: commit to a process arc before coding.
3. **Monotony:** one idea held too long (>~90s unchanged). Fix: variation at every phrase, complication at every section.
4. **Over-reactivity / jitter:** every parameter twitching on every transient. Fix: smoothing envelopes; reserve fast response for a few surface details only.
5. **Chaotic over-stimulation:** everything changing at once, all bands mapped to all parameters. Fix: one change at a time, on musical boundaries; each band has one job.
6. **Premature climax:** showing the densest/most complex state in the first minute, leaving nowhere to go. Fix: progressive revelation; ration your maximum.
7. **Unmotivated cuts:** scene changes that don't align with the music. Fix: cut on downbeats/section boundaries only.
8. **No restraint:** constant saturation, so nothing reads as a peak. Fix: engineer contrast; use breakdowns and negative space to earn the drops.
9. **Many systems juxtaposed instead of one transformed:** a slideshow of unrelated effects. Fix: one coherent world, evolving rules.
10. **Ignoring scale:** staying at one zoom level the whole track. Fix: at least one micro↔macro shift that recontextualizes the image.

---

## PART 6 — QUICK DESIGN CHECKLIST (per track)

- [ ] What is the one-sentence premise (the process/transformation)?
- [ ] Which life-cycle stage(s) does this track cover, and what is its energy curve (sketch 0–1 envelope)?
- [ ] What is the core visual motif that will recur transformed?
- [ ] One generative system with inherent growth/decay dynamics chosen?
- [ ] Section map: what system-level change happens at each intro/build/drop/breakdown/outro?
- [ ] Audio mapping: each band assigned exactly one job; smoothing set per band; section-boundary events wired to state changes?
- [ ] Camera regime per section (continuous vs. cut) decided?
- [ ] Where is the restraint that earns the climax?
- [ ] At least one scale shift and one genuine surprise in the back half?
- [ ] Does the outro resolve or return-to-seed (loop closure)?

---

## APPENDIX — SOURCE ORIENTATION FOR DEEPER STUDY

- **Max Cooper's own concept notes:** maxcooper.net (per-video "Work" pages), emergence.maxcooper.net, ohbs.maxcooper.net — each documents the concept behind a track; the single richest primary source for the "score-to-concept" method.
- **Andy Lomas:** andylomas.com (Cellular Forms / Morphogenetic Creations); his AISB-50 paper "Cellular Forms: an Artistic Exploration of Morphogenesis"; Goldsmiths talks — for growth-system design and single-object contemplative pacing.
- **Maxime Causeret:** onepointfour.co interview (Houdini workflow for "Order from Chaos").
- **Kevin McGloughlin:** Creative Boom / Booooooom interviews — repetition, nesting, kinetic editing.
- **Ryoji Ikeda:** ryojiikeda.com (*datamatics*, *test pattern*) — data-build arcs and perceptual-threshold intensity.
- **Tarik Barri:** tarikbarri.nl and Crack Magazine — *Versum* journey-through-space model.
- **Robert Hodgin:** roberthodgin.com / Art Blocks interviews — flocking and "controlled randomness."
- **Memo Akten, Refik Anadol, Universal Everything, Weirdcore:** for latent-space/fluid aesthetics, generative "lifeforms," and controlled-overload glitch respectively.
- **Technique references:** Three.js Journey (GPGPU flow-field particles), Codrops (GPGPU particle tutorial), TouchDesigner audio band-split guides (for the "each band has one job" mapping discipline), and demoscene timeline tools (GNU Rocket) for beat-aligned keyframe synchronization.