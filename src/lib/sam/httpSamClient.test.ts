import { describe, it, expect, vi, afterEach } from "vitest";
import { createHttpSamClient, MAX_IMAGE_PIXELS_FOR_LOCAL_SERVER } from "./httpSamClient";

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

  // --- codex レビュー指摘（修正1〜3）対応テスト ---

  it("修正1: setImage で画像を差し替えると前回のセッションを破棄してから新しいセッションを作成する", async () => {
    const sessionIds = ["session-1", "session-2"];
    let createCallIndex = 0;
    const calls: string[] = [];
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      calls.push(`${init?.method ?? "GET"} ${href}`);
      if (href === `${BASE_URL}/sessions` && init?.method === "POST") {
        return jsonResponse({ sessionId: sessionIds[createCallIndex++] });
      }
      if (href === `${BASE_URL}/sessions/session-1` && init?.method === "DELETE") {
        return new Response(null, { status: 204 });
      }
      throw new Error(`unexpected fetch: ${href}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = createHttpSamClient(BASE_URL, MODEL_ID);
    await client.setImage({
      data: new Uint8ClampedArray([1, 2, 3, 4]),
      width: 1,
      height: 1,
    });
    await client.setImage({
      data: new Uint8ClampedArray([5, 6, 7, 8]),
      width: 1,
      height: 1,
    });

    expect(calls).toEqual([
      `POST ${BASE_URL}/sessions`,
      `DELETE ${BASE_URL}/sessions/session-1`,
      `POST ${BASE_URL}/sessions`,
    ]);
  });

  it("修正1: 初回 setImage ではセッション破棄を呼ばない（保持しているセッションが無いため）", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      if (href === `${BASE_URL}/sessions` && init?.method === "POST") {
        return jsonResponse({ sessionId: "session-first" });
      }
      throw new Error(`unexpected fetch: ${href}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = createHttpSamClient(BASE_URL, MODEL_ID);
    await client.setImage({
      data: new Uint8ClampedArray([1, 2, 3, 4]),
      width: 1,
      height: 1,
    });

    const deleteCalls = fetchMock.mock.calls.filter(
      (call) => (call[1] as RequestInit | undefined)?.method === "DELETE"
    );
    expect(deleteCalls).toHaveLength(0);
  });

  it("修正1: 前回セッションの破棄に失敗しても新しいセッション作成・以後の segmentAtPoints は続行する", async () => {
    let createCallIndex = 0;
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      if (href === `${BASE_URL}/sessions` && init?.method === "POST") {
        const id = createCallIndex === 0 ? "session-1" : "session-2";
        createCallIndex++;
        return jsonResponse({ sessionId: id });
      }
      if (href === `${BASE_URL}/sessions/session-1` && init?.method === "DELETE") {
        throw new TypeError("Failed to fetch");
      }
      if (href === `${BASE_URL}/sessions/session-2/segment` && init?.method === "POST") {
        return jsonResponse({ masks: [] });
      }
      throw new Error(`unexpected fetch: ${href}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = createHttpSamClient(BASE_URL, MODEL_ID);
    await client.setImage({
      data: new Uint8ClampedArray([1, 2, 3, 4]),
      width: 1,
      height: 1,
    });

    // 前回セッション（session-1）の DELETE が失敗しても reject しない
    await expect(
      client.setImage({
        data: new Uint8ClampedArray([5, 6, 7, 8]),
        width: 1,
        height: 1,
      })
    ).resolves.toBeUndefined();

    // 2回目の setImage が新しいセッション（session-2）まで到達したことを、
    // segmentAtPoints が session-2 宛に送られることで確認する。
    await client.segmentAtPoints([{ x: 1, y: 1, label: 1 }]);
    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE_URL}/sessions/session-2/segment`,
      expect.anything()
    );
  });

  it("修正2: baseUrl 末尾のスラッシュを正規化してリクエストする", async () => {
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

    const client = createHttpSamClient(`${BASE_URL}/`, MODEL_ID);
    await client.init();

    const calledUrls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(calledUrls).toContain(`${BASE_URL}/health`);
    expect(calledUrls).toContain(`${BASE_URL}/models`);
    expect(calledUrls.some((url) => url.includes("//health"))).toBe(false);
    expect(calledUrls.some((url) => url.includes("//models"))).toBe(false);
  });

  it("修正2: baseUrl に複数の末尾スラッシュがあっても正規化する", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href === `${BASE_URL}/health`) {
        return jsonResponse({ status: "ok" });
      }
      throw new Error(`unexpected fetch: ${href}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = createHttpSamClient(`${BASE_URL}///`, MODEL_ID);
    // init() は /models も呼ぶため到達しない可能性があるが、/health への正規化だけ確認できれば十分
    await client.init().catch(() => undefined);

    const calledUrls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(calledUrls[0]).toBe(`${BASE_URL}/health`);
  });

  it("修正3: 上限を超える画像は送信前にエラーになりリクエストが発生しない", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const client = createHttpSamClient(BASE_URL, MODEL_ID);
    // MAX_IMAGE_PIXELS_FOR_LOCAL_SERVER を超えるよう width/height を設定する
    // （実データは検証に使わないため小さい配列のままでよい）。
    const width = 4000;
    const height = 3000; // 12,000,000 px > MAX_IMAGE_PIXELS_FOR_LOCAL_SERVER (8,000,000)
    expect(width * height).toBeGreaterThan(MAX_IMAGE_PIXELS_FOR_LOCAL_SERVER);

    await expect(
      client.setImage({ data: new Uint8ClampedArray(4), width, height })
    ).rejects.toThrow(/大きすぎます/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("修正3: 上限以下の画像は通常通り送信できる", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      if (href === `${BASE_URL}/sessions` && init?.method === "POST") {
        return jsonResponse({ sessionId: "session-ok" });
      }
      throw new Error(`unexpected fetch: ${href}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = createHttpSamClient(BASE_URL, MODEL_ID);
    await expect(
      client.setImage({ data: new Uint8ClampedArray(4), width: 100, height: 100 })
    ).resolves.toBeUndefined();
  });
});
