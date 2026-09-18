import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli } from '../../src/cli/index.js';

const ADDR = '0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf';

function io() {
  const out = [], err = [];
  return { stdout: (s) => out.push(s), stderr: (s) => err.push(s), cwd: mkdtempSync(join(tmpdir(), 'wallet-shim-')), out, err };
}

function firstLineConfig(text) {
  const line = text.split('\n')[0];
  expect(line.startsWith('window.__WALLET_SHIM_CONFIG__ = ')).toBe(true);
  return JSON.parse(line.slice('window.__WALLET_SHIM_CONFIG__ = '.length, -1));
}

describe('cli (address mode)', () => {
  beforeAll(() => {
    if (!existsSync('dist/shim.js')) execSync('npm run build', { stdio: 'inherit' });
  });
  it('emits config + bundle to stdout', async () => {
    const i = io();
    expect(await runCli(['--address', ADDR, '--chain', 'sepolia'], i)).toBe(0);
    const text = i.out.join('');
    const cfg = firstLineConfig(text);
    expect(cfg).toMatchObject({ address: ADDR, chainId: '0xaa36a7', chain: 'evm', name: 'MetaMask' });
    expect(cfg.rpcUrl).toMatch(/^https:/);
    expect(cfg.privateKey).toBeNull();
    expect(text).toContain('eip6963:announceProvider');
    expect(i.err.join('')).toContain(ADDR);
    expect(i.err.join('')).toContain('sepolia');
  });
  it('supports --out, --format base64, --rpc, --name, --rdns, --override', async () => {
    const i = io();
    const out = join(i.cwd, 'shim.out.js');
    const code = await runCli(['--address', ADDR, '--chain', '0x2105', '--rpc', 'http://rpc.local', '--name', 'Shim', '--rdns', 'dev.shim',
      '--override', 'eth_getBalance=\"0x1\"', '--override', 'eth_blockNumber=0x10', '--out', out], i);
    expect(code).toBe(0);
    expect(i.out).toHaveLength(0);
    const cfg = firstLineConfig(readFileSync(out, 'utf8'));
    expect(cfg).toMatchObject({ chainId: '0x2105', rpcUrl: 'http://rpc.local', name: 'Shim', rdns: 'dev.shim', overrides: { eth_getBalance: '0x1', eth_blockNumber: '0x10' } });

    const b = io();
    await runCli(['--address', ADDR, '--format', 'base64', '--quiet'], b);
    const decoded = Buffer.from(b.out.join(''), 'base64').toString('utf8');
    expect(firstLineConfig(decoded).address).toBe(ADDR);
    expect(b.err).toHaveLength(0);
  });
  it('merges --config file with flags taking precedence', async () => {
    const i = io();
    const cfgPath = join(i.cwd, 'cfg.json');
    writeFileSync(cfgPath, JSON.stringify({ address: ADDR, chainId: 'base', name: 'FromFile', autoConnect: false }));
    await runCli(['--config', cfgPath, '--name', 'FromFlag'], i);
    const cfg = firstLineConfig(i.out.join(''));
    expect(cfg).toMatchObject({ chainId: '0x2105', name: 'FromFlag', autoConnect: false });
  });
  it('fails clearly on bad input', async () => {
    const i = io();
    expect(await runCli(['--address', '0x123'], i)).toBe(1);
    expect(i.err.join('')).toMatch(/Invalid address/);
    const j = io();
    expect(await runCli(['--address', ADDR, '--chain', 'nope'], j)).toBe(1);
    expect(j.err.join('')).toMatch(/Unknown chain/);
    const k = io();
    expect(await runCli(['--address', ADDR, '--format', 'xml'], k)).toBe(1);
  });
  it('--help prints usage and exits 0', async () => {
    const i = io();
    expect(await runCli(['--help'], i)).toBe(0);
    expect(i.out.join('')).toContain('--address');
  });
});
