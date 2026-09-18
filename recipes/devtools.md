# DevTools コンソールに手貼り

1. `node bin/wallet-shim.mjs --address 0x... --out shim.out.js`
2. 対象ページで DevTools（F12）→ Console
3. `shim.out.js` の中身を貼り付けて Enter
4. `window.__WALLET_SHIM__.config` で確認

Chrome の「Sources → Snippets」に保存しておけば毎回貼らずに済む。ロード後注入なので、リロードすると消える。

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
