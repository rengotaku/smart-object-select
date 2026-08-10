/**
 * Web Worker のエントリポイント。ロジックを持たず、メッセージを handler に繋ぐだけの薄い配線
 * （`../mobileSam/mobileSam.worker.ts` と同型）。
 *
 * onnxruntime-web（`createOnnxRuntimeWebRuntime`）を main thread からではなく
 * この Worker から呼ぶのは、Vite dev server が `public/` 配下の `.mjs`（WASM ランタイムの
 * 自ホストファイル）への main thread からの動的 `import()` を拒否するため
 * （`onnxRuntime.ts` のコメント参照）。
 */
import { createYolo11nSegWorkerHandler } from "./yolo11nSegWorkerHandler";
import { createOnnxRuntimeWebRuntime } from "./onnxRuntime";
import type { Yolo11nSegWorkerRequest } from "./protocol";

const handler = createYolo11nSegWorkerHandler(createOnnxRuntimeWebRuntime());

self.onmessage = (event: MessageEvent<Yolo11nSegWorkerRequest>) => {
  void handler.handle(event.data).then((response) => {
    self.postMessage(response);
  });
};
