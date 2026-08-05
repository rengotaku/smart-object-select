# ADR 索引

<!-- generate-adr-index.zsh による自動生成。手で編集しない -->

| ADR | タイトル | status | date | 要旨 |
|---|---|---|---|---|
| [0001](0001-client-side-sam-in-web-worker.md) | SAM 推論をブラウザ内 Web Worker で実行する | accepted | 2026-08-06 | サーバーを持たず SlimSAM を transformers.js でブラウザ実行し、WASM フォールバック時の UI 凍結を避けるため推論を Web Worker に隔離する。 |
| [0002](0002-generation-guards-for-async-races.md) | 非同期待機中の入力変更を世代カウンタで無効化する | accepted | 2026-08-06 | encoder / decoder / 画像デコードの待機中に入力が変わる競合を、世代カウンタで古い結果を破棄することで塞ぐ。エラーが出ない誤表示を防ぐための不変条件。 |
| [0003](0003-verify-tests-fail-before-fixing.md) | 新しいテストは実装を壊して赤くなることを確認してから採用する | accepted | 2026-08-06 | jsdom の未実装 API が原因で「修正の有無にかかわらず通る」テストが混入するため、対象実装を一時的に壊して赤くなることを確認してからテストを採用する。 |
