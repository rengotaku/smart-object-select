import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isImageFile, fileToLoadedImage } from "./imageLoader";

describe("imageLoader", () => {
  let createObjectURLSpy: ReturnType<typeof vi.fn>;
  let revokeObjectURLSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    createObjectURLSpy = vi.fn(() => "blob:mock-fail-url");
    revokeObjectURLSpy = vi.fn();
    vi.stubGlobal("URL", {
      createObjectURL: createObjectURLSpy,
      revokeObjectURL: revokeObjectURLSpy,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("isImageFile: 画像ファイルの MIME タイプを判定する", () => {
    const pngFile = new File(["dummy"], "test.png", { type: "image/png" });
    const jpegFile = new File(["dummy"], "test.jpg", { type: "image/jpeg" });
    const textFile = new File(["dummy"], "test.txt", { type: "text/plain" });

    expect(isImageFile(pngFile)).toBe(true);
    expect(isImageFile(jpegFile)).toBe(true);
    expect(isImageFile(textFile)).toBe(false);
  });

  it("Case 18: デコード失敗時に objectUrl が解放される", async () => {
    HTMLCanvasElement.prototype.getContext = vi
      .fn()
      .mockReturnValue(null) as unknown as typeof HTMLCanvasElement.prototype.getContext;

    class FakeImage {
      set src(_val: string) {
        setTimeout(() => {
          if (this.onload) this.onload();
        }, 0);
      }
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      width = 100;
      height = 100;
      naturalWidth = 100;
      naturalHeight = 100;
    }
    vi.stubGlobal("Image", FakeImage);

    const imageFile = new File(["dummy"], "test.png", { type: "image/png" });

    await expect(fileToLoadedImage(imageFile)).rejects.toThrow();
    expect(revokeObjectURLSpy).toHaveBeenCalledWith("blob:mock-fail-url");
  });
});
