import test from 'node:test';
import assert from 'node:assert/strict';
import { openPreplay, preplaySource, onPreplayTabRemoved, returnToSource, viewPreplay } from '../src/preplay/service.js';

test('preplay permission checks, isolated header rules and tab cleanup are scoped to one job', async () => {
  const old = globalThis.chrome;
  const data = {};
  const rules = [];
  const activated = [];
  const created = [];
  let granted = false, scriptCalls = 0;
  globalThis.chrome = {
    runtime: { id: 'test-extension', getURL: path => `chrome-extension://test-extension/${path}` },
    permissions: { contains: async () => granted },
    storage: { session: {
      get: async key => ({ [key]: data[key] }), set: async values => Object.assign(data, values),
      remove: async key => { delete data[key]; },
    } },
    declarativeNetRequest: { updateSessionRules: async update => rules.push(update) },
    scripting: { executeScript: async () => {
      scriptCalls++;
      return [{ result: { duration: 60, title: 'Test', audio: ['https://a.bilivideo.com/audio'], video: ['https://a.bilivideo.com/video'] } }];
    } },
    tabs: { create: async options => { created.push(options); return { id: 99 }; }, get: async id => ({ id }), update: async id => { activated.push(id); } },
  };
  try {
    await assert.rejects(openPreplay(7), /权限/); assert.equal(scriptCalls, 0);
    granted = true;
    assert.equal((await openPreplay(7)).playerTabId, 99);
    assert.equal(created[0].active, false, 'keep Bilibili visible while preprocessing starts');
    assert.deepEqual(activated, []);
    await openPreplay(7);
    assert.deepEqual(activated, [], 'repeated start must not steal focus either');
    assert.equal(scriptCalls, 1, 'preprocessing only reads metadata; it must not pause or mute the source');
    const rule = rules[0].addRules[0];
    assert.deepEqual(rule.condition.initiatorDomains, ['test-extension']);
    assert.deepEqual(rule.condition.requestDomains, ['bilivideo.com', 'bilivideo.cn', 'bilivideo.net']);
    assert.deepEqual(rule.condition.resourceTypes, ['xmlhttprequest', 'media']);
    const jobId = data.preplay.jobId;
    const request = { jobId };
    const sender = { url: `chrome-extension://test-extension/preplay.html?job=${jobId}`, tab: { id: 99 } };
    assert.equal((await preplaySource(request, sender)).title, 'Test');
    await returnToSource(request, sender);
    assert.deepEqual(activated, [7]);
    await viewPreplay();
    assert.deepEqual(activated, [7, 99], 'only an explicit view request activates the processing tab');
    assert.equal(scriptCalls, 1, 'return must not change source playback');
    await assert.rejects(preplaySource(request, { ...sender, tab: { id: 100 } }), /失效/);
    await onPreplayTabRemoved(100); assert.ok(data.preplay);
    await onPreplayTabRemoved(99); assert.equal(data.preplay, undefined);
    await assert.rejects(viewPreplay(), /尚未/);
    assert.deepEqual(rules.at(-1), { removeRuleIds: [10001] });
  } finally { if (old) globalThis.chrome = old; else delete globalThis.chrome; }
});
