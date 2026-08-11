import { useCallback, useEffect, useRef, useState } from "react";
import {
  createYolo11nSegWorkerClient,
  type Yolo11nSegDetection,
  type Yolo11nSegWorkerClient,
} from "@/lib/modelLab/yolo11nSeg";
import type { SamImageInput } from "@/lib/types";

export type Yolo11nSegStatus = "idle" | "loading" | "detecting" | "ready" | "error";

export interface UseYolo11nSegOptions {
  /**
   * テストから fake Yolo11nSegWorkerClient を注入するためのフック
   * （`useMobileSam.ts` の `createClient` と同じ役割）。
   * 省略時は `yolo11nSeg.worker.ts` を起動する既定のクライアントが使われる。
   */
  createClient?: () => Yolo11nSegWorkerClient;
}

export interface UseYolo11nSegResult {
  status: Yolo11nSegStatus;
  error: Error | null;
  /** 直近の `detect()` で検出された全インスタンス（ボックス+マスク） */
  detections: Yolo11nSegDetection[] | null;
  /**
   * 指定画像に対して全自動検出を実行する（MobileSAM/EdgeSAM の点クリックとは異なり、
   * 画像アップロード時に1回だけ呼ぶ想定。issue #49）。同じ画像で複数回呼んでも
   * 再検出はスキップされる（`ModelLabPage` の useEffect が image 変更のたびに毎回
   * 呼んでも冪等）。
   */
  detect(image: SamImageInput): void;
  /** 検出結果・エラー・状態をクリアする（モデル切り替え・画像差し替え時に使う） */
  reset(): void;
}

/**
 * `useSamEngine.ts`/`useMobileSam.ts` の `createDefaultClient` と同じ理由（Vite の
 * worker import 構文を使うため、テストからは差し替えて jsdom 上で実 Worker を
 * 起動しないようにすること）。
 */
function createDefaultClient(): Yolo11nSegWorkerClient {
  const worker = new Worker(
    new URL("../lib/modelLab/yolo11nSeg/yolo11nSeg.worker.ts", import.meta.url),
    { type: "module" }
  );
  return createYolo11nSegWorkerClient(worker);
}

/**
 * YOLO11n-seg（issue #49, 親 #45）の推論エンジンを React コンポーネントから使うための hook。
 *
 * `useMobileSam`/`useEdgeSam` とは異なり、MobileSAM/EdgeSAM の `segmentAtPoint` に相当する
 * ものは無い。`detect(image)` 1回の呼び出しで画像全体の全インスタンスを一括検出する
 * （全自動検出系モデルのパラダイム。issue #49 スコープ）。
 */
export function useYolo11nSeg(options: UseYolo11nSegOptions = {}): UseYolo11nSegResult {
  const [status, setStatus] = useState<Yolo11nSegStatus>("idle");
  const [error, setError] = useState<Error | null>(null);
  const [detections, setDetections] = useState<Yolo11nSegDetection[] | null>(null);

  // マウント時点の値で固定する（useMobileSam.ts の clientFactory と同じ理由）。
  const [clientFactory] = useState(() => options.createClient ?? createDefaultClient);

  const clientRef = useRef<Yolo11nSegWorkerClient | null>(null);
  const currentImageRef = useRef<SamImageInput | null>(null);
  // 呼び出しごとにインクリメントし、古い非同期処理の結果で状態を上書きしないためのカウンタ
  // （useMobileSam.ts の generation パターンに倣う。detect() は画像アップロードのたびに
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
