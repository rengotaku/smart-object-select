import { describe, expect, it } from "vitest";
import request from "supertest";
import { createServerApp } from "../src/app";
import {
  createFakeSamRuntime,
  createFixedScoreSamRuntime,
  makeTestImageBase64,
} from "./helpers/fakeSamRuntime";

describe("createServerApp", () => {
  it("Case 6: GET /health が200を返す", async () => {
    const { runtime } = createFakeSamRuntime();
    const app = createServerApp(runtime);

    const res = await request(app).get("/health");

    expect(res.status).toBe(200);
  });

  it("Case 7: GET /models が利用可能モデル一覧を返す", async () => {
    const { runtime } = createFakeSamRuntime();
    const app = createServerApp(runtime);

    const res = await request(app).get("/models");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.some((m: { id: string }) => m.id === "slimsam-77-uniform")).toBe(true);
  });

  it("Case 1: セッション作成で embedding が計算されメモリに保持される", async () => {
    const { runtime, getImageEmbeddings } = createFakeSamRuntime();
    const app = createServerApp(runtime);

    const res = await request(app)
      .post("/sessions")
      .send({ image: { data: makeTestImageBase64(2, 2), width: 2, height: 2 } });

    expect(res.status).toBe(200);
    expect(res.body.sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
    expect(getImageEmbeddings).toHaveBeenCalledTimes(1);
  });

  it("Case 2: 作成したセッションで segment を呼ぶとマスク結果が返る", async () => {
    const { runtime } = createFakeSamRuntime();
    const app = createServerApp(runtime);

    const createRes = await request(app)
      .post("/sessions")
      .send({ image: { data: makeTestImageBase64(2, 2), width: 2, height: 2 } });
    const sessionId = createRes.body.sessionId as string;

    const segmentRes = await request(app)
      .post(`/sessions/${sessionId}/segment`)
      .send({ points: [{ x: 1, y: 1, label: 1 }] });

    expect(segmentRes.status).toBe(200);
    expect(Array.isArray(segmentRes.body.masks)).toBe(true);
    expect(segmentRes.body.masks.length).toBeGreaterThan(0);
    const mask = segmentRes.body.masks[0];
    expect(typeof mask.data).toBe("string");
    expect(typeof mask.width).toBe("number");
    expect(typeof mask.height).toBe("number");
    expect(typeof mask.score).toBe("number");
  });

  it("Case 3: 存在しないセッションIDでsegmentを呼ぶと404", async () => {
    const { runtime } = createFakeSamRuntime();
    const app = createServerApp(runtime);

    const res = await request(app)
      .post("/sessions/nonexistent-id/segment")
      .send({ points: [{ x: 1, y: 1, label: 1 }] });

    expect(res.status).toBe(404);
    expect(res.body.error).toContain("nonexistent-id");
  });

  it("Case 4: セッション削除後にsegmentを呼ぶと404", async () => {
    const { runtime } = createFakeSamRuntime();
    const app = createServerApp(runtime);

    const createRes = await request(app)
      .post("/sessions")
      .send({ image: { data: makeTestImageBase64(2, 2), width: 2, height: 2 } });
    const sessionId = createRes.body.sessionId as string;

    const deleteRes = await request(app).delete(`/sessions/${sessionId}`);
    expect(deleteRes.status).toBe(204);

    const segmentRes = await request(app)
      .post(`/sessions/${sessionId}/segment`)
      .send({ points: [{ x: 1, y: 1, label: 1 }] });

    expect(segmentRes.status).toBe(404);
  });

  it("Case 5: 複数セッションが独立して動作する（画像の混同を検知する重要ケース）", async () => {
    const { runtime } = createFakeSamRuntime();
    const app = createServerApp(runtime);

    const sessionARes = await request(app)
      .post("/sessions")
      .send({ image: { data: makeTestImageBase64(2, 2), width: 2, height: 2 } });
    const sessionBRes = await request(app)
      .post("/sessions")
      .send({ image: { data: makeTestImageBase64(3, 3), width: 3, height: 3 } });
    const sessionIdA = sessionARes.body.sessionId as string;
    const sessionIdB = sessionBRes.body.sessionId as string;

    const segmentA = await request(app)
      .post(`/sessions/${sessionIdA}/segment`)
      .send({ points: [{ x: 1, y: 1, label: 1 }] });
    const segmentB = await request(app)
      .post(`/sessions/${sessionIdB}/segment`)
      .send({ points: [{ x: 1, y: 1, label: 1 }] });

    // fake runtime は画像サイズ（tag）ごとに異なる score を返すため、
    // セッションAの結果とセッションBの結果が混同されていないことを score の差分で検証する。
    expect(segmentA.body.masks[0].score).not.toBe(segmentB.body.masks[0].score);

    // 順序を変えて再度呼んでも各セッションは自分自身の embedding に基づいた結果を返し続ける
    // （単一グローバル状態を使い回すバグがあれば、後勝ちの画像の結果に収束してしまう）。
    const segmentAAgain = await request(app)
      .post(`/sessions/${sessionIdA}/segment`)
      .send({ points: [{ x: 1, y: 1, label: 1 }] });
    expect(segmentAAgain.body.masks[0].score).toBe(segmentA.body.masks[0].score);
  });
});

describe("createServerApp（codex レビュー指摘対応: セッション TTL 自動破棄）", () => {
  // 検知/理由: クライアントが DELETE を送らずページを閉じる・通信断になるケースで
  // セッションが Map に無期限に残りメモリを圧迫するのを防ぐ TTL 機構（issue #32 codexレビュー指摘）。
  // `createServerApp` の `sessionStoreOptions` 経由で `now`/`sessionTtlMs` をDIし、
  // 実時間の経過を待たずに決定的に検証する。
  it("追加: TTLを過ぎて未アクセスのセッションはsegment呼び出し時に自動破棄され404になる", async () => {
    const { runtime } = createFakeSamRuntime();
    let currentTime = 0;
    const app = createServerApp(runtime, {
      ttlMs: 1000,
      sweepIntervalMs: 0, // バックグラウンドタイマーに頼らず、遅延評価（get時のTTLチェック）で検証する
      now: () => currentTime,
    });

    const createRes = await request(app)
      .post("/sessions")
      .send({ image: { data: makeTestImageBase64(2, 2), width: 2, height: 2 } });
    const sessionId = createRes.body.sessionId as string;

    currentTime += 2000; // TTL(1000ms)を超えて経過させる

    const segmentRes = await request(app)
      .post(`/sessions/${sessionId}/segment`)
      .send({ points: [{ x: 1, y: 1, label: 1 }] });

    expect(segmentRes.status).toBe(404);
  });

  it("追加: TTL内にsegmentでアクセスしたセッションは延命し404にならない", async () => {
    const { runtime } = createFakeSamRuntime();
    let currentTime = 0;
    const app = createServerApp(runtime, {
      ttlMs: 1000,
      sweepIntervalMs: 0,
      now: () => currentTime,
    });

    const createRes = await request(app)
      .post("/sessions")
      .send({ image: { data: makeTestImageBase64(2, 2), width: 2, height: 2 } });
    const sessionId = createRes.body.sessionId as string;

    currentTime += 900; // TTL未満でアクセス → lastAccessedAt が更新される
    const firstSegment = await request(app)
      .post(`/sessions/${sessionId}/segment`)
      .send({ points: [{ x: 1, y: 1, label: 1 }] });
    expect(firstSegment.status).toBe(200);

    currentTime += 900; // 作成からは1800ms経過だが直近アクセスからは900ms（TTL未満）
    const secondSegment = await request(app)
      .post(`/sessions/${sessionId}/segment`)
      .send({ points: [{ x: 1, y: 1, label: 1 }] });
    expect(secondSegment.status).toBe(200);
  });
});

describe("createServerApp（codex レビュー指摘対応: RGBAデータ長・画像寸法のバリデーション）", () => {
  it("追加: width/heightがゼロ・負数・小数だと400を返す", async () => {
    const { runtime } = createFakeSamRuntime();
    const app = createServerApp(runtime);

    const zero = await request(app)
      .post("/sessions")
      .send({ image: { data: makeTestImageBase64(2, 2), width: 0, height: 2 } });
    expect(zero.status).toBe(400);

    const negative = await request(app)
      .post("/sessions")
      .send({ image: { data: makeTestImageBase64(2, 2), width: -2, height: 2 } });
    expect(negative.status).toBe(400);

    const fractional = await request(app)
      .post("/sessions")
      .send({ image: { data: makeTestImageBase64(2, 2), width: 2.5, height: 2 } });
    expect(fractional.status).toBe(400);
  });

  it("追加: width/heightが許容上限を超えると400を返す", async () => {
    const { runtime } = createFakeSamRuntime();
    const app = createServerApp(runtime);

    const res = await request(app)
      .post("/sessions")
      .send({ image: { data: makeTestImageBase64(2, 2), width: 8193, height: 2 } });

    expect(res.status).toBe(400);
  });

  it("追加: base64復号後のデータ長がwidth*height*4と一致しないと400を返す", async () => {
    const { runtime } = createFakeSamRuntime();
    const app = createServerApp(runtime);

    // 2x2のRGBAなら16バイト必要だが、1x1分（4バイト）しか送らない
    const res = await request(app)
      .post("/sessions")
      .send({ image: { data: makeTestImageBase64(1, 1), width: 2, height: 2 } });

    expect(res.status).toBe(400);
  });
});

describe("createServerApp（codex レビュー指摘対応: 複数モデル対応 / modelId ルーティング）", () => {
  it("追加: modelId を指定すると対応する SamRuntime で推論される（既定モデルにフォールバックしない）", async () => {
    const defaultRuntime = createFixedScoreSamRuntime(0.11);
    const otherRuntime = createFixedScoreSamRuntime(0.99);
    const modelRuntimes = new Map([
      ["default-model", defaultRuntime],
      ["other-model", otherRuntime],
    ]);
    const app = createServerApp(defaultRuntime, {}, modelRuntimes);

    const createRes = await request(app)
      .post("/sessions")
      .send({
        image: { data: makeTestImageBase64(2, 2), width: 2, height: 2 },
        modelId: "other-model",
      });
    expect(createRes.status).toBe(200);
    const sessionId = createRes.body.sessionId as string;

    const segmentRes = await request(app)
      .post(`/sessions/${sessionId}/segment`)
      .send({ points: [{ x: 1, y: 1, label: 1 }] });

    expect(segmentRes.status).toBe(200);
    expect(segmentRes.body.masks[0].score).toBe(0.99);
  });

  it("追加: modelId を省略すると既定の runtime（第一引数）が使われる", async () => {
    const defaultRuntime = createFixedScoreSamRuntime(0.11);
    const otherRuntime = createFixedScoreSamRuntime(0.99);
    const modelRuntimes = new Map([
      ["default-model", defaultRuntime],
      ["other-model", otherRuntime],
    ]);
    const app = createServerApp(defaultRuntime, {}, modelRuntimes);

    const createRes = await request(app)
      .post("/sessions")
      .send({ image: { data: makeTestImageBase64(2, 2), width: 2, height: 2 } });
    expect(createRes.status).toBe(200);
    const sessionId = createRes.body.sessionId as string;

    const segmentRes = await request(app)
      .post(`/sessions/${sessionId}/segment`)
      .send({ points: [{ x: 1, y: 1, label: 1 }] });

    expect(segmentRes.status).toBe(200);
    expect(segmentRes.body.masks[0].score).toBe(0.11);
  });

  it("追加: 未知の modelId を指定すると400を返し、サイレントに既定モデルへフォールバックしない", async () => {
    const defaultRuntime = createFixedScoreSamRuntime(0.11);
    const modelRuntimes = new Map([["default-model", defaultRuntime]]);
    const app = createServerApp(defaultRuntime, {}, modelRuntimes);

    const res = await request(app)
      .post("/sessions")
      .send({
        image: { data: makeTestImageBase64(2, 2), width: 2, height: 2 },
        modelId: "totally-unknown-model",
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("totally-unknown-model");
  });

  it("追加: modelId が文字列でない場合400を返す", async () => {
    const { runtime } = createFakeSamRuntime();
    const app = createServerApp(runtime);

    const res = await request(app)
      .post("/sessions")
      .send({
        image: { data: makeTestImageBase64(2, 2), width: 2, height: 2 },
        modelId: 12345,
      });

    expect(res.status).toBe(400);
  });

  it("追加: modelRuntimes を渡さない（後方互換の単一runtime構成）場合、静的なモデル一覧に含まれる modelId は受理される", async () => {
    const { runtime } = createFakeSamRuntime();
    const app = createServerApp(runtime);

    // AVAILABLE_MODELS（AVAILABLE_SAM_MODELS）に実在するモデルIDを指定する。
    const res = await request(app)
      .post("/sessions")
      .send({
        image: { data: makeTestImageBase64(2, 2), width: 2, height: 2 },
        modelId: "slimsam-77-uniform",
      });

    expect(res.status).toBe(200);
  });
});
