import { Separator } from './separator.js';
import { SEGMENT, STRIDE, SAMPLE_RATE } from './config.js';

const capacity = SEGMENT * 3;
const ringL = new Float32Array(capacity);
const ringR = new Float32Array(capacity);
let written = 0;
let nextStart = 0;
let busy = false;
let ready = false;
let failed = false;
const separator = new Separator();

function fail(error) {
  failed = true;
  postMessage({ type: 'ERROR', error: error?.message || String(error) });
}

async function pump() {
  if (!ready || busy || failed || written < nextStart + SEGMENT) return;
  busy = true;
  // Bound latency and memory: when behind, infer the latest complete aligned segment.
  const latest = Math.floor((written - SEGMENT) / STRIDE) * STRIDE;
  const skipped = Math.max(0, Math.floor((latest - nextStart) / STRIDE));
  if (skipped) nextStart = latest;
  const start = nextStart;
  nextStart += STRIDE;
  const left = new Float32Array(SEGMENT);
  const right = new Float32Array(SEGMENT);
  for (let i = 0; i < SEGMENT; i++) {
    left[i] = ringL[(start + i) % capacity];
    right[i] = ringR[(start + i) % capacity];
  }
  const began = performance.now();
  try {
    const result = await separator.separate(left, right);
    const elapsed = (performance.now() - began) / 1000;
    postMessage({ type: 'PREDICTION', start, ...result }, [result.left.buffer, result.right.buffer]);
    postMessage({ type: 'INFERENCE', seconds: elapsed, realtime: (STRIDE / SAMPLE_RATE) / elapsed, skipped });
  } catch (error) {
    fail(error);
  } finally {
    busy = false;
    setTimeout(pump, 0);
  }
}

onmessage = async ({ data }) => {
  if (failed) return;
  if (data.type === 'INIT') {
    try {
      const backend = await separator.initialize();
      ready = true;
      postMessage({ type: 'READY', backend });
    } catch (error) { fail(error); }
    return;
  }
  if (data.type !== 'BLOCK') return;
  if (data.start !== written) {
    // Backpressure may discard old captured blocks. Resume from the next complete
    // aligned segment; never join samples from opposite sides of a missing interval.
    written = data.start;
    nextStart = Math.ceil(data.start / STRIDE) * STRIDE;
    ringL.fill(0); ringR.fill(0);
  }
  for (let i = 0; i < data.left.length; i++) {
    const index = written++ % capacity;
    ringL[index] = data.left[i];
    ringR[index] = data.right[i];
  }
  postMessage({ type: 'ACK' });
  pump();
};
