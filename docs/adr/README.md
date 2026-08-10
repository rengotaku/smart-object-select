# ADR 索引

<!-- generate-adr-index.zsh による自動生成。手で編集しない -->

| ADR | タイトル | status | date | 要旨 |
|---|---|---|---|---|
| [0001](0001-client-side-sam-in-web-worker.md) | SAM 推論をブラウザ内 Web Worker で実行する | accepted | 2026-08-06 | サーバーを持たず SlimSAM を transformers.js でブラウザ実行し、WASM フォールバック時の UI 凍結を避けるため推論を Web Worker に隔離する。 |
| [0002](0002-generation-guards-for-async-races.md) | 非同期待機中の入力変更を世代カウンタで無効化する | accepted | 2026-08-06 | encoder / decoder / 画像デコードの待機中に入力が変わる競合を、世代カウンタで古い結果を破棄することで塞ぐ。エラーが出ない誤表示を防ぐための不変条件。 |
| [0003](0003-verify-tests-fail-before-fixing.md) | 新しいテストは実装を壊して赤くなることを確認してから採用する | accepted | 2026-08-06 | jsdom の未実装 API が原因で「修正の有無にかかわらず通る」テストが混入するため、対象実装を一時的に壊して赤くなることを確認してからテストを採用する。 |
| [0004](0004-slimsam-box-input-unsupported.md) | SlimSAM-77-uniform の ONNX グラフは box 入力を持たない | accepted | 2026-08-06 | 現行モデル（Xenova/slimsam-77-uniform）の prompt_encoder_mask_decoder.onnx は image_embeddings / image_positional_embeddings / input_points / input_labels の4入力のみを宣言しており、input_boxes を渡しても ONNX ランタイムに黙って無視される。box プロンプトによる範囲指定は positive/negative 複数点で代替する。 |
| [0005](0005-offline-first-model-delivery.md) | モデル配信をオフライン完結型（自前ホスティング + Service Worker）に切り替える | accepted | 2026-08-08 | SAM モデル（Xenova/slimsam-77-uniform, Apache-2.0）と onnxruntime-web の WASM ランタイムを public/ 配下へ自前ホスティングし、Service Worker + Cache Storage で明示的にキャッシュすることで、初回アクセス後は外部（Hugging Face Hub / jsDelivr）に一切依存せずオフラインでも動作するようにした。進捗表示は転送先ファイルをまたいで自前集計する。 |
| [0006](0006-local-inference-server.md) | PCローカル推論サーバー（Node.js + onnxruntime-node）を追加し実行方式を選択可能にする | accepted | 2026-08-09 | SAM推論を、既存のブラウザ内蔵（WebGPU/WASM）実行に加えてPCローカル常駐サーバー（server/、Node.js + onnxruntime-node）でも実行できるようにした。ユーザーは実行方式を選択でき、ローカルサーバー方式では速度/精度違いのモデルも選択できる。既存のブラウザ内蔵実行パスは一切変更していない（機能追加）。 |
| [0007](0007-model-lab-verification-page.md) | 却下・保留したSAM代替モデル(MobileSAM/EdgeSAM/YOLO11n-seg/FastSAM)をWASM検証ページで動かせるようにする | accepted | 2026-08-11 | issue #34/ADR 0006で統合コスト・機能制約を理由に見送ったSAM代替モデル4種（MobileSAM・EdgeSAM・YOLO11n-seg・FastSAM）を、`transformers.js`を経由せず`onnxruntime-web`を直接呼ぶ専用実装で検証専用ページ（/model-lab）に統合した。既存の`/segment`ページ・`SamWorkerClient`・`samSession.ts`には一切影響を与えない機能追加。 |
