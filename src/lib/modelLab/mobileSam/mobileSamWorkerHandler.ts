import { createMobileSamSession, type MobileSamSession } from "./session";
import type { MobileSamRuntime } from "./onnxRuntime";
import type { MobileSamWorkerRequest, MobileSamWorkerResponse } from "./protocol";

export interface MobileSamWorkerHandler {
  handle(request: MobileSamWorkerRequest): Promise<MobileSamWorkerResponse>;
}

/**
 * Worker 側のメッセージルーティング（`src/lib/sam/samWorkerHandler.ts` と同型）。
 * セッションは初回リクエスト（setImage/segmentAtPoint いずれか）で遅延生成する
 * （既存 SAM 機能と異なり、MobileSAM には明示的な `init` ステップが無い。
 * device 検出（webgpu/wasm）が不要で常に wasm 実行のため）。
 */
export function createMobileSamWorkerHandler(
  runtime: MobileSamRuntime
): MobileSamWorkerHandler {
  let sessionPromise: Promise<MobileSamSession> | null = null;

  function requireSession(): Promise<MobileSamSession> {
    if (!sessionPromise) {
      sessionPromise = createMobileSamSession(runtime);
    }
    return sessionPromise;
  }

  async function handle(
    request: MobileSamWorkerRequest
  ): Promise<MobileSamWorkerResponse> {
    try {
      switch (request.type) {
        case "setImage": {
          const session = await requireSession();
          await session.setImage(request.image);
          return { id: request.id, type: "result", payload: undefined };
        }
        case "segmentAtPoint": {
          const session = await requireSession();
          const mask = await session.segmentAtPoint(request.x, request.y);
          return { id: request.id, type: "result", payload: mask };
        }
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      return { id: request.id, type: "error", name: err.name, message: err.message };
    }
  }

  return { handle };
}
