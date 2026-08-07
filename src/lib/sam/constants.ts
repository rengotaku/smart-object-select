/**
 * 自ホストしたモデルのローカル ID。`public/models/<SAM_MODEL_ID>/` を指す
 * （`env.localModelPath` と組み合わせて解決される。transformersLoader.ts 参照）。
 * 上流の Hugging Face Hub 上のモデルは `Xenova/slimsam-77-uniform`
 * （出典・ライセンスは public/models/slimsam-77-uniform/NOTICE を参照）。
 */
export const SAM_MODEL_ID = "slimsam-77-uniform";
