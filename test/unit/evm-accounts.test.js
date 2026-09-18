import { describe, it, expect, vi } from 'vitest';
import { CHAINS, CHAIN_NAMES, resolveChain, METAMASK_ICON } from '../../src/chains/evm/constants.js';
import { makeEvm, ADDR } from './helpers/evm.js';

describe('constants', () => {
  it('knows common chains by name and id', () => {
    expect(CHAIN_NAMES.sepolia).toBe('0xaa36a7');
    expect(CHAINS['0xaa36a7'].rpc).toMatch(/^https:\/\//);
    expect(resolveChain('sepolia')).toBe('0xaa36a7');
    expect(resolveChain('base')).toBe('0x2105');
    expect(resolveChain(31337)).toBe('0x7a69');
    expect(resolveChain('0x1')).toBe('0x1');
    expect(() => resolveChain('nope')).toThrow(/Unknown chain/);
    expect(METAMASK_ICON.startsWith('data:image/svg+xml')).toBe(true);
  });
});

describe('accounts and connection', () => {
  it('eth_requestAccounts returns the account and emits connect once', async () => {
    const evm = makeEvm();
    const connect = vi.fn();
    evm.emitter.on('connect', connect);
    expect(await evm.call('eth_requestAccounts')).toEqual([ADDR]);
    expect(await evm.call('eth_requestAccounts')).toEqual([ADDR]);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledWith({ chainId: '0x1' });
    expect(evm.state.connected).toBe(true);
  });
  it('eth_accounts honours autoConnect', async () => {
    expect(await makeEvm().call('eth_accounts')).toEqual([ADDR]);
    const strict = makeEvm({ autoConnect: false });
    expect(await strict.call('eth_accounts')).toEqual([]);
    await strict.call('eth_requestAccounts');
    expect(await strict.call('eth_accounts')).toEqual([ADDR]);
  });
  it('reports chain id and net version', async () => {
    const evm = makeEvm({ chainId: 11155111 });
    expect(await evm.call('eth_chainId')).toBe('0xaa36a7');
    expect(await evm.call('net_version')).toBe('11155111');
    expect(await evm.call('eth_coinbase')).toBe(ADDR);
  });
  it('permissions round-trip', async () => {
    const evm = makeEvm();
    const perms = await evm.call('wallet_requestPermissions', [{ eth_accounts: {} }]);
    expect(perms[0].parentCapability).toBe('eth_accounts');
    expect(perms[0].caveats[0].value).toEqual([ADDR]);
    expect(await evm.call('wallet_getPermissions')).toEqual(perms);
    expect(await evm.call('wallet_watchAsset', [{ type: 'ERC20' }])).toBe(true);
  });
});

describe('chain switching', () => {
  it('switches to known chains and emits chainChanged', async () => {
    const evm = makeEvm();
    const changed = vi.fn();
    evm.emitter.on('chainChanged', changed);
    expect(await evm.call('wallet_switchEthereumChain', [{ chainId: '0xAA36A7' }])).toBeNull();
    expect(evm.state.chainId).toBe('0xaa36a7');
    expect(changed).toHaveBeenCalledWith('0xaa36a7');
    expect(await evm.call('eth_chainId')).toBe('0xaa36a7');
  });
  it('rejects unknown chains with 4902 unless allowAnyChain', async () => {
    await expect(makeEvm().call('wallet_switchEthereumChain', [{ chainId: '0x123456' }])).rejects.toMatchObject({ code: 4902 });
    const lax = makeEvm({ allowAnyChain: true });
    expect(await lax.call('wallet_switchEthereumChain', [{ chainId: '0x123456' }])).toBeNull();
    expect(lax.state.chainId).toBe('0x123456');
  });
  it('wallet_addEthereumChain registers a chain for later switching', async () => {
    const evm = makeEvm();
    expect(await evm.call('wallet_addEthereumChain', [{ chainId: '0x123456', chainName: 'Custom', rpcUrls: ['http://x'] }])).toBeNull();
    expect(evm.state.chains['0x123456'].name).toBe('Custom');
    expect(await evm.call('wallet_switchEthereumChain', [{ chainId: '0x123456' }])).toBeNull();
  });
  it('rejects malformed switch params with -32602', async () => {
    await expect(makeEvm().call('wallet_switchEthereumChain', [])).rejects.toMatchObject({ code: -32602 });
  });
});

describe('control helpers', () => {
  it('setAccounts / setChainId / disconnect emit events', async () => {
    const evm = makeEvm();
    const accounts = vi.fn();
    const disconnect = vi.fn();
    evm.emitter.on('accountsChanged', accounts);
    evm.emitter.on('disconnect', disconnect);
    await evm.call('eth_requestAccounts');
    evm.setAccounts(['0x' + 'ab'.repeat(20)]);
    expect(accounts).toHaveBeenCalledWith(['0x' + 'ab'.repeat(20)]);
    expect(await evm.call('eth_accounts')).toEqual(['0x' + 'ab'.repeat(20)]);
    evm.setChainId('0x2105');
    expect(evm.state.chainId).toBe('0x2105');
    evm.disconnect();
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(disconnect.mock.calls[0][0].code).toBe(4900);
    expect(evm.state.connected).toBe(false);
    evm.disconnect();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
  it('wallet_revokePermissions disconnects', async () => {
    const evm = makeEvm();
    await evm.call('eth_requestAccounts');
    expect(await evm.call('wallet_revokePermissions', [{ eth_accounts: {} }])).toBeNull();
    expect(evm.state.connected).toBe(false);
  });
});
