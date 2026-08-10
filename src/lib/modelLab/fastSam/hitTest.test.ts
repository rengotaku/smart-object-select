import { describe, it, expect } from "vitest";
import { findDetectionAtPoint } from "./hitTest";
import type { FastSamDetection } from "./types";

function makeDetection(overrides: Partial<FastSamDetection>): FastSamDetection {
  return {
    score: 0.9,
    box: { x: 0, y: 0, width: 10, height: 10 },
    mask: { data: new Uint8Array(0), width: 0, height: 0, x: 0, y: 0 },
    ...overrides,
  };
}

describe("findDetectionAtPoint", () => {
  it("マスクがあればマスクのピクセル値で判定する", () => {
    // 4x4 マスク。左半分(x<2)のみ前景
    const width = 4;
    const height = 4;
    const data = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < 2; x++) {
        data[y * width + x] = 1;
      }
    }
    const detection = makeDetection({
      box: { x: 0, y: 0, width: 4, height: 4 },
      mask: { data, width, height, x: 0, y: 0 },
    });

    expect(findDetectionAtPoint([detection], 1, 1)).toBe(0);
    expect(findDetectionAtPoint([detection], 3, 1)).toBeNull(); // ボックス内だがマスク外
  });

  it("mask.x/mask.y オフセット分を差し引いてマスクのローカル座標へ変換する", () => {
    // ボックス範囲(20,30)-(24,34)のみを保持する部分マスク（画像全体ではない）。
    // 左半分(ローカルx<2)のみ前景。
    const width = 4;
    const height = 4;
    const data = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < 2; x++) {
        data[y * width + x] = 1;
      }
    }
    const detection = makeDetection({
      box: { x: 20, y: 30, width: 4, height: 4 },
      mask: { data, width, height, x: 20, y: 30 },
    });

    // 元画像座標(21,31) -> ローカル(1,1) -> 前景
    expect(findDetectionAtPoint([detection], 21, 31)).toBe(0);
    // 元画像座標(23,31) -> ローカル(3,1) -> 背景
    expect(findDetectionAtPoint([detection], 23, 31)).toBeNull();
    // オフセット適用前の座標(1,1)はマスク範囲外
    expect(findDetectionAtPoint([detection], 1, 1)).toBeNull();
  });

  it("該当インスタンスが無ければ null を返す", () => {
    const width = 10;
    const height = 10;
    const data = new Uint8Array(width * height); // 全て背景
    const detection = makeDetection({
      box: { x: 0, y: 0, width: 5, height: 5 },
      mask: { data, width, height, x: 0, y: 0 },
    });
    expect(findDetectionAtPoint([detection], 8, 8)).toBeNull();
  });

  it("複数インスタンスのマスクが重なる場合は面積最小のものを優先する", () => {
    const width = 100;
    const height = 100;

    // big: 画像全体が前景のマスク（面積100x100）
    const bigData = new Uint8Array(width * height).fill(1);
    const big = makeDetection({
      score: 0.7,
      box: { x: 0, y: 0, width: 100, height: 100 },
      mask: { data: bigData, width, height, x: 0, y: 0 },
    });

    // small: (40,40)-(50,50) の範囲のみ前景のマスク（面積10x10）
    const smallData = new Uint8Array(width * height);
    for (let y = 40; y < 50; y++) {
      for (let x = 40; x < 50; x++) {
        smallData[y * width + x] = 1;
      }
    }
    const small = makeDetection({
      score: 0.85,
      box: { x: 40, y: 40, width: 10, height: 10 },
      mask: { data: smallData, width, height, x: 0, y: 0 },
    });

    const index = findDetectionAtPoint([big, small], 45, 45);
    expect(index).toBe(1);
  });

  it("空配列なら null を返す", () => {
    expect(findDetectionAtPoint([], 0, 0)).toBeNull();
  });
});
