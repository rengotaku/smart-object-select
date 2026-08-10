/**
 * YOLO11n-seg（issue #49, 親 #45）用の定数。
 *
 * モデル資産は `public/models/yolo11n-seg/` に自前ホスティングしている
 * （出典・ライセンスは public/models/yolo11n-seg/NOTICE を参照。ONNX 本体は
 * https://huggingface.co/mobilint/YOLO11n-seg の `yolo11n-seg.onnx`）。
 *
 * MobileSAM/EdgeSAM（点プロンプト系）とは根本的にパラダイムが異なり、YOLO11n-seg は
 * 全自動でCOCO80クラスの全インスタンスを一括検出する（issue #49 参照）。
 */

/** ONNX モデルの URL（自ホストパス） */
export const YOLO11N_SEG_MODEL_URL = "/models/yolo11n-seg/yolo11n-seg.onnx";

/**
 * ONNX グラフの入力テンソル名。`mobilint/YOLO11n-seg` の `yolo11n-seg.onnx` は
 * "vanilla" な Ultralytics `yolo export format=onnx` の既定名 `images` ではなく
 * `input` を使う（onnxruntime-node で実モデルを読み込んで確認済み。NOTICE 参照）。
 */
export const YOLO11N_SEG_INPUT_NAME = "input";

/**
 * モデル入力の一辺サイズ（px）。YOLO11n-seg の入力形状は `[batch, 3, 640, 640]`
 * （onnxruntime-node で実モデルを読み込んで確認済み）。アスペクト比を保持したまま
 * レターボックス（余白を灰色 114 で埋める）でこのサイズに合わせる。
 */
export const YOLO11N_SEG_INPUT_SIZE = 640;

/**
 * マスクプロトタイプの一辺サイズ（px）。output1 の形状 `[1, 32, 160, 160]`
 * （onnxruntime-node で実モデルを読み込んで確認済み）。
 * `YOLO11N_SEG_INPUT_SIZE / YOLO11N_SEG_MASK_PROTO_SIZE = 4` が入力空間→プロト空間の縮小率。
 */
export const YOLO11N_SEG_MASK_PROTO_SIZE = 160;

/** マスクプロトタイプのチャンネル数（マスク係数の次元数）。output0 の末尾32要素と対応する。 */
export const YOLO11N_SEG_MASK_PROTO_CHANNELS = 32;

/** output0 の第2次元（4 box + 80 COCO class scores + 32 mask coeffs）。 */
export const YOLO11N_SEG_PREDICTION_LENGTH = 4 + 80 + YOLO11N_SEG_MASK_PROTO_CHANNELS;

/** クラススコアの信頼度閾値。これ未満の候補は破棄する（Ultralytics 既定値と同じ 0.25）。 */
export const YOLO11N_SEG_CONFIDENCE_THRESHOLD = 0.25;

/** NMS の IoU 閾値。これ以上重なる同クラスの低スコア候補を抑制する（Ultralytics 既定値と同じ 0.45）。 */
export const YOLO11N_SEG_IOU_THRESHOLD = 0.45;

/** マスクロジットの二値化閾値。sigmoid(logit) > この値を前景とする（Ultralytics 既定値と同じ 0.5）。 */
export const YOLO11N_SEG_MASK_THRESHOLD = 0.5;

/** レターボックスのパディング色（Ultralytics 既定のグレー 114）。 */
export const YOLO11N_SEG_LETTERBOX_PAD_VALUE = 114;
