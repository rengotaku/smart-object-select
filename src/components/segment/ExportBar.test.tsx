import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ExportBar } from "./ExportBar";
import type { SamImageInput, SamMaskResult } from "@/lib/sam";

describe("ExportBar", () => {
  it("Case 4-10: マスク未選択時は3ボタンすべて disabled", () => {
    const image: SamImageInput = { data: new Uint8ClampedArray(4), width: 1, height: 1 };
    const exportPng = vi.fn();
    const saveFile = vi.fn();
    const copyToClipboard = vi.fn();

    render(
      <ExportBar
        image={image}
        mask={null}
        exportPng={exportPng}
        saveFile={saveFile}
        copyToClipboard={copyToClipboard}
      />
    );

    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(3);
    for (const button of buttons) {
      expect(button).toBeDisabled();
    }

    for (const button of buttons) {
      fireEvent.click(button);
    }

    expect(exportPng).not.toHaveBeenCalled();
    expect(saveFile).not.toHaveBeenCalled();
    expect(copyToClipboard).not.toHaveBeenCalled();
  });

  it("Case 4-11: クリップボードコピー失敗時にエラーが画面に出る", async () => {
    const image: SamImageInput = { data: new Uint8ClampedArray(4), width: 1, height: 1 };
    const mask: SamMaskResult = {
      data: new Uint8Array([1]),
      width: 1,
      height: 1,
      score: 0.9,
    };
    const exportPng = vi.fn().mockResolvedValue(new Blob());
    const saveFile = vi.fn();
    const copyToClipboard = vi.fn().mockRejectedValue(new Error("Clipboard denied"));

    render(
      <ExportBar
        image={image}
        mask={mask}
        exportPng={exportPng}
        saveFile={saveFile}
        copyToClipboard={copyToClipboard}
      />
    );

    const copyButton = screen.getByRole("button", { name: /クリップボード/ });
    await act(async () => {
      fireEvent.click(copyButton);
    });

    await waitFor(() => {
      expect(screen.getByText(/Clipboard denied/)).toBeInTheDocument();
    });
    expect(saveFile).not.toHaveBeenCalled();
  });

  it("追加: 透過切り抜きボタンは合成済みピクセルと cutout ファイル名で書き出しを呼ぶ", async () => {
    const image: SamImageInput = {
      data: new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 255]),
      width: 2,
      height: 1,
    };
    const mask: SamMaskResult = {
      data: new Uint8Array([0, 1]),
      width: 2,
      height: 1,
      score: 0.9,
    };
    const blob = new Blob();
    const exportPng = vi.fn().mockResolvedValue(blob);
    const saveFile = vi.fn();
    const copyToClipboard = vi.fn();

    render(
      <ExportBar
        image={image}
        mask={mask}
        sourceFileName="photo.png"
        exportPng={exportPng}
        saveFile={saveFile}
        copyToClipboard={copyToClipboard}
      />
    );

    const cutoutButton = screen.getByRole("button", { name: /透過切り抜き/ });
    await act(async () => {
      fireEvent.click(cutoutButton);
    });

    expect(exportPng).toHaveBeenCalledTimes(1);
    const pixelsArg = exportPng.mock.calls[0][0];
    expect(pixelsArg.width).toBe(2);
    expect(pixelsArg.height).toBe(1);
    // マスク外（画素0）はアルファ 0、マスク内（画素1）は元画像の色を維持
    expect(pixelsArg.data[3]).toBe(0);
    expect(Array.from(pixelsArg.data.slice(4, 8))).toEqual([40, 50, 60, 255]);

    expect(saveFile).toHaveBeenCalledTimes(1);
    expect(saveFile.mock.calls[0][0]).toBe(blob);
    expect(saveFile.mock.calls[0][1]).toContain("cutout");
    expect(saveFile.mock.calls[0][1]).toContain("photo");
  });

  it("追加: マスク画像ボタンは白黒ピクセルと mask ファイル名で書き出しを呼ぶ", async () => {
    const image: SamImageInput = {
      data: new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 255]),
      width: 2,
      height: 1,
    };
    const mask: SamMaskResult = {
      data: new Uint8Array([0, 1]),
      width: 2,
      height: 1,
      score: 0.9,
    };
    const blob = new Blob();
    const exportPng = vi.fn().mockResolvedValue(blob);
    const saveFile = vi.fn();
    const copyToClipboard = vi.fn();

    render(
      <ExportBar
        image={image}
        mask={mask}
        exportPng={exportPng}
        saveFile={saveFile}
        copyToClipboard={copyToClipboard}
      />
    );

    const maskButton = screen.getByRole("button", { name: /マスク画像/ });
    await act(async () => {
      fireEvent.click(maskButton);
    });

    expect(exportPng).toHaveBeenCalledTimes(1);
    const pixelsArg = exportPng.mock.calls[0][0];
    expect(Array.from(pixelsArg.data.slice(0, 4))).toEqual([0, 0, 0, 255]);
    expect(Array.from(pixelsArg.data.slice(4, 8))).toEqual([255, 255, 255, 255]);

    expect(saveFile).toHaveBeenCalledTimes(1);
    expect(saveFile.mock.calls[0][1]).toContain("mask");
  });

  it("追加: 書き出し失敗時（toBlobが reject）にエラーが画面に出る", async () => {
    const image: SamImageInput = { data: new Uint8ClampedArray(4), width: 1, height: 1 };
    const mask: SamMaskResult = {
      data: new Uint8Array([1]),
      width: 1,
      height: 1,
      score: 0.9,
    };
    const exportPng = vi.fn().mockRejectedValue(new Error("Failed to encode PNG blob."));
    const saveFile = vi.fn();
    const copyToClipboard = vi.fn();

    render(
      <ExportBar
        image={image}
        mask={mask}
        exportPng={exportPng}
        saveFile={saveFile}
        copyToClipboard={copyToClipboard}
      />
    );

    const cutoutButton = screen.getByRole("button", { name: /透過切り抜き/ });
    await act(async () => {
      fireEvent.click(cutoutButton);
    });

    await waitFor(() => {
      expect(screen.getByText(/Failed to encode PNG blob/)).toBeInTheDocument();
    });
    expect(saveFile).not.toHaveBeenCalled();
  });

  it("Case 4-12: sourceFileName を渡すとその名前が書き出しファイル名に反映される", async () => {
    const image: SamImageInput = { data: new Uint8ClampedArray(4), width: 1, height: 1 };
    const mask: SamMaskResult = {
      data: new Uint8Array([1]),
      width: 1,
      height: 1,
      score: 0.9,
    };
    const blob = new Blob();
    const exportPng = vi.fn().mockResolvedValue(blob);
    const saveFile = vi.fn();
    const copyToClipboard = vi.fn();

    render(
      <ExportBar
        image={image}
        mask={mask}
        sourceFileName="my photo.png"
        exportPng={exportPng}
        saveFile={saveFile}
        copyToClipboard={copyToClipboard}
      />
    );

    const cutoutButton = screen.getByRole("button", { name: /透過切り抜き/ });
    await act(async () => {
      fireEvent.click(cutoutButton);
    });

    expect(saveFile).toHaveBeenCalledTimes(1);
    const filename = saveFile.mock.calls[0][1];
    expect(filename).toContain("my photo");
    expect(filename.endsWith(".png")).toBe(true);
    expect(filename).not.toBe("smart-object-select-cutout.png");
  });
});
