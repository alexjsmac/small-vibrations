---
name: track-viz
description: The full authoring process for a Small Vibrations per-track visualization, from concept to shipped. Use this whenever the user wants to create, continue, tune, or review the visuals for any album track (a2/Homemakers, a3/Biome Dominoes, b1/Icky Sticky & Thriving, b2/Terminal Taxonomy, b3/Sterile Breath, or revisions to a1/They Come Marching) — including casual phrasings like "let's do the next track", "start on Homemakers", "the b2 visuals", or "make the visuals for track 3". Also use it when adjusting act timing, palettes, particle behavior, or audio reactivity of an existing track module.
---

# Track Visualization Authoring

The process that turns a track master + the artist's concept into a shipped,
staged, audio-reactive visualization. It exists because the a1 build taught
us where time actually goes: not into shaders, but into (a) building the
wrong concept, (b) debugging blind, and (c) taste round-trips. The process
puts one cheap alignment gate up front, makes the build self-verifying in
the middle, and concentrates human taste at the end where it's decisive.

**Required reading before any build work: `src/viz/BRIEFING.md`.** It holds
the technical system — module anatomy, staging architecture, performance
playbook, palette, dev tools. This skill is the *process*; the briefing is
the *knowledge*. Don't duplicate it, follow it.

**Technique selection: `src/viz/TECHNIQUES.md`.** A researched, WebGL2-vetted
catalogue of methods (particles, GPGPU, boids, accretion, physics cascades,
wet surfaces, raymarching, post, typography, minimalism) with per-track
recommendations, Full/Lite budgets, and mobile fallbacks. Consult it in
Phase 2 when proposing the signature element, and again in Phase 3 for
implementation specifics and decision thresholds (e.g. when to use Rapier
vs an authored wave, when transmission must drop to matcap on Lite).

**Structural design: `src/viz/ARC.md`.** The full-track visual-arc manual
(Max Cooper / generative-audiovisual tradition): premise→development→payoff
spines, arc archetypes, section→system mapping, audio-reactivity discipline
("each band has one job"; the three response types), camera regimes, pacing
rules, and the failure-mode list. Techniques make a scene; ARC.md makes it
a *piece*. Use it in Phase 2 to design the arc, and its Part 5 failure
modes as the Phase 4 self-review rubric.

## Phase 1 — Concept (with the user, ~minutes)

Ask the artist for the track's inspiration in their own words: the imagery,
the feeling, what the track is "about", and any specific moments in the song
that matter to them. Their a1 description ("the beginning of time… elements
coming together to create the earliest forms of life") drove every design
decision that stuck — get the equivalent before touching anything. If
they've already given it in the conversation, don't re-ask.

Distill what they say into a **one-sentence premise — a process or
transformation with a natural beginning, middle, and end** (ARC.md Part 0:
score to a concept, not to the beat). The premise is what the whole track
enacts; if you can't state it in one sentence, Phase 2 will produce
staging without a story.

## Phase 2 — Structure + treatment proposal (one approval gate)

1. Profile the master: `node scripts/profile-track.mjs "<master.wav>" [window]`
   (masters in `~/Downloads/Sunntack - Small Vibrations EP/`). Sustained
   level steps in the bar chart = section boundaries.
2. Draft the act table: cue times, act names, one line of musical character,
   one line of visual treatment per act — mapping the profile to the concept.
   Design it as an **arc, not a sequence of looks** (ARC.md Parts 1–2):
   - Pick the arc archetype (§1.7) the premise implies; sketch the track's
     0–1 energy envelope and bind macro params (density, camera pace,
     palette temperature) to it, not just per-act values.
   - One system, transformed — acts are **rule/regime changes** to the one
     world, never a switch to a different world.
   - Name the **recurring motif** and where it returns transformed —
     including loop closure: the outro should resolve to, or return to,
     the intro's seed image.
   - Ration the maximum: the densest, most saturated state appears exactly
     once, and the act before it must be the restraint that earns it.
   - Place at least one **scale shift or genuine surprise in the back half**.
   - Give each act its own **camera regime** (continuous contemplative vs.
     kinetic; regime changes on section boundaries only).
3. Propose the signature element: each track remixes the existing layer
   vocabulary (dust fields, metaball forms, filaments/flashes — extract to
   `src/viz/lib/` on second use) **plus one new element that belongs to this
   track alone**. One new invention per track keeps every track distinct
   without re-inventing everything.
4. Plan the audio mapping with the "each band has one job" table (ARC.md
   §3.1–3.2): every band/feature gets exactly one visual job, with the
   right response type — fast-direct (transients→events), smoothed
   (bass/RMS→sustained params), or **discrete state changes on section
   boundaries** (the layer amateur visualizers omit). Big drops deserve a
   *discrete* visible hit, not only a 6s crossfade.
5. Present the act table + signature element to the user and get agreement
   **before building**. This is the cheapest moment to be wrong in the
   whole pipeline.

## Phase 3 — Build (autonomous, self-verifying)

Scaffold `src/viz/<id>-<slug>/` from the a1 module's shape (`sections.ts`,
one file per layer, `index.ts` composition), point `src/tracks.ts` at it,
then build **one layer at a time**:

- Get each layer on screen alone (`?solo=<layer>`, bright background)
  with a verified screenshot before composing. Never stack unverified layers
  — when two unproven things are wrong at once, debugging cost explodes.
- Give sporadic elements a force switch (like a1's `?sparks=always`) the
  moment they're created, so screenshots can catch them.
- Keep every tunable in `sections.ts` act params — taste notes later must
  translate to one-number edits, not refactors.
- Implement `Viz.pointer?()` — every track responds to touch (see the
  briefing's Interaction section: poke = inject life/energy, drag = pan;
  never a UI widget).
- Respect the Lite/Full budgets and patterns in the briefing; check the
  `?debug=1` fps HUD as layers land, not at the end.

## Phase 4 — Contact sheet (self-review before human review)

Walk the whole arc yourself: screenshot at each act's midpoint plus at least
one crossfade boundary (`?t=<seconds>`), on Lite. Look at them critically —
composition, palette balance, whether adjacent acts are visibly different,
whether stills suggest motion. Then audit the sheet against ARC.md Part 5's
failure modes — especially: monotony (any single state held >~90s unchanged,
watch long climaxes), premature climax, no restraint before the peak, missing
scale shift, and gradual-only transitions at the big musical hits. Fix the
obvious before involving the user. Present the set act-by-act with one line
each on what to look at.

## Phase 5 — Taste pass (the user, the decisive step)

The user reviews on real hardware — ideally with the record playing through
the real mic, since onset-driven events only prove themselves against real
audio. Translate their notes (however impressionistic — "act 3 feels empty",
"too red too early") into specific `sections.ts` values, state the numbers
changed, and re-screenshot only the affected acts. This loop should be
minutes per round; if a note can't be honored by turning existing knobs,
say so and propose the smallest structural change.

## Phase 6 — Ship + ratchet

1. `npm run build` green; walk-through screenshots done; commit with a
   summary of acts and elements. Deploy only when the user asks.
2. **Ratchet:** append anything learned to `src/viz/BRIEFING.md` (new
   technique, new pitfall, revised budget), and extract any layer used by
   two tracks into `src/viz/lib/`. Each track must make the next one faster.

## Checklist (paste into a task list at start)

- [ ] Concept captured in the artist's words → one-sentence premise
- [ ] Master profiled → act table (arc archetype, energy envelope, motif +
      loop closure, back-half surprise, camera regimes, band-job audio map)
      + signature element approved by user
- [ ] Module scaffolded, tracks.ts pointed at it
- [ ] Each layer solo-verified by screenshot (force switches for sporadic elements)
- [ ] Composed scene + events layer; fps HUD healthy on Lite
- [ ] Pointer response implemented + verified (tap = poke/ripple, drag = pan with momentum)
- [ ] Contact sheet: every act + one boundary, self-reviewed then presented
- [ ] Taste pass rounds until the user is happy
- [ ] Build green, committed; BRIEFING.md ratcheted; shared code extracted
