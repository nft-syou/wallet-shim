import { vi } from 'vitest';
import { CHAINS } from '../../../src/chains/evm/constants.js';
import { createEvmHandlers } from '../../../src/chains/evm/handlers.js';
import { createEmitter } from '../../../src/core/emitter.js';
import { resolveConfig } from '../../../src/core/config.js';
import { createSigner } from '../../../src/signing/evm.js';

export const ADDR = '0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf';

export function makeEvm(rawConfig = {}) {
  const config = resolveConfig({ address: ADDR, ...rawConfig });
  const emitter = createEmitter();
  const signer = createSigner({ privateKey: config.privateKey, address: config.address });
  const passthrough = vi.fn(async (method) => {
    if (method === 'eth_blockNumber') return '0x10';
    return `pt:${method}`;
  });
  const state = {
    accounts: [signer.address], chainId: config.chainId, connected: false, txs: [],
    chains: structuredClone(CHAINS), nonce: 0,
  };
  const api = createEvmHandlers({ state, config, emitter, passthrough, signer });
  const call = (method, params = []) => api.handlers[method](params);
  return { ...api, call, state, emitter, passthrough, signer, config };
}
