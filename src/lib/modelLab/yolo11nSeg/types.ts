/** YOLO11n-seg の1インスタンス検出結果。座標は元画像のピクセル座標系。 */
export interface Yolo11nSegDetection {
  /** COCO クラス index（0-79） */
  classId: number;
  /** `labels.ts` の `COCO_CLASSES[classId]` */
  label: string;
  /** クラス信頼度スコア（0-1） */
  score: number;
  /** 元画像座標系でのバウンディングボックス（左上 x, y と幅・高さ） */
  box: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  /**
   * インスタンスの二値マスク（元画像と同じ width/height。1バイト1ピクセル、0 or 1）。
   * バウンディングボックス外は常に 0（Ultralytics のボックスクロップと同じ挙動）。
   */
  mask: {
    data: Uint8Array;
    width: number;
    height: number;
  };
}
