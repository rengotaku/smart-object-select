export type SamDevice = "webgpu" | "wasm";

export interface GpuLike {
  requestAdapter(): Promise<unknown | null>;
}

export interface NavigatorLike {
  gpu?: GpuLike;
}

/**
 * WebGPU が利用可能かどうかを検出する。
 * `nav` を省略した場合は `globalThis.navigator` を使う。
 * 検出過程で発生した例外は伝播させず、安全側の "wasm" にフォールバックする。
 */
export async function detectDevice(nav?: NavigatorLike): Promise<SamDevice> {
  const target = nav ?? (globalThis.navigator as NavigatorLike | undefined);

  if (!target?.gpu) {
    return "wasm";
  }

  try {
    const adapter = await target.gpu.requestAdapter();
    return adapter ? "webgpu" : "wasm";
  } catch {
    return "wasm";
  }
}
