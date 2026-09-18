import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

const ADDR = '0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf';

describe('dist/shim.js', () => {
  beforeAll(() => {
    if (!existsSync('dist/shim.js')) execSync('npm run build', { stdio: 'inherit' });
  });
  it('self-installs from window.__WALLET_SHIM_CONFIG__', async () => {
    const code = readFileSync('dist/shim.js', 'utf8');
    const win = new EventTarget();
    win.__WALLET_SHIM_CONFIG__ = { address: ADDR, chainId: '0xaa36a7', verbose: false };
    win.fetch = async () => ({ ok: true, json: async () => ({ result: '0x1' }) });
    new Function('window', code)(win);
    expect(win.ethereum).toBeDefined();
    expect(win.__WALLET_SHIM__.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(await win.ethereum.request({ method: 'eth_chainId' })).toBe('0xaa36a7');
    expect(await win.ethereum.request({ method: 'eth_requestAccounts' })).toEqual([ADDR]);
  });
  it('is idempotent and does not throw without config', () => {
    const code = readFileSync('dist/shim.js', 'utf8');
    const win = new EventTarget();
    expect(() => new Function('window', code)(win)).not.toThrow();
    expect(win.ethereum).toBeUndefined();
    win.__WALLET_SHIM_CONFIG__ = { address: ADDR, verbose: false };
    new Function('window', code)(win);
    const first = win.ethereum;
    new Function('window', code)(win);
    expect(win.ethereum).toBe(first);
  });
});
