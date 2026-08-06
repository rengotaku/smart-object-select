import { useEffect, useRef } from "react";
import {
  computeUnionBounds,
  cropRgbaPixels,
  type RgbaPixels,
} from "@/lib/sam/exportImage";
import { maskToOverlayPixels } from "@/lib/sam/maskOverlay";
import { cn } from "@/lib/utils";
import type { SamImageInput, SamMaskResult } from "@/lib/sam";

export interface CandidatePickerProps {
  image: SamImageInput | null;
  candidates: SamMaskResult[];
  selectedIndex: number;
  onSelect: (index: number) => void;
}

interface CropBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

const OVERLAY_COLOR = { r: 59, g: 130, b: 246, a: 160 };

/** 元画像にマスクのオーバーレイ色を合成した RGBA を返す（image と candidate の寸法が一致しない場合は throw） */
function composeMaskOverlay(image: SamImageInput, mask: SamMaskResult): RgbaPixels {
  if (image.width !== mask.width || image.height !== mask.height) {
    throw new Error(
      `Image and mask dimensions do not match: image=${image.width}x${image.height}, mask=${mask.width}x${mask.height}`
    );
  }

  const overlay = maskToOverlayPixels(mask, OVERLAY_COLOR);
  const pixelCount = image.width * image.height;
  const data = new Uint8ClampedArray(pixelCount * 4);

  for (let i = 0; i < pixelCount; i++) {
    const offset = i * 4;
    const overlayAlpha = overlay.data[offset + 3] / 255;

    if (overlayAlpha > 0) {
      data[offset] =
        overlay.data[offset] * overlayAlpha + image.data[offset] * (1 - overlayAlpha);
      data[offset + 1] =
        overlay.data[offset + 1] * overlayAlpha +
        image.data[offset + 1] * (1 - overlayAlpha);
      data[offset + 2] =
        overlay.data[offset + 2] * overlayAlpha +
        image.data[offset + 2] * (1 - overlayAlpha);
      data[offset + 3] = 255;
    } else {
      data[offset] = image.data[offset];
      data[offset + 1] = image.data[offset + 1];
      data[offset + 2] = image.data[offset + 2];
      data[offset + 3] = image.data[offset + 3];
    }
  }

  return { data, width: image.width, height: image.height };
}

function computeCropBounds(
  image: SamImageInput,
  candidates: SamMaskResult[]
): CropBounds {
  const unionBounds = computeUnionBounds(candidates);
  if (!unionBounds) {
    return { x: 0, y: 0, width: image.width, height: image.height };
  }

  const padX = Math.max(4, Math.round(unionBounds.width * 0.1));
  const padY = Math.max(4, Math.round(unionBounds.height * 0.1));

  const minX = Math.max(0, unionBounds.x - padX);
  const minY = Math.max(0, unionBounds.y - padY);
  const maxX = Math.min(image.width, unionBounds.x + unionBounds.width + padX);
  const maxY = Math.min(image.height, unionBounds.y + unionBounds.height + padY);

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

interface CandidateItemProps {
  image: SamImageInput;
  candidate: SamMaskResult;
  index: number;
  isSelected: boolean;
  cropBounds: CropBounds;
  onSelect: (index: number) => void;
}

function CandidateItem({
  image,
  candidate,
  index,
  isSelected,
  cropBounds,
  onSelect,
}: CandidateItemProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    try {
      const composed = composeMaskOverlay(image, candidate);
      const cropped = cropRgbaPixels(composed, cropBounds);

      canvas.width = cropped.width;
      canvas.height = cropped.height;
      ctx.clearRect(0, 0, cropped.width, cropped.height);
      const imgData = ctx.createImageData(cropped.width, cropped.height);
      imgData.data.set(cropped.data);
      ctx.putImageData(imgData, 0, 0);
    } catch {
      // 寸法不一致等のエラー時は描画をスキップ
    }
  }, [image, candidate, cropBounds]);

  return (
    <button
      type="button"
      onClick={() => onSelect(index)}
      aria-pressed={isSelected}
      className={cn(
        "flex flex-col items-center gap-1.5 rounded-lg border-2 bg-card p-2 text-card-foreground shadow-sm transition-colors",
        isSelected
          ? "border-primary"
          : "border-transparent hover:border-muted-foreground/30"
      )}
    >
      <canvas ref={canvasRef} className="max-h-32 max-w-full rounded object-contain" />
      <span className="text-xs font-medium text-muted-foreground">
        スコア {candidate.score.toFixed(2)}
      </span>
    </button>
  );
}

export function CandidatePicker({
  image,
  candidates,
  selectedIndex,
  onSelect,
}: CandidatePickerProps) {
  if (!image || candidates.length <= 1) {
    return null;
  }

  const cropBounds = computeCropBounds(image, candidates);

  return (
    <div className="space-y-3 rounded-lg border bg-card p-4 text-card-foreground shadow-sm">
      <h2 className="text-sm font-semibold tracking-tight">候補 ({candidates.length})</h2>
      <div className="flex flex-wrap gap-3">
        {candidates.map((candidate, index) => (
          <CandidateItem
            key={index}
            image={image}
            candidate={candidate}
            index={index}
            isSelected={index === selectedIndex}
            cropBounds={cropBounds}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
}
