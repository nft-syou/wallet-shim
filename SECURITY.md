# Security Policy

wallet-shim is a development and testing tool. It injects a fake wallet into web pages you are automating and never broadcasts transactions. Please keep the following in mind.

## Scope and threat model

- **Throwaway keys only.** Keys created with `--generate-key` are meant to be disposable. Never pass a key that controls real funds to `--private-key` / `--private-key-file`. Anything a page's JavaScript can do, it can do with the injected key's signing ability.
- **The emitted JS contains the key** in key mode, by necessity (the provider signs with it in the page). Write it with `--out`, keep it out of logs and version control, and delete it when done. Generated keys are stored under `.wallet-shim/`, which the CLI git-ignores automatically.
- **The page can see everything the shim exposes**: `window.ethereum`, `window.__WALLET_SHIM__` (call log, recorded transactions, control API) and the RPC URL used for passthrough. Do not use RPC URLs that embed production API keys.
- **Fake signatures (address mode) are not cryptographically valid** and will fail server-side verification (for example Sign-In with Ethereum). That is expected.

## Reporting a vulnerability

If you find a way for a page to extract more than the above, escape the dry-run guarantee (cause a real broadcast), or leak keys through the CLI, please report it privately via GitHub's "Report a vulnerability" form on this repository (Security tab). Please include reproduction steps. You should receive a response within 7 days.

Supported versions: the latest release on npm.
