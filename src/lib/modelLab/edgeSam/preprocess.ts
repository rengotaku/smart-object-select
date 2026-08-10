import type { SamImageInput } from "@/lib/sam";
import { EDGE_SAM_INPUT_SIZE } from "./constants";

/**
 * 元画像 → エンコーダ入力空間（`EDGE_SAM_INPUT_SIZE` 四方の正方形）への
 * x/y 独立なスケール係数。
 *
 * EdgeSAM は MobileSAM と異なり、アスペクト比を保持せず常に正方形へリサイズする
 * （`tonyyang2000/EdgeSAM` の `handler.py`: `image.resize((1024, 1024), BILINEAR)`）ため、
 * 縦横で異なるスケール係数を持つ（MobileSAM の等方スケールとは違い、x/y を別々に扱う）。
 */
export interface EncoderScale {
  scaleX: number;
  scaleY: number;
}

/** 元画像の寸法から、エンコーダ入力空間への x/y スケール係数を計算する */
export function computeEncoderScale(
  width: number,
  height: number,
  targetSize: number = EDGE_SAM_INPUT_SIZE
): EncoderScale {
  return {
    scaleX: targetSize / width,
    scaleY: targetSize / height,
  };
}

/**
 * RGBA 画像を最近傍補間で `targetWidth` x `targetHeight` にリサイズする
 * （アスペクト比は保持しない。呼び出し側が正方形ターゲットを渡すことを想定）。
 *
 * 検証目的のモデルであり精度チューニングは対象外のため（issue #48 やってはいけないこと）、
 * 双線形補間等の高品質なリサイズは行わない（EdgeSAM 公式リファレンス実装は BILINEAR だが、
 * onnxruntime-node による実機検証で最近傍補間でも既知の矩形領域を正しくマスクできることを
 * 確認済み）。
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
 * リサイズ済み RGBA ピクセル列を、エンコーダ入力形式（CHW = [3, height, width] の
 * プレーン分離、0-1 に正規化した値）に変換する。アルファチャンネルは破棄する。
 *
 * MobileSAM の `toEncoderInputData`（HWC インターリーブド、正規化なし、raw 0-255）とは
 * 完全に異なる（issue #48 やってはいけないこと: MobileSAM のパラメータを流用しない）。
 * EdgeSAM の image_encoder ONNX グラフはグラフ内部で正規化を行わないため、ここで
 * `/ 255` を適用する必要がある（`tonyyang2000/EdgeSAM` の `handler.py`:
 * `img_array = np.array(image).astype(np.float32) / 255.0` の後に
 * `transpose(2, 0, 1)` で CHW 化。onnxruntime-node による実機検証で、この正規化・
 * プレーン順序で既知の矩形領域を正しくマスクできることを確認済み）。
 */
export function toEncoderInputData(
  rgba: Uint8ClampedArray,
  width: number,
  height: number
): Float32Array {
  const pixelCount = width * height;
  const output = new Float32Array(pixelCount * 3);

  for (let i = 0; i < pixelCount; i++) {
    output[i] = rgba[i * 4] / 255; // R plane
    output[pixelCount + i] = rgba[i * 4 + 1] / 255; // G plane
    output[2 * pixelCount + i] = rgba[i * 4 + 2] / 255; // B plane
  }

  return output;
}

/** 元画像座標系の点を、エンコーダ入力空間（`EDGE_SAM_INPUT_SIZE` 四方）の座標へ変換する */
export function scalePointToEncoderSpace(
  x: number,
  y: number,
  scale: EncoderScale
): { x: number; y: number } {
  return { x: x * scale.scaleX, y: y * scale.scaleY };
}
