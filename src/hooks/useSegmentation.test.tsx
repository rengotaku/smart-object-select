import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useSegmentation, type LoadedImage } from "./useSegmentation";
import {
  SamStaleRequestError,
  type SamWorkerClient,
  type SamMaskResult,
  type SamDevice,
} from "@/lib/sam";

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createFakeClient(overrides: Partial<SamWorkerClient> = {}): SamWorkerClient {
  return {
    init: vi.fn(async (): Promise<SamDevice> => "wasm"),
    setImage: vi.fn(async (): Promise<void> => undefined),
    segment: vi.fn(
      async (): Promise<SamMaskResult> => ({
        data: new Uint8Array([1]),
        width: 1,
        height: 1,
        score: 0.8,
      })
    ),
    segmentAtPoints: vi.fn(
      async (): Promise<SamMaskResult> => ({
        data: new Uint8Array([1]),
        width: 1,
        height: 1,
        score: 0.8,
      })
    ),
    terminate: vi.fn(),
    ...overrides,
  };
}

describe("useSegmentation", () => {
  let revokeObjectURLSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    revokeObjectURLSpy = vi.fn();
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:fake"),
      revokeObjectURL: revokeObjectURLSpy,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const sampleImageA: LoadedImage = {
    data: new Uint8ClampedArray([255, 0, 0, 255]),
    width: 1,
    height: 1,
    objectUrl: "blob:imageA",
  };

  const sampleImageB: LoadedImage = {
    data: new Uint8ClampedArray([0, 255, 0, 255]),
    width: 1,
    height: 1,
    objectUrl: "blob:imageB",
  };

  it("Case 6: setImage で preparing → ready に遷移する", async () => {
    const deferred = createDeferred<void>();
    const client = createFakeClient({
      setImage: vi.fn(() => deferred.promise),
    });

    const { result } = renderHook(() => useSegmentation(client));

    let setImagePromise!: Promise<void>;
    act(() => {
      setImagePromise = result.current.setImage(sampleImageA);
    });

    expect(result.current.status).toBe("preparing");

    await act(async () => {
      deferred.resolve();
      await setImagePromise;
    });

    expect(result.current.status).toBe("ready");
    expect(result.current.image).toEqual(sampleImageA);
  });

  it("Case 7: 🔴 preparing 中の selectAt は client.segment を呼ばない", async () => {
    const deferred = createDeferred<void>();
    const client = createFakeClient({
      setImage: vi.fn(() => deferred.promise),
    });

    const { result } = renderHook(() => useSegmentation(client));

    act(() => {
      void result.current.setImage(sampleImageA);
    });

    expect(result.current.status).toBe("preparing");

    act(() => {
      void result.current.selectAt(10, 20);
    });

    expect(client.segment).toHaveBeenCalledTimes(0);
    expect(result.current.status).toBe("preparing");
  });

  it("Case 8: selectAt でマスクがセットされる", async () => {
    const mockMask: SamMaskResult = {
      data: new Uint8Array([1]),
      width: 1,
      height: 1,
      score: 0.8,
    };
    const client = createFakeClient({
      segmentAtPoints: vi.fn(async () => mockMask),
    });

    const { result } = renderHook(() => useSegmentation(client));

    await act(async () => {
      await result.current.setImage(sampleImageA);
    });

    await act(async () => {
      await result.current.selectAt(5, 5);
    });

    // selectAt は addPoint(x, y, 1, { replace: true }) の薄いラッパーに統合された
    // （issue #9 STEP2）。実際の呼び出し先は client.segmentAtPoints に変わったため、
    // 「selectAt でマスクがセットされる」という保証はそのままに、検証対象のメソッドを
    // 追従させる。
    expect(client.segmentAtPoints).toHaveBeenCalledWith([{ x: 5, y: 5, label: 1 }]);
    expect(result.current.mask).toEqual(mockMask);
    expect(result.current.status).toBe("ready");
  });

  it("Case 9: 新しい setImage で前のマスクがクリアされ、前の objectUrl が解放される", async () => {
    const client = createFakeClient();
    const { result } = renderHook(() => useSegmentation(client));

    await act(async () => {
      await result.current.setImage(sampleImageA);
      await result.current.selectAt(5, 5);
    });

    expect(result.current.mask).not.toBeNull();

    await act(async () => {
      await result.current.setImage(sampleImageB);
    });

    expect(result.current.mask).toBeNull();
    expect(revokeObjectURLSpy).toHaveBeenCalledWith("blob:imageA");
  });

  it("Case 10: 🔴 selectAt の待機中に setImage が来たら古いマスクを表示しない", async () => {
    const segmentDeferred = createDeferred<SamMaskResult>();
    const client = createFakeClient({
      segment: vi.fn(() => segmentDeferred.promise),
    });

    const { result } = renderHook(() => useSegmentation(client));

    await act(async () => {
      await result.current.setImage(sampleImageA);
    });

    let selectPromise!: Promise<void>;
    act(() => {
      selectPromise = result.current.selectAt(1, 1);
    });

    await act(async () => {
      await result.current.setImage(sampleImageB);
    });

    await act(async () => {
      segmentDeferred.resolve({
        data: new Uint8Array([1]),
        width: 1,
        height: 1,
        score: 0.8,
      });
      await selectPromise;
    });

    expect(result.current.mask).toBeNull();
  });

  it("Case 11: SamStaleRequestError はエラー状態にしない", async () => {
    const client = createFakeClient({
      segment: vi.fn().mockRejectedValue(new SamStaleRequestError()),
    });

    const { result } = renderHook(() => useSegmentation(client));

    await act(async () => {
      await result.current.setImage(sampleImageA);
    });

    await act(async () => {
      await result.current.selectAt(1, 1);
    });

    expect(result.current.status).toBe("ready");
    expect(result.current.error).toBeNull();
  });

  it("Case 12: client が null のとき何も呼ばず例外も投げない", async () => {
    const { result } = renderHook(() => useSegmentation(null));

    await act(async () => {
      await expect(result.current.setImage(sampleImageA)).resolves.toBeUndefined();
      await expect(result.current.selectAt(1, 1)).resolves.toBeUndefined();
    });

    expect(result.current.status).not.toBe("error");
  });

  it("Case 17: アンマウント時に現在の objectUrl が解放される", async () => {
    const client = createFakeClient();
    const { result, unmount } = renderHook(() => useSegmentation(client));

    await act(async () => {
      await result.current.setImage(sampleImageA);
    });

    expect(result.current.image).toEqual(sampleImageA);

    unmount();

    expect(revokeObjectURLSpy).toHaveBeenCalledWith("blob:imageA");
  });

  it("Case 9b-13: addPoint(replace:true) は既存の点セットをクリアしてから1点で segmentAtPoints を呼ぶ", async () => {
    const client = createFakeClient();
    const { result } = renderHook(() => useSegmentation(client));

    await act(async () => {
      await result.current.setImage(sampleImageA);
      await result.current.addPoint(10, 20, 1, { replace: false });
    });

    expect(result.current.points).toEqual([{ x: 10, y: 20, label: 1 }]);

    await act(async () => {
      await result.current.addPoint(30, 40, 0, { replace: true });
    });

    expect(client.segmentAtPoints).toHaveBeenLastCalledWith([{ x: 30, y: 40, label: 0 }]);
    expect(result.current.points).toEqual([{ x: 30, y: 40, label: 0 }]);
  });

  it("Case 9b-14: addPoint(replace:false) は既存の点セットに追加してから全点で segmentAtPoints を呼ぶ", async () => {
    const client = createFakeClient();
    const { result } = renderHook(() => useSegmentation(client));

    await act(async () => {
      await result.current.setImage(sampleImageA);
      await result.current.addPoint(10, 20, 1, { replace: false });
      await result.current.addPoint(30, 40, 0, { replace: false });
    });

    expect(client.segmentAtPoints).toHaveBeenLastCalledWith([
      { x: 10, y: 20, label: 1 },
      { x: 30, y: 40, label: 0 },
    ]);
    expect(result.current.points).toEqual([
      { x: 10, y: 20, label: 1 },
      { x: 30, y: 40, label: 0 },
    ]);
  });

  it("Case 9b-15: addPoint 中に clearPoints されると（世代が進むと）結果を state に反映しない", async () => {
    const segmentDeferred = createDeferred<SamMaskResult>();
    const client = createFakeClient({
      segmentAtPoints: vi.fn(() => segmentDeferred.promise),
    });

    const { result } = renderHook(() => useSegmentation(client));

    await act(async () => {
      await result.current.setImage(sampleImageA);
    });

    let addPointPromise!: Promise<void>;
    act(() => {
      addPointPromise = result.current.addPoint(10, 20, 1);
    });

    act(() => {
      result.current.clearPoints();
    });

    await act(async () => {
      segmentDeferred.resolve({
        data: new Uint8Array([1]),
        width: 1,
        height: 1,
        score: 0.8,
      });
      await addPointPromise;
    });

    expect(result.current.mask).toBeNull();
    expect(result.current.points).toEqual([]);
  });

  it("Case 9b-16: clearPoints は points と mask をクリアする（image は保持する）", async () => {
    const client = createFakeClient();
    const { result } = renderHook(() => useSegmentation(client));

    await act(async () => {
      await result.current.setImage(sampleImageA);
      await result.current.addPoint(10, 20, 1);
    });

    expect(result.current.mask).not.toBeNull();
    expect(result.current.points).toHaveLength(1);

    act(() => {
      result.current.clearPoints();
    });

    expect(result.current.points).toEqual([]);
    expect(result.current.mask).toBeNull();
    expect(result.current.image).toEqual(sampleImageA);
  });

  it("Case 9b-17: setImage が preparing 中に clearPoints を呼んでも状態を変更しない", async () => {
    const deferred = createDeferred<void>();
    const client = createFakeClient({
      setImage: vi.fn(() => deferred.promise),
    });

    const { result } = renderHook(() => useSegmentation(client));

    let setImagePromise!: Promise<void>;
    act(() => {
      setImagePromise = result.current.setImage(sampleImageA);
    });

    expect(result.current.status).toBe("preparing");

    act(() => {
      result.current.clearPoints();
    });

    expect(result.current.status).toBe("preparing");

    await act(async () => {
      deferred.resolve();
      await setImagePromise;
    });

    expect(result.current.status).toBe("ready");
    expect(result.current.image).toEqual(sampleImageA);
  });

  it("Case 16-1: saveLayer は現在の mask を新規レイヤーとして追加する", async () => {
    const mockMask: SamMaskResult = {
      data: new Uint8Array([1]),
      width: 1,
      height: 1,
      score: 0.8,
    };
    const client = createFakeClient({
      segmentAtPoints: vi.fn(async () => mockMask),
    });
    const { result } = renderHook(() => useSegmentation(client));

    await act(async () => {
      await result.current.setImage(sampleImageA);
      await result.current.addPoint(10, 20, 1);
    });

    const currentMask = result.current.mask;
    expect(currentMask).toEqual(mockMask);

    act(() => {
      result.current.saveLayer();
    });

    expect(result.current.layers).toHaveLength(1);
    expect(result.current.layers[0].mask).toEqual(currentMask);
    expect(result.current.layers[0].label).toBe("レイヤー1");
  });

  it("Case 16-2: saveLayer 後に points/mask がクリアされる", async () => {
    const client = createFakeClient();
    const { result } = renderHook(() => useSegmentation(client));

    await act(async () => {
      await result.current.setImage(sampleImageA);
      await result.current.addPoint(10, 20, 1);
    });

    act(() => {
      result.current.saveLayer();
    });

    expect(result.current.points).toEqual([]);
    expect(result.current.mask).toBeNull();
  });

  it("Case 16-3: mask が null のとき saveLayer を呼んでも何も起きない", async () => {
    const client = createFakeClient();
    const { result } = renderHook(() => useSegmentation(client));

    await act(async () => {
      await result.current.setImage(sampleImageA);
    });

    act(() => {
      result.current.saveLayer();
    });

    expect(result.current.layers).toEqual([]);
    expect(result.current.points).toEqual([]);
    expect(result.current.mask).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("Case 16-4: 複数回 saveLayer すると連番のラベルで複数レイヤーが積まれる", async () => {
    const mask1: SamMaskResult = {
      data: new Uint8Array([1]),
      width: 1,
      height: 1,
      score: 0.8,
    };
    const mask2: SamMaskResult = {
      data: new Uint8Array([2]),
      width: 1,
      height: 1,
      score: 0.9,
    };
    const segmentAtPointsMock = vi
      .fn()
      .mockResolvedValueOnce(mask1)
      .mockResolvedValueOnce(mask2);

    const client = createFakeClient({
      segmentAtPoints: segmentAtPointsMock,
    });
    const { result } = renderHook(() => useSegmentation(client));

    await act(async () => {
      await result.current.setImage(sampleImageA);
      await result.current.addPoint(10, 20, 1);
    });

    act(() => {
      result.current.saveLayer();
    });

    await act(async () => {
      await result.current.addPoint(30, 40, 1);
    });

    act(() => {
      result.current.saveLayer();
    });

    expect(result.current.layers).toHaveLength(2);
    expect(result.current.layers[0].label).toBe("レイヤー1");
    expect(result.current.layers[1].label).toBe("レイヤー2");
    expect(result.current.layers[0].mask).toEqual(mask1);
    expect(result.current.layers[1].mask).toEqual(mask2);
    expect(result.current.layers[0].mask).not.toEqual(result.current.layers[1].mask);
  });

  it("Case 16-5: removeLayer は指定した id のレイヤーだけを取り除く", async () => {
    const mask1: SamMaskResult = {
      data: new Uint8Array([1]),
      width: 1,
      height: 1,
      score: 0.8,
    };
    const mask2: SamMaskResult = {
      data: new Uint8Array([2]),
      width: 1,
      height: 1,
      score: 0.9,
    };
    const segmentAtPointsMock = vi
      .fn()
      .mockResolvedValueOnce(mask1)
      .mockResolvedValueOnce(mask2);

    const client = createFakeClient({
      segmentAtPoints: segmentAtPointsMock,
    });
    const { result } = renderHook(() => useSegmentation(client));

    await act(async () => {
      await result.current.setImage(sampleImageA);
      await result.current.addPoint(10, 20, 1);
    });

    act(() => {
      result.current.saveLayer();
    });

    await act(async () => {
      await result.current.addPoint(30, 40, 1);
    });

    act(() => {
      result.current.saveLayer();
    });

    const targetId = result.current.layers[0].id;
    const remainingLayerMask = result.current.layers[1].mask;

    act(() => {
      result.current.removeLayer(targetId);
    });

    expect(result.current.layers).toHaveLength(1);
    expect(result.current.layers[0].mask).toEqual(remainingLayerMask);
  });

  it("Case 16-6: reset（別の画像を選ぶ）で layers もクリアされる", async () => {
    const client = createFakeClient();
    const { result } = renderHook(() => useSegmentation(client));

    await act(async () => {
      await result.current.setImage(sampleImageA);
      await result.current.addPoint(10, 20, 1);
    });

    act(() => {
      result.current.saveLayer();
    });

    expect(result.current.layers).toHaveLength(1);

    act(() => {
      result.current.reset();
    });

    expect(result.current.layers).toEqual([]);
    expect(result.current.image).toBeNull();
    expect(result.current.mask).toBeNull();
    expect(result.current.points).toEqual([]);
  });

  it("Case 16-10: 存在しない id で removeLayer を呼んでも layers に変化がない", async () => {
    const client = createFakeClient();
    const { result } = renderHook(() => useSegmentation(client));

    await act(async () => {
      await result.current.setImage(sampleImageA);
      await result.current.addPoint(10, 20, 1);
    });

    act(() => {
      result.current.saveLayer();
    });

    expect(result.current.layers).toHaveLength(1);

    act(() => {
      result.current.removeLayer("non-existent-id");
    });

    expect(result.current.layers).toHaveLength(1);
  });

  it("Case 16-17: レイヤー1・2を保存→レイヤー1を削除→新規保存で「レイヤー3」になる（重複しない）", async () => {
    const mask1: SamMaskResult = {
      data: new Uint8Array([1]),
      width: 1,
      height: 1,
      score: 0.8,
    };
    const mask2: SamMaskResult = {
      data: new Uint8Array([2]),
      width: 1,
      height: 1,
      score: 0.9,
    };
    const mask3: SamMaskResult = {
      data: new Uint8Array([3]),
      width: 1,
      height: 1,
      score: 0.95,
    };
    const segmentAtPointsMock = vi
      .fn()
      .mockResolvedValueOnce(mask1)
      .mockResolvedValueOnce(mask2)
      .mockResolvedValueOnce(mask3);

    const client = createFakeClient({
      segmentAtPoints: segmentAtPointsMock,
    });
    const { result } = renderHook(() => useSegmentation(client));

    await act(async () => {
      await result.current.setImage(sampleImageA);
      await result.current.addPoint(10, 20, 1);
    });

    act(() => {
      result.current.saveLayer();
    });

    await act(async () => {
      await result.current.addPoint(30, 40, 1);
    });

    act(() => {
      result.current.saveLayer();
    });

    expect(result.current.layers).toHaveLength(2);
    expect(result.current.layers[0].label).toBe("レイヤー1");
    expect(result.current.layers[1].label).toBe("レイヤー2");

    act(() => {
      result.current.removeLayer(result.current.layers[0].id);
    });

    expect(result.current.layers).toHaveLength(1);
    expect(result.current.layers[0].label).toBe("レイヤー2");

    await act(async () => {
      await result.current.addPoint(50, 60, 1);
    });

    act(() => {
      result.current.saveLayer();
    });

    expect(result.current.layers).toHaveLength(2);
    expect(result.current.layers.map((l) => l.label)).toEqual(["レイヤー2", "レイヤー3"]);
  });
});
