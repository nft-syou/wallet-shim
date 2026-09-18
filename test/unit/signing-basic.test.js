import { describe, it, expect } from 'vitest';
import { verifyMessage, hashMessage } from 'viem';
import {
  keccakHex, utf8ToBytes, toBytes, toChecksumAddress, deriveAddress,
  hashPersonalMessage, signPersonalMessage, fakeSignature, createSigner, bytesToHex,
} from '../../src/signing/evm.js';

const PK_ONE = '0x' + '00'.repeat(31) + '01';
const ADDR_ONE = '0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf';
const PK_COW = '0x' + keccakHex(utf8ToBytes('cow'));
const ADDR_COW = '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826';

describe('hashing helpers', () => {
  it('keccak256 of empty input matches the known constant', () => {
    expect(keccakHex(new Uint8Array())).toBe('c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470');
  });
  it('toBytes handles hex and utf8', () => {
    expect(bytesToHex(toBytes('0x6869'))).toBe('6869');
    expect(bytesToHex(toBytes('hi'))).toBe('6869');
    expect(bytesToHex(toBytes('0xabc'))).toBe('0abc');
  });
  it('checksums addresses (EIP-55)', () => {
    expect(toChecksumAddress('0x7e5f4552091a69125d5dfcb7b8c2659029395bdf')).toBe(ADDR_ONE);
  });
});

describe('key derivation', () => {
  it('derives well-known addresses', () => {
    expect(deriveAddress(PK_ONE)).toBe(ADDR_ONE);
    expect(deriveAddress(PK_COW)).toBe(ADDR_COW);
  });
});

describe('personal_sign', () => {
  it('hashes with the EIP-191 prefix (cross-checked with viem)', () => {
    // keccak256("\x19Ethereum Signed Message:\n5hello")
    expect('0x' + bytesToHex(hashPersonalMessage('hello'))).toBe(hashMessage('hello'));
    expect(bytesToHex(hashPersonalMessage('0x68656c6c6f'))).toBe(bytesToHex(hashPersonalMessage('hello')));
  });
  it('produces a signature viem can verify', async () => {
    const sig = signPersonalMessage(PK_ONE, '0x68656c6c6f');
    expect(sig).toMatch(/^0x[0-9a-f]{130}$/);
    expect(['1b', '1c']).toContain(sig.slice(-2));
    await expect(verifyMessage({ address: ADDR_ONE, message: 'hello', signature: sig })).resolves.toBe(true);
    await expect(verifyMessage({ address: ADDR_COW, message: 'hello', signature: sig })).resolves.toBe(false);
  });
});

describe('fakeSignature', () => {
  it('is deterministic, 65 bytes and ends with 1b', () => {
    const a = fakeSignature('personal_sign:["0x68"]');
    const b = fakeSignature('personal_sign:["0x68"]');
    expect(a).toBe(b);
    expect(a).toMatch(/^0x[0-9a-f]{130}$/);
    expect(a.endsWith('1b')).toBe(true);
    expect(fakeSignature('other')).not.toBe(a);
  });
});

describe('createSigner', () => {
  it('derives the address in private-key mode and ignores a mismatching address', () => {
    const s = createSigner({ privateKey: PK_ONE, address: ADDR_COW });
    expect(s.mode).toBe('private-key');
    expect(s.address).toBe(ADDR_ONE);
  });
  it('uses fake signatures in address mode', () => {
    const s = createSigner({ privateKey: null, address: ADDR_COW });
    expect(s.mode).toBe('fake');
    expect(s.address).toBe(ADDR_COW);
    expect(s.signPersonal('0x68')).toBe(fakeSignature('personal_sign:0x68'));
  });
});
