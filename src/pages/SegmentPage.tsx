import { AlertTriangle, Cpu, Loader2, Zap } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useSamEngine } from "@/hooks";
import { cn } from "@/lib/utils";
import type { SamWorkerClient } from "@/lib/sam";

export interface SegmentPageProps {
  /**
   * テストから fake SamWorkerClient を注入するためのフック。
   * 省略時は useSamEngine の既定（実 Worker クライアント）が使われる。
   */
  createClient?: () => SamWorkerClient;
}

/**
 * SAM 推論エンジン（device / ロード状態）を表示する最小画面。
 * 画像アップロード・Canvas・クリック処理は #3 で実装する（本ページの対象外）。
 */
export function SegmentPage({ createClient }: SegmentPageProps = {}) {
  const { status, device, error } = useSamEngine(createClient);

  return (
    <div>
      <h1 className="mb-6 text-3xl font-bold tracking-tight">Segment</h1>

      <Card className="max-w-md">
        <CardHeader>
          <CardTitle>推論エンジン</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {status === "initializing" && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              <span>モデルを読み込んでいます</span>
            </div>
          )}

          {status === "ready" && device && (
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

          {status === "ready" && device === "wasm" && (
            <Alert variant="destructive">
              <AlertTriangle className="size-4" />
              <AlertTitle>WASM で実行しています</AlertTitle>
              <AlertDescription>
                WebGPU が利用できないため WASM で実行します。処理に時間がかかります。
              </AlertDescription>
            </Alert>
          )}

          {status === "error" && (
            <Alert variant="destructive">
              <AlertTriangle className="size-4" />
              <AlertTitle>初期化に失敗しました</AlertTitle>
              <AlertDescription>{error?.message || "不明なエラーです"}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
