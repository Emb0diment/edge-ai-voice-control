import test from 'node:test';
import assert from 'node:assert/strict';
import { preprocess } from '../src/audio/preprocess.js';
import { SEGMENT, STRIDE } from '../src/audio/config.js';

test('preprocessing covers short, exact and partial final windows without gaps or overlap gain', async () => {
  for (const length of [100, SEGMENT, SEGMENT + 1, SEGMENT + STRIDE + 100]) {
    const left = new Float32Array(length).fill(0.4);
    const right = new Float32Array(length).fill(-0.2);
    const progress = [];
    const separator = { async separate(l, r) {
      return { left: l.map(x => x / 2), right: r.map(x => x / 2) };
    } };
    const result = await preprocess(left, right, separator, p => progress.push(p));
    assert.equal(result.left.length, length);
    assert.ok(result.left.every(x => Math.abs(x - 0.2) < 1e-6));
    assert.ok(result.right.every(x => Math.abs(x + 0.1) < 1e-6));
    assert.equal(progress.at(-1).ratio, 1);
  }
});
test('cancelled preprocessing never yields a partially complete playable result', async () => {
  await assert.rejects(preprocess(new Float32Array(100), new Float32Array(100), {}, () => {}, () => true), /取消/);
});
