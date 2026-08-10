/**
 * Model Lab の実行結果表示（issue #46）が扱うオーバーレイの共通形式。
 *
 * 検証対象モデルは大きく2系統のパラダイムを持つ（親 #45 Decision Log #3）:
 * - 点プロンプト系（SAM系: MobileSAM/EdgeSAM）→ ピクセル単位のマスク
 * - 全自動検出系（YOLO系: YOLO11n-seg/FastSAM）→ インスタンスのバウンディングボックス
 *
 * `ModelLabOverlay` は両方を一つの配列に混在させられる判別可能ユニオンにし、
 * 実行結果表示エリアが「モデルの種類を問わず同じコンポーネントで重ね描画できる」
 * 土台になるようにする。実際の描画ロジックは後続 sub-issue で実装する。
 */

/** 点プロンプト系モデルが返すマスク結果のオーバーレイ */
export interface ModelLabMaskOverlay {
  kind: "mask";
  /** 2値マスク（0/1 or 0-255）のピクセルデータ */
  data: Uint8Array;
  width: number;
  height: number;
  label?: string;
  score?: number;
}

/** 全自動検出系モデルが返すインスタンス（バウンディングボックス）のオーバーレイ */
export interface ModelLabBoxOverlay {
  kind: "box";
  /** 画像座標系での左上 x, y と幅・高さ（px） */
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string;
  score?: number;
  /**
   * インスタンスの二値マスク（issue #49, YOLO11n-seg で実装）。ある場合は元画像と
   * 同じ width/height（`kind: "mask"` の `ModelLabMaskOverlay` と同じ形式）。
   * 全自動検出系モデルの中にはボックスのみを返すものもあるため任意フィールドとする。
   */
  mask?: {
    data: Uint8Array;
    width: number;
    height: number;
  };
}

export type ModelLabOverlay = ModelLabMaskOverlay | ModelLabBoxOverlay;

/** モデルの1回の実行結果 */
export interface ModelLabResult {
  /** 実行に使ったモデルの `ModelLabDescriptor.id` */
  modelId: string;
  overlays: ModelLabOverlay[];
}
