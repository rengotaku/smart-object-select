import { describe, it, expect } from "vitest";
import {
  isCacheableAssetPath,
  buildCacheName,
  isExcludedFromAppShellCache,
  buildModelAssetPaths,
  WASM_RUNTIME_ASSET_PATHS,
  extractWorkerChunkUrls,
} from "./cachePolicy";

describe("isCacheableAssetPath", () => {
  // Case 1: キャッシュ対象パスの判定
  it("Case 1a: returns true for a model asset path under /models/", () => {
    expect(isCacheableAssetPath("/models/slimsam-77-uniform/config.json")).toBe(true);
  });

  it("Case 1b: returns true for an onnxruntime WASM runtime path under /onnxruntime/", () => {
    expect(
      isCacheableAssetPath("/onnxruntime/ort-wasm-simd-threaded.asyncify.wasm")
    ).toBe(true);
  });

  it("Case 1c: returns false for an unrelated API path", () => {
    expect(isCacheableAssetPath("/api/foo")).toBe(false);
  });

  it("Case 1d: returns false for the app shell (index.html)", () => {
    expect(isCacheableAssetPath("/index.html")).toBe(false);
  });

  it("Case 1e: returns false for the root path", () => {
    expect(isCacheableAssetPath("/")).toBe(false);
  });
});

describe("isExcludedFromAppShellCache", () => {
  // Case 3: アプリシェルキャッシュから除外すべき API パスの判定
  it("Case 3a: returns true for an API path under /api/", () => {
    expect(isExcludedFromAppShellCache("/api/v1/users")).toBe(true);
  });

  it("Case 3b: returns true for the login API path", () => {
    expect(isExcludedFromAppShellCache("/api/v1/auth/login")).toBe(true);
  });

  it("Case 3c: returns false for the app shell (index.html)", () => {
    expect(isExcludedFromAppShellCache("/index.html")).toBe(false);
  });

  it("Case 3d: returns false for a model asset path", () => {
    expect(isExcludedFromAppShellCache("/models/slimsam-77-uniform/config.json")).toBe(
      false
    );
  });
});

describe("buildCacheName", () => {
  // Case 2: キャッシュバージョンキーの生成
  it("Case 2a: returns a cache name that includes the model id and version", () => {
    const name = buildCacheName("slimsam-77-uniform", "v1");

    expect(name).toContain("slimsam-77-uniform");
    expect(name).toContain("v1");
  });

  it("Case 2b: different versions produce different cache names (enables stale cache eviction)", () => {
    const v1 = buildCacheName("slimsam-77-uniform", "v1");
    const v2 = buildCacheName("slimsam-77-uniform", "v2");

    expect(v1).not.toBe(v2);
  });

  it("Case 2c: different model ids produce different cache names", () => {
    const a = buildCacheName("slimsam-77-uniform", "v1");
    const b = buildCacheName("other-model", "v1");

    expect(a).not.toBe(b);
  });
});

describe("buildModelAssetPaths", () => {
  // Case 4: モデルアセットの固定 precache パス一覧の生成
  it("Case 4a: returns absolute paths for all required model files under the model id", () => {
    const paths = buildModelAssetPaths("slimsam-77-uniform");

    expect(paths).toEqual([
      "/models/slimsam-77-uniform/config.json",
      "/models/slimsam-77-uniform/preprocessor_config.json",
      "/models/slimsam-77-uniform/onnx/vision_encoder_quantized.onnx",
      "/models/slimsam-77-uniform/onnx/prompt_encoder_mask_decoder_quantized.onnx",
    ]);
  });

  it("Case 4b: different model ids produce paths scoped to their own directory", () => {
    const paths = buildModelAssetPaths("other-model");

    expect(paths.every((path) => path.startsWith("/models/other-model/"))).toBe(true);
  });
});

describe("WASM_RUNTIME_ASSET_PATHS", () => {
  // Case 5: onnxruntime WASM ランタイム（Safari版・非Safari版の両方）の固定 precache 対象
  it("Case 5a: includes both the Safari and asyncify (non-Safari) variants", () => {
    expect(WASM_RUNTIME_ASSET_PATHS).toEqual(
      expect.arrayContaining([
        "/onnxruntime/ort-wasm-simd-threaded.mjs",
        "/onnxruntime/ort-wasm-simd-threaded.wasm",
        "/onnxruntime/ort-wasm-simd-threaded.asyncify.mjs",
        "/onnxruntime/ort-wasm-simd-threaded.asyncify.wasm",
      ])
    );
  });

  it("Case 5b: every path is under /onnxruntime/", () => {
    expect(
      WASM_RUNTIME_ASSET_PATHS.every((path) => path.startsWith("/onnxruntime/"))
    ).toBe(true);
  });
});

describe("extractWorkerChunkUrls", () => {
  // Case 6: new Worker(new URL(...)) パターンからの Worker チャンク URL 抽出
  it("Case 6a: extracts a backtick-quoted (template literal) worker URL as emitted by Vite's minifier", () => {
    const js =
      "function zs(){return Rs(new Worker(new URL(`/assets/sam.worker-Bs5ExvMs.js`,``+import.meta.url),{type:`module`}))}";

    expect(extractWorkerChunkUrls(js)).toEqual(["/assets/sam.worker-Bs5ExvMs.js"]);
  });

  it("Case 6b: extracts a double-quoted worker URL", () => {
    const js = 'new Worker(new URL("/assets/sam.worker-ABCD.js", import.meta.url))';

    expect(extractWorkerChunkUrls(js)).toEqual(["/assets/sam.worker-ABCD.js"]);
  });

  it("Case 6c: extracts a single-quoted worker URL", () => {
    const js = "new Worker(new URL('/assets/sam.worker-ABCD.js', import.meta.url))";

    expect(extractWorkerChunkUrls(js)).toEqual(["/assets/sam.worker-ABCD.js"]);
  });

  it("Case 6d: ignores a relative (non-absolute) worker URL (dev-mode source reference)", () => {
    const js = 'new Worker(new URL("../lib/sam/sam.worker.ts", import.meta.url))';

    expect(extractWorkerChunkUrls(js)).toEqual([]);
  });

  it("Case 6e: returns an empty array when there is no new Worker(new URL(...)) call", () => {
    const js = "console.log('no worker here')";

    expect(extractWorkerChunkUrls(js)).toEqual([]);
  });

  it("Case 6f: deduplicates when the same worker URL appears multiple times", () => {
    const js =
      'new Worker(new URL("/assets/sam.worker-ABCD.js", import.meta.url)); new Worker(new URL("/assets/sam.worker-ABCD.js", import.meta.url));';

    expect(extractWorkerChunkUrls(js)).toEqual(["/assets/sam.worker-ABCD.js"]);
  });
});
