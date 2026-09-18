export function createEmitter() {
  const listeners = new Map();

  function on(event, fn) {
    if (typeof fn !== 'function') return api;
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(fn);
    return api;
  }
  function removeListener(event, fn) {
    listeners.get(event)?.delete(fn);
    return api;
  }
  function once(event, fn) {
    const wrapper = (...args) => {
      removeListener(event, wrapper);
      fn(...args);
    };
    return on(event, wrapper);
  }
  function emit(event, ...args) {
    const set = listeners.get(event);
    if (!set) return false;
    for (const fn of [...set]) {
      try {
        fn(...args);
      } catch {
        // A misbehaving dApp listener must not break the provider.
      }
    }
    return set.size > 0;
  }
  function listenerCount(event) {
    return listeners.get(event)?.size ?? 0;
  }

  const api = { on, addListener: on, once, off: removeListener, removeListener, emit, listenerCount };
  return api;
}
