import type { SamImageInput } from "@/lib/sam";
import {
  YOLO11N_SEG_INPUT_NAME,
  YOLO11N_SEG_INPUT_SIZE,
  YOLO11N_SEG_MASK_PROTO_CHANNELS,
  YOLO11N_SEG_MASK_PROTO_SIZE,
  YOLO11N_SEG_MODEL_URL,
  YOLO11N_SEG_PREDICTION_LENGTH,
} from "./constants";
import type { Yolo11nSegRuntime, Yolo11nSegTensor } from "./onnxRuntime";
import {
  computeLetterboxTransform,
  letterboxResize,
  toModelInputData,
} from "./preprocess";
import { decodeYoloOutputs } from "./postprocess";
import type { Yolo11nSegDetection } from "./types";

export class Yolo11nSegDisposedError extends Error {
  constructor(message = "This YOLO11n-seg session has been disposed") {
    super(message);
    this.name = "Yolo11nSegDisposedError";
  }
}

export interface Yolo11nSegSession {
  /** 画像全体を推論し、COCO80クラスの全インスタンス（ボックス+マスク）を検出する。 */
  detect(image: SamImageInput): Promise<Yolo11nSegDetection[]>;
  dispose(): void;
}

/**
 * 出力テンソルを名前ではなく shape で識別する。
 *
 * `output0`/`output1`（"vanilla" な Ultralytics 命名）を使う配布元がある一方、
 * このモデルの実際の配布元 `mobilint/YOLO11n-seg` は `output`/`onnx::Shape_520` という
 * 独自の出力名を使う（onnxruntime-node での実測で確認済み。NOTICE 参照）。名前に依存すると
 * 配布元差異で壊れるため、shape（検出テンソルは `[_, 116, N]`、プロトタイプは
 * `[_, 32, 160, 160]`）で判別する。
 */
function identifyOutputs(outputs: Record<string, Yolo11nSegTensor>): {
  detTensor: Yolo11nSegTensor;
  protoTensor: Yolo11nSegTensor;
} {
  let detTensor: Yolo11nSegTensor | undefined;
  let protoTensor: Yolo11nSegTensor | undefined;

  for (const tensor of Object.values(outputs)) {
    if (tensor.dims.length === 3 && tensor.dims[1] === YOLO11N_SEG_PREDICTION_LENGTH) {
      detTensor = tensor;
    } else if (
      tensor.dims.length === 4 &&
      tensor.dims[1] === YOLO11N_SEG_MASK_PROTO_CHANNELS &&
      tensor.dims[2] === YOLO11N_SEG_MASK_PROTO_SIZE
    ) {
      protoTensor = tensor;
    }
  }

  if (!detTensor || !protoTensor) {
    throw new Error(
      "YOLO11n-seg model did not return the expected output tensors " +
        `(detection [_, ${YOLO11N_SEG_PREDICTION_LENGTH}, N] and ` +
        `proto [_, ${YOLO11N_SEG_MASK_PROTO_CHANNELS}, ${YOLO11N_SEG_MASK_PROTO_SIZE}, ` +
        `${YOLO11N_SEG_MASK_PROTO_SIZE}]). Got dims: ` +
        Object.values(outputs)
          .map((t) => `[${t.dims.join(",")}]`)
          .join(", ")
    );
  }

  return { detTensor, protoTensor };
}

/**
 * YOLO11n-seg（全自動COCO80クラス検出）のセッションを作る。
 *
 * `onnxruntime-web`（実 WASM 推論）への依存は `Yolo11nSegRuntime` 抽象の背後に
 * 閉じ込めてあり（onnxRuntime.ts）、このファイルは前処理・推論呼び出し・後処理の
 * 組み立てのみを担う。既存の `src/lib/sam/samSession.ts` とは完全に独立した実装
 * （issue #49 やってはいけないこと: 既存ファイルへの変更禁止）。
 *
 * MobileSAM/EdgeSAM（`setImage` → `segmentAtPoint` の2段階、embeddings を跨いで
 * 共有する）と異なり、YOLO11n-seg は `detect(image)` 1回の呼び出しで完結する
 * ステートレスな設計（画像ごとに独立した推論で、セッションを跨ぐ共有可変状態を持たない）。
 * そのため MobileSAM/EdgeSAM のような世代ガード（generation guard）はこの層には不要
 * （複数 `detect()` 呼び出しの競合状態から UI state を守る責務は呼び出し側の
 * `useYolo11nSeg` フックが担う。既存 `useMobileSam`/`useEdgeSam` と同じ責務分担）。
 */
export async function createYolo11nSegSession(
  runtime: Yolo11nSegRuntime
): Promise<Yolo11nSegSession> {
  const session = await runtime.createSession(YOLO11N_SEG_MODEL_URL);
  let disposed = false;

  function ensureNotDisposed(): void {
    if (disposed) {
      throw new Yolo11nSegDisposedError();
    }
  }

  async function detect(image: SamImageInput): Promise<Yolo11nSegDetection[]> {
    ensureNotDisposed();

    const transform = computeLetterboxTransform(
      image.width,
      image.height,
      YOLO11N_SEG_INPUT_SIZE
    );
    const letterboxed = letterboxResize(image, transform, YOLO11N_SEG_INPUT_SIZE);
    const inputData = toModelInputData(letterboxed, YOLO11N_SEG_INPUT_SIZE);

    const outputs = await session.run({
      [YOLO11N_SEG_INPUT_NAME]: {
        data: inputData,
        dims: [1, 3, YOLO11N_SEG_INPUT_SIZE, YOLO11N_SEG_INPUT_SIZE],
      },
    });

    if (disposed) {
      throw new Yolo11nSegDisposedError();
    }

    const { detTensor, protoTensor } = identifyOutputs(outputs);

    return decodeYoloOutputs(
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
