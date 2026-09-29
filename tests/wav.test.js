import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeStemWav } from '../src/preplay/wav.js';
test('WAV exports separate unadjusted vocal and accompaniment tracks for editing', async () => {
  const buffer = values => ({ length: values[0].length, sampleRate: 44100, numberOfChannels: values.length,
    getChannelData: channel => new Float32Array(values[channel]) });
  const original = buffer([[0.6, -0.5], [0.4, -0.3]]), vocal = buffer([[0.2, -0.2], [0.1, -0.1]]);
  for (const [stem, expected] of [['vocals', [0.2, 0.1, -0.2, -0.1]], ['accompaniment', [0.4, 0.3, -0.3, -0.2]]]) {
    const bytes = await (await encodeStemWav(original, vocal, stem)).arrayBuffer();
    const view = new DataView(bytes);
    assert.equal(new TextDecoder().decode(bytes.slice(0, 4)), 'RIFF');
    assert.equal(view.getUint16(22, true), 2); assert.equal(view.getUint32(24, true), 44100);
    assert.equal(view.getUint16(34, true), 16); assert.equal(view.getUint32(40, true), 8);
    expected.forEach((value, i) => assert.ok(Math.abs(view.getInt16(44 + i * 2, true) / 32768 - value) < 0.0001));
  }
  await assert.rejects(encodeStemWav(original, vocal, 'vocals', () => true), /取消/);
});
