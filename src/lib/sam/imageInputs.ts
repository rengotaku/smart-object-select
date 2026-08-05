import type { SamImageInputs } from "./samSession";

/**
 * `@huggingface/transformers` の processor が実際に返すのは
 * `original_sizes` / `reshaped_input_sizes`（snake_case）であり、
 * `SamImageInputs`（確定 API）が期待する `originalSizes` / `reshapedInputSizes`
 * （camelCase）とは名前が一致しない。
 *
 * この関数はその差分を吸収し、他のフィールド（`pixel_values` 等）はそのまま保持する。
 * 既に camelCase で渡された場合もそのまま通す（冪等）。
 *
 * テスト可能性のため `@huggingface/transformers` を import しない
 * （transformersLoader.ts のみが実パッケージに依存する）。
 */
export function normalizeImageInputs(raw: Record<string, unknown>): SamImageInputs {
  const {
    original_sizes: originalSizesSnake,
    reshaped_input_sizes: reshapedInputSizesSnake,
    originalSizes: originalSizesCamel,
    reshapedInputSizes: reshapedInputSizesCamel,
    ...rest
  } = raw;

  return {
    ...rest,
    originalSizes: originalSizesCamel ?? originalSizesSnake,
    reshapedInputSizes: reshapedInputSizesCamel ?? reshapedInputSizesSnake,
  } as SamImageInputs;
}
