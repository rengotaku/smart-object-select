import { useCallback, useEffect, useRef, useState } from "react";
import {
  SamStaleRequestError,
  type SamImageInput,
  type SamMaskResult,
  type SamWorkerClient,
  type SegmentPoint,
} from "@/lib/sam";

export type { SegmentPoint } from "@/lib/sam";

export interface LoadedImage extends SamImageInput {
  objectUrl: string;
  /** 元ファイル名（拡張子込み）。書き出しファイル名の生成に使う。省略可 */
  sourceName?: string;
}

export interface SavedLayer {
  id: string;
  label: string;
  mask: SamMaskResult;
}

export type SegmentationStatus = "idle" | "preparing" | "ready" | "segmenting" | "error";

export interface UseSegmentationResult {
  status: SegmentationStatus;
  image: LoadedImage | null;
  mask: SamMaskResult | null;
  points: SegmentPoint[];
  layers: SavedLayer[];
  error: Error | null;
  setImage(image: LoadedImage): Promise<void>;
  selectAt(x: number, y: number): Promise<void>;
  addPoint(
    x: number,
    y: number,
    label?: 0 | 1,
    options?: { replace?: boolean }
  ): Promise<void>;
  clearPoints(): void;
  saveLayer(): void;
  removeLayer(id: string): void;
  reset(): void;
}

export function useSegmentation(client: SamWorkerClient | null): UseSegmentationResult {
  const [status, setStatus] = useState<SegmentationStatus>("idle");
  const [image, setImageState] = useState<LoadedImage | null>(null);
  const [mask, setMask] = useState<SamMaskResult | null>(null);
  const [points, setPoints] = useState<SegmentPoint[]>([]);
  const [layers, setLayers] = useState<SavedLayer[]>([]);
  const [error, setError] = useState<Error | null>(null);

  const generationRef = useRef<number>(0);
  const statusRef = useRef<SegmentationStatus>("idle");
  const imageRef = useRef<LoadedImage | null>(null);
  const pointsRef = useRef<SegmentPoint[]>([]);

  useEffect(() => {
    return () => {
      if (imageRef.current?.objectUrl) {
        if (typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
          URL.revokeObjectURL(imageRef.current.objectUrl);
        }
      }
    };
  }, []);

  const clearPoints = useCallback(() => {
    if (statusRef.current === "preparing" || statusRef.current === "idle") {
      return;
    }
    generationRef.current++;
    pointsRef.current = [];
    setPoints([]);
    setMask(null);
    setError(null);
    if (imageRef.current) {
      statusRef.current = "ready";
      setStatus("ready");
    }
  }, []);

  const saveLayer = useCallback(() => {
    if (!mask) {
      return;
    }
    setLayers((prev) => [
      ...prev,
      {
        id:
          typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
            ? crypto.randomUUID()
            : `layer-${Date.now()}-${Math.random()}`,
        label: `レイヤー${prev.length + 1}`,
        mask,
      },
    ]);
    clearPoints();
  }, [mask, clearPoints]);

  const removeLayer = useCallback((id: string) => {
    setLayers((prev) => prev.filter((l) => l.id !== id));
  }, []);

  const reset = useCallback(() => {
    generationRef.current++;
    if (imageRef.current?.objectUrl) {
      if (typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
        URL.revokeObjectURL(imageRef.current.objectUrl);
      }
    }
    imageRef.current = null;
    pointsRef.current = [];
    statusRef.current = "idle";
    setImageState(null);
    setMask(null);
    setPoints([]);
    setLayers([]);
    setError(null);
    setStatus("idle");
  }, []);

  const setImage = useCallback(
    async (newImage: LoadedImage): Promise<void> => {
      const currentGen = ++generationRef.current;

      if (
        imageRef.current?.objectUrl &&
        imageRef.current.objectUrl !== newImage.objectUrl
      ) {
        if (typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
          URL.revokeObjectURL(imageRef.current.objectUrl);
        }
      }

      imageRef.current = newImage;
      setImageState(newImage);
      pointsRef.current = [];
      setPoints([]);
      setMask(null);
      setError(null);
      statusRef.current = "preparing";
      setStatus("preparing");

      if (!client) {
        return;
      }

      try {
        await client.setImage({
          data: newImage.data,
          width: newImage.width,
          height: newImage.height,
        });

        if (generationRef.current === currentGen) {
          statusRef.current = "ready";
          setStatus("ready");
        }
      } catch (err) {
        if (generationRef.current === currentGen) {
          const catchedError = err instanceof Error ? err : new Error(String(err));
          setError(catchedError);
          statusRef.current = "error";
          setStatus("error");
        }
      }
    },
    [client]
  );

  const addPoint = useCallback(
    async (
      x: number,
      y: number,
      label: 0 | 1 = 1,
      options?: { replace?: boolean }
    ): Promise<void> => {
      if (!client) {
        return;
      }

      if (statusRef.current !== "ready") {
        return;
      }

      const replace = options?.replace ?? false;
      const newPoints: SegmentPoint[] = replace
        ? [{ x, y, label }]
        : [...pointsRef.current, { x, y, label }];

      pointsRef.current = newPoints;
      setPoints(newPoints);

      const currentGen = generationRef.current;
      statusRef.current = "segmenting";
      setStatus("segmenting");

      try {
        const resultMask = await client.segmentAtPoints(newPoints);

        if (generationRef.current === currentGen) {
          setMask(resultMask);
          statusRef.current = "ready";
          setStatus("ready");
        }
      } catch (err) {
        const isStale =
          err instanceof SamStaleRequestError ||
          (err instanceof Error && err.name === "SamStaleRequestError");

        if (isStale) {
          if (generationRef.current === currentGen) {
            statusRef.current = "ready";
            setStatus("ready");
          }
        } else {
          if (generationRef.current === currentGen) {
            const catchedError = err instanceof Error ? err : new Error(String(err));
            setError(catchedError);
            statusRef.current = "error";
            setStatus("error");
          }
        }
      }
    },
    [client]
  );

  const selectAt = useCallback(
    async (x: number, y: number): Promise<void> => {
      return addPoint(x, y, 1, { replace: true });
    },
    [addPoint]
  );

  return {
    status,
    image,
    mask,
    points,
    layers,
    error,
    setImage,
    selectAt,
    addPoint,
    clearPoints,
    saveLayer,
    removeLayer,
    reset,
  };
}
