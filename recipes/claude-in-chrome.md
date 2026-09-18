# claude-in-chrome（Chrome 拡張）への注入

この拡張にはロード前注入の経路が無い。`javascript_tool` によるロード後注入のみ。EIP-6963 対応 dApp（wagmi / RainbowKit / Web3Modal / ConnectKit 等）なら注入時の announce で拾われることが多い。

## 手順

1. `node bin/wallet-shim.mjs --address 0x... --out shim.out.js` で JS を作る
2. 対象ページをタブで開く（`navigate`）
3. `javascript_tool` に `shim.out.js` の中身をそのまま渡して実行する。ファイルが大きいときは `--format base64` で出力し、`(0, eval)(atob("<base64>"))` を実行する
4. `javascript_tool` で `window.__WALLET_SHIM__.config.address` を読んで注入を確認する
5. ページの Connect ボタンを押す。ウォレット一覧に MetaMask が出るのでそれを選ぶ

## 制約

- ページを再読み込みするとシムは消える。SPA 内の遷移なら残る
- `alert` / `confirm` を出す dApp では javascript_tool がブロックされるので注意

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
