# smart-object-select

Scaffolded from [my-boilerplate/react-spa](https://github.com/rengotaku/my-boilerplate/tree/main/boilerplates/react-spa).

## Getting Started

See the Makefile for available commands:

```bash
make help
```

## PC ローカル推論サーバー（任意）

既定ではブラウザ内蔵（WebGPU/WASM）で推論するが、`/segment` 画面の「実行方式」で
「PCローカルサーバー」を選ぶと、PC上で別途起動したローカル常駐サーバー（`server/`、
Node.js + `onnxruntime-node`）に推論を任せられる。手順・API 仕様は
[`server/README.md`](server/README.md) を参照。

```bash
cd server
npm install
npm start   # http://127.0.0.1:8787 で待ち受け
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
