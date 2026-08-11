import { describe, it, expect, vi } from "vitest";
import type { SamImageInput } from "@/lib/types";
import { MOBILE_SAM_DECODER_URL, MOBILE_SAM_ENCODER_URL } from "./constants";
import { createMobileSamWorkerHandler } from "./mobileSamWorkerHandler";
import type {
  MobileSamInferenceSession,
  MobileSamRuntime,
  MobileSamTensor,
} from "./onnxRuntime";

/**
 * setTimeout 等でタイミングを作らず、手動で resolve/reject できる deferred promise。
 * `mobileSam.worker.ts` の onmessage が先行リクエストの完了を待たずに次を処理する
 * 競合状態を決定的に再現するために使う。
 */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

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

  it(
    "画像Aのエンコード中に画像Bへのsetimageリクエストが割り込み、" +
      "Aが後から完了しても後続の segmentAtPoint は画像Bに基づく結果を返す" +
      "（onmessage は先行リクエストの完了を待たない。codex レビュー指摘の再発防止）",
    async () => {
      const deferredA = deferred<Record<string, MobileSamTensor>>();
      const deferredB = deferred<Record<string, MobileSamTensor>>();
      const embeddingsQueue = [deferredA, deferredB];
      let callIndex = 0;
      const encoderRun = vi.fn(() => embeddingsQueue[callIndex++]!.promise);
      const decoderRun = vi.fn((feeds: Record<string, MobileSamTensor>) =>
        Promise.resolve(DEFAULT_DECODER_RUN(feeds))
      );

      const runtime: MobileSamRuntime = {
        async createSession(url: string): Promise<MobileSamInferenceSession> {
          if (url === MOBILE_SAM_ENCODER_URL) {
            return { run: encoderRun };
          }
          if (url === MOBILE_SAM_DECODER_URL) {
            return { run: decoderRun };
          }
          throw new Error(`unexpected url: ${url}`);
        },
      };
      const handler = createMobileSamWorkerHandler(runtime);

      const imageB: SamImageInput = {
        data: new Uint8ClampedArray(2 * 2 * 4),
        width: 3,
        height: 3,
      };

      // mobileSam.worker.ts の onmessage は setImage(A) の完了を待たずに setImage(B) を
      // 処理へ回す（Promise を await しない fire-and-forget）ため、ここでも両方の
      // handle() 呼び出しを await せずに並行実行する。
      const handleA = handler.handle({ id: "req-A", type: "setImage", image: IMAGE });
      const handleB = handler.handle({ id: "req-B", type: "setImage", image: imageB });

      // Bが先に完了し、Aが後から遅れて完了する。
      deferredB.resolve({
        image_embeddings: { data: new Float32Array([2]), dims: [1, 1, 1, 1] },
      });
      await handleB;
      deferredA.resolve({
        image_embeddings: { data: new Float32Array([1]), dims: [1, 1, 1, 1] },
      });
      await handleA;

      const response = await handler.handle({
        id: "req-C",
        type: "segmentAtPoint",
        x: 0,
        y: 0,
      });

      expect(response.type).toBe("result");
      expect(decoderRun).toHaveBeenCalledTimes(1);
      const feeds = decoderRun.mock.calls[0][0] as Record<string, MobileSamTensor>;
      // 画像B（3x3）のサイズ・embeddings が使われること（画像Aで上書きされていないこと）
      expect(Array.from(feeds.orig_im_size.data)).toEqual([3, 3]);
      expect(Array.from(feeds.image_embeddings.data)).toEqual([2]);
    }
  );
});
