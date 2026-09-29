/** Export unadjusted stems as stereo 16-bit PCM WAV, independent of playback gains. */
export async function encodeStemWav(original, vocals, stem, cancelled = () => false) {
  if (!['vocals', 'accompaniment'].includes(stem)) throw new Error('未知音轨类型。');
  if (original.length !== vocals.length || original.sampleRate !== vocals.sampleRate) throw new Error('音轨长度或采样率不一致。');
  const frames = original.length, rate = original.sampleRate;
  const header = new ArrayBuffer(44), view = new DataView(header);
  const text = (offset, value) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
  text(0, 'RIFF'); view.setUint32(4, 36 + frames * 4, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 2, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 4, true);
  view.setUint16(32, 4, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, frames * 4, true);
  const raw = [original.getChannelData(0), original.getChannelData(original.numberOfChannels > 1 ? 1 : 0)];
  const voice = [vocals.getChannelData(0), vocals.getChannelData(1)];
  const parts = [header];
  for (let start = 0; start < frames; start += rate * 5) {
    if (cancelled()) throw new Error('导出已取消。');
    const count = Math.min(rate * 5, frames - start);
    const block = new ArrayBuffer(count * 4), pcm = new DataView(block);
    for (let i = 0; i < count; i++) {
      for (let channel = 0; channel < 2; channel++) {
        const at = start + i;
        const sample = stem === 'vocals' ? voice[channel][at] : raw[channel][at] - voice[channel][at];
        const bounded = Number.isFinite(sample) ? Math.max(-1, Math.min(1, sample)) : 0;
        pcm.setInt16(i * 4 + channel * 2, Math.round(bounded * (bounded < 0 ? 32768 : 32767)), true);
      }
    }
    parts.push(block);
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  if (cancelled()) throw new Error('导出已取消。');
  return new Blob(parts, { type: 'audio/wav' });
}
