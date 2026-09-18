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
    state.permissionsGrantedAt = null;
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
        date: (state.permissionsGrantedAt ??= Date.now()),
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

  // ---------- transactions (dry run: nothing is broadcast) ----------

  const ZERO_BLOOM = '0x' + '0'.repeat(512);

  function findTx(hash) {
    if (typeof hash !== 'string') return null;
    return state.txs.find((t) => t.hash.toLowerCase() === hash.toLowerCase()) ?? null;
  }

  function recordTx(tx) {
    const hash = '0x' + keccakHex(utf8ToBytes(`wallet-shim:tx:${state.nonce++}:${JSON.stringify(tx)}`));
    const entry = { hash, tx, at: Date.now() };
    state.txs.push(entry);
    return entry;
  }

  function txParam(params) {
    const tx = params?.[0];
    if (!tx || typeof tx !== 'object') throw errors.invalidParams('Expected [transaction]');
    const withFrom = { ...tx, from: tx.from ?? state.accounts[0] };
    assertOwner(withFrom.from);
    return withFrom;
  }

  async function currentBlockNumber() {
    try {
      const bn = await passthrough('eth_blockNumber', []);
      return typeof bn === 'string' ? bn : '0x1';
    } catch {
      return '0x1';
    }
  }

  function fakeBlockHash(blockNumber) {
    return '0x' + keccakHex(utf8ToBytes(`wallet-shim:block:${blockNumber}`));
  }

  Object.assign(handlers, {
    eth_sendTransaction: async (params) => recordTx(txParam(params)).hash,

    eth_sendRawTransaction: async (params) => {
      const raw = params?.[0];
      if (typeof raw !== 'string') throw errors.invalidParams('Expected [rawTransaction]');
      const hash = '0x' + keccakHex(toBytes(raw));
      state.txs.push({ hash, tx: { raw, from: state.accounts[0] }, at: Date.now() });
      return hash;
    },

    eth_signTransaction: async (params) => {
      const tx = txParam(params);
      return '0x' + keccakHex(utf8ToBytes(`wallet-shim:signed-tx:${JSON.stringify(tx)}`));
    },

    eth_getTransactionReceipt: async (params) => {
      const rec = findTx(params?.[0]);
      if (!rec) return passthrough('eth_getTransactionReceipt', params);
      const blockNumber = await currentBlockNumber();
      return {
        transactionHash: rec.hash,
        transactionIndex: '0x0',
        blockHash: fakeBlockHash(blockNumber),
        blockNumber,
        from: rec.tx.from ?? state.accounts[0],
        to: rec.tx.to ?? null,
        cumulativeGasUsed: '0x5208',
        gasUsed: '0x5208',
        effectiveGasPrice: rec.tx.gasPrice ?? rec.tx.maxFeePerGas ?? '0x1',
        contractAddress: null,
        logs: [],
        logsBloom: ZERO_BLOOM,
        status: '0x1',
        type: rec.tx.type ?? '0x2',
      };
    },

    eth_getTransactionByHash: async (params) => {
      const rec = findTx(params?.[0]);
      if (!rec) return passthrough('eth_getTransactionByHash', params);
      const blockNumber = await currentBlockNumber();
      const idx = state.txs.indexOf(rec);
      return {
        hash: rec.hash,
        blockHash: fakeBlockHash(blockNumber),
        blockNumber,
        transactionIndex: '0x0',
        from: rec.tx.from ?? state.accounts[0],
        to: rec.tx.to ?? null,
        value: rec.tx.value ?? '0x0',
        gas: rec.tx.gas ?? '0x5208',
        gasPrice: rec.tx.gasPrice ?? rec.tx.maxFeePerGas ?? '0x1',
        maxFeePerGas: rec.tx.maxFeePerGas ?? '0x1',
        maxPriorityFeePerGas: rec.tx.maxPriorityFeePerGas ?? '0x1',
        input: rec.tx.data ?? rec.tx.input ?? '0x',
        nonce: '0x' + idx.toString(16),
        type: rec.tx.type ?? '0x2',
        chainId: state.chainId,
        v: '0x1',
        r: '0x' + keccakHex(utf8ToBytes(`r:${rec.hash}`)),
        s: '0x' + keccakHex(utf8ToBytes(`s:${rec.hash}`)),
      };
    },

    eth_estimateGas: async (params) =>
      config.estimateGas === 'passthrough' ? passthrough('eth_estimateGas', params) : config.estimateGas,
  });

  // Transactions (Task 8) and signing (Task 9) extend `handlers` below.
  return { handlers, setChainId, setAccounts, disconnect, connect, assertOwner, sameAddress };
}
