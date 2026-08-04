/**
 * Spotify Canvas capture harness.
 *
 * Records an 8-second 9:16 loop of each track's visuals, audio-reactive to
 * the real track masters, without touching the app itself. Uses the app's
 * existing dev affordances: ?clean=1 (zero chrome), ?t= (seed the song
 * clock), window.__sv (quality lock + programmatic track load) and
 * VizHost.setAudioSource (a matched frame is passed through verbatim, time
 * included, so the WAV's clock drives the staging and the analyser bands
 * drive the beat layer — same band math as AudioEngine.tick).
 *
 * Usage:
 *   node scripts/capture-canvas.mjs                # all six tracks
 *   node scripts/capture-canvas.mjs b2 b3          # subset
 *   node scripts/capture-canvas.mjs b2 --start=229.5 --preroll=16 --params="scan=always"
 *   node scripts/capture-canvas.mjs --masters="/path/to/masters dir"
 *
 * Needs: built dist/ (npm run build), ffmpeg on PATH, the track masters.
 * Spawns `vite preview` on :4173 unless one is already listening, and a
 * headed Chromium (hardware GL — keep the window unoccluded; rAF freezes
 * in occluded windows and the sim clock with it).
 *
 * Output: exports/canvas/<id>-1080x1920.mp4 (master) and -720x1280.mp4
 * (upload), plus <id>-sheet.png contact sheets for review. All gitignored.
 */
import { chromium } from '@playwright/test';
import { spawn, execFileSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4173;
const WAV_PORT = 4174; // route.fulfill dies on ~100 MB bodies — serve WAVs over plain HTTP instead
const BASE = `http://localhost:${PORT}/small-vibrations/`;
const OUT_DIR = path.join(ROOT, 'exports', 'canvas');
const DEFAULT_MASTERS_DIR = '/Users/amaclean/Downloads/Sunntack - Small Vibrations EP';

const RECORD_SECONDS = 8.35; // trimmed to exactly 8.0 by ffmpeg
const FINAL_SECONDS = 8;

/**
 * The moment table: `start` is the beginning of the 8 s window (chosen just
 * before each track's scripted one-shot hit so the time-crossing fires on
 * camera), `preroll` is how many seconds of real playback the sim gets to
 * grow into its staged look before recording starts.
 */
const TRACKS = [
  { id: 'a1', idx: 0, wavPrefix: '01', title: 'They Come Marching', start: 197.5, preroll: 14 },
  { id: 'a2', idx: 1, wavPrefix: '02', title: 'Homemakers', start: 185.5, preroll: 14 },
  // a3: synchrony (120) beat the collapse (204) on review — the collapse window goes dark/sparse.
  { id: 'a3', idx: 2, wavPrefix: '03', title: 'Biome Dominoes', start: 118.5, preroll: 14 },
  { id: 'b1', idx: 3, wavPrefix: '04', title: 'Icky Sticky and Thriving', start: 175.5, preroll: 20 },
  { id: 'b2', idx: 4, wavPrefix: '05', title: 'Terminal Taxonomy', start: 229.5, preroll: 14 },
  { id: 'b3', idx: 5, wavPrefix: '06', title: 'Sterile Breath', start: 137.5, preroll: 14 },
];

// ---------------------------------------------------------------- CLI args
const args = process.argv.slice(2);
const flag = (name) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
};
const mastersDir = flag('masters') ?? DEFAULT_MASTERS_DIR;
const ids = args.filter((a) => !a.startsWith('--'));
const picked = ids.length ? TRACKS.filter((t) => ids.includes(t.id)) : TRACKS;
if (!picked.length) {
  console.error(`no matching tracks; ids are ${TRACKS.map((t) => t.id).join(', ')}`);
  process.exit(1);
}
const startOverride = flag('start') ? Number(flag('start')) : undefined;
const prerollOverride = flag('preroll') ? Number(flag('preroll')) : undefined;
const extraParams = flag('params') ?? '';
if ((startOverride !== undefined || prerollOverride !== undefined || extraParams) && picked.length > 1) {
  console.error('--start/--preroll/--params only make sense with a single track id');
  process.exit(1);
}

// ------------------------------------------------------------- prerequisites
if (!existsSync(path.join(ROOT, 'dist', 'index.html'))) {
  console.error('dist/ missing — run `npm run build` first');
  process.exit(1);
}
if (!existsSync(mastersDir)) {
  console.error(`masters dir not found: ${mastersDir} (override with --masters=)`);
  process.exit(1);
}
const wavPath = (t) => {
  const hit = readdirSync(mastersDir).find(
    (f) => f.startsWith(t.wavPrefix) && f.toLowerCase().endsWith('.wav'),
  );
  if (!hit) throw new Error(`no WAV starting with "${t.wavPrefix}" in ${mastersDir}`);
  return path.join(mastersDir, hit);
};
picked.forEach(wavPath); // fail fast before launching anything

// ------------------------------------------------------------ preview server
async function serverUp() {
  try {
    const res = await fetch(BASE, { signal: AbortSignal.timeout(1000) });
    return res.ok;
  } catch {
    return false;
  }
}

/** CORS-open WAV server: GET /wav/<id> streams that track's master. */
function startWavServer() {
  const server = createServer((req, res) => {
    const id = req.url?.replace(/^\/wav\//, '');
    const track = TRACKS.find((t) => t.id === id);
    if (!track) {
      res.writeHead(404).end();
      return;
    }
    const file = wavPath(track);
    res.writeHead(200, {
      'Content-Type': 'audio/wav',
      'Content-Length': statSync(file).size,
      'Access-Control-Allow-Origin': '*',
    });
    createReadStream(file).pipe(res);
  });
  server.listen(WAV_PORT);
  return server;
}

let previewProc = null;
async function ensureServer() {
  if (await serverUp()) return;
  console.log(`starting vite preview on :${PORT} …`);
  previewProc = spawn('npm', ['run', 'preview', '--', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    stdio: 'ignore',
    detached: false,
  });
  for (let i = 0; i < 50; i++) {
    if (await serverUp()) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('vite preview never came up');
}

// ---------------------------------------------------------------- capture
async function captureTrack(browser, track) {
  const start = startOverride ?? track.start;
  const preroll = prerollOverride ?? track.preroll;
  const t0 = Math.max(0, start - preroll);
  console.log(`\n[${track.id}] ${track.title} — window ${start}–${start + FINAL_SECONDS}s, preroll ${preroll}s`);

  const context = await browser.newContext({
    viewport: { width: 1080, height: 1920 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  // Seed = hashSeed(trackId + Date.now()) in VizHost — freeze Date.now so a
  // retake of the same moment reproduces the same layout. Nothing else in
  // the app reads Date.now.
  await page.addInitScript(() => {
    const fixed = 1754000000000;
    Date.now = () => fixed;
  });
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') console.log(`  [page] ${m.text()}`);
  });

  const params = new URLSearchParams({ clean: '1', t: String(t0) });
  for (const [k, v] of new URLSearchParams(extraParams)) params.set(k, v);
  await page.goto(`${BASE}?${params}`);
  await page.waitForFunction(() => window.__sv?.host, null, { timeout: 30_000 });

  // Fetch + decode + analyze the master while the ambient scene idles.
  // Everything runs in OfflineAudioContexts — a realtime AudioContext dies
  // in this automation environment ("error from the audio device"), and
  // offline analysis is deterministic anyway: step the render at 60 Hz via
  // suspend()/resume() and snapshot the analyser each step, producing the
  // exact per-frame bands AudioEngine.tick would compute (same fftSize
  // 2048 / smoothing 0.75 analyser, same 64-bin fold, same bandAvg).
  console.log('  decoding + analyzing master offline …');
  await page.evaluate(
    async ({ wavUrl, t0, span }) => {
      const res = await fetch(wavUrl);
      if (!res.ok) throw new Error(`wav fetch ${res.status}`);
      const buf = await res.arrayBuffer();
      const decoder = new OfflineAudioContext(2, 128, 48_000);
      const audioBuf = await decoder.decodeAudioData(buf);

      const sr = 48_000;
      const octx = new OfflineAudioContext(2, Math.ceil(span * sr), sr);
      const analyser = octx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.75;
      const src = octx.createBufferSource();
      src.buffer = audioBuf;
      src.connect(analyser);
      analyser.connect(octx.destination);
      src.start(0, t0);

      const bytes = new Uint8Array(analyser.frequencyBinCount); // 1024
      const hzPerBin = sr / 2 / bytes.length;
      const bandAvg = (loHz, hiHz) => {
        const lo = Math.max(0, Math.floor(loHz / hzPerBin));
        const hi = Math.min(bytes.length - 1, Math.ceil(hiHz / hzPerBin));
        let sum = 0;
        for (let i = lo; i <= hi; i++) sum += bytes[i];
        return sum / ((hi - lo + 1) * 255);
      };

      const fps = 60;
      const steps = Math.floor(span * fps) - 1;
      const frames = [];
      for (let k = 1; k <= steps; k++) {
        // Register all suspensions up front (required before startRendering).
        octx.suspend(k / fps).then(() => {
          analyser.getByteFrequencyData(bytes);
          const frequency = new Float32Array(64);
          for (let i = 0; i < 64; i++) {
            let sum = 0;
            for (let j = 0; j < 16; j++) sum += bytes[i * 16 + j];
            frequency[i] = sum / (16 * 255);
          }
          frames.push({
            frequency,
            bass: bandAvg(20, 250),
            mid: bandAvg(250, 2000),
            high: bandAvg(2000, 6000),
          });
          octx.resume();
        });
      }
      await octx.startRendering();
      window.__cap = { t0, fps, frames };
      return frames.length;
    },
    {
      wavUrl: `http://localhost:${WAV_PORT}/wav/${track.id}`,
      t0,
      span: preroll + RECORD_SECONDS + 2,
    },
  );

  // Full quality via the manual path — sets manualOverride, which disables
  // the mid-capture auto-drop to lite (a drop rebuilds the scene on camera).
  await page.evaluate((idx) => {
    window.__sv.quality.set('full');
    window.__sv.match(idx);
  }, track.idx);
  await page.waitForFunction(
    (id) => window.__sv.host.currentTrackId === id,
    track.id,
    { timeout: 60_000 },
  );

  // Start the song clock (wall time) and feed VizHost the precomputed
  // frames. matched:true → the frame (time included) is passed through
  // verbatim, so the WAV's clock drives staging and the bands the beat layer.
  await page.evaluate(() => {
    const { t0, fps, frames } = window.__cap;
    const wallStart = performance.now() / 1000;
    const songTime = () => t0 + (performance.now() / 1000 - wallStart);
    const out = { frequency: new Float32Array(64), bass: 0, mid: 0, high: 0, matched: true, time: t0 };
    window.__sv.host.setAudioSource(() => {
      const t = songTime();
      const f = frames[Math.min(frames.length - 1, Math.max(0, Math.floor((t - t0) * fps)))];
      out.frequency.set(f.frequency);
      out.bass = f.bass;
      out.mid = f.mid;
      out.high = f.high;
      out.time = t;
      return out;
    });
    window.__cap.songTime = songTime;
  });

  // Preroll happens inside this promise: a rAF loop watches the song clock,
  // starts the recorder exactly at `start`, stops past start+RECORD_SECONDS.
  console.log(`  prerolling ${preroll}s + recording ${RECORD_SECONDS}s …`);
  const b64 = await page.evaluate(
    ({ start, dur }) =>
      new Promise((resolve, reject) => {
        const canvas = document.querySelector('.stage canvas');
        if (!canvas) return reject(new Error('no .stage canvas'));
        const stream = canvas.captureStream(60);
        const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((m) =>
          MediaRecorder.isTypeSupported(m),
        );
        const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 40_000_000 });
        const chunks = [];
        rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
        rec.onerror = () => reject(new Error('MediaRecorder error'));
        rec.onstop = async () => {
          const buf = new Uint8Array(await new Blob(chunks, { type: mime }).arrayBuffer());
          let s = '';
          for (let i = 0; i < buf.length; i += 32768) {
            s += String.fromCharCode.apply(null, buf.subarray(i, i + 32768));
          }
          resolve(btoa(s));
        };
        const tick = () => {
          try {
            const t = window.__cap.songTime();
            if (rec.state === 'inactive') {
              if (t >= start) rec.start();
            } else if (t >= start + dur) {
              rec.stop();
              return;
            }
          } catch (err) {
            reject(err);
            return;
          }
          requestAnimationFrame(tick);
        };
        tick();
      }),
    { start, dur: RECORD_SECONDS },
  );
  await context.close();

  // ---- ffmpeg post: trim to exactly 8 s, constant 30 fps, H.264 yuv420p.
  mkdirSync(OUT_DIR, { recursive: true });
  const webm = path.join(OUT_DIR, `${track.id}-raw.webm`);
  const master = path.join(OUT_DIR, `${track.id}-1080x1920.mp4`);
  const upload = path.join(OUT_DIR, `${track.id}-720x1280.mp4`);
  const sheet = path.join(OUT_DIR, `${track.id}-sheet.png`);
  writeFileSync(webm, Buffer.from(b64, 'base64'));
  const ff = (ffArgs) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...ffArgs]);
  ff(['-i', webm, '-t', String(FINAL_SECONDS), '-an',
    '-vf', 'scale=1080:1920:flags=lanczos,fps=30,format=yuv420p',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-movflags', '+faststart', master]);
  ff(['-i', master, '-an',
    '-vf', 'scale=720:1280:flags=lanczos',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-movflags', '+faststart', upload]);
  ff(['-i', master, '-vf', 'fps=1,scale=216:384,tile=8x1', '-frames:v', '1', sheet]);
  console.log(`  wrote ${path.relative(ROOT, master)} + 720x1280 + contact sheet`);
}

// ------------------------------------------------------------------- main
await ensureServer();
const wavServer = startWavServer();
const browser = await chromium.launch({
  headless: false,
  args: [
    '--autoplay-policy=no-user-gesture-required',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
  ],
});
try {
  for (const track of picked) {
    await captureTrack(browser, track);
  }
} finally {
  await browser.close();
  wavServer.close();
  previewProc?.kill();
}
console.log('\ndone.');
