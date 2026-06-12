# majsoul-log-bot

雀魂の友人戦（4人麻雀・2026/06/13以降）の対局履歴を記録・集計するWebアプリ。
Cloudflare Workers + Hono + D1 で動作する。

## 仕組み

1. メンバーの誰かがブラウザで牌譜を開く
2. ユーザースクリプトが牌譜データ（protobuf）をJSONにデコードし、`POST /api/games` へ自動送信
3. Workerが牌譜を解析してD1に保存（友人戦・4人麻雀・2026/06/13以降のみ。重複は無視）
4. Web画面で総合成績・対局一覧を閲覧

集計内容: Mリーグ式ポイント（ウマ30-10・オカ20、同点は順位点を等分）、平均順位、着順分布、和了率・放銃率・立直率・副露率、平均和了点・平均放銃点。

## セットアップ

```sh
pnpm install

# D1データベース作成 → 出力された database_id を wrangler.jsonc に設定
pnpm exec wrangler d1 create majsoul-log

# マイグレーション適用
pnpm run db:migrate:remote

# APIキー（任意のランダム文字列）を設定
pnpm exec wrangler secret put API_KEY

# デプロイ
pnpm run deploy
```

### ユーザースクリプト

1. Tampermonkey等に `userscript/majsoul-log-uploader.user.js` をインストール
2. スクリプト冒頭の `ENDPOINT`（WorkerのURL + `/api/games`）と `API_KEY` を書き換える
3. 雀魂で対象の牌譜を開くと自動送信される（成功すると画面上部に緑のトーストが出る）

## 開発

```sh
pnpm run db:migrate:local   # ローカルD1にマイグレーション
pnpm run dev                # http://localhost:8787 （APIキーは .dev.vars の API_KEY）
pnpm test                   # パーサーのユニットテスト
```
