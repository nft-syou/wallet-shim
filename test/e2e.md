# E2E（手動、agent-browser）

前提: `npm install` 済み、`dist/shim.js` がビルド済み、agent-browser が使える（`npx agent-browser --version`）。

## 1. フィクスチャを立てる

```bash
npm run fixture          # http://localhost:3000
```

`npm run fixture` は起動前に `scripts/build-fixture.mjs`（esbuild）で viem をローカルに `test/fixture/vendor/viem.js` としてバンドルしてから `serve` を起動する。CDN（esm.sh 等）からは読み込まない — このマシンの agent-browser 経由の Chrome では esm.sh からの viem 依存グラフ読み込みが `document.readyState: interactive` のまま決定論的にデッドロックすることが分かっているため（個々の fetch は成功するのに `<script type="module">` の依存グラフ内で特定のリクエスト群だけが応答なしで残る）。フィクスチャだけをビルドし直したい場合は `npm run build:fixture` を使う。

## 2. 注入用 JS を作る

```bash
node bin/wallet-shim.mjs --generate-key --chain sepolia --out .wallet-shim/shim.out.js
```

ネットワークが無い環境、または viem のレシート待ちが公開 Sepolia RPC の到達性に依存して止まる場合は `--override eth_blockNumber="0x10"` を足す。

agent-browser のセッション衛生（必須）: すべてのコマンドに `--session wallet-shim-e2e` を付ける（または `export AGENT_BROWSER_SESSION=wallet-shim-e2e`）。`open` には `--headed false` を付けて必ずヘッドレスで起動する（このマシンの `~/.agent-browser/config.json` はユーザーの共有 Chrome プロファイルで `headed: true` をデフォルトにしており、`--headed false` を明示しないと共有プロファイルのロック競合で `open` が失敗する。agent-browser 0.37.x には `--headless` というフラグは存在しない — ヘッドレスがデフォルト動作であり、`--headed false` で config の `headed: true` を上書きする）。**`close --all` は絶対に使わないこと**（全セッションを閉じてしまい、他のユーザーセッションを巻き込む）。触ってよいのは自分が作った `wallet-shim-e2e` セッションだけ。デーモンが詰まったように見えたら、何かを kill するのではなく、正確な出力とともに BLOCKED として報告すること。

```bash
export AGENT_BROWSER_SESSION=wallet-shim-e2e
```

## 3. ロード前注入で開く

```bash
npx agent-browser --session wallet-shim-e2e open --headed false --init-script .wallet-shim/shim.out.js http://localhost:3000
npx agent-browser --session wallet-shim-e2e wait --text "detected: MetaMask"
npx agent-browser --session wallet-shim-e2e snapshot -i
npx agent-browser --session wallet-shim-e2e find text "Connect MetaMask" click
npx agent-browser --session wallet-shim-e2e wait --text "receipt: status=success"
npx agent-browser --session wallet-shim-e2e get text "#status"                     # => DONE
npx agent-browser --session wallet-shim-e2e eval "JSON.stringify(window.__WALLET_SHIM__.calls.map(c => c.method))"
npx agent-browser --session wallet-shim-e2e eval "JSON.stringify(window.__WALLET_SHIM__.txs)"
```

期待値:
- `calls` に `eth_requestAccounts`, `eth_chainId`, `personal_sign`, `eth_sendTransaction`, `eth_getTransactionReceipt` が含まれる
- `txs` に 1 件、`to` が接続アドレスと同じ

## 4. ロード後注入のフォールバック確認

```bash
npx agent-browser --session wallet-shim-e2e open --headed false http://localhost:3000
node bin/wallet-shim.mjs --address 0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf --format base64 --quiet > .wallet-shim/shim.b64
npx agent-browser --session wallet-shim-e2e eval -b "$(cat .wallet-shim/shim.b64)"
npx agent-browser --session wallet-shim-e2e wait --text "detected: MetaMask"      # 注入時の announce で検出される
npx agent-browser --session wallet-shim-e2e find text "Connect MetaMask" click
npx agent-browser --session wallet-shim-e2e wait --text "receipt: status=success"
```

PowerShell では `$b = Get-Content .wallet-shim/shim.b64 -Raw; npx agent-browser --session wallet-shim-e2e eval -b $b`。

## 5. 後片付け

```bash
npx agent-browser --session wallet-shim-e2e close
```

これは `wallet-shim-e2e` セッションだけを閉じる。`close --all` は使わない。`npm run fixture` のプロセスも自分で起動したものだけを停止する。

## 自動 E2E（puppeteer-core）

このマシンでは agent-browser 0.37.1 のデーモンが `open --init-script` の途中でハングし、`close`（セッション指定）も応答しなくなる事象が発生した（詳細は下記「最終確認」と `task-13-report.md` を参照）。デーモンやセッションを強制終了して復旧を試みるのではなく、agent-browser が既にダウンロード済みの Chrome バイナリを `puppeteer-core` で直接操作する形で、同じ E2E シナリオ（セクション3・4相当）を自動化して検証する。

```bash
npm run fixture &   # 別ターミナル、または run_in_background。http://localhost:3000 を確認してから次へ
node bin/wallet-shim.mjs --generate-key --chain sepolia --out .wallet-shim/shim.out.js
npm run e2e
```

`test/e2e.mjs` は以下を行う:
- Section A（ロード前注入相当）: `page.evaluateOnNewDocument(shim)` → `goto` → `#log` に `detected: MetaMask` が出るまで待機 → `Connect MetaMask` ボタンをクリック → `#status` が `DONE`/`ERROR` になるまで待機 → `calls`/`txs` を読む。
- Section B（ロード後注入相当）: 初期スクリプト無しで `goto` し、注入前は `detected:` が出ていないことを確認してから `page.evaluate(shim)` で後注入 → 以降は Section A と同様に `DONE` まで進める。
- 両セクションとも `#status` が `DONE` になり、`calls` に `eth_requestAccounts` / `eth_chainId` / `personal_sign` / `eth_sendTransaction` / `eth_getTransactionReceipt` が全て含まれていなければ exit code 1。シムの内容や秘密鍵は一切出力しない。

Chrome の実行パスは既定で `~/.agent-browser/browsers/chrome-152.0.7977.54/chrome.exe`（`WALLET_SHIM_CHROME` で上書き可）、フィクスチャの URL は既定で `http://localhost:3000`（`FIXTURE_URL` で上書き可）。viem のレシート待ちが公開 Sepolia RPC の到達性に依存して止まる場合は、シムを `--override eth_blockNumber="0x10"` 付きで作り直してから `npm run e2e` を再実行する。

---

最終確認: 2026-09-18、puppeteer-core 25.x + Chrome 152.0.7977.54（agent-browser 同梱バイナリを流用）で自動 E2E（`npm run e2e`）を実行し、Section A（ロード前注入）・Section B（ロード後注入）ともに `#status` が `DONE`、`calls` に `eth_requestAccounts, eth_chainId, personal_sign, eth_sendTransaction, eth_getTransactionReceipt` を全て確認（`--override eth_blockNumber` は不要、公開 Sepolia RPC への到達で完走）。このマシンでは agent-browser 0.37.1 経由の手順（セクション2〜5）はコマンド構文としては `--help`/`skills get core --full` で確認済みだが、`open --init-script` 実行中にデーモンがハングし（`session list` はセッションを "Active" と報告し続けるが、コマンドの応答が10分以上返らず、後続の `close`（セッション指定）も応答なし）、実機での完走確認には至らなかった。デーモン/Chrome プロセスを強制終了して復旧を試みることはせず（他のユーザーセッションを巻き込む事故を避けるため）、代わりに上記の puppeteer-core 経由の自動 E2E で動作を検証した。
