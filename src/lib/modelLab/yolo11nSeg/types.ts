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
   * インスタンスの二値マスク（1バイト1ピクセル、0 or 1）。メモリ効率のため元画像全体ではなく
   * バウンディングボックス範囲のみを保持する（`width`/`height` はボックス範囲のサイズ、
   * `x`/`y` は元画像座標系での左上オフセット）。
   */
  mask: {
    data: Uint8Array;
    width: number;
    height: number;
    /** 元画像座標系での mask.data の左上オフセット x */
    x: number;
    /** 元画像座標系での mask.data の左上オフセット y */
    y: number;
  };
}
