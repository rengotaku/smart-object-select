/**
 * Web Worker のエントリポイント。ロジックを持たず、メッセージを handler に繋ぐだけの薄い配線。
 */
import { createSamWorkerHandler } from "./samWorkerHandler";
import { createTransformersSamRuntime } from "./transformersLoader";
import type { SamWorkerRequest } from "./protocol";

const handler = createSamWorkerHandler(createTransformersSamRuntime());

self.onmessage = (event: MessageEvent<SamWorkerRequest>) => {
  void handler.handle(event.data).then((response) => {
    self.postMessage(response);
  });
};
