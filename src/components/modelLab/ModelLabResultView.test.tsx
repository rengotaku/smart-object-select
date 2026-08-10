import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { ModelLabResultView } from "./ModelLabResultView";
import type { LoadedImage } from "@/hooks";
import type { ModelLabResult } from "@/lib/modelLab";

const image: LoadedImage = {
  data: new Uint8ClampedArray([255, 0, 0, 255]),
  width: 1,
  height: 1,
  objectUrl: "blob:fake-image",
};

describe("ModelLabResultView", () => {
  it("画像が無いとき空状態を表示する", () => {
    render(<ModelLabResultView image={null} />);

    expect(screen.getByTestId("model-lab-result-empty-state")).toBeInTheDocument();
    expect(screen.queryByTestId("model-lab-preview-image")).not.toBeInTheDocument();
  });

  it("画像があるときプレビューを表示する", () => {
    render(<ModelLabResultView image={image} />);

    const preview = screen.getByTestId("model-lab-preview-image");
    expect(preview).toBeInTheDocument();
    expect(preview).toHaveAttribute("src", "blob:fake-image");
    expect(screen.queryByTestId("model-lab-result-empty-state")).not.toBeInTheDocument();
  });

  it("結果未指定のとき「実行すると重ね描画される」旨のメッセージを表示する", () => {
    render(<ModelLabResultView image={image} />);

    expect(screen.getByTestId("model-lab-result-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("model-lab-overlay-layer")).not.toBeInTheDocument();
  });

  it("結果があるときオーバーレイ描画レイヤーの拡張ポイントをレンダリングする", () => {
    const result: ModelLabResult = { modelId: "mobile-sam", overlays: [] };
    render(<ModelLabResultView image={image} result={result} />);

    expect(screen.getByTestId("model-lab-overlay-layer")).toBeInTheDocument();
    expect(screen.queryByTestId("model-lab-result-empty")).not.toBeInTheDocument();
  });
});
