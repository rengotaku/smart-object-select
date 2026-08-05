import { describe, it, expect } from "vitest";
import { detectDevice } from "./device";

describe("detectDevice", () => {
  it("Case 1: returns wasm when navigator.gpu is unavailable", async () => {
    const device = await detectDevice({});

    expect(device).toBe("wasm");
  });

  it("Case 2: returns webgpu when an adapter is obtained", async () => {
    const device = await detectDevice({
      gpu: { requestAdapter: async () => ({}) },
    });

    expect(device).toBe("webgpu");
  });

  it("Case 3: returns wasm when requestAdapter resolves to null", async () => {
    const device = await detectDevice({
      gpu: { requestAdapter: async () => null },
    });

    expect(device).toBe("wasm");
  });

  it("Case 4: returns wasm without throwing when requestAdapter rejects", async () => {
    const device = await detectDevice({
      gpu: {
        requestAdapter: async () => {
          throw new Error("boom");
        },
      },
    });

    expect(device).toBe("wasm");
  });
});
