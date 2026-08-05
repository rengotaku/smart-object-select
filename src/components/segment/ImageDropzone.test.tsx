import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ImageDropzone } from "./ImageDropzone";
import * as imageLoaderModule from "@/lib/sam/imageLoader";
import type { LoadedImage } from "@/hooks";

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("ImageDropzone", () => {
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
    vi.restoreAllMocks();
  });

  it("Case 13: 画像以外のファイルは拒否してエラーを画面に出す", () => {
    const onImageLoaded = vi.fn();
    render(<ImageDropzone onImageLoaded={onImageLoaded} />);

    const fileInput = screen.getByTestId("file-input");
    const textFile = new File(["hello"], "hello.txt", { type: "text/plain" });

    fireEvent.change(fileInput, { target: { files: [textFile] } });

    expect(onImageLoaded).not.toHaveBeenCalled();
    expect(screen.getByText(/画像ファイルを選択してください/i)).toBeInTheDocument();
  });

  it("Case 16: デコード中に別の画像を選ぶと古いデコード結果は通知されず解放される", async () => {
    const deferredA = createDeferred<LoadedImage>();
    const deferredB = createDeferred<LoadedImage>();

    const imageA: LoadedImage = {
      data: new Uint8ClampedArray([255, 0, 0, 255]),
      width: 1,
      height: 1,
      objectUrl: "blob:imageA",
    };
    const imageB: LoadedImage = {
      data: new Uint8ClampedArray([0, 255, 0, 255]),
      width: 1,
      height: 1,
      objectUrl: "blob:imageB",
    };

    const spyFileToLoadedImage = vi
      .spyOn(imageLoaderModule, "fileToLoadedImage")
      .mockImplementation((file: File) => {
        if (file.name === "imageA.png") return deferredA.promise;
        if (file.name === "imageB.png") return deferredB.promise;
        return Promise.reject(new Error("Unknown file"));
      });

    const onImageLoaded = vi.fn();
    render(<ImageDropzone onImageLoaded={onImageLoaded} />);

    const fileInput = screen.getByTestId("file-input");
    const fileA = new File(["dummyA"], "imageA.png", { type: "image/png" });
    const fileB = new File(["dummyB"], "imageB.png", { type: "image/png" });

    fireEvent.change(fileInput, { target: { files: [fileA] } });
    expect(spyFileToLoadedImage).toHaveBeenCalledWith(fileA);

    fireEvent.change(fileInput, { target: { files: [fileB] } });
    expect(spyFileToLoadedImage).toHaveBeenCalledWith(fileB);

    await act(async () => {
      deferredB.resolve(imageB);
    });

    expect(onImageLoaded).toHaveBeenCalledTimes(1);
    expect(onImageLoaded).toHaveBeenCalledWith(imageB);

    await act(async () => {
      deferredA.resolve(imageA);
    });

    expect(onImageLoaded).toHaveBeenCalledTimes(1);
    expect(revokeObjectURLSpy).toHaveBeenCalledWith("blob:imageA");
  });
});
