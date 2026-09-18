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

// ---------- EIP-712 ----------

const baseType = (t) => t.replace(/\[.*$/, '');

function collectDeps(types, primary, found = new Set()) {
  if (found.has(primary) || !types[primary]) return found;
  found.add(primary);
  for (const field of types[primary]) collectDeps(types, baseType(field.type), found);
  return found;
}

export function encodeType(types, primary) {
  const deps = [...collectDeps(types, primary)].filter((t) => t !== primary).sort();
  return [primary, ...deps]
    .map((t) => `${t}(${types[t].map((f) => `${f.type} ${f.name}`).join(',')})`)
    .join('');
}

export function typeHash(types, primary) {
  return keccak(utf8ToBytes(encodeType(types, primary)));
}

function padLeft(bytes) {
  if (bytes.length > 32) throw new Error('EIP-712: value longer than 32 bytes');
  const out = new Uint8Array(32);
  out.set(bytes, 32 - bytes.length);
  return out;
}

function padRight(bytes) {
  if (bytes.length > 32) throw new Error('EIP-712: value longer than 32 bytes');
  const out = new Uint8Array(32);
  out.set(bytes, 0);
  return out;
}

function encodeValue(types, type, value) {
  if (value === undefined || value === null) {
    throw new Error(`EIP-712: missing value for field of type ${type}`);
  }
  if (types[type]) return hashStruct(types, type, value);
  const arr = type.match(/^(.*)\[(\d*)\]$/);
  if (arr) {
    const items = value.map((v) => encodeValue(types, arr[1], v));
    return keccak(concatBytes(...items));
  }
  if (type === 'string') return keccak(utf8ToBytes(String(value)));
  if (type === 'bytes') return keccak(toBytes(value));
  if (type === 'bool') return padLeft(new Uint8Array([value ? 1 : 0]));
  if (type === 'address') return padLeft(hexToBytes(strip0x(String(value)).padStart(40, '0')));
  const fixedBytes = type.match(/^bytes(\d+)$/);
  if (fixedBytes) {
    const n = Number(fixedBytes[1]);
    const bytes = toBytes(value);
    if (bytes.length !== n) {
      throw new Error(`EIP-712: ${type} expects ${n} bytes, got ${bytes.length}`);
    }
    return padRight(bytes);
  }
  if (/^u?int\d*$/.test(type)) {
    let n = BigInt(value);
    if (n < 0n) n = (1n << 256n) + n;
    return padLeft(hexToBytes(n.toString(16).padStart(64, '0')));
  }
  throw new Error(`EIP-712: unsupported type ${type}`);
}

export function hashStruct(types, primary, data) {
  const parts = [typeHash(types, primary)];
  for (const field of types[primary]) parts.push(encodeValue(types, field.type, data[field.name]));
  return keccak(concatBytes(...parts));
}

const DOMAIN_FIELDS = [
  ['name', 'string'],
  ['version', 'string'],
  ['chainId', 'uint256'],
  ['verifyingContract', 'address'],
  ['salt', 'bytes32'],
];

function inferDomainType(domain = {}) {
  return DOMAIN_FIELDS.filter(([name]) => domain[name] !== undefined).map(([name, type]) => ({ name, type }));
}

export function hashTypedData(typed) {
  const { primaryType, domain = {}, message = {} } = typed;
  const types = { ...typed.types };
  if (!types.EIP712Domain) types.EIP712Domain = inferDomainType(domain);
  const parts = [new Uint8Array([0x19, 0x01]), hashStruct(types, 'EIP712Domain', domain)];
  if (primaryType !== 'EIP712Domain') parts.push(hashStruct(types, primaryType, message));
  return keccak(concatBytes(...parts));
}

export function signTypedData(privateKeyHex, typed) {
  return signHash(privateKeyHex, hashTypedData(typed));
}
