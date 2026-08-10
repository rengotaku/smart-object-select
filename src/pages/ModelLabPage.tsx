import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

import { ImageDropzone, ModelLabResultView } from "@/components";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useMobileSam } from "@/hooks/useMobileSam";
import type { LoadedImage } from "@/hooks";
import { ModelLabRegistry, type ModelLabResult } from "@/lib/modelLab";
import type { MobileSamWorkerClient } from "@/lib/modelLab/mobileSam";

/** MobileSAM（issue #47）の `ModelLabDescriptor.id`。registry.ts のエントリと一致させる。 */
const MOBILE_SAM_MODEL_ID = "mobile-sam";

export interface ModelLabPageProps {
  /**
   * テストから fake MobileSamWorkerClient を注入するためのフック（SegmentPage の
   * `createClient` と同じ役割）。省略時は `useMobileSam` の既定
   * （`mobileSam.worker.ts` を起動する実クライアント）が使われる。
   */
  createMobileSamClient?: () => MobileSamWorkerClient;
}

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
 * モデル検証用ページ（issue #46, 親 #45）。
 *
 * 却下・保留されたモデル（MobileSAM/EdgeSAM/YOLO11n-seg/FastSAM 等）のうち
 * wasm 対応可能なものを画面上で検証するための実験用ページ。既存の `SegmentPage` /
 * `useSamEngine` / `SamWorkerClient` とは独立しており、本番の実行方式には影響しない
 * （親 #45 Decision Log #3）。
 *
 * MobileSAM（issue #47）: `useMobileSam`（`onnxruntime-web` を直接呼ぶ検証専用実装、
 * `src/lib/modelLab/mobileSam/`）を使い、点クリック→マスク表示のインタラクションで動作する。
 * 他モデル（EdgeSAM/YOLO11n-seg/FastSAM 等）は後続 sub-issue が同じ拡張ポイント
 * （ModelLabRegistry への追加 + このページでの switch）で追加していく想定。
 */
export function ModelLabPage({ createMobileSamClient }: ModelLabPageProps = {}) {
  const [image, setImageState] = useState<LoadedImage | null>(null);
  // ModelLabRegistry にモデルが1件でも登録されていれば、その先頭を初期選択にする。
  // 空文字のまま初期化すると、レジストリが1件だけの場合ブラウザは先頭 <option> を
  // 視覚的に選択表示する一方 selectedModelId（React state）は空文字のまま乖離し、
  // ユーザーが select を操作しない限り onChange が発火せず不整合が解消されない。
  const [selectedModelId, setSelectedModelId] = useState(
    () => ModelLabRegistry[0]?.id ?? ""
  );
  // 直近の image を同期的に保持する ref。setState は非同期に反映されるため、
  // アンマウント時 cleanup やハンドラ内で「今どの Object URL が生きているか」を
  // 正確に参照するには state ではなく ref が必要（useSegmentation.ts と同じ理由）。
  const imageRef = useRef<LoadedImage | null>(null);

  const isMobileSamActive = selectedModelId === MOBILE_SAM_MODEL_ID;
  const {
    status: mobileSamStatus,
    error: mobileSamError,
    mask: mobileSamMask,
    segmentAtPoint: segmentMobileSamAtPoint,
    reset: resetMobileSam,
  } = useMobileSam({ createClient: createMobileSamClient });

  useEffect(() => {
    return () => {
      revokeObjectUrl(imageRef.current?.objectUrl);
    };
  }, []);

  // モデル・画像を切り替えたら、前回の推論結果を引きずらないようクリアする。
  useEffect(() => {
    resetMobileSam();
  }, [selectedModelId, image, resetMobileSam]);

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

  const handleImageClick = useCallback(
    (x: number, y: number) => {
      if (!isMobileSamActive || !image) return;
      segmentMobileSamAtPoint(image, x, y);
    },
    [isMobileSamActive, image, segmentMobileSamAtPoint]
  );

  const result: ModelLabResult | null =
    isMobileSamActive && mobileSamMask
      ? {
          modelId: MOBILE_SAM_MODEL_ID,
          overlays: [
            {
              kind: "mask",
              data: mobileSamMask.data,
              width: mobileSamMask.width,
              height: mobileSamMask.height,
              score: mobileSamMask.score,
            },
          ],
        }
      : null;

  const isMobileSamBusy =
    isMobileSamActive &&
    (mobileSamStatus === "loading" || mobileSamStatus === "segmenting");

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

      {isMobileSamActive && mobileSamError && (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" />
          <AlertTitle>MobileSAM の推論に失敗しました</AlertTitle>
          <AlertDescription>
            {mobileSamError.message || "不明なエラーです"}
          </AlertDescription>
        </Alert>
      )}

      {!image ? (
        <ImageDropzone onImageLoaded={handleImageLoaded} />
      ) : (
        <ModelLabResultView
          image={image}
          result={result}
          onImageClick={isMobileSamActive ? handleImageClick : undefined}
          isBusy={isMobileSamBusy}
        />
      )}
    </div>
  );
}
