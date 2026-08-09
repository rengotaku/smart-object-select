/**
 * SAM 推論の実行方式。
 * - "browser": ブラウザ内蔵実行（Web Worker + `@huggingface/transformers`、既存パス）
 * - "local-server": PC ローカル推論サーバー（issue #32 の `server/`）に HTTP で処理させる
 *
 * `device.ts` の `SamDevice`（"webgpu" | "wasm"、ブラウザ内での実行デバイス）とは別軸の概念。
 * issue #33 コメント「設計方針の補足」参照。
 */
export type ExecutionMode = "browser" | "local-server";
