# wallet-shim

Fake EIP-1193 / EIP-6963 provider (MetaMask-compatible) for dApp browser automation. Injects a "connected" wallet, signs with a throwaway key or fakes signatures for an arbitrary address, and dry-runs transactions (records them, returns a hash and a synthesized receipt, never broadcasts).

## Install as an agent skill

```bash
npx skills add nft-syou/wallet-shim          # picks the agents you have installed
npx skills add nft-syou/wallet-shim -a claude-code -y
```

The installed skill ships `dist/shim.js`, so address mode (`--address 0x...`) works immediately. Key modes (`--generate-key`, `--private-key-file`) need `@noble/curves` once: run `npm install` inside the installed skill directory. Install from the GitHub source rather than a local checkout; a local-path install copies `node_modules` and any `.wallet-shim/` keys along with it.

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
