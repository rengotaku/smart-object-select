import type { SamImageInput } from "@/lib/types";
import {
  FASTSAM_INPUT_NAME,
  FASTSAM_INPUT_SIZE,
  FASTSAM_MASK_PROTO_CHANNELS,
  FASTSAM_MASK_PROTO_SIZE,
  FASTSAM_MODEL_URL,
  FASTSAM_PREDICTION_LENGTH,
} from "./constants";
import type { FastSamRuntime, FastSamTensor } from "./onnxRuntime";
import {
  computeLetterboxTransform,
  letterboxResize,
  toModelInputData,
} from "./preprocess";
import { decodeFastSamOutputs } from "./postprocess";
import type { FastSamDetection } from "./types";

export class FastSamDisposedError extends Error {
  constructor(message = "This FastSAM session has been disposed") {
    super(message);
    this.name = "FastSamDisposedError";
  }
}

export interface FastSamSession {
  /** 画像全体を推論し、クラス非依存の全インスタンス（ボックス+マスク）を検出する。 */
  detect(image: SamImageInput): Promise<FastSamDetection[]>;
  dispose(): void;
}

/**
 * 出力テンソルを名前ではなく shape で識別する。
 *
 * `anakhiu/fastsam-onnx` の `fastsam_s.onnx` は実際には "vanilla" な
 * `output0`/`output1` 名を使う（onnxruntime-node での実測で確認済み）が、
 * YOLO11n-seg の配布元（`mobilint/YOLO11n-seg`）が独自の出力名を使っていた前例
 * （`../yolo11nSeg/session.ts` 参照）に倣い、名前に依存せず shape（検出テンソルは
 * `[_, 37, N]`、プロトタイプは `[_, 32, 256, 256]`）で判別する（配布元差異への
 * 防御的実装。将来 FastSAM の別エクスポートに切り替えても壊れにくくする）。
 */
function identifyOutputs(outputs: Record<string, FastSamTensor>): {
  detTensor: FastSamTensor;
  protoTensor: FastSamTensor;
} {
  let detTensor: FastSamTensor | undefined;
  let protoTensor: FastSamTensor | undefined;

  for (const tensor of Object.values(outputs)) {
    if (tensor.dims.length === 3 && tensor.dims[1] === FASTSAM_PREDICTION_LENGTH) {
      detTensor = tensor;
    } else if (
      tensor.dims.length === 4 &&
      tensor.dims[1] === FASTSAM_MASK_PROTO_CHANNELS &&
      tensor.dims[2] === FASTSAM_MASK_PROTO_SIZE
    ) {
      protoTensor = tensor;
    }
  }

  if (!detTensor || !protoTensor) {
    throw new Error(
      "FastSAM model did not return the expected output tensors " +
        `(detection [_, ${FASTSAM_PREDICTION_LENGTH}, N] and ` +
        `proto [_, ${FASTSAM_MASK_PROTO_CHANNELS}, ${FASTSAM_MASK_PROTO_SIZE}, ` +
        `${FASTSAM_MASK_PROTO_SIZE}]). Got dims: ` +
        Object.values(outputs)
          .map((t) => `[${t.dims.join(",")}]`)
          .join(", ")
    );
  }

  return { detTensor, protoTensor };
}

/**
 * FastSAM（全自動 seg-everything 検出）のセッションを作る。
 *
 * `onnxruntime-web`（実 WASM 推論）への依存は `FastSamRuntime` 抽象の背後に
 * 閉じ込めてあり（onnxRuntime.ts）、このファイルは前処理・推論呼び出し・後処理の
 * 組み立てのみを担う。既存の `src/lib/sam/samSession.ts` とは完全に独立した実装
 * （issue #50 やってはいけないこと: 既存ファイルへの変更・共有禁止）。
 *
 * MobileSAM/EdgeSAM（`setImage` → `segmentAtPoint` の2段階、embeddings を跨いで
 * 共有する）と異なり、FastSAM は `detect(image)` 1回の呼び出しで完結するステートレスな
 * 設計（YOLO11n-seg と同じパラダイム。issue #50 で確定）。画像ごとに独立した推論で、
 * セッションを跨ぐ共有可変状態を持たないため、MobileSAM/EdgeSAM のような世代ガード
 * （generation guard）はこの層には不要（複数 `detect()` 呼び出しの競合状態から UI state を
 * 守る責務は呼び出し側の `useFastSam` フックが担う。既存 `useYolo11nSeg` と同じ責務分担）。
 */
export async function createFastSamSession(
  runtime: FastSamRuntime
): Promise<FastSamSession> {
  const session = await runtime.createSession(FASTSAM_MODEL_URL);
  let disposed = false;

  function ensureNotDisposed(): void {
    if (disposed) {
      throw new FastSamDisposedError();
    }
  }

  async function detect(image: SamImageInput): Promise<FastSamDetection[]> {
    ensureNotDisposed();

    const transform = computeLetterboxTransform(
      image.width,
      image.height,
      FASTSAM_INPUT_SIZE
    );
    const letterboxed = letterboxResize(image, transform, FASTSAM_INPUT_SIZE);
    const inputData = toModelInputData(letterboxed, FASTSAM_INPUT_SIZE);

    const outputs = await session.run({
      [FASTSAM_INPUT_NAME]: {
        data: inputData,
        dims: [1, 3, FASTSAM_INPUT_SIZE, FASTSAM_INPUT_SIZE],
      },
    });

    if (disposed) {
      throw new FastSamDisposedError();
    }

    const { detTensor, protoTensor } = identifyOutputs(outputs);

    return decodeFastSamOutputs(
      detTensor.data,
      detTensor.dims,
      protoTensor.data,
      transform,
      image.width,
      image.height
    );
  }

  function dispose(): void {
    disposed = true;
  }

  return { detect, dispose };
}
