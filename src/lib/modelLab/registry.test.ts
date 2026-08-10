import { describe, it, expect } from "vitest";
import { ModelLabRegistry, type ModelLabDescriptor } from "./registry";

describe("ModelLabRegistry", () => {
  it("is an array (拡張ポイント) — 本 sub-issue の時点では空配列", () => {
    expect(Array.isArray(ModelLabRegistry)).toBe(true);
    expect(ModelLabRegistry).toHaveLength(0);
  });

  it("ModelLabDescriptor を要素として追加できる形になっている（型レベルの拡張性確認）", () => {
    // 後続 sub-issue はこの配列に要素を追加するだけで選択肢が増える設計であることを、
    // 型と実行時の両方で確認する（コンパイルが通ること自体がこのテストの主眼）。
    const extended: ModelLabDescriptor[] = [
      ...ModelLabRegistry,
      { id: "mobile-sam", name: "MobileSAM", description: "軽量版SAM" },
    ];

    expect(extended).toHaveLength(1);
    expect(extended[0]).toEqual({
      id: "mobile-sam",
      name: "MobileSAM",
      description: "軽量版SAM",
    });
  });
});
