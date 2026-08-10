import { useCallback, useEffect, useRef } from "react";
import type { MouseEvent } from "react";
import { ImageOff, Loader2 } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import type { LoadedImage } from "@/hooks";
import type { ModelLabMaskOverlay, ModelLabResult } from "@/lib/modelLab";
import { toImageCoords } from "@/lib/sam/coords";
import { maskToOverlayPixels } from "@/lib/sam/maskOverlay";

export interface ModelLabResultViewProps {
  image: LoadedImage | null;
  /**
   * モデルの実行結果。`kind: "mask"` のオーバーレイは overlay canvas に重ね描画する。
   * `kind: "box"`（全自動検出系モデル）の描画は本 sub-issue（#47, MobileSAM統合）の
   * スコープ外で、それを使う後続 sub-issue（YOLO11n-seg/FastSAM, #49/#50）が実装する。
   */
  result?: ModelLabResult | null;
  /**
   * 画像上のクリック位置（元画像のピクセル座標系。0-indexed、画像範囲にクランプ済み）を
   * 通知する。省略時はクリック無効（カーソルも通常表示のまま）。
   */
  onImageClick?: (x: number, y: number) => void;
  /** モデル推論の実行中インジケータを表示するかどうか。実行中はクリックも無視する。 */
  isBusy?: boolean;
}

function isMaskOverlay(
  overlay: ModelLabResult["overlays"][number]
): overlay is ModelLabMaskOverlay {
  return overlay.kind === "mask";
}

/**
 * 画像上へマスク・バウンディングボックスを重ね描画する実行結果表示エリア。
 *
 * - 画像未アップロード: 空状態を表示する
 * - 画像アップロード済み: プレビューを表示する。`onImageClick` が渡されていればクリックで
 *   元画像座標を通知し、`result.overlays` の `kind: "mask"` を overlay canvas に描画する
 */
export function ModelLabResultView({
  image,
  result,
  onImageClick,
  isBusy = false,
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

    const maskOverlays = (result?.overlays ?? []).filter(isMaskOverlay);
    for (const overlay of maskOverlays) {
      const pixels = maskToOverlayPixels(
        {
          data: overlay.data,
          width: overlay.width,
          height: overlay.height,
          score: overlay.score ?? 0,
        },
        { r: 59, g: 130, b: 246, a: 128 }
      );
      const overlayImageData = ctx.createImageData(pixels.width, pixels.height);
      overlayImageData.data.set(pixels.data);

      const offscreen = document.createElement("canvas");
      offscreen.width = pixels.width;
      offscreen.height = pixels.height;
      const offCtx = offscreen.getContext("2d");
      if (offCtx) {
        offCtx.putImageData(overlayImageData, 0, 0);
        ctx.drawImage(offscreen, 0, 0, canvas.width, canvas.height);
      }
    }
  }, [image, result]);

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
            画像をクリックすると、その位置でマスクを推論します
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
