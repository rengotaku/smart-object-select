import { COCO_CLASSES, COCO_CLASS_COUNT } from "./labels";
import {
  YOLO11N_SEG_CONFIDENCE_THRESHOLD,
  YOLO11N_SEG_INPUT_SIZE,
  YOLO11N_SEG_IOU_THRESHOLD,
  YOLO11N_SEG_MASK_PROTO_CHANNELS,
  YOLO11N_SEG_MASK_PROTO_SIZE,
  YOLO11N_SEG_MASK_THRESHOLD,
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
}

/**
 * YOLO11n-seg の `output0`（`[1, predLen, numCandidates]`。predLen = 4(box) + numClasses + maskProtoChannels）
 * を候補ごとにデコードする。行優先ではなくチャンネル優先（`c * numCandidates + i`）でフラット化されている
 * 点に注意（onnxruntime の Tensor はこのメモリレイアウトで返す。onnxruntime-node での実測で確認済み）。
 *
 * box は中心座標形式（cx, cy, w, h）で格納されているため、左上原点の xywh へ変換して返す
 * （Ultralytics の `non_max_suppression` 前の生出力フォーマット、`ultralytics/utils/ops.py` 参照）。
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

  return detections;
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
 * 1インスタンス分のマスクをデコードし、元画像サイズの二値マスクへ変換する。
 *
 * マスクプロトタイプ（`[maskProtoChannels, maskProtoSize, maskProtoSize]`）と
 * マスク係数（長さ maskProtoChannels）の内積 → sigmoid → 閾値二値化、という
 * Ultralytics の `process_mask` と同じ手順を、バウンディングボックス内の元画像ピクセルに
 * 対してのみ計算する（ボックス外は常に0。Ultralytics もマスクをボックスでクロップするため
 * 同じ結果になり、かつ全画面走査より大幅に高速）。
 */
export function decodeInstanceMask(
  protoData: Float32Array,
  maskCoeffs: Float32Array,
  box640: BoxXywh,
  transform: LetterboxTransform,
  originalWidth: number,
  originalHeight: number,
  options: DecodeInstanceMaskOptions = {}
): { data: Uint8Array; width: number; height: number } {
  const maskProtoSize = options.maskProtoSize ?? YOLO11N_SEG_MASK_PROTO_SIZE;
  const inputSize = options.inputSize ?? YOLO11N_SEG_INPUT_SIZE;
  const maskThreshold = options.maskThreshold ?? YOLO11N_SEG_MASK_THRESHOLD;
  const maskProtoChannels = maskCoeffs.length;
  const protoScale = maskProtoSize / inputSize;
  const protoPixelCount = maskProtoSize * maskProtoSize;

  const data = new Uint8Array(originalWidth * originalHeight);

  const boxOrig = mapBoxToOriginal(box640, transform, originalWidth, originalHeight);
  const x0 = Math.max(0, Math.floor(boxOrig.x));
  const y0 = Math.max(0, Math.floor(boxOrig.y));
  const x1 = Math.min(originalWidth, Math.ceil(boxOrig.x + boxOrig.width));
  const y1 = Math.min(originalHeight, Math.ceil(boxOrig.y + boxOrig.height));

  for (let oy = y0; oy < y1; oy++) {
    const iy = oy * transform.scale + transform.padY;
    const py = Math.min(maskProtoSize - 1, Math.max(0, Math.floor(iy * protoScale)));

    for (let ox = x0; ox < x1; ox++) {
      const ix = ox * transform.scale + transform.padX;
      const px = Math.min(maskProtoSize - 1, Math.max(0, Math.floor(ix * protoScale)));

      const pixelIndex = py * maskProtoSize + px;
      let logit = 0;
      for (let c = 0; c < maskProtoChannels; c++) {
        logit += protoData[c * protoPixelCount + pixelIndex] * maskCoeffs[c];
      }
      const probability = 1 / (1 + Math.exp(-logit));
      if (probability > maskThreshold) {
        data[oy * originalWidth + ox] = 1;
      }
    }
  }

  return { data, width: originalWidth, height: originalHeight };
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
