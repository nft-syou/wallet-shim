# agent-browser への注入

3 経路ある。ロード前注入（1, 2）を優先する。

## 1. `open --init-script`（推奨: 新規セッション）

```bash
node bin/wallet-shim.mjs --generate-key --chain sepolia --out ./shim.out.js
npx agent-browser --session wallet-shim open --headed false --init-script ./shim.out.js https://app.example.com
```

init script は以後そのセッションで開く全タブに適用される。

## 2. `addinitscript`（セッション起動後、次のナビゲーションから）

```bash
npx agent-browser --session wallet-shim open --headed false                                    # URL 無しでクリーン起動
npx agent-browser --session wallet-shim addinitscript "$(cat ./shim.out.js)"    # 識別子が返る
npx agent-browser --session wallet-shim open --headed false https://app.example.com
npx agent-browser --session wallet-shim removeinitscript <identifier>           # 外すとき
```

PowerShell: `npx agent-browser --session wallet-shim addinitscript (Get-Content ./shim.out.js -Raw)`

`--headless` というフラグは 0.37.x には無い。ヘッドレスは `--headed false`。

シムは 100KB 超なのでコマンドライン長の上限（cmd.exe は約 8K）に当たることがある。その場合は経路 1 の `--init-script <path>` を使う。

## 3. `eval -b`（ロード後注入。ページ JS 実行後なのでフォールバック）

```bash
node bin/wallet-shim.mjs --address 0x... --format base64 --quiet > ./shim.b64
npx agent-browser --session wallet-shim eval -b "$(cat ./shim.b64)"
```

## 動作確認

```bash
npx agent-browser --session wallet-shim eval "window.__WALLET_SHIM__ && window.__WALLET_SHIM__.config.address"
npx agent-browser --session wallet-shim eval "JSON.stringify(window.__WALLET_SHIM__.calls.map(c => c.method))"
```

## 注意

このプロジェクトを作成したマシンでは agent-browser 0.37.1 のデーモンが `open --init-script` で応答しなくなりました。`open` コマンドが 1 分以内に返らない場合は、デーモンを停止し、`test/e2e.mjs` に実装された working puppeteer-core の例を使用してください（`recipes/puppeteer.md` 参照）。また `close --all` はマシン上の全セッションを閉じるため使用しないでください。

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
