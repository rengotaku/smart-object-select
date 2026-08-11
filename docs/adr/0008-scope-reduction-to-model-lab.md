---
adr: 0008
title: 本編機能（/segment、SAM推論、PCローカル推論サーバー）を削除しModel Lab専用に縮小する
status: accepted
superseded_by: null
date: 2026-08-12
issues: [59]
tags: [scope-reduction, model-lab, segment, archival, deletion]
description: 本編機能（/segment、src/lib/sam/、server/）を削除し、リポジトリをModel Lab検証ページ（/model-lab）のみに縮小した。整理完了後、GitHubリポジトリをアーカイブする。
---

# ADR 0008: 本編機能を削除しModel Lab専用に縮小する

## 背景

本編機能（`/segment`、SlimSAMによるオブジェクト選択・書き出し）の開発は終了し、以降は
Model Lab（`/model-lab`、issue #45〜#50・ADR 0007）のみを維持する方針となった
（issue #59）。本編機能一式（`src/pages/SegmentPage.tsx`、`src/components/segment/`、
`src/lib/sam/`、`src/lib/serviceWorker/`、`public/sw.js`、`public/models/slimsam-*/`、
`server/`）を削除し、リポジトリをModel Lab専用に整理したうえでGitHubリポジトリを
アーカイブする。

## 決定

- 本編機能一式を削除する（上記ファイル・ディレクトリ）
- **`src/lib/sam/` の一部はModel Labからも参照されていたため、削除ではなく `src/lib/` 直下へ移設した**（実装前の想定と異なり、ADR 0007「`/segment`とは完全に独立」の記述は不正確だった。以下5点が実際の共有部分）:
  - `types.ts`（`SamImageInput` 型）
  - `coords.ts`（`toImageCoords`、`ModelLabResultView.tsx` が使用）
  - `maskOverlay.ts`（`maskToOverlayPixels`、同上）
  - `imageLoader.ts`（`fileToLoadedImage`/`isImageFile`、`LoadedImage` 型もここに統合。旧 `src/hooks/useSegmentation.ts` からも移設）
  - `wasmRuntimePaths.ts`（`resolveSelfHostedWasmPaths`、MobileSAM/FastSAM/YOLO11n-seg の `onnxRuntime.ts` が使用）
  - 同様に `src/components/segment/ImageDropzone.tsx` も `ModelLabPage.tsx` が使用していたため `src/components/ImageDropzone.tsx` へ移設した（`SegmentCanvas`/`ExportBar`/`LayerPanel`/`CandidatePicker` の4コンポーネントは実際にModel Labから未参照であることを確認し削除した）
- `@huggingface/transformers` を削除すると、Model Labが直接importする `onnxruntime-web` が推移的依存として失われることが判明したため、`package.json` に直接依存として追加した（バージョンは削除前の `package-lock.json` に記録されていた解決済みバージョン `1.26.0-dev.20260416-b7804b056c` を明示的に固定し、WASMバイナリ資産との互換性を維持）
- 既存デッドコード（Segment削除とは無関係に元から未使用だった）も合わせて削除した: `src/hooks/useUIStore.ts`（zustand、export済みだが呼び出し元皆無）、`zod`/`react-hook-form`/`@hookform/resolvers`/`ky`/`msw` の各npm依存
- 旧ADR（0001, 0002, 0004, 0005, 0006）は本編機能・`server/`の設計判断の記録として本文を変更せず残し、`status: superseded`・`superseded_by: 8` に更新した。ADR 0003（テスト運用の一般規約）とADR 0007（Model Lab自体）は無改変で有効
- 整理完了後、GitHubリポジトリをアーカイブする（読み取り専用化。以降の変更は行わない前提）

## 捨てた案

- **`src/lib/sam/` を丸ごと削除しModel Lab側で再実装する**: Model Labが実際に依存していた5ファイルは純粋関数・型定義でありSegment固有のロジックを持たない。再実装は無駄な差分と検証コストを生むため、移設（`git mv`）で対応した
- **`@huggingface/transformers` の依存を残す**: Model Labは`transformers.js`を経由しない設計（ADR 0007）のため、依存自体は不要。`onnxruntime-web`のみを直接依存として明示することで、依存関係が実際の利用実態と一致する

## 変えてよい前提 / 壊すと危ない前提

- **変えてよい**: `src/lib/` 直下に移設した5ファイルの配置は、Model Lab以外の利用者が今後現れた場合はさらに整理してよい（現状は唯一の利用元）
- **壊すと危ない**: `onnxruntime-web` のバージョンピン（`1.26.0-dev.20260416-b7804b056c`）を緩めたり最新化したりする場合、`public/onnxruntime/` に自前ホスティングしているWASMバイナリとの互換性を必ず実機確認すること（ADR 0007「実装中に発覚した技術的な罠」参照。WASMバイナリ版によるop非対応の実例あり）
