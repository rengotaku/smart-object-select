import type { SamImageInput } from "@/lib/sam";
import type { FastSamDetection } from "./types";
import type { FastSamWorkerRequest, FastSamWorkerResponse } from "./protocol";

type WorkerEventType = "message" | "error" | "messageerror";

export interface WorkerLike {
  postMessage(message: unknown): void;
  addEventListener(
    type: WorkerEventType,
    listener: (event: { data: unknown }) => void
  ): void;
  removeEventListener(
    type: WorkerEventType,
    listener: (event: { data: unknown }) => void
  ): void;
  terminate(): void;
}

export interface FastSamWorkerClient {
  detect(image: SamImageInput): Promise<FastSamDetection[]>;
  terminate(): void;
}

interface PendingRequest {
  resolve(payload: unknown): void;
  reject(error: unknown): void;
}

function createDefaultIdFactory(): () => string {
  let counter = 0;
  return () => `fast-sam-req-${counter++}`;
}

/**
 * メインスレッド側の Worker クライアント（`../yolo11nSeg/yolo11nSegWorkerClient.ts` と同型）。
 * onnxruntime-web を main thread から直接呼ぶと Vite dev server が動的 `import()` を
 * 拒否するため（`onnxRuntime.ts` コメント参照）、推論は必ず Web Worker
 * （`fastSam.worker.ts`）上で実行する。
 */
export function createFastSamWorkerClient(
  worker: WorkerLike,
  idFactory: () => string = createDefaultIdFactory()
): FastSamWorkerClient {
  const pending = new Map<string, PendingRequest>();

  function onMessage(event: { data: unknown }): void {
    const response = event.data as FastSamWorkerResponse;
    const request = pending.get(response.id);
    if (!request) {
      return;
    }
    pending.delete(response.id);

    if (response.type === "error") {
      const error = new Error(response.message);
      error.name = response.name;
      request.reject(error);
      return;
    }
    request.resolve(response.payload);
  }

  // Worker のモジュール読み込み失敗・モデル初期化中のクラッシュ等では "message" が
  // 一切発火せず "error"/"messageerror" だけが届く。これらを無視すると pending な
  // request が永久に解決されない（yolo11nSegWorkerClient.ts の同種コメント参照）。
  let terminalError: Error | null = null;

  function rejectAllPending(reason: string): void {
    terminalError = new Error(reason);
    const requests = Array.from(pending.values());
    pending.clear();
    for (const request of requests) {
      request.reject(terminalError);
    }
  }

  function onWorkerError(): void {
    rejectAllPending(
      "FastSAM worker emitted an error event (worker crashed or failed to load)"
    );
  }

  function onMessageError(): void {
    rejectAllPending(
      "FastSAM worker emitted a messageerror event (structured clone failure)"
    );
  }

  worker.addEventListener("message", onMessage);
  worker.addEventListener("error", onWorkerError);
  worker.addEventListener("messageerror", onMessageError);

  function send<T>(request: FastSamWorkerRequest): Promise<T> {
    if (terminalError) {
      return Promise.reject(terminalError);
    }
    return new Promise<T>((resolve, reject) => {
      pending.set(request.id, {
        resolve: resolve as (payload: unknown) => void,
        reject,
      });
      worker.postMessage(request);
    });
  }

  return {
    detect(image: SamImageInput): Promise<FastSamDetection[]> {
      return send<FastSamDetection[]>({ id: idFactory(), type: "detect", image });
    },
    terminate(): void {
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onWorkerError);
      worker.removeEventListener("messageerror", onMessageError);
      const error = new Error("FastSAM worker client was terminated");
      for (const request of pending.values()) {
        request.reject(error);
      }
      pending.clear();
      if (!terminalError) {
        terminalError = error;
      }
      worker.terminate();
    },
  };
}
