import { vi } from "vitest";
import type {
  MaskTensorLike,
  SamImageInputs,
  SamModelLike,
  SamProcessorLike,
  SamRuntime,
} from "../../../src/lib/sam/samSession";
import type { SamImageInput } from "../../../src/lib/sam/types";

/**
 * `samSession.test.ts` と同じパターンの fake `SamRuntime`（issue #32 コメント
 * 「テストケース仕様」の mock/setup 制約）。実際の onnxruntime-node / モデルファイルには
 * 一切依存しない。
 *
 * `processor.process` は画像の width/height を tag にして `SamImageInputs` に埋め込み、
 * `model.getImageEmbeddings` はその tag を含む embedding を返す。`model.decode` は
 * embedding tag ごとに異なる score を返すため、Case 5（複数セッションの独立性）で
 * 「どちらの画像の embedding を使って decode したか」をレスポンスの score から検証できる。
 */
export interface FakeSamRuntimeHandle {
  runtime: SamRuntime;
  model: SamModelLike;
  processor: SamProcessorLike;
  getImageEmbeddings: ReturnType<typeof vi.fn>;
  decode: ReturnType<typeof vi.fn>;
}

function tagForImage(image: SamImageInput): string {
  return `${image.width}x${image.height}`;
}

/** tag ごとに固定の score を割り当てる（テストから読みやすい既知の値にする） */
const SCORE_BY_TAG: Record<string, number> = {};
function scoreForTag(tag: string): number {
  if (!(tag in SCORE_BY_TAG)) {
    // 0.5 未満に被らないよう tag の登録順に段階的な既知値を割り当てる
    SCORE_BY_TAG[tag] = 0.9 - Object.keys(SCORE_BY_TAG).length * 0.2;
  }
  return SCORE_BY_TAG[tag];
}

export function createFakeSamRuntime(): FakeSamRuntimeHandle {
  const process = vi.fn(
    async (image: SamImageInput): Promise<SamImageInputs & { tag: string }> => {
      const tag = tagForImage(image);
      return {
        originalSizes: [[image.height, image.width]],
        reshapedInputSizes: [[image.height, image.width]],
        tag,
      };
    }
  );

  const getImageEmbeddings = vi.fn(async (inputs: Record<string, unknown>) => ({
    embeddingTag: inputs.tag,
  }));

  const decode = vi.fn(async (args: Record<string, unknown>) => {
    const tag = String(args.embeddingTag);
    return {
      predMasks: {},
      iouScores: [[[scoreForTag(tag)]]],
    };
  });

  const processor: SamProcessorLike = {
    process,
    reshapeInputPoints: vi.fn(() => [[[1, 1]]]),
    addInputLabels: vi.fn(() => [[1]]),
    postProcessMasks: vi.fn(
      async (): Promise<MaskTensorLike[]> => [
        { data: new Uint8Array([0, 255, 0, 255]), dims: [1, 1, 2, 2] },
      ]
    ),
  };

  const model: SamModelLike = {
    getImageEmbeddings,
    decode,
  };

  const runtime: SamRuntime = {
    loadModel: vi.fn(async () => model),
    loadProcessor: vi.fn(async () => processor),
  };

  return { runtime, model, processor, getImageEmbeddings, decode };
}

/** RGBA データを持つテスト用画像。width/height でセッション（embedding）を区別する。 */
export function makeTestImageBase64(width: number, height: number): string {
  const bytes = new Uint8Array(width * height * 4).fill(128);
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
}

/**
 * 常に固定の `score` を返す最小限の fake `SamRuntime`。複数モデル対応（issue #33 コメント
 * 「複数モデル対応」、codex レビュー指摘対応）のテストで、「どの `modelId` の runtime が
 * 実際に使われたか」を score の違いで検証するために使う（`createFakeSamRuntime` の
 * tag-by-image-size パターンとは別軸で、image サイズが同じでも区別できるようにする）。
 */
export function createFixedScoreSamRuntime(score: number): SamRuntime {
  const processor: SamProcessorLike = {
    process: vi.fn(async (image: SamImageInput) => ({
      originalSizes: [[image.height, image.width]],
      reshapedInputSizes: [[image.height, image.width]],
    })),
    reshapeInputPoints: vi.fn(() => [[[1, 1]]]),
    addInputLabels: vi.fn(() => [[1]]),
    postProcessMasks: vi.fn(
      async (): Promise<MaskTensorLike[]> => [
        { data: new Uint8Array([0, 255, 0, 255]), dims: [1, 1, 2, 2] },
      ]
    ),
  };
  const model: SamModelLike = {
    getImageEmbeddings: vi.fn(async () => ({})),
    decode: vi.fn(async () => ({ predMasks: {}, iouScores: [[[score]]] })),
  };
  return {
    loadModel: vi.fn(async () => model),
    loadProcessor: vi.fn(async () => processor),
  };
}
