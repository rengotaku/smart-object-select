/**
 * FastSAM（issue #50, 親 #45）用の定数。
 *
 * モデル資産は `public/models/fast-sam/` に自前ホスティングしている
 * （出典・ライセンスは public/models/fast-sam/NOTICE を参照。ONNX 本体は
 * https://huggingface.co/anakhiu/fastsam-onnx の `fastsam_s.onnx`）。
 *
 * FastSAM は YOLO11n-seg（issue #49）と同じ「全自動 seg-everything → クリックで
 * インスタンス選択」のパラダイムで統合する（issue #50 で解決した未確定の論点。
 * FastSAM 本来の点/矩形プロンプトによる絞り込みは実装しない）。ただし出力ヘッドが
 * 異なるため（YOLO11n-seg は COCO80クラス、FastSAM はクラス非依存の単一
 * objectness スコア）、前処理・後処理は個別に実機検証した値をここに定義する
 * （issue #50 やってはいけないこと: YOLO11n-seg 用コードの未検証流用禁止）。
 */

/** ONNX モデルの URL（自ホストパス） */
export const FASTSAM_MODEL_URL = "/models/fast-sam/fastsam-s.onnx";

/**
 * ONNX グラフの入力テンソル名。`anakhiu/fastsam-onnx` の `fastsam_s.onnx` は
 * Ultralytics `yolo export format=onnx` の既定名 `images` を使う
 * （onnxruntime-node で実モデルを読み込んで確認済み）。
 */
export const FASTSAM_INPUT_NAME = "images";

/**
 * モデル入力の一辺サイズ（px）。FastSAM-s の入力形状は `[batch, 3, 1024, 1024]`
 * （`imgsz=1024` でエクスポートされており、動的軸ではなく固定形状。640 等の他サイズを
 * 渡すと onnxruntime が次元不一致エラーを返すことを onnxruntime-node で実機確認済み）。
 * アスペクト比を保持したまま、レターボックス（余白を灰色 114 で埋める）でこのサイズに合わせる。
 */
export const FASTSAM_INPUT_SIZE = 1024;

/**
 * マスクプロトタイプの一辺サイズ（px）。output1 の形状 `[1, 32, 256, 256]`
 * （onnxruntime-node で実モデルを読み込んで確認済み）。YOLO11n-seg（160）とは異なる値。
 * `FASTSAM_INPUT_SIZE / FASTSAM_MASK_PROTO_SIZE = 4` が入力空間→プロト空間の縮小率。
 */
export const FASTSAM_MASK_PROTO_SIZE = 256;

/** マスクプロトタイプのチャンネル数（マスク係数の次元数）。output0 の末尾32要素と対応する。 */
export const FASTSAM_MASK_PROTO_CHANNELS = 32;

/**
 * output0 の第2次元（4 box + 1 class-agnostic objectness score + 32 mask coeffs）。
 * FastSAM は YOLO11n-seg と異なりクラス分類ヘッドを持たず、単一の "object" 判定スコアのみ
 * （anakhiu/fastsam-onnx の README、および onnxruntime-node での実測でスコアが常に 0-1
 * に収まる（sigmoid 適用済み）ことを確認済み。issue #50）。
 */
export const FASTSAM_PREDICTION_LENGTH = 4 + 1 + FASTSAM_MASK_PROTO_CHANNELS;

/**
 * objectness スコアの信頼度閾値。これ未満の候補は破棄する。
 * Ultralytics 公式 FastSAM の `Inference.py` 既定値（`--conf`）と同じ 0.4
 * （YOLO11n-seg の 0.25 とは異なる、FastSAM 固有の既定値）。
 */
export const FASTSAM_CONFIDENCE_THRESHOLD = 0.4;

/**
 * NMS の IoU 閾値。これ以上重なる低スコア候補を抑制する。
 * Ultralytics 公式 FastSAM の `Inference.py` 既定値（`--iou`）と同じ 0.9
 * （YOLO11n-seg の 0.45 とは異なる、FastSAM 固有の既定値。seg-everything は密に
 * 重なる候補を多く出すため、より高い IoU まで許容する設計になっている）。
 */
export const FASTSAM_IOU_THRESHOLD = 0.9;

/**
 * NMS **後**の最終検出数の上限（スコア降順で上位のみ残す）。
 * Ultralytics 公式実装の `max_det`（NMS 後の最終検出数上限、既定 300）と同じ値・同じ適用位置。
 *
 * 🔴 NMS **前**に適用してはいけない（issue #50 codex レビュー指摘 P2）。NMS 前に適用すると、
 * 同一物体の高スコアな重複候補（IoU が高い、ほぼ同じ位置の別候補）だけで上位枠を占められた
 * 画像で、NMS により重複が除去された後も「別の物体」の候補は復元されず、最終検出数が
 * 本来より少なくなる（検出漏れ）。`decodeFastSamOutputs` は `nms()` の呼び出し時にこの値を
 * 渡し、NMS が生き残らせた（＝重複を除去済みの）候補の中から上位 `FASTSAM_MAX_DETECTIONS`
 * 件のみを最終結果とする。
 *
 * NMS **前**の候補数（O(n^2) の NMS 自体のコスト）を絞る目的には、別の
 * `FASTSAM_MAX_NMS_CANDIDATES`（本来の検出数を保つため、この値より大幅に大きい）を使う。
 */
export const FASTSAM_MAX_DETECTIONS = 300;

/**
 * 信頼度閾値通過後、NMS に渡す前に採用する候補数の上限（スコア降順で上位のみ残す）。
 * `FASTSAM_MAX_DETECTIONS`（NMS 後の最終検出数上限）とは**別物**で、目的は NMS
 * 自体のコストの上限化のみ（issue #50 codex レビュー指摘 P2: 最終検出数上限をこの
 * 用途に流用すると検出漏れが起きるため、意図的に大きく・別の定数として用意する）。
 *
 * FastSAM は class-agnostic な "segment everything" モデルで、IoU 閾値も 0.9 と高い
 * （＝ほぼ抑制されない）ため、複雑な画像では信頼度閾値通過後の候補が数千件規模になりうる。
 * この実装の `nms()` は O(n^2) の素朴な貪欲法のため、モデル出力の理論上限
 * （`output0` の候補数次元、`fastsam_s.onnx` で 21504）をそのまま NMS に渡しても
 * 現実的な時間（実測 1.4秒程度、21504候補全生存という最悪ケースで）で完了することを
 * 確認済みだが、将来 FastSAM の別バリアント（候補数がより多いモデル）に切り替わった場合の
 * 安全マージンとして、実運用で想定される物体数（数百件規模）より一桁大きい値を設定する。
 */
export const FASTSAM_MAX_NMS_CANDIDATES = 5000;

/** マスクロジットの二値化閾値。sigmoid(logit) > この値を前景とする（Ultralytics 既定値と同じ 0.5）。 */
export const FASTSAM_MASK_THRESHOLD = 0.5;

/** レターボックスのパディング色（Ultralytics 既定のグレー 114）。 */
export const FASTSAM_LETTERBOX_PAD_VALUE = 114;
