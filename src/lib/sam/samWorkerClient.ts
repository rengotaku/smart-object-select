import type { SamDevice } from "./device";
import type { SamImageInput, SamMaskResult } from "./types";
import type { SamWorkerRequest, SamWorkerResponse } from "./protocol";

export interface WorkerLike {
  postMessage(message: unknown): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  removeEventListener(
    type: "message",
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

  worker.addEventListener("message", onMessage);

  function send<T>(request: SamWorkerRequest): Promise<T> {
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
      const error = new Error("SAM worker client was terminated");
      for (const request of pending.values()) {
        request.reject(error);
      }
      pending.clear();
      worker.terminate();
    },
  };
}
