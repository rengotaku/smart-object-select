import { describe, it, expect, vi } from "vitest";
import type { SamImageInput } from "@/lib/types";
import { FASTSAM_INPUT_NAME, FASTSAM_MODEL_URL } from "./constants";
import type {
  FastSamInferenceSession,
  FastSamRuntime,
  FastSamTensor,
} from "./onnxRuntime";
import { createFastSamSession, FastSamDisposedError } from "./session";

const MASK_PROTO_CHANNELS = 32;
const PRED_LEN = 4 + 1 + MASK_PROTO_CHANNELS;
const NUM_CANDIDATES = 2;
const MASK_PROTO_SIZE = 256;

function buildDetOutput(): FastSamTensor {
  const data = new Float32Array(PRED_LEN * NUM_CANDIDATES);
  // 候補0: 高信頼度で検出。box(cx,cy,w,h)=(512,512,160,160)（1024空間中心）
  data[0 * NUM_CANDIDATES + 0] = 512;
  data[1 * NUM_CANDIDATES + 0] = 512;
  data[2 * NUM_CANDIDATES + 0] = 160;
  data[3 * NUM_CANDIDATES + 0] = 160;
  data[4 * NUM_CANDIDATES + 0] = 0.95; // objectness score
  // 候補1: 低スコア（閾値未満、破棄されるはず）
  data[4 * NUM_CANDIDATES + 1] = 0.01;
  return { data, dims: [1, PRED_LEN, NUM_CANDIDATES] };
}

function buildProtoOutput(): FastSamTensor {
  const data = new Float32Array(
    MASK_PROTO_CHANNELS * MASK_PROTO_SIZE * MASK_PROTO_SIZE
  ).fill(5); // 全チャンネル正のロジット -> 全面前景
  return { data, dims: [1, MASK_PROTO_CHANNELS, MASK_PROTO_SIZE, MASK_PROTO_SIZE] };
}

type RunFn = (
  feeds: Record<string, FastSamTensor>
) => Promise<Record<string, FastSamTensor>>;

function createFakeRuntime(overrides: {
  outputs?: Record<string, FastSamTensor>;
  runMock?: ReturnType<typeof vi.fn<RunFn>>;
}): { runtime: FastSamRuntime; createSessionMock: ReturnType<typeof vi.fn> } {
  const outputs = overrides.outputs ?? {
    output0: buildDetOutput(),
    output1: buildProtoOutput(),
  };
  const runMock: ReturnType<typeof vi.fn<RunFn>> =
    overrides.runMock ?? vi.fn(async () => outputs);

  const createSessionMock = vi.fn(
    async (url: string): Promise<FastSamInferenceSession> => {
      if (url !== FASTSAM_MODEL_URL) {
        throw new Error(`unexpected model url: ${url}`);
      }
      return { run: runMock };
    }
  );

  return { runtime: { createSession: createSessionMock }, createSessionMock };
}

const IMAGE: SamImageInput = {
  data: new Uint8ClampedArray(8 * 8 * 4),
  width: 8,
  height: 8,
};

describe("createFastSamSession", () => {
  it("detect はモデル入力名でセッションを呼び、1024x1024のNCHWテンソルを渡す", async () => {
    const runMock = vi.fn().mockResolvedValue({
      output0: buildDetOutput(),
      output1: buildProtoOutput(),
    });
    const { runtime } = createFakeRuntime({ runMock });

    const session = await createFastSamSession(runtime);
    await session.detect(IMAGE);

    expect(runMock).toHaveBeenCalledTimes(1);
    const feeds = runMock.mock.calls[0][0] as Record<string, FastSamTensor>;
    expect(feeds[FASTSAM_INPUT_NAME].dims).toEqual([1, 3, 1024, 1024]);
    expect(feeds[FASTSAM_INPUT_NAME].data.length).toBe(3 * 1024 * 1024);
  });

  it("detect は出力を shape で識別しデコードした検出結果を返す", async () => {
    const { runtime } = createFakeRuntime({});
    const session = await createFastSamSession(runtime);

    const result = await session.detect(IMAGE);

    expect(result).toHaveLength(1);
    expect(result[0].score).toBeCloseTo(0.95, 5);
    // マスクは画像全体(8x8)ではなく、ボックス範囲のみを保持する。
    // 1024空間ボックス(432,432,160,160)をスケール128で元画像(8x8)へ写像すると (3,3)-(4,4) 付近になる。
    expect(result[0].mask.x).toBeGreaterThanOrEqual(2);
    expect(result[0].mask.width).toBeGreaterThan(0);
    expect(result[0].mask.height).toBeGreaterThan(0);
  });

  it("出力テンソルの名前が異なっていても shape が一致すれば動作する（配布元差異対応）", async () => {
    const { runtime } = createFakeRuntime({
      outputs: {
        proto: buildProtoOutput(),
        det: buildDetOutput(),
      },
    });
    const session = await createFastSamSession(runtime);

    const result = await session.detect(IMAGE);
    expect(result).toHaveLength(1);
  });

  it("期待する shape のテンソルが出力に無ければ例外を投げる", async () => {
    const { runtime } = createFakeRuntime({
      outputs: { onlyOne: buildDetOutput() },
    });
    const session = await createFastSamSession(runtime);

    await expect(session.detect(IMAGE)).rejects.toThrow();
  });

  it("dispose 後は detect が FastSamDisposedError を投げる", async () => {
    const { runtime } = createFakeRuntime({});
    const session = await createFastSamSession(runtime);
    session.dispose();

    await expect(session.detect(IMAGE)).rejects.toThrow(FastSamDisposedError);
  });

  it("セッションは1回だけ生成される", async () => {
    const { runtime, createSessionMock } = createFakeRuntime({});
    const session = await createFastSamSession(runtime);

    await session.detect(IMAGE);
    await session.detect(IMAGE);

    expect(createSessionMock).toHaveBeenCalledTimes(1);
  });
});
