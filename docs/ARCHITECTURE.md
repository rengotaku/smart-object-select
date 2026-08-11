# アーキテクチャ

このドキュメントは「どこを触れば何が変わるか」の地図。この機能を初めて触る開発者（人間または AI）向けに、実装（`src/`）と決定の記録（`docs/adr/`）を突き合わせて書いている。事実は実装を読んで確認したものだけを書き、断定できない点は「未確認」と明記する。

## 1. このリポジトリは何か

現在は **Model Lab**（`/model-lab`）のみを提供する検証用 React SPA。

- 元々は Photoshop の「オブジェクト選択ツール」相当をブラウザだけで実現する本編機能（`/segment`、SAM推論）を持っていたが、issue #59（`docs/adr/0008-scope-reduction-to-model-lab.md`）で削除し、Model Labのみに縮小した。本編機能・PCローカル推論サーバー（`server/`）の設計は歴史的記録として `docs/adr/0001`〜`0002`,`0004`〜`0006`（いずれも `status: superseded`）に残っている
- Model Lab は、issue #34（本編の初期検討）で統合コスト・機能制約を理由に見送ったSAM代替モデル4種（MobileSAM・EdgeSAM・YOLO11n-seg・FastSAM）を、実際にブラウザWASM実行で試して比較できるようにした検証専用ページ（issue #45〜#50、`docs/adr/0007-model-lab-verification-page.md`）
- **バックエンドを持たない**。画像・推論結果とも一切サーバーへ送信せず、`onnxruntime-web` を各モデルが直接呼び出してブラウザ内で完結する（`transformers.js` を経由しない。既存モデルとの統合コストが高かったのが元々の却下理由そのものであるため）
- `my-boilerplate` の `react-spa` テンプレートから scaffold されている

## 2. モデルレジストリとインタラクションパラダイム

- **エントリポイント**: `src/pages/ModelLabPage.tsx`（`/model-lab` ルート、`src/App.tsx`。`/` はここへ redirect する）
- **モデルレジストリ**: `src/lib/modelLab/registry.ts` の `ModelLabRegistry` 配列に要素を足すだけで選択肢が増える。各モデルは `src/lib/modelLab/{mobileSam,edgeSam,yolo11nSeg,fastSam}/` に独立実装（前処理・後処理・`onnxRuntime.ts`・Worker基盤・世代ガード付きセッション）を持つ
- **2種類のインタラクションパラダイム**（`src/lib/modelLab/results.ts` の `ModelLabResult`/`ModelLabOverlay` 判別可能ユニオン型で表現）:
  - 点プロンプト方式（MobileSAM・EdgeSAM）: `kind: "mask"`、クリック→その位置のマスクを推論
  - 全自動検出方式（YOLO11n-seg・FastSAM）: `kind: "box"`、アップロード時に全インスタンス一括検出→クリックでハイライト
- **描画**: `src/components/modelLab/ModelLabResultView.tsx` の `drawMaskLikeOverlay` が `kind` ごとに異なる描画先矩形（`dest`）を要求する。全画面マスクは画像全体への拡大描画、部分マスク（バウンディングボックス範囲のみ + オフセット座標）は等倍配置。**ここを混同すると片方にリグレッションが起きる**（ADR 0007 罠5）
- **モデル資産**: `public/models/{mobile-sam,edge-sam,yolo11n-seg,fast-sam}/`。各モデルのライセンスは性質が異なる（Apache-2.0 / S-Lab License 1.0＝非商用限定 / AGPL-3.0 ×2）ため、追加時は各 `NOTICE` とADR 0007のライセンス比較表を必ず参照すること
- **実装済みの罠と恒久対応**（新モデルを追加する際は同じ罠を踏まないよう、ADR 0007「実装中に発覚した技術的な罠」を先に読むこと）: WASMランタイム(.mjs)のBlobURL化、WASMバイナリ版によるop非対応、マスクのバウンディングボックス範囲限定保持、プロトタイプ空間でのマスク合成、NMS後の検出数上限適用

## 3. 全モデル共通の基盤（`src/lib/` 直下）

各モデル実装が共通で使う、モデル非依存の純粋関数・型・アダプタ。元々は本編（`/segment`）の `src/lib/sam/` 配下にあったが、issue #59 で本編削除に伴い `src/lib/` 直下へ移設した（Model Labが唯一の利用元になったため）。

**表1: `src/lib/` 直下の共通基盤モジュール**

| ファイル | 役割 | 利用元 |
| --- | --- | --- |
| `types.ts` | `SamImageInput`（RGBA ピクセル列 `{data, width, height}`）等の共通型定義 | 全モデルの `preprocess.ts`/`protocol.ts`/`session.ts`、フック |
| `imageLoader.ts` | アップロードされた `File` を DOM `Image`/`Canvas` で RGBA 化（`fileToLoadedImage`）。`LoadedImage`（`SamImageInput` + `objectUrl`/`sourceName`）を定義 | `ImageDropzone.tsx`、`ModelLabPage.tsx` |
| `coords.ts` | Canvas クリック座標 → 画像座標変換（`toImageCoords`） | `ModelLabResultView.tsx` |
| `maskOverlay.ts` | マスク → オーバーレイ表示用 RGBA 変換（`maskToOverlayPixels`） | `ModelLabResultView.tsx` |
| `wasmRuntimePaths.ts` | `onnxruntime-web` の自ホストWASMパス解決（`resolveSelfHostedWasmPaths`、Safari判定で asyncify 版/非asyncify版を切替） | MobileSAM/FastSAM/YOLO11n-seg の `onnxRuntime.ts`（EdgeSAMは独自の理由で非採用。§2「実装済みの罠」参照） |

**壊すと危ない前提**: `imageLoader.test.ts`/`coords.test.ts`/`maskOverlay.test.ts`/`wasmRuntimePaths.test.ts` は fake DOM/`navigator` を注入した純粋関数テスト。`imageLoader.ts` は DOM `Image`/`Canvas` デコードに依存するため jsdom で実行できず、coverage 対象から除外している（`vitest.config.ts`）。

## 4. テスト戦略

### 純関数とアダプタの分離

`coords.ts` / `maskOverlay.ts` / `types.ts` は外部依存を持たない純関数、または DI で差し替え可能なアダプタとして書かれている。各モデルの `onnxRuntime.ts` も `onnxruntime-web` への直接依存を1ファイルに封じ込め、`session.ts` 以降は自前インターフェース経由でのみモデルを扱う（`transformersLoader.ts` を1ファイルに封じ込めていた旧設計と同じ方針。ADR 0001「壊すと危ない前提」参照）。

### coverage から除外しているファイル（`vitest.config.ts`）

- `src/lib/imageLoader.ts` — DOM `Image`/Canvas 2D コンテキストに依存し jsdom はサポートしない。`isImageFile` は別途ユニットテスト済み
- `src/lib/modelLab/mobileSam/mobileSam.worker.ts` — `self.onmessage` を handler に繋ぐだけの Worker エントリポイント。jsdom に実 Worker ランタイムが無く実行できない。ルーティングされる先のロジック（`mobileSamWorkerHandler.ts`）は直接ユニットテストされている

## 5. どこを触れば何が変わるか

**表2: 典型的な変更と触るファイル**

| やりたいこと | 触るファイル |
| --- | --- |
| Model Lab に新しい検証用モデルを追加する | `src/lib/modelLab/registry.ts`（`ModelLabRegistry` に要素追加）＋ `src/lib/modelLab/<新モデルID>/`（前処理・後処理・`onnxRuntime.ts`・Worker基盤・世代ガード付きセッションを新規実装）＋ `public/models/<新モデルID>/`（モデル資産 + `NOTICE`。ライセンスはHugging Face cardDataだけでなくupstreamの実LICENSEファイルまで確認すること）。既存4モデル実装済みの罠（§2参照、ADR 0007）を先に読んでから着手する |
| オーバーレイの色・描画ロジックを変える | `src/components/modelLab/ModelLabResultView.tsx`（`drawMaskLikeOverlay`）。座標変換自体は `src/lib/coords.ts`、マスク→ピクセル変換は `src/lib/maskOverlay.ts` |
| アップロードできるファイルの検証ルールを変える | `src/lib/imageLoader.ts`（`isImageFile`） |
| WASMランタイムの自ホストパス解決を変える | `src/lib/wasmRuntimePaths.ts`（`resolveSelfHostedWasmPaths`）。EdgeSAMは独自実装のため `src/lib/modelLab/edgeSam/onnxRuntime.ts` も要確認 |
| coverage 閾値・除外対象を変える | `vitest.config.ts` の `coverage.exclude`、`.github/workflows/ci.yml` の閾値判定（`80` の箇所） |
| dev/build/test/lint コマンドを変える | `Makefile`（`make help` で一覧）。`ci` ターゲットは `lint format-check test-cov build` で、`build`（`npm run build` = `tsc -b && vite build`）が型チェックを兼ねる |

## 6. 参考

- `docs/adr/0007-model-lab-verification-page.md`（Model Lab検証ページの設計・実装中に発覚した罠・ライセンス対応方針、issue #45〜#50）
- `docs/adr/0008-scope-reduction-to-model-lab.md`（本編機能削除・Model Lab専用への縮小、issue #59）
- `docs/adr/0003-verify-tests-fail-before-fixing.md`（新しいテストを書く際の一般的な運用規約。SAM固有ではないため現在も有効）
- 歴史的記録（`status: superseded`、本編/`server/`削除により無効化済み）: `docs/adr/0001-client-side-sam-in-web-worker.md` / `docs/adr/0002-generation-guards-for-async-races.md` / `docs/adr/0004-slimsam-box-input-unsupported.md` / `docs/adr/0005-offline-first-model-delivery.md` / `docs/adr/0006-local-inference-server.md`
