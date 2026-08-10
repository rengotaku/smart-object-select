/**
 * Web Worker のエントリポイント。ロジックを持たず、メッセージを handler に繋ぐだけの薄い配線
 * （`../mobileSam/mobileSam.worker.ts` / `src/lib/sam/sam.worker.ts` と同型）。
 *
 * onnxruntime-web（`createOnnxRuntimeWebRuntime`）を main thread からではなく
 * この Worker から呼ぶのは、Vite dev server が `public/` 配下の `.mjs`（WASM ランタイムの
 * 自ホストファイル）への main thread からの動的 `import()` を拒否するため
 * （edgeSamWorkerClient.ts のコメント参照）。
 */
import { createEdgeSamWorkerHandler } from "./edgeSamWorkerHandler";
import { createOnnxRuntimeWebRuntime } from "./onnxRuntime";
import type { EdgeSamWorkerRequest } from "./protocol";

const handler = createEdgeSamWorkerHandler(createOnnxRuntimeWebRuntime());

self.onmessage = (event: MessageEvent<EdgeSamWorkerRequest>) => {
  void handler.handle(event.data).then((response) => {
    self.postMessage(response);
  });
};
