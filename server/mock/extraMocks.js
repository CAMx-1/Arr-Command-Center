// Demo-mode mocks for Autobrr, Maintainerr, Tdarr, Audiobookshelf and Flood.
// Response shapes follow each project's source (see the integration docs in
// README); every mock enforces the same auth the real service uses so the
// proxy's credential injection is exercised end-to-end.
import express from 'express';

const now = () => Date.now();
const iso = (msAgo) => new Date(now() - msAgo).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function coverSvg(label, hue) {
  const safe = String(label).replace(/[<>&"]/g, '');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><rect width="100%" height="100%" fill="hsl(${hue} 45% 32%)"/><text x="50%" y="52%" fill="white" font-family="sans-serif" font-size="22" text-anchor="middle">${safe}</text></svg>`;
}

// ---------------- Autobrr ----------------
export function makeAutobrr({ apiKey = 'MOCK_API_KEY' } = {}) {
  const app = express();
  app.use(express.json());
  app.get('/api/healthz/liveness', (req, res) => res.type('text/plain').send('OK'));
  app.use('/api', (req, res, next) => {
    const key = req.headers['x-api-token'] || req.query.apikey;
    if (key !== apiKey) return res.status(key ? 401 : 403).json({ message: 'unauthorized', status: key ? 401 : 403 });
    next();
  });
  const filters = [
    { id: 1, name: 'TV – 1080p WEB', enabled: true, priority: 10, indexers: [{ id: 1, name: 'TorrentLeech' }], actions_count: 1, created_at: iso(90 * DAY), updated_at: iso(2 * DAY) },
    { id: 2, name: 'Movies – 2160p Remux', enabled: true, priority: 5, indexers: [{ id: 2, name: 'BeyondHD' }], actions_count: 2, created_at: iso(60 * DAY), updated_at: iso(5 * DAY) },
    { id: 3, name: 'Freeleech ratio builder', enabled: false, priority: 1, indexers: [{ id: 1, name: 'TorrentLeech' }, { id: 3, name: 'IPTorrents' }], actions_count: 1, created_at: iso(30 * DAY), updated_at: iso(1 * DAY) },
  ];
  const idx = (id, name) => ({ id, name, identifier: name.toLowerCase().replace(/\s+/g, ''), identifier_external: name });
  const action = (id, status, client, filter, filterId, rejections = []) => ({ id, status, action: `${client} push`, action_id: id, type: client === 'Sonarr' || client === 'Radarr' ? client.toUpperCase() : 'QBITTORRENT', client, filter, filter_id: filterId, rejections, timestamp: iso(id * 7 * MIN) });
  const releases = [
    { id: 1, filter_status: 'FILTER_APPROVED', rejections: [], indexer: idx(1, 'TorrentLeech'), filter: 'TV – 1080p WEB', protocol: 'torrent', implementation: 'IRC', timestamp: iso(4 * MIN), name: 'The.Bear.S03E06.1080p.WEB.h264-ETHEL', title: 'The Bear', size: 1932735283, resolution: '1080p', source: 'WEB', group: 'ETHEL', action_status: [action(1, 'PUSH_APPROVED', 'Sonarr', 'TV – 1080p WEB', 1)] },
    { id: 2, filter_status: 'FILTER_APPROVED', rejections: [], indexer: idx(2, 'BeyondHD'), filter: 'Movies – 2160p Remux', protocol: 'torrent', implementation: 'IRC', timestamp: iso(38 * MIN), name: 'Furiosa.2024.2160p.UHD.BluRay.REMUX.HDR.HEVC.Atmos-FGT', title: 'Furiosa', size: 64424509440, resolution: '2160p', source: 'UHD.BluRay', group: 'FGT', action_status: [action(2, 'PUSH_REJECTED', 'Radarr', 'Movies – 2160p Remux', 2, ['Existing file meets cutoff'])] },
    { id: 3, filter_status: 'FILTER_APPROVED', rejections: [], indexer: idx(1, 'TorrentLeech'), filter: 'TV – 1080p WEB', protocol: 'torrent', implementation: 'IRC', timestamp: iso(2 * HOUR), name: 'Severance.S02E10.1080p.ATVP.WEB-DL.DDP5.1.H.264-NTb', title: 'Severance', size: 2254857830, resolution: '1080p', source: 'WEB-DL', group: 'NTb', action_status: [action(3, 'PUSH_ERROR', 'Sonarr', 'TV – 1080p WEB', 1, ['connection refused'])] },
    { id: 4, filter_status: 'FILTER_APPROVED', rejections: [], indexer: idx(3, 'IPTorrents'), filter: 'Freeleech ratio builder', protocol: 'torrent', implementation: 'IRC', timestamp: iso(5 * HOUR), name: 'Linux.Distro.Collection.2026-GROUP', title: 'Linux Distro Collection', size: 8589934592, resolution: '', source: '', group: 'GROUP', action_status: [action(4, 'PUSH_APPROVED', 'qBittorrent', 'Freeleech ratio builder', 3)] },
  ];
  app.get('/api/config', (req, res) => res.json({ application: 'autobrr', version: 'v1.87.0', commit: 'mock', date: iso(5 * DAY), host: '0.0.0.0', port: 7474, base_url: '/', check_for_updates: true }));
  app.get('/api/release', (req, res) => {
    const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 20));
    const status = req.query.push_status;
    const data = releases.filter((r) => !status || r.action_status.some((a) => a.status === status)).slice(0, limit);
    res.json({ data, count: data.length, next_cursor: 0 });
  });
  app.get('/api/release/stats', (req, res) => res.json({ total_count: 1284, filtered_count: 212, filter_rejected_count: 1072, push_approved_count: 164, push_rejected_count: 41, push_error_count: 7 }));
  app.get('/api/filters', (req, res) => res.json(filters));
  app.put('/api/filters/:id/enabled', (req, res) => {
    const f = filters.find((x) => x.id === Number(req.params.id));
    if (!f) return res.status(404).json({ message: 'filter not found' });
    if (typeof req.body?.enabled !== 'boolean') return res.status(400).json({ message: 'enabled must be a boolean' });
    f.enabled = req.body.enabled; f.updated_at = new Date().toISOString();
    res.status(204).end();
  });
  app.get('/api/irc', (req, res) => res.json([
    { id: 1, name: 'TorrentLeech', enabled: true, server: 'irc.torrentleech.org', port: 7021, tls: true, nick: 'acc_demo', connected: true, connected_since: iso(3 * DAY), healthy: true, connection_errors: [], channels: [{ id: 1, name: '#tlannounces', enabled: true, monitoring: true, monitoring_since: iso(3 * DAY), last_announce: iso(4 * MIN), connection_errors: [] }] },
    { id: 2, name: 'BeyondHD', enabled: true, server: 'irc.beyond-hd.me', port: 6697, tls: true, nick: 'acc_demo', connected: false, connected_since: null, healthy: false, connection_errors: ['dial tcp: i/o timeout'], channels: [{ id: 2, name: '#bhd_announce', enabled: true, monitoring: false, last_announce: iso(9 * HOUR), connection_errors: [] }] },
  ]));
  return app;
}

// ---------------- Maintainerr (no API auth) ----------------
export function makeMaintainerr() {
  const app = express();
  app.use(express.json());
  const collections = [
    { id: 1, title: 'Leaving soon – unwatched movies', description: 'Movies nobody has watched in 6 months', isActive: true, arrAction: 0, deleteAfterDays: 30, type: 'movie', addDate: iso(120 * DAY), libraryId: '1', mediaServerType: 'plex', handledMediaAmount: 18, totalSizeBytes: 214748364800, handledMediaSizeBytes: 322122547200 },
    { id: 2, title: 'Ended shows – fully watched', description: 'Ended series everyone has finished', isActive: true, arrAction: 0, deleteAfterDays: 14, type: 'show', addDate: iso(60 * DAY), libraryId: '2', mediaServerType: 'plex', handledMediaAmount: 4, totalSizeBytes: 96636764160, handledMediaSizeBytes: 150323855360 },
    { id: 3, title: 'Low-rated requests', description: 'Paused while reviewing rules', isActive: false, arrAction: 1, deleteAfterDays: 7, type: 'movie', addDate: iso(20 * DAY), libraryId: '1', mediaServerType: 'plex', handledMediaAmount: 0, totalSizeBytes: 0, handledMediaSizeBytes: 0 },
  ];
  let media = {
    1: [
      { id: 11, collectionId: 1, mediaServerId: '48213', tmdbId: 438631, addDate: iso(27 * DAY), sizeBytes: 64424509440, image_path: '', mediaData: { title: 'Dune', type: 'movie', addedAt: iso(400 * DAY) } },
      { id: 12, collectionId: 1, mediaServerId: '48214', tmdbId: 346698, addDate: iso(20 * DAY), sizeBytes: 21474836480, image_path: '', mediaData: { title: 'Barbie', type: 'movie', addedAt: iso(500 * DAY) } },
      { id: 13, collectionId: 1, mediaServerId: '48215', tmdbId: 505642, addDate: iso(3 * DAY), sizeBytes: 32212254720, image_path: '', mediaData: { title: 'Black Panther: Wakanda Forever', type: 'movie', addedAt: iso(700 * DAY) } },
    ],
    2: [
      { id: 21, collectionId: 2, mediaServerId: '51002', tmdbId: 1399, tvdbId: 121361, addDate: iso(12 * DAY), sizeBytes: 96636764160, image_path: '', mediaData: { title: 'Game of Thrones', type: 'show', addedAt: iso(900 * DAY) } },
    ],
    3: [],
  };
  const exclusions = [];
  let running = false;
  app.get('/api/app/status', (req, res) => res.json(JSON.stringify({ status: 1, version: '3.29.0', commitTag: '', updateAvailable: false })));
  app.get('/api/collections', (req, res) => res.json(collections));
  app.get('/api/collections/media/count', (req, res) => {
    const id = Number(req.query.collectionId);
    res.json(id ? (media[id] || []).length : Object.values(media).reduce((n, list) => n + list.length, 0));
  });
  app.get('/api/collections/media/:id/content/:page', (req, res) => {
    const list = media[Number(req.params.id)] || [];
    const size = Number(req.query.size) || 25;
    const page = Math.max(1, Number(req.params.page) || 1);
    res.json({ totalSize: list.length, items: list.slice((page - 1) * size, page * size) });
  });
  app.get(['/api/collections/activate/:id', '/api/collections/deactivate/:id'], (req, res) => {
    const c = collections.find((x) => x.id === Number(req.params.id));
    if (!c) return res.status(404).json({ message: 'Collection not found' });
    c.isActive = req.path.includes('/activate/');
    res.json(c);
  });
  app.get('/api/rules', (req, res) => res.json(collections.map((c) => ({ id: c.id, name: c.title, description: c.description, libraryId: c.libraryId, isActive: c.isActive, dataType: c.type, collection: { id: c.id }, rules: [] }))));
  app.get('/api/rules/execute/status', (req, res) => res.json({ processingQueue: running, executingRuleGroupId: running ? 1 : null }));
  app.post('/api/rules/execute', (req, res) => {
    if (running) return res.status(409).json({ message: 'Rules are already running' });
    running = true; setTimeout(() => { running = false; }, 1500);
    res.json({ code: 1, result: 'Success' });
  });
  app.post('/api/rules/exclusion', (req, res) => {
    const { mediaId, collectionId, action = 0 } = req.body || {};
    if (!mediaId) return res.status(400).json({ message: 'mediaId is required' });
    if (action === 0) {
      exclusions.push({ mediaServerId: String(mediaId), collectionId });
      for (const key of Object.keys(media)) media[key] = media[key].filter((m) => m.mediaServerId !== String(mediaId) || (collectionId && Number(key) !== Number(collectionId)));
    }
    res.json({ code: 1, result: 'Success' });
  });
  app.get('/api/rules/exclusion', (req, res) => res.json(exclusions));
  return app;
}

// ---------------- Tdarr (optional x-api-key) ----------------
export function makeTdarr({ apiKey = 'MOCK_API_KEY' } = {}) {
  const app = express();
  app.use(express.json());
  app.use('/api/v2', (req, res, next) => {
    if (apiKey && req.headers['x-api-key'] !== apiKey) return res.status(403).json({ status: 403, message: 'No auth token or API key provided' });
    next();
  });
  const started = now();
  app.get('/api/v2/status', (req, res) => res.json({ status: 'good', isProduction: true, os: 'linux', version: '2.49.01', uptime: Math.round((now() - started) / 1000) }));
  app.post('/api/v2/is-server-alive', (req, res) => res.json({ status: 'good' }));
  app.post('/api/v2/stats/get-pies', (req, res) => res.json({ pieStats: {
    totalFiles: 4812, totalTranscodeCount: 1937, totalHealthCheckCount: 4650, sizeDiff: 1843.6,
    status: {
      transcode: [{ name: 'Transcode success', value: 1911 }, { name: 'Transcode error', value: 26 }, { name: 'Not required', value: 2702 }, { name: 'Queued', value: 173 }],
      healthcheck: [{ name: 'Success', value: 4631 }, { name: 'Error', value: 19 }, { name: 'Queued', value: 162 }],
    },
    video: { codecs: [{ name: 'hevc', value: 3120 }, { name: 'h264', value: 1604 }, { name: 'av1', value: 88 }], containers: [{ name: 'mkv', value: 4410 }, { name: 'mp4', value: 402 }], resolutions: [{ name: '1080p', value: 3302 }, { name: '4KUHD', value: 811 }, { name: '720p', value: 699 }] },
    audio: { codecs: [{ name: 'eac3', value: 2011 }, { name: 'aac', value: 1780 }], containers: [] },
  } }));
  const worker = (id, file, percentage, type, fps) => ({ _id: id, file, fps, percentage, ETA: `00:${String(Math.max(1, Math.round((100 - percentage) / 4))).padStart(2, '0')}:12`, job: { type }, status: 'Processing', lastPluginDetails: { number: '3' }, originalfileSizeInGbytes: 8.4, estSize: 3.1, outputFileSizeInGbytes: 3.1 * (percentage / 100), workerType: type === 'transcode' ? 'transcodegpu' : 'healthcheckcpu' });
  app.get('/api/v2/get-nodes', (req, res) => {
    const drift = ((now() - started) / 1000) % 60;
    res.json({
      node1: { _id: 'node1', nodeName: 'tower-gpu', nodePaused: false, workers: {
        w1: worker('w1', '/media/tv/The Bear/Season 03/The Bear - S03E05 - Children.mkv', Math.min(99, 42 + drift), 'transcode', 184),
        w2: worker('w2', '/media/movies/Dune Part Two (2024)/Dune Part Two (2024).mkv', Math.min(99, 11 + drift / 2), 'transcode', 96),
      } },
      node2: { _id: 'node2', nodeName: 'nas-cpu', nodePaused: false, workers: {
        w3: worker('w3', '/media/movies/Oppenheimer (2023)/Oppenheimer (2023).mkv', Math.min(99, 70 + drift / 3), 'healthcheck', 612),
      } },
    });
  });
  const queued = [
    { _id: 'q1', file: '/media/tv/Severance/Season 02/Severance - S02E09.mkv', file_size: 2154.2, container: 'mkv', video_codec_name: 'h264', video_resolution: '1080p', HealthCheck: 'Queued', TranscodeDecisionMaker: 'Queued' },
    { _id: 'q2', file: '/media/tv/Severance/Season 02/Severance - S02E10.mkv', file_size: 2302.8, container: 'mkv', video_codec_name: 'h264', video_resolution: '1080p', HealthCheck: 'Queued', TranscodeDecisionMaker: 'Queued' },
    { _id: 'q3', file: '/media/movies/Furiosa (2024)/Furiosa (2024).mkv', file_size: 31022.1, container: 'mkv', video_codec_name: 'h264', video_resolution: '4KUHD', HealthCheck: 'Success', TranscodeDecisionMaker: 'Queued' },
  ];
  const errored = [
    { _id: 'e1', file: '/media/movies/Tenet (2020)/Tenet (2020).mkv', file_size: 48220.4, container: 'mkv', video_codec_name: 'hevc', video_resolution: '4KUHD', HealthCheck: 'Success', TranscodeDecisionMaker: 'Transcode error' },
  ];
  app.post('/api/v2/client/status-tables', (req, res) => {
    const { start = 0, pageSize = 20, opts = {} } = req.body?.data || {};
    const table = opts.table === 'table3' ? errored : opts.table === 'table1' ? queued : [];
    res.json({ totalCount: table.length, array: table.slice(start, start + pageSize) });
  });
  return app;
}

// ---------------- Audiobookshelf (Bearer token) ----------------
export function makeAudiobookshelf({ token = 'MOCK_API_KEY' } = {}) {
  const app = express();
  app.use(express.json());
  const hue = { 'li-1': 20, 'li-2': 200, 'li-3': 280, 'li-4': 120, 'li-5': 340, 'pod-1': 40 };
  const book = (id, title, authorName, narratorName, seriesName, hours, addedDaysAgo) => ({
    id, libraryId: 'lib-books', mediaType: 'book', addedAt: now() - addedDaysAgo * DAY, updatedAt: now() - DAY, size: Math.round(hours * 58e6), isMissing: false,
    media: { id: `m-${id}`, coverPath: `/metadata/items/${id}/cover.jpg`, numTracks: 1, numChapters: Math.round(hours * 2), duration: hours * 3600, size: Math.round(hours * 58e6),
      metadata: { title, subtitle: null, authorName, narratorName, seriesName, genres: ['Science Fiction'], publishedYear: '2021' } },
  });
  const items = [
    book('li-1', 'Project Hail Mary', 'Andy Weir', 'Ray Porter', '', 16.2, 3),
    book('li-2', 'Dune', 'Frank Herbert', 'Scott Brick, Simon Vance', 'Dune #1', 21.0, 12),
    book('li-3', 'Children of Time', 'Adrian Tchaikovsky', 'Mel Hudson', 'Children of Time #1', 16.5, 30),
    book('li-4', 'The Way of Kings', 'Brandon Sanderson', 'Michael Kramer, Kate Reading', 'The Stormlight Archive #1', 45.5, 60),
    book('li-5', 'Leviathan Wakes', 'James S. A. Corey', 'Jefferson Mays', 'The Expanse #1', 20.9, 90),
  ];
  const podcast = { id: 'pod-1', libraryId: 'lib-pods', mediaType: 'podcast', addedAt: now() - 5 * DAY, media: { id: 'm-pod-1', numEpisodes: 214, metadata: { title: 'Hardcore History', author: 'Dan Carlin' } } };
  app.get('/status', (req, res) => res.json({ app: 'audiobookshelf', serverVersion: '2.37.1', isInit: true, language: 'en-us' }));
  app.get('/ping', (req, res) => res.json({ success: true }));
  // Covers are public in Audiobookshelf.
  app.get('/api/items/:id/cover', (req, res) => {
    const it = items.find((x) => x.id === req.params.id) || (req.params.id === podcast.id ? podcast : null);
    if (!it) return res.status(404).end();
    res.type('image/svg+xml').send(coverSvg(it.media.metadata.title, hue[it.id] ?? 220));
  });
  app.use('/api', (req, res, next) => {
    const header = String(req.headers.authorization || '');
    const provided = header.startsWith('Bearer ') ? header.slice(7) : req.query.token;
    if (provided !== token) return res.status(401).send('Unauthorized');
    next();
  });
  app.get('/api/libraries', (req, res) => res.json({ libraries: [
    { id: 'lib-books', name: 'Audiobooks', mediaType: 'book', icon: 'audiobookshelf', displayOrder: 1, provider: 'audible' },
    { id: 'lib-pods', name: 'Podcasts', mediaType: 'podcast', icon: 'podcast', displayOrder: 2, provider: 'itunes' },
  ] }));
  app.get('/api/libraries/:id/stats', (req, res) => {
    if (req.params.id === 'lib-pods') return res.json({ totalItems: 1, totalAuthors: 0, totalGenres: 1, totalSize: 48e9, totalDuration: 214 * 3.2 * 3600, numAudioTracks: 214 });
    res.json({ totalItems: items.length, totalAuthors: 5, totalGenres: 3, totalSize: items.reduce((n, i) => n + i.size, 0), totalDuration: items.reduce((n, i) => n + i.media.duration, 0), numAudioTracks: items.length });
  });
  app.get('/api/libraries/:id/items', (req, res) => {
    const list = req.params.id === 'lib-pods' ? [podcast] : [...items].sort((a, b) => b.addedAt - a.addedAt);
    const limit = Number(req.query.limit) || list.length;
    const page = Number(req.query.page) || 0;
    res.json({ results: list.slice(page * limit, page * limit + limit), total: list.length, limit, page, sortBy: req.query.sort || 'addedAt', sortDesc: true, mediaType: req.params.id === 'lib-pods' ? 'podcast' : 'book', minified: true });
  });
  app.get('/api/me/items-in-progress', (req, res) => res.json({ libraryItems: [
    { ...items[1], progressLastUpdate: now() - 2 * HOUR },
    { ...items[3], progressLastUpdate: now() - 3 * DAY },
  ] }));
  app.get('/api/me/progress', (req, res) => res.json({ mediaProgress: [
    { libraryItemId: 'li-2', progress: 0.62, currentTime: 0.62 * 21 * 3600, duration: 21 * 3600, isFinished: false, lastUpdate: now() - 2 * HOUR },
    { libraryItemId: 'li-4', progress: 0.18, currentTime: 0.18 * 45.5 * 3600, duration: 45.5 * 3600, isFinished: false, lastUpdate: now() - 3 * DAY },
  ] }));
  app.get('/api/sessions/open', (req, res) => res.json({ sessions: [
    { id: 'ps-1', userId: 'u1', libraryItemId: 'li-2', mediaType: 'book', displayTitle: 'Dune', displayAuthor: 'Frank Herbert', duration: 21 * 3600, currentTime: 0.62 * 21 * 3600 + ((now() / 1000) % 600), playMethod: 0, mediaPlayer: 'html5', deviceInfo: { clientName: 'Abs iOS', deviceName: 'iPhone', osName: 'iOS' }, updatedAt: now() - 20_000, user: { id: 'u1', username: 'cameron' } },
  ], shareSessions: [] }));
  return app;
}

// ---------------- Flood (username/password → jwt cookie) ----------------
export function makeFlood({ username = 'flood', password = 'flood' } = {}) {
  const app = express();
  app.use(express.json());
  const TOKEN = 'mock-flood-jwt';
  const readJwt = (req) => /(?:^|;\s*)jwt=([^;]+)/.exec(req.headers.cookie || '')?.[1];
  app.post('/api/auth/authenticate', (req, res) => {
    const { username: u, password: p } = req.body || {};
    if (!u || !p) return res.status(400).json({ message: 'Missing username or password.' });
    if (u !== username || p !== password) return res.status(401).json({ message: 'Failed login.' });
    res.setHeader('Set-Cookie', `jwt=${TOKEN}; Path=/; HttpOnly; SameSite=Strict; Expires=${new Date(now() + 7 * DAY).toUTCString()}`);
    res.json({ success: true, username: u, level: 10 });
  });
  app.use('/api', (req, res, next) => {
    if (readJwt(req) !== TOKEN) return res.status(401).json({ message: 'Unauthorized' });
    next();
  });
  const settings = { throttleGlobalDownSpeed: 0, throttleGlobalUpSpeed: 5 * 1024 * 1024 };
  const t = (hash, name, pct, down, up, sizeGb, status, extra = {}) => ({
    hash, name, percentComplete: pct, downRate: down, upRate: up, sizeBytes: Math.round(sizeGb * 1024 ** 3), bytesDone: Math.round(sizeGb * 1024 ** 3 * pct / 100),
    eta: down > 0 ? Math.round((sizeGb * 1024 ** 3 * (100 - pct) / 100) / down) : -1, ratio: extra.ratio ?? 0, status, tags: extra.tags || [], dateAdded: Math.round((now() - (extra.ageMs || HOUR)) / 1000),
    peersConnected: extra.peers ?? 4, seedsConnected: extra.seeds ?? 12, message: extra.message || '', directory: '/downloads',
  });
  const torrents = {
    A1B2C3: t('A1B2C3', 'The.Bear.S03E06.1080p.WEB.h264-ETHEL', 63.4, 18.2 * 1024 * 1024, 1.1 * 1024 * 1024, 1.8, ['downloading', 'active'], { tags: ['tv'] }),
    D4E5F6: t('D4E5F6', 'Furiosa.2024.2160p.UHD.BluRay.REMUX-FGT', 12.9, 32.5 * 1024 * 1024, 0, 60, ['downloading', 'active'], { tags: ['movies'] }),
    G7H8I9: t('G7H8I9', 'ubuntu-26.04-desktop-amd64.iso', 100, 0, 2.4 * 1024 * 1024, 6.1, ['seeding', 'complete', 'active'], { ratio: 3.42, ageMs: 9 * DAY }),
    J1K2L3: t('J1K2L3', 'Severance.S02.1080p.ATVP.WEB-DL-NTb', 100, 0, 0, 22.4, ['stopped', 'complete', 'inactive'], { ratio: 1.02, tags: ['tv'], ageMs: 20 * DAY }),
    M4N5O6: t('M4N5O6', 'Some.Dead.Torrent.2019.720p', 7.2, 0, 0, 3.3, ['downloading', 'inactive', 'error'], { message: 'Tracker: torrent not registered', seeds: 0, peers: 0 }),
  };
  app.get('/api/torrents', (req, res) => res.json({ id: Math.floor(now() / 1000), torrents }));
  const setStatus = (hashes, stopped) => {
    for (const h of hashes || []) {
      const x = torrents[h]; if (!x) continue;
      const done = x.percentComplete >= 100;
      x.status = stopped ? ['stopped', ...(done ? ['complete'] : []), 'inactive'] : [done ? 'seeding' : 'downloading', ...(done ? ['complete'] : []), 'active'];
      if (stopped) { x.downRate = 0; x.upRate = 0; }
    }
  };
  const requireHashes = (req, res) => {
    const hashes = req.body?.hashes;
    if (!Array.isArray(hashes) || !hashes.length) { res.status(422).json({ message: 'hashes must be a non-empty array' }); return null; }
    return hashes;
  };
  app.post('/api/torrents/start', (req, res) => { const h = requireHashes(req, res); if (!h) return; setStatus(h, false); res.status(200).end(); });
  app.post('/api/torrents/stop', (req, res) => { const h = requireHashes(req, res); if (!h) return; setStatus(h, true); res.status(200).end(); });
  app.post('/api/torrents/delete', (req, res) => { const h = requireHashes(req, res); if (!h) return; for (const x of h) delete torrents[x]; res.status(200).end(); });
  app.get('/api/client/settings', (req, res) => res.json(settings));
  app.patch('/api/client/settings', (req, res) => {
    for (const k of ['throttleGlobalDownSpeed', 'throttleGlobalUpSpeed']) if (req.body && Number.isFinite(req.body[k])) settings[k] = req.body[k];
    res.status(200).end();
  });
  app.get('/api/client/connection-test', (req, res) => res.json({ isConnected: true }));
  return app;
}
