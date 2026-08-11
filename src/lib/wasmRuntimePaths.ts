/**
 * onnxruntime-web の WASM ランタイム（`.wasm` / `.mjs`）を自ホストパスから読み込むための設定。
 *
 * `@huggingface/transformers` は `env.backends.onnx.wasm.wasmPaths` が未設定の場合、
 * import 時点で jsDelivr CDN の URL を既定値としてセットする
 * （node_modules/@huggingface/transformers/src/backends/onnx.js 338-361行付近で実読して確認済み）。
 * この既定値は Safari かどうかで参照するファイルを切り替える（Safari は非 asyncify 版、
 * それ以外は asyncify 版）。この切り替えを自前パスに置き換えても再現するため、
 * 同ファイルの `isSafari()`（env.js 67-93行）と同一のロジックをここに複製する。
 * `apis`/`isSafari` は同パッケージの公開 API（package.json の `exports`）に含まれず
 * 外部から import できないため複製が必要。
 */

export interface NavigatorLike {
  userAgent?: string;
  vendor?: string;
}

/**
 * `@huggingface/transformers` の `isSafari()` と同一ロジック（Safari かどうかの判定）。
 */
export function isSafariNavigator(nav?: NavigatorLike): boolean {
  const navigatorLike =
    nav ?? (typeof navigator !== "undefined" ? (navigator as NavigatorLike) : undefined);
  if (!navigatorLike?.userAgent) {
    return false;
  }

  const userAgent = navigatorLike.userAgent;
  const vendor = navigatorLike.vendor ?? "";

  const isAppleVendor = vendor.indexOf("Apple") > -1;
  const notOtherBrowser =
    !/CriOS|FxiOS|EdgiOS|OPiOS|mercury|brave/i.test(userAgent) &&
    !userAgent.includes("Chrome") &&
    !userAgent.includes("Android");

  return isAppleVendor && notOtherBrowser;
}

export interface WasmPaths {
  wasm: string;
  mjs: string;
}

const WASM_BASE_PATH = "/onnxruntime/";

/**
 * 自ホストした onnxruntime-web の WASM ランタイムパスを返す。
 * Safari 判定は `@huggingface/transformers` の既定挙動（jsDelivr 版）と同じ分岐を再現する。
 */
export function resolveSelfHostedWasmPaths(nav?: NavigatorLike): WasmPaths {
  if (isSafariNavigator(nav)) {
    return {
      mjs: `${WASM_BASE_PATH}ort-wasm-simd-threaded.mjs`,
      wasm: `${WASM_BASE_PATH}ort-wasm-simd-threaded.wasm`,
    };
  }
  return {
    mjs: `${WASM_BASE_PATH}ort-wasm-simd-threaded.asyncify.mjs`,
    wasm: `${WASM_BASE_PATH}ort-wasm-simd-threaded.asyncify.wasm`,
  };
}
