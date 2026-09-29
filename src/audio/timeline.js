import { SAMPLE_RATE, SEGMENT, OVERLAP } from './config.js';

/** Bounded timestamped ring. The worklet never waits for an inference promise. */
export class AudioTimeline {
  constructor(delaySeconds) {
    this.delay = Math.round(delaySeconds * SAMPLE_RATE);
    this.capacity = this.delay + SEGMENT * 2;
    this.rawL = new Float32Array(this.capacity);
    this.rawR = new Float32Array(this.capacity);
    this.vocL = new Float32Array(this.capacity);
    this.vocR = new Float32Array(this.capacity);
    this.weight = new Float32Array(this.capacity);
    this.written = 0;
    this.read = -this.delay;
    this.missed = 0;
    this.covered = 0;
  }
  push(left, right) {
    const index = this.written++ % this.capacity;
    this.rawL[index] = left;
    this.rawR[index] = right;
    // No prediction is allowed before the input is captured.
    this.vocL[index] = 0;
    this.vocR[index] = 0;
    this.weight[index] = 0;
  }
  addPrediction(start, left, right, from = 0, to = left.length) {
    for (let i = from; i < to; i++) {
      const time = start + i;
      if (time < this.read || time >= this.written) continue;
      const index = time % this.capacity;
      // Complementary linear ramps in the overlap. The first segment needs no fade-in.
      const ramp = Math.min(start === 0 ? 1 : (i + 1) / OVERLAP,
        (left.length - i) / OVERLAP, 1);
      this.vocL[index] += left[i] * ramp;
      this.vocR[index] += right[i] * ramp;
      this.weight[index] += ramp;
    }
  }
  render(outputL, outputR, offset, voice, background, volume) {
    const time = this.read++;
    if (time < 0) {
      outputL[offset] = outputR[offset] = 0;
      return;
    }
    const index = time % this.capacity;
    const weight = this.weight[index];
    let l = this.rawL[index];
    let r = this.rawR[index];
    if (weight > 0) {
      // Residual accompaniment gives exact reconstruction when both gains are 1.
      l = background * l + (voice - background) * this.vocL[index] / weight;
      r = background * r + (voice - background) * this.vocR[index] / weight;
      this.covered++;
    } else {
      // Keep time moving if hardware cannot keep up. Never grow the output queue.
      // Fallback is intentionally the delayed original, surfaced in the UI.
      this.missed++;
    }
    outputL[offset] = limit(l * volume);
    outputR[offset] = limit(r * volume);
  }
}
export function limit(value) {
  if (!Number.isFinite(value)) return 0;
  const magnitude = Math.abs(value);
  return magnitude <= 0.9 ? value
    : Math.sign(value) * (0.9 + 0.1 * Math.tanh((magnitude - 0.9) / 0.1));
}
