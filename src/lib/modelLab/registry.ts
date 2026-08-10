/**
 * Model Lab（issue #46, 親 #45）で検証するモデルの記述子。
 *
 * 却下・保留されたモデル（MobileSAM/EdgeSAM/YOLO11n-seg/FastSAM 等）のうち
 * wasm 対応可能なものを、後続 sub-issue が1件ずつこのリストへ追加していく。
 */
export interface ModelLabDescriptor {
  /** モデルを一意に識別するID（例: "mobile-sam"）。`<select>` の value に使う */
  id: string;
  /** UI（モデル切り替え `<select>`）に表示する名前 */
  name: string;
  /** モデルの簡単な説明（任意。UI 上のツールチップ等で使う想定） */
  description?: string;
}

/**
 * 検証対象モデルのレジストリ。
 *
 * 後続 sub-issue はこの配列に `ModelLabDescriptor` を追加するだけで、
 * `ModelLabPage` のモデル切り替え `<select>` に選択肢が増える。
 *
 * "mobile-sam"（issue #47）: `src/lib/modelLab/mobileSam/` が提供する
 * `onnxruntime-web` 直接実行のセッションを `useMobileSam`（`src/hooks/useMobileSam.ts`）
 * 経由で使う。id はその2箇所と一致させること。
 */
export const ModelLabRegistry: ModelLabDescriptor[] = [
  {
    id: "mobile-sam",
    name: "MobileSAM",
    description:
      "軽量版SAM（TinyViTベースのエンコーダ）。onnxruntime-web を直接実行し、" +
      "点クリックでマスクを推論する（issue #34/ADR 0006 で見送り、issue #47 で検証用に統合）。",
  },
];
