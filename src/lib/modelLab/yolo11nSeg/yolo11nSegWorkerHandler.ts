import { createYolo11nSegSession, type Yolo11nSegSession } from "./session";
import type { Yolo11nSegRuntime } from "./onnxRuntime";
import type { Yolo11nSegWorkerRequest, Yolo11nSegWorkerResponse } from "./protocol";

export interface Yolo11nSegWorkerHandler {
  handle(request: Yolo11nSegWorkerRequest): Promise<Yolo11nSegWorkerResponse>;
}

/**
 * Worker 側のメッセージルーティング（`../mobileSam/mobileSamWorkerHandler.ts` と同型）。
 * セッションは初回リクエストで遅延生成する。
 */
export function createYolo11nSegWorkerHandler(
  runtime: Yolo11nSegRuntime
): Yolo11nSegWorkerHandler {
  let sessionPromise: Promise<Yolo11nSegSession> | null = null;

  function requireSession(): Promise<Yolo11nSegSession> {
    if (!sessionPromise) {
      sessionPromise = createYolo11nSegSession(runtime);
    }
    return sessionPromise;
  }

  async function handle(
    request: Yolo11nSegWorkerRequest
  ): Promise<Yolo11nSegWorkerResponse> {
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
