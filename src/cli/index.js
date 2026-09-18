import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULTS, resolveConfig, publicConfig } from '../core/config.js';
import { resolveChain, CHAINS } from '../chains/evm/constants.js';

const DIST_PATH = fileURLToPath(new URL('../../dist/shim.js', import.meta.url));

export const USAGE = `wallet-shim - emit a fake EIP-1193 (MetaMask-compatible) provider script

Usage: node bin/wallet-shim.mjs [options]

Identity (pick one; default: --generate-key)
  --address <0x..>            Impersonate this address (fake signatures)
  --private-key <0x..>        Sign for real with this key (address is derived)
  --private-key-file <path>   Read the private key from a file
  --generate-key              Create a throwaway key (saved under .wallet-shim/)

Chain
  --chain <id|name>           1, 0x1, mainnet, sepolia, base, arbitrum, ... (default: 1)
  --rpc <url>                 RPC for passthrough reads (default: public RPC of the chain)

Presentation
  --name <str>                Wallet name for EIP-6963 (default: MetaMask)
  --rdns <str>                Wallet rdns for EIP-6963 (default: io.metamask)
  --override <method>=<json>  Fixed response for a method (repeatable)
  --config <path.json>        Config file; CLI flags take precedence

Output
  --out <path>                Write to file instead of stdout
  --format iife|base64        Output format (default: iife)
  --print-config              Print the resolved config (secrets redacted) to stderr
  --quiet                     Suppress stderr summary
  --help, --version
`;

const OPTIONS = {
  address: { type: 'string' },
  'private-key': { type: 'string' },
  'private-key-file': { type: 'string' },
  'generate-key': { type: 'boolean', default: false },
  chain: { type: 'string' },
  rpc: { type: 'string' },
  name: { type: 'string' },
  rdns: { type: 'string' },
  override: { type: 'string', multiple: true, default: [] },
  config: { type: 'string' },
  out: { type: 'string' },
  format: { type: 'string', default: 'iife' },
  'print-config': { type: 'boolean', default: false },
  quiet: { type: 'boolean', default: false },
  help: { type: 'boolean', default: false },
  version: { type: 'boolean', default: false },
};

function parseOverride(spec) {
  const eq = spec.indexOf('=');
  if (eq === -1) throw new Error(`--override expects <method>=<json>, got "${spec}"`);
  const method = spec.slice(0, eq).trim();
  const raw = spec.slice(eq + 1);
  try {
    return [method, JSON.parse(raw)];
  } catch {
    return [method, raw];
  }
}

export function buildOutput(config, distSource, format = 'iife') {
  const iife = `window.__WALLET_SHIM_CONFIG__ = ${JSON.stringify(config)};\n${distSource}`;
  if (format === 'iife') return iife;
  if (format === 'base64') return Buffer.from(iife, 'utf8').toString('base64');
  throw new Error(`Unknown --format "${format}" (expected iife or base64)`);
}

function readDist() {
  if (!existsSync(DIST_PATH)) throw new Error(`dist/shim.js not found at ${DIST_PATH}; run "npm run build" first`);
  return readFileSync(DIST_PATH, 'utf8');
}

async function loadSigning() {
  try {
    return await import('../signing/evm.js');
  } catch (e) {
    if (e?.code === 'ERR_MODULE_NOT_FOUND') {
      throw new Error('Key modes need @noble/curves and @noble/hashes. Run "npm install" in the wallet-shim directory, or use --address instead.');
    }
    throw e;
  }
}

function normalizeKey(raw) {
  const s = String(raw).trim();
  const hex = s.startsWith('0x') || s.startsWith('0X') ? s.slice(2) : s;
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error('Invalid private key: expected 64 hex chars (with or without 0x)');
  return '0x' + hex.toLowerCase();
}

function saveGeneratedKey(io, address, privateKey) {
  const dir = resolve(io.cwd, '.wallet-shim');
  mkdirSync(dir, { recursive: true });
  const ignore = resolve(dir, '.gitignore');
  if (!existsSync(ignore)) writeFileSync(ignore, '*\n', 'utf8');
  const file = resolve(dir, `key-${address}.txt`);
  writeFileSync(file, privateKey + '\n', { encoding: 'utf8', mode: 0o600 });
  try {
    chmodSync(file, 0o600);
  } catch {
    // Windows ignores POSIX modes; the directory is gitignored regardless.
  }
  return file;
}

export async function resolveIdentity(values, io) {
  let privateKey = null;
  let mode;
  if (values['private-key']) {
    privateKey = normalizeKey(values['private-key']);
    mode = 'private-key';
  } else if (values['private-key-file']) {
    privateKey = normalizeKey(readFileSync(resolve(io.cwd, values['private-key-file']), 'utf8'));
    mode = 'private-key';
  } else if (values.address && !values['generate-key']) {
    return { address: values.address, privateKey: null, mode: 'address' };
  } else {
    privateKey = '0x' + randomBytes(32).toString('hex');
    mode = 'generated-key';
  }
  const { deriveAddress } = await loadSigning();
  const address = deriveAddress(privateKey);
  const identity = { address, privateKey, mode };
  if (mode === 'generated-key') identity.keyFile = saveGeneratedKey(io, address, privateKey);
  return identity;
}

export async function runCli(argv, io) {
  let values;
  try {
    ({ values } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: false }));
  } catch (e) {
    io.stderr(`error: ${e.message}\n${USAGE}`);
    return 1;
  }
  if (values.help) {
    io.stdout(USAGE);
    return 0;
  }
  if (values.version) {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    io.stdout(`${pkg.version}\n`);
    return 0;
  }

  try {
    const fileCfg = values.config ? JSON.parse(readFileSync(resolve(io.cwd, values.config), 'utf8')) : {};
    const merged = { ...DEFAULTS, ...fileCfg };
    if (fileCfg.chainId !== undefined) merged.chainId = resolveChain(fileCfg.chainId);
    if (values.chain !== undefined) merged.chainId = resolveChain(values.chain);
    if (values.rpc !== undefined) merged.rpcUrl = values.rpc;
    if (values.name !== undefined) merged.name = values.name;
    if (values.rdns !== undefined) merged.rdns = values.rdns;
    merged.overrides = { ...(fileCfg.overrides ?? {}) };
    for (const spec of values.override) {
      const [m, v] = parseOverride(spec);
      merged.overrides[m] = v;
    }

    const identity = await resolveIdentity({ ...values, address: values.address ?? fileCfg.address, 'private-key': values['private-key'] ?? fileCfg.privateKey }, io);
    merged.address = identity.address;
    merged.privateKey = identity.privateKey;
    if (!merged.rpcUrl) merged.rpcUrl = CHAINS[merged.chainId]?.rpc ?? null;

    const config = resolveConfig(merged);
    const output = buildOutput(config, readDist(), values.format);

    if (values.out) {
      writeFileSync(resolve(io.cwd, values.out), output, 'utf8');
    } else {
      io.stdout(output);
    }

    if (!values.quiet) {
      const chainName = CHAINS[config.chainId]?.name ?? 'custom';
      io.stderr(`[wallet-shim] mode: ${identity.mode}\n`);
      io.stderr(`[wallet-shim] address: ${config.address ?? identity.address}\n`);
      io.stderr(`[wallet-shim] chain: ${BigInt(config.chainId)} (${chainName}) rpc: ${config.rpcUrl ?? 'none'}\n`);
      if (identity.keyFile) io.stderr(`[wallet-shim] private key saved to: ${identity.keyFile} (gitignored)\n`);
      if (values.out) io.stderr(`[wallet-shim] written: ${resolve(io.cwd, values.out)}\n`);
      if (values['print-config']) io.stderr(`[wallet-shim] config: ${JSON.stringify(publicConfig(config), null, 2)}\n`);
    }
    return 0;
  } catch (e) {
    io.stderr(`error: ${e.message}\n`);
    return 1;
  }
}
