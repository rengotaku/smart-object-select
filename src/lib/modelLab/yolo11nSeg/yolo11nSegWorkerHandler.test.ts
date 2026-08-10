import { describe, it, expect, vi } from "vitest";
import type { SamImageInput } from "@/lib/sam";
import { YOLO11N_SEG_MODEL_URL } from "./constants";
import { createYolo11nSegWorkerHandler } from "./yolo11nSegWorkerHandler";
import type { Yolo11nSegInferenceSession, Yolo11nSegRuntime } from "./onnxRuntime";

const NUM_CLASSES = 80;
const MASK_PROTO_CHANNELS = 32;
const PRED_LEN = 4 + NUM_CLASSES + MASK_PROTO_CHANNELS;
const MASK_PROTO_SIZE = 160;

function buildOutputs() {
  const detData = new Float32Array(PRED_LEN * 1);
  detData[0] = 8;
  detData[1] = 8;
  detData[2] = 4;
  detData[3] = 4;
  detData[4] = 0.9; // class 0
  const protoData = new Float32Array(
    MASK_PROTO_CHANNELS * MASK_PROTO_SIZE * MASK_PROTO_SIZE
  ).fill(5);

  return {
    output: { data: detData, dims: [1, PRED_LEN, 1] },
    proto: {
      data: protoData,
      dims: [1, MASK_PROTO_CHANNELS, MASK_PROTO_SIZE, MASK_PROTO_SIZE],
    },
  };
}

function createFakeRuntime(
  runMock = vi.fn().mockResolvedValue(buildOutputs())
): Yolo11nSegRuntime {
  return {
    async createSession(url: string): Promise<Yolo11nSegInferenceSession> {
      if (url !== YOLO11N_SEG_MODEL_URL) {
        throw new Error(`unexpected url: ${url}`);
      }
      return { run: runMock };
    },
  };
}

const IMAGE: SamImageInput = {
  data: new Uint8ClampedArray(16 * 16 * 4),
  width: 16,
  height: 16,
};

describe("createYolo11nSegWorkerHandler", () => {
  it("detect リクエストは検出結果の result 応答を返す", async () => {
    const handler = createYolo11nSegWorkerHandler(createFakeRuntime());

    const response = await handler.handle({ id: "req-1", type: "detect", image: IMAGE });

    expect(response.id).toBe("req-1");
    expect(response.type).toBe("result");
    const payload = (response as { payload: unknown[] }).payload;
    expect(Array.isArray(payload)).toBe(true);
    expect(payload).toHaveLength(1);
  });

  it("セッションは初回リクエストで一度だけ生成される", async () => {
    const createSession = vi.fn(createFakeRuntime().createSession);
    const runtime: Yolo11nSegRuntime = { createSession };
    const handler = createYolo11nSegWorkerHandler(runtime);

    await handler.handle({ id: "req-1", type: "detect", image: IMAGE });
    await handler.handle({ id: "req-2", type: "detect", image: IMAGE });

    expect(createSession).toHaveBeenCalledTimes(1);
  });

  it("推論中の例外は reject せずエラー応答に変換する", async () => {
    const runtime: Yolo11nSegRuntime = {
      async createSession() {
        return {
          run: () => {
            throw new Error("inference failed");
          },
        };
      },
    };
    const handler = createYolo11nSegWorkerHandler(runtime);

    const response = await handler.handle({ id: "req-1", type: "detect", image: IMAGE });

    expect(response).toMatchObject({
      id: "req-1",
      type: "error",
      message: "inference failed",
    });
  });
});
