import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToHex, hexToBytes, utf8ToBytes, concatBytes } from '@noble/hashes/utils.js';

export { bytesToHex, hexToBytes, utf8ToBytes, concatBytes };

export const keccak = (bytes) => keccak_256(bytes);
export const keccakHex = (bytes) => bytesToHex(keccak_256(bytes));

export function strip0x(s) {
  return s.startsWith('0x') || s.startsWith('0X') ? s.slice(2) : s;
}

const HEX_RE = /^0[xX][0-9a-fA-F]*$/;

export function toBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (typeof value === 'string') {
    if (HEX_RE.test(value)) {
      const h = strip0x(value);
      return hexToBytes(h.length % 2 ? '0' + h : h);
    }
    return utf8ToBytes(value);
  }
  throw new TypeError(`toBytes: unsupported input ${typeof value}`);
}

export function toChecksumAddress(addr) {
  const lower = strip0x(addr).toLowerCase();
  const hash = keccakHex(utf8ToBytes(lower));
  let out = '0x';
  for (let i = 0; i < 40; i++) {
    out += parseInt(hash[i], 16) >= 8 ? lower[i].toUpperCase() : lower[i];
  }
  return out;
}

function privBytes(privateKeyHex) {
  return hexToBytes(strip0x(privateKeyHex));
}

export function deriveAddress(privateKeyHex) {
  const pub = secp256k1.getPublicKey(privBytes(privateKeyHex), false); // 65 bytes, 0x04 prefix
  return toChecksumAddress(bytesToHex(keccak(pub.slice(1)).slice(-20)));
}

/** Sign a 32-byte hash; returns 0x || r || s || v with v in {27, 28}. */
export function signHash(privateKeyHex, hash32) {
  const raw = secp256k1.sign(hash32, privBytes(privateKeyHex), { prehash: false, format: 'recovered' });
  const sig = secp256k1.Signature.fromBytes(raw, 'recovered');
  const v = (27 + sig.recovery).toString(16);
  return '0x' + bytesToHex(sig.toBytes('compact')) + v;
}

export function hashPersonalMessage(message) {
  const body = toBytes(message);
  const prefix = utf8ToBytes(`\x19Ethereum Signed Message:\n${body.length}`);
  return keccak(concatBytes(prefix, body));
}

export function signPersonalMessage(privateKeyHex, message) {
  return signHash(privateKeyHex, hashPersonalMessage(message));
}

/** Deterministic dummy signature for address-only mode. Never verifies on-chain. */
export function fakeSignature(seed) {
  const r = keccak(utf8ToBytes('wallet-shim:fake-sig:' + seed));
  const s = keccak(r);
  return '0x' + bytesToHex(r) + bytesToHex(s) + '1b';
}

export function createSigner({ privateKey, address }) {
  if (privateKey) {
    const derived = deriveAddress(privateKey);
    return {
      mode: 'private-key',
      address: derived,
      signPersonal: (message) => signPersonalMessage(privateKey, message),
      signTypedData: (typed) => signTypedData(privateKey, typed),
    };
  }
  return {
    mode: 'fake',
    address: toChecksumAddress(address),
    signPersonal: (message) => fakeSignature('personal_sign:' + String(message)),
    signTypedData: (typed) => fakeSignature('eth_signTypedData:' + JSON.stringify(typed)),
  };
}

// EIP-712 (hashTypedData / signTypedData) is appended in Task 6.
export function signTypedData() {
  throw new Error('signTypedData not implemented yet');
}
