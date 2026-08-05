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
      segment: vi.fn(async () => mockMask),
    });

    const { result } = renderHook(() => useSegmentation(client));

    await act(async () => {
      await result.current.setImage(sampleImageA);
    });

    await act(async () => {
      await result.current.selectAt(5, 5);
    });

    expect(client.segment).toHaveBeenCalledWith(5, 5);
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
});
