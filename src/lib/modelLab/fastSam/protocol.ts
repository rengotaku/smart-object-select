import type { SamImageInput } from "@/lib/sam";

/**
 * FastSAM を Web Worker 上で実行するための request/response（id 相関）。
 * `../yolo11nSeg/protocol.ts` と同型だが、全自動検出のため `detect` 1種類のみ
 * （点プロンプト系の `setImage`/`segmentAtPoint` に相当するメッセージは無い。issue #50）。
 */
export type FastSamWorkerRequest = {
  id: string;
  type: "detect";
  image: SamImageInput;
};

export type FastSamWorkerResponse =
  | { id: string; type: "result"; payload: unknown }
  | { id: string; type: "error"; name: string; message: string };
