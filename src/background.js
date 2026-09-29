import { DEFAULTS, normalizeSettings } from './settings.js';
import { openPreplay, preplaySource, onPreplayTabRemoved, returnToSource, viewPreplay } from './preplay/service.js';

let creating;
let mutationQueue = Promise.resolve();
const idle = () => ({ phase: 'idle', tabId: null });
const offscreenURL = chrome.runtime.getURL('offscreen.html');

async function exists() {
  return (await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [offscreenURL] })).length > 0;
}
async function ensureOffscreen() {
  if (await exists()) return;
  if (!creating) {
    creating = chrome.offscreen.createDocument({ url: 'offscreen.html',
      reasons: ['USER_MEDIA', 'WORKERS'],
      justification: '本地捕获并分离用户主动选中的标签页音频。',
    }).finally(() => { creating = null; });
  }
  await creating;
}
async function audio(type, payload = {}) {
  const result = await chrome.runtime.sendMessage({ target: 'audio', type, ...payload });
  if (!result?.ok) throw new Error(result?.error || '音频页面没有响应，请停止后重试。');
  return result.data;
}
async function getStatus() {
  return await exists() ? audio('STATUS') : idle();
}
function enqueue(task) {
  const result = mutationQueue.then(task);
  mutationQueue = result.catch(() => {});
  return result;
}
async function stop() {
  if (await exists()) {
    const previous = await audio('STATUS').catch(() => ({}));
    if (previous.tabId != null) await chrome.tabs.sendMessage(previous.tabId,
      { target: 'media-observer', type: 'STOP' }).catch(() => {});
    try { await audio('STOP'); }
    finally { await chrome.offscreen.closeDocument(); }
  }
  await chrome.action.setBadgeText({ text: '' });
  return idle();
}
async function command(message) {
  switch (message.type) {
    case 'STATE': {
      const stored = await chrome.storage.local.get('settings');
      return { settings: normalizeSettings(stored.settings || DEFAULTS), audio: await getStatus() };
    }
    case 'PREPARE':
      await ensureOffscreen();
      return audio('PREPARE');
    case 'PREPLAY_OPEN':
      await stop();
      return openPreplay(message.tabId);
    case 'PREPLAY_VIEW': return viewPreplay();
    case 'LISTEN_MODE': return audio('LISTEN_MODE', { tabId: message.tabId, mode: message.mode });
    case 'START': {
      const tab = await chrome.tabs.get(message.tabId);
      if (!tab.active || !/^https?:/.test(tab.url || '')) {
        throw new Error('请在正在播放视频的普通网页中打开插件；浏览器内部页面不支持。');
      }
      const state = await getStatus();
      if (state.phase !== 'ready') throw new Error('请先完成 AI 模型准备。');
      const settings = normalizeSettings(message.settings);
      const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
      const result = await audio('START', { tabId: tab.id, streamId, settings });
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/audio/media-events.js'] })
        .catch(() => {});
      await chrome.storage.local.set({ settings });
      await chrome.action.setBadgeBackgroundColor({ color: '#315fe9' });
      await chrome.action.setBadgeText({ text: 'AI' });
      return result;
    }
    case 'UPDATE': {
      const settings = normalizeSettings(message.settings);
      const state = await getStatus();
      if (state.phase === 'running' && state.tabId === message.tabId) {
        await audio('UPDATE', { tabId: message.tabId, settings });
      }
      await chrome.storage.local.set({ settings });
      return settings;
    }
    case 'STOP': return stop();
    default: throw new Error('未知操作。');
  }
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id || message?.target !== 'worker') return;
  if (message.type === 'AUDIO_ENDED' && sender.url === offscreenURL) {
    if (message.tabId != null) chrome.tabs.sendMessage(message.tabId,
      { target: 'media-observer', type: 'STOP' }).catch(() => {});
    chrome.action.setBadgeText({ text: '' });
    return;
  }
  if (message.type === 'MEDIA_STATE' && sender.tab?.id != null && typeof message.paused === 'boolean') {
    enqueue(async () => {
      if ((await getStatus()).tabId === sender.tab.id) {
        await audio('MEDIA_STATE', { tabId: sender.tab.id, paused: message.paused });
      }
    }).catch(() => {});
    return;
  }
  if (message.type === 'PREPLAY_SOURCE' || message.type === 'PREPLAY_RETURN') {
    const action = message.type === 'PREPLAY_RETURN' ? returnToSource : preplaySource;
    action(message, sender).then(data => reply({ ok: true, data }),
      error => reply({ ok: false, error: error.message }));
    return true;
  }
  if (sender.url !== chrome.runtime.getURL('popup.html')) return;
  const result = message.type === 'STATE' ? command(message) : enqueue(() => command(message));
  result.then(data => reply({ ok: true, data }), error => reply({ ok: false, error: error.message }));
  return true;
});
chrome.tabs.onRemoved.addListener(tabId => {
  onPreplayTabRemoved(tabId).catch(() => {});
  enqueue(async () => { if ((await getStatus()).tabId === tabId) await stop(); }).catch(() => {});
});
// New documents must not inherit buffered sound from the previous page.
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status !== 'loading') return;
  enqueue(async () => { if ((await getStatus()).tabId === tabId) await stop(); }).catch(() => {});
});
