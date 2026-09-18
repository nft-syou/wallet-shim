import { errors } from '../../core/errors.js';
import { normalizeChainId } from '../../core/config.js';
import { keccakHex, utf8ToBytes, toBytes } from '../../signing/evm.js';

const sameAddress = (a, b) =>
  typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();

export function createEvmHandlers({ state, config, emitter, passthrough, signer }) {
  function connect() {
    if (state.connected) return;
    state.connected = true;
    emitter.emit('connect', { chainId: state.chainId });
  }

  function disconnect() {
    if (!state.connected) return;
    state.connected = false;
    emitter.emit('accountsChanged', []);
    emitter.emit('disconnect', errors.disconnected());
  }

  function setChainId(hex) {
    state.chainId = normalizeChainId(hex);
    emitter.emit('chainChanged', state.chainId);
  }

  function setAccounts(list) {
    state.accounts = list.map(String);
    emitter.emit('accountsChanged', [...state.accounts]);
  }

  function assertOwner(address) {
    if (!sameAddress(address, state.accounts[0])) {
      throw errors.unauthorized(`Address ${address} is not the connected account ${state.accounts[0]}`);
    }
  }

  function permissions() {
    return [
      {
        id: 'wallet-shim-eth_accounts',
        parentCapability: 'eth_accounts',
        invoker: 'wallet-shim',
        caveats: [{ type: 'restrictReturnedAccounts', value: [...state.accounts] }],
        date: Date.now(),
      },
    ];
  }

  function chainParam(params) {
    const id = params?.[0]?.chainId;
    if (id === undefined) throw errors.invalidParams('Expected [{ chainId }]');
    try {
      return normalizeChainId(id);
    } catch {
      throw errors.invalidParams(`Invalid chainId: ${id}`);
    }
  }

  const handlers = {
    eth_requestAccounts: async () => {
      connect();
      return [...state.accounts];
    },
    eth_accounts: async () => (state.connected || config.autoConnect ? [...state.accounts] : []),
    eth_chainId: async () => state.chainId,
    net_version: async () => BigInt(state.chainId).toString(10),
    eth_coinbase: async () => state.accounts[0] ?? null,

    wallet_switchEthereumChain: async (params) => {
      const id = chainParam(params);
      if (!state.chains[id] && !config.allowAnyChain) throw errors.unrecognizedChain(id);
      setChainId(id);
      return null;
    },
    wallet_addEthereumChain: async (params) => {
      const id = chainParam(params);
      const spec = params[0];
      state.chains[id] = {
        name: spec.chainName ?? id,
        rpc: spec.rpcUrls?.[0] ?? null,
        symbol: spec.nativeCurrency?.symbol ?? 'ETH',
      };
      return null;
    },
    wallet_requestPermissions: async () => {
      connect();
      return permissions();
    },
    wallet_getPermissions: async () => permissions(),
    wallet_revokePermissions: async () => {
      disconnect();
      return null;
    },
    wallet_watchAsset: async () => true,
  };

  // Transactions (Task 8) and signing (Task 9) extend `handlers` below.
  return { handlers, setChainId, setAccounts, disconnect, connect, assertOwner, sameAddress };
}
