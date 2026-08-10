import { describe, it, expect, vi } from "vitest";
import type { SamImageInput } from "@/lib/sam";
import { MOBILE_SAM_DECODER_URL, MOBILE_SAM_ENCODER_URL } from "./constants";
import { createMobileSamWorkerHandler } from "./mobileSamWorkerHandler";
import type {
  MobileSamInferenceSession,
  MobileSamRuntime,
  MobileSamTensor,
} from "./onnxRuntime";

type RunFn = (feeds: Record<string, MobileSamTensor>) => Record<string, MobileSamTensor>;

const DEFAULT_ENCODER_RUN: RunFn = () => ({
  image_embeddings: { data: new Float32Array(4), dims: [1, 1, 2, 2] },
});
const DEFAULT_DECODER_RUN: RunFn = () => ({
  masks: { data: new Float32Array([1, -1, -1, 1]), dims: [1, 1, 2, 2] },
  iou_predictions: { data: new Float32Array([0.9]), dims: [1, 1] },
});

function createFakeRuntime(
  overrides: { encoderRun?: RunFn; decoderRun?: RunFn } = {}
): MobileSamRuntime {
  const encoderRun = overrides.encoderRun ?? DEFAULT_ENCODER_RUN;
  const decoderRun = overrides.decoderRun ?? DEFAULT_DECODER_RUN;

  return {
    async createSession(url: string): Promise<MobileSamInferenceSession> {
      if (url === MOBILE_SAM_ENCODER_URL) {
        return { run: (feeds) => Promise.resolve(encoderRun(feeds)) };
      }
      if (url === MOBILE_SAM_DECODER_URL) {
        return { run: (feeds) => Promise.resolve(decoderRun(feeds)) };
      }
      throw new Error(`unexpected url: ${url}`);
    },
  };
}

const IMAGE: SamImageInput = {
  data: new Uint8ClampedArray(2 * 2 * 4),
  width: 2,
  height: 2,
};

describe("createMobileSamWorkerHandler", () => {
  it("setImage リクエストは result 応答を返す", async () => {
    const handler = createMobileSamWorkerHandler(createFakeRuntime());

    const response = await handler.handle({
      id: "req-1",
      type: "setImage",
      image: IMAGE,
    });

    expect(response).toEqual({ id: "req-1", type: "result", payload: undefined });
  });

  it("setImage 後の segmentAtPoint リクエストはマスクを返す", async () => {
    const handler = createMobileSamWorkerHandler(createFakeRuntime());
    await handler.handle({ id: "req-1", type: "setImage", image: IMAGE });

    const response = await handler.handle({
      id: "req-2",
      type: "segmentAtPoint",
      x: 1,
      y: 1,
    });

    expect(response.id).toBe("req-2");
    expect(response.type).toBe("result");
    const payload = (
      response as {
        payload: { data: Uint8Array; width: number; height: number; score: number };
      }
    ).payload;
    expect(Array.from(payload.data)).toEqual([1, 0, 0, 1]);
    expect(payload.width).toBe(2);
    expect(payload.height).toBe(2);
    expect(payload.score).toBeCloseTo(0.9, 5);
  });

  it("setImage 前に segmentAtPoint を送ると reject せずエラー応答を返す", async () => {
    const handler = createMobileSamWorkerHandler(createFakeRuntime());

    const response = await handler.handle({
      id: "req-1",
      type: "segmentAtPoint",
      x: 0,
      y: 0,
    });

    expect(response.type).toBe("error");
    expect(response.id).toBe("req-1");
    expect((response as { name: string }).name).toBe("MobileSamNoImageError");
  });

  it("セッションは初回リクエストで一度だけ生成される（2回目以降は使い回す）", async () => {
    const createSession = vi.fn(createFakeRuntime().createSession);
    const runtime: MobileSamRuntime = { createSession };
    const handler = createMobileSamWorkerHandler(runtime);

    await handler.handle({ id: "req-1", type: "setImage", image: IMAGE });
    await handler.handle({ id: "req-2", type: "segmentAtPoint", x: 0, y: 0 });
    await handler.handle({ id: "req-3", type: "segmentAtPoint", x: 1, y: 1 });

    // エンコーダ・デコーダそれぞれ1回ずつ（=セッションは1回だけ生成）
    expect(createSession).toHaveBeenCalledTimes(2);
  });

  it("推論中の例外は reject せずエラー応答に変換する", async () => {
    const runtime = createFakeRuntime({
      decoderRun: () => {
        throw new Error("decode failed");
      },
    });
    const handler = createMobileSamWorkerHandler(runtime);
    await handler.handle({ id: "req-1", type: "setImage", image: IMAGE });

    const response = await handler.handle({
      id: "req-2",
      type: "segmentAtPoint",
      x: 0,
      y: 0,
    });

    expect(response).toMatchObject({
      id: "req-2",
      type: "error",
      message: "decode failed",
    });
  });
});
