// Replaced by esbuild `define` at build time; stays 'dev' under vitest.
export const VERSION =
  typeof __WALLET_SHIM_VERSION__ !== 'undefined' ? __WALLET_SHIM_VERSION__ : 'dev';
