import test from 'node:test';
import assert from 'node:assert/strict';
import { SAMPLE_RATE } from '../src/audio/config.js';

test('worklet batches capture, handles mono input and applies AI stems after fixed delay', async () => {
  const oldBase = globalThis.AudioWorkletProcessor;
  const oldRegister = globalThis.registerProcessor;
  let Processor;
  const sent = [];
  globalThis.AudioWorkletProcessor = class {
    constructor() { this.port = { postMessage: m => sent.push(m) }; }
  };
  globalThis.registerProcessor = (name, ctor) => { Processor = ctor; };
  try {
    await import(`../src/audio/processor.js?test=${Date.now()}`);
    const processor = new Processor({ processorOptions: { delay: 12, voice: 1, background: 0, volume: 1 } });
    const input = new Float32Array(128).fill(0.4);
    const l = new Float32Array(128), r = new Float32Array(128);
    let total = 0;
    while (total < 12 * SAMPLE_RATE + 4096) {
      processor.process([[input]], [[l, r]]);
      total += 128;
      for (const message of sent.splice(0)) {
        if (message.type === 'BLOCK') {
          assert.equal(message.left.length, 4096);
          assert.equal(message.right[0], message.left[0], 'mono is duplicated');
          processor.port.onmessage({ data: { type: 'PREDICTION', start: message.start,
            left: new Float32Array(4096).fill(0.25), right: new Float32Array(4096).fill(0.25) } });
        }
      }
    }
    assert.ok(Math.abs(l[127] - 0.25) < 1e-5, 'vocal-only output is actual model prediction');
    assert.ok(Math.abs(r[127] - 0.25) < 1e-5);
  } finally {
    if (oldBase) globalThis.AudioWorkletProcessor = oldBase; else delete globalThis.AudioWorkletProcessor;
    if (oldRegister) globalThis.registerProcessor = oldRegister; else delete globalThis.registerProcessor;
  }
});
