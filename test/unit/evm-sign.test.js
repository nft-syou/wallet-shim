import { describe, it, expect } from 'vitest';
import { verifyMessage, verifyTypedData } from 'viem';
import { makeEvm, ADDR } from './helpers/evm.js';
import { fakeSignature } from '../../src/signing/evm.js';

const PK_ONE = '0x' + '00'.repeat(31) + '01';
const OTHER = '0x' + 'cc'.repeat(20);

const TYPED = {
  types: { Person: [{ name: 'name', type: 'string' }, { name: 'wallet', type: 'address' }] },
  primaryType: 'Person',
  domain: { name: 'Test', version: '1', chainId: 1 },
  message: { name: 'Alice', wallet: ADDR },
};

describe('fake signing mode (address only)', () => {
  it('personal_sign returns a deterministic dummy signature', async () => {
    const evm = makeEvm();
    const sig = await evm.call('personal_sign', ['0x68656c6c6f', ADDR]);
    expect(sig).toBe(fakeSignature('personal_sign:0x68656c6c6f'));
    expect(await evm.call('personal_sign', ['0x68656c6c6f', ADDR.toLowerCase()])).toBe(sig);
    await expect(verifyMessage({ address: ADDR, message: 'hello', signature: sig })).resolves.toBe(false);
  });
  it('rejects signing for other addresses with 4100', async () => {
    const evm = makeEvm();
    await expect(evm.call('personal_sign', ['0x68', OTHER])).rejects.toMatchObject({ code: 4100 });
    await expect(evm.call('eth_signTypedData_v4', [OTHER, TYPED])).rejects.toMatchObject({ code: 4100 });
  });
});

describe('private-key signing mode', () => {
  it('personal_sign verifies with viem', async () => {
    const evm = makeEvm({ privateKey: PK_ONE });
    const sig = await evm.call('personal_sign', ['0x68656c6c6f', ADDR]);
    await expect(verifyMessage({ address: ADDR, message: 'hello', signature: sig })).resolves.toBe(true);
  });
  it('eth_sign uses the same personal-message path', async () => {
    const evm = makeEvm({ privateKey: PK_ONE });
    const a = await evm.call('eth_sign', [ADDR, '0x68656c6c6f']);
    const b = await evm.call('personal_sign', ['0x68656c6c6f', ADDR]);
    expect(a).toBe(b);
  });
  it('eth_signTypedData_v4 accepts objects and JSON strings and verifies', async () => {
    const evm = makeEvm({ privateKey: PK_ONE });
    const s1 = await evm.call('eth_signTypedData_v4', [ADDR, TYPED]);
    const s2 = await evm.call('eth_signTypedData_v4', [ADDR, JSON.stringify(TYPED)]);
    const s3 = await evm.call('eth_signTypedData_v3', [ADDR, TYPED]);
    expect(s1).toBe(s2);
    expect(s1).toBe(s3);
    await expect(verifyTypedData({ address: ADDR, ...TYPED, signature: s1 })).resolves.toBe(true);
  });
  it('eth_signTypedData (v1 order) detects which param is the address', async () => {
    const evm = makeEvm({ privateKey: PK_ONE });
    const legacy = await evm.call('eth_signTypedData', [TYPED, ADDR]);
    const v4 = await evm.call('eth_signTypedData_v4', [ADDR, TYPED]);
    expect(legacy).toBe(v4);
  });
  it('rejects invalid typed data JSON with -32602', async () => {
    const evm = makeEvm({ privateKey: PK_ONE });
    await expect(evm.call('eth_signTypedData_v4', [ADDR, '{not json'])).rejects.toMatchObject({ code: -32602 });
  });
});
