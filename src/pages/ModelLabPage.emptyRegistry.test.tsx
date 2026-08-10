import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

// ModelLabRegistry が空のときの表示（issue #46 の土台状態）を再現するため、
// このファイルだけ @/lib/modelLab をモックする（他テストの mobile-sam 登録済み前提は壊さない）。
vi.mock("@/lib/modelLab", () => ({
  ModelLabRegistry: [],
}));

describe("ModelLabPage（ModelLabRegistry が空のとき）", () => {
  it("選択肢が空のプレースホルダを表示し select を無効化する", async () => {
    const { ModelLabPage } = await import("./ModelLabPage");
    render(<ModelLabPage />);

    const select = screen.getByLabelText("モデル") as HTMLSelectElement;
    expect(select).toBeDisabled();
    expect(screen.getByText("検証可能なモデルはまだありません")).toBeInTheDocument();
  });
});
