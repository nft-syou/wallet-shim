# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to [Semantic Versioning](https://semver.org/).

## [0.1.2] - 2026-09-22

> 0.1.1 was never released: the registry wedged that version number in a phantom "staged" state ([npm/cli#9889](https://github.com/npm/cli/issues/9889)), so the same changes ship as 0.1.2.

### Changed
- The agent skill now lives in `skills/wallet-shim/` (SKILL.md + injection recipes only) so `npx skills add nft-syou/wallet-shim` copies 7 files instead of the whole repository.
- SKILL.md calls the CLI through `npx wallet-shim@latest`; the npm package no longer ships SKILL.md or recipes.

### Added
- MIT `LICENSE`, `CHANGELOG.md`, `CONTRIBUTING.md`, `SECURITY.md`, GitHub Actions CI (Node 20/22 on Ubuntu and Windows), README badges.
- Recipe for Orca's built-in browser (`orca eval` + `<script src>` injection), verified against the fixture and a live RainbowKit dApp.

## [0.1.0] - 2026-09-22

### Added
- Fake EIP-1193 / EIP-6963 provider (MetaMask-compatible): `window.ethereum` plus `eip6963:announceProvider`, connect / chain switching / permissions, `personal_sign` and EIP-712 typed data (real secp256k1 signatures with a throwaway or explicit key, deterministic fake signatures in address mode), dry-run transactions with synthesized receipts, RPC passthrough with per-method overrides.
- Control API on `window.__WALLET_SHIM__` (`calls`, `txs`, `rejectNext`, `override`, `setAccounts`, `setChainId`, `disconnect`).
- CLI `wallet-shim` that prepends the config to the committed `dist/shim.js` bundle; key generation stored under `.wallet-shim/` (auto-gitignored).
- Injection recipes for agent-browser, Playwright, Puppeteer, claude-in-chrome and DevTools; fixture dApp and puppeteer-core E2E (`npm run e2e`).
