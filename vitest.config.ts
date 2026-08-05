import { defineConfig } from "vitest/config";
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
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "json-summary", "html"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/test/**",
        "src/main.tsx",
        "src/vite-env.d.ts",
        // shared-react-ui primitive: shipped to every template via compose
        // even when not referenced by app code. Coverage is enforced via
        // shared-react-ui's gallery, not via per-template integration.
        "src/components/ui/time-picker.tsx",
        // Web Worker entry point: only wires self.onmessage to the handler.
        // Cannot be exercised in jsdom (no real Worker runtime); the routed
        // logic (samWorkerHandler.ts) is unit-tested directly instead.
        "src/lib/sam/sam.worker.ts",
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
