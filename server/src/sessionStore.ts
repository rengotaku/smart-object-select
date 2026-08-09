import { randomUUID } from "node:crypto";
import { createSamSession, type SamRuntime, type SamSession } from "../../src/lib/sam/samSession";
import type { SamImageInput } from "../../src/lib/sam/types";

/**
 * `Map<sessionId, SamSession>` によるセッション管理（issue #32 コメント「設計変更」節の
 * 設計通り）。セッションごとに独立した `SamSession` インスタンスを保持するため、
 * 複数クライアントが同時に別画像を扱っても embedding が混同しない（Case 5）。
 */
export class SessionNotFoundError extends Error {
  constructor(sessionId: string) {
    super(`session not found: "${sessionId}"`);
    this.name = "SessionNotFoundError";
  }
}

export interface SessionStore {
  /** `createSamSession(runtime, device)` → `setImage(image)` → セッションIDを発行し保持する */
  create(image: SamImageInput): Promise<string>;
  get(sessionId: string): SamSession;
  dispose(sessionId: string): void;
}

export function createSessionStore(runtime: SamRuntime): SessionStore {
  const sessions = new Map<string, SamSession>();

  return {
    async create(image) {
      // Node (onnxruntime-node) は wasm/webgpu を区別しないため device は無視される
      // 前提のダミー値（nodeTransformersLoader.ts 参照）。
      const session = await createSamSession(runtime, "wasm");
      await session.setImage(image);

      const sessionId = randomUUID();
      sessions.set(sessionId, session);
      return sessionId;
    },
    get(sessionId) {
      const session = sessions.get(sessionId);
      if (!session) {
        throw new SessionNotFoundError(sessionId);
      }
      return session;
    },
    dispose(sessionId) {
      const session = sessions.get(sessionId);
      if (!session) {
        throw new SessionNotFoundError(sessionId);
      }
      session.dispose();
      sessions.delete(sessionId);
    },
  };
}
