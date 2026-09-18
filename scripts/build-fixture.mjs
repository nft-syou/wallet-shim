import { build } from 'esbuild';

await build({
  entryPoints: ['test/fixture/viem-entry.js'],
  bundle: true,
  format: 'esm',
  target: ['es2022'],
  platform: 'browser',
  outfile: 'test/fixture/vendor/viem.js',
  minify: false,
  legalComments: 'none',
});

console.log('built test/fixture/vendor/viem.js');
