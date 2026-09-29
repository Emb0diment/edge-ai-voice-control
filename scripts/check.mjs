import { readFile, readdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import assert from 'node:assert/strict';

const root = new URL('../', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('manifest.json', root)));
assert.equal(manifest.manifest_version, 3);
assert.ok(!manifest.cross_origin_embedder_policy && !manifest.cross_origin_opener_policy,
  'Tab capture offscreen consumer must not enable cross-origin isolation');
assert.ok(!manifest.host_permissions, 'No website-wide host permissions needed');
for (const path of [manifest.action.default_popup, manifest.background.service_worker,
  'offscreen.html', 'preplay.html', 'preplay.css', 'vendor/ort/ort.webgpu.min.mjs', 'vendor/ort/ort-wasm-simd-threaded.jsep.mjs',
  'vendor/ort/ort-wasm-simd-threaded.jsep.wasm', 'vendor/demucs/processor.js', 'models/htdemucs.onnx']) {
  assert.ok((await stat(new URL(path, root))).size > 0, path);
}
async function checkImports(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir);
    if (entry.isDirectory()) await checkImports(url);
    else if (/\.(mjs|js)$/.test(entry.name)) {
      const source = await readFile(url, 'utf8');
      for (const match of source.matchAll(/(?:from\s*|import\s*)['"](\.[^'"]+)['"]/g)) {
        await stat(new URL(match[1], url));
      }
    }
  }
}
await checkImports(new URL('src/', root));
const provenance = JSON.parse(await readFile(new URL('models/provenance.json', root)));
const hash = createHash('sha256');
for await (const chunk of createReadStream(new URL('models/htdemucs.onnx', root))) hash.update(chunk);
assert.equal(hash.digest('hex'), provenance.sha256);
console.log('Manifest, assets, module imports and model SHA-256: PASS');
