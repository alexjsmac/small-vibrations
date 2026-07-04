import { ALBUM, TRACKS, Track } from '../tracks';

/** Visual state of the chrome. 'matched' is listening-mode *after* a track is
 *  confirmed — it shows the plate + rail now-playing instead of the ripple. */
export type VisualState = 'choose' | 'listening' | 'matched' | 'browse';

export interface FrameRefs {
  root: HTMLElement;
  stage: HTMLDivElement;

  // rail / spine
  rail: HTMLElement;
  railToggle: HTMLButtonElement;
  spineToggle: HTMLButtonElement;
  progressBar: HTMLDivElement;
  progressClock: HTMLDivElement;

  // start (choose) overlay — ids kept so audio wiring is unchanged
  micOverlay: HTMLDivElement;
  micStartBtn: HTMLButtonElement;
  micSkipBtn: HTMLButtonElement;

  // listening ripple/message
  listeningMsg: HTMLDivElement;

  // floating mic status (top-right of the stage)
  micDot: HTMLSpanElement;
  micLabel: HTMLSpanElement;

  // museum plate (bottom-left of the stage)
  plateEyebrow: HTMLDivElement;
  plateTitle: HTMLDivElement;
  plateMeta: HTMLDivElement;

  // rail "now playing" block (matched)
  railNowTitle: HTMLDivElement;
  railNowMeta: HTMLDivElement;

  // liner notes (rail)
  linerLabel: HTMLSpanElement;
  linerText: HTMLDivElement;

  // mobile bottom sheet
  sheet: HTMLDivElement;
  sheetHandle: HTMLDivElement;
  sheetNowTitle: HTMLDivElement;
  sheetLiner: HTMLDivElement;
}

/** Liner blurbs + display seeds live only in the chrome (tracks.ts stays untouched). */
const NOTES: Record<string, string> = {
  a1: 'The album opens at ground level — a thousand small legs finding the same tempo before anyone gives the order.',
  a2: 'Domestic ritual rendered as architecture. Comfort as a load-bearing wall, humming just below hearing.',
  a3: 'One tile tips and the whole ecosystem answers in sequence — cause and consequence collapsing into rhythm.',
  b1: 'Rot as abundance. The gooey underside of a thriving thing, magnified until it turns beautiful.',
  b2: 'Naming the last of something. A catalogue closing in on itself, specimen by specimen.',
  b3: 'The record exhales. Clean, sterile, and — at last — completely still.',
};
const SEEDS: Record<string, string> = {
  a1: '0x8F2C', a2: '0x21B7', a3: '0x5D04', b1: '0x9A11', b2: '0x3E88', b3: '0xB742',
};
const ALBUM_NOTE =
  'Written & performed by Sunntack. Every visualization is generated live and reseeds on each play. ' +
  'Cyanotype plates after 19th-century field guides. This page listens through your microphone and ' +
  'matches its visuals to whatever track is spinning.';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fmtDur = (sec: number) => {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${s < 10 ? '0' + s : s}`;
};
const sideId = (t: Track) => `${t.side}${t.n}`;
const plateMeta = (t: Track) =>
  `${fmtDur(t.duration)}  ·  SIDE ${t.side}  ·  SEED ${SEEDS[t.id] ?? '0x0000'}`;

/** Track rows for one side, as an HTML string. `idx` is the global TRACKS index. */
function rowsFor(side: 'A' | 'B'): string {
  return TRACKS.map((t, i) => (t.side === side
    ? `<div class="trow" data-idx="${i}"><span class="tnum">${sideId(t)}</span>` +
      `<span class="ttitle">${esc(t.title)}</span><span class="tdur">${fmtDur(t.duration)}</span></div>`
    : ''
  )).join('');
}

/** The control cluster (rail + sheet share it). Buttons show per data-mode via CSS. */
function controls(fsTarget: string): string {
  return `
    <div class="railctls">
      <button class="btn ctl js-prev"      data-m="browse">‹ Prev</button>
      <button class="btn ctl js-next"      data-m="browse">Next ›</button>
      <button class="btn ctl js-quality"   data-m="browse matched">Quality: Full</button>
      <button class="btn ctl js-fullscreen" data-m="browse matched" data-fs="${fsTarget}">⤢ Full</button>
      <button class="btn ctl js-browse"    data-m="listening">Browse instead</button>
      <button class="btn ctl ghost js-startover" data-m="browse">← Start over</button>
      <button class="btn ctl ghost js-stop" data-m="matched listening">■ Stop</button>
    </div>`;
}

export function mountFrame(root: HTMLElement): FrameRefs {
  root.dataset.mode = 'choose';
  root.innerHTML = `
    <aside class="rail" id="rail">
      <div class="railbody">
        <button class="railtoggle rail-fold js-railtoggle" title="Fold the sleeve">‹‹</button>
        <div class="eyebrow wide">${ALBUM.artist}</div>
        <div class="disp rail-title">Small<br>Vibrations</div>
        <div class="rail-cat">${ALBUM.catalog} · 2×LP · CYANOTYPE EDITION</div>
        <div class="rule"></div>

        <div class="rail-tracklist" id="rail-tracklist">
          <div class="eyebrow">Side A</div>
          ${rowsFor('A')}
          <div class="eyebrow gap">Side B</div>
          ${rowsFor('B')}
        </div>

        <div class="rail-nowplaying">
          <div class="eyebrow soft">Now playing · matched by ear</div>
          <div class="disp rail-now-title" id="rail-now-title">—</div>
          <div class="rail-now-meta" id="rail-now-meta"></div>
        </div>

        <div class="rail-listening">
          <span class="pulse-dot"></span>
          <span class="listening-copy">Listening for a track…<br>the record decides.</span>
        </div>

        <div class="rule"></div>
        <div class="eyebrow liner-label">Liner Notes — <span id="liner-label">Small Vibrations</span></div>
        <div class="liner-text" id="liner-text">${esc(ALBUM_NOTE)}</div>

        <div class="rail-spacer"></div>
        ${controls('stage')}
      </div>

      <div class="spine">
        <button class="railtoggle js-spinetoggle" title="Open the sleeve">››</button>
        <div class="spinelabel">${ALBUM.artist} — ${ALBUM.title}</div>
        <div class="progress-plate">
          <div class="progress-track"><div class="progress-bar" id="progress-bar"></div></div>
          <div class="progress-clock" id="progress-clock">0:00 / 0:00</div>
        </div>
        <div class="spine-cat">${ALBUM.catalog}</div>
      </div>
    </aside>

    <div class="stage" id="stage">
      <div class="halftone"></div>
      <div class="grain"></div>
      <div class="plate-frame"></div>

      <div class="brand-mobile eyebrow wide">${ALBUM.artist} · ${ALBUM.title}</div>

      <div class="mic-status" id="mic-status">
        <span class="mic-dot" id="mic-dot"></span>
        <span class="mic-label" id="mic-label">Mic Off</span>
      </div>

      <div class="now-plate" id="now-plate">
        <div class="eyebrow" id="plate-eyebrow">Plate A1 · Specimen 01</div>
        <div class="disp plate-title" id="now-title">—</div>
        <div class="plate-meta" id="plate-meta"></div>
      </div>

      <div class="listening-msg" id="listening-msg">
        <div class="ripple">
          <span></span><span></span><span></span>
        </div>
        <div class="listening-head">Listening for Small Vibrations</div>
        <div class="listening-sub">Play the record — visuals appear the moment a track is recognised.</div>
      </div>

      <div class="mic-overlay" id="mic-overlay">
        <div class="eyebrow wide">${ALBUM.catalog} · Audiovisual Companion</div>
        <div class="disp choose-title">Listen along,<br>or browse.</div>
        <div class="choose-sub">The record decides the visuals — the page matches each track by ear.</div>
        <div class="choose-actions">
          <button id="mic-start" class="pill">◉ Listen with microphone</button>
          <button id="mic-skip" class="link-btn">Browse without microphone</button>
        </div>
      </div>
    </div>

    <div class="sheet" id="sheet">
      <div class="sheethandle" id="sheet-handle">
        <span class="sheetgrip"></span>
        <span class="eyebrow" id="sheet-label">Inner Sleeve</span>
      </div>
      <div class="sheetbody">
        <div class="sheet-tracklist">
          <div class="eyebrow">Side A</div>
          ${rowsFor('A')}
          <div class="eyebrow gap">Side B</div>
          ${rowsFor('B')}
          ${controls('stage')}
        </div>
        <div class="sheet-nowplaying">
          <div class="eyebrow soft">Now playing · matched by ear</div>
          <div class="disp sheet-now-title" id="sheet-now-title">—</div>
          <div class="liner-text" id="sheet-liner"></div>
          ${controls('stage')}
        </div>
      </div>
    </div>
  `;

  const q = <T extends Element>(sel: string) => root.querySelector(sel) as T;
  return {
    root,
    stage:         q<HTMLDivElement>('#stage'),
    rail:          q<HTMLElement>('#rail'),
    railToggle:    q<HTMLButtonElement>('.js-railtoggle'),
    spineToggle:   q<HTMLButtonElement>('.js-spinetoggle'),
    progressBar:   q<HTMLDivElement>('#progress-bar'),
    progressClock: q<HTMLDivElement>('#progress-clock'),
    micOverlay:    q<HTMLDivElement>('#mic-overlay'),
    micStartBtn:   q<HTMLButtonElement>('#mic-start'),
    micSkipBtn:    q<HTMLButtonElement>('#mic-skip'),
    listeningMsg:  q<HTMLDivElement>('#listening-msg'),
    micDot:        q<HTMLSpanElement>('#mic-dot'),
    micLabel:      q<HTMLSpanElement>('#mic-label'),
    plateEyebrow:  q<HTMLDivElement>('#plate-eyebrow'),
    plateTitle:    q<HTMLDivElement>('#now-title'),
    plateMeta:     q<HTMLDivElement>('#plate-meta'),
    railNowTitle:  q<HTMLDivElement>('#rail-now-title'),
    railNowMeta:   q<HTMLDivElement>('#rail-now-meta'),
    linerLabel:    q<HTMLSpanElement>('#liner-label'),
    linerText:     q<HTMLDivElement>('#liner-text'),
    sheet:         q<HTMLDivElement>('#sheet'),
    sheetHandle:   q<HTMLDivElement>('#sheet-handle'),
    sheetNowTitle: q<HTMLDivElement>('#sheet-now-title'),
    sheetLiner:    q<HTMLDivElement>('#sheet-liner'),
  };
}

/**
 * Push all text/label/active state for the current visual state + track.
 * Mirrors the showcase `renderVals`. Does NOT touch the mic dot/label — that
 * stays owned by the audio wiring in main.ts.
 */
export function renderChrome(refs: FrameRefs, state: VisualState, idx: number) {
  refs.root.dataset.mode = state;

  const t = TRACKS[idx];
  const showTrack = state === 'matched' || state === 'browse';

  // museum plate + rail/sheet now-playing
  refs.plateEyebrow.textContent = `Plate ${sideId(t)} · Specimen 0${idx + 1}`;
  refs.plateTitle.textContent = t.title;
  refs.plateMeta.textContent = plateMeta(t);
  refs.railNowTitle.textContent = t.title;
  refs.railNowMeta.textContent = plateMeta(t);
  refs.sheetNowTitle.textContent = t.title;

  // liner notes
  refs.linerLabel.textContent = showTrack ? `${sideId(t)} — ${t.title}` : ALBUM.title;
  const liner = showTrack ? (NOTES[t.id] ?? ALBUM_NOTE) : ALBUM_NOTE;
  refs.linerText.textContent = liner;
  refs.sheetLiner.textContent = liner;

  // sheet handle label
  const sheetLabel = refs.sheet.querySelector('#sheet-label') as HTMLElement;
  if (sheetLabel) sheetLabel.textContent = showTrack ? `${sideId(t)} — ${t.title}` : 'Inner Sleeve';

  // active track row (only highlighted while browsing)
  refs.root.querySelectorAll<HTMLElement>('.trow[data-idx]').forEach((row) => {
    const on = state === 'browse' && Number(row.dataset.idx) === idx;
    row.classList.toggle('active', on);
  });
}
