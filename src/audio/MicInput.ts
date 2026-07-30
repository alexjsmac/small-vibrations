import { DSP, StreamResampler } from './dsp';

/**
 * Microphone capture. Opens getUserMedia with the "music" constraints
 * (echo cancellation / noise suppression / AGC all OFF — they mangle music),
 * exposes an AnalyserNode for viz reactivity, and streams 12 kHz mono PCM to
 * `onSamples` for the fingerprint matcher.
 *
 * Must be created from a user gesture (iOS requires it for both mic
 * permission and a running AudioContext).
 */
export class MicInput {
  onSamples: ((chunk12k: Float32Array) => void) | null = null;

  /**
   * Smoothed RMS of the mono signal actually handed to the matcher. This is
   * deliberately measured on the matcher's own input rather than the
   * analyser's: the two can disagree (see capture-worklet.js), and a `level`
   * pinned at 0 while the visuals dance is the signature of a capture path
   * that has gone deaf. Surfaced in the `?debug=1` HUD.
   */
  level = 0;

  private constructor(
    readonly ctx: AudioContext,
    readonly analyser: AnalyserNode,
    private stream: MediaStream,
    private captureNode: AudioNode,
    private resampler: StreamResampler,
  ) {}

  static async open(): Promise<MicInput> {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });

    let ctx = new AudioContext();
    if (ctx.sampleRate < DSP.sampleRate) {
      // A handful of devices default the context below the matcher's working
      // rate — Bluetooth hands-free profiles report 8 kHz, for one — and the
      // resampler can only decimate. Pin a rate it can consume instead of
      // failing the whole mic path.
      void ctx.close();
      ctx = new AudioContext({ sampleRate: 48000 });
    }
    await ctx.resume();

    const track = stream.getAudioTracks()[0];
    const settings = track?.getSettings?.() ?? {};
    console.info(
      `[audio] mic "${track?.label ?? '?'}" — ${settings.channelCount ?? '?'}ch @ ` +
      `${settings.sampleRate ?? '?'} Hz; context ${ctx.sampleRate} Hz → matcher ${DSP.sampleRate} Hz`,
    );

    const source = ctx.createMediaStreamSource(stream);

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.75;
    source.connect(analyser);

    const resampler = new StreamResampler(ctx.sampleRate, DSP.sampleRate);
    // Keep the capture path "audible" to the graph via a muted gain so
    // browsers don't optimize it away — without ever looping mic → speakers.
    const mute = ctx.createGain();
    mute.gain.value = 0;
    mute.connect(ctx.destination);

    let captureNode: AudioNode;
    let mic!: MicInput;
    const feed = (chunk: Float32Array) => {
      let sum = 0;
      for (let i = 0; i < chunk.length; i++) sum += chunk[i] * chunk[i];
      mic.level = mic.level * 0.8 + Math.sqrt(sum / (chunk.length || 1)) * 0.2;
      const out = mic.resampler.process(chunk);
      if (out.length && mic.onSamples) mic.onSamples(out);
    };

    if (ctx.audioWorklet) {
      await ctx.audioWorklet.addModule(import.meta.env.BASE_URL + 'capture-worklet.js');
      // Left at the default channelCountMode 'max' on purpose: the worklet
      // sees every channel the device offers and averages them itself, so the
      // down-mix never depends on the UA's channel-layout rules.
      const node = new AudioWorkletNode(ctx, 'sv-capture', { numberOfOutputs: 1 });
      node.port.onmessage = (e: MessageEvent<Float32Array>) => feed(e.data);
      source.connect(node);
      node.connect(mute);
      captureNode = node;
    } else {
      // Legacy fallback (old Safari): deprecated but universally supported.
      // The single input channel makes the graph down-mix to mono for us,
      // matching what the worklet path does by hand.
      const node = ctx.createScriptProcessor(4096, 1, 1);
      node.onaudioprocess = (e) => feed(e.inputBuffer.getChannelData(0));
      source.connect(node);
      node.connect(mute);
      captureNode = node;
    }

    mic = new MicInput(ctx, analyser, stream, captureNode, resampler);
    return mic;
  }

  close() {
    this.onSamples = null;
    this.captureNode.disconnect();
    for (const t of this.stream.getTracks()) t.stop();
    void this.ctx.close();
  }
}
