import type { Yolo11nSegDetection } from "./types";

interface MaskLike {
  data: Uint8Array;
  width: number;
  height: number;
}

function containsInMask(mask: MaskLike, x: number, y: number): boolean {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  if (ix < 0 || iy < 0 || ix >= mask.width || iy >= mask.height) {
    return false;
  }
  return mask.data[iy * mask.width + ix] > 0;
}

/**
 * 指定座標（元画像ピクセル座標系）を含むインスタンスの index を返す。「クリック位置を含む
 * インスタンスをハイライトする」インタラクション（issue #49）のヒットテストに使う。
 *
 * `Yolo11nSegDetection.mask` は常に元画像と同じサイズで存在する（`decodeInstanceMask` が
 * 全インスタンスに対して生成する。`types.ts` 参照）ため、ボックスの矩形ではなくマスクの
 * そのピクセルで判定する（ボックスより厳密で、重なった物体の境界も正確に判別できる）。
 * 複数のインスタンスのマスクが重なる場合は、ボックス面積が最小のものを優先する
 * （大きな物体の内側にある小さな物体を選びやすくするため）。
 * 一致するインスタンスが無ければ null を返す。
 */
export function findDetectionAtPoint(
  detections: readonly Yolo11nSegDetection[],
  x: number,
  y: number
): number | null {
  let bestIndex: number | null = null;
  let bestArea = Infinity;

  detections.forEach((detection, index) => {
    if (!containsInMask(detection.mask, x, y)) {
      return;
    }

    const area = detection.box.width * detection.box.height;
    if (area < bestArea) {
      bestArea = area;
      bestIndex = index;
    }
  });

  return bestIndex;
}
