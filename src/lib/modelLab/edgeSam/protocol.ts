import type { SamImageInput } from "@/lib/sam";

/**
 * EdgeSAM を Web Worker 上で実行するための request/response（id 相関）。
 * `../mobileSam/protocol.ts` と同型だが、EdgeSAM は単発クリックのみをスコープとするため
 * `init`/`segmentAtPoints` に相当するメッセージは無い（issue #48）。
 */
export type EdgeSamWorkerRequest =
  | { id: string; type: "setImage"; image: SamImageInput }
  | { id: string; type: "segmentAtPoint"; x: number; y: number };

export type EdgeSamWorkerResponse =
  | { id: string; type: "result"; payload: unknown }
  | { id: string; type: "error"; name: string; message: string };
