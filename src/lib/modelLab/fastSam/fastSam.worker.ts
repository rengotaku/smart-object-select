/**
 * Web Worker のエントリポイント。ロジックを持たず、メッセージを handler に繋ぐだけの薄い配線
 * （`../yolo11nSeg/yolo11nSeg.worker.ts` と同型）。
 *
 * onnxruntime-web（`createOnnxRuntimeWebRuntime`）を main thread からではなく
 * この Worker から呼ぶのは、Vite dev server が `public/` 配下の `.mjs`（WASM ランタイムの
 * 自ホストファイル）への main thread からの動的 `import()` を拒否するため
 * （`onnxRuntime.ts` のコメント参照）。
 */
import { createFastSamWorkerHandler } from "./fastSamWorkerHandler";
import { createOnnxRuntimeWebRuntime } from "./onnxRuntime";
import type { FastSamWorkerRequest } from "./protocol";

const handler = createFastSamWorkerHandler(createOnnxRuntimeWebRuntime());

self.onmessage = (event: MessageEvent<FastSamWorkerRequest>) => {
  void handler.handle(event.data).then((response) => {
    self.postMessage(response);
  });
};
