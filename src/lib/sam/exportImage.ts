import type { SamImageInput, SamMaskResult } from "./types";

/** RGBA ピクセル列。data.length === width * height * 4 */
export interface RgbaPixels {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/**
 * 元画像のうちマスク内のピクセルだけを残し、マスク外のアルファを 0 にした RGBA を返す。
 * 画像とマスクの寸法が一致しない場合は Error を throw する。
 *
 * 出力は image の解像度をそのまま維持する（表示用に縮小した Canvas から呼び出さないこと）。
 */
export function applyMaskToImage(image: SamImageInput, mask: SamMaskResult): RgbaPixels {
  if (image.width !== mask.width || image.height !== mask.height) {
    throw new Error(
      `Image and mask dimensions do not match: image=${image.width}x${image.height}, mask=${mask.width}x${mask.height}`
    );
  }

  const pixelCount = image.width * image.height;
  const data = new Uint8ClampedArray(pixelCount * 4);

  for (let i = 0; i < pixelCount; i++) {
    const isMasked = mask.data[i] > 0;
    const offset = i * 4;
    if (isMasked) {
      data[offset] = image.data[offset];
      data[offset + 1] = image.data[offset + 1];
      data[offset + 2] = image.data[offset + 2];
      data[offset + 3] = 255;
    } else {
      data[offset + 3] = 0;
    }
  }

  return { data, width: image.width, height: image.height };
}

/** マスク内を白 (255,255,255,255)、マスク外を黒 (0,0,0,255) にした RGBA を返す */
export function maskToBlackAndWhite(mask: SamMaskResult): RgbaPixels {
  const pixelCount = mask.width * mask.height;
  const data = new Uint8ClampedArray(pixelCount * 4);

  for (let i = 0; i < pixelCount; i++) {
    const isMasked = mask.data[i] > 0;
    const value = isMasked ? 255 : 0;
    const offset = i * 4;
    data[offset] = value;
    data[offset + 1] = value;
    data[offset + 2] = value;
    data[offset + 3] = 255;
  }

  return { data, width: mask.width, height: mask.height };
}
