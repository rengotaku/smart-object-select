---
adr: 0004
title: SlimSAM-77-uniform の ONNX グラフは box 入力を持たない
status: superseded
superseded_by: 8
date: 2026-08-06
issues: [9]
tags: [sam, onnx, model-constraint, transformers-js, box-prompt]
description: 現行モデル（Xenova/slimsam-77-uniform）の prompt_encoder_mask_decoder.onnx は image_embeddings / image_positional_embeddings / input_points / input_labels の4入力のみを宣言しており、input_boxes を渡しても ONNX ランタイムに黙って無視される。box プロンプトによる範囲指定は positive/negative 複数点で代替する。
---

# ADR 0004: SlimSAM-77-uniform の ONNX グラフは box 入力を持たない

## 背景

issue #9 は当初「範囲をドラッグで指定し、その中でセグメンテーションする」（box プロンプト）として実装した。`@huggingface/transformers` の JS 層（`SamImageProcessor.reshape_input_points(..., isBoundingBox=true)` / `SamModel.forward()` の `input_boxes` 分岐）はモデル非依存の汎用コードとして box を明示的にサポートしている。

しかし実ブラウザで検証したところ、椅子の実写真をドラッグで囲んでも 1 点クリックと同じ結果（部品のみ選択）にしかならず、コンソールに以下の警告が出ていた。

```
WARNING: Too many inputs were provided (5 > 4). The following inputs will be ignored: "input_boxes".
```

`node_modules/@huggingface/transformers/src/models/session.js` の `validateInputs()` を実読すると、この警告はセッションの `session.inputNames`（ONNX グラフが実際に宣言している入力名）に含まれないキーを黙って無視した上で出ることが分かった。`missingInputs` チェックでエラーにならなかった（`image_embeddings` / `image_positional_embeddings` / `input_points` / `input_labels` の4つは揃っていた）ことから、**この4つが `Xenova/slimsam-77-uniform` の `prompt_encoder_mask_decoder.onnx` が宣言する入力の全てで、`input_boxes` という入力ノード自体が存在しない**と確定できる。

## 決定

**box プロンプトによる範囲指定はこのモデルでは実装しない。範囲指定に相当する要求は positive/negative 複数点入力（issue #9 で実装済み）で代替する。**

box を実装したい場合は、box 入力を宣言する ONNX エクスポートを持つ別モデル（例: フル SAM の `Xenova/sam-vit-base` 等）へ切り替える必要がある。切り替えにはモデルサイズ・初回ロード時間・推論速度のトレードオフの再評価が要る（未検証）。

## 捨てた案

**box 実装をそのまま採用し、中心点を positive 点として一緒に渡す**
`SamModel.forward()` の `model_inputs.input_labels ??= ones(model_inputs.input_points.dims.slice(0, -1))` が `input_points` 無しでは `TypeError` になるため、この回避策自体は正しい実装だった。しかしそもそも `input_boxes` がグラフに存在せずランタイムに無視されるため、実質「ボックス中心点への1点クリック」と同じ結果にしかならず、意味がなかった。

**モデルを box 対応の ONNX エクスポートに切り替える**
issue #9 の合意時点でユーザーに提示したが、モデルサイズ・初回ロード時間のトレードオフが未評価のため見送った（`positive/negative 複数点に切り替える` が採用された）。

## 変えてよい前提 / 壊すと危ない前提

- **変えてよい**: 将来 box 対応モデルへ切り替える場合、`SamProcessorLike.reshapeInputPoints` に `isBoundingBox` 引数を足す設計自体は既に JS 層で検証済み（`transformers.js` の `reshape_input_points(..., is_bounding_box=true)` を呼ぶだけで動く）。box 対応モデルであれば復活できる
- **壊すと危ない**: box 対応の判断を「JS ライブラリのコードが対応しているか」だけで行うこと。`@huggingface/transformers` の JS 層はモデル非依存の汎用コードのため box を「書ける」が、個々のモデルの ONNX グラフが対応しているとは限らない。**モデルを変える／新しい入力を追加するときは、必ず実ブラウザでコンソール警告（`validateInputs` の "Too many inputs" / "Missing the following inputs"）を確認してから機能扱いにする**
- **壊すと危ない**: `SamProcessor`（`AutoProcessor.from_pretrained` の戻り値）に生えているメソッドを「全て `image_processor` へ委譲されている」と思い込むこと。`processing_sam.js` は `reshape_input_points` / `post_process_masks` は委譲するが `add_input_labels` は委譲しない（`transformersLoader.ts` はこれを踏まえ `processor.image_processor.add_input_labels` を直接呼んでいる）

## 関連

- [[0002-generation-guards-for-async-races]]
- 実装と検証: #9（PR #14）
