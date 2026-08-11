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

/**
 * 信頼度閾値通過後、NMS に渡す前に採用する候補数の上限（スコア降順で上位のみ残す）。
 * FastSAM（issue #50, `FASTSAM_MAX_NMS_CANDIDATES`）と同じ目的の定数（issue #56: FastSAM
 * のcodexレビューP1指摘「segment-everythingモデルは複雑な画像でNMS前候補数が膨大になり、
 * NMS自体がO(n^2)コストになりWorkerが長時間停止しうる」を受け、同種のリスクをYOLO11n-seg
 * にも導入する）。
 *
 * YOLO11n-seg の `output0` 候補数（`numCandidates`）は入力640x640・ストライド8/16/32の
 * アンカー数で決まる固定値 `(640/8)^2 + (640/16)^2 + (640/32)^2 = 6400+1600+400 = 8400`
 * （FastSAM の21504より小さい。モデル出力形状は画像内容に依らず一定で、変動するのは
 * 信頼度閾値を通過する候補の実数のみ）。NMS はクラス単位（class-aware、`nms()` 参照）の
 * ため、最悪ケース（全候補が同一クラスに集中）でも O(n^2) の n は高々8400。
 * COCO写真1枚あたりの実物体数（数十〜高々数百件規模）より一桁以上大きい値を安全マージンと
 * して設定する（FastSAM と同じ設計方針）。
 */
export const YOLO11N_SEG_MAX_NMS_CANDIDATES = 3000;

/** マスクロジットの二値化閾値。sigmoid(logit) > この値を前景とする（Ultralytics 既定値と同じ 0.5）。 */
export const YOLO11N_SEG_MASK_THRESHOLD = 0.5;

/** レターボックスのパディング色（Ultralytics 既定のグレー 114）。 */
export const YOLO11N_SEG_LETTERBOX_PAD_VALUE = 114;
