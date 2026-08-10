/**
 * Web Worker のエントリポイント。ロジックを持たず、メッセージを handler に繋ぐだけの薄い配線
 * （`src/lib/sam/sam.worker.ts` と同型）。
 *
 * onnxruntime-web（`createOnnxRuntimeWebRuntime`）を main thread からではなく
 * この Worker から呼ぶのは、Vite dev server が `public/` 配下の `.mjs`（WASM ランタイムの
 * 自ホストファイル）への main thread からの動的 `import()` を拒否するため
 * （mobileSamWorkerClient.ts のコメント参照）。
 */
import { createMobileSamWorkerHandler } from "./mobileSamWorkerHandler";
import { createOnnxRuntimeWebRuntime } from "./onnxRuntime";
import type { MobileSamWorkerRequest } from "./protocol";

const handler = createMobileSamWorkerHandler(createOnnxRuntimeWebRuntime());

self.onmessage = (event: MessageEvent<MobileSamWorkerRequest>) => {
  void handler.handle(event.data).then((response) => {
    self.postMessage(response);
  });
};
