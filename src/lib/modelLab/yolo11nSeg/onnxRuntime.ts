import * as ort from "onnxruntime-web";
import { resolveSelfHostedWasmPaths } from "@/lib/wasmRuntimePaths";

/**
 * `onnxruntime-web` への直接依存はこのファイルにのみ閉じ込める
 * （`../mobileSam/onnxRuntime.ts` / `../edgeSam/onnxRuntime.ts` と同型）。
 * session.ts はこのファイルが提供する `Yolo11nSegRuntime` 抽象のみに依存し、
 * `onnxruntime-web` を import しない。
 *
 * `wasmPaths.mjs` に `public/` 配下の URL をそのまま渡すと、onnxruntime-web が
 * 内部で `import(wasmPaths.mjs)` を実行し、Vite dev server が
 * 「public 配下のファイルは JS から import できない」として拒否する
 * （MobileSAM 実装で実機確認済み。詳細は `../mobileSam/onnxRuntime.ts` コメント参照）。
 * ここでも同じ手法（`.mjs` を `fetch()` して Blob URL 化）で回避する。
 *
 * EdgeSAM 実装（`../edgeSam/onnxRuntime.ts`）では、既定の asyncify 版 WASM バイナリが
 * デコーダ ONNX グラフの `Cast` ノードを実行できず非 asyncify 版への切り替えが必要だった
 * （issue #48 の教訓）。YOLO11n-seg のグラフはモデルごとに実機で個別検証すべし
 * （issue #48「やってはいけないこと」）という前提のもと検証した結果、MobileSAM と同じ
 * 既定の `resolveSelfHostedWasmPaths()`（Safari 以外は asyncify 版）で
 * `InferenceSession.create()` ・ 実推論（COCO画像でのマスク検出）が Chromium で問題なく
 * 成功することを実機（Playwright + Chromium、issue #49 実装時）で確認済み。
 * EdgeSAM のような Cast 非対応は発生しなかった（YOLO のグラフは Conv/Sigmoid/Concat が
 * 中心で、EdgeSAM デコーダ特有の bool Cast ノードを含まないため）。
 */

let wasmPathsPromise: Promise<void> | null = null;

async function loadMjsAsBlobUrl(mjsUrl: string): Promise<string> {
  const response = await fetch(mjsUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${mjsUrl}: HTTP ${response.status}`);
  }
  const code = await response.text();
  const blob = new Blob([code], { type: "text/javascript" });
  return URL.createObjectURL(blob);
}

function configureWasmPaths(): Promise<void> {
  if (!wasmPathsPromise) {
    wasmPathsPromise = (async () => {
      const paths = resolveSelfHostedWasmPaths();
      const mjsBlobUrl = await loadMjsAsBlobUrl(paths.mjs);
      ort.env.wasm.wasmPaths = { wasm: paths.wasm, mjs: mjsBlobUrl };
    })();
  }
  return wasmPathsPromise;
}

/** onnxruntime-web の Tensor を型に依存させないための最小限の表現 */
export interface Yolo11nSegTensor {
  data: Float32Array;
  dims: number[];
}

export interface Yolo11nSegInferenceSession {
  run(feeds: Record<string, Yolo11nSegTensor>): Promise<Record<string, Yolo11nSegTensor>>;
}

export interface Yolo11nSegRuntime {
  createSession(url: string): Promise<Yolo11nSegInferenceSession>;
}

function wrapSession(session: ort.InferenceSession): Yolo11nSegInferenceSession {
  return {
    async run(feeds) {
      const ortFeeds: Record<string, ort.Tensor> = {};
      for (const [name, tensor] of Object.entries(feeds)) {
        ortFeeds[name] = new ort.Tensor("float32", tensor.data, tensor.dims);
      }

      const output = await session.run(ortFeeds);

      const result: Record<string, Yolo11nSegTensor> = {};
      for (const [name, tensor] of Object.entries(output)) {
        result[name] = {
          data: tensor.data as Float32Array,
          dims: tensor.dims as number[],
        };
      }
      return result;
    },
  };
}

/** `onnxruntime-web` を wasm バックエンドで直接呼ぶ既定の `Yolo11nSegRuntime` を作る。 */
export function createOnnxRuntimeWebRuntime(): Yolo11nSegRuntime {
  return {
    async createSession(url: string) {
      await configureWasmPaths();
      const session = await ort.InferenceSession.create(url, {
        executionProviders: ["wasm"],
      });
      return wrapSession(session);
    },
  };
}
