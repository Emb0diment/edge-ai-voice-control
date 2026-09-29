import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const packages = [
  { name: 'demucs-web', version: '1.0.2',
    integrity: 'sha512-G/HWbbBDvfGzaxDZQhqTp4+6i8nlCIRGEd6E1+EZJJONx5Es3bBc+jHqhfyblTlsKo/7cAdylA8HfetBpbQ98w==',
    files: {
      'package/src/index.js': 'vendor/demucs/index.js',
      'package/src/constants.js': 'vendor/demucs/constants.js',
      'package/src/fft.js': 'vendor/demucs/fft.js',
      'package/src/processor.js': 'vendor/demucs/processor.js',
      'package/LICENSE': 'vendor/demucs/LICENSE',
    },
  },
  { name: 'onnxruntime-web', version: '1.22.0',
    integrity: 'sha512-Ud/+EBo6mhuaQWt/OjaOk0iNWjXqJoeeMFr6xQEERZdIZH2OWpGzuujz7lfuOBjUa6TEE/sc4nb7Da5dNL34fg==',
    files: {
      'package/dist/ort.webgpu.min.mjs': 'vendor/ort/ort.webgpu.min.mjs',
      'package/dist/ort-wasm-simd-threaded.jsep.mjs': 'vendor/ort/ort-wasm-simd-threaded.jsep.mjs',
      'package/dist/ort-wasm-simd-threaded.jsep.wasm': 'vendor/ort/ort-wasm-simd-threaded.jsep.wasm',
    },
  },
];
async function download(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(300000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  return response;
}
async function save(path, bytes) {
  const target = resolve(root, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, bytes);
}

for (const dependency of packages) {
  const url = `https://registry.npmjs.org/${dependency.name}/-/${dependency.name}-${dependency.version}.tgz`;
  const bytes = Buffer.from(await (await download(url)).arrayBuffer());
  const integrity = 'sha512-' + createHash('sha512').update(bytes).digest('base64');
  if (integrity !== dependency.integrity) throw new Error(`Integrity mismatch: ${dependency.name}`);
  const tar = gunzipSync(bytes);
  const found = new Set();
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    const name = header.subarray(0, 100).toString().split('\0')[0];
    if (!name) break;
    const prefix = header.subarray(345, 500).toString().split('\0')[0];
    const path = prefix ? `${prefix}/${name}` : name;
    const size = parseInt(header.subarray(124, 136).toString().replace(/\0/g, '').trim(), 8) || 0;
    const type = header[156];
    // Extract only explicitly named files into fixed destinations; never trust tar paths.
    if (dependency.files[path] && (type === 0 || type === 48)) {
      await save(dependency.files[path], tar.subarray(offset + 512, offset + 512 + size));
      found.add(path);
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  if (found.size !== Object.keys(dependency.files).length) throw new Error(`Missing files in ${dependency.name}`);
  console.log(`${dependency.name}@${dependency.version}: verified`);
}

for (const filename of ['LICENSE', 'ThirdPartyNotices.txt']) {
  const response = await download(`https://raw.githubusercontent.com/microsoft/onnxruntime/v1.22.0/${filename}`);
  await save(`vendor/ort/${filename}`, await response.text());
}

const provenance = JSON.parse(await readFile(resolve(root, 'models/provenance.json'), 'utf8'));
const modelURL = `${provenance.source}/resolve/${provenance.revision}/htdemucs_embedded.onnx`;
const response = await download(modelURL);
await mkdir(resolve(root, 'models'), { recursive: true });
const hash = createHash('sha256');
let size = 0;
const check = new Transform({ transform(chunk, encoding, callback) {
  size += chunk.length;
  hash.update(chunk);
  callback(null, chunk);
} });
await pipeline(Readable.fromWeb(response.body), check, createWriteStream(resolve(root, 'models/htdemucs.onnx')));
if (hash.digest('hex') !== provenance.sha256 || size !== provenance.bytes) {
  throw new Error('Model integrity mismatch; do not load this build.');
}
console.log(`Demucs model: SHA-256 verified (${size} bytes)`);
