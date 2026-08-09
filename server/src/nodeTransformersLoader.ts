import path from "node:path";
import { fileURLToPath } from "node:url";
import { AutoProcessor, RawImage, SamModel, env } from "@huggingface/transformers";
import { SAM_MODEL_ID } from "../../src/lib/sam/constants";
import { normalizeImageInputs } from "../../src/lib/sam/imageInputs";
import type {
  MaskTensorLike,
  SamModelLike,
  SamProcessorLike,
  SamRuntime,
} from "../../src/lib/sam/samSession";
import type { SamImageInput } from "../../src/lib/sam/types";

/**
 * ブラウザ版 `src/lib/sam/transformersLoader.ts` の Node 版アダプタ。
 * `@huggingface/transformers` は Node 環境で読み込むと自動的に `onnxruntime-node`
 * バックエンドを使う（`dist/transformers.node.cjs` が `require("onnxruntime-node")` する。
 * package.json の `dependencies.onnxruntime-node` 参照）。よってこのファイル経由の推論は
 * onnxruntime-node ベースで実行される。
 *
 * `@huggingface/transformers` への直接依存はこのファイルにのみ閉じ込める
 * （transformersLoader.ts と同じ制約。samSession.ts はこのパッケージを import しない）。
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// server/src/ から見て ../../public/models が自前ホスティング済みモデルの実体。
const MODELS_DIR = path.resolve(__dirname, "..", "..", "public", "models");

/**
 * 量子化済みファイル（`*_quantized.onnx`）のみを自前ホスティングしているため、
 * device に関わらず `q8` を明示指定する（transformersLoader.ts と同じ理由）。
 */
const MODEL_DTYPE = "q8";

let envConfigured = false;
function configureSelfHostedEnv(): void {
  if (envConfigured) {
    return;
  }
  envConfigured = true;
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  // Node 環境では localModelPath はファイルシステムパス（URL ではない）。
  // 末尾スラッシュはブラウザ版 (`env.localModelPath = "/models/"`) に揃える。
  env.localModelPath = `${MODELS_DIR}/`;
}

interface TransformersTensor {
  data: Uint8Array | Float32Array;
  dims: number[];
  tolist(): unknown;
}

interface TransformersSamModel {
  get_image_embeddings(inputs: {
    pixel_values: unknown;
  }): Promise<Record<string, unknown>>;
  (
    inputs: Record<string, unknown>
  ): Promise<{ pred_masks: unknown; iou_scores: TransformersTensor }>;
}

interface TransformersSamProcessor {
  (image: RawImage): Promise<Record<string, unknown>>;
  post_process_masks(
    masks: unknown,
    originalSizes: unknown,
    reshapedInputSizes: unknown
  ): Promise<TransformersTensor[]>;
  reshape_input_points(
    points: unknown,
    originalSizes: unknown,
    reshapedInputSizes: unknown
  ): unknown;
  image_processor?: {
    add_input_labels(labels: unknown, inputPoints: unknown): unknown;
  };
}

function toRawImage(image: SamImageInput): RawImage {
  return new RawImage(image.data, image.width, image.height, 4);
}

function wrapModel(model: TransformersSamModel): SamModelLike {
  return {
    async getImageEmbeddings(inputs) {
      return model.get_image_embeddings({ pixel_values: inputs.pixel_values });
    },
    async decode(args) {
      const output = await model(args);
      const iouScores = output.iou_scores.tolist() as number[][][];
      return { predMasks: output.pred_masks, iouScores };
    },
  };
}

function wrapProcessor(processor: TransformersSamProcessor): SamProcessorLike {
  return {
    async process(image) {
      const raw = await processor(toRawImage(image));
      return normalizeImageInputs(raw);
    },
    reshapeInputPoints(points, _imageSize, inputs) {
      return processor.reshape_input_points(
        points,
        inputs.originalSizes,
        inputs.reshapedInputSizes
      );
    },
    addInputLabels(labels, reshapedInputPoints) {
      const imageProcessor = processor.image_processor;
      if (!imageProcessor) {
        throw new Error(
          "SamProcessor.image_processor is unavailable; cannot build input_labels"
        );
      }
      return imageProcessor.add_input_labels(labels, reshapedInputPoints);
    },
    async postProcessMasks(predMasks, originalSizes, reshapedInputSizes) {
      const masks = await processor.post_process_masks(
        predMasks,
        originalSizes,
        reshapedInputSizes
      );
      return masks.map((mask): MaskTensorLike => ({ data: mask.data, dims: mask.dims }));
    },
  };
}

/**
 * Node 版 `SamRuntime` を生成する。
 *
 * `createSamSession(runtime, device)` はセッション作成のたびに `loadModel`/`loadProcessor`
 * を呼ぶ（`src/lib/sam/samSession.ts` 参照）。ONNX の重みを毎回読み直すのを避けるため、
 * このアダプタは一度ロードしたモデル/プロセッサをこのインスタンス内でメモ化し、以降の
 * 呼び出しでは同じインスタンスを返す。embedding 等のセッション状態は `createSamSession`
 * 側のクロージャで保持されるため、モデル/プロセッサの共有はセッション間の分離を壊さない
 * （embedding の混同を防ぐのは `samSession.ts` の責務であり、ここでは変更していない）。
 *
 * `loadModel` の `device` 引数（`SamDevice` = `"webgpu" | "wasm"`）はブラウザ向けの型を
 * そのまま流用しているだけで、このアダプタでは無視する。Node は onnxruntime-node の
 * CPU 実行しかサポートしないため、常に `device: "cpu"` でロードする。
 */
export function createNodeTransformersSamRuntime(): SamRuntime {
  configureSelfHostedEnv();

  let modelPromise: Promise<SamModelLike> | null = null;
  let processorPromise: Promise<SamProcessorLike> | null = null;

  return {
    async loadModel() {
      if (!modelPromise) {
        modelPromise = SamModel.from_pretrained(SAM_MODEL_ID, {
          device: "cpu",
          dtype: MODEL_DTYPE,
        }).then((model) => wrapModel(model as unknown as TransformersSamModel));
      }
      return modelPromise;
    },
    async loadProcessor() {
      if (!processorPromise) {
        processorPromise = AutoProcessor.from_pretrained(SAM_MODEL_ID, {}).then((processor) =>
          wrapProcessor(processor as unknown as TransformersSamProcessor)
        );
      }
      return processorPromise;
    },
  };
}
