import { ImageOff } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import type { LoadedImage } from "@/hooks";
import type { ModelLabResult } from "@/lib/modelLab";

export interface ModelLabResultViewProps {
  image: LoadedImage | null;
  /**
   * モデルの実行結果。マスク・バウンディングボックスの重ね描画ロジックは
   * 後続 sub-issue で実装するため、本 sub-issue の時点では未指定（プレビューのみ）でよい。
   */
  result?: ModelLabResult | null;
}

/**
 * 画像上へマスク・バウンディングボックスを重ね描画する実行結果表示エリアの土台。
 *
 * - 画像未アップロード: 空状態を表示する
 * - 画像アップロード済み: プレビューを表示する（`result` のオーバーレイ描画は後続 sub-issue）
 */
export function ModelLabResultView({ image, result }: ModelLabResultViewProps) {
  if (!image) {
    return (
      <Card>
        <CardContent
          className="flex flex-col items-center justify-center gap-2 p-12 text-center text-muted-foreground"
          data-testid="model-lab-result-empty-state"
        >
          <ImageOff className="size-8" aria-hidden="true" />
          <p className="text-sm">画像をアップロードすると、ここに結果が表示されます</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-4">
        <div className="relative w-full overflow-hidden rounded-md border border-border">
          <img
            src={image.objectUrl}
            alt="アップロードされた画像のプレビュー"
            className="block w-full"
            data-testid="model-lab-preview-image"
          />
          {/*
            マスク・バウンディングボックスのオーバーレイ描画（result.overlays）は
            後続 sub-issue で実装する。この <div> は画像に重ねる絶対配置レイヤーの拡張ポイント。
          */}
          {result && (
            <div
              className="pointer-events-none absolute inset-0"
              data-testid="model-lab-overlay-layer"
            />
          )}
        </div>
        {!result && (
          <p
            className="mt-3 text-sm text-muted-foreground"
            data-testid="model-lab-result-empty"
          >
            モデルを選択して実行すると、検出結果がここに重ね描画されます
          </p>
        )}
      </CardContent>
    </Card>
  );
}
