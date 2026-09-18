import { describe, it, expect, vi } from 'vitest';
import { createShim } from '../../src/shim.js';

const ADDR = '0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf';

function makeEnv() {
  const win = new EventTarget();
  const fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ jsonrpc: '2.0', id: 1, result: '0x20' }) }));
  const con = { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), log: vi.fn() };
  return { window: win, fetch, console: con };
}

describe('createShim', () => {
  it('installs window.ethereum and announces via EIP-6963', () => {
    const env = makeEnv();
    const announced = [];
    env.window.addEventListener('eip6963:announceProvider', (e) => announced.push(e.detail));
    const control = createShim({ address: ADDR, chainId: 11155111 }, env);
    expect(env.window.ethereum).toBe(control.provider);
    expect(env.window.__WALLET_SHIM__).toBe(control);
    expect(announced).toHaveLength(1);
    expect(announced[0].info).toMatchObject({ name: 'MetaMask', rdns: 'io.metamask' });
    expect(announced[0].info.uuid).toMatch(/^[0-9a-f-]{36}$/);
    expect(announced[0].provider).toBe(control.provider);
    expect(Object.isFrozen(announced[0])).toBe(true);
    env.window.dispatchEvent(new Event('eip6963:requestProvider'));
    expect(announced).toHaveLength(2);
  });
  it('exposes MetaMask-compatible provider surface', async () => {
    const env = makeEnv();
    const { provider } = createShim({ address: ADDR }, env);
    expect(provider.isMetaMask).toBe(true);
    expect(await provider._metamask.isUnlocked()).toBe(true);
    expect(provider.isConnected()).toBe(true);
    expect(provider.selectedAddress).toBe(ADDR);
    expect(provider.chainId).toBe('0x1');
    expect(provider.networkVersion).toBe('1');
    expect(await provider.request({ method: 'eth_requestAccounts' })).toEqual([ADDR]);
    expect(await provider.enable()).toEqual([ADDR]);
    expect(await provider.request({ method: 'eth_blockNumber' })).toBe('0x20');
    expect(env.fetch).toHaveBeenCalledWith('https://ethereum-rpc.publicnode.com', expect.anything());
  });
  it('supports legacy send / sendAsync', async () => {
    const env = makeEnv();
    const { provider } = createShim({ address: ADDR }, env);
    expect(await provider.send('eth_chainId', [])).toBe('0x1');
    const res = await new Promise((resolve) => provider.sendAsync({ id: 7, jsonrpc: '2.0', method: 'eth_chainId', params: [] }, (err, r) => resolve([err, r])));
    expect(res[0]).toBeNull();
    expect(res[1]).toEqual({ id: 7, jsonrpc: '2.0', result: '0x1' });
    const bad = await new Promise((resolve) => provider.sendAsync({ id: 8, jsonrpc: '2.0', method: 'personal_sign', params: ['0x1', '0x' + 'cc'.repeat(20)] }, (err, r) => resolve([err, r])));
    expect(bad[0].code).toBe(4100);
    expect(bad[1].error.code).toBe(4100);
  });
  it('control API drives events and records calls', async () => {
    const env = makeEnv();
    const control = createShim({ address: ADDR, verbose: false }, env);
    const chain = vi.fn();
    control.provider.on('chainChanged', chain);
    control.setChainId('0x2105');
    expect(chain).toHaveBeenCalledWith('0x2105');
    control.rejectNext('eth_requestAccounts');
    await expect(control.provider.request({ method: 'eth_requestAccounts' })).rejects.toMatchObject({ code: 4001 });
    control.override('eth_getBalance', (params) => (params[0] === ADDR ? '0xde0b6b3a7640000' : '0x0'));
    expect(await control.provider.request({ method: 'eth_getBalance', params: [ADDR, 'latest'] })).toBe('0xde0b6b3a7640000');
    expect(control.calls.map((c) => c.method)).toEqual(['eth_requestAccounts', 'eth_getBalance']);
    expect(control.config.address).toBe(ADDR);
    expect(control.config.privateKey).toBeUndefined();
    expect(control.version).toBe('dev');
    expect(control.txs).toEqual([]);
  });
  it('honours replaceExisting=false and custom name/rdns/rpcUrl', () => {
    const env = makeEnv();
    const real = { isMetaMask: true, real: true };
    env.window.ethereum = real;
    const announced = [];
    env.window.addEventListener('eip6963:announceProvider', (e) => announced.push(e.detail));
    createShim({ address: ADDR, replaceExisting: false, name: 'Shim', rdns: 'dev.shim', rpcUrl: 'http://rpc.local' }, env);
    expect(env.window.ethereum).toBe(real);
    expect(env.console.warn).toHaveBeenCalledWith(expect.stringContaining('replaceExisting'));
    expect(announced[0].info.name).toBe('Shim');
    expect(env.window.__WALLET_SHIM__.config.rpcUrl).toBe('http://rpc.local');
  });
  it('rejects unsupported chains', () => {
    expect(() => createShim({ address: ADDR, chain: 'solana' }, makeEnv())).toThrow(/Unsupported chain/);
  });
});
