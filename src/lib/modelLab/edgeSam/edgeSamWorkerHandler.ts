import { createEdgeSamSession, type EdgeSamSession } from "./session";
import type { EdgeSamRuntime } from "./onnxRuntime";
import type { EdgeSamWorkerRequest, EdgeSamWorkerResponse } from "./protocol";

export interface EdgeSamWorkerHandler {
  handle(request: EdgeSamWorkerRequest): Promise<EdgeSamWorkerResponse>;
}

/**
 * Worker 側のメッセージルーティング（`../mobileSam/mobileSamWorkerHandler.ts` と同型）。
 * セッションは初回リクエスト（setImage/segmentAtPoint いずれか）で遅延生成する
 * （EdgeSAM には明示的な `init` ステップが無い。device 検出（webgpu/wasm）が不要で
 * 常に wasm 実行のため）。
 */
export function createEdgeSamWorkerHandler(
  runtime: EdgeSamRuntime
): EdgeSamWorkerHandler {
  let sessionPromise: Promise<EdgeSamSession> | null = null;

  function requireSession(): Promise<EdgeSamSession> {
    if (!sessionPromise) {
      sessionPromise = createEdgeSamSession(runtime);
    }
    return sessionPromise;
  }

  async function handle(request: EdgeSamWorkerRequest): Promise<EdgeSamWorkerResponse> {
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
