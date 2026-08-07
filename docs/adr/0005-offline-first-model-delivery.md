---
adr: 0005
title: モデル配信をオフライン完結型（自前ホスティング + Service Worker）に切り替える
status: accepted
superseded_by: null
date: 2026-08-08
issues: [10, 21, 22, 23]
tags: [sam, offline, service-worker, self-hosting, cache-storage, transformers-js]
description: SAM モデル（Xenova/slimsam-77-uniform, Apache-2.0）と onnxruntime-web の WASM ランタイムを public/ 配下へ自前ホスティングし、Service Worker + Cache Storage で明示的にキャッシュすることで、初回アクセス後は外部（Hugging Face Hub / jsDelivr）に一切依存せずオフラインでも動作するようにした。進捗表示は転送先ファイルをまたいで自前集計する。
---

# ADR 0005: モデル配信をオフライン完結型（自前ホスティング + Service Worker）に切り替える

## 背景

issue #1 の Decision Log（論点5）では、モデル配信を「Hugging Face Hub 直参照（MVP）。自前ホスティングは必要になった時点で再検討」としていた。issue #10 で以下の制約が実測により顕在化した:

- 初回アクセス時に `config.json` / `preprocessor_config.json` / 量子化済み onnx 2ファイル / WASM ランタイム（jsDelivr 経由）を外部から取得しており、**オフラインでは一切動かない**（「ブラウザ内で完結する」という設計意図と矛盾）
- 外部サービスの可用性・レート制限・URL 変更に依存する
- 初回ロードの進捗が画面に出ず、遅い回線では「固まった」ように見える

## 決定

issue #10 を3つの sub-issue（#21 進捗表示 / #22 自前ホスティング / #23 Service Worker キャッシュ）に分割し、③→①→②の順で実装した。

### 1. 進捗表示（#21）: ライブラリ内部集計に依存せず自前集計する

`@huggingface/transformers` は `progress_callback` に渡す進捗を `from_pretrained()` 呼び出し単位で集計する（`DefaultProgressCallback`、内部実装）。この内部集計は以下の理由で不採用とした:

- ファイル単位の `status: "progress"` をそのまま UI に出すと、複数ファイル取得時に%が後退する
- ライブラリが提供する集約値 `status: "progress_total"` も `from_pretrained()` 呼び出し（`loadModel()`/`loadProcessor()`）ごとにリセットされるため、model→processor をまたぐと後退する

**採用**: `createTransformersSamRuntime()` のクロージャに `Map<file, {loaded, total}>` を1つ持たせ、生のファイル単位 `progress` イベントを `loadModel()`/`loadProcessor()` の両方の呼び出しをまたいで自前集計する。ライブラリの内部ラップ挙動（非公開・将来変更されうる）に依存しない。

Worker → メインスレッドの通知は、既存の id 相関 request/response（`SamWorkerResponse`）とは別種の通知型 `SamWorkerNotification` として設計した（`samWorkerClient.onProgress(listener): unsubscribe`）。

### 2. 自前ホスティング（#22）: quantized のみを選択的にミラーする

`Xenova/slimsam-77-uniform` は Apache-2.0（帰属表示のもとで再配布・自前ホスティング可、確認済み）。リポジトリには fp16/非量子化版を含む全171MBのファイルがあるが、**実際にロードする quantized 版4ファイル（計約14MB）のみ** を `public/models/slimsam-77-uniform/` にミラーした（YAGNI: 未使用ファイルはミラーしない）。

WASM ランタイム（onnxruntime-web、MIT）も `node_modules/onnxruntime-web/dist/` から `public/onnxruntime/` へ配置し、`env.backends.onnx.wasm.wasmPaths` を自ホストパスに向けた。

**副作用として dtype を `"q8"` に明示固定**: `device: "webgpu"` はデフォルト dtype が非量子化(fp32)になり、自ホストしていないファイルを要求してロードが失敗する。`allowRemoteModels=false` の下では device に関わらず量子化ファイルのみを使うよう `dtype: "q8"` を明示した。

**既知のトレードオフ**: モデル+WASM資産（計約50MB）をリポジトリに直接コミットしている。Git LFS は導入していない（追加の運用コストに見合う規模ではないと判断）。将来リポジトリサイズが問題になれば再検討する。

### 3. Service Worker キャッシュ（#23）: 3種のアセットを install 時に決定的に事前キャッシュする

Cache First（モデル/WASM）+ Network First（アプリ本体）の基本設計に加え、**「単発の初回訪問直後にオフラインになる」シナリオでも動作する**ことを実ブラウザ検証で確認しながら、以下3種すべてを `install` イベントで明示的に事前キャッシュする方式にした:

1. `index.html` とそこから `<script src>`/`<link href>` で直接参照されるアセット
2. メインバンドルの JS テキストを走査し `new Worker(new URL(...))` パターンから動的発見した Worker チャンク（`sam.worker-*.js` 等、ビルドハッシュ付きで `index.html` に現れないため）
3. モデル・WASM ランタイムの固定パス（ビルドハッシュを含まないためハードコード可能）

**この設計に至った理由**: SW の `fetch` イベント intercept（`event.respondWith`）だけに頼ると、「ページ読み込み → SW の `clients.claim()` 完了」より前に発行されたリクエストは SW に一切捕捉されずキャッシュされない（初回訪問特有のタイミング競合）。特に Worker チャンクは早期に fetch されるため、この競合の影響を受けやすかった（実測: `net::ERR_ABORTED` でオフライン初期化に失敗）。install 完了時点で決定的にキャッシュを埋めることで、この競合を回避した。

`/api/**` はアプリシェルキャッシュから明示的に除外した（同一 origin 構成の場合に認証付きレスポンスが永続キャッシュされる事故を防ぐため）。

## 却下した代替案

- **WASM/モデルを CDN へ配置**: 外部依存の解消という目的に反するため不採用
- **`fetch` intercept のみに頼る事前キャッシュ**: 初回訪問のタイミング競合を解消できないため不採用（上記3参照）
- **Git LFS でモデル資産を管理**: 現状の規模（約50MB）では運用コストに見合わないため見送り（将来再検討）
- **モデルサイズ変更（`sam-vit-base` 等）・dtype 調整によるマスク精度改善**: issue #19 のスパイクで効果なしと実証済みのため、本 ADR の対象外

## 変えてよい前提 / 壊すと危ない前提

- **変えてよい**: `public/models/<MODEL_ID>/` のディレクトリ名・`CACHE_VERSION` 定数（更新時に上げる運用）
- **壊すと危ない**: `public/sw.js` と `src/lib/serviceWorker/cachePolicy.ts` のロジック同期（`public/` は Vite の変換対象外で TypeScript を import できないため、両ファイルは手動で同期する設計。ロジックを変更する場合は両方を更新すること）
- **壊すと危ない**: `transformersLoader.ts` の自前進捗集計（`Map` をクロージャで model/processor 呼び出しをまたいで永続化する部分）。ライブラリの `progress_total` に戻すと model→processor 間で進捗が後退する退行が再発する

## 関連

- [ADR 0002](0002-generation-guards-for-async-races.md): 世代ガードの不変条件（本実装の worker 通知チャネル追加時にも維持した）
- [ADR 0004](0004-slimsam-box-input-unsupported.md): モデル選定・box 非対応の経緯
- issue #24: 複数ファイルの起動タイミング差による進捗%の一時的な後退（P2、defer）
