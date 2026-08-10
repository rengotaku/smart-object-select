import { describe, it, expect } from "vitest";
import {
  computeResizedDimensions,
  resizeRgbaNearest,
  scalePointToEncoderSpace,
  toEncoderInputData,
} from "./preprocess";

describe("computeResizedDimensions", () => {
  it("横長画像は幅を長辺として targetLongSide にスケールする", () => {
    const result = computeResizedDimensions(200, 150, 1024);
    expect(result.scale).toBeCloseTo(1024 / 200);
    expect(result.width).toBe(1024);
    expect(result.height).toBe(768); // round(150 * 5.12)
  });

  it("縦長画像は高さを長辺として targetLongSide にスケールする", () => {
    const result = computeResizedDimensions(100, 200, 1024);
    expect(result.scale).toBeCloseTo(1024 / 200);
    expect(result.height).toBe(1024);
    expect(result.width).toBe(512);
  });

  it("正方形画像は幅・高さとも targetLongSide になる", () => {
    const result = computeResizedDimensions(50, 50, 1024);
    expect(result.width).toBe(1024);
    expect(result.height).toBe(1024);
  });

  it("targetLongSide を省略すると既定値 1024 が使われる", () => {
    const result = computeResizedDimensions(512, 256);
    expect(result.width).toBe(1024);
    expect(result.height).toBe(512);
  });

  it("極端に小さい入力でも 0 以下の寸法にならない", () => {
    const result = computeResizedDimensions(1, 1000000, 1024);
    expect(result.width).toBeGreaterThanOrEqual(1);
    expect(result.height).toBeGreaterThanOrEqual(1);
  });
});

describe("resizeRgbaNearest", () => {
  it("2x1 の画像を 4x1 に最近傍補間でアップサンプルする", () => {
    // 左ピクセル=赤(255,0,0,255)、右ピクセル=青(0,0,255,255)
    const data = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255]);
    const resized = resizeRgbaNearest({ data, width: 2, height: 1 }, 4, 1);

    expect(resized.length).toBe(4 * 1 * 4);
    // srcX = floor(x * 2/4): x=0,1 -> srcX=0(赤) / x=2,3 -> srcX=1(青)
    expect([resized[0], resized[1], resized[2], resized[3]]).toEqual([255, 0, 0, 255]);
    expect([resized[4], resized[5], resized[6], resized[7]]).toEqual([255, 0, 0, 255]);
    expect([resized[8], resized[9], resized[10], resized[11]]).toEqual([0, 0, 255, 255]);
    expect([resized[12], resized[13], resized[14], resized[15]]).toEqual([
      0, 0, 255, 255,
    ]);
  });

  it("単色画像をダウンサンプルしても単色のまま", () => {
    const width = 4;
    const height = 4;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      data[i * 4] = 100;
      data[i * 4 + 1] = 150;
      data[i * 4 + 2] = 200;
      data[i * 4 + 3] = 255;
    }

    const resized = resizeRgbaNearest({ data, width, height }, 2, 2);
    expect(resized.length).toBe(2 * 2 * 4);
    for (let i = 0; i < 4; i++) {
      expect(resized[i * 4]).toBe(100);
      expect(resized[i * 4 + 1]).toBe(150);
      expect(resized[i * 4 + 2]).toBe(200);
      expect(resized[i * 4 + 3]).toBe(255);
    }
  });
});

describe("toEncoderInputData", () => {
  it("RGBA からアルファを落として RGB インターリーブの Float32Array に変換する", () => {
    const rgba = new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 128]);
    const result = toEncoderInputData(rgba, 2, 1);

    expect(result).toBeInstanceOf(Float32Array);
    expect(Array.from(result)).toEqual([10, 20, 30, 40, 50, 60]);
  });

  it("出力の長さは width * height * 3", () => {
    const rgba = new Uint8ClampedArray(3 * 2 * 4);
    const result = toEncoderInputData(rgba, 3, 2);
    expect(result.length).toBe(3 * 2 * 3);
  });
});

describe("scalePointToEncoderSpace", () => {
  it("点座標をスケール係数で変換する", () => {
    expect(scalePointToEncoderSpace(100, 50, 2)).toEqual({ x: 200, y: 100 });
  });

  it("スケール係数 1 のとき座標は変わらない", () => {
    expect(scalePointToEncoderSpace(42, 7, 1)).toEqual({ x: 42, y: 7 });
  });
});
