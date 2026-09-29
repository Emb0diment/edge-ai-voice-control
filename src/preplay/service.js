import { MEDIA_ORIGINS, readBilibiliSource, validateSource } from './source.js';
const RULE_ID = 10001;

export async function clearPreplay() {
  await chrome.storage.session.remove('preplay');
  await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [RULE_ID] });
}
export async function openPreplay(tabId) {
  const existing = (await chrome.storage.session.get('preplay')).preplay;
  if (existing?.playerTabId) {
    try {
      await chrome.tabs.get(existing.playerTabId);
    } catch { await clearPreplay(); }
    if ((await chrome.storage.session.get('preplay')).preplay) {
      return { openedExisting: true, playerTabId: existing.playerTabId };
    }
  }
  if (!await chrome.permissions.contains({ origins: MEDIA_ORIGINS })) {
    throw new Error('预处理需要读取 B 站音轨，请在权限提示中允许访问视频 CDN。');
  }
  const result = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: readBilibiliSource });
  const source = validateSource(result[0]?.result);
  // Limit request headers to this extension's own CDN fetches and video playback.
  // Do not alter any request made by the Bilibili page or by other websites.
  await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [RULE_ID], addRules: [{
    id: RULE_ID, priority: 1, action: { type: 'modifyHeaders', requestHeaders: [
      { header: 'Referer', operation: 'set', value: 'https://www.bilibili.com/' },
    ] }, condition: { initiatorDomains: [chrome.runtime.id],
      requestDomains: ['bilivideo.com', 'bilivideo.cn', 'bilivideo.net'],
      resourceTypes: ['xmlhttprequest', 'media'] },
  }] });
  const jobId = crypto.randomUUID();
  await chrome.storage.session.set({ preplay: { jobId, source, sourceTabId: tabId, playerTabId: null } });
  try {
    const player = await chrome.tabs.create({ url: chrome.runtime.getURL(`preplay.html?job=${jobId}`), active: false });
    await chrome.storage.session.set({ preplay: { jobId, source, sourceTabId: tabId, playerTabId: player.id } });
    // Leave source playback and volume untouched while preprocessing runs.
    return { playerTabId: player.id };
  } catch (error) { await clearPreplay(); throw error; }
}
export async function preplaySource(message, sender) {
  const job = (await chrome.storage.session.get('preplay')).preplay;
  const expectedURL = chrome.runtime.getURL(`preplay.html?job=${job?.jobId}`);
  if (!job || message.jobId !== job.jobId || sender.url !== expectedURL ||
    (job.playerTabId != null && sender.tab?.id !== job.playerTabId)) throw new Error('预处理会话已失效，请从视频网页重新打开。');
  return job.source;
}
export async function onPreplayTabRemoved(tabId) {
  const job = (await chrome.storage.session.get('preplay')).preplay;
  if (job?.playerTabId === tabId) await clearPreplay();
}
export async function returnToSource(message, sender) {
  await preplaySource(message, sender);
  const job = (await chrome.storage.session.get('preplay')).preplay;
  try { await chrome.tabs.update(job.sourceTabId, { active: true }); }
  catch { throw new Error('原视频标签页已关闭，请手动重新打开 B 站。'); }
  return { returned: true };
}
export async function viewPreplay() {
  const job = (await chrome.storage.session.get('preplay')).preplay;
  if (!job?.playerTabId) throw new Error('尚未开始预处理。');
  try { await chrome.tabs.update(job.playerTabId, { active: true }); }
  catch { await clearPreplay(); throw new Error('处理页已关闭，请重新开始。'); }
  return { opened: true };
}
