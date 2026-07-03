import { ALBUM, TRACKS, Track } from '../tracks';

export interface FrameRefs {
  stage: HTMLDivElement;
  nowTitle: HTMLSpanElement;
  nowMeta: HTMLDivElement;
  indicator: HTMLSpanElement;
  micDot: HTMLSpanElement;
  micLabel: HTMLSpanElement;
  micOverlay: HTMLDivElement;
  micStartBtn: HTMLButtonElement;
  micSkipBtn: HTMLButtonElement;
  prevBtn: HTMLButtonElement;
  nextBtn: HTMLButtonElement;
  qualityBtn: HTMLButtonElement;
  fullscreenBtn: HTMLButtonElement;
}

export function mountFrame(root: HTMLElement): FrameRefs {
  root.innerHTML = `
    <header class="header">
      <div class="brand">
        <span class="artist">${ALBUM.artist}</span>
        <span class="album">${ALBUM.title}</span>
      </div>
      <div class="now-playing" id="now-meta">
        <span id="now-side">A1</span>
        <span class="title" id="now-title">—</span>
      </div>
    </header>
    <div class="frame-edge left"></div>
    <div class="stage" id="stage">
      <div class="mic-overlay" id="mic-overlay">
        <button id="mic-start">Tap to listen</button>
        <p>Play the record — this page listens along and matches the visuals to the track.</p>
        <button id="mic-skip" class="link-btn">browse without microphone</button>
      </div>
    </div>
    <div class="frame-edge right"></div>
    <footer class="footer">
      <span class="catalog">${ALBUM.catalog}</span>
      <div class="controls">
        <button id="prev">Prev</button>
        <span class="indicator" id="indicator">— / —</span>
        <button id="next">Next</button>
        <button id="quality">Quality: Full</button>
        <button id="fullscreen">Fullscreen</button>
        <span class="indicator"><span class="mic-dot" id="mic-dot"></span><span id="mic-label">Mic Off</span></span>
      </div>
    </footer>
  `;

  return {
    stage:         root.querySelector('#stage')         as HTMLDivElement,
    nowTitle:      root.querySelector('#now-title')     as HTMLSpanElement,
    nowMeta:       root.querySelector('#now-meta')      as HTMLDivElement,
    indicator:     root.querySelector('#indicator')     as HTMLSpanElement,
    micDot:        root.querySelector('#mic-dot')       as HTMLSpanElement,
    micLabel:      root.querySelector('#mic-label')     as HTMLSpanElement,
    micOverlay:    root.querySelector('#mic-overlay')   as HTMLDivElement,
    micStartBtn:   root.querySelector('#mic-start')     as HTMLButtonElement,
    micSkipBtn:    root.querySelector('#mic-skip')      as HTMLButtonElement,
    prevBtn:       root.querySelector('#prev')          as HTMLButtonElement,
    nextBtn:       root.querySelector('#next')          as HTMLButtonElement,
    qualityBtn:    root.querySelector('#quality')       as HTMLButtonElement,
    fullscreenBtn: root.querySelector('#fullscreen')    as HTMLButtonElement,
  };
}

export function setNowPlaying(refs: FrameRefs, track: Track, idx: number) {
  refs.nowTitle.textContent = track.title;
  const sideLabel = `${track.side}${track.n}`;
  (refs.nowMeta.querySelector('#now-side') as HTMLElement).textContent = sideLabel;
  refs.indicator.textContent = `${idx + 1} / ${TRACKS.length}`;
}
