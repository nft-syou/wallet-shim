---
name: wallet-shim
description: dApp のウォレット接続をブラウザ自動化で突破する。ページに偽の EIP-1193 / EIP-6963 プロバイダ（MetaMask 偽装）を注入し、指定アドレスまたは使い捨て鍵で接続済みに見せ、トランザクションは送らずに完了を返す。Use when a dApp blocks on "Connect Wallet", when MetaMask is unavailable in the automation browser, when E2E needs a connected wallet, or when the user says "ウォレット接続で止まる", "MetaMask なしで dApp を動かしたい", "接続済み状態でスクショ", "wallet shim", "fake wallet", "mock MetaMask".
allowed-tools: Bash(node:*), Bash(npx:*)
---

# wallet-shim

偽ウォレットをページに注入して dApp を先に進める。注入手段はツールごとに `recipes/` を見る。

## 手順

1. **設定を決める**
   - 任意アドレスの表示確認だけなら `--address 0x...`（署名は偽物）
   - SIWE などサーバー側で署名検証がある dApp なら鍵モード（`--generate-key` 既定、または `--private-key-file`）
   - `--chain sepolia` のように対象チェーンを合わせる。dApp が要求するチェーンと違うと `wallet_switchEthereumChain` が飛ぶ（既知チェーンなら自動で追従する）
2. **JS を得る**
   ```bash
   npx wallet-shim@latest --generate-key --chain sepolia --out <scratch>/shim.out.js --print-config
   ```
   stderr に接続アドレスが出る。鍵はカレントディレクトリの `.wallet-shim/` に保存される。npm 版は依存（`@noble/curves` / `@noble/hashes`）を同梱するので鍵モードもそのまま動く。
   npm に届かない環境では、リポジトリ（https://github.com/nft-syou/wallet-shim）を clone して `node bin/wallet-shim.mjs …` を使う（アドレスモードはそのまま動く。鍵モードは clone 先で一度 `npm install` が必要）
3. **注入する**: 使っているツールのレシピを読む
   - `recipes/agent-browser.md`（`open --init-script` が最も確実）
   - `recipes/playwright.md` / `recipes/puppeteer.md`
   - `recipes/claude-in-chrome.md`（ロード後注入のみ）
   - `recipes/orca-cli.md`（Orca 内蔵ブラウザ。`orca eval` + `<script src>` によるロード後注入。実証済み）
   - `recipes/devtools.md`
4. **接続を確認する**: eval で `window.__WALLET_SHIM__.calls.some(c => c.method === 'eth_requestAccounts')`
5. **操作後の検証**: `window.__WALLET_SHIM__.txs` に送信された tx（to / value / data）が入る。これが「実 TX の代わりの検証点」

## 制御 API（eval で使う）

| 呼び出し | 効果 |
|---|---|
| `__WALLET_SHIM__.calls` | 全リクエストの記録 |
| `__WALLET_SHIM__.txs` | 送信された tx と偽ハッシュ |
| `__WALLET_SHIM__.rejectNext('eth_sendTransaction')` | 次の送信をユーザー拒否（4001）にする |
| `__WALLET_SHIM__.override('eth_getBalance', '0xde0b6b3a7640000')` | 残高を 1 ETH に偽装 |
| `__WALLET_SHIM__.setChainId('0x2105')` | チェーン切替イベントを発火 |
| `__WALLET_SHIM__.setAccounts(['0x...'])` | アカウント切替イベントを発火 |
| `__WALLET_SHIM__.disconnect()` | 切断イベントを発火 |

## 既知の制約

- **ドライ運転**。tx はどこにも送られない。dApp が自前の HTTP transport で実 RPC にレシートをポーリングする構成（wagmi の `http()` transport 等）では「pending」のまま止まる。その場合は `calls` に `eth_sendTransaction` が記録された時点で送信成功と判定する。プロバイダ経由（`custom(window.ethereum)`）のポーリングなら合成レシートで完了する
- **偽署名モードは検証に通らない**。SIWE ログインが必要なら鍵モードにする
- **ロード前注入が原則**。wagmi 等は起動時に走査するので、ロード後注入で拾われないときはレシピ末尾のフォールバックに従う
- 本物の MetaMask が入ったプロファイルでは `window.ethereum` を上書きする（`replaceExisting: false` で回避可）
- agent-browser のデーモンが `open --init-script` で固まる環境がある（このプロジェクトを作成したマシンで発生）。1 分待って返らなければ `recipes/puppeteer.md` に切り替える。リポジトリの `test/e2e.mjs` が動作確認済みの puppeteer-core 実装

## やってはいけないこと

- 本番の秘密鍵を `--private-key` に渡さない
- `.wallet-shim/` をコミットしない（自動で gitignore される）
- 鍵モードの出力 JS には秘密鍵が含まれる。`--out` でファイルに出し、ターミナルに流さない

## 動作確認（リポジトリを clone した場合）

`npm install` → `npm run fixture`（別ターミナル）→ `node bin/wallet-shim.mjs --generate-key --chain sepolia --out .wallet-shim/shim.out.js` → `npm run e2e`。connect → sign → send → receipt を load-before / load-after の両方の注入方式で検証する。
