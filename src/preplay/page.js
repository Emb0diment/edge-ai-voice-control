import { normalizeSettings } from '../settings.js';
import { SAMPLE_RATE } from '../audio/config.js';
import { MAX_DURATION, validateSource } from './source.js';
import { SyncedMixer } from './mixer.js';
import { encodeStemWav } from './wav.js';
const $ = id => document.getElementById(id);
const MAX_BYTES = 100 * 1024 * 1024;
let source, worker, controller, mixer, original;
let generation = 0;
let ready = false;
let settings = normalizeSettings();
let exporting = false;

function showError(error) { $('error').textContent = error?.message || String(error); $('error').hidden = false; }
function setStatus(title, detail) { $('status').textContent = title; if (detail) $('detail').textContent = detail; }
function renderSettings() {
  for (const key of ['voice', 'background', 'volume']) {
    $(key).value = settings[key]; $(`${key}-value`).textContent = `${Math.round(settings[key] * 100)}%`;
  }
}
async function cleanup() {
  controller?.abort(); controller = null; worker?.terminate(); worker = null;
  $('video').pause();
  if (mixer) { const previous = mixer; mixer = null; await previous.dispose(); }
  original = null; ready = false;
  $('video').removeAttribute('src'); $('video').load(); $('video').controls = false;
  $('placeholder').hidden = false; $('play').disabled = true; $('mixers').disabled = true;
}
async function readAudio(url, signal) {
  const response = await fetch(url, { credentials: 'omit', signal: AbortSignal.any([signal, AbortSignal.timeout(45000)]) });
  if (!response.ok) throw new Error(`音轨读取失败（HTTP ${response.status}）。请刷新 B 站页面后重新打开预处理。`);
  const expected = Number(response.headers.get('Content-Length') || 0);
  if (expected > MAX_BYTES) throw new Error('音轨文件超过 100 MB，当前实验版暂不支持。');
  const reader = response.body.getReader(); const chunks = []; let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BYTES) throw new Error('音轨文件超过 100 MB，已停止读取。');
      chunks.push(value);
      setStatus('正在读取音轨…', `已读取 ${(bytes / 1048576).toFixed(1)} MB${expected ? ` / ${(expected / 1048576).toFixed(1)} MB` : ''}`);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const data = new Uint8Array(bytes); let offset = 0;
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
  return data.buffer;
}
async function processAudio() {
  const run = ++generation;
  await cleanup();
  if (run !== generation) return;
  $('error').hidden = true; $('start').disabled = true; $('cancel').disabled = false;
  document.title = '【处理中】清声 · 可继续观看原视频';
  $('progress').value = 0; $('percent').textContent = '0%';
  controller = new AbortController();
  const signal = controller.signal;
  try {
    let bytes, lastError;
    for (const url of source.audio) {
      try { bytes = await readAudio(url, signal); break; }
      catch (error) { lastError = error; if (signal.aborted) throw error; }
    }
    if (!bytes) throw lastError;
    if (run !== generation) return;
    setStatus('正在解码音轨…');
    const decoder = new OfflineAudioContext(2, 1, SAMPLE_RATE);
    const decoded = await decoder.decodeAudioData(bytes); bytes = null;
    if (run !== generation) return;
    if (decoded.numberOfChannels > 2) throw new Error('当前预处理仅支持单声道或立体声音轨。');
    if (decoded.duration > MAX_DURATION || Math.abs(decoded.duration - source.duration) > 3) {
      throw new Error('解码后的音轨长度超出范围或与画面不一致，请重新读取当前视频。');
    }
    original = decoded;
    const left = decoded.getChannelData(0).slice();
    const right = decoded.getChannelData(decoded.numberOfChannels > 1 ? 1 : 0).slice();
    worker = new Worker(chrome.runtime.getURL('src/preplay/worker.js'), { type: 'module' });
    worker.onerror = event => { if (run === generation) handleFailure(new Error(event.message || 'AI 线程异常。')); };
    worker.onmessage = ({ data }) => {
      if (run !== generation) return;
      if (data.type === 'STATUS') setStatus(data.text);
      if (data.type === 'BACKEND') $('detail').textContent = `运行方式：${data.backend}。正在处理第一个音频片段…`;
      if (data.type === 'PROGRESS') {
        $('progress').value = data.ratio; $('percent').textContent = `${Math.round(data.ratio * 100)}%`;
        setStatus('正在分离人声与伴奏…', `${data.completed} / ${data.total} 个片段 · 预计剩余 ${Math.ceil(data.remaining)} 秒。可回到 B 站继续观看原视频。`);
      }
      if (data.type === 'ERROR') handleFailure(new Error(data.error));
      if (data.type === 'DONE') finish(data);
    };
    worker.postMessage({ type: 'PROCESS', left, right }, [left.buffer, right.buffer]);
  } catch (error) { if (run === generation) handleFailure(error); }
}
function handleFailure(error) {
  document.title = '【处理失败】清声 · 原视频不受影响';
  worker?.terminate(); worker = null; controller?.abort();
  original = null;
  $('start').disabled = false; $('cancel').disabled = true;
  setStatus('预处理未完成', '没有播放不完整的分离结果。可以查看错误后重试。'); showError(error);
}
function finish(data) {
  try {
    const vocals = new AudioBuffer({ numberOfChannels: 2, length: data.left.length, sampleRate: SAMPLE_RATE });
    vocals.copyToChannel(data.left, 0); vocals.copyToChannel(data.right, 1);
    mixer = new SyncedMixer($('video'), original, vocals, settings, showError);
    worker?.terminate(); worker = null; ready = true;
    $('video').src = source.video[0]; $('video').controls = true;
    $('placeholder').hidden = true; $('play').disabled = false; $('mixers').disabled = false;
    $('cancel').disabled = false; $('start').disabled = true;
    $('progress').value = 1; $('percent').textContent = '100%';
    document.title = '【处理完成】清声 · 可切换播放';
    setStatus('处理完成，可以切换播放', '原视频不会被打断。想听处理后的声音时，请先暂停原 B 站视频，再点击本页的播放按钮，避免两路声音重叠。');
  } catch (error) { handleFailure(error); }
}
$('start').addEventListener('click', processAudio);
$('cancel').addEventListener('click', async () => {
  generation++; await cleanup(); $('start').disabled = !source; $('cancel').disabled = true;
  document.title = '清声 · 先处理再播放';
  $('progress').value = 0; $('percent').textContent = '0%';
  setStatus('已取消', '已释放当前处理结果。再次开始需要重新处理音轨。');
});
$('play').addEventListener('click', () => mixer?.play().catch(showError));
async function exportStem(stem) {
  if (!ready || !mixer || exporting) return;
  exporting = true;
  $('save-vocals').disabled = $('save-accompaniment').disabled = true;
  const run = generation;
  try {
    $('export-status').textContent = '正在生成 WAV…';
    const blob = await encodeStemWav(original, mixer.vocals, stem, () => run !== generation);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const title = source.title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 80);
    link.href = url; link.download = `${title}-${stem === 'vocals' ? '人声' : '伴奏'}.wav`;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    $('export-status').textContent = '已发起保存。导出为原始分离音轨，不受播放音量滑块影响。';
  } catch (error) { showError(error); $('export-status').textContent = '导出未完成。'; }
  finally { exporting = false; $('save-vocals').disabled = $('save-accompaniment').disabled = false; }
}
$('save-vocals').addEventListener('click', () => exportStem('vocals'));
$('save-accompaniment').addEventListener('click', () => exportStem('accompaniment'));
$('return-source').addEventListener('click', async () => {
  try {
    const result = await chrome.runtime.sendMessage({ target: 'worker', type: 'PREPLAY_RETURN',
      jobId: new URL(location.href).searchParams.get('job') });
    if (!result?.ok) throw new Error(result?.error || '无法切换回原视频。');
  } catch (error) { showError(error); }
});
$('video').addEventListener('error', () => {
  if (ready) {
    mixer?.stop();
    showError('画面流加载失败或地址已过期。请关闭此播放页，刷新 B 站视频后重新打开预处理。');
  }
});
for (const key of ['voice', 'background', 'volume']) {
  $(key).addEventListener('input', () => {
    settings[key] = Number($(key).value); renderSettings(); mixer?.update(settings);
  });
  $(key).addEventListener('change', () => chrome.storage.local.set({ settings }));
}
document.querySelectorAll('[data-voice]').forEach(button => button.addEventListener('click', () => {
  settings.voice = Number(button.dataset.voice); settings.background = Number(button.dataset.background);
  renderSettings(); mixer?.update(settings); chrome.storage.local.set({ settings });
}));
addEventListener('pagehide', () => { generation++; worker?.terminate(); controller?.abort(); mixer?.dispose(); });

try {
  const jobId = new URL(location.href).searchParams.get('job');
  const result = await chrome.runtime.sendMessage({ target: 'worker', type: 'PREPLAY_SOURCE', jobId });
  if (!result?.ok) throw new Error(result?.error || '预处理会话不可用。');
  source = validateSource(result.data);
  if (!$('video').canPlayType(source.mime)) throw new Error('当前浏览器不能播放这段视频的画面格式。');
  $('title').textContent = source.title;
  settings = normalizeSettings((await chrome.storage.local.get('settings')).settings); renderSettings();
  $('start').disabled = false;
  setStatus('准备预处理', `视频时长 ${Math.ceil(source.duration)} 秒。即将在后台开始，B 站原声继续播放；保持此处理页打开即可。完成后标签标题会提示，不会自动切换播放。`);
  // The user already requested preprocessing in the popup. Start in this inactive
  // tab; no second click and no focus change are needed to keep the source audible.
  await processAudio();
} catch (error) { setStatus('无法读取视频'); showError(error); }
