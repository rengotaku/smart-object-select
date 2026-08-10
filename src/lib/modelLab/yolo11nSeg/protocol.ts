import type { SamImageInput } from "@/lib/sam";

/**
 * YOLO11n-seg を Web Worker 上で実行するための request/response（id 相関）。
 * `../mobileSam/protocol.ts` と同型だが、全自動検出のため `detect` 1種類のみ
 * （点プロンプト系の `setImage`/`segmentAtPoint` に相当するメッセージは無い。issue #49）。
 */
export type Yolo11nSegWorkerRequest = {
  id: string;
  type: "detect";
  image: SamImageInput;
};

export type Yolo11nSegWorkerResponse =
  | { id: string; type: "result"; payload: unknown }
  | { id: string; type: "error"; name: string; message: string };
