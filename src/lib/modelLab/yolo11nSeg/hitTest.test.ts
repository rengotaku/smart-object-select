import { describe, it, expect } from "vitest";
import { findDetectionAtPoint } from "./hitTest";
import type { Yolo11nSegDetection } from "./types";

function makeDetection(overrides: Partial<Yolo11nSegDetection>): Yolo11nSegDetection {
  return {
    classId: 0,
    label: "person",
    score: 0.9,
    box: { x: 0, y: 0, width: 10, height: 10 },
    mask: { data: new Uint8Array(0), width: 0, height: 0 },
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
      mask: { data, width, height },
    });

    expect(findDetectionAtPoint([detection], 1, 1)).toBe(0);
    expect(findDetectionAtPoint([detection], 3, 1)).toBeNull(); // ボックス内だがマスク外
  });

  it("該当インスタンスが無ければ null を返す", () => {
    const width = 10;
    const height = 10;
    const data = new Uint8Array(width * height); // 全て背景
    const detection = makeDetection({
      box: { x: 0, y: 0, width: 5, height: 5 },
      mask: { data, width, height },
    });
    expect(findDetectionAtPoint([detection], 8, 8)).toBeNull();
  });

  it("複数インスタンスのマスクが重なる場合は面積最小のものを優先する", () => {
    const width = 100;
    const height = 100;

    // big: 画像全体が前景のマスク（面積100x100）
    const bigData = new Uint8Array(width * height).fill(1);
    const big = makeDetection({
      classId: 0,
      box: { x: 0, y: 0, width: 100, height: 100 },
      mask: { data: bigData, width, height },
    });

    // small: (40,40)-(50,50) の範囲のみ前景のマスク（面積10x10）
    const smallData = new Uint8Array(width * height);
    for (let y = 40; y < 50; y++) {
      for (let x = 40; x < 50; x++) {
        smallData[y * width + x] = 1;
      }
    }
    const small = makeDetection({
      classId: 1,
      label: "cat",
      box: { x: 40, y: 40, width: 10, height: 10 },
      mask: { data: smallData, width, height },
    });

    const index = findDetectionAtPoint([big, small], 45, 45);
    expect(index).toBe(1);
  });

  it("空配列なら null を返す", () => {
    expect(findDetectionAtPoint([], 0, 0)).toBeNull();
  });
});
