# Third-party sources

## demucs-web 1.0.2

- Source: https://github.com/timcsy/demucs-web
- npm integrity: `sha512-G/HWbbBDvfGzaxDZQhqTp4+6i8nlCIRGEd6E1+EZJJONx5Es3bBc+jHqhfyblTlsKo/7cAdylA8HfetBpbQ98w==`
- License: MIT, preserved at `vendor/demucs/LICENSE`.
- Files under `vendor/demucs/` are unmodified upstream JavaScript.
- This extension uses `prepareModelInput` and `standaloneIspec`, with its own streaming scheduler, normalization and vocal-only model adapter.

## ONNX Runtime Web 1.22.0

- Source: https://github.com/microsoft/onnxruntime/tree/v1.22.0
- Distribution: https://registry.npmjs.org/onnxruntime-web/-/onnxruntime-web-1.22.0.tgz
- Download verified against the npm registry's SHA-512 integrity value.
- License: MIT, preserved at `vendor/ort/LICENSE`.
- Additional notices: `vendor/ort/ThirdPartyNotices.txt`.
- Bundled runtime: WebGPU JavaScript and JSEP WebAssembly loader / binary; no runtime CDN imports.

## Embedded HTDemucs model

- Export source: https://huggingface.co/timcsy/demucs-web-onnx
- Revision: `92e33df61cfc9eb820272aaa62d2ef6dcf4d950d`
- File: `htdemucs_embedded.onnx`, packaged as `models/htdemucs.onnx`.
- SHA-256: `e5e425c17683f163a472462eb5f5a4ffcd11c31858d57fbd0833b012d8b88077`
- Size: 180,534,758 bytes.
- Upstream model implementation: https://github.com/facebookresearch/demucs
- Upstream MIT license retained in `models/DEMUCS-LICENSE`. The export repository has no separate model card.

The original authors retain their copyrights. Provenance and bundled license texts are included with the distribution.
