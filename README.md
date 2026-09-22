# wallet-shim

[![npm version](https://img.shields.io/npm/v/wallet-shim)](https://www.npmjs.com/package/wallet-shim)
[![CI](https://github.com/nft-syou/wallet-shim/actions/workflows/ci.yml/badge.svg)](https://github.com/nft-syou/wallet-shim/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![node](https://img.shields.io/node/v/wallet-shim)](package.json)
[![Agent skill](https://img.shields.io/badge/agent%20skill-npx%20skills%20add-8A2BE2)](https://github.com/nft-syou/wallet-shim/tree/main/skills/wallet-shim)

Fake EIP-1193 / EIP-6963 provider (MetaMask-compatible) for dApp browser automation. Injects a "connected" wallet, signs with a throwaway key or fakes signatures for an arbitrary address, and dry-runs transactions (records them, returns a hash and a synthesized receipt, never broadcasts).

## Install as an agent skill

```bash
npx skills add nft-syou/wallet-shim          # picks the agents you have installed
npx skills add nft-syou/wallet-shim -a claude-code -y
```

The skill's instructions call the CLI through npm, so nothing else needs installing:

```bash
npx wallet-shim@latest --generate-key --chain sepolia --out shim.out.js
npx wallet-shim@latest --address 0xYourAddress --chain mainnet --out shim.out.js
```

The skill lives in `skills/wallet-shim/` (SKILL.md + injection recipes only, 7 files); the CLI and bundle come from the npm package. Without npm access, clone this repo and run `node bin/wallet-shim.mjs` directly.

## Develop

```bash
npm install
npm run build                      # dist/shim.js
node bin/wallet-shim.mjs --generate-key --chain sepolia --out shim.out.js
npx agent-browser open --init-script shim.out.js https://app.example.com
```

Try it against the bundled fixture dApp end-to-end:

```bash
npm run fixture                    # separate terminal: builds and serves test/fixture on :3000
node bin/wallet-shim.mjs --generate-key --chain sepolia --out .wallet-shim/shim.out.js
npm run e2e                        # drives the fixture with puppeteer-core, asserts connect/sign/send/receipt
```

- Skill instructions: `skills/wallet-shim/SKILL.md`
- Agent skill (instructions + injection recipes): `skills/wallet-shim/`
- Design: `docs/superpowers/specs/2026-09-18-wallet-shim-design.md`

## Verified

- Unit tests: `npm test` (vitest) covers the router, signing, chains, CLI and dist bundle.
- E2E: `npm run e2e` drives the bundled fixture dApp with puppeteer-core against the Chrome that `agent-browser install` downloads, exercising both load-before (`evaluateOnNewDocument`) and load-after (`page.evaluate`) injection.
- Orca built-in browser: load-after injection via `orca eval` + `<script src>` verified manually against the fixture (see `skills/wallet-shim/recipes/orca-cli.md`).

Never use real private keys with this tool. See [SECURITY.md](SECURITY.md) for the threat model.

## Contributing

Bug reports and pull requests are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md). Release notes live in [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE) © 2026 nft-syou
