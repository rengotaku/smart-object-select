import { useEffect, useRef } from "react";
import {
  composeMaskOverlayInBounds,
  computeThumbnailOutputSize,
  computeUnionBounds,
} from "@/lib/sam/exportImage";
import type { OverlayColor } from "@/lib/sam/maskOverlay";
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

const OVERLAY_COLOR: OverlayColor = { r: 59, g: 130, b: 246, a: 160 };

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
      const outputSize = computeThumbnailOutputSize(cropBounds);
      const composed = composeMaskOverlayInBounds(
        image,
        candidate,
        cropBounds,
        OVERLAY_COLOR,
        outputSize
      );

      canvas.width = composed.width;
      canvas.height = composed.height;
      ctx.clearRect(0, 0, composed.width, composed.height);
      const imgData = ctx.createImageData(composed.width, composed.height);
      imgData.data.set(composed.data);
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
