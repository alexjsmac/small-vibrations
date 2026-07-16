/**
 * Headless smoke test — the app's only integration-level coverage. Exists
 * specifically to catch the two worst historical production bugs:
 *   1. The entry-chunk top-level-await deadlock: the render loop never
 *      starts, and the stage stays a black screen forever.
 *   2. Silent WebGPU/WebGL black frames: the loop runs (frames tick, FPS is
 *      nonzero) but nothing visible is actually drawn.
 * `window.__sv.quality.avgFps()` is 0 until the render loop has ticked at
 * least once, so it's the direct signal for "the loop actually started" —
 * waiting on it (not a timeout) is what makes bug #1 unmistakable. A
 * `.stage` screenshot's mean luminance is the signal for bug #2.
 *
 * IMPORTANT: page.goto() paths here must have NO leading slash. baseURL is
 * 'http://localhost:4173/small-vibrations/' (the Pages subpath) — a leading
 * slash escapes that base and 404s.
 */
import { test, expect, type Page } from '@playwright/test';
import { PNG } from 'pngjs';

/**
 * Below this mean luminance (0-255, computed over every 4th pixel of the
 * `.stage` screenshot) we consider the stage "black" — i.e. the render loop
 * silently failed to draw anything visible, even though it's ticking.
 * Calibrated 2026-07-11 against real local runs at ?t=140: lite measured
 * 75–79/255, full measured 44–46/255 (the per-play seed varies field
 * density, so expect run-to-run spread). 15 keeps ~3x margin below the
 * dimmest measured tier while still catching a genuinely black stage
 * (which measures near the nebula floor, < 5).
 */
const MIN_MEAN_LUMINANCE = 15;

/** `?t=140` seeds the song clock to a bright, dense act (see the per-track
 * sections.ts files) so a black-frame regression isn't masked by a
 * naturally-dark moment in the visuals. `debug=1` adds the FPS HUD, which
 * is harmless here and useful when eyeballing a failure trace. */
const BRIGHT_ACT_QUERY = '?t=140&debug=1';

async function waitForRenderLoop(page: Page) {
  await page.waitForFunction(() => (window as any).__sv?.quality?.avgFps() > 0);
}

/** Screenshot the `.stage` locator via the compositor (not canvas.toDataURL,
 * which is blank — the WebGL context has no preserveDrawingBuffer) and
 * return its mean perceptual luminance. */
async function stageMeanLuminance(page: Page): Promise<number> {
  const buffer = await page.locator('.stage').screenshot();
  const png = PNG.sync.read(buffer);
  let sum = 0, count = 0;
  for (let i = 0; i < png.data.length; i += 4 * 4) { // every 4th pixel, RGBA stride 4
    const r = png.data[i], g = png.data[i + 1], b = png.data[i + 2];
    sum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
    count++;
  }
  return count ? sum / count : 0;
}

test('boots clean: mic overlay visible, zero console/page errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', (err) => errors.push(String(err)));

  await page.goto('');
  await expect(page.locator('#mic-overlay')).toBeVisible();
  expect(errors, `console/page errors: ${JSON.stringify(errors)}`).toEqual([]);
});

test('browse entry: mic-skip reveals nav controls and hides the overlay', async ({ page }) => {
  await page.goto('');
  await page.click('#mic-skip');

  await expect(page.locator('#mic-overlay')).toBeHidden();
  // controls() is rendered 2x (rail + the sheet's single shared cluster) —
  // scope to the rail's copy so the locator isn't a strict-mode violation.
  await expect(page.locator('#rail .js-next')).toBeVisible();
  await expect(page.locator('#rail .js-prev')).toBeVisible();
});

test('deadlock regression: render loop starts and the stage is not black', async ({ page }) => {
  await page.goto(BRIGHT_ACT_QUERY);
  await page.click('#mic-skip');

  await waitForRenderLoop(page); // the direct signal the render loop actually started

  const luminance = await stageMeanLuminance(page);
  // Printed (not just asserted) so the threshold above can be calibrated against a real run.
  console.log(`[smoke] stage mean luminance @ ${BRIGHT_ACT_QUERY}: ${luminance.toFixed(2)} / 255`);
  expect(luminance).toBeGreaterThan(MIN_MEAN_LUMINANCE);
});

for (const q of ['full', 'lite'] as const) {
  test(`quality tier q=${q} renders a non-black stage`, async ({ page }) => {
    // Full quality runs a 4x-resolution sim with a ~1,100-step warmup — on
    // CI's 2-core SwiftShader runner that alone can exceed the default 45s
    // (measured: 15s on an M-series laptop, timed out at 45s on ubuntu-latest).
    if (q === 'full') test.setTimeout(180_000);
    await page.goto(`?t=140&q=${q}`);
    await page.click('#mic-skip');

    await waitForRenderLoop(page);

    const luminance = await stageMeanLuminance(page);
    // Printed (not just asserted) so the threshold above can be calibrated against a real run.
    console.log(`[smoke] q=${q} stage mean luminance: ${luminance.toFixed(2)} / 255`);
    expect(luminance).toBeGreaterThan(MIN_MEAN_LUMINANCE);
  });
}

test('mobile: stage is full-bleed and never shrinks for the sheet overlay; liner notes read in browse', async ({ page }) => {
  // The mobile redesign's core regressions: (1) the stage used to be a flex
  // sibling of the sheet, losing real estate to it in every mode; (2) the
  // sheet's now-playing/liner block used to be matched-only, so liner notes
  // were unreachable while browsing on mobile. Pin both here.
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('');
  await page.click('#mic-skip'); // → browse mode, no mic

  await waitForRenderLoop(page);

  // dvh/dvw can differ from the raw viewport by a subpixel or two depending
  // on rounding — assert "fills the viewport", not bit-exact equality.
  const closeTo = (actual: number, expected: number, tolerance = 2) =>
    expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance);

  const stageBox = await page.locator('.stage').boundingBox();
  expect(stageBox).not.toBeNull();
  closeTo(stageBox!.x, 0);
  closeTo(stageBox!.y, 0);
  closeTo(stageBox!.width, 375);
  closeTo(stageBox!.height, 812);

  // The sheet is a fixed overlay, not a layout sibling — it must be
  // positioned within/against the viewport (not pushed off below it) while
  // the stage above stays untouched at full size.
  const sheetBox = await page.locator('#sheet').boundingBox();
  expect(sheetBox).not.toBeNull();
  expect(sheetBox!.y).toBeLessThan(812);
  const stageBoxAfterSheet = await page.locator('.stage').boundingBox();
  closeTo(stageBoxAfterSheet!.width, 375);
  closeTo(stageBoxAfterSheet!.height, 812);

  // The liner-notes fix: on mobile this block used to be `display:none`
  // outside `matched` — it must carry real text in browse too.
  const linerText = await page.locator('#sheet-liner').textContent();
  expect(linerText?.trim().length).toBeGreaterThan(0);
});
