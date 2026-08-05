import { describe, it, expect } from "vitest";
import { isImageFile } from "./imageLoader";

describe("imageLoader", () => {
  it("isImageFile: 画像ファイルの MIME タイプを判定する", () => {
    const pngFile = new File(["dummy"], "test.png", { type: "image/png" });
    const jpegFile = new File(["dummy"], "test.jpg", { type: "image/jpeg" });
    const textFile = new File(["dummy"], "test.txt", { type: "text/plain" });

    expect(isImageFile(pngFile)).toBe(true);
    expect(isImageFile(jpegFile)).toBe(true);
    expect(isImageFile(textFile)).toBe(false);
  });
});
