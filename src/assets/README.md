# Assets

Reference art. Nothing here is imported by the app — the shipped derivative
is `public/og-cover.jpg` (the share card), generated from `cover-front.png`.

**Check this list before treating a file here as final.** `cover-front.png`
used to be a jacket mock-up with "FRONT" printed across it, and it got
shipped as the share card on that basis.

- `cover-front.png` — **final art.** Front cover, 2000px, downscaled from the
  3735px master (which lives outside the repo).
- `cover-back.png`  — placeholder mock-up, not final.
- `marble-tile.png` — placeholder mock-up, not final.
- `Sunntack_MAR17.pdf` — **outdated proof.** A March jacket layout whose
  tracklist does not match the released record; `src/tracks.ts` is correct.
  Anything else read off this PDF is suspect for the same reason.

The current scaffold uses CSS-only chrome inspired by the sleeve palette
(`#ece4cf` cream, `#1f5d7a` teal, `#0a2230` ink). Once these files are
present, `src/ui/styles.css` and `src/ui/Frame.ts` can swap the procedural
border for the real artwork crops.
