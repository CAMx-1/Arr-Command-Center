// Thin client over the backend proxy. All requests go to /api/proxy/<service>/...
// so the server can attach API keys + Cloudflare Access headers.

async function parse(res) {
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json().catch(() => null) : await res.text();
  if (!res.ok) {
    const msg = (data && (data.error || data.message)) || (typeof data === 'string' && data) || `HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const api = {
  // App-level (not proxied)
  async config() { return parse(await fetch('/api/config')); },
  async status() { return parse(await fetch('/api/status')); },
  async diagnostics() { return parse(await fetch('/api/diagnostics')); },
  // Plex API (server holds the token)
  plex: {
    watchlist: async () => parse(await fetch('/api/plex/watchlist')),
    users: async () => parse(await fetch('/api/plex/users')),
    friends: async () => parse(await fetch('/api/plex/friends')),
    sessions: async () => parse(await fetch('/api/plex/sessions')),
    duplicates: async () => parse(await fetch('/api/plex/duplicates')),
  },
  // Custom links (Organizr-style)
  async links() { return parse(await fetch('/api/links')); },
  async addLink(link) { return parse(await fetch('/api/links', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(link) })); },
  async removeLink(id) { return parse(await fetch(`/api/links/${encodeURIComponent(id)}`, { method: 'DELETE' })); },
  async loginLog() { return parse(await fetch('/api/login-log')); },
  async saveService(key, service) { return parse(await fetch('/api/config/service', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key, service }) })); },
  async deleteService(key) { return parse(await fetch(`/api/config/service/${encodeURIComponent(key)}`, { method: 'DELETE' })); },

  // Generic proxied request to a service
  async proxy(service, path, { method = 'GET', body, headers } = {}) {
    const opts = { method, headers: { ...headers } };
    if (body !== undefined) {
      opts.headers['content-type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const clean = path.replace(/^\/+/, '');
    return parse(await fetch(`/api/proxy/${service}/${clean}`, opts));
  },

  // Proxied POST with an application/x-www-form-urlencoded body (qBittorrent).
  async proxyForm(service, path, params = {}) {
    const clean = path.replace(/^\/+/, '');
    const body = new URLSearchParams(params).toString();
    return parse(await fetch(`/api/proxy/${service}/${clean}`, {
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

  // ---- Overseerr (v1) helpers ----
  seerr(service) {
    return {
      get: (p) => this.proxy(service, `api/v1/${p}`),
      post: (p, body) => this.proxy(service, `api/v1/${p}`, { method: 'POST', body }),
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
