/**
 * モデルアセット（/models/**、onnxruntime-web の WASM ランタイム /onnxruntime/**）を
 * Cache First 戦略でキャッシュし、アプリ本体（ナビゲーション・JS/CSS 等）を
 * Network First（オフライン時はキャッシュへフォールバック）でキャッシュする Service Worker。
 *
 * アプリ本体までキャッシュするのは、DoD（初回アクセス後にオフラインで /segment を
 * リロードしても画面が表示・動作すること）を満たすため。ナビゲーションリクエストは
 * 要求された URL に関わらず単一のアプリシェル（NAVIGATION_FALLBACK_URL）を返す
 * （SPA のクライアントサイドルーティングは実際の URL バーの値を見て描画するため、
 * どの URL のキャッシュを返しても問題ない）。SW は自身が制御を確立する前に発生した
 * 初回リクエスト（index.html が直接参照する JS/CSS バンドル本体）を横取りできない
 * ため、install イベントで index.html を読み、参照先の同一オリジンアセットを
 * 明示的に事前キャッシュしている（`precacheAppShell` 参照）。
 *
 * Web Worker（`src/lib/sam/sam.worker.ts` のビルド後チャンク、例:
 * `assets/sam.worker-XXXX.js`）は index.html から直接参照されず、メインバンドルの
 * JS コード内で `new Worker(new URL(...))` として動的に参照されるため、上記の
 * index.html 解析だけでは発見できない。SW の `clients.claim()` 完了前にこの
 * `new Worker(...)` が実行されると fetch が SW にインターセプトされずキャッシュされない
 * ため、install 時にメインバンドルのソースを走査して Worker チャンク URL を抽出し、
 * 事前キャッシュ対象に加えている（`extractWorkerChunkUrls` 参照）。
 *
 * モデルアセット本体（`MODEL_IDS` 各要素の `/models/<modelId>/**`。自前ホスティング済みの
 * 全モデルを対象とし、UI から選択可能な既定モデル [`src/lib/sam/constants.ts` の
 * `SAM_MODEL_ID`] とは独立に precache する）と onnxruntime-web の WASM ランタイム
 * （`/onnxruntime/**`）はビルドハッシュを含まない固定パスのため、
 * install 時に固定リストで明示的に事前キャッシュしている（`precacheModelAssets` 参照）。
 *
 * `public/` 配下は Vite の変換・バンドル対象外のため、このファイルは TypeScript を
 * import できずプレーン JS で完結させている。キャッシュ対象パス判定・キャッシュ名生成・
 * Worker チャンク抽出・固定アセットパスのロジックは
 * `src/lib/serviceWorker/cachePolicy.ts`（vitest でユニットテスト済み）と同一である
 * 必要がある。ロジックを変更する場合は両ファイルを同時に更新すること。
 * fetch handler 本体（ネットワーク戦略）は `self`/`caches` に依存し vitest(jsdom) では
 * 実行できないため、実ブラウザでの DoD 確認で担保する。
 */

// src/lib/serviceWorker/cachePolicy.ts の CACHE_NAME_PREFIX と同じ値を保つこと。
const CACHE_NAME_PREFIX = "smart-object-select-model-assets";

// public/models/<modelId>/ を指す。src/lib/serviceWorker/cachePolicy.ts の
// SELF_HOSTED_MODEL_IDS と同じ値を保つこと（既定選択モデルは
// src/lib/sam/constants.ts の SAM_MODEL_ID = "slimsam-77-uniform" のまま変更していない。
// ここは「self-host 済みで precache すべきモデル一覧」であり選択中モデルとは別の関心事）。
const MODEL_IDS = ["slimsam-77-uniform", "slimsam-50-uniform"];

// モデルアセット・アプリ本体が更新されたらこの値を上げる。activate イベントで
// このバージョンと異なる（かつ CACHE_NAME_PREFIX を持つ）旧キャッシュを破棄する。
// slimsam-50-uniform 追加に伴い v1 -> v2 に更新（新モデル資産を確実に precache するため）。
const CACHE_VERSION = "v2";

// src/lib/serviceWorker/cachePolicy.ts の CACHEABLE_ASSET_PATH_PREFIXES と同じ値を保つこと。
const CACHEABLE_ASSET_PATH_PREFIXES = ["/models/", "/onnxruntime/"];

// src/lib/serviceWorker/cachePolicy.ts の isCacheableAssetPath と同一ロジック。
function isCacheableAssetPath(pathname) {
  return CACHEABLE_ASSET_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

// src/lib/serviceWorker/cachePolicy.ts の APP_SHELL_CACHE_EXCLUDED_PATH_PREFIXES と同じ値を保つこと。
const APP_SHELL_CACHE_EXCLUDED_PATH_PREFIXES = ["/api/"];

// src/lib/serviceWorker/cachePolicy.ts の isExcludedFromAppShellCache と同一ロジック。
function isExcludedFromAppShellCache(pathname) {
  return APP_SHELL_CACHE_EXCLUDED_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

// src/lib/serviceWorker/cachePolicy.ts の buildCacheName と同一ロジック。
function buildCacheName(id, version) {
  return `${CACHE_NAME_PREFIX}-${id}-${version}`;
}

// 複数モデルのアセットを1つのキャッシュにまとめて保持するため、特定モデルの ID ではなく
// 固定の集約名 "models" でキャッシュ名を生成する（`MODEL_IDS` 追加時にキャッシュ名自体は
// 変わらないようにするため。バージョン更新時の破棄は CACHE_VERSION で行う）。
const MODEL_CACHE_NAME = buildCacheName("models", CACHE_VERSION);
const APP_SHELL_CACHE_NAME = buildCacheName("app-shell", CACHE_VERSION);
const CURRENT_CACHE_NAMES = new Set([MODEL_CACHE_NAME, APP_SHELL_CACHE_NAME]);

// ナビゲーションリクエスト（SPA の任意のルート）をオフライン時に肩代わりする
// フォールバック用のキャッシュキー。実際にネットワークから取得できたナビゲーション
// レスポンス（"/segment" 等）をこのキーで保存し直す。
const NAVIGATION_FALLBACK_URL = "/index.html";

/**
 * `NAVIGATION_FALLBACK_URL`（index.html）の本文から `<script src="...">` /
 * `<link href="...">` が参照する同一オリジンの絶対パスアセット URL を抽出する。
 *
 * ビルド成果物のファイル名はコンテンツハッシュを含み（例: `/assets/index-XXXX.js`）
 * ビルドのたびに変わるため、Vite の変換対象外である `public/sw.js` にハードコード
 * できない。install 時に実際の index.html を読んでその場で発見する。
 *
 * dev モードでは `<script src="/src/main.tsx">` の 1 ファイルのみが対象になり、
 * そこから import される多数の ESM モジュールまでは列挙しない（動的で不安定な
 * ため対象外。既存の networkFirst によるオンライン時の逐次キャッシュに委ねる）。
 */
function extractAppShellAssetUrls(html) {
  const urls = new Set();
  const tagPattern = /<(?:script|link)\b[^>]*\s(?:src|href)="([^"]+)"[^>]*>/gi;
  let match;
  while ((match = tagPattern.exec(html)) !== null) {
    const url = match[1];
    if (url.startsWith("/") && !url.startsWith("//")) {
      urls.add(url);
    }
  }
  return urls;
}

// src/lib/serviceWorker/cachePolicy.ts の MODEL_ASSET_PATH_SUFFIXES と同じ値を保つこと。
const MODEL_ASSET_PATH_SUFFIXES = [
  "config.json",
  "preprocessor_config.json",
  "onnx/vision_encoder_quantized.onnx",
  "onnx/prompt_encoder_mask_decoder_quantized.onnx",
];

// src/lib/serviceWorker/cachePolicy.ts の buildModelAssetPaths と同一ロジック。
function buildModelAssetPaths(modelId) {
  return MODEL_ASSET_PATH_SUFFIXES.map((suffix) => `/models/${modelId}/${suffix}`);
}

// src/lib/serviceWorker/cachePolicy.ts の WASM_RUNTIME_ASSET_PATHS と同じ値を保つこと。
const WASM_RUNTIME_ASSET_PATHS = [
  "/onnxruntime/ort-wasm-simd-threaded.mjs",
  "/onnxruntime/ort-wasm-simd-threaded.wasm",
  "/onnxruntime/ort-wasm-simd-threaded.asyncify.mjs",
  "/onnxruntime/ort-wasm-simd-threaded.asyncify.wasm",
];

// src/lib/serviceWorker/cachePolicy.ts の WORKER_CHUNK_URL_PATTERN と同一ロジック。
const WORKER_CHUNK_URL_PATTERN =
  /new\s+Worker\s*\(\s*new\s+URL\s*\(\s*([`'"])((?:(?!\1)[\s\S])*?)\1/g;

// src/lib/serviceWorker/cachePolicy.ts の extractWorkerChunkUrls と同一ロジック。
function extractWorkerChunkUrls(jsSource) {
  const urls = new Set();
  WORKER_CHUNK_URL_PATTERN.lastIndex = 0;
  let match;
  while ((match = WORKER_CHUNK_URL_PATTERN.exec(jsSource)) !== null) {
    const url = match[2];
    if (url.startsWith("/") && !url.startsWith("//")) {
      urls.add(url);
    }
  }
  return Array.from(urls);
}

/**
 * アプリシェル（ナビゲーションフォールバック用の index.html、そこから参照される
 * 同一オリジンの JS/CSS アセット、および同 JS アセットが `new Worker(new URL(...))`
 * で動的に参照する Web Worker チャンク）を事前キャッシュする。初回アクセス直後に
 * オフラインになった場合でも、この install 完了時点のキャッシュだけで `/segment`
 * 等の画面が描画・動作できる状態を作る。
 */
async function precacheAppShell(cache) {
  const htmlResponse = await fetch(NAVIGATION_FALLBACK_URL);
  if (!htmlResponse.ok) {
    throw new Error(
      `failed to fetch ${NAVIGATION_FALLBACK_URL} for app shell precache: ${htmlResponse.status}`
    );
  }
  const html = await htmlResponse.clone().text();
  await cache.put(NAVIGATION_FALLBACK_URL, htmlResponse);

  const assetUrls = extractAppShellAssetUrls(html);
  const workerChunkUrls = new Set();

  await Promise.all(
    Array.from(assetUrls, (url) =>
      fetch(url)
        .then(async (response) => {
          if (!response.ok) {
            return;
          }
          if (url.endsWith(".js")) {
            // メインバンドル JS 内で動的に new Worker(new URL(...)) 参照される
            // Worker チャンク（index.html からは発見できない）を抽出する。
            try {
              const text = await response.clone().text();
              for (const workerUrl of extractWorkerChunkUrls(text)) {
                workerChunkUrls.add(workerUrl);
              }
            } catch (error) {
              console.warn(`[sw] failed to scan for worker chunk urls in: ${url}`, error);
            }
          }
          return cache.put(url, response);
        })
        .catch((error) => {
          // 個々のアセットの事前キャッシュに失敗しても他のアセット・SW インストール
          // 自体は継続する（部分的にでもオフライン動作の可能性を残すため）。
          console.warn(`[sw] failed to precache app shell asset: ${url}`, error);
        })
    )
  );

  await Promise.all(
    Array.from(workerChunkUrls, (url) =>
      fetch(url)
        .then((response) => {
          if (response.ok) {
            return cache.put(url, response);
          }
        })
        .catch((error) => {
          // Worker チャンクの事前キャッシュに失敗しても他のアセット・SW インストール
          // 自体は継続する（既存の防御的エラーハンドリング方針を踏襲）。
          console.warn(`[sw] failed to precache worker chunk: ${url}`, error);
        })
    )
  );
}

/**
 * モデルアセット本体（`MODEL_IDS` それぞれの `/models/<modelId>/**`）と onnxruntime-web の
 * WASM ランタイム（`/onnxruntime/**`。Safari 版・非 Safari(asyncify) 版の両方）を、
 * install 時点で MODEL_CACHE_NAME へ明示的に事前キャッシュする。これらのパスはビルドハッシュを
 * 含まないため固定リストで参照できる（`buildModelAssetPaths` / `WASM_RUNTIME_ASSET_PATHS`）。
 *
 * 個々の URL の取得は `cacheFirst`（fetch handler が実リクエストの処理にも使う関数）を
 * 再利用する。install 完了前に SAM Worker がモデル本体を実際に fetch し始めることが
 * あり、install 側の事前取得とタイミングが重なると同一キャッシュキーへ並行してリクエストが
 * 発生しうる。生の `fetch` + `cache.put` を個別に呼ぶと同一 URL への冗長な二重取得が
 * 起こるため、`cacheFirst` の同一キー de-dup（`inFlightCacheFirstFetches` 参照）を
 * 経由させ 1 本の fetch + cache.put に集約する。
 *
 * 実測メモ: 8MB超の大きい .onnx ファイルを SW の fetch handler 経由で取得すると、
 * ブラウザの HTTP ディスクキャッシュへの書き込みが失敗しモデル読み込み自体が失敗する
 * 事象（`net::ERR_CACHE_WRITE_FAILURE`）を確認した。永続キャッシュは cache.put
 * （Cache Storage）で自前管理しておりブラウザの HTTP ディスクキャッシュは不要なため、
 * `cacheFirst` 側の fetch を `{ cache: "no-store" }` にすることで解消している
 * （`cacheFirst` 内のコメント参照）。
 */
async function precacheModelAssets(cacheName) {
  const urls = [
    ...MODEL_IDS.flatMap((modelId) => buildModelAssetPaths(modelId)),
    ...WASM_RUNTIME_ASSET_PATHS,
  ];
  await Promise.all(
    urls.map((url) =>
      cacheFirst(new Request(url), cacheName).catch((error) => {
        // 個々のモデルアセットの事前キャッシュに失敗しても他のアセット・SW インストール
        // 自体は継続する（既存の防御的エラーハンドリング方針を踏襲）。
        console.warn(`[sw] failed to precache model asset: ${url}`, error);
      })
    )
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    Promise.all([
      caches.open(APP_SHELL_CACHE_NAME).then((cache) => precacheAppShell(cache)),
      precacheModelAssets(MODEL_CACHE_NAME),
    ]).catch((error) => {
      // 事前キャッシュに失敗しても SW 自体のインストールは継続する
      // （オンライン時の動作やオフライン以外のフォールバックは引き続き機能する）。
      console.warn("[sw] precache failed", error);
    })
  );
  // 新しい SW を即座にアクティブ化する（既存タブの制御は activate 完了後に引き継ぐ）。
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames
            .filter(
              (name) => name.startsWith(CACHE_NAME_PREFIX) && !CURRENT_CACHE_NAMES.has(name)
            )
            .map((name) => caches.delete(name))
        )
      )
      .then(() => self.clients.claim())
  );
});

// cacheName + URL をキーに、進行中の cacheFirst 取得（fetch + cache.put）を保持する。
// install 時の precacheModelAssets とページ本体（SAM Worker）からの実リクエストが
// ほぼ同時に同じモデルアセットを要求すると、キャッシュ未ヒットの判定が両方とも
// 素通りし、同一 URL への冗長な二重 fetch + cache.put が走ってしまう
// （`precacheModelAssets` のコメント参照）。同一キーの取得を 1 本の Promise に
// 集約して共有し、この冗長な二重取得を避ける。
const inFlightCacheFirstFetches = new Map();

/** Cache First: モデルアセット用。キャッシュ済みなら即返し、無ければネットワーク取得して保存する。 */
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  // Origin ヘッダ等の Vary 差分（例: crossorigin 属性付きリクエストは Origin ヘッダを
  // 付与する）でキャッシュヒットを取りこぼさないよう、URL のみで照合する。
  const cached = await cache.match(request, { ignoreVary: true });
  if (cached) {
    return cached;
  }

  const inFlightKey = `${cacheName}:${request.url}`;
  let fetchPromise = inFlightCacheFirstFetches.get(inFlightKey);
  if (!fetchPromise) {
    // モデルアセットの永続キャッシュは cache.put（Cache Storage）で自前管理しており、
    // ブラウザ標準の HTTP ディスクキャッシュへの二重保存は不要。実測で、大きい
    // （8MB超の）レスポンスを Service Worker 経由で fetch すると、ブラウザの HTTP
    // ディスクキャッシュへの書き込みが `net::ERR_CACHE_WRITE_FAILURE` で失敗し
    // モデル読み込み自体が失敗する事象を確認した（`{ cache: "no-store" }` を指定し
    // ブラウザの HTTP キャッシュ書き込みを行わせないことで解消することを実ブラウザで確認済み）。
    fetchPromise = fetch(new Request(request, { cache: "no-store" }))
      .then((response) => {
        if (response.ok) {
          // ここでの cache.put 失敗（ストレージ容量超過等）を待たずに
          // レスポンスを返す（取得済みのレスポンスでオンライン時の動作を壊さない）。
          cache.put(request, response.clone()).catch((error) => {
            console.warn("[sw] cache.put failed; serving fetched response uncached", error);
          });
        }
        return response;
      })
      .finally(() => {
        inFlightCacheFirstFetches.delete(inFlightKey);
      });
    inFlightCacheFirstFetches.set(inFlightKey, fetchPromise);
  }

  // 呼び出し元が複数（install 時の precache とページ本体からの実リクエスト等）でも、
  // 実体は 1 本の fetch + cache.put のみ実行し、各呼び出し元へは複製を返す
  // （Response のボディは 1 度しか読めないため、共有元は直接消費せず必ず clone する）。
  const response = await fetchPromise;
  return response.clone();
}

/**
 * Network First: アプリ本体（ナビゲーション/JS/CSS 等）用。
 * オンライン時は常に最新を取得し（開発中の変更を反映）、取得できたレスポンスは
 * オフライン時のフォールバック用にキャッシュへ書き込む。ネットワーク取得に失敗した
 * 場合のみキャッシュを参照する。
 */
async function networkFirst(request, cacheName, { fallbackKey } = {}) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) {
      try {
        await cache.put(fallbackKey ?? request, response.clone());
      } catch (error) {
        console.warn("[sw] cache.put failed; serving fetched response uncached", error);
      }
    }
    return response;
  } catch (error) {
    // ignoreVary: true の理由は cacheFirst と同じ（`crossorigin` 属性付きの
    // <script>/<link> は Origin ヘッダを付与するため、`Vary: Origin` を返す
    // オリジンサーバー配下では厳密一致だと事前キャッシュ済みでも取りこぼす）。
    const cached = await cache.match(fallbackKey ?? request, { ignoreVary: true });
    if (cached) {
      return cached;
    }
    // 未キャッシュかつオフラインの場合は通常のネットワークエラーとして扱う。
    throw error;
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") {
    // キャッシュ対象外は SW を素通りさせ、ブラウザの通常のネットワーク処理に委ねる。
    return;
  }

  const url = new URL(request.url);

  if (url.origin !== self.location.origin) {
    // クロスオリジンリクエストは対象外（素通り）。
    // モデルパス判定より先に行い、クロスオリジンの URL が誤って
    // cacheFirst（永続キャッシュ）に渡らないようにする。
    return;
  }

  if (isExcludedFromAppShellCache(url.pathname)) {
    // API リクエスト（例: /api/v1/users）は認証付き・ユーザー固有のレスポンスを
    // 返しうるため、アプリシェルキャッシュ（networkFirst）に永続保存しない。
    // SW を素通りさせ、ブラウザの通常のネットワーク処理に委ねる。
    return;
  }

  if (isCacheableAssetPath(url.pathname)) {
    event.respondWith(
      cacheFirst(request, MODEL_CACHE_NAME).catch((error) => {
        console.warn("[sw] cache-first handling failed", error);
        return fetch(request);
      })
    );
    return;
  }

  if (request.mode === "navigate") {
    // どの URL へのナビゲーションでも同一のフォールバックキーでキャッシュする。
    // SPA はクライアントサイドルーティングで実際の URL バーを見て描画するため、
    // オフライン時に別ルートのキャッシュを返しても問題ない。
    event.respondWith(
      networkFirst(request, APP_SHELL_CACHE_NAME, {
        fallbackKey: NAVIGATION_FALLBACK_URL,
      }).catch((error) => {
        console.warn("[sw] navigation network-first handling failed", error);
        return fetch(request);
      })
    );
    return;
  }

  event.respondWith(
    networkFirst(request, APP_SHELL_CACHE_NAME).catch((error) => {
      console.warn("[sw] asset network-first handling failed", error);
      return fetch(request);
    })
  );
});
