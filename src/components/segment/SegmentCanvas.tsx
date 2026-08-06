import React, { useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import type { LoadedImage, SegmentationStatus } from "@/hooks";
import { toImageCoords } from "@/lib/sam/coords";
import { maskToOverlayPixels } from "@/lib/sam/maskOverlay";
import type { SamMaskResult, SegmentPoint } from "@/lib/sam";

export interface SegmentCanvasProps {
  image: LoadedImage | null;
  mask: SamMaskResult | null;
  status: SegmentationStatus;
  points?: SegmentPoint[];
  onPointClick?: (
    x: number,
    y: number,
    label: 0 | 1,
    options: { replace: boolean }
  ) => void;
  onSelect?: (x: number, y: number) => void;
}

export function SegmentCanvas({
  image,
  mask,
  status,
  points = [],
  onPointClick,
  onSelect,
}: SegmentCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !image) return;

    canvas.width = image.width;
    canvas.height = image.height;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, image.width, image.height);

    const imgData = ctx.createImageData(image.width, image.height);
    imgData.data.set(image.data);
    ctx.putImageData(imgData, 0, 0);

    if (mask) {
      const overlay = maskToOverlayPixels(mask, { r: 59, g: 130, b: 246, a: 128 });
      const overlayImageData = ctx.createImageData(overlay.width, overlay.height);
      overlayImageData.data.set(overlay.data);

      const offscreen = document.createElement("canvas");
      offscreen.width = overlay.width;
      offscreen.height = overlay.height;
      const offCtx = offscreen.getContext("2d");
      if (offCtx) {
        offCtx.putImageData(overlayImageData, 0, 0);
        ctx.drawImage(offscreen, 0, 0);
      }
    }

    if (points && points.length > 0) {
      for (const pt of points) {
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 4, 0, 2 * Math.PI);
        ctx.fillStyle = pt.label === 1 ? "#22c55e" : "#ef4444";
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = "#ffffff";
        ctx.stroke();
      }
    }
  }, [image, mask, points]);

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!image || status !== "ready") return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const coords = toImageCoords(e.clientX, e.clientY, rect, {
      width: image.width,
      height: image.height,
    });

    if (coords) {
      let label: 0 | 1 = 1;
      let replace = true;

      if (e.shiftKey) {
        label = 1;
        replace = false;
      } else if (e.altKey) {
        label = 0;
        replace = false;
      } else {
        label = 1;
        replace = true;
      }

      if (onPointClick) {
        onPointClick(coords.x, coords.y, label, { replace });
      }
      if (onSelect) {
        onSelect(coords.x, coords.y);
      }
    }
  };

  if (!image) return null;

  const isPreparing = status === "preparing";
  const isSegmenting = status === "segmenting";

  return (
    <div className="relative flex flex-col items-center justify-center rounded-lg border bg-card p-4 text-card-foreground shadow-sm">
      <div className="relative overflow-hidden rounded-md border">
        <canvas
          ref={canvasRef}
          onClick={handleClick}
          className={`max-h-[70vh] max-w-full object-contain ${
            status === "ready" ? "cursor-crosshair" : "cursor-not-allowed"
          }`}
        />

        {(isPreparing || isSegmenting) && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/60 backdrop-blur-sm">
            <Loader2 className="mb-2 size-8 animate-spin text-primary" />
            <span className="text-sm font-medium text-foreground">
              {isPreparing ? "解析中..." : "領域を抽出中..."}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
