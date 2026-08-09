/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * ローカル推論サーバー（`server/`）の既定接続先URL。
   * `wt dev` 環境で `web` service 起動時に注入される（`src/pages/SegmentPage.tsx` 参照）。
   * 未設定時は `SegmentPage.tsx` 側で固定既定ポート（8787）にフォールバックする。
   */
  readonly VITE_SERVER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
