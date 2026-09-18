# wallet-shim

Fake EIP-1193 / EIP-6963 provider (MetaMask-compatible) for dApp browser automation. Injects a "connected" wallet, signs with a throwaway key or fakes signatures for an arbitrary address, and dry-runs transactions (records them, returns a hash and a synthesized receipt, never broadcasts).

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

Never use real private keys with this tool.
