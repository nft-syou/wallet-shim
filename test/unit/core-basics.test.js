import { describe, it, expect, vi } from 'vitest';
import { ProviderRpcError, errors } from '../../src/core/errors.js';
import { createEmitter } from '../../src/core/emitter.js';
import { DEFAULTS, normalizeChainId, resolveConfig, publicConfig } from '../../src/core/config.js';

const ADDR = '0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf';

describe('errors', () => {
  it('builds EIP-1193 errors with codes', () => {
    expect(errors.userRejected().code).toBe(4001);
    expect(errors.unauthorized().code).toBe(4100);
    expect(errors.unsupportedMethod('x').code).toBe(4200);
    expect(errors.disconnected().code).toBe(4900);
    expect(errors.unrecognizedChain('0x5').code).toBe(4902);
    expect(errors.methodNotFound('x').code).toBe(-32601);
    expect(errors.invalidParams().code).toBe(-32602);
    expect(errors.userRejected()).toBeInstanceOf(Error);
    expect(errors.userRejected()).toBeInstanceOf(ProviderRpcError);
  });
  it('wraps RPC errors keeping code/message/data', () => {
    const e = errors.fromRpc({ code: -32000, message: 'boom', data: '0xdead' });
    expect(e.code).toBe(-32000);
    expect(e.message).toBe('boom');
    expect(e.data).toBe('0xdead');
  });
  it('byCode uses the default message for known codes', () => {
    expect(errors.byCode(4001).message).toMatch(/rejected/i);
    expect(errors.byCode(4001, 'custom').message).toBe('custom');
  });
});

describe('emitter', () => {
  it('emits to listeners and supports removal', () => {
    const em = createEmitter();
    const fn = vi.fn();
    em.on('x', fn);
    em.emit('x', 1, 2);
    expect(fn).toHaveBeenCalledWith(1, 2);
    em.removeListener('x', fn);
    em.emit('x', 3);
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it('once fires a single time and a throwing listener does not break others', () => {
    const em = createEmitter();
    const a = vi.fn(() => { throw new Error('bad'); });
    const b = vi.fn();
    em.once('x', a);
    em.on('x', b);
    em.emit('x');
    em.emit('x');
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);
    expect(em.listenerCount('x')).toBe(1);
  });
});

describe('config', () => {
  it('normalizes chain ids from number, hex and decimal string', () => {
    expect(normalizeChainId(1)).toBe('0x1');
    expect(normalizeChainId('0xAA36A7')).toBe('0xaa36a7');
    expect(normalizeChainId('11155111')).toBe('0xaa36a7');
    expect(() => normalizeChainId('sepolia')).toThrow(/Invalid chainId/);
  });
  it('applies defaults and validates address', () => {
    const cfg = resolveConfig({ address: ADDR, chainId: 11155111 });
    expect(cfg.name).toBe(DEFAULTS.name);
    expect(cfg.chainId).toBe('0xaa36a7');
    expect(cfg.address).toBe(ADDR);
    expect(() => resolveConfig({ address: '0x123' })).toThrow(/Invalid address/);
    expect(() => resolveConfig({})).toThrow(/address or privateKey/);
    expect(() => resolveConfig({ privateKey: '0xabc' })).toThrow(/privateKey/);
  });
  it('does not share the overrides object with the input', () => {
    const raw = { address: ADDR, overrides: { eth_getBalance: '0x1' } };
    const cfg = resolveConfig(raw);
    cfg.overrides.eth_chainId = '0x2';
    expect(raw.overrides.eth_chainId).toBeUndefined();
  });
  it('publicConfig strips the private key and reports signing mode', () => {
    const pk = '0x' + '11'.repeat(32);
    const pub = publicConfig(resolveConfig({ privateKey: pk, address: ADDR }));
    expect(pub.privateKey).toBeUndefined();
    expect(pub.signingMode).toBe('private-key');
    expect(JSON.stringify(pub)).not.toContain('1111111111');
    expect(publicConfig(resolveConfig({ address: ADDR })).signingMode).toBe('fake');
  });
});
