// Bundled mock services that emulate the subset of Sonarr / Radarr / Overseerr /
// SABnzbd APIs the dashboard uses. Lets you run and test the whole app locally
// without any real services. Each mock REQUIRES the API key, which proves the
// proxy is correctly injecting auth end-to-end. Cloudflare Access headers are
// recorded on a /__debug endpoint so you can confirm header injection too.
import express from 'express';
import { makeAutobrr, makeMaintainerr, makeTdarr, makeAudiobookshelf, makeFlood } from './extraMocks.js';

export const MOCK_PORTS = {
  sonarr: 18989,
  sonarrAnime: 18990,
  radarr: 17878,
  radarr4k: 17879,
  lidarr: 18686,
  readarr: 18787,
  bindery: 18788,
  listenarr: 14545,
  overseerr: 15055,
  sabnzbd: 18080,
  tautulli: 18181,
  bazarr: 16767,
  qbittorrent: 18081,
  transmission: 19091,
  deluge: 18112,
  nzbget: 16789,
  jellyfin: 18096,
  emby: 18097,
  indexer: 16060,
  flood: 13001,
  audiobookshelf: 13378,
  autobrr: 17474,
  maintainerr: 16246,
  tdarr: 18265,
  prowlarr: 19696,
};

import { createMockFs, sonarrDemoFs, radarrDemoFs, lidarrDemoFs } from './mockFs.js';
import { INTEGRATION_MOCK_PORTS, makePortainer, makeGlances, makePihole, makeAdguard, makeSyncthing, makeNavidrome, makePulsarr, makeUnraid, makeTruenasServer, makeUnpackerr, makeSpeedtest, makePlex } from './integrationMocks.js';
import { DEMO_TAUTULLI_USERS, demoHistoryPage, demoPosterSvg } from './yearHistory.js';
Object.assign(MOCK_PORTS, INTEGRATION_MOCK_PORTS);

const cfSeen = {}; // service -> last seen CF headers

function recordCf(name, req) {
  cfSeen[name] = {
    clientId: req.headers['cf-access-client-id'] || null,
    clientSecret: req.headers['cf-access-client-secret'] ? '***present***' : null,
    at: new Date().toISOString(),
  };
}

// Fake indexer releases for interactive-search demo.
function mockReleases(name) {
  return [
    { guid: 'rel-1', indexerId: 1, indexer: 'NZBgeek', protocol: 'usenet', title: `${name}.2160p.WEB-DL.DDP5.1.H.265-DEMO`, size: 21474836480, ageHours: 6.2, approved: true, rejections: [], quality: { quality: { name: 'WEBDL-2160p' } } },
    { guid: 'rel-2', indexerId: 1, indexer: 'DrunkenSlug', protocol: 'usenet', title: `${name}.1080p.WEB-DL.DDP5.1.H.264-DEMO`, size: 3221225472, ageHours: 9.5, approved: true, rejections: [], quality: { quality: { name: 'WEBDL-1080p' } } },
    { guid: 'rel-3', indexerId: 2, indexer: 'RARBG', protocol: 'torrent', title: `${name}.1080p.BluRay.x264-DEMO`, size: 8589934592, ageHours: 40, seeders: 128, leechers: 12, approved: false, rejections: ['Release group is on the blocklist'], quality: { quality: { name: 'Bluray-1080p' } } },
    { guid: 'rel-4', indexerId: 2, indexer: 'TorrentLeech', protocol: 'torrent', title: `${name}.720p.WEB-DL-DEMO`, size: 1610612736, ageHours: 2, seeders: 4, leechers: 30, approved: false, rejections: ['Only 2 hours old, minimum age is 48 hours'], quality: { quality: { name: 'WEBDL-720p' } } },
  ];
}

function fillSonarrLibrary(series, requestedSize) {
  const size = Number.parseInt(requestedSize, 10);
  if (!Number.isFinite(size) || size <= series.length) return series;
  const networks = ['Apple TV+', 'HBO', 'Netflix', 'FX', 'Prime Video'];
  for (let id = series.length + 1; id <= size; id++) {
    const episodeCount = 8 + (id % 5) * 4;
    const missing = id % 4 === 0 ? 0 : id % 7;
    const episodeFileCount = Math.max(0, episodeCount - missing);
    const title = `Performance Series ${String(id).padStart(3, '0')}`;
    series.push({
      id,
      title,
      year: 2010 + (id % 15),
      tvdbId: 900000 + id,
      status: id % 5 === 0 ? 'ended' : 'continuing',
      monitored: id % 3 !== 0,
      seasonCount: 1 + (id % 6),
      network: networks[id % networks.length],
      overview: `Deterministic performance fixture for series ${String(id).padStart(3, '0')}.`,
      path: `C:\\Media\\TV\\${title}`,
      rootFolderPath: 'C:\\Media\\TV',
      statistics: {
        episodeFileCount,
        episodeCount,
        percentOfEpisodes: episodeCount ? Math.round((episodeFileCount / episodeCount) * 1000) / 10 : 0,
        sizeOnDisk: episodeFileCount * (700 * 1024 * 1024 + (id % 4) * 100 * 1024 * 1024),
      },
      images: [],
    });
  }
  return series;
}

function fillRadarrLibrary(movies, requestedSize) {
  const size = Number.parseInt(requestedSize, 10);
  if (!Number.isFinite(size) || size <= movies.length) return movies;
  const studios = ['Aperture Pictures', 'Northstar Films', 'Beacon Studios', 'Summit Works'];
  for (let id = movies.length + 1; id <= size; id++) {
    const hasFile = id % 4 !== 0;
    const title = `Performance Movie ${String(id).padStart(3, '0')}`;
    const year = 2005 + (id % 20);
    movies.push({
      id,
      title,
      year,
      tmdbId: 800000 + id,
      status: id % 8 === 0 ? 'announced' : 'released',
      monitored: id % 3 !== 0,
      hasFile,
      runtime: 85 + (id % 70),
      overview: `Deterministic performance fixture for movie ${String(id).padStart(3, '0')}.`,
      path: `C:\\Media\\Movies\\${title} (${year})`,
      rootFolderPath: 'C:\\Media\\Movies',
      sizeOnDisk: hasFile ? (4 + (id % 16)) * 1024 * 1024 * 1024 : 0,
      studio: studios[id % studios.length],
      images: [],
    });
  }
  return movies;
}

// ---------------- Sonarr ----------------
// Shared manual-import endpoints for the Sonarr/Radarr mocks. Mirrors the real
// v3 contract closely enough to exercise ACC's Fix-import flow end-to-end:
//   GET  manualimport?downloadId=…   candidates for a stuck download
//   POST manualimport [items]        reprocess (re-evaluate rejections)
//   GET  qualitydefinition           quality picker
//   POST command {ManualImport}      imports + drops the queue item
//   GET  command/:id                 completes on the second poll
// Quality from a release-style file name, for folder-based manual imports.
const QUALITY_BY_NAME = [
  [/2160p.*(bluray|uhd|remux)|(bluray|uhd|remux).*2160p/i, { id: 19, name: 'Bluray-2160p', resolution: 2160 }],
  [/2160p/i, { id: 18, name: 'WEBDL-2160p', resolution: 2160 }],
  [/1080p.*bluray|bluray.*1080p/i, { id: 7, name: 'Bluray-1080p', resolution: 1080 }],
  [/1080p/i, { id: 3, name: 'WEBDL-1080p', resolution: 1080 }],
  [/720p/i, { id: 5, name: 'WEBDL-720p', resolution: 720 }],
];
const qualityFromName = (name) => (QUALITY_BY_NAME.find(([re]) => re.test(name)) || [null, { id: 1, name: 'SDTV', resolution: 480 }])[1];
const QUALITY_RANK = { 1: 1, 4: 2, 5: 2, 9: 3, 3: 3, 15: 3, 7: 4, 18: 5, 19: 6 };

function mountManualImportMock(app, { kind, candidates, getQueue, setQueue, library, fs, recycled, episodeFiles }) {
  const commands = new Map();
  let nextCmd = 1000;
  const qualities = [
    { id: 1, quality: { id: 1, name: 'SDTV' }, title: 'SDTV', minSize: 2, maxSize: 100 },
    { id: 2, quality: { id: 4, name: 'HDTV-720p' }, title: 'HDTV-720p', minSize: 17.1, maxSize: 400 },
    { id: 3, quality: { id: 3, name: 'WEBDL-1080p' }, title: 'WEBDL-1080p', minSize: 12.5, maxSize: 400 },
    { id: 4, quality: { id: 7, name: 'Bluray-1080p' }, title: 'Bluray-1080p', minSize: 50.4, maxSize: 400 },
    { id: 5, quality: { id: 18, name: 'WEBDL-2160p' }, title: 'WEBDL-2160p', minSize: 34.5, maxSize: 1000 },
    { id: 6, quality: { id: 19, name: 'Bluray-2160p' }, title: 'Bluray-2160p', minSize: 102, maxSize: 1000 },
  ];
  app.get('/api/v3/qualitydefinition', (req, res) => res.json(qualities));
  app.get('/api/v3/manualimport', (req, res) => {
    // Folder import (movies): every video file in the folder, mapped to the
    // given movie, rejected when it isn't better than the current file.
    if (req.query.folder && fs && kind === 'movie') {
      const movie = library().find((m) => m.id === Number(req.query.movieId));
      const out = [];
      const walk = (dir) => { for (const c of fs.children(dir) || []) { if (c.type === 'file') { if (/\.(mkv|mp4|avi|m4v)$/i.test(c.name)) out.push(c); } else walk(c.path); } };
      walk(String(req.query.folder));
      return res.json(out.map((c, i) => {
        const q = qualityFromName(c.name);
        const cur = movie && movie.movieFile && movie.movieFile.quality && movie.movieFile.quality.quality;
        const rejections = cur && (QUALITY_RANK[q.id] || 0) <= (QUALITY_RANK[cur.id] || 0) ? [{ reason: 'Not an upgrade for existing movie file', type: 'permanent' }] : [];
        return { id: i + 1, path: c.path, relativePath: c.name, folderName: String(req.query.folder).split('/').pop(), name: c.name.replace(/\.[^.]+$/, ''), size: 61203283968, movie: movie ? { id: movie.id, title: movie.title, year: movie.year } : undefined, quality: { quality: q, revision: { version: 1, real: 0, isRepack: false } }, languages: [{ id: 1, name: 'English' }], releaseGroup: '', indexerFlags: 0, rejections };
      }));
    }
    // Folder import (series): every SxxEyy video file, mapped to episodes,
    // rejected when it isn't better than those episodes' current files.
    if (req.query.folder && fs && kind === 'series') {
      const s = library().find((x) => x.id === Number(req.query.seriesId));
      const out = [];
      const walk = (dir) => { for (const c of fs.children(dir) || []) { if (c.type === 'file') { if (/\.(mkv|mp4|avi|m4v)$/i.test(c.name)) out.push(c); } else walk(c.path); } };
      walk(String(req.query.folder));
      return res.json(out.map((c, i) => {
        const m = /S(\d+)E(\d+)/i.exec(c.name);
        const season = m ? Number(m[1]) : 1; const ep = m ? Number(m[2]) : 1;
        const epId = 5000 + season * 100 + ep;
        const q = qualityFromName(c.name);
        const cur = (episodeFiles || []).find((ef) => s && ef.seriesId === s.id && (ef.episodeIds || []).includes(epId));
        const curQ = cur && cur.quality && cur.quality.quality;
        const rejections = curQ && (QUALITY_RANK[q.id] || 0) <= (QUALITY_RANK[curQ.id] || 0) ? [{ reason: 'Not an upgrade for existing episode file(s)', type: 'permanent' }] : [];
        return { id: i + 1, path: c.path, relativePath: c.name, folderName: '', name: c.name.replace(/\.[^.]+$/, ''), size: 9e9, series: s ? { id: s.id, title: s.title } : undefined, seasonNumber: season, episodes: [{ id: epId, seasonNumber: season, episodeNumber: ep, title: `Episode ${ep}` }], quality: { quality: q, revision: { version: 1, real: 0, isRepack: false } }, languages: [{ id: 1, name: 'English' }], releaseGroup: '', releaseType: 'singleEpisode', indexerFlags: 0, rejections };
      }));
    }
    const id = String(req.query.downloadId || '');
    res.json(JSON.parse(JSON.stringify(candidates[id] || candidates.default || [])));
  });
  app.post('/api/v3/manualimport', (req, res) => {
    const items = Array.isArray(req.body) ? req.body : [];
    res.json(items.map((it) => {
      const rejections = [];
      if (kind === 'series') {
        if (!it.seriesId) rejections.push({ reason: 'Unknown Series', type: 'permanent' });
        else if (!(it.episodeIds || []).length) rejections.push({ reason: 'No episodes selected', type: 'permanent' });
        const s = library().find((x) => x.id === it.seriesId);
        return { ...it, series: s ? { id: s.id, title: s.title } : undefined, episodes: (it.episodeIds || []).map((eid) => ({ id: eid, seasonNumber: it.seasonNumber, episodeNumber: (eid % 100) || 1 })), episodeIds: undefined, rejections };
      }
      if (!it.movieId) rejections.push({ reason: 'Unknown Movie', type: 'permanent' });
      const m = library().find((x) => x.id === it.movieId);
      return { ...it, movie: m ? { id: m.id, title: m.title, year: m.year } : undefined, rejections };
    }));
  });
  app.post('/api/v3/command', (req, res) => {
    const body = req.body || {};
    const cmd = { id: nextCmd++, name: body.name, status: 'queued', polls: 0, body };
    commands.set(cmd.id, cmd);
    if (body.name === 'ManualImport') {
      const ids = new Set((body.files || []).map((f) => f.downloadId).filter(Boolean));
      if (ids.size) setQueue(getQueue().filter((q) => !ids.has(q.downloadId)));
      // Folder import into a series: replace each episode's file.
      if (kind === 'series' && fs && episodeFiles) {
        for (const f of body.files || []) {
          if (f.downloadId) continue;
          const s = library().find((x) => x.id === f.seriesId);
          if (!s) continue;
          const name = String(f.path).split('/').pop();
          for (const old of episodeFiles.filter((ef) => ef.seriesId === s.id && (ef.episodeIds || []).some((id) => (f.episodeIds || []).includes(id)))) {
            recycled.push(old.path);
            fs.remove(old.path);
            episodeFiles.splice(episodeFiles.indexOf(old), 1);
          }
          if (body.importMode !== 'copy') fs.remove(f.path);
          const season = /S(\d+)E/i.exec(name);
          const dest = `${s.path}/Season ${season ? Number(season[1]) : 1}/${name}`;
          fs.addFile(dest);
          episodeFiles.push({ id: 7000 + episodeFiles.length + recycled.length, seriesId: s.id, seasonNumber: season ? Number(season[1]) : 1, relativePath: dest.slice(s.path.length + 1), path: dest, quality: f.quality, size: 8e9, episodeIds: f.episodeIds });
        }
      }
      // Folder import into a movie that already has a file: the old file goes
      // to the recycle bin, the new one is moved into the movie folder.
      if (kind === 'movie' && fs) {
        for (const f of body.files || []) {
          if (f.downloadId) continue;
          const m = library().find((x) => x.id === f.movieId);
          if (!m) continue;
          const name = String(f.path).split('/').pop();
          if (m.movieFile) {
            recycled.push(`${m.path}/${m.movieFile.relativePath}`);
            fs.remove(`${m.path}/${m.movieFile.relativePath}`);
          }
          if (body.importMode !== 'copy') fs.remove(f.path);
          fs.addFile(`${m.path}/${name}`);
          m.movieFile = { id: (m.movieFile ? m.movieFile.id : 900) + 1, movieId: m.id, relativePath: name, path: `${m.path}/${name}`, quality: f.quality, size: 61203283968 };
          m.hasFile = true;
          m.sizeOnDisk = m.movieFile.size;
        }
      }
    }
    res.status(201).json({ id: cmd.id, name: cmd.name, status: cmd.status });
  });
  app.get('/api/v3/command/:id', (req, res) => {
    const cmd = commands.get(Number(req.params.id));
    if (!cmd) return res.status(404).json({ message: 'Command not found' });
    cmd.polls += 1;
    if (cmd.polls >= 2) cmd.status = 'completed';
    else cmd.status = 'started';
    res.json({ id: cmd.id, name: cmd.name, status: cmd.status, message: cmd.status === 'completed' ? 'Completed' : 'Processing', body: cmd.body });
  });
}

// Sonarr/Radarr's RootFolderCheck: one error naming the missing roots.
function missingRootsHealth(roots, fs, app) {
  const missing = roots.filter((r) => !fs.exists(r.path)).map((r) => r.path);
  return missing.length ? [{ id: 90, type: 'error', source: 'RootFolderCheck', message: `Missing root folder${missing.length > 1 ? 's' : ''}: ${missing.join(' | ')}`, wikiUrl: `https://wiki.servarr.com/${app}/system#missing-root-folder` }] : [];
}

// Filesystem where every item's folder (POSIX paths) exists.
function fsFromItems(items) {
  const fs = createMockFs({}, { disks: [{ path: '/', label: 'root', freeSpace: 5e11, totalSpace: 2e12 }] });
  for (const it of items) if (it.path && it.path.startsWith('/')) fs.mkdirp(it.path);
  return fs;
}

// Backups, like the real apps: GET system/backup lists them, the Backup
// command makes one, and the zip is served from /backup/<type>/<name> (needs
// the API key). Mounted first so it sees Backup commands before other routes.
// Download clients, remote path mappings, indexers and download-client
// settings, for the setup doctor. Each demo instance has its own setup
// (passed in), including one realistic mistake to find.
const dlField = (name, value) => ({ name, value });
export function demoDownloadClient(id, impl, { host, port, category, field, protocol, enable = true }) {
  return {
    id, name: impl === 'QBittorrent' ? 'qBittorrent' : impl === 'Sabnzbd' ? 'SABnzbd' : impl, implementation: impl, implementationName: impl, configContract: `${impl}Settings`,
    protocol: protocol || (impl === 'Sabnzbd' || impl === 'Nzbget' ? 'usenet' : 'torrent'), enable, priority: 1, removeCompletedDownloads: true, removeFailedDownloads: true, tags: [],
    fields: [dlField('host', host), dlField('port', port), dlField('useSsl', false), dlField('urlBase', ''), impl === 'Sabnzbd' ? dlField('apiKey', '********') : dlField('username', 'admin'), dlField('password', '********'), dlField(field, category), dlField(field.replace('Category', 'ImportedCategory'), '')],
  };
}
const prowlarrIndexer = (id, name, protocol) => ({ id, name: `${name} (Prowlarr)`, implementation: protocol === 'torrent' ? 'Torznab' : 'Newznab', protocol, enableRss: true, enableAutomaticSearch: true, enableInteractiveSearch: true, priority: 25, fields: [dlField('baseUrl', `http://prowlarr:9696/${id}/`), dlField('apiKey', '********')] });
export const DEMO_PROWLARR_INDEXERS = { nzbgeek: (id) => prowlarrIndexer(id, 'NZBgeek', 'usenet'), drunkenslug: (id) => prowlarrIndexer(id, 'DrunkenSlug', 'usenet'), torrentleech: (id) => prowlarrIndexer(id, 'TorrentLeech', 'torrent'), oldindexer: (id) => prowlarrIndexer(id, 'OldIndexer', 'torrent') };
function mountDoctorMock(app, v, { clients = [], mappings = [], indexers = [], completedHandling = true } = {}) {
  const dlConfig = { id: 1, downloadClientWorkingFolders: '_UNPACK_|_FAILED_', enableCompletedDownloadHandling: completedHandling, autoRedownloadFailed: true, autoRedownloadFailedFromInteractiveSearch: true };
  app.get(`/api/${v}/downloadclient`, (req, res) => res.json(clients));
  app.get(`/api/${v}/remotepathmapping`, (req, res) => res.json(mappings));
  app.get(`/api/${v}/indexer`, (req, res) => res.json(indexers));
  app.get(`/api/${v}/config/downloadclient`, (req, res) => res.json(dlConfig));
}

function mountBackupMock(app, appName, v) {
  const t0 = Date.now();
  let backups = [
    { id: 1, name: `${appName}_backup_v4.0.0_${new Date(t0 - 86400000).toISOString().slice(0, 10).replace(/-/g, '.')}_04.00.00.zip`, path: '', type: 'scheduled', size: 1843200, time: new Date(t0 - 86400000).toISOString() },
    { id: 2, name: `${appName}_backup_v4.0.0_${new Date(t0 - 8 * 86400000).toISOString().slice(0, 10).replace(/-/g, '.')}_04.00.00.zip`, path: '', type: 'scheduled', size: 1802240, time: new Date(t0 - 8 * 86400000).toISOString() },
  ];
  const withPath = (b) => ({ ...b, path: `/backup/${b.type}/${b.name}` });
  const authed = (req, res) => { if (req.headers['x-api-key'] === 'MOCK_API_KEY' || req.query.apikey === 'MOCK_API_KEY') return true; res.status(401).json({ error: 'Unauthorized' }); return false; };
  app.get(`/api/${v}/system/backup`, (req, res) => { if (authed(req, res)) res.json(backups.map(withPath).sort((a, b) => b.time.localeCompare(a.time))); });
  app.delete(`/api/${v}/system/backup/:id`, (req, res) => { if (!authed(req, res)) return; backups = backups.filter((b) => b.id !== Number(req.params.id)); res.json({}); });
  app.post(`/api/${v}/command`, (req, res, next) => {
    if (req.body && req.body.name === 'Backup' && req.headers['x-api-key'] === 'MOCK_API_KEY') {
      const now = new Date();
      const stampName = now.toISOString().slice(0, 19).replace('T', '_').replace(/-/g, '.').replace(/:/g, '.');
      backups.push({ id: Math.max(0, ...backups.map((b) => b.id)) + 1, name: `${appName}_backup_v4.0.0_${stampName}.zip`, path: '', type: 'manual', size: 1900544 + backups.length * 4096, time: now.toISOString() });
    }
    next();
  });
  // Connect → notifications (only the Webhook type is modelled).
  const notifications = [];
  app.locals.notifications = notifications;
  const WEBHOOK_SCHEMA = { implementation: 'Webhook', implementationName: 'Webhook', configContract: 'WebhookSettings', name: '', fields: [{ name: 'url', value: '' }, { name: 'method', value: 1 }, { name: 'username', value: '' }, { name: 'password', value: '' }],
    onGrab: false, onDownload: false, onUpgrade: false, onHealthIssue: false, onApplicationUpdate: false, supportsOnGrab: true, supportsOnDownload: true, supportsOnUpgrade: true, supportsOnHealthIssue: true, supportsOnApplicationUpdate: false, presets: [] };
  app.get(`/api/${v}/notification`, (req, res) => res.json(notifications));
  app.get(`/api/${v}/notification/schema`, (req, res) => res.json([WEBHOOK_SCHEMA, { implementation: 'Discord', fields: [] }]));
  app.post(`/api/${v}/notification`, (req, res) => {
    const url = ((req.body.fields || []).find((f) => f.name === 'url') || {}).value;
    if (!/^https?:\/\//.test(url || '')) return res.status(400).json([{ propertyName: 'Url', errorMessage: "'Url' must be a valid URL" }]);
    const n = { ...req.body, id: notifications.length + 1 }; notifications.push(n); res.status(201).json(n);
  });
  app.put(`/api/${v}/notification/:id`, (req, res) => { const i = notifications.findIndex((n) => n.id === Number(req.params.id)); if (i < 0) return res.status(404).json({ message: 'NotFound' }); notifications[i] = { ...req.body, id: notifications[i].id }; res.status(202).json(notifications[i]); });
  // release/push: approve unless the title looks wrong for this app.
  const pushed = [];
  app.locals.pushed = pushed;
  app.post(`/api/${v}/release/push`, (req, res) => {
    const b = req.body || {};
    if (!b.title) return res.status(400).json([{ propertyName: 'Title', errorMessage: "'Title' must not be empty." }]);
    if (!b.downloadUrl && !b.magnetUrl) return res.status(400).json([{ propertyName: 'DownloadUrl', errorMessage: "'Download Url' must not be empty." }]);
    if (!['usenet', 'torrent'].includes(b.protocol)) return res.status(400).json([{ propertyName: 'Protocol', errorMessage: "'Protocol' must not be empty." }]);
    pushed.push(b);
    const unknown = /unknown|zzz/i.test(b.title);
    res.json([{ guid: `push-${pushed.length}`, title: b.title, approved: !unknown, rejections: unknown ? [{ reason: 'Unknown Series', type: 'permanent' }] : [], ...(appName === 'radarr' ? { movieTitle: b.title.split(/[.(\[]/)[0].trim() } : { seriesTitle: b.title.split(/[.(\[]/)[0].trim() }) }]);
  });
  app.get('/backup/:type/:name', (req, res) => {
    if (!authed(req, res)) return;
    const b = backups.find((x) => x.type === req.params.type && x.name === req.params.name);
    if (!b) return res.status(404).send('Not found');
    // A tiny valid (empty) zip file.
    res.type('application/zip').send(Buffer.from([0x50, 0x4b, 0x05, 0x06, ...new Array(18).fill(0)]));
  });
}

function makeSonarr(opts = {}) {
  const app = express();
  app.use(express.json());
  mountBackupMock(app, opts.instanceName && /whisparr/i.test(opts.instanceName) ? 'whisparr' : 'sonarr', 'v3');
  // Setup doctor demo: the main Sonarr can't see qBittorrent's /downloads (no
  // mapping); the anime instance shares SABnzbd's "tv" category with it.
  const I = DEMO_PROWLARR_INDEXERS;
  mountDoctorMock(app, 'v3', /whisparr/i.test(opts.instanceName || '')
    ? { clients: [demoDownloadClient(1, 'Sabnzbd', { host: 'sabnzbd', port: 8080, category: 'whisparr', field: 'tvCategory' })] }
    : opts.series
      ? { clients: [demoDownloadClient(1, 'Sabnzbd', { host: 'sabnzbd', port: 8080, category: 'tv', field: 'tvCategory' })], indexers: [{ id: 1, name: 'Nyaa', implementation: 'Torznab', protocol: 'torrent', enableRss: true, enableAutomaticSearch: true, enableInteractiveSearch: true, priority: 25, fields: [] }] }
      : {
        clients: [demoDownloadClient(1, 'QBittorrent', { host: 'qbittorrent', port: 8080, category: 'tv-sonarr', field: 'tvCategory' }), demoDownloadClient(2, 'Sabnzbd', { host: 'sabnzbd', port: 8080, category: 'tv', field: 'tvCategory' })],
        mappings: [{ id: 1, host: 'sabnzbd', remotePath: '/downloads/complete/', localPath: '/data/usenet/' }],
        indexers: [I.nzbgeek(1), I.drunkenslug(2), I.torrentleech(3)],
      });
  let series = [
    { id: 1, title: 'Severance', year: 2022, tvdbId: 371980, status: 'continuing', monitored: true, seasonCount: 2, network: 'Apple TV+', overview: 'Employees at Lumon undergo a procedure that severs work and personal memories.', path: 'C:\\Media\\TV\\Severance', rootFolderPath: 'C:\\Media\\TV', statistics: { episodeFileCount: 18, episodeCount: 19, percentOfEpisodes: 94.7, sizeOnDisk: 40802189312 }, images: [] },
    { id: 2, title: 'The Bear', year: 2022, tvdbId: 388477, status: 'continuing', monitored: true, seasonCount: 3, network: 'FX', overview: 'A young chef returns to Chicago to run his family sandwich shop.', path: 'C:\\Media\\TV\\The Bear', rootFolderPath: 'C:\\Media\\TV', statistics: { episodeFileCount: 28, episodeCount: 28, percentOfEpisodes: 100, sizeOnDisk: 30064771072 }, images: [] },
    { id: 3, title: 'Foundation', year: 2021, tvdbId: 358711, status: 'continuing', monitored: false, seasonCount: 2, network: 'Apple TV+', overview: 'A band of exiles races to save humanity and rebuild civilization.', path: 'C:\\Media\\TV\\Foundation', rootFolderPath: 'C:\\Media\\TV', statistics: { episodeFileCount: 20, episodeCount: 20, percentOfEpisodes: 100, sizeOnDisk: 64424509440 }, images: [] },
    { id: 4, title: 'Severance', year: 2022, tvdbId: 371980, status: 'continuing', monitored: false, seasonCount: 2, network: 'Apple TV+', overview: 'Duplicate entry added on another drive.', path: 'C:\\Media\\TV2\\Severance', rootFolderPath: 'C:\\Media\\TV2', statistics: { episodeFileCount: 0, episodeCount: 19, percentOfEpisodes: 0, sizeOnDisk: 0 }, images: [] },
  ];
  if (opts.series) series = opts.series.map((s) => ({ ...s }));
  else series = fillSonarrLibrary(series, opts.librarySize);
  let queue = [
    { id: 101, title: 'Severance S02E10', seriesId: 1, downloadId: 'SABnzbd_nzo_sev0210', status: 'downloading', trackedDownloadStatus: 'ok', trackedDownloadState: 'downloading', size: 2147483648, sizeleft: 536870912, timeleft: '00:04:12', estimatedCompletionTime: new Date(Date.now() + 252000).toISOString(), downloadClient: 'SABnzbd', indexer: 'NZBgeek' },
    { id: 102, title: 'The.Bear.S03E05.Children.1080p.WEB.h264-ETHEL', seriesId: 2, downloadId: 'SABnzbd_nzo_bear0305', status: 'completed', trackedDownloadStatus: 'warning', trackedDownloadState: 'importBlocked', size: 1610612736, sizeleft: 0, downloadClient: 'SABnzbd', indexer: 'NZBgeek', statusMessages: [{ title: 'The.Bear.S03E05.Children.1080p.WEB.h264-ETHEL', messages: ['Found matching series via grab history, but release was matched to series by ID. Automatic import is not possible.'] }] },
    { id: 103, title: 'Unknown.Show.2024.S01E01.720p.HDTV', downloadId: 'qbit_hash_unknown0101', status: 'completed', trackedDownloadStatus: 'warning', trackedDownloadState: 'importPending', size: 734003200, sizeleft: 0, downloadClient: 'qBittorrent', indexer: 'Torznab', statusMessages: [{ title: 'Unknown.Show.2024.S01E01.720p.HDTV', messages: ['Unknown Series'] }] },
  ];

  app.use((req, res, next) => {
    recordCf('sonarr', req);
    if (req.headers['x-api-key'] !== 'MOCK_API_KEY') return res.status(401).json({ error: 'Unauthorized (missing X-Api-Key)' });
    next();
  });
  app.get('/__debug', (req, res) => res.json({ cf: cfSeen.sonarr || null }));
  app.get('/api/v3/system/status', (req, res) => res.json({ version: '4.0.10.2544', appName: 'Sonarr', instanceName: opts.instanceName || 'Sonarr (mock)' }));
  // Root folders and disks come from a virtual filesystem (mockFs.js). The
  // primary demo instance tells a "moved from Windows" story; other instances
  // get a filesystem where every item's folder exists.
  const fs = opts.series ? fsFromItems(series) : sonarrDemoFs();
  let rootFolders = opts.series
    ? [...new Set(series.map((x) => x.rootFolderPath).filter(Boolean))].map((path, i) => ({ id: i + 1, path }))
    : [{ id: 1, path: 'C:\\Media\\TV' }, { id: 2, path: 'C:\\Media\\TV2' }, { id: 3, path: '/data/tv' }];
  fs.mount(app, { getItems: () => series, rootFolders: () => rootFolders });
  app.get('/api/v3/qualityprofile', (req, res) => res.json(app.locals.profiles || MOCK_QUALITY_PROFILES));
  // Stable fake 'added' dates (days ago derived from id) for cleanup/age features.
  app.get('/api/v3/series', (req, res) => res.json(series.map((x) => (x.added ? x : { ...x, added: new Date(Date.now() - (120 + x.id * 97) * 86400000).toISOString() }))));
  app.get('/api/v3/queue', (req, res) => res.json({ page: 1, pageSize: 20, totalRecords: queue.length, records: queue }));
  app.delete('/api/v3/queue/:id', (req, res) => { queue = queue.filter(q => q.id !== Number(req.params.id)); res.json({}); });
  app.get('/api/v3/calendar', (req, res) => {
    const now = Date.now();
    res.json([
      { id: 9001, seriesId: 1, title: 'Cold Harbor', seasonNumber: 2, episodeNumber: 10, airDateUtc: new Date(now + 86400000).toISOString(), hasFile: false, monitored: true, series: { title: 'Severance' } },
      { id: 9002, seriesId: 2, title: 'Next', seasonNumber: 3, episodeNumber: 1, airDateUtc: new Date(now + 3 * 86400000).toISOString(), hasFile: false, monitored: true, series: { title: 'The Bear' } },
      // A streaming-style full-season drop: eight episodes on one day.
      ...Array.from({ length: 8 }, (_, i) => ({ id: 9100 + i, seriesId: 3, title: `Chapter ${i + 1}`, seasonNumber: 3, episodeNumber: i + 1, airDateUtc: new Date(now + 2 * 86400000 + i * 60000).toISOString(), hasFile: false, monitored: true, series: { title: 'Foundation' } })),
    ]);
  });
  app.get('/api/v3/series/lookup', (req, res) => {
    const term = (req.query.term || '').toString();
    const tvdb = /^tvdb:(\d+)$/.exec(term);
    if (tvdb) return res.json([{ title: 'Arcane', year: 2021, tvdbId: Number(tvdb[1]), status: 'ended', overview: 'The origins of two iconic League champions.', network: 'Netflix', images: [], seasons: [{ seasonNumber: 1, monitored: true }, { seasonNumber: 2, monitored: true }] }]);
    res.json([
      { title: `${term || 'Andor'}`, year: 2022, tvdbId: 371980, status: 'continuing', overview: 'A drama set in the Star Wars universe.', network: 'Disney+', images: [], seasons: [] },
      { title: `${term || 'Andor'} (Documentary)`, year: 2023, tvdbId: 999001, status: 'ended', overview: 'Behind the scenes.', network: 'Disney+', images: [], seasons: [] },
    ]);
  });
  app.post('/api/v3/series', (req, res) => { const s = { id: series.length + 1, ...req.body, statistics: { episodeFileCount: 0, episodeCount: 0, percentOfEpisodes: 0, sizeOnDisk: 0 } }; series.push(s); res.status(201).json(s); });
  const importsSince = (req, res) => {
    const d = (h) => new Date(Date.now() - h * 3600000).toISOString();
    const since = Date.parse(req.query.date || 0) || 0;
    const ep = (id, sid, title, year, se, e, name, h, q = 'WEBDL-1080p') => ({ id, eventType: 'downloadFolderImported', date: d(h), quality: { quality: { name: q } }, seriesId: sid, episodeId: id * 10, series: { id: sid, title, year, images: [{ coverType: 'poster', remoteUrl: `https://image.tmdb.org/t/p/w300/${sid}.jpg` }] }, episode: { id: id * 10, seriesId: sid, seasonNumber: se, episodeNumber: e, title: name } });
    const all = [
      ep(101, 1, 'Severance', 2022, 2, 10, 'Cold Harbor', 1), ep(102, 1, 'Severance', 2022, 2, 9, 'The After Hours', 30),
      ep(103, 2, 'The Bear', 2022, 3, 1, 'Tomorrow', 50), ep(104, 2, 'The Bear', 2022, 3, 2, 'Next', 52), ep(105, 2, 'The Bear', 2022, 3, 3, 'Doors', 54),
      ep(106, 3, 'Foundation', 2021, 2, 1, 'In Seldon’s Shadow', 120, 'WEBDL-2160p'),
      { id: 107, eventType: 'grabbed', date: d(2), seriesId: 1, series: { id: 1, title: 'Severance' }, episode: { seasonNumber: 2, episodeNumber: 11 } },
      ep(108, 3, 'Foundation', 2021, 1, 10, 'The Leap', 400),
    ];
    res.json(all.filter((r) => Date.parse(r.date) >= since));
  };
  app.get('/api/v3/history/since', importsSince);
  app.get('/api/v3/history', (req, res, next) => {
    if (!req.query.eventType) return next();
    importsSince({ query: {} }, { json: (rows) => {
      const want = rows.filter((r) => String(req.query.eventType) !== '3' || r.eventType === 'downloadFolderImported').sort((a, b) => b.date.localeCompare(a.date))
        .map((r) => { const o = { ...r }; if (req.query.includeSeries !== 'true') delete o.series; if (req.query.includeEpisode !== 'true') delete o.episode; if (req.query.includeMovie !== 'true') delete o.movie; return o; });
      const size = Number(req.query.pageSize) || 10; const page = Number(req.query.page) || 1;
      res.json({ page, pageSize: size, totalRecords: want.length, records: want.slice((page - 1) * size, page * size) });
    } });
  });
  app.get('/api/v3/history', (req, res) => res.json({ page: 1, pageSize: 40, totalRecords: 3, records: [
    { id: 1, eventType: 'downloadFolderImported', sourceTitle: 'Severance.S02E10.1080p.WEB-DL', date: new Date(Date.now() - 3600000).toISOString(), quality: { quality: { name: 'WEBDL-1080p' } }, series: { title: 'Severance' }, episode: { seasonNumber: 2, episodeNumber: 10 } },
    { id: 2, eventType: 'downloadFailed', sourceTitle: 'The.Bear.S03E05.1080p', date: new Date(Date.now() - 9000000).toISOString(), quality: { quality: { name: 'WEBDL-1080p' } }, series: { title: 'The Bear' }, episode: { seasonNumber: 3, episodeNumber: 5 } },
    { id: 3, eventType: 'grabbed', sourceTitle: 'Foundation.S02E01.2160p', date: new Date(Date.now() - 18000000).toISOString(), quality: { quality: { name: 'WEBDL-2160p' } }, series: { title: 'Foundation' }, episode: { seasonNumber: 2, episodeNumber: 1 } },
  ] }));
  app.get('/api/v3/episode', (req, res, next) => {
    if (!req.query.episodeIds) return next();
    const ids = new Set([].concat(req.query.episodeIds).map(Number));
    importsSince({ query: {} }, { json: (rows) => res.json(rows.filter((r) => r.episode && ids.has(r.episode.id)).map((r) => r.episode)) });
  });
  app.get('/api/v3/episode', (req, res) => {
    const season = Number(req.query.seasonNumber) || 1;
    res.json(Array.from({ length: 8 }, (_, i) => ({ id: 5000 + season * 100 + i + 1, seriesId: Number(req.query.seriesId) || 1, seasonNumber: season, episodeNumber: i + 1, title: `Episode ${i + 1}`, airDateUtc: new Date(Date.now() - (8 - i) * 86400000).toISOString(), hasFile: i % 3 !== 0, monitored: true })));
  });
  app.get('/api/v3/release', (req, res) => res.json(mockReleases('Severance')));
  app.post('/api/v3/release', (req, res) => res.status(201).json({ guid: req.body.guid, approved: true }));
  app.get('/api/v3/health', (req, res) => res.json([
    { id: 1, type: 'warning', message: 'Indexers unavailable due to failures: NZBgeek', source: 'IndexerStatusCheck', wikiUrl: 'https://wiki.servarr.com/sonarr/system#indexers-are-unavailable-due-to-failures' },
    ...missingRootsHealth(rootFolders, fs, 'sonarr'),
  ]));
  app.put('/api/v3/series/editor', (req, res) => {
    const ids = (req.body && req.body.seriesIds) || [];
    for (const s of series) {
      if (!ids.includes(s.id)) continue;
      if (req.body.monitored !== undefined) s.monitored = req.body.monitored;
      if (req.body.qualityProfileId !== undefined) s.qualityProfileId = req.body.qualityProfileId;
      if (Array.isArray(req.body.tags) && req.body.applyTags) { const cur = new Set(s.tags || []); if (req.body.applyTags === 'add') req.body.tags.forEach((t) => cur.add(t)); else if (req.body.applyTags === 'remove') req.body.tags.forEach((t) => cur.delete(t)); else { cur.clear(); req.body.tags.forEach((t) => cur.add(t)); } s.tags = [...cur]; }
      if (req.body.rootFolderPath) { const root = String(req.body.rootFolderPath).replace(/[\\/]+$/, ''); s.rootFolderPath = req.body.rootFolderPath; s.path = `${root}/${s.title}`; }
    }
    res.json(series.filter((s) => ids.includes(s.id)));
  });
  app.delete('/api/v3/series/editor', (req, res) => { const ids = (req.body && req.body.seriesIds) || []; series = series.filter((s) => !ids.includes(s.id)); res.json({}); });
  app.get('/api/v3/series/:id', (req, res) => { const x = series.find((s) => s.id === Number(req.params.id)); return x ? res.json(x) : res.status(404).json({ message: 'NotFound' }); });
  app.put('/api/v3/series/:id', (req, res) => {
    const id = Number(req.params.id);
    const idx = series.findIndex((s) => s.id === id);
    if (idx === -1) return res.status(404).json({ error: 'not found' });
    series[idx] = { ...series[idx], ...req.body, id };
    res.json(series[idx]);
  });
  app.delete('/api/v3/series/:id', (req, res) => { series = series.filter((s) => s.id !== Number(req.params.id)); res.json({}); });
  let tags = [{ id: 1, label: 'anime' }, { id: 2, label: 'kids' }];
  app.get('/api/v3/tag', (req, res) => res.json(tags));
  app.post('/api/v3/tag', (req, res) => { const t = { id: (tags.reduce((mx, x) => Math.max(mx, x.id), 0) || 0) + 1, label: String((req.body && req.body.label) || 'tag') }; tags.push(t); res.status(201).json(t); });
  mountArrLibraryExtras(app, 'series', { getTags: () => tags, setTags: (t) => { tags = t; }, getItems: () => series, variant: opts.instanceName ? 'b' : 'a' });
  app.get('/api/v3/rename', (req, res) => res.json([
    { episodeFileId: 501, seriesId: Number(req.query.seriesId) || 1, existingPath: 'Season 02/severance.s02e10.1080p.web.mkv', newPath: 'Season 02/Severance - S02E10 - Cold Harbor [WEBDL-1080p].mkv' },
  ]));
  app.put('/api/v3/episode/monitor', (req, res) => res.json({ updated: ((req.body && req.body.episodeIds) || []).length, monitored: !!(req.body && req.body.monitored) }));
  // Episode files (Severance S01E01-04 at 1080p in the demo) and a recycle bin.
  const episodeFiles = opts.series ? [] : [1, 2, 3, 4].map((e) => ({ id: 700 + e, seriesId: 1, seasonNumber: 1, relativePath: `Season 1/Severance.S01E0${e}.1080p.WEB-DL.mkv`, path: `/Volumes/Media/TV/Severance/Season 1/Severance.S01E0${e}.1080p.WEB-DL.mkv`, quality: { quality: { id: 3, name: 'WEBDL-1080p', resolution: 1080 }, revision: { version: 1, real: 0, isRepack: false } }, size: 4e9, episodeIds: [5100 + e], mediaInfo: e === 3 ? null : { videoCodec: 'h264', audioCodec: 'EAC3', audioChannels: 5.1, audioStreamCount: 1, resolution: '1920x1080', runTime: '0:55:10' } }));
  const recycledTv = [];
  app.locals.recycled = recycledTv;
  // Paths are rewritten when Fix paths moves the series; keep files in step.
  const filesFor = (s) => episodeFiles.filter((ef) => ef.seriesId === s.id).map((ef) => ({ ...ef, path: `${s.path}/${ef.relativePath}` }));
  app.delete('/api/v3/episodefile/:id', (req, res) => {
    const i = episodeFiles.findIndex((ef) => ef.id === Number(req.params.id));
    if (i < 0) return res.status(404).json({ message: 'NotFound' });
    const s = series.find((x) => x.id === episodeFiles[i].seriesId);
    recycledTv.push(s ? `${s.path}/${episodeFiles[i].relativePath}` : episodeFiles[i].path);
    episodeFiles.splice(i, 1);
    res.json({});
  });
  app.get('/api/v3/episodefile', (req, res) => { const s = series.find((x) => x.id === Number(req.query.seriesId)); res.json(s ? filesFor(s) : []); });
  let mediaManagementTv = { id: 1, recycleBin: opts.series ? '' : '/Volumes/Media/.recycle', recycleBinCleanupDays: 7, copyUsingHardlinks: !opts.series };
  app.get('/api/v3/config/mediamanagement', (req, res) => res.json(mediaManagementTv));
  app.put('/api/v3/config/mediamanagement', (req, res) => { mediaManagementTv = { ...mediaManagementTv, ...req.body }; res.status(202).json(mediaManagementTv); });
  mountManualImportMock(app, {
    fs, recycled: recycledTv, episodeFiles: { get length() { return episodeFiles.length; }, filter: (fn) => episodeFiles.map((ef) => { const s = series.find((x) => x.id === ef.seriesId); return s ? Object.assign(ef, { path: `${s.path}/${ef.relativePath}` }) : ef; }).filter(fn), find: (fn) => episodeFiles.find(fn), indexOf: (x) => episodeFiles.indexOf(x), splice: (...a) => episodeFiles.splice(...a), push: (x) => episodeFiles.push(x) },
    kind: 'series', library: () => series, getQueue: () => queue, setQueue: (q) => { queue = q; },
    candidates: {
      SABnzbd_nzo_bear0305: [
        { id: 1, path: '/downloads/complete/The.Bear.S03E05.Children.1080p.WEB.h264-ETHEL/the.bear.s03e05.1080p.web.h264-ethel.mkv', relativePath: 'the.bear.s03e05.1080p.web.h264-ethel.mkv', folderName: 'The.Bear.S03E05.Children.1080p.WEB.h264-ETHEL', name: 'the.bear.s03e05.1080p.web.h264-ethel', size: 1598029824, quality: { quality: { id: 6, name: 'WEBDL-1080p' }, revision: { version: 1, real: 0, isRepack: false } }, languages: [{ id: 1, name: 'English' }], series: { id: 2, title: 'The Bear' }, seasonNumber: 3, episodes: [{ id: 5305, seasonNumber: 3, episodeNumber: 5, title: 'Children' }], releaseGroup: 'ETHEL', indexerFlags: 0, releaseType: 'singleEpisode', downloadId: 'SABnzbd_nzo_bear0305', rejections: [] },
        { id: 2, path: '/downloads/complete/The.Bear.S03E05.Children.1080p.WEB.h264-ETHEL/sample.mkv', relativePath: 'sample.mkv', folderName: 'The.Bear.S03E05.Children.1080p.WEB.h264-ETHEL', name: 'sample', size: 26214400, quality: { quality: { id: 6, name: 'WEBDL-1080p' }, revision: { version: 1, real: 0, isRepack: false } }, languages: [{ id: 1, name: 'English' }], series: { id: 2, title: 'The Bear' }, seasonNumber: 3, episodes: [{ id: 5305, seasonNumber: 3, episodeNumber: 5, title: 'Children' }], releaseGroup: 'ETHEL', downloadId: 'SABnzbd_nzo_bear0305', rejections: [{ reason: 'Sample', type: 'permanent' }] },
      ],
      qbit_hash_unknown0101: [
        { id: 3, path: '/downloads/torrents/Unknown.Show.2024.S01E01.720p.HDTV/unknown.show.2024.s01e01.720p.hdtv.mkv', relativePath: 'unknown.show.2024.s01e01.720p.hdtv.mkv', folderName: 'Unknown.Show.2024.S01E01.720p.HDTV', name: 'unknown.show.2024.s01e01.720p.hdtv', size: 734003200, quality: { quality: { id: 4, name: 'HDTV-720p' }, revision: { version: 1, real: 0, isRepack: false } }, languages: [{ id: 1, name: 'English' }], series: null, episodes: [], releaseGroup: '', downloadId: 'qbit_hash_unknown0101', rejections: [{ reason: 'Unknown Series', type: 'permanent' }] },
      ],
      default: [],
    },
  });
  app.get('/api/v3/wanted/missing', (req, res) => res.json({ page: 1, pageSize: 50, totalRecords: 2, records: [
    { id: 7001, seriesId: 1, seasonNumber: 2, episodeNumber: 10, title: 'Cold Harbor', airDateUtc: new Date(Date.now() - 86400000).toISOString(), series: { title: 'Severance' } },
    { id: 7002, seriesId: 2, seasonNumber: 3, episodeNumber: 5, title: 'Children', airDateUtc: new Date(Date.now() - 2 * 86400000).toISOString(), series: { title: 'The Bear' } },
  ] }));
  app.get('/api/v3/wanted/cutoff', (req, res) => res.json({ page: 1, pageSize: 50, totalRecords: 1, records: [
    { id: 7101, seriesId: 3, seasonNumber: 2, episodeNumber: 1, title: 'In Seldon\u2019s Shadow', airDateUtc: new Date(Date.now() - 5 * 86400000).toISOString(), series: { title: 'Foundation' } },
  ] }));
  return app;
}

// Shared Sonarr/Radarr extras: tag usage/rename/delete, custom formats and a
// paged blocklist.
const q = (id, name) => ({ quality: { id, name }, allowed: true, items: [] });
const MOCK_QUALITY_PROFILES = [
  { id: 1, name: 'HD-1080p', upgradeAllowed: true, cutoff: 7, minFormatScore: 0, cutoffFormatScore: 100, minUpgradeFormatScore: 1,
    items: [q(4, 'HDTV-720p'), q(5, 'WEBDL-720p'), q(9, 'HDTV-1080p'), q(3, 'WEBDL-1080p'), q(7, 'Bluray-1080p')],
    formatItems: [{ format: 1, name: 'x265', score: 50 }, { format: 2, name: 'HDR', score: 0 }, { format: 3, name: 'Bad release group', score: -1000 }] },
  { id: 2, name: 'Ultra-HD', upgradeAllowed: true, cutoff: 19, minFormatScore: 10, cutoffFormatScore: 200, minUpgradeFormatScore: 10,
    items: [q(18, 'WEBDL-2160p'), q(19, 'Bluray-2160p')],
    formatItems: [{ format: 1, name: 'x265', score: 25 }, { format: 2, name: 'HDR', score: 150 }, { format: 3, name: 'Bad release group', score: -1000 }] },
  { id: 3, name: 'Any', upgradeAllowed: false, cutoff: 1, minFormatScore: 0, cutoffFormatScore: 0, items: [q(1, 'SDTV'), q(3, 'WEBDL-1080p')], formatItems: [] },
];
const MOCK_CUSTOM_FORMATS = [
  { id: 1, name: 'x265', includeCustomFormatWhenRenaming: false, specifications: [{ name: 'x265/HEVC', implementation: 'ReleaseTitleSpecification', negate: false, required: true, fields: [{ name: 'value', value: '[xh][ .]?265|\\bHEVC(\\b|\\d)' }] }] },
  { id: 2, name: 'HDR', includeCustomFormatWhenRenaming: true, specifications: [{ name: 'HDR', implementation: 'ReleaseTitleSpecification', negate: false, required: false, fields: [{ name: 'value', value: '\\bHDR(\\b|\\d)' }] }, { name: 'Not SDR', implementation: 'SourceSpecification', negate: true, required: false, fields: [] }] },
  { id: 3, name: 'Bad release group', includeCustomFormatWhenRenaming: false, specifications: [{ name: 'Groups', implementation: 'ReleaseGroupSpecification', negate: false, required: false, fields: [{ name: 'value', value: '^(YIFY|aXXo)$' }] }] },
];
function mountArrLibraryExtras(app, kind, state) {
  // Tidy-up demo cases (main instance only): every item gets a profile; The
  // Bear has ended with every episode, Foundation's profile was deleted.
  for (const it of state.getItems() || []) if (it.qualityProfileId == null) it.qualityProfileId = 1;
  if (state.variant !== 'b' && kind === 'series') {
    const bear = (state.getItems() || []).find((x) => x.id === 2); if (bear) bear.status = 'ended';
    const fnd = (state.getItems() || []).find((x) => x.id === 3); if (fnd) fnd.qualityProfileId = 99;
  }
  if (state.variant !== 'b' && kind === 'movie') {
    const fur = (state.getItems() || []).find((x) => x.id === 3); if (fur) { fur.inCinemas = '2024-05-24'; fur.digitalRelease = '2024-06-25'; }
  }
  const idKey = kind === 'series' ? 'seriesIds' : 'movieIds';
  app.get('/api/v3/tag/detail', (req, res) => res.json(state.getTags().map((t) => ({
    ...t, delayProfileIds: [], importListIds: [], notificationIds: [], restrictionIds: [], indexerIds: [], downloadClientIds: [], autoTagIds: [],
    [idKey]: state.getItems().filter((x) => (x.tags || []).includes(t.id)).map((x) => x.id),
  }))));
  app.put('/api/v3/tag/:id', (req, res) => {
    const id = Number(req.params.id);
    const label = String((req.body && req.body.label) || '').trim().toLowerCase();
    if (!label) return res.status(400).json([{ propertyName: 'Label', errorMessage: "'Label' must not be empty." }]);
    const t = state.getTags().find((x) => x.id === id);
    if (!t) return res.status(404).json({ message: 'NotFound' });
    t.label = label;
    res.status(202).json(t);
  });
  app.delete('/api/v3/tag/:id', (req, res) => {
    const id = Number(req.params.id);
    state.setTags(state.getTags().filter((x) => x.id !== id));
    for (const x of state.getItems()) if (Array.isArray(x.tags)) x.tags = x.tags.filter((t) => t !== id);
    res.json({});
  });
  // Per-instance copies so edits in one mock don't leak into another.
  app.locals.profiles = structuredClone(MOCK_QUALITY_PROFILES);
  app.locals.formats = structuredClone(MOCK_CUSTOM_FORMATS);
  app.get('/api/v3/customformat', (req, res) => res.json(app.locals.formats));
  // A second instance (4K / anime) differs a little, like real setups do.
  if (state.variant === 'b') {
    app.locals.formats = app.locals.formats.filter((f) => f.name !== 'Bad release group');
    for (const pr of app.locals.profiles) pr.formatItems = (pr.formatItems || []).filter((fi) => fi.name !== 'Bad release group');
    app.locals.formats.push({ id: 9, name: 'DV (Dolby Vision)', includeCustomFormatWhenRenaming: true, specifications: [{ name: 'DV', implementation: 'ReleaseTitleSpecification', negate: false, required: true, fields: [{ name: 'value', value: '\\b(dv|dovi|dolby[ .]?vision)\\b' }] }] });
    const hdr = app.locals.formats.find((f) => f.name === 'HDR');
    if (hdr) hdr.specifications[0].fields[0].value = '\\bHDR(10)?\\b';
    const hd = app.locals.profiles.find((p) => p.name === 'HD-1080p');
    if (hd) { hd.upgradeAllowed = false; (hd.formatItems.find((f) => f.name === 'x265') || {}).score = 100; }
  }
  // File naming.
  let naming = kind === 'series'
    ? { id: 1, renameEpisodes: true, replaceIllegalCharacters: true, colonReplacementFormat: 4, multiEpisodeStyle: 5, standardEpisodeFormat: '{Series TitleYear} - S{season:00}E{episode:00} - {Episode CleanTitle} [{Quality Full}]', dailyEpisodeFormat: '{Series TitleYear} - {Air-Date} - {Episode CleanTitle}', animeEpisodeFormat: '{Series TitleYear} - S{season:00}E{episode:00} - {absolute:000} - {Episode CleanTitle}', seriesFolderFormat: '{Series TitleYear}', seasonFolderFormat: 'Season {season:00}' }
    : { id: 1, renameMovies: true, replaceIllegalCharacters: true, colonReplacementFormat: 'dash', standardMovieFormat: '{Movie CleanTitle} ({Release Year}) {Quality Full}', movieFolderFormat: '{Movie CleanTitle} ({Release Year})' };
  if (state.variant === 'b') naming = kind === 'series' ? { ...naming, standardEpisodeFormat: '{Series Title} - {season:0}x{episode:00} - {Episode Title}' } : { ...naming, standardMovieFormat: '{Movie CleanTitle} ({Release Year}) {Edition Tags} [{Quality Full}][{MediaInfo VideoDynamicRangeType}]' };
  app.get('/api/v3/config/naming', (req, res) => res.json(naming));
  app.put('/api/v3/config/naming', (req, res) => { naming = { ...naming, ...req.body, id: 1 }; res.status(202).json(naming); });
  // Delay profiles (the default one has order 2147483647 and no tags).
  let delays = [{ id: 1, enableUsenet: true, enableTorrent: true, preferredProtocol: 'usenet', usenetDelay: 0, torrentDelay: state.variant === 'b' ? 120 : 60, bypassIfHighestQuality: true, bypassIfAboveCustomFormatScore: false, minimumCustomFormatScore: 0, order: 2147483647, tags: [] }];
  if (state.variant !== 'b') delays.push({ id: 2, enableUsenet: true, enableTorrent: false, preferredProtocol: 'usenet', usenetDelay: 30, torrentDelay: 0, bypassIfHighestQuality: true, order: 1, tags: [2] });
  const nextId = (l) => Math.max(0, ...l.map((x) => x.id)) + 1;
  app.get('/api/v3/delayprofile', (req, res) => res.json(delays));
  app.post('/api/v3/delayprofile', (req, res) => { const d = { ...req.body, id: nextId(delays), order: delays.length }; delays.push(d); res.status(201).json(d); });
  app.put('/api/v3/delayprofile/:id', (req, res) => { const i = delays.findIndex((d) => d.id === Number(req.params.id)); if (i < 0) return res.status(404).json({ message: 'NotFound' }); delays[i] = { ...delays[i], ...req.body, id: delays[i].id }; res.status(202).json(delays[i]); });
  app.delete('/api/v3/delayprofile/:id', (req, res) => { const d = delays.find((x) => x.id === Number(req.params.id)); if (!d) return res.status(404).json({ message: 'NotFound' }); if (d.order === 2147483647) return res.status(400).json({ message: 'Cannot delete the default delay profile' }); delays = delays.filter((x) => x !== d); res.json({}); });
  // Release profiles (Sonarr v4 / Radarr v5 shape: required/ignored are arrays).
  let releases = [{ id: 1, name: 'No cams', enabled: true, required: [], ignored: ['CAM', 'TS', 'HDTS'], indexerId: 0, tags: [] }];
  if (state.variant === 'b') releases.push({ id: 2, name: 'Only HDR', enabled: true, required: ['HDR', 'DV'], ignored: [], indexerId: 0, tags: [] });
  app.get('/api/v3/releaseprofile', (req, res) => res.json(releases));
  app.post('/api/v3/releaseprofile', (req, res) => { const r = { ...req.body, id: nextId(releases) }; if (!(r.required || []).length && !(r.ignored || []).length) return res.status(400).json([{ propertyName: '', errorMessage: "'Must contain' or 'Must not contain' is required" }]); releases.push(r); res.status(201).json(r); });
  app.put('/api/v3/releaseprofile/:id', (req, res) => { const i = releases.findIndex((r) => r.id === Number(req.params.id)); if (i < 0) return res.status(404).json({ message: 'NotFound' }); releases[i] = { ...releases[i], ...req.body, id: releases[i].id }; res.status(202).json(releases[i]); });
  app.delete('/api/v3/releaseprofile/:id', (req, res) => { releases = releases.filter((r) => r.id !== Number(req.params.id)); res.json({}); });
  app.put('/api/v3/qualityprofile/:id', (req, res) => {
    const id = Number(req.params.id);
    const i = app.locals.profiles.findIndex((p) => p.id === id);
    if (i < 0) return res.status(404).json({ message: 'NotFound' });
    const body = req.body || {};
    const allowedIds = [];
    for (const it of body.items || []) if (it.allowed) allowedIds.push(it.items && it.items.length ? it.id : it.quality && it.quality.id);
    const errors = [];
    if (!String(body.name || '').trim()) errors.push({ propertyName: 'Name', errorMessage: "'Name' must not be empty." });
    if (!allowedIds.length) errors.push({ propertyName: 'Items', errorMessage: 'Must contain at least one allowed quality' });
    else if (!allowedIds.includes(body.cutoff)) errors.push({ propertyName: 'Cutoff', errorMessage: 'Cutoff must be an allowed quality or group' });
    if (errors.length) return res.status(400).json(errors);
    app.locals.profiles[i] = { ...body, id };
    res.status(202).json(app.locals.profiles[i]);
  });
  app.post('/api/v3/customformat', (req, res) => {
    const name = String((req.body && req.body.name) || '').trim();
    if (!name) return res.status(400).json([{ propertyName: 'Name', errorMessage: "'Name' must not be empty." }]);
    if (app.locals.formats.some((f) => f.name.toLowerCase() === name.toLowerCase())) return res.status(400).json([{ propertyName: 'Name', errorMessage: 'Must be unique.' }]);
    const f = { ...req.body, id: Math.max(0, ...app.locals.formats.map((x) => x.id)) + 1 };
    app.locals.formats.push(f);
    // Like Sonarr/Radarr: every profile gets the new format at score 0.
    for (const p of app.locals.profiles) (p.formatItems = p.formatItems || []).push({ format: f.id, name: f.name, score: 0 });
    res.status(201).json(f);
  });
  app.put('/api/v3/customformat/:id', (req, res) => {
    const id = Number(req.params.id);
    const i = app.locals.formats.findIndex((f) => f.id === id);
    if (i < 0) return res.status(404).json({ message: 'NotFound' });
    if (!String((req.body && req.body.name) || '').trim()) return res.status(400).json([{ propertyName: 'Name', errorMessage: "'Name' must not be empty." }]);
    app.locals.formats[i] = { ...req.body, id };
    res.status(202).json(app.locals.formats[i]);
  });
  const titles = kind === 'series'
    ? ['The.Bear.S03E05.1080p.WEB.h264-BADGRP', 'Severance.S02E09.720p.HDTV.x264-LOL', 'Foundation.S02E01.2160p.WEB.H265-FAKE']
    : ['Furiosa.2024.1080p.CAM.x264-YIFY', 'Oppenheimer.2023.2160p.WEB.H265-FAKE', 'Dune.Part.Two.2024.720p.HDTS-aXXo'];
  let blocklist = Array.from({ length: 27 }, (_, i) => ({
    id: i + 1, sourceTitle: `${titles[i % 3]}.${i + 1}`, protocol: i % 2 ? 'usenet' : 'torrent', indexer: i % 2 ? 'NZBGeek' : 'TorrentLeech',
    date: new Date(Date.now() - i * 3600000).toISOString(), message: i % 3 ? 'Manually marked as failed' : 'Download failed: unpack error',
    quality: { quality: { name: i % 3 === 2 ? 'WEBDL-2160p' : 'WEBDL-1080p' } },
  }));
  app.get('/api/v3/blocklist', (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize) || 20));
    res.json({ page, pageSize, totalRecords: blocklist.length, records: blocklist.slice((page - 1) * pageSize, page * pageSize) });
  });
  app.delete('/api/v3/blocklist/bulk', (req, res) => {
    const ids = new Set(((req.body && req.body.ids) || []).map(Number));
    blocklist = blocklist.filter((b) => !ids.has(b.id));
    res.json({});
  });
  app.delete('/api/v3/blocklist/:id', (req, res) => { blocklist = blocklist.filter((b) => b.id !== Number(req.params.id)); res.json({}); });
}

// ---------------- Radarr ----------------
function makeRadarr(opts = {}) {
  const app = express();
  app.use(express.json());
  mountBackupMock(app, 'radarr', 'v3');
  // Setup doctor demo: the main Radarr sees qBittorrent's downloads on the
  // Movies3 disk while its library is on another one (no hard links); it's
  // missing TorrentLeech from Prowlarr. The 4K instance has hard links off.
  const RI = DEMO_PROWLARR_INDEXERS;
  mountDoctorMock(app, 'v3', opts.movies
    ? { clients: [demoDownloadClient(1, 'QBittorrent', { host: 'qbittorrent', port: 8080, category: 'radarr-4k', field: 'movieCategory' })], indexers: [RI.nzbgeek(1), RI.drunkenslug(2), RI.torrentleech(3), RI.oldindexer(4)] }
    : {
      clients: [demoDownloadClient(1, 'QBittorrent', { host: 'qbittorrent', port: 8080, category: 'radarr', field: 'movieCategory' }), demoDownloadClient(2, 'Sabnzbd', { host: 'sabnzbd', port: 8080, category: 'movies', field: 'movieCategory' })],
      mappings: [{ id: 1, host: 'qbittorrent', remotePath: '/downloads/', localPath: '/Volumes/Movies3/downloads/' }, { id: 2, host: 'sabnzbd', remotePath: '/downloads/complete/', localPath: '/data/usenet/' }],
      indexers: [RI.nzbgeek(1), RI.drunkenslug(2)],
    });
  let movies = [
    { id: 1, title: 'Dune: Part Two', year: 2024, tmdbId: 693134, status: 'released', monitored: true, hasFile: true, runtime: 166, overview: 'Paul Atreides unites with the Fremen to wage war against House Harkonnen.', path: 'C:\\Media\\Movies\\Dune Part Two (2024)', rootFolderPath: 'C:\\Media\\Movies', sizeOnDisk: 32212254720, studio: 'Legendary', images: [], movieFile: { id: 101, movieId: 1, relativePath: 'Dune.Part.Two.mkv', quality: { quality: { id: 7, name: 'Bluray-1080p', resolution: 1080 }, revision: { version: 1, real: 0, isRepack: false } }, size: 32212254720, mediaInfo: { videoCodec: 'x264', audioCodec: 'DTS-HD MA', audioChannels: 7.1, audioStreamCount: 2, resolution: '1920x804', runTime: '2:46:12', videoBitrate: 24000000 } } },
    { id: 2, title: 'Oppenheimer', year: 2023, tmdbId: 872585, status: 'released', monitored: true, hasFile: true, runtime: 180, overview: 'The story of J. Robert Oppenheimer and the atomic bomb.', path: 'C:\\Media\\Movies2\\Oppenheimer (2023)', rootFolderPath: 'C:\\Media\\Movies2', sizeOnDisk: 27917287424, studio: 'Universal', images: [], movieFile: { id: 102, movieId: 2, relativePath: 'Oppenheimer.2023.1080p.mkv', quality: { quality: { id: 7, name: 'Bluray-1080p', resolution: 1080 }, revision: { version: 1, real: 0, isRepack: false } }, size: 27917287424, mediaInfo: { videoCodec: 'x265', audioCodec: '', audioChannels: 0, audioStreamCount: 0, resolution: '1920x1080', runTime: '3:00:21' } } },
    { id: 3, title: 'Furiosa', year: 2024, tmdbId: 786892, status: 'released', monitored: true, hasFile: false, runtime: 148, overview: 'The origin story of Furiosa before Mad Max: Fury Road.', path: 'C:\\Media\\Movies3\\Furiosa (2024)', rootFolderPath: 'C:\\Media\\Movies3', sizeOnDisk: 0, studio: 'Warner Bros', images: [] },
    { id: 4, title: 'Dune: Part Two', year: 2024, tmdbId: 693134, status: 'released', monitored: false, hasFile: false, runtime: 166, overview: 'Duplicate entry added on another drive.', path: 'C:\\Media\\Movies2\\Dune Part Two (2024)', rootFolderPath: 'C:\\Media\\Movies2', sizeOnDisk: 0, studio: 'Legendary', images: [] },
    { id: 5, title: '1917', year: 2019, tmdbId: 530915, status: 'released', monitored: true, hasFile: true, runtime: 119, overview: 'Two soldiers race against time to deliver a message.', path: 'C:\\Media\\Movies\\1917 (2019)', rootFolderPath: 'C:\\Media\\Movies', sizeOnDisk: 8589934592, studio: 'DreamWorks', images: [], movieFile: { id: 105, movieId: 5, relativePath: '1917.mkv', quality: { quality: { id: 19, name: 'Bluray-2160p', resolution: 2160 }, revision: { version: 1, real: 0, isRepack: false } }, size: 734003200, mediaInfo: { videoCodec: 'XviD', audioCodec: 'MP3', audioChannels: 2, audioStreamCount: 1, resolution: '720x304', runTime: '0:21:40' } } },
  ];
  if (opts.movies) movies = opts.movies.map((m) => ({ ...m }));
  else movies = fillRadarrLibrary(movies, opts.librarySize);
  let queue = [
    { id: 201, title: 'Furiosa 2024 2160p', movieId: 3, downloadId: 'SABnzbd_nzo_furiosa', status: 'downloading', trackedDownloadStatus: 'ok', trackedDownloadState: 'downloading', size: 21474836480, sizeleft: 6442450944, timeleft: '00:11:38', downloadClient: 'SABnzbd', indexer: 'DrunkenSlug' },
    // Imported, still seeding, with a warning — finished, not a problem.
    { id: 203, title: 'Oppenheimer.2023.2160p', movieId: 2, downloadId: 'qbit_hash_opp', status: 'completed', trackedDownloadStatus: 'warning', trackedDownloadState: 'imported', size: 50000000000, sizeleft: 0, downloadClient: 'qBittorrent', statusMessages: [{ title: 'Seeding', messages: ['Seed ratio not met'] }] },
    { id: 202, title: 'Furiosa.A.Mad.Max.Saga.2024.1080p.BluRay.x264-GROUP', movieId: 3, downloadId: 'qbit_hash_furiosa1080', status: 'completed', trackedDownloadStatus: 'warning', trackedDownloadState: 'importBlocked', size: 12884901888, sizeleft: 0, downloadClient: 'qBittorrent', indexer: 'Torznab', statusMessages: [{ title: 'Furiosa.A.Mad.Max.Saga.2024.1080p.BluRay.x264-GROUP', messages: ['Not a Custom Format upgrade for existing movie file(s)', 'Movie title mismatch, automatic import is not possible'] }] },
  ];

  app.use((req, res, next) => {
    recordCf('radarr', req);
    if (req.headers['x-api-key'] !== 'MOCK_API_KEY') return res.status(401).json({ error: 'Unauthorized (missing X-Api-Key)' });
    next();
  });
  app.get('/__debug', (req, res) => res.json({ cf: cfSeen.radarr || null }));
  app.get('/api/v3/system/status', (req, res) => res.json({ version: '5.11.0.9244', appName: 'Radarr', instanceName: opts.instanceName || 'Radarr (mock)' }));
  const fs = opts.movies ? fsFromItems(movies) : radarrDemoFs();
  let rootFoldersOld = [
    { id: 1, path: 'C:\\Media\\Movies', freeSpace: 0, accessible: false, unmappedFolders: [] },
    { id: 2, path: 'C:\\Media\\Movies2', freeSpace: 0, accessible: false, unmappedFolders: [{ name: '1917.2019.PROPER.1080p.BluRay.x265', path: 'C:\\Media\\Movies2\\1917.2019.PROPER.1080p.BluRay.x265', relativePath: '1917.2019.PROPER.1080p.BluRay.x265' }] },
    { id: 3, path: 'C:\\Media\\Movies3', freeSpace: 0, accessible: false, unmappedFolders: [] },
    { id: 4, path: '/data/movies', freeSpace: 2748779069440, accessible: true, unmappedFolders: [] },
  ];
  let rootFolders = opts.movies
    ? [...new Set(movies.map((x) => x.rootFolderPath).filter(Boolean))].map((path, i) => ({ id: i + 1, path }))
    : rootFoldersOld.map(({ id, path }) => ({ id, path }));
  fs.mount(app, { getItems: () => movies, rootFolders: () => rootFolders });
  app.get('/api/v3/qualityprofile', (req, res) => res.json(app.locals.profiles || MOCK_QUALITY_PROFILES));
  app.get('/api/v3/movie', (req, res) => res.json(movies.map((x) => (x.added ? x : { ...x, added: new Date(Date.now() - (90 + (x.id % 40) * 23) * 86400000).toISOString() }))));
  app.get('/api/v3/calendar', (req, res) => res.json([
    { id: 1, title: 'Furiosa', year: 2024, digitalRelease: new Date(Date.now() + 5 * 86400000).toISOString(), hasFile: false, images: [] },
    { id: 2, title: 'Gladiator II', year: 2024, inCinemas: new Date(Date.now() + 15 * 86400000).toISOString(), hasFile: false, images: [] },
    { id: 3, title: 'Nosferatu', year: 2024, physicalRelease: new Date(Date.now() + 25 * 86400000).toISOString(), hasFile: false, images: [] },
  ]));
  const importsSince = (req, res) => {
    const d = (h) => new Date(Date.now() - h * 3600000).toISOString();
    const since = Date.parse(req.query.date || 0) || 0;
    const mv = (id, mid, title, year, h, q) => ({ id, eventType: 'downloadFolderImported', date: d(h), movieId: mid, quality: { quality: { name: q } }, movie: { id: mid, title, year, images: [{ coverType: 'poster', remoteUrl: `https://image.tmdb.org/t/p/w300/m${mid}.jpg` }] } });
    const all = [mv(201, 1, 'Dune: Part Two', 2024, 1, 'WEBDL-2160p'), mv(202, 3, 'Furiosa', 2024, 70, 'Bluray-1080p'), mv(203, 5, '1917', 2019, 140, 'Bluray-2160p'), { id: 204, eventType: 'downloadFailed', date: d(3), movieId: 2, movie: { id: 2, title: 'Oppenheimer' } }, mv(205, 2, 'Oppenheimer', 2023, 600, 'Bluray-1080p')];
    res.json(all.filter((r) => Date.parse(r.date) >= since));
  };
  app.get('/api/v3/history/since', importsSince);
  app.get('/api/v3/history', (req, res, next) => {
    if (!req.query.eventType) return next();
    importsSince({ query: {} }, { json: (rows) => {
      const want = rows.filter((r) => String(req.query.eventType) !== '3' || r.eventType === 'downloadFolderImported').sort((a, b) => b.date.localeCompare(a.date))
        .map((r) => { const o = { ...r }; if (req.query.includeSeries !== 'true') delete o.series; if (req.query.includeEpisode !== 'true') delete o.episode; if (req.query.includeMovie !== 'true') delete o.movie; return o; });
      const size = Number(req.query.pageSize) || 10; const page = Number(req.query.page) || 1;
      res.json({ page, pageSize: size, totalRecords: want.length, records: want.slice((page - 1) * size, page * size) });
    } });
  });
  app.get('/api/v3/history', (req, res) => res.json({ page: 1, pageSize: 40, totalRecords: 2, records: [
    { id: 1, eventType: 'downloadFolderImported', sourceTitle: 'Dune.Part.Two.2024.2160p.WEB-DL', date: new Date(Date.now() - 3600000).toISOString(), quality: { quality: { name: 'WEBDL-2160p' } }, movie: { title: 'Dune: Part Two' } },
    { id: 2, eventType: 'downloadFailed', sourceTitle: 'Furiosa.2024.1080p.WEBRip', date: new Date(Date.now() - 10800000).toISOString(), quality: { quality: { name: 'WEBRip-1080p' } }, movie: { title: 'Furiosa' } },
  ] }));
  app.get('/api/v3/queue', (req, res) => res.json({ page: 1, pageSize: 20, totalRecords: queue.length, records: queue }));
  app.delete('/api/v3/queue/:id', (req, res) => { queue = queue.filter(q => q.id !== Number(req.params.id)); res.json({}); });
  // Collections (Radarr v4.2+): isExisting comes from the library.
  const COLLECTIONS = [
    { id: 1, title: 'Dune Collection', tmdbId: 726871, movies: [
      { tmdbId: 438631, title: 'Dune', year: 2021, status: 'released', images: [{ coverType: 'poster', remoteUrl: 'https://image.tmdb.org/t/p/w200/d5NXSklXo0qyIYkgV94XAgMIckC.jpg' }] },
      { tmdbId: 693134, title: 'Dune: Part Two', year: 2024, status: 'released', images: [] },
      { tmdbId: 1170608, title: 'Dune: Part Three', year: 2026, status: 'announced', images: [] },
    ] },
    { id: 2, title: 'Mad Max Collection', tmdbId: 8945, movies: [
      { tmdbId: 9659, title: 'Mad Max', year: 1979, status: 'released', images: [] },
      { tmdbId: 8810, title: 'Mad Max 2', year: 1981, status: 'released', images: [] },
      { tmdbId: 9355, title: 'Mad Max Beyond Thunderdome', year: 1985, status: 'released', images: [] },
      { tmdbId: 76341, title: 'Mad Max: Fury Road', year: 2015, status: 'released', images: [] },
      { tmdbId: 786892, title: 'Furiosa: A Mad Max Saga', year: 2024, status: 'released', images: [] },
    ], excluded: [9355] },
    { id: 3, title: 'Gladiator Collection', tmdbId: 1069584, movies: [
      { tmdbId: 98, title: 'Gladiator', year: 2000, status: 'released', images: [] },
      { tmdbId: 558449, title: 'Gladiator II', year: 2024, status: 'released', images: [] },
    ] },
  ];
  app.get('/api/v3/collection', (req, res) => {
    const have = new Set(movies.map((m) => m.tmdbId));
    res.json(COLLECTIONS.map(({ excluded = [], ...c }) => {
      const ms = c.movies.map((m) => ({ ...m, isExisting: have.has(m.tmdbId), isExcluded: excluded.includes(m.tmdbId) }));
      return { ...c, monitored: false, qualityProfileId: 1, rootFolderPath: '', movies: ms, missingMovies: ms.filter((m) => !m.isExisting && !m.isExcluded).length };
    }));
  });
  app.get('/api/v3/movie/lookup', (req, res) => {
    const term = (req.query.term || '').toString();
    const tmdb = /^tmdb:(\d+)$/.exec(term);
    if (tmdb) { const known = COLLECTIONS.flatMap((c) => c.movies).find((m) => m.tmdbId === Number(tmdb[1])); return res.json([known ? { ...known, titleSlug: String(known.tmdbId), overview: '' } : { title: 'The Wild Robot', year: 2024, tmdbId: Number(tmdb[1]), status: 'released', overview: 'A robot learns to survive in the wilderness.', studio: 'DreamWorks', images: [] }]); }
    res.json([
      { title: `${term || 'Gladiator II'}`, year: 2024, tmdbId: 558449, status: 'released', overview: 'Years after Maximus, Lucius must fight for Rome.', studio: 'Paramount', images: [] },
      { title: `${term || 'Gladiator'}`, year: 2000, tmdbId: 98, status: 'released', overview: 'A betrayed Roman general seeks revenge.', studio: 'DreamWorks', images: [] },
    ]);
  });
  app.post('/api/v3/movie', (req, res) => { const m = { id: movies.length + 1, ...req.body, hasFile: false, sizeOnDisk: 0 }; movies.push(m); res.status(201).json(m); });
  app.get('/api/v3/release', (req, res) => res.json(mockReleases('Furiosa')));
  app.post('/api/v3/release', (req, res) => res.status(201).json({ guid: req.body.guid, approved: true }));
  app.get('/api/v3/health', (req, res) => res.json(missingRootsHealth(rootFolders, fs, 'radarr')));
  app.put('/api/v3/movie/editor', (req, res) => {
    const ids = (req.body && req.body.movieIds) || [];
    for (const m of movies) {
      if (!ids.includes(m.id)) continue;
      if (req.body.monitored !== undefined) m.monitored = req.body.monitored;
      if (req.body.qualityProfileId !== undefined) m.qualityProfileId = req.body.qualityProfileId;
      if (Array.isArray(req.body.tags) && req.body.applyTags) { const cur = new Set(m.tags || []); if (req.body.applyTags === 'add') req.body.tags.forEach((t) => cur.add(t)); else if (req.body.applyTags === 'remove') req.body.tags.forEach((t) => cur.delete(t)); else { cur.clear(); req.body.tags.forEach((t) => cur.add(t)); } m.tags = [...cur]; }
      if (req.body.rootFolderPath) { const root = String(req.body.rootFolderPath).replace(/[\\/]+$/, ''); m.rootFolderPath = req.body.rootFolderPath; m.path = `${root}/${m.title} (${m.year})`; }
    }
    res.json(movies.filter((m) => ids.includes(m.id)));
  });
  app.delete('/api/v3/movie/editor', (req, res) => { const ids = (req.body && req.body.movieIds) || []; movies = movies.filter((m) => !ids.includes(m.id)); res.json({}); });
  app.get('/api/v3/movie/:id', (req, res) => { const x = movies.find((m) => m.id === Number(req.params.id)); return x ? res.json(x) : res.status(404).json({ message: 'NotFound' }); });
  app.put('/api/v3/movie/:id', (req, res) => {
    const id = Number(req.params.id);
    const idx = movies.findIndex((m) => m.id === id);
    if (idx === -1) return res.status(404).json({ error: 'not found' });
    movies[idx] = { ...movies[idx], ...req.body, id };
    res.json(movies[idx]);
  });
  app.delete('/api/v3/movie/:id', (req, res) => { movies = movies.filter((m) => m.id !== Number(req.params.id)); res.json({}); });
  let tags = [{ id: 1, label: '4k' }, { id: 2, label: 'kids' }, { id: 3, label: 'keep' }];
  app.get('/api/v3/tag', (req, res) => res.json(tags));
  app.post('/api/v3/tag', (req, res) => { const t = { id: (tags.reduce((mx, x) => Math.max(mx, x.id), 0) || 0) + 1, label: String((req.body && req.body.label) || 'tag') }; tags.push(t); res.status(201).json(t); });
  mountArrLibraryExtras(app, 'movie', { getTags: () => tags, setTags: (t) => { tags = t; }, getItems: () => movies, variant: opts.instanceName ? 'b' : 'a' });
  app.get('/api/v3/rename', (req, res) => res.json([
    { movieFileId: 601, movieId: Number(req.query.movieId) || 1, existingPath: 'furiosa.2024.2160p.mkv', newPath: 'Furiosa A Mad Max Saga (2024) [Bluray-2160p].mkv' },
  ]));
  // Movie files and media management (recycle bin) for upgrades.
  const recycled = [];
  app.locals.recycled = recycled;
  app.delete('/api/v3/moviefile/:id', (req, res) => {
    const m = movies.find((x) => x.movieFile && x.movieFile.id === Number(req.params.id));
    if (!m) return res.status(404).json({ message: 'NotFound' });
    recycled.push(`${m.path}/${m.movieFile.relativePath}`);
    if (fs) fs.remove(`${m.path}/${m.movieFile.relativePath}`);
    delete m.movieFile; m.hasFile = false; m.sizeOnDisk = 0;
    res.json({});
  });
  app.get('/api/v3/moviefile', (req, res) => { const m = movies.find((x) => x.id === Number(req.query.movieId)); res.json(m && m.movieFile ? [m.movieFile] : []); });
  let mediaManagement = { id: 1, recycleBin: opts.movies ? '' : '/Volumes/Movies/.recycle', recycleBinCleanupDays: 7, deleteEmptyFolders: false, autoUnmonitorPreviouslyDownloadedMovies: false, copyUsingHardlinks: !opts.movies };
  app.get('/api/v3/config/mediamanagement', (req, res) => res.json(mediaManagement));
  app.put('/api/v3/config/mediamanagement', (req, res) => { mediaManagement = { ...mediaManagement, ...req.body }; res.status(202).json(mediaManagement); });
  mountManualImportMock(app, {
    fs, recycled,
    kind: 'movie', library: () => movies, getQueue: () => queue, setQueue: (q) => { queue = q; },
    candidates: {
      qbit_hash_furiosa1080: [
        { id: 1, path: '/downloads/torrents/Furiosa.A.Mad.Max.Saga.2024.1080p.BluRay.x264-GROUP/furiosa.2024.1080p.bluray.x264-group.mkv', relativePath: 'furiosa.2024.1080p.bluray.x264-group.mkv', folderName: 'Furiosa.A.Mad.Max.Saga.2024.1080p.BluRay.x264-GROUP', name: 'furiosa.2024.1080p.bluray.x264-group', size: 12751020032, quality: { quality: { id: 7, name: 'Bluray-1080p' }, revision: { version: 1, real: 0, isRepack: false } }, languages: [{ id: 1, name: 'English' }], movie: null, releaseGroup: 'GROUP', indexerFlags: 0, downloadId: 'qbit_hash_furiosa1080', rejections: [{ reason: 'Movie title mismatch', type: 'permanent' }] },
      ],
      default: [],
    },
  });
  app.get('/api/v3/wanted/missing', (req, res) => res.json({ page: 1, pageSize: 50, totalRecords: 1, records: [
    { id: 8001, title: 'Furiosa', year: 2024, digitalRelease: new Date(Date.now() - 3 * 86400000).toISOString() },
  ] }));
  app.get('/api/v3/wanted/cutoff', (req, res) => res.json({ page: 1, pageSize: 50, totalRecords: 0, records: [] }));
  return app;
}

// ---------------- Overseerr ----------------
function makeOverseerr() {
  const app = express();
  app.use(express.json());
  let requests = [
    { id: 11, status: 1, type: 'movie', createdAt: new Date(Date.now() - 3600000).toISOString(), media: { tmdbId: 533535, status: 3, title: 'Deadpool & Wolverine', mediaType: 'movie' }, requestedBy: { displayName: 'cameron', email: 'cameron@example.com' } },
    { id: 12, status: 1, type: 'tv', createdAt: new Date(Date.now() - 7200000).toISOString(), seasons: [{ seasonNumber: 1 }, { seasonNumber: 2 }], media: { tmdbId: 94997, status: 2, title: 'House of the Dragon', mediaType: 'tv' }, requestedBy: { displayName: 'guest', email: 'guest@example.com' } },
    { id: 13, status: 2, type: 'movie', createdAt: new Date(Date.now() - 172800000).toISOString(), media: { tmdbId: 786892, status: 5, title: 'Furiosa', mediaType: 'movie' }, requestedBy: { displayName: 'cameron', email: 'cameron@example.com' } },
    { id: 14, status: 2, type: 'movie', createdAt: new Date(Date.now() - 5400000).toISOString(), media: { tmdbId: 693134, status: 3, mediaType: 'movie', externalServiceId: 4 }, requestedBy: { displayName: 'alex' } },
    // Older, available requests with Plex rating keys (for "never watched").
    { id: 21, status: 2, type: 'movie', createdAt: new Date(Date.now() - 210 * 86400000).toISOString(), media: { id: 501, tmdbId: 872585, status: 5, mediaType: 'movie', ratingKey: '10', mediaAddedAt: new Date(Date.now() - 200 * 86400000).toISOString() }, requestedBy: { id: 4, displayName: 'jamie', plexUsername: 'jamie', plexId: 4004 } },
    { id: 22, status: 2, type: 'movie', createdAt: new Date(Date.now() - 160 * 86400000).toISOString(), media: { id: 502, tmdbId: 530915, status: 5, mediaType: 'movie', ratingKey: '15', mediaAddedAt: new Date(Date.now() - 150 * 86400000).toISOString() }, requestedBy: { id: 3, displayName: 'alex', plexUsername: 'alex', plexId: 3003 } },
    { id: 23, status: 2, type: 'tv', createdAt: new Date(Date.now() - 320 * 86400000).toISOString(), seasons: [{ seasonNumber: 1 }], media: { id: 503, tmdbId: 93740, tvdbId: 358711, status: 5, mediaType: 'tv', ratingKey: '30', mediaAddedAt: new Date(Date.now() - 300 * 86400000).toISOString() }, requestedBy: { id: 4, displayName: 'jamie', plexUsername: 'jamie', plexId: 4004 } },
    { id: 24, status: 2, type: 'tv', createdAt: new Date(Date.now() - 130 * 86400000).toISOString(), seasons: [{ seasonNumber: 1 }], media: { id: 504, tmdbId: 136315, tvdbId: 388477, status: 4, mediaType: 'tv', ratingKey: '40', mediaAddedAt: new Date(Date.now() - 120 * 86400000).toISOString() }, requestedBy: { id: 5, displayName: 'guest', plexUsername: 'guest', plexId: 5005 } },
    { id: 25, status: 2, type: 'movie', createdAt: new Date(Date.now() - 20 * 86400000).toISOString(), media: { id: 505, tmdbId: 786892, status: 5, mediaType: 'movie', ratingKey: '16', mediaAddedAt: new Date(Date.now() - 10 * 86400000).toISOString() }, requestedBy: { id: 3, displayName: 'alex', plexUsername: 'alex', plexId: 3003 } },
    { id: 15, status: 2, type: 'tv', createdAt: new Date(Date.now() - 86400000).toISOString(), seasons: [{ seasonNumber: 2 }], media: { tmdbId: 95396, tvdbId: 371980, status: 3, mediaType: 'tv', externalServiceId: 1 }, requestedBy: { displayName: 'jamie' } },
    { id: 16, status: 2, type: 'tv', createdAt: new Date(Date.now() - 4000000).toISOString(), media: { tmdbId: 136315, tvdbId: 388477, status: 3, mediaType: 'tv' }, requestedBy: { displayName: 'alex' } },
  ];

  app.use((req, res, next) => {
    recordCf('overseerr', req);
    if (req.headers['x-api-key'] !== 'MOCK_API_KEY') return res.status(401).json({ error: 'Unauthorized (missing X-Api-Key)' });
    next();
  });
  app.get('/__debug', (req, res) => res.json({ cf: cfSeen.overseerr || null }));
  app.get('/api/v1/status', (req, res) => res.json({ version: '1.33.2', commitTag: 'mock', updateAvailable: false }));
  let issues = [
    { id: 1, issueType: 1, status: 1, problemSeason: 2, problemEpisode: 10, createdAt: new Date(Date.now() - 3600000).toISOString(), media: { mediaType: 'tv', tmdbId: 95396, title: 'Severance' }, createdBy: { displayName: 'cameron' }, comments: [{ id: 1, message: 'Audio desyncs about 20 minutes in.', user: { displayName: 'cameron' }, createdAt: new Date(Date.now() - 3600000).toISOString() }] },
    { id: 2, issueType: 3, status: 1, createdAt: new Date(Date.now() - 7200000).toISOString(), media: { mediaType: 'movie', tmdbId: 533535, title: 'Deadpool & Wolverine' }, createdBy: { displayName: 'guest' }, comments: [] },
    { id: 3, issueType: 2, status: 2, createdAt: new Date(Date.now() - 172800000).toISOString(), media: { mediaType: 'movie', tmdbId: 786892, title: 'Furiosa' }, createdBy: { displayName: 'cameron' }, comments: [{ id: 1, message: 'Fixed after re-grab.', user: { displayName: 'admin' }, createdAt: new Date(Date.now() - 90000000).toISOString() }] },
  ];
  app.get('/api/v1/issue', (req, res) => { let r = issues; if (req.query.filter === 'open') r = issues.filter((i) => i.status === 1); res.json({ pageInfo: { pages: 1, pageSize: 50, results: r.length, page: 1 }, results: r }); });
  app.get('/api/v1/issue/:id', (req, res) => { const i = issues.find((x) => x.id === Number(req.params.id)); if (!i) return res.status(404).json({ error: 'not found' }); res.json(i); });
  app.post('/api/v1/issue/:id/comment', (req, res) => { const i = issues.find((x) => x.id === Number(req.params.id)); if (!i) return res.status(404).json({ error: 'not found' }); const c = { id: (i.comments.reduce((m, x) => Math.max(m, x.id), 0) || 0) + 1, message: String((req.body && req.body.message) || ''), user: { displayName: 'you' }, createdAt: new Date().toISOString() }; i.comments.push(c); res.status(200).json(c); });
  app.post('/api/v1/issue/:id/resolved', (req, res) => { const i = issues.find((x) => x.id === Number(req.params.id)); if (i) i.status = 2; res.json(i || {}); });
  app.post('/api/v1/issue/:id/reopen', (req, res) => { const i = issues.find((x) => x.id === Number(req.params.id)); if (i) i.status = 1; res.json(i || {}); });
  const mockCast = [
    { id: 1, name: 'Jane Doe', character: 'Lead Role', profilePath: null, order: 0 },
    { id: 2, name: 'John Smith', character: 'Supporting Role', profilePath: null, order: 1 },
    { id: 3, name: 'Alex Rivera', character: 'Antagonist', profilePath: null, order: 2 },
    { id: 4, name: 'Sam Chen', character: 'Sidekick', profilePath: null, order: 3 },
  ];
  // TMDB-style detail overrides keyed by tmdbId so the dashboard/detail popout
  // can render real titles, years and posters for the seeded requests/issues.
  const tmdbDetails = {
    533535: { title: 'Deadpool & Wolverine', releaseDate: '2024-07-24', posterPath: '/kqjL17yufvn9OVLyXYpvtyrFfak.jpg' },
    786892: { title: 'Furiosa: A Mad Max Saga', releaseDate: '2024-05-22', posterPath: '/iADOJ8Zymht2JPMoy3R7xceZprc.jpg' },
    94997: { name: 'House of the Dragon', firstAirDate: '2022-08-21', posterPath: '/z2yahl2uefxDCl0nogcRBstwruJ.jpg' },
    95396: { name: 'Severance', firstAirDate: '2022-02-18', posterPath: '/lFf6LLrQjYldcZItzOkGmMMigP7.jpg' },
  };
  app.get('/api/v1/movie/:id/ratingscombined', (req, res) => res.json({
    rt: { title: 'Mock Movie', year: 2024, url: 'https://www.rottentomatoes.com/m/mock_movie', criticsScore: 92, criticsRating: 'Certified Fresh', audienceScore: 88, audienceRating: 'Upright' },
    imdb: { title: 'Mock Movie', url: 'https://www.imdb.com/title/tt0000001', criticsScore: 8.1 },
  }));
  app.get('/api/v1/tv/:id/ratings', (req, res) => res.json({ title: 'Mock Show', year: 2023, url: 'https://www.rottentomatoes.com/tv/mock_show', criticsScore: 54, criticsRating: 'Rotten', audienceScore: 71, audienceRating: 'Upright' }));
  app.get('/api/v1/movie/:id', (req, res) => res.json({
    id: Number(req.params.id), title: 'Mock Movie', overview: 'A thrilling mock movie used to demonstrate the details popout with description, ratings, genres and cast.',
    voteAverage: 7.8, voteCount: 4213, genres: [{ name: 'Action' }, { name: 'Sci-Fi' }], runtime: 132, releaseDate: '2024-05-01',
    tagline: 'Every demo has its hero.', status: 'Released', posterPath: null, backdropPath: null, credits: { cast: mockCast },
    watchProviders: [{ iso_3166_1: 'US', link: 'https://www.themoviedb.org/movie/1/watch?locale=US', flatrate: [{ id: 8, name: 'Netflix', logoPath: null, displayPriority: 1 }, { id: 15, name: 'Hulu', logoPath: null, displayPriority: 2 }], rent: [{ id: 2, name: 'Apple TV', logoPath: null, displayPriority: 3 }], buy: [{ id: 2, name: 'Apple TV', logoPath: null, displayPriority: 3 }, { id: 10, name: 'Amazon Video', logoPath: null, displayPriority: 4 }] }],

    ...(tmdbDetails[Number(req.params.id)] || {}),
  }));
  app.get('/api/v1/tv/:id', (req, res) => res.json({
    id: Number(req.params.id), name: 'Mock Show', overview: 'A gripping mock series used to demonstrate the details popout including seasons and cast.',
    voteAverage: 8.4, voteCount: 2890, genres: [{ name: 'Drama' }, { name: 'Mystery' }], episodeRunTime: [50], firstAirDate: '2023-09-10',
    tagline: 'Binge responsibly.', status: 'Returning Series', posterPath: null, backdropPath: null,
    seasons: [{ seasonNumber: 1, name: 'Season 1', episodeCount: 8 }, { seasonNumber: 2, name: 'Season 2', episodeCount: 10 }],
    mediaInfo: { status: 4, seasons: [{ seasonNumber: 1, status: 5 }] },
    externalIds: { tvdbId: 371028 },
    credits: { cast: mockCast },
    ...(tmdbDetails[Number(req.params.id)] || {}),
  }));
  app.get('/api/v1/request', (req, res) => {
    const filter = req.query.filter;
    let results = requests;
    if (filter === 'pending') results = requests.filter(r => r.status === 1);
    res.json({ pageInfo: { pages: 1, pageSize: 20, results: results.length, page: 1 }, results });
  });
  app.delete('/api/v1/request/:id', (req, res) => { requests = requests.filter((r) => r.id !== Number(req.params.id)); res.status(204).end(); });
  app.delete('/api/v1/media/:id', (req, res) => { requests = requests.filter((r) => !(r.media && r.media.id === Number(req.params.id))); res.status(204).end(); });
  app.get('/api/v1/request/count', (req, res) => res.json({ total: requests.length, pending: requests.filter(r => r.status === 1).length, approved: requests.filter(r => r.status === 2).length, declined: requests.filter(r => r.status === 3).length }));
  app.get('/api/v1/media', (req, res) => {
    const results = [
      { id: 201, mediaType: 'movie', tmdbId: 786892, status: 5, mediaAddedAt: new Date(Date.now() - 2 * 3600000).toISOString() },
      { id: 202, mediaType: 'tv', tmdbId: 95396, status: 5, mediaAddedAt: new Date(Date.now() - 8 * 3600000).toISOString() },
      { id: 203, mediaType: 'movie', tmdbId: 533535, status: 5, mediaAddedAt: new Date(Date.now() - 26 * 3600000).toISOString() },
    ];
    res.json({ pageInfo: { pages: 1, pageSize: 60, results: results.length, page: 1 }, results });
  });
  app.post('/api/v1/request/:id/:action', (req, res) => {
    const r = requests.find(x => x.id === Number(req.params.id));
    if (!r) return res.status(404).json({ error: 'not found' });
    if (req.params.action === 'approve') r.status = 2;
    if (req.params.action === 'decline') r.status = 3;
    res.json(r);
  });
  app.get('/api/v1/discover/trending', (req, res) => res.json({ page: 1, totalPages: 1, totalResults: 4, results: [
    { id: 533535, mediaType: 'movie', title: 'Deadpool & Wolverine', overview: 'Wade teams up with Wolverine.', releaseDate: '2024-07-24', voteAverage: 7.7, posterPath: null, mediaInfo: { status: 5 } },
    { id: 94997, mediaType: 'tv', name: 'House of the Dragon', overview: 'The Targaryen civil war.', firstAirDate: '2022-08-21', voteAverage: 8.4, posterPath: null, mediaInfo: { status: 2 } },
    { id: 1184918, mediaType: 'movie', title: 'The Wild Robot', overview: 'A robot learns to survive.', releaseDate: '2024-09-12', voteAverage: 8.3, posterPath: null },
    { id: 94605, mediaType: 'tv', name: 'Arcane', overview: 'League champions origins.', firstAirDate: '2021-11-06', voteAverage: 8.7, posterPath: null },
  ] }));
  // A small catalogue so searches return sensible matches.
  const CATALOG = [
    { id: 438631, mediaType: 'movie', title: 'Dune', releaseDate: '2021-09-15', overview: 'Paul Atreides travels to Arrakis.' },
    { id: 693134, mediaType: 'movie', title: 'Dune: Part Two', releaseDate: '2024-02-27', overview: 'Paul unites with the Fremen.', mediaInfo: { status: 5 } },
    { id: 90228, mediaType: 'tv', name: 'Dune: Prophecy', firstAirDate: '2024-11-17', overview: 'The Bene Gesserit, 10,000 years before Paul.' },
    { id: 1184918, mediaType: 'movie', title: 'The Wild Robot', releaseDate: '2024-09-12', overview: 'A robot learns to survive in the wilderness.' },
    { id: 94605, mediaType: 'tv', name: 'Arcane', firstAirDate: '2021-11-06', overview: 'The origins of two iconic League champions.' },
    { id: 95396, mediaType: 'tv', name: 'Severance', firstAirDate: '2022-02-17', overview: 'Work and life, surgically divided.', mediaInfo: { status: 4 } },
    { id: 1064213, mediaType: 'movie', title: 'Anora', releaseDate: '2024-10-14', overview: 'A young sex worker marries the son of an oligarch.' },
  ];
  const seerrUsers = [{ id: 1, displayName: 'cameron', plexUsername: 'cameron' }, { id: 3, displayName: 'alex', plexUsername: 'alex' }, { id: 4, displayName: 'jamie', plexUsername: 'jamie' }];
  app.get('/api/v1/user', (req, res) => res.json({ pageInfo: { pages: 1, results: seerrUsers.length }, results: seerrUsers }));
  app.get('/api/v1/search', (req, res) => {
    const q = (req.query.query || '').toString().toLowerCase().trim();
    const words = q.split(/\s+/).filter(Boolean);
    let results = CATALOG.filter((c) => words.every((w) => String(c.title || c.name).toLowerCase().includes(w)));
    if (!q) results = CATALOG.slice(3, 5);
    results = results.map((c) => {
      const r = requests.find((x) => x.media && x.media.tmdbId === c.id && x.type === c.mediaType);
      return r && !c.mediaInfo ? { ...c, mediaInfo: { status: r.media.status || 2 } } : c;
    });
    res.json({ page: 1, totalPages: 1, totalResults: results.length, results });
  });
  app.get('/api/v1/request/:id', (req, res, next) => { if (!/^\d+$/.test(req.params.id)) return next(); const r = requests.find((x) => x.id === Number(req.params.id)); return r ? res.json(r) : res.status(404).json({ message: 'Request not found' }); });
  app.post('/api/v1/request', (req, res) => {
    const b = req.body || {};
    if (!b.mediaType || !b.mediaId) return res.status(400).json({ message: 'mediaType and mediaId are required' });
    if (requests.some((x) => x.media && x.media.tmdbId === b.mediaId && x.type === b.mediaType)) return res.status(409).json({ message: 'Request for this media already exists.' });
    const cat = CATALOG.find((c) => c.id === b.mediaId) || {};
    const user = seerrUsers.find((u) => u.id === b.userId) || { id: 1, displayName: 'cameron' };
    const nr = { id: 100 + requests.length, status: 1, type: b.mediaType, createdAt: new Date().toISOString(), seasons: b.mediaType === 'tv' ? [{ seasonNumber: 1 }] : undefined, media: { tmdbId: b.mediaId, status: 2, mediaType: b.mediaType, title: cat.title || cat.name }, requestedBy: user };
    requests.push(nr);
    res.status(201).json(nr);
  });
  app.get('/api/v1/service/:type', (req, res) => res.json([
    { id: 0, name: req.params.type, is4k: false, isDefault: true, activeProfileId: 1, activeDirectory: '/data/media' },
  ]));
  app.get('/api/v1/service/:type/:id', (req, res) => res.json({
    server: { id: 0, name: req.params.type, is4k: false, isDefault: true, activeProfileId: 1, activeDirectory: '/data/media' },
    profiles: [{ id: 1, name: 'HD-1080p' }, { id: 2, name: 'Ultra-HD' }, { id: 3, name: 'Any' }],
    rootFolders: [{ id: 1, path: '/data/media', freeSpace: 1099511627776 }, { id: 2, path: '/data/media-4k', freeSpace: 2199023255552 }],
    tags: [],
  }));
  return app;
}

// ---------------- SABnzbd ----------------
function makeSab() {
  const app = express();
  app.use(express.json());
  let paused = false;
  let speedlimit = '100';
  let slots = [
    { nzo_id: 'SABnzbd_nzo_a1', filename: 'Furiosa.2024.2160p.WEB-DL', status: 'Downloading', percentage: '70', mb: '20480', mbleft: '6144', timeleft: '0:11:38', cat: 'movies', priority: 'Normal', sizeleft: '6.0 GB', size: '20.0 GB' },
    { nzo_id: 'SABnzbd_nzo_b2', filename: 'Severance.S02E10.1080p.WEB', status: 'Queued', percentage: '0', mb: '2048', mbleft: '2048', timeleft: '0:00:00', cat: 'tv', priority: 'High', sizeleft: '2.0 GB', size: '2.0 GB' },
  ];
  let history = [
    { nzo_id: 'SABnzbd_nzo_h1', name: 'Dune.Part.Two.2024.2160p', status: 'Completed', category: 'movies', storage: '/downloads/complete/movies/Dune.Part.Two.2024.2160p', size: '30.0 GB', bytes: 32212254720, completed: Math.floor((Date.now() - 3600000) / 1000), download_time: 842, storage: '/data/movies' },
    { nzo_id: 'SABnzbd_nzo_h2', name: 'The.Bear.S03E08.1080p', status: 'Failed', category: 'tv', size: '1.8 GB', bytes: 1932735283, completed: Math.floor((Date.now() - 9000000) / 1000), fail_message: 'Unpack failed', storage: '' },
  ];

  app.use((req, res, next) => {
    recordCf('sabnzbd', req);
    if (req.query.apikey !== 'MOCK_API_KEY') return res.status(401).json({ status: false, error: 'API Key Incorrect' });
    next();
  });
  app.get('/__debug', (req, res) => res.json({ cf: cfSeen.sabnzbd || null }));
  app.all('/api', (req, res) => {
    const mode = req.query.mode;
    if (mode === 'version') return res.json({ version: '4.3.2' });
    // Add an NZB by URL (used by the Indexer "Send to SABnzbd" action).
    if (mode === 'addurl') {
      const id = 'SABnzbd_nzo_' + Math.random().toString(36).slice(2, 8);
      slots.unshift({ nzo_id: id, filename: req.query.nzbname || 'Indexer NZB', status: 'Queued', percentage: '0', mb: '700', mbleft: '700', timeleft: '0:00:00', cat: req.query.cat || '*', priority: 'Normal', sizeleft: '700 MB', size: '700 MB' });
      return res.json({ status: true, nzo_ids: [id] });
    }
    // Delete must be checked before the queue-list branch (SAB uses mode=queue&name=delete).
    if (mode === 'queue' && req.query.name === 'delete') { const id = req.query.value; slots = slots.filter(s => s.nzo_id !== id); return res.json({ status: true }); }
    if (mode === 'history' && req.query.name === 'delete') { const id = req.query.value; history = history.filter(s => s.nzo_id !== id); return res.json({ status: true }); }
    if (mode === 'queue') {
      const totalMbLeft = slots.reduce((a, s) => a + Number(s.mbleft), 0);
      return res.json({ queue: {
        status: paused ? 'Paused' : 'Downloading', paused, speedlimit, speedlimit_abs: (Number(speedlimit) / 100 * 12500000).toFixed(0),
        kbpersec: paused ? '0.0' : '11534.2', speed: paused ? '0 ' : '11.3 M', sizeleft: `${(totalMbLeft / 1024).toFixed(1)} GB`, size: '22.0 GB',
        timeleft: paused ? '0:00:00' : '0:11:38', mbleft: String(totalMbLeft), mb: '22528', noofslots: slots.length, diskspace1: '512.4', diskspacetotal1: '4096.0',
        slots,
      } });
    }
    if (mode === 'history') {
      return res.json({ history: { noofslots: history.length, day_size: '30.0 G', week_size: '210.0 G', month_size: '900.0 G', total_size: '4.2 T', slots: history } });
    }
    if (mode === 'pause') { paused = true; return res.json({ status: true }); }
    if (mode === 'resume') { paused = false; return res.json({ status: true }); }
    if (mode === 'config' && req.query.name === 'speedlimit') { speedlimit = String(req.query.value || '100'); return res.json({ status: true }); }
    return res.json({ status: true, echo: mode });
  });
  return app;
}

// ---------------- Tautulli ----------------
function makeTautulli() {
  const app = express();
  let sessions = [
    { session_key: '1', session_id: 'sess-1', user: 'cameron', friendly_name: 'cameron', full_title: 'Dune: Part Two', title: 'Dune: Part Two', grandparent_title: '', thumb: '/library/metadata/1/thumb/1', grandparent_thumb: '', media_type: 'movie', state: 'playing', progress_percent: '42', player: 'Apple TV', platform: 'tvOS', quality_profile: '4k', video_resolution: '4k', transcode_decision: 'direct play', stream_video_resolution: '4k', bandwidth: '25000' },
    { session_key: '2', session_id: 'sess-2', user: 'guest', friendly_name: 'Guest', full_title: 'The Bear - S03E01 - Tomorrow', title: 'Tomorrow', grandparent_title: 'The Bear', thumb: '/library/metadata/2/thumb/2', grandparent_thumb: '/library/metadata/3/thumb/3', media_type: 'episode', state: 'paused', progress_percent: '73', player: 'Chrome', platform: 'Chrome', quality_profile: '1080p', video_resolution: '1080', transcode_decision: 'transcode', stream_video_resolution: '720', bandwidth: '4000' },
  ];
  const wrap = (data) => ({ response: { result: 'success', message: null, data } });
  app.use((req, res, next) => {
    if (req.query.apikey !== 'MOCK_API_KEY') return res.json({ response: { result: 'error', message: 'Invalid apikey' } });
    next();
  });
  app.get('/__debug', (req, res) => res.json({ cf: cfSeen.tautulli || null }));
  app.all('/api/v2', (req, res) => {
    recordCf('tautulli', req);
    const cmd = req.query.cmd;
    if (cmd === 'status') return res.json(wrap({ result: 'success' }));
    if (cmd === 'get_tautulli_info') return res.json(wrap({ tautulli_version: 'v2.15.2', tautulli_install_type: 'docker', tautulli_branch: 'master' }));
    if (cmd === 'get_activity') {
      const total = sessions.reduce((a, s) => a + Number(s.bandwidth), 0);
      return res.json(wrap({ stream_count: String(sessions.length), stream_count_direct_play: 1, stream_count_transcode: 1, total_bandwidth: total, wan_bandwidth: total, sessions }));
    }
    if (cmd === 'terminate_session') {
      const id = req.query.session_id, key = req.query.session_key;
      sessions = sessions.filter((s) => s.session_id !== id && s.session_key !== key);
      return res.json(wrap({}));
    }
    // Library media info: plays and last played per title, as Tautulli's
    // Libraries → Media Info table (rating keys match the demo Plex).
    if (cmd === 'get_libraries') return res.json(wrap([
      { section_id: '1', section_name: 'Movies', section_type: 'movie', count: '3', is_active: 1 },
      { section_id: '2', section_name: 'TV Shows', section_type: 'show', count: '3', parent_count: '9', child_count: '66', is_active: 1 },
    ]));
    if (cmd === 'get_library_media_info') {
      const ago = (d) => Math.floor((Date.now() - d * 86400000) / 1000);
      const GB = 2 ** 30;
      const row = (o) => ({ section_type: o.media_type === 'show' ? 'show' : 'movie', added_at: String(ago(200)), thumb: '', container: 'mkv', ...o, rating_key: String(o.rating_key), file_size: String(o.file_size || 0) });
      const media = {
        1: [row({ section_id: 1, media_type: 'movie', rating_key: 11, title: 'Dune: Part Two', year: '2024', file_size: 30 * GB, play_count: 3, last_played: ago(420) }),
          row({ section_id: 1, media_type: 'movie', rating_key: 15, title: '1917', year: '1917', file_size: 8 * GB, play_count: 0, last_played: null }),
          row({ section_id: 1, media_type: 'movie', rating_key: 10, title: 'Oppenheimer', year: '2023', file_size: 26 * GB, play_count: 2, last_played: ago(3) })],
        2: [row({ section_id: 2, media_type: 'show', rating_key: 20, title: 'Severance', year: '2022', play_count: 6, last_played: ago(1) }),
          row({ section_id: 2, media_type: 'show', rating_key: 30, title: 'Foundation', year: '1951', play_count: 4, last_played: ago(300) }),
          row({ section_id: 2, media_type: 'show', rating_key: 40, title: 'The Bear', year: '2022', play_count: 12, last_played: ago(2) })],
      };
      const list = media[String(req.query.section_id)] || [];
      const start = Number(req.query.start) || 0; const length = Number(req.query.length) || 25;
      return res.json(wrap({ draw: 1, recordsTotal: list.length, recordsFiltered: list.length, data: list.slice(start, start + length) }));
    }
    if (cmd === 'get_users') return res.json(wrap(DEMO_TAUTULLI_USERS));
    if (cmd === 'pms_image_proxy') return res.type('image/svg+xml').send(demoPosterSvg(req.query.img));
    // A date range (Year in review) gets the demo's year of history.
    if (cmd === 'get_history' && req.query.before) return res.json(wrap(demoHistoryPage(req.query)));
    if (cmd === 'get_history') {
      const ago = (d) => Math.floor((Date.now() - d * 86400000) / 1000);
      let data = [
        { full_title: 'Oppenheimer', title: 'Oppenheimer', year: 2023, user: 'cameron', friendly_name: 'cameron', user_id: 1001, rating_key: 10, player: 'Apple TV', media_type: 'movie', thumb: '/library/metadata/10/thumb/10', date: Math.floor((Date.now() - 3600000) / 1000), watched_status: 1, percent_complete: 100, duration: 10800 },
        { full_title: 'Dune: Part Two', title: 'Dune: Part Two', year: 2024, user: 'alex', friendly_name: 'alex', user_id: 3003, rating_key: 12, player: 'Roku', media_type: 'movie', date: ago(420), watched_status: 1, percent_complete: 100, duration: 9960 },
        { full_title: 'The Bear - S03E01', grandparent_title: 'The Bear', user: 'cameron', friendly_name: 'cameron', user_id: 1001, rating_key: 41, grandparent_rating_key: 40, player: 'iOS', media_type: 'episode', date: ago(2), watched_status: 1, percent_complete: 100, duration: 1800 },
        { full_title: 'Foundation - S01E01', grandparent_title: 'Foundation', user: 'jamie', friendly_name: 'jamie', user_id: 4004, rating_key: 31, grandparent_rating_key: 30, player: 'Apple TV', media_type: 'episode', date: ago(300), watched_status: 1, percent_complete: 100, duration: 3600 },
        { full_title: 'Severance - S02E01', user: 'guest', friendly_name: 'Guest', user_id: 5005, rating_key: 21, grandparent_rating_key: 20, player: 'Chrome', media_type: 'episode', grandparent_thumb: '/library/metadata/11/thumb/11', date: Math.floor((Date.now() - 86400000) / 1000), watched_status: 1, percent_complete: 96, duration: 3600 },
      ];
      data.forEach((d, i) => { d.id = d.id || i + 1; d.transcode_decision = d.transcode_decision || 'direct play'; });
      // Plays that transcode, for the Transcodes tab (users chosen so the
      // "never watched" demo is unchanged).
      const tx = (id, o) => ({ id, user: 'cameron', friendly_name: 'cameron', user_id: 1001, player: 'Chrome', platform: 'Chrome', percent_complete: 100, watched_status: 1, date: ago(id % 20), transcode_decision: 'transcode', ...o });
      data.push(
        tx(101, { full_title: 'Dune: Part Two', title: 'Dune: Part Two', year: 2024, media_type: 'movie', rating_key: 12 }),
        tx(102, { full_title: 'Dune: Part Two', title: 'Dune: Part Two', year: 2024, media_type: 'movie', rating_key: 12, player: 'Roku', platform: 'Roku' }),
        tx(103, { full_title: 'Dune: Part Two', title: 'Dune: Part Two', year: 2024, media_type: 'movie', rating_key: 12 }),
        tx(104, { full_title: 'Oppenheimer', title: 'Oppenheimer', year: 2023, media_type: 'movie', rating_key: 10, player: 'Apple TV', platform: 'tvOS' }),
        tx(105, { full_title: 'Oppenheimer', title: 'Oppenheimer', year: 2023, media_type: 'movie', rating_key: 10, player: 'Apple TV', platform: 'tvOS' }),
        tx(106, { full_title: 'Severance - S02E02', grandparent_title: 'Severance', media_type: 'episode', rating_key: 22, grandparent_rating_key: 20, player: 'Android', platform: 'Android', user: 'alex', friendly_name: 'alex', user_id: 3003 }),
        tx(107, { full_title: 'Severance - S02E03', grandparent_title: 'Severance', media_type: 'episode', rating_key: 23, grandparent_rating_key: 20, player: 'Android', platform: 'Android', user: 'alex', friendly_name: 'alex', user_id: 3003 }),
        tx(108, { full_title: 'The Bear - S03E02', grandparent_title: 'The Bear', media_type: 'episode', rating_key: 42, grandparent_rating_key: 40 }),
        { ...tx(109, { full_title: 'The Bear - S03E03', grandparent_title: 'The Bear', media_type: 'episode', rating_key: 43, grandparent_rating_key: 40, player: 'Apple TV', platform: 'tvOS' }), transcode_decision: 'direct play' },
      );
      if (req.query.after) data = data.filter((d) => d.date * 1000 >= Date.parse(req.query.after));
      if (req.query.rating_key) data = data.filter((d) => String(d.rating_key) === String(req.query.rating_key));
      if (req.query.grandparent_rating_key) data = data.filter((d) => String(d.grandparent_rating_key) === String(req.query.grandparent_rating_key));
      return res.json(wrap({ recordsFiltered: data.length, recordsTotal: data.length, data }));
    }
    if (cmd === 'get_stream_data') {
      const base = { container: 'mkv', stream_container: 'mkv', video_codec: 'h264', stream_video_codec: 'h264', audio_codec: 'eac3', stream_audio_codec: 'eac3', video_decision: 'copy', audio_decision: 'copy', subtitle_decision: '', bitrate: 12000, stream_bitrate: 12000, video_full_resolution: '1080p', stream_video_full_resolution: '1080p', quality_profile: 'Original' };
      const rows = {
        101: { video_codec: 'hevc', stream_video_codec: 'h264', video_decision: 'transcode', bitrate: 32000, stream_bitrate: 20000, video_full_resolution: '4k', stream_video_full_resolution: '1080p', player: 'Chrome' },
        102: { video_codec: 'hevc', stream_video_codec: 'h264', video_decision: 'transcode', bitrate: 32000, stream_bitrate: 8000, quality_profile: '8 Mbps 1080p', player: 'Roku' },
        103: { video_codec: 'hevc', stream_video_codec: 'h264', video_decision: 'transcode', bitrate: 32000, stream_bitrate: 20000, player: 'Chrome' },
        104: { subtitle_decision: 'burn', subtitle_codec: 'pgs', stream_subtitle_codec: '', video_decision: 'transcode', player: 'Apple TV' },
        105: { subtitle_decision: 'burn', subtitle_codec: 'pgs', stream_subtitle_codec: '', video_decision: 'transcode', player: 'Apple TV' },
        106: { video_decision: 'transcode', bitrate: 18000, stream_bitrate: 4000, quality_profile: '4 Mbps 720p', stream_video_full_resolution: '720p', player: 'Android' },
        107: { video_decision: 'transcode', bitrate: 18000, stream_bitrate: 4000, quality_profile: '4 Mbps 720p', stream_video_full_resolution: '720p', player: 'Android' },
        108: { audio_codec: 'truehd', stream_audio_codec: 'aac', audio_decision: 'transcode', player: 'Chrome' },
      };
      const r = rows[Number(req.query.row_id)];
      return r ? res.json(wrap({ ...base, ...r })) : res.json({ response: { result: 'error', message: 'Invalid row_id', data: {} } });
    }
    if (cmd === 'get_home_stats') {
      const days = Number(req.query.time_range) || 30;
      const f = days <= 7 ? 0.3 : days >= 90 ? 2.4 : 1; // scale plays by window
      const s = (n) => Math.max(1, Math.round(n * f));
      return res.json(wrap([
        { stat_id: 'top_movies', stat_title: 'Most Watched Movies', rows: [{ title: 'Dune: Part Two', total_plays: s(12) }, { title: 'Oppenheimer', total_plays: s(9) }, { title: 'The Wild Robot', total_plays: s(6) }] },
        { stat_id: 'top_tv', stat_title: 'Most Watched Shows', rows: [{ title: 'The Bear', total_plays: s(22) }, { title: 'Severance', total_plays: s(18) }, { title: 'Shogun', total_plays: s(14) }] },
        { stat_id: 'top_users', stat_title: 'Most Active Users', rows: [{ friendly_name: 'cameron', total_plays: s(40) }, { friendly_name: 'guest', total_plays: s(11) }, { friendly_name: 'kids', total_plays: s(7) }] },
        { stat_id: 'top_platforms', stat_title: 'Most Active Platforms', rows: [{ platform: 'Apple TV', total_plays: s(26) }, { platform: 'Chrome', total_plays: s(19) }, { platform: 'iOS', total_plays: s(9) }] },
        { stat_id: 'top_libraries', stat_title: 'Most Active Libraries', rows: [{ section_name: 'TV Shows', total_plays: s(54) }, { section_name: 'Movies', total_plays: s(33) }] },
      ]));
    }
    if (cmd === 'get_plays_by_date') {
      const days = Math.min(120, Number(req.query.time_range) || 30);
      const cats = []; const tv = []; const mv = [];
      for (let i = days - 1; i >= 0; i--) { const d = new Date(Date.now() - i * 86400000); cats.push(`${d.getMonth() + 1}/${d.getDate()}`); tv.push(Math.floor(2 + Math.random() * 8)); mv.push(Math.floor(Math.random() * 5)); }
      return res.json(wrap({ categories: cats, series: [{ name: 'TV', data: tv }, { name: 'Movies', data: mv }, { name: 'Total', data: tv.map((v, i) => v + mv[i]) }] }));
    }
    if (cmd === 'get_plays_by_dayofweek') return res.json(wrap({ categories: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], series: [{ name: 'TV', data: [12, 9, 14, 11, 20, 26, 22] }, { name: 'Movies', data: [3, 2, 4, 3, 7, 11, 9] }] }));
    if (cmd === 'get_plays_by_hourofday') { const cats = Array.from({ length: 24 }, (_, hh) => String(hh)); const data = cats.map((_, hh) => (hh >= 18 && hh <= 23 ? Math.floor(8 + Math.random() * 10) : (hh >= 8 && hh < 12 ? Math.floor(3 + Math.random() * 4) : Math.floor(Math.random() * 3)))); return res.json(wrap({ categories: cats, series: [{ name: 'Plays', data }] })); }
    if (cmd === 'get_plays_by_top_10_platforms') return res.json(wrap({ categories: ['Apple TV', 'Chrome', 'iOS', 'Android', 'Roku'], series: [{ name: 'Plays', data: [42, 31, 19, 12, 7] }] }));
    if (cmd === 'get_plays_by_top_10_users') return res.json(wrap({ categories: ['cameron', 'guest', 'kids', 'partner'], series: [{ name: 'Plays', data: [58, 22, 14, 9] }] }));
    return res.json(wrap({}));
  });
  return app;
}

// ---------------- Bazarr (subtitle manager) ----------------
// ---- Prowlarr (v1) ----
// Indexer list/stats, enable/disable via PUT, single + bulk tests (one indexer
// deliberately fails), connected apps, and the ApplicationIndexerSync command.
function makeProwlarr() {
  const app = express();
  app.use(express.json());
  mountBackupMock(app, 'prowlarr', 'v1');
  app.get('/api/v1/system/status', (req, res) => res.json({ appName: 'Prowlarr', instanceName: 'Prowlarr (mock)', version: '1.28.2.4885', isDocker: true }));
  const CAT_IDS = { Movies: 2000, Audio: 3000, PC: 4000, TV: 5000, Books: 7000 };
  const cats = (names) => ({ categories: names.map((name) => ({ id: CAT_IDS[name], name, subCategories: [] })) });
  let indexers = [
    { id: 1, name: 'NZBgeek', protocol: 'usenet', enable: true, priority: 10, implementation: 'Newznab', capabilities: cats(['Movies', 'TV', 'Audio']) },
    { id: 2, name: 'DrunkenSlug', protocol: 'usenet', enable: true, priority: 15, implementation: 'Newznab', capabilities: cats(['Movies', 'TV']) },
    { id: 3, name: 'TorrentLeech', protocol: 'torrent', enable: true, priority: 25, implementation: 'TorrentLeech', capabilities: cats(['Movies', 'TV']) },
    { id: 4, name: 'OldTracker', protocol: 'torrent', enable: false, priority: 40, implementation: 'Cardigann', capabilities: cats(['TV']) },
  ];
  const apps = [
    { id: 1, name: 'Sonarr', implementation: 'Sonarr', syncLevel: 'fullSync', tags: [], fields: [{ name: 'baseUrl', value: 'http://sonarr:8989' }, { name: 'syncCategories', value: [5000, 5010, 5020, 5030, 5040, 5045, 5050] }] },
    { id: 2, name: 'Radarr', implementation: 'Radarr', syncLevel: 'fullSync', tags: [], fields: [{ name: 'baseUrl', value: 'http://radarr:7878' }, { name: 'syncCategories', value: [2000, 2010, 2020, 2030, 2040, 2045, 2050, 2060] }] },
    { id: 3, name: 'Radarr 4K', implementation: 'Radarr', syncLevel: 'addOnly', tags: [], fields: [{ name: 'baseUrl', value: 'http://radarr-4k:7879' }, { name: 'syncCategories', value: [2000, 2045] }] },
  ];
  const failing = new Set([3]);
  let commandId = 100;
  app.get('/api/v1/indexer', (req, res) => res.json(indexers));
  app.get('/api/v1/indexer/:id', (req, res) => { const ix = indexers.find((x) => x.id === Number(req.params.id)); return ix ? res.json(ix) : res.status(404).json({ message: 'Not found' }); });
  app.put('/api/v1/indexer/:id', (req, res) => {
    const id = Number(req.params.id); const i = indexers.findIndex((x) => x.id === id);
    if (i < 0) return res.status(404).json({ message: 'Not found' });
    indexers[i] = { ...indexers[i], ...req.body, id }; res.status(202).json(indexers[i]);
  });
  // Realistic spread: one healthy, one slow, one failing (and paused), one disabled.
  const STATS = {
    1: { numberOfQueries: 1840, numberOfRssQueries: 2900, numberOfAuthQueries: 3, numberOfGrabs: 212, numberOfFailedQueries: 9, numberOfFailedGrabs: 1, averageResponseTime: 410, averageGrabResponseTime: 380 },
    2: { numberOfQueries: 1610, numberOfRssQueries: 2880, numberOfAuthQueries: 2, numberOfGrabs: 4, numberOfFailedQueries: 70, numberOfFailedGrabs: 0, averageResponseTime: 4300, averageGrabResponseTime: 900 },
    3: { numberOfQueries: 1200, numberOfRssQueries: 2700, numberOfAuthQueries: 40, numberOfGrabs: 61, numberOfFailedQueries: 1590, numberOfFailedGrabs: 9, numberOfFailedAuthQueries: 38, averageResponseTime: 1200, averageGrabResponseTime: 700 },
    4: { numberOfQueries: 0, numberOfGrabs: 0, averageResponseTime: 0 },
  };
  app.get('/api/v1/indexerstats', (req, res) => res.json({ indexers: indexers.map((ix) => ({ indexerId: ix.id, indexerName: ix.name, numberOfQueries: 0, numberOfGrabs: 0, numberOfFailedQueries: 0, averageResponseTime: 0, ...(STATS[ix.id] || {}) })), userAgents: [], hosts: [] }));
  app.get('/api/v1/indexerstatus', (req, res) => res.json([...failing].map((id) => ({ id, indexerId: id, initialFailure: new Date(Date.now() - 2 * 86400000).toISOString(), mostRecentFailure: new Date(Date.now() - 1800000).toISOString(), disabledTill: new Date(Date.now() + 3 * 3600000).toISOString() }))));
  app.post('/api/v1/indexer/test', (req, res) => {
    if (failing.has(Number(req.body?.id))) return res.status(400).json([{ propertyName: 'BaseUrl', errorMessage: 'Unable to connect to indexer: 401 Unauthorized. Check your API key.' }]);
    res.json({});
  });
  app.post('/api/v1/indexer/testall', (req, res) => res.json(indexers.filter((x) => x.enable).map((x) => ({
    id: x.id, isValid: !failing.has(x.id),
    validationFailures: failing.has(x.id) ? [{ propertyName: 'BaseUrl', errorMessage: 'Unable to connect to indexer: 401 Unauthorized' }] : [],
  }))));
  app.get('/api/v1/applications', (req, res) => res.json(apps));
  app.post('/api/v1/command', (req, res) => res.status(201).json({ id: ++commandId, name: req.body?.name, status: 'queued', queued: new Date().toISOString() }));
  app.get('/api/v1/command/:id', (req, res) => res.json({ id: Number(req.params.id), name: 'ApplicationIndexerSync', status: 'completed', ended: new Date().toISOString() }));
  app.get('/api/v1/health', (req, res) => res.json(failing.size ? [{ source: 'IndexerStatusCheck', type: 'warning', message: 'Indexers unavailable due to failures: TorrentLeech' }] : []));
  app.get('/api/v1/history', (req, res) => res.json({ page: 1, pageSize: 50, totalRecords: 0, records: [] }));
  // Search across indexers. Like Prowlarr, download and magnet links point at
  // Prowlarr itself (/{indexerId}/download?apikey=…) on the host it was asked on.
  const RELEASES = [
    { guid: 'px-1', title: 'Dune.Part.Two.2024.2160p.UHD.BluRay.x265-GROUP', indexerId: 1, indexer: 'NZBgeek', protocol: 'usenet', size: 32.4e9, grabs: 120, cats: [[2000, 'Movies', [[2045, 'Movies/UHD']]]], age: 40 },
    { guid: 'px-2', title: 'Dune.Part.Two.2024.1080p.WEB-DL.DDP5.1.H.264-FLUX', indexerId: 3, indexer: 'TorrentLeech', protocol: 'torrent', size: 9.1e9, seeders: 412, leechers: 18, cats: [[2000, 'Movies', [[2040, 'Movies/HD']]]], age: 120, hash: '6a7c2b1f0e9d8c7b6a5f4e3d2c1b0a9f8e7d6c5b' },
    { guid: 'px-3', title: 'Severance.S02E10.1080p.ATVP.WEB-DL.DDP5.1.H.264-NTb', indexerId: 1, indexer: 'NZBgeek', protocol: 'usenet', size: 2.1e9, grabs: 54, cats: [[5000, 'TV', [[5040, 'TV/HD']]]], age: 6 },
    { guid: 'px-4', title: 'Severance.S02E10.2160p.ATVP.WEB-DL.DDP5.1.HDR.H.265-FLUX', indexerId: 3, indexer: 'TorrentLeech', protocol: 'torrent', size: 6.8e9, seeders: 250, leechers: 9, cats: [[5000, 'TV', [[5045, 'TV/UHD']]]], age: 5, magnetOnly: true, hash: '0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c' },
    { guid: 'px-5', title: 'Andy.Weir.Project.Hail.Mary.2021.Audiobook.M4B', indexerId: 2, indexer: 'DrunkenSlug', protocol: 'usenet', size: 1.1e9, grabs: 9, cats: [[3000, 'Audio', [[3030, 'Audio/Audiobook']]]], age: 300 },
    { guid: 'px-6', title: 'Unknown.Show.S01E01.720p.HDTV.x264-LOL', indexerId: 2, indexer: 'DrunkenSlug', protocol: 'usenet', size: 0.9e9, grabs: 1, cats: [[5000, 'TV', [[5030, 'TV/SD']]]], age: 2 },
  ];
  const grabbed = [];
  app.locals.grabbed = grabbed;
  const shape = (r, base) => {
    const link = `${base}/${r.indexerId}/download?apikey=MOCK_API_KEY&link=${encodeURIComponent(Buffer.from(r.guid).toString('base64'))}&file=${encodeURIComponent(r.title)}`;
    const magnet = r.hash ? `magnet:?xt=urn:btih:${r.hash}&dn=${encodeURIComponent(r.title)}` : null;
    return {
      guid: r.guid, title: r.title, sortTitle: r.title.toLowerCase(), indexerId: r.indexerId, indexer: r.indexer, protocol: r.protocol, size: r.size, grabs: r.grabs,
      publishDate: new Date(Date.now() - r.age * 3600000).toISOString(), age: Math.floor(r.age / 24), ageHours: r.age,
      categories: r.cats.map(([id, name, subs]) => ({ id, name, subCategories: subs.map(([sid, sname]) => ({ id: sid, name: sname, subCategories: [] })) })),
      downloadUrl: r.magnetOnly ? null : link, magnetUrl: r.protocol === 'torrent' ? magnet : null, infoHash: r.hash || null,
      ...(r.protocol === 'torrent' ? { seeders: r.seeders, leechers: r.leechers } : {}),
      infoUrl: `${base}/details/${r.guid}`,
    };
  };
  app.get('/api/v1/search', (req, res) => {
    const words = String(req.query.query || '').toLowerCase().split(/[\s.]+/).filter(Boolean);
    const base = `${req.protocol}://${req.get('host')}`;
    res.json(RELEASES.filter((r) => words.length && words.every((w) => r.title.toLowerCase().includes(w))).map((r) => shape(r, base)));
  });
  app.post('/api/v1/search', (req, res) => {
    const r = RELEASES.find((x) => x.guid === (req.body && req.body.guid));
    if (!r) return res.status(404).json({ message: 'Release not found in cache, search again' });
    grabbed.push(r.guid); res.json(shape(r, `${req.protocol}://${req.get('host')}`));
  });
  return app;
}

function makeBazarr() {
  const app = express();
  app.use(express.json());

  // Language helpers
  const L = {
    en: { name: 'English', code2: 'en', code3: 'eng' },
    es: { name: 'Spanish', code2: 'es', code3: 'spa' },
    fr: { name: 'French', code2: 'fr', code3: 'fra' },
  };
  const missing = (code, { forced = false, hi = false } = {}) => ({ ...L[code], forced, hi });
  const have = (code, path) => ({ ...L[code], forced: false, hi: false, path });

  // Library: series (subtitle view of Sonarr) and movies (subtitle view of Radarr).
  let series = [
    { sonarrSeriesId: 1, title: 'Severance', year: 2022, monitored: true, path: '/tv/Severance', tvdbId: 371980, imdbId: 'tt11280740', profileId: 1, audio_language: [L.en], episodeFileCount: 19, episodeMissingCount: 1 },
    { sonarrSeriesId: 2, title: 'The Bear', year: 2022, monitored: true, path: '/tv/The Bear', tvdbId: 388477, imdbId: 'tt14452776', profileId: 2, audio_language: [L.en], episodeFileCount: 28, episodeMissingCount: 3 },
    { sonarrSeriesId: 3, title: 'Foundation', year: 2021, monitored: true, path: '/tv/Foundation', tvdbId: 358711, imdbId: 'tt0804484', profileId: 1, audio_language: [L.en], episodeFileCount: 20, episodeMissingCount: 0 },
  ];
  let movies = [
    { radarrId: 1, title: 'Dune: Part Two', year: 2024, monitored: true, path: '/movies/Dune Part Two (2024)', tmdbId: 693134, imdbId: 'tt15239678', profileId: 1, audio_language: [L.en], subtitles: [have('en', '/movies/Dune.en.srt')], missing_subtitles: [] },
    { radarrId: 2, title: 'Oppenheimer', year: 2023, monitored: true, path: '/movies/Oppenheimer (2023)', tmdbId: 872585, imdbId: 'tt15398776', profileId: 2, audio_language: [L.en], subtitles: [have('en', '/movies/Oppenheimer.en.srt')], missing_subtitles: [missing('es')] },
    { radarrId: 3, title: 'Furiosa', year: 2024, monitored: true, path: '/movies/Furiosa (2024)', tmdbId: 786892, imdbId: 'tt12037194', profileId: 2, audio_language: [L.en], subtitles: [], missing_subtitles: [missing('en'), missing('es')] },
  ];
  let wantedEpisodes = [
    { sonarrSeriesId: 1, sonarrEpisodeId: 1010, seriesTitle: 'Severance', episodeTitle: 'Cold Harbor', episode_number: '2x10', sceneName: 'Severance.S02E10.1080p.WEB-DL', tags: [], failedAttempts: 0, missing_subtitles: [missing('en')] },
    { sonarrSeriesId: 2, sonarrEpisodeId: 3005, seriesTitle: 'The Bear', episodeTitle: 'Children', episode_number: '3x05', sceneName: 'The.Bear.S03E05.1080p.WEB-DL', tags: [], failedAttempts: 1, missing_subtitles: [missing('en'), missing('es')] },
    { sonarrSeriesId: 2, sonarrEpisodeId: 3006, seriesTitle: 'The Bear', episodeTitle: 'Napkins', episode_number: '3x06', sceneName: 'The.Bear.S03E06.1080p.WEB-DL', tags: [], failedAttempts: 0, missing_subtitles: [missing('en')] },
  ];
  let wantedMovies = [
    { radarrId: 3, title: 'Furiosa', year: 2024, sceneName: 'Furiosa.2024.2160p.WEB-DL', tags: [], failedAttempts: 0, missing_subtitles: [missing('en'), missing('es')] },
    { radarrId: 2, title: 'Oppenheimer', year: 2023, sceneName: 'Oppenheimer.2023.1080p.BluRay', tags: [], failedAttempts: 0, missing_subtitles: [missing('es')] },
  ];
  let seriesHistory = [
    { action: 1, timestamp: new Date(Date.now() - 3600000).toISOString(), description: 'English subtitles downloaded from OpenSubtitles.com with a score of 98%.', language: L.en, provider: 'opensubtitlescom', score: '98%', seriesTitle: 'Severance', episode_number: '2x01', episodeTitle: 'Hello, Ms. Cobel', sonarrSeriesId: 1, sonarrEpisodeId: 1001, subtitles_path: '/tv/Severance/S02E01.en.srt' },
    { action: 2, timestamp: new Date(Date.now() - 9000000).toISOString(), description: 'English subtitles manually downloaded from Addic7ed.', language: L.en, provider: 'addic7ed', score: '91%', seriesTitle: 'The Bear', episode_number: '3x04', episodeTitle: 'Violet', sonarrSeriesId: 2, sonarrEpisodeId: 3004, subtitles_path: '/tv/The Bear/S03E04.en.srt' },
    { action: 3, timestamp: new Date(Date.now() - 172800000).toISOString(), description: 'English subtitles upgraded from a better release.', language: L.en, provider: 'opensubtitlescom', score: '100%', seriesTitle: 'Foundation', episode_number: '2x10', episodeTitle: 'Creation Myths', sonarrSeriesId: 3, sonarrEpisodeId: 3110, subtitles_path: '/tv/Foundation/S02E10.en.srt' },
  ];
  let movieHistory = [
    { action: 1, timestamp: new Date(Date.now() - 5400000).toISOString(), description: 'English subtitles downloaded from Podnapisi with a score of 96%.', language: L.en, provider: 'podnapisi', score: '96%', title: 'Dune: Part Two', radarrId: 1, subtitles_path: '/movies/Dune.en.srt' },
    { action: 1, timestamp: new Date(Date.now() - 86400000).toISOString(), description: 'English subtitles downloaded from OpenSubtitles.com with a score of 99%.', language: L.en, provider: 'opensubtitlescom', score: '99%', title: 'Oppenheimer', radarrId: 2, subtitles_path: '/movies/Oppenheimer.en.srt' },
  ];
  const providers = [
    { name: 'opensubtitlescom', status: 'Good', retry: 'now' },
    { name: 'podnapisi', status: 'Good', retry: 'now' },
    { name: 'addic7ed', status: 'Good', retry: 'now' },
    { name: 'subscene', status: 'Throttled until 14:30', retry: '14:30' },
  ];
  const languages = [
    { ...L.en, enabled: true },
    { ...L.es, enabled: true },
    { ...L.fr, enabled: false },
  ];
  const profiles = [
    { profileId: 1, name: 'English', cutoff: null, mustContain: [], mustNotContain: [], originalFormat: false, items: [{ id: 1, language: 'en', audio_exclude: 'False', hi: 'False', forced: 'False' }] },
    { profileId: 2, name: 'English + Spanish', cutoff: null, mustContain: [], mustNotContain: [], originalFormat: false, items: [{ id: 1, language: 'en', audio_exclude: 'False', hi: 'False', forced: 'False' }, { id: 2, language: 'es', audio_exclude: 'False', hi: 'False', forced: 'False' }] },
  ];

  const badges = () => ({
    episodes: wantedEpisodes.length,
    movies: wantedMovies.length,
    providers: providers.filter((p) => /throttl/i.test(p.status)).length,
    status: 0,
    sonarr_signalr: 'LIVE',
    radarr_signalr: 'LIVE',
    announcements: 0,
  });

  app.use((req, res, next) => {
    recordCf('bazarr', req);
    if (req.headers['x-api-key'] !== 'MOCK_API_KEY') return res.status(401).json({ error: 'Unauthorized (missing X-API-KEY)' });
    next();
  });
  app.get('/__debug', (req, res) => res.json({ cf: cfSeen.bazarr || null }));

  app.get('/api/system/status', (req, res) => res.json({ data: {
    bazarr_version: 'v1.4.5', sonarr_version: '4.0.10.2544', radarr_version: '5.11.0.9244',
    operating_system: 'Linux', python_version: '3.11.9', bazarr_directory: '/app/bazarr', bazarr_config_directory: '/config',
    package_version: 'Docker', start_time: new Date(Date.now() - 5 * 86400000).toISOString(),
  } }));
  app.get('/api/system/health', (req, res) => res.json({ data: [] }));
  app.get('/api/badges', (req, res) => res.json(badges()));

  // Like Bazarr, ?seriesid[]= / ?radarrid[]= filter to specific items.
  const ids = (v) => [].concat(v ?? []).map(Number).filter(Number.isFinite);
  app.get('/api/series', (req, res) => { const want = ids(req.query['seriesid[]'] ?? req.query.seriesid); const data = want.length ? series.filter((x) => want.includes(x.sonarrSeriesId)) : series; res.json({ data, total: data.length }); });
  app.get('/api/movies', (req, res) => { const want = ids(req.query['radarrid[]'] ?? req.query.radarrid); const data = want.length ? movies.filter((x) => want.includes(x.radarrId)) : movies; res.json({ data, total: data.length }); });
  // Episodes of a series: those still wanted carry missing_subtitles; the rest
  // of the season count as complete in English.
  app.get('/api/episodes', (req, res) => {
    const want = ids(req.query['seriesid[]'] ?? req.query.seriesid);
    if (!want.length) return res.status(404).json({ message: 'Series or Episode ID not provided' });
    const data = [];
    for (const s of series.filter((x) => want.includes(x.sonarrSeriesId))) {
      const total = Math.min(Number(s.episodeFileCount) || 6, 12);
      for (let n = 1; n <= total; n += 1) {
        const epId = s.sonarrSeriesId * 1000 + n;
        data.push({ sonarrSeriesId: s.sonarrSeriesId, sonarrEpisodeId: epId, title: `Episode ${n}`, season: 1, episode: n, monitored: true, subtitles: [have('en', `${s.path}/S01E${n}.en.srt`)], missing_subtitles: [] });
      }
      for (const w of wantedEpisodes.filter((x) => x.sonarrSeriesId === s.sonarrSeriesId)) {
        const [season, episode] = String(w.episode_number || '1x1').split('x').map(Number);
        data.push({ sonarrSeriesId: s.sonarrSeriesId, sonarrEpisodeId: w.sonarrEpisodeId, title: w.episodeTitle, season, episode, monitored: true, subtitles: [], missing_subtitles: w.missing_subtitles });
      }
    }
    res.json({ data, total: data.length });
  });

  app.get('/api/episodes/wanted', (req, res) => res.json({ data: wantedEpisodes, total: wantedEpisodes.length }));
  app.get('/api/movies/wanted', (req, res) => res.json({ data: wantedMovies, total: wantedMovies.length }));

  app.get('/api/history/series', (req, res) => res.json({ data: seriesHistory, total: seriesHistory.length }));
  app.get('/api/history/movies', (req, res) => res.json({ data: movieHistory, total: movieHistory.length }));

  app.get('/api/providers', (req, res) => res.json({ data: providers }));
  app.get('/api/system/languages', (req, res) => {
    const enabledOnly = req.query.enabled === 'true';
    res.json(enabledOnly ? languages.filter((l) => l.enabled) : languages);
  });
  app.get('/api/system/languages/profiles', (req, res) => res.json(profiles));

  // ---- Actions (demo: mutate state so the UI feels live) ----
  // Subtitle searches. These mirror real Bazarr: PATCH /api/movies and
  // /api/series need an `action` (400 "Unknown action" otherwise),
  // /api/episodes is GET-only (405), and a single episode language is fetched
  // with PATCH /api/episodes/subtitles (seriesid, episodeid, language, forced,
  // hi all required).
  const historyText = (lang) => `${lang.name} subtitles manually downloaded from OpenSubtitles.com with a score of 100%.`;
  const sameLang = (a, b) => a.code2 === b.code2 && !!a.forced === !!b.forced && !!a.hi === !!b.hi;
  function fetchEpisodeSub(item, lang) {
    item.missing_subtitles = (item.missing_subtitles || []).filter((x) => !sameLang(x, lang));
    if (!item.missing_subtitles.length) {
      wantedEpisodes = wantedEpisodes.filter((w) => w !== item);
      const s = series.find((x) => x.sonarrSeriesId === item.sonarrSeriesId);
      if (s && s.episodeMissingCount > 0) s.episodeMissingCount -= 1;
    }
    seriesHistory.unshift({ action: 2, timestamp: new Date().toISOString(), description: historyText(lang), language: { name: lang.name, code2: lang.code2, code3: lang.code3 }, provider: 'opensubtitlescom', score: '100%', seriesTitle: item.seriesTitle, episode_number: item.episode_number, episodeTitle: item.episodeTitle, sonarrSeriesId: item.sonarrSeriesId, sonarrEpisodeId: item.sonarrEpisodeId });
  }
  function fetchMovieSubs(item) {
    wantedMovies = wantedMovies.filter((w) => w !== item);
    const m = movies.find((x) => x.radarrId === item.radarrId);
    for (const lang of item.missing_subtitles || []) {
      if (m) { m.subtitles = [...(m.subtitles || []), have(lang.code2, `${m.path}/subtitle.${lang.code2}.srt`)]; m.missing_subtitles = (m.missing_subtitles || []).filter((x) => x.code2 !== lang.code2); }
      movieHistory.unshift({ action: 2, timestamp: new Date().toISOString(), description: historyText(lang), language: { name: lang.name, code2: lang.code2, code3: lang.code3 }, provider: 'opensubtitlescom', score: '100%', title: item.title, radarrId: item.radarrId });
    }
  }
  const fetchSeriesSubs = (seriesId) => {
    for (const item of wantedEpisodes.filter((w) => w.sonarrSeriesId === seriesId)) {
      for (const lang of [...(item.missing_subtitles || [])]) fetchEpisodeSub(item, lang);
    }
  };
  app.patch('/api/episodes', (req, res) => res.status(405).json({ message: 'The method is not allowed for the requested URL.' }));
  app.patch('/api/episodes/subtitles', (req, res) => {
    const { seriesid, episodeid, language, forced, hi } = req.query;
    if ([seriesid, episodeid, language, forced, hi].some((v) => v === undefined || v === '')) {
      return res.status(400).json({ message: 'seriesid, episodeid, language, forced and hi are required' });
    }
    const item = wantedEpisodes.find((w) => w.sonarrSeriesId === Number(seriesid) && w.sonarrEpisodeId === Number(episodeid));
    if (!item) return res.status(404).send('Episode not found');
    const want = { code2: language, forced: /^true$/i.test(forced), hi: /^true$/i.test(hi) };
    const lang = (item.missing_subtitles || []).find((x) => sameLang(x, want));
    if (lang) fetchEpisodeSub(item, lang);
    res.status(204).end();
  });
  app.patch('/api/movies/subtitles', (req, res) => {
    const { radarrid, language, forced, hi } = req.query;
    if ([radarrid, language, forced, hi].some((v) => v === undefined || v === '')) return res.status(400).json({ message: 'radarrid, language, forced and hi are required' });
    const item = wantedMovies.find((w) => w.radarrId === Number(radarrid));
    if (!item) return res.status(404).send('Movie not found');
    const lang = (item.missing_subtitles || []).find((x) => sameLang(x, { code2: language, forced: /^true$/i.test(forced), hi: /^true$/i.test(hi) }));
    if (lang) item.missing_subtitles = item.missing_subtitles.filter((x) => x !== lang);
    if (!item.missing_subtitles.length) wantedMovies.splice(wantedMovies.indexOf(item), 1);
    res.status(204).end();
  });
  app.patch('/api/series', (req, res) => {
    const { action } = req.query;
    if (action === 'search-missing') fetchSeriesSubs(Number(req.query.seriesid));
    else if (action === 'search-wanted') for (const id of [...new Set(wantedEpisodes.map((w) => w.sonarrSeriesId))]) fetchSeriesSubs(id);
    else if (action !== 'scan-disk' && action !== 'sync') return res.status(400).send('Unknown action');
    res.status(204).end();
  });
  app.patch('/api/movies', (req, res) => {
    const { action } = req.query;
    if (action === 'search-missing') { const item = wantedMovies.find((w) => w.radarrId === Number(req.query.radarrid)); if (item) fetchMovieSubs(item); }
    else if (action === 'search-wanted') for (const item of [...wantedMovies]) fetchMovieSubs(item);
    else if (action !== 'scan-disk' && action !== 'sync') return res.status(400).send('Unknown action');
    res.status(204).end();
  });
  // Manual subtitle download (from the "search available" modal).
  app.post('/api/subtitles', (req, res) => res.json({}));
  app.patch('/api/providers', (req, res) => res.json({}));
  app.post('/api/system/tasks', (req, res) => res.json({}));

  // ---- Manual search: list candidate subtitles from providers ----
  const candidates = (title) => ([
    { language: L.en, provider: 'opensubtitlescom', score: 98, orig_score: 98, uploader: 'subber123', release_info: [`${title}.1080p.WEB-DL.DDP5.1.H.264`], matches: ['series', 'year', 'resolution', 'source'], dont_matches: ['release_group'], hearing_impaired: false, forced: false, subtitle: 'b64-en-1', url: 'https://opensubtitles.com/sub/1' },
    { language: L.en, provider: 'addic7ed', score: 91, orig_score: 91, uploader: 'addicteam', release_info: [`${title}.720p.WEB-DL`], matches: ['series', 'year'], dont_matches: ['resolution'], hearing_impaired: true, forced: false, subtitle: 'b64-en-2', url: 'https://addic7ed.com/sub/2' },
    { language: L.es, provider: 'podnapisi', score: 84, orig_score: 84, uploader: 'esteam', release_info: [`${title}.1080p.BluRay.x264`], matches: ['year'], dont_matches: ['source', 'resolution'], hearing_impaired: false, forced: false, subtitle: 'b64-es-1', url: 'https://podnapisi.net/sub/3' },
  ]);
  app.get('/api/providers/episodes', (req, res) => {
    const ep = wantedEpisodes.find((w) => w.sonarrEpisodeId === Number(req.query.episodeid));
    res.json({ data: candidates(ep ? ep.seriesTitle : 'Episode') });
  });
  app.get('/api/providers/movies', (req, res) => {
    const mv = movies.find((m) => m.radarrId === Number(req.query.radarrid));
    res.json({ data: candidates(mv ? mv.title : 'Movie') });
  });
  // Manual download of a chosen candidate -> record to history (+ clear wanted).
  app.post('/api/providers/episodes', (req, res) => {
    const epId = Number(req.query.episodeid || (req.body && req.body.episodeid));
    const item = wantedEpisodes.find((w) => w.sonarrEpisodeId === epId);
    if (item) {
      wantedEpisodes = wantedEpisodes.filter((w) => w.sonarrEpisodeId !== epId);
      const s = series.find((x) => x.sonarrSeriesId === item.sonarrSeriesId);
      if (s && s.episodeMissingCount > 0) s.episodeMissingCount -= 1;
      seriesHistory.unshift({ action: 2, timestamp: new Date().toISOString(), description: `Manually downloaded subtitles from ${req.body?.provider || 'a provider'}.`, language: L.en, provider: req.body?.provider || 'opensubtitlescom', score: '100%', seriesTitle: item.seriesTitle, episode_number: item.episode_number, episodeTitle: item.episodeTitle, sonarrSeriesId: item.sonarrSeriesId, sonarrEpisodeId: epId });
    }
    res.json({});
  });
  app.post('/api/providers/movies', (req, res) => {
    const rid = Number(req.query.radarrid || (req.body && req.body.radarrid));
    const item = wantedMovies.find((w) => w.radarrId === rid);
    if (item) {
      wantedMovies = wantedMovies.filter((w) => w.radarrId !== rid);
      const m = movies.find((x) => x.radarrId === rid);
      if (m) { m.subtitles = [...(m.subtitles || []), have('en', `${m.path}/subtitle.en.srt`)]; m.missing_subtitles = []; }
      movieHistory.unshift({ action: 2, timestamp: new Date().toISOString(), description: `Manually downloaded subtitles from ${req.body?.provider || 'a provider'}.`, language: L.en, provider: req.body?.provider || 'opensubtitlescom', score: '100%', title: item.title, radarrId: rid });
    }
    res.json({});
  });

  // ---- Blacklist (subtitles the user has rejected) ----
  let seriesBlacklist = [
    { id: 1, provider: 'subscene', subs_id: 'ss-8842', language: L.en, seriesTitle: 'The Bear', episode_number: '3x02', timestamp: new Date(Date.now() - 43200000).toISOString(), subtitles_path: '/tv/The Bear/S03E02.en.srt' },
  ];
  let movieBlacklist = [
    { id: 2, provider: 'addic7ed', subs_id: 'a7-1201', language: L.en, title: 'Furiosa', timestamp: new Date(Date.now() - 129600000).toISOString(), subtitles_path: '/movies/Furiosa.en.srt' },
  ];
  app.get('/api/episodes/blacklist', (req, res) => res.json({ data: seriesBlacklist }));
  app.get('/api/movies/blacklist', (req, res) => res.json({ data: movieBlacklist }));
  app.post('/api/episodes/blacklist', (req, res) => { seriesBlacklist.unshift({ id: Date.now(), provider: req.body?.provider || 'unknown', subs_id: req.body?.subs_id || 'x', language: L.en, seriesTitle: 'Manual', episode_number: '', timestamp: new Date().toISOString(), subtitles_path: req.body?.subtitles_path || '' }); res.json({}); });
  app.delete('/api/episodes/blacklist', (req, res) => { if (req.query.all === 'true') seriesBlacklist = []; else seriesBlacklist = seriesBlacklist.filter((b) => String(b.id) !== String(req.query.id) && b.subs_id !== req.query.subs_id); res.json({}); });
  app.delete('/api/movies/blacklist', (req, res) => { if (req.query.all === 'true') movieBlacklist = []; else movieBlacklist = movieBlacklist.filter((b) => String(b.id) !== String(req.query.id) && b.subs_id !== req.query.subs_id); res.json({}); });

  return app;
}

// ---------------- qBittorrent (torrent client) ----------------
function makeQbittorrent() {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  const now = Math.floor(Date.now() / 1000);
  let torrents = [
    { hash: 'a1a1a1', name: 'ubuntu-24.04.1-desktop-amd64.iso', state: 'downloading', progress: 0.42, dlspeed: 9568256, upspeed: 131072, eta: 540, size: 6033534976, amount_left: 3499450086, completed: 2534084890, num_seeds: 48, num_leechs: 6, category: 'linux', tags: '', ratio: 0.08, added_on: now - 3600, completion_on: 0, save_path: '/downloads' },
    { hash: 'b2b2b2', name: 'Big Buck Bunny (2008) [1080p BluRay x265]', state: 'stalledUP', progress: 1, dlspeed: 0, upspeed: 262144, eta: 8640000, size: 355566592, amount_left: 0, completed: 355566592, num_seeds: 12, num_leechs: 3, category: 'movies', tags: 'x265', ratio: 2.41, added_on: now - 86400, completion_on: now - 80000, save_path: '/downloads/movies' },
    { hash: 'c3c3c3', name: 'Sintel.2010.2160p.UHD.BluRay.x265-DEMO', state: 'pausedDL', progress: 0.15, dlspeed: 0, upspeed: 0, eta: 8640000, size: 12884901888, amount_left: 10952166605, completed: 1932735283, num_seeds: 0, num_leechs: 0, category: 'movies', tags: '', ratio: 0, added_on: now - 7200, completion_on: 0, save_path: '/downloads/movies' },
    // Finished and seeding: for the seeding clean-up demo.
    { hash: 'd4d4d4', name: 'Severance.S02E01.1080p.WEB.H264-NTb', state: 'stalledUP', progress: 1, dlspeed: 0, upspeed: 0, eta: 8640000, size: 2147483648, amount_left: 0, completed: 2147483648, num_seeds: 40, num_leechs: 0, category: 'tv-sonarr', tags: '', ratio: 3.2, seeding_time: 21 * 86400, added_on: now - 22 * 86400, completion_on: now - 21 * 86400, save_path: '/downloads/tv', tracker: 'https://tracker.torrentleech.org/a/123/announce' },
    { hash: 'e5e5e5', name: 'Dune.Part.Two.2024.2160p.UHD.BluRay.x265', state: 'uploading', progress: 1, dlspeed: 0, upspeed: 524288, eta: 8640000, size: 62277025792, amount_left: 0, completed: 62277025792, num_seeds: 15, num_leechs: 4, category: 'radarr', tags: '', ratio: 0.6, seeding_time: 3 * 86400, added_on: now - 4 * 86400, completion_on: now - 3 * 86400, save_path: '/downloads/movies', tracker: 'https://tracker.torrentleech.org/a/123/announce' },
    { hash: 'f6f6f6', name: 'Oppenheimer.2023.1080p.BluRay.x264', state: 'pausedUP', progress: 1, dlspeed: 0, upspeed: 0, eta: 8640000, size: 14495514624, amount_left: 0, completed: 14495514624, num_seeds: 22, num_leechs: 0, category: 'radarr', tags: '', ratio: 1.05, seeding_time: 40 * 86400, added_on: now - 41 * 86400, completion_on: now - 40 * 86400, save_path: '/downloads/movies', tracker: 'udp://tracker.opentrackr.org:1337/announce' },
    { hash: 'g7g7g7', name: 'Rare.Documentary.2011.DVDRip', state: 'stalledUP', progress: 1, dlspeed: 0, upspeed: 0, eta: 8640000, size: 1395864371, amount_left: 0, completed: 1395864371, num_seeds: 1, num_leechs: 0, category: 'radarr', tags: 'keep', ratio: 0.2, seeding_time: 90 * 86400, added_on: now - 91 * 86400, completion_on: now - 90 * 86400, save_path: '/downloads/movies', tracker: 'https://privatehd.example/announce' },
  ];
  let dlLimit = 0; let upLimit = 0; let altSpeed = 0;

  // Auth: API key (Bearer) OR a SID cookie from /auth/login. Login is exempt.
  app.use((req, res, next) => {
    recordCf('qbittorrent', req);
    if (req.path === '/api/v2/auth/login') return next();
    const bearer = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
    const cookie = req.headers['cookie'] || '';
    if (bearer === 'MOCK_API_KEY' || /SID=mocksid/.test(cookie)) return next();
    return res.status(403).send('Forbidden');
  });
  app.get('/__debug', (req, res) => res.json({ cf: cfSeen.qbittorrent || null }));
  // Preferences: only the "run external program" settings are modelled.
  const prefs = { autorun_enabled: false, autorun_program: '', autorun_on_torrent_added_enabled: false, autorun_on_torrent_added_program: '' };
  app.locals.prefs = prefs;
  app.get('/api/v2/app/preferences', (req, res) => res.json(prefs));
  app.post('/api/v2/app/setPreferences', (req, res) => {
    let j; try { j = JSON.parse(req.body.json || '{}'); } catch { return res.status(400).send('Bad json'); }
    for (const [k, v] of Object.entries(j)) if (k in prefs) prefs[k] = typeof prefs[k] === 'string' ? String(v).trim() : !!v;
    res.send('');
  });

  app.post('/api/v2/auth/login', (req, res) => {
    const { username, password } = req.body || {};
    if (username === 'admin' && password === 'adminadmin') {
      res.setHeader('Set-Cookie', 'SID=mocksid; HttpOnly; path=/');
      return res.send('Ok.');
    }
    return res.send('Fails.');
  });
  app.post('/api/v2/auth/logout', (req, res) => res.send(''));
  app.get('/api/v2/app/version', (req, res) => res.type('text/plain').send('v5.2.0'));
  app.get('/api/v2/app/webapiVersion', (req, res) => res.type('text/plain').send('2.14.1'));

  app.get('/api/v2/transfer/info', (req, res) => res.json({
    dl_info_speed: torrents.reduce((a, t) => a + (t.state === 'downloading' ? t.dlspeed : 0), 0),
    up_info_speed: torrents.reduce((a, t) => a + t.upspeed, 0),
    dl_info_data: 68152111900, up_info_data: 10747904000,
    dl_rate_limit: dlLimit, up_rate_limit: upLimit,
    dht_nodes: 322, connection_status: 'connected', use_alt_speed_limits: !!altSpeed,
  }));
  app.get('/api/v2/transfer/speedLimitsMode', (req, res) => res.type('text/plain').send(String(altSpeed)));
  app.post('/api/v2/transfer/toggleSpeedLimitsMode', (req, res) => { altSpeed = altSpeed ? 0 : 1; res.send(''); });
  app.get('/api/v2/transfer/downloadLimit', (req, res) => res.type('text/plain').send(String(dlLimit)));
  app.get('/api/v2/transfer/uploadLimit', (req, res) => res.type('text/plain').send(String(upLimit)));
  app.post('/api/v2/transfer/setDownloadLimit', (req, res) => { dlLimit = Number(req.body.limit) || 0; res.send(''); });
  app.post('/api/v2/transfer/setUploadLimit', (req, res) => { upLimit = Number(req.body.limit) || 0; res.send(''); });

  app.get('/api/v2/torrents/info', (req, res) => {
    const filter = req.query.filter;
    let list = torrents;
    if (filter === 'downloading') list = list.filter((t) => /DL$|downloading|stalledDL|metaDL/i.test(t.state) && t.progress < 1);
    else if (filter === 'completed') list = list.filter((t) => t.progress >= 1);
    else if (filter === 'paused') list = list.filter((t) => /paused/i.test(t.state));
    // Real qBittorrent reports seeding_time (seconds) on every torrent.
    res.json(list.map((t) => ({ seeding_time: 0, ...t })));
  });
  const applyHashes = (req, fn) => {
    const hashes = String((req.body && req.body.hashes) || req.query.hashes || '');
    const set = hashes === 'all' ? torrents.map((t) => t.hash) : hashes.split('|');
    for (const t of torrents) if (set.includes(t.hash)) fn(t);
  };
  app.post('/api/v2/torrents/pause', (req, res) => { applyHashes(req, (t) => { t.state = t.progress >= 1 ? 'pausedUP' : 'pausedDL'; t.dlspeed = 0; t.upspeed = 0; }); res.send(''); });
  app.post('/api/v2/torrents/resume', (req, res) => { applyHashes(req, (t) => { t.state = t.progress >= 1 ? 'uploading' : 'downloading'; if (t.progress < 1) t.dlspeed = 8000000; }); res.send(''); });
  // qBittorrent 5.0 renamed pause/resume -> stop/start and paused* -> stopped*.
  app.post('/api/v2/torrents/stop', (req, res) => { applyHashes(req, (t) => { t.state = t.progress >= 1 ? 'stoppedUP' : 'stoppedDL'; t.dlspeed = 0; t.upspeed = 0; }); res.send(''); });
  app.post('/api/v2/torrents/start', (req, res) => { applyHashes(req, (t) => { t.state = t.progress >= 1 ? 'uploading' : 'downloading'; if (t.progress < 1) t.dlspeed = 8000000; }); res.send(''); });
  app.post('/api/v2/torrents/delete', (req, res) => { const hashes = String((req.body && req.body.hashes) || ''); const set = hashes === 'all' ? torrents.map((t) => t.hash) : hashes.split('|'); torrents = torrents.filter((t) => !set.includes(t.hash)); res.send(''); });
  app.post('/api/v2/torrents/recheck', (req, res) => res.send(''));
  return app;
}

// ---------------- Transmission ----------------
function makeTransmission() {
  const app = express();
  app.use(express.json());
  const sessionId = 'mock-transmission-session';
  let dlLimit = 0; let upLimit = 0;
  let torrents = [
    { id: 1, hashString: 'tr-a1', name: 'Fedora-Workstation.iso', status: 4, percentDone: 0.56, rateDownload: 7340032, rateUpload: 65536, eta: 420, totalSize: 4294967296, leftUntilDone: 1889785610, uploadRatio: 0.12, error: 0, errorString: '', isStalled: false, peersConnected: 18, labels: ['linux'] },
    { id: 2, hashString: 'tr-b2', name: 'Big Buck Bunny', status: 6, percentDone: 1, rateDownload: 0, rateUpload: 262144, eta: -1, totalSize: 355566592, leftUntilDone: 0, uploadRatio: 2.3, error: 0, errorString: '', isStalled: false, peersConnected: 4, labels: ['movies'] },
  ];
  app.use((req, res, next) => {
    recordCf('transmission', req);
    const expected = `Basic ${Buffer.from('admin:transmission').toString('base64')}`;
    if (req.headers.authorization !== expected) return res.status(401).json({ error: 'Unauthorized' });
    if (req.headers['x-transmission-session-id'] !== sessionId) {
      res.set('X-Transmission-Session-Id', sessionId);
      return res.status(409).send('Conflict');
    }
    next();
  });
  app.post('/transmission/rpc', (req, res) => {
    const method = req.body?.method; const args = req.body?.arguments || {};
    const selected = () => {
      if (!args.ids) return torrents;
      const ids = Array.isArray(args.ids) ? args.ids : [args.ids];
      return torrents.filter((torrent) => ids.includes(torrent.id) || ids.includes(torrent.hashString));
    };
    if (method === 'session-get') return res.json({ result: 'success', arguments: { version: '4.0.6', 'rpc-version': 17, 'speed-limit-down': dlLimit, 'speed-limit-down-enabled': dlLimit > 0, 'speed-limit-up': upLimit, 'speed-limit-up-enabled': upLimit > 0 } });
    if (method === 'session-stats') return res.json({ result: 'success', arguments: { activeTorrentCount: torrents.filter((t) => t.status === 4 || t.status === 6).length, downloadSpeed: torrents.reduce((n, t) => n + t.rateDownload, 0), pausedTorrentCount: torrents.filter((t) => t.status === 0).length, torrentCount: torrents.length, uploadSpeed: torrents.reduce((n, t) => n + t.rateUpload, 0) } });
    if (method === 'torrent-get') return res.json({ result: 'success', arguments: { torrents: selected() } });
    if (method === 'torrent-start') { selected().forEach((t) => { t.status = t.percentDone >= 1 ? 6 : 4; }); return res.json({ result: 'success', arguments: {} }); }
    if (method === 'torrent-stop') { selected().forEach((t) => { t.status = 0; t.rateDownload = 0; t.rateUpload = 0; }); return res.json({ result: 'success', arguments: {} }); }
    if (method === 'torrent-remove') { const remove = new Set(selected().map((t) => t.hashString)); torrents = torrents.filter((t) => !remove.has(t.hashString)); return res.json({ result: 'success', arguments: {} }); }
    if (method === 'session-set') { dlLimit = args['speed-limit-down-enabled'] ? Number(args['speed-limit-down']) || 0 : 0; upLimit = args['speed-limit-up-enabled'] ? Number(args['speed-limit-up']) || 0 : 0; return res.json({ result: 'success', arguments: {} }); }
    return res.json({ result: `method not found: ${method}`, arguments: {} });
  });
  return app;
}

// ---------------- Deluge Web ----------------
function makeDeluge() {
  const app = express();
  app.use(express.json());
  const sessionId = 'mock-deluge-session';
  let paused = false; let maxDownload = -1; let maxUpload = -1;
  let torrents = {
    'de-a1': { name: 'Debian-12.iso', state: 'Downloading', progress: 38, total_size: 2147483648, total_done: 816043786, download_payload_rate: 5242880, upload_payload_rate: 32768, eta: 270, ratio: 0.04, num_seeds: 31, num_peers: 7, label: 'linux', is_finished: false },
    'de-b2': { name: 'Sintel', state: 'Seeding', progress: 100, total_size: 1342177280, total_done: 1342177280, download_payload_rate: 0, upload_payload_rate: 131072, eta: 0, ratio: 1.8, num_seeds: 9, num_peers: 2, label: 'movies', is_finished: true },
  };
  const reply = (res, id, result, error = null) => res.json({ result, error, id });
  app.use((req, res, next) => { recordCf('deluge', req); next(); });
  app.post('/json', (req, res) => {
    const { method, params = [], id = null } = req.body || {};
    if (method === 'auth.login') {
      if (params[0] !== 'deluge') return reply(res, id, false);
      res.setHeader('Set-Cookie', `_session_id=${sessionId}; HttpOnly; Path=/json`);
      return reply(res, id, true);
    }
    if (!String(req.headers.cookie || '').includes(`_session_id=${sessionId}`)) return reply(res, id, null, { code: 1, message: 'Not authenticated' });
    if (method === 'web.connected') return reply(res, id, true);
    if (method === 'web.update_ui') return reply(res, id, { connected: true, torrents, stats: { download_rate: Object.values(torrents).reduce((n, t) => n + t.download_payload_rate, 0), upload_rate: Object.values(torrents).reduce((n, t) => n + t.upload_payload_rate, 0), free_space: 536870912000, num_connections: 38 } });
    if (method === 'core.is_session_paused') return reply(res, id, paused);
    if (method === 'core.get_config_values') return reply(res, id, { max_download_speed: maxDownload, max_upload_speed: maxUpload });
    if (method === 'core.pause_session') { paused = true; return reply(res, id, null); }
    if (method === 'core.resume_session') { paused = false; return reply(res, id, null); }
    if (method === 'core.pause_torrent' || method === 'core.resume_torrent') { const hash = params[0]; if (torrents[hash]) torrents[hash].state = method.includes('pause') ? 'Paused' : (torrents[hash].progress >= 100 ? 'Seeding' : 'Downloading'); return reply(res, id, null); }
    if (method === 'core.remove_torrent') { delete torrents[params[0]]; return reply(res, id, true); }
    if (method === 'core.set_config') { const cfg = params[0] || {}; if (cfg.max_download_speed != null) maxDownload = Number(cfg.max_download_speed); if (cfg.max_upload_speed != null) maxUpload = Number(cfg.max_upload_speed); return reply(res, id, null); }
    return reply(res, id, null, { code: 2, message: 'Unknown method' });
  });
  return app;
}

// ---------------- NZBGet ----------------
function makeNzbget() {
  const app = express();
  app.use(express.json());
  let paused = false; let rateKiB = 0;
  let groups = [
    { NZBID: 71, NZBName: 'Foundation.S03E01.1080p', Status: 'DOWNLOADING', Category: 'tv', FileSizeMB: 2048, RemainingSizeMB: 614, DownloadTimeSec: 420, ActiveDownloads: 4 },
    { NZBID: 72, NZBName: 'Dune.Messiah.EPUB', Status: 'PAUSED', Category: 'books', FileSizeMB: 8, RemainingSizeMB: 8, DownloadTimeSec: 0, ActiveDownloads: 0 },
  ];
  let history = [
    { NZBID: 81, Name: 'Oppenheimer.2023.2160p', NZBName: 'Oppenheimer.2023.2160p', Status: 'SUCCESS/ALL', Category: 'movies', FileSizeMB: 28672, HistoryTime: Math.floor(Date.now() / 1000) - 3600 },
    { NZBID: 82, Name: 'Broken.Release', NZBName: 'Broken.Release', Status: 'FAILURE/UNPACK', Category: 'tv', FileSizeMB: 1024, HistoryTime: Math.floor(Date.now() / 1000) - 7200 },
  ];
  app.use((req, res, next) => {
    recordCf('nzbget', req);
    const expected = `Basic ${Buffer.from('nzbget:nzbget').toString('base64')}`;
    if (req.headers.authorization !== expected) return res.status(401).json({ error: { message: 'Unauthorized' }, result: null, id: req.body?.id });
    next();
  });
  app.post('/jsonrpc', (req, res) => {
    const { method, params = [], id = 1 } = req.body || {};
    const ok = (result) => res.json({ version: '1.1', result, error: null, id });
    if (method === 'version') return ok('24.6');
    if (method === 'status') return ok({ DownloadRate: paused ? 0 : 9437184, DownloadLimit: rateKiB * 1024, DownloadPaused: paused, RemainingSizeMB: groups.reduce((n, g) => n + g.RemainingSizeMB, 0), FreeDiskSpaceMB: 524288, ServerStandBy: paused || groups.length === 0 });
    if (method === 'listgroups') return ok(groups);
    if (method === 'history') return ok(history);
    if (method === 'pausedownload') { paused = true; return ok(true); }
    if (method === 'resumedownload') { paused = false; return ok(true); }
    if (method === 'rate') { rateKiB = Number(params[0]) || 0; return ok(true); }
    if (method === 'editqueue') {
      const [command, , ids = []] = params; const selected = new Set(ids.map(Number));
      if (command === 'GroupPause' || command === 'GroupResume') groups.forEach((g) => { if (selected.has(g.NZBID)) g.Status = command === 'GroupPause' ? 'PAUSED' : 'QUEUED'; });
      if (command === 'GroupDelete' || command === 'GroupFinalDelete') groups = groups.filter((g) => !selected.has(g.NZBID));
      if (command === 'HistoryDelete' || command === 'HistoryFinalDelete') history = history.filter((g) => !selected.has(g.NZBID));
      return ok(true);
    }
    return res.json({ version: '1.1', result: null, error: { code: 1, message: `Unknown method ${method}` }, id });
  });
  return app;
}

// ---------------- Jellyfin / Emby ----------------
function makeMediaServer(kind) {
  const app = express();
  const lc = (v) => String(v || '').toLowerCase();
  const isEmby = kind === 'emby';
  const now = Date.now();
  const items = [
    { Id: `${kind}-movie-1`, Name: 'Arrival', Type: 'Movie', ProductionYear: 2016, RunTimeTicks: 69600000000, CommunityRating: 7.9, ImageTags: { Primary: 'img1' }, Overview: 'A linguist works with the military to communicate with alien lifeforms.' },
    { Id: `${kind}-series-1`, Name: 'Severance', Type: 'Series', ProductionYear: 2022, CommunityRating: 8.7, ImageTags: { Primary: 'img2' } },
    { Id: `${kind}-episode-1`, Name: 'Hello, Ms. Cobel', SeriesName: 'Severance', Type: 'Episode', RunTimeTicks: 31200000000, ImageTags: { Primary: 'img3' } },
  ];
  app.use((req, res, next) => {
    recordCf(kind, req);
    // Jellyfin 12: legacy X-Emby-Token / api_key are disabled by default; only
    // the standard Authorization: MediaBrowser Token="…" header is accepted.
    // Emby still uses X-Emby-Token.
    const tok = kind === 'jellyfin'
      ? (/Token="([^"]*)"/.exec(req.headers.authorization || '') || [])[1]
      : req.headers['x-emby-token'];
    if (tok !== 'MOCK_API_KEY') return res.status(401).json({ error: 'Unauthorized' });
    next();
  });
  app.get('/System/Info', (req, res) => res.json({ ServerName: `${isEmby ? 'Emby' : 'Jellyfin'} Mock`, Version: isEmby ? '4.9.0.30' : '10.10.7', Id: `${kind}-server` }));
  app.get('/Library/VirtualFolders', (req, res) => res.json([
    { Name: 'Movies', CollectionType: 'movies', ItemId: `${kind}-movies`, Locations: ['/media/movies'] },
    { Name: 'TV Shows', CollectionType: 'tvshows', ItemId: `${kind}-tv`, Locations: ['/media/tv'] },
  ]));
  app.use(express.json());
  // The library as Sonarr/Radarr see it (same folders as the demo apps).
  // "Dune: Part Two" is matched to the 1984 film and Foundation isn't matched,
  // for the wrong-matches demo; The Bear only has a TMDB id.
  const id = (n) => (isEmby ? String(1000 + n) : `${kind}${String(n).padStart(4, '0')}`);
  const library = [
    { Id: id(1), Name: 'Dune', Type: 'Movie', ProductionYear: 1984, ProviderIds: { Tmdb: '841', Imdb: 'tt0087182' }, Path: 'C:\\Media\\Movies\\Dune Part Two (2024)\\Dune.Part.Two.mkv' },
    { Id: id(2), Name: 'Oppenheimer', Type: 'Movie', ProductionYear: 2023, ProviderIds: { Tmdb: '872585', Imdb: 'tt15398776' }, Path: 'C:\\Media\\Movies2\\Oppenheimer (2023)\\Oppenheimer.2023.1080p.mkv' },
    { Id: id(3), Name: '1917', Type: 'Movie', ProductionYear: 2019, ProviderIds: { Tmdb: '530915' }, Path: 'C:\\Media\\Movies\\1917 (2019)\\1917.mkv' },
    { Id: id(4), Name: 'Severance', Type: 'Series', ProductionYear: 2022, ProviderIds: { Tvdb: '371980', Tmdb: '95396' }, Path: 'C:\\Media\\TV\\Severance' },
    { Id: id(5), Name: 'The Bear', Type: 'Series', ProductionYear: 2022, ProviderIds: { Tmdb: '136315' }, Path: 'C:\\Media\\TV\\The Bear' },
    { Id: id(6), Name: 'Foundation', Type: 'Series', ProductionYear: 2021, ProviderIds: {}, Path: 'C:\\Media\\TV\\Foundation' },
  ];
  app.locals.library = library;
  app.get('/Items/Latest', (req, res) => res.json(items));
  app.get('/Items', (req, res) => {
    const types = String(req.query.IncludeItemTypes || '').split(',').filter(Boolean);
    if (types.length && !req.query.ParentId && types.every((t) => t === 'Movie' || t === 'Series')) {
      const list = library.filter((x) => types.includes(x.Type));
      const start = Number(req.query.StartIndex) || 0; const limit = Number(req.query.Limit) || list.length;
      return res.json({ Items: list.slice(start, start + limit), TotalRecordCount: list.length, StartIndex: start });
    }
    res.json({ Items: items, TotalRecordCount: items.length, StartIndex: 0 });
  });
  // Identify: search the providers, then apply one result.
  const CANDIDATES = {
    Movie: [{ Name: 'Dune: Part Two', ProductionYear: 2024, ProviderIds: { Tmdb: '693134', Imdb: 'tt15239678' }, SearchProviderName: 'TheMovieDb', ImageUrl: 'https://image.tmdb.org/t/p/original/dune2.jpg' },
      { Name: 'Dune', ProductionYear: 1984, ProviderIds: { Tmdb: '841', Imdb: 'tt0087182' }, SearchProviderName: 'TheMovieDb' }],
    Series: [{ Name: 'Foundation', ProductionYear: 2021, ProviderIds: { Tvdb: '358711', Tmdb: '93740' }, SearchProviderName: 'TheMovieDb' },
      { Name: 'Foundation and Empire', ProductionYear: 1975, ProviderIds: { Tmdb: '4471' }, SearchProviderName: 'TheMovieDb' }],
  };
  app.post('/Items/RemoteSearch/:type', (req, res, next) => {
    if (!CANDIDATES[req.params.type]) return next();
    const info = (req.body && req.body.SearchInfo) || {};
    const want = lc(info.Name);
    const list = CANDIDATES[req.params.type].filter((c) => lc(c.Name).includes(want.split(':')[0]) || Object.values(info.ProviderIds || {}).some((v) => Object.values(c.ProviderIds).includes(String(v))));
    res.json(list.length ? list : [{ Name: info.Name, ProductionYear: info.Year, ProviderIds: info.ProviderIds || {}, SearchProviderName: 'TheMovieDb' }]);
  });
  app.post('/Items/RemoteSearch/Apply/:id', (req, res) => {
    const it = library.find((x) => x.Id === req.params.id);
    if (!it) return res.status(404).json({ error: 'Item not found' });
    const b = req.body || {};
    if (!b.ProviderIds || !Object.keys(b.ProviderIds).length) return res.status(400).json({ error: 'ProviderIds required' });
    it.Name = b.Name || it.Name; it.ProductionYear = b.ProductionYear || it.ProductionYear; it.ProviderIds = { ...b.ProviderIds };
    res.status(204).end();
  });
  // Playback Reporting plugin: its custom-query endpoint over the play log.
  app.get('/user_usage_stats/type_filter_list', (req, res) => res.json(['Movie', 'Episode']));
  const ago = (d, h = 20) => { const t = new Date(now - d * 86400000); t.setHours(h, 0, 0, 0); return t.toISOString().replace('T', ' ').slice(0, 19); };
  const playLog = [
    [ago(1), 'u1', id(41), 'Episode', 'Severance - s02e01 - Hello, Ms. Cobel', 'Transcode (v:h264 a:aac)', (isEmby ? 'Emby for Android' : 'Jellyfin Android'), 'Pixel 8', 2900],
    [ago(3), 'u1', id(42), 'Episode', 'Severance - s02e02 - Goodbye, Mrs. Selvig', 'Transcode (v:h264 a:aac)', (isEmby ? 'Emby for Android' : 'Jellyfin Android'), 'Pixel 8', 3100],
    [ago(4), 'u2', id(43), 'Episode', 'Severance - s02e03 - Who Is Alive?', 'Transcode (v:h264 a:direct)', (isEmby ? 'Emby Web' : 'Jellyfin Web'), 'Chrome', 3000],
    [ago(6), 'u2', id(44), 'Episode', 'Severance - s02e04 - Woe\'s Hollow', 'DirectPlay', 'Infuse', 'Apple TV', 3200],
    [ago(2), 'u1', id(1), 'Movie', 'Dune: Part Two', 'Transcode (v:h264 a:direct)', (isEmby ? 'Emby Web' : 'Jellyfin Web'), 'Firefox', 9900],
    [ago(9), 'u2', id(1), 'Movie', 'Dune: Part Two', 'Transcode (v:h264 a:aac)', (isEmby ? 'Emby Web' : 'Jellyfin Web'), 'Chrome', 9800],
    [ago(5), 'u1', id(51), 'Episode', 'The Bear - s03e01 - Tomorrow', 'Transcode (v:direct a:aac)', (isEmby ? 'Emby Theater' : 'Jellyfin Media Player'), 'Desktop', 1800],
    [ago(8), 'u1', id(52), 'Episode', 'The Bear - s03e02 - Next', 'Transcode (v:direct a:aac)', (isEmby ? 'Emby Theater' : 'Jellyfin Media Player'), 'Desktop', 1750],
    [ago(7), 'u2', id(2), 'Movie', 'Oppenheimer', 'DirectPlay', 'Infuse', 'Apple TV', 10800],
    [ago(12), 'u1', id(2), 'Movie', 'Oppenheimer', 'DirectPlay', 'Infuse', 'Apple TV', 10700],
    [ago(60), 'u1', id(3), 'Movie', '1917', 'Transcode (v:h264 a:aac)', (isEmby ? 'Emby Web' : 'Jellyfin Web'), 'Chrome', 7000],
  ];
  const users = { u1: 'cameron', u2: 'guest' };
  app.post('/user_usage_stats/submit_custom_query', (req, res) => {
    const q = String((req.body && req.body.CustomQueryString) || '');
    if (!/^\s*select\b/i.test(q)) return res.json({ colums: [], results: [], message: 'Query executed, no data returned.' });
    const since = (/DateCreated >= '(\d{4}-\d{2}-\d{2})'/.exec(q) || [])[1] || '0000';
    const cols = ['ItemId', 'ItemType', 'ItemName', 'PlaybackMethod', 'ClientName', 'DeviceName', req.body.ReplaceUserId ? 'UserName' : 'UserId', 'DateCreated'];
    const results = playLog.filter((r) => r[0].slice(0, 10) >= since).map(([d, u, iid, type, name, method, client, device]) => [iid, type, name, method, client, device, req.body.ReplaceUserId ? users[u] : u, d]);
    res.json({ colums: cols, results, message: '' });
  });
  app.get('/Sessions', (req, res) => res.json([
    { Id: `${kind}-session`, UserName: 'cameron', Client: isEmby ? 'Emby Theater' : 'Jellyfin Web', DeviceName: 'Living Room', NowPlayingItem: items[0], PlayState: { IsPaused: false, PositionTicks: 24000000000 }, TranscodingInfo: { VideoCodec: 'h264', Bitrate: 8000000 } },
  ]));
  app.get('/Users', (req, res) => res.json([
    { Id: `${kind}-admin`, Name: 'cameron', PrimaryImageTag: 'user1', LastLoginDate: new Date(now - 3600000).toISOString(), Policy: { IsAdministrator: true, IsDisabled: false } },
    { Id: `${kind}-guest`, Name: 'Guest', LastLoginDate: new Date(now - 86400000).toISOString(), Policy: { IsAdministrator: false, IsDisabled: false } },
  ]));
  app.get(['/Items/:id/Images/Primary', '/Users/:id/Images/Primary'], (req, res) => res.type('image/svg+xml').send('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450"><rect width="100%" height="100%" fill="#334155"/><text x="50%" y="50%" fill="white" text-anchor="middle">MEDIA</text></svg>'));
  return app;
}

// ---------------- Usenet indexer (search; public indexers like NZBGeek) ----------------
function makeIndexer() {
  const app = express();
  const port = MOCK_PORTS.indexer;
  const getUrl = (id) => `http://127.0.0.1:${port}/api?t=get&id=${id}&apikey=MOCK_API_KEY`;
  const day = 86400000;
  // Demo catalogue spanning Audiobooks, Audio (30x0), Books (70x0), PC (40x0)
  // and Console (10x0).
  const catalogue = [
    { id: 'ab1', title: 'Project Hail Mary - Andy Weir [Audiobook M4B]', cat: '3030', size: 891289600, grabs: 142, age: 2 },
    { id: 'ab2', title: 'The Hobbit - J.R.R. Tolkien (Unabridged Audiobook)', cat: '3030', size: 650117120, grabs: 96, age: 9 },
    { id: 'ab3', title: 'Dune - Frank Herbert [Audiobook 64kbps]', cat: '3030', size: 738197504, grabs: 210, age: 15 },
    { id: 'eb1', title: 'Dune - Frank Herbert (Retail EPUB)', cat: '7020', size: 3145728, grabs: 320, age: 4 },
    { id: 'eb2', title: 'The Martian - Andy Weir [EPUB + MOBI]', cat: '7020', size: 4194304, grabs: 180, age: 20 },
    { id: 'cx1', title: 'Saga Vol. 1 (2012) (Digital) (comic)', cat: '7030', size: 47185920, grabs: 41, age: 30 },
    { id: 'mg1', title: 'National Geographic - January 2024', cat: '7010', size: 62914560, grabs: 12, age: 6 },
    { id: 'au1', title: 'Various Artists - Jazz Classics [MP3 320]', cat: '3010', size: 188743680, grabs: 27, age: 12 },
    { id: 'au2', title: 'Ludwig van Beethoven - Symphony No. 9 [FLAC]', cat: '3040', size: 524288000, grabs: 9, age: 40 },
    { id: 'tb1', title: 'Clean Code - Robert C. Martin (PDF)', cat: '7040', size: 9437184, grabs: 64, age: 11 },
    { id: 'pc1', title: 'LibreOffice 24.8.2 Win x64', cat: '4010', size: 356515840, grabs: 58, age: 3 },
    { id: 'pc2', title: 'Ubuntu 24.04.1 Desktop amd64 ISO', cat: '4020', size: 6174015488, grabs: 233, age: 25 },
    { id: 'pc3', title: 'Stardew Valley v1.6.14 (GOG)', cat: '4050', size: 734003200, grabs: 91, age: 8 },
    { id: 'cn1', title: 'Celeste (NSW homebrew demo) [3DS]', cat: '1110', size: 104857600, grabs: 7, age: 18 },
    { id: 'cn2', title: 'Retro Arcade Collection [PS4]', cat: '1180', size: 2147483648, grabs: 15, age: 21 },
  ];
  const catMatch = (itemCat, reqCats) => {
    if (!reqCats.length) return true;
    const ic = Number(itemCat);
    return reqCats.some((rc) => { const r = Number(rc); return r % 1000 === 0 ? Math.floor(ic / 1000) * 1000 === r : ic === r; });
  };
  const detailsUrl = (id) => `http://127.0.0.1:${MOCK_PORTS.indexer}/details/${id}`;
  const toItem = (it) => ({
    title: it.title,
    guid: detailsUrl(it.id),
    link: getUrl(it.id),
    comments: `${detailsUrl(it.id)}#comments`,
    description: `${it.title} — posted to alt.binaries.mock. ${it.grabs} grabs, retention OK. Includes PAR2 recovery.`,
    pubDate: new Date(Date.now() - it.age * day).toUTCString(),
    enclosure: { '@attributes': { url: getUrl(it.id), length: String(it.size), type: 'application/x-nzb' } },
    attr: [
      { '@attributes': { name: 'category', value: it.cat } },
      { '@attributes': { name: 'guid', value: it.id } },
      { '@attributes': { name: 'size', value: String(it.size) } },
      { '@attributes': { name: 'grabs', value: String(it.grabs) } },
      { '@attributes': { name: 'comments', value: String(it.grabs % 5) } },
      { '@attributes': { name: 'poster', value: 'ghost@usenet.mock' } },
      { '@attributes': { name: 'group', value: 'alt.binaries.mock' } },
      { '@attributes': { name: 'files', value: String(10 + (it.grabs % 30)) } },
      { '@attributes': { name: 'usenetdate', value: new Date(Date.now() - it.age * day).toUTCString() } },
    ],
  });

  app.use((req, res, next) => {
    recordCf('indexer', req);
    // The human-facing details/comments page uses a browser session, not the
    // API key — leave it ungated so demo "View on indexer"/"Comments" links work.
    if (req.path.startsWith('/details/')) return next();
    if (req.query.apikey !== 'MOCK_API_KEY') return res.status(401).json({ error: 'Missing or invalid API key' });
    next();
  });
  app.get('/details/:id', (req, res) => {
    const it = catalogue.find((x) => x.id === req.params.id) || { title: 'Release', grabs: 0 };
    res.type('html').send(`<!doctype html><meta charset="utf-8"><title>${it.title}</title>`
      + `<body style="font-family:system-ui;background:#0f1117;color:#e5e7eb;padding:32px;max-width:720px;margin:auto">`
      + `<h1>${it.title}</h1><p>Category ${it.cat || ''} · ${it.grabs} grabs</p>`
      + `<h2 id="comments">Comments</h2><p>Demo indexer details page (mock).</p></body>`);
  });
  app.get('/__debug', (req, res) => res.json({ cf: cfSeen.indexer || null }));
  app.get('/api', (req, res) => {
    const t = req.query.t;
    if (t === 'caps') {
      return res.json({ caps: { server: { '@attributes': { version: '1.0', title: 'Mock Indexer', strapline: 'Demo Usenet indexer' } } } });
    }
    if (t === 'comments') {
      const guid = String(req.query.guid || req.query.id || '');
      const item = catalogue.find((x) => x.id === guid);
      const n = item ? (item.grabs % 5) : 0;
      const users = ['nzbfan', 'audiophile', 'bookworm', 'grabby', 'mockuser'];
      const bodies = ['Perfect, thanks!', 'Great retention, downloaded fine.', 'Works with SABnzbd.', 'Nice quality rip.', 'PAR2 recovered a couple blocks — all good.'];
      const items = Array.from({ length: n }, (_, i) => ({
        title: users[i % users.length],
        description: bodies[i % bodies.length],
        pubDate: new Date(Date.now() - (i + 1) * 3600000).toUTCString(),
      }));
      return res.json({ channel: { item: items } });
    }
    if (['search', 'book', 'music', 'tvsearch', 'movie', ''].includes(t) || t === undefined) {
      const q = String(req.query.q || '').toLowerCase();
      const cats = String(req.query.cat || '').split(',').map((s) => s.trim()).filter(Boolean);
      let list = catalogue.filter((it) => catMatch(it.cat, cats));
      if (q) list = list.filter((it) => it.title.toLowerCase().includes(q));
      return res.json({ channel: { response: { '@attributes': { offset: '0', total: String(list.length) } }, item: list.map(toItem) } });
    }
    if (t === 'get') return res.type('application/x-nzb').send('<?xml version="1.0"?><nzb></nzb>');
    return res.json({ channel: { item: [] } });
  });
  return app;
}

// ---------------- Lidarr (music, API v1) ----------------
function makeLidarr(opts = {}) {
  const app = express();
  app.use(express.json());
  mountBackupMock(app, 'lidarr', 'v1');
  mountDoctorMock(app, 'v1', { clients: [demoDownloadClient(1, 'QBittorrent', { host: 'qbittorrent', port: 8080, category: 'lidarr', field: 'musicCategory' })], completedHandling: false });
  const now = Date.now();
  let artists = [
    { id: 1, artistName: 'Radiohead', foreignArtistId: 'a74b1b7f-71a5-4011-9441-d0b5e4122711', status: 'continuing', qualityProfileId: 1, monitored: true, overview: 'English rock band formed in Abingdon.', path: '/music/Radiohead', rootFolderPath: '/music', added: new Date(now - 90 * 86400000).toISOString(), statistics: { albumCount: 9, trackFileCount: 120, trackCount: 130, percentOfTracks: 92.3, sizeOnDisk: 8589934592 }, images: [] },
    { id: 2, artistName: 'Daft Punk', foreignArtistId: '056e4f3e-d505-4dad-8ec1-d04f521cbb56', status: 'ended', qualityProfileId: 1, monitored: true, overview: 'French electronic duo.', path: '/music/Daft Punk', rootFolderPath: '/music', added: new Date(now - 60 * 86400000).toISOString(), statistics: { albumCount: 4, trackFileCount: 52, trackCount: 52, percentOfTracks: 100, sizeOnDisk: 3221225472 }, images: [] },
    { id: 3, artistName: 'Miles Davis', foreignArtistId: '561d854a-6a28-4aa7-8c99-323e6ce46c2a', status: 'ended', qualityProfileId: 9, monitored: false, overview: 'American jazz trumpeter.', path: '/music/Miles Davis', rootFolderPath: '/music', added: new Date(now - 30 * 86400000).toISOString(), statistics: { albumCount: 12, trackFileCount: 140, trackCount: 140, percentOfTracks: 100, sizeOnDisk: 6442450944 }, images: [] },
  ];
  let queue = [
    { id: 301, title: 'Radiohead - OK Computer (1997) [FLAC]', artistId: 1, status: 'downloading', trackedDownloadState: 'downloading', trackedDownloadStatus: 'ok', size: 524288000, sizeleft: 104857600, timeleft: '00:03:00', estimatedCompletionTime: new Date(now + 180000).toISOString(), downloadClient: 'SABnzbd', indexer: 'NZBgeek', downloadId: 'lid-abc', protocol: 'usenet' },
    { id: 302, title: 'Daft Punk - Random Access Memories (2013) [FLAC]', artistId: 2, status: 'warning', trackedDownloadState: 'downloading', trackedDownloadStatus: 'warning', size: 734003200, sizeleft: 734003200, timeleft: '00:00:00', downloadClient: 'SABnzbd', indexer: 'NZBgeek', downloadId: 'lid-def', protocol: 'usenet', errorMessage: 'The download is stalled with no connections', statusMessages: [{ title: 'Download stalled', messages: ['The download is stalled with no connections'] }] },
  ];
  app.use((req, res, next) => { recordCf('lidarr', req); if (req.headers['x-api-key'] !== 'MOCK_API_KEY') return res.status(401).json({ error: 'Unauthorized' }); next(); });
  app.get('/__debug', (req, res) => res.json({ cf: cfSeen.lidarr || null }));
  app.get('/api/v1/system/status', (req, res) => res.json({ version: '2.6.4.4402', appName: 'Lidarr', instanceName: opts.instanceName || 'Lidarr (mock)' }));
  // The demo library still points at /music, which moved to /data/media/music.
  const lfs = opts.artists ? fsFromItems(artists) : lidarrDemoFs();
  const lidarrRoots = [{ id: 1, path: '/music' }];
  lfs.mount(app, { getItems: () => artists, rootFolders: () => lidarrRoots, prefix: '/api/v1' });
  // Mass editor (Tidy up): monitor / profile, and remove entries.
  app.put('/api/v1/artist/editor', (req, res) => {
    const b = req.body || {}; const ids = new Set((b.artistIds || []).map(Number));
    for (const a of artists.filter((x) => ids.has(x.id))) { if (typeof b.monitored === 'boolean') a.monitored = b.monitored; if (b.qualityProfileId) a.qualityProfileId = Number(b.qualityProfileId); }
    res.status(202).json(artists.filter((x) => ids.has(x.id)));
  });
  app.delete('/api/v1/artist/editor', (req, res) => { const ids = new Set(((req.body || {}).artistIds || []).map(Number)); artists = artists.filter((x) => !ids.has(x.id)); res.json({}); });
  app.get('/api/v1/artist/:id', (req, res) => { const a = artists.find((x) => x.id === Number(req.params.id)); return a ? res.json(a) : res.status(404).json({ message: 'NotFound' }); });
  app.put('/api/v1/artist/:id', (req, res) => {
    const id = Number(req.params.id);
    const i = artists.findIndex((a) => a.id === id);
    if (i < 0) return res.status(404).json({ message: 'NotFound' });
    artists[i] = { ...artists[i], ...req.body, id };
    res.status(202).json(artists[i]);
  });
  app.get('/api/v1/qualityprofile', (req, res) => res.json([{ id: 1, name: 'Lossless' }, { id: 2, name: 'Standard' }]));
  app.get('/api/v1/metadataprofile', (req, res) => res.json([{ id: 1, name: 'Standard' }]));
  app.get('/api/v1/artist', (req, res) => res.json(artists));
  app.get('/api/v1/queue', (req, res) => res.json({ page: 1, pageSize: 20, totalRecords: queue.length, records: queue }));
  app.delete('/api/v1/queue/:id', (req, res) => { queue = queue.filter((q) => q.id !== Number(req.params.id)); res.json({}); });
  app.get('/api/v1/calendar', (req, res) => res.json([
    { id: 401, artistId: 1, foreignAlbumId: 'x1', title: 'A Moon Shaped Pool (Reissue)', releaseDate: new Date(now + 2 * 86400000).toISOString(), monitored: true, artist: { artistName: 'Radiohead' } },
    { id: 402, artistId: 2, foreignAlbumId: 'x2', title: 'Discovery (Anniversary)', releaseDate: new Date(now + 5 * 86400000).toISOString(), monitored: true, artist: { artistName: 'Daft Punk' } },
  ]));
  app.get('/api/v1/history', (req, res) => res.json({ page: 1, pageSize: 40, totalRecords: 2, records: [
    { id: 1, eventType: 'trackFileImported', sourceTitle: 'Radiohead - In Rainbows [FLAC]', date: new Date(now - 3600000).toISOString(), artist: { artistName: 'Radiohead' } },
    { id: 2, eventType: 'downloadFailed', sourceTitle: 'Daft Punk - Homework [FLAC]', date: new Date(now - 7200000).toISOString(), artist: { artistName: 'Daft Punk' } },
  ] }));
  app.get('/api/v1/wanted/missing', (req, res) => res.json({ page: 1, pageSize: 50, totalRecords: 1, records: [
    { id: 501, title: 'The Bends', releaseDate: '1995-03-13', monitored: true, artist: { artistName: 'Radiohead' } },
  ] }));
  app.get('/api/v1/wanted/cutoff', (req, res) => res.json({ page: 1, pageSize: 50, totalRecords: 0, records: [] }));
  app.post('/api/v1/command', (req, res) => res.status(201).json({ id: Math.floor(Math.random() * 1000), name: (req.body && req.body.name) || 'Command', status: 'queued' }));
  app.get('/api/v1/command/:id', (req, res) => res.json({ id: Number(req.params.id), status: 'completed', message: 'Completed' }));
  app.get('/api/v1/health', (req, res) => res.json([]));
  return app;
}

// ---------------- Readarr (books, API v1) ----------------
function makeReadarr(opts = {}) {
  const app = express();
  app.use(express.json());
  mountBackupMock(app, 'readarr', 'v1');
  mountDoctorMock(app, 'v1', { clients: [] });
  const now = Date.now();
  let authors = [
    { id: 1, authorName: 'Brandon Sanderson', foreignAuthorId: 'b1', monitored: true, overview: 'American fantasy author.', path: '/books/Brandon Sanderson', rootFolderPath: '/books', added: new Date(now - 120 * 86400000).toISOString(), statistics: { bookCount: 20, bookFileCount: 18, sizeOnDisk: 1073741824 }, images: [] },
    { id: 2, authorName: 'Andy Weir', foreignAuthorId: 'b2', monitored: true, overview: 'American novelist.', path: '/books/Andy Weir', rootFolderPath: '/books', added: new Date(now - 45 * 86400000).toISOString(), statistics: { bookCount: 3, bookFileCount: 3, sizeOnDisk: 157286400 }, images: [] },
    { id: 3, authorName: 'Terry Pratchett', foreignAuthorId: 'b3', status: 'ended', qualityProfileId: 1, monitored: true, overview: 'English humorist and fantasy author.', path: '/books/Terry Pratchett', rootFolderPath: '/books', added: new Date(now - 400 * 86400000).toISOString(), statistics: { bookCount: 41, bookFileCount: 41, sizeOnDisk: 524288000 }, images: [] },
    { id: 4, authorName: 'Agatha Christie', foreignAuthorId: 'b4', status: 'ended', qualityProfileId: 1, monitored: false, overview: 'English crime novelist.', path: '/books/Agatha Christie', rootFolderPath: '/books', added: new Date(now - 300 * 86400000).toISOString(), statistics: { bookCount: 66, bookFileCount: 0, sizeOnDisk: 0 }, images: [] },
  ];
  let queue = [
    { id: 601, title: 'Andy Weir - Project Hail Mary [EPUB]', authorId: 2, status: 'downloading', trackedDownloadState: 'downloading', trackedDownloadStatus: 'ok', size: 4194304, sizeleft: 1048576, timeleft: '00:00:30', estimatedCompletionTime: new Date(now + 30000).toISOString(), downloadClient: 'SABnzbd', indexer: 'NZBgeek', downloadId: 'rd-abc', protocol: 'usenet' },
  ];
  app.use((req, res, next) => { recordCf('readarr', req); if (req.headers['x-api-key'] !== 'MOCK_API_KEY') return res.status(401).json({ error: 'Unauthorized' }); next(); });
  app.get('/__debug', (req, res) => res.json({ cf: cfSeen.readarr || null }));
  app.get('/api/v1/system/status', (req, res) => res.json({ version: '0.4.7.2718', appName: 'Readarr', instanceName: opts.instanceName || 'Readarr (mock)' }));
  app.get('/api/v1/rootfolder', (req, res) => res.json([{ id: 1, path: '/books', freeSpace: 120000000000, accessible: true }]));
  app.get('/api/v1/diskspace', (req, res) => res.json([{ path: '/', label: 'root', freeSpace: 120000000000, totalSpace: 500000000000 }]));
  app.get('/api/v1/qualityprofile', (req, res) => res.json([{ id: 1, name: 'eBook' }, { id: 2, name: 'Audiobook' }]));
  app.get('/api/v1/metadataprofile', (req, res) => res.json([{ id: 1, name: 'Standard' }]));
  app.get('/api/v1/author', (req, res) => res.json(authors));
  app.put('/api/v1/author/editor', (req, res) => {
    const b = req.body || {}; const ids = new Set((b.authorIds || []).map(Number));
    for (const a of authors.filter((x) => ids.has(x.id))) { if (typeof b.monitored === 'boolean') a.monitored = b.monitored; if (b.qualityProfileId) a.qualityProfileId = Number(b.qualityProfileId); }
    res.status(202).json(authors.filter((x) => ids.has(x.id)));
  });
  app.delete('/api/v1/author/editor', (req, res) => { const ids = new Set(((req.body || {}).authorIds || []).map(Number)); authors = authors.filter((x) => !ids.has(x.id)); res.json({}); });
  app.get('/api/v1/queue', (req, res) => res.json({ page: 1, pageSize: 20, totalRecords: queue.length, records: queue }));
  app.delete('/api/v1/queue/:id', (req, res) => { queue = queue.filter((q) => q.id !== Number(req.params.id)); res.json({}); });
  app.get('/api/v1/calendar', (req, res) => res.json([
    { id: 701, authorId: 1, title: 'Wind and Truth', releaseDate: new Date(now + 4 * 86400000).toISOString(), monitored: true, author: { authorName: 'Brandon Sanderson' } },
  ]));
  app.get('/api/v1/history', (req, res) => res.json({ page: 1, pageSize: 40, totalRecords: 1, records: [
    { id: 1, eventType: 'bookFileImported', sourceTitle: 'Andy Weir - The Martian [EPUB]', date: new Date(now - 5400000).toISOString(), author: { authorName: 'Andy Weir' } },
  ] }));
  app.get('/api/v1/wanted/missing', (req, res) => res.json({ page: 1, pageSize: 50, totalRecords: 1, records: [
    { id: 801, title: 'Warbreaker', releaseDate: '2009-06-09', monitored: true, author: { authorName: 'Brandon Sanderson' } },
  ] }));
  app.get('/api/v1/wanted/cutoff', (req, res) => res.json({ page: 1, pageSize: 50, totalRecords: 0, records: [] }));
  app.post('/api/v1/command', (req, res) => res.status(201).json({ id: Math.floor(Math.random() * 1000), name: (req.body && req.body.name) || 'Command', status: 'queued' }));
  app.get('/api/v1/command/:id', (req, res) => res.json({ id: Number(req.params.id), status: 'completed', message: 'Completed' }));
  app.get('/api/v1/health', (req, res) => res.json([]));
  return app;
}

// ---------------- Bindery (Readarr successor, API v1) ----------------
// Listenarr (audiobooks, pre-1.0): /api/v1, X-Api-Key. Shapes follow
// Listenarrs/Listenarr fe/src/types (Audiobook slim list, QueueSnapshot,
// History envelope, metadata SearchResult).
function makeListenarr() {
  const app = express();
  app.use(express.json());
  let books = [
    { id: 1, title: 'Project Hail Mary', authors: ['Andy Weir'], narrators: ['Ray Porter'], publishYear: '2021', asin: 'B08G9PRS1K', monitored: true, fileCount: 1, fileSize: 1073741824, runtime: 970, status: 'quality-match', wanted: false, imageUrl: null },
    { id: 2, title: 'The Way of Kings', authors: ['Brandon Sanderson'], narrators: ['Michael Kramer', 'Kate Reading'], series: 'The Stormlight Archive', seriesNumber: '1', publishYear: '2010', asin: 'B003P2WO5E', monitored: true, fileCount: 0, fileSize: 0, runtime: 2741, status: 'no-file', wanted: true, imageUrl: null },
    { id: 3, title: 'Dungeon Crawler Carl', authors: ['Matt Dinniman'], narrators: ['Jeff Hays'], series: 'Dungeon Crawler Carl', seriesNumber: '1', publishYear: '2020', asin: 'B08BX5K3V4', monitored: true, fileCount: 0, fileSize: 0, runtime: 816, status: 'downloading', wanted: true, imageUrl: null },
    { id: 4, title: 'Dune', authors: ['Frank Herbert'], narrators: ['Scott Brick'], publishYear: '2007', asin: 'B002V1OF70', monitored: false, fileCount: 2, fileSize: 1395864371, runtime: 1263, status: 'quality-mismatch', wanted: false, imageUrl: null },
  ];
  let queue = [
    { id: 'q-1', title: 'Dungeon Crawler Carl [M4B]', audiobookId: 3, author: 'Matt Dinniman', quality: 'M4B 64kbps', status: 'downloading', progress: 42.5, size: 524288000, downloaded: 222822400, downloadSpeed: 3145728, eta: 96, downloadClient: 'qBittorrent', downloadClientId: 'qb', downloadClientType: 'qbittorrent', addedAt: new Date(Date.now() - 600000).toISOString(), canPause: true, canRemove: true },
  ];
  app.use((req, res, next) => { recordCf('listenarr', req); if (req.headers['x-api-key'] !== 'MOCK_API_KEY') return res.status(401).json({ error: 'Unauthorized' }); next(); });
  app.get('/__debug', (req, res) => res.json({ cf: cfSeen.listenarr || null }));
  app.get('/api/v1/system/info', (req, res) => res.json({ version: '0.2.60-canary', operatingSystem: 'Linux', runtime: '.NET 10', uptime: '3.02:11:09', startTime: new Date(Date.now() - 266000000).toISOString() }));
  app.get('/api/v1/system/health', (req, res) => res.json([]));
  app.get('/api/v1/library', (req, res) => res.json(books));
  app.get('/api/v1/qualityprofile', (req, res) => res.json([{ id: 1, name: 'Any', isDefault: false, qualities: [] }, { id: 2, name: 'M4B preferred', isDefault: true, qualities: [] }]));
  app.get('/api/v1/rootfolders', (req, res) => res.json([{ id: 1, name: 'Audiobooks', path: '/audiobooks', isDefault: true }, { id: 2, name: 'Archive', path: '/mnt/archive/audiobooks', isDefault: false }]));
  app.get('/api/v1/system/storage', (req, res) => res.json({ usedBytes: 0, totalBytes: 0, freeBytes: 0, disks: [
    { label: 'root', path: '/', freeBytes: 812 * 1024 ** 3, totalBytes: 2000 * 1024 ** 3 },
    { label: 'archive', path: '/mnt/archive', freeBytes: 3.6 * 1024 ** 4, totalBytes: 8 * 1024 ** 4 },
  ] }));
  app.post('/api/v1/library/preview-path', (req, res) => {
    const m = (req.body && req.body.metadata) || {}; const root = String((req.body && req.body.destinationRoot) || '/audiobooks').replace(/\/+$/, '');
    const rel = `${(m.authors && m.authors[0]) || 'Unknown'}/${m.title || 'Untitled'}`;
    res.json({ fullPath: `${root}/${rel}`, relativePath: rel, root });
  });
  app.get('/api/v1/download/queue', (req, res) => res.json({ items: queue, clients: [], generatedAt: new Date().toISOString(), hasStaleData: false, hasUnavailableClients: false }));
  app.delete('/api/v1/download/queue/:id', (req, res) => { queue = queue.filter((q) => q.id !== req.params.id); res.json({ message: 'Removed' }); });
  app.post('/api/v1/download/search-and-download', (req, res) => res.json({ success: true, downloadId: 'q-2', indexerUsed: 'MyAnonamouse', downloadClientUsed: 'qBittorrent' }));
  app.get('/api/v1/history', (req, res) => res.json({ history: [
    { id: 1, audiobookId: 1, audiobookTitle: 'Project Hail Mary', eventType: 'Imported', message: 'Imported 1 file', source: 'Download', timestamp: new Date(Date.now() - 7200000).toISOString() },
    { id: 2, audiobookId: 3, audiobookTitle: 'Dungeon Crawler Carl', eventType: 'Grabbed', message: 'Sent to qBittorrent', source: 'Search', timestamp: new Date(Date.now() - 900000).toISOString() },
    { id: 3, audiobookId: 2, audiobookTitle: 'The Way of Kings', eventType: 'DownloadFailed', message: 'No seeders', source: 'Download', timestamp: new Date(Date.now() - 86400000).toISOString() },
  ], total: 3, limit: Number(req.query.limit) || 50, offset: 0 }));
  app.post('/api/v1/search', (req, res) => {
    const q = String((req.body && req.body.query) || 'Mistborn');
    res.json([
      { id: 's1', title: q, artist: 'Brandon Sanderson', authors: [{ name: 'Brandon Sanderson' }], narrators: [{ name: 'Michael Kramer' }], asin: 'B002UZMLXM', series: 'Mistborn', seriesNumber: '1', lengthMinutes: 1462, releaseDate: '2009-11-24', imageUrl: null, metadataSource: 'Audible' },
      { id: 's2', title: 'Project Hail Mary', artist: 'Andy Weir', authors: [{ name: 'Andy Weir' }], narrators: [{ name: 'Ray Porter' }], asin: 'B08G9PRS1K', lengthMinutes: 970, releaseDate: '2021-05-04', imageUrl: null, metadataSource: 'Audible' },
    ]);
  });
  app.post('/api/v1/library/add', (req, res) => {
    const m = (req.body && req.body.metadata) || {};
    if (!m.title) return res.status(400).json({ message: 'metadata.title is required' });
    if (books.some((b) => m.asin && b.asin === m.asin)) return res.status(409).json({ message: 'Audiobook already exists in library' });
    const b = { id: books.length + 1, title: m.title, authors: m.authors || [], narrators: m.narrators || [], asin: m.asin, monitored: req.body.monitored !== false, qualityProfileId: req.body.qualityProfileId, basePath: req.body.destinationPath, fileCount: 0, fileSize: 0, status: 'no-file', wanted: true };
    books.push(b);
    res.status(201).json({ message: 'Added', audiobook: b });
  });
  return app;
}

function makeBindery() {
  const app = express();
  app.use(express.json());
  const now = Date.now();
  const authors = [
    { id: 11, authorName: 'N. K. Jemisin', foreignAuthorId: 'OL6813008A', monitored: true, statistics: { bookCount: 9, availableBookCount: 7, wantedBookCount: 2 } },
    { id: 12, authorName: 'Martha Wells', foreignAuthorId: 'OL3396730A', monitored: true, statistics: { bookCount: 14, availableBookCount: 12, wantedBookCount: 2 } },
  ];
  const books = [
    { id: 21, title: 'The Stone Sky', authorId: 11, author: authors[0], monitored: true, status: 'imported', releaseDate: '2017-08-15', mediaType: 'ebook' },
    { id: 22, title: 'The Fifth Season', authorId: 11, author: authors[0], monitored: true, status: 'wanted', releaseDate: new Date(now + 5 * 86400000).toISOString(), mediaType: 'audiobook' },
  ];
  let queue = [
    { id: 31, title: 'Martha Wells - Network Effect [EPUB]', status: 'downloading', size: 5242880, percentage: '72.5', timeLeft: '00:00:25', protocol: 'usenet', book: { id: 22, title: 'Network Effect', authorId: 12, authorName: 'Martha Wells' } },
  ];
  const page = (items, req) => ({ items, total: items.length, limit: Number(req.query.limit) || 50, offset: Number(req.query.offset) || 0 });
  app.use((req, res, next) => { recordCf('bindery', req); if (req.headers['x-api-key'] !== 'MOCK_API_KEY') return res.status(401).json({ error: 'Unauthorized' }); next(); });
  app.get('/__debug', (req, res) => res.json({ cf: cfSeen.bindery || null }));
  app.get('/api/v1/health', (req, res) => res.json({ status: 'ok', version: '1.37.0' }));
  app.get('/api/v1/system/status', (req, res) => res.json({ version: '1.37.0', commit: 'mock', buildDate: new Date(0).toISOString() }));
  app.get('/api/v1/author', (req, res) => res.json(page(authors, req)));
  app.get('/api/v1/book', (req, res) => {
    let result = books;
    if (req.query.status) result = result.filter((book) => book.status === req.query.status);
    if (req.query.releaseFrom) result = result.filter((book) => new Date(book.releaseDate) >= new Date(String(req.query.releaseFrom)));
    if (req.query.releaseBefore) result = result.filter((book) => new Date(book.releaseDate) < new Date(String(req.query.releaseBefore)));
    res.json(page(result, req));
  });
  app.get('/api/v1/wanted/missing', (req, res) => res.json(page(books.filter((book) => book.status === 'wanted'), req)));
  app.post('/api/v1/book/:id/search', (req, res) => res.status(202).json({ bookId: Number(req.params.id), status: 'queued' }));
  app.get('/api/v1/queue', (req, res) => res.json({ items: queue, partial: false, staleClients: [] }));
  app.delete('/api/v1/queue/:id', (req, res) => { queue = queue.filter((item) => item.id !== Number(req.params.id)); res.json({ ok: true }); });
  app.get('/api/v1/history', (req, res) => res.json(page([
    { id: 41, bookId: 21, eventType: 'bookImported', sourceTitle: 'The Stone Sky [EPUB]', createdAt: new Date(now - 3600000).toISOString(), book: { id: 21, title: 'The Stone Sky', authorId: 11, authorName: 'N. K. Jemisin' } },
  ], req)));
  return app;
}

export function startMockServices() {
  const librarySize = Number.parseInt(process.env.MOCK_LIBRARY_SIZE || '', 10);
  const primaryLibraryOptions = Number.isFinite(librarySize) && librarySize > 0 ? { librarySize } : {};
  const defs = [
    ['sonarr', makeSonarr(primaryLibraryOptions), MOCK_PORTS.sonarr],
    ['sonarr-anime', makeSonarr({ instanceName: 'Sonarr Anime (mock)', series: [
      { id: 1, title: 'Frieren: Beyond Journey\u2019s End', year: 2023, tvdbId: 424536, status: 'continuing', monitored: true, seasonCount: 1, network: 'Nippon TV', overview: 'A mage reflects on her journey after the hero party disbands.', path: '/anime/Frieren', rootFolderPath: '/anime', statistics: { episodeFileCount: 28, episodeCount: 28, percentOfEpisodes: 100, sizeOnDisk: 21474836480 }, images: [] },
      { id: 2, title: 'Attack on Titan', year: 2013, tvdbId: 267440, status: 'ended', monitored: true, seasonCount: 4, network: 'MBS', overview: 'Humanity fights for survival against man-eating titans.', path: '/anime/Attack on Titan', rootFolderPath: '/anime', statistics: { episodeFileCount: 85, episodeCount: 88, percentOfEpisodes: 96.6, sizeOnDisk: 96636764160 }, images: [] },
      { id: 3, title: 'Jujutsu Kaisen', year: 2020, tvdbId: 377543, status: 'continuing', monitored: false, seasonCount: 2, network: 'MBS', overview: 'A student joins a secret organization of sorcerers.', path: '/anime/Jujutsu Kaisen', rootFolderPath: '/anime', statistics: { episodeFileCount: 47, episodeCount: 47, percentOfEpisodes: 100, sizeOnDisk: 53687091200 }, images: [] },
    ] }), MOCK_PORTS.sonarrAnime],
    ['radarr', makeRadarr(primaryLibraryOptions), MOCK_PORTS.radarr],
    ['radarr-4k', makeRadarr({ instanceName: 'Radarr 4K (mock)', movies: [
      { id: 1, title: 'Blade Runner 2049', year: 2017, tmdbId: 335984, status: 'released', monitored: true, hasFile: true, runtime: 164, overview: 'A young blade runner uncovers a long-buried secret.', path: '/movies-4k/Blade Runner 2049 (2017)', rootFolderPath: '/movies-4k', sizeOnDisk: 64424509440, tags: [3], studio: 'Alcon', images: [] },
      { id: 2, title: 'Interstellar', year: 2014, tmdbId: 157336, status: 'released', monitored: true, hasFile: true, runtime: 169, overview: 'Explorers travel through a wormhole in search of a new home.', path: '/movies-4k/Interstellar (2014)', rootFolderPath: '/movies-4k', sizeOnDisk: 75161927680, studio: 'Paramount', images: [] },
      { id: 3, title: 'Top Gun: Maverick', year: 2022, tmdbId: 361743, status: 'released', monitored: false, hasFile: false, runtime: 130, overview: 'Maverick trains a detachment of Top Gun graduates.', path: '/movies-4k/Top Gun Maverick (2022)', rootFolderPath: '/movies-4k', sizeOnDisk: 0, studio: 'Paramount', images: [] },
    ] }), MOCK_PORTS.radarr4k],
    ['lidarr', makeLidarr(), MOCK_PORTS.lidarr],
    ['readarr', makeReadarr(), MOCK_PORTS.readarr],
    ['bindery', makeBindery(), MOCK_PORTS.bindery],
    ['listenarr', makeListenarr(), MOCK_PORTS.listenarr],
    ['overseerr', makeOverseerr(), MOCK_PORTS.overseerr],
    ['sabnzbd', makeSab(), MOCK_PORTS.sabnzbd],
    ['tautulli', makeTautulli(), MOCK_PORTS.tautulli],
    ['bazarr', makeBazarr(), MOCK_PORTS.bazarr],
    ['prowlarr', makeProwlarr(), MOCK_PORTS.prowlarr],
    ['qbittorrent', makeQbittorrent(), MOCK_PORTS.qbittorrent],
    ['transmission', makeTransmission(), MOCK_PORTS.transmission],
    ['deluge', makeDeluge(), MOCK_PORTS.deluge],
    ['nzbget', makeNzbget(), MOCK_PORTS.nzbget],
    ['jellyfin', makeMediaServer('jellyfin'), MOCK_PORTS.jellyfin],
    ['emby', makeMediaServer('emby'), MOCK_PORTS.emby],
    ['indexer', makeIndexer(), MOCK_PORTS.indexer],
    ['flood', makeFlood(), MOCK_PORTS.flood],
    ['audiobookshelf', makeAudiobookshelf(), MOCK_PORTS.audiobookshelf],
    ['autobrr', makeAutobrr(), MOCK_PORTS.autobrr],
    ['maintainerr', makeMaintainerr(), MOCK_PORTS.maintainerr],
    ['tdarr', makeTdarr(), MOCK_PORTS.tdarr],
    ['portainer', makePortainer(), MOCK_PORTS.portainer],
    ['glances', makeGlances(), MOCK_PORTS.glances],
    ['pihole', makePihole(), MOCK_PORTS.pihole],
    ['adguard', makeAdguard(), MOCK_PORTS.adguard],
    ['syncthing', makeSyncthing(), MOCK_PORTS.syncthing],
    ['navidrome', makeNavidrome(), MOCK_PORTS.navidrome],
    ['pulsarr', makePulsarr(), MOCK_PORTS.pulsarr],
    ['unpackerr', makeUnpackerr(), MOCK_PORTS.unpackerr],
    ['speedtest', makeSpeedtest(), MOCK_PORTS.speedtest],
    ['plex', makePlex(), MOCK_PORTS.plex],
    ['whisparr', makeSonarr({ instanceName: 'Whisparr (mock)' }), MOCK_PORTS.whisparr],
    ['unraid', makeUnraid(), MOCK_PORTS.unraid],
    ['truenas', makeTruenasServer(), MOCK_PORTS.truenas],
  ];
  const servers = [];
  for (const [name, app, port] of defs) {
    // A login-page-like title, as the real apps serve, for the setup wizard.
    // Real apps serve their login page without a key; the mocks' own auth
    // would refuse it, so answer "/" in front of them.
    let front = app;
    if (typeof app.get === 'function' && typeof app.use === 'function') { front = express(); front.get('/', (req, res, next) => (req.headers['x-plex-token'] ? next() : res.type('html').send(`<!doctype html><title>${name}</title>`))); front.use(app); }
    const server = front.listen(port, '127.0.0.1', () => {
      console.log(`  [mock] ${name} listening on http://127.0.0.1:${port}`);
    });
    servers.push(server);
  }
  return servers;
}

// Exposed for tests (in-process, ephemeral ports).
export { makeSab as _makeSabMock, makeMediaServer as _makeMediaServerMock, makeReadarr as _makeReadarrMock, makeLidarr as _makeLidarrMock, makeSonarr as _makeSonarrMock, makeRadarr as _makeRadarrMock, makeBazarr as _makeBazarrMock, makeQbittorrent as _makeQbittorrentMock, makeTransmission as _makeTransmissionMock, makeDeluge as _makeDelugeMock, makeNzbget as _makeNzbgetMock, makeFlood as _makeFloodMock, makeOverseerr as _makeOverseerrMock, makeTautulli as _makeTautulliMock, makeProwlarr as _makeProwlarrMock };
