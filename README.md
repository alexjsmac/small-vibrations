# Small Vibrations — Audiovisual Album Site

A QR-linked, framed audiovisual companion to the **Sunntack — Small Vibrations** vinyl release.

The site listens through the visitor's microphone, identifies which track is playing via in-browser audio fingerprinting, and renders a unique generative 3D visualization for that track. Visualizations are different on every play (per-play seed) and include a Lite/Full quality toggle so the same site looks great on a low-end laptop *or* an RTX 5080.

## Status

This is a scaffold. Implemented:

- Vite + TypeScript project
- Framed UI in the album's duotone palette (artist/album block, controls, mic status, catalog number)
- `QualityManager` with Full/Lite presets and an FPS-based auto-drop
- `VizHost` with a persistent canvas and dynamic per-track viz module loading
- Shared placeholder visualization that all 6 tracks point to (per-play seeded, quality-aware, audio-reactive hooks already in place)
- Keyboard shortcuts: ←/→ to switch tracks, `q` to toggle quality

Not yet implemented (waiting on master audio):

- `src/audio/MicInput.ts`, `src/audio/Fingerprint.ts`, `src/audio/Matcher.ts`
- `scripts/build-fingerprints.ts` (offline pre-compute step)
- Per-track visualizations (currently all 6 share `src/viz/placeholder/`)
- Switch from `WebGLRenderer` → `WebGPURenderer` once we start authoring real visuals

## Run

```bash
npm install
npm run dev
```

Open <http://localhost:5173>. Use Prev/Next or arrow keys to step through tracks. Each load reseeds the visualization.

## Structure

```
src/
  main.ts                 boot, controls, fullscreen
  tracks.ts               album metadata + tracklist
  ui/
    Frame.ts              framed shell, header/footer
    styles.css            duotone palette + chrome
  quality/
    QualityManager.ts     Full/Lite presets, FPS auto-detect
  viz/
    types.ts              Viz / VizContext / AudioFrame
    VizHost.ts            persistent canvas, dynamic module loader
    placeholder/index.ts  shared placeholder visualization
  assets/                 (drop sleeve art here)
```

## Tracklist

- A1. Biome Dominoes
- A2. Marching Under Foot
- A3. Without bee, without me
- B1. Hidden Collateral
- B2. Sticky, slimy, and thriving
- B3. Sterile Earth
