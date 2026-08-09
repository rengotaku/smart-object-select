import type { SamModelDescriptor } from "./constants";
import type { SamDevice } from "./device";
import { SamNoImageError } from "./samSession";
import type { SamWorkerClient } from "./samWorkerClient";
import type { SamImageInput, SamMaskResult, SegmentPoint } from "./types";

/**
 * `GET /models` のレスポンス1件は `server/src/modelRegistry.ts` の `ModelDescriptor` と
 * 対応する。`server/` には依存できないが、フロント側の `constants.ts` が定義している
 * `SamModelDescriptor`（id/name）と同形のワイヤーフォーマットのため、独自定義せず再利用する
 * （issue #34 で `constants.ts` に追加された型。#33 実装時点では未反映だったため重複定義に
 * なっていたのを rebase 後に統合した）。
 */

interface HealthResponse {
  status: string;
}

interface SessionCreateResponse {
  sessionId: string;
}

interface WireMaskResult {
  data: string; // base64 encoded Uint8Array (0/1 per pixel)
  width: number;
  height: number;
  score: number;
}

interface SegmentResponse {
  masks: WireMaskResult[];
}

/** 大きな画像でも `String.fromCharCode` のスタックオーバーフローを避けるためのチャンクサイズ。 */
const BASE64_CHUNK_SIZE = 0x8000;

/**
 * ローカル推論サーバー（`server/`）へ送信できる画像の上限（ピクセル数）。
 * サーバー側の JSON ボディ上限（50MB、`server/src/app.ts` の `express.json({ limit: "50mb" })`）
 * から逆算した安全マージン込みの値。RGBA（4 bytes/px）を base64 化すると約 4/3 倍になるため、
 * 8,000,000 px の画像でも base64 後は約 40MB程度に収まる（codex レビュー指摘対応）。
 */
export const MAX_IMAGE_PIXELS_FOR_LOCAL_SERVER = 8_000_000;

function bytesToBase64(bytes: Uint8ClampedArray | Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK_SIZE) {
    const chunk = bytes.subarray(offset, offset + BASE64_CHUNK_SIZE);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function decodeMask(mask: WireMaskResult): SamMaskResult {
  return {
    data: base64ToUint8Array(mask.data),
    width: mask.width,
    height: mask.height,
    score: mask.score,
  };
}

/**
 * ローカル推論サーバー（issue #32、`server/`）を HTTP 経由で呼び出す `SamWorkerClient` 実装。
 *
 * 推論そのものはサーバー側で行われるため Web Worker を経由しない。issue #33 コメント
 * 「設計方針の補足」の対応表通りに各メソッドを実装している:
 * - `init()`: `GET /health` → `GET /models`（疎通確認とモデル一覧取得。戻り値の `SamDevice` は
 *   local-server 方式では意味を持たないプレースホルダで、呼び出し側（`useSamEngine`/
 *   `SegmentPage`）は `executionMode` で分岐しこの値を表示には使わない）
 * - `setImage()`: `POST /sessions` に `modelId` を含めてセッションを作成し `sessionId` を
 *   内部に保持する（サーバー側は指定された `modelId` に対応する `SamRuntime` で推論する。
 *   codex レビュー指摘対応: 選択したモデルが実際に使われることをサーバー側と揃えて保証する）
 * - `segment()`/`segmentAtPoints()`: `POST /sessions/:id/segment`
 * - `terminate()`: `DELETE /sessions/:id`（セッションを保持していれば、ベストエフォート）
 * - `onProgress()`: サーバー方式では進捗通知が無いため no-op
 */
/**
 * サーバーURL末尾のスラッシュ（複数連続含む）を除去する。除去しないと `${baseUrl}${path}`
 * が `//health` のようになり Express のルートと一致せず接続に失敗する
 * （codex レビュー指摘対応）。`createHttpSamClient` 内部だけでなく、クライアント生成前に
 * モデル一覧を取得する `SegmentPage.tsx` 側の fetch でも同じ正規化が必要なため export する。
 */
export function normalizeServerBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

export function createHttpSamClient(baseUrl: string, modelId: string): SamWorkerClient {
  const normalizedBaseUrl = normalizeServerBaseUrl(baseUrl);
  let sessionId: string | null = null;
  // setImage() の並行呼び出しを世代で判別する（samSession.ts の generation ガードと同じ
  // 考え方）。POST /sessions のレスポンス到達順がリクエスト順と一致するとは限らないため、
  // 「自分より新しい setImage() が既に呼ばれているか」を見て古いレスポンスの sessionId
  // 上書きを防ぐ（codex レビュー指摘対応: 並行 setImage の完了順でセッションを上書きしない）。
  let generation = 0;

  /**
   * DELETE はレスポンスボディを持たない（204 No Content）ため、`response.json()` を呼ぶ
   * `requestJson` は使わずベストエフォートで直接 fetch する。失敗しても呼び出し元の処理
   * （新規セッション作成・terminate）は継続する。
   */
  function disposeSession(id: string): Promise<void> {
    return fetch(`${normalizedBaseUrl}/sessions/${id}`, { method: "DELETE" })
      .then(() => undefined)
      .catch(() => undefined);
  }

  async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${normalizedBaseUrl}${path}`, init);
    } catch {
      throw new Error(
        `ローカル推論サーバー（${normalizedBaseUrl}）に接続できません。サーバーが起動しているか確認するか、` +
          "ブラウザ内蔵の実行方式に切り替えてください。"
      );
    }

    if (!response.ok) {
      let message = `ローカル推論サーバーがエラーを返しました（HTTP ${response.status}）`;
      try {
        const body = (await response.json()) as { error?: string };
        if (body?.error) {
          message = body.error;
        }
      } catch {
        // レスポンスボディが JSON でない場合は既定メッセージのまま扱う
      }
      throw new Error(message);
    }

    return (await response.json()) as T;
  }

  async function doSegment(points: SegmentPoint[]): Promise<SamMaskResult[]> {
    if (!sessionId) {
      throw new SamNoImageError();
    }
    const result = await requestJson<SegmentResponse>(`/sessions/${sessionId}/segment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ points }),
    });
    return result.masks.map(decodeMask);
  }

  return {
    async init(): Promise<SamDevice> {
      await requestJson<HealthResponse>("/health");
      const models = await requestJson<SamModelDescriptor[]>("/models");
      if (!models.some((model) => model.id === modelId)) {
        throw new Error(
          `選択したモデル「${modelId}」はローカル推論サーバーで利用できません。` +
            "利用可能なモデルを選び直してください。"
        );
      }
      // ローカルサーバー方式には SamDevice（webgpu/wasm）相当の概念が無い。
      // 呼び出し側は executionMode で分岐しこの戻り値を表示に使わないため、
      // SamWorkerClient["init"] の型を満たすためのプレースホルダとして返す。
      return "wasm";
    },

    async setImage(image: SamImageInput): Promise<void> {
      const pixelCount = image.width * image.height;
      if (pixelCount > MAX_IMAGE_PIXELS_FOR_LOCAL_SERVER) {
        const limitMp = (MAX_IMAGE_PIXELS_FOR_LOCAL_SERVER / 1_000_000).toFixed(0);
        const actualMp = (pixelCount / 1_000_000).toFixed(1);
        throw new Error(
          `画像が大きすぎます。PCローカルサーバー方式では現在${limitMp}メガピクセル以下の` +
            `画像のみ対応しています（選択した画像: 約${actualMp}メガピクセル）。`
        );
      }

      const myGeneration = ++generation;

      // 別画像に切り替える際は、サーバー上に前回の embedding を残さないよう先に破棄する
      // （codex レビュー指摘対応: 破棄せずに作り続けると TTL まで蓄積しメモリを圧迫する）。
      if (sessionId) {
        const previousSessionId = sessionId;
        sessionId = null;
        await disposeSession(previousSessionId);
      }

      const response = await requestJson<SessionCreateResponse>("/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image: {
            data: bytesToBase64(image.data),
            width: image.width,
            height: image.height,
          },
          modelId,
        }),
      });

      if (myGeneration !== generation) {
        // 自分より新しい setImage() が既に呼ばれた後にこのレスポンスが届いた（並行呼び出し
        // で応答順がリクエスト順と一致しなかった）。内部状態は上書きせず、サーバー上に
        // 作られてしまったこのセッションだけベストエフォートで破棄する。
        void disposeSession(response.sessionId);
        return;
      }

      sessionId = response.sessionId;
    },

    segment(x: number, y: number): Promise<SamMaskResult[]> {
      return doSegment([{ x, y, label: 1 }]);
    },

    segmentAtPoints(points: SegmentPoint[]): Promise<SamMaskResult[]> {
      return doSegment(points);
    },

    onProgress(): () => void {
      // サーバー方式では進捗通知が存在しないため no-op（購読しても何も発火しない）。
      return () => {};
    },

    terminate(): void {
      // setImage() が POST /sessions の応答待ちの間に terminate() が呼ばれると、
      // 当時は sessionId がまだ null なのでここでは何もできない。generation を進めて
      // おくことで、後から届く setImage() のレスポンスを stale として検知させ、
      // サーバー上に作られたセッションを破棄させる（codex レビュー指摘対応）。
      generation += 1;

      if (!sessionId) {
        return;
      }
      const idToDispose = sessionId;
      sessionId = null;
      // terminate() は同期 API のためレスポンスを待たない（ベストエフォート）。
      void disposeSession(idToDispose);
    },
  };
}
