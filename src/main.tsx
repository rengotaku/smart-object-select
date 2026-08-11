import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";

/**
 * 過去バージョン（本編/segment、issue #59で削除）が登録した Service Worker
 * （`public/sw.js`、削除済み。`register("/sw.js")` は scope 未指定のため既定 scope は
 * このオリジンの `/`）とそのモデルアセットキャッシュ（`CACHE_NAME_PREFIX`
 * `smart-object-select-model-assets-`、旧 `src/lib/serviceWorker/cachePolicy.ts`、
 * 削除済み）だけを解除する。
 *
 * `public/sw.js` を削除して登録処理を main.tsx から外しただけでは、以前このアプリに
 * アクセスしたことがあるブラウザ（特に `wt dev` のように同一 origin/port を再利用する
 * ローカル開発環境）では、既に有効化済みの旧 Service Worker がブラウザ側に残り続け、
 * 全リクエストを横取りしたまま SlimSAM を含む大容量キャッシュも保持してしまう
 * （issue #59 PR #60 codex レビュー指摘）。
 *
 * 🔴 対象は `scriptURL` が `/sw.js`（このアプリ由来）のもの・キャッシュ名が
 * `smart-object-select-model-assets-` で始まるものだけに限定する。同一オリジンを
 * サブパスで共有する別アプリの Service Worker / Cache Storage まで巻き込んで
 * 解除・削除しない（codex レビュー P1 指摘、issue #59 PR #60 2回目）。
 * 未対応環境・失敗時もアプリ本体の起動は妨げない。
 */
const STALE_SERVICE_WORKER_SCRIPT_PATH = "/sw.js";
const STALE_CACHE_NAME_PREFIX = "smart-object-select-model-assets-";

function isStaleServiceWorkerRegistration(
  registration: ServiceWorkerRegistration
): boolean {
  const worker = registration.active ?? registration.waiting ?? registration.installing;
  if (!worker) {
    return false;
  }
  try {
    return new URL(worker.scriptURL).pathname === STALE_SERVICE_WORKER_SCRIPT_PATH;
  } catch {
    return false;
  }
}

function unregisterStaleServiceWorker(): void {
  try {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.getRegistrations().then((registrations) => {
        registrations.filter(isStaleServiceWorkerRegistration).forEach((registration) => {
          void registration.unregister();
        });
      });
    }
    if ("caches" in window) {
      caches.keys().then((keys) => {
        keys
          .filter((key) => key.startsWith(STALE_CACHE_NAME_PREFIX))
          .forEach((key) => {
            void caches.delete(key);
          });
      });
    }
  } catch {
    // 未対応環境・権限エラー等は無視する（アプリ本体の起動には影響しない）
  }
}

unregisterStaleServiceWorker();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
