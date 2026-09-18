import { errors } from './errors.js';

export function createPassthrough({ fetch: doFetch, rpcUrl }) {
  let nextId = 0;
  return async function passthrough(method, params = []) {
    if (!rpcUrl) throw errors.unsupportedMethod(method);
    const res = await doFetch(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++nextId, method, params }),
    });
    if (!res.ok) throw errors.internal(`RPC HTTP ${res.status} from ${rpcUrl}`);
    const body = await res.json();
    if (body.error) throw errors.fromRpc(body.error);
    return body.result;
  };
}
