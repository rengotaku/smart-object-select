import { describe, it, expect, vi } from "vitest";
import type { SamImageInput } from "@/lib/types";
import { YOLO11N_SEG_INPUT_NAME, YOLO11N_SEG_MODEL_URL } from "./constants";
import type {
  Yolo11nSegInferenceSession,
  Yolo11nSegRuntime,
  Yolo11nSegTensor,
} from "./onnxRuntime";
import { createYolo11nSegSession, Yolo11nSegDisposedError } from "./session";

const NUM_CLASSES = 80;
const MASK_PROTO_CHANNELS = 32;
const PRED_LEN = 4 + NUM_CLASSES + MASK_PROTO_CHANNELS;
const NUM_CANDIDATES = 2;
const MASK_PROTO_SIZE = 160;

function buildDetOutput(): Yolo11nSegTensor {
  const data = new Float32Array(PRED_LEN * NUM_CANDIDATES);
  // 候補0: person(class 0) を高信頼度で検出。box(cx,cy,w,h)=(320,320,100,100)（640空間中心）
  data[0 * NUM_CANDIDATES + 0] = 320;
  data[1 * NUM_CANDIDATES + 0] = 320;
  data[2 * NUM_CANDIDATES + 0] = 100;
  data[3 * NUM_CANDIDATES + 0] = 100;
  data[(4 + 0) * NUM_CANDIDATES + 0] = 0.95; // class 0 score
  // 候補1: 全クラス低スコア（閾値未満、破棄されるはず）
  return { data, dims: [1, PRED_LEN, NUM_CANDIDATES] };
}

function buildProtoOutput(): Yolo11nSegTensor {
  const data = new Float32Array(
    MASK_PROTO_CHANNELS * MASK_PROTO_SIZE * MASK_PROTO_SIZE
  ).fill(5); // 全チャンネル正のロジット -> 全面前景
  return { data, dims: [1, MASK_PROTO_CHANNELS, MASK_PROTO_SIZE, MASK_PROTO_SIZE] };
}

type RunFn = (
  feeds: Record<string, Yolo11nSegTensor>
) => Promise<Record<string, Yolo11nSegTensor>>;

function createFakeRuntime(overrides: {
  outputs?: Record<string, Yolo11nSegTensor>;
  runMock?: ReturnType<typeof vi.fn<RunFn>>;
}): { runtime: Yolo11nSegRuntime; createSessionMock: ReturnType<typeof vi.fn> } {
  const outputs = overrides.outputs ?? {
    output: buildDetOutput(),
    proto: buildProtoOutput(),
  };
  const runMock: ReturnType<typeof vi.fn<RunFn>> =
    overrides.runMock ?? vi.fn(async () => outputs);

  const createSessionMock = vi.fn(
    async (url: string): Promise<Yolo11nSegInferenceSession> => {
      if (url !== YOLO11N_SEG_MODEL_URL) {
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

describe("createYolo11nSegSession", () => {
  it("detect はモデル入力名でセッションを呼び、640x640のNCHWテンソルを渡す", async () => {
    const runMock = vi.fn().mockResolvedValue({
      output: buildDetOutput(),
      proto: buildProtoOutput(),
    });
    const { runtime } = createFakeRuntime({ runMock });

    const session = await createYolo11nSegSession(runtime);
    await session.detect(IMAGE);

    expect(runMock).toHaveBeenCalledTimes(1);
    const feeds = runMock.mock.calls[0][0] as Record<string, Yolo11nSegTensor>;
    expect(feeds[YOLO11N_SEG_INPUT_NAME].dims).toEqual([1, 3, 640, 640]);
    expect(feeds[YOLO11N_SEG_INPUT_NAME].data.length).toBe(3 * 640 * 640);
  });

  it("detect は出力を shape で識別しデコードした検出結果を返す", async () => {
    const { runtime } = createFakeRuntime({});
    const session = await createYolo11nSegSession(runtime);

    const result = await session.detect(IMAGE);

    expect(result).toHaveLength(1);
    expect(result[0].classId).toBe(0);
    expect(result[0].label).toBe("person");
    expect(result[0].score).toBeCloseTo(0.95, 5);
    // マスクは画像全体(8x8)ではなく、ボックス範囲のみを保持する（issue #49 codex レビュー指摘）。
    // 640空間ボックス(270,270,100,100)をスケール80で元画像(8x8)へ写像すると (3,3)-(5,5) になる。
    expect(result[0].mask.x).toBe(3);
    expect(result[0].mask.y).toBe(3);
    expect(result[0].mask.width).toBe(2);
    expect(result[0].mask.height).toBe(2);
  });

  it("出力テンソルの名前が異なっていても shape が一致すれば動作する（配布元差異対応）", async () => {
    const { runtime } = createFakeRuntime({
      outputs: {
        // mobilint/YOLO11n-seg の実際の出力名（NOTICE 参照）
        "onnx::Shape_520": buildProtoOutput(),
        output: buildDetOutput(),
      },
    });
    const session = await createYolo11nSegSession(runtime);

    const result = await session.detect(IMAGE);
    expect(result).toHaveLength(1);
  });

  it("期待する shape のテンソルが出力に無ければ例外を投げる", async () => {
    const { runtime } = createFakeRuntime({
      outputs: { onlyOne: buildDetOutput() },
    });
    const session = await createYolo11nSegSession(runtime);

    await expect(session.detect(IMAGE)).rejects.toThrow();
  });

  it("dispose 後は detect が Yolo11nSegDisposedError を投げる", async () => {
    const { runtime } = createFakeRuntime({});
    const session = await createYolo11nSegSession(runtime);
    session.dispose();

    await expect(session.detect(IMAGE)).rejects.toThrow(Yolo11nSegDisposedError);
  });

  it("セッションは1回だけ生成される", async () => {
    const { runtime, createSessionMock } = createFakeRuntime({});
    const session = await createYolo11nSegSession(runtime);

    await session.detect(IMAGE);
    await session.detect(IMAGE);

    expect(createSessionMock).toHaveBeenCalledTimes(1);
  });
});
