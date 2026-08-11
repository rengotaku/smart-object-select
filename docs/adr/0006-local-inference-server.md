---
adr: 0006
title: PCローカル推論サーバー（Node.js + onnxruntime-node）を追加し実行方式を選択可能にする
status: superseded
superseded_by: 8
date: 2026-08-09
issues: [31, 32, 33, 34]
tags: [sam, local-server, onnxruntime-node, execution-mode, model-selection]
description: SAM推論を、既存のブラウザ内蔵（WebGPU/WASM）実行に加えてPCローカル常駐サーバー（server/、Node.js + onnxruntime-node）でも実行できるようにした。ユーザーは実行方式を選択でき、ローカルサーバー方式では速度/精度違いのモデルも選択できる。既存のブラウザ内蔵実行パスは一切変更していない（機能追加）。
---

# ADR 0006: PCローカル推論サーバー（Node.js + onnxruntime-node）を追加し実行方式を選択可能にする

## 背景

issue #31 でユーザーから「ブラウザにモデルを読み込ませて処理しているのを、PCにさせたい」という要望があった。会話中の質問への回答で以下が確定した:

- 実現方式は既存Webアプリを維持したまま推論だけをPCネイティブのローカルサーバープロセスに切り出す「ローカル常駐サーバー方式」（Electron化等のデスクトップアプリ化ではない）
- モデル選択の対象はSAM系の速度/精度違いバリエーション
- 既存のブラウザ内蔵WASM/WebGPU実行は維持する。今回は「機能改善」ではなく「機能追加」——ユーザーが実行方式を選択できる形にする

これは `docs/ARCHITECTURE.md` §1 の「バックエンドが無い」という初期実装（issue #1, ADR 0001）以来の中核前提を変更する規模の変更である。

## 決定

issue #31 を4つのsub-issue（#32 サーバー基盤 / #33 フロントUI / #34 追加モデル調査 / #35 本ADR）に分割し、#32→#34（並行）→#33→#35の順で実装した。

### 1. サーバーの技術スタック（#32）: Node.js + `onnxruntime-node`

既存コードベースがTypeScript/Node統一されており、`public/models/`に自前ホスティング済み（ADR 0005）のONNXモデル資産をそのまま共有できる。Python環境（venv等）を新規に持ち込まずに済み、配布・保守コストが低いと判断した。

`@huggingface/transformers`のNodeビルド（`dist/transformers.node.cjs`）は内部で`onnxruntime-node`を`require`することを実読して確認済み。これにより`src/lib/sam/transformersLoader.ts`と同じAPI（`SamModel.from_pretrained`/`AutoProcessor.from_pretrained`）をサーバー側でも使え、生の`onnxruntime-node` APIを直接叩く実装より前処理・後処理の再実装リスクを避けられる。

### 2. サーバーAPI仕様: embedding往復ではなくセッション方式

issue #31本文の当初案（`POST /embeddings`でembeddingをクライアントに返し`POST /decode`で送り返す）は、embeddingテンソル（数十〜数百KB級の配列）を毎回HTTP往復でシリアライズすることになり非効率と判断し、以下のセッション方式に変更した:

```
POST /sessions              画像を渡す → { sessionId }
POST /sessions/:id/segment  points を渡す → マスク結果
DELETE /sessions/:id        セッション破棄
```

サーバーは`Map<sessionId, SamSession>`でセッションを管理する。`src/lib/sam/samSession.ts`（`createSamSession`）はブラウザ非依存の純粋ロジックのため、サーバー側からもそのままimportして再利用し、世代ガード等のロジックを重複実装していない。

セッションは最終アクセス時刻ベースのTTL（既定30分、`SESSION_TTL_MS`で上書き可）で自動破棄する。クライアントが`DELETE`を送らずページを閉じた・通信断になった場合でも、embeddingを保持したままの`SamSession`がメモリを圧迫し続けないようにするための保険（正常系ではクライアントが`httpSamClient.ts`の`setImage()`/`terminate()`で明示的に破棄する）。

### 3. クライアント実装の位置づけ（#33）: `SamRuntime`ではなく`SamWorkerClient`を実装する

issue #31本文の当初案（`httpSamRuntime.ts`、`SamRuntime`インターフェース実装）から変更した。`SamRuntime`（`loadModel`/`loadProcessor`）はWorker内で`samSession.ts`に注入されるインターフェースで、実際の推論ロジック（世代ガード等）はWorker内で実行される前提。しかしPCローカルサーバー方式では推論そのものがサーバー側で行われるため、Workerを経由する必要が無い。

**採用**: `src/lib/sam/httpSamClient.ts`が`SamWorkerClient`インターフェース（`init`/`setImage`/`segment`/`segmentAtPoints`/`onProgress`/`terminate`）を直接実装し、`useSamEngine.ts`は実行方式（`ExecutionMode = "browser" | "local-server"`）に応じてWorkerクライアントかHTTPクライアントかを生成し分ける。

並行して呼ばれた`setImage()`のレスポンス到達順がリクエスト順と一致しないケース（画像を素早く切り替えた場合）に備え、`samSession.ts`と同じ世代ガードのパターンを`httpSamClient.ts`にも導入した。古いレスポンスは内部状態を上書きせず、サーバー上に作られたセッションだけをベストエフォートで破棄する。

### 4. モデル選択の実配線: `AVAILABLE_SAM_MODELS`をフロント・サーバー間の単一ソースにする

`src/lib/sam/constants.ts`の`AVAILABLE_SAM_MODELS`（issue #34で追加）を、`server/src/modelRegistry.ts`が re-export する形で単一ソース化した。フロント（`httpSamClient.ts`）が`POST /sessions`に`modelId`を含め、サーバー（`server/src/nodeTransformersLoader.ts`）はモデルごとにロード結果をメモ化した`SamRuntime`を`modelId`単位で切り替える。未知の`modelId`を指定すると`400`を返す（サイレントに既定モデルへフォールバックしない）。

既存の`createServerApp`/`createSessionStore`のシグネチャはすべてオプショナル引数の追加で拡張し、#32時点の単一モデル呼び出し（引数省略）は後方互換で動作する。

### 5. 速度/精度違いのモデル（#34）: `slimsam-50-uniform`を追加

`Xenova/slimsam-77-uniform`（速度重視、既定）に加え、`Xenova/slimsam-50-uniform`（Apache-2.0、精度重視・より低いpruning比率）を`public/models/`へ追加した。MobileSAM・EdgeSAMは`transformers.js`の`SamModel`/`AutoProcessor`形式に非準拠で、別プロセッサ実装が必要になり統合コストが高いため見送った。

Apache-2.0のライセンス本文（`public/models/LICENSE-APACHE-2.0.txt`）を新規に同梱し、既存の`slimsam-77-uniform`のNOTICEも合わせて参照を追加した（codexレビュー指摘対応。従来はNOTICEにURL記載のみでライセンス本文の同梱が欠けていた）。

### 6. サーバーはループバック固定でbindする

`app.listen(PORT)`のみだとホスト省略で全ネットワークインターフェースで待ち受け、共有LAN上の第三者が認証なしで推論APIを叩ける状態になる（codexレビュー指摘）。`server/src/server.ts`は`127.0.0.1`固定でbindする。

### 7. サーバーの起動方法: 手動起動のMVP

初期実装は手動起動（`cd server && npm start`）を前提とする。自動起動（Electron化やSPAからのプロセス起動）は本ADRのスコープ外。

## 却下した代替案

- **Python + FastAPI/onnxruntime**: エコシステムが広くMobileSAM等新規モデルの入手性は高いが、Python環境（venv/requirements）を新規に持ち込む必要があり、既存のNode/TypeScript統一という前提を崩すため不採用
- **サーバー側の自動起動（SPAからのプロセス起動、Electron化）**: 実装規模が大きく本ADRのスコープでは過大と判断し見送り。将来必要になれば別issueで再検討
- **embedding往復方式（issue #31当初案）**: 上記「2. サーバーAPI仕様」の通り、通信コストの観点でセッション方式に変更

## 変えてよい前提 / 壊すと危ない前提

- **変えてよい**: `SESSION_TTL_MS`（セッションTTL）、`server/`のCORS許可オリジン（`SERVER_CORS_ORIGINS`）、`MAX_IMAGE_PIXELS_FOR_LOCAL_SERVER`（クライアント側の送信前サイズ上限）
- **壊すと危ない**: `src/lib/sam/samSession.ts`をサーバー側からもimportして再利用している構造。サーバー側で世代ガード等のロジックを独自実装すると、ブラウザ版とサーバー版で挙動が分岐するリスクがある
- **壊すと危ない**: `server/src/server.ts`のループバック固定bind。ホスト引数を省略すると全ネットワークインターフェースに公開される（本ADR「6. サーバーはループバック固定でbindする」参照）
- **壊すと危ない**: `AVAILABLE_SAM_MODELS`（`src/lib/sam/constants.ts`）を単一ソースとする設計。`server/src/modelRegistry.ts`側で独自のモデル一覧を持つと、フロントの選択肢とサーバーが実際にロードできるモデルが乖離する

## 関連

- [ADR 0001](0001-client-side-sam-in-web-worker.md): クライアントサイド実行・Worker必須化の初期決定（本ADRはこれを「唯一の実行方式」から「選択可能な実行方式の1つ」に変更した）
- [ADR 0002](0002-generation-guards-for-async-races.md): 世代ガードの設計（`httpSamClient.ts`の並行`setImage`ガードもこのパターンを踏襲）
- [ADR 0005](0005-offline-first-model-delivery.md): モデルの自前ホスティング方針（`slimsam-50-uniform`の追加もこの方針に従う）
- issue #37: codexレビューでdeferした改善項目（JSONパースエラーの500誤分類、TTL掃除と実行中セッションの競合）
