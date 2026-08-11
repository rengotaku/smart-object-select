import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ModelLabPage } from "./ModelLabPage";
import * as imageLoaderModule from "@/lib/imageLoader";
import type { LoadedImage } from "@/lib/imageLoader";
import type { EdgeSamMaskResult, EdgeSamWorkerClient } from "@/lib/modelLab/edgeSam";

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

const image: LoadedImage = {
  data: new Uint8ClampedArray(2 * 2 * 4),
  width: 2,
  height: 2,
  objectUrl: "blob:image-edge-sam",
};

async function uploadImage() {
  vi.spyOn(imageLoaderModule, "fileToLoadedImage").mockResolvedValue(image);
  const fileInput = screen.getByTestId("file-input");
  const file = new File(["dummy"], "image.png", { type: "image/png" });
  fireEvent.change(fileInput, { target: { files: [file] } });

  await waitFor(() => {
    expect(screen.getByTestId("model-lab-preview-image")).toBeInTheDocument();
  });
}

function selectEdgeSam() {
  const select = screen.getByLabelText("モデル") as HTMLSelectElement;
  fireEvent.change(select, { target: { value: "edge-sam" } });
}

describe("ModelLabPage（EdgeSAM 統合, issue #48）", () => {
  beforeEach(() => {
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:fake"),
      revokeObjectURL: vi.fn(),
    });
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
      drawImage: vi.fn(),
      putImageData: vi.fn(),
      clearRect: vi.fn(),
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

  it("EdgeSAM を選択して画像をクリックするとマスクが表示される", async () => {
    const client = createFakeClient();
    render(<ModelLabPage createEdgeSamClient={() => client} />);

    await uploadImage();
    selectEdgeSam();

    const preview = screen.getByTestId("model-lab-preview-image");
    preview.getBoundingClientRect = vi.fn().mockReturnValue({
      left: 0,
      top: 0,
      width: 2,
      height: 2,
      right: 2,
      bottom: 2,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    fireEvent.click(preview, { clientX: 1, clientY: 1 });

    await waitFor(() => {
      expect(screen.getByTestId("model-lab-overlay-layer")).toBeInTheDocument();
    });

    expect(screen.queryByTestId("model-lab-processing")).not.toBeInTheDocument();
    expect(client.setImage).toHaveBeenCalledWith(image);
    expect(client.segmentAtPoint).toHaveBeenCalledWith(1, 1);
  });

  it("推論に失敗するとエラーメッセージを表示する", async () => {
    const client = createFakeClient({
      segmentAtPoint: vi.fn().mockRejectedValue(new Error("decode failed in test")),
    });
    render(<ModelLabPage createEdgeSamClient={() => client} />);

    await uploadImage();
    selectEdgeSam();

    const preview = screen.getByTestId("model-lab-preview-image");
    preview.getBoundingClientRect = vi.fn().mockReturnValue({
      left: 0,
      top: 0,
      width: 2,
      height: 2,
      right: 2,
      bottom: 2,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    fireEvent.click(preview, { clientX: 1, clientY: 1 });

    await waitFor(() => {
      expect(screen.getByText("decode failed in test")).toBeInTheDocument();
    });
  });

  it("MobileSAM から EdgeSAM に切り替えると MobileSAM のクライアントは使われない", async () => {
    const mobileSamClient = {
      setImage: vi.fn(async (): Promise<void> => undefined),
      segmentAtPoint: vi.fn(),
      terminate: vi.fn(),
    };
    const edgeSamClient = createFakeClient();

    render(
      <ModelLabPage
        createMobileSamClient={() => mobileSamClient}
        createEdgeSamClient={() => edgeSamClient}
      />
    );

    await uploadImage();
    selectEdgeSam();

    const preview = screen.getByTestId("model-lab-preview-image");
    preview.getBoundingClientRect = vi.fn().mockReturnValue({
      left: 0,
      top: 0,
      width: 2,
      height: 2,
      right: 2,
      bottom: 2,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    fireEvent.click(preview, { clientX: 1, clientY: 1 });

    await waitFor(() => {
      expect(edgeSamClient.segmentAtPoint).toHaveBeenCalledWith(1, 1);
    });

    expect(mobileSamClient.segmentAtPoint).not.toHaveBeenCalled();
  });
});
