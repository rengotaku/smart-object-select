import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildExportFilename,
  copyImageToClipboard,
  pixelsToPngBlob,
  triggerDownload,
  type CanvasFactory,
} from "./download";
import type { RgbaPixels } from "./exportImage";

/**
 * jsdom は HTMLCanvasElement.toBlob / 2D context を実装していないため、
 * `getContext("2d")` / `toBlob` を spy 化した fake canvas を注入して検証する。
 */
function createFakeCanvas() {
  const putImageData = vi.fn();
  const createImageData = vi.fn((width: number, height: number) => ({
    data: new Uint8ClampedArray(width * height * 4),
    width,
    height,
  }));
  const toBlob = vi.fn<(cb: (blob: Blob | null) => void, type?: string) => void>((cb) => {
    cb(new Blob());
  });

  const context = { putImageData, createImageData };
  const canvas = {
    getContext: vi.fn(() => context),
    toBlob,
  } as unknown as HTMLCanvasElement;

  return { canvas, putImageData, createImageData, toBlob };
}

describe("download", () => {
  describe("pixelsToPngBlob", () => {
    it("Case 4-5: canvas へ描いて PNG として書き出す", async () => {
      const pixels: RgbaPixels = {
        data: new Uint8ClampedArray(4),
        width: 1,
        height: 1,
      };
      const { canvas, putImageData, toBlob } = createFakeCanvas();
      const fakeCreateCanvas: CanvasFactory = vi.fn(() => canvas);

      const result = await pixelsToPngBlob(pixels, fakeCreateCanvas);

      expect(fakeCreateCanvas).toHaveBeenCalledWith(1, 1);
      expect(putImageData).toHaveBeenCalled();
      expect(toBlob.mock.calls[0][1]).toBe("image/png");
      expect(result).toBeInstanceOf(Blob);
    });

    it("Case 4-6: toBlob が null を返したら reject する", async () => {
      const pixels: RgbaPixels = {
        data: new Uint8ClampedArray(4),
        width: 1,
        height: 1,
      };
      const { canvas, toBlob } = createFakeCanvas();
      toBlob.mockImplementation((cb: (blob: Blob | null) => void) => cb(null));
      const fakeCreateCanvas: CanvasFactory = vi.fn(() => canvas);

      await expect(pixelsToPngBlob(pixels, fakeCreateCanvas)).rejects.toThrow(Error);
    });
  });

  describe("triggerDownload", () => {
    let createObjectURL: ReturnType<typeof vi.fn>;
    let revokeObjectURL: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      createObjectURL = vi.fn(() => "blob:fake-url");
      revokeObjectURL = vi.fn();
      vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    });

    it("Case 4-7: ファイル名を設定してクリックし object URL を解放する", () => {
      const click = vi.fn();
      const anchor = { href: "", download: "", click } as unknown as HTMLAnchorElement;
      const createElement = vi.fn(() => anchor);
      const fakeDoc = { createElement } as unknown as Document;

      const blob = new Blob();
      triggerDownload(blob, "smart-object-select-cutout-sample.png", fakeDoc);
      vi.runAllTimers();

      expect(createElement).toHaveBeenCalledWith("a");
      expect(anchor.download).toBe("smart-object-select-cutout-sample.png");
      expect(anchor.href).toBe("blob:fake-url");
      expect(click).toHaveBeenCalledTimes(1);
      expect(createObjectURL).toHaveBeenCalledWith(blob);
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:fake-url");
    });

    it("Case 4-14: revoke がクリックと同じ同期処理内では呼ばれない", () => {
      const click = vi.fn();
      const anchor = { href: "", download: "", click } as unknown as HTMLAnchorElement;
      const createElement = vi.fn(() => anchor);
      const fakeDoc = { createElement } as unknown as Document;

      const blob = new Blob();
      triggerDownload(blob, "smart-object-select-cutout-sample.png", fakeDoc);

      expect(revokeObjectURL).toHaveBeenCalledTimes(0);

      vi.runAllTimers();

      expect(revokeObjectURL).toHaveBeenCalledTimes(1);
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:fake-url");
    });
  });

  describe("copyImageToClipboard", () => {
    beforeEach(() => {
      // jsdom の navigator には clipboard が無いことを保証する（jsdom バージョンに
      // 依存させず「非対応」経路を確実にテストするため明示的に stub する）。
      vi.stubGlobal("navigator", {});
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("Case 4-8: Clipboard API が使えないとき Error で reject する", async () => {
      const blob = new Blob();

      await expect(copyImageToClipboard(blob, undefined)).rejects.toThrow(/clipboard/i);
      await expect(
        copyImageToClipboard(blob, { write: () => Promise.reject(new Error("denied")) })
      ).rejects.toThrow();
    });
  });

  describe("buildExportFilename", () => {
    it("Case 4-9: 元ファイル名を反映し危険な文字を除去する", () => {
      const withSource = buildExportFilename("cutout", "my photo.png");
      expect(withSource).toContain("cutout");
      expect(withSource).toContain("my photo");
      expect(withSource.endsWith(".png")).toBe(true);

      const traversal = buildExportFilename("mask", "../../etc/passwd");
      expect(traversal).not.toContain("/");
      expect(traversal).not.toContain("..");

      const noSource = buildExportFilename("cutout");
      expect(noSource).not.toMatch(/photo|passwd/);
      expect(noSource.endsWith(".png")).toBe(true);
    });
  });
});
