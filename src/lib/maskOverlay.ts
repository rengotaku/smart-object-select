import type { SamMaskResult } from "./types";

export interface OverlayColor {
  r: number;
  g: number;
  b: number;
  /** 0-255 */
  a: number;
}

export interface OverlayPixels {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** マスク内を color、マスク外を完全透明にした RGBA ピクセル列を返す */
export function maskToOverlayPixels(
  mask: SamMaskResult,
  color: OverlayColor
): OverlayPixels {
  const pixelCount = mask.width * mask.height;
  const data = new Uint8ClampedArray(pixelCount * 4);

  for (let i = 0; i < pixelCount; i++) {
    const isMasked = mask.data[i] > 0;
    const offset = i * 4;
    if (isMasked) {
      data[offset] = color.r;
      data[offset + 1] = color.g;
      data[offset + 2] = color.b;
      data[offset + 3] = color.a;
    } else {
      data[offset] = 0;
      data[offset + 1] = 0;
      data[offset + 2] = 0;
      data[offset + 3] = 0;
    }
  }

  return {
    data,
    width: mask.width,
    height: mask.height,
  };
}
