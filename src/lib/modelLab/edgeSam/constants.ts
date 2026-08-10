/**
 * EdgeSAM（issue #48, 親 #45）用の定数。
 *
 * モデル資産は `public/models/edge-sam/` に自前ホスティングしている
 * （出典・ライセンスは public/models/edge-sam/NOTICE を参照。ONNX 本体は
 * https://huggingface.co/tonyyang2000/EdgeSAM の `edge_sam_3x_encoder.onnx` /
 * `edge_sam_3x_decoder.onnx`）。
 *
 * MobileSAM（`../mobileSam/constants.ts`）とは値・前提が異なる（issue #48
 * やってはいけないこと: MobileSAM の数値をコピペせず個別確認すること）。
 * 実際に onnxruntime-node でエンコーダ+デコーダの入出力形状・
 * `tonyyang2000/EdgeSAM` の `handler.py`（リファレンス実装）を確認して決定した。
 */

/** 画像エンコーダ ONNX モデルの URL（自ホストパス） */
export const EDGE_SAM_ENCODER_URL = "/models/edge-sam/edge_sam_3x_encoder.onnx";

/** マスクデコーダ ONNX モデルの URL（自ホストパス） */
export const EDGE_SAM_DECODER_URL = "/models/edge-sam/edge_sam_3x_decoder.onnx";

/**
 * エンコーダに入力する画像の一辺サイズ（px）。
 *
 * EdgeSAM の image_encoder は入力形状が `[1, 3, 1024, 1024]` に固定されている
 * （onnxruntime-node で実モデルを読み込んで確認済み）。MobileSAM の動的形状
 * `[image_height, image_width, 3]`（長辺リサイズ、アスペクト比保持）とは異なり、
 * EdgeSAM は正方形へ非等方（アスペクト比を保持しない）リサイズする
 * （`tonyyang2000/EdgeSAM` の `handler.py`: `image.resize((1024, 1024), BILINEAR)`）。
 */
export const EDGE_SAM_INPUT_SIZE = 1024;
