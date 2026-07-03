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

    const ctx = new AudioContext();
    await ctx.resume();

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
      const out = mic.resampler.process(chunk);
      if (out.length && mic.onSamples) mic.onSamples(out);
    };

    if (ctx.audioWorklet) {
      await ctx.audioWorklet.addModule(import.meta.env.BASE_URL + 'capture-worklet.js');
      const node = new AudioWorkletNode(ctx, 'sv-capture', { numberOfOutputs: 1 });
      node.port.onmessage = (e: MessageEvent<Float32Array>) => feed(e.data);
      source.connect(node);
      node.connect(mute);
      captureNode = node;
    } else {
      // Legacy fallback (old Safari): deprecated but universally supported.
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
