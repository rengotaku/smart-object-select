import { useEffect, useState } from "react";
import {
  createHttpSamClient,
  createSamWorkerClient,
  type ExecutionMode,
  type SamDevice,
  type SamProgressEvent,
  type SamWorkerClient,
} from "@/lib/sam";

export type SamEngineStatus = "idle" | "initializing" | "ready" | "error";

export interface UseSamEngineResult {
  status: SamEngineStatus;
  device: SamDevice | null;
  error: Error | null;
  client: SamWorkerClient | null;
  /** モデルダウンロードの進捗。通知が来るまでは null。 */
  progress: SamProgressEvent | null;
}

export interface UseSamEngineOptions {
  /** 実行方式。省略時は "browser"（従来通り Web Worker + SamDevice 検出）。 */
  executionMode?: ExecutionMode;
  /** executionMode が "local-server" のときのローカル推論サーバー URL。 */
  serverUrl?: string;
  /** executionMode が "local-server" のときの選択モデル ID。 */
  modelId?: string;
  /**
   * テストから fake SamWorkerClient を注入するためのフック。
   * 指定時は executionMode に関わらずこのクライアントが使われる。
   * 省略時は executionMode の既定（実 Worker クライアント）が使われる。
   */
  createClient?: () => SamWorkerClient;
}

/**
 * 実 Worker を起動する既定のクライアントファクトリ。
 * Vite の worker import 構文を使うため、テストからは差し替えて
 * jsdom 上で実 Worker を起動しないようにすること（Case 17 前提）。
 */
function createDefaultClient(): SamWorkerClient {
  const worker = new Worker(new URL("../lib/sam/sam.worker.ts", import.meta.url), {
    type: "module",
  });
  return createSamWorkerClient(worker);
}

/**
 * executionMode に応じた実クライアントファクトリを作る。
 * "local-server" では serverUrl/modelId が未選択の場合、同期的に throw して
 * 呼び出し元（effect 内の try/catch）で error 状態に落とし込む。
 */
function resolveClientFactory(options: UseSamEngineOptions): () => SamWorkerClient {
  if (options.createClient) {
    return options.createClient;
  }
  if (options.executionMode === "local-server") {
    const { serverUrl, modelId } = options;
    return () => {
      if (!serverUrl || !modelId) {
        throw new Error("ローカル推論サーバーの URL とモデルを選択してください");
      }
      return createHttpSamClient(serverUrl, modelId);
    };
  }
  return createDefaultClient;
}

/**
 * SAM 推論エンジン（Web Worker または PC ローカル推論サーバー）のライフサイクルを管理する
 * React hook。マウント時に client を生成して init() を実行し、アンマウント時に
 * terminate() する。
 */
export function useSamEngine(options: UseSamEngineOptions = {}): UseSamEngineResult {
  // マウント直後は必ず init() が走り始めるため、初期値をそのまま "initializing"
  // にする（"idle" は型の完全性のために残る値で、この hook 自体は遷移しない）。
  const [status, setStatus] = useState<SamEngineStatus>("initializing");
  const [device, setDevice] = useState<SamDevice | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [client, setClient] = useState<SamWorkerClient | null>(null);
  const [progress, setProgress] = useState<SamProgressEvent | null>(null);

  // options は初回レンダー時点の値だけを使う（マウント/アンマウントの
  // 1回だけ初期化 effect を走らせるための lazy snapshot。以後の再レンダーで
  // options の参照が変わっても再初期化はしない。実行方式を切り替えたい呼び出し側は
  // コンポーネントを key で再マウントすること）。
  const [clientFactory] = useState(() => resolveClientFactory(options));

  useEffect(() => {
    let cancelled = false;

    // clientFactory()（＝実 Worker 生成時の `new Worker(...)`）は CSP 制限や
    // Worker 非対応環境で「同期的に」throw しうる。promise チェーンの外で
    // 起きる同期例外は .catch() に届かず effect からそのまま送出され、
    // error boundary の無いこのアプリではコンポーネントツリーごとクラッシュ
    // する（画面が白くなる）。ここで try/catch して error 状態に落とし込む。
    let instance: SamWorkerClient;
    try {
      instance = clientFactory();
    } catch (err: unknown) {
      // setState はここで同期的に呼ばず、他の分岐（init 失敗時の .catch）と
      // 揃えてマイクロタスクへ逃がす（react-hooks/set-state-in-effect対策。
      // effect body 内での同期 setState 呼び出しはカスケードレンダーを招くため
      // 禁止されている）。
      const syncError = err instanceof Error ? err : new Error(String(err));
      Promise.resolve().then(() => {
        if (cancelled) return;
        setError(syncError);
        setStatus("error");
      });
      return () => {
        cancelled = true;
      };
    }

    // 進捗通知は init() の解決前（モデルダウンロード中）に届くため、init() 呼び出しより
    // 先に subscribe しておく必要がある。
    const unsubscribeProgress = instance.onProgress((event) => {
      if (cancelled) return;
      setProgress(event);
    });

    instance
      .init()
      .then((resolvedDevice) => {
        if (cancelled) return;
        setDevice(resolvedDevice);
        setClient(instance);
        setStatus("ready");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setStatus("error");
      });

    return () => {
      cancelled = true;
      unsubscribeProgress();
      instance.terminate();
    };
  }, [clientFactory]);

  return { status, device, error, client, progress };
}
