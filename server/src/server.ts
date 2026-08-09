import type { Application } from "express";
import { createServerApp } from "./app";
import { createNodeTransformersSamRuntime } from "./nodeTransformersLoader";

/**
 * ローカル推論専用サーバーのため、bind先はループバック（127.0.0.1）に固定する。
 * 環境変数での上書きは意図的に用意しない。ホストを省略する（= 全インターフェースで
 * 待ち受ける）と、共有LAN上の第三者が認証なしで画像アップロード・推論を叩けてしまい、
 * ARCHITECTURE.md の「オフライン・ローカル完結」という設計方針に反する（codex レビュー指摘）。
 */
export const LOOPBACK_HOST = "127.0.0.1";

export function resolvePort(): number {
  return Number(process.env.SERVER_PORT ?? 8787);
}

/** `app.listen` をループバック固定で呼び出す薄いラッパー。テストから DI したい部分のみ切り出す。 */
export function startServer(app: Application, port: number): ReturnType<Application["listen"]> {
  return app.listen(port, LOOPBACK_HOST, () => {
    console.log(
      `[server] smart-object-select inference server listening on http://${LOOPBACK_HOST}:${port}`
    );
  });
}

function isMainModule(): boolean {
  return typeof process.argv[1] === "string" && import.meta.url === `file://${process.argv[1]}`;
}

// `npm start`/`npm run dev`（tsx で直接実行）されたときのみ実サーバーを起動する。
// テストからの import では起動しない（startServer を fake app で直接検証する）。
if (isMainModule()) {
  const runtime = createNodeTransformersSamRuntime();
  const app = createServerApp(runtime);
  startServer(app, resolvePort());
}
