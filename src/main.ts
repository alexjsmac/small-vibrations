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

function setVisual(v: VisualState) {
  visual = v;
  renderChrome(refs, v, idx);
}

async function go(nextIdx: number) {
  idx = (nextIdx + TRACKS.length) % TRACKS.length;
  trackStart = performance.now();
  renderChrome(refs, visual, idx);
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

// --- mobile bottom sheet (tap to toggle, drag to resize) ---

const SHEET_OPEN = 392, SHEET_CLOSED = 58;
let sheetOpen = true, sy = 0, sh0 = 0, sheetMoved = false, sheetDragging = false;

function setSheetHeight(h: number, dragging: boolean) {
  refs.sheet.style.height = `${h}px`;
  refs.sheet.style.transition = dragging ? 'none' : 'height 0.5s cubic-bezier(0.7,0,0.2,1)';
}
refs.sheetHandle.addEventListener('pointerdown', (e) => {
  try { refs.sheetHandle.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  sy = e.clientY; sh0 = sheetOpen ? SHEET_OPEN : SHEET_CLOSED; sheetMoved = false; sheetDragging = true;
  setSheetHeight(sh0, true);
});
refs.sheetHandle.addEventListener('pointermove', (e) => {
  if (!sheetDragging) return;
  const dy = sy - e.clientY;
  if (Math.abs(dy) > 4) sheetMoved = true;
  setSheetHeight(Math.max(SHEET_CLOSED, Math.min(SHEET_OPEN, sh0 + dy)), true);
});
refs.sheetHandle.addEventListener('pointerup', () => {
  if (!sheetDragging) return;
  sheetDragging = false;
  const cur = parseFloat(refs.sheet.style.height) || SHEET_OPEN;
  sheetOpen = sheetMoved ? cur > 200 : !sheetOpen;
  setSheetHeight(sheetOpen ? SHEET_OPEN : SHEET_CLOSED, false);
});

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
  refs.progressBar.style.height = `${dur ? Math.round((el / dur) * 100) : 0}%`;
  refs.progressClock.textContent = `${mmss(el)} / ${mmss(dur)}`;
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
