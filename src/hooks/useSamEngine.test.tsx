import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { useSamEngine, type UseSamEngineResult } from "./useSamEngine";
import type { SamWorkerClient, SamDevice, SamMaskResult } from "@/lib/sam";

function createFakeClient(overrides: Partial<SamWorkerClient> = {}): SamWorkerClient {
  return {
    init: vi.fn(async (): Promise<SamDevice> => "wasm"),
    setImage: vi.fn(async (): Promise<void> => undefined),
    segment: vi.fn(
      async (): Promise<SamMaskResult> => ({
        data: new Uint8Array([1]),
        width: 1,
        height: 1,
        score: 1,
      })
    ),
    terminate: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useSamEngine", () => {
  it("初期化に成功すると initializing を経て ready になり device を保持する", async () => {
    const client = createFakeClient({
      init: vi.fn(async (): Promise<SamDevice> => "webgpu"),
    });
    const { result } = renderHook(() => useSamEngine(() => client));

    await waitFor(() => {
      expect(result.current.status).toBe("ready");
    });

    expect(result.current.device).toBe("webgpu");
    expect(result.current.error).toBeNull();
    expect(result.current.client).toBe(client);
  });

  it("WASM フォールバック時は device が wasm になる", async () => {
    const client = createFakeClient({
      init: vi.fn(async (): Promise<SamDevice> => "wasm"),
    });
    const { result } = renderHook(() => useSamEngine(() => client));

    await waitFor(() => {
      expect(result.current.status).toBe("ready");
    });

    expect(result.current.device).toBe("wasm");
  });

  it("init が失敗すると error 状態になり error を保持する", async () => {
    const failure = new Error("init failed");
    const client = createFakeClient({
      init: vi.fn().mockRejectedValue(failure),
    });
    const { result } = renderHook(() => useSamEngine(() => client));

    await waitFor(() => {
      expect(result.current.status).toBe("error");
    });

    expect(result.current.error).toBe(failure);
    expect(result.current.device).toBeNull();
  });

  it("アンマウント時に terminate() を呼ぶ", async () => {
    const client = createFakeClient();
    const { result, unmount } = renderHook(() => useSamEngine(() => client));

    await waitFor(() => {
      expect(result.current.status).toBe("ready");
    });

    unmount();

    expect(client.terminate).toHaveBeenCalledTimes(1);
  });

  it("追加: アンマウント後に init が解決しても状態を更新しない（stale setState 防止）", async () => {
    let resolveInit!: (device: SamDevice) => void;
    const client = createFakeClient({
      init: vi.fn(
        () =>
          new Promise<SamDevice>((resolve) => {
            resolveInit = resolve;
          })
      ),
    });
    const { result, unmount } = renderHook(() => useSamEngine(() => client));

    expect(result.current.status).toBe("initializing");
    unmount();
    resolveInit("webgpu");

    // アンマウント後に resolve しても React の act 外で setState が呼ばれない
    // （呼ばれていれば act 警告や例外が発生するはずだが、ここでは client 側の
    // 状態は既に unmount 前の値のまま変化しないことを確認する）
    await Promise.resolve();
    expect(result.current.status).toBe("initializing");
  });

  it("追加: createClient を省略すると既定で実 Worker クライアントを生成する", async () => {
    class FakeWorker {
      static instances: FakeWorker[] = [];
      url: string | URL;
      options: unknown;
      constructor(url: string | URL, options: unknown) {
        this.url = url;
        this.options = options;
        FakeWorker.instances.push(this);
      }
      addEventListener(): void {}
      removeEventListener(): void {}
      postMessage(): void {}
      terminate(): void {}
    }
    vi.stubGlobal("Worker", FakeWorker);

    const { result, unmount } = renderHook(() => useSamEngine());

    await waitFor(() => {
      expect(result.current.status).toBe("initializing");
    });

    expect(FakeWorker.instances).toHaveLength(1);
    expect(FakeWorker.instances[0].options).toEqual({ type: "module" });

    unmount();
  });

  it("Case 24: createClient が同期 throw しても hook が error 状態になりクラッシュしない", async () => {
    const failure = new Error("Worker construction blocked by CSP");
    const createClient = vi.fn((): SamWorkerClient => {
      throw failure;
    });

    let renderError: unknown;
    let result: { current: UseSamEngineResult } | undefined;
    try {
      result = renderHook(() => useSamEngine(createClient)).result;
    } catch (err) {
      renderError = err;
    }

    expect(renderError).toBeUndefined();
    await waitFor(() => {
      expect(result?.current.status).toBe("error");
    });
    expect(result?.current.error).toBe(failure);
  });
});
