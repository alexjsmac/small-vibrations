# small-vibrations

Visual album app for the Sunntack *Small Vibrations* LP (Aug 7 2026 release).
Deploys to GitHub Pages at base path `/small-vibrations/`.

## Design references

Before building or reworking a track visualization, read the two research
references in `docs/reference/`:

- `threejs-techniques-catalogue.md` — per-technique WebGL2/GLSL catalogue
  (stateless GPU particles, GPGPU ping-pong, boids, reaction-diffusion, SDF
  raymarching, …) matched to this repo's stack and per-track arcs.
- `audiovisual-structure-manual.md` — high-level structure manual for
  full-track visual arcs (act staging, audio-reactivity mapping, camera and
  transition design), oriented to the album's insect life-cycle theme.

## Workflow: branch → PR → green CI → merge

The workflow setup here is shared with alexjsmac's other site repos
(small-vibrations, bluheron-interactive, alexjsmac.github.io). When you change
it in one, change it in all three.

- `main` is protected by the `main` ruleset (`.github/rulesets/main.json`):
  a PR is required, the `CI` check must pass, force-pushes and deletion are
  blocked, and nobody can bypass it. There's no second approver (solo
  maintainer), so a green PR can be self-merged. Merges are squash-only.
- Work on a branch, open a PR, and merge it yourself once `CI` is green.
  Never push to `main` or bypass `CI`.
- Merging to `main` deploys to production via `.github/workflows/deploy.yml`.
- Before opening a PR, run `npm run verify`. `.github/workflows/ci.yml` runs
  the same script, so a local pass means a CI pass. It runs lint, typecheck,
  unit tests, build and the Playwright smoke test (first run: `npx playwright
  install --with-deps chromium`).
- Node version: `.nvmrc`. CI and deploy both read it.
- Dependabot (`.github/dependabot.yml`) opens grouped update PRs every Monday,
  after a 3-day cooldown (7 for majors). TypeScript >=7 is ignored until the
  lint/type tooling supports it.

## Deploys & PR previews

GitHub Pages serves from the **`gh-pages` branch** (Pages source must be set to
"Deploy from a branch" → `gh-pages` / root). Two workflows write to it:

- **`deploy.yml`** (push to `main`) builds with the default base
  `/small-vibrations/` and publishes to the branch **root** → the live site
  at `https://www.alexmaclean.ca/small-vibrations/`. It uses
  `clean-exclude: pr-preview/` so it never wipes open previews.
- **`preview.yml`** (every PR except Dependabot's, which would run new
  packages' install scripts with a write token) builds with `BASE_PATH=/small-vibrations/pr-preview/pr-<N>/`
  and publishes to `pr-preview/pr-<N>/` on the branch, then comments the live
  preview URL on the PR; it removes that subdir when the PR closes.

The base path is build-time only: `vite.config.ts` reads `process.env.BASE_PATH`
(default `/small-vibrations/`), and the app resolves the fingerprint DB and the
audio worklet off `import.meta.env.BASE_URL`, so a correct base at build time
makes everything load from the right subpath. Never hardcode the base elsewhere.

`.nojekyll` is written at the branch root on every production deploy — required
because branch-served Pages runs Jekyll by default.

## Test layout

- **Unit tests** are colocated as `src/**/*.test.ts` and are typechecked by
  `tsc --noEmit` (i.e. by `npm run build` itself) — a broken test type
  blocks the build on purpose. There's no reviewer to catch it otherwise.
  Run with `npm run test:unit` (Vitest).
- **Smoke test** lives in `tests/smoke/*.spec.ts` (Playwright), outside
  `src/`, and is not part of the typechecked/bundled app. Run with
  `npm run test:smoke`. It boots the built `dist/` via `vite preview` and
  drives a real (SwiftShader) Chromium — this is the only coverage for the
  integration failures unit tests can't see, including the two worst
  historical bugs: the entry-chunk top-level-await deadlock (black screen,
  render loop never starts) and silent WebGPU/WebGL black frames.
- **Pure, unit-testable surface**: `src/audio/dsp.ts` (the full fingerprint
  pipeline), `src/viz/random.ts`, `src/tracks.ts`, and each track's
  `sections.ts` (`paramsAt`/`arcAt` staging math). `src/quality/QualityManager.ts`
  needs a jsdom environment (`location`, `performance.now`, `EventTarget`) —
  see the `/** @vitest-environment jsdom */` docblock at the top of its test.
- **Not unit-testable — covered by the smoke test instead**: `VizHost`
  (WebGL), `AudioEngine` (Worker + `import.meta`), `MicInput`
  (AudioContext/AudioWorklet), and `match-worker`. Don't try to mock these
  into a unit test; extend `tests/smoke/app.spec.ts` instead.

## Fingerprint DB

`public/fp/db.bin` + `public/fp/manifest.json` are committed production
data — the in-browser matcher loads them directly, and CI never needs the
track masters (WAVs) to build or test. Regenerate only locally, from the
masters, with `npm run fingerprints` (or `npm run fingerprints -- --selftest`
to verify against noisy excerpts) — then commit the regenerated `db.bin`
and `manifest.json`. Bump `DSP.version` in `src/audio/dsp.ts` first if the
fingerprinting algorithm itself changed, or old and new fingerprints will
silently mismatch.
