import { describe, it, expect } from "vitest";
import {
  computeIoU,
  decodeDetections,
  decodeFastSamOutputs,
  decodeInstanceMask,
  nms,
  type RawDetection,
} from "./postprocess";
import type { LetterboxTransform } from "./preprocess";

/**
 * テスト用に小さい候補数・maskProtoChannels の output0 を組み立てるヘルパー。
 * レイアウトは `[batch=1, predLen, numCandidates]` で `c * numCandidates + i` フラット化。
 * FastSAM は単一 objectness スコア（index 4）のみを持ち、YOLO11n-seg のような
 * 複数クラススコアは無い点に注意（`../yolo11nSeg/postprocess.test.ts` の buildOutput0 と
 * レイアウトが異なる）。
 */
function buildOutput0(
  maskProtoChannels: number,
  candidates: Array<{
    cx: number;
    cy: number;
    w: number;
    h: number;
    score: number;
    maskCoeffs: number[];
  }>
): { data: Float32Array; dims: number[] } {
  const numCandidates = candidates.length;
  const predLen = 4 + 1 + maskProtoChannels;
  const data = new Float32Array(predLen * numCandidates);

  candidates.forEach((c, i) => {
    data[0 * numCandidates + i] = c.cx;
    data[1 * numCandidates + i] = c.cy;
    data[2 * numCandidates + i] = c.w;
    data[3 * numCandidates + i] = c.h;
    data[4 * numCandidates + i] = c.score;
    for (let m = 0; m < maskProtoChannels; m++) {
      data[(5 + m) * numCandidates + i] = c.maskCoeffs[m] ?? 0;
    }
  });

  return { data, dims: [1, predLen, numCandidates] };
}

describe("decodeDetections", () => {
  it("信頼度閾値以上の候補のみデコードする（クラス分類ヘッド無し、objectness スコアのみ）", () => {
    const { data, dims } = buildOutput0(1, [
      { cx: 10, cy: 10, w: 4, h: 4, score: 0.9, maskCoeffs: [1] },
      { cx: 20, cy: 20, w: 4, h: 4, score: 0.1, maskCoeffs: [2] }, // 閾値未満
    ]);

    const result = decodeDetections(data, dims, {
      maskProtoChannels: 1,
      confidenceThreshold: 0.4,
    });

    expect(result).toHaveLength(1);
    expect(result[0].score).toBeCloseTo(0.9, 5);
    expect(result[0].box).toEqual({ x: 8, y: 8, width: 4, height: 4 }); // cx-w/2, cy-h/2
    expect(Array.from(result[0].maskCoeffs)).toEqual([1]);
  });

  it("中心座標形式(cx,cy,w,h)を左上原点のxywhへ変換する", () => {
    const { data, dims } = buildOutput0(1, [
      { cx: 100, cy: 50, w: 40, h: 20, score: 0.8, maskCoeffs: [0] },
    ]);
    const result = decodeDetections(data, dims, {
      maskProtoChannels: 1,
      confidenceThreshold: 0.4,
    });
    expect(result[0].box).toEqual({ x: 80, y: 40, width: 40, height: 20 });
  });

  it("predLen が期待値と異なると例外を投げる", () => {
    const data = new Float32Array(10 * 5);
    expect(() => decodeDetections(data, [1, 10, 5], { maskProtoChannels: 1 })).toThrow();
  });

  it("候補が0件（全て閾値未満）なら空配列を返す", () => {
    const { data, dims } = buildOutput0(1, [
      { cx: 0, cy: 0, w: 1, h: 1, score: 0.01, maskCoeffs: [0] },
    ]);
    const result = decodeDetections(data, dims, {
      maskProtoChannels: 1,
      confidenceThreshold: 0.4,
    });
    expect(result).toEqual([]);
  });

  it("信頼度閾値通過後の候補が maxDetections を超える場合、スコア上位のみに打ち切る（issue #50 codex レビュー指摘: NMS/マスク復号コストの上限化）", () => {
    // 5候補が閾値(0.4)を通過するが maxDetections=3 のため上位3件のみ残るはず
    const { data, dims } = buildOutput0(1, [
      { cx: 1, cy: 1, w: 1, h: 1, score: 0.5, maskCoeffs: [0] },
      { cx: 2, cy: 2, w: 1, h: 1, score: 0.95, maskCoeffs: [0] },
      { cx: 3, cy: 3, w: 1, h: 1, score: 0.6, maskCoeffs: [0] },
      { cx: 4, cy: 4, w: 1, h: 1, score: 0.99, maskCoeffs: [0] },
      { cx: 5, cy: 5, w: 1, h: 1, score: 0.41, maskCoeffs: [0] },
    ]);

    const result = decodeDetections(data, dims, {
      maskProtoChannels: 1,
      confidenceThreshold: 0.4,
      maxDetections: 3,
    });

    expect(result).toHaveLength(3);
    // スコア降順で上位3件（0.99, 0.95, 0.6）のみ残り、最低スコアの0.41・0.5は落ちる
    const scores = result.map((d) => d.score).sort((a, b) => b - a);
    expect(scores.map((s) => Number(s.toFixed(2)))).toEqual([0.99, 0.95, 0.6]);
  });

  it("候補数が maxDetections 以下なら打ち切らない", () => {
    const { data, dims } = buildOutput0(1, [
      { cx: 1, cy: 1, w: 1, h: 1, score: 0.5, maskCoeffs: [0] },
      { cx: 2, cy: 2, w: 1, h: 1, score: 0.6, maskCoeffs: [0] },
    ]);

    const result = decodeDetections(data, dims, {
      maskProtoChannels: 1,
      confidenceThreshold: 0.4,
      maxDetections: 3,
    });

    expect(result).toHaveLength(2);
  });

  it("maxDetections を省略すると既定値 FASTSAM_MAX_DETECTIONS(300) が使われる", () => {
    // 閾値通過候補を301件用意し、既定では300件に打ち切られることを確認する
    const candidates = Array.from({ length: 301 }, (_, i) => ({
      cx: i,
      cy: i,
      w: 1,
      h: 1,
      score: 0.5 + i * 0.0001,
      maskCoeffs: [0],
    }));
    const { data, dims } = buildOutput0(1, candidates);

    const result = decodeDetections(data, dims, {
      maskProtoChannels: 1,
      confidenceThreshold: 0.4,
    });

    expect(result).toHaveLength(300);
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
      score: 0.5,
      maskCoeffs: new Float32Array(0),
      ...overrides,
    };
  }

  it("大きく重なる低スコア候補を抑制する（クラス非依存）", () => {
    const high = makeDetection({
      score: 0.9,
      box: { x: 0, y: 0, width: 10, height: 10 },
    });
    const low = makeDetection({ score: 0.6, box: { x: 1, y: 1, width: 10, height: 10 } });
    const result = nms([low, high], 0.3);
    expect(result).toHaveLength(1);
    expect(result[0].score).toBe(0.9);
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

  it("YOLO11n-seg と異なりクラス概念が無いため、重なる候補はクラスに関わらず抑制される", () => {
    // FastSAM はクラス非依存のため、YOLO11n-seg の「異なるクラスは両方残す」テストに相当する
    // ケースは存在しない（RawDetection に classId フィールドが無い）。ここでは重なる2候補が
    // 常に1件に抑制されることを確認する。
    const a = makeDetection({ score: 0.9, box: { x: 0, y: 0, width: 10, height: 10 } });
    const b = makeDetection({ score: 0.8, box: { x: 0, y: 0, width: 10, height: 10 } });
    const result = nms([a, b], 0.3);
    expect(result).toHaveLength(1);
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
    const box1024 = { x: 0, y: 0, width: 8, height: 8 };

    const mask = decodeInstanceMask(
      proto,
      maskCoeffs,
      box1024,
      IDENTITY_TRANSFORM,
      8,
      8,
      {
        maskProtoSize,
        inputSize: 8,
      }
    );

    // ボックスが画像全体(0,0,8,8)のため、マスクも画像全体サイズになる
    expect(mask.x).toBe(0);
    expect(mask.y).toBe(0);
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

  it("ボックス範囲のみのマスクを返す（画像全体は保持しない）", () => {
    const maskProtoSize = 2;
    const proto = new Float32Array(1 * maskProtoSize * maskProtoSize).fill(10); // 全て強い前景ロジット
    const maskCoeffs = new Float32Array([1]);
    // ボックスは画像の一部（x:2-4, y:2-4）のみ
    const box1024 = { x: 2, y: 2, width: 2, height: 2 };

    const mask = decodeInstanceMask(
      proto,
      maskCoeffs,
      box1024,
      IDENTITY_TRANSFORM,
      8,
      8,
      {
        maskProtoSize,
        inputSize: 8,
      }
    );

    // マスクデータはボックス範囲(2,2,2,2)分のみ確保される（画像全体の8x8=64バイトではない）
    expect(mask.x).toBe(2);
    expect(mask.y).toBe(2);
    expect(mask.width).toBe(2);
    expect(mask.height).toBe(2);
    expect(mask.data.length).toBe(4);
    // ボックス内は全て前景（強い前景ロジットのため）
    expect(Array.from(mask.data)).toEqual([1, 1, 1, 1]);
  });

  it("既定の maskProtoSize/inputSize（オプション省略時）は FastSAM の 256/1024 を使う", () => {
    // options を省略しても FASTSAM_MASK_PROTO_SIZE(256)/FASTSAM_INPUT_SIZE(1024) が
    // 使われることを、実寸のプロトタイプ(256x256)で確認する。
    const maskProtoSize = 256;
    const proto = new Float32Array(1 * maskProtoSize * maskProtoSize).fill(10);
    const maskCoeffs = new Float32Array([1]);
    const transform: LetterboxTransform = {
      scale: 1,
      padX: 0,
      padY: 0,
      resizedWidth: 1024,
      resizedHeight: 1024,
    };
    const box1024 = { x: 0, y: 0, width: 100, height: 100 };

    const mask = decodeInstanceMask(proto, maskCoeffs, box1024, transform, 1024, 1024);

    expect(mask.width).toBe(100);
    expect(mask.height).toBe(100);
    expect(mask.data[0]).toBe(1);
  });
});

describe("decodeFastSamOutputs", () => {
  it("検出→NMS→マスクデコードを一気通貫で行う", () => {
    const maskProtoChannels = 1;
    const maskProtoSize = 4;
    const inputSize = 8;

    const { data: detData, dims: detDims } = buildOutput0(maskProtoChannels, [
      // 中心(4,4) 幅高4x4 -> box 1024空間 (2,2,4,4)
      { cx: 4, cy: 4, w: 4, h: 4, score: 0.9, maskCoeffs: [1] },
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

    const result = decodeFastSamOutputs(detData, detDims, proto, transform, 8, 8, {
      maskProtoChannels,
      maskProtoSize,
      inputSize,
      confidenceThreshold: 0.4,
    });

    expect(result).toHaveLength(1);
    expect(result[0].score).toBeCloseTo(0.9, 5);
    expect(result[0].box).toEqual({ x: 2, y: 2, width: 4, height: 4 });
    // マスクはボックス範囲(2,2,4,4)のみ保持し、画像全体(8x8)は保持しない
    expect(result[0].mask.x).toBe(2);
    expect(result[0].mask.y).toBe(2);
    expect(result[0].mask.width).toBe(4);
    expect(result[0].mask.height).toBe(4);
    expect(result[0].mask.data.length).toBe(16);
    // 元画像(3,3)はボックス左上(2,2)からのローカル座標(1,1)に対応し、前景
    expect(result[0].mask.data[1 * 4 + 1]).toBe(1);
    // classId/label フィールドを持たない（クラス非依存モデルであることを型・実行時双方で確認）
    expect(result[0]).not.toHaveProperty("classId");
    expect(result[0]).not.toHaveProperty("label");
  });
});
