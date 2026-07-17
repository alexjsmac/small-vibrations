// Generates the PWA/Add-to-Home-Screen icons from a small inline SVG mark.
// No new dependency: rasterizes with Playwright's already-installed Chromium
// (a devDependency for tests/smoke) rather than pulling in node-canvas.
//
// Output — public/icons/icon-192.png, icon-512.png, apple-touch-icon.png —
// is a committed artifact, same pattern as public/fp/db.bin: regenerate
// locally and commit the PNGs whenever the mark changes; nothing at
// build/deploy time depends on this script running.
//
// Usage: node scripts/make-icons.mjs
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, '..', 'public', 'icons');
mkdirSync(outDir, { recursive: true });

// Aubergine ground (#08202e, matches --deep), a spore-gold ring echoing the
// petri-dish rim of the b1 visuals, cream "SV" in a Zilla-Slab-ish serif
// fallback. Ring + glyph sit inside the ~80% "safe zone" so the maskable
// variant isn't clipped when a platform applies its own mask shape.
const svg = (size) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#08202e"/>
  <circle cx="256" cy="256" r="178" fill="none" stroke="#c9a24b" stroke-width="9"/>
  <circle cx="256" cy="256" r="156" fill="none" stroke="#c9a24b" stroke-width="2" opacity="0.55"/>
  <text x="256" y="292" text-anchor="middle"
        font-family="Georgia, 'Zilla Slab', serif" font-size="168" font-weight="700"
        fill="#ece4cf">SV</text>
</svg>`;

const targets = [
  { file: 'icon-192.png', size: 192 },
  { file: 'icon-512.png', size: 512 },
  { file: 'apple-touch-icon.png', size: 180 },
];

const browser = await chromium.launch();
try {
  for (const { file, size } of targets) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.setContent(`<!doctype html><html><body style="margin:0;padding:0">${svg(size)}</body></html>`);
    const dest = path.join(outDir, file);
    await page.screenshot({ path: dest });
    console.log(`wrote ${dest} (${size}x${size})`);
    await page.close();
  }
} finally {
  await browser.close();
}
