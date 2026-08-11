---
adr: 0001
title: SAM 推論をブラウザ内 Web Worker で実行する
status: superseded
superseded_by: 8
date: 2026-08-06
issues: [1, 2]
tags: [sam, web-worker, webgpu, wasm, transformers]
description: サーバーを持たず SlimSAM を transformers.js でブラウザ実行し、WASM フォールバック時の UI 凍結を避けるため推論を Web Worker に隔離する。
---

# ADR 0001: SAM 推論をブラウザ内 Web Worker で実行する

## 背景

「Web 上で Photoshop のオブジェクト選択みたいなことをできないか」という要望が起点。SAM（Segment Anything Model）でクリック位置のオブジェクトをマスク選択する機能を、`react-spa` テンプレートから scaffold した SPA に載せる必要があった。

このリポジトリには**バックエンドが無い**。推論をどこで走らせるかが最初の分岐だった。

加えて SAM の処理は2段階に分かれ、コストが極端に非対称:

- **image encoder**: 画像1枚につき1回。重い（WASM 実行では数秒〜数十秒）
- **mask decoder**: クリックのたび。軽い（実測で 1 秒未満）

## 決定

**クライアントサイド実行（`@huggingface/transformers` + SlimSAM-77-uniform）を採用し、推論全体を Web Worker に隔離する。**

- モデルは `Xenova/slimsam-77-uniform` を Hugging Face Hub から直接読み込む（自前ホスティングしない）
- 実行デバイスは WebGPU を優先し、利用できなければ **WASM にフォールバックする**（機能を無効化しない）
- WASM フォールバック時は「処理に時間がかかります」を画面に明示する
- **推論は必ず Web Worker 上で行う**。メインスレッドでは encoder を走らせない
- image encoder の結果（embedding）は画像ごとに 1 回だけ計算してキャッシュし、クリックのたびに decoder だけを回す

Web Worker を必須にしたのは、WASM フォールバックを採用した時点で不可分になったため。メインスレッドで encoder を回すと WASM 実行時に UI が数十秒フリーズし、**フォールバック自体が実用にならない**。「WebGPU があるときだけ Worker を使う」といった条件分岐は、遅い側の環境でこそ Worker が必要という関係と逆になる。

## 捨てた案

**SAM をサーバー API 化する（Python + FastAPI 等）**
モデルロードが速く大きいモデルも使えるが、このリポジトリにバックエンドが無く、GPU 課金も発生する。画像がサーバーに送られるためプライバシー面でも不利。SPA 単体で完結する構成を優先した。

**Replicate / fal.ai 等のホスティング API を叩く**
実装は最速だが外部 SaaS への従量課金と依存が発生する。プロトタイプとしては妥当だが、「ブラウザだけで完結する」ことをこの機能の性質と見なした。

**MobileSAM を使う**
一般に SlimSAM より精度が高いとされるが、モデルサイズとロード時間が増える。初回ロード体験を優先して SlimSAM を選んだ。**この判断は覆しやすい**（下記「変えてよい前提」参照）。

**モデルを UI で切り替え可能にする**
モデル切替 UI と embedding キャッシュの無効化処理が必要になり MVP が膨らむ。単一モデル固定とした。

**WebGPU 非対応ブラウザでは機能を無効化する**
実装は単純だが Safari で全く使えなくなる。遅くても動くことを優先した。

**モデルを自前ホスティングする**
配信インフラの追加判断が必要になる。MVP では Hub 直参照とし、必要になった時点で再検討する。

## 変えてよい前提 / 壊すと危ない前提

- **変えてよい**: モデル ID（`SAM_MODEL_ID`）。`SamRuntime` インターフェースを満たす限り、SlimSAM から MobileSAM 等へ差し替えられる。オーバーレイの色。WASM 警告の文言
- **変えてよい**: 実行デバイスの判定ロジック。WebGPU の検出条件を厳しく/緩くしても、`"webgpu" | "wasm"` のどちらかを返す限り上位層は影響を受けない
- **壊すと危ない**: **`@huggingface/transformers` への依存を `transformersLoader.ts` の外へ広げること**。推論ロジックが実パッケージを import すると、テストがモデル実体のダウンロードに依存し、CI が遅く不安定になる。`samSession.ts` は `SamRuntime` を DI で受け取る形を保つこと
- **壊すと危ない**: **embedding のキャッシュ**。クリックのたびに encoder が回ると、WASM 環境では 1 クリックあたり数十秒かかり機能として成立しない
- **壊すと危ない**: **推論をメインスレッドへ戻すこと**。WASM フォールバックが実用にならなくなる
- **壊すと危ない**: WebGPU 検出で例外を外へ伝播させること。検出処理の失敗がアプリ全体の初期化失敗になる（意図的に「安全側＝wasm」へ倒している）

## 関連

- 親 issue #1 の Decision Log 論点 1 / 2 / 5 / 6
- 実装: #2（PR #6）
