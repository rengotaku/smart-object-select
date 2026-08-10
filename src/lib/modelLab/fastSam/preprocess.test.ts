import { describe, it, expect } from "vitest";
import {
  computeLetterboxTransform,
  letterboxResize,
  mapBoxToOriginal,
  toModelInputData,
} from "./preprocess";

describe("computeLetterboxTransform", () => {
  it("横長画像は幅を基準にスケールし、上下にパディングする", () => {
    const transform = computeLetterboxTransform(200, 100, 1024);
    expect(transform.scale).toBeCloseTo(1024 / 200);
    expect(transform.resizedWidth).toBe(1024);
    expect(transform.resizedHeight).toBe(512); // round(100 * 5.12)
    expect(transform.padX).toBe(0);
    expect(transform.padY).toBe(Math.floor((1024 - 512) / 2));
  });

  it("縦長画像は高さを基準にスケールし、左右にパディングする", () => {
    const transform = computeLetterboxTransform(100, 200, 1024);
    expect(transform.scale).toBeCloseTo(1024 / 200);
    expect(transform.resizedHeight).toBe(1024);
    expect(transform.resizedWidth).toBe(512);
    expect(transform.padY).toBe(0);
    expect(transform.padX).toBe(Math.floor((1024 - 512) / 2));
  });

  it("正方形画像はパディング無しで targetSize になる", () => {
    const transform = computeLetterboxTransform(50, 50, 1024);
    expect(transform.resizedWidth).toBe(1024);
    expect(transform.resizedHeight).toBe(1024);
    expect(transform.padX).toBe(0);
    expect(transform.padY).toBe(0);
  });

  it("targetSize を省略すると既定値 1024 が使われる（YOLO11n-seg の640とは異なる）", () => {
    const transform = computeLetterboxTransform(512, 512);
    expect(transform.resizedWidth).toBe(1024);
    expect(transform.resizedHeight).toBe(1024);
  });
});

describe("letterboxResize", () => {
  it("正方形画像はパディング無くそのまま拡大される", () => {
    // 2x2 の単色画像（赤）を 4x4 にレターボックスする
    const data = new Uint8ClampedArray(2 * 2 * 4);
    for (let i = 0; i < 4; i++) {
      data[i * 4] = 255;
      data[i * 4 + 3] = 255;
    }
    const image = { data, width: 2, height: 2 };
    const transform = computeLetterboxTransform(2, 2, 4);
    const resized = letterboxResize(image, transform, 4);

    expect(resized.length).toBe(4 * 4 * 4);
    // 全ピクセルが赤（パディングが写り込んでいない）
    for (let i = 0; i < 16; i++) {
      expect(resized[i * 4]).toBe(255);
      expect(resized[i * 4 + 1]).toBe(0);
    }
  });

  it("横長画像は上下がパディング色（114,114,114）で埋まる", () => {
    // 4x2 の単色画像（緑）を 4x4 にレターボックスする -> scale=1, resizedH=2, padY=1
    const data = new Uint8ClampedArray(4 * 2 * 4);
    for (let i = 0; i < 8; i++) {
      data[i * 4 + 1] = 255;
      data[i * 4 + 3] = 255;
    }
    const image = { data, width: 4, height: 2 };
    const transform = computeLetterboxTransform(4, 2, 4);
    const resized = letterboxResize(image, transform, 4);

    // 最上段（y=0）はパディング
    expect(resized[0]).toBe(114);
    expect(resized[1]).toBe(114);
    expect(resized[2]).toBe(114);
    // y=1(padYの直後)は画像（緑）
    const rowOffset = 1 * 4 * 4;
    expect(resized[rowOffset]).toBe(0);
    expect(resized[rowOffset + 1]).toBe(255);
  });
});

describe("toModelInputData", () => {
  it("NCHW planar・0-1正規化の Float32Array に変換する（size x size の正方形入力）", () => {
    // 2x2（4ピクセル）。size=2 として扱う。
    const rgba = new Uint8ClampedArray([
      255,
      0,
      0,
      255, // (0,0) 赤
      0,
      255,
      0,
      255, // (1,0) 緑
      0,
      0,
      255,
      255, // (0,1) 青
      255,
      255,
      255,
      255, // (1,1) 白
    ]);
    const result = toModelInputData(rgba, 2);
    expect(result).toBeInstanceOf(Float32Array);
    expect(result.length).toBe(3 * 2 * 2);
  });

  it("チャンネルごとに planar（R全部→G全部→B全部）に並ぶ", () => {
    // 1x1 の単一ピクセル。size=1 として扱う。
    const rgba = new Uint8ClampedArray([51, 102, 153, 255]); // R=51,G=102,B=153
    const result = toModelInputData(rgba, 1);

    expect(result.length).toBe(3);
    expect(result[0]).toBeCloseTo(51 / 255, 5);
    expect(result[1]).toBeCloseTo(102 / 255, 5);
    expect(result[2]).toBeCloseTo(153 / 255, 5);
  });
});

describe("mapBoxToOriginal", () => {
  it("パディング無し（scale=1, pad=0）のときそのまま返す", () => {
    const transform = {
      scale: 1,
      padX: 0,
      padY: 0,
      resizedWidth: 100,
      resizedHeight: 100,
    };
    const box = mapBoxToOriginal(
      { x: 10, y: 20, width: 30, height: 40 },
      transform,
      100,
      100
    );
    expect(box).toEqual({ x: 10, y: 20, width: 30, height: 40 });
  });

  it("スケールとパディングを逆変換する（1024空間）", () => {
    // 元画像 200x100 -> targetSize=1024 -> scale=5.12, padX=0, padY=(1024-512)/2=256
    const transform = {
      scale: 5.12,
      padX: 0,
      padY: 256,
      resizedWidth: 1024,
      resizedHeight: 512,
    };
    // 1024空間でのボックス: x=512,y=256,w=102.4,h=51.2 (中央付近)
    const box = mapBoxToOriginal(
      { x: 512, y: 256, width: 102.4, height: 51.2 },
      transform,
      200,
      100
    );
    expect(box.x).toBeCloseTo(100, 5);
    expect(box.y).toBeCloseTo(0, 5);
    expect(box.width).toBeCloseTo(20, 5);
    expect(box.height).toBeCloseTo(10, 5);
  });

  it("画像範囲外にはみ出すボックスはクランプする", () => {
    const transform = { scale: 1, padX: 0, padY: 0, resizedWidth: 50, resizedHeight: 50 };
    const box = mapBoxToOriginal(
      { x: -10, y: -10, width: 30, height: 30 },
      transform,
      50,
      50
    );
    expect(box.x).toBe(0);
    expect(box.y).toBe(0);
    expect(box.width).toBe(20);
    expect(box.height).toBe(20);
  });
});
