# wallet-shim 設計書

日付: 2026-09-18

## 目的

dApp をブラウザ自動化（agent-browser / Playwright / Puppeteer / claude-in-chrome / DevTools 手貼り）で動かすとき、ウォレット接続で止まる問題を解消する。ページに偽の EIP-1193 プロバイダを注入し、指定アドレス（または使い捨て鍵から導出したアドレス）で接続済みのように振る舞わせる。トランザクションは実際には送らず、送信完了として応答する（ドライ運転）。

注入手段には依存しない。コアは単一の自己完結 JS で、ツール別の注入手順は `recipes/` に分離する。

## 決定事項（ブレインストーミングの結論）

| 論点 | 決定 |
|---|---|
| 対象チェーン | EVM を先に実装。`src/chains/<name>/` を足せば他チェーンを追加できる構造にする |
| ウォレット検出 | `window.ethereum` + EIP-6963 `announceProvider` の両方 |
| 読み取り系 RPC | 実 RPC へパススルー。`overrides` で個別メソッドの応答を差し替え可能 |
| 署名 | `address` 指定なら決定的な偽署名。`privateKey` 指定なら本物の署名。どちらも無ければ使い捨て鍵を自動生成して導出したアドレスを使う |
| トランザクション | ドライ運転のみ。偽ハッシュを返し、プロバイダ経由のレシート問い合わせには成功レシートを合成して返す。フォーク実行モードは作らない |
| 入口 | ビルド CLI `node bin/wallet-shim.mjs`。設定を埋め込んだ単一 JS を出力する |
| 構成 | モジュール分割 + esbuild で `dist/shim.js` に単一 IIFE としてバンドル。`dist/` はコミットする |
| npm 公開 | 今回は行わないが、`bin` / `files` フィールドは先に書いておき後から `npx wallet-shim` にできるようにする |

## ファイル構成

```
wallet-shim/
├── SKILL.md                  # スキル本体（エージェント向け手順、トリガー語、注意事項）
├── README.md                 # クイックスタートと検証状況
├── package.json              # type: module。deps: @noble/curves, @noble/hashes。devDeps: esbuild, vitest, puppeteer-core, viem, serve
├── bin/
│   └── wallet-shim.mjs       # CLI 入口。`src/cli/index.js` の runCli を呼ぶだけ（Node 20+）
├── src/
│   ├── index.js              # ブラウザ側ブートストラップ。window.__WALLET_SHIM_CONFIG__ を読んで createShim を呼ぶ
│   ├── shim.js                # createShim。chain モジュールを解決して provider を組み立てる本体
│   ├── cli/
│   │   └── index.js          # runCli。引数解析・鍵の生成/読み込み・dist/shim.js への設定注入・出力
│   ├── core/
│   │   ├── config.js         # window.__WALLET_SHIM_CONFIG__ の読み込みと既定値
│   │   ├── emitter.js        # EIP-1193 準拠の on/removeListener/emit
│   │   ├── router.js         # method → handler 解決、overrides、passthrough
│   │   ├── passthrough.js    # 実 RPC への fetch 転送
│   │   ├── errors.js         # ProviderRpcError とエラーコード別メッセージ表
│   │   └── log.js            # console への統一ログ + window.__WALLET_SHIM__.calls 記録
│   ├── chains/
│   │   └── evm/
│   │       ├── provider.js   # EIP-1193 provider オブジェクト（isMetaMask 等）
│   │       ├── handlers.js   # eth_requestAccounts / chainId / sendTransaction / 署名 / receipt 等
│   │       ├── announce.js   # EIP-6963 announceProvider + window.ethereum 設置
│   │       └── constants.js  # チェーン ID 表（名前・公開 RPC）、MetaMask 用 uuid/icon
│   └── signing/
│       └── evm.js            # keccak256 + secp256k1（noble 経由）、address 導出、personal_sign / typedData v4
├── dist/
│   └── shim.js               # ビルド成果物（コミットする）
├── scripts/
│   ├── build.mjs              # esbuild で src/index.js → dist/shim.js（IIFE）
│   └── build-fixture.mjs      # esbuild で viem をローカルバンドルし test/fixture/vendor/viem.js を生成
├── recipes/
│   ├── agent-browser.md      # --init-script / addinitscript / eval の3経路
│   ├── playwright.md         # addInitScript
│   ├── puppeteer.md          # evaluateOnNewDocument
│   ├── claude-in-chrome.md   # javascript_tool（ロード後注入の制約つき）
│   └── devtools.md           # 手貼り
├── test/
│   ├── unit/                  # vitest。provider.request() を Node 上で直接叩く
│   │   └── helpers/evm.js     # 署名検証などユニットテスト共通ヘルパー
│   ├── fixture/
│   │   ├── index.html         # 検証用の最小 dApp（接続→署名→送信→レシートを実行）
│   │   ├── viem-entry.js      # build-fixture.mjs のバンドル入口（viem の再エクスポート）
│   │   └── vendor/            # build-fixture.mjs の生成物（viem.js）。gitignore 対象
│   ├── e2e.mjs                 # puppeteer-core による自動 E2E（load-before / load-after）
│   └── e2e.md                 # 手動 agent-browser E2E 手順（未検証、参考用）
└── docs/superpowers/specs/   # 本設計書
```

原則:

- `dist/shim.js` をコミットするので、`--address` 指定での利用は npm install 不要
- core は EVM を知らない。チェーン追加は `src/chains/<name>/` を足して `index.js` に登録する
- 注入手段はすべて `recipes/`。SKILL.md は共通フローだけを書く

## シムの振る舞い（EVM）

### 設置

初期化時に `window.ethereum` を定義する。既に本物がある場合、設定 `replaceExisting`（既定 true）なら上書き、false なら設置せず警告のみ出す。`eip6963:announceProvider` を即時 dispatch し、`eip6963:requestProvider` を listen して再 announce する。

announce の `info` は `{ uuid, name, rdns, icon }`。既定は `name: "MetaMask"`, `rdns: "io.metamask"`、設定で差し替え可能。uuid は初期化ごとに生成する。

プロバイダは `isMetaMask: true`、`_metamask.isUnlocked()` → `true`、`isConnected()`、`request`、`on`、`removeListener`、`enable`（`eth_requestAccounts` の別名）、`selectedAddress`、`chainId`、`networkVersion` を持つ。レガシー `send` / `sendAsync` も `request` に委譲する形で用意する。

### 接続とチェーン

| メソッド | 応答 |
|---|---|
| `eth_requestAccounts` | `[address]`。初回に `connect` イベント（`{ chainId }`）を emit し接続済みにする |
| `eth_accounts` | 接続済みなら `[address]`。`autoConnect: true`（既定）なら未接続でも `[address]`、false なら `[]`。`disconnect()` / `wallet_revokePermissions` の後は `autoConnect` に関わらず `[]`（`eth_requestAccounts` で復帰） |
| `eth_chainId` | 設定の `chainId`（16進） |
| `net_version` | `chainId` の10進文字列 |
| `wallet_switchEthereumChain` | 既知チェーン（`constants.js` の表、または `wallet_addEthereumChain` で登録済み）なら切替えて `chainChanged` を emit し `null` を返す。未知なら 4902。`allowAnyChain: true` なら未知でも受け入れる |
| `wallet_addEthereumChain` | チェーンを登録して `null` |
| `wallet_requestPermissions` / `wallet_getPermissions` | `[{ parentCapability: "eth_accounts", caveats: [...] }]`。`date` は接続ごとに一度だけ採番して固定する（`permissionsGrantedAt`）。呼ぶたびに変わらない |
| `wallet_watchAsset` | `true` |
| `wallet_revokePermissions` | 切断して `null` |

### 署名

`personal_sign`、`eth_sign`、`eth_signTypedData`、`eth_signTypedData_v3`、`eth_signTypedData_v4` を扱う。

- `privateKey` あり: `signing/evm.js` で本物の署名を返す。`personal_sign` は EIP-191、typedData は EIP-712（v4 のエンコード。v3 / v1 も同じ経路で処理する）
- `privateKey` なし: `keccak256(method + JSON.stringify(params))` を r、その keccak を s として組み立てた決定的な偽 65 バイト（v = `1b`）を返す

署名対象アドレスが接続アドレスと一致しない場合は 4100 エラー。

`toBytes` は `0x` / `0X` どちらのプレフィックスも受け付ける。EIP-712 のエンコードは、値が欠けているフィールドがあれば `EIP-712: missing value for field of type <type>`、`bytesN` の長さが宣言と違えば `EIP-712: <type> expects <n> bytes, got <m>` という明示的なエラーを投げる（黙って切り詰め/ゼロ埋めしない）。

### トランザクション（ドライ運転）

- `eth_sendTransaction`: tx を `txs` に記録し、`keccak256(JSON.stringify(tx) + nonce)` を偽ハッシュとして返す。`from` が接続アドレスと違えば 4100
- `eth_getTransactionReceipt` / `eth_getTransactionByHash`: `txs` にあるハッシュなら合成レシートを返す。`status: "0x1"`, `blockNumber` は直近の `eth_blockNumber` のパススルー結果（失敗時は `"0x1"`）, `gasUsed: "0x5208"`, `logs: []`。無いハッシュはパススルー
- `eth_estimateGas`: 既定 `"0x5208"`。設定 `estimateGas: "passthrough"` で転送
- `eth_signTransaction`: 署名済み raw tx の代わりに偽ハッシュと同様の決定的 bytes を返す
- `eth_sendRawTransaction`: 記録して偽ハッシュを返す

### パススルーと上書き

解決順は `overrides` → 組み込みハンドラ → パススルー。

- `overrides[method]` が関数なら `(params, ctx) => result` として呼ぶ。それ以外の値はそのまま返す
- パススルーは `rpcUrl` に JSON-RPC 2.0 で `fetch` する。`rpcUrl` 未設定なら `chainId` に対応する公開 RPC を `constants.js` の表から選ぶ。表に無ければ 4200 (unsupported method)
- RPC がエラーを返した場合はそのエラーオブジェクトをそのまま reject する
- HTTP レベルで失敗した場合（`res.ok` が false）は `RPC HTTP <status>` とだけ reject する。`rpcUrl`（API キーを含みうる）はメッセージに含めない

### 制御 API

`window.__WALLET_SHIM__` に公開する。

| API | 内容 |
|---|---|
| `calls` | 全 request の `{ method, params, result?, error?, at }` 配列 |
| `txs` | `{ hash, tx, at }` の配列 |
| `rejectNext(method?, code = 4001)` | 次のリクエスト（method 指定時はそのメソッドの次）をユーザー拒否エラーにする |
| `setAccounts(addresses)` | 接続アドレスを切替えて `accountsChanged` を emit |
| `setChainId(hex)` | チェーンを切替えて `chainChanged` を emit |
| `disconnect()` | 切断して `disconnect` イベントを emit。以後 `eth_accounts` は `[]`、`isConnected()` は false |
| `override(method, fn \| value)` | 実行時に overrides を追加する（関数型はここでしか登録できない） |
| `config` | 適用済みの設定（秘密鍵は含めない） |
| `version` | シムのバージョン |

### エラーコード

EIP-1193 / EIP-1474 に従う。4001 user rejected、4100 unauthorized、4200 unsupported method、4900 disconnected、4902 unrecognized chain、-32601 method not found、-32602 invalid params。エラーオブジェクトは `{ code, message, data? }` を持つ `Error` インスタンス。

### ログ

全 request を `[wallet-shim] <method> → <result>` の形で `console.debug` に出す。`verbose: false` で抑制。秘密鍵は決してログに出さない。

## CLI と設定

### コマンド

```
node bin/wallet-shim.mjs [options]
```

| オプション | 既定 | 説明 |
|---|---|---|
| `--address <0x…>` | なし | 接続アドレス。偽署名モード |
| `--private-key <0x…>` | なし | 本物署名モード。アドレスは導出 |
| `--private-key-file <path>` | なし | ファイルから秘密鍵を読む |
| `--generate-key` | なし | 使い捨て鍵を生成。`--address` / `--private-key` のいずれも無ければ自動でこれになる |
| `--chain <id \| name>` | `1` | 10進、16進、または名前（`sepolia`, `base` 等） |
| `--rpc <url>` | チェーン表の公開 RPC | パススルー先 |
| `--name <str>` / `--rdns <str>` | `MetaMask` / `io.metamask` | EIP-6963 の表示名 |
| `--override <method>=<json>` | なし | 繰り返し可。固定値の上書き |
| `--config <path.json>` | なし | 設定 JSON。CLI フラグが優先 |
| `--out <path>` | stdout | 出力先 |
| `--format iife \| base64` | `iife` | `base64` は agent-browser `eval -b` 向け |
| `--print-config` | なし | 最終設定と生成/導出アドレスを stderr に表示 |
| `--quiet` | なし | stderr の案内を抑制 |

### 出力の形

```js
window.__WALLET_SHIM_CONFIG__ = {"chain":"evm","address":"0x…","chainId":"0x1",…};
(() => { /* dist/shim.js */ })();
```

### 鍵の扱い

- 生成は `node:crypto` の `randomBytes(32)`。アドレス導出は `@noble/secp256k1` + `@noble/hashes`（通常の dependency、鍵モード時のみ動的 import）
- noble が未インストールなら「address 指定なら依存不要。鍵モードは `npm install` が必要」と案内して終了
- 生成鍵はコマンドラインや stdout に出さない。カレントディレクトリの `.wallet-shim/key-<address>.txt` に保存し、stderr にパスだけ出す。`.wallet-shim/` は `.gitignore` に含める
- 同じアドレスで再実行するときは `--private-key-file` で読ませる
- 鍵モードの出力 JS（`dist/shim.js` に設定を差し込んだもの）には、シムがその場で署名するために秘密鍵そのものが必然的に埋め込まれる。stderr のログと `--print-config` の出力には秘密鍵を絶対に出さない（アドレスと鍵ファイルパスのみ）。鍵モードでは出力を `--out` でファイルに書き、標準出力やターミナルに流さないことを強く推奨する
- `.wallet-shim/.gitignore` は実行のたびに内容を `*` で上書きする（手動編集されていても常に全無視の状態に戻す）

### 設定スキーマ

`--config` の JSON と `window.__WALLET_SHIM_CONFIG__` は同じスキーマ。

```json
{
  "chain": "evm",
  "address": "0x…",
  "privateKey": null,
  "chainId": "0xaa36a7",
  "rpcUrl": "https://…",
  "name": "MetaMask",
  "rdns": "io.metamask",
  "autoConnect": true,
  "replaceExisting": true,
  "allowAnyChain": false,
  "estimateGas": "0x5208",
  "overrides": {},
  "verbose": true
}
```

### package.json

```json
{
  "name": "wallet-shim",
  "type": "module",
  "bin": { "wallet-shim": "bin/wallet-shim.mjs" },
  "files": ["bin", "dist", "src", "recipes", "SKILL.md", "README.md"],
  "engines": { "node": ">=20" },
  "scripts": {
    "build": "node scripts/build.mjs",
    "build:fixture": "node scripts/build-fixture.mjs",
    "test": "vitest run",
    "fixture": "node scripts/build-fixture.mjs && serve test/fixture -l 3000",
    "e2e": "node test/e2e.mjs"
  },
  "devDependencies": {
    "puppeteer-core": "...",
    "viem": "...",
    "serve": "...",
    "esbuild": "...",
    "vitest": "..."
  }
}
```

`files` に `src` を含めるので `npm pack` でもソースが配布される。`fixture` は `build-fixture.mjs` で viem をローカルバンドルしてから配信する（CDN からは読まない）。公開は今回行わない。

## 注入レシピと SKILL.md

### 注入タイミングの原則

ページ JS より前に注入するのが正解。wagmi / viem は起動直後に `window.ethereum` と EIP-6963 を走査し、後から announce しても拾わない実装がある。

| ツール | ロード前（推奨） | ロード後（フォールバック） |
|---|---|---|
| agent-browser | `open --init-script shim.out.js` または `addinitscript` してから `open <url>` | `eval -b <base64>` してから `navigate` し直す |
| Playwright | `context.addInitScript({ path })` | `page.evaluate` |
| Puppeteer | `page.evaluateOnNewDocument` | `page.evaluate` |
| claude-in-chrome | 無し（拡張の制約） | `javascript_tool` で注入 |
| DevTools 手貼り | 無し | コンソールに貼り付け |

ロード後注入のフォールバック手順（各レシピに記載）:

1. シムは注入時に `eip6963:announceProvider` を dispatch するので、まずウォレット選択 UI を開き直す
2. 出なければ `window.dispatchEvent(new Event("eip6963:requestProvider"))` を eval する
3. それでも出なければページをリロードせずに接続ボタンを直接押す（`window.ethereum` 直読みの dApp 向け）

### SKILL.md の構成

1. トリガー: 「ウォレット接続で止まる」「MetaMask なしで dApp を動かしたい」「接続済み状態で E2E」「dApp のスクショを撮りたいがウォレットが要る」
2. 手順
   1. 設定を決める（アドレス指定か鍵生成か、チェーン、RPC）
   2. `node bin/wallet-shim.mjs … --out <scratchpad>/shim.out.js --print-config` で JS を得る
   3. 使っているブラウザツールの `recipes/<tool>.md` を読み、ロード前注入を試す
   4. 接続後に `window.__WALLET_SHIM__.calls` を eval で読み、`eth_requestAccounts` が記録されたことを確認する
   5. 操作後は `__WALLET_SHIM__.txs` で送信された tx の中身を検証する
3. 既知の制約
   - ドライ運転なので、dApp が自前の HTTP transport で実 RPC のレシートをポーリングする構成では pending のまま止まる。`calls` に `eth_sendTransaction` が記録された時点で送信成功と判定する
   - 偽署名モードでは SIWE 等のサーバー検証が通らない。鍵生成モードに切り替える
   - 本物のウォレットが同居するプロファイルでは `replaceExisting` に注意
4. やってはいけないこと: 本番の秘密鍵を渡さない。生成鍵はコミットしない

### 配置

`~/.agents/skills/wallet-shim` → このリポジトリへ symlink し、`~/.claude/skills/wallet-shim` からも辿れるようにする（agent-browser と同じ方式）。

## テストと検証

### ユニットテスト（vitest）

`src/` のブラウザ依存は `window`、`fetch`、`console` の3つに限定する。テストでは `globalThis.window = { dispatchEvent, addEventListener }` の最小スタブを与え、`provider.request()` を直接叩く。

- `eth_requestAccounts` が `[address]` を返し `connect` を1回だけ emit する
- `wallet_switchEthereumChain` で `chainChanged` が emit され、未知チェーンは 4902、`allowAnyChain` なら通る
- `eth_sendTransaction` → `eth_getTransactionReceipt` で `status: "0x1"` の合成レシートが返る
- `overrides` が組み込みより優先され、組み込みがパススルーより優先される。パススルーは `fetch` をモックして JSON-RPC の形を検証
- `rejectNext()` で 4001 が返り、次のリクエストは通常に戻る
- 署名: `privateKey` 指定時の `personal_sign` を noble の `recoverPublicKey` で検証しアドレスが一致する。`eth_signTypedData_v4` は viem の既知テストベクタと一致する
- 偽署名モードでは同じ入力に対して同じ署名が返る
- CLI: `--address` / `--generate-key` / `--config` の出力先頭行が正しい JSON。`--format base64` を decode すると iife と一致する。`--generate-key` の鍵が stdout / stderr に出ない

### フィクスチャ dApp

`test/fixture/index.html`。viem は CDN（esm.sh 等）からは読まない。CDN 経由だと自動化ブラウザ上で ESM のモジュールグラフ解決が止まる事象が起きたため、`scripts/build-fixture.mjs`（esbuild、`test/fixture/viem-entry.js` を入口）でローカルに `test/fixture/vendor/viem.js` としてバンドルし、それを `<script type="module">` から読む。`npm run build:fixture` または `npm run fixture`（ビルド＋配信）で生成する。EIP-6963 で検出したウォレット一覧を表示 → 接続 → `personal_sign` → `sendTransaction` → レシート待ちを順に行い、各結果を `<pre id="log">` に書き出す。`npm run fixture`（内部で `npx serve test/fixture -l 3000`）で立つ。

### E2E

`test/e2e.mjs` で自動化した。puppeteer-core で、agent-browser が `npx agent-browser install` 時にダウンロードした Chrome（既定パス、`WALLET_SHIM_CHROME` で上書き可）を直接操作する。フィクスチャを起動し、生成した shim JS を load-before（`page.evaluateOnNewDocument`）と load-after（`page.evaluate`）の両方の経路で注入して、それぞれ connect → sign → send → receipt が完了することを確認する。`npm run e2e` で実行する。

agent-browser 経由の手動手順は `test/e2e.md` に残しているが、このマシンでは `agent-browser open --init-script` 実行中にデーモンが固まり検証できなかった（未検証。参考手順として置いてある）。

### 完成の定義

- `npm test` が通り、`npm run build` で `dist/shim.js` が再生成される
- `npm run e2e` が load-before / load-after の両方で DONE に到達し、`calls` に eth_requestAccounts / eth_chainId / personal_sign / eth_sendTransaction / eth_getTransactionReceipt が含まれる（agent-browser 経由の手順は `recipes/` と `test/e2e.md` に文書化してあるが、このマシンでは未検証）
- `recipes/` の5ファイルと SKILL.md が揃い、`~/.agents/skills/wallet-shim` から参照できる

## スコープ外

- フォーク実行モード（Anvil への転送）
- 複数ウォレットの同時偽装、`window.ethereum.providers`
- Solana 等の他チェーン（構造だけ用意する）
- npm 公開
