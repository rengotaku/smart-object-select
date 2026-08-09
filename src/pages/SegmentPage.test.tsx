import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SegmentPage } from "./SegmentPage";
import * as imageLoaderModule from "@/lib/sam/imageLoader";
import type { LoadedImage } from "@/hooks";
import type {
  SamWorkerClient,
  SamDevice,
  SamMaskResult,
  SamProgressEvent,
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
      async (): Promise<SamMaskResult[]> => [
        {
          data: new Uint8Array([1]),
          width: 1,
          height: 1,
          score: 1,
        },
      ]
    ),
    segmentAtPoints: vi.fn(
      async (): Promise<SamMaskResult[]> => [
        {
          data: new Uint8Array([1]),
          width: 1,
          height: 1,
          score: 1,
        },
      ]
    ),
    onProgress: vi.fn(() => () => {}),
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
      beginPath: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
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

  it("追加: 初期化中に progress 通知を受け取るとパーセント表示に切り替わる", async () => {
    let progressListener: ((event: SamProgressEvent) => void) | undefined;
    const client = createFakeClient({
      init: vi.fn(() => new Promise<SamDevice>(() => {})),
      onProgress: vi.fn((listener: (event: SamProgressEvent) => void) => {
        progressListener = listener;
        return () => {};
      }),
    });
    render(<SegmentPage createClient={() => client} />);

    expect(screen.getByText("モデルを読み込んでいます")).toBeInTheDocument();

    act(() => {
      progressListener?.({ file: "model.onnx", loaded: 42, total: 100 });
    });

    expect(screen.getByText("モデルを読み込み中... 42%")).toBeInTheDocument();
  });

  it("追加: total が不明な progress 通知ではパーセントを表示せず「読み込み中」のみ表示する", async () => {
    let progressListener: ((event: SamProgressEvent) => void) | undefined;
    const client = createFakeClient({
      init: vi.fn(() => new Promise<SamDevice>(() => {})),
      onProgress: vi.fn((listener: (event: SamProgressEvent) => void) => {
        progressListener = listener;
        return () => {};
      }),
    });
    render(<SegmentPage createClient={() => client} />);

    act(() => {
      progressListener?.({ file: "model.onnx", loaded: 10, total: null });
    });

    expect(screen.getByText("モデルを読み込み中...")).toBeInTheDocument();
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

  it("Case 16-18: segStatus が segmenting のとき（mask は前回の値が残っている）「レイヤーとして保存」ボタンが disabled である", async () => {
    const image: LoadedImage = {
      data: new Uint8ClampedArray([255, 0, 0, 255]),
      width: 1,
      height: 1,
      objectUrl: "blob:imageA",
    };
    vi.spyOn(imageLoaderModule, "fileToLoadedImage").mockResolvedValue(image);

    const mask1: SamMaskResult = {
      data: new Uint8Array([1]),
      width: 1,
      height: 1,
      score: 0.8,
    };
    const segmentDeferred = createDeferred<SamMaskResult[]>();
    const segmentAtPointsMock = vi
      .fn()
      .mockResolvedValueOnce([mask1])
      .mockImplementationOnce(() => segmentDeferred.promise);

    const client = createFakeClient({
      init: vi.fn(async (): Promise<SamDevice> => "webgpu"),
      segmentAtPoints: segmentAtPointsMock,
    });
    render(<SegmentPage createClient={() => client} />);

    await waitFor(() => {
      expect(screen.getByText("WebGPU")).toBeInTheDocument();
    });

    const fileInput = screen.getByTestId("file-input");
    const file = new File(["dummy"], "image.png", { type: "image/png" });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /レイヤーとして保存/ })
      ).toBeInTheDocument();
    });

    const canvas = document.querySelector("canvas")!;
    canvas.getBoundingClientRect = vi.fn().mockReturnValue({
      left: 0,
      top: 0,
      width: 100,
      height: 100,
      right: 100,
      bottom: 100,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    // 1点目: mask が確定し、ボタンが有効になる
    fireEvent.click(canvas, { clientX: 50, clientY: 50 });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /レイヤーとして保存/ })).toBeEnabled();
    });

    // 2点目（Shift+クリックで追加）: segmentAtPoints が保留中の間、
    // segStatus は "segmenting" になるが mask は直前の値のまま残る
    fireEvent.click(canvas, { clientX: 50, clientY: 50, shiftKey: true });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /レイヤーとして保存/ })).toBeDisabled();
    });

    await act(async () => {
      segmentDeferred.resolve([mask1]);
    });
  });

  it("Case 6: 実行方式セレクタで「PCローカルサーバー」を選ぶとモデル選択UIが表示される", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href.endsWith("/models")) {
        return new Response(
          JSON.stringify([{ id: "slimsam-77-uniform", name: "SlimSAM 77 Uniform" }]),
          { status: 200 }
        );
      }
      throw new Error(`unexpected fetch: ${href}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = createFakeClient({
      init: vi.fn(async (): Promise<SamDevice> => "webgpu"),
    });
    render(<SegmentPage createClient={() => client} />);

    expect(screen.queryByLabelText("モデル")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("実行方式"), {
      target: { value: "local-server" },
    });

    await waitFor(() => {
      expect(screen.getByLabelText("モデル")).toBeInTheDocument();
    });
  });

  it("追加: サーバー未起動状態で「PCローカルサーバー」を選ぶとエラーメッセージが表示される", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = createFakeClient();
    render(<SegmentPage createClient={() => client} />);

    fireEvent.change(screen.getByLabelText("実行方式"), {
      target: { value: "local-server" },
    });

    await waitFor(() => {
      expect(screen.getByText("サーバーに接続できません")).toBeInTheDocument();
    });
  });

  it("追加: PCローカルサーバーでモデルを選択すると ready になり選択したモデル名のバッジが表示される", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href.endsWith("/health")) {
        return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
      }
      if (href.endsWith("/models")) {
        return new Response(
          JSON.stringify([{ id: "slimsam-77-uniform", name: "SlimSAM 77 Uniform" }]),
          { status: 200 }
        );
      }
      throw new Error(`unexpected fetch: ${href}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = createFakeClient();
    render(<SegmentPage createClient={() => client} />);

    fireEvent.change(screen.getByLabelText("実行方式"), {
      target: { value: "local-server" },
    });

    await waitFor(() => {
      expect(screen.getByLabelText("モデル")).toHaveValue("slimsam-77-uniform");
    });

    await waitFor(() => {
      expect(screen.getByTestId("engine-badge")).toHaveTextContent("SlimSAM 77 Uniform");
    });
  });
});
