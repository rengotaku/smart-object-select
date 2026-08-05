export interface DisplayRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ImageSize {
  width: number;
  height: number;
}

/**
 * Canvas 上のクリック座標（clientX/clientY）を元画像の座標系へ変換する。
 * 画像範囲内にクランプする。rect の幅・高さが 0 のときは null を返す。
 */
export function toImageCoords(
  clientX: number,
  clientY: number,
  rect: DisplayRect,
  image: ImageSize
): { x: number; y: number } | null {
  if (rect.width <= 0 || rect.height <= 0) {
    return null;
  }

  const relativeX = clientX - rect.left;
  const relativeY = clientY - rect.top;

  const rawX = Math.floor(relativeX * (image.width / rect.width));
  const rawY = Math.floor(relativeY * (image.height / rect.height));

  const clampedX = Math.max(0, Math.min(image.width - 1, rawX));
  const clampedY = Math.max(0, Math.min(image.height - 1, rawY));

  return { x: clampedX, y: clampedY };
}
