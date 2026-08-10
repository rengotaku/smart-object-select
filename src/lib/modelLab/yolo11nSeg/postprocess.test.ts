import { describe, it, expect } from "vitest";
import {
  computeIoU,
  decodeDetections,
  decodeInstanceMask,
  decodeYoloOutputs,
  nms,
  type RawDetection,
} from "./postprocess";
import type { LetterboxTransform } from "./preprocess";

/**
 * テスト用に小さいクラス数・候補数の output0 を組み立てるヘルパー。
 * レイアウトは `[batch=1, predLen, numCandidates]` で `c * numCandidates + i` フラット化。
 */
function buildOutput0(
  numClasses: number,
  maskProtoChannels: number,
  candidates: Array<{
    cx: number;
    cy: number;
    w: number;
    h: number;
    classScores: number[];
    maskCoeffs: number[];
  }>
): { data: Float32Array; dims: number[] } {
  const numCandidates = candidates.length;
  const predLen = 4 + numClasses + maskProtoChannels;
  const data = new Float32Array(predLen * numCandidates);

  candidates.forEach((c, i) => {
    data[0 * numCandidates + i] = c.cx;
    data[1 * numCandidates + i] = c.cy;
    data[2 * numCandidates + i] = c.w;
    data[3 * numCandidates + i] = c.h;
    for (let k = 0; k < numClasses; k++) {
      data[(4 + k) * numCandidates + i] = c.classScores[k] ?? 0;
    }
    for (let m = 0; m < maskProtoChannels; m++) {
      data[(4 + numClasses + m) * numCandidates + i] = c.maskCoeffs[m] ?? 0;
    }
  });

  return { data, dims: [1, predLen, numCandidates] };
}

describe("decodeDetections", () => {
  it("信頼度閾値以上の候補のみ、最良クラスとともにデコードする", () => {
    const { data, dims } = buildOutput0(2, 1, [
      { cx: 10, cy: 10, w: 4, h: 4, classScores: [0.9, 0.1], maskCoeffs: [1] },
      { cx: 20, cy: 20, w: 4, h: 4, classScores: [0.1, 0.05], maskCoeffs: [2] }, // 閾値未満
    ]);

    const result = decodeDetections(data, dims, {
      numClasses: 2,
      maskProtoChannels: 1,
      confidenceThreshold: 0.25,
    });

    expect(result).toHaveLength(1);
    expect(result[0].classId).toBe(0);
    expect(result[0].score).toBeCloseTo(0.9, 5);
    expect(result[0].box).toEqual({ x: 8, y: 8, width: 4, height: 4 }); // cx-w/2, cy-h/2
    expect(Array.from(result[0].maskCoeffs)).toEqual([1]);
  });

  it("中心座標形式(cx,cy,w,h)を左上原点のxywhへ変換する", () => {
    const { data, dims } = buildOutput0(1, 1, [
      { cx: 100, cy: 50, w: 40, h: 20, classScores: [0.8], maskCoeffs: [0] },
    ]);
    const result = decodeDetections(data, dims, {
      numClasses: 1,
      maskProtoChannels: 1,
      confidenceThreshold: 0.25,
    });
    expect(result[0].box).toEqual({ x: 80, y: 40, width: 40, height: 20 });
  });

  it("predLen が期待値と異なると例外を投げる", () => {
    const data = new Float32Array(10 * 5);
    expect(() =>
      decodeDetections(data, [1, 10, 5], { numClasses: 2, maskProtoChannels: 1 })
    ).toThrow();
  });

  it("候補が0件（全て閾値未満）なら空配列を返す", () => {
    const { data, dims } = buildOutput0(1, 1, [
      { cx: 0, cy: 0, w: 1, h: 1, classScores: [0.01], maskCoeffs: [0] },
    ]);
    const result = decodeDetections(data, dims, {
      numClasses: 1,
      maskProtoChannels: 1,
      confidenceThreshold: 0.25,
    });
    expect(result).toEqual([]);
  });
});

describe("computeIoU", () => {
  it("完全一致は1", () => {
    const box = { x: 0, y: 0, width: 10, height: 10 };
    expect(computeIoU(box, box)).toBeCloseTo(1, 5);
  });

  it("重なり無しは0", () => {
    const a = { x: 0, y: 0, width: 10, height: 10 };
    const b = { x: 20, y: 20, width: 10, height: 10 };
    expect(computeIoU(a, b)).toBe(0);
  });

  it("半分重なるボックスは 1/3", () => {
    const a = { x: 0, y: 0, width: 10, height: 10 };
    const b = { x: 5, y: 0, width: 10, height: 10 };
    // inter = 5x10=50, union = 100+100-50=150, IoU=50/150=1/3
    expect(computeIoU(a, b)).toBeCloseTo(1 / 3, 5);
  });
});

describe("nms", () => {
  function makeDetection(overrides: Partial<RawDetection>): RawDetection {
    return {
      box: { x: 0, y: 0, width: 10, height: 10 },
      classId: 0,
      score: 0.5,
      maskCoeffs: new Float32Array(0),
      ...overrides,
    };
  }

  it("同クラスで大きく重なる低スコア候補を抑制する", () => {
    const high = makeDetection({
      score: 0.9,
      box: { x: 0, y: 0, width: 10, height: 10 },
    });
    const low = makeDetection({ score: 0.6, box: { x: 1, y: 1, width: 10, height: 10 } });
    const result = nms([low, high], 0.3);
    expect(result).toHaveLength(1);
    expect(result[0].score).toBe(0.9);
  });

  it("異なるクラスは重なっていても両方残す", () => {
    const a = makeDetection({ score: 0.9, classId: 0 });
    const b = makeDetection({ score: 0.8, classId: 1 });
    const result = nms([a, b], 0.3);
    expect(result).toHaveLength(2);
  });

  it("重なりが閾値未満なら両方残す", () => {
    const a = makeDetection({ score: 0.9, box: { x: 0, y: 0, width: 10, height: 10 } });
    const b = makeDetection({
      score: 0.8,
      box: { x: 100, y: 100, width: 10, height: 10 },
    });
    const result = nms([a, b], 0.3);
    expect(result).toHaveLength(2);
  });
});

describe("decodeInstanceMask", () => {
  const IDENTITY_TRANSFORM: LetterboxTransform = {
    scale: 1,
    padX: 0,
    padY: 0,
    resizedWidth: 8,
    resizedHeight: 8,
  };

  it("ボックス内の proto ロジット>0（sigmoid>0.5）のピクセルのみ前景にする", () => {
    // maskProtoSize=4, maskProtoChannels=1（1chの単純化: proto値=そのままロジット）
    const maskProtoSize = 4;
    const proto = new Float32Array(1 * maskProtoSize * maskProtoSize);
    // 左半分(px=0,1)を正のロジット、右半分(px=2,3)を負のロジットにする
    for (let y = 0; y < maskProtoSize; y++) {
      for (let x = 0; x < maskProtoSize; x++) {
        proto[y * maskProtoSize + x] = x < 2 ? 5 : -5;
      }
    }
    const maskCoeffs = new Float32Array([1]);
    // inputSize=8, maskProtoSize=4 -> protoScale=0.5。ボックスは入力空間全体 (0,0,8,8)
    const box640 = { x: 0, y: 0, width: 8, height: 8 };

    const mask = decodeInstanceMask(proto, maskCoeffs, box640, IDENTITY_TRANSFORM, 8, 8, {
      maskProtoSize,
      inputSize: 8,
    });

    expect(mask.width).toBe(8);
    expect(mask.height).toBe(8);
    // 元画像の左半分(x=0..3)が前景、右半分(x=4..7)が背景になるはず
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 4; x++) {
        expect(mask.data[y * 8 + x]).toBe(1);
      }
      for (let x = 4; x < 8; x++) {
        expect(mask.data[y * 8 + x]).toBe(0);
      }
    }
  });

  it("ボックス外のピクセルは常に0", () => {
    const maskProtoSize = 2;
    const proto = new Float32Array(1 * maskProtoSize * maskProtoSize).fill(10); // 全て強い前景ロジット
    const maskCoeffs = new Float32Array([1]);
    // ボックスは画像の一部（x:2-4, y:2-4）のみ
    const box640 = { x: 2, y: 2, width: 2, height: 2 };

    const mask = decodeInstanceMask(proto, maskCoeffs, box640, IDENTITY_TRANSFORM, 8, 8, {
      maskProtoSize,
      inputSize: 8,
    });

    // ボックス外(0,0)は0のまま
    expect(mask.data[0 * 8 + 0]).toBe(0);
    // ボックス内(2,2)は1
    expect(mask.data[2 * 8 + 2]).toBe(1);
  });
});

describe("decodeYoloOutputs", () => {
  it("検出→NMS→マスクデコードを一気通貫で行う", () => {
    const numClasses = 2;
    const maskProtoChannels = 1;
    const maskProtoSize = 4;
    const inputSize = 8;

    const { data: detData, dims: detDims } = buildOutput0(numClasses, maskProtoChannels, [
      // person(class 0) 中心(4,4) 幅高4x4 -> box 640空間 (2,2,4,4)
      { cx: 4, cy: 4, w: 4, h: 4, classScores: [0.9, 0.1], maskCoeffs: [1] },
    ]);

    const proto = new Float32Array(
      maskProtoChannels * maskProtoSize * maskProtoSize
    ).fill(10); // 全面前景ロジット

    const transform: LetterboxTransform = {
      scale: 1,
      padX: 0,
      padY: 0,
      resizedWidth: inputSize,
      resizedHeight: inputSize,
    };

    const result = decodeYoloOutputs(detData, detDims, proto, transform, 8, 8, {
      numClasses,
      maskProtoChannels,
      maskProtoSize,
      inputSize,
      confidenceThreshold: 0.25,
    });

    expect(result).toHaveLength(1);
    expect(result[0].classId).toBe(0);
    expect(result[0].label).toBe("person");
    expect(result[0].score).toBeCloseTo(0.9, 5);
    expect(result[0].box).toEqual({ x: 2, y: 2, width: 4, height: 4 });
    expect(result[0].mask.width).toBe(8);
    expect(result[0].mask.height).toBe(8);
    // ボックス内(3,3)は前景
    expect(result[0].mask.data[3 * 8 + 3]).toBe(1);
    // ボックス外(0,0)は背景
    expect(result[0].mask.data[0]).toBe(0);
  });
});
