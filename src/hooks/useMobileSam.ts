import { useCallback, useEffect, useRef, useState } from "react";
import {
  createMobileSamWorkerClient,
  type MobileSamMaskResult,
  type MobileSamWorkerClient,
} from "@/lib/modelLab/mobileSam";
import type { SamImageInput } from "@/lib/types";

export type MobileSamStatus = "idle" | "loading" | "segmenting" | "ready" | "error";

export interface UseMobileSamOptions {
  /**
   * テストから fake MobileSamWorkerClient を注入するためのフック
   * （`useSamEngine.ts` の `createClient` と同じ役割）。
   * 省略時は `mobileSam.worker.ts` を起動する既定のクライアントが使われる。
   */
  createClient?: () => MobileSamWorkerClient;
}

export interface UseMobileSamResult {
  status: MobileSamStatus;
  error: Error | null;
  mask: MobileSamMaskResult | null;
  /**
   * 指定画像上の点をクリックした結果としてマスクを推論する。
   * Worker（`mobileSam.worker.ts`）は初回呼び出し時に遅延生成する。
   * 画像が前回と異なる場合のみ再エンコードする。
   */
  segmentAtPoint(image: SamImageInput, x: number, y: number): void;
  /** マスク・エラー・状態をクリアする（モデル切り替え・画像差し替え時に使う） */
  reset(): void;
}

/**
 * `useSamEngine.ts` の `createDefaultClient` と同じ理由（Vite の worker import 構文を
 * 使うため、テストからは差し替えて jsdom 上で実 Worker を起動しないようにすること）。
 *
 * onnxruntime-web を main thread から直接呼ぶと、Vite dev server が
 * `public/onnxruntime/*.mjs`（WASM ランタイムの自ホストファイル）への動的 `import()` を
 * 拒否する（実機確認で再現。詳細は mobileSamWorkerClient.ts のコメント参照）。
 * このため MobileSAM の推論は必ず Web Worker（`mobileSam.worker.ts`）上で実行する。
 */
function createDefaultClient(): MobileSamWorkerClient {
  const worker = new Worker(
    new URL("../lib/modelLab/mobileSam/mobileSam.worker.ts", import.meta.url),
    { type: "module" }
  );
  return createMobileSamWorkerClient(worker);
}

/**
 * MobileSAM（issue #47, 親 #45）の推論エンジンを React コンポーネントから使うための hook。
 *
 * `useSamEngine`（`src/lib/sam`）とは完全に独立しており、検証ページ専用の
 * `src/lib/modelLab/mobileSam` にのみ依存する（既存の SAM 実行方式には影響しない）。
 */
export function useMobileSam(options: UseMobileSamOptions = {}): UseMobileSamResult {
  const [status, setStatus] = useState<MobileSamStatus>("idle");
  const [error, setError] = useState<Error | null>(null);
  const [mask, setMask] = useState<MobileSamMaskResult | null>(null);

  // マウント時点の値で固定する（useSamEngine.ts の clientFactory と同じ理由）。
  const [clientFactory] = useState(() => options.createClient ?? createDefaultClient);

  const clientRef = useRef<MobileSamWorkerClient | null>(null);
  const currentImageRef = useRef<SamImageInput | null>(null);
  // 呼び出しごとにインクリメントし、古い非同期処理の結果で状態を上書きしないためのカウンタ
  // （samSession.ts の generation パターンに倣う）。
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
