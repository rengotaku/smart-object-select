import { describe, it, expect, vi, afterEach } from "vitest";
import { createHttpSamClient } from "./httpSamClient";

const BASE_URL = "http://localhost:8787";
const MODEL_ID = "slimsam-77-uniform";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createHttpSamClient", () => {
  it("Case 1: init() がサーバー疎通確認とモデル一覧取得を行う", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href === `${BASE_URL}/health`) {
        return jsonResponse({ status: "ok" });
      }
      if (href === `${BASE_URL}/models`) {
        return jsonResponse([{ id: MODEL_ID, name: "SlimSAM 77 Uniform" }]);
      }
      throw new Error(`unexpected fetch: ${href}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = createHttpSamClient(BASE_URL, MODEL_ID);

    await expect(client.init()).resolves.toBeDefined();

    const calledUrls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(calledUrls).toContain(`${BASE_URL}/health`);
    expect(calledUrls).toContain(`${BASE_URL}/models`);
  });

  it("Case 2: setImage → segmentAtPoints の一連でセッションIDを内部管理する", async () => {
    const sessionId = "session-abc";
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      if (href === `${BASE_URL}/sessions` && init?.method === "POST") {
        return jsonResponse({ sessionId });
      }
      if (
        href === `${BASE_URL}/sessions/${sessionId}/segment` &&
        init?.method === "POST"
      ) {
        return jsonResponse({
          masks: [
            {
              data: btoa(String.fromCharCode(1, 0, 0, 1)),
              width: 2,
              height: 2,
              score: 0.9,
            },
          ],
        });
      }
      throw new Error(`unexpected fetch: ${href}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = createHttpSamClient(BASE_URL, MODEL_ID);
    await client.setImage({
      data: new Uint8ClampedArray([255, 0, 0, 255]),
      width: 1,
      height: 1,
    });

    const masks = await client.segmentAtPoints([{ x: 1, y: 1, label: 1 }]);

    const segmentCall = fetchMock.mock.calls.find(
      (call) => String(call[0]) === `${BASE_URL}/sessions/${sessionId}/segment`
    );
    expect(segmentCall).toBeDefined();
    expect(masks[0]).toMatchObject({ width: 2, height: 2, score: 0.9 });
    expect(Array.from(masks[0].data)).toEqual([1, 0, 0, 1]);
  });

  it("Case 3: setImage 前に segmentAtPoints を呼ぶとエラーになる", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("fetch should not be called before setImage()");
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = createHttpSamClient(BASE_URL, MODEL_ID);

    await expect(
      client.segmentAtPoints([{ x: 1, y: 1, label: 1 }])
    ).rejects.toMatchObject({
      name: "SamNoImageError",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Case 4: サーバー未起動・接続失敗時にエラーが分かりやすく返る", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = createHttpSamClient(BASE_URL, MODEL_ID);

    await expect(client.init()).rejects.toThrow(/接続できません/);
  });

  it("Case 5: terminate() でセッションを破棄する", async () => {
    const sessionId = "session-xyz";
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      if (href === `${BASE_URL}/sessions` && init?.method === "POST") {
        return jsonResponse({ sessionId });
      }
      if (href === `${BASE_URL}/sessions/${sessionId}` && init?.method === "DELETE") {
        return new Response(null, { status: 204 });
      }
      throw new Error(`unexpected fetch: ${href}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = createHttpSamClient(BASE_URL, MODEL_ID);
    await client.setImage({
      data: new Uint8ClampedArray([255, 0, 0, 255]),
      width: 1,
      height: 1,
    });

    client.terminate();

    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE_URL}/sessions/${sessionId}`,
      expect.objectContaining({ method: "DELETE" })
    );
  });

  it("追加: terminate() は setImage 未実行（セッション未保持）なら fetch を呼ばない", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const client = createHttpSamClient(BASE_URL, MODEL_ID);
    client.terminate();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("追加: onProgress は購読しても通知が発火しない no-op である", () => {
    vi.stubGlobal("fetch", vi.fn());
    const client = createHttpSamClient(BASE_URL, MODEL_ID);
    const listener = vi.fn();

    const unsubscribe = client.onProgress(listener);
    unsubscribe();

    expect(listener).not.toHaveBeenCalled();
  });

  it("追加: init() は選択したモデルがサーバーの一覧に無い場合エラーになる", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href === `${BASE_URL}/health`) {
        return jsonResponse({ status: "ok" });
      }
      if (href === `${BASE_URL}/models`) {
        return jsonResponse([{ id: "other-model", name: "Other" }]);
      }
      throw new Error(`unexpected fetch: ${href}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = createHttpSamClient(BASE_URL, MODEL_ID);

    await expect(client.init()).rejects.toThrow(/利用できません/);
  });

  it("追加: サーバーがエラー本文を返した場合はそのメッセージを使う", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ error: 'field "image" must be an object' }, 400)
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = createHttpSamClient(BASE_URL, MODEL_ID);

    await expect(
      client.setImage({ data: new Uint8ClampedArray([0, 0, 0, 0]), width: 1, height: 1 })
    ).rejects.toThrow(/field "image" must be an object/);
  });
});
