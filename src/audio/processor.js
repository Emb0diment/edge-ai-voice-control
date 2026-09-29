import { AudioTimeline } from './timeline.js';
import { BLOCK, SAMPLE_RATE } from './config.js';
import { normalizeSettings } from '../settings.js';

class SeparationMixer extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.settings = normalizeSettings(options.processorOptions);
    this.voice = this.settings.voice;
    this.background = this.settings.background;
    this.volume = this.settings.volume;
    this.timeline = new AudioTimeline(this.settings.delay);
    this.left = new Float32Array(BLOCK);
    this.right = new Float32Array(BLOCK);
    this.fill = 0;
    this.frames = 0;
    this.predictions = [];
    this.smoothing = 1 - Math.exp(-1 / (0.015 * SAMPLE_RATE));
    this.port.onmessage = ({ data }) => {
      if (data.type === 'SETTINGS') this.settings = normalizeSettings(data.settings);
      if (data.type === 'PREDICTION') {
        if (this.predictions.length >= 2) this.predictions.shift();
        this.predictions.push({ ...data, cursor: 0 });
      }
    };
  }
  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (output.length !== 2) return true;
    // Amortize large prediction copies: no multi-hundred-thousand-sample loop in
    // an audio callback. Bounded work prevents an inference result causing a glitch.
    const pending = this.predictions[0];
    if (pending) {
      const end = Math.min(pending.left.length, pending.cursor + 2048);
      this.timeline.addPrediction(pending.start, pending.left, pending.right, pending.cursor, end);
      pending.cursor = end;
      if (end === pending.left.length) this.predictions.shift();
    }
    for (let i = 0; i < output[0].length; i++) {
      const l = input?.[0]?.[i] ?? 0;
      const r = input?.[1]?.[i] ?? l;
      this.timeline.push(l, r);
      this.left[this.fill] = l;
      this.right[this.fill++] = r;
      if (this.fill === BLOCK) {
        this.port.postMessage({ type: 'BLOCK', start: this.timeline.written - BLOCK,
          left: this.left, right: this.right }, [this.left.buffer, this.right.buffer]);
        this.left = new Float32Array(BLOCK);
        this.right = new Float32Array(BLOCK);
        this.fill = 0;
      }
      this.voice += this.smoothing * (this.settings.voice - this.voice);
      this.background += this.smoothing * (this.settings.background - this.background);
      this.volume += this.smoothing * (this.settings.volume - this.volume);
      this.timeline.render(output[0], output[1], i, this.voice, this.background, this.volume);
    }
    this.frames += output[0].length;
    if (this.frames >= SAMPLE_RATE / 2) {
      this.frames = 0;
      this.port.postMessage({ type: 'PLAYBACK',
        priming: Math.max(0, -this.timeline.read / SAMPLE_RATE),
        coverage: this.timeline.covered / Math.max(1, this.timeline.covered + this.timeline.missed),
        fallback: this.timeline.missed > 0,
      });
      this.timeline.missed = this.timeline.covered = 0;
    }
    return true;
  }
}
registerProcessor('separation-mixer', SeparationMixer);
