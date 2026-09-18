import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli } from '../../src/cli/index.js';

const PK_ONE = '0x' + '00'.repeat(31) + '01';
const ADDR_ONE = '0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf';

function io() {
  const out = [], err = [];
  return { stdout: (s) => out.push(s), stderr: (s) => err.push(s), cwd: mkdtempSync(join(tmpdir(), 'wallet-shim-')), out, err };
}
const cfgOf = (text) => JSON.parse(text.split('\n')[0].slice('window.__WALLET_SHIM_CONFIG__ = '.length, -1));

describe('cli (key modes)', () => {
  it('--private-key derives the address and embeds the key in the script only', async () => {
    const i = io();
    expect(await runCli(['--private-key', PK_ONE, '--print-config'], i)).toBe(0);
    const cfg = cfgOf(i.out.join(''));
    expect(cfg.address).toBe(ADDR_ONE);
    expect(cfg.privateKey).toBe(PK_ONE);
    const err = i.err.join('');
    expect(err).toContain('mode: private-key');
    expect(err).toContain(ADDR_ONE);
    expect(err).not.toContain(PK_ONE);
    expect(err).not.toContain('"privateKey"');
  });
  it('--private-key-file reads the key (trimmed, with or without 0x)', async () => {
    const i = io();
    const f = join(i.cwd, 'key.txt');
    writeFileSync(f, PK_ONE.slice(2) + '\n');
    expect(await runCli(['--private-key-file', f], i)).toBe(0);
    expect(cfgOf(i.out.join('')).address).toBe(ADDR_ONE);
  });
  it('--generate-key writes a key file under .wallet-shim and never prints the key', async () => {
    const i = io();
    const out = join(i.cwd, 'shim.out.js');
    expect(await runCli(['--generate-key', '--out', out], i)).toBe(0);
    const cfg = cfgOf(readFileSync(out, 'utf8'));
    expect(cfg.privateKey).toMatch(/^0x[0-9a-f]{64}$/);
    expect(cfg.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    const dir = join(i.cwd, '.wallet-shim');
    const files = readdirSync(dir);
    expect(files).toContain(`key-${cfg.address}.txt`);
    expect(files).toContain('.gitignore');
    expect(readFileSync(join(dir, '.gitignore'), 'utf8').trim()).toBe('*');
    expect(readFileSync(join(dir, `key-${cfg.address}.txt`), 'utf8').trim()).toBe(cfg.privateKey);
    const err = i.err.join('');
    expect(err).toContain('mode: generated-key');
    expect(err).toContain(`key-${cfg.address}.txt`);
    expect(err).not.toContain(cfg.privateKey);
  });
  it('defaults to --generate-key when no identity is given', async () => {
    const i = io();
    expect(await runCli(['--quiet'], i)).toBe(0);
    expect(cfgOf(i.out.join('')).privateKey).toMatch(/^0x[0-9a-f]{64}$/);
    expect(existsSync(join(i.cwd, '.wallet-shim'))).toBe(true);
  });
  it('--private-key wins over --address and generated keys differ per run', async () => {
    const i = io();
    await runCli(['--private-key', PK_ONE, '--address', '0x' + 'cc'.repeat(20), '--quiet'], i);
    expect(cfgOf(i.out.join('')).address).toBe(ADDR_ONE);
    const a = io(), b = io();
    await runCli(['--generate-key', '--quiet'], a);
    await runCli(['--generate-key', '--quiet'], b);
    expect(cfgOf(a.out.join('')).address).not.toBe(cfgOf(b.out.join('')).address);
  });
  it('rewrites a stale .wallet-shim/.gitignore so generated keys stay ignored', async () => {
    const i = io();
    const dir = join(i.cwd, '.wallet-shim');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, '.gitignore'), 'nothing\n');
    expect(await runCli(['--generate-key', '--quiet'], i)).toBe(0);
    expect(readFileSync(join(dir, '.gitignore'), 'utf8').trim()).toBe('*');
  });
});
