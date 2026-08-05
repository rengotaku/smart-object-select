import { useCallback, useRef, useState } from "react";
import {
  SamStaleRequestError,
  type SamImageInput,
  type SamMaskResult,
  type SamWorkerClient,
} from "@/lib/sam";

export interface LoadedImage extends SamImageInput {
  objectUrl: string;
}

export type SegmentationStatus = "idle" | "preparing" | "ready" | "segmenting" | "error";

export interface UseSegmentationResult {
  status: SegmentationStatus;
  image: LoadedImage | null;
  mask: SamMaskResult | null;
  error: Error | null;
  setImage(image: LoadedImage): Promise<void>;
  selectAt(x: number, y: number): Promise<void>;
  reset(): void;
}

export function useSegmentation(client: SamWorkerClient | null): UseSegmentationResult {
  const [status, setStatus] = useState<SegmentationStatus>("idle");
  const [image, setImageState] = useState<LoadedImage | null>(null);
  const [mask, setMask] = useState<SamMaskResult | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const generationRef = useRef<number>(0);
  const statusRef = useRef<SegmentationStatus>("idle");
  const imageRef = useRef<LoadedImage | null>(null);

  const reset = useCallback(() => {
    generationRef.current++;
    if (imageRef.current?.objectUrl) {
      if (typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
        URL.revokeObjectURL(imageRef.current.objectUrl);
      }
    }
    imageRef.current = null;
    statusRef.current = "idle";
    setImageState(null);
    setMask(null);
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

  const selectAt = useCallback(
    async (x: number, y: number): Promise<void> => {
      if (!client) {
        return;
      }

      if (statusRef.current !== "ready") {
        return;
      }

      const currentGen = generationRef.current;
      statusRef.current = "segmenting";
      setStatus("segmenting");

      try {
        const resultMask = await client.segment(x, y);

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

  return {
    status,
    image,
    mask,
    error,
    setImage,
    selectAt,
    reset,
  };
}
