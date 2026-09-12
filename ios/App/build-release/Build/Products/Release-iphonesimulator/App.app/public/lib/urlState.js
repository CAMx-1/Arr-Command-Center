// Pure hash-route helpers shared by the app shell and tests.
// Route state uses #/<route>?key=value so views remain bookmarkable without a
// server-side SPA router.
export function parseHash(hash = '') {
  const raw = String(hash).replace(/^#\/?/, '');
  const split = raw.indexOf('?');
  const route = decodeURIComponent((split >= 0 ? raw.slice(0, split) : raw) || 'home');
  const search = split >= 0 ? raw.slice(split + 1) : '';
  return { route, params: Object.fromEntries(new URLSearchParams(search)) };
}

export function cleanParams(params = {}) {
  const out = {};
  for (const [key, value] of Object.entries(params || {})) {
    if (value === undefined || value === null || value === '' || value === false) continue;
    out[key] = String(value);
  }
  return out;
}

export function buildHash(route = 'home', params = {}) {
  const safeRoute = encodeURIComponent(route || 'home').replace(/%2F/gi, '/');
  const query = new URLSearchParams(cleanParams(params)).toString();
  return `#/${safeRoute}${query ? `?${query}` : ''}`;
}

export function patchParams(params = {}, patch = {}) {
  const next = { ...params };
  for (const [key, value] of Object.entries(patch || {})) {
    if (value === undefined || value === null || value === '' || value === false) delete next[key];
    else next[key] = String(value);
  }
  return cleanParams(next);
}
