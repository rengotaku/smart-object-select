import { useCallback, useEffect, useRef, useState } from "react";
import {
  createEdgeSamWorkerClient,
  type EdgeSamMaskResult,
  type EdgeSamWorkerClient,
} from "@/lib/modelLab/edgeSam";
import type { SamImageInput } from "@/lib/sam";

export type EdgeSamStatus = "idle" | "loading" | "segmenting" | "ready" | "error";

export interface UseEdgeSamOptions {
  /**
   * テストから fake EdgeSamWorkerClient を注入するためのフック
   * （`useMobileSam.ts` の `createClient` と同じ役割）。
   * 省略時は `edgeSam.worker.ts` を起動する既定のクライアントが使われる。
   */
  createClient?: () => EdgeSamWorkerClient;
}

export interface UseEdgeSamResult {
  status: EdgeSamStatus;
  error: Error | null;
  mask: EdgeSamMaskResult | null;
  /**
   * 指定画像上の点をクリックした結果としてマスクを推論する。
   * Worker（`edgeSam.worker.ts`）は初回呼び出し時に遅延生成する。
   * 画像が前回と異なる場合のみ再エンコードする。
   */
  segmentAtPoint(image: SamImageInput, x: number, y: number): void;
  /** マスク・エラー・状態をクリアする（モデル切り替え・画像差し替え時に使う） */
  reset(): void;
}

/**
 * `useMobileSam.ts` の `createDefaultClient` と同じ理由（Vite の worker import 構文を
 * 使うため、テストからは差し替えて jsdom 上で実 Worker を起動しないようにすること）。
 *
 * onnxruntime-web を main thread から直接呼ぶと、Vite dev server が
 * `public/onnxruntime/*.mjs`（WASM ランタイムの自ホストファイル）への動的 `import()` を
 * 拒否する（実機確認で再現。詳細は edgeSamWorkerClient.ts のコメント参照）。
 * このため EdgeSAM の推論は必ず Web Worker（`edgeSam.worker.ts`）上で実行する。
 */
function createDefaultClient(): EdgeSamWorkerClient {
  const worker = new Worker(
    new URL("../lib/modelLab/edgeSam/edgeSam.worker.ts", import.meta.url),
    { type: "module" }
  );
  return createEdgeSamWorkerClient(worker);
}

/**
 * EdgeSAM（issue #48, 親 #45）の推論エンジンを React コンポーネントから使うための hook。
 *
 * `useSamEngine`（`src/lib/sam`）とは完全に独立しており、検証ページ専用の
 * `src/lib/modelLab/edgeSam` にのみ依存する（既存の SAM 実行方式には影響しない）。
 * `useMobileSam.ts` と同型（issue #47 の実装パターンを踏襲）。
 */
export function useEdgeSam(options: UseEdgeSamOptions = {}): UseEdgeSamResult {
  const [status, setStatus] = useState<EdgeSamStatus>("idle");
  const [error, setError] = useState<Error | null>(null);
  const [mask, setMask] = useState<EdgeSamMaskResult | null>(null);

  // マウント時点の値で固定する（useMobileSam.ts の clientFactory と同じ理由）。
  const [clientFactory] = useState(() => options.createClient ?? createDefaultClient);

  const clientRef = useRef<EdgeSamWorkerClient | null>(null);
  const currentImageRef = useRef<SamImageInput | null>(null);
  // 呼び出しごとにインクリメントし、古い非同期処理の結果で状態を上書きしないためのカウンタ
  // （session.ts の generation パターンに倣う）。
  const generationRef = useRef(0);

  useEffect(() => {
    return () => {
      generationRef.current += 1;
      clientRef.current?.terminate();
      clientRef.current = null;
    };
  }, []);

  const segmentAtPoint = useCallback(
    (image: SamImageInput, x: number, y: number) => {
      generationRef.current += 1;
      const generation = generationRef.current;

      void (async () => {
        try {
          if (!clientRef.current) {
            setStatus("loading");
            clientRef.current = clientFactory();
          }
          const client = clientRef.current;

          if (currentImageRef.current !== image) {
            setStatus("loading");
            await client.setImage(image);
            if (generation !== generationRef.current) {
              return;
            }
            currentImageRef.current = image;
          }

          setStatus("segmenting");
          const result = await client.segmentAtPoint(x, y);
          if (generation !== generationRef.current) {
            return;
          }

          setMask(result);
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
    setMask(null);
    setError(null);
    setStatus("idle");
  }, []);

  return { status, error, mask, segmentAtPoint, reset };
}
