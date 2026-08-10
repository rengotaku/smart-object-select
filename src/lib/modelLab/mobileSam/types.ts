/** MobileSAM 推論結果の二値マスク。1 バイト 1 ピクセル（0 or 1）。長さ = width * height */
export interface MobileSamMaskResult {
  data: Uint8Array;
  width: number;
  height: number;
  score: number;
}
