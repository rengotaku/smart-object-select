import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";

/**
 * 過去バージョン（本編/segment、issue #59で削除）で登録された Service Worker
 * （`public/sw.js`、削除済み）とそのモデルアセットキャッシュ（`CACHE_NAME_PREFIX`
 * `smart-object-select-model-assets-*`、旧 `src/lib/serviceWorker/cachePolicy.ts`、
 * 削除済み）を解除する。
 *
 * `public/sw.js` を削除して登録処理を main.tsx から外しただけでは、以前このアプリに
 * アクセスしたことがあるブラウザ（特に `wt dev` のように同一 origin/port を再利用する
 * ローカル開発環境）では、既に有効化済みの旧 Service Worker がブラウザ側に残り続け、
 * 全リクエストを横取りしたまま SlimSAM を含む大容量キャッシュも保持してしまう
 * （codex レビュー指摘、issue #59 PR #60）。このアプリは Service Worker /
 * Cache Storage を今後一切使わない前提のため、登録済み Worker・全キャッシュを
 * 無条件に解除・削除する。未対応環境・失敗時もアプリ本体の起動は妨げない。
 */
function unregisterStaleServiceWorker(): void {
  try {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.getRegistrations().then((registrations) => {
        registrations.forEach((registration) => {
          void registration.unregister();
        });
      });
    }
    if ("caches" in window) {
      caches.keys().then((keys) => {
        keys.forEach((key) => {
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
