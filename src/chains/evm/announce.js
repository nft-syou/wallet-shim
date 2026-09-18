import { METAMASK_ICON } from './constants.js';

function uuid(win) {
  const c = win.crypto ?? globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function installEvmProvider({ provider, config, env, recorder }) {
  const win = env.window;
  if (win.ethereum && !config.replaceExisting) {
    recorder.warn('window.ethereum already exists and replaceExisting=false; announcing via EIP-6963 only');
  } else {
    try {
      Object.defineProperty(win, 'ethereum', { value: provider, configurable: true, writable: true, enumerable: true });
    } catch (e) {
      recorder.warn(`could not define window.ethereum (${e.message}); announcing via EIP-6963 only`);
    }
  }

  const info = Object.freeze({ uuid: uuid(win), name: config.name, icon: config.icon ?? METAMASK_ICON, rdns: config.rdns });
  const detail = Object.freeze({ info, provider });
  const announce = () => win.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail }));
  win.addEventListener('eip6963:requestProvider', announce);
  announce();
  return { info, announce };
}
