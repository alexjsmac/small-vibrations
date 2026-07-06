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

## Phase 1 — Concept (with the user, ~minutes)

Ask the artist for the track's inspiration in their own words: the imagery,
the feeling, what the track is "about", and any specific moments in the song
that matter to them. Their a1 description ("the beginning of time… elements
coming together to create the earliest forms of life") drove every design
decision that stuck — get the equivalent before touching anything. If
they've already given it in the conversation, don't re-ask.

## Phase 2 — Structure + treatment proposal (one approval gate)

1. Profile the master: `node scripts/profile-track.mjs "<master.wav>" [window]`
   (masters in `~/Downloads/Sunntack - Small Vibrations EP/`). Sustained
   level steps in the bar chart = section boundaries.
2. Draft the act table: cue times, act names, one line of musical character,
   one line of visual treatment per act — mapping the profile to the concept.
3. Propose the signature element: each track remixes the existing layer
   vocabulary (dust fields, metaball forms, filaments/flashes — extract to
   `src/viz/lib/` on second use) **plus one new element that belongs to this
   track alone**. One new invention per track keeps every track distinct
   without re-inventing everything.
4. Present the act table + signature element to the user and get agreement
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
- Respect the Lite/Full budgets and patterns in the briefing; check the
  `?debug=1` fps HUD as layers land, not at the end.

## Phase 4 — Contact sheet (self-review before human review)

Walk the whole arc yourself: screenshot at each act's midpoint plus at least
one crossfade boundary (`?t=<seconds>`), on Lite. Look at them critically —
composition, palette balance, whether adjacent acts are visibly different,
whether stills suggest motion. Fix the obvious before involving the user.
Present the set act-by-act with one line each on what to look at.

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

- [ ] Concept captured in the artist's words
- [ ] Master profiled → act table + signature element approved by user
- [ ] Module scaffolded, tracks.ts pointed at it
- [ ] Each layer solo-verified by screenshot (force switches for sporadic elements)
- [ ] Composed scene + events layer; fps HUD healthy on Lite
- [ ] Contact sheet: every act + one boundary, self-reviewed then presented
- [ ] Taste pass rounds until the user is happy
- [ ] Build green, committed; BRIEFING.md ratcheted; shared code extracted
