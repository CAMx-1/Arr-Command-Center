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

export function decodeDockerLogs(bytes) {
  const out = [];
  let i = 0;
  const dec = new TextDecoder();
  const framed = bytes.length >= 8 && (bytes[0] === 1 || bytes[0] === 2) && bytes[1] === 0 && bytes[2] === 0 && bytes[3] === 0;
  if (!framed) return dec.decode(bytes).split(/\r?\n/).filter(Boolean).map((text) => ({ stream: 'stdout', text }));
  while (i + 8 <= bytes.length) {
    const stream = bytes[i] === 2 ? 'stderr' : 'stdout';
    const len = (bytes[i + 4] << 24) | (bytes[i + 5] << 16) | (bytes[i + 6] << 8) | bytes[i + 7];
    const chunk = dec.decode(bytes.subarray(i + 8, i + 8 + len));
    for (const text of chunk.split(/\r?\n/)) if (text) out.push({ stream, text });
    i += 8 + len;
  }
  return out;
}

export function portainerClient(api, key) {
  const get = (p) => api.proxy(key, `api/${p}`);
  return {
    status: () => get('system/status'),
    environments: async () => normalizePortainerEnvironments(await get('endpoints')),
    containers: async (envId) => normalizePortainerContainers(await get(`endpoints/${encodeURIComponent(envId)}/docker/containers/json?all=1`)),
    // Last `tail` log lines (admin only: logs can contain secrets). Docker
    // returns a multiplexed stream for non-TTY containers; decodeDockerLogs
    // strips the 8-byte frame headers.
    async logs(envId, containerId, tail = 200) {
      const r = await fetch(`/api/proxy/${encodeURIComponent(key)}/api/endpoints/${encodeURIComponent(envId)}/docker/containers/${encodeURIComponent(containerId)}/logs?stdout=1&stderr=1&timestamps=1&tail=${tail}`);
      if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error || d.message || `HTTP ${r.status}`); }
      return decodeDockerLogs(new Uint8Array(await r.arrayBuffer()));
    },
    // action: start | stop | restart. Docker answers 304 when it's already in
    // that state, which is fine.
    async containerAction(envId, containerId, action) {
      if (!['start', 'stop', 'restart'].includes(action)) throw new Error('Unsupported action');
      try { await api.proxy(key, `api/endpoints/${encodeURIComponent(envId)}/docker/containers/${encodeURIComponent(containerId)}/${action}`, { method: 'POST' }); }
      catch (e) { if (e.status !== 304) throw e; }
    },
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

// -------------------------------------------------------------------- TrueNAS
// The server talks to TrueNAS over its WebSocket API and returns one overview.
export function truenasClient(key, fetchImpl = (...a) => fetch(...a)) {
  return {
    async overview() {
      const r = await fetchImpl(`/api/truenas/${encodeURIComponent(key)}`, { cache: 'no-store' });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      return data;
    },
  };
}

// --------------------------------------------------------------------- Unraid
export const UNRAID_QUERY = `query Overview {
  info { os { hostname uptime } versions { core { unraid } } }
  metrics { cpu { percentTotal } memory { total used percentTotal } }
  array {
    state
    capacity { kilobytes { free used total } }
    parityCheckStatus { status running paused progress errors date speed }
    parities { name device size status temp numErrors rotational }
    disks { name device size status temp numErrors fsSize fsUsed fsFree rotational }
    caches { name device size status temp numErrors fsSize fsUsed fsFree rotational }
  }
  docker { containers { id names image state status autoStart isUpdateAvailable } }
  vms { domains { id name state } }
  notifications { overview { unread { info warning alert total } } }
}`;

const big = (v) => (v == null ? null : Number(v));
const diskOut = (d, role) => ({
  name: d.name || d.device || '?', device: d.device || '', role, status: d.status || 'UNKNOWN',
  ok: d.status === 'DISK_OK', standby: d.status === 'DISK_OK' && d.temp == null && d.rotational !== false,
  temp: d.temp == null ? null : Number(d.temp), errors: big(d.numErrors) || 0,
  size: (big(d.size) || 0) * 1024, fsSize: big(d.fsSize) == null ? null : big(d.fsSize) * 1024,
  fsUsed: big(d.fsUsed) == null ? null : big(d.fsUsed) * 1024,
});

export function normalizeUnraid(data = {}) {
  const a = data.array || {};
  const kb = (a.capacity && a.capacity.kilobytes) || {};
  const total = Number(kb.total) * 1024 || 0;
  const used = Number(kb.used) * 1024 || 0;
  const pc = a.parityCheckStatus || {};
  const unread = (data.notifications && data.notifications.overview && data.notifications.overview.unread) || {};
  return {
    hostname: (data.info && data.info.os && data.info.os.hostname) || '',
    version: (data.info && data.info.versions && data.info.versions.core && data.info.versions.core.unraid) || '',
    uptime: (data.info && data.info.os && data.info.os.uptime) || '',
    cpu: data.metrics && data.metrics.cpu ? Number(data.metrics.cpu.percentTotal) : null,
    mem: data.metrics && data.metrics.memory ? Number(data.metrics.memory.percentTotal) : null,
    state: a.state || 'UNKNOWN', started: a.state === 'STARTED',
    total, used, percent: total ? Math.round((used / total) * 1000) / 10 : 0,
    parityCheck: { status: pc.status || '', running: !!pc.running, paused: !!pc.paused, progress: Number(pc.progress) || 0, errors: Number(pc.errors) || 0, date: pc.date || null, speed: pc.speed || '' },
    disks: [...(a.parities || []).map((d) => diskOut(d, 'parity')), ...(a.disks || []).map((d) => diskOut(d, 'data')), ...(a.caches || []).map((d) => diskOut(d, 'cache'))],
    containers: ((data.docker && data.docker.containers) || []).map((c) => ({
      id: c.id, name: String((c.names || [])[0] || c.id).replace(/^\//, ''), image: c.image || '',
      state: String(c.state || '').toLowerCase(), status: c.status || '', autoStart: !!c.autoStart, update: !!c.isUpdateAvailable,
    })).sort((x, y) => x.name.localeCompare(y.name)),
    vms: ((data.vms && data.vms.domains) || []).map((v) => ({ id: v.id, name: v.name || v.id, state: String(v.state || '').toLowerCase() })),
    alerts: { warning: Number(unread.warning) || 0, alert: Number(unread.alert) || 0, total: Number(unread.total) || 0 },
  };
}

export function unraidClient(api, key) {
  return {
    async overview() {
      const r = await api.proxy(key, 'graphql', { method: 'POST', body: { query: UNRAID_QUERY } });
      if (r && Array.isArray(r.errors) && r.errors.length && !r.data) throw new Error(r.errors[0].message || 'Unraid API error');
      return normalizeUnraid((r && r.data) || {});
    },
  };
}

// ------------------------------------------------------------------ Unpackerr
// Unpackerr v1 web server API (X-Api-Key). Status words from its source.
export const UNPACKERR_STATUS = {
  waiting: ['Waiting', 'muted'], queued: ['Queued', 'info'], extracting: ['Extracting', 'info'], extractfailed: ['Failed', 'down'],
  extracted: ['Waiting for import', 'warn'], imported: ['Imported', 'ok'], deleting: ['Cleaning up', 'muted'], deletefailed: ['Delete failed', 'down'],
  deleted: ['Done', 'ok'], extractednothing: ['Nothing to extract', 'muted'],
};

// Plain reason an item is stuck, with what to do. Returns null when it's fine.
export function unpackerrDiagnosis(item, { now = Date.now() } = {}) {
  const err = String(item.error || '');
  const age = now - Date.parse(item.updated || item.started || 0);
  const mins = Number.isFinite(age) ? Math.round(age / 60000) : 0;
  if (item.status === 'extractfailed') {
    if (/password|encrypted/i.test(err)) return { level: 'down', reason: 'The archive is password protected and none of the passwords Unpackerr knows worked.', fix: 'Add the password to Unpackerr’s passwords list, or blocklist the release and search again.' };
    if (/missing volume|continues in next volume|unexpected end|EOF/i.test(err)) return { level: 'down', reason: 'Part of the archive is missing or the download is incomplete.', fix: 'Blocklist this release and search for another, or repair it in the download client.' };
    if (/crc|checksum|corrupt|bad (archive|header)|not a valid/i.test(err)) return { level: 'down', reason: 'The archive is damaged.', fix: 'Blocklist this release and search for another.' };
    if (/no space|disk full|ENOSPC/i.test(err)) return { level: 'down', reason: 'The disk ran out of space while extracting.', fix: 'Free some space, then retry.' };
    if (/permission denied|EACCES|read-only/i.test(err)) return { level: 'down', reason: 'Unpackerr can’t write to the download folder.', fix: 'Check the folder permissions and the user Unpackerr runs as, then retry.' };
    return { level: 'down', reason: err ? `Extraction failed: ${err}` : 'Extraction failed.', fix: item.dueKind === 'retry' ? 'Unpackerr will retry on its own; you can retry now.' : 'Retry, or blocklist the release if it keeps failing.' };
  }
  if (item.status === 'extracted' && mins >= 30) return { level: 'warn', reason: `Extracted ${mins} minutes ago but the app hasn’t imported it yet.`, fix: 'Check the item in the app’s queue (often a path mapping or naming problem).' };
  if (item.status === 'extracting' && mins >= 30) return { level: 'warn', reason: `No progress for ${mins} minutes.`, fix: 'The archive may be very large or the disk slow. Check Unpackerr’s log.' };
  if (item.status === 'waiting' && item.note) return { level: 'muted', reason: `Waiting for ${item.note} to finish downloading.`, fix: '' };
  return null;
}

export function unpackerrClient(api, key) {
  const get = (p) => api.proxy(key, `api/${p}`);
  const post = (p, id) => api.proxy(key, `api/${p}`, { method: 'POST', body: { id } });
  return {
    stats: async () => (await get('stats')) || {},
    queue: async () => arr(await get('queue')),
    history: async () => arr(await get('history')),
    retry: (id) => post('queue/retry', id),
    forget: (id) => post('queue/forget', id),
    deleteHistory: (id) => post('history/delete', id),
  };
}

// ---------------------------------------------------------- Speedtest Tracker
// download/upload are bytes per second; ping is milliseconds.
export const toMbps = (bytesPerSec) => (bytesPerSec == null ? null : Math.round((Number(bytesPerSec) * 8) / 1e5) / 10);

export function normalizeSpeedtest(r) {
  return { id: r.id, at: r.created_at, ok: r.status === 'completed', status: r.status, healthy: r.healthy, down: toMbps(r.download), up: toMbps(r.upload), ping: r.ping == null ? null : Number(r.ping),
    server: r.data && r.data.server ? [r.data.server.name, r.data.server.location].filter(Boolean).join(' · ') : '', isp: (r.data && r.data.isp) || '', error: (r.data && r.data.message) || '' };
}

export function speedSummary(results) {
  const ok = results.filter((r) => r.ok && r.down != null);
  if (!ok.length) return null;
  const avg = (k) => Math.round((ok.reduce((s, r) => s + r[k], 0) / ok.length) * 10) / 10;
  const sorted = ok.map((r) => r.down).sort((a, b) => a - b);
  return { count: results.length, failed: results.filter((r) => !r.ok).length, unhealthy: ok.filter((r) => r.healthy === false).length,
    avgDown: avg('down'), avgUp: avg('up'), avgPing: avg('ping'), minDown: sorted[0], maxDown: sorted[sorted.length - 1] };
}

export function speedtestClient(api, key) {
  return {
    latest: async () => normalizeSpeedtest(await api.proxy(key, 'api/v1/results/latest')),
    results: async ({ days = 14, max = 500 } = {}) => {
      const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
      const d = await api.proxy(key, `api/v1/results?per_page=${max}&sort=-created_at&filter[start_at]=${since}`);
      // The API filters by date only, so trim to the exact window here.
      const from = Date.now() - days * 86400000;
      return arr(d && d.data).map(normalizeSpeedtest).filter((r) => Date.parse(r.at) >= from).sort((a, b) => String(a.at).localeCompare(String(b.at)));
    },
    run: () => api.proxy(key, 'api/v1/speedtests/run', { method: 'POST', body: {} }),
  };
}
