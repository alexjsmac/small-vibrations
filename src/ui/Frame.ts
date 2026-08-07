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
  /** The peek bar — always visible; drag target (peek↔half↔full) + tap target (peek↔half). */
  sheetPeek: HTMLDivElement;
  sheetPeekLabel: HTMLSpanElement;
  /** 1px playback-progress hairline across the peek bar's top edge. */
  sheetHairline: HTMLDivElement;
  sheetBody: HTMLDivElement;
  /** now-playing/liner block — shown in both half and full (browse AND matched, see showTrack). */
  sheetNowTitle: HTMLDivElement;
  sheetNowMeta: HTMLDivElement;
  sheetLinerLabel: HTMLSpanElement;
  sheetLiner: HTMLDivElement;
  /** Album note in the sheet's full state — kept in sync with the rail's. */
  sheetAlbumNote: HTMLDivElement;
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
/** The album note, split so the microphone sentence can be withheld from
 *  anyone who declined the mic — in browse mode it describes something that
 *  isn't happening. See `albumNoteFor`. */
const ALBUM_NOTE_BASE =
  'Written & performed by Sunntack. Every visualization is generated live and reseeds on each play. ' +
  'Cyanotype plates after 19th-century field guides.';
const ALBUM_NOTE_MIC =
  'This page listens through your microphone and matches its visuals to whatever track is spinning.';

/** Browse mode = the listener declined the mic, so drop the mic sentence. */
const albumNoteFor = (state: VisualState) =>
  state === 'browse' ? ALBUM_NOTE_BASE : `${ALBUM_NOTE_BASE} ${ALBUM_NOTE_MIC}`;

/** Credits, taken from the printed sleeve's back panel — the record is the
 *  source of truth for how collaborators are named, so this wording tracks it
 *  rather than being re-edited here. `SUPPORT` stands in for the London Arts
 *  Council / City of London logos on the jacket (the site has no logo assets,
 *  and the acknowledgement is the part that matters). */
const CREDITS: readonly string[] = [
  'All music written and recorded by Alex MacLean',
  'Mixed by Matt Thibideau',
  'Mastered by Jon Tornblom at Transparent Mastering',
  'Vinyl cut at Precision Pressing',
];
const THANKS =
  'Special thanks to Elizabeth for listening to every version of every track ' +
  'and the bugs that inspired this project.';
const SUPPORT = 'Supported by the London Arts Council and the City of London.';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fmtDur = (sec: number) => {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${s < 10 ? '0' + s : s}`;
};
const sideId = (t: Track) => `${t.side}${t.n}`;
const plateMeta = (t: Track) => `${sideId(t)} · ${fmtDur(t.duration)}`;

/** Track rows for one side, as an HTML string. `idx` is the global TRACKS index. */
function rowsFor(side: 'A' | 'B'): string {
  return TRACKS.map((t, i) => (t.side === side
    ? `<div class="trow" data-idx="${i}"><span class="tnum">${sideId(t)}</span>` +
      `<span class="ttitle">${esc(t.title)}</span><span class="tdur">${fmtDur(t.duration)}</span></div>`
    : ''
  )).join('');
}

/** Credits block — identical markup in the rail and the sheet. */
function creditsBlock(): string {
  return `
    <div class="rule"></div>
    <div class="eyebrow liner-label">Credits</div>
    <div class="credits">${CREDITS.map((l) => `<div>${esc(l)}</div>`).join('')}</div>
    <div class="credits-note">${esc(THANKS)}</div>
    <div class="credits-note">${esc(SUPPORT)}</div>`;
}

/** The control cluster (rail + sheet share it). Buttons show per data-mode via CSS. */
function controls(fsTarget: string): string {
  return `
    <div class="railctls">
      <button class="btn ctl js-prev"      data-m="browse">‹ Prev</button>
      <button class="btn ctl js-next"      data-m="browse">Next ›</button>
      <button class="btn ctl js-quality"   data-m="browse matched">Quality: Full</button>
      <button class="btn ctl js-fullscreen" data-m="browse matched" data-fs="${fsTarget}">⤢ Fullscreen</button>
      <button class="btn ctl js-browse"    data-m="listening">Browse instead</button>
      <button class="btn ctl ghost js-startover" data-m="browse">← Start over</button>
      <button class="btn ctl ghost js-stop" data-m="matched listening">■ Stop listening</button>
    </div>`;
}

export function mountFrame(root: HTMLElement): FrameRefs {
  root.dataset.mode = 'choose';
  root.dataset.sheet = 'peek'; // mobile sheet starts collapsed so visuals lead — see main.ts snap logic
  root.innerHTML = `
    <aside class="rail" id="rail">
      <div class="railbody">
        <button class="railtoggle rail-fold js-railtoggle" title="Fold the sleeve">‹‹</button>
        <div class="eyebrow wide">${ALBUM.artist}</div>
        <div class="disp rail-title">Small<br>Vibrations</div>
        <div class="rail-cat">${ALBUM.catalog} · LP · CYANOTYPE EDITION</div>
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
        <div class="liner-text" id="liner-text">${esc(albumNoteFor('choose'))}</div>

        ${creditsBlock()}

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
        <div class="disp plate-title" id="now-title">—</div>
        <div class="plate-meta" id="plate-meta"></div>
      </div>

      <div class="listening-msg" id="listening-msg">
        <div class="ripple">
          <span></span><span></span><span></span>
        </div>
        <div class="listening-head">Listening for Small Vibrations</div>
        <div class="listening-sub">Play the record — visuals appear the moment a track is recognized.</div>
      </div>

      <div class="mic-overlay" id="mic-overlay">
        <div class="eyebrow wide">${ALBUM.catalog} · Audiovisual Companion</div>
        <div class="disp choose-title">Listen along,<br>or browse.</div>
        <div class="choose-sub">The record decides the visuals — the page matches each track by ear.</div>
        <div class="choose-actions">
          <button id="mic-start" class="pill">◉ Listen with microphone</button>
          <div class="choose-privacy">Audio is matched on your device and never leaves it.</div>
          <button id="mic-skip" class="link-btn">Browse without microphone</button>
        </div>
      </div>
    </div>

    <div class="sheet" id="sheet">
      <div class="sheetpeek" id="sheet-peek">
        <div class="sheethairline" id="sheet-hairline"></div>
        <span class="sheetgrip"></span>
        <span class="eyebrow sheetpeek-label" id="sheet-peek-label">Inner Sleeve</span>
      </div>
      <div class="sheetbody" id="sheet-body">
        <div class="sheet-tracklist" id="sheet-tracklist">
          <div class="eyebrow">Side A</div>
          ${rowsFor('A')}
          <div class="eyebrow gap">Side B</div>
          ${rowsFor('B')}
        </div>

        <div class="sheet-nowplaying" id="sheet-nowplaying">
          <div class="disp sheet-now-title" id="sheet-now-title">—</div>
          <div class="sheet-now-meta" id="sheet-now-meta"></div>
          <div class="eyebrow liner-label">Liner Notes — <span id="sheet-liner-label">Small Vibrations</span></div>
          <div class="liner-text" id="sheet-liner"></div>
        </div>

        <div class="sheet-album-note" id="sheet-album-note">
          <div class="rule"></div>
          <div class="eyebrow liner-label">${ALBUM.catalog} · Album Note</div>
          <div class="liner-text" id="sheet-album-note-text">${esc(albumNoteFor('choose'))}</div>
          ${creditsBlock()}
        </div>

        ${controls('stage')}
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
    plateTitle:    q<HTMLDivElement>('#now-title'),
    plateMeta:     q<HTMLDivElement>('#plate-meta'),
    railNowTitle:  q<HTMLDivElement>('#rail-now-title'),
    railNowMeta:   q<HTMLDivElement>('#rail-now-meta'),
    linerLabel:    q<HTMLSpanElement>('#liner-label'),
    linerText:     q<HTMLDivElement>('#liner-text'),
    sheet:             q<HTMLDivElement>('#sheet'),
    sheetPeek:         q<HTMLDivElement>('#sheet-peek'),
    sheetPeekLabel:    q<HTMLSpanElement>('#sheet-peek-label'),
    sheetHairline:     q<HTMLDivElement>('#sheet-hairline'),
    sheetBody:         q<HTMLDivElement>('#sheet-body'),
    sheetNowTitle:     q<HTMLDivElement>('#sheet-now-title'),
    sheetNowMeta:      q<HTMLDivElement>('#sheet-now-meta'),
    sheetLinerLabel:   q<HTMLSpanElement>('#sheet-liner-label'),
    sheetLiner:        q<HTMLDivElement>('#sheet-liner'),
    sheetAlbumNote:    q<HTMLDivElement>('#sheet-album-note-text'),
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
  refs.plateTitle.textContent = t.title;
  refs.plateMeta.textContent = plateMeta(t);
  refs.railNowTitle.textContent = t.title;
  refs.railNowMeta.textContent = plateMeta(t);
  refs.sheetNowTitle.textContent = t.title;
  refs.sheetNowMeta.textContent = plateMeta(t);

  // liner notes — showTrack (matched||browse) gates the track-specific note,
  // exactly like the desktop rail; the sheet mirrors this on mobile in BOTH
  // browse and matched (the liner-notes fix — it used to be matched-only).
  // The album note is state-dependent (see albumNoteFor), so it's recomputed
  // here rather than baked into the initial markup.
  const albumNote = albumNoteFor(state);
  refs.linerLabel.textContent = showTrack ? `${sideId(t)} · ${t.title}` : ALBUM.title;
  const liner = showTrack ? (NOTES[t.id] ?? albumNote) : albumNote;
  refs.linerText.textContent = liner;
  refs.sheetLinerLabel.textContent = showTrack ? `${sideId(t)} · ${t.title}` : ALBUM.title;
  refs.sheetLiner.textContent = liner;
  refs.sheetAlbumNote.textContent = albumNote;

  // peek bar label — one line, identity at a glance even collapsed
  refs.sheetPeekLabel.textContent = showTrack ? `${sideId(t)} · ${t.title}` : 'Inner Sleeve';

  // active track row (only highlighted while browsing)
  refs.root.querySelectorAll<HTMLElement>('.trow[data-idx]').forEach((row) => {
    const on = state === 'browse' && Number(row.dataset.idx) === idx;
    row.classList.toggle('active', on);
  });
}
