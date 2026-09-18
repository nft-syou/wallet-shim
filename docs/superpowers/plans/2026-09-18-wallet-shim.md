# wallet-shim 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ブラウザ自動化ツールから dApp に注入できる偽 EIP-1193 プロバイダ（MetaMask 偽装）と、それを設定込みの単一 JS として出力する CLI、ツール別注入レシピ、SKILL.md を作る。

**Architecture:** `src/core/` はチェーン非依存のルータ・イベント・記録・パススルー、`src/chains/evm/` が EVM のメソッド実装と EIP-6963 announce、`src/signing/evm.js` が keccak / secp256k1 / EIP-712。esbuild で `dist/shim.js`（IIFE）にバンドルしてコミットし、`bin/wallet-shim.mjs` がその先頭に `window.__WALLET_SHIM_CONFIG__` を差し込んで出力する。

**Tech Stack:** Node 20+ (ESM)、esbuild、vitest、@noble/curves 2.x、@noble/hashes 2.x、viem（テスト検証用 devDependency）、serve（フィクスチャ配信）

**Spec:** `docs/superpowers/specs/2026-09-18-wallet-shim-design.md`

## Global Constraints

- Node `>=20`、`"type": "module"`。すべて ESM、`.js` 拡張子付き import
- `src/` のブラウザ依存は `window` / `fetch` / `console` の3つに限定し、すべて `env` オブジェクト経由で受け取る（テストで差し替えるため）
- noble 2.x は import パスに `.js` が必須（`@noble/hashes/sha3.js`, `@noble/curves/secp256k1.js`）
- noble-curves 2.x の `sign` は既定でメッセージを sha256 する。Ethereum では必ず `{ prehash: false }` を渡す
- 秘密鍵を `console` / stderr / `--print-config` に出さない。生成鍵は `.wallet-shim/` 配下のみ
- エラーは `ProviderRpcError`（`code`, `message`, `data?`）。コードは 4001 / 4100 / 4200 / 4900 / 4902 / -32601 / -32602 / -32603
- 解決順は `overrides` → 組み込みハンドラ → パススルー
- `dist/shim.js` はコミットする。`src/` を変更したら `npm run build` して dist も同じコミットに含める
- コミットメッセージ末尾に `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` を付ける
- 応答・ドキュメントは日本語、コード内コメントと識別子は英語

## ファイル構成（最終形）

```
wallet-shim/
├── SKILL.md
├── README.md
├── package.json
├── vitest.config.js
├── .gitignore
├── bin/wallet-shim.mjs            # runCli を呼ぶだけ
├── scripts/build.mjs              # esbuild
├── src/
│   ├── index.js                   # バンドルのエントリ。window から config を読み createShim
│   ├── shim.js                    # createShim(config, env)。チェーンレジストリ
│   ├── version.js
│   ├── core/{errors,emitter,config,log,passthrough,router}.js
│   ├── chains/evm/{constants,handlers,provider,announce}.js
│   ├── signing/evm.js
│   └── cli/index.js               # runCli(argv, io)
├── dist/shim.js
├── recipes/{agent-browser,playwright,puppeteer,claude-in-chrome,devtools}.md
├── test/
│   ├── unit/*.test.js
│   ├── fixture/index.html
│   └── e2e.md
└── docs/superpowers/{specs,plans}/
```

---

### Task 1: プロジェクト雛形とビルド/テスト基盤

**Files:**
- Create: `package.json`, `vitest.config.js`, `.gitignore`, `scripts/build.mjs`, `src/version.js`, `src/index.js`（仮）, `test/unit/smoke.test.js`

**Interfaces:**
- Produces: `npm test`（vitest run）、`npm run build`（`dist/shim.js` 生成）、`VERSION` 定数

- [ ] **Step 1: package.json を作る**

```json
{
  "name": "wallet-shim",
  "version": "0.1.0",
  "description": "Fake EIP-1193 (MetaMask-compatible) provider for dApp browser automation. Injects a connected wallet, dry-runs transactions.",
  "type": "module",
  "license": "MIT",
  "bin": { "wallet-shim": "bin/wallet-shim.mjs" },
  "files": ["bin", "dist", "src", "recipes", "SKILL.md", "README.md"],
  "engines": { "node": ">=20" },
  "scripts": {
    "build": "node scripts/build.mjs",
    "test": "vitest run",
    "test:watch": "vitest",
    "fixture": "serve test/fixture -l 3000"
  },
  "dependencies": {
    "@noble/curves": "^2.4.0",
    "@noble/hashes": "^2.4.0"
  },
  "devDependencies": {
    "esbuild": "^0.28.2",
    "serve": "^14.2.6",
    "viem": "^2.56.8",
    "vitest": "^5.0.1"
  }
}
```

- [ ] **Step 2: .gitignore と vitest.config.js**

`.gitignore`:
```
node_modules/
.wallet-shim/
*.out.js
```

`vitest.config.js`:
```js
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/unit/**/*.test.js'],
    environment: 'node',
  },
});
```

- [ ] **Step 3: version.js と仮の index.js、ビルドスクリプト**

`src/version.js`:
```js
// Replaced by esbuild `define` at build time; stays 'dev' under vitest.
export const VERSION =
  typeof __WALLET_SHIM_VERSION__ !== 'undefined' ? __WALLET_SHIM_VERSION__ : 'dev';
```

`src/index.js`（Task 10 で置き換える仮実装）:
```js
import { VERSION } from './version.js';
console.debug(`[wallet-shim] v${VERSION}`);
```

`scripts/build.mjs`:
```js
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

await build({
  entryPoints: ['src/index.js'],
  bundle: true,
  format: 'iife',
  target: ['es2020'],
  outfile: 'dist/shim.js',
  minify: false,
  legalComments: 'none',
  define: { __WALLET_SHIM_VERSION__: JSON.stringify(pkg.version) },
  banner: {
    js: `/* wallet-shim v${pkg.version} - fake EIP-1193 provider for dApp browser automation. Do not use with real keys. */`,
  },
});
console.log('built dist/shim.js');
```

- [ ] **Step 4: スモークテストを書く**

`test/unit/smoke.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { VERSION } from '../../src/version.js';

describe('smoke', () => {
  it('exposes a dev version under vitest', () => {
    expect(VERSION).toBe('dev');
  });
});
```

- [ ] **Step 5: インストールしてテストとビルドを走らせる**

Run: `npm install && npm test && npm run build && head -c 200 dist/shim.js`
Expected: テスト 1 件 PASS。`dist/shim.js` の先頭に banner と `v0.1.0` が入っている

- [ ] **Step 6: コミット**

```bash
git add package.json package-lock.json vitest.config.js .gitignore scripts src test dist
git commit -m "chore: プロジェクト雛形（esbuild / vitest / noble）

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: core — errors / emitter / config

**Files:**
- Create: `src/core/errors.js`, `src/core/emitter.js`, `src/core/config.js`
- Test: `test/unit/core-basics.test.js`

**Interfaces:**
- Produces:
  - `class ProviderRpcError extends Error { code: number; data?: unknown }`
  - `errors.userRejected(msg?)`, `errors.unauthorized(msg?)`, `errors.unsupportedMethod(method)`, `errors.disconnected()`, `errors.unrecognizedChain(chainId)`, `errors.methodNotFound(method)`, `errors.invalidParams(msg?)`, `errors.internal(msg)`, `errors.fromRpc({code,message,data})`, `errors.byCode(code, msg?)`
  - `createEmitter() → { on, addListener, once, off, removeListener, emit, listenerCount }`
  - `DEFAULTS`, `normalizeChainId(input) → '0x..'`, `resolveConfig(raw) → config`, `publicConfig(config) → 秘密鍵を除いた設定`

- [ ] **Step 1: 失敗するテストを書く**

`test/unit/core-basics.test.js`:
```js
import { describe, it, expect, vi } from 'vitest';
import { ProviderRpcError, errors } from '../../src/core/errors.js';
import { createEmitter } from '../../src/core/emitter.js';
import { DEFAULTS, normalizeChainId, resolveConfig, publicConfig } from '../../src/core/config.js';

const ADDR = '0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf';

describe('errors', () => {
  it('builds EIP-1193 errors with codes', () => {
    expect(errors.userRejected().code).toBe(4001);
    expect(errors.unauthorized().code).toBe(4100);
    expect(errors.unsupportedMethod('x').code).toBe(4200);
    expect(errors.disconnected().code).toBe(4900);
    expect(errors.unrecognizedChain('0x5').code).toBe(4902);
    expect(errors.methodNotFound('x').code).toBe(-32601);
    expect(errors.invalidParams().code).toBe(-32602);
    expect(errors.userRejected()).toBeInstanceOf(Error);
    expect(errors.userRejected()).toBeInstanceOf(ProviderRpcError);
  });
  it('wraps RPC errors keeping code/message/data', () => {
    const e = errors.fromRpc({ code: -32000, message: 'boom', data: '0xdead' });
    expect(e.code).toBe(-32000);
    expect(e.message).toBe('boom');
    expect(e.data).toBe('0xdead');
  });
  it('byCode uses the default message for known codes', () => {
    expect(errors.byCode(4001).message).toMatch(/rejected/i);
    expect(errors.byCode(4001, 'custom').message).toBe('custom');
  });
});

describe('emitter', () => {
  it('emits to listeners and supports removal', () => {
    const em = createEmitter();
    const fn = vi.fn();
    em.on('x', fn);
    em.emit('x', 1, 2);
    expect(fn).toHaveBeenCalledWith(1, 2);
    em.removeListener('x', fn);
    em.emit('x', 3);
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it('once fires a single time and a throwing listener does not break others', () => {
    const em = createEmitter();
    const a = vi.fn(() => { throw new Error('bad'); });
    const b = vi.fn();
    em.once('x', a);
    em.on('x', b);
    em.emit('x');
    em.emit('x');
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);
    expect(em.listenerCount('x')).toBe(1);
  });
});

describe('config', () => {
  it('normalizes chain ids from number, hex and decimal string', () => {
    expect(normalizeChainId(1)).toBe('0x1');
    expect(normalizeChainId('0xAA36A7')).toBe('0xaa36a7');
    expect(normalizeChainId('11155111')).toBe('0xaa36a7');
    expect(() => normalizeChainId('sepolia')).toThrow(/Invalid chainId/);
  });
  it('applies defaults and validates address', () => {
    const cfg = resolveConfig({ address: ADDR, chainId: 11155111 });
    expect(cfg.name).toBe(DEFAULTS.name);
    expect(cfg.chainId).toBe('0xaa36a7');
    expect(cfg.address).toBe(ADDR);
    expect(() => resolveConfig({ address: '0x123' })).toThrow(/Invalid address/);
    expect(() => resolveConfig({})).toThrow(/address or privateKey/);
    expect(() => resolveConfig({ privateKey: '0xabc' })).toThrow(/privateKey/);
  });
  it('does not share the overrides object with the input', () => {
    const raw = { address: ADDR, overrides: { eth_getBalance: '0x1' } };
    const cfg = resolveConfig(raw);
    cfg.overrides.eth_chainId = '0x2';
    expect(raw.overrides.eth_chainId).toBeUndefined();
  });
  it('publicConfig strips the private key and reports signing mode', () => {
    const pk = '0x' + '11'.repeat(32);
    const pub = publicConfig(resolveConfig({ privateKey: pk, address: ADDR }));
    expect(pub.privateKey).toBeUndefined();
    expect(pub.signingMode).toBe('private-key');
    expect(JSON.stringify(pub)).not.toContain('1111111111');
    expect(publicConfig(resolveConfig({ address: ADDR })).signingMode).toBe('fake');
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run test/unit/core-basics.test.js`
Expected: FAIL（モジュールが見つからない）

- [ ] **Step 3: 実装**

`src/core/errors.js`:
```js
export class ProviderRpcError extends Error {
  constructor(code, message, data) {
    super(message);
    this.name = 'ProviderRpcError';
    this.code = code;
    if (data !== undefined) this.data = data;
  }
}

export const MESSAGES = {
  4001: 'User rejected the request.',
  4100: 'The requested account and/or method has not been authorized by the user.',
  4200: 'The requested method is not supported by this Ethereum provider.',
  4900: 'The provider is disconnected from all chains.',
  4902: 'Unrecognized chain ID. Try adding the chain using wallet_addEthereumChain first.',
  [-32601]: 'The method does not exist / is not available.',
  [-32602]: 'Invalid params.',
  [-32603]: 'Internal error.',
};

export const errors = {
  userRejected: (msg) => new ProviderRpcError(4001, msg ?? MESSAGES[4001]),
  unauthorized: (msg) => new ProviderRpcError(4100, msg ?? MESSAGES[4100]),
  unsupportedMethod: (method) =>
    new ProviderRpcError(4200, `The requested method is not supported: ${method}`),
  disconnected: () => new ProviderRpcError(4900, MESSAGES[4900]),
  unrecognizedChain: (chainId) =>
    new ProviderRpcError(4902, `Unrecognized chain ID "${chainId}". Try adding the chain using wallet_addEthereumChain first.`),
  methodNotFound: (method) =>
    new ProviderRpcError(-32601, `The method "${method}" does not exist / is not available.`),
  invalidParams: (msg) => new ProviderRpcError(-32602, msg ?? MESSAGES[-32602]),
  internal: (msg) => new ProviderRpcError(-32603, msg ?? MESSAGES[-32603]),
  fromRpc: (err) =>
    new ProviderRpcError(err?.code ?? -32603, err?.message ?? MESSAGES[-32603], err?.data),
  byCode: (code, msg) => new ProviderRpcError(code, msg ?? MESSAGES[code] ?? `Error ${code}`),
};
```

`src/core/emitter.js`:
```js
export function createEmitter() {
  const listeners = new Map();

  function on(event, fn) {
    if (typeof fn !== 'function') return api;
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(fn);
    return api;
  }
  function removeListener(event, fn) {
    listeners.get(event)?.delete(fn);
    return api;
  }
  function once(event, fn) {
    const wrapper = (...args) => {
      removeListener(event, wrapper);
      fn(...args);
    };
    return on(event, wrapper);
  }
  function emit(event, ...args) {
    const set = listeners.get(event);
    if (!set) return false;
    for (const fn of [...set]) {
      try {
        fn(...args);
      } catch {
        // A misbehaving dApp listener must not break the provider.
      }
    }
    return set.size > 0;
  }
  function listenerCount(event) {
    return listeners.get(event)?.size ?? 0;
  }

  const api = { on, addListener: on, once, off: removeListener, removeListener, emit, listenerCount };
  return api;
}
```

`src/core/config.js`:
```js
export const DEFAULTS = Object.freeze({
  chain: 'evm',
  address: null,
  privateKey: null,
  chainId: '0x1',
  rpcUrl: null,
  name: 'MetaMask',
  rdns: 'io.metamask',
  icon: null,
  autoConnect: true,
  replaceExisting: true,
  allowAnyChain: false,
  estimateGas: '0x5208',
  overrides: {},
  verbose: true,
});

export function normalizeChainId(input) {
  if (typeof input === 'number' && Number.isInteger(input) && input > 0) {
    return '0x' + input.toString(16);
  }
  if (typeof input === 'string') {
    const s = input.trim().toLowerCase();
    if (/^0x[0-9a-f]+$/.test(s)) return '0x' + BigInt(s).toString(16);
    if (/^\d+$/.test(s)) return '0x' + BigInt(s).toString(16);
  }
  throw new Error(`Invalid chainId: ${String(input)}`);
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const PRIVATE_KEY_RE = /^0x[0-9a-fA-F]{64}$/;

export function resolveConfig(raw = {}) {
  const cfg = { ...DEFAULTS, ...raw, overrides: { ...(raw.overrides ?? {}) } };
  cfg.chainId = normalizeChainId(cfg.chainId);
  if (cfg.address != null && !ADDRESS_RE.test(cfg.address)) {
    throw new Error(`Invalid address: ${cfg.address}`);
  }
  if (cfg.privateKey != null && !PRIVATE_KEY_RE.test(cfg.privateKey)) {
    throw new Error('Invalid privateKey: expected 0x followed by 64 hex chars');
  }
  if (!cfg.address && !cfg.privateKey) {
    throw new Error('Config needs address or privateKey');
  }
  return cfg;
}

export function publicConfig(cfg) {
  const { privateKey, overrides, ...rest } = cfg;
  return {
    ...rest,
    overrides: Object.keys(overrides ?? {}),
    signingMode: privateKey ? 'private-key' : 'fake',
  };
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run test/unit/core-basics.test.js`
Expected: PASS（全件）

- [ ] **Step 5: コミット**

```bash
git add src/core/errors.js src/core/emitter.js src/core/config.js test/unit/core-basics.test.js
git commit -m "feat(core): errors / emitter / config

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: core — recorder（log）と passthrough

**Files:**
- Create: `src/core/log.js`, `src/core/passthrough.js`
- Test: `test/unit/core-io.test.js`

**Interfaces:**
- Consumes: `errors`, `ProviderRpcError`（Task 2）
- Produces:
  - `createRecorder({ console, verbose }) → { calls: Array<{at, method, params, result?|error?}>, record(entry) → entry, warn(msg), info(msg) }`
  - `createPassthrough({ fetch, rpcUrl }) → async (method, params=[]) → result`。`rpcUrl` が無ければ 4200、HTTP エラーは -32603、JSON-RPC error は `errors.fromRpc`

- [ ] **Step 1: 失敗するテストを書く**

`test/unit/core-io.test.js`:
```js
import { describe, it, expect, vi } from 'vitest';
import { createRecorder } from '../../src/core/log.js';
import { createPassthrough } from '../../src/core/passthrough.js';

function fakeConsole() {
  return { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), log: vi.fn() };
}

describe('recorder', () => {
  it('records calls with timestamps and logs when verbose', () => {
    const con = fakeConsole();
    const rec = createRecorder({ console: con, verbose: true });
    const e = rec.record({ method: 'eth_chainId', params: [], result: '0x1' });
    expect(rec.calls).toHaveLength(1);
    expect(typeof e.at).toBe('number');
    expect(con.debug).toHaveBeenCalledWith(expect.stringContaining('eth_chainId'));
    expect(con.debug.mock.calls[0][0]).toContain('"0x1"');
  });
  it('logs errors with code and stays silent when not verbose', () => {
    const con = fakeConsole();
    const rec = createRecorder({ console: con, verbose: false });
    rec.record({ method: 'x', params: [], error: { code: 4001, message: 'no' } });
    expect(rec.calls[0].error.code).toBe(4001);
    expect(con.debug).not.toHaveBeenCalled();
    rec.warn('careful');
    expect(con.warn).toHaveBeenCalledWith('[wallet-shim] careful');
  });
  it('truncates long results in the log line', () => {
    const con = fakeConsole();
    const rec = createRecorder({ console: con, verbose: true });
    rec.record({ method: 'x', params: [], result: 'a'.repeat(1000) });
    expect(con.debug.mock.calls[0][0].length).toBeLessThan(300);
  });
});

describe('passthrough', () => {
  it('posts JSON-RPC 2.0 and returns result', async () => {
    const fetch = vi.fn(async (url, init) => ({
      ok: true,
      status: 200,
      json: async () => ({ jsonrpc: '2.0', id: JSON.parse(init.body).id, result: '0x10' }),
    }));
    const pt = createPassthrough({ fetch, rpcUrl: 'http://rpc.test' });
    await expect(pt('eth_blockNumber', [])).resolves.toBe('0x10');
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('http://rpc.test');
    expect(init.method).toBe('POST');
    expect(init.headers['content-type']).toBe('application/json');
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ jsonrpc: '2.0', method: 'eth_blockNumber', params: [] });
    expect(typeof body.id).toBe('number');
  });
  it('rejects with the RPC error object', async () => {
    const fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'nope', data: 'x' } }),
    }));
    const pt = createPassthrough({ fetch, rpcUrl: 'http://rpc.test' });
    await expect(pt('eth_call', [])).rejects.toMatchObject({ code: -32000, message: 'nope', data: 'x' });
  });
  it('rejects with 4200 when no rpcUrl and -32603 on HTTP failure', async () => {
    const none = createPassthrough({ fetch: vi.fn(), rpcUrl: null });
    await expect(none('eth_call', [])).rejects.toMatchObject({ code: 4200 });
    const bad = createPassthrough({ fetch: vi.fn(async () => ({ ok: false, status: 502 })), rpcUrl: 'http://x' });
    await expect(bad('eth_call', [])).rejects.toMatchObject({ code: -32603 });
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run test/unit/core-io.test.js`
Expected: FAIL（モジュールが見つからない）

- [ ] **Step 3: 実装**

`src/core/log.js`:
```js
const MAX_LOG_LEN = 200;

function fmt(value) {
  let s;
  try {
    s = JSON.stringify(value);
  } catch {
    s = String(value);
  }
  if (s === undefined) s = String(value);
  return s.length > MAX_LOG_LEN ? s.slice(0, MAX_LOG_LEN) + '…' : s;
}

export function createRecorder({ console: con, verbose = true }) {
  const calls = [];
  return {
    calls,
    record(entry) {
      const e = { at: Date.now(), ...entry };
      calls.push(e);
      if (verbose) {
        if (e.error) con.debug(`[wallet-shim] ${e.method} ✗ ${e.error.code} ${e.error.message}`);
        else con.debug(`[wallet-shim] ${e.method} → ${fmt(e.result)}`);
      }
      return e;
    },
    warn(msg) {
      con.warn(`[wallet-shim] ${msg}`);
    },
    info(msg) {
      if (verbose) con.debug(`[wallet-shim] ${msg}`);
    },
  };
}
```

`src/core/passthrough.js`:
```js
import { errors } from './errors.js';

export function createPassthrough({ fetch: doFetch, rpcUrl }) {
  let nextId = 0;
  return async function passthrough(method, params = []) {
    if (!rpcUrl) throw errors.unsupportedMethod(method);
    const res = await doFetch(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++nextId, method, params }),
    });
    if (!res.ok) throw errors.internal(`RPC HTTP ${res.status} from ${rpcUrl}`);
    const body = await res.json();
    if (body.error) throw errors.fromRpc(body.error);
    return body.result;
  };
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run test/unit/core-io.test.js`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/core/log.js src/core/passthrough.js test/unit/core-io.test.js
git commit -m "feat(core): recorder と RPC passthrough

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: core — router（overrides / handlers / passthrough / rejectNext）

**Files:**
- Create: `src/core/router.js`
- Test: `test/unit/router.test.js`

**Interfaces:**
- Consumes: `createRecorder`（Task 3）、`errors` / `ProviderRpcError`（Task 2）
- Produces: `createRouter({ handlers, overrides, passthrough, recorder }) → { request({method, params}), rejectNext(method?=null, code=4001, message?), override(method, fnOrValue) }`

- [ ] **Step 1: 失敗するテストを書く**

`test/unit/router.test.js`:
```js
import { describe, it, expect, vi } from 'vitest';
import { createRouter } from '../../src/core/router.js';
import { createRecorder } from '../../src/core/log.js';

function setup(extra = {}) {
  const recorder = createRecorder({ console: { debug() {}, warn() {} }, verbose: false });
  const passthrough = vi.fn(async (method) => `pt:${method}`);
  const handlers = { eth_chainId: vi.fn(async () => '0x1'), ...extra.handlers };
  const overrides = { ...extra.overrides };
  const router = createRouter({ handlers, overrides, passthrough, recorder });
  return { router, recorder, passthrough, handlers };
}

describe('router', () => {
  it('resolves overrides before handlers before passthrough', async () => {
    const { router, passthrough } = setup({ overrides: { eth_chainId: '0x99' } });
    expect(await router.request({ method: 'eth_chainId' })).toBe('0x99');
    router.override('eth_chainId', undefined);
    expect(await router.request({ method: 'eth_chainId' })).toBe('0x1');
    expect(passthrough).not.toHaveBeenCalled();
  });
  it('uses handler when no override, passthrough otherwise', async () => {
    const { router, passthrough, handlers } = setup();
    expect(await router.request({ method: 'eth_chainId' })).toBe('0x1');
    expect(handlers.eth_chainId).toHaveBeenCalledWith([]);
    expect(await router.request({ method: 'eth_blockNumber', params: ['a'] })).toBe('pt:eth_blockNumber');
    expect(passthrough).toHaveBeenCalledWith('eth_blockNumber', ['a']);
  });
  it('function overrides receive params and ctx', async () => {
    const { router } = setup();
    router.override('eth_getBalance', (params, ctx) => `${ctx.method}:${params[0]}`);
    expect(await router.request({ method: 'eth_getBalance', params: ['0xabc'] })).toBe('eth_getBalance:0xabc');
  });
  it('records every call including errors', async () => {
    const { router, recorder } = setup({ handlers: { boom: async () => { throw new Error('x'); } } });
    await router.request({ method: 'eth_chainId' });
    await expect(router.request({ method: 'boom' })).rejects.toMatchObject({ code: -32603, message: 'x' });
    expect(recorder.calls.map((c) => c.method)).toEqual(['eth_chainId', 'boom']);
    expect(recorder.calls[1].error).toEqual({ code: -32603, message: 'x' });
  });
  it('rejectNext rejects only the next matching request', async () => {
    const { router } = setup();
    router.rejectNext();
    await expect(router.request({ method: 'eth_chainId' })).rejects.toMatchObject({ code: 4001 });
    expect(await router.request({ method: 'eth_chainId' })).toBe('0x1');
    router.rejectNext('eth_blockNumber', 4100, 'nope');
    expect(await router.request({ method: 'eth_chainId' })).toBe('0x1');
    await expect(router.request({ method: 'eth_blockNumber' })).rejects.toMatchObject({ code: 4100, message: 'nope' });
    expect(await router.request({ method: 'eth_blockNumber' })).toBe('pt:eth_blockNumber');
  });
  it('rejects malformed requests with -32602', async () => {
    const { router } = setup();
    await expect(router.request()).rejects.toMatchObject({ code: -32602 });
    await expect(router.request({ method: 5 })).rejects.toMatchObject({ code: -32602 });
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run test/unit/router.test.js`
Expected: FAIL

- [ ] **Step 3: 実装**

`src/core/router.js`:
```js
import { errors, ProviderRpcError } from './errors.js';

export function createRouter({ handlers, overrides, passthrough, recorder }) {
  const pendingRejections = [];

  function takeRejection(method) {
    const i = pendingRejections.findIndex((p) => p.method === null || p.method === method);
    return i === -1 ? null : pendingRejections.splice(i, 1)[0];
  }

  async function request(args) {
    const method = args?.method;
    const params = args?.params ?? [];
    if (typeof method !== 'string') {
      const e = errors.invalidParams('request(): "method" must be a string');
      recorder.record({ method: String(method), params, error: { code: e.code, message: e.message } });
      throw e;
    }
    try {
      const rej = takeRejection(method);
      if (rej) throw errors.byCode(rej.code, rej.message);
      let result;
      if (Object.prototype.hasOwnProperty.call(overrides, method) && overrides[method] !== undefined) {
        const o = overrides[method];
        result = typeof o === 'function' ? await o(params, { method }) : o;
      } else if (Object.prototype.hasOwnProperty.call(handlers, method)) {
        result = await handlers[method](params);
      } else {
        result = await passthrough(method, params);
      }
      recorder.record({ method, params, result });
      return result;
    } catch (err) {
      const e = err instanceof ProviderRpcError ? err : errors.internal(err?.message ?? String(err));
      recorder.record({ method, params, error: { code: e.code, message: e.message } });
      throw e;
    }
  }

  function rejectNext(method = null, code = 4001, message) {
    pendingRejections.push({ method, code, message });
  }

  function override(method, value) {
    overrides[method] = value;
  }

  return { request, rejectNext, override };
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run test/unit/router.test.js`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/core/router.js test/unit/router.test.js
git commit -m "feat(core): request router（overrides / rejectNext）

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: signing — keccak / アドレス導出 / personal_sign / 偽署名

**Files:**
- Create: `src/signing/evm.js`
- Test: `test/unit/signing-basic.test.js`

**Interfaces:**
- Produces（`src/signing/evm.js`）:
  - re-export: `bytesToHex, hexToBytes, utf8ToBytes, concatBytes`
  - `keccak(bytes) → Uint8Array(32)`, `keccakHex(bytes) → hex(no 0x)`
  - `strip0x(str)`, `toBytes(hexOr utf8 string | Uint8Array) → Uint8Array`
  - `toChecksumAddress(hex) → EIP-55`
  - `deriveAddress(privateKeyHex) → checksum address`
  - `signHash(privateKeyHex, hash32: Uint8Array) → '0x' + r + s + v(1b|1c)`
  - `hashPersonalMessage(message) → Uint8Array(32)`（EIP-191）
  - `signPersonalMessage(privateKeyHex, message) → hex signature`
  - `fakeSignature(seed: string) → '0x' + 65 bytes hex, 末尾 '1b'`（決定的）
  - `createSigner({ privateKey, address }) → { address, mode: 'private-key'|'fake', signPersonal(message), signTypedData(typed) }`（`signTypedData` は Task 6 で実装。ここでは `hashTypedData` 未実装のため `signTypedData` は Task 6 で追加する）

- [ ] **Step 1: 失敗するテストを書く**

`test/unit/signing-basic.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { verifyMessage, hashMessage } from 'viem';
import {
  keccakHex, utf8ToBytes, toBytes, toChecksumAddress, deriveAddress,
  hashPersonalMessage, signPersonalMessage, fakeSignature, createSigner, bytesToHex,
} from '../../src/signing/evm.js';

const PK_ONE = '0x' + '00'.repeat(31) + '01';
const ADDR_ONE = '0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf';
const PK_COW = '0x' + keccakHex(utf8ToBytes('cow'));
const ADDR_COW = '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826';

describe('hashing helpers', () => {
  it('keccak256 of empty input matches the known constant', () => {
    expect(keccakHex(new Uint8Array())).toBe('c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470');
  });
  it('toBytes handles hex and utf8', () => {
    expect(bytesToHex(toBytes('0x6869'))).toBe('6869');
    expect(bytesToHex(toBytes('hi'))).toBe('6869');
    expect(bytesToHex(toBytes('0xabc'))).toBe('0abc');
  });
  it('checksums addresses (EIP-55)', () => {
    expect(toChecksumAddress('0x7e5f4552091a69125d5dfcb7b8c2659029395bdf')).toBe(ADDR_ONE);
  });
});

describe('key derivation', () => {
  it('derives well-known addresses', () => {
    expect(deriveAddress(PK_ONE)).toBe(ADDR_ONE);
    expect(deriveAddress(PK_COW)).toBe(ADDR_COW);
  });
});

describe('personal_sign', () => {
  it('hashes with the EIP-191 prefix (cross-checked with viem)', () => {
    // keccak256("\x19Ethereum Signed Message:\n5hello")
    expect('0x' + bytesToHex(hashPersonalMessage('hello'))).toBe(hashMessage('hello'));
    expect(bytesToHex(hashPersonalMessage('0x68656c6c6f'))).toBe(bytesToHex(hashPersonalMessage('hello')));
  });
  it('produces a signature viem can verify', async () => {
    const sig = signPersonalMessage(PK_ONE, '0x68656c6c6f');
    expect(sig).toMatch(/^0x[0-9a-f]{130}$/);
    expect(['1b', '1c']).toContain(sig.slice(-2));
    await expect(verifyMessage({ address: ADDR_ONE, message: 'hello', signature: sig })).resolves.toBe(true);
    await expect(verifyMessage({ address: ADDR_COW, message: 'hello', signature: sig })).resolves.toBe(false);
  });
});

describe('fakeSignature', () => {
  it('is deterministic, 65 bytes and ends with 1b', () => {
    const a = fakeSignature('personal_sign:["0x68"]');
    const b = fakeSignature('personal_sign:["0x68"]');
    expect(a).toBe(b);
    expect(a).toMatch(/^0x[0-9a-f]{130}$/);
    expect(a.endsWith('1b')).toBe(true);
    expect(fakeSignature('other')).not.toBe(a);
  });
});

describe('createSigner', () => {
  it('derives the address in private-key mode and ignores a mismatching address', () => {
    const s = createSigner({ privateKey: PK_ONE, address: ADDR_COW });
    expect(s.mode).toBe('private-key');
    expect(s.address).toBe(ADDR_ONE);
  });
  it('uses fake signatures in address mode', () => {
    const s = createSigner({ privateKey: null, address: ADDR_COW });
    expect(s.mode).toBe('fake');
    expect(s.address).toBe(ADDR_COW);
    expect(s.signPersonal('0x68')).toBe(fakeSignature('personal_sign:0x68'));
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run test/unit/signing-basic.test.js`
Expected: FAIL

- [ ] **Step 3: 実装**

`src/signing/evm.js`（Task 6 で EIP-712 を追記する）:
```js
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToHex, hexToBytes, utf8ToBytes, concatBytes } from '@noble/hashes/utils.js';

export { bytesToHex, hexToBytes, utf8ToBytes, concatBytes };

export const keccak = (bytes) => keccak_256(bytes);
export const keccakHex = (bytes) => bytesToHex(keccak_256(bytes));

export function strip0x(s) {
  return s.startsWith('0x') || s.startsWith('0X') ? s.slice(2) : s;
}

const HEX_RE = /^0x[0-9a-fA-F]*$/;

export function toBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (typeof value === 'string') {
    if (HEX_RE.test(value)) {
      const h = strip0x(value);
      return hexToBytes(h.length % 2 ? '0' + h : h);
    }
    return utf8ToBytes(value);
  }
  throw new TypeError(`toBytes: unsupported input ${typeof value}`);
}

export function toChecksumAddress(addr) {
  const lower = strip0x(addr).toLowerCase();
  const hash = keccakHex(utf8ToBytes(lower));
  let out = '0x';
  for (let i = 0; i < 40; i++) {
    out += parseInt(hash[i], 16) >= 8 ? lower[i].toUpperCase() : lower[i];
  }
  return out;
}

function privBytes(privateKeyHex) {
  return hexToBytes(strip0x(privateKeyHex));
}

export function deriveAddress(privateKeyHex) {
  const pub = secp256k1.getPublicKey(privBytes(privateKeyHex), false); // 65 bytes, 0x04 prefix
  return toChecksumAddress(bytesToHex(keccak(pub.slice(1)).slice(-20)));
}

/** Sign a 32-byte hash; returns 0x || r || s || v with v in {27, 28}. */
export function signHash(privateKeyHex, hash32) {
  const raw = secp256k1.sign(hash32, privBytes(privateKeyHex), { prehash: false, format: 'recovered' });
  const sig = secp256k1.Signature.fromBytes(raw, 'recovered');
  const v = (27 + sig.recovery).toString(16);
  return '0x' + bytesToHex(sig.toBytes('compact')) + v;
}

export function hashPersonalMessage(message) {
  const body = toBytes(message);
  const prefix = utf8ToBytes(`\x19Ethereum Signed Message:\n${body.length}`);
  return keccak(concatBytes(prefix, body));
}

export function signPersonalMessage(privateKeyHex, message) {
  return signHash(privateKeyHex, hashPersonalMessage(message));
}

/** Deterministic dummy signature for address-only mode. Never verifies on-chain. */
export function fakeSignature(seed) {
  const r = keccak(utf8ToBytes('wallet-shim:fake-sig:' + seed));
  const s = keccak(r);
  return '0x' + bytesToHex(r) + bytesToHex(s) + '1b';
}

export function createSigner({ privateKey, address }) {
  if (privateKey) {
    const derived = deriveAddress(privateKey);
    return {
      mode: 'private-key',
      address: derived,
      signPersonal: (message) => signPersonalMessage(privateKey, message),
      signTypedData: (typed) => signTypedData(privateKey, typed),
    };
  }
  return {
    mode: 'fake',
    address: toChecksumAddress(address),
    signPersonal: (message) => fakeSignature('personal_sign:' + String(message)),
    signTypedData: (typed) => fakeSignature('eth_signTypedData:' + JSON.stringify(typed)),
  };
}

// EIP-712 (hashTypedData / signTypedData) is appended in Task 6.
export function signTypedData() {
  throw new Error('signTypedData not implemented yet');
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run test/unit/signing-basic.test.js`
Expected: PASS。もし `verifyMessage` が false になる場合は `signHash` の recovery ビット取り出しを疑う（`Signature.fromBytes(raw, 'recovered')` の `recovery` と `toBytes('compact')` を使っていることを確認）

- [ ] **Step 5: コミット**

```bash
git add src/signing/evm.js test/unit/signing-basic.test.js
git commit -m "feat(signing): keccak / アドレス導出 / personal_sign / 偽署名

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: signing — EIP-712 typed data

**Files:**
- Modify: `src/signing/evm.js`（末尾の仮 `signTypedData` を置き換え）
- Test: `test/unit/signing-typed.test.js`

**Interfaces:**
- Produces: `encodeType(types, primary) → string`, `typeHash(types, primary) → Uint8Array`, `hashStruct(types, primary, data) → Uint8Array`, `hashTypedData(typed) → Uint8Array(32)`, `signTypedData(privateKeyHex, typed) → hex signature`

- [ ] **Step 1: 失敗するテストを書く**

`test/unit/signing-typed.test.js`（EIP-712 仕様書の Mail 例をそのままベクタに使う）:
```js
import { describe, it, expect } from 'vitest';
import { verifyTypedData, hashTypedData as viemHashTypedData } from 'viem';
import {
  encodeType, typeHash, hashStruct, hashTypedData, signTypedData, bytesToHex, keccakHex, utf8ToBytes,
} from '../../src/signing/evm.js';

// 定数は EIP-712 仕様書の Mail 例。定数と viem の hashTypedData が食い違ったら viem を正とし、定数を直す。

const PK_COW = '0x' + keccakHex(utf8ToBytes('cow'));
const ADDR_COW = '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826';

const MAIL = {
  types: {
    EIP712Domain: [
      { name: 'name', type: 'string' },
      { name: 'version', type: 'string' },
      { name: 'chainId', type: 'uint256' },
      { name: 'verifyingContract', type: 'address' },
    ],
    Person: [
      { name: 'name', type: 'string' },
      { name: 'wallet', type: 'address' },
    ],
    Mail: [
      { name: 'from', type: 'Person' },
      { name: 'to', type: 'Person' },
      { name: 'contents', type: 'string' },
    ],
  },
  primaryType: 'Mail',
  domain: {
    name: 'Ether Mail',
    version: '1',
    chainId: 1,
    verifyingContract: '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC',
  },
  message: {
    from: { name: 'Cow', wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826' },
    to: { name: 'Bob', wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB' },
    contents: 'Hello, Bob!',
  },
};

describe('EIP-712', () => {
  it('encodes types with sorted dependencies', () => {
    expect(encodeType(MAIL.types, 'Mail')).toBe('Mail(Person from,Person to,string contents)Person(string name,address wallet)');
    expect(bytesToHex(typeHash(MAIL.types, 'Mail'))).toBe('a0cedeb2dc280ba39b857546d74f5549c3a1d7bdc2dd96bf881f76108e23dac2');
  });
  it('hashes structs and the domain separator', () => {
    expect(bytesToHex(hashStruct(MAIL.types, 'Mail', MAIL.message))).toBe('c52c0ee5d84264471806290a3f2c4cecfc5490626bf912d01f240d7a274b371e');
    expect(bytesToHex(hashStruct(MAIL.types, 'EIP712Domain', MAIL.domain))).toBe('f2cee375fa42b42143804025fc449deafd50cc031ca257e0b194a650a912090f');
  });
  it('computes the final sign hash (matches viem)', () => {
    const { EIP712Domain, ...types } = MAIL.types;
    const expected = viemHashTypedData({ domain: MAIL.domain, types, primaryType: 'Mail', message: MAIL.message });
    expect('0x' + bytesToHex(hashTypedData(MAIL))).toBe(expected);
    expect(bytesToHex(hashTypedData(MAIL))).toBe('be609aee343fb3c4b28e1df9e632fca64fcfaede20f02e86244efddf30957bd2');
  });
  it('infers EIP712Domain when omitted', () => {
    const { EIP712Domain, ...types } = MAIL.types;
    expect(bytesToHex(hashTypedData({ ...MAIL, types }))).toBe('be609aee343fb3c4b28e1df9e632fca64fcfaede20f02e86244efddf30957bd2');
  });
  it('signs so viem verifies it', async () => {
    const sig = signTypedData(PK_COW, MAIL);
    const { EIP712Domain, ...types } = MAIL.types;
    await expect(verifyTypedData({
      address: ADDR_COW, domain: MAIL.domain, types, primaryType: 'Mail', message: MAIL.message, signature: sig,
    })).resolves.toBe(true);
  });
  it('handles arrays, bytes, bool, int and fixed bytes', () => {
    const types = {
      T: [
        { name: 'tags', type: 'string[]' },
        { name: 'nums', type: 'uint8[2]' },
        { name: 'ok', type: 'bool' },
        { name: 'neg', type: 'int8' },
        { name: 'blob', type: 'bytes' },
        { name: 'fixed', type: 'bytes4' },
      ],
    };
    const data = { tags: ['a', 'b'], nums: [1, 2], ok: true, neg: -1, blob: '0x0102', fixed: '0xdeadbeef' };
    const h = hashStruct(types, 'T', data);
    expect(h).toHaveLength(32);
    // Same data with a different bool must hash differently.
    expect(bytesToHex(hashStruct(types, 'T', { ...data, ok: false }))).not.toBe(bytesToHex(h));
    // A string message passed as JSON must be accepted by hashTypedData's caller (handlers), tested there.
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run test/unit/signing-typed.test.js`
Expected: FAIL（`encodeType` が無い）

- [ ] **Step 3: 実装（`src/signing/evm.js` 末尾の仮 `signTypedData` を削除して以下を追記）**

```js
// ---------- EIP-712 ----------

const baseType = (t) => t.replace(/\[.*$/, '');

function collectDeps(types, primary, found = new Set()) {
  if (found.has(primary) || !types[primary]) return found;
  found.add(primary);
  for (const field of types[primary]) collectDeps(types, baseType(field.type), found);
  return found;
}

export function encodeType(types, primary) {
  const deps = [...collectDeps(types, primary)].filter((t) => t !== primary).sort();
  return [primary, ...deps]
    .map((t) => `${t}(${types[t].map((f) => `${f.type} ${f.name}`).join(',')})`)
    .join('');
}

export function typeHash(types, primary) {
  return keccak(utf8ToBytes(encodeType(types, primary)));
}

function padLeft(bytes) {
  if (bytes.length > 32) throw new Error('EIP-712: value longer than 32 bytes');
  const out = new Uint8Array(32);
  out.set(bytes, 32 - bytes.length);
  return out;
}

function padRight(bytes) {
  if (bytes.length > 32) throw new Error('EIP-712: value longer than 32 bytes');
  const out = new Uint8Array(32);
  out.set(bytes, 0);
  return out;
}

function encodeValue(types, type, value) {
  if (types[type]) return hashStruct(types, type, value ?? {});
  const arr = type.match(/^(.*)\[(\d*)\]$/);
  if (arr) {
    const items = (value ?? []).map((v) => encodeValue(types, arr[1], v));
    return keccak(concatBytes(...items));
  }
  if (type === 'string') return keccak(utf8ToBytes(String(value ?? '')));
  if (type === 'bytes') return keccak(toBytes(value ?? '0x'));
  if (type === 'bool') return padLeft(new Uint8Array([value ? 1 : 0]));
  if (type === 'address') return padLeft(hexToBytes(strip0x(String(value)).padStart(40, '0')));
  if (/^bytes\d+$/.test(type)) return padRight(toBytes(value));
  if (/^u?int\d*$/.test(type)) {
    let n = BigInt(value);
    if (n < 0n) n = (1n << 256n) + n;
    return padLeft(hexToBytes(n.toString(16).padStart(64, '0')));
  }
  throw new Error(`EIP-712: unsupported type ${type}`);
}

export function hashStruct(types, primary, data) {
  const parts = [typeHash(types, primary)];
  for (const field of types[primary]) parts.push(encodeValue(types, field.type, data[field.name]));
  return keccak(concatBytes(...parts));
}

const DOMAIN_FIELDS = [
  ['name', 'string'],
  ['version', 'string'],
  ['chainId', 'uint256'],
  ['verifyingContract', 'address'],
  ['salt', 'bytes32'],
];

function inferDomainType(domain = {}) {
  return DOMAIN_FIELDS.filter(([name]) => domain[name] !== undefined).map(([name, type]) => ({ name, type }));
}

export function hashTypedData(typed) {
  const { primaryType, domain = {}, message = {} } = typed;
  const types = { ...typed.types };
  if (!types.EIP712Domain) types.EIP712Domain = inferDomainType(domain);
  const parts = [new Uint8Array([0x19, 0x01]), hashStruct(types, 'EIP712Domain', domain)];
  if (primaryType !== 'EIP712Domain') parts.push(hashStruct(types, primaryType, message));
  return keccak(concatBytes(...parts));
}

export function signTypedData(privateKeyHex, typed) {
  return signHash(privateKeyHex, hashTypedData(typed));
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run test/unit/signing-typed.test.js test/unit/signing-basic.test.js`
Expected: PASS（全件）

- [ ] **Step 5: コミット**

```bash
git add src/signing/evm.js test/unit/signing-typed.test.js
git commit -m "feat(signing): EIP-712 typed data のハッシュと署名

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: chains/evm — constants と接続/チェーン系ハンドラ

**Files:**
- Create: `src/chains/evm/constants.js`, `src/chains/evm/handlers.js`, `test/unit/helpers/evm.js`
- Test: `test/unit/evm-accounts.test.js`

**Interfaces:**
- Consumes: `createEmitter`, `errors`, `normalizeChainId`, `createSigner`, `keccakHex`, `utf8ToBytes`, `toBytes`
- Produces:
  - `CHAINS: { [hexId]: { name, rpc, symbol } }`, `CHAIN_NAMES: { [name]: hexId }`, `resolveChain(input) → hexId`（名前・10進・16進を受ける）、`METAMASK_ICON`
  - `createEvmHandlers({ state, config, emitter, passthrough, signer }) → { handlers, setChainId(hex), setAccounts(list), disconnect() }`
  - `state` の形: `{ accounts: string[], chainId: hex, connected: boolean, txs: Array<{hash, tx, at}>, chains: {...}, nonce: number }`

- [ ] **Step 1: テストヘルパーと失敗するテストを書く**

`test/unit/helpers/evm.js`（テストファイルから import すると describe が二重登録されるので、ヘルパーは別ファイルに置く）:
```js
import { vi } from 'vitest';
import { CHAINS } from '../../../src/chains/evm/constants.js';
import { createEvmHandlers } from '../../../src/chains/evm/handlers.js';
import { createEmitter } from '../../../src/core/emitter.js';
import { resolveConfig } from '../../../src/core/config.js';
import { createSigner } from '../../../src/signing/evm.js';

export const ADDR = '0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf';

export function makeEvm(rawConfig = {}) {
  const config = resolveConfig({ address: ADDR, ...rawConfig });
  const emitter = createEmitter();
  const signer = createSigner({ privateKey: config.privateKey, address: config.address });
  const passthrough = vi.fn(async (method) => {
    if (method === 'eth_blockNumber') return '0x10';
    return `pt:${method}`;
  });
  const state = {
    accounts: [signer.address], chainId: config.chainId, connected: false, txs: [],
    chains: structuredClone(CHAINS), nonce: 0,
  };
  const api = createEvmHandlers({ state, config, emitter, passthrough, signer });
  const call = (method, params = []) => api.handlers[method](params);
  return { ...api, call, state, emitter, passthrough, signer, config };
}
```

`test/unit/evm-accounts.test.js`:
```js
import { describe, it, expect, vi } from 'vitest';
import { CHAINS, CHAIN_NAMES, resolveChain, METAMASK_ICON } from '../../src/chains/evm/constants.js';
import { makeEvm, ADDR } from './helpers/evm.js';

describe('constants', () => {
  it('knows common chains by name and id', () => {
    expect(CHAIN_NAMES.sepolia).toBe('0xaa36a7');
    expect(CHAINS['0xaa36a7'].rpc).toMatch(/^https:\/\//);
    expect(resolveChain('sepolia')).toBe('0xaa36a7');
    expect(resolveChain('base')).toBe('0x2105');
    expect(resolveChain(31337)).toBe('0x7a69');
    expect(resolveChain('0x1')).toBe('0x1');
    expect(() => resolveChain('nope')).toThrow(/Unknown chain/);
    expect(METAMASK_ICON.startsWith('data:image/svg+xml')).toBe(true);
  });
});

describe('accounts and connection', () => {
  it('eth_requestAccounts returns the account and emits connect once', async () => {
    const evm = makeEvm();
    const connect = vi.fn();
    evm.emitter.on('connect', connect);
    expect(await evm.call('eth_requestAccounts')).toEqual([ADDR]);
    expect(await evm.call('eth_requestAccounts')).toEqual([ADDR]);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledWith({ chainId: '0x1' });
    expect(evm.state.connected).toBe(true);
  });
  it('eth_accounts honours autoConnect', async () => {
    expect(await makeEvm().call('eth_accounts')).toEqual([ADDR]);
    const strict = makeEvm({ autoConnect: false });
    expect(await strict.call('eth_accounts')).toEqual([]);
    await strict.call('eth_requestAccounts');
    expect(await strict.call('eth_accounts')).toEqual([ADDR]);
  });
  it('reports chain id and net version', async () => {
    const evm = makeEvm({ chainId: 11155111 });
    expect(await evm.call('eth_chainId')).toBe('0xaa36a7');
    expect(await evm.call('net_version')).toBe('11155111');
    expect(await evm.call('eth_coinbase')).toBe(ADDR);
  });
  it('permissions round-trip', async () => {
    const evm = makeEvm();
    const perms = await evm.call('wallet_requestPermissions', [{ eth_accounts: {} }]);
    expect(perms[0].parentCapability).toBe('eth_accounts');
    expect(perms[0].caveats[0].value).toEqual([ADDR]);
    expect(await evm.call('wallet_getPermissions')).toEqual(perms);
    expect(await evm.call('wallet_watchAsset', [{ type: 'ERC20' }])).toBe(true);
  });
});

describe('chain switching', () => {
  it('switches to known chains and emits chainChanged', async () => {
    const evm = makeEvm();
    const changed = vi.fn();
    evm.emitter.on('chainChanged', changed);
    expect(await evm.call('wallet_switchEthereumChain', [{ chainId: '0xAA36A7' }])).toBeNull();
    expect(evm.state.chainId).toBe('0xaa36a7');
    expect(changed).toHaveBeenCalledWith('0xaa36a7');
    expect(await evm.call('eth_chainId')).toBe('0xaa36a7');
  });
  it('rejects unknown chains with 4902 unless allowAnyChain', async () => {
    await expect(makeEvm().call('wallet_switchEthereumChain', [{ chainId: '0x123456' }])).rejects.toMatchObject({ code: 4902 });
    const lax = makeEvm({ allowAnyChain: true });
    expect(await lax.call('wallet_switchEthereumChain', [{ chainId: '0x123456' }])).toBeNull();
    expect(lax.state.chainId).toBe('0x123456');
  });
  it('wallet_addEthereumChain registers a chain for later switching', async () => {
    const evm = makeEvm();
    expect(await evm.call('wallet_addEthereumChain', [{ chainId: '0x123456', chainName: 'Custom', rpcUrls: ['http://x'] }])).toBeNull();
    expect(evm.state.chains['0x123456'].name).toBe('Custom');
    expect(await evm.call('wallet_switchEthereumChain', [{ chainId: '0x123456' }])).toBeNull();
  });
  it('rejects malformed switch params with -32602', async () => {
    await expect(makeEvm().call('wallet_switchEthereumChain', [])).rejects.toMatchObject({ code: -32602 });
  });
});

describe('control helpers', () => {
  it('setAccounts / setChainId / disconnect emit events', async () => {
    const evm = makeEvm();
    const accounts = vi.fn();
    const disconnect = vi.fn();
    evm.emitter.on('accountsChanged', accounts);
    evm.emitter.on('disconnect', disconnect);
    await evm.call('eth_requestAccounts');
    evm.setAccounts(['0x' + 'ab'.repeat(20)]);
    expect(accounts).toHaveBeenCalledWith(['0x' + 'ab'.repeat(20)]);
    expect(await evm.call('eth_accounts')).toEqual(['0x' + 'ab'.repeat(20)]);
    evm.setChainId('0x2105');
    expect(evm.state.chainId).toBe('0x2105');
    evm.disconnect();
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(disconnect.mock.calls[0][0].code).toBe(4900);
    expect(evm.state.connected).toBe(false);
    evm.disconnect();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
  it('wallet_revokePermissions disconnects', async () => {
    const evm = makeEvm();
    await evm.call('eth_requestAccounts');
    expect(await evm.call('wallet_revokePermissions', [{ eth_accounts: {} }])).toBeNull();
    expect(evm.state.connected).toBe(false);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run test/unit/evm-accounts.test.js`
Expected: FAIL

- [ ] **Step 3: 実装**

`src/chains/evm/constants.js`:
```js
import { normalizeChainId } from '../../core/config.js';

// hexId -> { name, rpc, symbol }. Public RPCs are best-effort; users can override with --rpc.
export const CHAINS = Object.freeze({
  '0x1': { name: 'mainnet', rpc: 'https://ethereum-rpc.publicnode.com', symbol: 'ETH' },
  '0xaa36a7': { name: 'sepolia', rpc: 'https://ethereum-sepolia-rpc.publicnode.com', symbol: 'ETH' },
  '0x4268': { name: 'holesky', rpc: 'https://ethereum-holesky-rpc.publicnode.com', symbol: 'ETH' },
  '0x2105': { name: 'base', rpc: 'https://mainnet.base.org', symbol: 'ETH' },
  '0x14a34': { name: 'base-sepolia', rpc: 'https://sepolia.base.org', symbol: 'ETH' },
  '0xa': { name: 'optimism', rpc: 'https://mainnet.optimism.io', symbol: 'ETH' },
  '0xa4b1': { name: 'arbitrum', rpc: 'https://arb1.arbitrum.io/rpc', symbol: 'ETH' },
  '0x89': { name: 'polygon', rpc: 'https://polygon-rpc.com', symbol: 'POL' },
  '0x38': { name: 'bsc', rpc: 'https://bsc-dataseed.binance.org', symbol: 'BNB' },
  '0xa86a': { name: 'avalanche', rpc: 'https://api.avax.network/ext/bc/C/rpc', symbol: 'AVAX' },
  '0x7a69': { name: 'localhost', rpc: 'http://127.0.0.1:8545', symbol: 'ETH' },
});

export const CHAIN_NAMES = Object.freeze(
  Object.fromEntries(
    Object.entries(CHAINS).flatMap(([id, c]) => [[c.name, id]]).concat([
      ['ethereum', '0x1'], ['anvil', '0x7a69'], ['hardhat', '0x7a69'], ['foundry', '0x7a69'],
    ]),
  ),
);

/** Accepts a chain name ("sepolia"), decimal (11155111), or hex ("0xaa36a7"). */
export function resolveChain(input) {
  if (typeof input === 'string' && CHAIN_NAMES[input.trim().toLowerCase()]) {
    return CHAIN_NAMES[input.trim().toLowerCase()];
  }
  try {
    return normalizeChainId(input);
  } catch {
    throw new Error(`Unknown chain: ${String(input)} (use a name like sepolia, a decimal id, or 0x-hex)`);
  }
}

// Tiny orange badge so wallet pickers show *something*; EIP-6963 requires a data: URI.
export const METAMASK_ICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ccircle cx='16' cy='16' r='16' fill='%23f6851b'/%3E%3Ctext x='16' y='21.5' font-size='16' text-anchor='middle' fill='white' font-family='sans-serif' font-weight='bold'%3EM%3C/text%3E%3C/svg%3E";
```

`src/chains/evm/handlers.js`（この Task では接続/チェーン系のみ。tx と署名は Task 8 / 9 で追記）:
```js
import { errors } from '../../core/errors.js';
import { normalizeChainId } from '../../core/config.js';
import { keccakHex, utf8ToBytes, toBytes } from '../../signing/evm.js';

const sameAddress = (a, b) =>
  typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();

export function createEvmHandlers({ state, config, emitter, passthrough, signer }) {
  function connect() {
    if (state.connected) return;
    state.connected = true;
    emitter.emit('connect', { chainId: state.chainId });
  }

  function disconnect() {
    if (!state.connected) return;
    state.connected = false;
    emitter.emit('accountsChanged', []);
    emitter.emit('disconnect', errors.disconnected());
  }

  function setChainId(hex) {
    state.chainId = normalizeChainId(hex);
    emitter.emit('chainChanged', state.chainId);
  }

  function setAccounts(list) {
    state.accounts = list.map(String);
    emitter.emit('accountsChanged', [...state.accounts]);
  }

  function assertOwner(address) {
    if (!sameAddress(address, state.accounts[0])) {
      throw errors.unauthorized(`Address ${address} is not the connected account ${state.accounts[0]}`);
    }
  }

  function permissions() {
    return [
      {
        id: 'wallet-shim-eth_accounts',
        parentCapability: 'eth_accounts',
        invoker: 'wallet-shim',
        caveats: [{ type: 'restrictReturnedAccounts', value: [...state.accounts] }],
        date: Date.now(),
      },
    ];
  }

  function chainParam(params) {
    const id = params?.[0]?.chainId;
    if (id === undefined) throw errors.invalidParams('Expected [{ chainId }]');
    try {
      return normalizeChainId(id);
    } catch {
      throw errors.invalidParams(`Invalid chainId: ${id}`);
    }
  }

  const handlers = {
    eth_requestAccounts: async () => {
      connect();
      return [...state.accounts];
    },
    eth_accounts: async () => (state.connected || config.autoConnect ? [...state.accounts] : []),
    eth_chainId: async () => state.chainId,
    net_version: async () => BigInt(state.chainId).toString(10),
    eth_coinbase: async () => state.accounts[0] ?? null,

    wallet_switchEthereumChain: async (params) => {
      const id = chainParam(params);
      if (!state.chains[id] && !config.allowAnyChain) throw errors.unrecognizedChain(id);
      setChainId(id);
      return null;
    },
    wallet_addEthereumChain: async (params) => {
      const id = chainParam(params);
      const spec = params[0];
      state.chains[id] = {
        name: spec.chainName ?? id,
        rpc: spec.rpcUrls?.[0] ?? null,
        symbol: spec.nativeCurrency?.symbol ?? 'ETH',
      };
      return null;
    },
    wallet_requestPermissions: async () => {
      connect();
      return permissions();
    },
    wallet_getPermissions: async () => permissions(),
    wallet_revokePermissions: async () => {
      disconnect();
      return null;
    },
    wallet_watchAsset: async () => true,
  };

  // Transactions (Task 8) and signing (Task 9) extend `handlers` below.
  return { handlers, setChainId, setAccounts, disconnect, connect, assertOwner, sameAddress };
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run test/unit/evm-accounts.test.js`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/chains/evm/constants.js src/chains/evm/handlers.js test/unit/helpers/evm.js test/unit/evm-accounts.test.js
git commit -m "feat(evm): チェーン定数と接続/チェーン切替ハンドラ

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: chains/evm — トランザクションのドライ運転

**Files:**
- Modify: `src/chains/evm/handlers.js`
- Test: `test/unit/evm-tx.test.js`

**Interfaces:**
- Consumes: Task 7 の `createEvmHandlers` 内部（`state.txs`, `state.nonce`, `assertOwner`, `passthrough`）
- Produces: ハンドラ `eth_sendTransaction`, `eth_sendRawTransaction`, `eth_signTransaction`, `eth_getTransactionReceipt`, `eth_getTransactionByHash`, `eth_estimateGas`

- [ ] **Step 1: 失敗するテストを書く**

`test/unit/evm-tx.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { makeEvm, ADDR } from './helpers/evm.js';

const TX = { from: ADDR, to: '0x' + 'bb'.repeat(20), value: '0x1', data: '0x' };

describe('eth_sendTransaction (dry run)', () => {
  it('returns a 32-byte hash, records the tx, and hashes differ per call', async () => {
    const evm = makeEvm();
    const h1 = await evm.call('eth_sendTransaction', [TX]);
    const h2 = await evm.call('eth_sendTransaction', [TX]);
    expect(h1).toMatch(/^0x[0-9a-f]{64}$/);
    expect(h1).not.toBe(h2);
    expect(evm.state.txs).toHaveLength(2);
    expect(evm.state.txs[0]).toMatchObject({ hash: h1, tx: TX });
    expect(evm.passthrough).not.toHaveBeenCalledWith('eth_sendTransaction', expect.anything());
  });
  it('rejects a foreign from address with 4100 and missing params with -32602', async () => {
    const evm = makeEvm();
    await expect(evm.call('eth_sendTransaction', [{ ...TX, from: '0x' + 'cc'.repeat(20) }])).rejects.toMatchObject({ code: 4100 });
    await expect(evm.call('eth_sendTransaction', [])).rejects.toMatchObject({ code: -32602 });
  });
  it('defaults from to the connected account when omitted', async () => {
    const evm = makeEvm();
    const { from, ...noFrom } = TX;
    const h = await evm.call('eth_sendTransaction', [noFrom]);
    expect(evm.state.txs[0].tx.from).toBe(ADDR);
    expect(h).toMatch(/^0x/);
  });
});

describe('receipts', () => {
  it('synthesizes a successful receipt for known hashes using the passthrough block number', async () => {
    const evm = makeEvm();
    const hash = await evm.call('eth_sendTransaction', [TX]);
    const r = await evm.call('eth_getTransactionReceipt', [hash]);
    expect(r).toMatchObject({ transactionHash: hash, status: '0x1', blockNumber: '0x10', from: ADDR, to: TX.to, logs: [], gasUsed: '0x5208' });
    expect(r.blockHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(r.logsBloom).toBe('0x' + '0'.repeat(512));
    const t = await evm.call('eth_getTransactionByHash', [hash]);
    expect(t).toMatchObject({ hash, from: ADDR, to: TX.to, value: '0x1', blockNumber: '0x10', input: '0x' });
  });
  it('falls back to block 0x1 when the RPC is unreachable', async () => {
    const evm = makeEvm();
    evm.passthrough.mockImplementation(async () => { throw new Error('offline'); });
    const hash = await evm.call('eth_sendTransaction', [TX]);
    expect((await evm.call('eth_getTransactionReceipt', [hash])).blockNumber).toBe('0x1');
  });
  it('passes unknown hashes through', async () => {
    const evm = makeEvm();
    const unknown = '0x' + '11'.repeat(32);
    expect(await evm.call('eth_getTransactionReceipt', [unknown])).toBe('pt:eth_getTransactionReceipt');
    expect(evm.passthrough).toHaveBeenCalledWith('eth_getTransactionReceipt', [unknown]);
  });
});

describe('other tx methods', () => {
  it('eth_sendRawTransaction hashes the raw bytes and records it', async () => {
    const evm = makeEvm();
    const raw = '0x02f8' + 'ab'.repeat(10);
    const h = await evm.call('eth_sendRawTransaction', [raw]);
    expect(h).toMatch(/^0x[0-9a-f]{64}$/);
    expect(evm.state.txs[0]).toMatchObject({ hash: h, tx: { raw } });
    expect((await evm.call('eth_getTransactionReceipt', [h])).status).toBe('0x1');
  });
  it('eth_signTransaction returns deterministic bytes and checks from', async () => {
    const evm = makeEvm();
    const a = await evm.call('eth_signTransaction', [TX]);
    const b = await evm.call('eth_signTransaction', [TX]);
    expect(a).toBe(b);
    expect(a).toMatch(/^0x[0-9a-f]{64}$/);
    await expect(evm.call('eth_signTransaction', [{ ...TX, from: '0x' + 'cc'.repeat(20) }])).rejects.toMatchObject({ code: 4100 });
  });
  it('eth_estimateGas returns the configured value or passes through', async () => {
    expect(await makeEvm().call('eth_estimateGas', [TX])).toBe('0x5208');
    expect(await makeEvm({ estimateGas: '0x7530' }).call('eth_estimateGas', [TX])).toBe('0x7530');
    const pt = makeEvm({ estimateGas: 'passthrough' });
    expect(await pt.call('eth_estimateGas', [TX])).toBe('pt:eth_estimateGas');
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run test/unit/evm-tx.test.js`
Expected: FAIL（`handlers.eth_sendTransaction is not a function`）

- [ ] **Step 3: 実装（`src/chains/evm/handlers.js` の `return` の直前に追記）**

```js
  // ---------- transactions (dry run: nothing is broadcast) ----------

  const ZERO_BLOOM = '0x' + '0'.repeat(512);

  function findTx(hash) {
    if (typeof hash !== 'string') return null;
    return state.txs.find((t) => t.hash.toLowerCase() === hash.toLowerCase()) ?? null;
  }

  function recordTx(tx) {
    const hash = '0x' + keccakHex(utf8ToBytes(`wallet-shim:tx:${state.nonce++}:${JSON.stringify(tx)}`));
    const entry = { hash, tx, at: Date.now() };
    state.txs.push(entry);
    return entry;
  }

  function txParam(params) {
    const tx = params?.[0];
    if (!tx || typeof tx !== 'object') throw errors.invalidParams('Expected [transaction]');
    const withFrom = { ...tx, from: tx.from ?? state.accounts[0] };
    assertOwner(withFrom.from);
    return withFrom;
  }

  async function currentBlockNumber() {
    try {
      const bn = await passthrough('eth_blockNumber', []);
      return typeof bn === 'string' ? bn : '0x1';
    } catch {
      return '0x1';
    }
  }

  function fakeBlockHash(blockNumber) {
    return '0x' + keccakHex(utf8ToBytes(`wallet-shim:block:${blockNumber}`));
  }

  Object.assign(handlers, {
    eth_sendTransaction: async (params) => recordTx(txParam(params)).hash,

    eth_sendRawTransaction: async (params) => {
      const raw = params?.[0];
      if (typeof raw !== 'string') throw errors.invalidParams('Expected [rawTransaction]');
      const hash = '0x' + keccakHex(toBytes(raw));
      state.txs.push({ hash, tx: { raw, from: state.accounts[0] }, at: Date.now() });
      return hash;
    },

    eth_signTransaction: async (params) => {
      const tx = txParam(params);
      return '0x' + keccakHex(utf8ToBytes(`wallet-shim:signed-tx:${JSON.stringify(tx)}`));
    },

    eth_getTransactionReceipt: async (params) => {
      const rec = findTx(params?.[0]);
      if (!rec) return passthrough('eth_getTransactionReceipt', params);
      const blockNumber = await currentBlockNumber();
      return {
        transactionHash: rec.hash,
        transactionIndex: '0x0',
        blockHash: fakeBlockHash(blockNumber),
        blockNumber,
        from: rec.tx.from ?? state.accounts[0],
        to: rec.tx.to ?? null,
        cumulativeGasUsed: '0x5208',
        gasUsed: '0x5208',
        effectiveGasPrice: rec.tx.gasPrice ?? rec.tx.maxFeePerGas ?? '0x1',
        contractAddress: null,
        logs: [],
        logsBloom: ZERO_BLOOM,
        status: '0x1',
        type: rec.tx.type ?? '0x2',
      };
    },

    eth_getTransactionByHash: async (params) => {
      const rec = findTx(params?.[0]);
      if (!rec) return passthrough('eth_getTransactionByHash', params);
      const blockNumber = await currentBlockNumber();
      const idx = state.txs.indexOf(rec);
      return {
        hash: rec.hash,
        blockHash: fakeBlockHash(blockNumber),
        blockNumber,
        transactionIndex: '0x0',
        from: rec.tx.from ?? state.accounts[0],
        to: rec.tx.to ?? null,
        value: rec.tx.value ?? '0x0',
        gas: rec.tx.gas ?? '0x5208',
        gasPrice: rec.tx.gasPrice ?? rec.tx.maxFeePerGas ?? '0x1',
        maxFeePerGas: rec.tx.maxFeePerGas ?? '0x1',
        maxPriorityFeePerGas: rec.tx.maxPriorityFeePerGas ?? '0x1',
        input: rec.tx.data ?? rec.tx.input ?? '0x',
        nonce: '0x' + idx.toString(16),
        type: rec.tx.type ?? '0x2',
        chainId: state.chainId,
        v: '0x1',
        r: '0x' + keccakHex(utf8ToBytes(`r:${rec.hash}`)),
        s: '0x' + keccakHex(utf8ToBytes(`s:${rec.hash}`)),
      };
    },

    eth_estimateGas: async (params) =>
      config.estimateGas === 'passthrough' ? passthrough('eth_estimateGas', params) : config.estimateGas,
  });
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run test/unit/evm-tx.test.js test/unit/evm-accounts.test.js`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/chains/evm/handlers.js test/unit/evm-tx.test.js
git commit -m "feat(evm): トランザクションのドライ運転と合成レシート

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: chains/evm — 署名メソッドの配線

**Files:**
- Modify: `src/chains/evm/handlers.js`
- Test: `test/unit/evm-sign.test.js`

**Interfaces:**
- Consumes: `signer.signPersonal(message)`, `signer.signTypedData(typed)`（Task 5/6）、`assertOwner`
- Produces: ハンドラ `personal_sign`, `eth_sign`, `eth_signTypedData`, `eth_signTypedData_v3`, `eth_signTypedData_v4`

- [ ] **Step 1: 失敗するテストを書く**

`test/unit/evm-sign.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { verifyMessage, verifyTypedData } from 'viem';
import { makeEvm, ADDR } from './helpers/evm.js';
import { fakeSignature } from '../../src/signing/evm.js';

const PK_ONE = '0x' + '00'.repeat(31) + '01';
const OTHER = '0x' + 'cc'.repeat(20);

const TYPED = {
  types: { Person: [{ name: 'name', type: 'string' }, { name: 'wallet', type: 'address' }] },
  primaryType: 'Person',
  domain: { name: 'Test', version: '1', chainId: 1 },
  message: { name: 'Alice', wallet: ADDR },
};

describe('fake signing mode (address only)', () => {
  it('personal_sign returns a deterministic dummy signature', async () => {
    const evm = makeEvm();
    const sig = await evm.call('personal_sign', ['0x68656c6c6f', ADDR]);
    expect(sig).toBe(fakeSignature('personal_sign:0x68656c6c6f'));
    expect(await evm.call('personal_sign', ['0x68656c6c6f', ADDR.toLowerCase()])).toBe(sig);
    await expect(verifyMessage({ address: ADDR, message: 'hello', signature: sig })).resolves.toBe(false);
  });
  it('rejects signing for other addresses with 4100', async () => {
    const evm = makeEvm();
    await expect(evm.call('personal_sign', ['0x68', OTHER])).rejects.toMatchObject({ code: 4100 });
    await expect(evm.call('eth_signTypedData_v4', [OTHER, TYPED])).rejects.toMatchObject({ code: 4100 });
  });
});

describe('private-key signing mode', () => {
  it('personal_sign verifies with viem', async () => {
    const evm = makeEvm({ privateKey: PK_ONE });
    const sig = await evm.call('personal_sign', ['0x68656c6c6f', ADDR]);
    await expect(verifyMessage({ address: ADDR, message: 'hello', signature: sig })).resolves.toBe(true);
  });
  it('eth_sign uses the same personal-message path', async () => {
    const evm = makeEvm({ privateKey: PK_ONE });
    const a = await evm.call('eth_sign', [ADDR, '0x68656c6c6f']);
    const b = await evm.call('personal_sign', ['0x68656c6c6f', ADDR]);
    expect(a).toBe(b);
  });
  it('eth_signTypedData_v4 accepts objects and JSON strings and verifies', async () => {
    const evm = makeEvm({ privateKey: PK_ONE });
    const s1 = await evm.call('eth_signTypedData_v4', [ADDR, TYPED]);
    const s2 = await evm.call('eth_signTypedData_v4', [ADDR, JSON.stringify(TYPED)]);
    const s3 = await evm.call('eth_signTypedData_v3', [ADDR, TYPED]);
    expect(s1).toBe(s2);
    expect(s1).toBe(s3);
    await expect(verifyTypedData({ address: ADDR, ...TYPED, signature: s1 })).resolves.toBe(true);
  });
  it('eth_signTypedData (v1 order) detects which param is the address', async () => {
    const evm = makeEvm({ privateKey: PK_ONE });
    const legacy = await evm.call('eth_signTypedData', [TYPED, ADDR]);
    const v4 = await evm.call('eth_signTypedData_v4', [ADDR, TYPED]);
    expect(legacy).toBe(v4);
  });
  it('rejects invalid typed data JSON with -32602', async () => {
    const evm = makeEvm({ privateKey: PK_ONE });
    await expect(evm.call('eth_signTypedData_v4', [ADDR, '{not json'])).rejects.toMatchObject({ code: -32602 });
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run test/unit/evm-sign.test.js`
Expected: FAIL

- [ ] **Step 3: 実装（`src/chains/evm/handlers.js` の `return` の直前に追記）**

```js
  // ---------- signing ----------

  const isAddress = (v) => typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v);

  function parseTyped(data) {
    if (typeof data === 'string') {
      try {
        return JSON.parse(data);
      } catch {
        throw errors.invalidParams('Typed data must be valid JSON');
      }
    }
    if (data && typeof data === 'object') return data;
    throw errors.invalidParams('Typed data must be an object or JSON string');
  }

  function personal(message, address) {
    if (typeof message !== 'string') throw errors.invalidParams('Expected [message, address]');
    assertOwner(address);
    return signer.signPersonal(message);
  }

  function typed(address, data) {
    assertOwner(address);
    return signer.signTypedData(parseTyped(data));
  }

  Object.assign(handlers, {
    personal_sign: async (params) => personal(params?.[0], params?.[1]),
    eth_sign: async (params) => personal(params?.[1], params?.[0]),
    eth_signTypedData_v4: async (params) => typed(params?.[0], params?.[1]),
    eth_signTypedData_v3: async (params) => typed(params?.[0], params?.[1]),
    // v1 historically took [typedData, address]; accept either order.
    eth_signTypedData: async (params) =>
      isAddress(params?.[0]) ? typed(params[0], params[1]) : typed(params?.[1], params?.[0]),
  });
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run test/unit/`
Expected: 全ファイル PASS

- [ ] **Step 5: コミット**

```bash
git add src/chains/evm/handlers.js test/unit/evm-sign.test.js
git commit -m "feat(evm): personal_sign / eth_signTypedData の配線

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: provider / announce / createShim / バンドル

**Files:**
- Create: `src/chains/evm/provider.js`, `src/chains/evm/announce.js`, `src/shim.js`
- Modify: `src/index.js`（仮実装を置き換え）
- Test: `test/unit/shim.test.js`, `test/unit/dist.test.js`

**Interfaces:**
- Consumes: Task 2〜9 の全部
- Produces:
  - `createEvmProvider({ config, env }) → { provider, control, recorder }`
  - `installEvmProvider({ provider, config, env, recorder }) → { info, announce }`
  - `createShim(rawConfig, env) → control`（`env = { window, fetch, console }`）。`env.window.__WALLET_SHIM__ = control`
  - `control = { calls, txs, rejectNext, override, setAccounts, setChainId, disconnect, config, info, version, provider }`
  - `dist/shim.js`: `window.__WALLET_SHIM_CONFIG__` を読んで自動インストール

- [ ] **Step 1: 失敗するテストを書く**

`test/unit/shim.test.js`:
```js
import { describe, it, expect, vi } from 'vitest';
import { createShim } from '../../src/shim.js';

const ADDR = '0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf';

function makeEnv() {
  const win = new EventTarget();
  const fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ jsonrpc: '2.0', id: 1, result: '0x20' }) }));
  const con = { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), log: vi.fn() };
  return { window: win, fetch, console: con };
}

describe('createShim', () => {
  it('installs window.ethereum and announces via EIP-6963', () => {
    const env = makeEnv();
    const announced = [];
    env.window.addEventListener('eip6963:announceProvider', (e) => announced.push(e.detail));
    const control = createShim({ address: ADDR, chainId: 11155111 }, env);
    expect(env.window.ethereum).toBe(control.provider);
    expect(env.window.__WALLET_SHIM__).toBe(control);
    expect(announced).toHaveLength(1);
    expect(announced[0].info).toMatchObject({ name: 'MetaMask', rdns: 'io.metamask' });
    expect(announced[0].info.uuid).toMatch(/^[0-9a-f-]{36}$/);
    expect(announced[0].provider).toBe(control.provider);
    expect(Object.isFrozen(announced[0])).toBe(true);
    env.window.dispatchEvent(new Event('eip6963:requestProvider'));
    expect(announced).toHaveLength(2);
  });
  it('exposes MetaMask-compatible provider surface', async () => {
    const env = makeEnv();
    const { provider } = createShim({ address: ADDR }, env);
    expect(provider.isMetaMask).toBe(true);
    expect(await provider._metamask.isUnlocked()).toBe(true);
    expect(provider.isConnected()).toBe(true);
    expect(provider.selectedAddress).toBe(ADDR);
    expect(provider.chainId).toBe('0x1');
    expect(provider.networkVersion).toBe('1');
    expect(await provider.request({ method: 'eth_requestAccounts' })).toEqual([ADDR]);
    expect(await provider.enable()).toEqual([ADDR]);
    expect(await provider.request({ method: 'eth_blockNumber' })).toBe('0x20');
    expect(env.fetch).toHaveBeenCalledWith('https://ethereum-rpc.publicnode.com', expect.anything());
  });
  it('supports legacy send / sendAsync', async () => {
    const env = makeEnv();
    const { provider } = createShim({ address: ADDR }, env);
    expect(await provider.send('eth_chainId', [])).toBe('0x1');
    const res = await new Promise((resolve) => provider.sendAsync({ id: 7, jsonrpc: '2.0', method: 'eth_chainId', params: [] }, (err, r) => resolve([err, r])));
    expect(res[0]).toBeNull();
    expect(res[1]).toEqual({ id: 7, jsonrpc: '2.0', result: '0x1' });
    const bad = await new Promise((resolve) => provider.sendAsync({ id: 8, jsonrpc: '2.0', method: 'personal_sign', params: ['0x1', '0x' + 'cc'.repeat(20)] }, (err, r) => resolve([err, r])));
    expect(bad[0].code).toBe(4100);
    expect(bad[1].error.code).toBe(4100);
  });
  it('control API drives events and records calls', async () => {
    const env = makeEnv();
    const control = createShim({ address: ADDR, verbose: false }, env);
    const chain = vi.fn();
    control.provider.on('chainChanged', chain);
    control.setChainId('0x2105');
    expect(chain).toHaveBeenCalledWith('0x2105');
    control.rejectNext('eth_requestAccounts');
    await expect(control.provider.request({ method: 'eth_requestAccounts' })).rejects.toMatchObject({ code: 4001 });
    control.override('eth_getBalance', (params) => (params[0] === ADDR ? '0xde0b6b3a7640000' : '0x0'));
    expect(await control.provider.request({ method: 'eth_getBalance', params: [ADDR, 'latest'] })).toBe('0xde0b6b3a7640000');
    expect(control.calls.map((c) => c.method)).toEqual(['eth_requestAccounts', 'eth_getBalance']);
    expect(control.config.address).toBe(ADDR);
    expect(control.config.privateKey).toBeUndefined();
    expect(control.version).toBe('dev');
    expect(control.txs).toEqual([]);
  });
  it('honours replaceExisting=false and custom name/rdns/rpcUrl', () => {
    const env = makeEnv();
    const real = { isMetaMask: true, real: true };
    env.window.ethereum = real;
    const announced = [];
    env.window.addEventListener('eip6963:announceProvider', (e) => announced.push(e.detail));
    createShim({ address: ADDR, replaceExisting: false, name: 'Shim', rdns: 'dev.shim', rpcUrl: 'http://rpc.local' }, env);
    expect(env.window.ethereum).toBe(real);
    expect(env.console.warn).toHaveBeenCalledWith(expect.stringContaining('replaceExisting'));
    expect(announced[0].info.name).toBe('Shim');
    expect(env.window.__WALLET_SHIM__.config.rpcUrl).toBe('http://rpc.local');
  });
  it('rejects unsupported chains', () => {
    expect(() => createShim({ address: ADDR, chain: 'solana' }, makeEnv())).toThrow(/Unsupported chain/);
  });
});
```

`test/unit/dist.test.js`:
```js
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

const ADDR = '0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf';

describe('dist/shim.js', () => {
  beforeAll(() => {
    if (!existsSync('dist/shim.js')) execSync('npm run build', { stdio: 'inherit' });
  });
  it('self-installs from window.__WALLET_SHIM_CONFIG__', async () => {
    const code = readFileSync('dist/shim.js', 'utf8');
    const win = new EventTarget();
    win.__WALLET_SHIM_CONFIG__ = { address: ADDR, chainId: '0xaa36a7', verbose: false };
    win.fetch = async () => ({ ok: true, json: async () => ({ result: '0x1' }) });
    new Function('window', code)(win);
    expect(win.ethereum).toBeDefined();
    expect(win.__WALLET_SHIM__.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(await win.ethereum.request({ method: 'eth_chainId' })).toBe('0xaa36a7');
    expect(await win.ethereum.request({ method: 'eth_requestAccounts' })).toEqual([ADDR]);
  });
  it('is idempotent and does not throw without config', () => {
    const code = readFileSync('dist/shim.js', 'utf8');
    const win = new EventTarget();
    expect(() => new Function('window', code)(win)).not.toThrow();
    expect(win.ethereum).toBeUndefined();
    win.__WALLET_SHIM_CONFIG__ = { address: ADDR, verbose: false };
    new Function('window', code)(win);
    const first = win.ethereum;
    new Function('window', code)(win);
    expect(win.ethereum).toBe(first);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run test/unit/shim.test.js test/unit/dist.test.js`
Expected: FAIL

- [ ] **Step 3: 実装**

`src/chains/evm/provider.js`:
```js
import { createEmitter } from '../../core/emitter.js';
import { createRecorder } from '../../core/log.js';
import { createPassthrough } from '../../core/passthrough.js';
import { createRouter } from '../../core/router.js';
import { publicConfig } from '../../core/config.js';
import { createSigner } from '../../signing/evm.js';
import { CHAINS } from './constants.js';
import { createEvmHandlers } from './handlers.js';
import { VERSION } from '../../version.js';

export function createEvmProvider({ config, env }) {
  const recorder = createRecorder({ console: env.console, verbose: config.verbose });
  const signer = createSigner({ privateKey: config.privateKey, address: config.address });
  const rpcUrl = config.rpcUrl ?? CHAINS[config.chainId]?.rpc ?? null;
  const passthrough = createPassthrough({ fetch: env.fetch, rpcUrl });
  const emitter = createEmitter();
  const state = {
    accounts: [signer.address],
    chainId: config.chainId,
    connected: false,
    txs: [],
    chains: JSON.parse(JSON.stringify(CHAINS)),
    nonce: 0,
  };
  const evm = createEvmHandlers({ state, config, emitter, passthrough, signer });
  const router = createRouter({ handlers: evm.handlers, overrides: { ...config.overrides }, passthrough, recorder });

  const request = (args) => router.request(args);

  function sendAsync(payload, callback) {
    request({ method: payload?.method, params: payload?.params }).then(
      (result) => callback(null, { id: payload?.id, jsonrpc: '2.0', result }),
      (err) => callback(err, { id: payload?.id, jsonrpc: '2.0', error: { code: err.code, message: err.message, data: err.data } }),
    );
  }

  function send(methodOrPayload, paramsOrCallback) {
    if (typeof methodOrPayload === 'string') {
      return request({ method: methodOrPayload, params: Array.isArray(paramsOrCallback) ? paramsOrCallback : [] });
    }
    if (typeof paramsOrCallback === 'function') return sendAsync(methodOrPayload, paramsOrCallback);
    return request({ method: methodOrPayload?.method, params: methodOrPayload?.params });
  }

  const provider = {
    isMetaMask: true,
    _metamask: { isUnlocked: async () => true },
    isConnected: () => true,
    request,
    send,
    sendAsync,
    enable: () => request({ method: 'eth_requestAccounts' }),
    on: (...a) => (emitter.on(...a), provider),
    addListener: (...a) => (emitter.on(...a), provider),
    once: (...a) => (emitter.once(...a), provider),
    off: (...a) => (emitter.removeListener(...a), provider),
    removeListener: (...a) => (emitter.removeListener(...a), provider),
    removeAllListeners: () => provider,
    listenerCount: (e) => emitter.listenerCount(e),
    get selectedAddress() { return state.accounts[0] ?? null; },
    get chainId() { return state.chainId; },
    get networkVersion() { return BigInt(state.chainId).toString(10); },
  };

  const control = {
    calls: recorder.calls,
    txs: state.txs,
    rejectNext: router.rejectNext,
    override: router.override,
    setAccounts: evm.setAccounts,
    setChainId: evm.setChainId,
    disconnect: evm.disconnect,
    config: publicConfig({ ...config, address: signer.address, rpcUrl }),
    version: VERSION,
    provider,
  };

  return { provider, control, recorder };
}
```

`src/chains/evm/announce.js`:
```js
import { METAMASK_ICON } from './constants.js';

function uuid(win) {
  const c = win.crypto ?? globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function installEvmProvider({ provider, config, env, recorder }) {
  const win = env.window;
  if (win.ethereum && !config.replaceExisting) {
    recorder.warn('window.ethereum already exists and replaceExisting=false; announcing via EIP-6963 only');
  } else {
    try {
      Object.defineProperty(win, 'ethereum', { value: provider, configurable: true, writable: true, enumerable: true });
    } catch (e) {
      recorder.warn(`could not define window.ethereum (${e.message}); announcing via EIP-6963 only`);
    }
  }

  const info = Object.freeze({ uuid: uuid(win), name: config.name, icon: config.icon ?? METAMASK_ICON, rdns: config.rdns });
  const detail = Object.freeze({ info, provider });
  const announce = () => win.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail }));
  win.addEventListener('eip6963:requestProvider', announce);
  announce();
  return { info, announce };
}
```

`src/shim.js`:
```js
import { resolveConfig } from './core/config.js';
import { createEvmProvider } from './chains/evm/provider.js';
import { installEvmProvider } from './chains/evm/announce.js';

// Add new chains here: { create({config, env}), install({provider, config, env, recorder}) }
const CHAIN_MODULES = {
  evm: { create: createEvmProvider, install: installEvmProvider },
};

export function createShim(rawConfig, env) {
  const config = resolveConfig(rawConfig);
  const mod = CHAIN_MODULES[config.chain];
  if (!mod) throw new Error(`Unsupported chain: ${config.chain} (available: ${Object.keys(CHAIN_MODULES).join(', ')})`);
  const { provider, control, recorder } = mod.create({ config, env });
  const { info } = mod.install({ provider, config, env, recorder });
  control.info = info;
  env.window.__WALLET_SHIM__ = control;
  recorder.info(`installed "${config.name}" as ${control.config.address} on chain ${config.chainId} (${control.config.signingMode} signing, rpc: ${control.config.rpcUrl ?? 'none'})`);
  return control;
}
```

`src/index.js`（置き換え）:
```js
import { createShim } from './shim.js';

(function bootstrap() {
  if (typeof window === 'undefined') return;
  if (window.__WALLET_SHIM__) {
    console.debug('[wallet-shim] already installed, skipping');
    return;
  }
  const config = window.__WALLET_SHIM_CONFIG__;
  if (!config) {
    console.debug('[wallet-shim] no window.__WALLET_SHIM_CONFIG__ found; nothing installed');
    return;
  }
  try {
    createShim(config, { window, fetch: (...args) => window.fetch(...args), console });
  } catch (e) {
    console.error('[wallet-shim] failed to install:', e);
  }
})();
```

- [ ] **Step 4: ビルドしてテストが通ることを確認**

Run: `npm run build && npx vitest run`
Expected: 全件 PASS。`dist/shim.js` のサイズが 200KB 未満であること（`ls -l dist/shim.js`）

- [ ] **Step 5: コミット**

```bash
git add src/chains/evm/provider.js src/chains/evm/announce.js src/shim.js src/index.js dist/shim.js test/unit/shim.test.js test/unit/dist.test.js
git commit -m "feat: EIP-1193 provider / EIP-6963 announce / createShim とバンドル

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: CLI — 引数解析・設定マージ・出力（アドレスモード）

**Files:**
- Create: `src/cli/index.js`, `bin/wallet-shim.mjs`
- Test: `test/unit/cli.test.js`

**Interfaces:**
- Consumes: `DEFAULTS`, `resolveConfig`, `publicConfig`, `resolveChain`, `CHAINS`
- Produces: `runCli(argv: string[], io: { stdout: (s)=>void, stderr: (s)=>void, cwd: string }) → Promise<number>`（終了コード）。`buildOutput(config, distSource, format) → string`

- [ ] **Step 1: 失敗するテストを書く**

`test/unit/cli.test.js`:
```js
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli } from '../../src/cli/index.js';

const ADDR = '0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf';

function io() {
  const out = [], err = [];
  return { stdout: (s) => out.push(s), stderr: (s) => err.push(s), cwd: mkdtempSync(join(tmpdir(), 'wallet-shim-')), out, err };
}

function firstLineConfig(text) {
  const line = text.split('\n')[0];
  expect(line.startsWith('window.__WALLET_SHIM_CONFIG__ = ')).toBe(true);
  return JSON.parse(line.slice('window.__WALLET_SHIM_CONFIG__ = '.length, -1));
}

describe('cli (address mode)', () => {
  beforeAll(() => {
    if (!existsSync('dist/shim.js')) execSync('npm run build', { stdio: 'inherit' });
  });
  it('emits config + bundle to stdout', async () => {
    const i = io();
    expect(await runCli(['--address', ADDR, '--chain', 'sepolia'], i)).toBe(0);
    const text = i.out.join('');
    const cfg = firstLineConfig(text);
    expect(cfg).toMatchObject({ address: ADDR, chainId: '0xaa36a7', chain: 'evm', name: 'MetaMask' });
    expect(cfg.rpcUrl).toMatch(/^https:/);
    expect(cfg.privateKey).toBeNull();
    expect(text).toContain('eip6963:announceProvider');
    expect(i.err.join('')).toContain(ADDR);
    expect(i.err.join('')).toContain('sepolia');
  });
  it('supports --out, --format base64, --rpc, --name, --rdns, --override', async () => {
    const i = io();
    const out = join(i.cwd, 'shim.out.js');
    const code = await runCli(['--address', ADDR, '--chain', '0x2105', '--rpc', 'http://rpc.local', '--name', 'Shim', '--rdns', 'dev.shim',
      '--override', 'eth_getBalance=\"0x1\"', '--override', 'eth_blockNumber=0x10', '--out', out], i);
    expect(code).toBe(0);
    expect(i.out).toHaveLength(0);
    const cfg = firstLineConfig(readFileSync(out, 'utf8'));
    expect(cfg).toMatchObject({ chainId: '0x2105', rpcUrl: 'http://rpc.local', name: 'Shim', rdns: 'dev.shim', overrides: { eth_getBalance: '0x1', eth_blockNumber: '0x10' } });

    const b = io();
    await runCli(['--address', ADDR, '--format', 'base64', '--quiet'], b);
    const decoded = Buffer.from(b.out.join(''), 'base64').toString('utf8');
    expect(firstLineConfig(decoded).address).toBe(ADDR);
    expect(b.err).toHaveLength(0);
  });
  it('merges --config file with flags taking precedence', async () => {
    const i = io();
    const cfgPath = join(i.cwd, 'cfg.json');
    writeFileSync(cfgPath, JSON.stringify({ address: ADDR, chainId: 'base', name: 'FromFile', autoConnect: false }));
    await runCli(['--config', cfgPath, '--name', 'FromFlag'], i);
    const cfg = firstLineConfig(i.out.join(''));
    expect(cfg).toMatchObject({ chainId: '0x2105', name: 'FromFlag', autoConnect: false });
  });
  it('fails clearly on bad input', async () => {
    const i = io();
    expect(await runCli(['--address', '0x123'], i)).toBe(1);
    expect(i.err.join('')).toMatch(/Invalid address/);
    const j = io();
    expect(await runCli(['--address', ADDR, '--chain', 'nope'], j)).toBe(1);
    expect(j.err.join('')).toMatch(/Unknown chain/);
    const k = io();
    expect(await runCli(['--address', ADDR, '--format', 'xml'], k)).toBe(1);
  });
  it('--help prints usage and exits 0', async () => {
    const i = io();
    expect(await runCli(['--help'], i)).toBe(0);
    expect(i.out.join('')).toContain('--address');
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run test/unit/cli.test.js`
Expected: FAIL

- [ ] **Step 3: 実装**

`src/cli/index.js`（鍵モードは Task 12 で追記）:
```js
import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULTS, resolveConfig, publicConfig } from '../core/config.js';
import { resolveChain, CHAINS } from '../chains/evm/constants.js';

const DIST_PATH = fileURLToPath(new URL('../../dist/shim.js', import.meta.url));

export const USAGE = `wallet-shim - emit a fake EIP-1193 (MetaMask-compatible) provider script

Usage: node bin/wallet-shim.mjs [options]

Identity (pick one; default: --generate-key)
  --address <0x..>            Impersonate this address (fake signatures)
  --private-key <0x..>        Sign for real with this key (address is derived)
  --private-key-file <path>   Read the private key from a file
  --generate-key              Create a throwaway key (saved under .wallet-shim/)

Chain
  --chain <id|name>           1, 0x1, mainnet, sepolia, base, arbitrum, ... (default: 1)
  --rpc <url>                 RPC for passthrough reads (default: public RPC of the chain)

Presentation
  --name <str>                Wallet name for EIP-6963 (default: MetaMask)
  --rdns <str>                Wallet rdns for EIP-6963 (default: io.metamask)
  --override <method>=<json>  Fixed response for a method (repeatable)
  --config <path.json>        Config file; CLI flags take precedence

Output
  --out <path>                Write to file instead of stdout
  --format iife|base64        Output format (default: iife)
  --print-config              Print the resolved config (secrets redacted) to stderr
  --quiet                     Suppress stderr summary
  --help, --version
`;

const OPTIONS = {
  address: { type: 'string' },
  'private-key': { type: 'string' },
  'private-key-file': { type: 'string' },
  'generate-key': { type: 'boolean', default: false },
  chain: { type: 'string' },
  rpc: { type: 'string' },
  name: { type: 'string' },
  rdns: { type: 'string' },
  override: { type: 'string', multiple: true, default: [] },
  config: { type: 'string' },
  out: { type: 'string' },
  format: { type: 'string', default: 'iife' },
  'print-config': { type: 'boolean', default: false },
  quiet: { type: 'boolean', default: false },
  help: { type: 'boolean', default: false },
  version: { type: 'boolean', default: false },
};

function parseOverride(spec) {
  const eq = spec.indexOf('=');
  if (eq === -1) throw new Error(`--override expects <method>=<json>, got "${spec}"`);
  const method = spec.slice(0, eq).trim();
  const raw = spec.slice(eq + 1);
  try {
    return [method, JSON.parse(raw)];
  } catch {
    return [method, raw];
  }
}

export function buildOutput(config, distSource, format = 'iife') {
  const iife = `window.__WALLET_SHIM_CONFIG__ = ${JSON.stringify(config)};\n${distSource}`;
  if (format === 'iife') return iife;
  if (format === 'base64') return Buffer.from(iife, 'utf8').toString('base64');
  throw new Error(`Unknown --format "${format}" (expected iife or base64)`);
}

function readDist() {
  if (!existsSync(DIST_PATH)) throw new Error(`dist/shim.js not found at ${DIST_PATH}; run "npm run build" first`);
  return readFileSync(DIST_PATH, 'utf8');
}

export async function resolveIdentity(values, io) {
  // Extended in Task 12 with private-key / generate-key handling.
  if (values.address) return { address: values.address, privateKey: null, mode: 'address' };
  throw new Error('No identity given: pass --address, --private-key, --private-key-file, or --generate-key');
}

export async function runCli(argv, io) {
  let values;
  try {
    ({ values } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: false }));
  } catch (e) {
    io.stderr(`error: ${e.message}\n${USAGE}`);
    return 1;
  }
  if (values.help) {
    io.stdout(USAGE);
    return 0;
  }
  if (values.version) {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    io.stdout(`${pkg.version}\n`);
    return 0;
  }

  try {
    const fileCfg = values.config ? JSON.parse(readFileSync(resolve(io.cwd, values.config), 'utf8')) : {};
    const merged = { ...DEFAULTS, ...fileCfg };
    if (fileCfg.chainId !== undefined) merged.chainId = resolveChain(fileCfg.chainId);
    if (values.chain !== undefined) merged.chainId = resolveChain(values.chain);
    if (values.rpc !== undefined) merged.rpcUrl = values.rpc;
    if (values.name !== undefined) merged.name = values.name;
    if (values.rdns !== undefined) merged.rdns = values.rdns;
    merged.overrides = { ...(fileCfg.overrides ?? {}) };
    for (const spec of values.override) {
      const [m, v] = parseOverride(spec);
      merged.overrides[m] = v;
    }

    const identity = await resolveIdentity({ ...values, address: values.address ?? fileCfg.address, 'private-key': values['private-key'] ?? fileCfg.privateKey }, io);
    merged.address = identity.address;
    merged.privateKey = identity.privateKey;
    if (!merged.rpcUrl) merged.rpcUrl = CHAINS[merged.chainId]?.rpc ?? null;

    const config = resolveConfig(merged);
    const output = buildOutput(config, readDist(), values.format);

    if (values.out) {
      writeFileSync(resolve(io.cwd, values.out), output, 'utf8');
    } else {
      io.stdout(output);
    }

    if (!values.quiet) {
      const chainName = CHAINS[config.chainId]?.name ?? 'custom';
      io.stderr(`[wallet-shim] mode: ${identity.mode}\n`);
      io.stderr(`[wallet-shim] address: ${config.address ?? identity.address}\n`);
      io.stderr(`[wallet-shim] chain: ${BigInt(config.chainId)} (${chainName}) rpc: ${config.rpcUrl ?? 'none'}\n`);
      if (identity.keyFile) io.stderr(`[wallet-shim] private key saved to: ${identity.keyFile} (gitignored)\n`);
      if (values.out) io.stderr(`[wallet-shim] written: ${resolve(io.cwd, values.out)}\n`);
      if (values['print-config']) io.stderr(`[wallet-shim] config: ${JSON.stringify(publicConfig(config), null, 2)}\n`);
    }
    return 0;
  } catch (e) {
    io.stderr(`error: ${e.message}\n`);
    return 1;
  }
}
```

`bin/wallet-shim.mjs`:
```js
#!/usr/bin/env node
import { runCli } from '../src/cli/index.js';

const code = await runCli(process.argv.slice(2), {
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
  cwd: process.cwd(),
});
process.exit(code);
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run test/unit/cli.test.js && node bin/wallet-shim.mjs --address 0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf --chain sepolia --quiet | head -c 120`
Expected: PASS。CLI が `window.__WALLET_SHIM_CONFIG__ = {...}` から始まる出力を出す

- [ ] **Step 5: コミット**

```bash
git add src/cli/index.js bin/wallet-shim.mjs test/unit/cli.test.js
git commit -m "feat(cli): 設定マージと注入用 JS の出力（アドレスモード）

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: CLI — 鍵モード（--private-key / --private-key-file / --generate-key）

**Files:**
- Modify: `src/cli/index.js`（`resolveIdentity` を置き換え）
- Test: `test/unit/cli-keys.test.js`

**Interfaces:**
- Consumes: `deriveAddress`（`src/signing/evm.js`、動的 import）
- Produces: `resolveIdentity(values, io) → { address, privateKey, mode: 'address'|'private-key'|'generated-key', keyFile? }`

- [ ] **Step 1: 失敗するテストを書く**

`test/unit/cli-keys.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli } from '../../src/cli/index.js';

const PK_ONE = '0x' + '00'.repeat(31) + '01';
const ADDR_ONE = '0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf';

function io() {
  const out = [], err = [];
  return { stdout: (s) => out.push(s), stderr: (s) => err.push(s), cwd: mkdtempSync(join(tmpdir(), 'wallet-shim-')), out, err };
}
const cfgOf = (text) => JSON.parse(text.split('\n')[0].slice('window.__WALLET_SHIM_CONFIG__ = '.length, -1));

describe('cli (key modes)', () => {
  it('--private-key derives the address and embeds the key in the script only', async () => {
    const i = io();
    expect(await runCli(['--private-key', PK_ONE, '--print-config'], i)).toBe(0);
    const cfg = cfgOf(i.out.join(''));
    expect(cfg.address).toBe(ADDR_ONE);
    expect(cfg.privateKey).toBe(PK_ONE);
    const err = i.err.join('');
    expect(err).toContain('mode: private-key');
    expect(err).toContain(ADDR_ONE);
    expect(err).not.toContain(PK_ONE);
    expect(err).not.toContain('"privateKey"');
  });
  it('--private-key-file reads the key (trimmed, with or without 0x)', async () => {
    const i = io();
    const f = join(i.cwd, 'key.txt');
    writeFileSync(f, PK_ONE.slice(2) + '\n');
    expect(await runCli(['--private-key-file', f], i)).toBe(0);
    expect(cfgOf(i.out.join('')).address).toBe(ADDR_ONE);
  });
  it('--generate-key writes a key file under .wallet-shim and never prints the key', async () => {
    const i = io();
    const out = join(i.cwd, 'shim.out.js');
    expect(await runCli(['--generate-key', '--out', out], i)).toBe(0);
    const cfg = cfgOf(readFileSync(out, 'utf8'));
    expect(cfg.privateKey).toMatch(/^0x[0-9a-f]{64}$/);
    expect(cfg.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    const dir = join(i.cwd, '.wallet-shim');
    const files = readdirSync(dir);
    expect(files).toContain(`key-${cfg.address}.txt`);
    expect(files).toContain('.gitignore');
    expect(readFileSync(join(dir, '.gitignore'), 'utf8').trim()).toBe('*');
    expect(readFileSync(join(dir, `key-${cfg.address}.txt`), 'utf8').trim()).toBe(cfg.privateKey);
    const err = i.err.join('');
    expect(err).toContain('mode: generated-key');
    expect(err).toContain(`key-${cfg.address}.txt`);
    expect(err).not.toContain(cfg.privateKey);
  });
  it('defaults to --generate-key when no identity is given', async () => {
    const i = io();
    expect(await runCli(['--quiet'], i)).toBe(0);
    expect(cfgOf(i.out.join('')).privateKey).toMatch(/^0x[0-9a-f]{64}$/);
    expect(existsSync(join(i.cwd, '.wallet-shim'))).toBe(true);
  });
  it('--private-key wins over --address and generated keys differ per run', async () => {
    const i = io();
    await runCli(['--private-key', PK_ONE, '--address', '0x' + 'cc'.repeat(20), '--quiet'], i);
    expect(cfgOf(i.out.join('')).address).toBe(ADDR_ONE);
    const a = io(), b = io();
    await runCli(['--generate-key', '--quiet'], a);
    await runCli(['--generate-key', '--quiet'], b);
    expect(cfgOf(a.out.join('')).address).not.toBe(cfgOf(b.out.join('')).address);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run test/unit/cli-keys.test.js`
Expected: FAIL

- [ ] **Step 3: 実装（`src/cli/index.js` の `resolveIdentity` を置き換え、import を追加）**

既存の `node:fs` import 行に `mkdirSync, chmodSync` を足し、`node:crypto` の import を追加する:
```js
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
```

置き換え:
```js
async function loadSigning() {
  try {
    return await import('../signing/evm.js');
  } catch (e) {
    if (e?.code === 'ERR_MODULE_NOT_FOUND') {
      throw new Error('Key modes need @noble/curves and @noble/hashes. Run "npm install" in the wallet-shim directory, or use --address instead.');
    }
    throw e;
  }
}

function normalizeKey(raw) {
  const s = String(raw).trim();
  const hex = s.startsWith('0x') || s.startsWith('0X') ? s.slice(2) : s;
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error('Invalid private key: expected 64 hex chars (with or without 0x)');
  return '0x' + hex.toLowerCase();
}

function saveGeneratedKey(io, address, privateKey) {
  const dir = resolve(io.cwd, '.wallet-shim');
  mkdirSync(dir, { recursive: true });
  const ignore = resolve(dir, '.gitignore');
  if (!existsSync(ignore)) writeFileSync(ignore, '*\n', 'utf8');
  const file = resolve(dir, `key-${address}.txt`);
  writeFileSync(file, privateKey + '\n', { encoding: 'utf8', mode: 0o600 });
  try {
    chmodSync(file, 0o600);
  } catch {
    // Windows ignores POSIX modes; the directory is gitignored regardless.
  }
  return file;
}

export async function resolveIdentity(values, io) {
  let privateKey = null;
  let mode;
  if (values['private-key']) {
    privateKey = normalizeKey(values['private-key']);
    mode = 'private-key';
  } else if (values['private-key-file']) {
    privateKey = normalizeKey(readFileSync(resolve(io.cwd, values['private-key-file']), 'utf8'));
    mode = 'private-key';
  } else if (values.address && !values['generate-key']) {
    return { address: values.address, privateKey: null, mode: 'address' };
  } else {
    privateKey = '0x' + randomBytes(32).toString('hex');
    mode = 'generated-key';
  }
  const { deriveAddress } = await loadSigning();
  const address = deriveAddress(privateKey);
  const identity = { address, privateKey, mode };
  if (mode === 'generated-key') identity.keyFile = saveGeneratedKey(io, address, privateKey);
  return identity;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run test/unit/cli-keys.test.js test/unit/cli.test.js`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/cli/index.js test/unit/cli-keys.test.js
git commit -m "feat(cli): 秘密鍵モードと使い捨て鍵の自動生成

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 13: フィクスチャ dApp と E2E 手順、agent-browser での実機確認

**Files:**
- Create: `test/fixture/index.html`, `test/e2e.md`

**Interfaces:**
- Consumes: `dist/shim.js`（Task 10）、CLI（Task 11/12）
- Produces: `npm run fixture` で http://localhost:3000 に最小 dApp。`#status` が `DONE` になれば接続→署名→送信→レシートまで通ったことになる

- [ ] **Step 1: フィクスチャを書く**

`test/fixture/index.html`:
```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>wallet-shim fixture</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 2rem; max-width: 720px; }
    pre { background: #f4f4f4; padding: 1rem; white-space: pre-wrap; word-break: break-all; }
    button { margin: 0.25rem 0; }
  </style>
</head>
<body>
  <h1>wallet-shim fixture</h1>
  <p>Status: <strong id="status">IDLE</strong></p>
  <h2>EIP-6963 wallets</h2>
  <ul id="wallets"></ul>
  <button id="connect-legacy">Connect via window.ethereum</button>
  <button id="rediscover">Re-dispatch eip6963:requestProvider</button>
  <pre id="log"></pre>

  <script type="module">
    import { createWalletClient, createPublicClient, custom, parseEther } from 'https://esm.sh/viem@2';

    const $ = (id) => document.getElementById(id);
    const log = (m) => { $('log').textContent += m + '\n'; };
    const providers = new Map();

    window.addEventListener('eip6963:announceProvider', (e) => {
      const { info, provider } = e.detail;
      if (providers.has(info.uuid)) return;
      providers.set(info.uuid, { info, provider });
      log(`detected: ${info.name} (${info.rdns})`);
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.textContent = `Connect ${info.name}`;
      btn.onclick = () => run(provider);
      li.appendChild(btn);
      $('wallets').appendChild(li);
    });
    window.dispatchEvent(new Event('eip6963:requestProvider'));

    $('connect-legacy').onclick = () => (window.ethereum ? run(window.ethereum) : log('no window.ethereum'));
    $('rediscover').onclick = () => window.dispatchEvent(new Event('eip6963:requestProvider'));

    async function run(provider) {
      $('status').textContent = 'RUNNING';
      try {
        const wallet = createWalletClient({ transport: custom(provider) });
        const pub = createPublicClient({ transport: custom(provider) });
        const [account] = await wallet.requestAddresses();
        log(`connected: ${account}`);
        log(`chainId: ${await wallet.getChainId()}`);
        const sig = await wallet.signMessage({ account, message: 'hello from fixture' });
        log(`signature: ${sig}`);
        const hash = await wallet.sendTransaction({ account, to: account, value: parseEther('0.001'), chain: null });
        log(`tx sent: ${hash}`);
        const receipt = await pub.waitForTransactionReceipt({ hash });
        log(`receipt: status=${receipt.status} block=${receipt.blockNumber}`);
        $('status').textContent = 'DONE';
      } catch (e) {
        log(`ERROR: ${e.shortMessage ?? e.message}`);
        $('status').textContent = 'ERROR';
      }
    }
  </script>
</body>
</html>
```

- [ ] **Step 2: E2E 手順を書く**

`test/e2e.md`:
````markdown
# E2E（手動、agent-browser）

前提: `npm install` 済み、`dist/shim.js` がビルド済み、agent-browser が使える（`npx agent-browser --version`）。

## 1. フィクスチャを立てる

```bash
npm run fixture          # http://localhost:3000
```

## 2. 注入用 JS を作る

```bash
node bin/wallet-shim.mjs --generate-key --chain sepolia --out .wallet-shim/shim.out.js
```

ネットワークが無い環境では `--override eth_blockNumber=\"0x10\"` を足すと viem のレシート待ちが RPC に依存しなくなる。

## 3. ロード前注入で開く

```bash
npx agent-browser open --init-script .wallet-shim/shim.out.js http://localhost:3000
npx agent-browser wait --text "detected: MetaMask"
npx agent-browser snapshot -i
npx agent-browser find text "Connect MetaMask" click
npx agent-browser wait --text "receipt: status=success"
npx agent-browser get text "#status"                     # => DONE
npx agent-browser eval "JSON.stringify(window.__WALLET_SHIM__.calls.map(c => c.method))"
npx agent-browser eval "JSON.stringify(window.__WALLET_SHIM__.txs)"
npx agent-browser close
```

期待値:
- `calls` に `eth_requestAccounts`, `eth_chainId`, `personal_sign`, `eth_sendTransaction`, `eth_getTransactionReceipt` が含まれる
- `txs` に 1 件、`to` が接続アドレスと同じ

## 4. ロード後注入のフォールバック確認

```bash
npx agent-browser open http://localhost:3000
node bin/wallet-shim.mjs --address 0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf --format base64 --quiet > .wallet-shim/shim.b64
npx agent-browser eval -b "$(cat .wallet-shim/shim.b64)"
npx agent-browser wait --text "detected: MetaMask"      # 注入時の announce で検出される
npx agent-browser find text "Connect MetaMask" click
npx agent-browser wait --text "receipt: status=success"
npx agent-browser close
```

PowerShell では `$b = Get-Content .wallet-shim/shim.b64 -Raw; npx agent-browser eval -b $b`。
````

- [ ] **Step 3: E2E を実際に走らせる**

Run（別ターミナルで `npm run fixture` を起動した上で）: `test/e2e.md` のセクション 2〜4 を順に実行
Expected: `#status` が `DONE`、`calls` に期待メソッドが含まれる。ロード後注入でも `detected: MetaMask` が出る。うまくいかない場合は `npx agent-browser console` でページのエラーを確認し、agent-browser のフラグ名は `npx agent-browser skills get core --full` で照合する

- [ ] **Step 4: 実行結果を e2e.md の末尾に記録する**

`test/e2e.md` の末尾に「最終確認: 2026-MM-DD、agent-browser vX.Y.Z、Chrome N、結果 DONE」を1行追加する。

- [ ] **Step 5: コミット**

```bash
git add test/fixture/index.html test/e2e.md
git commit -m "test: フィクスチャ dApp と agent-browser E2E 手順

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 14: 注入レシピ（5 ツール分）

**Files:**
- Create: `recipes/agent-browser.md`, `recipes/playwright.md`, `recipes/puppeteer.md`, `recipes/claude-in-chrome.md`, `recipes/devtools.md`

**Interfaces:**
- Consumes: CLI の出力（`--out` / `--format base64`）、`window.__WALLET_SHIM__` の制御 API

- [ ] **Step 1: 共通フォールバック節を決める（各ファイルの末尾に同じ文面を入れる）**

```markdown
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
```

- [ ] **Step 2: agent-browser レシピ**

`recipes/agent-browser.md`:
````markdown
# agent-browser への注入

3 経路ある。ロード前注入（1, 2）を優先する。

## 1. `open --init-script`（推奨: 新規セッション）

```bash
node bin/wallet-shim.mjs --generate-key --chain sepolia --out ./shim.out.js
npx agent-browser open --init-script ./shim.out.js https://app.example.com
```

init script は以後そのセッションで開く全タブに適用される。

## 2. `addinitscript`（セッション起動後、次のナビゲーションから）

```bash
npx agent-browser open                                    # URL 無しでクリーン起動
npx agent-browser addinitscript "$(cat ./shim.out.js)"    # 識別子が返る
npx agent-browser open https://app.example.com
npx agent-browser removeinitscript <identifier>           # 外すとき
```

PowerShell: `npx agent-browser addinitscript (Get-Content ./shim.out.js -Raw)`

シムは 100KB 超なのでコマンドライン長の上限（cmd.exe は約 8K）に当たることがある。その場合は経路 1 の `--init-script <path>` を使う。

## 3. `eval -b`（ロード後注入。ページ JS 実行後なのでフォールバック）

```bash
node bin/wallet-shim.mjs --address 0x... --format base64 --quiet > ./shim.b64
npx agent-browser eval -b "$(cat ./shim.b64)"
```

## 動作確認

```bash
npx agent-browser eval "window.__WALLET_SHIM__ && window.__WALLET_SHIM__.config.address"
npx agent-browser eval "JSON.stringify(window.__WALLET_SHIM__.calls.map(c => c.method))"
```

（共通フォールバック節）
````

- [ ] **Step 3: Playwright / Puppeteer レシピ**

`recipes/playwright.md`:
````markdown
# Playwright への注入

## ロード前（推奨）

```js
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';

const shim = execFileSync('node', ['bin/wallet-shim.mjs', '--address', '0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf', '--chain', 'sepolia', '--quiet'], { encoding: 'utf8' });

const browser = await chromium.launch();
const context = await browser.newContext();
await context.addInitScript(shim);            // 文字列でも { path } でも可
const page = await context.newPage();
await page.goto('https://app.example.com');
```

Playwright Test なら `test.beforeEach(async ({ context }) => { await context.addInitScript({ path: 'shim.out.js' }); })`。

## ロード後（フォールバック）

```js
await page.evaluate(shim);
```

## 確認

```js
const calls = await page.evaluate(() => window.__WALLET_SHIM__.calls.map((c) => c.method));
expect(calls).toContain('eth_requestAccounts');
```

（共通フォールバック節）
````

`recipes/puppeteer.md`:
````markdown
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

（共通フォールバック節）
````

- [ ] **Step 4: claude-in-chrome / DevTools レシピ**

`recipes/claude-in-chrome.md`:
````markdown
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

（共通フォールバック節）
````

`recipes/devtools.md`:
````markdown
# DevTools コンソールに手貼り

1. `node bin/wallet-shim.mjs --address 0x... --out shim.out.js`
2. 対象ページで DevTools（F12）→ Console
3. `shim.out.js` の中身を貼り付けて Enter
4. `window.__WALLET_SHIM__.config` で確認

Chrome の「Sources → Snippets」に保存しておけば毎回貼らずに済む。ロード後注入なので、リロードすると消える。

（共通フォールバック節）
````

- [ ] **Step 5: 5 ファイルに共通フォールバック節を貼り込み、コミット**

各レシピ末尾の `（共通フォールバック節）` を Step 1 の文面で置き換える。

```bash
git add recipes
git commit -m "docs: ツール別の注入レシピ

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 15: SKILL.md / README / スキル登録

**Files:**
- Create: `SKILL.md`, `README.md`
- Modify: `docs/superpowers/specs/2026-09-18-wallet-shim-design.md`（`files` に `src` を含める点、`src/core/errors.js` / `src/shim.js` / `src/cli/` / `scripts/build.mjs` の追加を反映）
- 外部: `~/.agents/skills/wallet-shim` と `~/.claude/skills/wallet-shim` の symlink

**Interfaces:**
- Consumes: すべて

- [ ] **Step 1: SKILL.md を書く**

```markdown
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
   node <skill-dir>/bin/wallet-shim.mjs --generate-key --chain sepolia --out <scratch>/shim.out.js --print-config
   ```
   stderr に接続アドレスが出る。鍵は `.wallet-shim/` に保存される
3. **注入する**: 使っているツールのレシピを読む
   - `recipes/agent-browser.md`（`open --init-script` が最も確実）
   - `recipes/playwright.md` / `recipes/puppeteer.md`
   - `recipes/claude-in-chrome.md`（ロード後注入のみ）
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

## やってはいけないこと

- 本番の秘密鍵を `--private-key` に渡さない
- `.wallet-shim/` をコミットしない（自動で gitignore される）
- 鍵モードの出力 JS には秘密鍵が含まれる。`--out` でファイルに出し、ターミナルに流さない
```

- [ ] **Step 2: README.md を書く**

```markdown
# wallet-shim

Fake EIP-1193 / EIP-6963 provider (MetaMask-compatible) for dApp browser automation. Injects a "connected" wallet, signs with a throwaway key or fakes signatures for an arbitrary address, and dry-runs transactions (records them, returns a hash and a synthesized receipt, never broadcasts).

```bash
npm install
npm run build                      # dist/shim.js
node bin/wallet-shim.mjs --generate-key --chain sepolia --out shim.out.js
npx agent-browser open --init-script shim.out.js https://app.example.com
```

- Skill instructions: `SKILL.md`
- Injection recipes: `recipes/`
- Design: `docs/superpowers/specs/2026-09-18-wallet-shim-design.md`

Never use real private keys with this tool.
```

- [ ] **Step 3: 設計書の差分を反映する**

`docs/superpowers/specs/2026-09-18-wallet-shim-design.md` のファイル構成に `src/core/errors.js`, `src/shim.js`, `src/cli/index.js`, `scripts/build.mjs`, `README.md` を追加し、`package.json` の `files` を `["bin", "dist", "src", "recipes", "SKILL.md", "README.md"]` に修正する。鍵の扱いの節に「鍵モードの出力 JS には秘密鍵が含まれる。stderr / `--print-config` には出さない」を追記する。

- [ ] **Step 4: スキルとして登録する**

Run（Git Bash）:
```bash
ln -s /c/Users/user/orca/projects/wallet-shim ~/.agents/skills/wallet-shim
ln -s /c/Users/user/.agents/skills/wallet-shim ~/.claude/skills/wallet-shim
ls -la ~/.claude/skills/wallet-shim/SKILL.md
```
symlink が作れない場合は PowerShell で `New-Item -ItemType SymbolicLink -Path "$HOME\.agents\skills\wallet-shim" -Target "C:\Users\user\orca\projects\wallet-shim"`（管理者権限または開発者モードが必要）。
Expected: `~/.claude/skills/wallet-shim/SKILL.md` が読める

- [ ] **Step 5: 全テストとビルドを通してコミット**

Run: `npm run build && npm test`
Expected: 全件 PASS、`git status` で dist に差分が無い（あれば同じコミットに含める）

```bash
git add SKILL.md README.md docs dist
git commit -m "docs: SKILL.md / README とスキル登録

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## 完成の定義（設計書より）

- `npm test` が通り、`npm run build` で `dist/shim.js` が再生成される
- フィクスチャ dApp で agent-browser の init-script 経由で接続・署名・送信完了まで到達する（Task 13 で実測）
- `recipes/` の 5 ファイルと SKILL.md が揃い、`~/.agents/skills/wallet-shim` から参照できる
