import { renderHook, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { useFastSam } from "./useFastSam";
import type { FastSamDetection, FastSamWorkerClient } from "@/lib/modelLab/fastSam";
import type { SamImageInput } from "@/lib/types";

const DEFAULT_DETECTIONS: FastSamDetection[] = [
  {
    score: 0.9,
    box: { x: 0, y: 0, width: 2, height: 2 },
    mask: { data: new Uint8Array([1, 1, 1, 1]), width: 2, height: 2, x: 0, y: 0 },
  },
];

function createFakeClient(
  overrides: Partial<FastSamWorkerClient> = {}
): FastSamWorkerClient {
  return {
    detect: vi.fn(async (): Promise<FastSamDetection[]> => DEFAULT_DETECTIONS),
    terminate: vi.fn(),
    ...overrides,
  };
}

const IMAGE: SamImageInput = {
  data: new Uint8ClampedArray(2 * 2 * 4),
  width: 2,
  height: 2,
};

describe("useFastSam", () => {
  it("初期状態は idle で検出結果・エラーが無い", () => {
    const { result } = renderHook(() =>
      useFastSam({ createClient: () => createFakeClient() })
    );

    expect(result.current.status).toBe("idle");
    expect(result.current.detections).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("detect を呼ぶと ready になり検出結果を保持する", async () => {
    const { result } = renderHook(() =>
      useFastSam({ createClient: () => createFakeClient() })
    );

    act(() => {
      result.current.detect(IMAGE);
    });

    await waitFor(() => {
      expect(result.current.status).toBe("ready");
    });

    expect(result.current.detections).toEqual(DEFAULT_DETECTIONS);
    expect(result.current.error).toBeNull();
  });

  it("推論が失敗すると error 状態になりエラーメッセージを保持する", async () => {
    const client = createFakeClient({
      detect: vi.fn().mockRejectedValue(new Error("detect failed")),
    });
    const { result } = renderHook(() => useFastSam({ createClient: () => client }));

    act(() => {
      result.current.detect(IMAGE);
    });

    await waitFor(() => {
      expect(result.current.status).toBe("error");
    });

    expect(result.current.error?.message).toBe("detect failed");
    expect(result.current.detections).toBeNull();
  });

  it("reset() は status/detections/error を初期状態に戻す", async () => {
    const { result } = renderHook(() =>
      useFastSam({ createClient: () => createFakeClient() })
    );

    act(() => {
      result.current.detect(IMAGE);
    });
    await waitFor(() => {
      expect(result.current.status).toBe("ready");
    });

    act(() => {
      result.current.reset();
    });

    expect(result.current.status).toBe("idle");
    expect(result.current.detections).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("同じ画像で2回目の detect は再検出しない（client.detect を再送しない）", async () => {
    const client = createFakeClient();
    const { result } = renderHook(() => useFastSam({ createClient: () => client }));

    act(() => {
      result.current.detect(IMAGE);
    });
    await waitFor(() => expect(result.current.status).toBe("ready"));

    act(() => {
      result.current.detect(IMAGE);
    });

    expect(client.detect).toHaveBeenCalledTimes(1);
  });

  it("異なる画像で detect を呼ぶと再検出する", async () => {
    const client = createFakeClient();
    const { result } = renderHook(() => useFastSam({ createClient: () => client }));

    const otherImage: SamImageInput = {
      data: new Uint8ClampedArray(2 * 2 * 4),
      width: 2,
      height: 2,
    };

    act(() => {
      result.current.detect(IMAGE);
    });
    await waitFor(() => expect(result.current.status).toBe("ready"));

    act(() => {
      result.current.detect(otherImage);
    });
    await waitFor(() => expect(client.detect).toHaveBeenCalledTimes(2));
  });

  it("アンマウント時に client.terminate() を呼ぶ", () => {
    const client = createFakeClient();
    const { result, unmount } = renderHook(() =>
      useFastSam({ createClient: () => client })
    );

    act(() => {
      result.current.detect(IMAGE);
    });

    unmount();

    expect(client.terminate).toHaveBeenCalledTimes(1);
  });
});
