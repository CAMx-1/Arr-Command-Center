// Demo/test mocks for Portainer, Glances, Pi-hole v6, AdGuard Home, Syncthing,
// Navidrome (Subsonic API) and Pulsarr. Each checks credentials the way the
// real service does and returns the response shapes the app reads.
import express from 'express';
import crypto from 'node:crypto';
import http from 'node:http';

export const INTEGRATION_MOCK_PORTS = {
  truenas: 16443, unraid: 18088, portainer: 19443, glances: 16120, pihole: 18053, adguard: 13000, syncthing: 18384, navidrome: 14533, pulsarr: 13003, whisparr: 16969,
};
export const MOCK_KEY = 'MOCK_API_KEY';
const basic = (req) => {
  const m = /^Basic (.+)$/.exec(req.headers.authorization || '');
  if (!m) return null;
  const [u, ...p] = Buffer.from(m[1], 'base64').toString().split(':');
  return { u, p: p.join(':') };
};

// ------------------------------------------------------------------ Portainer
export function makePortainer() {
  const app = express();
  app.use(express.json());
  app.use('/api', (req, res, next) => (req.headers['x-api-key'] === MOCK_KEY ? next() : res.status(401).json({ message: 'Unauthorized', details: 'A valid authorisation token is missing' })));
  const t = Math.floor(Date.now() / 1000);
  const c = (name, image, state, status, stack, ports = []) => ({ Id: crypto.createHash('sha1').update(name).digest('hex'), Names: [`/${name}`], Image: image, State: state, Status: status, Created: t - 86400 * 3, Labels: stack ? { 'com.docker.compose.project': stack } : {}, Ports: ports.map(([pub, priv]) => ({ PublicPort: pub, PrivatePort: priv, Type: 'tcp', IP: '0.0.0.0' })) });
  const containers = {
    1: [
      c('sonarr', 'lscr.io/linuxserver/sonarr:latest', 'running', 'Up 3 days (healthy)', 'arr', [[8989, 8989]]),
      c('radarr', 'lscr.io/linuxserver/radarr:latest', 'running', 'Up 3 days (healthy)', 'arr', [[7878, 7878]]),
      c('prowlarr', 'lscr.io/linuxserver/prowlarr:latest', 'running', 'Up 3 days', 'arr', [[9696, 9696]]),
      c('qbittorrent', 'lscr.io/linuxserver/qbittorrent:latest', 'running', 'Up 2 hours (unhealthy)', 'downloads', [[8080, 8080]]),
      c('gluetun', 'qmcgaw/gluetun:latest', 'running', 'Up 2 hours (healthy)', 'downloads'),
      c('plex', 'plexinc/pms-docker:latest', 'running', 'Up 6 days', 'media', [[32400, 32400]]),
      c('tautulli', 'ghcr.io/tautulli/tautulli:latest', 'exited', 'Exited (0) 5 hours ago', 'media'),
      c('watchtower', 'containrrr/watchtower', 'running', 'Up 6 days', ''),
    ],
    2: [c('pihole', 'pihole/pihole:latest', 'running', 'Up 12 days (healthy)', 'dns', [[53, 53], [8053, 80]])],
  };
  app.get('/api/system/status', (req, res) => res.json({ Version: '2.27.1', InstanceID: 'mock-portainer' }));
  app.get('/api/endpoints', (req, res) => res.json([
    { Id: 1, Name: 'nas', Type: 1, Status: 1, Snapshots: [{ Time: t - 60, DockerVersion: '27.3.1', RunningContainerCount: 7, StoppedContainerCount: 1, HealthyContainerCount: 3, UnhealthyContainerCount: 1, VolumeCount: 14, ImageCount: 22, StackCount: 3, TotalCPU: 8, TotalMemory: 33554432000 }] },
    { Id: 2, Name: 'raspberrypi', Type: 2, Status: 1, Snapshots: [{ Time: t - 90, DockerVersion: '26.1.4', RunningContainerCount: 1, StoppedContainerCount: 0, HealthyContainerCount: 1, UnhealthyContainerCount: 0, VolumeCount: 2, ImageCount: 3, StackCount: 1, TotalCPU: 4, TotalMemory: 8254390272 }] },
  ]));
  app.get('/api/endpoints/:id/docker/containers/json', (req, res) => {
    const list = containers[req.params.id];
    if (!list) return res.status(404).json({ message: 'Environment not found' });
    res.json(req.query.all === '1' || req.query.all === 'true' ? list : list.filter((x) => x.State === 'running'));
  });
  app.get('/api/endpoints/:id/docker/containers/:cid/json', (req, res) => res.json({ Config: { Env: ['PUID=1000', 'SECRET=hunter2'] } }));
  // Docker log stream (multiplexed: 8-byte header per frame).
  app.get('/api/endpoints/:id/docker/containers/:cid/logs', (req, res) => {
    const c = (containers[req.params.id] || []).find((x) => x.Id === req.params.cid);
    if (!c) return res.status(404).json({ message: 'No such container' });
    const name = c.Names[0].slice(1);
    const lines = [[1, `2026-11-03T04:00:01Z [info] ${name} starting`], [1, `2026-11-03T04:00:02Z [info] listening on port 8080`], [2, `2026-11-03T04:10:00Z [warn] ${name}: health check took 5s`]];
    const frames = lines.map(([s, t]) => { const body = Buffer.from(`${t}\n`); const head = Buffer.alloc(8); head[0] = s; head.writeUInt32BE(body.length, 4); return Buffer.concat([head, body]); });
    res.type('application/octet-stream').send(Buffer.concat(frames));
  });
  // Docker returns 204 on success and 304 when already in that state.
  app.post('/api/endpoints/:id/docker/containers/:cid/:action', (req, res) => {
    if (!['start', 'stop', 'restart'].includes(req.params.action)) return res.status(404).json({ message: 'Not found' });
    const c = (containers[req.params.id] || []).find((x) => x.Id === req.params.cid || x.Id.startsWith(req.params.cid));
    if (!c) return res.status(404).json({ message: 'No such container' });
    const { action } = req.params;
    if ((action === 'start' && c.State === 'running') || (action === 'stop' && c.State !== 'running')) return res.status(304).end();
    if (action === 'stop') { c.State = 'exited'; c.Status = 'Exited (0) Less than a second ago'; } else { c.State = 'running'; c.Status = 'Up Less than a second'; }
    app._actions.push(`${action}:${c.Names[0].slice(1)}`);
    res.status(204).end();
  });
  app._actions = [];
  app.all('/api/{*rest}', (req, res) => res.status(req.method === 'GET' ? 404 : 204).json({}));
  return app;
}

// ------------------------------------------------------------------- Glances
export function makeGlances() {
  const app = express();
  let tick = 0;
  app.use((req, res, next) => { tick += 1; next(); });
  const j = (path, fn) => app.get(`/api/4/${path}`, (req, res) => res.json(fn()));
  j('status', () => ({ version: '4.3.1' }));
  j('version', () => '4.3.1');
  j('quicklook', () => ({ cpu: 18 + (tick % 7) * 3.1, mem: 61.4, swap: 4.2, cpu_name: 'Intel(R) Celeron(R) N5105 @ 2.00GHz', cpu_hz_current: 2000000000 }));
  j('load', () => ({ min1: 0.84, min5: 0.71, min15: 0.66, cpucore: 4 }));
  j('uptime', () => '12 days, 4:13:51');
  j('system', () => ({ hostname: 'nas', os_name: 'Linux', linux_distro: 'Debian GNU/Linux 12', os_version: '6.1.0-26-amd64', platform: '64bit' }));
  j('fs', () => [
    { device_name: '/dev/nvme0n1p2', fs_type: 'ext4', mnt_point: '/', size: 248000000000, used: 91000000000, free: 157000000000, percent: 36.7 },
    { device_name: '/dev/md0', fs_type: 'btrfs', mnt_point: '/mnt/media', size: 16000000000000, used: 13900000000000, free: 2100000000000, percent: 86.9 },
  ]);
  j('sensors', () => [
    { label: 'Package id 0', value: 54, warning: 80, critical: 100, unit: 'C', type: 'temperature_core', key: 'label' },
    { label: 'Core 0', value: 52, warning: 80, critical: 100, unit: 'C', type: 'temperature_core', key: 'label' },
    { label: 'Core 1', value: 55, warning: 80, critical: 100, unit: 'C', type: 'temperature_core', key: 'label' },
    { label: 'Composite', value: 41, warning: 80, critical: 85, unit: 'C', type: 'temperature_core', key: 'label' },
    { label: 'nct6775 fan1', value: 920, unit: 'R', type: 'fan_speed', key: 'label' },
  ]);
  j('containers', () => [
    { name: 'plex', status: 'running', cpu_percent: 12.4, memory_usage: 1288490188, engine: 'docker' },
    { name: 'sonarr', status: 'running', cpu_percent: 0.6, memory_usage: 312475648, engine: 'docker' },
    { name: 'tautulli', status: 'exited', cpu_percent: 0, memory_usage: 0, engine: 'docker' },
  ]);
  return app;
}

// ------------------------------------------------------------------- Pi-hole v6
export function makePihole({ password = 'mock-pihole' } = {}) {
  const app = express();
  app.use(express.json());
  const sessions = new Set();
  let blocking = { blocking: 'enabled', timer: null };
  let until = 0;
  app.post('/api/auth', (req, res) => {
    if (!password) return res.json({ session: { valid: true, totp: false, sid: null, validity: -1 } });
    if (!req.body || req.body.password !== password) return res.status(401).json({ session: { valid: false, sid: null, message: 'password incorrect' } });
    const sid = crypto.randomBytes(12).toString('base64url');
    sessions.add(sid);
    res.json({ session: { valid: true, totp: false, sid, validity: 1800 } });
  });
  app.use('/api', (req, res, next) => (!password || sessions.has(req.headers['x-ftl-sid']) ? next() : res.status(401).json({ error: { key: 'unauthorized', message: 'Unauthorized' } })));
  app.get('/api/info/version', (req, res) => res.json({ version: { core: { local: { version: 'v6.1.4' } }, web: { local: { version: 'v6.2.1' } }, ftl: { local: { version: 'v6.2.3' } } } }));
  app.get('/api/stats/summary', (req, res) => res.json({ queries: { total: 48213, blocked: 7412, percent_blocked: 15.37, cached: 21004, forwarded: 19797 }, clients: { active: 23, total: 31 }, gravity: { domains_being_blocked: 1204883 } }));
  app.get('/api/stats/top_domains', (req, res) => res.json({ domains: req.query.blocked === 'true'
    ? [{ domain: 'telemetry.example-tv.com', count: 1904 }, { domain: 'ads.doubleclick.net', count: 1210 }, { domain: 'graph.facebook.com', count: 733 }]
    : [{ domain: 'plex.direct', count: 5022 }] }));
  app.get('/api/stats/top_clients', (req, res) => res.json({ clients: [{ name: 'living-room-tv', ip: '192.168.1.40', count: 9123 }, { name: 'nas', ip: '192.168.1.10', count: 7310 }, { name: '', ip: '192.168.1.77', count: 2011 }] }));
  app.get('/api/dns/blocking', (req, res) => {
    if (until && Date.now() >= until) { blocking = { blocking: 'enabled', timer: null }; until = 0; }
    res.json({ ...blocking, timer: until ? Math.round((until - Date.now()) / 1000) : null });
  });
  app.post('/api/dns/blocking', (req, res) => {
    const on = !!(req.body && req.body.blocking);
    const timer = req.body && req.body.timer ? Number(req.body.timer) : null;
    blocking = { blocking: on ? 'enabled' : 'disabled', timer };
    until = !on && timer ? Date.now() + timer * 1000 : 0;
    res.json({ ...blocking });
  });
  app._sessions = sessions;
  return app;
}

// --------------------------------------------------------------- AdGuard Home
export function makeAdguard({ username = 'admin', password = 'mock-adguard' } = {}) {
  const app = express();
  app.use(express.json());
  app.use('/control', (req, res, next) => { const b = basic(req); return b && b.u === username && b.p === password ? next() : res.status(401).send('Unauthorized'); });
  let protection = true;
  let until = null;
  app.get('/control/status', (req, res) => {
    if (until && Date.now() >= Date.parse(until)) { protection = true; until = null; }
    res.json({ version: 'v0.107.57', running: true, protection_enabled: protection, protection_disabled_until: until, dns_addresses: ['192.168.1.2'], dns_port: 53, http_port: 3000 });
  });
  app.get('/control/stats', (req, res) => res.json({ num_dns_queries: 61022, num_blocked_filtering: 9511, avg_processing_time: 0.0182, top_blocked_domains: [{ 'app-measurement.com': 2100 }, { 'ads.example.net': 1500 }], top_clients: [{ '192.168.1.40': 20111 }, { '192.168.1.10': 9077 }] }));
  app.post('/control/protection', (req, res) => {
    protection = !!(req.body && req.body.enabled);
    until = !protection && req.body.duration ? new Date(Date.now() + Number(req.body.duration)).toISOString() : null;
    res.json({});
  });
  return app;
}

// ------------------------------------------------------------------ Syncthing
export function makeSyncthing() {
  const app = express();
  app.use('/rest', (req, res, next) => (req.headers['x-api-key'] === MOCK_KEY ? next() : res.status(403).send('CSRF Error')));
  const me = 'AAAAAAA-BBBBBBB-CCCCCCC-DDDDDDD-EEEEEEE-FFFFFFF-GGGGGGG-HHHHHHH';
  const phone = 'PHONE01-AAAAAAA-BBBBBBB-CCCCCCC-DDDDDDD-EEEEEEE-FFFFFFF-GGGGGGG';
  const laptop = 'LAPTOP1-AAAAAAA-BBBBBBB-CCCCCCC-DDDDDDD-EEEEEEE-FFFFFFF-GGGGGGG';
  const scans = [];
  app.get('/rest/system/version', (req, res) => res.json({ version: 'v1.29.2', os: 'linux', arch: 'amd64' }));
  app.get('/rest/system/status', (req, res) => res.json({ myID: me, uptime: 433200 }));
  app.get('/rest/config/folders', (req, res) => res.json([
    { id: 'photos', label: 'Phone photos', path: '/data/photos', paused: false, devices: [{ deviceID: me }, { deviceID: phone }] },
    { id: 'docs', label: 'Documents', path: '/data/docs', paused: false, devices: [{ deviceID: me }, { deviceID: laptop }, { deviceID: phone }] },
    { id: 'old', label: 'Archive', path: '/data/archive', paused: true, devices: [{ deviceID: me }] },
  ]));
  app.get('/rest/config/devices', (req, res) => res.json([{ deviceID: me, name: 'nas' }, { deviceID: phone, name: 'Pixel', paused: false }, { deviceID: laptop, name: 'MacBook', paused: false }]));
  app.get('/rest/system/connections', (req, res) => res.json({ total: { inBytesTotal: 52428800000, outBytesTotal: 1073741824 }, connections: { [phone]: { connected: true, address: '192.168.1.55:22000', inBytesTotal: 52000000000, outBytesTotal: 900000000, clientVersion: 'v1.29.2' }, [laptop]: { connected: false, address: '', inBytesTotal: 0, outBytesTotal: 0 } } }));
  app.get('/rest/db/status', (req, res) => res.json({
    photos: { state: 'syncing', globalBytes: 64424509440, needBytes: 2147483648, needFiles: 312 },
    docs: { state: 'idle', globalBytes: 3221225472, needBytes: 0, needFiles: 0 },
    old: { state: 'idle', globalBytes: 1073741824, needBytes: 0, needFiles: 0 },
  }[req.query.folder] || { error: 'no such folder' }));
  app.post('/rest/db/scan', (req, res) => { scans.push(req.query.folder); res.json({}); });
  app._scans = scans;
  return app;
}

// ------------------------------------------------------------------ Navidrome
export function makeNavidrome({ username = 'admin', password = 'mock-navidrome' } = {}) {
  const app = express();
  let scanning = false;
  const ok = (body = {}) => ({ 'subsonic-response': { status: 'ok', version: '1.16.1', type: 'navidrome', serverVersion: '0.55.2', openSubsonic: true, ...body } });
  app.use('/rest', (req, res, next) => {
    const { u, t, s } = req.query;
    const good = u === username && s && t === crypto.createHash('md5').update(`${password}${s}`).digest('hex');
    if (!good) return res.json({ 'subsonic-response': { status: 'failed', version: '1.16.1', error: { code: 40, message: 'Wrong username or password' } } });
    if (req.query.f !== 'json') return res.status(400).send('xml not mocked');
    next();
  });
  const view = (name, fn) => app.get([`/rest/${name}`, `/rest/${name}.view`], (req, res) => res.json(fn(req)));
  view('ping', () => ok());
  view('getScanStatus', () => ok({ scanStatus: { scanning, count: 18342, folderCount: 1120, lastScan: new Date(Date.now() - 3 * 3600000).toISOString() } }));
  view('startScan', () => { scanning = true; setTimeout(() => { scanning = false; }, 2000).unref?.(); return ok({ scanStatus: { scanning: true, count: 18342 } }); });
  // Includes a credited-only person with albumCount 0 (Dashboarr #473).
  view('getArtists', () => ok({ artists: { index: [
    { name: 'L', artist: [{ id: 'a1', name: 'Linkin Park', albumCount: 7 }, { id: 'a2', name: 'Lorde', albumCount: 3 }] },
    { name: 'M', artist: [{ id: 'a3', name: 'Mike Shinoda', albumCount: 0 }, { id: 'a4', name: 'Massive Attack', albumCount: 5 }] },
  ] } }));
  view('getAlbumList2', () => ok({ albumList2: { album: [
    { id: 'al1', name: 'From Zero', artist: 'Linkin Park', year: 2024, coverArt: 'al-al1', created: new Date(Date.now() - 86400000).toISOString() },
    { id: 'al2', name: 'Virgin', artist: 'Lorde', year: 2025, coverArt: 'al-al2', created: new Date(Date.now() - 3 * 86400000).toISOString() },
  ] } }));
  view('getNowPlaying', () => ok({ nowPlaying: { entry: [{ id: 's1', title: 'The Emptiness Machine', artist: 'Linkin Park', album: 'From Zero', username: 'cameron', playerName: 'Symfonium', minutesAgo: 0, coverArt: 'al-al1' }] } }));
  view('getCoverArt', () => ok());
  return app;
}

// -------------------------------------------------------------------- Pulsarr
export function makePulsarr() {
  const app = express();
  app.use(express.json());
  app.get('/health', (req, res) => res.json({ status: 'ok' }));
  app.use('/v1', (req, res, next) => (req.headers['x-api-key'] === MOCK_KEY ? next() : res.status(401).json({ statusCode: 401, error: 'Unauthorized', message: 'Authentication required' })));
  const now = Date.now();
  let requests = [
    { id: 11, userId: 2, userName: 'kid', contentType: 'movie', contentTitle: 'Inside Out 2', contentKey: 'plex://movie/1', contentGuids: ['tmdb:1022789'], thumb: null, status: 'pending', approvalReason: 'Quota exceeded (5/5 this week)', createdAt: new Date(now - 3600000).toISOString(), expirationDisplayText: 'Expires in 6 days' },
    { id: 12, userId: 3, userName: 'friend', contentType: 'show', contentTitle: 'Shōgun', contentKey: 'plex://show/2', contentGuids: ['tvdb:392573'], thumb: null, status: 'pending', approvalReason: 'Router rule: needs approval for 4K', createdAt: new Date(now - 7200000).toISOString() },
  ];
  const stats = { pending: 2, approved: 41, rejected: 3, expired: 1, auto_approved: 118 };
  app.get('/v1/approval/stats', (req, res) => res.json({ success: true, message: 'ok', stats: { ...stats, pending: requests.filter((r) => r.status === 'pending').length, totalRequests: 165 } }));
  app.get('/v1/approval/requests', (req, res) => { const list = requests.filter((r) => !req.query.status || r.status === req.query.status); res.json({ success: true, message: 'ok', approvalRequests: list, total: list.length }); });
  const decide = (status) => (req, res) => {
    const r = requests.find((x) => x.id === Number(req.params.id));
    if (!r) return res.status(404).json({ success: false, message: 'Not found' });
    if (r.status !== 'pending') return res.status(409).json({ success: false, message: `Already ${r.status}` });
    r.status = status;
    stats[status] += 1;
    res.json({ success: true, message: `Request ${status}` });
  };
  app.post('/v1/approval/requests/:id/approve', decide('approved'));
  app.post('/v1/approval/requests/:id/reject', decide('rejected'));
  app.get('/v1/stats/recent-requests', (req, res) => res.json({ success: true, items: [
    ...requests.filter((r) => r.status === 'pending').map((r) => ({ id: r.id, source: 'approval', title: r.contentTitle, key: r.contentKey, contentType: r.contentType, guids: r.contentGuids, thumb: null, status: 'pending_approval', userId: r.userId, userName: r.userName, createdAt: r.createdAt })),
    { id: 201, source: 'watchlist', title: 'Andor', key: 'plex://show/9', contentType: 'show', guids: [], thumb: null, status: 'notified', userId: 1, userName: 'cameron', createdAt: new Date(now - 86400000).toISOString() },
    { id: 202, source: 'watchlist', title: 'Wicked', key: 'plex://movie/8', contentType: 'movie', guids: [], thumb: null, status: 'grabbed', userId: 3, userName: 'friend', createdAt: new Date(now - 2 * 86400000).toISOString() },
  ].slice(0, Number(req.query.limit) || 10) }));
  return app;
}

// -------------------------------------------------------------------- Unraid
export function makeUnraid() {
  const app = express();
  app.use(express.json());
  app.post('/graphql', (req, res) => {
    if (req.headers['x-api-key'] !== MOCK_KEY) return res.status(401).json({ errors: [{ message: 'Unauthorized: invalid API key' }] });
    const q = String((req.body && req.body.query) || '');
    if (/\bmutation\b/.test(q)) return res.json({ errors: [{ message: 'mock: mutations are not expected' }] });
    const TB = 1e9; // KiB per ~1 TiB, near enough for a demo
    const disk = (name, device, sizeTB, usedPct, temp, extra = {}) => ({ name, device, size: Math.round(sizeTB * TB), status: 'DISK_OK', temp, numErrors: 0, rotational: true, fsSize: Math.round(sizeTB * TB), fsUsed: Math.round(sizeTB * TB * usedPct), fsFree: Math.round(sizeTB * TB * (1 - usedPct)), ...extra });
    res.json({ data: {
      online: true,
      info: { os: { hostname: 'tower', uptime: new Date(Date.now() - 9 * 86400000).toISOString() }, versions: { core: { unraid: '7.2.3' } } },
      metrics: { cpu: { percentTotal: 14.2 }, memory: { total: 34359738368, used: 17179869184, percentTotal: 50 } },
      array: {
        state: 'STARTED',
        capacity: { kilobytes: { total: String(36 * TB), used: String(27.4 * TB), free: String(8.6 * TB) } },
        parityCheckStatus: { status: 'COMPLETED', running: false, paused: false, progress: 100, errors: 0, date: new Date(Date.now() - 6 * 86400000).toISOString(), speed: '182 MB/s' },
        parities: [{ name: 'parity', device: 'sdb', size: 18 * TB, status: 'DISK_OK', temp: 36, numErrors: 0, rotational: true }],
        disks: [disk('disk1', 'sdc', 18, 0.81, 35), disk('disk2', 'sdd', 18, 0.71, null), { ...disk('disk3', 'sde', 12, 0.2, null), status: 'DISK_DSBL', numErrors: 128 }],
        caches: [{ ...disk('cache', 'nvme0n1', 1, 0.42, 44), rotational: false }],
      },
      docker: { containers: [
        { id: 'c1', names: ['/plex'], image: 'plexinc/pms-docker', state: 'RUNNING', status: 'Up 9 days', autoStart: true, isUpdateAvailable: false },
        { id: 'c2', names: ['/sonarr'], image: 'lscr.io/linuxserver/sonarr', state: 'RUNNING', status: 'Up 9 days', autoStart: true, isUpdateAvailable: true },
        { id: 'c3', names: ['/handbrake'], image: 'jlesage/handbrake', state: 'EXITED', status: 'Exited (0) 2 days ago', autoStart: false, isUpdateAvailable: false },
      ] },
      vms: { domains: [{ id: 'v1', name: 'Windows 11', state: 'SHUTOFF' }, { id: 'v2', name: 'Home Assistant', state: 'RUNNING' }] },
      notifications: { overview: { unread: { info: 3, warning: 1, alert: 1, total: 5 } } },
    } });
  });
  return app;
}

// ------------------------------------------------------------------- TrueNAS
// A tiny WebSocket JSON-RPC server (RFC 6455 text frames only) so the demo
// and tests don't need a WebSocket library.
export function makeTruenasServer({ apiKey = MOCK_KEY } = {}) {
  const server = http.createServer((req, res) => { res.statusCode = 426; res.end('Upgrade Required'); });
  const calls = [];
  server.calls = calls;
  server.on('upgrade', (req, socket) => {
    if (req.url !== '/api/current') { socket.end('HTTP/1.1 404 Not Found\r\n\r\n'); return; }
    const accept = crypto.createHash('sha1').update(`${req.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    let authed = false;
    let buf = Buffer.alloc(0);
    const send = (obj) => {
      const data = Buffer.from(JSON.stringify(obj));
      const head = data.length < 126 ? Buffer.from([0x81, data.length])
        : data.length < 65536 ? Buffer.from([0x81, 126, data.length >> 8, data.length & 255])
          : (() => { const b = Buffer.alloc(10); b[0] = 0x81; b[1] = 127; b.writeBigUInt64BE(BigInt(data.length), 2); return b; })();
      socket.write(Buffer.concat([head, data]));
    };
    const handle = (msg) => {
      const { id, method, params = [] } = msg;
      calls.push(method);
      const ok = (result) => send({ jsonrpc: '2.0', id, result });
      if (method === 'auth.login_with_api_key') { authed = params[0] === apiKey; return ok(authed); }
      if (!authed) return send({ jsonrpc: '2.0', id, error: { code: -32001, message: 'Not authenticated' } });
      const TB = 1099511627776;
      const results = {
        'system.info': { version: '25.10.1', hostname: 'truenas', uptime_seconds: 1209600, physmem: 68719476736, cores: 8, loadavg: [0.41, 0.52, 0.48] },
        'pool.query': [
          { name: 'tank', status: 'ONLINE', healthy: true, size: 40 * TB, allocated: 31 * TB, free: 9 * TB, scan: { function: 'SCRUB', state: 'FINISHED', percentage: 100, errors: 0 } },
          { name: 'fast', status: 'DEGRADED', healthy: false, size: 2 * TB, allocated: 0.6 * TB, free: 1.4 * TB, scan: null },
        ],
        'disk.query': [
          { name: 'sda', model: 'WDC WD200EDGZ', serial: 'WD-1', size: 20 * TB, type: 'HDD', pool: 'tank' },
          { name: 'sdb', model: 'WDC WD200EDGZ', serial: 'WD-2', size: 20 * TB, type: 'HDD', pool: 'tank' },
          { name: 'nvme0n1', model: 'Samsung 990 PRO', serial: 'S-1', size: 2 * TB, type: 'SSD', pool: 'fast' },
          { name: 'sdc', model: 'Spare', serial: 'SP-1', size: 20 * TB, type: 'HDD', pool: null },
        ],
        'disk.temperatures': { sda: 37, sdb: 39, nvme0n1: 58, sdc: null },
        'app.query': [
          { name: 'jellyfin', state: 'RUNNING', human_version: '10.11.2_1.2.3', upgrade_available: true },
          { name: 'nextcloud', state: 'STOPPED', human_version: '31.0.1_2.0.0', upgrade_available: false },
          { name: 'immich', state: 'CRASHED', human_version: '1.120.0_1.0.0', upgrade_available: false },
        ],
        'alert.list': [
          { level: 'CRITICAL', formatted: 'Pool <b>fast</b> state is DEGRADED: One or more devices has been removed.', dismissed: false },
          { level: 'INFO', formatted: 'Old alert', dismissed: true },
        ],
      };
      if (method in results) return ok(results[method]);
      send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method ${method} not found` } });
    };
    socket.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      while (buf.length >= 2) {
        const op = buf[0] & 0x0f;
        let len = buf[1] & 0x7f; let off = 2;
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
        else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
        const masked = (buf[1] & 0x80) !== 0;
        const total = off + (masked ? 4 : 0) + len;
        if (buf.length < total) return;
        const mask = masked ? buf.subarray(off, off + 4) : null;
        const payload = Buffer.from(buf.subarray(off + (masked ? 4 : 0), total));
        if (mask) for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i % 4];
        buf = buf.subarray(total);
        if (op === 0x8) { socket.end(Buffer.from([0x88, 0])); return; }
        if (op === 0x1) { try { handle(JSON.parse(payload.toString())); } catch { /* ignore */ } }
      }
    });
    socket.on('error', () => {});
  });
  return server;
}
