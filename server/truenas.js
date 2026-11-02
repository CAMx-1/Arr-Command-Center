// TrueNAS (25.04+) over its JSON-RPC 2.0 WebSocket API (wss://<host>/api/current).
// The REST API is deprecated and removed in TrueNAS 26, so this talks
// WebSocket. Read-only: it logs in with the API key, makes a few query calls
// and closes the socket.
//
// TrueNAS revokes an API key that is sent over an unencrypted connection, so
// only https:// base URLs are accepted (demo mode excepted).

const METHODS = {
  info: ['system.info', []],
  pools: ['pool.query', []],
  disks: ['disk.query', [[], { extra: { pools: true } }]],
  temps: ['disk.temperatures', []],
  apps: ['app.query', []],
  alerts: ['alert.list', []],
};

export function truenasSocketUrl(baseUrl, { allowInsecure = false } = {}) {
  let u;
  try { u = new URL(baseUrl); } catch { throw new Error('TrueNAS URL is not valid'); }
  if (u.protocol !== 'https:' && !(allowInsecure && u.protocol === 'http:')) {
    throw new Error('TrueNAS needs an https:// URL: it revokes API keys used over plain http');
  }
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  u.pathname = `${u.pathname.replace(/\/+$/, '')}/api/current`;
  u.search = '';
  return u.toString();
}

// Minimal JSON-RPC client over one WebSocket.
export function rpcSession(url, { WebSocketImpl = globalThis.WebSocket, timeoutMs = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocketImpl(url);
    let nextId = 1;
    const pending = new Map();
    const timer = setTimeout(() => { fail(new Error('TrueNAS did not answer in time')); }, timeoutMs);
    function fail(err) {
      clearTimeout(timer);
      for (const p of pending.values()) p.reject(err);
      pending.clear();
      try { ws.close(); } catch { /* ignore */ }
      reject(err);
    }
    ws.addEventListener('error', () => fail(new Error('Could not connect to TrueNAS (check the URL and certificate)')));
    ws.addEventListener('message', (ev) => {
      let msg; try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString()); } catch { return; }
      const p = msg && pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error((msg.error.data && msg.error.data.reason) || msg.error.message || 'TrueNAS error'));
      else p.resolve(msg.result);
    });
    ws.addEventListener('open', () => {
      clearTimeout(timer);
      const call = (method, params = [], ms = timeoutMs) => new Promise((res, rej) => {
        const id = nextId++;
        const t = setTimeout(() => { pending.delete(id); rej(new Error(`${method} timed out`)); }, ms);
        pending.set(id, { resolve: (v) => { clearTimeout(t); res(v); }, reject: (e) => { clearTimeout(t); rej(e); } });
        ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
      });
      resolve({ call, close: () => { try { ws.close(); } catch { /* ignore */ } } });
    });
  });
}

const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export function normalizeTruenas({ info = {}, pools = [], disks = [], temps = {}, apps = [], alerts = [] } = {}) {
  const t = temps || {};
  return {
    hostname: info.hostname || '', version: info.version || '', uptimeSeconds: n(info.uptime_seconds),
    memory: n(info.physmem), cores: n(info.cores), load: Array.isArray(info.loadavg) ? info.loadavg.map(n) : null,
    pools: (pools || []).map((p) => {
      const size = n(p.size); const allocated = n(p.allocated);
      return {
        name: p.name, status: p.status || 'UNKNOWN', healthy: p.healthy !== false,
        size, allocated, free: n(p.free), percent: size ? Math.round((allocated / size) * 1000) / 10 : 0,
        scan: p.scan && p.scan.function ? { kind: p.scan.function, state: p.scan.state, percent: n(p.scan.percentage), errors: n(p.scan.errors) } : null,
      };
    }),
    disks: (disks || []).map((d) => ({
      name: d.name, model: d.model || '', serial: d.serial || '', size: n(d.size), type: d.type || '',
      pool: d.pool || '', temp: t[d.name] == null ? null : n(t[d.name]),
    })).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
    apps: (apps || []).map((a) => ({ name: a.name, state: a.state || 'UNKNOWN', version: a.human_version || a.version || '', upgrade: !!a.upgrade_available }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    alerts: (alerts || []).filter((a) => !a.dismissed).map((a) => ({ level: a.level || 'INFO', text: String(a.formatted || a.text || '').replace(/<[^>]+>/g, '').slice(0, 300) })),
  };
}

export async function truenasOverview(svc, { allowInsecure = false, WebSocketImpl } = {}) {
  if (!svc.apiKey) throw new Error('TrueNAS needs an API key');
  const session = await rpcSession(truenasSocketUrl(svc.baseUrl, { allowInsecure }), { WebSocketImpl });
  try {
    const ok = await session.call('auth.login_with_api_key', [svc.apiKey]);
    if (ok !== true) throw Object.assign(new Error('TrueNAS rejected the API key'), { status: 401 });
    const out = {};
    // Optional calls (temperatures, apps, alerts) don't fail the whole page.
    await Promise.all(Object.entries(METHODS).map(async ([k, [method, params]]) => {
      try { out[k] = await session.call(method, params); }
      catch (e) { if (k === 'info' || k === 'pools') throw e; out[k] = undefined; }
    }));
    return normalizeTruenas(out);
  } finally { session.close(); }
}

export async function pingTruenas(svc, opts = {}) {
  const started = Date.now();
  try {
    const session = await rpcSession(truenasSocketUrl(svc.baseUrl, opts), { ...opts, timeoutMs: 8000 });
    try {
      const ok = await session.call('auth.login_with_api_key', [svc.apiKey || '']);
      if (ok !== true) return { ok: false, status: 401, ms: Date.now() - started, error: 'Auth / access denied' };
      const info = await session.call('system.info');
      return { ok: true, status: 200, ms: Date.now() - started, version: info && info.version };
    } finally { session.close(); }
  } catch (e) {
    return { ok: false, status: 0, ms: Date.now() - started, error: e.message };
  }
}
