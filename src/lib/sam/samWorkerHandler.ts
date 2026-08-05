import { detectDevice } from "./device";
import { createSamSession, type SamRuntime, type SamSession } from "./samSession";
import type { SamWorkerRequest, SamWorkerResponse } from "./protocol";

export interface SamWorkerHandler {
  handle(request: SamWorkerRequest): Promise<SamWorkerResponse>;
}

export function createSamWorkerHandler(runtime: SamRuntime): SamWorkerHandler {
  let sessionPromise: Promise<SamSession> | null = null;

  async function requireSession(): Promise<SamSession> {
    if (!sessionPromise) {
      throw new Error(
        "SAM worker has not been initialized. Send an 'init' request first."
      );
    }
    return sessionPromise;
  }

  async function handle(request: SamWorkerRequest): Promise<SamWorkerResponse> {
    try {
      switch (request.type) {
        case "init": {
          const device = await detectDevice();
          sessionPromise = createSamSession(runtime, device);
          await sessionPromise;
          return { id: request.id, type: "result", payload: device };
        }
        case "setImage": {
          const session = await requireSession();
          await session.setImage(request.image);
          return { id: request.id, type: "result", payload: undefined };
        }
        case "segment": {
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
