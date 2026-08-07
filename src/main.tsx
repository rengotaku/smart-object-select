import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { logger } from "./lib/logger";

/**
 * モデルアセットのオフラインキャッシュ用 Service Worker（public/sw.js）を登録する。
 * 未対応環境（`serviceWorker` が navigator に無い）や登録失敗時もアプリ本体の
 * 起動は妨げない（try/catch でフォールバックし、失敗時はログのみ残す）。
 *
 * `window.addEventListener("load", ...)` で遅延させず、スクリプト評価時に即座に
 * 登録する。初回アクセス直後にオフラインになった場合でも、SW の install 完了時点
 * でナビゲーションフォールバック用のアプリシェルキャッシュが用意されている必要が
 * あるため（public/sw.js の install ハンドラ参照）。
 */
function registerServiceWorker(): void {
  try {
    if (!("serviceWorker" in navigator)) {
      return;
    }
    navigator.serviceWorker.register("/sw.js").catch((error: unknown) => {
      logger.warn(
        "Service Worker registration failed; continuing without offline cache",
        error
      );
    });
  } catch (error) {
    logger.warn(
      "Service Worker registration threw synchronously; continuing without offline cache",
      error
    );
  }
}

registerServiceWorker();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
