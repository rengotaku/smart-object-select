/** RGBA ピクセル列。width * height * 4 バイト */
export interface SamImageInput {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** 1 バイト 1 ピクセルの二値マスク（0 or 1）。length === width * height */
export interface SamMaskResult {
  data: Uint8Array;
  width: number;
  height: number;
  score: number;
}

/** セグメンテーション指示用の座標とラベル（1: positive, 0: negative） */
export interface SegmentPoint {
  x: number;
  y: number;
  label: 0 | 1;
}
