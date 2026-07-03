import { mountFrame, setNowPlaying } from './ui/Frame';
import { TRACKS } from './tracks';
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

let idx = 0;

async function go(nextIdx: number) {
  idx = (nextIdx + TRACKS.length) % TRACKS.length;
  const track = TRACKS[idx];
  setNowPlaying(refs, track, idx);
  await host.load(track);
}

// --- controls ---

refs.prevBtn.addEventListener('click',     () => go(idx - 1));
refs.nextBtn.addEventListener('click',     () => go(idx + 1));

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
  if (e.key === 'ArrowRight') go(idx + 1);
  if (e.key === 'ArrowLeft')  go(idx - 1);
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
  const match = (e as CustomEvent<TrackMatch | null>).detail;
  if (!match) return; // lost the signal — keep showing the last track
  const matchedIdx = TRACKS.findIndex((t) => t.id === match.trackId);
  if (matchedIdx >= 0) {
    refs.micLabel.textContent = `● ${match.trackId.toUpperCase()}`;
    go(matchedIdx);
  }
});

refs.micStartBtn.addEventListener('click', async () => {
  refs.micOverlay.hidden = true;
  await engine.start();
  host.setAudioSource(() => {
    engine.tick();
    return engine.frame;
  });
});

refs.micSkipBtn.addEventListener('click', () => {
  refs.micOverlay.hidden = true;
});

await go(0);
host.start();
