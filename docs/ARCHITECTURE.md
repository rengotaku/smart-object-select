# アーキテクチャ

このドキュメントは「どこを触れば何が変わるか」の地図。この機能を初めて触る開発者（人間または AI）向けに、実装（`src/`）と決定の記録（`docs/adr/`, GitHub issue #1）を突き合わせて書いている。事実は実装を読んで確認したものだけを書き、断定できない点は「未確認」と明記する。

## 1. このリポジトリは何か

Photoshop の「オブジェクト選択ツール」相当をブラウザだけで実現する React SPA。画像をアップロードして任意の位置をクリックすると、その位置のオブジェクトが SAM（Segment Anything Model、実際には軽量蒸留版の SlimSAM）で自動的にマスク選択され、PNG 透過切り抜き等で書き出せる。

- **バックエンドが無い**。推論・画像処理はすべてブラウザ内で完結する（サーバーへ画像もクリック座標も送らない）
- `my-boilerplate` の `react-spa` テンプレートから scaffold されている。テンプレート付属のサンプル（`HomePage`/`LoginPage`/`UsersPage` とその依存一式の認証・ユーザー一覧デモ機能）は削除済みで、アプリは `/segment` 単一構成（issue [#30](https://github.com/rengotaku/smart-object-select/issues/30)）。**この機能のエントリポイントは `/segment` ルート**（`src/App.tsx` の `<Route path="segment" element={<SegmentPage />} />`、`/` はそこへ redirect する）
- モデル（`Xenova/slimsam-77-uniform`、`src/lib/sam/constants.ts` の `SAM_MODEL_ID`、Apache-2.0）と推論ランタイムの WASM（onnxruntime-web、MIT）は `public/models/slimsam-77-uniform/` / `public/onnxruntime/` に自前ホスティングしている。`transformersLoader.ts` が `env.allowRemoteModels = false` 等を設定しており、初回アクセス以降 Hugging Face Hub / jsDelivr など外部サービスへは一切依存しない（`docs/adr/0005-offline-first-model-delivery.md`）
- Service Worker（`public/sw.js`）がモデルアセットとアプリ本体を Cache Storage に事前キャッシュしており、2回目以降はオフラインでも `/segment` が動作する（§3・§7）
- 初回モデルロード中はファイル単位のダウンロード進捗を Worker → メインスレッドの通知チャネル（既存の id 相関 request/response とは別経路、§4）で `SegmentPage` に表示する
- 推論ランタイムは `@huggingface/transformers`（旧 transformers.js、`package.json` では `^4.2.0`）。実行デバイスは WebGPU を優先し、無ければ WASM にフォールバックする

設計判断の経緯は GitHub issue [#1](https://github.com/rengotaku/smart-object-select/issues/1) の Decision Log と、`docs/adr/0001-client-side-sam-in-web-worker.md` / `docs/adr/0002-generation-guards-for-async-races.md` に記録されている。本ドキュメントはそれらの要点を「触るファイル」に接続する形でまとめ直したもの。

## 2. 全体像: データフローとレイヤー境界

アップロードから書き出しまでの流れ（`==` で挟んだ区間が Web Worker との境界、詳細は §4）。

```
[ファイル選択 / ドロップ]                         components/segment/ImageDropzone.tsx
        │ File
        ▼
  fileToLoadedImage()                             lib/sam/imageLoader.ts
        │ RGBA (Uint8ClampedArray) + width/height + objectUrl
        ▼
  useSegmentation.setImage()                       hooks/useSegmentation.ts
        │ client.setImage({ data, width, height })
        ▼
  ================== Web Worker 境界 ==================
  samWorkerClient (main側) → postMessage                lib/sam/samWorkerClient.ts
        │
  self.onmessage → samWorkerHandler.handle()             lib/sam/sam.worker.ts, samWorkerHandler.ts
        │
  samSession.setImage()                                  lib/sam/samSession.ts
        │  processor.process(image) → model.getImageEmbeddings(inputs)
        ▼
  embedding をセッション内にキャッシュ（世代ガード付き、§5）
  ================== Web Worker 境界 ==================
        │
        ▼
  [ユーザーが Canvas をクリック / Shift・Alt+クリック]  components/segment/SegmentCanvas.tsx
        │ clientX/clientY → toImageCoords() → 画像座標 (x, y)   lib/sam/coords.ts
        │ 修飾キー無し=replace / Shift=positive追加 / Alt=negative追加
        ▼
  useSegmentation.addPoint(x, y, label, { replace })  hooks/useSegmentation.ts
        │ client.segmentAtPoints(points)   ※ points は現在の点セット全体（世代スナップショット）
        ▼
  ================== Web Worker 境界 ==================
        │
  samSession.segmentAtPoints(points)                      lib/sam/samSession.ts
        │  reshapeInputPoints + addInputLabels → model.decode() → postProcessMasks()
        │  → binarizeMask() + pickBestMaskIndex()
        ▼
  SamMaskResult { data, width, height, score }
  ================== Web Worker 境界 ==================
        │ postMessage(result)
        ▼
  useSegmentation の mask state 更新
        │
        ├─► SegmentCanvas: maskToOverlayPixels() で半透明オーバーレイを描画   lib/sam/maskOverlay.ts
        │
        └─► ExportBar: 書き出しボタン                     components/segment/ExportBar.tsx
                ├─ applyMaskToImage()  → 透過切り抜き PNG          lib/sam/exportImage.ts
                ├─ maskToBlackAndWhite() → マスク画像（白黒PNG）    lib/sam/exportImage.ts
                └─ pixelsToPngBlob() → triggerDownload() / copyImageToClipboard()  lib/sam/download.ts

[「レイヤーとして保存」ボタン]                    useSegmentation.saveLayer()
        │ 現在の mask を SavedLayer として layers 配列へ追加 → clearPoints() を呼び選択を自動クリア
        ▼
  LayerPanel: 保存済みレイヤー一覧                 components/segment/LayerPanel.tsx
        ├─ computeMaskBounds() + cropRgbaPixels() でサムネイルをマスク領域にクロップ表示   lib/sam/exportImage.ts
        └─ レイヤーごとに ExportBar をそのまま埋め込み個別書き出し（コンポーネント自体は無改変）
```

embedding の計算（encoder）は画像 1 枚につき 1 回だけ。クリックのたびに走るのは decoder（`segmentAtPoints`）だけで、encoder より軽い。この非対称性が Worker 必須化（§4）の前提になっている。

`segmentAtPoint(x, y)`（単一点）も後方互換のため残っており、`useSegmentation.selectAt` は `addPoint(x, y, 1, { replace: true })` の薄いラッパーとして実装されている（`segmentAtPoint` 自体は現在どこからも呼ばれていないが、外部から見た挙動は変えない前提で API として維持）。

## 3. レイヤーと責務

`src/lib/sam/` が推論コアと書き出しの本体。責務ごとにファイルが分かれており、依存の向きが片方向になるよう意図的に制約されている。

**表1: `src/lib/sam/` の各モジュールの責務と依存**

| ファイル                | 役割                                                                                                                                                                                                                                    | 依存してよいもの                                                                                      | 依存してはいけないもの                          |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `types.ts`              | `SamImageInput` / `SamMaskResult` の型定義                                                                                                                                                                                              | なし                                                                                                  | —                                               |
| `constants.ts`          | `SAM_MODEL_ID`                                                                                                                                                                                                                          | なし                                                                                                  | —                                               |
| `protocol.ts`           | Worker⇄main 間のメッセージ型（`SamWorkerRequest` / `SamWorkerResponse`）に加え、id 非依存の一方向通知型（`SamWorkerNotification` / `SamProgressEvent`、モデルロード進捗用）                                                            | `types.ts`                                                                                            | `@huggingface/transformers`                     |
| `device.ts`             | WebGPU 検出（`detectDevice`）                                                                                                                                                                                                           | `navigator.gpu`（DI 可能）                                                                            | `@huggingface/transformers`                     |
| `samSession.ts`         | 推論のコアロジック本体。`setImage` / `segmentAtPoint`（単一点・互換用） / `segmentAtPoints`（複数点、positive/negative ラベル対応）、世代ガード（§5、両メソッド共通の `runDecode` helper に集約）、`binarizeMask` / `pickBestMaskIndex` | `device.ts` の型、`types.ts`、**`SamRuntime` インターフェース経由でのみ**モデル/プロセッサを扱う      | `@huggingface/transformers`（直接 import 禁止） |
| `imageInputs.ts`        | processor の生出力（snake_case）を `SamImageInputs`（camelCase）へ正規化                                                                                                                                                                | `samSession.ts` の型のみ                                                                              | `@huggingface/transformers`                     |
| `transformersLoader.ts` | `@huggingface/transformers` を実際に呼び出し、`SamRuntime` を実装するアダプタ。モジュールロード時に `env.allowRemoteModels = false` / `env.localModelPath` / `env.backends.onnx.wasm.wasmPaths` を自ホストパスへ設定し、`createTransformersSamRuntime(onProgress)` が `progress_callback` のファイル単位イベントを `loadModel()`/`loadProcessor()` をまたいで自前集計する（§4、ADR 0005） | `@huggingface/transformers`、`constants.ts`、`device.ts` の型、`samSession.ts` の型、`imageInputs.ts`、`protocol.ts` の `SamProgressEvent`、`wasmRuntimePaths.ts` | —                                               |
| `samWorkerHandler.ts`   | Worker が受けたリクエストを `samSession` の呼び出しへルーティング                                                                                                                                                                       | `device.ts`、`samSession.ts`、`protocol.ts`                                                           | `@huggingface/transformers`                     |
| `sam.worker.ts`         | Worker エントリポイント。`self.onmessage` を `samWorkerHandler` に配線するほか、`createTransformersSamRuntime` に progress コールバックを渡し、進捗を `SamWorkerNotification` として `samWorkerHandler` を経由せず直接 `self.postMessage` する（§4） | `samWorkerHandler.ts`、`transformersLoader.ts`、`protocol.ts`                                         | —                                               |
| `samWorkerClient.ts`    | main 側から Worker へ Promise ベースで問い合わせる API（id 相関・障害検知）に加え、`onProgress(listener): unsubscribe` で進捗通知を購読できる                                                                                          | `protocol.ts`、`device.ts` の型、`types.ts`                                                           | `@huggingface/transformers`                     |
| `executionMode.ts`      | 実行方式の型定義（`ExecutionMode = "browser" \| "local-server"`、issue [#33](https://github.com/rengotaku/smart-object-select/issues/33)）。`device.ts` の `SamDevice`（ブラウザ内デバイス）とは別軸の概念                            | なし                                                                                                  | —                                               |
| `httpSamClient.ts`      | PC ローカル推論サーバー（issue [#32](https://github.com/rengotaku/smart-object-select/issues/32)、`server/`）を HTTP 経由で呼び出す `SamWorkerClient` 実装（`createHttpSamClient(baseUrl, modelId)`）。推論はサーバー側で行われるため Worker を経由しない。`init()` は `GET /health` → `GET /models` で疎通確認とモデル一覧取得を行い、`setImage()`/`segmentAtPoints()` は `POST /sessions` → `POST /sessions/:id/segment` をセッションID経由で呼び出す（issue #33 コメント「設計方針の補足」） | `device.ts` の型、`samSession.ts` の `SamNoImageError`、`samWorkerClient.ts` の `SamWorkerClient` 型、`types.ts` | Web Worker、`@huggingface/transformers`         |
| `coords.ts`             | Canvas クリック座標 → 画像座標変換（`toImageCoords`）                                                                                                                                                                                   | なし（純関数）                                                                                        | —                                               |
| `maskOverlay.ts`        | マスク → オーバーレイ表示用 RGBA 変換（`maskToOverlayPixels`）                                                                                                                                                                          | `types.ts`                                                                                            | —                                               |
| `exportImage.ts`        | マスク適用（`applyMaskToImage`）/ 白黒化（`maskToBlackAndWhite`）/ マスクのバウンディングボックス算出（`computeMaskBounds`）・RGBA 切り出し（`cropRgbaPixels`、`LayerPanel` のサムネイル用）                                            | `types.ts`                                                                                            | —                                               |
| `download.ts`           | RGBA → PNG Blob 化、ダウンロード、クリップボードコピー、ファイル名生成                                                                                                                                                                  | `exportImage.ts` の型のみ                                                                             | —                                               |
| `imageLoader.ts`        | アップロードされた `File` を DOM `Image`/`Canvas` で RGBA 化                                                                                                                                                                            | `hooks/useSegmentation.ts` の `LoadedImage` 型                                                        | —                                               |

### `@huggingface/transformers` への依存を `transformersLoader.ts` 1 ファイルに封じ込めている理由

実パッケージへの `import` は `transformersLoader.ts` にしか存在しない。他のすべて（`samSession.ts` を含む）は `SamRuntime` / `SamModelLike` / `SamProcessorLike`（`samSession.ts` で定義）という自前インターフェース越しにモデル/プロセッサを扱う。

これにより:

- 推論ロジック（`samSession.ts`）のテストは**モデル実体を一切ダウンロードせず**、fake な `SamRuntime` を注入して行える（`samSession.test.ts` 参照）。CI で実モデルを取得すると遅く不安定になる（ADR 0001 の「壊すと危ない前提」）
- モデルを差し替える場合、`SamRuntime` インターフェースを満たす別実装を書けば `samSession.ts` 以降には影響しない（§6 の対応表参照）

`vitest.config.ts` の coverage 設定でも `transformersLoader.ts` は明示的に除外されている（§7）。これは「テストしなくていい」のではなく、「このファイルだけは実パッケージ結合なので単体テストの対象外とし、`samSession.ts` 側のテストで裏を取る」という設計判断。

### `src/lib/serviceWorker/` と `public/sw.js`（モデル資産のオフラインキャッシュ）

`src/lib/sam/` の外に、Service Worker 関連のファイルがもう1層ある（`docs/adr/0005-offline-first-model-delivery.md` 参照）。

- `src/lib/serviceWorker/cachePolicy.ts` — キャッシュ対象パス判定（`isCacheableAssetPath`）・アプリシェルキャッシュ除外判定（`isExcludedFromAppShellCache`、`/api/**` 除外）・キャッシュ名生成（`buildCacheName`）・モデル/WASM の固定アセットパス一覧（`buildModelAssetPaths` / `WASM_RUNTIME_ASSET_PATHS`）・Worker チャンク URL 抽出（`extractWorkerChunkUrls`）を**純粋関数として**実装し、vitest でユニットテストされている
- `public/sw.js` — 実際に `self` / `caches` を使う Service Worker 本体（fetch handler・install/activate）。`public/` は Vite の変換対象外で TypeScript を import できないため、`cachePolicy.ts` と**同一のロジックを手動で複製**したプレーン JS になっている。`self`/`caches` に依存し jsdom では実行できないため、fetch handler 自体はユニットテストの対象外（実ブラウザでの DoD 確認で担保。§6）
- モデルアセット（`/models/**`）と onnxruntime-web の WASM（`/onnxruntime/**`）は Cache First、アプリ本体（ナビゲーション・JS/CSS）は Network First。`install` イベント時に (1) `index.html` が参照するアセット (2) メインバンドルを走査して動的発見した Worker チャンク URL (3) モデル/WASM の固定パス、の3種類をすべて事前キャッシュする（SW が制御を確立する前に発行された初回リクエストを取りこぼさないため。ADR 0005「3. Service Worker キャッシュ」参照）
- `src/main.tsx` の `registerServiceWorker()` が `navigator.serviceWorker.register("/sw.js")` を行う。未対応環境・登録失敗は `try/catch` で握りアプリ本体の起動は妨げない

**壊すと危ない前提**: `public/sw.js` と `src/lib/serviceWorker/cachePolicy.ts` はロジックを手動同期している。片方だけ変更すると齟齬が生じるため、キャッシュ対象パス・パスプレフィックス・固定アセット一覧を変える場合は**両ファイルを同時に更新**すること（ADR 0005「変えてよい前提 / 壊すと危ない前提」）。

## 4. Web Worker の境界

Worker とのやり取りは `protocol.ts` の判別可能ユニオン型で固定されている。

```ts
// lib/sam/protocol.ts
type SamWorkerRequest =
  | { id: string; type: "init" }
  | { id: string; type: "setImage"; image: SamImageInput }
  | { id: string; type: "segment"; x: number; y: number };

type SamWorkerResponse =
  | { id: string; type: "result"; payload: unknown }
  | { id: string; type: "error"; name: string; message: string };

// id 相関の request/response とは別種、id を持たない一方向通知。
// モデルロード進捗（モデルの自前ホスティング後もダウンロードは発生するため引き続き必要）
interface SamProgressEvent {
  file: string;
  loaded: number;
  total: number | null; // ファイルサイズ不明時は null
}
type SamWorkerNotification = { type: "progress" } & SamProgressEvent;
```

- **main → worker**: `samWorkerClient.ts` がリクエストごとに `id`（`sam-req-<連番>`）を発行し、`pending: Map<id, {resolve, reject}>` で紐づけて `postMessage`
- **worker → main**: `sam.worker.ts` の `self.onmessage` が `samWorkerHandler.handle()` を呼び、結果を同じ `id` を付けて `postMessage` で返す
- `samWorkerHandler.handle()` は `switch (request.type)` で `init` → `detectDevice()` + `createSamSession()`、`setImage` → `session.setImage()`、`segment` → `session.segmentAtPoint()`、`segmentPoints` → `session.segmentAtPoints()` にルーティングし、例外は `try/catch` で `{ type: "error" }` に変換して返す（Worker 側で投げっぱなしにしない）

### モデルロード進捗の通知チャネル（id 非依存、request/response とは別経路）

`init` リクエストの内部でモデル/プロセッサをダウンロードする間、`SamWorkerNotification`（`type: "progress"`）が id 相関の `SamWorkerResponse` とは**別の経路**で main へ流れる。issue #21 の注意点（「既存の `SamWorkerResponse` に混ぜると相関ロジックを壊しかねない」）を踏まえた設計。

- **worker 側**: `sam.worker.ts` が `createTransformersSamRuntime(postProgress)` という形で progress コールバックを直接渡す。`transformersLoader.ts` は `loadModel()`/`loadProcessor()` 双方の `progress_callback` のファイル単位イベント（`status === "progress"`）を、両呼び出しをまたぐ `Map<file, {loaded,total}>` で自前集計してから `postProgress()` を呼ぶ（ライブラリが提供する集約値 `progress_total` は `from_pretrained()` 呼び出し単位でリセットされ、model→processor 間で後退するため不採用。ADR 0005 参照）。`postProgress()` は `samWorkerHandler` を経由せず `self.postMessage(notification)` を直接呼ぶ
- **main 側**: `samWorkerClient.ts` の `onMessage` は、受信データが `id` を持たず `type === "progress"` であれば `isProgressNotification()` で判別し、`pending` map を一切参照せず `progressListeners`（`onProgress(listener)` で購読された Set）へ直接ディスパッチする。id 相関の request/response（`segment`/`segmentAtPoints` 等）の解決ロジックとは完全に独立しており、progress 通知が pending な request を誤って resolve/reject することはない
- `useSamEngine.ts` が `client.onProgress()` で購読し `progress` state を保持、`SegmentPage.tsx` が `progress.total` が非 `null` なら `Math.round(loaded/total*100)` で `%` を表示し、`total` が不明（`null`）な場合は「読み込み中」とだけ表示するフォールバックを持つ

### Worker が必須な理由

WASM フォールバック（device.ts が WebGPU 非対応時に返す）を採用した時点で、encoder をメインスレッドで実行すると **UI が数十秒フリーズ**する（ADR 0001）。フォールバックを機能させるには推論を別スレッドに逃がすしかない。「WebGPU があるときだけ Worker を使う」という条件分岐は、遅い側の環境でこそ Worker が必要という関係と逆になるため、**常に** Worker 上で推論する設計になっている。

### Worker 障害時のフェイルセーフ（`samWorkerClient.ts`）

Worker のモジュール読み込み失敗・モデル初期化中のクラッシュ・OOM 等では `"message"` イベントが一切発火せず、`"error"`（DOM `ErrorEvent`）または `"messageerror"`（構造化クローン失敗）だけが届く。これを無視すると pending な request が永久に resolve/reject されず、呼び出し元は「読み込み中」のままハングする。

`samWorkerClient.ts` は `error` / `messageerror` を一度でも受信するとクライアントを**失敗状態として保持**し（`terminalError`）、以後の `send()` は Worker へ `postMessage` せず即座に reject する。`terminate()` 後も同様。これは「Worker がリクエストの合間（pending が空）でクラッシュした後に発行された新しいリクエストが応答なく永久 pending になる」ケースを塞ぐための設計（コード中コメント参照）。

## 5. 非同期の競合ガード（世代カウンタ）

この機能は待つ処理だらけで、しかも待っている間もユーザーが次の操作をできる。何も対策しないと**後から完了した古い処理が最新の状態を上書き**する。このクラスの不具合は例外が出ず、型としては正しい古い結果がそのまま表示されるため、実装を読んだだけでは意図が分かりにくい。壊すと**エラーが出ないまま誤ったマスクや誤った画像が表示される**（ADR 0002）。

世代カウンタは独立した層に分かれて存在し、大きく2種類に分類できる。

**表2: 世代カウンタの配置**

| 種類                                       | 場所                                                            | 守っているもの                                                                                                                                                                                                                                                                                                                                                                                                                                               | 破棄の方法                                         |
| ------------------------------------------ | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| **embedding の世代**（Worker 側）          | `samSession.ts` の `generation` / `currentEmbeddingsGeneration` | 保持している embedding が最新の `setImage` 呼び出しに属するか。`segmentAtPoint` 内の**すべての await 明け**（`decode()` 後、`postProcessMasks()` 後）で `embeddingGeneration !== generation` を確認し、不一致なら `SamStaleRequestError` を throw して内部状態を上書きしない                                                                                                                                                                                 | `SamStaleRequestError`                             |
| **デコードの世代**（main 側・画像/マスク） | `useSegmentation.ts` の `generationRef`                         | 表示中のマスクがどの画像/どの選択に対応するか。`setImage` の完了時・`addPoint` の完了時に `generationRef.current === currentGen` を確認してから state を更新する。`SamStaleRequestError` を受けたときはエラー扱いにせず黙って `ready` へ戻す。`clearPoints` も世代を進めるが、`status` が `preparing`/`idle` の間は何もしない（`setImage` 準備中に呼ばれても画面が復旧不能なエラー状態にならないようにするため。issue #9 で codex レビューにより発見・修正） | 黙って state 更新をスキップ                        |
| **デコードの世代**（main 側・ファイル）    | `ImageDropzone.tsx` の `generationRef`                          | アップロードされたファイルの `fileToLoadedImage()`（DOM Image デコード）の結果がどの選択に属するか。アンマウント時にも世代を進める                                                                                                                                                                                                                                                                                                                           | 黙って `onImageLoaded` を呼ばず `objectUrl` を解放 |

判定の基準は「最新のリクエスト世代」ではなく「**保持しているデータが属する世代**」であることが重要（ADR 0002）。前者では `setImage` の**準備中**（世代は進んでいるが embedding はまだ古い画像のまま）を検出できず、新しい画像の座標に対して古い画像の embedding で推論してしまう。`samSession.ts` が `generation`（最新の setImage 世代）と `currentEmbeddingsGeneration`（保持中の embedding の世代）を別変数として持っているのはこのため。

チェックは await のたびに入っている。`decode()` の後だけでは、その後の `postProcessMasks()`（画像サイズへの補間を含む非同期処理）の間に起きた差し替えをすり抜けるため。

テストはタイミングを `setTimeout` 等に頼らず、手動で resolve/reject できる deferred promise で「開始 → 入力を変更 → 解決」の順を決定的に駆動する（`samSession.test.ts` 冒頭の `deferred()`、`useSegmentation.test.tsx` の `createDeferred()`）。`setTimeout` ベースにすると実行順が処理系依存になり flaky になるため、これは明示的に禁止されている（ADR 0002「壊すと危ない前提」）。

## 6. テスト戦略

### 純関数とアダプタの分離

`coords.ts` / `maskOverlay.ts` / `exportImage.ts` / `device.ts` / `imageInputs.ts` は外部依存を持たない純関数、または DI で差し替え可能なアダプタ（`download.ts` の `CanvasFactory` / `ClipboardLike`、`samSession.ts` の `SamRuntime`）として書かれている。これにより jsdom 環境でも実ブラウザ API・実モデルを必要とせずテストできる。§3 の「`transformersLoader.ts` に封じ込める」設計もこの分離の一部。`src/lib/serviceWorker/cachePolicy.ts`（§3）も同じ方針で、`self`/`caches` に依存する Service Worker 本体（`public/sw.js`）からロジックだけを純関数として切り出しユニットテストしている。

### coverage から除外している4ファイル（`vitest.config.ts`）

**表3: coverage 除外ファイルと理由**

| ファイル                            | 除外理由                                                                                                                                                                                                                             |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/components/ui/time-picker.tsx` | `shared-react-ui` 由来の共有 UI プリミティブ。SAM 機能とは無関係で、compose 時に無条件で入る。カバレッジ担保は `shared-react-ui` 側のギャラリーで行う方針                                                                            |
| `src/lib/sam/sam.worker.ts`         | `self.onmessage` を handler に繋ぎ、progress コールバックを `transformersLoader.ts` に配線する Worker エントリポイント。jsdom には実 Worker ランタイムが無く実行できない。ルーティングされる先のロジック（`samWorkerHandler.ts`）は直接ユニットテストされている            |
| `src/lib/sam/transformersLoader.ts` | `@huggingface/transformers` の薄いアダプタ。実パッケージをテストで import するとモデル重みを引いてきて CI が遅く flaky になる。`samSession.ts` は fake `SamRuntime` でテストされるため、このアダプタ自体には専用ユニットテストが無い |
| `src/lib/sam/imageLoader.ts`        | `File` → RGBA `ImageData` の変換に DOM `Image` デコードと Canvas 2D コンテキストを使うが、jsdom はこれらをサポートしない。`isImageFile` は別途ユニットテスト済み                                                                     |

### 「実装を一時的に壊して赤くなることを確認する」運用

issue [#2 完了コメント](https://github.com/rengotaku/smart-object-select/issues/1) に記録されている通り、SAM 推論コア実装の codex レビューで **fake runtime によるテストが緑のまま検知できない silent failure が 6 件**見つかった（processor の命名不一致でセグメンテーションが常に失敗する／画像差し替え直後のクリックで前の画像のマスクが出る／worker 障害で「読み込み中」のまま無限ハングする、等）。実装とテストを同じ視点・同じタイミングで書くと、両方が同じ盲点を持ち、テストが「実装が間違っていても通る」空虚なものになってしまう。

これを踏まえた運用が `docs/adr/0003-verify-tests-fail-before-fixing.md` に記録されている。**新しく書いたテストは、対象の実装を一時的に壊すと実際に赤くなることを確認してから採用する**（確認結果は完了報告に残す）。赤にならないテストは検証手段として機能していないので、期待値を緩めるのではなくテストの設計をやり直す。

TDD の「先に赤を見る」と目的は同じだが、**修正系のタスクでは実装が既に存在するため通常の TDD だけでは赤を経由しない**。そこを補う運用として明示されている。背景には jsdom の性質があり、未実装の API がエラーではなく「何もしない」挙動になるため、**修正の有無にかかわらず通るテスト**が混入しうる（実例: `fireEvent.change` は input の `value` を設定しない、`getBoundingClientRect` は常に全ゼロを返す）。

`samSession.test.ts` や `useSegmentation.test.tsx` 等の一部テストに付いている `Case N: 🔴 ...` という命名（例: `SegmentCanvas.test.tsx` の `Case 14`、`useSegmentation.test.tsx` の `Case 7` / `Case 10`）は、**壊すと silent failure が復活する重要ケース**の目印。ただし絵文字表記そのものを定義した記述はドキュメント上に無いため、規約としての厳密な意味は**未確認**。

そのほか確認できる事実:

- 世代ガードの回帰テスト（`Case 9` / `Case 10` / `Case 18` / `Case 19` / `Case 20` 等）は、上記の silent failure 検出を受けて追加されたこと（ADR 0002「関連」節）
- 世代ガード系のテストは deferred promise で競合を決定的に駆動しており、`setTimeout` を使うテストへの書き換えは ADR 0002 で明示的に禁止されていること

## 7. どこを触れば何が変わるか

**表4: 典型的な変更と触るファイル**

| やりたいこと                                                                           | 触るファイル                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| モデルを変える                                                                         | `src/lib/sam/constants.ts`（`SAM_MODEL_ID`）。`SamRuntime` / `SamModelLike` / `SamProcessorLike`（`src/lib/sam/samSession.ts`）を満たす限り、`transformersLoader.ts` 側の実装だけで差し替えが完結する。**自前ホスティングしているため**、新しい `public/models/<新ID>/`（量子化ファイル一式 + `NOTICE`）を追加し、`src/lib/serviceWorker/cachePolicy.ts` の `MODEL_ASSET_PATH_SUFFIXES` と `public/sw.js` の `MODEL_ID`/同配列を両方更新すること（更新を忘れると SW が新モデルをキャッシュしない） |
| モデル/WASM の自前ホスト資産を更新する                                                 | `public/models/<SAM_MODEL_ID>/`（量子化 onnx 2件 + config系2件 + `NOTICE`）、`public/onnxruntime/`（onnxruntime-web の WASM 一式、`node_modules/onnxruntime-web/dist/` からコピー）。`src/lib/sam/transformersLoader.ts` の `env` 設定・`wasmRuntimePaths.ts` の参照先パスと整合させること                                                                                                                                                                                          |
| Service Worker のキャッシュ対象・戦略（Cache First/Network First、事前キャッシュ対象）を変える | `public/sw.js`（fetch/install/activate 本体）＋ `src/lib/serviceWorker/cachePolicy.ts`（パス判定・キャッシュ名生成等の純粋関数、ユニットテスト対象）。**両ファイルはロジックを手動同期する設計**なので必ず両方を更新し、`CACHE_VERSION` を上げて旧キャッシュを破棄させること（ADR 0005）                                                                                                                                                                                             |
| モデルロード進捗の表示・集計方法を変える                                               | `src/lib/sam/transformersLoader.ts`（`createProgressCallback` の自前集計ロジック）、`src/lib/sam/protocol.ts`（`SamProgressEvent`/`SamWorkerNotification`）、`src/lib/sam/samWorkerClient.ts`（`onProgress`）、`src/hooks/useSamEngine.ts`（`progress` state）、`src/pages/SegmentPage.tsx`（% 表示・フォールバック表示）                                                                                                                                                            |
| オーバーレイの色を変える                                                               | `src/components/segment/SegmentCanvas.tsx`（`maskToOverlayPixels` 呼び出し箇所の `{ r, g, b, a }` 引数）。変換ロジック自体は `src/lib/sam/maskOverlay.ts`                                                                                                                                                                                                                                                                                                                               |
| 書き出し形式を足す                                                                     | `src/lib/sam/exportImage.ts`（変換関数を追加）＋ `src/lib/sam/download.ts`（`buildExportFilename` の `kind` 引数を拡張）＋ `src/components/segment/ExportBar.tsx`（ボタンと `runExport` 呼び出しを追加）                                                                                                                                                                                                                                                                                |
| positive/negative 複数点入力をさらに拡張する（点の個数上限、視覚的なやり直しUI改善等） | issue #9（PR #14）で実装済み: `src/lib/sam/samSession.ts` の `segmentAtPoints`、`src/components/segment/SegmentCanvas.tsx` の Shift/Alt 修飾キー判定、`src/hooks/useSegmentation.ts` の `addPoint`/`clearPoints`。**box（ドラッグ矩形）指定は現行モデルでは実装しない**（`docs/adr/0004-slimsam-box-input-unsupported.md` 参照。ONNX グラフが `input_boxes` を宣言していない）                                                                                                          |
| レイヤー機能（複数物体を個別に選択・保存・書き出し）を拡張する                         | issue #16（PR #17）で実装済み: `src/hooks/useSegmentation.ts` の `layers`/`saveLayer`/`removeLayer`、`src/components/segment/LayerPanel.tsx`（一覧・サムネイル・削除、`ExportBar` を無改変のまま個別書き出しに再利用）、`src/lib/sam/exportImage.ts` の `computeMaskBounds`/`cropRgbaPixels`（サムネイルのクロップ）。**`setImage()` を `reset()` を経ずに直接呼ぶ UI を追加する場合は `layers` のクリアも忘れずに追加すること**（issue #16 のレビューで defer 判定した既知のギャップ） |
| WebGPU/WASM の判定条件を変える                                                         | `src/lib/sam/device.ts`（`detectDevice`）                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Worker⇄main のメッセージ種別を増やす                                                   | `src/lib/sam/protocol.ts`（型追加）＋ `src/lib/sam/samWorkerHandler.ts`（`switch` にケース追加）＋ `src/lib/sam/samWorkerClient.ts`（呼び出し用メソッド追加）                                                                                                                                                                                                                                                                                                                           |
| アップロードできるファイルの検証ルールを変える                                         | `src/lib/sam/imageLoader.ts`（`isImageFile`）                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| クリック座標の変換ロジックを変える（表示縮小率の扱い等）                               | `src/lib/sam/coords.ts`（`toImageCoords`）                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| coverage 閾値・除外対象を変える                                                        | `vitest.config.ts` の `coverage.exclude`、`.github/workflows/ci.yml` の閾値判定（`80` の箇所）                                                                                                                                                                                                                                                                                                                                                                                          |
| dev/build/test/lint コマンドを変える                                                   | `Makefile`（`make help` で一覧）。`ci` ターゲットは `lint format-check test-cov build` で、`build`（`npm run build` = `tsc -b && vite build`）が型チェックを兼ねる。CI ワークフロー（`.github/workflows/ci.yml`）はこれとは別に `npx tsc -b --noEmit` を明示ステップとして持つ（issue #5 で `tsc --noEmit`（`-b` なし）が0ファイルしか検査していなかった過去の不具合を踏まえた明示化）                                                                                                  |

## 8. 参考

- GitHub issue [#1](https://github.com/rengotaku/smart-object-select/issues/1)（親 issue・Decision Log。論点1〜6の決定と根拠）
- `docs/adr/0001-client-side-sam-in-web-worker.md`（クライアントサイド実行・Worker 必須化の決定）
- `docs/adr/0002-generation-guards-for-async-races.md`（世代カウンタの設計、テストの扱い）
- `docs/adr/0004-slimsam-box-input-unsupported.md`（box プロンプトが現行モデルで機能しない理由、positive/negative 複数点への切り替え）
- `docs/adr/0005-offline-first-model-delivery.md`（モデル配信をオフライン完結型に切り替えた決定。進捗表示の自前集計・自前ホスティング・Service Worker キャッシュの3点セット、issue #10/#21/#22/#23）
