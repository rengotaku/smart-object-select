import { describe, expect, it } from "vitest";
import request from "supertest";
import { createServerApp } from "../src/app";
import { createFakeSamRuntime, makeTestImageBase64 } from "./helpers/fakeSamRuntime";

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
