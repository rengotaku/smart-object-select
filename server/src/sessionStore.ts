import { randomUUID } from "node:crypto";
import { createSamSession, type SamRuntime, type SamSession } from "../../src/lib/sam/samSession";
import type { SamImageInput } from "../../src/lib/sam/types";

/**
 * `Map<sessionId, SamSession>` によるセッション管理（issue #32 コメント「設計変更」節の
 * 設計通り）。セッションごとに独立した `SamSession` インスタンスを保持するため、
 * 複数クライアントが同時に別画像を扱っても embedding が混同しない（Case 5）。
 *
 * セッションは最終アクセス時刻ベースの TTL で自動破棄する（codex レビュー指摘対応）。
 * クライアントが `DELETE` を送らずページを閉じた・通信断になった場合でも、embedding を
 * 保持したままの `SamSession` が `Map` に無期限に残りメモリを圧迫するのを防ぐ。
 */
export class SessionNotFoundError extends Error {
  constructor(sessionId: string) {
    super(`session not found: "${sessionId}"`);
    this.name = "SessionNotFoundError";
  }
}

/** アクセスが無いセッションを自動破棄するまでの既定時間（ミリ秒）。30分。 */
export const DEFAULT_SESSION_TTL_MS = 30 * 60 * 1000;
/** バックグラウンドで期限切れセッションを掃除する既定の実行間隔（ミリ秒）。1分ごと。 */
export const DEFAULT_SWEEP_INTERVAL_MS = 60 * 1000;

function resolvePositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

export interface SessionStoreOptions {
  /** セッション TTL（ミリ秒）。既定は環境変数 `SESSION_TTL_MS`、未設定なら30分。 */
  ttlMs?: number;
  /**
   * バックグラウンド掃除の実行間隔（ミリ秒）。0以下を指定すると `setInterval` を
   * 起動しない（テストでタイマーを残さないためのDIポイント。掃除は `get`/`create` の
   * 都度行う遅延評価と `sweepExpiredSessions()` の明示呼び出しで代替できる）。
   */
  sweepIntervalMs?: number;
  /** 現在時刻を返す関数。テストで時間経過を制御するためのDIポイント。既定は `Date.now`。 */
  now?: () => number;
}

interface SessionEntry {
  session: SamSession;
  lastAccessedAt: number;
}

export interface SessionStore {
  /** `createSamSession(runtime, device)` → `setImage(image)` → セッションIDを発行し保持する */
  create(image: SamImageInput): Promise<string>;
  get(sessionId: string): SamSession;
  dispose(sessionId: string): void;
  /**
   * TTL を過ぎたセッションを即座に `dispose()` して `Map` から取り除く。
   * 破棄したセッション数を返す。バックグラウンドタイマーからも同じ関数を呼ぶ。
   */
  sweepExpiredSessions(): number;
  /** バックグラウンド掃除タイマーを止める（プロセス終了・テストの後片付け用）。 */
  stopSweeping(): void;
}

export function createSessionStore(
  runtime: SamRuntime,
  options: SessionStoreOptions = {}
): SessionStore {
  const ttlMs = options.ttlMs ?? resolvePositiveIntEnv("SESSION_TTL_MS", DEFAULT_SESSION_TTL_MS);
  const sweepIntervalMs = options.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS;
  const now = options.now ?? (() => Date.now());

  const sessions = new Map<string, SessionEntry>();

  function isExpired(entry: SessionEntry): boolean {
    return now() - entry.lastAccessedAt >= ttlMs;
  }

  function sweepExpiredSessions(): number {
    let disposedCount = 0;
    for (const [sessionId, entry] of sessions) {
      if (isExpired(entry)) {
        entry.session.dispose();
        sessions.delete(sessionId);
        disposedCount += 1;
      }
    }
    return disposedCount;
  }

  let sweepTimer: ReturnType<typeof setInterval> | null = null;
  if (sweepIntervalMs > 0) {
    sweepTimer = setInterval(sweepExpiredSessions, sweepIntervalMs);
    // タイマーがプロセス終了・テストランナーの終了を妨げないようにする
    sweepTimer.unref?.();
  }

  return {
    async create(image) {
      // 期限切れセッションが溜まっていれば作成前にも掃除しておく（バックグラウンドタイマー
      // が無効化されているテスト等でも、アクセスの都度整合性を保てるようにする）。
      sweepExpiredSessions();

      // Node (onnxruntime-node) は wasm/webgpu を区別しないため device は無視される
      // 前提のダミー値（nodeTransformersLoader.ts 参照）。
      const session = await createSamSession(runtime, "wasm");
      await session.setImage(image);

      const sessionId = randomUUID();
      sessions.set(sessionId, { session, lastAccessedAt: now() });
      return sessionId;
    },
    get(sessionId) {
      const entry = sessions.get(sessionId);
      if (!entry) {
        throw new SessionNotFoundError(sessionId);
      }
      if (isExpired(entry)) {
        // TTL切れを検知した時点で遅延破棄する（バックグラウンドタイマーの実行を待たない）。
        entry.session.dispose();
        sessions.delete(sessionId);
        throw new SessionNotFoundError(sessionId);
      }
      entry.lastAccessedAt = now();
      return entry.session;
    },
    dispose(sessionId) {
      const entry = sessions.get(sessionId);
      if (!entry) {
        throw new SessionNotFoundError(sessionId);
      }
      entry.session.dispose();
      sessions.delete(sessionId);
    },
    sweepExpiredSessions,
    stopSweeping() {
      if (sweepTimer) {
        clearInterval(sweepTimer);
        sweepTimer = null;
      }
    },
  };
}
