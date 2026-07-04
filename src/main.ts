import { mountFrame, setNowPlaying } from './ui/Frame';
import { TRACKS, LISTENING_TRACK } from './tracks';
import { QualityManager } from './quality/QualityManager';
import { VizHost } from './viz/VizHost';
import { AudioEngine, type MicState, type TrackMatch } from './audio/AudioEngine';
import marbleUrl from './assets/marble-tile.png';

// Inject the marble texture as a CSS variable so vite can hash & rewrite the URL.
document.documentElement.style.setProperty('--marble', `url('${marbleUrl}')`);

const root = document.getElementById('app') as HTMLDivElement;
const refs = mountFrame(root);

const quality = new QualityManager();
const host = new VizHost(refs.stage, quality);
const engine = new AudioEngine();

/**
 * Two ways in from the start overlay:
 *  - 'listening': mic-driven. The ambient scene + "Listening for Small
 *    Vibrations…" message hold until the matcher confirms a track, which
 *    reveals its visuals; losing the signal returns to the ambient scene.
 *    Manual track navigation is hidden — the record decides.
 *  - 'browse': no mic; Prev/Next navigation.
 * 'choose' is the overlay itself (ambient scene idles behind it).
 */
type Mode = 'choose' | 'listening' | 'browse';
let mode: Mode = 'choose';

let idx = 0;

async function go(nextIdx: number) {
  idx = (nextIdx + TRACKS.length) % TRACKS.length;
  const track = TRACKS[idx];
  setNowPlaying(refs, track, idx);
  try {
    await host.load(track);
  } catch (err) {
    // A single broken viz module shouldn't take down navigation or the render loop.
    console.error(`[viz] failed to load "${track.viz}" for ${track.id}:`, err);
  }
}

function setBrowseControlsVisible(visible: boolean) {
  refs.prevBtn.hidden = !visible;
  refs.nextBtn.hidden = !visible;
  refs.indicator.hidden = !visible;
}

/** The pre-detection state: ambient dust + pulsing message, neutral header. */
async function showListeningScene() {
  refs.nowTitle.textContent = '—';
  (refs.nowMeta.querySelector('#now-side') as HTMLElement).textContent = '';
  refs.listeningMsg.hidden = false;
  try {
    await host.load(LISTENING_TRACK);
  } catch (err) {
    console.error('[viz] failed to load listening scene:', err);
  }
}

function enterBrowse() {
  mode = 'browse';
  refs.micOverlay.hidden = true;
  refs.listeningMsg.hidden = true;
  setBrowseControlsVisible(true);
  void go(idx);
}

// --- controls ---

refs.prevBtn.addEventListener('click', () => { if (mode === 'browse') go(idx - 1); });
refs.nextBtn.addEventListener('click', () => { if (mode === 'browse') go(idx + 1); });

function syncQualityLabel() {
  refs.qualityBtn.textContent = `Quality: ${quality.state.level === 'full' ? 'Full' : 'Lite'}`;
}
refs.qualityBtn.addEventListener('click', () => quality.toggle());
quality.addEventListener('change', syncQualityLabel);
syncQualityLabel();

// iPhone Safari has no Fullscreen API — hide the button there.
if (!document.documentElement.requestFullscreen) {
  refs.fullscreenBtn.hidden = true;
}
refs.fullscreenBtn.addEventListener('click', () => {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen();
  else document.exitFullscreen();
});

window.addEventListener('keydown', (e) => {
  if (mode === 'browse' && e.key === 'ArrowRight') go(idx + 1);
  if (mode === 'browse' && e.key === 'ArrowLeft')  go(idx - 1);
  if (e.key.toLowerCase() === 'q') {
    quality.toggle();
  }
});

// --- microphone / track matching ---

const MIC_LABEL: Record<MicState, string> = {
  off: 'Mic Off',
  starting: 'Starting…',
  listening: 'Listening…',
  matched: 'Matched',
  error: 'Mic unavailable',
};

engine.addEventListener('state', (e) => {
  const state = (e as CustomEvent<MicState>).detail;
  refs.micDot.classList.toggle('listening', state === 'listening' || state === 'starting');
  refs.micDot.classList.toggle('matched', state === 'matched');
  refs.micLabel.textContent = state === 'matched' && engine.current
    ? `● ${engine.current.trackId.toUpperCase()}`
    : MIC_LABEL[state];
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
    refs.micLabel.textContent = `● ${match.trackId.toUpperCase()}`;
    refs.listeningMsg.hidden = true;
    void go(matchedIdx);
  }
});

refs.micStartBtn.addEventListener('click', async () => {
  mode = 'listening';
  refs.micOverlay.hidden = true;
  setBrowseControlsVisible(false);
  refs.listeningMsg.hidden = false;
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

refs.micSkipBtn.addEventListener('click', enterBrowse);

// NOTE: no top-level await here. The entry chunk must finish evaluating
// before dynamically-imported viz chunks (which import three from it) can
// resolve — a module-level `await go(0)` deadlocks the production build.
void (async () => {
  // Boot into the ambient scene: it idles behind the start overlay, and
  // listening mode keeps using it until a track is detected.
  refs.nowTitle.textContent = '—';
  (refs.nowMeta.querySelector('#now-side') as HTMLElement).textContent = '';
  setBrowseControlsVisible(false);
  try {
    await host.load(LISTENING_TRACK);
  } catch (err) {
    console.error('[viz] failed to load listening scene:', err);
  }
  host.start();
})();

// Console handle for live inspection/tuning (harmless in prod; used heavily
// while authoring visuals and handy for projection-night tweaks).
(window as any).__sv = { host, engine, quality, get mode() { return mode; } };

// ?debug=1 → tiny FPS/quality readout in the stage corner, so performance
// reports from test machines carry numbers.
if (new URLSearchParams(location.search).has('debug')) {
  const hud = document.createElement('div');
  hud.className = 'debug-hud';
  refs.stage.appendChild(hud);
  setInterval(() => {
    hud.textContent = `${quality.avgFps().toFixed(0)} fps · ${quality.state.level}`;
  }, 500);
}
