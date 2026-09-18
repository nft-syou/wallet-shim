import { createEmitter } from '../../core/emitter.js';
import { createRecorder } from '../../core/log.js';
import { createPassthrough } from '../../core/passthrough.js';
import { createRouter } from '../../core/router.js';
import { publicConfig } from '../../core/config.js';
import { createSigner } from '../../signing/evm.js';
import { CHAINS } from './constants.js';
import { createEvmHandlers } from './handlers.js';
import { VERSION } from '../../version.js';

export function createEvmProvider({ config, env }) {
  const recorder = createRecorder({ console: env.console, verbose: config.verbose });
  const signer = createSigner({ privateKey: config.privateKey, address: config.address });
  const rpcUrl = config.rpcUrl ?? CHAINS[config.chainId]?.rpc ?? null;
  const passthrough = createPassthrough({ fetch: env.fetch, rpcUrl });
  const emitter = createEmitter();
  const state = {
    accounts: [signer.address],
    chainId: config.chainId,
    connected: false,
    txs: [],
    chains: JSON.parse(JSON.stringify(CHAINS)),
    nonce: 0,
  };
  const evm = createEvmHandlers({ state, config, emitter, passthrough, signer });
  const router = createRouter({ handlers: evm.handlers, overrides: { ...config.overrides }, passthrough, recorder });

  const request = (args) => router.request(args);

  function sendAsync(payload, callback) {
    request({ method: payload?.method, params: payload?.params }).then(
      (result) => callback(null, { id: payload?.id, jsonrpc: '2.0', result }),
      (err) => callback(err, { id: payload?.id, jsonrpc: '2.0', error: { code: err.code, message: err.message, data: err.data } }),
    );
  }

  function send(methodOrPayload, paramsOrCallback) {
    if (typeof methodOrPayload === 'string') {
      return request({ method: methodOrPayload, params: Array.isArray(paramsOrCallback) ? paramsOrCallback : [] });
    }
    if (typeof paramsOrCallback === 'function') return sendAsync(methodOrPayload, paramsOrCallback);
    return request({ method: methodOrPayload?.method, params: methodOrPayload?.params });
  }

  const provider = {
    isMetaMask: true,
    _metamask: { isUnlocked: async () => true },
    isConnected: () => true,
    request,
    send,
    sendAsync,
    enable: () => request({ method: 'eth_requestAccounts' }),
    on: (...a) => (emitter.on(...a), provider),
    addListener: (...a) => (emitter.on(...a), provider),
    once: (...a) => (emitter.once(...a), provider),
    off: (...a) => (emitter.removeListener(...a), provider),
    removeListener: (...a) => (emitter.removeListener(...a), provider),
    removeAllListeners: () => provider,
    listenerCount: (e) => emitter.listenerCount(e),
    get selectedAddress() { return state.accounts[0] ?? null; },
    get chainId() { return state.chainId; },
    get networkVersion() { return BigInt(state.chainId).toString(10); },
  };

  const control = {
    calls: recorder.calls,
    txs: state.txs,
    rejectNext: router.rejectNext,
    override: router.override,
    setAccounts: evm.setAccounts,
    setChainId: evm.setChainId,
    disconnect: evm.disconnect,
    config: publicConfig({ ...config, address: signer.address, rpcUrl }),
    version: VERSION,
    provider,
  };

  return { provider, control, recorder };
}
