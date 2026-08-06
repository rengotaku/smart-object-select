import { describe, it, expect, vi } from "vitest";
import {
  createSamSession,
  binarizeMask,
  binarizeAllMasks,
  pickBestMaskIndex,
  SamNoImageError,
  SamStaleRequestError,
  SamDisposedError,
  SamEmptyPointsError,
  type SamRuntime,
  type SamModelLike,
  type SamProcessorLike,
  type SamImageInputs,
  type MaskTensorLike,
} from "./samSession";
import type { SamImageInput } from "./types";

/**
 * setTimeout 等でタイミングを作らず、手動で resolve/reject できる deferred promise。
 * Case 9 / Case 10 の競合状態を決定的に再現するために使う。
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

describe("pickBestMaskIndex", () => {
  it("returns the index of the highest score", () => {
    expect(pickBestMaskIndex([[[0.1, 0.9, 0.4]]])).toBe(1);
  });
});

describe("binarizeMask", () => {
  it("converts values greater than 0 to 1 and the rest to 0", () => {
    const tensor: MaskTensorLike = {
      data: new Uint8Array([0, 255, 0, 255]),
      dims: [1, 1, 2, 2],
    };

    expect(binarizeMask(tensor, 0)).toEqual({
      data: new Uint8Array([0, 1, 0, 1]),
      width: 2,
      height: 2,
      score: 0,
    });
  });
});

describe("binarizeAllMasks", () => {
  it("binarizes every mask in the tensor and sorts them by score descending", () => {
    const tensor: MaskTensorLike = {
      data: new Uint8Array([
        0,
        0,
        0,
        0, // mask 0: all zero
        255,
        255,
        255,
        255, // mask 1: all one
        255,
        0,
        255,
        0, // mask 2: alternating
      ]),
      dims: [1, 3, 2, 2],
    };
    const iouScores = [[[0.1, 0.9, 0.5]]];

    const result = binarizeAllMasks(tensor, iouScores);

    expect(result).toHaveLength(3);
    expect(result.map((r) => r.score)).toEqual([0.9, 0.5, 0.1]);
    expect(result[0].data).toEqual(new Uint8Array([1, 1, 1, 1]));
    expect(result[1].data).toEqual(new Uint8Array([1, 0, 1, 0]));
    expect(result[2].data).toEqual(new Uint8Array([0, 0, 0, 0]));
    expect(result[0]).toMatchObject({ width: 2, height: 2 });
  });

  it("falls back to score 0 when iouScores does not cover an index", () => {
    const tensor: MaskTensorLike = {
      data: new Uint8Array([0, 255, 0, 255]),
      dims: [1, 1, 2, 2],
    };

    const result = binarizeAllMasks(tensor, [[[]]]);

    expect(result).toEqual([
      { data: new Uint8Array([0, 1, 0, 1]), width: 2, height: 2, score: 0 },
    ]);
  });
});

describe("createSamSession", () => {
  it("Case 19-1: segmentAtPoint returns all candidates sorted by score descending", async () => {
    const processor = createFakeProcessor();
    processor.postProcessMasks = vi.fn(
      async (): Promise<MaskTensorLike[]> => [
        {
          data: new Uint8Array([
            0,
            0,
            0,
            0, // mask 0
            255,
            255,
            255,
            255, // mask 1
            255,
            0,
            255,
            0, // mask 2
          ]),
          dims: [1, 3, 2, 2],
        },
      ]
    );
    const model: SamModelLike = {
      getImageEmbeddings: vi.fn(async () => ({ embedding: "e" })),
      decode: vi.fn(async () => ({ predMasks: {}, iouScores: [[[0.1, 0.9, 0.5]]] })),
    };
    const runtime: SamRuntime = {
      loadModel: vi.fn(async () => model),
      loadProcessor: vi.fn(async () => processor),
    };

    const session = await createSamSession(runtime, "wasm");
    await session.setImage(image);
    const result = await session.segmentAtPoint(1, 1);

    expect(result).toHaveLength(3);
    expect(result.map((r) => r.score)).toEqual([0.9, 0.5, 0.1]);
    expect(result[0]).toEqual({
      width: 2,
      height: 2,
      score: 0.9,
      data: new Uint8Array([1, 1, 1, 1]),
    });
  });

  it("Case 6: embedding is computed only once across multiple segmentAtPoint calls", async () => {
    const processor = createFakeProcessor();
    const getImageEmbeddings = vi.fn(async () => ({ embedding: "e" }));
    const model: SamModelLike = {
      getImageEmbeddings,
      decode: vi.fn(async () => ({ predMasks: {}, iouScores: [[[0.9]]] })),
    };
    const runtime: SamRuntime = {
      loadModel: vi.fn(async () => model),
      loadProcessor: vi.fn(async () => processor),
    };

    const session = await createSamSession(runtime, "wasm");
    await session.setImage(image);
    await session.segmentAtPoint(1, 1);
    await session.segmentAtPoint(2, 2);
    await session.segmentAtPoint(3, 3);

    expect(getImageEmbeddings).toHaveBeenCalledTimes(1);
  });

  it("Case 7: setImage with a different image recomputes embeddings", async () => {
    const processor = createFakeProcessor();
    const embeddingsByCall = [{ tag: "A" }, { tag: "B" }];
    let callIndex = 0;
    const getImageEmbeddings = vi.fn(async () => embeddingsByCall[callIndex++]);
    const decode = vi.fn(async (args: Record<string, unknown>) => {
      void args; // 型上は Record<string, unknown> を受け取る decode を模す。呼び出し引数は mock.calls で検証する
      return { predMasks: {}, iouScores: [[[0.9]]] };
    });
    const model: SamModelLike = { getImageEmbeddings, decode };
    const runtime: SamRuntime = {
      loadModel: vi.fn(async () => model),
      loadProcessor: vi.fn(async () => processor),
    };
    const imageB: SamImageInput = {
      data: new Uint8ClampedArray(16),
      width: 3,
      height: 3,
    };

    const session = await createSamSession(runtime, "wasm");
    await session.setImage(image);
    await session.segmentAtPoint(1, 1);
    await session.setImage(imageB);
    await session.segmentAtPoint(1, 1);

    expect(getImageEmbeddings).toHaveBeenCalledTimes(2);
    const secondDecodeArgs = decode.mock.calls[1][0] as Record<string, unknown>;
    expect(secondDecodeArgs.tag).toBe("B");
  });

  it("Case 8: segmentAtPoint before setImage rejects with SamNoImageError", async () => {
    const processor = createFakeProcessor();
    const model: SamModelLike = {
      getImageEmbeddings: vi.fn(async () => ({})),
      decode: vi.fn(async () => ({ predMasks: {}, iouScores: [[[0.9]]] })),
    };
    const runtime: SamRuntime = {
      loadModel: vi.fn(async () => model),
      loadProcessor: vi.fn(async () => processor),
    };

    const session = await createSamSession(runtime, "wasm");

    await expect(session.segmentAtPoint(1, 1)).rejects.toBeInstanceOf(SamNoImageError);
  });

  it("Case 9: a stale setImage does not overwrite a newer one", async () => {
    const processor = createFakeProcessor();
    const deferredA = deferred<Record<string, unknown>>();
    const deferredB = deferred<Record<string, unknown>>();
    const embeddingsQueue = [deferredA, deferredB];
    let callIndex = 0;
    const getImageEmbeddings = vi.fn(() => embeddingsQueue[callIndex++].promise);
    const decode = vi.fn(async (args: Record<string, unknown>) => {
      void args; // 型上は Record<string, unknown> を受け取る decode を模す。呼び出し引数は mock.calls で検証する
      return { predMasks: {}, iouScores: [[[0.9]]] };
    });
    const model: SamModelLike = { getImageEmbeddings, decode };
    const runtime: SamRuntime = {
      loadModel: vi.fn(async () => model),
      loadProcessor: vi.fn(async () => processor),
    };
    const imageB: SamImageInput = {
      data: new Uint8ClampedArray(16),
      width: 3,
      height: 3,
    };

    const session = await createSamSession(runtime, "wasm");

    const setImageA = session.setImage(image);
    const setImageB = session.setImage(imageB);

    deferredB.resolve({ tag: "B" });
    await setImageB;
    deferredA.resolve({ tag: "A" });
    await setImageA;

    await session.segmentAtPoint(1, 1);

    const decodeArgs = decode.mock.calls[0][0] as Record<string, unknown>;
    expect(decodeArgs.tag).toBe("B");
  });

  it("Case 10: segmentAtPoint rejects with SamStaleRequestError when a newer setImage lands while pending", async () => {
    const processor = createFakeProcessor();
    const decodeDeferred = deferred<{ predMasks: unknown; iouScores: number[][][] }>();
    const model: SamModelLike = {
      getImageEmbeddings: vi.fn(async () => ({})),
      decode: vi.fn(() => decodeDeferred.promise),
    };
    const runtime: SamRuntime = {
      loadModel: vi.fn(async () => model),
      loadProcessor: vi.fn(async () => processor),
    };
    const imageB: SamImageInput = {
      data: new Uint8ClampedArray(16),
      width: 3,
      height: 3,
    };

    const session = await createSamSession(runtime, "wasm");
    await session.setImage(image);

    const segmentPromise = session.segmentAtPoint(1, 1);
    await session.setImage(imageB);
    decodeDeferred.resolve({ predMasks: {}, iouScores: [[[0.9]]] });

    await expect(segmentPromise).rejects.toBeInstanceOf(SamStaleRequestError);
  });

  it("Case 11: operations after dispose reject with SamDisposedError", async () => {
    const processor = createFakeProcessor();
    const model: SamModelLike = {
      getImageEmbeddings: vi.fn(async () => ({})),
      decode: vi.fn(async () => ({ predMasks: {}, iouScores: [[[0.9]]] })),
    };
    const runtime: SamRuntime = {
      loadModel: vi.fn(async () => model),
      loadProcessor: vi.fn(async () => processor),
    };

    const session = await createSamSession(runtime, "wasm");
    await session.setImage(image);

    session.dispose();

    await expect(session.setImage(image)).rejects.toBeInstanceOf(SamDisposedError);
    await expect(session.segmentAtPoint(1, 1)).rejects.toBeInstanceOf(SamDisposedError);
  });

  // 追加テスト: dispose 中の pending 操作
  // 検知/理由: Case 11 の意図は「アンマウント後に推論が走り続けてメモリを保持するのを防ぐ」こと。
  // 呼び出し後の操作だけでなく、dispose() 時点で既に進行中だった setImage / segmentAtPoint も
  // 破棄済みの状態を復活させたり結果を返したりしないことを固定する。
  it("追加: dispose while setImage is pending discards the result instead of resurrecting state", async () => {
    const processor = createFakeProcessor();
    const embeddingsDeferred = deferred<Record<string, unknown>>();
    const model: SamModelLike = {
      getImageEmbeddings: vi.fn(() => embeddingsDeferred.promise),
      decode: vi.fn(async () => ({ predMasks: {}, iouScores: [[[0.9]]] })),
    };
    const runtime: SamRuntime = {
      loadModel: vi.fn(async () => model),
      loadProcessor: vi.fn(async () => processor),
    };

    const session = await createSamSession(runtime, "wasm");
    const setImagePromise = session.setImage(image);
    session.dispose();
    embeddingsDeferred.resolve({ tag: "A" });

    await expect(setImagePromise).rejects.toBeInstanceOf(SamDisposedError);
  });

  it("追加: dispose while segmentAtPoint is pending rejects with SamDisposedError instead of resolving", async () => {
    const processor = createFakeProcessor();
    const decodeDeferred = deferred<{ predMasks: unknown; iouScores: number[][][] }>();
    const model: SamModelLike = {
      getImageEmbeddings: vi.fn(async () => ({})),
      decode: vi.fn(() => decodeDeferred.promise),
    };
    const runtime: SamRuntime = {
      loadModel: vi.fn(async () => model),
      loadProcessor: vi.fn(async () => processor),
    };

    const session = await createSamSession(runtime, "wasm");
    await session.setImage(image);

    const segmentPromise = session.segmentAtPoint(1, 1);
    session.dispose();
    decodeDeferred.resolve({ predMasks: {}, iouScores: [[[0.9]]] });

    await expect(segmentPromise).rejects.toBeInstanceOf(SamDisposedError);
  });

  // 追加テスト: dispose while postProcessMasks is pending
  // 理由: 指摘3対応で追加した「postProcessMasks 完了後の disposed 再チェック」を固定する。
  // 「追加: dispose while segmentAtPoint is pending」は decode 待機中の dispose しか
  // 検証しておらず、postProcessMasks 待機中の dispose は別経路（別の if 分岐）のため
  // 未カバーのまま残る。
  it("追加: dispose while postProcessMasks is pending rejects with SamDisposedError", async () => {
    const postProcessDeferred = deferred<MaskTensorLike[]>();
    const processor: SamProcessorLike = {
      process: vi.fn(
        async (img: SamImageInput): Promise<SamImageInputs> => ({
          originalSizes: [[img.height, img.width]],
          reshapedInputSizes: [[img.height, img.width]],
        })
      ),
      reshapeInputPoints: vi.fn(() => [[[1, 1]]]),
      addInputLabels: vi.fn(() => [[1]]),
      postProcessMasks: vi.fn(() => postProcessDeferred.promise),
    };

    const model: SamModelLike = {
      getImageEmbeddings: vi.fn(async () => ({})),
      decode: vi.fn(async () => ({ predMasks: {}, iouScores: [[[0.9]]] })),
    };
    const runtime: SamRuntime = {
      loadModel: vi.fn(async () => model),
      loadProcessor: vi.fn(async () => processor),
    };

    const session = await createSamSession(runtime, "wasm");
    await session.setImage(image);

    const segmentPromise = session.segmentAtPoint(1, 1);
    // decode の解決を待ち、decode 直後の disposed チェックを通過させてから dispose する。
    // これをしないと decode 待機中の disposed チェック（別分岐）で先に reject してしまい、
    // 狙った postProcessMasks 後のチェックを通らない。
    await Promise.resolve();
    session.dispose();
    postProcessDeferred.resolve([
      { data: new Uint8Array([0, 255, 0, 255]), dims: [1, 1, 2, 2] },
    ]);

    await expect(segmentPromise).rejects.toBeInstanceOf(SamDisposedError);
  });

  it("Case 18: setImage の準備中に segmentAtPoint を呼ぶと古い画像のマスクを返さない", async () => {
    const processor = createFakeProcessor();
    const deferredB = deferred<Record<string, unknown>>();
    let callIndex = 0;
    const getImageEmbeddings = vi.fn(() => {
      callIndex += 1;
      // imgA 用は即解決、imgB 用は保留（setImage(imgB) を「準備中」のまま止める）
      return callIndex === 1 ? Promise.resolve({ tag: "A" }) : deferredB.promise;
    });
    const decode = vi.fn(async () => ({ predMasks: {}, iouScores: [[[0.9]]] }));
    const model: SamModelLike = { getImageEmbeddings, decode };
    const runtime: SamRuntime = {
      loadModel: vi.fn(async () => model),
      loadProcessor: vi.fn(async () => processor),
    };
    const imageB: SamImageInput = {
      data: new Uint8ClampedArray(16),
      width: 3,
      height: 3,
    };

    const session = await createSamSession(runtime, "wasm");
    await session.setImage(image);

    // setImage(imgB) を開始するが完了させない（imgB の embedding は保留のまま）
    const setImageBPromise = session.setImage(imageB);
    const segmentPromise = session.segmentAtPoint(1, 1);

    await expect(segmentPromise).rejects.toBeInstanceOf(SamStaleRequestError);
    expect(decode).not.toHaveBeenCalled();

    // pending の setImage(imgB) を後始末する（未処理の reject/pending を残さない）
    deferredB.resolve({ tag: "B" });
    await setImageBPromise;
  });

  it("Case 19: postProcessMasks の待機中に setImage が来たら結果を破棄する", async () => {
    const decodeDeferred = deferred<{ predMasks: unknown; iouScores: number[][][] }>();
    const postProcessDeferred = deferred<MaskTensorLike[]>();
    const processor: SamProcessorLike = {
      process: vi.fn(
        async (img: SamImageInput): Promise<SamImageInputs> => ({
          originalSizes: [[img.height, img.width]],
          reshapedInputSizes: [[img.height, img.width]],
        })
      ),
      reshapeInputPoints: vi.fn(() => [[[1, 1]]]),
      addInputLabels: vi.fn(() => [[1]]),
      postProcessMasks: vi.fn(() => postProcessDeferred.promise),
    };

    const model: SamModelLike = {
      getImageEmbeddings: vi.fn(async () => ({})),
      decode: vi.fn(() => decodeDeferred.promise),
    };
    const runtime: SamRuntime = {
      loadModel: vi.fn(async () => model),
      loadProcessor: vi.fn(async () => processor),
    };
    const imageB: SamImageInput = {
      data: new Uint8ClampedArray(16),
      width: 3,
      height: 3,
    };

    const session = await createSamSession(runtime, "wasm");
    await session.setImage(image);

    const segmentPromise = session.segmentAtPoint(1, 1);

    // decode を解決させる。この時点ではまだ setImage(imgB) を呼んでいないため、
    // decode 直後の世代チェックは通り、postProcessMasks の呼び出しまで進む。
    decodeDeferred.resolve({ predMasks: {}, iouScores: [[[0.9]]] });
    await Promise.resolve();

    // segmentAtPoint が postProcessMasks の完了待ちの間に、別の setImage を完了させる
    await session.setImage(imageB);

    postProcessDeferred.resolve([
      { data: new Uint8Array([0, 255, 0, 255]), dims: [1, 1, 2, 2] },
    ]);

    await expect(segmentPromise).rejects.toBeInstanceOf(SamStaleRequestError);
  });

  it("Case 9b-1: segmentAtPoints が全点の座標とラベルを input_points/input_labels として decode に渡す", async () => {
    const fakeReshapedPoints = [
      [
        [1, 1],
        [5, 5],
      ],
    ];
    const fakeLabels = [[1, 0]];
    const processor = createFakeProcessor();
    processor.reshapeInputPoints = vi.fn(() => fakeReshapedPoints);
    processor.addInputLabels = vi.fn(() => fakeLabels);

    const decode = vi.fn(async (args: Record<string, unknown>) => {
      void args;
      return { predMasks: {}, iouScores: [[[0.9]]] };
    });
    const model: SamModelLike = {
      getImageEmbeddings: vi.fn(async () => ({ embedding: "e" })),
      decode,
    };

    const runtime: SamRuntime = {
      loadModel: vi.fn(async () => model),
      loadProcessor: vi.fn(async () => processor),
    };

    const session = await createSamSession(runtime, "wasm");
    await session.setImage(image);
    await session.segmentAtPoints([
      { x: 1, y: 1, label: 1 },
      { x: 5, y: 5, label: 0 },
    ]);

    expect(processor.reshapeInputPoints).toHaveBeenCalledWith(
      [
        [
          [1, 1],
          [5, 5],
        ],
      ],
      [2, 2],
      expect.anything()
    );
    expect(processor.addInputLabels).toHaveBeenCalledWith([[1, 0]], fakeReshapedPoints);
    expect(decode).toHaveBeenCalledTimes(1);
    const decodeArgs = decode.mock.calls[0][0] as Record<string, unknown>;
    expect(decodeArgs.input_points).toEqual(fakeReshapedPoints);
    expect(decodeArgs.input_labels).toEqual(fakeLabels);
  });

  it("Case 9b-2: segmentAtPoints は候補配列の先頭に最もスコアの高いマスクを返す（Case 5 の複数点版）", async () => {
    const processor = createFakeProcessor();
    const model: SamModelLike = {
      getImageEmbeddings: vi.fn(async () => ({ embedding: "e" })),
      decode: vi.fn(async () => ({ predMasks: {}, iouScores: [[[0.9]]] })),
    };
    const runtime: SamRuntime = {
      loadModel: vi.fn(async () => model),
      loadProcessor: vi.fn(async () => processor),
    };

    const session = await createSamSession(runtime, "wasm");
    await session.setImage(image);
    const result = await session.segmentAtPoints([
      { x: 1, y: 1, label: 1 },
      { x: 5, y: 5, label: 0 },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      width: 2,
      height: 2,
      score: 0.9,
      data: new Uint8Array([0, 1, 0, 1]),
    });
  });

  it("Case 9b-3: segmentAtPoints は setImage と embedding を共有する（Case 6 の複数点版）", async () => {
    const processor = createFakeProcessor();
    const getImageEmbeddings = vi.fn(async () => ({ embedding: "e" }));
    const model: SamModelLike = {
      getImageEmbeddings,
      decode: vi.fn(async () => ({ predMasks: {}, iouScores: [[[0.9]]] })),
    };
    const runtime: SamRuntime = {
      loadModel: vi.fn(async () => model),
      loadProcessor: vi.fn(async () => processor),
    };

    const session = await createSamSession(runtime, "wasm");
    await session.setImage(image);
    await session.segmentAtPoint(1, 1);
    await session.segmentAtPoints([
      { x: 1, y: 1, label: 1 },
      { x: 5, y: 5, label: 0 },
    ]);
    await session.segmentAtPoint(2, 2);

    expect(getImageEmbeddings).toHaveBeenCalledTimes(1);
  });

  it("Case 9b-4: 空配列で segmentAtPoints を呼ぶと SamEmptyPointsError で reject する", async () => {
    const processor = createFakeProcessor();
    const model: SamModelLike = {
      getImageEmbeddings: vi.fn(async () => ({})),
      decode: vi.fn(async () => ({ predMasks: {}, iouScores: [[[0.9]]] })),
    };
    const runtime: SamRuntime = {
      loadModel: vi.fn(async () => model),
      loadProcessor: vi.fn(async () => processor),
    };

    const session = await createSamSession(runtime, "wasm");
    await session.setImage(image);

    await expect(session.segmentAtPoints([])).rejects.toBeInstanceOf(SamEmptyPointsError);
  });

  it("Case 9b-5: setImage 前の segmentAtPoints は SamNoImageError で reject する（Case 8 の複数点版）", async () => {
    const processor = createFakeProcessor();
    const model: SamModelLike = {
      getImageEmbeddings: vi.fn(async () => ({})),
      decode: vi.fn(async () => ({ predMasks: {}, iouScores: [[[0.9]]] })),
    };
    const runtime: SamRuntime = {
      loadModel: vi.fn(async () => model),
      loadProcessor: vi.fn(async () => processor),
    };

    const session = await createSamSession(runtime, "wasm");

    await expect(
      session.segmentAtPoints([{ x: 1, y: 1, label: 1 }])
    ).rejects.toBeInstanceOf(SamNoImageError);
  });

  it("Case 9b-6: decode 待機中に新しい setImage が来たら segmentAtPoints は SamStaleRequestError で reject する（Case 10 の複数点版）", async () => {
    const processor = createFakeProcessor();
    const decodeDeferred = deferred<{ predMasks: unknown; iouScores: number[][][] }>();
    const model: SamModelLike = {
      getImageEmbeddings: vi.fn(async () => ({})),
      decode: vi.fn(() => decodeDeferred.promise),
    };
    const runtime: SamRuntime = {
      loadModel: vi.fn(async () => model),
      loadProcessor: vi.fn(async () => processor),
    };
    const imageB: SamImageInput = {
      data: new Uint8ClampedArray(16),
      width: 3,
      height: 3,
    };

    const session = await createSamSession(runtime, "wasm");
    await session.setImage(image);

    const segmentPromise = session.segmentAtPoints([{ x: 1, y: 1, label: 1 }]);
    await session.setImage(imageB);
    decodeDeferred.resolve({ predMasks: {}, iouScores: [[[0.9]]] });

    await expect(segmentPromise).rejects.toBeInstanceOf(SamStaleRequestError);
  });

  it("Case 9b-7: dispose 後の segmentAtPoints は SamDisposedError で reject する（Case 11 の複数点版）", async () => {
    const processor = createFakeProcessor();
    const model: SamModelLike = {
      getImageEmbeddings: vi.fn(async () => ({})),
      decode: vi.fn(async () => ({ predMasks: {}, iouScores: [[[0.9]]] })),
    };
    const runtime: SamRuntime = {
      loadModel: vi.fn(async () => model),
      loadProcessor: vi.fn(async () => processor),
    };

    const session = await createSamSession(runtime, "wasm");
    await session.setImage(image);

    session.dispose();

    await expect(
      session.segmentAtPoints([{ x: 1, y: 1, label: 1 }])
    ).rejects.toBeInstanceOf(SamDisposedError);
  });

  it("Case 19-2: segmentAtPoints は全候補を score 降順で返す", async () => {
    const processor = createFakeProcessor();
    processor.postProcessMasks = vi.fn(
      async (): Promise<MaskTensorLike[]> => [
        {
          data: new Uint8Array([
            0,
            0,
            0,
            0, // mask 0
            255,
            255,
            255,
            255, // mask 1
            255,
            0,
            255,
            0, // mask 2
          ]),
          dims: [1, 3, 2, 2],
        },
      ]
    );
    const model: SamModelLike = {
      getImageEmbeddings: vi.fn(async () => ({ embedding: "e" })),
      decode: vi.fn(async () => ({ predMasks: {}, iouScores: [[[0.1, 0.9, 0.5]]] })),
    };
    const runtime: SamRuntime = {
      loadModel: vi.fn(async () => model),
      loadProcessor: vi.fn(async () => processor),
    };

    const session = await createSamSession(runtime, "wasm");
    await session.setImage(image);
    const result = await session.segmentAtPoints([
      { x: 1, y: 1, label: 1 },
      { x: 5, y: 5, label: 0 },
    ]);

    expect(result).toHaveLength(3);
    expect(result.map((r) => r.score)).toEqual([0.9, 0.5, 0.1]);
    expect(result[0]).toEqual({
      width: 2,
      height: 2,
      score: 0.9,
      data: new Uint8Array([1, 1, 1, 1]),
    });
  });
});
