import {
  FASTSAM_CONFIDENCE_THRESHOLD,
  FASTSAM_INPUT_SIZE,
  FASTSAM_IOU_THRESHOLD,
  FASTSAM_MASK_PROTO_CHANNELS,
  FASTSAM_MASK_PROTO_SIZE,
  FASTSAM_MASK_THRESHOLD,
  FASTSAM_MAX_DETECTIONS,
} from "./constants";
import { mapBoxToOriginal, type BoxXywh, type LetterboxTransform } from "./preprocess";
import type { FastSamDetection } from "./types";

/** NMS 前の生の検出候補（モデル入力=1024空間での座標）。 */
export interface RawDetection {
  /** モデル入力（1024）空間での左上 x, y, 幅, 高さ */
  box: BoxXywh;
  /** objectness スコア（クラス分類ではない。FastSAM はクラス非依存。issue #50） */
  score: number;
  /** マスクプロトタイプとの線形結合係数（長さ = maskProtoChannels） */
  maskCoeffs: Float32Array;
}

export interface DecodeDetectionsOptions {
  maskProtoChannels?: number;
  confidenceThreshold?: number;
  /**
   * 信頼度閾値通過後、NMS に渡す前に採用する候補数の上限（スコア降順で上位のみ残す）。
   * 省略時は `FASTSAM_MAX_DETECTIONS`。詳細は `constants.ts` のコメント参照
   * （issue #50 codex レビュー指摘: NMS の O(n^2) コストとマスク復号コストの両方を
   * 候補数で上限化する）。
   */
  maxDetections?: number;
}

/**
 * FastSAM の `output0`（`[1, predLen, numCandidates]`。predLen = 4(box) + 1(objectness) +
 * maskProtoChannels）を候補ごとにデコードする。行優先ではなくチャンネル優先
 * （`c * numCandidates + i`）でフラット化されている点に注意（onnxruntime の Tensor は
 * このメモリレイアウトで返す。onnxruntime-node での実測で確認済み）。
 *
 * YOLO11n-seg の `decodeDetections`（`../yolo11nSeg/postprocess.ts`）とはクラス数の扱いが
 * 異なる: YOLO11n-seg は80クラスから最良クラスを選ぶループが必要だが、FastSAM はクラス
 * ヘッドを持たず単一の objectness スコア（インデックス4）のみを読む（issue #50 やっては
 * いけないこと: YOLO11n-seg コードの未検証流用禁止。ここでは独立に実装・検証している）。
 *
 * box は中心座標形式（cx, cy, w, h）で格納されているため、左上原点の xywh へ変換して返す
 * （Ultralytics の `non_max_suppression` 前の生出力フォーマット）。objectness スコアは
 * onnxruntime-node での実測により既に sigmoid 適用済み（0-1 に収まる）ことを確認済みのため、
 * ここで追加の sigmoid は適用しない（`public/models/fast-sam/NOTICE` 参照）。
 *
 * 信頼度閾値通過後の候補が `maxDetections`（既定 `FASTSAM_MAX_DETECTIONS`）を超える場合、
 * スコア降順で上位のみに打ち切る。FastSAM は class-agnostic な "segment everything" モデルで
 * IoU 閾値も 0.9 と高い（＝ほぼ抑制されない）ため、複雑な画像では信頼度閾値通過後の候補が
 * 数千件規模になりうる。ここで打ち切らないと、後段の `nms()`（O(n^2) の素朴な貪欲法）と
 * `decodeInstanceMask()`（各候補ごとに 256x256x32 の内積＋アップサンプリング）の両方の
 * コストが線形以上に膨張し、Worker が長時間ブロックしうる（issue #50 codex レビュー指摘）。
 */
export function decodeDetections(
  output: Float32Array,
  dims: readonly number[],
  options: DecodeDetectionsOptions = {}
): RawDetection[] {
  const maskProtoChannels = options.maskProtoChannels ?? FASTSAM_MASK_PROTO_CHANNELS;
  const confidenceThreshold = options.confidenceThreshold ?? FASTSAM_CONFIDENCE_THRESHOLD;
  const maxDetections = options.maxDetections ?? FASTSAM_MAX_DETECTIONS;

  const [, predLen, numCandidates] = dims;
  const expectedPredLen = 4 + 1 + maskProtoChannels;
  if (predLen !== expectedPredLen) {
    throw new Error(
      `Unexpected FastSAM output0 shape: predLen=${predLen}, expected ${expectedPredLen} ` +
        `(4 box + 1 objectness score + ${maskProtoChannels} mask coeffs)`
    );
  }

  const detections: RawDetection[] = [];
  const scoreRow = 4 * numCandidates;

  for (let i = 0; i < numCandidates; i++) {
    const score = output[scoreRow + i];
    if (score < confidenceThreshold) {
      continue;
    }

    const cx = output[0 * numCandidates + i];
    const cy = output[1 * numCandidates + i];
    const w = output[2 * numCandidates + i];
    const h = output[3 * numCandidates + i];

    const maskCoeffs = new Float32Array(maskProtoChannels);
    for (let m = 0; m < maskProtoChannels; m++) {
      maskCoeffs[m] = output[(5 + m) * numCandidates + i];
    }

    detections.push({
      box: { x: cx - w / 2, y: cy - h / 2, width: w, height: h },
      score,
      maskCoeffs,
    });
  }

  if (detections.length <= maxDetections) {
    return detections;
  }

  // NMS・マスク復号のコストを上限化するため、スコア降順で上位 maxDetections 件のみ残す
  // （Ultralytics 公式実装の `max_det` に倣う。issue #50 codex レビュー指摘）。
  return detections.sort((a, b) => b.score - a.score).slice(0, maxDetections);
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
 * クラス非依存の貪欲 NMS。スコア降順に走査し、既に採用したボックスと IoU が閾値を超える
 *候補を抑制する。FastSAM は単一クラス（objectness のみ）のため、YOLO11n-seg のような
 * クラス単位（class-aware）の分岐は不要（Ultralytics 公式 FastSAM の `agnostic_nms` 相当）。
 */
export function nms(
  detections: readonly RawDetection[],
  iouThreshold: number = FASTSAM_IOU_THRESHOLD
): RawDetection[] {
  const sorted = [...detections].sort((a, b) => b.score - a.score);
  const kept: RawDetection[] = [];

  for (const candidate of sorted) {
    const suppressed = kept.some((k) => computeIoU(k.box, candidate.box) > iouThreshold);
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
 * マスクプロトタイプ（`[maskProtoChannels, maskProtoSize, maskProtoSize]`。FastSAM は既定
 * 256x256、YOLO11n-seg は160x160と異なる）とマスク係数（長さ maskProtoChannels）の内積 →
 * sigmoid → 閾値二値化、という Ultralytics の `process_mask` と同じ手順を
 * **プロトタイプ空間でのみ**行い、その結果を元画像のボックス座標系へ最近傍アップサンプリング
 * する（YOLO11n-seg 実装（issue #49 codex レビュー指摘）と同じ設計方針: 元画像のボックス内
 * ピクセルごとに内積計算をすると、高解像度画像を覆う検出1件だけで
 * `ボックス内ピクセル数 × maskProtoChannels` の積和が爆発し Worker が長時間ブロックする。
 * プロトタイプ空間はどれだけ元画像が高解像度でも最大 `maskProtoSize^2 × maskProtoChannels`
 * ≈ 210万回（256^2 × 32）の積和で済み、アップサンプリング側は最近傍のルックアップのみ
 * （チャンネルループなし）のため軽い）。
 */
export function decodeInstanceMask(
  protoData: Float32Array,
  maskCoeffs: Float32Array,
  box1024: BoxXywh,
  transform: LetterboxTransform,
  originalWidth: number,
  originalHeight: number,
  options: DecodeInstanceMaskOptions = {}
): { data: Uint8Array; width: number; height: number; x: number; y: number } {
  const maskProtoSize = options.maskProtoSize ?? FASTSAM_MASK_PROTO_SIZE;
  const inputSize = options.inputSize ?? FASTSAM_INPUT_SIZE;
  const maskThreshold = options.maskThreshold ?? FASTSAM_MASK_THRESHOLD;
  const maskProtoChannels = maskCoeffs.length;
  const protoScale = maskProtoSize / inputSize;
  const protoPixelCount = maskProtoSize * maskProtoSize;

  const boxOrig = mapBoxToOriginal(box1024, transform, originalWidth, originalHeight);
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

export interface DecodeFastSamOutputsOptions
  extends DecodeDetectionsOptions, DecodeInstanceMaskOptions {
  iouThreshold?: number;
}

/**
 * `output0`（検出候補）と `output1`（マスクプロトタイプ）から、NMS 適用済みの
 * インスタンス一覧（元画像座標系のボックス・マスク付き）を組み立てる。
 */
export function decodeFastSamOutputs(
  detOutput: Float32Array,
  detDims: readonly number[],
  protoOutput: Float32Array,
  transform: LetterboxTransform,
  originalWidth: number,
  originalHeight: number,
  options: DecodeFastSamOutputsOptions = {}
): FastSamDetection[] {
  const raw = decodeDetections(detOutput, detDims, options);
  const kept = nms(raw, options.iouThreshold ?? FASTSAM_IOU_THRESHOLD);

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
      score: detection.score,
      box: boxOrig,
      mask,
    };
  });
}
