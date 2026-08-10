import { describe, it, expect } from "vitest";
import {
  computeEncoderScale,
  resizeRgbaNearest,
  scalePointToEncoderSpace,
  toEncoderInputData,
} from "./preprocess";

describe("computeEncoderScale", () => {
  it("横長画像は x/y で異なるスケール係数を持つ（アスペクト比を保持しない）", () => {
    const result = computeEncoderScale(800, 600, 1024);
    expect(result.scaleX).toBeCloseTo(1024 / 800);
    expect(result.scaleY).toBeCloseTo(1024 / 600);
  });

  it("正方形画像は x/y のスケール係数が等しい", () => {
    const result = computeEncoderScale(512, 512, 1024);
    expect(result.scaleX).toBeCloseTo(2);
    expect(result.scaleY).toBeCloseTo(2);
  });

  it("targetSize を省略すると既定値 1024 が使われる", () => {
    const result = computeEncoderScale(1024, 1024);
    expect(result.scaleX).toBe(1);
    expect(result.scaleY).toBe(1);
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

  it("非正方形な元画像を正方形ターゲットへ非等方にリサイズできる", () => {
    const width = 4;
    const height = 2;
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
  it("RGBA から CHW（プレーン分離）の Float32Array へ変換し 0-1 に正規化する", () => {
    const rgba = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 128]);
    const result = toEncoderInputData(rgba, 2, 1);

    expect(result).toBeInstanceOf(Float32Array);
    // pixelCount=2: R plane [0,1], G plane [2,3], B plane [4,5]
    expect(result[0]).toBeCloseTo(1); // R of pixel0 = 255/255
    expect(result[1]).toBeCloseTo(0); // R of pixel1 = 0/255
    expect(result[2]).toBeCloseTo(0); // G of pixel0 = 0/255
    expect(result[3]).toBeCloseTo(1); // G of pixel1 = 255/255
    expect(result[4]).toBeCloseTo(0); // B of pixel0
    expect(result[5]).toBeCloseTo(0); // B of pixel1
  });

  it("出力の長さは width * height * 3", () => {
    const rgba = new Uint8ClampedArray(3 * 2 * 4);
    const result = toEncoderInputData(rgba, 3, 2);
    expect(result.length).toBe(3 * 2 * 3);
  });
});

describe("scalePointToEncoderSpace", () => {
  it("x/y で異なるスケール係数を独立に適用する", () => {
    expect(scalePointToEncoderSpace(100, 50, { scaleX: 2, scaleY: 4 })).toEqual({
      x: 200,
      y: 200,
    });
  });

  it("スケール係数 1 のとき座標は変わらない", () => {
    expect(scalePointToEncoderSpace(42, 7, { scaleX: 1, scaleY: 1 })).toEqual({
      x: 42,
      y: 7,
    });
  });
});
