import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioTimeline, limit } from '../src/audio/timeline.js';
import { normalizeSettings } from '../src/settings.js';
import { SAMPLE_RATE } from '../src/audio/config.js';

test('settings reject invalid types, NaN and out-of-range gains', () => {
  const s = normalizeSettings({ voice: NaN, background: 9, volume: -1, delay: '20' });
  assert.equal(s.voice, 1); assert.equal(s.background, 2);
  assert.equal(s.volume, 0); assert.equal(s.delay, 20);
  assert.deepEqual(normalizeSettings(null), normalizeSettings());
});
test('equal gains exactly reconstruct original stereo below limiter', () => {
  const t = new AudioTimeline(0);
  t.push(0.4, -0.2);
  t.addPrediction(0, new Float32Array([0.25]), new Float32Array([0.1]));
  const l = new Float32Array(1), r = new Float32Array(1);
  t.render(l, r, 0, 1, 1, 1);
  assert.ok(Math.abs(l[0] - 0.4) < 1e-6); assert.ok(Math.abs(r[0] + 0.2) < 1e-6);
});
test('vocal-only and instrumental-only are complementary', () => {
  for (const [vg, bg, expected] of [[1, 0, 0.3], [0, 1, 0.2], [0, 0, 0]]) {
    const t = new AudioTimeline(0); t.push(0.5, 0.5);
    t.addPrediction(0, new Float32Array([0.3]), new Float32Array([0.3]));
    const a = new Float32Array(1), b = new Float32Array(1);
    t.render(a, b, 0, vg, bg, 1);
    assert.ok(Math.abs(a[0] - expected) < 1e-6);
  }
});
test('audio is silent during priming, then has an exact fixed delay', () => {
  const t = new AudioTimeline(4 / SAMPLE_RATE);
  const a = new Float32Array(9), b = new Float32Array(9);
  for (let i = 0; i < 9; i++) { t.push((i + 1) / 100, 0); t.render(a, b, i, 1, 1, 1); }
  assert.deepEqual(Array.from(a.slice(0, 4)), [0, 0, 0, 0]);
  assert.ok(Math.abs(a[4] - 0.01) < 1e-6);
  assert.ok(Math.abs(a[8] - 0.05) < 1e-6);
});
test('late predictions are dropped and cannot corrupt already-played timestamps', () => {
  const t = new AudioTimeline(0); const a = new Float32Array(1), b = new Float32Array(1);
  t.push(0.2, 0.2); t.render(a, b, 0, 0, 1, 1);
  t.addPrediction(0, new Float32Array([0.9]), new Float32Array([0.9]));
  assert.equal(t.weight[0], 0); assert.equal(t.missed, 1);
});
test('overlapping model results are normalized instead of double amplified', () => {
  const t = new AudioTimeline(0); t.push(0.5, 0.5);
  const v = new Float32Array([0.25]); t.addPrediction(0, v, v); t.addPrediction(0, v, v);
  const a = new Float32Array(1), b = new Float32Array(1); t.render(a, b, 0, 1, 0, 1);
  assert.ok(Math.abs(a[0] - 0.25) < 1e-6);
});
test('ring wrap never reuses stale AI predictions', () => {
  const t = new AudioTimeline(0); const a = new Float32Array(1), b = new Float32Array(1);
  const v = new Float32Array([0.1]);
  for (let i = 0; i <= t.capacity; i++) {
    t.push(0.2, 0.2);
    if (i === 0) t.addPrediction(i, v, v);
    t.render(a, b, 0, 1, 0, 1);
  }
  assert.ok(Math.abs(a[0] - 0.2) < 1e-6); assert.equal(t.covered, 1);
});
test('limiter preserves quiet samples, bounds overload and rejects NaN', () => {
  assert.equal(limit(0.5), 0.5); assert.equal(limit(NaN), 0);
  for (const x of [-100, -1, 0, 1, 100]) assert.ok(Math.abs(limit(x)) <= 1);
});
