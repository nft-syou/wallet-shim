import { resolveConfig } from './core/config.js';
import { createEvmProvider } from './chains/evm/provider.js';
import { installEvmProvider } from './chains/evm/announce.js';

// Add new chains here: { create({config, env}), install({provider, config, env, recorder}) }
const CHAIN_MODULES = {
  evm: { create: createEvmProvider, install: installEvmProvider },
};

export function createShim(rawConfig, env) {
  const config = resolveConfig(rawConfig);
  const mod = CHAIN_MODULES[config.chain];
  if (!mod) throw new Error(`Unsupported chain: ${config.chain} (available: ${Object.keys(CHAIN_MODULES).join(', ')})`);
  const { provider, control, recorder } = mod.create({ config, env });
  const { info } = mod.install({ provider, config, env, recorder });
  control.info = info;
  env.window.__WALLET_SHIM__ = control;
  recorder.info(`installed "${config.name}" as ${control.config.address} on chain ${config.chainId} (${control.config.signingMode} signing, rpc: ${control.config.rpcUrl ?? 'none'})`);
  return control;
}
