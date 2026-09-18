import { describe, it, expect } from 'vitest';
import { makeEvm, ADDR } from './helpers/evm.js';

const TX = { from: ADDR, to: '0x' + 'bb'.repeat(20), value: '0x1', data: '0x' };

describe('eth_sendTransaction (dry run)', () => {
  it('returns a 32-byte hash, records the tx, and hashes differ per call', async () => {
    const evm = makeEvm();
    const h1 = await evm.call('eth_sendTransaction', [TX]);
    const h2 = await evm.call('eth_sendTransaction', [TX]);
    expect(h1).toMatch(/^0x[0-9a-f]{64}$/);
    expect(h1).not.toBe(h2);
    expect(evm.state.txs).toHaveLength(2);
    expect(evm.state.txs[0]).toMatchObject({ hash: h1, tx: TX });
    expect(evm.passthrough).not.toHaveBeenCalledWith('eth_sendTransaction', expect.anything());
  });
  it('rejects a foreign from address with 4100 and missing params with -32602', async () => {
    const evm = makeEvm();
    await expect(evm.call('eth_sendTransaction', [{ ...TX, from: '0x' + 'cc'.repeat(20) }])).rejects.toMatchObject({ code: 4100 });
    await expect(evm.call('eth_sendTransaction', [])).rejects.toMatchObject({ code: -32602 });
  });
  it('defaults from to the connected account when omitted', async () => {
    const evm = makeEvm();
    const { from, ...noFrom } = TX;
    const h = await evm.call('eth_sendTransaction', [noFrom]);
    expect(evm.state.txs[0].tx.from).toBe(ADDR);
    expect(h).toMatch(/^0x/);
  });
});

describe('receipts', () => {
  it('synthesizes a successful receipt for known hashes using the passthrough block number', async () => {
    const evm = makeEvm();
    const hash = await evm.call('eth_sendTransaction', [TX]);
    const r = await evm.call('eth_getTransactionReceipt', [hash]);
    expect(r).toMatchObject({ transactionHash: hash, status: '0x1', blockNumber: '0x10', from: ADDR, to: TX.to, logs: [], gasUsed: '0x5208' });
    expect(r.blockHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(r.logsBloom).toBe('0x' + '0'.repeat(512));
    const t = await evm.call('eth_getTransactionByHash', [hash]);
    expect(t).toMatchObject({ hash, from: ADDR, to: TX.to, value: '0x1', blockNumber: '0x10', input: '0x' });
  });
  it('falls back to block 0x1 when the RPC is unreachable', async () => {
    const evm = makeEvm();
    evm.passthrough.mockImplementation(async () => { throw new Error('offline'); });
    const hash = await evm.call('eth_sendTransaction', [TX]);
    expect((await evm.call('eth_getTransactionReceipt', [hash])).blockNumber).toBe('0x1');
  });
  it('passes unknown hashes through', async () => {
    const evm = makeEvm();
    const unknown = '0x' + '11'.repeat(32);
    expect(await evm.call('eth_getTransactionReceipt', [unknown])).toBe('pt:eth_getTransactionReceipt');
    expect(evm.passthrough).toHaveBeenCalledWith('eth_getTransactionReceipt', [unknown]);
  });
});

describe('other tx methods', () => {
  it('eth_sendRawTransaction hashes the raw bytes and records it', async () => {
    const evm = makeEvm();
    const raw = '0x02f8' + 'ab'.repeat(10);
    const h = await evm.call('eth_sendRawTransaction', [raw]);
    expect(h).toMatch(/^0x[0-9a-f]{64}$/);
    expect(evm.state.txs[0]).toMatchObject({ hash: h, tx: { raw } });
    expect((await evm.call('eth_getTransactionReceipt', [h])).status).toBe('0x1');
  });
  it('eth_signTransaction returns deterministic bytes and checks from', async () => {
    const evm = makeEvm();
    const a = await evm.call('eth_signTransaction', [TX]);
    const b = await evm.call('eth_signTransaction', [TX]);
    expect(a).toBe(b);
    expect(a).toMatch(/^0x[0-9a-f]{64}$/);
    await expect(evm.call('eth_signTransaction', [{ ...TX, from: '0x' + 'cc'.repeat(20) }])).rejects.toMatchObject({ code: 4100 });
  });
  it('eth_estimateGas returns the configured value or passes through', async () => {
    expect(await makeEvm().call('eth_estimateGas', [TX])).toBe('0x5208');
    expect(await makeEvm({ estimateGas: '0x7530' }).call('eth_estimateGas', [TX])).toBe('0x7530');
    const pt = makeEvm({ estimateGas: 'passthrough' });
    expect(await pt.call('eth_estimateGas', [TX])).toBe('pt:eth_estimateGas');
  });
});
