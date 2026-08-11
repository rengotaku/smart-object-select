import { COCO_CLASSES, COCO_CLASS_COUNT } from "./labels";
import {
  YOLO11N_SEG_CONFIDENCE_THRESHOLD,
  YOLO11N_SEG_INPUT_SIZE,
  YOLO11N_SEG_IOU_THRESHOLD,
  YOLO11N_SEG_MASK_PROTO_CHANNELS,
  YOLO11N_SEG_MASK_PROTO_SIZE,
  YOLO11N_SEG_MASK_THRESHOLD,
  YOLO11N_SEG_MAX_NMS_CANDIDATES,
} from "./constants";
import { mapBoxToOriginal, type BoxXywh, type LetterboxTransform } from "./preprocess";
import type { Yolo11nSegDetection } from "./types";

/** NMS 前の生の検出候補（モデル入力=640空間での座標）。 */
export interface RawDetection {
  /** モデル入力（640）空間での左上 x, y, 幅, 高さ */
  box: BoxXywh;
  classId: number;
  score: number;
  /** マスクプロトタイプとの線形結合係数（長さ = maskProtoChannels） */
  maskCoeffs: Float32Array;
}

export interface DecodeDetectionsOptions {
  numClasses?: number;
  maskProtoChannels?: number;
  confidenceThreshold?: number;
  /**
   * 信頼度閾値通過後、NMS に渡す前に採用する候補数の上限（スコア降順で上位のみ残す）。
   * 省略時は `YOLO11N_SEG_MAX_NMS_CANDIDATES`。**これは最終検出数の上限ではない**
   * （`nms()` はクラス単位で重複を除去するのみで、最終検出数の上限は現状無い）。
   * ここでの上限は純粋に NMS 自体（O(n^2) の素朴な貪欲法）のコストを抑えるためのもの
   * （issue #56、FastSAM の `FASTSAM_MAX_NMS_CANDIDATES` と同じ設計方針。
   * `../fastSam/postprocess.ts` の `DecodeDetectionsOptions.maxCandidates` 参照）。
   */
  maxCandidates?: number;
}

/**
 * YOLO11n-seg の `output0`（`[1, predLen, numCandidates]`。predLen = 4(box) + numClasses + maskProtoChannels）
 * を候補ごとにデコードする。行優先ではなくチャンネル優先（`c * numCandidates + i`）でフラット化されている
 * 点に注意（onnxruntime の Tensor はこのメモリレイアウトで返す。onnxruntime-node での実測で確認済み）。
 *
 * box は中心座標形式（cx, cy, w, h）で格納されているため、左上原点の xywh へ変換して返す
 * （Ultralytics の `non_max_suppression` 前の生出力フォーマット、`ultralytics/utils/ops.py` 参照）。
 *
 * 信頼度閾値通過後の候補が `maxCandidates`（既定 `YOLO11N_SEG_MAX_NMS_CANDIDATES`）を超える場合、
 * スコア降順で上位のみに打ち切る。これは NMS 自体（O(n^2) の素朴な貪欲法）のコストを
 * 抑えるためだけの上限であり、最終検出数の上限ではない（issue #56、FastSAM の
 * `decodeDetections`（`../fastSam/postprocess.ts`）と同じ設計方針。ただし YOLO11n-seg は
 * class-aware NMS のため、この上限を超えないケースでも実質的な NMS コストは FastSAM の
 * class-agnostic NMS より小さい）。
 */
export function decodeDetections(
  output: Float32Array,
  dims: readonly number[],
  options: DecodeDetectionsOptions = {}
): RawDetection[] {
  const numClasses = options.numClasses ?? COCO_CLASS_COUNT;
  const maskProtoChannels = options.maskProtoChannels ?? YOLO11N_SEG_MASK_PROTO_CHANNELS;
  const confidenceThreshold =
    options.confidenceThreshold ?? YOLO11N_SEG_CONFIDENCE_THRESHOLD;
  const maxCandidates = options.maxCandidates ?? YOLO11N_SEG_MAX_NMS_CANDIDATES;

  const [, predLen, numCandidates] = dims;
  const expectedPredLen = 4 + numClasses + maskProtoChannels;
  if (predLen !== expectedPredLen) {
    throw new Error(
      `Unexpected YOLO11n-seg output0 shape: predLen=${predLen}, expected ${expectedPredLen} ` +
        `(4 box + ${numClasses} classes + ${maskProtoChannels} mask coeffs)`
    );
  }

  const detections: RawDetection[] = [];

  for (let i = 0; i < numCandidates; i++) {
    let bestClassId = -1;
    let bestScore = 0;
    for (let c = 0; c < numClasses; c++) {
      const score = output[(4 + c) * numCandidates + i];
      if (score > bestScore) {
        bestScore = score;
        bestClassId = c;
      }
    }
    if (bestScore < confidenceThreshold) {
      continue;
    }

    const cx = output[0 * numCandidates + i];
    const cy = output[1 * numCandidates + i];
    const w = output[2 * numCandidates + i];
    const h = output[3 * numCandidates + i];

    const maskCoeffs = new Float32Array(maskProtoChannels);
    for (let m = 0; m < maskProtoChannels; m++) {
      maskCoeffs[m] = output[(4 + numClasses + m) * numCandidates + i];
    }

    detections.push({
      box: { x: cx - w / 2, y: cy - h / 2, width: w, height: h },
      classId: bestClassId,
      score: bestScore,
      maskCoeffs,
    });
  }

  if (detections.length <= maxCandidates) {
    return detections;
  }

  // NMS 自体の O(n^2) コストを上限化するため、スコア降順で上位 maxCandidates 件のみ
  // NMS に渡す（最終検出数の上限ではない点に注意。上記コメント参照）。
  return detections.sort((a, b) => b.score - a.score).slice(0, maxCandidates);
}

/** 2つの xywh ボックスの IoU（重なり無しは 0）。 */
export function computeIoU(a: BoxXywh, b: BoxXywh): number {
  const ax1 = a.x;
  const ay1 = a.y;
  const ax2 = a.x + a.width;
  const ay2 = a.y + a.height;
  const bx1 = b.x;
  const by1 = b.y;
  const bx2 = b.x + b.width;
  const by2 = b.y + b.height;

  const interX1 = Math.max(ax1, bx1);
  const interY1 = Math.max(ay1, by1);
  const interX2 = Math.min(ax2, bx2);
  const interY2 = Math.min(ay2, by2);

  const interWidth = Math.max(0, interX2 - interX1);
  const interHeight = Math.max(0, interY2 - interY1);
  const interArea = interWidth * interHeight;

  const areaA = Math.max(0, a.width) * Math.max(0, a.height);
  const areaB = Math.max(0, b.width) * Math.max(0, b.height);
  const unionArea = areaA + areaB - interArea;

  if (unionArea <= 0) {
    return 0;
  }
  return interArea / unionArea;
}

/**
 * クラス単位（class-aware）の貪欲 NMS。スコア降順に走査し、既に採用した同クラスの
 * ボックスと IoU が閾値を超える候補を抑制する（Ultralytics 既定の `agnostic=False` と同じ挙動）。
 */
export function nms(
  detections: readonly RawDetection[],
  iouThreshold: number = YOLO11N_SEG_IOU_THRESHOLD
): RawDetection[] {
  const sorted = [...detections].sort((a, b) => b.score - a.score);
  const kept: RawDetection[] = [];

  for (const candidate of sorted) {
    const suppressed = kept.some(
      (k) =>
        k.classId === candidate.classId && computeIoU(k.box, candidate.box) > iouThreshold
    );
    if (!suppressed) {
      kept.push(candidate);
    }
  }

  return kept;
}

export interface DecodeInstanceMaskOptions {
  maskProtoSize?: number;
  inputSize?: number;
  maskThreshold?: number;
}

/**
 * 1インスタンス分のマスクをデコードし、バウンディングボックス範囲のみの二値マスクへ変換する。
 *
 * マスクプロトタイプ（`[maskProtoChannels, maskProtoSize, maskProtoSize]`。既定 160x160）と
 * マスク係数（長さ maskProtoChannels）の内積 → sigmoid → 閾値二値化、という
 * Ultralytics の `process_mask` と同じ手順を **プロトタイプ空間（160x160）でのみ**行い、
 * その結果を元画像のボックス座標系へ最近傍アップサンプリングする（issue #49 codex レビュー
 * 指摘: 元画像のボックス内ピクセルごとに内積計算をすると、12MP画像を覆う検出1件だけで
 * `ボックス内ピクセル数 × maskProtoChannels` ≈ 数億回の積和になり Worker が長時間ブロックする。
 * プロトタイプ空間はどれだけ元画像が高解像度でも最大 `maskProtoSize^2 × maskProtoChannels`
 * ≈ 82万回の積和で済み、アップサンプリング側は最近傍のルックアップのみ（チャンネルループなし）
 * のため軽い）。
 */
export function decodeInstanceMask(
  protoData: Float32Array,
  maskCoeffs: Float32Array,
  box640: BoxXywh,
  transform: LetterboxTransform,
  originalWidth: number,
  originalHeight: number,
  options: DecodeInstanceMaskOptions = {}
): { data: Uint8Array; width: number; height: number; x: number; y: number } {
  const maskProtoSize = options.maskProtoSize ?? YOLO11N_SEG_MASK_PROTO_SIZE;
  const inputSize = options.inputSize ?? YOLO11N_SEG_INPUT_SIZE;
  const maskThreshold = options.maskThreshold ?? YOLO11N_SEG_MASK_THRESHOLD;
  const maskProtoChannels = maskCoeffs.length;
  const protoScale = maskProtoSize / inputSize;
  const protoPixelCount = maskProtoSize * maskProtoSize;

  const boxOrig = mapBoxToOriginal(box640, transform, originalWidth, originalHeight);
  const x0 = Math.max(0, Math.floor(boxOrig.x));
  const y0 = Math.max(0, Math.floor(boxOrig.y));
  const x1 = Math.min(originalWidth, Math.ceil(boxOrig.x + boxOrig.width));
  const y1 = Math.min(originalHeight, Math.ceil(boxOrig.y + boxOrig.height));

  const width = Math.max(0, x1 - x0);
  const height = Math.max(0, y1 - y0);
  const data = new Uint8Array(width * height);

  if (width === 0 || height === 0) {
    return { data, width, height, x: x0, y: y0 };
  }

  const toProtoIndex = (originalCoord: number, scaleOffset: number): number => {
    const modelSpace = originalCoord * transform.scale + scaleOffset;
    return Math.min(maskProtoSize - 1, Math.max(0, Math.floor(modelSpace * protoScale)));
  };

  // 1. プロトタイプ空間でボックスが覆う範囲を求める（transform は等方スケール+パディングの
  //    アフィン変換で scale > 0 のため、oy/ox に対し単調増加。両端の座標だけで範囲が確定する）。
  const protoY0 = toProtoIndex(y0, transform.padY);
  const protoY1 = toProtoIndex(y1 - 1, transform.padY);
  const protoX0 = toProtoIndex(x0, transform.padX);
  const protoX1 = toProtoIndex(x1 - 1, transform.padX);
  const protoCropWidth = protoX1 - protoX0 + 1;
  const protoCropHeight = protoY1 - protoY0 + 1;

  // 2. プロトタイプ空間の範囲内だけ内積→sigmoid→二値化する（重い計算はここだけに閉じ込める）。
  const protoMask = new Uint8Array(protoCropWidth * protoCropHeight);
  for (let py = protoY0; py <= protoY1; py++) {
    const localPy = py - protoY0;
    for (let px = protoX0; px <= protoX1; px++) {
      const pixelIndex = py * maskProtoSize + px;
      let logit = 0;
      for (let c = 0; c < maskProtoChannels; c++) {
        logit += protoData[c * protoPixelCount + pixelIndex] * maskCoeffs[c];
      }
      const probability = 1 / (1 + Math.exp(-logit));
      protoMask[localPy * protoCropWidth + (px - protoX0)] =
        probability > maskThreshold ? 1 : 0;
    }
  }

  // 3. 元画像のボックス範囲へ最近傍アップサンプリング（チャンネルループを含まないため軽い）。
  for (let oy = y0; oy < y1; oy++) {
    const py = toProtoIndex(oy, transform.padY);
    const localPy = py - protoY0;
    const localY = oy - y0;

    for (let ox = x0; ox < x1; ox++) {
      const px = toProtoIndex(ox, transform.padX);
      const localPx = px - protoX0;
      data[localY * width + (ox - x0)] = protoMask[localPy * protoCropWidth + localPx];
    }
  }

  return { data, width, height, x: x0, y: y0 };
}

export interface DecodeYoloOutputsOptions
  extends DecodeDetectionsOptions, DecodeInstanceMaskOptions {
  iouThreshold?: number;
}

/**
 * `output0`（検出候補）と `output1`（マスクプロトタイプ）から、NMS 適用済みの
 * インスタンス一覧（元画像座標系のボックス・マスク付き）を組み立てる。
 */
export function decodeYoloOutputs(
  detOutput: Float32Array,
  detDims: readonly number[],
  protoOutput: Float32Array,
  transform: LetterboxTransform,
  originalWidth: number,
  originalHeight: number,
  options: DecodeYoloOutputsOptions = {}
): Yolo11nSegDetection[] {
  const raw = decodeDetections(detOutput, detDims, options);
  const kept = nms(raw, options.iouThreshold ?? YOLO11N_SEG_IOU_THRESHOLD);

  return kept.map((detection) => {
    const boxOrig = mapBoxToOriginal(
      detection.box,
      transform,
      originalWidth,
      originalHeight
    );
    const mask = decodeInstanceMask(
      protoOutput,
      detection.maskCoeffs,
      detection.box,
      transform,
      originalWidth,
      originalHeight,
      options
    );

    return {
      classId: detection.classId,
      label: COCO_CLASSES[detection.classId] ?? `class_${detection.classId}`,
      score: detection.score,
      box: boxOrig,
      mask,
    };
  });
}
