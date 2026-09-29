import { normalizeSettings } from '../settings.js';
import { SAMPLE_RATE, SEGMENT, BLOCK } from './config.js';
import { captureErrorMessage } from './errors.js';

// Actual resource ownership stays here across service-worker sleep and popup close.
let engine = null;
let session = null;
let phase = 'idle';
let lastError = '';
let backend = '';
let inference = null;
let playback = null;
let loadTimer;
let inputQueue = [];
let inFlight = false;
const MAX_INPUT_BLOCKS = Math.ceil(2 * SEGMENT / BLOCK);

function drainInput() {
  if (inFlight || !engine || !inputQueue.length) return;
  inFlight = true;
  const data = inputQueue.shift();
  engine.postMessage(data, [data.left.buffer, data.right.buffer]);
}

function status() {
  return { phase, error: lastError, backend, inference, playback,
    listenMode: session?.listenMode ?? 'original', canListenAI: aiReady(),
    tabId: session?.tabId ?? null, settings: session?.settings ?? null,
    contextState: session?.context.state ?? null, mediaPaused: session?.mediaPaused ?? false };
}

function aiReady() {
  return playback?.priming === 0 && playback.coverage >= 0.99 && !playback.fallback;
}

function updateListenGains() {
  if (!session?.dryGain) return;
  const ai = session.listenMode === 'ai';
  session.dryGain.gain.setTargetAtTime(ai ? 0 : session.settings.volume, session.context.currentTime, 0.01);
  session.processedGain.gain.setTargetAtTime(ai ? 1 : 0, session.context.currentTime, 0.01);
}

async function dispose() {
  clearTimeout(loadTimer);
  engine?.terminate();
  engine = null;
  const old = session;
  session = null;
  if (old) {
    old.stream.getTracks().forEach(track => track.stop());
    old.source?.disconnect();
    old.node?.disconnect();
    old.dryGain?.disconnect();
    old.processedGain?.disconnect();
    old.playbackGate?.disconnect();
    old.node?.port.close();
    if (old.context.state !== 'closed') await old.context.close();
  }
  inference = playback = null;
  inputQueue = [];
  inFlight = false;
}

async function fail(error) {
  const tabId = session?.tabId;
  phase = 'error';
  lastError = error?.message || String(error);
  await dispose();
  chrome.runtime.sendMessage({ target: 'worker', type: 'AUDIO_ENDED', tabId }).catch(() => {});
}

function prepare() {
  if (phase === 'loading' || phase === 'ready' || phase === 'running') return status();
  lastError = '';
  phase = 'loading';
  engine = new Worker(chrome.runtime.getURL('src/audio/worker.js'), { type: 'module' });
  const current = engine;
  engine.onerror = event => { if (engine === current) fail(new Error(event.message || 'AI 线程意外退出。')); };
  engine.onmessage = ({ data }) => {
    if (engine !== current) return;
    switch (data.type) {
      case 'READY': clearTimeout(loadTimer); backend = data.backend; phase = 'ready'; break;
      case 'ERROR': fail(new Error(data.error)); break;
      case 'INFERENCE': inference = data; break;
      case 'ACK': inFlight = false; drainInput(); break;
      case 'PREDICTION':
        session?.node.port.postMessage(data, [data.left.buffer, data.right.buffer]);
        break;
    }
  };
  loadTimer = setTimeout(() => fail(new Error('模型准备超过 3 分钟，请检查可用内存或重试。')), 180000);
  engine.postMessage({ type: 'INIT' });
  return status();
}

async function start({ tabId, streamId, settings }) {
  if (session || phase !== 'ready') throw new Error('请先准备 AI 模型，且一次只处理一个标签页。');
  // COOP/COEP can place the offscreen consumer outside the capture caller's
  // renderer. Our single-threaded WASM path does not require these policies.
  if (globalThis.crossOriginIsolated === true) {
    lastError = '检测到与标签页捕获冲突的隔离设置。请在 edge://extensions 重新加载 1.0.1 或更新版本的清声扩展。';
    throw new Error(lastError);
  }
  lastError = '';
  phase = 'starting';
  let stream;
  let context;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } }, video: false,
    });
    context = new AudioContext({ latencyHint: 'interactive', sampleRate: SAMPLE_RATE });
    if (context.sampleRate !== SAMPLE_RATE) throw new Error('设备不支持模型所需的 44100 Hz 音频上下文。');
    const clean = normalizeSettings(settings);
    session = { tabId, stream, context, settings: clean };
    await context.audioWorklet.addModule(chrome.runtime.getURL('src/audio/processor.js'));
    const source = context.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(context, 'separation-mixer', {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
      channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers',
      processorOptions: clean,
    });
    Object.assign(session, { source, node });
    const current = session;
    node.port.onmessage = ({ data }) => {
      if (session !== current) return;
      if (data.type === 'BLOCK') {
        // Single in-flight message: synchronous WASM cannot grow a hidden port queue.
        if (inputQueue.length >= MAX_INPUT_BLOCKS) inputQueue.shift();
        inputQueue.push(data);
        drainInput();
      }
      if (data.type === 'PLAYBACK') {
        playback = data;
        if (session.listenMode === 'ai' && !aiReady()) {
          session.listenMode = 'original';
          updateListenGains();
        }
      }
    };
    node.onprocessorerror = () => { if (session === current) fail(new Error('音频线程异常，已恢复原声。')); };
    stream.getTracks().forEach(track => track.addEventListener('ended', () => {
      if (session === current) fail(new Error('标签页音频捕获结束，已停止处理。'));
    }, { once: true }));
    const playbackGate = context.createGain();
    const dryGain = context.createGain();
    const processedGain = context.createGain();
    // tabCapture suppresses native output. Restore a direct audible path before
    // waiting for any AI blocks; switching to delayed AI requires a user action.
    dryGain.gain.value = clean.volume;
    processedGain.gain.value = 0;
    Object.assign(session, { playbackGate, dryGain, processedGain, listenMode: 'original', mediaPaused: false });
    source.connect(dryGain).connect(playbackGate);
    source.connect(node).connect(processedGain).connect(playbackGate);
    playbackGate.connect(context.destination);
    await context.resume();
    if (context.state !== 'running') throw new Error('音频设备未运行，请重试。');
    phase = 'running';
    return status();
  } catch (error) {
    // getUserMedia failed before creating any audio resources. Retain the ready
    // model instead of destroying it and making every retry reload 180 MB.
    if (!stream && engine) {
      phase = 'ready';
      lastError = captureErrorMessage(error);
      throw new Error(lastError);
    }
    stream?.getTracks().forEach(track => track.stop());
    if (!session && context && context.state !== 'closed') await context.close();
    await fail(error);
    throw error;
  }
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id || message?.target !== 'audio') return;
  const handle = async () => {
    switch (message.type) {
      case 'STATUS': return status();
      case 'PREPARE': return prepare();
      case 'START': return start(message);
      case 'STOP': await dispose(); phase = 'idle'; lastError = ''; return status();
      case 'LISTEN_MODE':
        if (!session || session.tabId !== message.tabId) throw new Error('当前标签页没有正在运行的音频处理。');
        if (!['original', 'ai'].includes(message.mode)) throw new Error('未知试听模式。');
        if (message.mode === 'ai' && !aiReady()) throw new Error('AI 音频尚未准备好，原声会继续播放。');
        session.listenMode = message.mode;
        updateListenGains();
        return status();
      case 'MEDIA_STATE':
        if (session?.tabId === message.tabId && session.playbackGate) {
          session.mediaPaused = message.paused === true;
          session.playbackGate.gain.setTargetAtTime(session.mediaPaused ? 0 : 1, session.context.currentTime, 0.005);
        }
        return status();
      case 'UPDATE':
        if (!session || session.tabId !== message.tabId) throw new Error('当前标签页没有正在运行的音频处理。');
        session.settings = { ...normalizeSettings(message.settings), delay: session.settings.delay };
        session.node.port.postMessage({ type: 'SETTINGS', settings: session.settings });
        updateListenGains();
        return status();
      default: throw new Error('未知音频操作。');
    }
  };
  handle().then(data => reply({ ok: true, data }), error => reply({ ok: false, error: error.message }));
  return true;
});
