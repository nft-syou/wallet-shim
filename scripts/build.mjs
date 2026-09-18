import { build } from 'esbuild';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

await build({
  entryPoints: ['src/index.js'],
  bundle: true,
  format: 'iife',
  target: ['es2020'],
  outfile: 'dist/shim.js',
  minify: false,
  legalComments: 'none',
  define: { __WALLET_SHIM_VERSION__: JSON.stringify(pkg.version) },
  banner: {
    js: `/* wallet-shim v${pkg.version} - fake EIP-1193 provider for dApp browser automation. Do not use with real keys. */`,
  },
});
console.log('built dist/shim.js');
