import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
test('real-time observer reports Bilibili pause/resume without changing the player', async () => {
  const events = new Map(), sent = [];
  let stopListener, poll, cleared = false;
  const video = { paused: false, ended: false, seeking: false };
  const context = {
    document: { querySelector: () => video, querySelectorAll: () => [video],
      addEventListener: (event, fn) => events.set(event, fn), removeEventListener: event => events.delete(event) },
    chrome: { runtime: { id: 'test', sendMessage: async message => { sent.push(message); },
      onMessage: { addListener: fn => { stopListener = fn; }, removeListener() {} } } },
    setInterval: fn => { poll = fn; return 1; }, clearInterval: () => { cleared = true; },
  };
  vm.runInNewContext(await readFile(new URL('../src/audio/media-events.js', import.meta.url), 'utf8'), context);
  assert.equal(sent.at(-1).paused, false);
  video.paused = true; events.get('pause')(); assert.equal(sent.at(-1).paused, true);
  video.paused = false; events.get('playing')(); assert.equal(sent.at(-1).paused, false);
  video.paused = true; poll(); assert.equal(sent.at(-1).paused, true);
  stopListener({ target: 'media-observer', type: 'STOP' }, { id: 'test' });
  assert.ok(cleared); assert.equal(events.size, 0);
});
