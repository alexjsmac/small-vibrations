# small-vibrations

Visual album app for the Sunntack *Small Vibrations* LP (Aug 7 2026 release).
Deploys to GitHub Pages at base path `/small-vibrations/`.

## Workflow: branch → PR → green CI → merge

`main` is protected: direct pushes are disabled (including for admins), a PR
is required, and the `CI` status check must pass. There is no second
approver (solo maintainer) — `required_approving_review_count` is 0, so a
green PR can be self-merged.

1. Work on a branch, never on `main`.
2. Open a PR. CI runs automatically (lint, typecheck, unit tests, build,
   Playwright smoke test).
3. Once `CI` is green, merge the PR yourself.
4. Merging to `main` auto-deploys to GitHub Pages via `.github/workflows/deploy.yml` — no
   separate deploy step.

Never commit or push directly to `main`, and never bypass the `CI` check.

## Deploys & PR previews

GitHub Pages serves from the **`gh-pages` branch** (Pages source must be set to
"Deploy from a branch" → `gh-pages` / root). Two workflows write to it:

- **`deploy.yml`** (push to `main`) builds with the default base
  `/small-vibrations/` and publishes to the branch **root** → the live site
  at `https://www.alexmaclean.ca/small-vibrations/`. It uses
  `clean-exclude: pr-preview/` so it never wipes open previews.
- **`preview.yml`** (every PR) builds with `BASE_PATH=/small-vibrations/pr-preview/pr-<N>/`
  and publishes to `pr-preview/pr-<N>/` on the branch, then comments the live
  preview URL on the PR; it removes that subdir when the PR closes.

The base path is build-time only: `vite.config.ts` reads `process.env.BASE_PATH`
(default `/small-vibrations/`), and the app resolves the fingerprint DB and the
audio worklet off `import.meta.env.BASE_URL`, so a correct base at build time
makes everything load from the right subpath. Never hardcode the base elsewhere.

`.nojekyll` is written at the branch root on every production deploy — required
because branch-served Pages runs Jekyll by default.

## Before opening a PR, run locally

```
npm run lint
npm run typecheck
npm run test:unit
npm run build
npm run test:smoke   # first run: npx playwright install --with-deps chromium
```

All five must pass — CI runs the same steps and will reject the PR otherwise.

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
