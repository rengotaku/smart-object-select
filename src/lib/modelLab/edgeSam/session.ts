import type { SamImageInput } from "@/lib/types";
import {
  EDGE_SAM_DECODER_URL,
  EDGE_SAM_ENCODER_URL,
  EDGE_SAM_INPUT_SIZE,
} from "./constants";
import type { EdgeSamRuntime, EdgeSamTensor } from "./onnxRuntime";
import {
  computeEncoderScale,
  resizeRgbaNearest,
  scalePointToEncoderSpace,
  toEncoderInputData,
} from "./preprocess";
import type { EdgeSamMaskResult } from "./types";

export class EdgeSamDisposedError extends Error {
  constructor(message = "This EdgeSAM session has been disposed") {
    super(message);
    this.name = "EdgeSamDisposedError";
  }
}

export class EdgeSamNoImageError extends Error {
  constructor(message = "No image has been set on this EdgeSAM session") {
    super(message);
    this.name = "EdgeSamNoImageError";
  }
}

export class EdgeSamStaleRequestError extends Error {
  constructor(message = "The EdgeSAM request is stale and its result was discarded") {
    super(message);
    this.name = "EdgeSamStaleRequestError";
  }
}

export interface EdgeSamSession {
  setImage(image: SamImageInput): Promise<void>;
  segmentAtPoint(x: number, y: number): Promise<EdgeSamMaskResult>;
  dispose(): void;
}

/**
 * デコーダの `masks` 出力（dims=[1, numMasks, maskHeight, maskWidth]。EdgeSAM は
 * `orig_im_size` を受け取らず、常にエンコーダ入力空間（1024四方）を等方縮小した
 * 固定解像度（onnxruntime-node での実測で 256x256）で返す。`tonyyang2000/EdgeSAM` の
 * `handler.py` 同様、呼び出し側が呼び出し先の表示スケールに合わせて引き伸ばす前提のため、
 * ここではアップサンプルしない）を二値マスクへ変換する。
 * ロジット > 0 を前景とする（sigmoid(0) = 0.5 と同義の閾値。MobileSAM と同じ規約）。
 *
 * `scores` は候補マスクごとの IoU 予測（dims=[1, numMasks]）。EdgeSAM のリファレンス実装
 * （`handler.py`）は常に先頭マスク（index 0）を採用するが、onnxruntime-node による
 * 実機検証で「先頭マスクが必ずしも最良ではない（既知の矩形をクリックした際、最高スコアの
 * 候補が最も正確に矩形をマスクしていた）」ことを確認したため、ここでは
 * スコア最大のマスクを選択する（issue #48 やってはいけないこと: MobileSAM/リファレンス実装の
 * 数値・挙動をそのまま信用せず個別に検証する、を踏まえた設計判断）。
 */
function maskTensorToResult(
  masks: EdgeSamTensor,
  scores: EdgeSamTensor
): EdgeSamMaskResult {
  const [, numMasks, maskHeight, maskWidth] = masks.dims;
  const maskPixelCount = maskHeight * maskWidth;

  let bestIndex = 0;
  let bestScore = scores.data[0] ?? 0;
  for (let i = 1; i < numMasks; i++) {
    const candidate = scores.data[i] ?? Number.NEGATIVE_INFINITY;
    if (candidate > bestScore) {
      bestScore = candidate;
      bestIndex = i;
    }
  }

  const offset = bestIndex * maskPixelCount;
  const data = new Uint8Array(maskPixelCount);
  for (let i = 0; i < maskPixelCount; i++) {
    data[i] = masks.data[offset + i] > 0 ? 1 : 0;
  }

  return { data, width: maskWidth, height: maskHeight, score: bestScore };
}

/**
 * EdgeSAM（画像エンコーダ + マスクデコーダ）のセッションを作る。
 *
 * `onnxruntime-web`（実 WASM 推論）への依存は `EdgeSamRuntime` 抽象の背後に
 * 閉じ込めてあり（onnxRuntime.ts）、このファイルは前処理・推論呼び出し・後処理の
 * 組み立てのみを担う。既存の `src/lib/sam/samSession.ts` とは完全に独立した実装
 * （issue #48 やってはいけないこと: 既存ファイルへの変更禁止）。
 *
 * 1つのセッション（Worker）に対し複数の `setImage` が競合して呼ばれうる
 * （例: 画像Aのエンコード中に画像Bへ切り替えてすぐクリックする）。`onmessage` は
 * 前のリクエストの完了を待たずに次のメッセージを処理する（`edgeSam.worker.ts`）ため、
 * 何もガードしないと画像Aの結果が画像Bより後に届いて共有状態 `embeddings` を
 * 上書きし、画像Bへのクリックが画像Aのマスクを返しうる。
 * MobileSAM実装（`../mobileSam/session.ts`）・`src/lib/sam/samSession.ts` の
 * generation ガード（ADR 0002）と同じパターンを、issue #48 の指示どおり最初から
 * 組み込む（後から指摘されて直すのではなく最初から入れる）。
 */
export async function createEdgeSamSession(
  runtime: EdgeSamRuntime
): Promise<EdgeSamSession> {
  const encoderSession = await runtime.createSession(EDGE_SAM_ENCODER_URL);
  const decoderSession = await runtime.createSession(EDGE_SAM_DECODER_URL);

  let disposed = false;
  let generation = 0;
  let embeddings: EdgeSamTensor | null = null;
  let encoderScale = { scaleX: 1, scaleY: 1 };
  // 保持している embeddings/encoderScale がどの世代の setImage によって作られたか。
  // generation（最新の setImage 呼び出し世代）とは別に持つことで、
  // 「setImage 実行中（=generation は進んでいるが embeddings はまだ古い画像のまま）」を
  // segmentAtPoint 側から検出できる（MobileSAM実装と同じ理由）。
  let embeddingsGeneration = 0;

  function ensureNotDisposed(): void {
    if (disposed) {
      throw new EdgeSamDisposedError();
    }
  }

  async function setImage(image: SamImageInput): Promise<void> {
    ensureNotDisposed();
    generation += 1;
    const requestGeneration = generation;

    const scale = computeEncoderScale(image.width, image.height);
    const resizedRgba = resizeRgbaNearest(
      image,
      EDGE_SAM_INPUT_SIZE,
      EDGE_SAM_INPUT_SIZE
    );
    const inputData = toEncoderInputData(
      resizedRgba,
      EDGE_SAM_INPUT_SIZE,
      EDGE_SAM_INPUT_SIZE
    );

    const output = await encoderSession.run({
      image: {
        data: inputData,
        dims: [1, 3, EDGE_SAM_INPUT_SIZE, EDGE_SAM_INPUT_SIZE],
      },
    });

    if (disposed) {
      throw new EdgeSamDisposedError();
    }
    if (requestGeneration !== generation) {
      // より新しい setImage が既に走っている。古い結果で状態を上書きしない。
      return;
    }

    const imageEmbeddings = output.image_embeddings;
    if (!imageEmbeddings) {
      throw new Error("EdgeSAM encoder did not return image_embeddings");
    }

    embeddings = imageEmbeddings;
    encoderScale = scale;
    embeddingsGeneration = requestGeneration;
  }

  async function segmentAtPoint(x: number, y: number): Promise<EdgeSamMaskResult> {
    ensureNotDisposed();
    if (!embeddings) {
      throw new EdgeSamNoImageError();
    }

    // 呼び出し時点で保持している embeddings の世代を固定する。以降このリクエストの
    // 結果は常にこの世代と現在の generation を突き合わせて判定する（generation
    // そのものではなく embeddings の世代を基準にすることで、setImage 実行中の
    // 呼び出しも検出できる）。
    const embeddingGeneration = embeddingsGeneration;
    if (embeddingGeneration !== generation) {
      // 新しい setImage が進行中（embeddings はまだ古い画像のまま）。推論を開始せず破棄する。
      throw new EdgeSamStaleRequestError();
    }

    const embeddingsSnapshot = embeddings;

    const point = scalePointToEncoderSpace(x, y, encoderScale);
    // EdgeSAM のデコーダは MobileSAM と異なりボックスプロンプト無しでもパディング点が
    // 不要（onnxruntime-node での実機検証で確認済み。`point_coords`/`point_labels` の
    // 軸は `num_points` として動的で、クリック点1つだけを渡しても正しくマスクできた）。
    const pointCoords = new Float32Array([point.x, point.y]);
    const pointLabels = new Float32Array([1]);

    const output = await decoderSession.run({
      image_embeddings: embeddingsSnapshot,
      point_coords: { data: pointCoords, dims: [1, 1, 2] },
      point_labels: { data: pointLabels, dims: [1, 1] },
    });

    if (disposed) {
      throw new EdgeSamDisposedError();
    }
    if (embeddingGeneration !== generation) {
      // decode 待機中に画像が差し替えられた。古い画像のマスクは返さない。
      throw new EdgeSamStaleRequestError();
    }

    const masks = output.masks;
    const scores = output.scores;
    if (!masks) {
      throw new Error("EdgeSAM decoder did not return masks");
    }
    if (!scores) {
      throw new Error("EdgeSAM decoder did not return scores");
    }

    return maskTensorToResult(masks, scores);
  }

  function dispose(): void {
    disposed = true;
    embeddings = null;
  }

  return { setImage, segmentAtPoint, dispose };
}
