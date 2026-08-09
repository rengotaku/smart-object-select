import cors from "cors";
import express, { type Application, type NextFunction, type Request, type Response } from "express";
import { AVAILABLE_MODELS } from "./modelRegistry";
import { createSessionStore, SessionNotFoundError, type SessionStoreOptions } from "./sessionStore";
import {
  decodeImagePayload,
  decodePointsPayload,
  encodeMasks,
  RequestValidationError,
} from "./wireFormat";
import { SamEmptyPointsError } from "../../src/lib/sam/samSession";
import type { SamRuntime } from "../../src/lib/sam/samSession";

/** SPA の開発オリジン。本番オリジンは runtime env で拡張できるようにする。 */
const DEFAULT_ALLOWED_ORIGINS = ["http://localhost:5173"];

function resolveAllowedOrigins(): string[] {
  const extra = process.env.SERVER_CORS_ORIGINS;
  if (!extra) {
    return DEFAULT_ALLOWED_ORIGINS;
  }
  return [...DEFAULT_ALLOWED_ORIGINS, ...extra.split(",").map((origin) => origin.trim())];
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
 */
export function createServerApp(
  runtime: SamRuntime,
  sessionStoreOptions: SessionStoreOptions = {}
): Application {
  const app = express();
  const sessions = createSessionStore(runtime, sessionStoreOptions);

  app.use(cors({ origin: resolveAllowedOrigins() }));
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
      const sessionId = await sessions.create(image);
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
    // eslint 等が無い server/ でも最低限のエラー可視性は確保する
    // eslint-disable-next-line no-console
    console.error("[server] unhandled error:", err);
    res.status(500).json({ error: message });
  });

  return app;
}
