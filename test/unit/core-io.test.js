import { describe, it, expect, vi } from 'vitest';
import { createRecorder } from '../../src/core/log.js';
import { createPassthrough } from '../../src/core/passthrough.js';

function fakeConsole() {
  return { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), log: vi.fn() };
}

describe('recorder', () => {
  it('records calls with timestamps and logs when verbose', () => {
    const con = fakeConsole();
    const rec = createRecorder({ console: con, verbose: true });
    const e = rec.record({ method: 'eth_chainId', params: [], result: '0x1' });
    expect(rec.calls).toHaveLength(1);
    expect(typeof e.at).toBe('number');
    expect(con.debug).toHaveBeenCalledWith(expect.stringContaining('eth_chainId'));
    expect(con.debug.mock.calls[0][0]).toContain('"0x1"');
  });
  it('logs errors with code and stays silent when not verbose', () => {
    const con = fakeConsole();
    const rec = createRecorder({ console: con, verbose: false });
    rec.record({ method: 'x', params: [], error: { code: 4001, message: 'no' } });
    expect(rec.calls[0].error.code).toBe(4001);
    expect(con.debug).not.toHaveBeenCalled();
    rec.warn('careful');
    expect(con.warn).toHaveBeenCalledWith('[wallet-shim] careful');
  });
  it('truncates long results in the log line', () => {
    const con = fakeConsole();
    const rec = createRecorder({ console: con, verbose: true });
    rec.record({ method: 'x', params: [], result: 'a'.repeat(1000) });
    expect(con.debug.mock.calls[0][0].length).toBeLessThan(300);
  });
});

describe('passthrough', () => {
  it('posts JSON-RPC 2.0 and returns result', async () => {
    const fetch = vi.fn(async (url, init) => ({
      ok: true,
      status: 200,
      json: async () => ({ jsonrpc: '2.0', id: JSON.parse(init.body).id, result: '0x10' }),
    }));
    const pt = createPassthrough({ fetch, rpcUrl: 'http://rpc.test' });
    await expect(pt('eth_blockNumber', [])).resolves.toBe('0x10');
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('http://rpc.test');
    expect(init.method).toBe('POST');
    expect(init.headers['content-type']).toBe('application/json');
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ jsonrpc: '2.0', method: 'eth_blockNumber', params: [] });
    expect(typeof body.id).toBe('number');
  });
  it('rejects with the RPC error object', async () => {
    const fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'nope', data: 'x' } }),
    }));
    const pt = createPassthrough({ fetch, rpcUrl: 'http://rpc.test' });
    await expect(pt('eth_call', [])).rejects.toMatchObject({ code: -32000, message: 'nope', data: 'x' });
  });
  it('rejects with 4200 when no rpcUrl and -32603 on HTTP failure', async () => {
    const none = createPassthrough({ fetch: vi.fn(), rpcUrl: null });
    await expect(none('eth_call', [])).rejects.toMatchObject({ code: 4200 });
    const bad = createPassthrough({ fetch: vi.fn(async () => ({ ok: false, status: 502 })), rpcUrl: 'http://x' });
    await expect(bad('eth_call', [])).rejects.toMatchObject({ code: -32603 });
  });
});
