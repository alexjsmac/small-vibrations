# Small Vibrations — Audiovisual Album Site

A QR-linked, framed audiovisual companion to the **Sunntack — Small Vibrations** vinyl release.

The site listens through the visitor's microphone, identifies which track is playing via in-browser audio fingerprinting, and renders a unique generative 3D visualization for that track. Visualizations are different on every play (per-play seed) and include a Lite/Full quality toggle so the same site looks great on a low-end laptop *or* an RTX 5080.

## Status

Implemented:

- Vite + TypeScript project
- Framed UI in the album's duotone palette (artist/album block, controls, mic status, catalog number), mobile-friendly (portrait layout, touch targets, safe-area insets)
- `QualityManager` with Full/Lite presets, an FPS-based auto-drop, and a Lite default on touch devices
- `VizHost` with a persistent canvas and dynamic per-track viz module loading
- Shared placeholder visualization that all 6 tracks point to (per-play seeded, quality-aware, audio-reactive)
- **Mic fingerprinting pipeline**: Shazam-style landmark hashing (`src/audio/dsp.ts`), offline DB builder (`scripts/build-fingerprints.ts` → `public/fp/`), mic capture via AudioWorklet (`src/audio/MicInput.ts`), matching in a Web Worker (`src/audio/match-worker.ts`), orchestrated by `src/audio/AudioEngine.ts`. On a confident match the site reveals the playing track's visuals and feeds live band energies + playback position to the viz.
- **Two entry modes**: "Tap to listen" (mic-driven — an ambient listening scene holds until a track is detected; no manual nav) and "browse without microphone" (manual Prev/Next).
- **Track 1 "They Come Marching" visualization** (`src/viz/a1-they-come-marching/`): staged by the track's measured song sections — curl-noise dust, marching-cubes forms, sporadic flashes/filaments, rust accent following the arc. See **[src/viz/BRIEFING.md](src/viz/BRIEFING.md)** — the working brief for authoring the remaining track visuals (architecture, performance playbook, aesthetic system, workflow).
- Keyboard shortcuts: ←/→ to switch tracks (browse mode), `q` to toggle quality

Not yet implemented:

- Visualizations for tracks a2–b3 (they share `src/viz/placeholder/`) — start from `src/viz/BRIEFING.md`
- Bloom on Full quality (planned: WebGL `UnrealBloomPass` via the `Viz.render()` hook)

## Run

```bash
npm install
npm run dev
```

Open <http://localhost:5173/small-vibrations/>. Tap to start listening (or browse manually with Prev/Next / arrow keys). Each load reseeds the visualization.

## Fingerprints

The committed `public/fp/db.bin` + `manifest.json` are precomputed from the track masters. To rebuild (e.g. after changing `src/audio/dsp.ts` — bump `DSP.version`):

```bash
npm run fingerprints -- "/path/to/masters" --selftest
```

The masters dir must contain one WAV per track named with the track number prefix (`01 …`, `02 …`). `--selftest` verifies the DB by matching noisy 10 s excerpts. Masters are read in place and never copied into the repo.

## Structure

```
src/
  main.ts                 boot, controls, mic overlay wiring
  tracks.ts               album metadata + tracklist
  ui/
    Frame.ts              framed shell, header/footer, mic overlay
    styles.css            duotone palette + chrome + mobile layout
  quality/
    QualityManager.ts     Full/Lite presets, FPS auto-detect
  audio/
    dsp.ts                shared fingerprint DSP (FFT, peaks, landmarks, matching)
    MicInput.ts           getUserMedia + AudioWorklet capture + analyser
    match-worker.ts       rolling-window matching off the main thread
    AudioEngine.ts        mic ⇄ worker orchestration, match hysteresis, AudioFrame
  viz/
    types.ts              Viz / VizContext / AudioFrame
    VizHost.ts            persistent canvas, dynamic module loader
    placeholder/index.ts  shared placeholder visualization
  assets/                 (sleeve art)
scripts/
  build-fingerprints.ts   WAV → landmark DB (public/fp/), --selftest
public/
  capture-worklet.js      AudioWorklet processor (mic PCM → main thread)
  fp/                     committed fingerprint database
```

## Tracklist

- A1. They Come Marching
- A2. Homemakers
- A3. Biome Dominoes
- B1. Icky, Sticky, & Thriving
- B2. Terminal Taxonomy
- B3. Sterile Breath
