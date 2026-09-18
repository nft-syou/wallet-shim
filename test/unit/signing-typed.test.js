import { describe, it, expect } from 'vitest';
import { verifyTypedData, hashTypedData as viemHashTypedData } from 'viem';
import {
  encodeType, typeHash, hashStruct, hashTypedData, signTypedData, bytesToHex, keccakHex, utf8ToBytes,
} from '../../src/signing/evm.js';

// 定数は EIP-712 仕様書の Mail 例。定数と viem の hashTypedData が食い違ったら viem を正とし、定数を直す。

const PK_COW = '0x' + keccakHex(utf8ToBytes('cow'));
const ADDR_COW = '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826';

const MAIL = {
  types: {
    EIP712Domain: [
      { name: 'name', type: 'string' },
      { name: 'version', type: 'string' },
      { name: 'chainId', type: 'uint256' },
      { name: 'verifyingContract', type: 'address' },
    ],
    Person: [
      { name: 'name', type: 'string' },
      { name: 'wallet', type: 'address' },
    ],
    Mail: [
      { name: 'from', type: 'Person' },
      { name: 'to', type: 'Person' },
      { name: 'contents', type: 'string' },
    ],
  },
  primaryType: 'Mail',
  domain: {
    name: 'Ether Mail',
    version: '1',
    chainId: 1,
    verifyingContract: '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC',
  },
  message: {
    from: { name: 'Cow', wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826' },
    to: { name: 'Bob', wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB' },
    contents: 'Hello, Bob!',
  },
};

describe('EIP-712', () => {
  it('encodes types with sorted dependencies', () => {
    expect(encodeType(MAIL.types, 'Mail')).toBe('Mail(Person from,Person to,string contents)Person(string name,address wallet)');
    expect(bytesToHex(typeHash(MAIL.types, 'Mail'))).toBe('a0cedeb2dc280ba39b857546d74f5549c3a1d7bdc2dd96bf881f76108e23dac2');
  });
  it('hashes structs and the domain separator', () => {
    expect(bytesToHex(hashStruct(MAIL.types, 'Mail', MAIL.message))).toBe('c52c0ee5d84264471806290a3f2c4cecfc5490626bf912d01f240d7a274b371e');
    expect(bytesToHex(hashStruct(MAIL.types, 'EIP712Domain', MAIL.domain))).toBe('f2cee375fa42b42143804025fc449deafd50cc031ca257e0b194a650a912090f');
  });
  it('computes the final sign hash (matches viem)', () => {
    const { EIP712Domain, ...types } = MAIL.types;
    const expected = viemHashTypedData({ domain: MAIL.domain, types, primaryType: 'Mail', message: MAIL.message });
    expect('0x' + bytesToHex(hashTypedData(MAIL))).toBe(expected);
    expect(bytesToHex(hashTypedData(MAIL))).toBe('be609aee343fb3c4b28e1df9e632fca64fcfaede20f02e86244efddf30957bd2');
  });
  it('infers EIP712Domain when omitted', () => {
    const { EIP712Domain, ...types } = MAIL.types;
    expect(bytesToHex(hashTypedData({ ...MAIL, types }))).toBe('be609aee343fb3c4b28e1df9e632fca64fcfaede20f02e86244efddf30957bd2');
  });
  it('signs so viem verifies it', async () => {
    const sig = signTypedData(PK_COW, MAIL);
    const { EIP712Domain, ...types } = MAIL.types;
    await expect(verifyTypedData({
      address: ADDR_COW, domain: MAIL.domain, types, primaryType: 'Mail', message: MAIL.message, signature: sig,
    })).resolves.toBe(true);
  });
  it('handles arrays, bytes, bool, int and fixed bytes', () => {
    const types = {
      T: [
        { name: 'tags', type: 'string[]' },
        { name: 'nums', type: 'uint8[2]' },
        { name: 'ok', type: 'bool' },
        { name: 'neg', type: 'int8' },
        { name: 'blob', type: 'bytes' },
        { name: 'fixed', type: 'bytes4' },
      ],
    };
    const data = { tags: ['a', 'b'], nums: [1, 2], ok: true, neg: -1, blob: '0x0102', fixed: '0xdeadbeef' };
    const h = hashStruct(types, 'T', data);
    expect(h).toHaveLength(32);
    // Same data with a different bool must hash differently.
    expect(bytesToHex(hashStruct(types, 'T', { ...data, ok: false }))).not.toBe(bytesToHex(h));
    // A string message passed as JSON must be accepted by hashTypedData's caller (handlers), tested there.
  });
});
