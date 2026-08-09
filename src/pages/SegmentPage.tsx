import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Cpu,
  Layers,
  Loader2,
  RefreshCw,
  RotateCcw,
  Server,
  Zap,
} from "lucide-react";

import {
  CandidatePicker,
  ExportBar,
  ImageDropzone,
  LayerPanel,
  SegmentCanvas,
} from "@/components";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useSamEngine, useSegmentation } from "@/hooks";
import { cn } from "@/lib/utils";
import type { ExecutionMode, SamModelDescriptor, SamWorkerClient } from "@/lib/sam";

/** ローカル推論サーバー（issue #32、`server/`）の既定ポート（`server/README.md` 参照）。 */
const DEFAULT_LOCAL_SERVER_URL = "http://localhost:8787";

export interface SegmentPageProps {
  /**
   * テストから fake SamWorkerClient を注入するためのフック。
   * 省略時は useSamEngine の既定（実 Worker クライアント）が使われる。
   * 実行方式が「PCローカルサーバー」のときは使われない（サーバーへの HTTP クライアントが使われる）。
   */
  createClient?: () => SamWorkerClient;
}

export function SegmentPage({ createClient }: SegmentPageProps = {}) {
  const [executionMode, setExecutionMode] = useState<ExecutionMode>("browser");
  const [serverUrl, setServerUrl] = useState(DEFAULT_LOCAL_SERVER_URL);
  const [selectedModelId, setSelectedModelId] = useState("");
  const [serverModels, setServerModels] = useState<SamModelDescriptor[]>([]);
  const [serverModelsLoading, setServerModelsLoading] = useState(false);
  const [serverModelsError, setServerModelsError] = useState<string | null>(null);

  // 実行方式が「PCローカルサーバー」の間、サーバーURLが変わるたびに GET /models で
  // モデル選択UIの選択肢を取得する。サーバー未起動・接続失敗時はここでエラーを検知して
  // 表示する（DoD: サーバー未起動状態でエラーメッセージが表示されること）。
  useEffect(() => {
    if (executionMode !== "local-server") {
      return;
    }

    let cancelled = false;

    // setState はここで同期的に呼ばず、Promise チェーンの中（マイクロタスク）へ逃がす
    // （react-hooks/set-state-in-effect対策。effect body 内での同期 setState 呼び出しは
    // カスケードレンダーを招くため禁止されている。useSamEngine.ts の同種コメント参照）。
    Promise.resolve()
      .then(() => {
        if (cancelled) return undefined;
        setServerModelsLoading(true);
        setServerModelsError(null);
        return fetch(`${serverUrl}/models`);
      })
      .then((response) => {
        if (cancelled || !response) return undefined;
        if (!response.ok) {
          throw new Error(`サーバーエラー（HTTP ${response.status}）`);
        }
        return response.json() as Promise<SamModelDescriptor[]>;
      })
      .then((models) => {
        if (cancelled || !models) return;
        setServerModels(models);
        setSelectedModelId((prev) =>
          prev && models.some((model) => model.id === prev) ? prev : (models[0]?.id ?? "")
        );
      })
      .catch(() => {
        if (cancelled) return;
        setServerModels([]);
        setSelectedModelId("");
        setServerModelsError(
          "ローカル推論サーバーに接続できません。サーバーが起動しているか確認するか、" +
            "ブラウザ内蔵に切り替えてください。"
        );
      })
      .finally(() => {
        if (cancelled) return;
        setServerModelsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [executionMode, serverUrl]);

  // browser: 常に準備できている。local-server: モデル選択が済むまで engine を起動しない。
  const engineReady = executionMode === "browser" || Boolean(selectedModelId);
  const selectedModelName =
    serverModels.find((model) => model.id === selectedModelId)?.name ?? selectedModelId;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Segment</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          任意の位置をクリックしてオブジェクトをオートマスク選択します
        </p>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-4 pt-6 sm:flex-row sm:flex-wrap sm:items-end">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="execution-mode" className="text-sm font-medium">
              実行方式
            </label>
            <select
              id="execution-mode"
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              value={executionMode}
              onChange={(event) => setExecutionMode(event.target.value as ExecutionMode)}
            >
              <option value="browser">ブラウザ内蔵</option>
              <option value="local-server">PCローカルサーバー</option>
            </select>
          </div>

          {executionMode === "local-server" && (
            <>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="server-url" className="text-sm font-medium">
                  サーバーURL
                </label>
                <input
                  id="server-url"
                  type="text"
                  className="h-9 w-56 rounded-md border border-input bg-background px-3 text-sm"
                  value={serverUrl}
                  onChange={(event) => setServerUrl(event.target.value)}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="server-model" className="text-sm font-medium">
                  モデル
                </label>
                <select
                  id="server-model"
                  className="h-9 min-w-40 rounded-md border border-input bg-background px-3 text-sm"
                  value={selectedModelId}
                  disabled={serverModelsLoading || serverModels.length === 0}
                  onChange={(event) => setSelectedModelId(event.target.value)}
                >
                  {serverModels.length === 0 && (
                    <option value="">
                      {serverModelsLoading
                        ? "読み込み中..."
                        : "利用可能なモデルがありません"}
                    </option>
                  )}
                  {serverModels.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.name}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {serverModelsError && (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" />
          <AlertTitle>サーバーに接続できません</AlertTitle>
          <AlertDescription>{serverModelsError}</AlertDescription>
        </Alert>
      )}

      {engineReady && (
        <SegmentWorkspace
          // 実行方式・サーバーURL・モデルを切り替えたら engine を作り直す
          // （useSamEngine は初回マウント時点の値で固定する設計のため、key で再マウントする）。
          key={
            executionMode === "local-server"
              ? `local-server:${serverUrl}:${selectedModelId}`
              : "browser"
          }
          executionMode={executionMode}
          serverUrl={serverUrl}
          modelId={selectedModelId}
          modelName={selectedModelName}
          createClient={executionMode === "browser" ? createClient : undefined}
        />
      )}
    </div>
  );
}

interface SegmentWorkspaceProps {
  executionMode: ExecutionMode;
  serverUrl?: string;
  modelId?: string;
  modelName?: string;
  createClient?: () => SamWorkerClient;
}

function SegmentWorkspace({
  executionMode,
  serverUrl,
  modelId,
  modelName,
  createClient,
}: SegmentWorkspaceProps) {
  const {
    status: engineStatus,
    device,
    client,
    error: engineError,
    progress: engineProgress,
  } = useSamEngine({ executionMode, serverUrl, modelId, createClient });
  const {
    status: segStatus,
    image,
    mask,
    candidates,
    selectedCandidateIndex,
    points,
    layers,
    error: segError,
    setImage,
    addPoint,
    clearPoints,
    saveLayer,
    removeLayer,
    reset,
    selectCandidate,
  } = useSegmentation(client);

  // 進捗通知が届くまでは総量が分からないため「モデルを読み込んでいます」（進捗なし）を
  // 既定表示にする。total が取れない（null）ファイルはパーセントを出さずフォールバックする。
  const engineLoadingLabel = (() => {
    if (!engineProgress) {
      return "モデルを読み込んでいます";
    }
    if (engineProgress.total === null) {
      return "モデルを読み込み中...";
    }
    const percent = Math.round((engineProgress.loaded / engineProgress.total) * 100);
    return `モデルを読み込み中... ${percent}%`;
  })();

  return (
    <div className="space-y-6">
      {engineStatus === "ready" && executionMode === "browser" && device && (
        <div className="flex justify-end">
          <span
            data-testid="engine-badge"
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
        </div>
      )}

      {engineStatus === "ready" && executionMode === "local-server" && (
        <div className="flex justify-end">
          <span
            data-testid="engine-badge"
            className="inline-flex w-fit items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 text-xs font-semibold text-secondary-foreground"
          >
            <Server className="size-3.5" aria-hidden="true" />
            {modelName}
          </span>
        </div>
      )}

      {engineStatus === "initializing" && (
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>推論エンジン</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              <span>{engineLoadingLabel}</span>
            </div>
          </CardContent>
        </Card>
      )}

      {engineStatus === "ready" && executionMode === "browser" && device === "wasm" && (
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

              <CandidatePicker
                image={image}
                candidates={candidates}
                selectedIndex={selectedCandidateIndex}
                onSelect={selectCandidate}
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
