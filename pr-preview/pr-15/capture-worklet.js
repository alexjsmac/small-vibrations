/**
 * AudioWorklet processor that forwards mic PCM (device sample rate) to the
 * main thread in ~2048-sample batches, down-mixed to mono. Plain JS in
 * public/ so it can be loaded via audioWorklet.addModule() without bundler
 * involvement.
 *
 * The channel down-mix is the point of the loop below, not a nicety. Capture
 * devices are often stereo — line-in, loopback ("Stereo Mix"), USB
 * interfaces, mic arrays, virtual devices — and because MicInput asks
 * getUserMedia to disable echoCancellation/noiseSuppression/autoGainControl,
 * the browser's audio processing module is off and the device's native
 * channel layout reaches us untouched (with that module on, Chrome would
 * force mono). Reading channel 0 alone therefore handed the fingerprint
 * matcher pure silence on any device whose content sits on the right channel,
 * while the visuals — fed by an AnalyserNode, which down-mixes to mono per
 * spec — kept reacting normally. Net effect: no track was ever detected.
 * Averaging every channel matches both the analyser and the legacy
 * ScriptProcessor path, which asks for 1 input channel and lets the graph
 * perform the same down-mix.
 */
class SvCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(4096);
    this.n = 0;
  }

  process(inputs) {
    const chans = inputs[0];
    if (!chans || !chans.length || !chans[0] || !chans[0].length) return true;
    const frames = chans[0].length;

    // Only average channels the UA actually delivered at this block size;
    // anything ragged is ignored rather than risking undefined reads.
    let nch = 0;
    while (nch < chans.length && chans[nch] && chans[nch].length === frames) nch++;

    if (this.n + frames > this.buf.length) this.flush();
    const buf = this.buf;
    const base = this.n;

    if (nch === 1) {
      buf.set(chans[0], base);
    } else {
      for (let i = 0; i < frames; i++) {
        let sum = 0;
        for (let c = 0; c < nch; c++) sum += chans[c][i];
        buf[base + i] = sum / nch;
      }
    }

    this.n += frames;
    if (this.n >= 2048) this.flush();
    return true;
  }

  flush() {
    if (this.n === 0) return;
    const out = this.buf.slice(0, this.n);
    this.port.postMessage(out, [out.buffer]);
    this.n = 0;
  }
}

registerProcessor('sv-capture', SvCaptureProcessor);
