# Contributing

Thanks for helping improve wallet-shim. Issues and pull requests are welcome in English or Japanese.

## Development setup

```bash
git clone https://github.com/nft-syou/wallet-shim.git
cd wallet-shim
npm install
npm test            # vitest unit tests
npm run build       # rebuilds dist/shim.js (commit it together with src/ changes)
```

End-to-end check against the bundled fixture dApp:

```bash
npm run fixture     # terminal 1: bundles viem locally and serves test/fixture on :3000
node bin/wallet-shim.mjs --generate-key --chain sepolia --out .wallet-shim/shim.out.js
npm run e2e         # terminal 2: puppeteer-core drives load-before and load-after injection
```

`npm run e2e` looks for the Chrome that `agent-browser install` downloads; point `WALLET_SHIM_CHROME` at any Chrome/Chromium binary otherwise.

## Ground rules

- `dist/shim.js` is generated from `src/` by esbuild and is committed. CI fails if it is out of date, so run `npm run build` before committing `src/` changes.
- Keep `src/core/` chain-agnostic. New chains go under `src/chains/<name>/` and are registered in `src/shim.js`.
- Browser globals (`window`, `fetch`, `console`) reach `src/` only through the `env` object; `src/index.js` is the single place that passes them in.
- Never log or print private keys. The CLI's stderr summary and `--print-config` must stay key-free; tests assert this.
- Add or update a unit test for every behavior change. Signature changes must keep the viem cross-checks (`verifyMessage`, `verifyTypedData`) green.
- The agent skill (`skills/wallet-shim/`) contains only SKILL.md and recipes. Tool-specific injection steps belong in `skills/wallet-shim/recipes/<tool>.md`, not in SKILL.md.

## Releasing (maintainers)

1. Update `CHANGELOG.md` and bump `version` in `package.json` (`npm version patch|minor` also creates the tag).
2. `npm publish` (runs `npm run build && npm test` first; requires the npm account's 2FA).
3. `git push --follow-tags`.
