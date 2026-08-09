/**
 * Service Worker（`public/sw.js`）のキャッシュ戦略に関する純粋ロジック。
 *
 * `public/` 配下のファイルは Vite の変換・バンドル対象外のため、`public/sw.js` は
 * TypeScript を import できずプレーン JS で完結させる必要がある（`self`/`caches` は
 * ブラウザの Service Worker グローバルスコープでのみ利用可能で jsdom でも実行不可）。
 * そのため、テスト可能なロジック部分（キャッシュ対象パス判定・キャッシュ名生成）を
 * ここに純粋関数として切り出し、`public/sw.js` 側は同一ロジックを手動で複製する
 * （`wasmRuntimePaths.ts` が `@huggingface/transformers` 内部ロジックを複製している
 * のと同じ方針）。ロジックを変更する場合は両ファイルを同時に更新すること。
 */

/**
 * Cache Storage に保存するキャッシュ名の共通プレフィックス。
 * `public/sw.js` 側と同じ値を保つこと。
 */
export const CACHE_NAME_PREFIX = "smart-object-select-model-assets";

/**
 * Cache First 戦略でキャッシュする対象パスのプレフィックス一覧。
 * これ以外のリクエスト（アプリ本体・API 等）は SW のキャッシュ対象にしない。
 */
export const CACHEABLE_ASSET_PATH_PREFIXES = ["/models/", "/onnxruntime/"] as const;

/**
 * 指定した pathname がモデルアセットのキャッシュ対象かどうかを判定する。
 * `/models/**` と `/onnxruntime/**`（自ホストした onnxruntime-web の WASM ランタイム）
 * のみを対象とし、それ以外（アプリ本体・API 等）は SW が意図せずキャッシュしないようにする。
 */
export function isCacheableAssetPath(pathname: string): boolean {
  return CACHEABLE_ASSET_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/**
 * アプリシェルキャッシュ（Network First）から除外するパスのプレフィックス一覧。
 * `VITE_API_BASE_URL`（`src/api/client.ts`）がフロントエンドと同一 origin の場合、
 * `api/v1/...`（`src/api/users.ts` 等）への認証付き API レスポンスが汎用の
 * Network First 分岐に紛れ込み Cache Storage に永続保存されるのを防ぐ。
 */
export const APP_SHELL_CACHE_EXCLUDED_PATH_PREFIXES = ["/api/"] as const;

/**
 * 指定した pathname がアプリシェルキャッシュの対象外（SW を素通りさせて通常の
 * ネットワーク処理に委ねるべき）かどうかを判定する。
 */
export function isExcludedFromAppShellCache(pathname: string): boolean {
  return APP_SHELL_CACHE_EXCLUDED_PATH_PREFIXES.some((prefix) =>
    pathname.startsWith(prefix)
  );
}

/**
 * モデル ID とバージョン文字列から一意なキャッシュ名を生成する。
 * モデルアセットが更新された際は `version` を変更することで、SW の `activate`
 * イベントが旧バージョンのキャッシュ（同じプレフィックスを持ち名前が異なるもの）を
 * 破棄できるようにする。
 */
export function buildCacheName(modelId: string, version: string): string {
  return `${CACHE_NAME_PREFIX}-${modelId}-${version}`;
}

/**
 * `/models/<modelId>/` 配下で SAM 実行に必須なファイルの相対パス一覧。
 * `src/lib/sam/transformersLoader.ts` が `MODEL_DTYPE = "q8"` を明示指定するため
 * 量子化済みファイルのみが実際に fetch される（非量子化ファイル・NOTICE 等の
 * ライセンス表記ファイルは実行時に参照されないため対象外）。
 * これらのパスはビルドハッシュを含まないため固定リストとしてハードコードできる。
 * `public/sw.js` 側と同じ値を保つこと。
 */
export const MODEL_ASSET_PATH_SUFFIXES = [
  "config.json",
  "preprocessor_config.json",
  "onnx/vision_encoder_quantized.onnx",
  "onnx/prompt_encoder_mask_decoder_quantized.onnx",
] as const;

/**
 * `modelId` から `/models/<modelId>/` 配下の実ファイル絶対パス一覧を生成する。
 */
export function buildModelAssetPaths(modelId: string): string[] {
  return MODEL_ASSET_PATH_SUFFIXES.map((suffix) => `/models/${modelId}/${suffix}`);
}

/**
 * `public/models/` 配下に自前ホスティングしているモデル ID の一覧。
 * Service Worker の install 時 precache 対象を決めるための一覧であり、
 * どのモデルを UI から選択可能にするか（`src/lib/sam/constants.ts`）とは別の関心事
 * として独立させている（`public/sw.js` は TypeScript を import できないため）。
 * 新しいモデルを `public/models/<modelId>/` へ追加したら、この配列にも追記すること。
 * `public/sw.js` 側と同じ値を保つこと。
 */
export const SELF_HOSTED_MODEL_IDS = [
  "slimsam-77-uniform",
  "slimsam-50-uniform",
] as const;

/**
 * `SELF_HOSTED_MODEL_IDS` に列挙した全モデルの precache 対象パス一覧を生成する。
 */
export function buildAllModelAssetPaths(): string[] {
  return SELF_HOSTED_MODEL_IDS.flatMap((modelId) => buildModelAssetPaths(modelId));
}

/**
 * onnxruntime-web の WASM ランタイム一式（Safari 版・非 Safari(asyncify) 版の両方）。
 * `src/lib/sam/wasmRuntimePaths.ts` の `resolveSelfHostedWasmPaths` は実行時の UA で
 * どちらか一方のみを選択するが、install 時点ではクライアントの UA を確定できない
 * （また将来の再訪問時に別ブラウザから同一 SW が使われる可能性もある）ため、
 * 両方を precache 対象に含める。パスはビルドハッシュを含まないため固定リストで
 * ハードコードできる。`public/sw.js` 側と同じ値を保つこと。
 */
export const WASM_RUNTIME_ASSET_PATHS = [
  "/onnxruntime/ort-wasm-simd-threaded.mjs",
  "/onnxruntime/ort-wasm-simd-threaded.wasm",
  "/onnxruntime/ort-wasm-simd-threaded.asyncify.mjs",
  "/onnxruntime/ort-wasm-simd-threaded.asyncify.wasm",
] as const;

/**
 * Vite がビルドした `new Worker(new URL("<path>", import.meta.url), { type: "module" })`
 * 相当のコードから `<path>` を抽出する正規表現。
 *
 * 実際のビルド出力ではミニファイア次第でクォート文字（`"` / `'` / `` ` ``。テンプレート
 * リテラルとして出力される場合がある）や空白の有無が変動するため、いずれのクォート
 * 文字にも対応できる形にしている（キャプチャグループ1でクォート文字を捕捉し、
 * 同じ文字が再度現れるまでを非貪欲にパス本体として捕捉する）。
 */
const WORKER_CHUNK_URL_PATTERN =
  /new\s+Worker\s*\(\s*new\s+URL\s*\(\s*([`'"])((?:(?!\1)[\s\S])*?)\1/g;

/**
 * メインバンドル JS のソーステキストから、`new Worker(new URL(...))` で動的に参照される
 * Web Worker チャンクの同一オリジン絶対パス URL を抽出する。
 *
 * `index.html` の `<script src>` / `<link href>` 解析（`extractAppShellAssetUrls`、
 * `public/sw.js` 側にのみ存在）では Worker チャンク（例: `sam.worker-XXXX.js`）を
 * 発見できない。Worker はメインバンドルのコード内で動的に `new Worker(...)` として
 * 参照されるだけで、`index.html` からは直接参照されないため。
 */
export function extractWorkerChunkUrls(jsSource: string): string[] {
  const urls = new Set<string>();
  WORKER_CHUNK_URL_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = WORKER_CHUNK_URL_PATTERN.exec(jsSource)) !== null) {
    const url = match[2];
    if (url.startsWith("/") && !url.startsWith("//")) {
      urls.add(url);
    }
  }
  return Array.from(urls);
}
