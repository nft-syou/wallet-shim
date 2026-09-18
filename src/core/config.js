export const DEFAULTS = Object.freeze({
  chain: 'evm',
  address: null,
  privateKey: null,
  chainId: '0x1',
  rpcUrl: null,
  name: 'MetaMask',
  rdns: 'io.metamask',
  icon: null,
  autoConnect: true,
  replaceExisting: true,
  allowAnyChain: false,
  estimateGas: '0x5208',
  overrides: {},
  verbose: true,
});

export function normalizeChainId(input) {
  if (typeof input === 'number' && Number.isInteger(input) && input > 0) {
    return '0x' + input.toString(16);
  }
  if (typeof input === 'string') {
    const s = input.trim().toLowerCase();
    if (/^0x[0-9a-f]+$/.test(s)) return '0x' + BigInt(s).toString(16);
    if (/^\d+$/.test(s)) return '0x' + BigInt(s).toString(16);
  }
  throw new Error(`Invalid chainId: ${String(input)}`);
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const PRIVATE_KEY_RE = /^0x[0-9a-fA-F]{64}$/;

export function resolveConfig(raw = {}) {
  const cfg = { ...DEFAULTS, ...raw, overrides: { ...(raw.overrides ?? {}) } };
  cfg.chainId = normalizeChainId(cfg.chainId);
  if (cfg.address != null && !ADDRESS_RE.test(cfg.address)) {
    throw new Error(`Invalid address: ${cfg.address}`);
  }
  if (cfg.privateKey != null && !PRIVATE_KEY_RE.test(cfg.privateKey)) {
    throw new Error('Invalid privateKey: expected 0x followed by 64 hex chars');
  }
  if (!cfg.address && !cfg.privateKey) {
    throw new Error('Config needs address or privateKey');
  }
  return cfg;
}

export function publicConfig(cfg) {
  const { privateKey, overrides, ...rest } = cfg;
  return {
    ...rest,
    overrides: Object.keys(overrides ?? {}),
    signingMode: privateKey ? 'private-key' : 'fake',
  };
}
