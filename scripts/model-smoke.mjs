import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Separator } from '../src/audio/separator.js';
import { SEGMENT, SAMPLE_RATE, STRIDE } from '../src/audio/config.js';

// Executes the actual bundled ONNX model on CPU. This is a numerical smoke test,
// not an Edge integration test or a subjective separation-quality benchmark.
const separator = new Separator();
try {
  const bytes = new Uint8Array(await readFile(new URL('../models/htdemucs.onnx', import.meta.url)));
  const backend = await separator.initialize(bytes);
  const left = new Float32Array(SEGMENT), right = new Float32Array(SEGMENT);
  for (let i = 0; i < SEGMENT; i++) {
    left[i] = 0.15 * Math.sin(2 * Math.PI * 220 * i / SAMPLE_RATE) + 0.05 * Math.sin(2 * Math.PI * 880 * i / SAMPLE_RATE);
    right[i] = 0.15 * Math.sin(2 * Math.PI * 220 * i / SAMPLE_RATE) - 0.05 * Math.sin(2 * Math.PI * 880 * i / SAMPLE_RATE);
  }
  const began = performance.now();
  const vocal = await separator.separate(left, right);
  const seconds = (performance.now() - began) / 1000;
  assert.equal(vocal.left.length, SEGMENT);
  assert.equal(vocal.right.length, SEGMENT);
  assert.ok(vocal.left.every(Number.isFinite));
  assert.ok(vocal.right.every(Number.isFinite));
  console.log(JSON.stringify({ result: 'PASS', backend, samples: SEGMENT,
    inferenceSeconds: seconds, continuousRealtimeFactor: STRIDE / SAMPLE_RATE / seconds }, null, 2));
} finally {
  if (separator.session) await separator.session.release();
}
