import { describe, expect, it } from "vitest";
import { createSessionStore, SessionNotFoundError } from "../src/sessionStore";
import { createFakeSamRuntime } from "./helpers/fakeSamRuntime";

// 検知/理由: codex レビュー指摘（未削除セッションが Map に無期限に残りメモリを圧迫する）
// への対応で追加した TTL 機構をユニットレベルでも直接検証する。HTTP 経由の
// app.test.ts のケースと相補的に、`sweepExpiredSessions()` の戻り値（破棄件数）や
// Map からの削除まで踏み込んで確認する。
describe("createSessionStore TTL / sweepExpiredSessions", () => {
  const testImage = { data: new Uint8ClampedArray(16), width: 2, height: 2 };

  it("追加: sweepExpiredSessionsはTTLを過ぎたセッションをdisposeしMapから削除する", async () => {
    const { runtime } = createFakeSamRuntime();
    let currentTime = 0;
    const store = createSessionStore(runtime, {
      ttlMs: 1000,
      sweepIntervalMs: 0,
      now: () => currentTime,
    });

    const sessionId = await store.create(testImage);
    expect(store.get(sessionId)).toBeDefined();

    currentTime += 2000;
    const disposedCount = store.sweepExpiredSessions();

    expect(disposedCount).toBe(1);
    expect(() => store.get(sessionId)).toThrow(SessionNotFoundError);
  });

  it("追加: TTL内のセッションはsweepExpiredSessionsで破棄されない", async () => {
    const { runtime } = createFakeSamRuntime();
    let currentTime = 0;
    const store = createSessionStore(runtime, {
      ttlMs: 1000,
      sweepIntervalMs: 0,
      now: () => currentTime,
    });

    await store.create(testImage);

    currentTime += 500;
    const disposedCount = store.sweepExpiredSessions();

    expect(disposedCount).toBe(0);
  });

  it("追加: getによるアクセスはlastAccessedAtを更新しTTLを延命する", async () => {
    const { runtime } = createFakeSamRuntime();
    let currentTime = 0;
    const store = createSessionStore(runtime, {
      ttlMs: 1000,
      sweepIntervalMs: 0,
      now: () => currentTime,
    });

    const sessionId = await store.create(testImage);

    currentTime += 900;
    store.get(sessionId); // アクセスで延命される

    currentTime += 900; // 作成からは1800ms経過だが直近アクセスからは900ms
    expect(() => store.get(sessionId)).not.toThrow();
  });

  it("追加: stopSweepingを呼んでもTTL遅延評価（get時のチェック）は引き続き機能する", async () => {
    const { runtime } = createFakeSamRuntime();
    let currentTime = 0;
    const store = createSessionStore(runtime, {
      ttlMs: 1000,
      sweepIntervalMs: 0,
      now: () => currentTime,
    });
    store.stopSweeping();

    const sessionId = await store.create(testImage);
    currentTime += 2000;

    expect(() => store.get(sessionId)).toThrow(SessionNotFoundError);
  });
});
