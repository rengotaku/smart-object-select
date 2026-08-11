import type { SamImageInput } from "@/lib/types";
import type { MobileSamMaskResult } from "./types";
import type { MobileSamWorkerRequest, MobileSamWorkerResponse } from "./protocol";

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

export interface MobileSamWorkerClient {
  setImage(image: SamImageInput): Promise<void>;
  segmentAtPoint(x: number, y: number): Promise<MobileSamMaskResult>;
  terminate(): void;
}

interface PendingRequest {
  resolve(payload: unknown): void;
  reject(error: unknown): void;
}

function createDefaultIdFactory(): () => string {
  let counter = 0;
  return () => `mobile-sam-req-${counter++}`;
}

/**
 * メインスレッド側の Worker クライアント（`src/lib/sam/samWorkerClient.ts` と同型）。
 *
 * onnxruntime-web を main thread から直接呼ぶと、Vite dev server が
 * `ort.env.wasm.wasmPaths.mjs`（`public/onnxruntime/` 配下の自ホストファイル）への
 * 動的 `import()` を「public 配下のファイルは JS から import できない」として拒否する
 * （実機確認で再現。Vite の `checkPublicFile` ガード）。既存の SAM 機能
 * （`useSamEngine`/`sam.worker.ts`）は同じ onnxruntime-web を Web Worker 内から使っており、
 * そちらは `.mjs` を `import()` ではなく `fetch()` で取得する別コードパスを通るため
 * この問題が起きない（実機のネットワークログで確認済み）。MobileSAM も同様に
 * Web Worker（`mobileSam.worker.ts`）上で onnxruntime-web を実行することでこれを回避する。
 */
export function createMobileSamWorkerClient(
  worker: WorkerLike,
  idFactory: () => string = createDefaultIdFactory()
): MobileSamWorkerClient {
  const pending = new Map<string, PendingRequest>();

  function onMessage(event: { data: unknown }): void {
    const response = event.data as MobileSamWorkerResponse;
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
  // request が永久に解決されない（samWorkerClient.ts の同種コメント参照）。
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
      "MobileSAM worker emitted an error event (worker crashed or failed to load)"
    );
  }

  function onMessageError(): void {
    rejectAllPending(
      "MobileSAM worker emitted a messageerror event (structured clone failure)"
    );
  }

  worker.addEventListener("message", onMessage);
  worker.addEventListener("error", onWorkerError);
  worker.addEventListener("messageerror", onMessageError);

  function send<T>(request: MobileSamWorkerRequest): Promise<T> {
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
    setImage(image: SamImageInput): Promise<void> {
      return send<void>({ id: idFactory(), type: "setImage", image });
    },
    segmentAtPoint(x: number, y: number): Promise<MobileSamMaskResult> {
      return send<MobileSamMaskResult>({ id: idFactory(), type: "segmentAtPoint", x, y });
    },
    terminate(): void {
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onWorkerError);
      worker.removeEventListener("messageerror", onMessageError);
      const error = new Error("MobileSAM worker client was terminated");
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
