# smart-object-select

Photoshopの「オブジェクト選択ツール」相当をブラウザだけで実現することを目指していたSPA。
本編機能（`/segment`）は開発終了に伴い削除され、現在は検証用の **Model Lab**
（`/model-lab`）のみを残している（issue #59、`docs/adr/0008-scope-reduction-to-model-lab.md`参照）。

## Model Lab とは

MobileSAM・EdgeSAM・YOLO11n-seg・FastSAM の4モデルを、`onnxruntime-web` 直呼び出しで
ブラウザWASM実行して比較検証するためのページ。バックエンドを持たず、画像・推論結果とも
一切サーバーへ送信しない。詳細は [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) を参照。

Scaffolded from [my-boilerplate/react-spa](https://github.com/rengotaku/my-boilerplate/tree/main/boilerplates/react-spa).

## Getting Started

See the Makefile for available commands:

```bash
make help
```

## CI

CI workflow is at `.github/workflows/ci.yml`.

```bash
make ci
```

## License

This repository is licensed under the GNU Affero General Public License v3.0
(AGPL-3.0). See [`LICENSE`](LICENSE) for the full text.

Some bundled model assets under `public/models/` are derived from third-party
models with their own licenses (which may differ from this repository's
AGPL-3.0, e.g. Apache-2.0, non-commercial-only, or also AGPL-3.0). See the
`NOTICE` file alongside each model directory (e.g.
`public/models/yolo11n-seg/NOTICE`) for details.
