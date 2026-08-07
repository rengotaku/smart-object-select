import { describe, it, expect } from "vitest";
import { isSafariNavigator, resolveSelfHostedWasmPaths } from "./wasmRuntimePaths";

const CHROME_MAC_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const SAFARI_MAC_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15";
const CHROME_IOS_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/119.0.6045.109 Mobile/15E148 Safari/604.1";

describe("isSafariNavigator", () => {
  it("Case 1: returns false when navigator is undefined-like (no userAgent)", () => {
    expect(isSafariNavigator({})).toBe(false);
  });

  it("Case 2: returns false for Chrome on macOS (Apple vendor but Chrome UA)", () => {
    expect(isSafariNavigator({ userAgent: CHROME_MAC_UA, vendor: "Google Inc." })).toBe(
      false
    );
  });

  it("Case 3: returns true for actual Safari on macOS", () => {
    expect(
      isSafariNavigator({ userAgent: SAFARI_MAC_UA, vendor: "Apple Computer, Inc." })
    ).toBe(true);
  });

  it("Case 4: returns false for Chrome on iOS (CriOS, Apple vendor)", () => {
    expect(
      isSafariNavigator({ userAgent: CHROME_IOS_UA, vendor: "Apple Computer, Inc." })
    ).toBe(false);
  });
});

describe("resolveSelfHostedWasmPaths", () => {
  it("Case 1: returns asyncify variant for non-Safari", () => {
    const paths = resolveSelfHostedWasmPaths({
      userAgent: CHROME_MAC_UA,
      vendor: "Google Inc.",
    });

    expect(paths).toEqual({
      mjs: "/onnxruntime/ort-wasm-simd-threaded.asyncify.mjs",
      wasm: "/onnxruntime/ort-wasm-simd-threaded.asyncify.wasm",
    });
  });

  it("Case 2: returns non-asyncify variant for Safari", () => {
    const paths = resolveSelfHostedWasmPaths({
      userAgent: SAFARI_MAC_UA,
      vendor: "Apple Computer, Inc.",
    });

    expect(paths).toEqual({
      mjs: "/onnxruntime/ort-wasm-simd-threaded.mjs",
      wasm: "/onnxruntime/ort-wasm-simd-threaded.wasm",
    });
  });
});
