import { errors, ProviderRpcError } from './errors.js';

export function createRouter({ handlers, overrides, passthrough, recorder }) {
  const pendingRejections = [];

  function takeRejection(method) {
    const i = pendingRejections.findIndex((p) => p.method === null || p.method === method);
    return i === -1 ? null : pendingRejections.splice(i, 1)[0];
  }

  async function request(args) {
    const method = args?.method;
    const params = args?.params ?? [];
    if (typeof method !== 'string') {
      const e = errors.invalidParams('request(): "method" must be a string');
      recorder.record({ method: String(method), params, error: { code: e.code, message: e.message } });
      throw e;
    }
    try {
      const rej = takeRejection(method);
      if (rej) throw errors.byCode(rej.code, rej.message);
      let result;
      if (Object.prototype.hasOwnProperty.call(overrides, method) && overrides[method] !== undefined) {
        const o = overrides[method];
        result = typeof o === 'function' ? await o(params, { method }) : o;
      } else if (Object.prototype.hasOwnProperty.call(handlers, method)) {
        result = await handlers[method](params);
      } else {
        result = await passthrough(method, params);
      }
      recorder.record({ method, params, result });
      return result;
    } catch (err) {
      const e = err instanceof ProviderRpcError ? err : errors.internal(err?.message ?? String(err));
      recorder.record({ method, params, error: { code: e.code, message: e.message } });
      throw e;
    }
  }

  function rejectNext(method = null, code = 4001, message) {
    pendingRejections.push({ method, code, message });
  }

  function override(method, value) {
    overrides[method] = value;
  }

  return { request, rejectNext, override };
}
