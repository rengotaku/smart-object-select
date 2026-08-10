import type { SamImageInput } from "@/lib/sam";
import { FASTSAM_INPUT_SIZE, FASTSAM_LETTERBOX_PAD_VALUE } from "./constants";

/**
 * 元画像 ⇔ モデル入力（`targetSize` 正方形、レターボックス済み）の座標変換情報。
 * アスペクト比を保持したまま `scale` で縮小し、余った領域を `padX`/`padY` で
 * 中央寄せパディングする（Ultralytics の `letterbox` 前処理と同じ挙動。
 * `../yolo11nSeg/preprocess.ts` と同一のアルゴリズムだが、FastSAM は既定
 * `targetSize` が 1024（YOLO11n-seg は 640）と異なるため独立実装する。issue #50
 * やってはいけないこと: YOLO11n-seg コードの未検証流用禁止）。
 */
export interface LetterboxTransform {
  /** 元画像 → リサイズ後（パディング前）画像への等方スケール係数 */
  scale: number;
  /** 左右パディング幅（モデル入力空間でのpx） */
  padX: number;
  /** 上下パディング幅（モデル入力空間でのpx） */
  padY: number;
  /** パディング前のリサイズ後の幅 */
  resizedWidth: number;
  /** パディング前のリサイズ後の高さ */
  resizedHeight: number;
}

/**
 * 元画像の寸法から、`targetSize` 正方形へのレターボックス変換を計算する。
 * 短辺が余る側に均等にパディングを配分する（Ultralytics 既定の `center=True` 相当）。
 */
export function computeLetterboxTransform(
  width: number,
  height: number,
  targetSize: number = FASTSAM_INPUT_SIZE
): LetterboxTransform {
  const scale = Math.min(targetSize / width, targetSize / height);
  const resizedWidth = Math.max(1, Math.round(width * scale));
  const resizedHeight = Math.max(1, Math.round(height * scale));
  const padX = Math.floor((targetSize - resizedWidth) / 2);
  const padY = Math.floor((targetSize - resizedHeight) / 2);

  return { scale, padX, padY, resizedWidth, resizedHeight };
}

/**
 * 元画像を `transform` に従ってレターボックス（最近傍補間でリサイズ＋パディング）し、
 * `targetSize` x `targetSize` の RGBA ピクセル列を返す。検証目的のモデルであり
 * 精度チューニングは対象外のため（issue #50 スコープ）、双線形補間等は行わない
 * （YOLO11n-seg・MobileSAM と同じ方針）。
 */
export function letterboxResize(
  image: SamImageInput,
  transform: LetterboxTransform,
  targetSize: number = FASTSAM_INPUT_SIZE
): Uint8ClampedArray {
  const { scale, padX, padY, resizedWidth, resizedHeight } = transform;
  const output = new Uint8ClampedArray(targetSize * targetSize * 4);
  // 全体をパディング色で塗ってから、リサイズ後の画像を中央に上書きする。
  for (let i = 0; i < targetSize * targetSize; i++) {
    output[i * 4] = FASTSAM_LETTERBOX_PAD_VALUE;
    output[i * 4 + 1] = FASTSAM_LETTERBOX_PAD_VALUE;
    output[i * 4 + 2] = FASTSAM_LETTERBOX_PAD_VALUE;
    output[i * 4 + 3] = 255;
  }

  for (let y = 0; y < resizedHeight; y++) {
    const srcY = Math.min(image.height - 1, Math.floor(y / scale));
    const dstY = y + padY;
    if (dstY < 0 || dstY >= targetSize) continue;
    for (let x = 0; x < resizedWidth; x++) {
      const srcX = Math.min(image.width - 1, Math.floor(x / scale));
      const dstX = x + padX;
      if (dstX < 0 || dstX >= targetSize) continue;
      const srcOffset = (srcY * image.width + srcX) * 4;
      const dstOffset = (dstY * targetSize + dstX) * 4;
      output[dstOffset] = image.data[srcOffset];
      output[dstOffset + 1] = image.data[srcOffset + 1];
      output[dstOffset + 2] = image.data[srcOffset + 2];
      output[dstOffset + 3] = image.data[srcOffset + 3];
    }
  }

  return output;
}

/**
 * レターボックス済み RGBA ピクセル列を、モデル入力形式（NCHW、チャンネルごとに
 * planar な `[1, 3, size, size]`、0-1 正規化）に変換する。アルファチャンネルは破棄する。
 *
 * Ultralytics の ONNX エクスポートは正規化（`/255`）をグラフに含めずホスト側で行う前提
 * （`ultralytics/data/augment.py` の `ToTensor`/`img / 255` 相当。FastSAM は
 * YOLOv8-seg ベースで同じエクスポートパイプラインを使う）。
 */
export function toModelInputData(
  rgba: Uint8ClampedArray,
  size: number = FASTSAM_INPUT_SIZE
): Float32Array {
  const pixelCount = size * size;
  const output = new Float32Array(pixelCount * 3);
  const rOffset = 0;
  const gOffset = pixelCount;
  const bOffset = pixelCount * 2;

  for (let i = 0; i < pixelCount; i++) {
    output[rOffset + i] = rgba[i * 4] / 255;
    output[gOffset + i] = rgba[i * 4 + 1] / 255;
    output[bOffset + i] = rgba[i * 4 + 2] / 255;
  }

  return output;
}

export interface BoxXywh {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * モデル入力空間（`targetSize` 正方形、レターボックス済み）のボックスを、
 * 元画像のピクセル座標系へ逆変換する。画像範囲にクランプする。
 */
export function mapBoxToOriginal(
  box: BoxXywh,
  transform: LetterboxTransform,
  originalWidth: number,
  originalHeight: number
): BoxXywh {
  const { scale, padX, padY } = transform;

  const rawX0 = (box.x - padX) / scale;
  const rawY0 = (box.y - padY) / scale;
  const rawX1 = (box.x + box.width - padX) / scale;
  const rawY1 = (box.y + box.height - padY) / scale;

  const x0 = Math.max(0, Math.min(originalWidth, rawX0));
  const y0 = Math.max(0, Math.min(originalHeight, rawY0));
  const x1 = Math.max(0, Math.min(originalWidth, rawX1));
  const y1 = Math.max(0, Math.min(originalHeight, rawY1));

  return {
    x: x0,
    y: y0,
    width: Math.max(0, x1 - x0),
    height: Math.max(0, y1 - y0),
  };
}
