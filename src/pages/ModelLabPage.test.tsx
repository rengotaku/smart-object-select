import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ModelLabPage } from "./ModelLabPage";
import * as imageLoaderModule from "@/lib/sam/imageLoader";
import type { LoadedImage } from "@/hooks";

describe("ModelLabPage", () => {
  let revokeObjectURL: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:fake"),
      revokeObjectURL,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("タイトルと画像アップロードUIを表示する", () => {
    render(<ModelLabPage />);

    expect(screen.getByRole("heading", { name: "Model Lab" })).toBeInTheDocument();
    expect(screen.getByTestId("file-input")).toBeInTheDocument();
  });

  it("モデル切り替えUIをレンダリングする（選択肢が空でもプレースホルダを表示する）", () => {
    render(<ModelLabPage />);

    const select = screen.getByLabelText("モデル") as HTMLSelectElement;
    expect(select).toBeInTheDocument();
    expect(select).toBeDisabled();
    expect(screen.getByText("検証可能なモデルはまだありません")).toBeInTheDocument();
  });

  it("画像をアップロードすると実行結果表示エリアにプレビューが出る", async () => {
    const image: LoadedImage = {
      data: new Uint8ClampedArray([255, 0, 0, 255]),
      width: 1,
      height: 1,
      objectUrl: "blob:image-a",
    };
    vi.spyOn(imageLoaderModule, "fileToLoadedImage").mockResolvedValue(image);

    render(<ModelLabPage />);

    const fileInput = screen.getByTestId("file-input");
    const file = new File(["dummy"], "image.png", { type: "image/png" });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByTestId("model-lab-preview-image")).toHaveAttribute(
        "src",
        "blob:image-a"
      );
    });

    // アップロード後は ImageDropzone が消え、「別の画像を選ぶ」ボタンが現れる
    expect(screen.queryByTestId("file-input")).not.toBeInTheDocument();
    expect(screen.getByTestId("model-lab-reset-image")).toBeInTheDocument();
  });

  it("「別の画像を選ぶ」ボタンでアップロード前の状態に戻る", async () => {
    const image: LoadedImage = {
      data: new Uint8ClampedArray([255, 0, 0, 255]),
      width: 1,
      height: 1,
      objectUrl: "blob:image-a",
    };
    vi.spyOn(imageLoaderModule, "fileToLoadedImage").mockResolvedValue(image);

    render(<ModelLabPage />);

    const fileInput = screen.getByTestId("file-input");
    const file = new File(["dummy"], "image.png", { type: "image/png" });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByTestId("model-lab-reset-image")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("model-lab-reset-image"));

    expect(screen.getByTestId("file-input")).toBeInTheDocument();
    expect(screen.queryByTestId("model-lab-preview-image")).not.toBeInTheDocument();
  });

  it("「別の画像を選ぶ」でリセットするとき、アップロード済み画像の Object URL を revoke する", async () => {
    const image: LoadedImage = {
      data: new Uint8ClampedArray([255, 0, 0, 255]),
      width: 1,
      height: 1,
      objectUrl: "blob:image-a",
    };
    vi.spyOn(imageLoaderModule, "fileToLoadedImage").mockResolvedValue(image);

    render(<ModelLabPage />);

    const fileInput = screen.getByTestId("file-input");
    const file = new File(["dummy"], "image.png", { type: "image/png" });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByTestId("model-lab-reset-image")).toBeInTheDocument();
    });

    expect(revokeObjectURL).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("model-lab-reset-image"));

    expect(revokeObjectURL).toHaveBeenCalledWith("blob:image-a");
  });

  it("アンマウント時、アップロード済み画像の Object URL を revoke する", async () => {
    const image: LoadedImage = {
      data: new Uint8ClampedArray([255, 0, 0, 255]),
      width: 1,
      height: 1,
      objectUrl: "blob:image-b",
    };
    vi.spyOn(imageLoaderModule, "fileToLoadedImage").mockResolvedValue(image);

    const { unmount } = render(<ModelLabPage />);

    const fileInput = screen.getByTestId("file-input");
    const file = new File(["dummy"], "image.png", { type: "image/png" });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByTestId("model-lab-reset-image")).toBeInTheDocument();
    });

    expect(revokeObjectURL).not.toHaveBeenCalled();

    unmount();

    expect(revokeObjectURL).toHaveBeenCalledWith("blob:image-b");
  });

  it("画像未アップロードのままアンマウントしても revoke を呼ばない", () => {
    const { unmount } = render(<ModelLabPage />);

    unmount();

    expect(revokeObjectURL).not.toHaveBeenCalled();
  });
});
