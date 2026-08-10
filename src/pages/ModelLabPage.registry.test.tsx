import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

// ModelLabRegistry に1件以上モデルが登録されている状態を再現するため、
// このファイルだけ @/lib/modelLab をモックする（他テストの空レジストリ前提は壊さない）。
vi.mock("@/lib/modelLab", () => ({
  ModelLabRegistry: [
    { id: "mobile-sam", name: "MobileSAM" },
    { id: "edge-sam", name: "EdgeSAM" },
  ],
}));

describe("ModelLabPage（ModelLabRegistry にモデルが登録済みのとき）", () => {
  it("selectedModelId の初期値がレジストリ先頭モデルのIDになる", async () => {
    const { ModelLabPage } = await import("./ModelLabPage");
    render(<ModelLabPage />);

    const select = screen.getByLabelText("モデル") as HTMLSelectElement;
    expect(select).not.toBeDisabled();
    expect(select.value).toBe("mobile-sam");
  });
});
