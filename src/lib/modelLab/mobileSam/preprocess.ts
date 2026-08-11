import type { SamImageInput } from "@/lib/types";
import { MOBILE_SAM_TARGET_LONG_SIDE } from "./constants";

export interface ResizedDimensions {
  width: number;
  height: number;
  /** 元画像 → リサイズ後画像への等方スケール係数（point 座標の変換にも使う） */
  scale: number;
}

/**
 * 長辺が `targetLongSide` になるよう、アスペクト比を保ったままリサイズ後の寸法を計算する。
 * MobileSAM の image_encoder（動的形状 [image_height, image_width, 3]）は正方形パディングを
 * 必要としない（参考実装で確認済み。constants.ts のコメント参照）。
 */
export function computeResizedDimensions(
  width: number,
  height: number,
  targetLongSide: number = MOBILE_SAM_TARGET_LONG_SIDE
): ResizedDimensions {
  const longSide = Math.max(width, height);
  const scale = targetLongSide / longSide;

  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scale,
  };
}

/**
 * RGBA 画像を最近傍補間でリサイズする。
 * 検証目的のモデルであり精度チューニングは対象外のため（issue #47 やってはいけないこと）、
 * 双線形補間等の高品質なリサイズは行わない。
 */
export function resizeRgbaNearest(
  image: SamImageInput,
  targetWidth: number,
  targetHeight: number
): Uint8ClampedArray {
  const output = new Uint8ClampedArray(targetWidth * targetHeight * 4);
  const scaleX = image.width / targetWidth;
  const scaleY = image.height / targetHeight;

  for (let y = 0; y < targetHeight; y++) {
    const srcY = Math.min(image.height - 1, Math.floor(y * scaleY));
    for (let x = 0; x < targetWidth; x++) {
      const srcX = Math.min(image.width - 1, Math.floor(x * scaleX));
      const srcOffset = (srcY * image.width + srcX) * 4;
      const dstOffset = (y * targetWidth + x) * 4;
      output[dstOffset] = image.data[srcOffset];
      output[dstOffset + 1] = image.data[srcOffset + 1];
      output[dstOffset + 2] = image.data[srcOffset + 2];
      output[dstOffset + 3] = image.data[srcOffset + 3];
    }
  }

  return output;
}

/**
 * リサイズ済み RGBA ピクセル列を、エンコーダ入力形式（[height, width, 3] の
 * インターリーブド RGB、0-255 の raw 値）に変換する。アルファチャンネルは破棄する。
 *
 * MobileSAM の image_encoder ONNX グラフは正規化（平均減算・分散除算）をグラフ内部で
 * 行うため、ここでは正規化しない。実際に onnxruntime-node でエンコーダ+デコーダを
 * 通して検証済み（0-255 raw 値をそのまま渡すことで既知の矩形領域を正しくマスクできた）。
 * 二重に正規化すると入力がほぼ均一な値に潰れ、マスクが破綻する。
 */
export function toEncoderInputData(
  rgba: Uint8ClampedArray,
  width: number,
  height: number
): Float32Array {
  const pixelCount = width * height;
  const output = new Float32Array(pixelCount * 3);

  for (let i = 0; i < pixelCount; i++) {
    output[i * 3] = rgba[i * 4];
    output[i * 3 + 1] = rgba[i * 4 + 1];
    output[i * 3 + 2] = rgba[i * 4 + 2];
  }

  return output;
}

/** 元画像座標系の点を、エンコーダ入力空間（長辺 1024 にリサイズ後）の座標へ変換する */
export function scalePointToEncoderSpace(
  x: number,
  y: number,
  scale: number
): { x: number; y: number } {
  return { x: x * scale, y: y * scale };
}
