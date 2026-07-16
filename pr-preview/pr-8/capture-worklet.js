/**
 * AudioWorklet processor that forwards raw mic PCM (channel 0, device sample
 * rate) to the main thread in ~2048-sample batches. Plain JS in public/ so it
 * can be loaded via audioWorklet.addModule() without bundler involvement.
 */
class SvCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(4096);
    this.n = 0;
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch && ch.length) {
      if (this.n + ch.length > this.buf.length) this.flush();
      this.buf.set(ch, this.n);
      this.n += ch.length;
      if (this.n >= 2048) this.flush();
    }
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
