import { describe, expect, it } from "vitest";
import { toImageCoords, type DisplayRect, type ImageSize } from "./coords";

describe("coords", () => {
  it("Case 1: 縮小表示でのクリックが元画像座標に変換される", () => {
    const rect: DisplayRect = { left: 100, top: 50, width: 400, height: 300 };
    const image: ImageSize = { width: 1600, height: 1200 };

    const coords = toImageCoords(300, 200, rect, image);

    expect(coords).toEqual({ x: 800, y: 600 });
  });

  it("Case 2: 画像範囲外のクリックが範囲内にクランプされる", () => {
    const rect: DisplayRect = { left: 100, top: 50, width: 400, height: 300 };
    const image: ImageSize = { width: 1600, height: 1200 };

    const lowerBound = toImageCoords(0, 0, rect, image);
    expect(lowerBound).toEqual({ x: 0, y: 0 });

    const upperBound = toImageCoords(600, 400, rect, image);
    expect(upperBound).toEqual({ x: 1599, y: 1199 });
  });

  it("Case 3: rect の幅・高さが 0 のとき null を返す", () => {
    const rect: DisplayRect = { left: 0, top: 0, width: 0, height: 0 };
    const image: ImageSize = { width: 1600, height: 1200 };

    const coords = toImageCoords(10, 10, rect, image);

    expect(coords).toBeNull();
  });
});
