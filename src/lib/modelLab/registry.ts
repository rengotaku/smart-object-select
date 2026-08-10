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
 *
 * "edge-sam"（issue #48）: `src/lib/modelLab/edgeSam/` が提供する
 * `onnxruntime-web` 直接実行のセッションを `useEdgeSam`（`src/hooks/useEdgeSam.ts`）
 * 経由で使う。id はその2箇所と一致させること。
 *
 * "yolo11n-seg"（issue #49）: `src/lib/modelLab/yolo11nSeg/` が提供する
 * `onnxruntime-web` 直接実行のセッションを `useYolo11nSeg`（`src/hooks/useYolo11nSeg.ts`）
 * 経由で使う。id はその2箇所と一致させること。MobileSAM/EdgeSAM とは異なり、点クリックの
 * 代わりに画像アップロード時の全自動検出＋クリックでのインスタンス選択（ハイライト）という
 * インタラクションを取る（親 #45「未確定の論点」を issue #49 で解決）。
 *
 * "fast-sam"（issue #50）: `src/lib/modelLab/fastSam/` が提供する
 * `onnxruntime-web` 直接実行のセッションを `useFastSam`（`src/hooks/useFastSam.ts`）
 * 経由で使う。id はその2箇所と一致させること。YOLO11n-seg と同じ「全自動検出＋クリック
 * でのインスタンス選択」のインタラクションを取るが、FastSAM はクラス非依存（単一の
 * objectness スコアのみで、COCOクラスのような人間可読なラベルを持たない）（issue #50 で
 * 親 #45「未確定の論点」を解決）。
 */
export const ModelLabRegistry: ModelLabDescriptor[] = [
  {
    id: "mobile-sam",
    name: "MobileSAM",
    description:
      "軽量版SAM（TinyViTベースのエンコーダ）。onnxruntime-web を直接実行し、" +
      "点クリックでマスクを推論する（issue #34/ADR 0006 で見送り、issue #47 で検証用に統合）。",
  },
  {
    id: "edge-sam",
    name: "EdgeSAM",
    description:
      "軽量版SAM（RepViTベースのエンコーダ）。onnxruntime-web を直接実行し、" +
      "点クリックでマスクを推論する（issue #34/ADR 0006 で見送り、issue #48 で検証用に統合）。",
  },
  {
    id: "yolo11n-seg",
    name: "YOLO11n-seg",
    description:
      "COCO80クラス固定の全自動インスタンスセグメンテーション。任意物体は選べない閉集合検出器。" +
      "画像アップロードで全インスタンスを一括検出し、クリックで該当インスタンスをハイライトする" +
      "（issue #49 で検証用に統合。ライセンス: AGPL-3.0）。",
  },
  {
    id: "fast-sam",
    name: "FastSAM",
    description:
      "クラス非依存の全自動セグメンテーション（YOLOv8-segベース）。任意物体を検出できるが" +
      "人間可読なラベルは持たない。画像アップロードで全インスタンスを一括検出し、クリックで" +
      "該当インスタンスをハイライトする（issue #50 で検証用に統合。ライセンス: AGPL-3.0）。",
  },
];
