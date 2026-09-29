import { SEGMENT, STRIDE, OVERLAP } from './config.js';

/** Shared pre-playback separation. Independent of URL/file loading and the player. */
export async function preprocess(left, right, separator, onProgress = () => {}, isCancelled = () => false) {
  if (!left.length || left.length !== right.length) throw new Error('音轨为空或左右声道长度不一致。');
  const vocals = { left: new Float32Array(left.length), right: new Float32Array(left.length) };
  const weights = new Float32Array(left.length);
  const total = Math.max(1, Math.ceil((left.length - SEGMENT) / STRIDE) + 1);
  for (let segment = 0; segment < total; segment++) {
    if (isCancelled()) throw new Error('处理已取消。');
    const start = segment * STRIDE;
    const count = Math.min(SEGMENT, left.length - start);
    const inputLeft = new Float32Array(SEGMENT);
    const inputRight = new Float32Array(SEGMENT);
    inputLeft.set(left.subarray(start, start + count));
    inputRight.set(right.subarray(start, start + count));
    const prediction = await separator.separate(inputLeft, inputRight);
    if (isCancelled()) throw new Error('处理已取消。');
    for (let i = 0; i < count; i++) {
      const weight = Math.min(segment === 0 ? 1 : (i + 1) / OVERLAP,
        segment === total - 1 ? 1 : (SEGMENT - i) / OVERLAP, 1);
      vocals.left[start + i] += prediction.left[i] * weight;
      vocals.right[start + i] += prediction.right[i] * weight;
      weights[start + i] += weight;
    }
    onProgress({ completed: segment + 1, total, ratio: (segment + 1) / total });
  }
  for (let i = 0; i < left.length; i++) {
    if (!weights[i]) throw new Error('预处理音轨时间线不完整。');
    vocals.left[i] /= weights[i];
    vocals.right[i] /= weights[i];
  }
  return vocals;
}
