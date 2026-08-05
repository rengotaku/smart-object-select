import { AutoProcessor, RawImage, SamModel } from "@huggingface/transformers";
import { SAM_MODEL_ID } from "./constants";
import type { SamDevice } from "./device";
import { normalizeImageInputs } from "./imageInputs";
import type {
  MaskTensorLike,
  SamModelLike,
  SamProcessorLike,
  SamRuntime,
} from "./samSession";
import type { SamImageInput } from "./types";

/**
 * `@huggingface/transformers` への直接依存はこのファイルにのみ閉じ込める。
 * samSession / samWorkerHandler / samWorkerClient はこのパッケージを import しない。
 */

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
  // 実 API は original_sizes / reshaped_input_sizes（snake_case）を含む生オブジェクトを返す。
  // camelCase への正規化は normalizeImageInputs（imageInputs.ts）が行う。
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
    // 確定 API は imageSize を引数に持つが、実アダプタでは process() 済みの
    // originalSizes / reshapedInputSizes（inputs 側）が正の情報源のためそちらを使う。
    reshapeInputPoints(points, _imageSize, inputs) {
      return processor.reshape_input_points(
        points,
        inputs.originalSizes,
        inputs.reshapedInputSizes
      );
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

export function createTransformersSamRuntime(): SamRuntime {
  return {
    async loadModel(device: SamDevice) {
      const model = await SamModel.from_pretrained(SAM_MODEL_ID, { device });
      return wrapModel(model as unknown as TransformersSamModel);
    },
    async loadProcessor() {
      const processor = await AutoProcessor.from_pretrained(SAM_MODEL_ID);
      return wrapProcessor(processor as unknown as TransformersSamProcessor);
    },
  };
}
