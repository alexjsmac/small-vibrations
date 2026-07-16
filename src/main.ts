import { mountFrame, renderChrome, type VisualState } from './ui/Frame';
import { TRACKS, LISTENING_TRACK } from './tracks';
import { QualityManager } from './quality/QualityManager';
import { VizHost } from './viz/VizHost';
import { AudioEngine, type MicState, type TrackMatch } from './audio/AudioEngine';

const root = document.getElementById('app') as HTMLDivElement;
const refs = mountFrame(root);

const quality = new QualityManager();
const host = new VizHost(refs.stage, quality);
const engine = new AudioEngine();

/**
 * Two ways in from the start overlay:
 *  - 'listening': mic-driven. The ambient scene + ripple hold until the matcher
 *    confirms a track ('matched'), which reveals its visuals; losing the signal
 *    returns to the ambient scene. Manual navigation is hidden — the record decides.
 *  - 'browse': no mic; tracklist + Prev/Next navigation.
 * 'choose' is the start overlay itself (ambient scene idles behind it).
 *
 * `visual` is the chrome's presentation state and additionally distinguishes
 * 'matched' (listening, track confirmed) so the plate/now-playing render.
 */
type Mode = 'choose' | 'listening' | 'browse';
let mode: Mode = 'choose';
let visual: VisualState = 'choose';
let idx = 0;
let trackStart = performance.now();

// --- chrome auto-fade timer ---
//
// #app.chrome-idle fades the floating overlays (mic status, brand mark,
// plate frame, now-plate, peek bar) — see styles.css. Purely event-driven
// (setTimeout, no rAF/per-frame work). `sheetSnap` (declared below with the
// sheet drag logic) gates arming: reading the sheet at half/full suppresses
// the fade entirely; on desktop there's no sheet to open, so it always arms.
//
// Suppression also requires the sheet to actually be on screen (computed
// display, not just the `display:none` check baked into the mobile media
// query) — sheetSnap is plain JS state, so it doesn't reset itself when a
// mobile viewport left at half/full is then resized past the breakpoint
// into desktop; without this check that stale snap would wrongly suppress
// the desktop fade forever.
const CHROME_IDLE_MS = 4000;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

function armChromeIdle() {
  if (idleTimer !== null) { clearTimeout(idleTimer); idleTimer = null; }
  const sheetOnScreen = getComputedStyle(refs.sheet).display !== 'none';
  if (sheetOnScreen && (sheetSnap === 'half' || sheetSnap === 'full')) return; // you're reading — don't fade
  idleTimer = setTimeout(() => root.classList.add('chrome-idle'), CHROME_IDLE_MS);
}
function wakeChrome() {
  root.classList.remove('chrome-idle');
  armChromeIdle();
}

function setVisual(v: VisualState) {
  visual = v;
  renderChrome(refs, v, idx);
  wakeChrome(); // a mode change (e.g. a match landing) should surface the chrome
}

async function go(nextIdx: number) {
  idx = (nextIdx + TRACKS.length) % TRACKS.length;
  trackStart = performance.now();
  renderChrome(refs, visual, idx);
  wakeChrome(); // a new track — matched or manually browsed — wakes the chrome
  try {
    await host.load(TRACKS[idx]);
  } catch (err) {
    // A single broken viz module shouldn't take down navigation or the render loop.
    console.error(`[viz] failed to load "${TRACKS[idx].viz}" for ${TRACKS[idx].id}:`, err);
  }
}

/** Load the ambient dust scene into the canvas (used behind both the start
 *  overlay and the listening ripple). Does not change the visual state. */
async function loadAmbient() {
  try {
    await host.load(LISTENING_TRACK);
  } catch (err) {
    console.error('[viz] failed to load listening scene:', err);
  }
}

/** The pre-detection listening state: ambient dust + ripple. */
async function showListeningScene() {
  setVisual('listening');
  await loadAmbient();
}

function setMicStatus(state: MicState) {
  refs.micDot.classList.toggle('listening', state === 'listening' || state === 'starting');
  refs.micDot.classList.toggle('matched', state === 'matched');
  refs.micLabel.textContent =
    state === 'matched' && engine.current ? `Matched · ${engine.current.trackId.toUpperCase()}`
    : state === 'listening' || state === 'starting' ? 'Listening…'
    : state === 'error' ? 'Mic unavailable'
    : 'Mic Off';
}

function enterBrowse(selectIdx = idx) {
  mode = 'browse';
  visual = 'browse';
  setMicStatus('off');
  void go(selectIdx);
}

function backToStart() {
  mode = 'choose';
  setMicStatus('off');
  setVisual('choose');
  void loadAmbient();
}

// --- controls (rail + sheet share button classes, so wire all matches) ---

const all = <T extends Element>(sel: string) => Array.from(root.querySelectorAll<T>(sel));

all<HTMLButtonElement>('.js-prev').forEach((b) => b.addEventListener('click', () => { if (mode === 'browse') go(idx - 1); }));
all<HTMLButtonElement>('.js-next').forEach((b) => b.addEventListener('click', () => { if (mode === 'browse') go(idx + 1); }));
all<HTMLButtonElement>('.js-startover').forEach((b) => b.addEventListener('click', backToStart));
all<HTMLButtonElement>('.js-stop').forEach((b) => b.addEventListener('click', backToStart));
all<HTMLButtonElement>('.js-browse').forEach((b) => b.addEventListener('click', () => enterBrowse()));

// Clicking a track row jumps into browse mode on that track.
all<HTMLElement>('.trow[data-idx]').forEach((row) => {
  row.addEventListener('click', () => {
    const i = Number(row.dataset.idx);
    if (mode === 'listening') return; // the record drives while listening
    enterBrowse(i);
  });
});

function syncQualityLabel() {
  const label = `Quality: ${quality.state.level === 'full' ? 'Full' : 'Lite'}`;
  all<HTMLButtonElement>('.js-quality').forEach((b) => { b.textContent = label; });
}
all<HTMLButtonElement>('.js-quality').forEach((b) => b.addEventListener('click', () => quality.toggle()));
quality.addEventListener('change', syncQualityLabel);
syncQualityLabel();

// Fullscreen the canvas stage only (iPhone Safari has no Fullscreen API → hide).
const fsButtons = all<HTMLButtonElement>('.js-fullscreen');
if (!refs.stage.requestFullscreen) {
  fsButtons.forEach((b) => { b.hidden = true; });
} else {
  fsButtons.forEach((b) => b.addEventListener('click', () => {
    if (!document.fullscreenElement) refs.stage.requestFullscreen().catch(() => {});
    else document.exitFullscreen();
  }));
}

// --- collapsible rail ---

refs.railToggle.addEventListener('click', () => refs.rail.classList.add('collapsed'));
refs.spineToggle.addEventListener('click', () => refs.rail.classList.remove('collapsed'));

// --- mobile bottom sheet (tap peek↔half, drag between peek/half/full) ---
//
// The sheet is a fixed overlay (see styles.css); only its `transform:
// translateY(...)` moves. We track the currently-settled snap as state
// (`sheetSnap`) and, while dragging, the live "visible height" in px
// (distance from the peek bar's top edge down to the viewport bottom).
// Settled positions are recomputed from window.innerHeight so a resize
// (rotation, PWA chrome changing) doesn't leave a stale snap point.

type SheetSnap = 'peek' | 'half' | 'full';
let sheetSnap: SheetSnap = 'peek';
let sy = 0, dragStart = 0, dragVisible = 0, sheetMoved = false, sheetDragging = false;

/** Visible height (px) of the sheet at each snap point, recomputed live —
 *  peek tracks the peek bar's actual rendered size (safe-area included). */
function snapVisiblePx(snap: SheetSnap): number {
  if (snap === 'peek') return refs.sheetPeek.getBoundingClientRect().height;
  const vh = window.innerHeight;
  return snap === 'half' ? vh * 0.46 : vh * 0.85;
}

function applySheetTransform(visiblePx: number, dragging: boolean) {
  const total = refs.sheet.getBoundingClientRect().height; // fixed at 85dvh regardless of snap
  refs.sheet.style.transition = dragging ? 'none' : '';
  refs.sheet.style.transform = `translateY(${Math.max(0, total - visiblePx)}px)`;
}

/** Re-apply the currently-settled snap's position (e.g. after a resize) without treating it as a new interaction. */
function reapplySheetSnap() {
  refs.root.dataset.sheet = sheetSnap;
  applySheetTransform(snapVisiblePx(sheetSnap), false);
}

function setSheetSnap(snap: SheetSnap) {
  sheetSnap = snap;
  reapplySheetSnap();
  wakeChrome(); // lifts fade suppression immediately if we just left half/full
}

reapplySheetSnap(); // establish the initial peek position before first paint-relevant work
window.addEventListener('resize', reapplySheetSnap);

refs.sheetPeek.addEventListener('pointerdown', (e) => {
  try { refs.sheetPeek.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  sy = e.clientY;
  dragStart = snapVisiblePx(sheetSnap);
  dragVisible = dragStart;
  sheetMoved = false; sheetDragging = true;
  applySheetTransform(dragVisible, true);
});
refs.sheetPeek.addEventListener('pointermove', (e) => {
  if (!sheetDragging) return;
  const dy = sy - e.clientY;
  if (Math.abs(dy) > 4) sheetMoved = true;
  const min = snapVisiblePx('peek'), max = snapVisiblePx('full');
  dragVisible = Math.max(min, Math.min(max, dragStart + dy));
  applySheetTransform(dragVisible, true);
});
function finishSheetDrag() {
  if (!sheetDragging) return;
  sheetDragging = false;
  if (!sheetMoved) {
    // Tap: toggle peek↔half (a tap while full collapses it to peek).
    setSheetSnap(sheetSnap === 'peek' ? 'half' : 'peek');
    return;
  }
  let nearest: SheetSnap = 'peek', best = Infinity;
  (['peek', 'half', 'full'] as const).forEach((candidate) => {
    const d = Math.abs(snapVisiblePx(candidate) - dragVisible);
    if (d < best) { best = d; nearest = candidate; }
  });
  setSheetSnap(nearest);
}
refs.sheetPeek.addEventListener('pointerup', finishSheetDrag);
refs.sheetPeek.addEventListener('pointercancel', finishSheetDrag);

// --- chrome wake sources ---
//
// Any pointer interaction with the chrome (sheet/peek bar, rail, any
// button) wakes it — EXCEPT the canvas itself: feeding the organisms
// mid-recording must not summon UI. A single delegated listener excluding
// the one element that must stay silent is simpler and cheaper than
// enumerating every chrome container.
root.addEventListener('pointerdown', (e) => {
  if (e.target === host.canvas) return;
  wakeChrome();
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') wakeChrome();
});

// --- ?clean=1: unconditional zero-chrome capture mode ---
if (new URLSearchParams(location.search).get('clean') === '1') {
  root.classList.add('clean');
}

// --- keyboard ---

window.addEventListener('keydown', (e) => {
  if (mode === 'browse' && e.key === 'ArrowRight') go(idx + 1);
  if (mode === 'browse' && e.key === 'ArrowLeft')  go(idx - 1);
  if (e.key.toLowerCase() === 'q') quality.toggle();
});

// --- microphone / track matching ---

engine.addEventListener('state', (e) => {
  setMicStatus((e as CustomEvent<MicState>).detail);
});

engine.addEventListener('match', (e) => {
  if (mode !== 'listening') return;
  const match = (e as CustomEvent<TrackMatch | null>).detail;
  if (!match) {
    // Signal lost — withdraw the visuals and resume listening.
    void showListeningScene();
    return;
  }
  const matchedIdx = TRACKS.findIndex((t) => t.id === match.trackId);
  if (matchedIdx >= 0) {
    visual = 'matched';
    void go(matchedIdx);
  }
});

refs.micStartBtn.addEventListener('click', async () => {
  mode = 'listening';
  setVisual('listening');
  await engine.start();
  if (engine.state === 'error') {
    // No mic — don't strand them on a scene with no controls.
    enterBrowse();
    return;
  }
  host.setAudioSource(() => {
    engine.tick();
    return engine.frame;
  });
});

refs.micSkipBtn.addEventListener('click', () => enterBrowse());

// --- now-playing progress (drives the collapsed spine bar + clock) ---

const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
setInterval(() => {
  if (visual !== 'matched' && visual !== 'browse') return;
  const dur = TRACKS[idx].duration;
  const el = Math.min(dur, (performance.now() - trackStart) / 1000);
  const pct = dur ? Math.round((el / dur) * 100) : 0;
  refs.progressBar.style.height = `${pct}%`;
  refs.progressClock.textContent = `${mmss(el)} / ${mmss(dur)}`;
  refs.sheetHairline.style.width = `${pct}%`; // mobile peek bar's progress hairline
}, 500);

// NOTE: no top-level await here. The entry chunk must finish evaluating before
// dynamically-imported viz chunks (which import three from it) can resolve — a
// module-level `await go(0)` deadlocks the production build.
void (async () => {
  // Boot into the ambient scene: it idles behind the start overlay, and
  // listening mode keeps using it until a track is detected.
  setVisual('choose');
  setMicStatus('off');
  await loadAmbient();
  host.start();
})();

// Console handle for live inspection/tuning (harmless in prod; used heavily
// while authoring visuals and handy for projection-night tweaks).
(window as any).__sv = {
  host, engine, quality,
  get mode() { return mode; },
  get visual() { return visual; },
  // Force the matched chrome without a live mic (for previews/screenshots).
  match(i = 0) { mode = 'listening'; visual = 'matched'; setMicStatus('matched'); void go(i); },
};

// ?debug=1 → tiny FPS/quality readout in the stage corner.
if (new URLSearchParams(location.search).has('debug')) {
  const hud = document.createElement('div');
  hud.className = 'debug-hud';
  refs.stage.appendChild(hud);
  setInterval(() => {
    hud.textContent = `${quality.avgFps().toFixed(0)} fps · ${quality.state.level}`;
  }, 500);
}
