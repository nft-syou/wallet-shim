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
    // Remove the private-key-bearing config from window once installed so it
    // does not stay readable by page scripts after the shim has bootstrapped.
    try {
      delete window.__WALLET_SHIM_CONFIG__;
    } catch {
      window.__WALLET_SHIM_CONFIG__ = undefined;
    }
  } catch (e) {
    console.error('[wallet-shim] failed to install:', e);
  }
})();
