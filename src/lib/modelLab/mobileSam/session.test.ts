import { describe, it, expect, vi } from "vitest";
import type { SamImageInput } from "@/lib/sam";
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
} from "./session";

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
});
