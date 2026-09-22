# wallet-shim

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

The installed skill also ships `bin/` + `dist/shim.js` as an offline fallback: address mode works from there immediately; key modes need one `npm install` inside the skill directory. Install the skill from the GitHub source rather than a local checkout; a local-path install copies `node_modules` and any `.wallet-shim/` keys along with it.

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

- Skill instructions: `SKILL.md`
- Injection recipes: `recipes/`
- Design: `docs/superpowers/specs/2026-09-18-wallet-shim-design.md`

## Verified

- Unit tests: `npm test` (vitest) covers the router, signing, chains, CLI and dist bundle.
- E2E: `npm run e2e` drives the bundled fixture dApp with puppeteer-core against the Chrome that `agent-browser install` downloads, exercising both load-before (`evaluateOnNewDocument`) and load-after (`page.evaluate`) injection.
- Orca built-in browser: load-after injection via `orca eval` + `<script src>` verified manually against the fixture (see `recipes/orca-cli.md`).

Never use real private keys with this tool.
