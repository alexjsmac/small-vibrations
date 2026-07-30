/**
 * Capture-path regression test for the shipped `capture-worklet.js`.
 *
 * The bug this exists for: the worklet used to forward channel 0 only. On any
 * stereo capture device whose content isn't on the left channel — common on
 * Windows (line-in, loopback/"Stereo Mix", USB interfaces, virtual devices),
 * and reachable because MicInput disables the browser's audio processing,
 * which would otherwise force mono — the fingerprint matcher received pure
 * silence and no track was ever detected. The visuals kept moving the whole
 * time, because they're driven by an AnalyserNode, which down-mixes to mono
 * per spec. That divergence is what made it invisible in testing, so this
 * asserts both halves: analyser alive AND capture non-silent.
 *
 * Not a unit test because it needs a real AudioContext, a real AudioWorklet,
 * and the real file from `public/` — see the test-layout notes in CLAUDE.md.
 * A MediaStreamAudioDestinationNode stands in for the device: it exercises the
 * same MediaStreamAudioSourceNode → AudioWorkletNode channel plumbing without
 * needing hardware.
 */
import { test, expect } from '@playwright/test';

interface CaptureProbe {
  workletSawChannels: number | null;
  perChannelRms: number[] | null;
  capturedRms: number;
  capturedSamples: number;
  analyserPeakByte: number;
}

/**
 * Runs the shipped worklet against a 2-channel source carrying a 440 Hz tone
 * on the RIGHT channel and silence on the LEFT, wired up the way MicInput
 * wires it (default channelCountMode, muted gain to the destination).
 */
async function probeStereoCapture(page: import('@playwright/test').Page): Promise<CaptureProbe> {
  return page.evaluate(async (workletUrl) => {
    const ctx = new AudioContext();
    await ctx.resume();

    const osc = ctx.createOscillator();
    osc.frequency.value = 440;
    osc.start();
    const silent = ctx.createConstantSource();
    silent.offset.value = 0;
    silent.start();
    const merger = ctx.createChannelMerger(2);
    silent.connect(merger, 0, 0); // left: silence
    osc.connect(merger, 0, 1);    // right: the tone

    const dest = ctx.createMediaStreamDestination();
    merger.connect(dest);
    const source = ctx.createMediaStreamSource(dest.stream);

    // The analyser the visuals run on.
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.75;
    source.connect(analyser);

    // The capture path the matcher runs on.
    await ctx.audioWorklet.addModule(workletUrl);
    const node = new AudioWorkletNode(ctx, 'sv-capture', { numberOfOutputs: 1 });
    const mute = ctx.createGain();
    mute.gain.value = 0;
    mute.connect(ctx.destination);

    let capturedSum = 0;
    let capturedCount = 0;
    node.port.onmessage = (e: MessageEvent<Float32Array>) => {
      const chunk = e.data;
      for (let i = 0; i < chunk.length; i++) capturedSum += chunk[i] * chunk[i];
      capturedCount += chunk.length;
    };
    source.connect(node);
    node.connect(mute);

    // Read the channel layout the UA hands the graph, independently of the
    // worklet, so a failure says whether the source was even stereo.
    const splitter = ctx.createChannelSplitter(2);
    source.connect(splitter);
    const chanAnalysers = [0, 1].map((i) => {
      const a = ctx.createAnalyser();
      a.fftSize = 2048;
      splitter.connect(a, i);
      return a;
    });

    await new Promise((r) => setTimeout(r, 1500));

    const bytes = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(bytes);
    let analyserPeakByte = 0;
    for (const b of bytes) if (b > analyserPeakByte) analyserPeakByte = b;

    const perChannelRms = chanAnalysers.map((a) => {
      const t = new Float32Array(a.fftSize);
      a.getFloatTimeDomainData(t);
      let s = 0;
      for (let i = 0; i < t.length; i++) s += t[i] * t[i];
      return Math.sqrt(s / t.length);
    });

    const settings = dest.stream.getAudioTracks()[0].getSettings();
    return {
      workletSawChannels: settings.channelCount ?? null,
      perChannelRms,
      capturedRms: capturedCount ? Math.sqrt(capturedSum / capturedCount) : 0,
      capturedSamples: capturedCount,
      analyserPeakByte,
    };
  }, new URL('capture-worklet.js', page.url()).toString());
}

test('capture worklet down-mixes a stereo source instead of taking channel 0', async ({ page }) => {
  await page.goto('');
  const r = await probeStereoCapture(page);

  // Guard the fixture itself: the source must really be silent on the left.
  expect(r.perChannelRms, 'per-channel RMS unavailable').not.toBeNull();
  expect(r.perChannelRms![0], 'fixture: left channel should be silent').toBeLessThan(1e-3);
  expect(r.perChannelRms![1], 'fixture: right channel should carry the tone').toBeGreaterThan(0.1);

  // The worklet must have produced audio at all.
  expect(r.capturedSamples, 'worklet forwarded no samples').toBeGreaterThan(1000);

  // The visuals' analyser sees the tone (it down-mixes to mono per spec) …
  expect(r.analyserPeakByte, 'analyser saw no signal').toBeGreaterThan(0);
  // … and so must the matcher's capture path. Channel-0-only capture scores
  // exactly 0 here, which is the regression.
  expect(
    r.capturedRms,
    `matcher input was silent while the analyser saw signal (peak ${r.analyserPeakByte}) — ` +
    'capture worklet is not down-mixing all channels',
  ).toBeGreaterThan(0.01);
});
