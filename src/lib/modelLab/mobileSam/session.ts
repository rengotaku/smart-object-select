import type { SamImageInput } from "@/lib/sam";
import {
  MOBILE_SAM_DECODER_URL,
  MOBILE_SAM_ENCODER_URL,
  MOBILE_SAM_MASK_INPUT_SIZE,
} from "./constants";
import type { MobileSamRuntime, MobileSamTensor } from "./onnxRuntime";
import {
  computeResizedDimensions,
  resizeRgbaNearest,
  scalePointToEncoderSpace,
  toEncoderInputData,
} from "./preprocess";
import type { MobileSamMaskResult } from "./types";

export class MobileSamDisposedError extends Error {
  constructor(message = "This MobileSAM session has been disposed") {
    super(message);
    this.name = "MobileSamDisposedError";
  }
}

export class MobileSamNoImageError extends Error {
  constructor(message = "No image has been set on this MobileSAM session") {
    super(message);
    this.name = "MobileSamNoImageError";
  }
}

export interface MobileSamSession {
  setImage(image: SamImageInput): Promise<void>;
  segmentAtPoint(x: number, y: number): Promise<MobileSamMaskResult>;
  dispose(): void;
}

/**
 * デコーダの `masks` 出力（dims=[1, 1, height, width]。`orig_im_size` へ内部で
 * アップサンプル済み。onnxruntime-node での実測で確認済み）を二値マスクへ変換する。
 * ロジット > 0 を前景とする（sigmoid(0) = 0.5 と同義の閾値）。
 */
function maskTensorToResult(
  tensor: MobileSamTensor,
  iouScore: number
): MobileSamMaskResult {
  const [, , height, width] = tensor.dims;
  const pixelCount = height * width;
  const data = new Uint8Array(pixelCount);
  for (let i = 0; i < pixelCount; i++) {
    data[i] = tensor.data[i] > 0 ? 1 : 0;
  }
  return { data, width, height, score: iouScore };
}

/**
 * MobileSAM（画像エンコーダ + マスクデコーダ）のセッションを作る。
 *
 * `onnxruntime-web`（実 WASM 推論）への依存は `MobileSamRuntime` 抽象の背後に
 * 閉じ込めてあり（onnxRuntime.ts）、このファイルは前処理・推論呼び出し・後処理の
 * 組み立てのみを担う。既存の `src/lib/sam/samSession.ts` とは完全に独立した実装
 * （issue #47 やってはいけないこと: 既存ファイルへの変更禁止）。
 */
export async function createMobileSamSession(
  runtime: MobileSamRuntime
): Promise<MobileSamSession> {
  const encoderSession = await runtime.createSession(MOBILE_SAM_ENCODER_URL);
  const decoderSession = await runtime.createSession(MOBILE_SAM_DECODER_URL);

  let disposed = false;
  let embeddings: MobileSamTensor | null = null;
  let currentImageSize: { width: number; height: number } | null = null;
  let encoderScale = 1;

  function ensureNotDisposed(): void {
    if (disposed) {
      throw new MobileSamDisposedError();
    }
  }

  async function setImage(image: SamImageInput): Promise<void> {
    ensureNotDisposed();

    const {
      width: resizedWidth,
      height: resizedHeight,
      scale,
    } = computeResizedDimensions(image.width, image.height);
    const resizedRgba = resizeRgbaNearest(image, resizedWidth, resizedHeight);
    const inputData = toEncoderInputData(resizedRgba, resizedWidth, resizedHeight);

    const output = await encoderSession.run({
      input_image: { data: inputData, dims: [resizedHeight, resizedWidth, 3] },
    });

    ensureNotDisposed();

    const imageEmbeddings = output.image_embeddings;
    if (!imageEmbeddings) {
      throw new Error("MobileSAM encoder did not return image_embeddings");
    }

    embeddings = imageEmbeddings;
    currentImageSize = { width: image.width, height: image.height };
    encoderScale = scale;
  }

  async function segmentAtPoint(x: number, y: number): Promise<MobileSamMaskResult> {
    ensureNotDisposed();
    if (!embeddings || !currentImageSize) {
      throw new MobileSamNoImageError();
    }

    const point = scalePointToEncoderSpace(x, y, encoderScale);
    // SAM の ONNX デコーダはボックスプロンプト無しの場合、末尾に (0,0)/label=-1 の
    // パディング点が必須（onnxruntime-node での実測で確認済み。省略すると意図しない
    // 出力になる）。本 sub-issue は単発クリックのみが対象なのでクリック点1つ+パディングのみ。
    const pointCoords = new Float32Array([point.x, point.y, 0, 0]);
    const pointLabels = new Float32Array([1, -1]);
    const maskInput = new Float32Array(
      MOBILE_SAM_MASK_INPUT_SIZE * MOBILE_SAM_MASK_INPUT_SIZE
    );

    const output = await decoderSession.run({
      image_embeddings: embeddings,
      point_coords: { data: pointCoords, dims: [1, 2, 2] },
      point_labels: { data: pointLabels, dims: [1, 2] },
      mask_input: {
        data: maskInput,
        dims: [1, 1, MOBILE_SAM_MASK_INPUT_SIZE, MOBILE_SAM_MASK_INPUT_SIZE],
      },
      has_mask_input: { data: new Float32Array([0]), dims: [1] },
      orig_im_size: {
        data: new Float32Array([currentImageSize.height, currentImageSize.width]),
        dims: [2],
      },
    });

    ensureNotDisposed();

    const masks = output.masks;
    if (!masks) {
      throw new Error("MobileSAM decoder did not return masks");
    }
    const iouScore = output.iou_predictions?.data[0] ?? 0;

    return maskTensorToResult(masks, iouScore);
  }

  function dispose(): void {
    disposed = true;
    embeddings = null;
    currentImageSize = null;
  }

  return { setImage, segmentAtPoint, dispose };
}
