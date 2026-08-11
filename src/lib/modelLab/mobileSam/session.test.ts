import { describe, it, expect, vi } from "vitest";
import type { SamImageInput } from "@/lib/types";
import { MOBILE_SAM_DECODER_URL, MOBILE_SAM_ENCODER_URL } from "./constants";
import type {
  MobileSamInferenceSession,
  MobileSamRuntime,
  MobileSamTensor,
} from "./onnxRuntime";
import {
  createMobileSamSession,
  MobileSamDisposedError,
  MobileSamNoImageError,
  MobileSamStaleRequestError,
} from "./session";

/**
 * setTimeout 等でタイミングを作らず、手動で resolve/reject できる deferred promise。
 * setImage の競合状態を決定的に再現するために使う（samSession.test.ts の同名ヘルパーに倣う）。
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

type RunFn = (feeds: Record<string, MobileSamTensor>) => Record<string, MobileSamTensor>;

function createFakeRuntime(options: { encoderRun: RunFn; decoderRun: RunFn }): {
  runtime: MobileSamRuntime;
  encoderRunMock: ReturnType<typeof vi.fn>;
  decoderRunMock: ReturnType<typeof vi.fn>;
} {
  const encoderRunMock = vi.fn((feeds: Record<string, MobileSamTensor>) =>
    Promise.resolve(options.encoderRun(feeds))
  );
  const decoderRunMock = vi.fn((feeds: Record<string, MobileSamTensor>) =>
    Promise.resolve(options.decoderRun(feeds))
  );

  const runtime: MobileSamRuntime = {
    async createSession(url: string): Promise<MobileSamInferenceSession> {
      if (url === MOBILE_SAM_ENCODER_URL) {
        return { run: encoderRunMock };
      }
      if (url === MOBILE_SAM_DECODER_URL) {
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
  iou_predictions: { data: new Float32Array([0.9]), dims: [1, 1] },
});

describe("createMobileSamSession", () => {
  it("setImage はエンコーダを1回呼び、長辺 1024 にリサイズした入力を渡す", async () => {
    const { runtime, encoderRunMock } = createFakeRuntime({
      encoderRun: DEFAULT_ENCODER_RUN,
      decoderRun: DEFAULT_DECODER_RUN,
    });

    const session = await createMobileSamSession(runtime);
    await session.setImage(IMAGE);

    expect(encoderRunMock).toHaveBeenCalledTimes(1);
    const feeds = encoderRunMock.mock.calls[0][0] as Record<string, MobileSamTensor>;
    // 4x4 (正方形) は長辺 targetLongSide=1024 にリサイズされる
    expect(feeds.input_image.dims).toEqual([1024, 1024, 3]);
    expect(feeds.input_image.data.length).toBe(1024 * 1024 * 3);
  });

  it("segmentAtPoint はクリック座標をエンコーダ空間へスケールし、パディング点付きでデコーダを呼ぶ", async () => {
    const { runtime, decoderRunMock } = createFakeRuntime({
      encoderRun: DEFAULT_ENCODER_RUN,
      decoderRun: DEFAULT_DECODER_RUN,
    });

    const session = await createMobileSamSession(runtime);
    await session.setImage(IMAGE); // 4x4 -> scale = 1024/4 = 256
    await session.segmentAtPoint(2, 1);

    expect(decoderRunMock).toHaveBeenCalledTimes(1);
    const feeds = decoderRunMock.mock.calls[0][0] as Record<string, MobileSamTensor>;
    expect(Array.from(feeds.point_coords.data)).toEqual([512, 256, 0, 0]);
    expect(Array.from(feeds.point_labels.data)).toEqual([1, -1]);
    expect(feeds.has_mask_input.data[0]).toBe(0);
    expect(Array.from(feeds.orig_im_size.data)).toEqual([4, 4]); // [height, width]
    expect(feeds.mask_input.dims).toEqual([1, 1, 256, 256]);
  });

  it("デコーダの masks をロジット > 0 で二値化し、iou_predictions を score にする", async () => {
    const maskData = new Float32Array([1, -1, -1, 1]);
    const { runtime } = createFakeRuntime({
      encoderRun: DEFAULT_ENCODER_RUN,
      decoderRun: () => ({
        masks: { data: maskData, dims: [1, 1, 2, 2] },
        iou_predictions: { data: new Float32Array([0.75]), dims: [1, 1] },
      }),
    });

    const session = await createMobileSamSession(runtime);
    await session.setImage(IMAGE);
    const result = await session.segmentAtPoint(0, 0);

    expect(Array.from(result.data)).toEqual([1, 0, 0, 1]);
    expect(result.width).toBe(2);
    expect(result.height).toBe(2);
    expect(result.score).toBe(0.75);
  });

  it("setImage 前に segmentAtPoint を呼ぶと MobileSamNoImageError を投げる", async () => {
    const { runtime } = createFakeRuntime({
      encoderRun: DEFAULT_ENCODER_RUN,
      decoderRun: DEFAULT_DECODER_RUN,
    });

    const session = await createMobileSamSession(runtime);
    await expect(session.segmentAtPoint(0, 0)).rejects.toThrow(MobileSamNoImageError);
  });

  it("dispose 後は setImage / segmentAtPoint が MobileSamDisposedError を投げる", async () => {
    const { runtime } = createFakeRuntime({
      encoderRun: DEFAULT_ENCODER_RUN,
      decoderRun: DEFAULT_DECODER_RUN,
    });

    const session = await createMobileSamSession(runtime);
    await session.setImage(IMAGE);
    session.dispose();

    await expect(session.setImage(IMAGE)).rejects.toThrow(MobileSamDisposedError);
    await expect(session.segmentAtPoint(0, 0)).rejects.toThrow(MobileSamDisposedError);
  });

  it("2回目の setImage で画像を差し替えると、以後の segmentAtPoint は新しい画像サイズを使う", async () => {
    const smallImage: SamImageInput = {
      data: new Uint8ClampedArray(2 * 2 * 4),
      width: 2,
      height: 2,
    };
    const { runtime, decoderRunMock } = createFakeRuntime({
      encoderRun: DEFAULT_ENCODER_RUN,
      decoderRun: DEFAULT_DECODER_RUN,
    });

    const session = await createMobileSamSession(runtime);
    await session.setImage(IMAGE);
    await session.setImage(smallImage);
    await session.segmentAtPoint(1, 1);

    const feeds = decoderRunMock.mock.calls[0][0] as Record<string, MobileSamTensor>;
    expect(Array.from(feeds.orig_im_size.data)).toEqual([2, 2]);
  });

  it(
    "画像Aのエンコード中に画像Bへ切り替え、Aが後から完了しても embeddings を上書きしない" +
      "（世代ガード。codex レビュー指摘の再発防止）",
    async () => {
      const deferredA = deferred<Record<string, MobileSamTensor>>();
      const deferredB = deferred<Record<string, MobileSamTensor>>();
      const embeddingsQueue = [deferredA, deferredB];
      let callIndex = 0;
      const encoderRunMock = vi.fn(() => embeddingsQueue[callIndex++]!.promise);
      const decoderRunMock = vi.fn((feeds: Record<string, MobileSamTensor>) =>
        Promise.resolve(DEFAULT_DECODER_RUN(feeds))
      );

      const runtime: MobileSamRuntime = {
        async createSession(url: string): Promise<MobileSamInferenceSession> {
          if (url === MOBILE_SAM_ENCODER_URL) {
            return { run: encoderRunMock };
          }
          if (url === MOBILE_SAM_DECODER_URL) {
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

      const session = await createMobileSamSession(runtime);

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

      const feeds = decoderRunMock.mock.calls[0][0] as Record<string, MobileSamTensor>;
      // 画像Bのサイズ・embeddings が使われ続けること（後から完了した画像Aで
      // 上書きされていないこと）を確認する。
      expect(Array.from(feeds.orig_im_size.data)).toEqual([2, 2]);
      expect(Array.from(feeds.image_embeddings.data)).toEqual([2]);
    }
  );

  it("segmentAtPoint の decode 待機中に新しい setImage が来ると MobileSamStaleRequestError で reject する", async () => {
    const decodeDeferred = deferred<Record<string, MobileSamTensor>>();
    const encoderRunMock = vi.fn((feeds: Record<string, MobileSamTensor>) =>
      Promise.resolve(DEFAULT_ENCODER_RUN(feeds))
    );
    const decoderRunMock = vi.fn(() => decodeDeferred.promise);

    const runtime: MobileSamRuntime = {
      async createSession(url: string): Promise<MobileSamInferenceSession> {
        if (url === MOBILE_SAM_ENCODER_URL) {
          return { run: encoderRunMock };
        }
        if (url === MOBILE_SAM_DECODER_URL) {
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

    const session = await createMobileSamSession(runtime);
    await session.setImage(IMAGE);

    const segmentPromise = session.segmentAtPoint(1, 1);
    await session.setImage(imageB);
    decodeDeferred.resolve(DEFAULT_DECODER_RUN({}));

    await expect(segmentPromise).rejects.toBeInstanceOf(MobileSamStaleRequestError);
  });

  it("画像Aの setImage が pending のまま segmentAtPoint を呼ぶと、embeddings 未確定として MobileSamNoImageError か、直前の画像に基づく結果のどちらかになり、決して画像Aの中身では解決しない", async () => {
    // setImage 完了前（embeddings 未確定）に segmentAtPoint を呼んだ場合の型は
    // 「画像未設定」（MobileSamNoImageError）である。以下はそのケースを明示的に確認する
    // （embeddings が古い画像のまま誤って使われないことの別角度からの確認）。
    const { runtime } = createFakeRuntime({
      encoderRun: DEFAULT_ENCODER_RUN,
      decoderRun: DEFAULT_DECODER_RUN,
    });

    const session = await createMobileSamSession(runtime);
    const setImagePromise = session.setImage(IMAGE);

    await expect(session.segmentAtPoint(0, 0)).rejects.toThrow(MobileSamNoImageError);

    await setImagePromise;
  });
});
