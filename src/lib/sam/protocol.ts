import type { SamImageInput, SegmentPoint } from "./types";

export type SamWorkerRequest =
  | { id: string; type: "init" }
  | { id: string; type: "setImage"; image: SamImageInput }
  | { id: string; type: "segment"; x: number; y: number }
  | { id: string; type: "segmentAtPoints"; points: SegmentPoint[] };

export type SamWorkerResponse =
  | { id: string; type: "result"; payload: unknown }
  | { id: string; type: "error"; name: string; message: string };

/**
 * ダウンロード進捗の1件分（1ファイル単位）。`total` はファイルサイズが不明な場合に
 * `null`（`@huggingface/transformers` の progress_callback は不明時に `total: 0` を返す
 * ため、呼び出し元でこの正規化を行う）。
 */
export interface SamProgressEvent {
  file: string;
  loaded: number;
  total: number | null;
}

/**
 * id 相関の request/response（SamWorkerRequest/SamWorkerResponse）とは別種の、
 * Worker → メインスレッドへの一方向通知。`pending` map の相関ロジックを経由しない。
 * `id` フィールドを持たないことで response と判別可能にしている。
 */
export type SamWorkerNotification = { type: "progress" } & SamProgressEvent;
