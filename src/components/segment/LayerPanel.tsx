import { useEffect, useRef } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ExportBar } from "./ExportBar";
import {
  applyMaskToImage,
  computeMaskBounds,
  cropRgbaPixels,
} from "@/lib/sam/exportImage";
import type { SamImageInput } from "@/lib/sam";
import type { SavedLayer } from "@/hooks";

export interface LayerPanelProps {
  image: SamImageInput | null;
  layers: SavedLayer[];
  onRemove: (id: string) => void;
  sourceFileName?: string;
}

interface LayerItemProps {
  image: SamImageInput | null;
  layer: SavedLayer;
  onRemove: (id: string) => void;
  sourceFileName?: string;
}

function LayerItem({ image, layer, onRemove, sourceFileName }: LayerItemProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !image) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    try {
      const masked = applyMaskToImage(image, layer.mask);
      const bounds = computeMaskBounds(layer.mask);

      if (!bounds) {
        canvas.width = image.width;
        canvas.height = image.height;
        ctx.clearRect(0, 0, image.width, image.height);
        const imgData = ctx.createImageData(masked.width, masked.height);
        imgData.data.set(masked.data);
        ctx.putImageData(imgData, 0, 0);
      } else {
        const padX = Math.max(4, Math.round(bounds.width * 0.1));
        const padY = Math.max(4, Math.round(bounds.height * 0.1));

        const minX = Math.max(0, bounds.x - padX);
        const minY = Math.max(0, bounds.y - padY);
        const maxX = Math.min(image.width, bounds.x + bounds.width + padX);
        const maxY = Math.min(image.height, bounds.y + bounds.height + padY);

        const cropBounds = {
          x: minX,
          y: minY,
          width: maxX - minX,
          height: maxY - minY,
        };

        const cropped = cropRgbaPixels(masked, cropBounds);

        canvas.width = cropped.width;
        canvas.height = cropped.height;
        ctx.clearRect(0, 0, cropped.width, cropped.height);
        const imgData = ctx.createImageData(cropped.width, cropped.height);
        imgData.data.set(cropped.data);
        ctx.putImageData(imgData, 0, 0);
      }
    } catch {
      // 寸法不一致等のエラー時は描画をスキップ
    }
  }, [image, layer.mask]);

  return (
    <div className="space-y-3 rounded-lg border bg-card p-4 text-card-foreground shadow-sm">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-foreground">{layer.label}</h3>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={() => onRemove(layer.id)}
          aria-label={`${layer.label}を削除`}
        >
          <Trash2 className="mr-1.5 size-4" aria-hidden="true" />
          削除
        </Button>
      </div>

      {image && (
        <div className="flex justify-center rounded-md border bg-muted/30 p-2">
          <canvas
            ref={canvasRef}
            className="max-h-32 max-w-full rounded object-contain"
          />
        </div>
      )}

      <ExportBar image={image} mask={layer.mask} sourceFileName={sourceFileName} />
    </div>
  );
}

export function LayerPanel({ image, layers, onRemove, sourceFileName }: LayerPanelProps) {
  if (!layers || layers.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold tracking-tight">
        保存済みレイヤー ({layers.length})
      </h2>
      <div className="space-y-4">
        {layers.map((layer) => (
          <LayerItem
            key={layer.id}
            image={image}
            layer={layer}
            onRemove={onRemove}
            sourceFileName={sourceFileName}
          />
        ))}
      </div>
    </div>
  );
}
