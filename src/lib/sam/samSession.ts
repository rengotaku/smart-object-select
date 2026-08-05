import type { SamDevice } from "./device";
import type { SamImageInput, SamMaskResult } from "./types";

export interface SamImageInputs {
  originalSizes: unknown;
  reshapedInputSizes: unknown;
  [key: string]: unknown;
}

export interface SamModelLike {
  getImageEmbeddings(inputs: SamImageInputs): Promise<Record<string, unknown>>;
  decode(
    args: Record<string, unknown>
  ): Promise<{ predMasks: unknown; iouScores: number[][][] }>;
}

export interface MaskTensorLike {
  data: Uint8Array | Float32Array;
  dims: number[]; // [1, numMasks, height, width]
}

export interface SamProcessorLike {
  process(image: SamImageInput): Promise<SamImageInputs>;
  reshapeInputPoints(
    points: number[][][],
    imageSize: [number, number],
    inputs: SamImageInputs
  ): unknown;
  postProcessMasks(
    predMasks: unknown,
    originalSizes: unknown,
    reshapedInputSizes: unknown
  ): Promise<MaskTensorLike[]>;
}

export interface SamRuntime {
  loadModel(device: SamDevice): Promise<SamModelLike>;
  loadProcessor(): Promise<SamProcessorLike>;
}

export class SamStaleRequestError extends Error {
  constructor(message = "The SAM request is stale and its result was discarded") {
    super(message);
    this.name = "SamStaleRequestError";
  }
}

export class SamNoImageError extends Error {
  constructor(message = "No image has been set on this SAM session") {
    super(message);
    this.name = "SamNoImageError";
  }
}

export class SamDisposedError extends Error {
  constructor(message = "This SAM session has been disposed") {
    super(message);
    this.name = "SamDisposedError";
  }
}

export interface SamSession {
  setImage(image: SamImageInput): Promise<void>;
  segmentAtPoint(x: number, y: number): Promise<SamMaskResult>;
  dispose(): void;
}

/** iouScores の中から最もスコアが高いマスクの index を返す */
export function pickBestMaskIndex(iouScores: number[][][]): number {
  const scores = iouScores[0]?.[0] ?? [];

  let bestIndex = 0;
  let bestScore = -Infinity;
  scores.forEach((score, index) => {
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });

  return bestIndex;
}

/**
 * dims=[1, numMasks, height, width] のマスクテンソルから maskIndex 番目のマスクを切り出し、
 * 0 より大きい値を 1、それ以外を 0 とした Uint8Array に変換する。
 * score は含まないため、呼び出し側で上書きすること。
 */
export function binarizeMask(tensor: MaskTensorLike, maskIndex: number): SamMaskResult {
  const [, , height, width] = tensor.dims;
  const maskSize = height * width;
  const offset = maskIndex * maskSize;

  const data = new Uint8Array(maskSize);
  for (let i = 0; i < maskSize; i += 1) {
    data[i] = tensor.data[offset + i] > 0 ? 1 : 0;
  }

  return { data, width, height, score: 0 };
}

export async function createSamSession(
  runtime: SamRuntime,
  device: SamDevice
): Promise<SamSession> {
  const model = await runtime.loadModel(device);
  const processor = await runtime.loadProcessor();

  let generation = 0;
  let disposed = false;
  let currentImageInputs: SamImageInputs | null = null;
  let currentImageSize: [number, number] | null = null;
  let currentEmbeddings: Record<string, unknown> | null = null;

  function ensureNotDisposed(): void {
    if (disposed) {
      throw new SamDisposedError();
    }
  }

  async function setImage(image: SamImageInput): Promise<void> {
    ensureNotDisposed();
    generation += 1;
    const requestGeneration = generation;

    const inputs = await processor.process(image);
    const embeddings = await model.getImageEmbeddings(inputs);

    if (disposed) {
      throw new SamDisposedError();
    }
    if (requestGeneration !== generation) {
      // より新しい setImage が既に走っている。古い結果で状態を上書きしない。
      return;
    }

    currentImageInputs = inputs;
    currentImageSize = [image.height, image.width];
    currentEmbeddings = embeddings;
  }

  async function segmentAtPoint(x: number, y: number): Promise<SamMaskResult> {
    ensureNotDisposed();
    if (!currentImageInputs || !currentEmbeddings || !currentImageSize) {
      throw new SamNoImageError();
    }

    const requestGeneration = generation;
    const imageInputs = currentImageInputs;
    const embeddings = currentEmbeddings;
    const imageSize = currentImageSize;

    const inputPoints = processor.reshapeInputPoints([[[x, y]]], imageSize, imageInputs);
    const { predMasks, iouScores } = await model.decode({
      ...imageInputs,
      ...embeddings,
      input_points: inputPoints,
    });

    if (disposed) {
      throw new SamDisposedError();
    }
    if (requestGeneration !== generation) {
      // 待機中に画像が差し替えられた。古い画像のマスクは返さない。
      throw new SamStaleRequestError();
    }

    const maskTensors = await processor.postProcessMasks(
      predMasks,
      imageInputs.originalSizes,
      imageInputs.reshapedInputSizes
    );
    const maskIndex = pickBestMaskIndex(iouScores);
    const score = iouScores[0]?.[0]?.[maskIndex] ?? 0;

    return { ...binarizeMask(maskTensors[0], maskIndex), score };
  }

  function dispose(): void {
    disposed = true;
    currentImageInputs = null;
    currentEmbeddings = null;
    currentImageSize = null;
  }

  return { setImage, segmentAtPoint, dispose };
}
