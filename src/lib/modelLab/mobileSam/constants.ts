/**
 * MobileSAM（issue #47, 親 #45）用の定数。
 *
 * モデル資産は `public/models/mobile-sam/` に自前ホスティングしている
 * （出典・ライセンスは public/models/mobile-sam/NOTICE を参照。ONNX 本体は
 * https://huggingface.co/Acly/MobileSAM の `mobile_sam_image_encoder.onnx` /
 * `sam_mask_decoder_single.onnx`）。
 */

/** 画像エンコーダ ONNX モデルの URL（自ホストパス） */
export const MOBILE_SAM_ENCODER_URL = "/models/mobile-sam/mobile_sam_image_encoder.onnx";

/** マスクデコーダ ONNX モデルの URL（自ホストパス。単一マスクを返す variant） */
export const MOBILE_SAM_DECODER_URL = "/models/mobile-sam/sam_mask_decoder_single.onnx";

/**
 * エンコーダに入力する画像の長辺サイズ（px）。
 * MobileSAM の image_encoder は入力形状 [image_height, image_width, 3]（動的）だが、
 * 学習時の解像度に合わせて長辺を 1024px にリサイズしてから渡す必要がある
 * （参考実装: https://github.com/xw19/DarkRawLAB の SamController.imageToSamTensor）。
 */
export const MOBILE_SAM_TARGET_LONG_SIDE = 1024;

/**
 * デコーダの `mask_input`（前回予測の低解像度マスクを与えるリファインメント入力）の一辺サイズ。
 * 本 sub-issue は単発クリックのみをスコープとするため常にゼロ埋めで渡す（`has_mask_input=0`）。
 */
export const MOBILE_SAM_MASK_INPUT_SIZE = 256;
