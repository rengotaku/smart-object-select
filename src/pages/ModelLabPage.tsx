import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";

import { ImageDropzone, ModelLabResultView } from "@/components";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { LoadedImage } from "@/hooks";
import { ModelLabRegistry } from "@/lib/modelLab";

/**
 * `fileToLoadedImage`（`ImageDropzone` 経由）が `URL.createObjectURL` で生成した
 * Object URL を解放する。`src/hooks/useSegmentation.ts` の同名パターンに倣い、
 * 未定義環境（テスト等）でも安全に呼べるようガードする。
 */
function revokeObjectUrl(url: string | undefined) {
  if (url && typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
    URL.revokeObjectURL(url);
  }
}

/**
 * モデル検証用の土台ページ（issue #46, 親 #45）。
 *
 * 却下・保留されたモデル（MobileSAM/EdgeSAM/YOLO11n-seg/FastSAM 等）のうち
 * wasm 対応可能なものを画面上で検証するための実験用ページ。既存の `SegmentPage` /
 * `useSamEngine` / `SamWorkerClient` とは独立しており、本番の実行方式には影響しない
 * （親 #45 Decision Log #3）。
 *
 * 本 sub-issue（#46）の時点ではモデル統合は未実装で、土台（画像アップロード・
 * モデル切り替えUIの拡張ポイント・実行結果表示エリア）のみを提供する。
 */
export function ModelLabPage() {
  const [image, setImageState] = useState<LoadedImage | null>(null);
  const [selectedModelId, setSelectedModelId] = useState("");
  // 直近の image を同期的に保持する ref。setState は非同期に反映されるため、
  // アンマウント時 cleanup やハンドラ内で「今どの Object URL が生きているか」を
  // 正確に参照するには state ではなく ref が必要（useSegmentation.ts と同じ理由）。
  const imageRef = useRef<LoadedImage | null>(null);

  useEffect(() => {
    return () => {
      revokeObjectUrl(imageRef.current?.objectUrl);
    };
  }, []);

  const handleImageLoaded = useCallback((newImage: LoadedImage) => {
    if (
      imageRef.current?.objectUrl &&
      imageRef.current.objectUrl !== newImage.objectUrl
    ) {
      revokeObjectUrl(imageRef.current.objectUrl);
    }
    imageRef.current = newImage;
    setImageState(newImage);
  }, []);

  const handleResetImage = useCallback(() => {
    revokeObjectUrl(imageRef.current?.objectUrl);
    imageRef.current = null;
    setImageState(null);
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Model Lab</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          却下・保留されたモデルのうち wasm 対応可能なものを検証するための実験用ページです
        </p>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-4 pt-6 sm:flex-row sm:flex-wrap sm:items-end">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="model-lab-model" className="text-sm font-medium">
              モデル
            </label>
            <select
              id="model-lab-model"
              className="h-9 min-w-56 rounded-md border border-input bg-background px-3 text-sm"
              value={selectedModelId}
              disabled={ModelLabRegistry.length === 0}
              onChange={(event) => setSelectedModelId(event.target.value)}
            >
              {ModelLabRegistry.length === 0 && (
                <option value="">検証可能なモデルはまだありません</option>
              )}
              {ModelLabRegistry.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name}
                </option>
              ))}
            </select>
          </div>

          {image && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleResetImage}
              data-testid="model-lab-reset-image"
            >
              <RefreshCw className="mr-2 size-4" />
              別の画像を選ぶ
            </Button>
          )}
        </CardContent>
      </Card>

      {!image ? (
        <ImageDropzone onImageLoaded={handleImageLoaded} />
      ) : (
        <ModelLabResultView image={image} />
      )}
    </div>
  );
}
