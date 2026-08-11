import { describe, it, expect, vi } from "vitest";
import type { SamImageInput } from "@/lib/types";
import { EDGE_SAM_DECODER_URL, EDGE_SAM_ENCODER_URL } from "./constants";
import type {
  EdgeSamInferenceSession,
  EdgeSamRuntime,
  EdgeSamTensor,
} from "./onnxRuntime";
import {
  createEdgeSamSession,
  EdgeSamDisposedError,
  EdgeSamNoImageError,
  EdgeSamStaleRequestError,
} from "./session";

/**
 * setTimeout 等でタイミングを作らず、手動で resolve/reject できる deferred promise。
 * setImage の競合状態を決定的に再現するために使う（mobileSam/session.test.ts の
 * 同名ヘルパーに倣う）。
 */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

type RunFn = (feeds: Record<string, EdgeSamTensor>) => Record<string, EdgeSamTensor>;

function createFakeRuntime(options: { encoderRun: RunFn; decoderRun: RunFn }): {
  runtime: EdgeSamRuntime;
  encoderRunMock: ReturnType<typeof vi.fn>;
  decoderRunMock: ReturnType<typeof vi.fn>;
} {
  const encoderRunMock = vi.fn((feeds: Record<string, EdgeSamTensor>) =>
    Promise.resolve(options.encoderRun(feeds))
  );
  const decoderRunMock = vi.fn((feeds: Record<string, EdgeSamTensor>) =>
    Promise.resolve(options.decoderRun(feeds))
  );

  const runtime: EdgeSamRuntime = {
    async createSession(url: string): Promise<EdgeSamInferenceSession> {
      if (url === EDGE_SAM_ENCODER_URL) {
        return { run: encoderRunMock };
      }
      if (url === EDGE_SAM_DECODER_URL) {
        return { run: decoderRunMock };
      }
      throw new Error(`unexpected model url: ${url}`);
    },
  };

  return { runtime, encoderRunMock, decoderRunMock };
}

const IMAGE: SamImageInput = {
  data: new Uint8ClampedArray(4 * 4 * 4),
  width: 4,
  height: 4,
};

const DEFAULT_ENCODER_RUN: RunFn = () => ({
  image_embeddings: { data: new Float32Array(4), dims: [1, 1, 2, 2] },
});
const DEFAULT_DECODER_RUN: RunFn = () => ({
  masks: { data: new Float32Array(4 * 4), dims: [1, 1, 4, 4] },
  scores: { data: new Float32Array([0.9]), dims: [1, 1] },
});

describe("createEdgeSamSession", () => {
  it("setImage はエンコーダを1回呼び、1024四方（EDGE_SAM_INPUT_SIZE）にリサイズした CHW 入力を渡す", async () => {
    const { runtime, encoderRunMock } = createFakeRuntime({
      encoderRun: DEFAULT_ENCODER_RUN,
      decoderRun: DEFAULT_DECODER_RUN,
    });

    const session = await createEdgeSamSession(runtime);
    await session.setImage(IMAGE);

    expect(encoderRunMock).toHaveBeenCalledTimes(1);
    const feeds = encoderRunMock.mock.calls[0][0] as Record<string, EdgeSamTensor>;
    // MobileSAM の [1024, 1024, 3]（HWC）とは異なり、EdgeSAM は [1, 3, 1024, 1024]（CHW）固定
    expect(feeds.image.dims).toEqual([1, 3, 1024, 1024]);
    expect(feeds.image.data.length).toBe(1024 * 1024 * 3);
  });

  it("segmentAtPoint はクリック座標を x/y 独立にエンコーダ空間へスケールし、パディング点無しでデコーダを呼ぶ", async () => {
    const { runtime, decoderRunMock } = createFakeRuntime({
      encoderRun: DEFAULT_ENCODER_RUN,
      decoderRun: DEFAULT_DECODER_RUN,
    });

    const session = await createEdgeSamSession(runtime);
    await session.setImage(IMAGE); // 4x4 -> scaleX = scaleY = 1024/4 = 256
    await session.segmentAtPoint(2, 1);

    expect(decoderRunMock).toHaveBeenCalledTimes(1);
    const feeds = decoderRunMock.mock.calls[0][0] as Record<string, EdgeSamTensor>;
    // MobileSAM と異なり、パディング点（label=-1）を付与しない（issue #48 実機検証で
    // パディング無しでも正しく動作することを確認済み）
    expect(Array.from(feeds.point_coords.data)).toEqual([512, 256]);
    expect(Array.from(feeds.point_labels.data)).toEqual([1]);
    expect(feeds.point_coords.dims).toEqual([1, 1, 2]);
    expect(feeds.point_labels.dims).toEqual([1, 1]);
    // MobileSAM の mask_input/has_mask_input/orig_im_size に相当する入力は無い
    expect(feeds.mask_input).toBeUndefined();
    expect(feeds.has_mask_input).toBeUndefined();
    expect(feeds.orig_im_size).toBeUndefined();
  });

  it("デコーダの masks をロジット > 0 で二値化し、スコア最大の候補マスクを選ぶ", async () => {
    // 4候補中 index=2 が最高スコア。handler.py（リファレンス実装）は常に index=0 を
    // 採用するが、issue #48 実機検証で「最高スコアの候補が最も正確」と確認したため、
    // このセッションは argmax(scores) を選ぶ設計（session.ts のコメント参照）。
    const maskPixels = 4; // 2x2
    const masksData = new Float32Array(4 * maskPixels);
    // index=0: 全部背景
    masksData.set([-1, -1, -1, -1], 0 * maskPixels);
    // index=1: 全部背景
    masksData.set([-1, -1, -1, -1], 1 * maskPixels);
    // index=2 (最高スコア): 対角線が前景
    masksData.set([1, -1, -1, 1], 2 * maskPixels);
    // index=3: 全部背景
    masksData.set([-1, -1, -1, -1], 3 * maskPixels);

    const { runtime } = createFakeRuntime({
      encoderRun: DEFAULT_ENCODER_RUN,
      decoderRun: () => ({
        masks: { data: masksData, dims: [1, 4, 2, 2] },
        scores: { data: new Float32Array([0.4, 0.5, 0.95, 0.6]), dims: [1, 4] },
      }),
    });

    const session = await createEdgeSamSession(runtime);
    await session.setImage(IMAGE);
    const result = await session.segmentAtPoint(0, 0);

    expect(Array.from(result.data)).toEqual([1, 0, 0, 1]);
    expect(result.width).toBe(2);
    expect(result.height).toBe(2);
    expect(result.score).toBeCloseTo(0.95);
  });

  it("setImage 前に segmentAtPoint を呼ぶと EdgeSamNoImageError を投げる", async () => {
    const { runtime } = createFakeRuntime({
      encoderRun: DEFAULT_ENCODER_RUN,
      decoderRun: DEFAULT_DECODER_RUN,
    });

    const session = await createEdgeSamSession(runtime);
    await expect(session.segmentAtPoint(0, 0)).rejects.toThrow(EdgeSamNoImageError);
  });

  it("dispose 後は setImage / segmentAtPoint が EdgeSamDisposedError を投げる", async () => {
    const { runtime } = createFakeRuntime({
      encoderRun: DEFAULT_ENCODER_RUN,
      decoderRun: DEFAULT_DECODER_RUN,
    });

    const session = await createEdgeSamSession(runtime);
    await session.setImage(IMAGE);
    session.dispose();

    await expect(session.setImage(IMAGE)).rejects.toThrow(EdgeSamDisposedError);
    await expect(session.segmentAtPoint(0, 0)).rejects.toThrow(EdgeSamDisposedError);
  });

  it("2回目の setImage で画像を差し替えると、以後の segmentAtPoint は新しいスケールを使う", async () => {
    const smallImage: SamImageInput = {
      data: new Uint8ClampedArray(2 * 2 * 4),
      width: 2,
      height: 2,
    };
    const { runtime, decoderRunMock } = createFakeRuntime({
      encoderRun: DEFAULT_ENCODER_RUN,
      decoderRun: DEFAULT_DECODER_RUN,
    });

    const session = await createEdgeSamSession(runtime);
    await session.setImage(IMAGE); // scale = 1024/4 = 256
    await session.setImage(smallImage); // scale = 1024/2 = 512
    await session.segmentAtPoint(1, 1);

    const feeds = decoderRunMock.mock.calls[0][0] as Record<string, EdgeSamTensor>;
    expect(Array.from(feeds.point_coords.data)).toEqual([512, 512]);
  });

  it(
    "画像Aのエンコード中に画像Bへ切り替え、Aが後から完了しても embeddings を上書きしない" +
      "（世代ガード。issue #48 で最初から組み込み済み）",
    async () => {
      const deferredA = deferred<Record<string, EdgeSamTensor>>();
      const deferredB = deferred<Record<string, EdgeSamTensor>>();
      const embeddingsQueue = [deferredA, deferredB];
      let callIndex = 0;
      const encoderRunMock = vi.fn(() => embeddingsQueue[callIndex++]!.promise);
      const decoderRunMock = vi.fn((feeds: Record<string, EdgeSamTensor>) =>
        Promise.resolve(DEFAULT_DECODER_RUN(feeds))
      );

      const runtime: EdgeSamRuntime = {
        async createSession(url: string): Promise<EdgeSamInferenceSession> {
          if (url === EDGE_SAM_ENCODER_URL) {
            return { run: encoderRunMock };
          }
          if (url === EDGE_SAM_DECODER_URL) {
            return { run: decoderRunMock };
          }
          throw new Error(`unexpected model url: ${url}`);
        },
      };

      const imageB: SamImageInput = {
        data: new Uint8ClampedArray(2 * 2 * 4),
        width: 2,
        height: 2,
      };

      const session = await createEdgeSamSession(runtime);

      // 画像A（4x4）のエンコード中に、画像B（2x2）へすぐ切り替える
      // （「別の画像を選ぶ」→即クリック、を再現）。
      const setImageA = session.setImage(IMAGE);
      const setImageB = session.setImage(imageB);

      // Bが先に完了し、Aが後から遅れて完了する（Worker の onmessage は先行リクエストの
      // 完了を待たずに次を処理するため、実際にこの順で完了しうる）。
      deferredB.resolve({
        image_embeddings: { data: new Float32Array([2]), dims: [1, 1, 1, 1] },
      });
      await setImageB;
      deferredA.resolve({
        image_embeddings: { data: new Float32Array([1]), dims: [1, 1, 1, 1] },
      });
      await setImageA;

      await session.segmentAtPoint(1, 1);

      const feeds = decoderRunMock.mock.calls[0][0] as Record<string, EdgeSamTensor>;
      // 画像Bのスケール・embeddings が使われ続けること（後から完了した画像Aで
      // 上書きされていないこと）を確認する。scale = 1024/2 = 512
      expect(Array.from(feeds.point_coords.data)).toEqual([512, 512]);
      expect(Array.from(feeds.image_embeddings.data)).toEqual([2]);
    }
  );

  it("segmentAtPoint の decode 待機中に新しい setImage が来ると EdgeSamStaleRequestError で reject する", async () => {
    const decodeDeferred = deferred<Record<string, EdgeSamTensor>>();
    const encoderRunMock = vi.fn((feeds: Record<string, EdgeSamTensor>) =>
      Promise.resolve(DEFAULT_ENCODER_RUN(feeds))
    );
    const decoderRunMock = vi.fn(() => decodeDeferred.promise);

    const runtime: EdgeSamRuntime = {
      async createSession(url: string): Promise<EdgeSamInferenceSession> {
        if (url === EDGE_SAM_ENCODER_URL) {
          return { run: encoderRunMock };
        }
        if (url === EDGE_SAM_DECODER_URL) {
          return { run: decoderRunMock };
        }
        throw new Error(`unexpected model url: ${url}`);
      },
    };

    const imageB: SamImageInput = {
      data: new Uint8ClampedArray(2 * 2 * 4),
      width: 2,
      height: 2,
    };

    const session = await createEdgeSamSession(runtime);
    await session.setImage(IMAGE);

    const segmentPromise = session.segmentAtPoint(1, 1);
    await session.setImage(imageB);
    decodeDeferred.resolve(DEFAULT_DECODER_RUN({}));

    await expect(segmentPromise).rejects.toBeInstanceOf(EdgeSamStaleRequestError);
  });

  it("画像Aの setImage が pending のまま segmentAtPoint を呼ぶと EdgeSamNoImageError を投げる", async () => {
    const { runtime } = createFakeRuntime({
      encoderRun: DEFAULT_ENCODER_RUN,
      decoderRun: DEFAULT_DECODER_RUN,
    });

    const session = await createEdgeSamSession(runtime);
    const setImagePromise = session.setImage(IMAGE);

    await expect(session.segmentAtPoint(0, 0)).rejects.toThrow(EdgeSamNoImageError);

    await setImagePromise;
  });
});
