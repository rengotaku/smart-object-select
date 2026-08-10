import { renderHook, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { useEdgeSam } from "./useEdgeSam";
import type { EdgeSamMaskResult, EdgeSamWorkerClient } from "@/lib/modelLab/edgeSam";
import type { SamImageInput } from "@/lib/sam";

const DEFAULT_MASK: EdgeSamMaskResult = {
  data: new Uint8Array([1, 1, 1, 1]),
  width: 2,
  height: 2,
  score: 0.9,
};

function createFakeClient(
  overrides: Partial<EdgeSamWorkerClient> = {}
): EdgeSamWorkerClient {
  return {
    setImage: vi.fn(async (): Promise<void> => undefined),
    segmentAtPoint: vi.fn(async (): Promise<EdgeSamMaskResult> => DEFAULT_MASK),
    terminate: vi.fn(),
    ...overrides,
  };
}

const IMAGE: SamImageInput = {
  data: new Uint8ClampedArray(2 * 2 * 4),
  width: 2,
  height: 2,
};

describe("useEdgeSam", () => {
  it("初期状態は idle でマスク・エラーが無い", () => {
    const { result } = renderHook(() =>
      useEdgeSam({ createClient: () => createFakeClient() })
    );

    expect(result.current.status).toBe("idle");
    expect(result.current.mask).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("segmentAtPoint を呼ぶと ready になりマスクを保持する", async () => {
    const { result } = renderHook(() =>
      useEdgeSam({ createClient: () => createFakeClient() })
    );

    act(() => {
      result.current.segmentAtPoint(IMAGE, 1, 1);
    });

    await waitFor(() => {
      expect(result.current.status).toBe("ready");
    });

    expect(result.current.mask).toEqual(DEFAULT_MASK);
    expect(result.current.error).toBeNull();
  });

  it("推論が失敗すると error 状態になりエラーメッセージを保持する", async () => {
    const client = createFakeClient({
      segmentAtPoint: vi.fn().mockRejectedValue(new Error("decode failed")),
    });
    const { result } = renderHook(() => useEdgeSam({ createClient: () => client }));

    act(() => {
      result.current.segmentAtPoint(IMAGE, 1, 1);
    });

    await waitFor(() => {
      expect(result.current.status).toBe("error");
    });

    expect(result.current.error?.message).toBe("decode failed");
    expect(result.current.mask).toBeNull();
  });

  it("reset() は status/mask/error を初期状態に戻す", async () => {
    const { result } = renderHook(() =>
      useEdgeSam({ createClient: () => createFakeClient() })
    );

    act(() => {
      result.current.segmentAtPoint(IMAGE, 1, 1);
    });
    await waitFor(() => {
      expect(result.current.status).toBe("ready");
    });

    act(() => {
      result.current.reset();
    });

    expect(result.current.status).toBe("idle");
    expect(result.current.mask).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("同じ画像で2回目の segmentAtPoint は setImage を再送しない", async () => {
    const client = createFakeClient();
    const { result } = renderHook(() => useEdgeSam({ createClient: () => client }));

    act(() => {
      result.current.segmentAtPoint(IMAGE, 0, 0);
    });
    await waitFor(() => expect(result.current.status).toBe("ready"));

    act(() => {
      result.current.segmentAtPoint(IMAGE, 1, 1);
    });
    await waitFor(() => expect(result.current.status).toBe("ready"));

    expect(client.setImage).toHaveBeenCalledTimes(1);
    expect(client.segmentAtPoint).toHaveBeenCalledTimes(2);
  });

  it("異なる画像で segmentAtPoint を呼ぶと setImage を再送する", async () => {
    const client = createFakeClient();
    const { result } = renderHook(() => useEdgeSam({ createClient: () => client }));

    const otherImage: SamImageInput = {
      data: new Uint8ClampedArray(2 * 2 * 4),
      width: 2,
      height: 2,
    };

    act(() => {
      result.current.segmentAtPoint(IMAGE, 0, 0);
    });
    await waitFor(() => expect(result.current.status).toBe("ready"));

    act(() => {
      result.current.segmentAtPoint(otherImage, 1, 1);
    });
    await waitFor(() => expect(result.current.status).toBe("ready"));

    expect(client.setImage).toHaveBeenCalledTimes(2);
  });

  it("アンマウント時に client.terminate() を呼ぶ", () => {
    const client = createFakeClient();
    const { result, unmount } = renderHook(() =>
      useEdgeSam({ createClient: () => client })
    );

    act(() => {
      result.current.segmentAtPoint(IMAGE, 0, 0);
    });

    unmount();

    expect(client.terminate).toHaveBeenCalledTimes(1);
  });
});
