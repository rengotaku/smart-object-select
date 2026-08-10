import { defineConfig, configDefaults } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    // server/ はローカル推論サーバー用の独立した npm パッケージ（自前の
    // node_modules・vitest.config.ts・`npm test` を持つ、issue #32）。
    // ルートの vitest はデフォルトで node_modules 配下しか除外しないため、
    // 除外しないと server/test/**/*.test.ts を jsdom 環境で拾ってしまい失敗する。
    exclude: [...configDefaults.exclude, "server/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "json-summary", "html"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/test/**",
        "src/main.tsx",
        "src/vite-env.d.ts",
        // Web Worker entry point: only wires self.onmessage to the handler.
        // Cannot be exercised in jsdom (no real Worker runtime); the routed
        // logic (samWorkerHandler.ts) is unit-tested directly instead.
        "src/lib/sam/sam.worker.ts",
        // Same reason as sam.worker.ts above, for the MobileSAM worker entry
        // point (issue #47). The routed logic (mobileSamWorkerHandler.ts) is
        // unit-tested directly instead.
        "src/lib/modelLab/mobileSam/mobileSam.worker.ts",
        // Thin adapter around the real @huggingface/transformers package.
        // Importing the real package in tests would pull model weights and
        // make CI slow/flaky; samSession.ts is tested against a fake
        // SamRuntime instead, so this adapter has no dedicated unit test.
        "src/lib/sam/transformersLoader.ts",
        // Decode File to RGBA ImageData via HTMLImageElement & HTMLCanvasElement.
        // Relies on DOM Image decoding / Canvas 2D context which jsdom does not support;
        // isImageFile is tested separately via unit tests.
        "src/lib/sam/imageLoader.ts",
      ],
    },
  },
});
