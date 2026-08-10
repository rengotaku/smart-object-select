---
adr: 0007
title: 却下・保留したSAM代替モデル(MobileSAM/EdgeSAM/YOLO11n-seg/FastSAM)をWASM検証ページで動かせるようにする
status: accepted
superseded_by: null
date: 2026-08-11
issues: [45, 46, 47, 48, 49, 50]
tags: [model-lab, mobilesam, edgesam, yolo11n-seg, fastsam, onnxruntime-web, license, verification]
description: issue #34/ADR 0006で統合コスト・機能制約を理由に見送ったSAM代替モデル4種（MobileSAM・EdgeSAM・YOLO11n-seg・FastSAM）を、`transformers.js`を経由せず`onnxruntime-web`を直接呼ぶ専用実装で検証専用ページ（/model-lab）に統合した。既存の`/segment`ページ・`SamWorkerClient`・`samSession.ts`には一切影響を与えない機能追加。
---

# ADR 0007: 却下・保留したSAM代替モデルをWASM検証ページで動かせるようにする

## 背景

issue #34/ADR 0006で、MobileSAM・EdgeSAMは「`transformers.js`の`SamModel`/`AutoProcessor`形式に非準拠で統合コストが高い」という理由で採用を見送っていた。issue #45できっかけとなった会話（Adobeの物体選択が高速な理由の調査 → OSS代替モデルの比較）の中で、YOLO11n-seg（COCO80クラス固定の閉集合検出器）・FastSAM（YOLOv8-segベース、MobileSAM/EdgeSAMと同じ統合コストの壁が予想される）も含め、却下・保留した4モデルのうちブラウザWASM実行が可能なものを実際に動かして検証したいという要望があった。

## 決定

issue #45を親issueとし、5つのsub-issueに分割して実装した（#46 土台 → #47 MobileSAM → #48 EdgeSAM → #49 YOLO11n-seg → #50 FastSAM の順）。

### 1. UIの置き場所: 既存Segmentページとは独立した検証専用ページ（`/model-lab`）

既存の`SamWorkerClient`抽象（点プロンプト前提）は、YOLO11n-seg/FastSAMの「全自動検出→クリックでインスタンス選択」という別パラダイムに合わないため、無理に共通化せず`src/pages/ModelLabPage.tsx`として独立実装した。既存の`/segment`ページ・`useSamEngine`・`src/lib/sam/*`（`samSession.ts`・`transformersLoader.ts`等）には一切変更を加えていない。

### 2. インタラクションパラダイムを2種類に分離

- **点プロンプト方式**（MobileSAM・EdgeSAM）: 既存SAMと同じ「クリック→その位置のマスクを推論」
- **全自動検出方式**（YOLO11n-seg・FastSAM）: 画像アップロード時に全インスタンスを一括検出し、クリックで該当インスタンスをハイライト（FastSAM本来の点/矩形プロンプトによる絞り込みパイプラインは実装せず、YOLO11n-segと一貫したUXにするため採用しなかった）

`src/lib/modelLab/results.ts`の`ModelLabResult`/`ModelLabOverlay`判別可能ユニオン型で両方を表現し、`ModelLabResultView.tsx`が`kind`（`"mask"`=全画面マスク、`"box"`=部分マスク）に応じて描画方式を分岐する。

### 3. `onnxruntime-web`を直接呼ぶ専用実装（`transformers.js`を経由しない）

各モデル（`src/lib/modelLab/{mobileSam,edgeSam,yolo11nSeg,fastSam}/`）は、`transformers.js`の`SamModel`/`AutoProcessor`規約に頼らず、`onnxruntime-web`を直接呼ぶ前処理・後処理・Worker基盤・世代ガード付きセッションを個別実装した。これがまさに元々の却下理由（統合コストが高い）に対応する部分であり、今回はその統合コストを払って実装した。

### 4. モデル選択の単一ソース: `ModelLabRegistry`

`src/lib/modelLab/registry.ts`の配列に要素を追加するだけでUIの選択肢が増える拡張可能な設計にした（#46で先に土台を作り、#47〜#50は配列への追記のみで統合）。

## 実装中に発覚した技術的な罠（各モデルで再発、恒久対応済み）

1. **onnxruntime-webのWASMランタイム（`.mjs`）を`public/`配下のURLとしてそのまま`wasmPaths`に渡すと、Vite dev serverが「静的アセットをJSとしてimportできない」エラーで500を返し推論が完全に失敗する**。`@huggingface/transformers`が内部で行っている「fetch→Blob→ObjectURL化」と同じ手法を、各モデルの`onnxRuntime.ts`で再実装している。
2. **WASMバイナリの版（asyncify版 vs 非asyncify版）でONNXグラフ内の演算子(op)がサポートされないことがある**（EdgeSAMのデコーダが使う`Cast`演算子がasyncify版で未サポートだった）。モデルごとに実機で確認し、非asyncify版を使うよう切り替えている。
3. **検出ごとにフル解像度のマスクを保持・転送すると、高解像度画像+複数検出でメモリを大量消費しフリーズ/OOMになる**（YOLO11n-segのcodexレビューP1指摘）。マスクは「バウンディングボックス範囲のみ + 元画像座標系でのオフセット(x,y)」という座標系（`{ data, width, height, x, y }`）で保持するよう統一した。
4. **マスク合成を元画像解像度で行うと計算量が爆発する**（YOLO11n-segのcodexレビューP1指摘）。プロトタイプ空間（160×160や256×256、モデルのセグメンテーションヘッドのネイティブ出力解像度）で先に合成し、最後にボックス範囲へアップサンプリングする設計に統一した。
5. **`kind: "mask"`（全画面マスク）と`kind: "box"`（部分マスク）で描画方式を混同すると、片方にリグレッションが起きる**（YOLO11n-segの対応3.でEdgeSAMの全画面マスク描画を壊しかけた、codexレビューP1指摘）。`ModelLabResultView.tsx`の`drawMaskLikeOverlay`は呼び出し側が明示的に描画先矩形（`dest`）を渡す設計にし、全画面マスクは画像全体への拡大描画、部分マスクは等倍配置、と用途ごとに固定した。
6. **NMS前に検出数の上限を適用すると、同一物体の重複候補が上位を占め別物体の検出漏れが起きる**（FastSAMのcodexレビューP2指摘）。検出数上限（Ultralytics公式の`max_det`相当）はNMS**後**に適用し、NMS前の候補数上限は別の大きめの定数（O(n²)コスト対策専用）として分離した。

## ライセンスに関する重要な決定（issue #45 Decision Log #4・#5参照）

4モデルのライセンスはそれぞれ性質が異なり、ユーザー承認済みの方針で統合している。

| モデル | ライセンス | 商用利用 | 対応方針 |
|---|---|---|---|
| MobileSAM | Apache-2.0 | 可 | そのまま利用 |
| EdgeSAM | **S-Lab License 1.0**（実体の一次配布元、非商用限定） | **不可** | 検証用途として受け入れ（Decision Log #5） |
| YOLO11n-seg | AGPL-3.0 | 可（コピーレフト） | リポジトリに`LICENSE`（AGPL-3.0全文）を追加。本リポジトリは既にGitHub上でpublic・全ソース公開済みのため要件を実質満たす（Decision Log #4） |
| FastSAM | AGPL-3.0（upstream README/LICENSEファイルの矛盾あり、保守的にAGPL-3.0として扱う） | 可（コピーレフト） | 同上 |

各モデルのHugging Face配布元のライセンス表記（cardData）は、ONNXエクスポート作業自体への宣言に過ぎず、実体の重みの一次配布元のライセンスと異なることがある（EdgeSAM・FastSAMで発覚）。**モデルを新規に自前ホスティングする際は、Hugging Face cardDataだけでなく、upstream（原著作者）の実際のLICENSEファイルまで確認すること**。詳細は各モデルの`public/models/<model-id>/NOTICE`に記載。

## 却下した代替案

- **FastSAMの点/矩形プロンプトによる絞り込みパイプライン（`FastSAMPrompt`）の実装**: YOLO11n-segと一貫したUXにするため、全自動検出→クリック選択方式に統一した（実装スコープも小さくなる）
- **YOLO系（全自動検出パラダイム）を既存の`SamWorkerClient`インターフェースに無理に統合すること**: 「点プロンプト→単一マスク」という既存インターフェースの前提と根本的に異なるため、独立実装とした

## 変えてよい前提 / 壊すと危ない前提

- **変えてよい**: `ModelLabRegistry`への要素追加（新しいモデルを追加する場合）
- **壊すと危ない**: `ModelLabResultView.tsx`の`drawMaskLikeOverlay`が`kind`ごとに異なる`dest`矩形を要求する設計。ここを崩すと既存モデルの描画にリグレッションが起きる（本ADRの罠5参照）
- **壊すと危ない**: 各モデルの`postprocess.ts`が採用している「プロトタイプ空間で合成→最後にアップサンプリング」という設計（罠4参照）。元画像解像度で先に合成する実装に戻すとパフォーマンス問題が再発する
- **壊すと危ない**: `src/lib/sam/samSession.ts`・`transformersLoader.ts`・`SegmentPage.tsx`（既存のブラウザ内蔵実行）への非変更。Model Lab機能は独立実装のまま維持すること

## 既知の未対応事項（改善バックログ）

- **YOLO11n-seg（#49）にもFastSAM(#50)と同種のNMS前候補数上限が無い**: FastSAMの罠6と同じ構造的リスクがYOLO11n-segにも存在する可能性がある（実装時のスコープ外として意図的に見送った）。別issueで対応を検討する。

## 関連

- [ADR 0006](0006-local-inference-server.md): 既存のブラウザ内蔵・PCローカルサーバー実行方式の設計（本ADRの前提となるADR 0001も含む既存アーキテクチャには一切手を入れていない）
- [ADR 0002](0002-generation-guards-for-async-races.md): 世代ガードの設計（各モデルのセッション実装もこのパターンを踏襲）
- issue [#45](https://github.com/rengotaku/smart-object-select/issues/45): 親issue、Decision Log全体
