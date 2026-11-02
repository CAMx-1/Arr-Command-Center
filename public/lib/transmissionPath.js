// Transmission RPC path. Transmission serves RPC at /transmission/rpc by
// default, but `rpc-url` can change it and seedboxes often expose it elsewhere
// (for example /rpc or /transmission/custom/rpc). The UI always calls the
// logical path `transmission/rpc`; the server proxy and the local backend map
// it to the configured path.

export const DEFAULT_RPC_PATH = '/transmission/rpc';
export const LOGICAL_RPC_PATH = 'transmission/rpc';

// Returns a clean absolute path, or DEFAULT_RPC_PATH for blank input.
// Throws on anything that isn't a plain URL path (no scheme, query, fragment,
// '..' segments or unusual characters).
export function normalizeRpcPath(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return DEFAULT_RPC_PATH;
  if (raw.length > 200) throw new Error('RPC path is too long');
  const path = (raw.startsWith('/') ? raw : `/${raw}`).replace(/\/{2,}/g, '/').replace(/\/+$/, '') || '/';
  if (!/^\/[A-Za-z0-9._~\-/]*$/.test(path)) throw new Error('RPC path may only contain letters, numbers, / . _ ~ -');
  if (path.split('/').some((seg) => seg === '..' || seg === '.')) throw new Error('RPC path may not contain . or .. segments');
  if (path === '/') throw new Error('RPC path cannot be just /');
  return path;
}

export function safeRpcPath(value) {
  try { return normalizeRpcPath(value); } catch { return DEFAULT_RPC_PATH; }
}

// Map a proxied sub-path to the upstream sub-path (no leading slash).
export function transmissionSubPath(subPath, rpcPath) {
  const clean = String(subPath || '').replace(/^\/+/, '');
  if (clean !== LOGICAL_RPC_PATH) return clean;
  return safeRpcPath(rpcPath).replace(/^\/+/, '');
}
