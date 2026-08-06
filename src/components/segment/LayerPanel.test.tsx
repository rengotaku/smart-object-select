import { render, fireEvent, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { LayerPanel } from "./LayerPanel";
import type { SamImageInput, SamMaskResult } from "@/lib/sam";
import type { SavedLayer } from "@/hooks";

describe("LayerPanel", () => {
  beforeEach(() => {
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
      drawImage: vi.fn(),
      putImageData: vi.fn(),
      clearRect: vi.fn(),
      createImageData: vi.fn((w: number, h: number) => ({
        data: new Uint8ClampedArray(w * h * 4),
        width: w,
        height: h,
      })),
      beginPath: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
    }) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  });

  const mockImage: SamImageInput = {
    data: new Uint8ClampedArray(10 * 10 * 4),
    width: 10,
    height: 10,
  };

  const mockMask1: SamMaskResult = {
    data: new Uint8Array(10 * 10),
    width: 10,
    height: 10,
    score: 0.9,
  };

  const mockMask2: SamMaskResult = {
    data: new Uint8Array(10 * 10),
    width: 10,
    height: 10,
    score: 0.8,
  };

  const mockLayers: SavedLayer[] = [
    { id: "layer-1", label: "レイヤー1", mask: mockMask1 },
    { id: "layer-2", label: "レイヤー2", mask: mockMask2 },
  ];

  it("Case 16-7: layers が空のとき何もレンダリングしない", () => {
    const onRemove = vi.fn();
    const { container } = render(
      <LayerPanel image={mockImage} layers={[]} onRemove={onRemove} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("Case 16-8: layers の件数分サムネイル・削除ボタン・ExportBar が描画される", () => {
    const onRemove = vi.fn();
    const { container } = render(
      <LayerPanel image={mockImage} layers={mockLayers} onRemove={onRemove} />
    );

    expect(screen.getByText("レイヤー1")).toBeInTheDocument();
    expect(screen.getByText("レイヤー2")).toBeInTheDocument();

    const canvases = container.querySelectorAll("canvas");
    expect(canvases).toHaveLength(2);

    const deleteButtons = screen.getAllByRole("button", { name: /削除/i });
    expect(deleteButtons).toHaveLength(2);

    const cutoutButtons = screen.getAllByText("透過切り抜き PNG");
    expect(cutoutButtons).toHaveLength(2);
  });

  it("Case 16-9: 削除ボタンをクリックすると該当レイヤーの id で onRemove が呼ばれる", () => {
    const onRemove = vi.fn();
    render(<LayerPanel image={mockImage} layers={mockLayers} onRemove={onRemove} />);

    const deleteButtons = screen.getAllByRole("button", { name: /削除/i });
    fireEvent.click(deleteButtons[0]);

    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledWith("layer-1");
  });

  it("Case 16-16: サムネイル canvas がバウンディングボックス+余白のサイズで描画される（画像全体のサイズより小さい）", () => {
    const largeImage: SamImageInput = {
      data: new Uint8ClampedArray(100 * 100 * 4),
      width: 100,
      height: 100,
    };

    const smallMaskData = new Uint8Array(100 * 100);
    // (40,40)〜(50,50) の範囲だけ1
    for (let y = 40; y <= 50; y++) {
      for (let x = 40; x <= 50; x++) {
        smallMaskData[y * 100 + x] = 1;
      }
    }

    const smallLayer: SavedLayer = {
      id: "small-layer",
      label: "小さいレイヤー",
      mask: {
        data: smallMaskData,
        width: 100,
        height: 100,
        score: 0.9,
      },
    };

    const onRemove = vi.fn();
    const { container } = render(
      <LayerPanel image={largeImage} layers={[smallLayer]} onRemove={onRemove} />
    );

    const canvas = container.querySelector("canvas")!;
    expect(canvas).toBeInTheDocument();
    expect(canvas.width).toBeLessThan(largeImage.width);
    expect(canvas.height).toBeLessThan(largeImage.height);
  });
});
