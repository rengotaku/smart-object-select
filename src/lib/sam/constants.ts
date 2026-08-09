/**
 * 自ホストしたモデルのローカル ID。`public/models/<SAM_MODEL_ID>/` を指す
 * （`env.localModelPath` と組み合わせて解決される。transformersLoader.ts 参照）。
 * 上流の Hugging Face Hub 上のモデルは `Xenova/slimsam-77-uniform`
 * （出典・ライセンスは public/models/slimsam-77-uniform/NOTICE を参照）。
 * 実際に使用するモデルの選択（サーバー側 `/models` API・フロント UI）は別 issue
 * （#32 / #33）のスコープのため、既定値としてこの定数は変更していない。
 */
export const SAM_MODEL_ID = "slimsam-77-uniform";

/** `public/models/<id>/` を指す、自前ホスティング済みで選択可能な SAM モデルの記述子。 */
export interface SamModelDescriptor {
  id: string;
  name: string;
}

/**
 * 自前ホスティング済み（`public/models/<id>/`）で選択可能な SAM モデルの一覧。
 * 速度/精度の異なるバリエーションを列挙する（issue #34）。実際にどのモデルを
 * ロードするかの選択 UI・API 配線は #32（サーバー `/models` API）・#33（フロント UI）
 * のスコープのため、ここでは一覧の定義のみを追加する。
 */
export const AVAILABLE_SAM_MODELS: SamModelDescriptor[] = [
  { id: "slimsam-77-uniform", name: "SlimSAM 77 Uniform (fast)" },
  { id: "slimsam-50-uniform", name: "SlimSAM 50 Uniform (accurate)" },
];
