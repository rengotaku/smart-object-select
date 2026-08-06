import type { SamImageInput, SamMaskResult } from "./types";
import type { OverlayColor } from "./maskOverlay";

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
      data[offset + 3] = image.data[offset + 3];
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

/**
 * マスクの不透明領域 (data > 0) の最小・最大座標からタイトなバウンディングボックスを計算する。
 * マスクが全て 0 の場合は null を返す。
 */
export function computeMaskBounds(
  mask: SamMaskResult
): { x: number; y: number; width: number; height: number } | null {
  let minX = mask.width;
  let minY = mask.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < mask.height; y++) {
    for (let x = 0; x < mask.width; x++) {
      if (mask.data[y * mask.width + x] > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX === -1 || maxY === -1) {
    return null;
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}

/**
 * 複数マスクそれぞれの `computeMaskBounds` の和集合となるバウンディングボックスを計算する。
 * masks が空、または全マスクが空（bounds が全て null）の場合は null を返す。
 */
export function computeUnionBounds(
  masks: SamMaskResult[]
): { x: number; y: number; width: number; height: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const mask of masks) {
    const bounds = computeMaskBounds(mask);
    if (!bounds) continue;

    if (bounds.x < minX) minX = bounds.x;
    if (bounds.y < minY) minY = bounds.y;
    if (bounds.x + bounds.width > maxX) maxX = bounds.x + bounds.width;
    if (bounds.y + bounds.height > maxY) maxY = bounds.y + bounds.height;
  }

  if (maxX === -Infinity || maxY === -Infinity) {
    return null;
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

/**
 * 元画像の bounds 内だけを対象に、マスクのオーバーレイ色をアルファブレンドした RGBA を返す。
 * image と mask の寸法が一致しない場合は Error を throw する。
 *
 * 画像全体サイズの一時バッファは確保せず、計算量は bounds の面積（width * height）に比例する
 * （高解像度画像で候補ごとにフルサイズの一時アロケーションが発生するのを避けるための実装）。
 */
export function composeMaskOverlayInBounds(
  image: SamImageInput,
  mask: SamMaskResult,
  bounds: { x: number; y: number; width: number; height: number },
  color: OverlayColor
): RgbaPixels {
  if (image.width !== mask.width || image.height !== mask.height) {
    throw new Error(
      `Image and mask dimensions do not match: image=${image.width}x${image.height}, mask=${mask.width}x${mask.height}`
    );
  }

  const data = new Uint8ClampedArray(bounds.width * bounds.height * 4);
  const alpha = color.a / 255;

  for (let y = 0; y < bounds.height; y++) {
    const srcY = bounds.y + y;
    for (let x = 0; x < bounds.width; x++) {
      const srcX = bounds.x + x;
      const srcIndex = srcY * image.width + srcX;
      const srcOffset = srcIndex * 4;
      const destOffset = (y * bounds.width + x) * 4;

      if (mask.data[srcIndex] > 0) {
        data[destOffset] = color.r * alpha + image.data[srcOffset] * (1 - alpha);
        data[destOffset + 1] = color.g * alpha + image.data[srcOffset + 1] * (1 - alpha);
        data[destOffset + 2] = color.b * alpha + image.data[srcOffset + 2] * (1 - alpha);
        data[destOffset + 3] = 255;
      } else {
        data[destOffset] = image.data[srcOffset];
        data[destOffset + 1] = image.data[srcOffset + 1];
        data[destOffset + 2] = image.data[srcOffset + 2];
        data[destOffset + 3] = image.data[srcOffset + 3];
      }
    }
  }

  return { data, width: bounds.width, height: bounds.height };
}

/**
 * RgbaPixels から指定した bounds の矩形領域を切り出した新しい RgbaPixels を返す。
 */
export function cropRgbaPixels(
  pixels: RgbaPixels,
  bounds: { x: number; y: number; width: number; height: number }
): RgbaPixels {
  const croppedData = new Uint8ClampedArray(bounds.width * bounds.height * 4);

  for (let y = 0; y < bounds.height; y++) {
    const srcY = bounds.y + y;
    for (let x = 0; x < bounds.width; x++) {
      const srcX = bounds.x + x;
      const srcOffset = (srcY * pixels.width + srcX) * 4;
      const destOffset = (y * bounds.width + x) * 4;

      croppedData[destOffset] = pixels.data[srcOffset];
      croppedData[destOffset + 1] = pixels.data[srcOffset + 1];
      croppedData[destOffset + 2] = pixels.data[srcOffset + 2];
      croppedData[destOffset + 3] = pixels.data[srcOffset + 3];
    }
  }

  return {
    data: croppedData,
    width: bounds.width,
    height: bounds.height,
  };
}
