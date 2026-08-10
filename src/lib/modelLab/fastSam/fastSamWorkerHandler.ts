import { createFastSamSession, type FastSamSession } from "./session";
import type { FastSamRuntime } from "./onnxRuntime";
import type { FastSamWorkerRequest, FastSamWorkerResponse } from "./protocol";

export interface FastSamWorkerHandler {
  handle(request: FastSamWorkerRequest): Promise<FastSamWorkerResponse>;
}

/**
 * Worker 側のメッセージルーティング（`../yolo11nSeg/yolo11nSegWorkerHandler.ts` と同型）。
 * セッションは初回リクエストで遅延生成する。
 */
export function createFastSamWorkerHandler(
  runtime: FastSamRuntime
): FastSamWorkerHandler {
  let sessionPromise: Promise<FastSamSession> | null = null;

  function requireSession(): Promise<FastSamSession> {
    if (!sessionPromise) {
      sessionPromise = createFastSamSession(runtime);
    }
    return sessionPromise;
  }

  async function handle(request: FastSamWorkerRequest): Promise<FastSamWorkerResponse> {
    try {
      switch (request.type) {
        case "detect": {
          const session = await requireSession();
          const detections = await session.detect(request.image);
          return { id: request.id, type: "result", payload: detections };
        }
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      return { id: request.id, type: "error", name: err.name, message: err.message };
    }
  }

  return { handle };
}
