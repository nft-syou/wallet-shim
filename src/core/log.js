const MAX_LOG_LEN = 200;

function fmt(value) {
  let s;
  try {
    s = JSON.stringify(value);
  } catch {
    s = String(value);
  }
  if (s === undefined) s = String(value);
  return s.length > MAX_LOG_LEN ? s.slice(0, MAX_LOG_LEN) + '…' : s;
}

export function createRecorder({ console: con, verbose = true }) {
  const calls = [];
  return {
    calls,
    record(entry) {
      const e = { at: Date.now(), ...entry };
      calls.push(e);
      if (verbose) {
        if (e.error) con.debug(`[wallet-shim] ${e.method} ✗ ${e.error.code} ${e.error.message}`);
        else con.debug(`[wallet-shim] ${e.method} → ${fmt(e.result)}`);
      }
      return e;
    },
    warn(msg) {
      con.warn(`[wallet-shim] ${msg}`);
    },
    info(msg) {
      if (verbose) con.debug(`[wallet-shim] ${msg}`);
    },
  };
}
