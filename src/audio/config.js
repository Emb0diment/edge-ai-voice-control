// Matches timcsy/demucs-web's embedded HTDemucs ONNX model exactly.
export const SAMPLE_RATE = 44100;
export const SEGMENT = 343980;
export const STRIDE = 257985; // 25% overlap, ~5.85 s between inferences.
export const OVERLAP = SEGMENT - STRIDE;
export const BLOCK = 4096;
