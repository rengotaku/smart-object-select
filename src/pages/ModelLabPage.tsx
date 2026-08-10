import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Info, RefreshCw } from "lucide-react";

import { ImageDropzone, ModelLabResultView } from "@/components";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useMobileSam } from "@/hooks/useMobileSam";
import { useEdgeSam } from "@/hooks/useEdgeSam";
import { useYolo11nSeg } from "@/hooks/useYolo11nSeg";
import type { LoadedImage } from "@/hooks";
import {
  ModelLabRegistry,
  type ModelLabBoxOverlay,
  type ModelLabResult,
} from "@/lib/modelLab";
import type { MobileSamWorkerClient } from "@/lib/modelLab/mobileSam";
import type { EdgeSamWorkerClient } from "@/lib/modelLab/edgeSam";
import {
  findDetectionAtPoint,
  type Yolo11nSegWorkerClient,
} from "@/lib/modelLab/yolo11nSeg";

/** MobileSAM（issue #47）の `ModelLabDescriptor.id`。registry.ts のエントリと一致させる。 */
const MOBILE_SAM_MODEL_ID = "mobile-sam";
/** EdgeSAM（issue #48）の `ModelLabDescriptor.id`。registry.ts のエントリと一致させる。 */
const EDGE_SAM_MODEL_ID = "edge-sam";
/** YOLO11n-seg（issue #49）の `ModelLabDescriptor.id`。registry.ts のエントリと一致させる。 */
const YOLO11N_SEG_MODEL_ID = "yolo11n-seg";

const YOLO_CLICK_HINT_TEXT =
  "画像をクリックすると、その位置にあるインスタンスをハイライトします";

export interface ModelLabPageProps {
  /**
   * テストから fake MobileSamWorkerClient を注入するためのフック（SegmentPage の
   * `createClient` と同じ役割）。省略時は `useMobileSam` の既定
   * （`mobileSam.worker.ts` を起動する実クライアント）が使われる。
   */
  createMobileSamClient?: () => MobileSamWorkerClient;
  /**
   * テストから fake EdgeSamWorkerClient を注入するためのフック（`createMobileSamClient`
   * と同じ役割）。省略時は `useEdgeSam` の既定（`edgeSam.worker.ts` を起動する
   * 実クライアント）が使われる。
   */
  createEdgeSamClient?: () => EdgeSamWorkerClient;
  /**
   * テストから fake Yolo11nSegWorkerClient を注入するためのフック（`createMobileSamClient`
   * と同じ役割）。省略時は `useYolo11nSeg` の既定（`yolo11nSeg.worker.ts` を起動する
   * 実クライアント）が使われる。
   */
  createYolo11nSegClient?: () => Yolo11nSegWorkerClient;
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
 * EdgeSAM（issue #48）: `useEdgeSam`（`src/lib/modelLab/edgeSam/`）を使い、同じ
 * 点クリック→マスク表示のインタラクションで動作する。
 * YOLO11n-seg（issue #49）: `useYolo11nSeg`（`src/lib/modelLab/yolo11nSeg/`）を使い、
 * MobileSAM/EdgeSAM とは根本的に異なるインタラクションで動作する。全自動でCOCO80クラスの
 * 全インスタンスを画像アップロード時に一括検出し、クリックは新規推論ではなく検出済み
 * インスタンスの選択（ハイライト）として扱う（親 #45「未確定の論点」を解決）。
 * 他モデル（FastSAM 等）は後続 sub-issue が同じ拡張ポイント
 * （ModelLabRegistry への追加 + このページでの switch）で追加していく想定。
 */
export function ModelLabPage({
  createMobileSamClient,
  createEdgeSamClient,
  createYolo11nSegClient,
}: ModelLabPageProps = {}) {
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
  // クリックでハイライトしたインスタンスの overlays 配列内 index（YOLO11n-seg 専用）。
  // モデル・画像の切り替え時にクリアする。setState をレンダー中に直接呼ぶ
  // 「前回の関連値をレンダー中に比較して調整する」パターン（React 公式が推奨する、
  // useEffect を使わない state 調整方法）で実装する（`selectedModelId`/`image` が
  // 変化した最初のレンダーで同期的にリセットされ、useEffect 経由の cascading render
  // を避けられる）。
  const [selectedInstanceIndex, setSelectedInstanceIndex] = useState<number | null>(null);
  const [instanceSelectionKey, setInstanceSelectionKey] = useState<{
    modelId: string;
    image: LoadedImage | null;
  }>({ modelId: selectedModelId, image });
  if (
    instanceSelectionKey.modelId !== selectedModelId ||
    instanceSelectionKey.image !== image
  ) {
    setInstanceSelectionKey({ modelId: selectedModelId, image });
    setSelectedInstanceIndex(null);
  }

  const isMobileSamActive = selectedModelId === MOBILE_SAM_MODEL_ID;
  const isEdgeSamActive = selectedModelId === EDGE_SAM_MODEL_ID;
  const isYoloActive = selectedModelId === YOLO11N_SEG_MODEL_ID;
  const {
    status: mobileSamStatus,
    error: mobileSamError,
    mask: mobileSamMask,
    segmentAtPoint: segmentMobileSamAtPoint,
    reset: resetMobileSam,
  } = useMobileSam({ createClient: createMobileSamClient });
  const {
    status: edgeSamStatus,
    error: edgeSamError,
    mask: edgeSamMask,
    segmentAtPoint: segmentEdgeSamAtPoint,
    reset: resetEdgeSam,
  } = useEdgeSam({ createClient: createEdgeSamClient });
  const {
    status: yoloStatus,
    error: yoloError,
    detections: yoloDetections,
    detect: detectYolo,
    reset: resetYolo,
  } = useYolo11nSeg({ createClient: createYolo11nSegClient });

  useEffect(() => {
    return () => {
      revokeObjectUrl(imageRef.current?.objectUrl);
    };
  }, []);

  // モデル・画像を切り替えたら、前回の推論結果を引きずらないようクリアする。
  // （`selectedInstanceIndex` のクリアは上記のレンダー中 state 調整で行う）
  useEffect(() => {
    resetMobileSam();
    resetEdgeSam();
    resetYolo();
  }, [selectedModelId, image, resetMobileSam, resetEdgeSam, resetYolo]);

  // YOLO11n-seg は点クリックではなく画像アップロード時の全自動検出（issue #49）。
  // `detectYolo` は同じ image に対しては再検出をスキップする（useYolo11nSeg.ts 参照）ため、
  // 依存する再レンダリングのたびに呼んでも冪等。
  useEffect(() => {
    if (isYoloActive && image) {
      detectYolo(image);
    }
  }, [isYoloActive, image, detectYolo]);

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
      if (!image) return;
      if (isMobileSamActive) {
        segmentMobileSamAtPoint(image, x, y);
      } else if (isEdgeSamActive) {
        segmentEdgeSamAtPoint(image, x, y);
      } else if (isYoloActive) {
        const index = findDetectionAtPoint(yoloDetections ?? [], x, y);
        setSelectedInstanceIndex(index);
      }
    },
    [
      isMobileSamActive,
      isEdgeSamActive,
      isYoloActive,
      image,
      segmentMobileSamAtPoint,
      segmentEdgeSamAtPoint,
      yoloDetections,
    ]
  );

  const yoloOverlays: ModelLabBoxOverlay[] = (yoloDetections ?? []).map((detection) => ({
    kind: "box",
    x: detection.box.x,
    y: detection.box.y,
    width: detection.box.width,
    height: detection.box.height,
    label: detection.label,
    score: detection.score,
    mask: detection.mask,
  }));

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
      : isEdgeSamActive && edgeSamMask
        ? {
            modelId: EDGE_SAM_MODEL_ID,
            overlays: [
              {
                kind: "mask",
                data: edgeSamMask.data,
                width: edgeSamMask.width,
                height: edgeSamMask.height,
                score: edgeSamMask.score,
              },
            ],
          }
        : isYoloActive && yoloDetections
          ? { modelId: YOLO11N_SEG_MODEL_ID, overlays: yoloOverlays }
          : null;

  const isMobileSamBusy =
    isMobileSamActive &&
    (mobileSamStatus === "loading" || mobileSamStatus === "segmenting");
  const isEdgeSamBusy =
    isEdgeSamActive && (edgeSamStatus === "loading" || edgeSamStatus === "segmenting");
  const isYoloBusy =
    isYoloActive && (yoloStatus === "loading" || yoloStatus === "detecting");
  const isActiveModelBusy = isMobileSamBusy || isEdgeSamBusy || isYoloBusy;

  const selectedInstance =
    isYoloActive && selectedInstanceIndex !== null
      ? (yoloDetections?.[selectedInstanceIndex] ?? null)
      : null;

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

      {isEdgeSamActive && edgeSamError && (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" />
          <AlertTitle>EdgeSAM の推論に失敗しました</AlertTitle>
          <AlertDescription>
            {edgeSamError.message || "不明なエラーです"}
          </AlertDescription>
        </Alert>
      )}

      {isYoloActive && (
        <Alert data-testid="model-lab-yolo-scope-notice">
          <Info className="size-4" />
          <AlertTitle>YOLO11n-seg は COCO の80クラスしか検出できません</AlertTitle>
          <AlertDescription>
            学習済みの80クラス（人物・車・動物など）に含まれない物体は検出・選択できません
            （閉集合検出器）。ライセンス: AGPL-3.0（
            <code>public/models/yolo11n-seg/NOTICE</code> 参照）。
          </AlertDescription>
        </Alert>
      )}

      {isYoloActive && yoloError && (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" />
          <AlertTitle>YOLO11n-seg の推論に失敗しました</AlertTitle>
          <AlertDescription>{yoloError.message || "不明なエラーです"}</AlertDescription>
        </Alert>
      )}

      {!image ? (
        <ImageDropzone onImageLoaded={handleImageLoaded} />
      ) : (
        <>
          <ModelLabResultView
            image={image}
            result={result}
            onImageClick={
              isMobileSamActive || isEdgeSamActive || isYoloActive
                ? handleImageClick
                : undefined
            }
            isBusy={isActiveModelBusy}
            clickHintText={isYoloActive ? YOLO_CLICK_HINT_TEXT : undefined}
            highlightedOverlayIndex={isYoloActive ? selectedInstanceIndex : null}
          />
          {isYoloActive && yoloDetections && (
            <p
              className="text-sm text-muted-foreground"
              data-testid="model-lab-yolo-summary"
            >
              検出数: {yoloDetections.length}件
              {selectedInstance && (
                <>
                  {" "}
                  ／ 選択中: {selectedInstance.label}（
                  {Math.round(selectedInstance.score * 100)}%）
                </>
              )}
            </p>
          )}
        </>
      )}
    </div>
  );
}
