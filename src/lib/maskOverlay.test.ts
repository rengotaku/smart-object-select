import { describe, expect, it } from "vitest";
import { maskToOverlayPixels, type OverlayColor } from "./maskOverlay";
import type { SamMaskResult } from "./types";

describe("maskOverlay", () => {
  it("Case 4: マスク内が指定色、マスク外が完全透明になる", () => {
    const mask: SamMaskResult = {
      data: new Uint8Array([0, 1, 1, 0]),
      width: 2,
      height: 2,
      score: 0.9,
    };
    const color: OverlayColor = { r: 59, g: 130, b: 246, a: 128 };

    const result = maskToOverlayPixels(mask, color);

    expect(Array.from(result.data.slice(0, 4))).toEqual([0, 0, 0, 0]);
    expect(Array.from(result.data.slice(4, 8))).toEqual([59, 130, 246, 128]);
    expect(Array.from(result.data.slice(8, 12))).toEqual([59, 130, 246, 128]);
    expect(Array.from(result.data.slice(12, 16))).toEqual([0, 0, 0, 0]);
  });

  it("Case 5: 出力の長さが width * height * 4 になる", () => {
    const mask: SamMaskResult = {
      data: new Uint8Array(3 * 5),
      width: 3,
      height: 5,
      score: 0.8,
    };
    const color: OverlayColor = { r: 255, g: 0, b: 0, a: 255 };

    const result = maskToOverlayPixels(mask, color);

    expect(result.data.length).toBe(60);
    expect(result.width).toBe(3);
    expect(result.height).toBe(5);
  });
});
