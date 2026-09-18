import { normalizeChainId } from '../../core/config.js';

// hexId -> { name, rpc, symbol }. Public RPCs are best-effort; users can override with --rpc.
export const CHAINS = Object.freeze({
  '0x1': { name: 'mainnet', rpc: 'https://ethereum-rpc.publicnode.com', symbol: 'ETH' },
  '0xaa36a7': { name: 'sepolia', rpc: 'https://ethereum-sepolia-rpc.publicnode.com', symbol: 'ETH' },
  '0x4268': { name: 'holesky', rpc: 'https://ethereum-holesky-rpc.publicnode.com', symbol: 'ETH' },
  '0x2105': { name: 'base', rpc: 'https://mainnet.base.org', symbol: 'ETH' },
  '0x14a34': { name: 'base-sepolia', rpc: 'https://sepolia.base.org', symbol: 'ETH' },
  '0xa': { name: 'optimism', rpc: 'https://mainnet.optimism.io', symbol: 'ETH' },
  '0xa4b1': { name: 'arbitrum', rpc: 'https://arb1.arbitrum.io/rpc', symbol: 'ETH' },
  '0x89': { name: 'polygon', rpc: 'https://polygon-rpc.com', symbol: 'POL' },
  '0x38': { name: 'bsc', rpc: 'https://bsc-dataseed.binance.org', symbol: 'BNB' },
  '0xa86a': { name: 'avalanche', rpc: 'https://api.avax.network/ext/bc/C/rpc', symbol: 'AVAX' },
  '0x7a69': { name: 'localhost', rpc: 'http://127.0.0.1:8545', symbol: 'ETH' },
});

export const CHAIN_NAMES = Object.freeze(
  Object.fromEntries(
    Object.entries(CHAINS).flatMap(([id, c]) => [[c.name, id]]).concat([
      ['ethereum', '0x1'], ['anvil', '0x7a69'], ['hardhat', '0x7a69'], ['foundry', '0x7a69'],
    ]),
  ),
);

/** Accepts a chain name ("sepolia"), decimal (11155111), or hex ("0xaa36a7"). */
export function resolveChain(input) {
  if (typeof input === 'string' && CHAIN_NAMES[input.trim().toLowerCase()]) {
    return CHAIN_NAMES[input.trim().toLowerCase()];
  }
  try {
    return normalizeChainId(input);
  } catch {
    throw new Error(`Unknown chain: ${String(input)} (use a name like sepolia, a decimal id, or 0x-hex)`);
  }
}

// Tiny orange badge so wallet pickers show *something*; EIP-6963 requires a data: URI.
export const METAMASK_ICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ccircle cx='16' cy='16' r='16' fill='%23f6851b'/%3E%3Ctext x='16' y='21.5' font-size='16' text-anchor='middle' fill='white' font-family='sans-serif' font-weight='bold'%3EM%3C/text%3E%3C/svg%3E";
