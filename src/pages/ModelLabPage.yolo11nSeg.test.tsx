import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ModelLabPage } from "./ModelLabPage";
import * as imageLoaderModule from "@/lib/sam/imageLoader";
import type { LoadedImage } from "@/hooks";
import type {
  Yolo11nSegDetection,
  Yolo11nSegWorkerClient,
} from "@/lib/modelLab/yolo11nSeg";

const image: LoadedImage = {
  data: new Uint8ClampedArray(4 * 4 * 4),
  width: 4,
  height: 4,
  objectUrl: "blob:image-yolo",
};

// 画像全体を覆う person(0,0)-(2,2) と cat(2,2)-(4,4) の2インスタンス。
const DETECTIONS: Yolo11nSegDetection[] = [
  {
    classId: 0,
    label: "person",
    score: 0.91,
    box: { x: 0, y: 0, width: 2, height: 2 },
    mask: {
      data: new Uint8Array([
        1,
        1,
        0,
        0, //
        1,
        1,
        0,
        0, //
        0,
        0,
        0,
        0, //
        0,
        0,
        0,
        0, //
      ]),
      width: 4,
      height: 4,
    },
  },
  {
    classId: 15,
    label: "cat",
    score: 0.82,
    box: { x: 2, y: 2, width: 2, height: 2 },
    mask: {
      data: new Uint8Array([
        0,
        0,
        0,
        0, //
        0,
        0,
        0,
        0, //
        0,
        0,
        1,
        1, //
        0,
        0,
        1,
        1, //
      ]),
      width: 4,
      height: 4,
    },
  },
];

function createFakeClient(
  overrides: Partial<Yolo11nSegWorkerClient> = {}
): Yolo11nSegWorkerClient {
  return {
    detect: vi.fn(async (): Promise<Yolo11nSegDetection[]> => DETECTIONS),
    terminate: vi.fn(),
    ...overrides,
  };
}

async function uploadImage() {
  vi.spyOn(imageLoaderModule, "fileToLoadedImage").mockResolvedValue(image);
  const fileInput = screen.getByTestId("file-input");
  const file = new File(["dummy"], "image.png", { type: "image/png" });
  fireEvent.change(fileInput, { target: { files: [file] } });

  await waitFor(() => {
    expect(screen.getByTestId("model-lab-preview-image")).toBeInTheDocument();
  });
}

function selectYoloModel() {
  const select = screen.getByLabelText("モデル") as HTMLSelectElement;
  fireEvent.change(select, { target: { value: "yolo11n-seg" } });
}

describe("ModelLabPage（YOLO11n-seg 統合, issue #49）", () => {
  beforeEach(() => {
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:fake"),
      revokeObjectURL: vi.fn(),
    });
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
      drawImage: vi.fn(),
      putImageData: vi.fn(),
      clearRect: vi.fn(),
      strokeRect: vi.fn(),
      createImageData: vi.fn((w: number, h: number) => ({
        data: new Uint8ClampedArray(w * h * 4),
        width: w,
        height: h,
      })),
    }) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("YOLO11n-seg を選択して画像をアップロードすると全自動で検出しオーバーレイを表示する", async () => {
    const client = createFakeClient();
    render(<ModelLabPage createYolo11nSegClient={() => client} />);

    selectYoloModel();
    await uploadImage();

    await waitFor(() => {
      expect(client.detect).toHaveBeenCalledWith(image);
    });
    await waitFor(() => {
      expect(screen.getByTestId("model-lab-overlay-layer")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("model-lab-processing")).not.toBeInTheDocument();
    expect(screen.getByTestId("model-lab-yolo-summary")).toHaveTextContent("検出数: 2件");
  });

  it("COCO80クラス限定である旨の注記を表示する", async () => {
    render(<ModelLabPage createYolo11nSegClient={() => createFakeClient()} />);

    selectYoloModel();

    expect(screen.getByTestId("model-lab-yolo-scope-notice")).toBeInTheDocument();
  });

  it("画像アップロード前はクリックせずとも検出を実行しない（画像必須）", async () => {
    const client = createFakeClient();
    render(<ModelLabPage createYolo11nSegClient={() => client} />);

    selectYoloModel();

    expect(client.detect).not.toHaveBeenCalled();
  });

  it("検出済みインスタンスをクリックするとハイライトされ、サマリに選択中インスタンスが表示される", async () => {
    const client = createFakeClient();
    render(<ModelLabPage createYolo11nSegClient={() => client} />);

    selectYoloModel();
    await uploadImage();

    await waitFor(() => {
      expect(screen.getByTestId("model-lab-yolo-summary")).toHaveTextContent(
        "検出数: 2件"
      );
    });

    const preview = screen.getByTestId("model-lab-preview-image");
    preview.getBoundingClientRect = vi.fn().mockReturnValue({
      left: 0,
      top: 0,
      width: 4,
      height: 4,
      right: 4,
      bottom: 4,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    // cat インスタンス側 (3,3) をクリック
    fireEvent.click(preview, { clientX: 3, clientY: 3 });

    await waitFor(() => {
      expect(screen.getByTestId("model-lab-yolo-summary")).toHaveTextContent(
        "選択中: cat（82%）"
      );
    });
  });

  it("推論に失敗するとエラーメッセージを表示する", async () => {
    const client = createFakeClient({
      detect: vi.fn().mockRejectedValue(new Error("detect failed in test")),
    });
    render(<ModelLabPage createYolo11nSegClient={() => client} />);

    selectYoloModel();
    await uploadImage();

    await waitFor(() => {
      expect(screen.getByText("detect failed in test")).toBeInTheDocument();
    });
  });

  it("既存の MobileSAM モデルはクリック=マスク推論のインタラクションのまま変わらない", async () => {
    render(<ModelLabPage createYolo11nSegClient={() => createFakeClient()} />);

    // 既定選択（先頭）は mobile-sam のまま
    const select = screen.getByLabelText("モデル") as HTMLSelectElement;
    expect(select.value).toBe("mobile-sam");
    expect(screen.queryByTestId("model-lab-yolo-scope-notice")).not.toBeInTheDocument();
  });
});
