/**
 * サーバーが提供できるモデルの一覧。フロント側 `src/lib/sam/constants.ts` の
 * `AVAILABLE_SAM_MODELS`（`public/models/<id>/` に自前ホスティング済みのモデル一覧、
 * issue #34）と二重管理しないよう統一する（issue #33 コメント「複数モデル対応」）。
 * `ModelDescriptor` という別名は既存のサーバー側コード（`app.ts` 等）との互換のために残す。
 */
export {
  AVAILABLE_SAM_MODELS as AVAILABLE_MODELS,
  type SamModelDescriptor as ModelDescriptor,
} from "../../src/lib/sam/constants";
