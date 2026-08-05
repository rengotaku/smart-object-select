import { describe, expect, it } from "vitest";
import { applyMaskToImage, maskToBlackAndWhite } from "./exportImage";
import type { SamImageInput, SamMaskResult } from "./types";

describe("exportImage", () => {
  describe("applyMaskToImage", () => {
    it("Case 4-1: マスク内は元画像の色を残しアルファ 255、マスク外はアルファ 0", () => {
      const image: SamImageInput = {
        data: new Uint8ClampedArray([
          10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255, 100, 110, 120, 255,
        ]),
        width: 2,
        height: 2,
      };
      const mask: SamMaskResult = {
        data: new Uint8Array([0, 1, 1, 0]),
        width: 2,
        height: 2,
        score: 0.9,
      };

      const result = applyMaskToImage(image, mask);

      // 画素0・画素3（マスク外）は RGB は問わずアルファのみ検証する（仕様どおり）
      expect(result.data[3]).toBe(0);
      expect(result.data[15]).toBe(0);
      // 画素1・画素2（マスク内）は元画像の RGB を残しアルファ 255
      expect(Array.from(result.data.slice(4, 8))).toEqual([40, 50, 60, 255]);
      expect(Array.from(result.data.slice(8, 12))).toEqual([70, 80, 90, 255]);
    });

    it("Case 4-2: 出力が元画像の解像度になる", () => {
      const width = 7;
      const height = 5;
      const image: SamImageInput = {
        data: new Uint8ClampedArray(width * height * 4),
        width,
        height,
      };
      const mask: SamMaskResult = {
        data: new Uint8Array(width * height),
        width,
        height,
        score: 0.5,
      };

      const result = applyMaskToImage(image, mask);

      expect(result.width).toBe(7);
      expect(result.height).toBe(5);
      expect(result.data.length).toBe(140);
    });

    it("Case 4-4: 画像とマスクの寸法が違うと throw する", () => {
      const image: SamImageInput = {
        data: new Uint8ClampedArray(4 * 4 * 4),
        width: 4,
        height: 4,
      };
      const mask: SamMaskResult = {
        data: new Uint8Array(2 * 2),
        width: 2,
        height: 2,
        score: 0.5,
      };

      expect(() => applyMaskToImage(image, mask)).toThrow(Error);
    });
  });

  describe("maskToBlackAndWhite", () => {
    it("Case 4-3: マスク PNG はマスク内が白・マスク外が黒（どちらも不透明）", () => {
      const mask: SamMaskResult = {
        data: new Uint8Array([0, 1]),
        width: 2,
        height: 1,
        score: 0.5,
      };

      const result = maskToBlackAndWhite(mask);

      expect(Array.from(result.data.slice(0, 4))).toEqual([0, 0, 0, 255]);
      expect(Array.from(result.data.slice(4, 8))).toEqual([255, 255, 255, 255]);
    });

    it("追加: 出力の寸法がマスクの寸法と一致する", () => {
      const mask: SamMaskResult = {
        data: new Uint8Array(3 * 5),
        width: 3,
        height: 5,
        score: 0.5,
      };

      const result = maskToBlackAndWhite(mask);

      expect(result.width).toBe(3);
      expect(result.height).toBe(5);
      expect(result.data.length).toBe(60);
    });
  });
});
