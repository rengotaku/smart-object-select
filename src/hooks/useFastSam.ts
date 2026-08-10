import { useCallback, useEffect, useRef, useState } from "react";
import {
  createFastSamWorkerClient,
  type FastSamDetection,
  type FastSamWorkerClient,
} from "@/lib/modelLab/fastSam";
import type { SamImageInput } from "@/lib/sam";

export type FastSamStatus = "idle" | "loading" | "detecting" | "ready" | "error";

export interface UseFastSamOptions {
  /**
   * テストから fake FastSamWorkerClient を注入するためのフック
   * （`useYolo11nSeg.ts` の `createClient` と同じ役割）。
   * 省略時は `fastSam.worker.ts` を起動する既定のクライアントが使われる。
   */
  createClient?: () => FastSamWorkerClient;
}

export interface UseFastSamResult {
  status: FastSamStatus;
  error: Error | null;
  /** 直近の `detect()` で検出された全インスタンス（ボックス+マスク） */
  detections: FastSamDetection[] | null;
  /**
   * 指定画像に対して全自動検出を実行する（YOLO11n-seg と同じパラダイム。issue #50）。
   * 画像アップロード時に1回だけ呼ぶ想定。同じ画像で複数回呼んでも再検出はスキップされる
   * （`ModelLabPage` の useEffect が image 変更のたびに毎回呼んでも冪等）。
   */
  detect(image: SamImageInput): void;
  /** 検出結果・エラー・状態をクリアする（モデル切り替え・画像差し替え時に使う） */
  reset(): void;
}

/**
 * `useYolo11nSeg.ts` の `createDefaultClient` と同じ理由（Vite の worker import 構文を
 * 使うため、テストからは差し替えて jsdom 上で実 Worker を起動しないようにすること）。
 */
function createDefaultClient(): FastSamWorkerClient {
  const worker = new Worker(
    new URL("../lib/modelLab/fastSam/fastSam.worker.ts", import.meta.url),
    {
      type: "module",
    }
  );
  return createFastSamWorkerClient(worker);
}

/**
 * FastSAM（issue #50, 親 #45）の推論エンジンを React コンポーネントから使うための hook。
 *
 * `useMobileSam`/`useEdgeSam` とは異なり、`segmentAtPoint` に相当するものは無い。
 * `detect(image)` 1回の呼び出しで画像全体の全インスタンスを一括検出する
 * （`useYolo11nSeg` と同じ全自動検出系モデルのパラダイム。issue #50 スコープ）。
 */
export function useFastSam(options: UseFastSamOptions = {}): UseFastSamResult {
  const [status, setStatus] = useState<FastSamStatus>("idle");
  const [error, setError] = useState<Error | null>(null);
  const [detections, setDetections] = useState<FastSamDetection[] | null>(null);

  // マウント時点の値で固定する（useYolo11nSeg.ts の clientFactory と同じ理由）。
  const [clientFactory] = useState(() => options.createClient ?? createDefaultClient);

  const clientRef = useRef<FastSamWorkerClient | null>(null);
  const currentImageRef = useRef<SamImageInput | null>(null);
  // 呼び出しごとにインクリメントし、古い非同期処理の結果で状態を上書きしないためのカウンタ
  // （useYolo11nSeg.ts の generation パターンに倣う。detect() は画像アップロードのたびに
  // 呼ばれるため、連続アップロード時に古い画像の検出結果が後から届いても state を汚さない）。
  const generationRef = useRef(0);

  useEffect(() => {
    return () => {
      generationRef.current += 1;
      clientRef.current?.terminate();
      clientRef.current = null;
    };
  }, []);

  const detect = useCallback(
    (image: SamImageInput) => {
      if (currentImageRef.current === image) {
        // 同じ画像に対する再検出はスキップする（ModelLabPage の useEffect が
        // モデル切り替え等のたびに毎回呼んでも冪等にするため）。
        return;
      }

      generationRef.current += 1;
      const generation = generationRef.current;
      currentImageRef.current = image;

      void (async () => {
        try {
          if (!clientRef.current) {
            setStatus("loading");
            clientRef.current = clientFactory();
          }
          const client = clientRef.current;

          setStatus("detecting");
          const result = await client.detect(image);
          if (generation !== generationRef.current) {
            return;
          }

          setDetections(result);
          setError(null);
          setStatus("ready");
        } catch (err) {
          if (generation !== generationRef.current) {
            return;
          }
          setError(err instanceof Error ? err : new Error(String(err)));
          setStatus("error");
        }
      })();
    },
    [clientFactory]
  );

  const reset = useCallback(() => {
    generationRef.current += 1;
    currentImageRef.current = null;
    setDetections(null);
    setError(null);
    setStatus("idle");
  }, []);

  return { status, error, detections, detect, reset };
}
