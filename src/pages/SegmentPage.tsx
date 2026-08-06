import {
  AlertTriangle,
  Cpu,
  Layers,
  Loader2,
  RefreshCw,
  RotateCcw,
  Zap,
} from "lucide-react";

import { ExportBar, ImageDropzone, LayerPanel, SegmentCanvas } from "@/components";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useSamEngine, useSegmentation } from "@/hooks";
import { cn } from "@/lib/utils";
import type { SamWorkerClient } from "@/lib/sam";

export interface SegmentPageProps {
  /**
   * テストから fake SamWorkerClient を注入するためのフック。
   * 省略時は useSamEngine の既定（実 Worker クライアント）が使われる。
   */
  createClient?: () => SamWorkerClient;
}

export function SegmentPage({ createClient }: SegmentPageProps = {}) {
  const {
    status: engineStatus,
    device,
    client,
    error: engineError,
  } = useSamEngine(createClient);
  const {
    status: segStatus,
    image,
    mask,
    points,
    layers,
    error: segError,
    setImage,
    addPoint,
    clearPoints,
    saveLayer,
    removeLayer,
    reset,
  } = useSegmentation(client);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Segment</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            任意の位置をクリックしてオブジェクトをオートマスク選択します
          </p>
        </div>

        {engineStatus === "ready" && device && (
          <span
            className={cn(
              "inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
              device === "webgpu"
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-secondary-foreground"
            )}
          >
            {device === "webgpu" ? (
              <Zap className="size-3.5" aria-hidden="true" />
            ) : (
              <Cpu className="size-3.5" aria-hidden="true" />
            )}
            {device === "webgpu" ? "WebGPU" : "WASM"}
          </span>
        )}
      </div>

      {engineStatus === "initializing" && (
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>推論エンジン</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              <span>モデルを読み込んでいます</span>
            </div>
          </CardContent>
        </Card>
      )}

      {engineStatus === "ready" && device === "wasm" && (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" />
          <AlertTitle>WASM で実行しています</AlertTitle>
          <AlertDescription>
            WebGPU が利用できないため WASM で実行します。処理に時間がかかります。
          </AlertDescription>
        </Alert>
      )}

      {engineStatus === "error" && (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" />
          <AlertTitle>初期化に失敗しました</AlertTitle>
          <AlertDescription>
            {engineError?.message || "不明なエラーです"}
          </AlertDescription>
        </Alert>
      )}

      {segError && (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" />
          <AlertTitle>エラー</AlertTitle>
          <AlertDescription>
            {segError.message || "処理中にエラーが発生しました"}
          </AlertDescription>
        </Alert>
      )}

      {engineStatus === "ready" && (
        <>
          {!image ? (
            <ImageDropzone onImageLoaded={(img) => void setImage(img)} />
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-muted-foreground">
                  クリックして対象を選択、Shift+クリックで追加、Alt+クリックで除外できます
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!mask || segStatus !== "ready"}
                    onClick={saveLayer}
                  >
                    <Layers className="mr-2 size-4" />
                    レイヤーとして保存
                  </Button>
                  <Button variant="outline" size="sm" onClick={clearPoints}>
                    <RotateCcw className="mr-2 size-4" />
                    選択をやり直す
                  </Button>
                  <Button variant="outline" size="sm" onClick={reset}>
                    <RefreshCw className="mr-2 size-4" />
                    別の画像を選ぶ
                  </Button>
                </div>
              </div>

              <SegmentCanvas
                image={image}
                mask={mask}
                status={segStatus}
                points={points}
                onPointClick={(x, y, label, options) =>
                  void addPoint(x, y, label, options)
                }
              />

              <ExportBar image={image} mask={mask} sourceFileName={image.sourceName} />

              <LayerPanel
                image={image}
                layers={layers}
                onRemove={removeLayer}
                sourceFileName={image.sourceName}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
