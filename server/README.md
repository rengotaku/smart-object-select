# smart-object-select ローカル推論サーバー

`src/lib/sam/samSession.ts`（純粋な TypeScript ロジック、ブラウザ非依存）をそのまま再利用し、
onnxruntime-node で SAM (SlimSAM) 推論を行うローカル常駐サーバー（issue #32）。

依存管理はルートの `package.json` / `package-lock.json` とは完全に分離されている。

## セットアップ

```bash
cd server
npm install
```

## 起動

```bash
npm start        # 本番相当（tsx で直接実行）
npm run dev       # ファイル変更を検知して再起動
```

既定ポートは `8787`。`SERVER_PORT` 環境変数で変更できる。
CORS の許可オリジンは既定で `http://localhost:5173`（Vite dev server）。
`SERVER_CORS_ORIGINS`（カンマ区切り）で追加できる。

## テスト

```bash
npm test
```

fake `SamRuntime` を DI したユニットテスト（`test/app.test.ts`）。実際の
onnxruntime-node / モデルファイルには依存しない。

## API

| メソッド | パス                    | 概要                                                       |
| -------- | ----------------------- | ------------------------------------------------------------ |
| GET      | `/health`                | 死活確認。`200 { status: "ok" }`                              |
| GET      | `/models`                 | 利用可能モデル一覧。`200 [{ id, name }]`                       |
| POST     | `/sessions`                | 画像を渡してセッションを作成し embedding を計算・保持する         |
| POST     | `/sessions/:id/segment`     | セッションの embedding を使って点プロンプトからマスクを生成する    |
| DELETE   | `/sessions/:id`             | セッションを破棄する                                          |

### `POST /sessions`

```json
{ "image": { "data": "<base64 RGBA bytes>", "width": 640, "height": 480 } }
```

→ `200 { "sessionId": "<uuid>" }`

### `POST /sessions/:id/segment`

```json
{ "points": [{ "x": 100, "y": 120, "label": 1 }] }
```

→ `200 { "masks": [{ "data": "<base64 0/1 per pixel>", "width": 640, "height": 480, "score": 0.95 }, ...] }`

（`masks` は score 降順。複数候補すべてを返す。存在しない `:id` は `404`）

### `DELETE /sessions/:id`

→ `204`（存在しない `:id` は `404`）
