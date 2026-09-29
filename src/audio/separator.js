import * as ort from '../../vendor/ort/ort.webgpu.min.mjs';
import { prepareModelInput, standaloneIspec } from '../../vendor/demucs/processor.js';
import { SEGMENT } from './config.js';

/** Adapter around the reference model. UI and streaming know nothing about ONNX shapes. */
export class Separator {
  async initialize(modelData = null) {
    ort.env.wasm.wasmPaths = new URL('../../vendor/ort/', import.meta.url).href;
    ort.env.wasm.numThreads = 1; // Avoid nested workers and MV3 blob-worker restrictions.
    ort.env.wasm.proxy = false;
    const model = modelData ?? new URL('../../models/htdemucs.onnx', import.meta.url).href;
    let providers = ['wasm'];
    if (globalThis.navigator?.gpu) {
      try {
        if (await navigator.gpu.requestAdapter()) providers = ['webgpu', 'wasm'];
      } catch { /* CPU fallback remains explicit in diagnostics. */ }
    }
    const options = { executionProviders: providers, graphOptimizationLevel: 'basic' };
    try {
      this.session = await ort.InferenceSession.create(model, options);
      this.backend = providers[0] === 'webgpu' ? 'WebGPU（部分算子可能由 CPU 执行）' : 'WASM / CPU';
    } catch (error) {
      if (providers[0] === 'wasm') throw error;
      this.session = await ort.InferenceSession.create(model, { ...options, executionProviders: ['wasm'] });
      this.backend = 'WASM / CPU（GPU 初始化失败）';
    }
    return this.backend;
  }
  async separate(left, right) {
    // Normalize like Demucs' reference preprocessing; avoid amplifying near-silence.
    let mean = 0;
    for (let i = 0; i < SEGMENT; i++) mean += (left[i] + right[i]) / (2 * SEGMENT);
    let variance = 0;
    for (let i = 0; i < SEGMENT; i++) variance += ((left[i] + right[i]) * 0.5 - mean) ** 2;
    const scale = Math.sqrt(variance / Math.max(1, SEGMENT - 1));
    // Out-of-phase stereo may have a silent mid channel: use channel RMS then.
    let rms = 0;
    for (let i = 0; i < SEGMENT; i++) rms += left[i] ** 2 + right[i] ** 2;
    if (rms / (2 * SEGMENT) < 1e-12) {
      return { left: new Float32Array(SEGMENT), right: new Float32Array(SEGMENT) };
    }
    const gain = Math.max(scale, Math.sqrt(rms / (2 * SEGMENT)) * 0.1, 1e-5);
    const normalL = new Float32Array(SEGMENT);
    const normalR = new Float32Array(SEGMENT);
    for (let i = 0; i < SEGMENT; i++) {
      normalL[i] = (left[i] - mean) / gain;
      normalR[i] = (right[i] - mean) / gain;
    }
    const input = prepareModelInput(normalL, normalR);
    const wave = new ort.Tensor('float32', input.waveform, [1, 2, SEGMENT]);
    const spec = new ort.Tensor('float32', input.magSpec, [1, 4, 2048, 336]);
    const feeds = { [this.session.inputNames[0]]: wave, [this.session.inputNames[1]]: spec };
    let results;
    try {
      results = await this.session.run(feeds);
      const tensors = Object.values(results);
      const time = tensors.find(t => t.dims.length === 4 && t.dims[1] === 4 && t.dims[2] === 2);
      const freq = tensors.find(t => t.dims.length === 5 && t.dims[1] === 4 && t.dims[2] === 4);
      if (!time || time.dims[3] !== SEGMENT || !freq) throw new Error('模型输出与预期不一致。');
      // Only reconstruct vocals (track 3); accompaniment = original - vocals.
      const width = 2048 * 336;
      const base = 3 * 4 * width;
      const vocalSpec = {
        leftReal: freq.data.subarray(base, base + width),
        leftImag: freq.data.subarray(base + width, base + 2 * width),
        rightReal: freq.data.subarray(base + 2 * width, base + 3 * width),
        rightImag: freq.data.subarray(base + 3 * width, base + 4 * width),
      };
      const vocal = standaloneIspec(vocalSpec, SEGMENT);
      for (let i = 0; i < SEGMENT; i++) {
        vocal.left[i] = (time.data[6 * SEGMENT + i] + vocal.left[i]) * gain;
        vocal.right[i] = (time.data[7 * SEGMENT + i] + vocal.right[i]) * gain;
        if (!Number.isFinite(vocal.left[i]) || !Number.isFinite(vocal.right[i])) {
          throw new Error('模型输出包含无效样本，已停止处理。');
        }
      }
      return vocal;
    } finally {
      wave.dispose();
      spec.dispose();
      if (results) for (const tensor of Object.values(results)) tensor.dispose();
    }
  }
}
