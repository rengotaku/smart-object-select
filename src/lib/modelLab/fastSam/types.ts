/**
 * FastSAM の1インスタンス検出結果。座標は元画像のピクセル座標系。
 *
 * YOLO11n-seg の `Yolo11nSegDetection` と異なり `classId`/`label` を持たない。
 * FastSAM は「segment everything」型のクラス非依存モデルで、検出ヘッドは
 * ボックス＋単一 objectness スコア＋マスク係数のみを出力し、人間可読なクラス名を
 * 生成できない（`public/models/fast-sam/NOTICE` 参照。issue #50）。
 */
export interface FastSamDetection {
  /** objectness スコア（0-1）。クラス分類ではなく「物体らしさ」の信頼度。 */
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
   * `x`/`y` は元画像座標系での左上オフセット。YOLO11n-seg の `Yolo11nSegDetection.mask` と
   * 同じ設計、issue #49 codex レビュー指摘を踏襲）。
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
