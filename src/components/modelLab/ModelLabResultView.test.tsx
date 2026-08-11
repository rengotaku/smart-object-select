import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ModelLabResultView } from "./ModelLabResultView";
import type { LoadedImage } from "@/lib/imageLoader";
import type { ModelLabResult } from "@/lib/modelLab";

const image: LoadedImage = {
  data: new Uint8ClampedArray([255, 0, 0, 255]),
  width: 1,
  height: 1,
  objectUrl: "blob:fake-image",
};

describe("ModelLabResultView", () => {
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
    }) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  });

  it("画像が無いとき空状態を表示する", () => {
    render(<ModelLabResultView image={null} />);

    expect(screen.getByTestId("model-lab-result-empty-state")).toBeInTheDocument();
    expect(screen.queryByTestId("model-lab-preview-image")).not.toBeInTheDocument();
  });

  it("画像があるときプレビューを表示する", () => {
    render(<ModelLabResultView image={image} />);

    const preview = screen.getByTestId("model-lab-preview-image");
    expect(preview).toBeInTheDocument();
    expect(preview).toHaveAttribute("src", "blob:fake-image");
    expect(screen.queryByTestId("model-lab-result-empty-state")).not.toBeInTheDocument();
  });

  it("結果未指定のとき「実行すると重ね描画される」旨のメッセージを表示する", () => {
    render(<ModelLabResultView image={image} />);

    expect(screen.getByTestId("model-lab-result-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("model-lab-overlay-layer")).not.toBeInTheDocument();
  });

  it("結果があるときオーバーレイ描画レイヤーの拡張ポイントをレンダリングする", () => {
    const result: ModelLabResult = { modelId: "mobile-sam", overlays: [] };
    render(<ModelLabResultView image={image} result={result} />);

    expect(screen.getByTestId("model-lab-overlay-layer")).toBeInTheDocument();
    expect(screen.queryByTestId("model-lab-result-empty")).not.toBeInTheDocument();
  });

  it("kind: mask のオーバーレイがあるとき overlay canvas に描画する", () => {
    const drawImage = vi.fn();
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
      drawImage,
      putImageData: vi.fn(),
      clearRect: vi.fn(),
      createImageData: vi.fn((w: number, h: number) => ({
        data: new Uint8ClampedArray(w * h * 4),
        width: w,
        height: h,
      })),
    }) as unknown as typeof HTMLCanvasElement.prototype.getContext;

    const result: ModelLabResult = {
      modelId: "mobile-sam",
      overlays: [
        {
          kind: "mask",
          data: new Uint8Array([1]),
          width: 1,
          height: 1,
          score: 0.9,
        },
      ],
    };
    render(<ModelLabResultView image={image} result={result} />);

    expect(drawImage).toHaveBeenCalled();
  });

  it("onImageClick が渡っているとき画像クリックで元画像座標を通知する", () => {
    const onImageClick = vi.fn();
    const largeImage: LoadedImage = {
      data: new Uint8ClampedArray(1600 * 1200 * 4),
      width: 1600,
      height: 1200,
      objectUrl: "blob:large-image",
    };

    render(<ModelLabResultView image={largeImage} onImageClick={onImageClick} />);

    const preview = screen.getByTestId("model-lab-preview-image");
    preview.getBoundingClientRect = vi.fn().mockReturnValue({
      left: 0,
      top: 0,
      width: 400,
      height: 300,
      right: 400,
      bottom: 300,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    fireEvent.click(preview, { clientX: 200, clientY: 150 });

    // rect 400x300, image 1600x1200 -> scale x4: (200,150) -> (800,600)
    expect(onImageClick).toHaveBeenCalledWith(800, 600);
  });

  it("onImageClick 未指定のとき画像をクリックしても何も起きない", () => {
    render(<ModelLabResultView image={image} />);

    const preview = screen.getByTestId("model-lab-preview-image");
    expect(() => fireEvent.click(preview)).not.toThrow();
  });

  it("isBusy のとき処理中インジケータを表示し、クリックしても onImageClick を呼ばない", () => {
    const onImageClick = vi.fn();
    render(<ModelLabResultView image={image} onImageClick={onImageClick} isBusy />);

    expect(screen.getByTestId("model-lab-processing")).toBeInTheDocument();
    expect(screen.queryByTestId("model-lab-click-hint")).not.toBeInTheDocument();

    const preview = screen.getByTestId("model-lab-preview-image");
    preview.getBoundingClientRect = vi.fn().mockReturnValue({
      left: 0,
      top: 0,
      width: 1,
      height: 1,
      right: 1,
      bottom: 1,
      x: 0,
      y: 0,
      toJSON: () => {},
    });
    fireEvent.click(preview, { clientX: 0, clientY: 0 });

    expect(onImageClick).not.toHaveBeenCalled();
  });

  it("onImageClick があるとき、クリックを促すヒントを表示する", () => {
    render(<ModelLabResultView image={image} onImageClick={vi.fn()} />);

    expect(screen.getByTestId("model-lab-click-hint")).toBeInTheDocument();
    expect(screen.queryByTestId("model-lab-result-empty")).not.toBeInTheDocument();
  });

  it("clickHintText を渡すと既定文言の代わりにその文言を表示する（issue #49）", () => {
    render(
      <ModelLabResultView
        image={image}
        onImageClick={vi.fn()}
        clickHintText="クリックでインスタンスを選択します"
      />
    );

    expect(screen.getByTestId("model-lab-click-hint")).toHaveTextContent(
      "クリックでインスタンスを選択します"
    );
  });

  it("kind: box のオーバーレイがあるとき枠線を描画する（issue #49）", () => {
    const strokeRect = vi.fn();
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
      drawImage: vi.fn(),
      putImageData: vi.fn(),
      clearRect: vi.fn(),
      strokeRect,
      createImageData: vi.fn((w: number, h: number) => ({
        data: new Uint8ClampedArray(w * h * 4),
        width: w,
        height: h,
      })),
    }) as unknown as typeof HTMLCanvasElement.prototype.getContext;

    const result: ModelLabResult = {
      modelId: "yolo11n-seg",
      overlays: [
        { kind: "box", x: 0, y: 0, width: 1, height: 1, label: "person", score: 0.9 },
      ],
    };
    render(<ModelLabResultView image={image} result={result} />);

    expect(strokeRect).toHaveBeenCalledWith(0, 0, 1, 1);
  });

  it("kind: box に mask が付いているとき塗りつぶしも描画する（issue #49）", () => {
    const drawImage = vi.fn();
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
      drawImage,
      putImageData: vi.fn(),
      clearRect: vi.fn(),
      strokeRect: vi.fn(),
      createImageData: vi.fn((w: number, h: number) => ({
        data: new Uint8ClampedArray(w * h * 4),
        width: w,
        height: h,
      })),
    }) as unknown as typeof HTMLCanvasElement.prototype.getContext;

    const result: ModelLabResult = {
      modelId: "yolo11n-seg",
      overlays: [
        {
          kind: "box",
          x: 0,
          y: 0,
          width: 1,
          height: 1,
          score: 0.9,
          mask: { data: new Uint8Array([1]), width: 1, height: 1, x: 0, y: 0 },
        },
      ],
    };
    render(<ModelLabResultView image={image} result={result} />);

    expect(drawImage).toHaveBeenCalled();
  });

  it("highlightedOverlayIndex と一致する box オーバーレイは異なる色で強調描画する（issue #49）", () => {
    const strokeRectCalls: unknown[] = [];
    const strokeStyleValues: string[] = [];
    const ctx = {
      drawImage: vi.fn(),
      putImageData: vi.fn(),
      clearRect: vi.fn(),
      strokeRect: vi.fn((...args: unknown[]) => {
        strokeRectCalls.push(args);
        strokeStyleValues.push((ctx as unknown as { strokeStyle: string }).strokeStyle);
      }),
      createImageData: vi.fn((w: number, h: number) => ({
        data: new Uint8ClampedArray(w * h * 4),
        width: w,
        height: h,
      })),
      strokeStyle: "",
      lineWidth: 0,
    };
    HTMLCanvasElement.prototype.getContext = vi
      .fn()
      .mockReturnValue(ctx) as unknown as typeof HTMLCanvasElement.prototype.getContext;

    const result: ModelLabResult = {
      modelId: "yolo11n-seg",
      overlays: [
        { kind: "box", x: 0, y: 0, width: 1, height: 1, score: 0.9 },
        { kind: "box", x: 1, y: 1, width: 1, height: 1, score: 0.8 },
      ],
    };
    render(
      <ModelLabResultView image={image} result={result} highlightedOverlayIndex={1} />
    );

    expect(strokeRectCalls).toHaveLength(2);
    // ハイライト対象(index=1)の strokeStyle は非ハイライト(index=0)と異なる
    expect(strokeStyleValues[0]).not.toBe(strokeStyleValues[1]);
  });
});
