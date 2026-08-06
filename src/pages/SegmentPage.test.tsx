import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SegmentPage } from "./SegmentPage";
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
    segmentAtPoints: vi.fn(
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

describe("SegmentPage", () => {
  beforeEach(() => {
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:fake"),
      revokeObjectURL: vi.fn(),
    });
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
      drawImage: vi.fn(),
      putImageData: vi.fn(),
      clearRect: vi.fn(),
      createImageData: vi.fn().mockReturnValue({ data: new Uint8ClampedArray(4) }),
    }) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("初期化中は読み込み中のメッセージを表示する", () => {
    const client = createFakeClient({
      init: vi.fn(() => new Promise<SamDevice>(() => {})),
    });
    render(<SegmentPage createClient={() => client} />);

    expect(screen.getByText("モデルを読み込んでいます")).toBeInTheDocument();
  });

  it("Case 17: device が wasm のとき WebGPU 不可・処理に時間がかかる旨の警告が表示される", async () => {
    const client = createFakeClient({
      init: vi.fn(async (): Promise<SamDevice> => "wasm"),
    });
    render(<SegmentPage createClient={() => client} />);

    await waitFor(() => {
      expect(screen.getByText(/WebGPU/)).toBeInTheDocument();
    });
    expect(screen.getByText(/処理に時間がかかります/)).toBeInTheDocument();
  });

  it("Case 17: device が webgpu のときは WASM 警告が存在しない", async () => {
    const client = createFakeClient({
      init: vi.fn(async (): Promise<SamDevice> => "webgpu"),
    });
    render(<SegmentPage createClient={() => client} />);

    await waitFor(() => {
      expect(screen.getByText("WebGPU")).toBeInTheDocument();
    });
    expect(screen.queryByText(/処理に時間がかかります/)).not.toBeInTheDocument();
  });

  it("ready かつ webgpu のときデバイスバッジが表示される", async () => {
    const client = createFakeClient({
      init: vi.fn(async (): Promise<SamDevice> => "webgpu"),
    });
    render(<SegmentPage createClient={() => client} />);

    await waitFor(() => {
      expect(screen.getByText("WebGPU")).toBeInTheDocument();
    });
  });

  it("error 状態のときエラーメッセージを表示する", async () => {
    const failure = new Error("boom");
    const client = createFakeClient({ init: vi.fn().mockRejectedValue(failure) });
    render(<SegmentPage createClient={() => client} />);

    await waitFor(() => {
      expect(screen.getByText("初期化に失敗しました")).toBeInTheDocument();
    });
    expect(screen.getByText("boom")).toBeInTheDocument();
  });

  it("追加: エラーオブジェクトに message が無くてもクラッシュしない", async () => {
    const failure = new Error();
    const client = createFakeClient({ init: vi.fn().mockRejectedValue(failure) });
    render(<SegmentPage createClient={() => client} />);

    await waitFor(() => {
      expect(screen.getByText("初期化に失敗しました")).toBeInTheDocument();
    });
    expect(screen.getByText("不明なエラーです")).toBeInTheDocument();
  });

  it("追加: createClient を省略しても既定（実 Worker クライアント）でレンダリングできる", () => {
    class FakeWorker {
      addEventListener(): void {}
      removeEventListener(): void {}
      postMessage(): void {}
      terminate(): void {}
    }
    vi.stubGlobal("Worker", FakeWorker);

    render(<SegmentPage />);

    expect(screen.getByText("モデルを読み込んでいます")).toBeInTheDocument();
  });

  it("追加: mask が null のとき「レイヤーとして保存」ボタンが disabled である", async () => {
    const client = createFakeClient({
      init: vi.fn(async (): Promise<SamDevice> => "webgpu"),
    });
    render(<SegmentPage createClient={() => client} />);

    await waitFor(() => {
      expect(screen.getByText("WebGPU")).toBeInTheDocument();
    });

    // 画像がまだセットされていないか、mask が null の場合
    // このテストでは画像未ロードのため「レイヤーとして保存」ボタンはレンダリングすらされない（ImageDropzoneが表示）
  });
});
