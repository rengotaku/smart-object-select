import { render, fireEvent, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SegmentCanvas } from "./SegmentCanvas";
import type { LoadedImage } from "@/hooks";

describe("SegmentCanvas", () => {
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

  it("Case 14: 🔴 Canvas のクリックが元画像座標に変換されて渡る", () => {
    const onSelect = vi.fn();
    const mockImage: LoadedImage = {
      data: new Uint8ClampedArray(1600 * 1200 * 4),
      width: 1600,
      height: 1200,
      objectUrl: "blob:test",
    };

    const { container } = render(
      <SegmentCanvas image={mockImage} mask={null} status="ready" onSelect={onSelect} />
    );

    const canvas = container.querySelector("canvas")!;
    expect(canvas).toBeInTheDocument();

    canvas.getBoundingClientRect = vi.fn().mockReturnValue({
      left: 100,
      top: 50,
      width: 400,
      height: 300,
      right: 500,
      bottom: 350,
      x: 100,
      y: 50,
      toJSON: () => {},
    });

    fireEvent.click(canvas, { clientX: 300, clientY: 200 });

    expect(onSelect).toHaveBeenCalledWith(800, 600);
  });

  it("Case 15: 準備中はクリックを受け付けず進捗が表示される", () => {
    const onSelect = vi.fn();
    const mockImage: LoadedImage = {
      data: new Uint8ClampedArray(100 * 100 * 4),
      width: 100,
      height: 100,
      objectUrl: "blob:test",
    };

    const { container } = render(
      <SegmentCanvas
        image={mockImage}
        mask={null}
        status="preparing"
        onSelect={onSelect}
      />
    );

    const canvas = container.querySelector("canvas")!;
    canvas.getBoundingClientRect = vi.fn().mockReturnValue({
      left: 0,
      top: 0,
      width: 100,
      height: 100,
      right: 100,
      bottom: 100,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    fireEvent.click(canvas, { clientX: 50, clientY: 50 });

    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByText(/解析中/i)).toBeInTheDocument();
  });

  it("Case 9b-9: 修飾キーなしのクリックは replace:true で呼ばれる", () => {
    const onPointClick = vi.fn();
    const mockImage: LoadedImage = {
      data: new Uint8ClampedArray(100 * 100 * 4),
      width: 100,
      height: 100,
      objectUrl: "blob:test",
    };

    const { container } = render(
      <SegmentCanvas
        image={mockImage}
        mask={null}
        status="ready"
        onPointClick={onPointClick}
      />
    );

    const canvas = container.querySelector("canvas")!;
    canvas.getBoundingClientRect = vi.fn().mockReturnValue({
      left: 0,
      top: 0,
      width: 100,
      height: 100,
      right: 100,
      bottom: 100,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    fireEvent.click(canvas, { clientX: 50, clientY: 50 });

    expect(onPointClick).toHaveBeenCalledWith(50, 50, 1, { replace: true });
  });

  it("Case 9b-10: Shift+クリックは label:1, replace:false で呼ばれる", () => {
    const onPointClick = vi.fn();
    const mockImage: LoadedImage = {
      data: new Uint8ClampedArray(100 * 100 * 4),
      width: 100,
      height: 100,
      objectUrl: "blob:test",
    };

    const { container } = render(
      <SegmentCanvas
        image={mockImage}
        mask={null}
        status="ready"
        onPointClick={onPointClick}
      />
    );

    const canvas = container.querySelector("canvas")!;
    canvas.getBoundingClientRect = vi.fn().mockReturnValue({
      left: 0,
      top: 0,
      width: 100,
      height: 100,
      right: 100,
      bottom: 100,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    fireEvent.click(canvas, { clientX: 50, clientY: 50, shiftKey: true });

    expect(onPointClick).toHaveBeenCalledWith(50, 50, 1, { replace: false });
  });

  it("Case 9b-11: Alt+クリックは label:0, replace:false で呼ばれる", () => {
    const onPointClick = vi.fn();
    const mockImage: LoadedImage = {
      data: new Uint8ClampedArray(100 * 100 * 4),
      width: 100,
      height: 100,
      objectUrl: "blob:test",
    };

    const { container } = render(
      <SegmentCanvas
        image={mockImage}
        mask={null}
        status="ready"
        onPointClick={onPointClick}
      />
    );

    const canvas = container.querySelector("canvas")!;
    canvas.getBoundingClientRect = vi.fn().mockReturnValue({
      left: 0,
      top: 0,
      width: 100,
      height: 100,
      right: 100,
      bottom: 100,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    fireEvent.click(canvas, { clientX: 50, clientY: 50, altKey: true });

    expect(onPointClick).toHaveBeenCalledWith(50, 50, 0, { replace: false });
  });

  it("Case 9b-12: points prop に値があるとキャンバスにマーカーが描画される", () => {
    const mockCtx = {
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
    };
    HTMLCanvasElement.prototype.getContext = vi
      .fn()
      .mockReturnValue(
        mockCtx
      ) as unknown as typeof HTMLCanvasElement.prototype.getContext;

    const mockImage: LoadedImage = {
      data: new Uint8ClampedArray(100 * 100 * 4),
      width: 100,
      height: 100,
      objectUrl: "blob:test",
    };

    render(
      <SegmentCanvas
        image={mockImage}
        mask={null}
        status="ready"
        points={[
          { x: 10, y: 20, label: 1 },
          { x: 30, y: 40, label: 0 },
        ]}
      />
    );

    expect(mockCtx.arc).toHaveBeenCalledTimes(2);
    expect(mockCtx.arc).toHaveBeenNthCalledWith(
      1,
      10,
      20,
      expect.any(Number),
      0,
      expect.any(Number)
    );
    expect(mockCtx.arc).toHaveBeenNthCalledWith(
      2,
      30,
      40,
      expect.any(Number),
      0,
      expect.any(Number)
    );
    expect(mockCtx.fill).toHaveBeenCalled();
  });
});
