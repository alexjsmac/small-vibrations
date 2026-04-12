# Assets

Drop the album sleeve files here when ready:

- `cover-front.png` — front of the gatefold (Sunntack / Small Vibrations)
- `cover-back.png`  — back of the gatefold (tracklist + cracked-marble texture)
- `marble-tile.png` — optional cropped tileable section of the back-cover
  marble for the UI frame border

The current scaffold uses CSS-only chrome inspired by the sleeve palette
(`#ece4cf` cream, `#1f5d7a` teal, `#0a2230` ink). Once these files are
present, `src/ui/styles.css` and `src/ui/Frame.ts` can swap the procedural
border for the real artwork crops.
