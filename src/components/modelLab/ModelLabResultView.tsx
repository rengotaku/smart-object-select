import { useCallback, useEffect, useRef } from "react";
import type { MouseEvent } from "react";
import { ImageOff, Loader2 } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import type { LoadedImage } from "@/hooks";
import type { ModelLabBoxOverlay, ModelLabResult } from "@/lib/modelLab";
import { toImageCoords } from "@/lib/sam/coords";
import { maskToOverlayPixels } from "@/lib/sam/maskOverlay";

const DEFAULT_CLICK_HINT_TEXT = "画像をクリックすると、その位置でマスクを推論します";

/** マスクオーバーレイの既定色（半透明の青） */
const MASK_COLOR = { r: 59, g: 130, b: 246, a: 128 };
/** 全自動検出系（`kind: "box"`）インスタンスの既定色（半透明の緑） */
const BOX_COLOR = { r: 34, g: 197, b: 94, a: 90 };
/** ハイライト中インスタンスの色（半透明の琥珀色。既定色より目立たせる） */
const BOX_HIGHLIGHT_COLOR = { r: 250, g: 204, b: 21, a: 150 };

export interface ModelLabResultViewProps {
  image: LoadedImage | null;
  /**
   * モデルの実行結果。`kind: "mask"` のオーバーレイ（点プロンプト系: MobileSAM/EdgeSAM）と
   * `kind: "box"` のオーバーレイ（全自動検出系: YOLO11n-seg, issue #49）の両方を
   * overlay canvas に重ね描画する。`kind: "box"` は `mask` フィールドがあればマスクも
   * 塗りつぶし、常にバウンディングボックスの枠線を描く。
   */
  result?: ModelLabResult | null;
  /**
   * 画像上のクリック位置（元画像のピクセル座標系。0-indexed、画像範囲にクランプ済み）を
   * 通知する。省略時はクリック無効（カーソルも通常表示のまま）。
   */
  onImageClick?: (x: number, y: number) => void;
  /** モデル推論の実行中インジケータを表示するかどうか。実行中はクリックも無視する。 */
  isBusy?: boolean;
  /**
   * `onImageClick` が渡っているときにクリック操作の説明として表示する文言。
   * 省略時は点プロンプト系モデル向けの既定文言（マスク推論の説明）を使う。
   * 全自動検出系モデル（YOLO11n-seg 等）は推論済みインスタンスの選択が目的のため
   * 呼び出し側から別の文言を渡す（issue #49）。
   */
  clickHintText?: string;
  /**
   * `result.overlays` のうちハイライト表示するオーバーレイの index（`kind: "box"` のみ対象）。
   * 全自動検出系モデルでクリックしたインスタンスを目立たせるために使う（issue #49）。
   */
  highlightedOverlayIndex?: number | null;
}

function isMaskOverlay(
  overlay: ModelLabResult["overlays"][number]
): overlay is Extract<ModelLabResult["overlays"][number], { kind: "mask" }> {
  return overlay.kind === "mask";
}

function isBoxOverlay(
  overlay: ModelLabResult["overlays"][number]
): overlay is ModelLabBoxOverlay {
  return overlay.kind === "box";
}

/**
 * マスクを overlay canvas へ描画する。`mask` は画像全体（`kind: "mask"`）とバウンディング
 * ボックス範囲のみ（`kind: "box"` の `mask`、issue #49 codex レビュー指摘によりメモリ節約の
 * ため部分マスク化）の両方をサポートする。`offsetX`/`offsetY`（元画像座標系）を渡すと、
 * その位置にマスクを等倍（拡縮なし）で配置する。マスクの1ピクセルは常に元画像の1ピクセルに
 * 対応するため、canvas のサイズに合わせて引き伸ばす必要はない。
 */
function drawMaskLikeOverlay(
  ctx: CanvasRenderingContext2D,
  mask: { data: Uint8Array; width: number; height: number },
  score: number,
  color: { r: number; g: number; b: number; a: number },
  offsetX = 0,
  offsetY = 0
): void {
  if (mask.width <= 0 || mask.height <= 0) {
    return;
  }

  const pixels = maskToOverlayPixels({ ...mask, score }, color);
  const overlayImageData = ctx.createImageData(pixels.width, pixels.height);
  overlayImageData.data.set(pixels.data);

  const offscreen = document.createElement("canvas");
  offscreen.width = pixels.width;
  offscreen.height = pixels.height;
  const offCtx = offscreen.getContext("2d");
  if (offCtx) {
    offCtx.putImageData(overlayImageData, 0, 0);
    ctx.drawImage(offscreen, offsetX, offsetY);
  }
}

/**
 * 画像上へマスク・バウンディングボックスを重ね描画する実行結果表示エリア。
 *
 * - 画像未アップロード: 空状態を表示する
 * - 画像アップロード済み: プレビューを表示する。`onImageClick` が渡されていればクリックで
 *   元画像座標を通知し、`result.overlays` を overlay canvas に描画する
 *   （`kind: "mask"`: マスクの塗りつぶし。`kind: "box"`: 枠線＋あればマスクの塗りつぶし）
 */
export function ModelLabResultView({
  image,
  result,
  onImageClick,
  isBusy = false,
  clickHintText = DEFAULT_CLICK_HINT_TEXT,
  highlightedOverlayIndex = null,
}: ModelLabResultViewProps) {
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = overlayCanvasRef.current;
    if (!canvas || !image) return;

    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const overlays = result?.overlays ?? [];
    overlays.forEach((overlay, index) => {
      if (isMaskOverlay(overlay)) {
        drawMaskLikeOverlay(
          ctx,
          { data: overlay.data, width: overlay.width, height: overlay.height },
          overlay.score ?? 0,
          MASK_COLOR
        );
        return;
      }

      if (isBoxOverlay(overlay)) {
        const isHighlighted = index === highlightedOverlayIndex;
        if (overlay.mask) {
          drawMaskLikeOverlay(
            ctx,
            overlay.mask,
            overlay.score ?? 0,
            isHighlighted ? BOX_HIGHLIGHT_COLOR : BOX_COLOR,
            overlay.mask.x,
            overlay.mask.y
          );
        }
        ctx.strokeStyle = isHighlighted ? "#facc15" : "rgba(255, 255, 255, 0.85)";
        ctx.lineWidth = isHighlighted ? 3 : 1.5;
        ctx.strokeRect(overlay.x, overlay.y, overlay.width, overlay.height);
      }
    });
  }, [image, result, highlightedOverlayIndex]);

  const handleClick = useCallback(
    (event: MouseEvent<HTMLImageElement>) => {
      if (!image || !onImageClick || isBusy) return;

      const rect = event.currentTarget.getBoundingClientRect();
      const coords = toImageCoords(event.clientX, event.clientY, rect, {
        width: image.width,
        height: image.height,
      });
      if (coords) {
        onImageClick(coords.x, coords.y);
      }
    },
    [image, onImageClick, isBusy]
  );

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
            className={`block w-full ${onImageClick && !isBusy ? "cursor-crosshair" : ""}`}
            data-testid="model-lab-preview-image"
            onClick={handleClick}
          />
          {result && (
            <canvas
              ref={overlayCanvasRef}
              className="pointer-events-none absolute inset-0 h-full w-full"
              data-testid="model-lab-overlay-layer"
            />
          )}
          {isBusy && (
            <div
              className="absolute inset-0 flex flex-col items-center justify-center bg-background/60 backdrop-blur-sm"
              data-testid="model-lab-processing"
            >
              <Loader2
                className="mb-2 size-8 animate-spin text-primary"
                aria-hidden="true"
              />
              <span className="text-sm font-medium text-foreground">処理中...</span>
            </div>
          )}
        </div>
        {onImageClick && !isBusy && (
          <p
            className="mt-3 text-sm text-muted-foreground"
            data-testid="model-lab-click-hint"
          >
            {clickHintText}
          </p>
        )}
        {!onImageClick && !result && (
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
