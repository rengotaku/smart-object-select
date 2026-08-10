import * as ort from "onnxruntime-web";

/**
 * `onnxruntime-web` への直接依存はこのファイルにのみ閉じ込める
 * （`../mobileSam/onnxRuntime.ts` と同型。transformersLoader.ts の同種コメントに倣う）。
 * session.ts はこのファイルが提供する `EdgeSamRuntime` 抽象のみに依存し、
 * `onnxruntime-web` を import しない。
 *
 * `wasmPaths.mjs` に `public/` 配下の URL をそのまま渡すと、onnxruntime-web が
 * 内部で `import(wasmPaths.mjs)` を実行し、Vite dev server が
 * 「public 配下のファイルは JS から import できない」として拒否する
 * （MobileSAM 実装 `../mobileSam/onnxRuntime.ts` で実機確認済み。issue #48 の
 * 「重要な教訓」参照）。`@huggingface/transformers`（既存の SAM 機能が使う）はこれを、
 * `.mjs` の中身を自前で `fetch()` し Blob URL に変換して `wasmPaths.mjs` に差し替える
 * ことで回避している。ここでも MobileSAM 実装と同じ手法を使う。
 *
 * 【EdgeSAM 固有の追加の教訓（issue #48 実機検証で新たに発覚）】
 * MobileSAM/既存SAM機能が使う `resolveSelfHostedWasmPaths()`（`src/lib/sam/wasmRuntimePaths.ts`）は
 * 非 Safari ブラウザで `ort-wasm-simd-threaded.asyncify.wasm` を選ぶが、この asyncify 版
 * バイナリは EdgeSAM デコーダの ONNX グラフが含む `Cast` ノード（bool 型へのキャスト、
 * ONNX TensorProto DataType=9）のカーネル実装を持たず、実ブラウザ（Chromium）で
 * `InferenceSession.create()` が `Could not find an implementation for Cast(9) node`
 * で失敗することを確認した（MobileSAM は同じ asyncify バイナリで問題なく動くため、
 * MobileSAM の実装をそのまま信用せず EdgeSAM 個別に検証すべし、という issue #48
 * 「やってはいけないこと」がまさに的中したケース）。
 * 同じ `public/onnxruntime/` に自ホスト済みの非 asyncify 版（`ort-wasm-simd-threaded.wasm`/
 * `.mjs`。既存コードは Safari 向けに既に自ホストしている）は Cast(9) を実行でき、
 * onnxruntime-node 経由の実機検証（Node の wasm バックエンドに同バイナリを明示指定）でも
 * decoder のセッション生成・推論が成功することを確認した。そのため EdgeSAM は
 * `resolveSelfHostedWasmPaths()`（Safari 判定で asyncify 版を選ぶ）を再利用せず、
 * 常に非 asyncify 版を使う（新規ファイルのダウンロード・追加は不要。既存の自ホスト資産の
 * 別バリアントを選ぶだけ）。
 */

const EDGE_SAM_WASM_PATH = "/onnxruntime/ort-wasm-simd-threaded.wasm";
const EDGE_SAM_WASM_MJS_PATH = "/onnxruntime/ort-wasm-simd-threaded.mjs";

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
      const mjsBlobUrl = await loadMjsAsBlobUrl(EDGE_SAM_WASM_MJS_PATH);
      ort.env.wasm.wasmPaths = { wasm: EDGE_SAM_WASM_PATH, mjs: mjsBlobUrl };
    })();
  }
  return wasmPathsPromise;
}

/** onnxruntime-web の Tensor を型に依存させないための最小限の表現 */
export interface EdgeSamTensor {
  data: Float32Array;
  dims: number[];
}

export interface EdgeSamInferenceSession {
  run(feeds: Record<string, EdgeSamTensor>): Promise<Record<string, EdgeSamTensor>>;
}

export interface EdgeSamRuntime {
  createSession(url: string): Promise<EdgeSamInferenceSession>;
}

function wrapSession(session: ort.InferenceSession): EdgeSamInferenceSession {
  return {
    async run(feeds) {
      const ortFeeds: Record<string, ort.Tensor> = {};
      for (const [name, tensor] of Object.entries(feeds)) {
        ortFeeds[name] = new ort.Tensor("float32", tensor.data, tensor.dims);
      }

      const output = await session.run(ortFeeds);

      const result: Record<string, EdgeSamTensor> = {};
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

/** `onnxruntime-web` を wasm バックエンドで直接呼ぶ既定の `EdgeSamRuntime` を作る。 */
export function createOnnxRuntimeWebRuntime(): EdgeSamRuntime {
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
