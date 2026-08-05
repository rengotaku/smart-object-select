import { describe, it, expect } from "vitest";
import { normalizeImageInputs } from "./imageInputs";

describe("normalizeImageInputs", () => {
  it("Case 20: maps snake_case fields from the real processor to camelCase and keeps the rest", () => {
    const pixelValues = { dims: [1, 3, 1024, 1024] };
    const raw = {
      original_sizes: [[480, 640]],
      reshaped_input_sizes: [[1024, 1024]],
      pixel_values: pixelValues,
    };

    const result = normalizeImageInputs(raw);

    expect(result.originalSizes).toEqual([[480, 640]]);
    expect(result.reshapedInputSizes).toEqual([[1024, 1024]]);
    expect(result.pixel_values).toBe(pixelValues);
  });

  it("Case 20: is a no-op when the input is already camelCase", () => {
    const pixelValues = { dims: [1, 3, 1024, 1024] };
    const raw = {
      originalSizes: [[480, 640]],
      reshapedInputSizes: [[1024, 1024]],
      pixel_values: pixelValues,
    };

    const result = normalizeImageInputs(raw);

    expect(result.originalSizes).toEqual([[480, 640]]);
    expect(result.reshapedInputSizes).toEqual([[1024, 1024]]);
    expect(result.pixel_values).toBe(pixelValues);
  });
});
