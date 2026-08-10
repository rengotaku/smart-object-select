import { describe, it, expect } from "vitest";
import { ModelLabRegistry, type ModelLabDescriptor } from "./registry";

describe("ModelLabRegistry", () => {
  it("is an array (拡張ポイント)", () => {
    expect(Array.isArray(ModelLabRegistry)).toBe(true);
  });

  it("mobile-sam（issue #47）が登録されている", () => {
    const mobileSam = ModelLabRegistry.find((model) => model.id === "mobile-sam");
    expect(mobileSam).toBeDefined();
    expect(mobileSam?.name).toBe("MobileSAM");
  });

  it("yolo11n-seg（issue #49）が登録されている", () => {
    const yolo = ModelLabRegistry.find((model) => model.id === "yolo11n-seg");
    expect(yolo).toBeDefined();
    expect(yolo?.name).toBe("YOLO11n-seg");
  });

  it("fast-sam（issue #50）が登録されている", () => {
    const fastSam = ModelLabRegistry.find((model) => model.id === "fast-sam");
    expect(fastSam).toBeDefined();
    expect(fastSam?.name).toBe("FastSAM");
  });

  it("ModelLabDescriptor を要素として追加できる形になっている（型レベルの拡張性確認）", () => {
    // 後続 sub-issue はこの配列に要素を追加するだけで選択肢が増える設計であることを、
    // 型と実行時の両方で確認する（コンパイルが通ること自体がこのテストの主眼）。
    const extended: ModelLabDescriptor[] = [
      ...ModelLabRegistry,
      { id: "edge-sam", name: "EdgeSAM", description: "軽量版SAM" },
    ];

    expect(extended).toHaveLength(ModelLabRegistry.length + 1);
    expect(extended.at(-1)).toEqual({
      id: "edge-sam",
      name: "EdgeSAM",
      description: "軽量版SAM",
    });
  });
});
