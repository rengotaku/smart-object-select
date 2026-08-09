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
 * - `setImage()`: `POST /sessions` でセッションを作成し `sessionId` を内部に保持する
 * - `segment()`/`segmentAtPoints()`: `POST /sessions/:id/segment`
 * - `terminate()`: `DELETE /sessions/:id`（セッションを保持していれば、ベストエフォート）
 * - `onProgress()`: サーバー方式では進捗通知が無いため no-op
 */
export function createHttpSamClient(baseUrl: string, modelId: string): SamWorkerClient {
  let sessionId: string | null = null;

  async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${baseUrl}${path}`, init);
    } catch {
      throw new Error(
        `ローカル推論サーバー（${baseUrl}）に接続できません。サーバーが起動しているか確認するか、` +
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
      const response = await requestJson<SessionCreateResponse>("/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image: {
            data: bytesToBase64(image.data),
            width: image.width,
            height: image.height,
          },
        }),
      });
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
      if (!sessionId) {
        return;
      }
      const idToDispose = sessionId;
      sessionId = null;
      // terminate() は同期 API のためレスポンスを待たない（ベストエフォート）。
      void fetch(`${baseUrl}/sessions/${idToDispose}`, { method: "DELETE" }).catch(
        () => {}
      );
    },
  };
}
