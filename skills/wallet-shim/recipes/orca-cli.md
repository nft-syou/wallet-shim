# Orca 内蔵ブラウザ（orca-cli）への注入

Orca の内蔵ブラウザにはロード前注入（init script）の経路が無い。`orca eval` によるロード後注入のみ。EIP-6963 対応 dApp なら注入時の announce で拾われる（フィクスチャで実証済み、2026-09-19）。

## 前提

- `orca status --json` で `app.running: true` を確認する
- 130KB のシムをコマンドライン引数で渡すと Windows の引数長上限に当たる。**シムを HTTP で配信し、`<script src>` で読み込む**方式にする

## 手順

1. シムを生成し、dApp と同一オリジンで配信できる場所に置く（フィクスチャなら `test/fixture/vendor/` が `npm run fixture` で配信される。gitignore 対象）

```bash
node bin/wallet-shim.mjs --generate-key --chain sepolia --out test/fixture/vendor/shim.out.js
```

別オリジンの dApp を相手にする場合は、シムを配信する小さなローカルサーバー（`npx serve <dir> -l 3999` 等）を立て、`s.src` をそのフル URL にする。`<script src>` は CORS の制約を受けないので別オリジンでも読み込める。

2. タブを開き、`browserPageId` を控える

```bash
orca tab create --url http://localhost:3000/ --json      # result.browserPageId を以後 --page に渡す
```

3. ロードを確認してから `<script>` タグで注入する

```bash
orca eval --page <id> --expression "document.readyState" --json
orca eval --page <id> --expression "(function(){var s=document.createElement('script');s.src='/vendor/shim.out.js';document.head.appendChild(s);return 'injected';})()" --json
```

4. 検出と設置を確認する

```bash
orca eval --page <id> --expression "typeof window.ethereum + '|' + (window.__WALLET_SHIM__ && window.__WALLET_SHIM__.config.address)" --json
```

5. 接続ボタンを押す。`orca snapshot` / `orca click` / `orca wait` は内部の agent-browser ヘルパーが stale だと `browser_owner_unavailable` で失敗することがある。その場合は JS でクリックする

```bash
orca eval --page <id> --expression "(function(){var b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Connect MetaMask'); b && b.click(); return !!b;})()" --json
```

6. 結果を読む

```bash
orca eval --page <id> --expression "JSON.stringify(window.__WALLET_SHIM__.calls.map(c=>c.method))" --json
orca eval --page <id> --expression "JSON.stringify(window.__WALLET_SHIM__.txs)" --json
```

7. 終わったらタブを閉じる（`orca tab list --json` で index を引いて `orca tab close --index <n> --json`）。配信用にコピーしたシム（鍵入り）は削除する。

## 実証結果（2026-09-19、Orca 1.4.205）

フィクスチャ dApp に対して上記手順で `detected: MetaMask` → 接続 → `personal_sign` → `eth_sendTransaction` → 合成レシート（実 Sepolia RPC のブロック番号）まで `DONE` に到達。`calls` は `eth_requestAccounts, eth_chainId, personal_sign, eth_sendTransaction, eth_getTransactionReceipt`。`orca wait` / `snapshot` / `click` はヘルパー stale で失敗したため JS クリックで代替した。

## ロード後注入で dApp がウォレットを拾わないとき

1. ウォレット選択 UI（Connect ボタン）をいったん閉じて開き直す。シムは注入時に `eip6963:announceProvider` を dispatch している
2. それでも出なければ `window.dispatchEvent(new Event("eip6963:requestProvider"))` を eval する
3. `window.ethereum` を直接読む dApp なら、リロードせずに接続ボタンを押す
4. 上記で駄目なら、そのツールのロード前注入経路（あれば）に切り替える。wagmi / RainbowKit は起動時の走査結果をキャッシュすることがある

## 確認コマンド（eval で）

- 接続されたか: `window.__WALLET_SHIM__.calls.some(c => c.method === 'eth_requestAccounts')`
- 送信された tx: `JSON.stringify(window.__WALLET_SHIM__.txs)`
- 拒否を再現: `window.__WALLET_SHIM__.rejectNext('eth_sendTransaction')`
- 残高を偽装: `window.__WALLET_SHIM__.override('eth_getBalance', '0xde0b6b3a7640000')`
