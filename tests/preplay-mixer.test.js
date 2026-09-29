import test from 'node:test';
import assert from 'node:assert/strict';
import { SyncedMixer } from '../src/preplay/mixer.js';

test('preprocessed audio follows video seek, pause and speed without a delay queue', async () => {
  const old = globalThis.AudioContext;
  class Parameter { setTargetAtTime(value) { this.value = value; } }
  class Node { connect(node) { return node; } disconnect() {} }
  const created = [];
  class Source extends Node {
    constructor() { super(); this.playbackRate = new Parameter(); created.push(this); }
    start(time, offset) { this.startTime = time; this.offset = offset; }
    stop() { this.stopped = true; }
  }
  class Context {
    currentTime = 10; destination = {};
    createGain() { return Object.assign(new Node(), { gain: new Parameter() }); }
    createWaveShaper() { return new Node(); }
    createBufferSource() { return new Source(); }
    async resume() {}
    async close() { this.closed = true; }
  }
  globalThis.AudioContext = Context;
  const video = { paused: false, seeking: false, readyState: 4, currentTime: 3, playbackRate: 1,
    addEventListener() {}, removeEventListener() {}, async play() { this.paused = false; }, pause() { this.paused = true; } };
  let mixer;
  try {
    mixer = new SyncedMixer(video, { duration: 60, sampleRate: 44100 }, {}, { voice: 1, background: 0, volume: 0.8 });
    await mixer.start();
    assert.equal(created[0].offset, 3, 'start at video timestamp, not timestamp minus 20 seconds');
    assert.equal(created[1].offset, 3);
    assert.equal(mixer.dry.gain.value, 0); assert.equal(mixer.vocal.gain.value, 1);
    mixer.events.pause(); assert.ok(created[0].stopped); assert.equal(mixer.active, null);
    video.currentTime = 35; video.playbackRate = 1.5;
    await mixer.start(); assert.equal(created[2].offset, 35); assert.equal(created[2].playbackRate.value, 1.5);
    mixer.update({ voice: 0, background: 1, volume: 0.5 });
    assert.equal(mixer.vocal.gain.value, -1, 'residual accompaniment = original - vocals');
    assert.equal(mixer.master.gain.value, 0.5);
    video.paused = true; mixer.reconcile();
    assert.equal(mixer.active, null, 'clock check stops sound even if a pause event was missed');
    assert.ok(created[2].stopped);
  } finally {
    if (mixer) await mixer.dispose();
    if (old) globalThis.AudioContext = old; else delete globalThis.AudioContext;
  }
});
