import { describe, it, expect, vi } from 'vitest';
import { createRouter } from '../../src/core/router.js';
import { createRecorder } from '../../src/core/log.js';

function setup(extra = {}) {
  const recorder = createRecorder({ console: { debug() {}, warn() {} }, verbose: false });
  const passthrough = vi.fn(async (method) => `pt:${method}`);
  const handlers = { eth_chainId: vi.fn(async () => '0x1'), ...extra.handlers };
  const overrides = { ...extra.overrides };
  const router = createRouter({ handlers, overrides, passthrough, recorder });
  return { router, recorder, passthrough, handlers };
}

describe('router', () => {
  it('resolves overrides before handlers before passthrough', async () => {
    const { router, passthrough } = setup({ overrides: { eth_chainId: '0x99' } });
    expect(await router.request({ method: 'eth_chainId' })).toBe('0x99');
    router.override('eth_chainId', undefined);
    expect(await router.request({ method: 'eth_chainId' })).toBe('0x1');
    expect(passthrough).not.toHaveBeenCalled();
  });
  it('uses handler when no override, passthrough otherwise', async () => {
    const { router, passthrough, handlers } = setup();
    expect(await router.request({ method: 'eth_chainId' })).toBe('0x1');
    expect(handlers.eth_chainId).toHaveBeenCalledWith([]);
    expect(await router.request({ method: 'eth_blockNumber', params: ['a'] })).toBe('pt:eth_blockNumber');
    expect(passthrough).toHaveBeenCalledWith('eth_blockNumber', ['a']);
  });
  it('function overrides receive params and ctx', async () => {
    const { router } = setup();
    router.override('eth_getBalance', (params, ctx) => `${ctx.method}:${params[0]}`);
    expect(await router.request({ method: 'eth_getBalance', params: ['0xabc'] })).toBe('eth_getBalance:0xabc');
  });
  it('records every call including errors', async () => {
    const { router, recorder } = setup({ handlers: { boom: async () => { throw new Error('x'); } } });
    await router.request({ method: 'eth_chainId' });
    await expect(router.request({ method: 'boom' })).rejects.toMatchObject({ code: -32603, message: 'x' });
    expect(recorder.calls.map((c) => c.method)).toEqual(['eth_chainId', 'boom']);
    expect(recorder.calls[1].error).toEqual({ code: -32603, message: 'x' });
  });
  it('rejectNext rejects only the next matching request', async () => {
    const { router } = setup();
    router.rejectNext();
    await expect(router.request({ method: 'eth_chainId' })).rejects.toMatchObject({ code: 4001 });
    expect(await router.request({ method: 'eth_chainId' })).toBe('0x1');
    router.rejectNext('eth_blockNumber', 4100, 'nope');
    expect(await router.request({ method: 'eth_chainId' })).toBe('0x1');
    await expect(router.request({ method: 'eth_blockNumber' })).rejects.toMatchObject({ code: 4100, message: 'nope' });
    expect(await router.request({ method: 'eth_blockNumber' })).toBe('pt:eth_blockNumber');
  });
  it('rejects malformed requests with -32602', async () => {
    const { router } = setup();
    await expect(router.request()).rejects.toMatchObject({ code: -32602 });
    await expect(router.request({ method: 5 })).rejects.toMatchObject({ code: -32602 });
  });
});
