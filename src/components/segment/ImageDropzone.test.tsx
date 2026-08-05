import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ImageDropzone } from "./ImageDropzone";

describe("ImageDropzone", () => {
  it("Case 13: 画像以外のファイルは拒否してエラーを画面に出す", () => {
    const onImageLoaded = vi.fn();
    render(<ImageDropzone onImageLoaded={onImageLoaded} />);

    const fileInput = screen.getByTestId("file-input");
    const textFile = new File(["hello"], "hello.txt", { type: "text/plain" });

    fireEvent.change(fileInput, { target: { files: [textFile] } });

    expect(onImageLoaded).not.toHaveBeenCalled();
    expect(screen.getByText(/画像ファイルを選択してください/i)).toBeInTheDocument();
  });
});
