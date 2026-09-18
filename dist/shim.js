/* wallet-shim v0.1.0 - fake EIP-1193 provider for dApp browser automation. Do not use with real keys. */
(() => {
  // src/version.js
  var VERSION = true ? "0.1.0" : "dev";

  // src/index.js
  console.debug(`[wallet-shim] v${VERSION}`);
})();
