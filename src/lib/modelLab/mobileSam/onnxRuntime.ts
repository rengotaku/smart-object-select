import * as ort from "onnxruntime-web";
import { resolveSelfHostedWasmPaths } from "@/lib/sam/wasmRuntimePaths";

/**
 * `onnxruntime-web` への直接依存はこのファイルにのみ閉じ込める
 * （transformersLoader.ts の同種コメントに倣う）。session.ts はこのファイルが
 * 提供する `MobileSamRuntime` 抽象のみに依存し、`onnxruntime-web` を import しない。
 *
 * `resolveSelfHostedWasmPaths`（`src/lib/sam/wasmRuntimePaths.ts`）は onnxruntime-web の
 * WASM ランタイム自ホストパスを解決するだけの純粋関数で、SAM セッション抽象
 * （samSession.ts / transformersLoader.ts）には依存しない。この検証ページ専用モジュールも
 * 同じ自ホスト済み WASM バイナリ（`public/onnxruntime/`）を使うため、ロジックを複製せず
 * 再利用する（読み取り専用の再利用であり、issue #47 で変更を禁止されている
 * samSession.ts / transformersLoader.ts 自体には一切手を入れていない）。
 *
 * `wasmPaths.mjs` に `public/` 配下の URL をそのまま渡すと、onnxruntime-web が
 * 内部で `import(wasmPaths.mjs)` を実行し、Vite dev server が
 * 「public 配下のファイルは JS から import できない」として拒否する（実機確認で再現）。
 * `@huggingface/transformers`（既存の SAM 機能が使う）はこれを、`.mjs` の中身を
 * 自前で `fetch()` し Blob URL に変換して `wasmPaths.mjs` に差し替えることで回避している
 * （`node_modules/@huggingface/transformers/src/backends/utils/cacheWasm.js`
 * `loadWasmFactory()` で実読して確認済み）。Blob URL はブラウザ内で完結し Vite dev server
 * に一切リクエストが飛ばないため、上記の拒否に引っかからない。
 * ここでも同じ手法を使う（`.mjs` を省略して onnxruntime-web 同梱の factory を使う対処法は、
 * バイナリと factory のペアが噛み合わず `WebAssembly.instantiate()` の LinkError になり
 * 実機で失敗したため採らない）。
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
export interface MobileSamTensor {
  data: Float32Array;
  dims: number[];
}

export interface MobileSamInferenceSession {
  run(feeds: Record<string, MobileSamTensor>): Promise<Record<string, MobileSamTensor>>;
}

export interface MobileSamRuntime {
  createSession(url: string): Promise<MobileSamInferenceSession>;
}

function wrapSession(session: ort.InferenceSession): MobileSamInferenceSession {
  return {
    async run(feeds) {
      const ortFeeds: Record<string, ort.Tensor> = {};
      for (const [name, tensor] of Object.entries(feeds)) {
        ortFeeds[name] = new ort.Tensor("float32", tensor.data, tensor.dims);
      }

      const output = await session.run(ortFeeds);

      const result: Record<string, MobileSamTensor> = {};
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

/** `onnxruntime-web` を wasm バックエンドで直接呼ぶ既定の `MobileSamRuntime` を作る。 */
export function createOnnxRuntimeWebRuntime(): MobileSamRuntime {
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
