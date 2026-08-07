import {
  AutoProcessor,
  RawImage,
  SamModel,
  env,
  type ProgressInfo,
} from "@huggingface/transformers";
import { SAM_MODEL_ID } from "./constants";
import type { SamDevice } from "./device";
import { normalizeImageInputs } from "./imageInputs";
import type { SamProgressEvent } from "./protocol";
import type {
  MaskTensorLike,
  SamModelLike,
  SamProcessorLike,
  SamRuntime,
} from "./samSession";
import type { SamImageInput } from "./types";
import { resolveSelfHostedWasmPaths } from "./wasmRuntimePaths";

/**
 * `@huggingface/transformers` への直接依存はこのファイルにのみ閉じ込める。
 * samSession / samWorkerHandler / samWorkerClient はこのパッケージを import しない。
 */

/**
 * モデル・WASM ランタイムの取得元を自ホストパス（同一オリジン）に固定する。
 * `SamModel`/`AutoProcessor` の import 時点で onnxruntime-web は
 * `env.backends.onnx.wasm.wasmPaths` を jsDelivr CDN の URL に既定初期化するため
 * （node_modules/@huggingface/transformers/src/backends/onnx.js 参照）、
 * それを自ホストパスへ上書きする。この関数はモジュールロード時に一度だけ実行される。
 */
function configureSelfHostedEnv(): void {
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.localModelPath = "/models/";
  // `env.backends.onnx.wasm` 自体は onnxruntime-web 側で import 時に populate 済みの
  // オブジェクト（readonly な参照だが中身は可変）。参照を差し替えず中身のみ上書きする。
  if (env.backends.onnx.wasm) {
    env.backends.onnx.wasm.wasmPaths = resolveSelfHostedWasmPaths();
  }
}

configureSelfHostedEnv();

/**
 * `device` ごとの既定 dtype（`wasm` → 量子化 `q8` / `webgpu` → 非量子化 `fp32`）に従うと、
 * WebGPU が検出された環境では自ホストしていない非量子化ファイルを要求してしまう
 * （node_modules/@huggingface/transformers/src/utils/dtypes.js の
 * `DEFAULT_DEVICE_DTYPE_MAPPING` 参照。`webgpu` にはエントリが無く `fp32` にフォールバックする）。
 * 自ホストしているのは量子化済みファイルのみのため、device に関わらず `q8` を明示指定する。
 */
const MODEL_DTYPE = "q8";

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
  // `SamProcessor`（AutoProcessor.from_pretrained が返すファサード）は
  // reshape_input_points/post_process_masks は image_processor へ委譲するが、
  // add_input_labels は委譲しない（node_modules/@huggingface/transformers/src/models/sam/processing_sam.js
  // で実読して確認済み）。そのため image_processor 側を直接呼ぶ必要がある。
  image_processor?: {
    add_input_labels(labels: unknown, inputPoints: unknown): unknown;
  };
}

function toRawImage(image: SamImageInput): RawImage {
  return new RawImage(image.data, image.width, image.height, 4);
}

/**
 * `@huggingface/transformers` の `progress_callback` は status 別の union
 * （initiate/download/progress/done/ready/progress_total）を渡してくる。
 * SamModel/AutoProcessor はいずれも複数ファイルを取得しうるため、`from_pretrained` は
 * 渡された callback を内部で `DefaultProgressCallback` にラップし、ファイル単位の
 * `status === "progress"` を通知する直前に必ず全ファイル集約値の
 * `status === "progress_total"` を先に通知する
 * （node_modules/@huggingface/transformers/src/utils/core.js の
 * `DefaultProgressCallback._call` で実読して確認済み）。
 *
 * ただしこの `progress_total` の集計は `from_pretrained()` 呼び出し単位（内部で
 * 生成される `DefaultProgressCallback` インスタンス単位）で完結しており、
 * `loadModel()` と `loadProcessor()` をまたいで引き継がれない
 * （node_modules/@huggingface/transformers/src/models/modeling_utils.js
 * 313-345行付近で `from_pretrained` ごとに新規 `DefaultProgressCallback` が
 * 生成されることを実読して確認済み）。そのため model 取得完了直後に
 * processor 取得が始まると、集約値が小さい値へ後退して見える。
 *
 * ライブラリ内部のラップ・集計挙動に依存しないよう、ここではファイル単位の生イベント
 * `status === "progress"`（内部ラップの有無に関わらず必ず発火する一次情報）のみを使い、
 * `loadModel()`/`loadProcessor()` の両呼び出しをまたいで永続する `filesLoaded` map で
 * 自前集計する。`progress_total` は今後使わない。
 */
function createProgressCallback(
  onProgress: ((event: SamProgressEvent) => void) | undefined,
  filesLoaded: Map<string, { loaded: number; total: number }>
): (info: ProgressInfo) => void {
  return (info: ProgressInfo) => {
    if (!onProgress || info.status !== "progress") {
      return;
    }
    filesLoaded.set(info.file, { loaded: info.loaded, total: info.total });

    let loaded = 0;
    let total = 0;
    for (const entry of filesLoaded.values()) {
      loaded += entry.loaded;
      total += entry.total;
    }

    onProgress({
      file: info.file,
      loaded,
      total: total > 0 ? total : null,
    });
  };
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

export function createTransformersSamRuntime(
  onProgress?: (event: SamProgressEvent) => void
): SamRuntime {
  // loadModel()/loadProcessor() をまたいで永続させ、model→processor 間で
  // 集計値が後退しないようにする（詳細は createProgressCallback 直上のコメント参照）。
  const filesLoaded = new Map<string, { loaded: number; total: number }>();
  const progress_callback = createProgressCallback(onProgress, filesLoaded);

  return {
    async loadModel(device: SamDevice) {
      const model = await SamModel.from_pretrained(SAM_MODEL_ID, {
        device,
        dtype: MODEL_DTYPE,
        progress_callback,
      });
      return wrapModel(model as unknown as TransformersSamModel);
    },
    async loadProcessor() {
      const processor = await AutoProcessor.from_pretrained(SAM_MODEL_ID, {
        progress_callback,
      });
      return wrapProcessor(processor as unknown as TransformersSamProcessor);
    },
  };
}
