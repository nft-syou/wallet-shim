# Puppeteer への注入

## ロード前（推奨）

```js
import puppeteer from 'puppeteer';
import { readFileSync } from 'node:fs';

const shim = readFileSync('shim.out.js', 'utf8');   // node bin/wallet-shim.mjs ... --out shim.out.js
const browser = await puppeteer.launch();
const page = await browser.newPage();
await page.evaluateOnNewDocument(shim);
await page.goto('https://app.example.com');
```

## ロード後（フォールバック）

```js
await page.evaluate(shim);
```

## 確認

```js
const txs = await page.evaluate(() => window.__WALLET_SHIM__.txs);
```

`test/e2e.mjs` に完全な実装例があります（ロード前は `evaluateOnNewDocument`、ロード後は `page.evaluate` で実行）。`npm run e2e` で実行できます。

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
