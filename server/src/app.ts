import cors from "cors";
import express, { type Application, type NextFunction, type Request, type Response } from "express";
import { AVAILABLE_MODELS } from "./modelRegistry";
import { createSessionStore, SessionNotFoundError, type SessionStoreOptions } from "./sessionStore";
import {
  decodeImagePayload,
  decodeModelId,
  decodePointsPayload,
  encodeMasks,
  RequestValidationError,
} from "./wireFormat";
import { SamEmptyPointsError } from "../../src/lib/sam/samSession";
import type { SamRuntime } from "../../src/lib/sam/samSession";

/** SPA の開発オリジン。本番オリジンは runtime env で拡張できるようにする。 */
const DEFAULT_ALLOWED_ORIGINS = ["http://localhost:5173"];

/**
 * `wt dev`（git worktree ごとに `<worktree名>.<repo名>.wt.localhost:<port>` で
 * ローカル配信するツール。`~/.config/wt/wt serve`）経由でアクセスした場合の
 * オリジンパターン。開発機ではポートが起動のたびに変わりうるため、固定リストでは
 * 追従できず `SERVER_CORS_ORIGINS` の手動指定を毎回強いることになる。ホスト名の
 * サフィックスだけを検証する（他ホストへの誤許可を避けるため `wt.localhost` 固定）。
 */
const WT_DEV_ORIGIN_PATTERN = /^https?:\/\/[a-z0-9-]+\.[a-z0-9-]+\.wt\.localhost(:\d+)?$/;

function resolveAllowedOrigins(): string[] {
  const extra = process.env.SERVER_CORS_ORIGINS;
  if (!extra) {
    return DEFAULT_ALLOWED_ORIGINS;
  }
  return [...DEFAULT_ALLOWED_ORIGINS, ...extra.split(",").map((origin) => origin.trim())];
}

function isAllowedOrigin(origin: string, allowedOrigins: string[]): boolean {
  return allowedOrigins.includes(origin) || WT_DEV_ORIGIN_PATTERN.test(origin);
}

function asyncHandler(
  handler: (req: Request, res: Response) => Promise<void>
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    handler(req, res).catch(next);
  };
}

/**
 * 推論サーバーの Express アプリを組み立てる。`runtime` を DI することで、テストは
 * 実際の onnxruntime-node / モデルファイルを読まずに fake `SamRuntime` を注入できる
 * （issue #32 コメント「テストケース仕様」の mock/setup 制約）。
 *
 * `sessionStoreOptions` はセッション TTL・掃除間隔・時刻取得のDIポイント（`SessionStoreOptions`
 * 参照）。省略時は本番相当の既定値（TTL 30分、1分ごとにバックグラウンド掃除）で動く。
 *
 * `modelRuntimes`（省略可）は `modelId` ごとの `SamRuntime`（issue #33 コメント
 * 「複数モデル対応」）。`POST /sessions` で指定された `modelId` の検証・ルーティングに使う。
 * 省略時（既存呼び出し・テストとの後方互換）は `AVAILABLE_MODELS` の一覧を検証対象にしつつ、
 * 実際の推論には常に `runtime`（第一引数、既定モデル）を使う。
 */
export function createServerApp(
  runtime: SamRuntime,
  sessionStoreOptions: SessionStoreOptions = {},
  modelRuntimes?: Map<string, SamRuntime>
): Application {
  const app = express();
  const sessions = createSessionStore(runtime, sessionStoreOptions, modelRuntimes);
  const availableModelIds = modelRuntimes
    ? Array.from(modelRuntimes.keys())
    : AVAILABLE_MODELS.map((model) => model.id);

  const allowedOrigins = resolveAllowedOrigins();
  app.use(
    cors({
      origin(origin, callback) {
        // Origin ヘッダが無いリクエスト（curl 等、ブラウザ以外からの直接アクセス）は許可する
        // （元の `origin: string[]` 指定時と同じ挙動を維持）。
        if (!origin || isAllowedOrigin(origin, allowedOrigins)) {
          callback(null, true);
          return;
        }
        callback(null, false);
      },
    })
  );
  app.use(express.json({ limit: "50mb" }));

  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  app.get("/models", (_req, res) => {
    res.status(200).json(AVAILABLE_MODELS);
  });

  app.post(
    "/sessions",
    asyncHandler(async (req, res) => {
      const image = decodeImagePayload(req.body);
      // 未知の modelId をサイレントに既定モデルへフォールバックさせず、明示的に 400 にする
      // （codex レビュー指摘の核心: 選択したモデルと実際に推論に使われるモデルの不整合防止）。
      const modelId = decodeModelId(req.body, availableModelIds);
      const sessionId = await sessions.create(image, modelId);
      res.status(200).json({ sessionId });
    })
  );

  app.post(
    "/sessions/:id/segment",
    asyncHandler(async (req, res) => {
      const points = decodePointsPayload(req.body);
      const session = sessions.get(String(req.params.id));
      const masks = await session.segmentAtPoints(points);
      res.status(200).json({ masks: encodeMasks(masks) });
    })
  );

  app.delete(
    "/sessions/:id",
    asyncHandler(async (req, res) => {
      sessions.dispose(String(req.params.id));
      res.status(204).end();
    })
  );

  // Express はエラーハンドラミドルウェアを引数の個数（4個）で判定するため、
  // 使わない req/next も省略できない。
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof RequestValidationError || err instanceof SamEmptyPointsError) {
      res.status(400).json({ error: err.message });
      return;
    }
    if (err instanceof SessionNotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error("[server] unhandled error:", err);
    res.status(500).json({ error: message });
  });

  return app;
}
