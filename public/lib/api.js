// Thin client over the backend proxy. All requests go to /api/proxy/<service>/...
// so the server can attach API keys + Cloudflare Access headers.

// Turn an error response body into a short, human-readable message. Upstream
// HTML error pages (404s, Cloudflare/reverse-proxy pages) must never be shown
// verbatim in a toast; *arr validation errors arrive as [{ errorMessage }].
export function errorMessage(data, status, statusText = '') {
  const fallback = `HTTP ${status}${statusText ? ` ${statusText}` : ''}`;
  if (Array.isArray(data)) {
    const msgs = data.map((d) => d && (d.errorMessage || d.message)).filter(Boolean);
    return msgs.length ? msgs.join('; ') : fallback;
  }
  if (data && typeof data === 'object') {
    const m = data.error || data.message || data.title;
    return typeof m === 'string' && m ? m : (m && typeof m === 'object' && m.message) || fallback;
  }
  if (typeof data === 'string') {
    const text = data.trim();
    if (!text) return fallback;
    if (/^<(!doctype|html|\?xml|head|body)/i.test(text) || /<\/(html|body|div|p)>/i.test(text)) {
      const title = (text.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1];
      const clean = title && title.replace(/\s+/g, ' ').trim();
      return clean ? `${fallback} — ${clean.slice(0, 120)}` : fallback;
    }
    return text.length > 200 ? `${text.slice(0, 200)}…` : text;
  }
  return fallback;
}

async function parse(res) {
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json().catch(() => null) : await res.text();
  if (!res.ok) {
    const msg = errorMessage(data, res.status, res.statusText);
    const err = new Error(msg);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

// "Confirm it's you": when the server asks first (two-factor accounts, before
// deleting files or changing roles), show the dialog, then retry once.
// Parallel requests share one dialog. A cancel stays in effect while more
// requests keep asking (a loop of deletes), until they pause for a moment.
let confirming = null;
let cancelledAt = 0;
const cancelled = () => Object.assign(new Error('Cancelled'), { cancelled: true });
async function send(url, init) {
  // The dialog's own requests never wait on the dialog.
  if (String(url).startsWith('/api/account/verify')) return fetch(url, init);
  const res = await fetch(url, init);
  if (res.status !== 403 && res.status !== 401) return res;
  if (!(res.headers.get('content-type') || '').includes('application/json')) return res;
  const data = await res.clone().json().catch(() => null);
  if (!data || !data.needsVerification) return res;
  if (Date.now() - cancelledAt < 1500) { cancelledAt = Date.now(); throw cancelled(); }
  if (!confirming) confirming = import('./passkeys.js').then((m) => m.confirmIdentity({ reason: data.error })).finally(() => { confirming = null; });
  if (!(await confirming)) { cancelledAt = Date.now(); throw cancelled(); }
  return fetch(url, init);
}

export const api = {
  // App-level (not proxied)
  async config() { return parse(await send('/api/config')); },
  async version() { return parse(await send('/api/version', { cache: 'no-store' })); },
  async status() { return parse(await send('/api/status')); },
  async diagnostics() { return parse(await send('/api/diagnostics')); },
  async system() { return parse(await send('/api/system', { cache: 'no-store' })); },
  async operations({ limit = 100, fresh = false } = {}) { return parse(await send(`/api/operations?limit=${encodeURIComponent(limit)}${fresh ? `&fresh=${Date.now()}` : ''}`)); },
  // Plex API (server holds the token)
  plex: {
    watchlist: async () => parse(await send('/api/plex/watchlist')),
    users: async () => parse(await send('/api/plex/users')),
    friends: async () => parse(await send('/api/plex/friends')),
    sessions: async () => parse(await send('/api/plex/sessions')),
    duplicates: async () => parse(await send('/api/plex/duplicates')),
  },
  // Custom links (Organizr-style)
  async links() { return parse(await send('/api/links')); },
  async addLink(link) { return parse(await send('/api/links', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(link) })); },
  async removeLink(id) { return parse(await send(`/api/links/${encodeURIComponent(id)}`, { method: 'DELETE' })); },
  async loginLog() { return parse(await send('/api/login-log')); },
  // Plain JSON from one of this server's own /api routes.
  async getJson(path) { return parse(await send(path, { cache: 'no-store' })); },
  async sendJson(path, body, method = 'POST') { return parse(await send(path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) })); },
  async saveService(key, service) { return parse(await send('/api/config/service', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key, service }) })); },
  async deleteService(key) { return parse(await send(`/api/config/service/${encodeURIComponent(key)}`, { method: 'DELETE' })); },
  async exportLocalFallback() { return parse(await send('/api/config/local-fallback', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirm: true }) })); },

  // Generic proxied request to a service
  async proxy(service, path, { method = 'GET', body, headers } = {}) {
    const opts = { method, headers: { ...headers } };
    if (body !== undefined) {
      opts.headers['content-type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const clean = path.replace(/^\/+/, '');
    return parse(await send(`/api/proxy/${service}/${clean}`, opts));
  },

  // Proxied POST with an application/x-www-form-urlencoded body (qBittorrent).
  async proxyForm(service, path, params = {}) {
    const clean = path.replace(/^\/+/, '');
    const body = new URLSearchParams(params).toString();
    return parse(await send(`/api/proxy/${service}/${clean}`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body,
    }));
  },

  // ---- Sonarr / Radarr (v3) helpers ----
  arr(service) {
    return {
      get: (p) => this.proxy(service, `api/v3/${p}`),
      post: (p, body) => this.proxy(service, `api/v3/${p}`, { method: 'POST', body }),
      put: (p, body) => this.proxy(service, `api/v3/${p}`, { method: 'PUT', body }),
      del: (p, body) => this.proxy(service, `api/v3/${p}`, { method: 'DELETE', body }),
    };
  },

  // ---- Lidarr / Readarr (v1) helpers — same shape, different API version ----
  arrV1(service) {
    return {
      get: (p) => this.proxy(service, `api/v1/${p}`),
      post: (p, body) => this.proxy(service, `api/v1/${p}`, { method: 'POST', body }),
      put: (p, body) => this.proxy(service, `api/v1/${p}`, { method: 'PUT', body }),
      del: (p, body) => this.proxy(service, `api/v1/${p}`, { method: 'DELETE', body }),
    };
  },

  // Bindery also lives under /api/v1, but its list envelopes and resource
  // actions are intentionally adapted in bookServices.js rather than treated
  // as Readarr-compatible wire contracts.
  bindery(service) {
    return {
      get: (p) => this.proxy(service, `api/v1/${p}`),
      post: (p, body) => this.proxy(service, `api/v1/${p}`, { method: 'POST', body }),
      put: (p, body) => this.proxy(service, `api/v1/${p}`, { method: 'PUT', body }),
      del: (p, body) => this.proxy(service, `api/v1/${p}`, { method: 'DELETE', body }),
    };
  },
  // Pick the right client for any *arr-style service by type.
  arrByType(type, service) {
    if (type === 'bindery') return this.bindery(service);
    return (type === 'lidarr' || type === 'readarr') ? this.arrV1(service) : this.arr(service);
  },

  // ---- Overseerr (v1) helpers ----
  seerr(service) {
    return {
      get: (p) => this.proxy(service, `api/v1/${p}`),
      post: (p, body) => this.proxy(service, `api/v1/${p}`, { method: 'POST', body }),
      del: (p) => this.proxy(service, `api/v1/${p}`, { method: 'DELETE' }),
    };
  },

  // ---- Prowlarr (v1) helpers ----
  prowlarr(service) {
    return {
      get: (p) => this.proxy(service, `api/v1/${p}`),
      post: (p, body) => this.proxy(service, `api/v1/${p}`, { method: 'POST', body }),
      put: (p, body) => this.proxy(service, `api/v1/${p}`, { method: 'PUT', body }),
      del: (p) => this.proxy(service, `api/v1/${p}`, { method: 'DELETE' }),
    };
  },

  // ---- Bazarr helper (subtitle manager; API base is /api/, no version prefix) ----
  bazarr(service) {
    return {
      get: (p) => this.proxy(service, `api/${p}`),
      post: (p, body) => this.proxy(service, `api/${p}`, { method: 'POST', body }),
      patch: (p, body) => this.proxy(service, `api/${p}`, { method: 'PATCH', body }),
      del: (p) => this.proxy(service, `api/${p}`, { method: 'DELETE' }),
    };
  },

  // ---- qBittorrent helper (WebUI API v2; POSTs are form-encoded) ----
  qbit(service) {
    return {
      get: (p) => this.proxy(service, `api/v2/${p}`),
      post: (p, params) => this.proxyForm(service, `api/v2/${p}`, params),
    };
  },

  // ---- Usenet indexer helper (public indexers like NZBGeek; ?apikey= injected server-side) ----
  indexer(service, params = {}) {
    const qs = new URLSearchParams({ o: 'json', ...params });
    return this.proxy(service, `api?${qs.toString()}`);
  },

  // ---- RPC download clients ----
  transmission(service) {
    return {
      call: async (method, args = {}) => {
        const data = await this.proxy(service, 'transmission/rpc', { method: 'POST', body: { method, arguments: args } });
        if (!data || data.result !== 'success') throw new Error(data?.result || 'Transmission RPC error');
        return data.arguments || {};
      },
    };
  },

  deluge(service) {
    let id = 10;
    return {
      call: async (method, params = []) => {
        const data = await this.proxy(service, 'json', { method: 'POST', body: { method, params, id: id++ } });
        if (!data || data.error) throw new Error(data?.error?.message || 'Deluge JSON-RPC error');
        return data.result;
      },
    };
  },

  nzbget(service) {
    let id = 10;
    return {
      call: async (method, params = []) => {
        const data = await this.proxy(service, 'jsonrpc', { method: 'POST', body: { method, params, id: id++ } });
        if (!data || data.error) throw new Error(data?.error?.message || 'NZBGet JSON-RPC error');
        return data.result;
      },
    };
  },

  // ---- Jellyfin / Emby shared MediaBrowser API ----
  mediaServer(service) {
    return {
      get: (path) => this.proxy(service, path),
      post: (path, body) => this.proxy(service, path, { method: 'POST', body }),
    };
  },

  // ---- SABnzbd helper (query-based API) ----
  sab(service, params = {}) {
    const qs = new URLSearchParams({ output: 'json', ...params });
    return this.proxy(service, `api?${qs.toString()}`);
  },

  // ---- Tautulli helper (api/v2?cmd=... , response wrapped in {response:{data}}) ----
  tautulli(service) {
    return {
      get: async (cmd, params = {}) => {
        const qs = new URLSearchParams({ cmd, ...params });
        const res = await api.proxy(service, `api/v2?${qs.toString()}`);
        if (res && res.response) {
          if (res.response.result !== 'success') throw new Error(res.response.message || 'Tautulli error');
          return res.response.data;
        }
        return res;
      },
    };
  },
};
