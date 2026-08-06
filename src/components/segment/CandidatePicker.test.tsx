import { render, fireEvent, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { CandidatePicker } from "./CandidatePicker";
import type { SamImageInput, SamMaskResult } from "@/lib/sam";

describe("CandidatePicker", () => {
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

  function makeMask(pixelIndex: number, score: number): SamMaskResult {
    const data = new Uint8Array(10 * 10);
    data[pixelIndex] = 1;
    return { data, width: 10, height: 10, score };
  }

  const mockCandidates: SamMaskResult[] = [
    makeMask(11, 0.9),
    makeMask(55, 0.6),
    makeMask(88, 0.3),
  ];

  it("Case 19-7: candidates が1件以下なら何もレンダリングしない", () => {
    const onSelect = vi.fn();

    const { container: emptyContainer } = render(
      <CandidatePicker
        image={mockImage}
        candidates={[]}
        selectedIndex={0}
        onSelect={onSelect}
      />
    );
    expect(emptyContainer.firstChild).toBeNull();

    const { container: singleContainer } = render(
      <CandidatePicker
        image={mockImage}
        candidates={[mockCandidates[0]]}
        selectedIndex={0}
        onSelect={onSelect}
      />
    );
    expect(singleContainer.firstChild).toBeNull();
  });

  it("Case 19-7b: image が null なら何もレンダリングしない", () => {
    const onSelect = vi.fn();
    const { container } = render(
      <CandidatePicker
        image={null}
        candidates={mockCandidates}
        selectedIndex={0}
        onSelect={onSelect}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it("Case 19-8: candidates が複数あれば件数分のサムネイルとスコア表示が描画される", () => {
    const onSelect = vi.fn();
    const { container } = render(
      <CandidatePicker
        image={mockImage}
        candidates={mockCandidates}
        selectedIndex={0}
        onSelect={onSelect}
      />
    );

    const canvases = container.querySelectorAll("canvas");
    expect(canvases).toHaveLength(3);

    expect(screen.getByText("スコア 0.90")).toBeInTheDocument();
    expect(screen.getByText("スコア 0.60")).toBeInTheDocument();
    expect(screen.getByText("スコア 0.30")).toBeInTheDocument();
  });

  it("Case 19-9: サムネイルをクリックすると該当 index で onSelect が呼ばれる", () => {
    const onSelect = vi.fn();
    render(
      <CandidatePicker
        image={mockImage}
        candidates={mockCandidates}
        selectedIndex={0}
        onSelect={onSelect}
      />
    );

    const buttons = screen.getAllByRole("button");
    fireEvent.click(buttons[1]);

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(1);
  });

  it("Case 19-10: selectedIndex に対応するサムネイルが強調表示される", () => {
    const onSelect = vi.fn();
    render(
      <CandidatePicker
        image={mockImage}
        candidates={mockCandidates}
        selectedIndex={1}
        onSelect={onSelect}
      />
    );

    const buttons = screen.getAllByRole("button");
    expect(buttons[0]).toHaveAttribute("aria-pressed", "false");
    expect(buttons[1]).toHaveAttribute("aria-pressed", "true");
    expect(buttons[2]).toHaveAttribute("aria-pressed", "false");
  });
});
