import { describe, expect, it } from "vitest";
import {
  applyMaskToImage,
  composeMaskOverlayInBounds,
  computeMaskBounds,
  computeThumbnailOutputSize,
  computeUnionBounds,
  cropRgbaPixels,
  maskToBlackAndWhite,
  type RgbaPixels,
} from "./exportImage";
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

    it("Case 4-13: マスク内でも元画像の半透明・透明が保持される", () => {
      const image: SamImageInput = {
        data: new Uint8ClampedArray([
          10, 20, 30, 255, 40, 50, 60, 128, 70, 80, 90, 0, 100, 110, 120, 255,
        ]),
        width: 2,
        height: 2,
      };
      const mask: SamMaskResult = {
        data: new Uint8Array([1, 1, 1, 0]),
        width: 2,
        height: 2,
        score: 0.9,
      };

      const result = applyMaskToImage(image, mask);

      // 画素0・1・2（マスク内）は元画像のアルファをそのまま引き継ぐ
      expect(Array.from(result.data.slice(0, 4))).toEqual([10, 20, 30, 255]);
      expect(Array.from(result.data.slice(4, 8))).toEqual([40, 50, 60, 128]);
      expect(Array.from(result.data.slice(8, 12))).toEqual([70, 80, 90, 0]);
      // 画素3（マスク外）はアルファ 0
      expect(result.data[15]).toBe(0);
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

  describe("computeMaskBounds", () => {
    it("Case 16-12: computeMaskBounds は不透明領域のタイトなバウンディングボックスを返す", () => {
      // 4x4 マスク、 (1,1)〜(2,2) の2x2だけ値1
      const maskData = new Uint8Array(4 * 4);
      // y=1: x=1, x=2
      maskData[1 * 4 + 1] = 1;
      maskData[1 * 4 + 2] = 1;
      // y=2: x=1, x=2
      maskData[2 * 4 + 1] = 1;
      maskData[2 * 4 + 2] = 1;

      const mask: SamMaskResult = {
        data: maskData,
        width: 4,
        height: 4,
        score: 0.9,
      };

      const result = computeMaskBounds(mask);
      expect(result).toEqual({ x: 1, y: 1, width: 2, height: 2 });
    });

    it("Case 16-13: computeMaskBounds は全て0のマスクで null を返す", () => {
      const mask: SamMaskResult = {
        data: new Uint8Array(4 * 4),
        width: 4,
        height: 4,
        score: 0.9,
      };

      const result = computeMaskBounds(mask);
      expect(result).toBeNull();
    });

    it("Case 16-14: computeMaskBounds は単一ピクセルのマスクで width=1,height=1 を返す", () => {
      const maskData = new Uint8Array(4 * 4);
      maskData[2 * 4 + 3] = 1; // x=3, y=2

      const mask: SamMaskResult = {
        data: maskData,
        width: 4,
        height: 4,
        score: 0.9,
      };

      const result = computeMaskBounds(mask);
      expect(result).toEqual({ x: 3, y: 2, width: 1, height: 1 });
    });
  });

  describe("computeUnionBounds", () => {
    it("Case 19-11: 複数マスクの和集合のバウンディングボックスを返す", () => {
      // 8x8 マスク。mask1 は (1,1)、mask2 は (5,6) だけ値1
      const mask1Data = new Uint8Array(8 * 8);
      mask1Data[1 * 8 + 1] = 1;
      const mask2Data = new Uint8Array(8 * 8);
      mask2Data[6 * 8 + 5] = 1;

      const mask1: SamMaskResult = { data: mask1Data, width: 8, height: 8, score: 0.9 };
      const mask2: SamMaskResult = { data: mask2Data, width: 8, height: 8, score: 0.5 };

      const result = computeUnionBounds([mask1, mask2]);

      expect(result).toEqual({ x: 1, y: 1, width: 5, height: 6 });
    });

    it("Case 19-12: 全マスクが空（bounds が全て null）なら null を返す", () => {
      const emptyMask1: SamMaskResult = {
        data: new Uint8Array(4 * 4),
        width: 4,
        height: 4,
        score: 0.9,
      };
      const emptyMask2: SamMaskResult = {
        data: new Uint8Array(4 * 4),
        width: 4,
        height: 4,
        score: 0.5,
      };

      const result = computeUnionBounds([emptyMask1, emptyMask2]);

      expect(result).toBeNull();
    });

    it("追加: masks が空配列なら null を返す", () => {
      expect(computeUnionBounds([])).toBeNull();
    });
  });

  describe("cropRgbaPixels", () => {
    it("Case 16-15: cropRgbaPixels は指定した矩形だけを正しい順序で切り出す", () => {
      const width = 4;
      const height = 4;
      const data = new Uint8ClampedArray(width * height * 4);

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = (y * width + x) * 4;
          data[idx] = x;
          data[idx + 1] = y;
          data[idx + 2] = 100;
          data[idx + 3] = 255;
        }
      }

      const pixels: RgbaPixels = { data, width, height };

      const cropped = cropRgbaPixels(pixels, { x: 1, y: 1, width: 2, height: 2 });

      expect(cropped.width).toBe(2);
      expect(cropped.height).toBe(2);
      expect(cropped.data.length).toBe(2 * 2 * 4);

      // (x=1, y=1)
      expect(cropped.data[0]).toBe(1);
      expect(cropped.data[1]).toBe(1);

      // (x=2, y=1)
      expect(cropped.data[4]).toBe(2);
      expect(cropped.data[5]).toBe(1);

      // (x=1, y=2)
      expect(cropped.data[8]).toBe(1);
      expect(cropped.data[9]).toBe(2);

      // (x=2, y=2)
      expect(cropped.data[12]).toBe(2);
      expect(cropped.data[13]).toBe(2);
    });
  });

  describe("composeMaskOverlayInBounds", () => {
    // 10x10 の画像。各ピクセルの R チャンネルにグローバル index を埋め込み、
    // bounds 外を読んでいないかを「読んだ値がその座標に対応しているか」で検証する。
    function makeIndexedImage(): SamImageInput {
      const data = new Uint8ClampedArray(10 * 10 * 4);
      for (let i = 0; i < 100; i++) {
        const offset = i * 4;
        data[offset] = i; // R = グローバル pixel index
        data[offset + 1] = 0;
        data[offset + 2] = 0;
        data[offset + 3] = 255;
      }
      return { data, width: 10, height: 10 };
    }

    it("Case 19-13: bounds 内の画素だけを正しく合成する（bounds 外を読み書きしない）", () => {
      const image = makeIndexedImage();
      // bounds = x:3, y:2, width:3, height:3 → グローバル index 23,24,25 / 33,34,35 / 43,44,45
      const bounds = { x: 3, y: 2, width: 3, height: 3 };
      const maskData = new Uint8Array(10 * 10);
      maskData[34] = 1; // bounds のローカル座標 (1,1) だけをマスク対象にする
      const mask: SamMaskResult = { data: maskData, width: 10, height: 10, score: 1 };
      const color = { r: 0, g: 255, b: 0, a: 255 };

      const result = composeMaskOverlayInBounds(image, mask, bounds, color);

      // 出力サイズは bounds と一致（画像全体サイズのバッファを確保していない）
      expect(result.width).toBe(3);
      expect(result.height).toBe(3);
      expect(result.data.length).toBe(3 * 3 * 4);

      const globalIndices = [23, 24, 25, 33, 34, 35, 43, 44, 45];
      for (let localY = 0; localY < 3; localY++) {
        for (let localX = 0; localX < 3; localX++) {
          const destOffset = (localY * 3 + localX) * 4;
          const isMaskedCenter = localX === 1 && localY === 1;
          if (isMaskedCenter) {
            // マスク内: color (a=255 → フル不透明) とブレンドされる
            expect(result.data[destOffset]).toBe(0);
            expect(result.data[destOffset + 1]).toBe(255);
            expect(result.data[destOffset + 2]).toBe(0);
            expect(result.data[destOffset + 3]).toBe(255);
          } else {
            // マスク外: 元画像のその座標のピクセルがそのままコピーされる
            const globalIndex = globalIndices[localY * 3 + localX];
            expect(result.data[destOffset]).toBe(globalIndex);
            expect(result.data[destOffset + 1]).toBe(0);
            expect(result.data[destOffset + 2]).toBe(0);
            expect(result.data[destOffset + 3]).toBe(255);
          }
        }
      }
    });

    it("Case 19-13b: image と mask の寸法が一致しない場合は throw する", () => {
      const image = makeIndexedImage();
      const mismatchedMask: SamMaskResult = {
        data: new Uint8Array(5 * 5),
        width: 5,
        height: 5,
        score: 1,
      };
      expect(() =>
        composeMaskOverlayInBounds(
          image,
          mismatchedMask,
          { x: 0, y: 0, width: 3, height: 3 },
          { r: 0, g: 255, b: 0, a: 255 }
        )
      ).toThrow();
    });

    it("Case 19-14: 出力サイズが上限を超える crop bounds はダウンスケールして合成される（境界ピクセルが元画像と整合する）", () => {
      const width = 1000;
      const height = 500;
      const data = new Uint8ClampedArray(width * height * 4);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const offset = (y * width + x) * 4;
          data[offset] = x % 256; // R = x 座標（mod 256）
          data[offset + 1] = y % 256; // G = y 座標（mod 256）
          data[offset + 2] = 0;
          data[offset + 3] = 255;
        }
      }
      const image: SamImageInput = { data, width, height };
      // マスクは全て 0（アンマスク）にして、元画像がそのままコピーされることを利用し座標整合を検証する
      const mask: SamMaskResult = {
        data: new Uint8Array(width * height),
        width,
        height,
        score: 1,
      };
      const bounds = { x: 0, y: 0, width: 1000, height: 500 };
      const color = { r: 0, g: 255, b: 0, a: 255 };

      const outputSize = computeThumbnailOutputSize(bounds);
      // 1000x500 は上限 160 を超えるので、アスペクト比を保って 160x80 にダウンスケールされる
      expect(outputSize).toEqual({ width: 160, height: 80 });

      const result = composeMaskOverlayInBounds(image, mask, bounds, color, outputSize);

      // 計算量が出力サイズに比例することの確認（bounds/元画像解像度ではなく出力サイズでバッファが確保される）
      expect(result.width).toBe(160);
      expect(result.height).toBe(80);
      expect(result.data.length).toBe(160 * 80 * 4);

      // 左上角: 出力 (0,0) は元画像の (0,0) に対応する
      expect(result.data[0]).toBe(0);
      expect(result.data[1]).toBe(0);

      // 右下角: 出力 (159,79) は nearest-neighbor で元画像の対応座標に整合する
      const expectedSrcX = Math.floor((159 * bounds.width) / outputSize.width);
      const expectedSrcY = Math.floor((79 * bounds.height) / outputSize.height);
      const lastOffset = (79 * 160 + 159) * 4;
      expect(result.data[lastOffset]).toBe(expectedSrcX % 256);
      expect(result.data[lastOffset + 1]).toBe(expectedSrcY % 256);
    });
  });
});
