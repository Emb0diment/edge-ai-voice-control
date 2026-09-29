import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { captureErrorMessage } from '../src/audio/errors.js';

test('tab capture manifest does not isolate its offscreen consumer from the worker', async () => {
  const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
  assert.equal(manifest.cross_origin_embedder_policy, undefined);
  assert.equal(manifest.cross_origin_opener_policy, undefined);
  assert.ok(manifest.content_security_policy.extension_pages.includes("'wasm-unsafe-eval'"));
  const adapter = await readFile(new URL('../src/audio/separator.js', import.meta.url), 'utf8');
  assert.match(adapter, /ort\.env\.wasm\.numThreads\s*=\s*1/);
});
test('capture errors preserve the original diagnostic and provide a direct recovery path', () => {
  const message = captureErrorMessage(new DOMException('Error starting tab capture', 'AbortError'));
  assert.match(message, /AbortError: Error starting tab capture/);
  assert.match(message, /模型已保留/);
  assert.match(message, /edge:\/\/extensions/);
});
