export class ProviderRpcError extends Error {
  constructor(code, message, data) {
    super(message);
    this.name = 'ProviderRpcError';
    this.code = code;
    if (data !== undefined) this.data = data;
  }
}

export const MESSAGES = {
  4001: 'User rejected the request.',
  4100: 'The requested account and/or method has not been authorized by the user.',
  4200: 'The requested method is not supported by this Ethereum provider.',
  4900: 'The provider is disconnected from all chains.',
  4902: 'Unrecognized chain ID. Try adding the chain using wallet_addEthereumChain first.',
  [-32601]: 'The method does not exist / is not available.',
  [-32602]: 'Invalid params.',
  [-32603]: 'Internal error.',
};

export const errors = {
  userRejected: (msg) => new ProviderRpcError(4001, msg ?? MESSAGES[4001]),
  unauthorized: (msg) => new ProviderRpcError(4100, msg ?? MESSAGES[4100]),
  unsupportedMethod: (method) =>
    new ProviderRpcError(4200, `The requested method is not supported: ${method}`),
  disconnected: () => new ProviderRpcError(4900, MESSAGES[4900]),
  unrecognizedChain: (chainId) =>
    new ProviderRpcError(4902, `Unrecognized chain ID "${chainId}". Try adding the chain using wallet_addEthereumChain first.`),
  methodNotFound: (method) =>
    new ProviderRpcError(-32601, `The method "${method}" does not exist / is not available.`),
  invalidParams: (msg) => new ProviderRpcError(-32602, msg ?? MESSAGES[-32602]),
  internal: (msg) => new ProviderRpcError(-32603, msg ?? MESSAGES[-32603]),
  fromRpc: (err) =>
    new ProviderRpcError(err?.code ?? -32603, err?.message ?? MESSAGES[-32603], err?.data),
  byCode: (code, msg) => new ProviderRpcError(code, msg ?? MESSAGES[code] ?? `Error ${code}`),
};
