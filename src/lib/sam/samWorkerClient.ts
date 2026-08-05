import type { SamDevice } from "./device";
import type { SamImageInput, SamMaskResult } from "./types";
import type { SamWorkerRequest, SamWorkerResponse } from "./protocol";

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

export interface SamWorkerClient {
  init(): Promise<SamDevice>;
  setImage(image: SamImageInput): Promise<void>;
  segment(x: number, y: number): Promise<SamMaskResult>;
  terminate(): void;
}

interface PendingRequest {
  resolve(payload: unknown): void;
  reject(error: unknown): void;
}

function createDefaultIdFactory(): () => string {
  let counter = 0;
  return () => `sam-req-${counter++}`;
}

export function createSamWorkerClient(
  worker: WorkerLike,
  idFactory: () => string = createDefaultIdFactory()
): SamWorkerClient {
  const pending = new Map<string, PendingRequest>();

  function onMessage(event: { data: unknown }): void {
    const response = event.data as SamWorkerResponse;
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

  // Worker のモジュール読み込み失敗・モデル初期化中のクラッシュ・OOM 等では
  // "message" イベントが一切発火せず、"error"（DOM ErrorEvent）または
  // "messageerror"（構造化クローン失敗）だけが届く。これらを無視すると
  // pending な request が永久に resolve/reject されず、呼び出し元は
  // 「読み込み中」のままハングする。
  //
  // さらに、worker がリクエストの合間（pending が空の状態）でクラッシュした
  // 場合、その時点では reject すべき request が無いため何も起きない。その
  // 後に発行された setImage/segment は既に停止した worker へ送られ、応答が
  // 一切来ないまま永久 pending になる。これを防ぐため、error/messageerror
  // を一度でも受信したらクライアントを失敗状態として保持し、以後の送信は
  // worker へ postMessage せず即座に reject する（terminate 後も同様）。
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
      "SAM worker emitted an error event (worker crashed or failed to load)"
    );
  }

  function onMessageError(): void {
    rejectAllPending(
      "SAM worker emitted a messageerror event (structured clone failure)"
    );
  }

  worker.addEventListener("message", onMessage);
  worker.addEventListener("error", onWorkerError);
  worker.addEventListener("messageerror", onMessageError);

  function send<T>(request: SamWorkerRequest): Promise<T> {
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
    init(): Promise<SamDevice> {
      return send<SamDevice>({ id: idFactory(), type: "init" });
    },
    setImage(image: SamImageInput): Promise<void> {
      return send<void>({ id: idFactory(), type: "setImage", image });
    },
    segment(x: number, y: number): Promise<SamMaskResult> {
      return send<SamMaskResult>({ id: idFactory(), type: "segment", x, y });
    },
    terminate(): void {
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onWorkerError);
      worker.removeEventListener("messageerror", onMessageError);
      const error = new Error("SAM worker client was terminated");
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
