import { DEFAULTS, normalizeSettings } from '../settings.js';
import { MEDIA_ORIGINS } from '../preplay/source.js';

const $ = id => document.getElementById(id);
let tabId;
let settings = { ...DEFAULTS };
let state = { phase: 'idle' };
let busy = false;
let saveTimer;
let initialized = false;

async function send(type, payload = {}) {
  const result = await chrome.runtime.sendMessage({ target: 'worker', type, tabId, ...payload });
  if (!result?.ok) throw new Error(result?.error || '插件未响应，请重新打开面板。');
  return result.data;
}
function showError(error) {
  $('error').textContent = error?.message || String(error);
  $('error').hidden = false;
}
function showSettings() {
  for (const key of ['voice', 'background', 'volume']) {
    $(key).value = settings[key];
    $(`${key}-value`).textContent = `${Math.round(settings[key] * 100)}%`;
  }
  $('delay').value = settings.delay;
  $('delay-note').textContent = `${settings.delay} 秒`;
}
function render() {
  const other = state.tabId != null && state.tabId !== tabId;
  const running = state.phase === 'running';
  $('mixers').disabled = other || busy;
  $('preplay').disabled = busy;
  $('view-preplay').disabled = busy;
  $('listen').disabled = busy || other || !running || (state.listenMode !== 'ai' && !state.canListenAI);
  $('listen').textContent = state.listenMode === 'ai' ? '切回原声' : '切换到 AI 音频（有缓冲延迟）';
  $('delay').disabled = running || busy || state.phase === 'starting';
  $('primary').disabled = busy || ['loading', 'running', 'starting'].includes(state.phase);
  $('primary').textContent = state.phase === 'ready'
    ? (state.error ? '重试读取声音' : '开始处理此标签页')
    : (state.phase === 'loading' ? '正在自动准备模型…' : '重新准备 AI 模型');
  $('stop').disabled = busy || state.phase === 'idle';
  $('stop').textContent = other ? '停止另一标签页' : '停止 / 恢复原声';
  const labels = { idle: '尚未启用', loading: '正在准备 AI 模型…', ready: 'AI 已就绪',
    starting: '正在连接音频…', running: other ? '另一标签页正在处理' : (state.listenMode === 'ai' ? 'AI 音频播放中' : '原声播放中 · AI 后台处理'), error: '处理已停止' };
  $('status').textContent = labels[state.phase] || state.phase;
  let detail = '打开面板会自动准备模型。默认继续播放原声。';
  if (state.phase === 'loading') detail = '正在自动准备模型，网页原声继续播放；关闭面板后仍会继续准备。';
  if (state.phase === 'ready') detail = '模型已准备好。点击“开始处理此标签页”后默认继续播放原声。';
  if (state.phase === 'ready' && state.error) {
    detail = '读取网页声音失败，AI 模型仍然就绪，可以直接重试。';
    showError(state.error);
  }
  if (state.phase === 'error') detail = state.error || '请重新准备模型。';
  if (running) {
    detail = state.listenMode === 'ai'
      ? `AI 声音落后画面 ${state.settings.delay} 秒，可随时切回原声。`
      : (state.canListenAI ? '原声继续播放。AI 已准备好，可点击下方按钮切换试听。' : '原声继续播放，AI 正在后台缓冲或处理。准备好后可手动切换。');
    if (state.contextState !== 'running') detail = '音频设备暂停，请停止后重新启用。';
    if (state.mediaPaused) detail = '视频已暂停，音频输出已静音。继续播放视频后恢复声音。';
  }
  $('detail').textContent = detail;
  if (state.phase === 'running') $('error').hidden = true;
  $('backend').textContent = state.backend || '未准备';
  $('speed').textContent = state.inference
    ? `${state.inference.realtime.toFixed(2)}×（≥ 1× 才能持续跟上）` : '等待推理';
  $('coverage').textContent = state.playback && state.playback.priming === 0
    ? `${Math.round(state.playback.coverage * 100)}%（最近半秒）` : '等待播放';
}
async function refresh() {
  const result = await send('STATE');
  state = result.audio;
  if (!initialized) {
    settings = normalizeSettings(state.tabId === tabId && state.settings ? state.settings : result.settings);
    showSettings();
    initialized = true;
  }
  render();
}
async function act(operation) {
  busy = true;
  $('error').hidden = true;
  render();
  try { await operation(); await refresh(); }
  catch (error) { showError(error); }
  finally { busy = false; render(); }
}
function save() {
  clearTimeout(saveTimer);
  send('UPDATE', { settings: { ...settings } }).catch(showError);
}
for (const key of ['voice', 'background', 'volume']) {
  $(key).addEventListener('input', () => {
    settings[key] = Number($(key).value);
    $(`${key}-value`).textContent = `${Math.round(settings[key] * 100)}%`;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 70);
  });
  $(key).addEventListener('change', save);
}
$('delay').addEventListener('change', () => {
  settings.delay = Number($('delay').value);
  showSettings(); save();
});
document.querySelectorAll('[data-voice]').forEach(button => {
  button.addEventListener('click', () => {
    settings.voice = Number(button.dataset.voice);
    settings.background = Number(button.dataset.background);
    showSettings(); save();
  });
});
$('primary').addEventListener('click', () => act(async () => {
  await send(state.phase === 'ready' ? 'START' : 'PREPARE', { settings });
}));
$('stop').addEventListener('click', () => act(() => send('STOP')));
$('listen').addEventListener('click', () => act(() => send('LISTEN_MODE', { mode: state.listenMode === 'ai' ? 'original' : 'ai' })));
$('view-preplay').addEventListener('click', () => act(() => send('PREPLAY_VIEW')));
$('preplay').addEventListener('click', () => {
  // Request optional hosts directly in the user gesture, before any async messaging.
  const grant = chrome.permissions.request({ origins: MEDIA_ORIGINS });
  act(async () => {
    if (!await grant) throw new Error('未允许读取 B 站音轨。你仍可使用下方的实时捕获模式。');
    await send('PREPLAY_OPEN');
    $('preplay-status').textContent = '已在后台开始处理，当前 B 站页面继续播放。点击“查看处理进度 / 保存音轨”打开处理页。';
  });
});

try {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab?.id;
  await refresh();
  // Only prepare once on opening: polling must not restart a stopped or failed
  // session. Existing loading/ready/running sessions keep their model and mode.
  if (['idle', 'error'].includes(state.phase)) {
    await act(() => send('PREPARE'));
  }
  // Polling is restricted to the visible popup; audio work has no UI dependency.
  setInterval(() => { if (!busy) refresh().catch(showError); }, 1000);
} catch (error) { showError(error); }
