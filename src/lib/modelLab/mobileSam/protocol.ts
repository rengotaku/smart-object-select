import type { SamImageInput } from "@/lib/sam";

/**
 * MobileSAM を Web Worker 上で実行するための request/response（id 相関）。
 * `src/lib/sam/protocol.ts`（既存 SAM 機能）と同型だが、MobileSAM は単発クリックのみを
 * スコープとするため `init`/`segmentAtPoints` に相当するメッセージは無い（issue #47）。
 */
export type MobileSamWorkerRequest =
  | { id: string; type: "setImage"; image: SamImageInput }
  | { id: string; type: "segmentAtPoint"; x: number; y: number };

export type MobileSamWorkerResponse =
  | { id: string; type: "result"; payload: unknown }
  | { id: string; type: "error"; name: string; message: string };
