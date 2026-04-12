import { mountFrame, setNowPlaying } from './ui/Frame';
import { TRACKS } from './tracks';
import { QualityManager } from './quality/QualityManager';
import { VizHost } from './viz/VizHost';
import marbleUrl from './assets/marble-tile.png';

// Inject the marble texture as a CSS variable so vite can hash & rewrite the URL.
document.documentElement.style.setProperty('--marble', `url('${marbleUrl}')`);

const root = document.getElementById('app') as HTMLDivElement;
const refs = mountFrame(root);

const quality = new QualityManager();
const host = new VizHost(refs.stage, quality);

let idx = 0;

async function go(nextIdx: number) {
  idx = (nextIdx + TRACKS.length) % TRACKS.length;
  const track = TRACKS[idx];
  setNowPlaying(refs, track, idx);
  await host.load(track);
}

refs.prevBtn.addEventListener('click',     () => go(idx - 1));
refs.nextBtn.addEventListener('click',     () => go(idx + 1));
refs.qualityBtn.addEventListener('click',  () => {
  quality.toggle();
  refs.qualityBtn.textContent = `Quality: ${quality.state.level === 'full' ? 'Full' : 'Lite'}`;
});
quality.addEventListener('change', () => {
  refs.qualityBtn.textContent = `Quality: ${quality.state.level === 'full' ? 'Full' : 'Lite'}`;
});

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

await go(0);
host.start();
