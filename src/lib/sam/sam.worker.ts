/**
 * Web Worker のエントリポイント。ロジックを持たず、メッセージを handler に繋ぐだけの薄い配線。
 */
import { createSamWorkerHandler } from "./samWorkerHandler";
import { createTransformersSamRuntime } from "./transformersLoader";
import type {
  SamProgressEvent,
  SamWorkerNotification,
  SamWorkerRequest,
} from "./protocol";

// ダウンロード進捗は id 相関の request/response とは別種のメッセージとして流す
// （既存の pending map 相関ロジックには一切関与しない）。
function postProgress(event: SamProgressEvent): void {
  const notification: SamWorkerNotification = { type: "progress", ...event };
  self.postMessage(notification);
}

const handler = createSamWorkerHandler(createTransformersSamRuntime(postProgress));

self.onmessage = (event: MessageEvent<SamWorkerRequest>) => {
  void handler.handle(event.data).then((response) => {
    self.postMessage(response);
  });
};
