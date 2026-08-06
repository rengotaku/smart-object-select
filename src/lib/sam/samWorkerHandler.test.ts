import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createSamWorkerHandler } from "./samWorkerHandler";
import type {
  SamRuntime,
  SamModelLike,
  SamProcessorLike,
  SamImageInputs,
  MaskTensorLike,
} from "./samSession";
import type { SamImageInput } from "./types";

const image: SamImageInput = { data: new Uint8ClampedArray(16), width: 2, height: 2 };

function createFakeProcessor(): SamProcessorLike {
  return {
    process: vi.fn(
      async (img: SamImageInput): Promise<SamImageInputs> => ({
        originalSizes: [[img.height, img.width]],
        reshapedInputSizes: [[img.height, img.width]],
      })
    ),
    reshapeInputPoints: vi.fn(() => [[[1, 1]]]),
    addInputLabels: vi.fn(() => [[1, 0]]),
    postProcessMasks: vi.fn(
      async (): Promise<MaskTensorLike[]> => [
        { data: new Uint8Array([0, 255, 0, 255]), dims: [1, 1, 2, 2] },
      ]
    ),
  };
}

function createFakeModel(): SamModelLike {
  return {
    getImageEmbeddings: vi.fn(async () => ({})),
    decode: vi.fn(async () => ({ predMasks: {}, iouScores: [[[0.9]]] })),
  };
}

function createFakeRuntime(): SamRuntime {
  return {
    loadModel: vi.fn(async () => createFakeModel()),
    loadProcessor: vi.fn(async () => createFakeProcessor()),
  };
}

describe("createSamWorkerHandler", () => {
  // Case 12 の前提 「globalThis.navigator.gpu 不在」を保証するため save-restore する
  let originalGpu: unknown;

  beforeEach(() => {
    originalGpu = (globalThis.navigator as unknown as { gpu?: unknown }).gpu;
    delete (globalThis.navigator as unknown as { gpu?: unknown }).gpu;
  });

  afterEach(() => {
    if (originalGpu !== undefined) {
      (globalThis.navigator as unknown as { gpu?: unknown }).gpu = originalGpu;
    }
  });

  it("Case 12: an init request resolves with the detected device", async () => {
    const handler = createSamWorkerHandler(createFakeRuntime());

    const response = await handler.handle({ id: "a1", type: "init" });

    expect(response).toEqual({ id: "a1", type: "result", payload: "wasm" });
  });

  it("Case 13: a segment request returns a mask", async () => {
    const handler = createSamWorkerHandler(createFakeRuntime());
    await handler.handle({ id: "init-1", type: "init" });
    await handler.handle({ id: "set-1", type: "setImage", image });

    const response = await handler.handle({ id: "b2", type: "segment", x: 1, y: 1 });

    expect(response).toEqual({
      id: "b2",
      type: "result",
      payload: [{ width: 2, height: 2, score: 0.9, data: new Uint8Array([0, 1, 0, 1]) }],
    });
  });

  it("Case 14: an exception is converted into an error response instead of throwing", async () => {
    const handler = createSamWorkerHandler(createFakeRuntime());
    await handler.handle({ id: "init-1", type: "init" });

    const response = await handler.handle({ id: "c3", type: "segment", x: 1, y: 1 });

    expect(response).toMatchObject({
      id: "c3",
      type: "error",
      name: "SamNoImageError",
    });
    expect((response as { message: string }).message).toEqual(expect.any(String));
  });

  it("追加: setImage/segment を init 前に送ると reject せずエラー応答を返す", async () => {
    const handler = createSamWorkerHandler(createFakeRuntime());

    const response = await handler.handle({ id: "d4", type: "segment", x: 1, y: 1 });

    expect(response.type).toBe("error");
    expect(response.id).toBe("d4");
  });

  it("segmentAtPoints リクエストを処理してマスク結果を返す", async () => {
    const handler = createSamWorkerHandler(createFakeRuntime());
    await handler.handle({ id: "init-1", type: "init" });
    await handler.handle({ id: "set-1", type: "setImage", image });

    const response = await handler.handle({
      id: "sp-1",
      type: "segmentAtPoints",
      points: [
        { x: 1, y: 1, label: 1 },
        { x: 2, y: 2, label: 0 },
      ],
    });

    expect(response).toEqual({
      id: "sp-1",
      type: "result",
      payload: [{ width: 2, height: 2, score: 0.9, data: new Uint8Array([0, 1, 0, 1]) }],
    });
  });
});
