import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockRun = vi.fn();
const mockCreate = vi.fn();

// `onnxruntime-web` は実 WASM 推論を伴う重い依存のため、transformersLoader.ts と同様に
// 実パッケージを import せずモックする（本ファイルのテストは createOnnxRuntimeWebRuntime()
// が ort.InferenceSession.create / session.run をどう呼ぶかだけを検証する）。
vi.mock("onnxruntime-web", () => {
  class FakeTensor {
    type: string;
    data: unknown;
    dims: number[];
    constructor(type: string, data: unknown, dims: number[]) {
      this.type = type;
      this.data = data;
      this.dims = dims;
    }
  }

  return {
    env: { wasm: {} as Record<string, unknown> },
    Tensor: FakeTensor,
    InferenceSession: {
      create: (...args: unknown[]) => mockCreate(...args),
    },
  };
});

describe("createOnnxRuntimeWebRuntime", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let createObjectURLMock: ReturnType<typeof vi.fn>;
  let originalCreateObjectURL: typeof URL.createObjectURL;

  beforeEach(() => {
    // configureWasmPaths() は module-level のキャッシュ（wasmPathsPromise）を持つため、
    // テストごとに独立させるには resetModules + 動的 import で毎回フレッシュな
    // モジュールインスタンスを使う必要がある。
    vi.resetModules();
    mockRun.mockReset();
    mockCreate.mockReset();
    mockCreate.mockResolvedValue({ run: mockRun });

    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve("export default function ortWasmFactory() {}"),
    });
    vi.stubGlobal("fetch", fetchMock);

    createObjectURLMock = vi.fn(() => "blob:mock-mjs-url");
    originalCreateObjectURL = URL.createObjectURL;
    URL.createObjectURL = createObjectURLMock as typeof URL.createObjectURL;
    class FakeBlob {
      parts: unknown[];
      options?: { type?: string };
      constructor(parts: unknown[], options?: { type?: string }) {
        this.parts = parts;
        this.options = options;
      }
    }
    vi.stubGlobal("Blob", FakeBlob);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    URL.createObjectURL = originalCreateObjectURL;
  });

  it("wasm バックエンドで InferenceSession.create を呼ぶ", async () => {
    const { createOnnxRuntimeWebRuntime } = await import("./onnxRuntime");
    const runtime = createOnnxRuntimeWebRuntime();
    await runtime.createSession("/models/mobile-sam/foo.onnx");

    expect(mockCreate).toHaveBeenCalledWith("/models/mobile-sam/foo.onnx", {
      executionProviders: ["wasm"],
    });
  });

  it("自ホストの .wasm と、Blob URL 化した .mjs を wasmPaths に設定する", async () => {
    const ort = await import("onnxruntime-web");
    const { createOnnxRuntimeWebRuntime } = await import("./onnxRuntime");
    const runtime = createOnnxRuntimeWebRuntime();
    await runtime.createSession("/models/mobile-sam/foo.onnx");

    const wasmPaths = ort.env.wasm.wasmPaths as { wasm: string; mjs: string };
    expect(wasmPaths.wasm).toContain("/onnxruntime/");
    expect(wasmPaths.mjs).toBe("blob:mock-mjs-url");
  });

  it(".mjs は public/ 配下の URL を直接 wasmPaths に渡さず、fetch してから Blob URL に変換する", async () => {
    // Vite dev server は public/ 配下の .mjs への動的 import() を拒否するため
    // （実機確認で再現）、ort.env.wasm.wasmPaths.mjs には直接 URL を渡さず、
    // fetch() で中身を取得してから Blob URL 化する必要がある（onnxRuntime.ts 冒頭コメント参照）。
    const { createOnnxRuntimeWebRuntime } = await import("./onnxRuntime");
    const runtime = createOnnxRuntimeWebRuntime();
    await runtime.createSession("/models/mobile-sam/foo.onnx");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain("/onnxruntime/");
    expect(createObjectURLMock).toHaveBeenCalledTimes(1);
  });

  it("2回目以降の createSession では .mjs を再取得しない（キャッシュされる）", async () => {
    const { createOnnxRuntimeWebRuntime } = await import("./onnxRuntime");
    const runtime = createOnnxRuntimeWebRuntime();
    await runtime.createSession("/models/mobile-sam/foo.onnx");
    await runtime.createSession("/models/mobile-sam/bar.onnx");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("run() は MobileSamTensor を ort.Tensor へ変換して session.run に渡す", async () => {
    mockRun.mockResolvedValue({});

    const { createOnnxRuntimeWebRuntime } = await import("./onnxRuntime");
    const runtime = createOnnxRuntimeWebRuntime();
    const session = await runtime.createSession("/models/mobile-sam/foo.onnx");
    await session.run({
      in1: { data: new Float32Array([9, 9]), dims: [1, 2] },
    });

    expect(mockRun).toHaveBeenCalledTimes(1);
    const feeds = mockRun.mock.calls[0][0] as Record<
      string,
      { data: Float32Array; dims: number[] }
    >;
    expect(feeds.in1.dims).toEqual([1, 2]);
    expect(Array.from(feeds.in1.data)).toEqual([9, 9]);
  });

  it("run() は session.run の出力を MobileSamTensor へ変換して返す", async () => {
    mockRun.mockResolvedValue({
      out1: { data: new Float32Array([1, 2, 3]), dims: [1, 3] },
    });

    const { createOnnxRuntimeWebRuntime } = await import("./onnxRuntime");
    const runtime = createOnnxRuntimeWebRuntime();
    const session = await runtime.createSession("/models/mobile-sam/foo.onnx");
    const result = await session.run({
      in1: { data: new Float32Array([0]), dims: [1] },
    });

    expect(result.out1.dims).toEqual([1, 3]);
    expect(Array.from(result.out1.data)).toEqual([1, 2, 3]);
  });
});
