// Data access and normalisation for the newer integrations: Portainer,
// Glances, Pi-hole, AdGuard Home, Syncthing, Navidrome and Pulsarr. Every call
// goes through the server proxy (/api/proxy/<key>/...), which adds credentials
// and enforces roles. Normalisers are pure so they can be unit-tested.

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const arr = (v) => (Array.isArray(v) ? v : []);

// ------------------------------------------------------------------ Portainer
export function normalizePortainerEnvironments(list) {
  return arr(list).map((e) => {
    const snap = arr(e.Snapshots)[0] || {};
    return {
      id: e.Id, name: e.Name || `Environment ${e.Id}`, up: e.Status === 1,
      type: e.Type === 1 || e.Type === 2 ? 'Docker' : e.Type === 5 || e.Type === 6 || e.Type === 7 ? 'Kubernetes' : 'Docker',
      docker: snap.DockerVersion || '', running: num(snap.RunningContainerCount), stopped: num(snap.StoppedContainerCount),
      healthy: num(snap.HealthyContainerCount), unhealthy: num(snap.UnhealthyContainerCount),
      images: num(snap.ImageCount), volumes: num(snap.VolumeCount), stacks: num(snap.StackCount),
      cpus: num(snap.TotalCPU), memory: num(snap.TotalMemory), at: snap.Time ? snap.Time * 1000 : null,
    };
  });
}

export function normalizePortainerContainers(list) {
  return arr(list).map((c) => {
    const labels = c.Labels || {};
    const status = String(c.Status || '');
    return {
      id: c.Id, name: String(arr(c.Names)[0] || c.Id || '').replace(/^\//, ''),
      image: c.Image || '', state: c.State || 'unknown', status,
      health: /\(unhealthy\)/i.test(status) ? 'unhealthy' : /\(healthy\)/i.test(status) ? 'healthy' : /\(health: starting\)/i.test(status) ? 'starting' : '',
      stack: labels['com.docker.compose.project'] || labels['com.docker.stack.namespace'] || '',
      ports: [...new Set(arr(c.Ports).filter((p) => p.PublicPort).map((p) => `${p.PublicPort}→${p.PrivatePort}/${p.Type}`))],
      created: c.Created ? c.Created * 1000 : null,
    };
  }).sort((a, b) => (!a.stack - !b.stack) || a.stack.localeCompare(b.stack) || a.name.localeCompare(b.name));
}

export function portainerClient(api, key) {
  const get = (p) => api.proxy(key, `api/${p}`);
  return {
    status: () => get('system/status'),
    environments: async () => normalizePortainerEnvironments(await get('endpoints')),
    containers: async (envId) => normalizePortainerContainers(await get(`endpoints/${encodeURIComponent(envId)}/docker/containers/json?all=1`)),
  };
}

// -------------------------------------------------------------------- Glances
export function normalizeGlances({ quicklook, fs, sensors, load, uptime, system, containers } = {}) {
  const q = quicklook || {};
  const temps = arr(sensors)
    .filter((s) => /temperature/i.test(s.type || '') && Number.isFinite(Number(s.value)))
    .map((s) => ({ label: s.label, value: num(s.value), unit: s.unit || '°C', warning: num(s.warning), critical: num(s.critical) }));
  const cpuTemp = temps.find((t) => /package|tctl|tdie|cpu/i.test(t.label)) || temps.find((t) => /core/i.test(t.label)) || null;
  return {
    host: (system && system.hostname) || '',
    os: system ? [system.linux_distro || system.os_name, system.os_version].filter(Boolean).join(' ') : '',
    uptime: typeof uptime === 'string' ? uptime : '',
    cpu: num(q.cpu), mem: num(q.mem), swap: num(q.swap), cpuName: q.cpu_name || '',
    load: load ? [load.min1, load.min5, load.min15].map(num) : null,
    cores: load ? num(load.cpucore) : 0,
    disks: arr(fs).map((d) => ({ mount: d.mnt_point, device: d.device_name, type: d.fs_type, size: num(d.size), used: num(d.used), percent: num(d.percent) })),
    temps, cpuTemp,
    containers: arr(containers).map((c) => ({ name: c.name, status: c.status || c.Status || '', cpu: num(c.cpu_percent ?? (c.cpu && c.cpu.total)), memory: num(c.memory_usage ?? (c.memory && c.memory.usage)), engine: c.engine || '' })),
  };
}

export function glancesClient(api, key) {
  const get = (p) => api.proxy(key, `api/4/${p}`);
  return {
    async overview() {
      const parts = ['quicklook', 'fs', 'sensors', 'load', 'uptime', 'system', 'containers'];
      const values = await Promise.all(parts.map((p) => get(p).catch(() => null)));
      if (values[0] == null && values[1] == null) throw new Error('Glances did not respond (API v4 is required)');
      return normalizeGlances(Object.fromEntries(parts.map((p, i) => [p, values[i]])));
    },
  };
}

// --------------------------------------------------------------------- Pi-hole
export function normalizePiholeSummary(summary = {}, blocking = {}) {
  const q = summary.queries || {};
  return {
    total: num(q.total), blocked: num(q.blocked), percent: num(q.percent_blocked),
    cached: num(q.cached), forwarded: num(q.forwarded),
    domains: num(summary.gravity && summary.gravity.domains_being_blocked),
    clients: num(summary.clients && summary.clients.active),
    blocking: blocking.blocking || 'unknown', timer: blocking.timer == null ? null : num(blocking.timer),
  };
}

export function piholeClient(api, key) {
  const get = (p) => api.proxy(key, `api/${p}`);
  return {
    async summary() {
      const [s, b] = await Promise.all([get('stats/summary'), get('dns/blocking').catch(() => ({}))]);
      return normalizePiholeSummary(s, b);
    },
    topBlocked: async (count = 10) => arr((await get(`stats/top_domains?blocked=true&count=${count}`)).domains).map((d) => ({ domain: d.domain, count: num(d.count) })),
    topClients: async (count = 10) => arr((await get(`stats/top_clients?count=${count}`)).clients).map((c) => ({ name: c.name || c.ip, ip: c.ip, count: num(c.count) })),
    // seconds = null for "until turned back on".
    setBlocking: (enabled, seconds = null) => api.proxy(key, 'api/dns/blocking', { method: 'POST', body: { blocking: !!enabled, timer: enabled ? null : seconds } }),
  };
}

// ------------------------------------------------------------- AdGuard Home
const pairList = (list) => arr(list).map((o) => { const [k, v] = Object.entries(o || {})[0] || []; return { name: k, count: num(v) }; }).filter((x) => x.name);

export function normalizeAdguard(status = {}, stats = {}) {
  const total = num(stats.num_dns_queries);
  const blocked = num(stats.num_blocked_filtering);
  return {
    version: status.version || '', running: status.running !== false, protection: !!status.protection_enabled,
    disabledUntil: status.protection_disabled_until || null,
    total, blocked, percent: total ? Math.round((blocked / total) * 1000) / 10 : 0,
    avgMs: Math.round(num(stats.avg_processing_time) * 1000 * 10) / 10,
    topBlocked: pairList(stats.top_blocked_domains), topClients: pairList(stats.top_clients),
  };
}

export function adguardClient(api, key) {
  const get = (p) => api.proxy(key, `control/${p}`);
  return {
    overview: async () => { const [status, stats] = await Promise.all([get('status'), get('stats').catch(() => ({}))]); return normalizeAdguard(status, stats); },
    // durationMs: omit/0 to stay off until turned back on.
    setProtection: (enabled, durationMs = 0) => api.proxy(key, 'control/protection', { method: 'POST', body: enabled || !durationMs ? { enabled: !!enabled } : { enabled: false, duration: durationMs } }),
  };
}

// ------------------------------------------------------------------ Syncthing
export function normalizeSyncthing({ folders, statuses = {}, devices, connections, myId } = {}) {
  const conn = (connections && connections.connections) || {};
  const dev = arr(devices).filter((d) => d.deviceID !== myId).map((d) => {
    const c = conn[d.deviceID] || {};
    return { id: d.deviceID, name: d.name || d.deviceID.slice(0, 7), paused: !!d.paused, connected: !!c.connected, address: c.address || '', inBytes: num(c.inBytesTotal), outBytes: num(c.outBytesTotal), client: c.clientVersion || '' };
  });
  return {
    folders: arr(folders).map((f) => {
      const st = statuses[f.id] || {};
      const global = num(st.globalBytes);
      const need = num(st.needBytes);
      return {
        id: f.id, label: f.label || f.id, path: f.path || '', paused: !!f.paused,
        state: f.paused ? 'paused' : (st.state || 'unknown'), error: st.error || '',
        globalBytes: global, needBytes: need, needFiles: num(st.needFiles),
        percent: global ? Math.floor(((global - need) / global) * 100) : 100,
        devices: arr(f.devices).length - 1,
      };
    }),
    devices: dev,
    inTotal: num(connections && connections.total && connections.total.inBytesTotal),
    outTotal: num(connections && connections.total && connections.total.outBytesTotal),
  };
}

export function syncthingClient(api, key) {
  const get = (p) => api.proxy(key, `rest/${p}`);
  return {
    async overview() {
      const [status, folders, devices, connections] = await Promise.all([get('system/status'), get('config/folders'), get('config/devices'), get('system/connections').catch(() => ({}))]);
      const statuses = Object.fromEntries(await Promise.all(arr(folders).map(async (f) => [f.id, await get(`db/status?folder=${encodeURIComponent(f.id)}`).catch(() => ({}))])));
      return { ...normalizeSyncthing({ folders, statuses, devices, connections, myId: status && status.myID }), uptime: num(status && status.uptime), myId: (status && status.myID) || '' };
    },
    rescan: (folderId) => api.proxy(key, `rest/db/scan?folder=${encodeURIComponent(folderId)}`, { method: 'POST' }),
  };
}

// ------------------------------------------------------------------ Navidrome
// Subsonic API. Errors come back as HTTP 200 with status "failed".
export function subsonicBody(data) {
  const r = data && data['subsonic-response'];
  if (!r) throw new Error('Not a Subsonic response');
  if (r.status !== 'ok') throw new Error((r.error && r.error.message) || 'Subsonic request failed');
  return r;
}

// Count album artists only (artists with albums), not every credited person.
export function countAlbumArtists(artistsBody) {
  return arr(artistsBody && artistsBody.artists && artistsBody.artists.index)
    .flatMap((i) => arr(i.artist)).filter((a) => num(a.albumCount) > 0).length;
}

export function navidromeClient(api, key) {
  const get = async (view, qs = '') => subsonicBody(await api.proxy(key, `rest/${view}.view${qs ? `?${qs}` : ''}`));
  const cover = (id, size = 300) => (id ? `/api/proxy/${encodeURIComponent(key)}/rest/getCoverArt.view?id=${encodeURIComponent(id)}&size=${size}` : '');
  return {
    cover,
    async overview() {
      const [scan, artists, newest, playing] = await Promise.all([
        get('getScanStatus'), get('getArtists').catch(() => null),
        get('getAlbumList2', 'type=newest&size=24').catch(() => null), get('getNowPlaying').catch(() => null),
      ]);
      const s = scan.scanStatus || {};
      return {
        version: scan.serverVersion || scan.version || '',
        scanning: !!s.scanning, songs: num(s.count), folders: num(s.folderCount), lastScan: s.lastScan || null,
        artists: artists ? countAlbumArtists(artists) : null,
        newest: arr(newest && newest.albumList2 && newest.albumList2.album).map((a) => ({ id: a.id, name: a.name, artist: a.artist, year: a.year, cover: cover(a.coverArt), created: a.created })),
        playing: arr(playing && playing.nowPlaying && playing.nowPlaying.entry).map((e) => ({ id: e.id, title: e.title, artist: e.artist, album: e.album, user: e.username, player: e.playerName, minutesAgo: num(e.minutesAgo), cover: cover(e.coverArt, 120) })),
      };
    },
    startScan: () => get('startScan'),
  };
}

// -------------------------------------------------------------------- Pulsarr
export function pulsarrClient(api, key) {
  const get = (p) => api.proxy(key, `v1/${p}`);
  return {
    stats: async () => ((await get('approval/stats')) || {}).stats || {},
    approvals: async (status = 'pending') => arr(((await get(`approval/requests?status=${encodeURIComponent(status)}&limit=50`)) || {}).approvalRequests),
    recent: async (limit = 20) => arr(((await get(`stats/recent-requests?limit=${limit}`)) || {}).items),
    approve: (id, notes) => api.proxy(key, `v1/approval/requests/${encodeURIComponent(id)}/approve`, { method: 'POST', body: notes ? { notes } : {} }),
    reject: (id, reason) => api.proxy(key, `v1/approval/requests/${encodeURIComponent(id)}/reject`, { method: 'POST', body: reason ? { reason } : {} }),
  };
}

export const PULSARR_STATUS = {
  pending_approval: ['Needs approval', 'warn'], pending: ['Pending', 'muted'], requested: ['Requested', 'info'], grabbed: ['Grabbed', 'info'], notified: ['Available', 'ok'],
};
