import test from 'node:test';
import assert from 'node:assert/strict';

test('offscreen lifecycle owns resources, survives status queries, and recovers on failure', async () => {
  const saved = new Map(['chrome', 'navigator', 'Worker', 'AudioContext', 'AudioWorkletNode']
    .map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const listeners = [];
  const workers = [];
  const contexts = [];
  const tracks = [];
  const sent = [];
  const channels = [];
  let captureFails = false;
  const runtime = {
    id: 'test', getURL: path => `chrome-extension://test/${path}`,
    onMessage: { addListener: fn => listeners.push(fn) },
    sendMessage: async message => { sent.push(message); },
  };
  class FakeWorker {
    constructor() { workers.push(this); this.messages = []; this.terminated = false; }
    postMessage(message) { this.messages.push(message); }
    terminate() { this.terminated = true; }
    emit(data) { this.onmessage({ data }); }
  }
  class FakeContext {
    constructor() {
      this.sampleRate = 44100; this.state = 'suspended'; contexts.push(this);
      this.gains = []; this.currentTime = 0; this.sourceConnections = [];
      this.audioWorklet = { addModule: async () => {} }; this.destination = {};
    }
    createMediaStreamSource() { return { connect: node => { this.sourceConnections.push(node); return node; }, disconnect() {} }; }
    createGain() {
      const result = { gain: { value: 1, setTargetAtTime(value) { this.value = value; } }, connections: [],
        connect(node) { this.connections.push(node); return node; }, disconnect() {} };
      this.gains.push(result); return result;
    }
    async resume() { this.state = 'running'; }
    async close() { this.state = 'closed'; }
  }
  class FakeNode {
    constructor() {
      this.port = { messages: [], postMessage(data) { this.messages.push(data); }, close() {} };
      channels.push(this.port);
    }
    connect(node) { return node; }
    disconnect() {}
  }
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
    mediaDevices: { getUserMedia: async () => {
      if (captureFails) throw new Error('capture denied');
      const track = { stopped: false, stop() { this.stopped = true; },
        addEventListener(name, fn) { this[name] = fn; } };
      tracks.push(track); return { getTracks: () => [track] };
    } },
  } });
  Object.assign(globalThis, { chrome: { runtime }, Worker: FakeWorker, AudioContext: FakeContext, AudioWorkletNode: FakeNode });
  try {
    await import(`../src/audio/offscreen.js?test=${Date.now()}`);
    const message = (type, payload = {}) => new Promise(resolve => {
      listeners[0]({ target: 'audio', type, ...payload }, { id: 'test' }, resolve);
    });
    assert.equal((await message('PREPARE')).data.phase, 'loading');
    await message('PREPARE'); assert.equal(workers.length, 1, 'prepare is idempotent');
    workers[0].emit({ type: 'READY', backend: 'test' });
    const active = await message('START', { tabId: 7, streamId: 'fake', settings: { delay: 20 } });
    assert.equal(active.data.phase, 'running');
    const [gate, dry, processed] = contexts[0].gains;
    assert.equal(active.data.listenMode, 'original');
    assert.equal(dry.gain.value, 0.8, 'original audio is audible before any AI output');
    assert.equal(processed.gain.value, 0, 'delayed output starts muted');
    assert.ok(contexts[0].sourceConnections.includes(dry), 'source bypasses the AI worklet');
    assert.ok(dry.connections.includes(gate));
    assert.ok(processed.connections.includes(gate));
    assert.ok(gate.connections.includes(contexts[0].destination));
    assert.equal((await message('LISTEN_MODE', { tabId: 7, mode: 'ai' })).ok, false);
    channels[0].onmessage({ data: { type: 'PLAYBACK', priming: 0, coverage: 1, fallback: false } });
    assert.equal((await message('STATUS')).data.listenMode, 'original', 'AI readiness never interrupts original playback');
    assert.equal((await message('LISTEN_MODE', { tabId: 8, mode: 'ai' })).ok, false);
    assert.equal((await message('LISTEN_MODE', { tabId: 7, mode: 'ai' })).ok, true);
    assert.equal(dry.gain.value, 0); assert.equal(processed.gain.value, 1);
    channels[0].onmessage({ data: { type: 'PLAYBACK', priming: 0, coverage: 0, fallback: true } });
    assert.equal((await message('STATUS')).data.listenMode, 'original');
    assert.equal(dry.gain.value, 0.8); assert.equal(processed.gain.value, 0);
    assert.equal((await message('STATUS')).data.tabId, 7);
    assert.equal((await message('MEDIA_STATE', { tabId: 7, paused: true })).data.mediaPaused, true);
    assert.equal(gate.gain.value, 0, 'pause silences both original and AI paths');
    assert.equal((await message('MEDIA_STATE', { tabId: 8, paused: false })).data.mediaPaused, true);
    assert.equal((await message('MEDIA_STATE', { tabId: 7, paused: false })).data.mediaPaused, false);
    assert.equal(gate.gain.value, 1);
    const update = await message('UPDATE', { tabId: 7, settings: { voice: 0, background: 1, delay: 12 } });
    assert.equal(update.data.settings.delay, 20, 'delay must not jump during playback');
    assert.equal(update.data.settings.voice, 0);
    assert.equal((await message('UPDATE', { tabId: 8 })).ok, false, 'tab isolation');
    // A stalled synchronous worker must not accumulate unlimited postMessage payloads.
    for (let i = 0; i < 500; i++) {
      channels[0].onmessage({ data: { type: 'BLOCK', start: i * 4096,
        left: new Float32Array(1), right: new Float32Array(1) } });
    }
    assert.equal(workers[0].messages.filter(m => m.type === 'BLOCK').length, 1);
    workers[0].emit({ type: 'ACK' });
    const last = workers[0].messages.at(-1);
    assert.ok(last.start > 4096, 'old pending blocks are dropped');
    await message('STOP');
    assert.equal(contexts[0].state, 'closed'); assert.ok(tracks[0].stopped); assert.ok(workers[0].terminated);
    assert.equal((await message('STATUS')).data.phase, 'idle');
    await message('PREPARE'); workers[1].emit({ type: 'READY', backend: 'test' });
    await message('START', { tabId: 7, streamId: 'fake' });
    workers[1].emit({ type: 'ERROR', error: 'model failed' });
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal((await message('STATUS')).data.phase, 'error');
    assert.ok(tracks[1].stopped); assert.ok(workers[1].terminated);
    assert.equal(contexts[1].state, 'closed');
    assert.ok(sent.some(m => m.type === 'AUDIO_ENDED'));
    captureFails = true;
    await message('PREPARE'); workers[2].emit({ type: 'READY', backend: 'test' });
    const denied = await message('START', { tabId: 7, streamId: 'denied' });
    assert.equal(denied.ok, false); assert.match(denied.error, /capture denied/);
    assert.equal(workers[2].terminated, false, 'capture failure retains the model');
    assert.equal((await message('STATUS')).data.phase, 'ready');
    captureFails = false;
    const retry = await message('START', { tabId: 7, streamId: 'fresh' });
    assert.equal(retry.ok, true); assert.equal(retry.data.phase, 'running');
    assert.equal(workers.length, 3, 'retry must reuse the prepared model');
    await message('STOP');
  } finally {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});
