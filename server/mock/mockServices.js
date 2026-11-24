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
  chaptarr: 18789,
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
  let nextFileId = 7001;
  const qualities = [
    { id: 1, quality: { id: 1, name: 'SDTV' }, title: 'SDTV', minSize: 2, maxSize: 100 },
    { id: 2, quality: { id: 4, name: 'HDTV-720p' }, title: 'HDTV-720p', minSize: 17.1, maxSize: 400 },
    { id: 7, quality: { id: 5, name: 'WEBDL-720p' }, title: 'WEBDL-720p', minSize: 12.5, maxSize: 400 },
    { id: 3, quality: { id: 3, name: 'WEBDL-1080p' }, title: 'WEBDL-1080p', minSize: 12.5, maxSize: 400 },
    { id: 4, quality: { id: 7, name: 'Bluray-1080p' }, title: 'Bluray-1080p', minSize: 50.4, maxSize: 400 },
    { id: 5, quality: { id: 18, name: 'WEBDL-2160p' }, title: 'WEBDL-2160p', minSize: 34.5, maxSize: 1000 },
    { id: 6, quality: { id: 19, name: 'Bluray-2160p' }, title: 'Bluray-2160p', minSize: 102, maxSize: 1000 },
  ];
  app.get('/api/v3/qualitydefinition', (req, res) => res.json(qualities));
  const isVideo = (n) => /\.(mkv|mp4|avi|m4v|ts)$/i.test(n);
  const walkVideos = (dir) => { const out = []; const walk = (d) => { for (const c of (fs && fs.children(d)) || []) { if (c.type === 'file') { if (isVideo(c.name)) out.push(c); } else walk(c.path); } }; walk(dir); return out; };
  const UNKNOWN_Q = { quality: { id: 0, name: 'Unknown', source: 'unknown', resolution: 0 }, revision: { version: 1, real: 0, isRepack: false } };
  app.get('/api/v3/manualimport', (req, res, next) => {
    // Real Sonarr/Radarr ignore `folder` when a seriesId/movieId is given (and
    // no downloadId): they list that item's own files, then any other video
    // file in its folder with no episodes and unknown quality.
    const id = Number(kind === 'series' ? req.query.seriesId : req.query.movieId);
    if (!id || req.query.downloadId) return next();
    const it = library().find((x) => x.id === id);
    if (!it) return res.json([]);
    const own = kind === 'series' ? (episodeFiles || []).filter((ef) => ef.seriesId === id) : (it.movieFile ? [{ ...it.movieFile, path: `${it.path}/${it.movieFile.relativePath}` }] : []);
    const known = new Set(own.map((f) => String(f.path).toLowerCase()));
    const ref = kind === 'series' ? { series: { id, title: it.title } } : { movie: { id, title: it.title, year: it.year } };
    const tracked = own.map((f, i) => ({ id: i + 1, path: f.path, relativePath: f.relativePath, folderName: String(it.path).split('/').pop(), name: String(f.relativePath).split('/').pop().replace(/\.[^.]+$/, ''), size: f.size || 0, ...ref, quality: f.quality, languages: [{ id: 1, name: 'English' }], releaseGroup: f.releaseGroup || '', rejections: [],
      ...(kind === 'series' ? { seasonNumber: f.seasonNumber, episodes: (f.episodeIds || []).map((eid) => ({ id: eid, seasonNumber: Math.floor((eid - 5000) / 100), episodeNumber: eid % 100, episodeFileId: f.id, hasFile: true })), episodeFileId: f.id } : { movieFileId: f.id }) }));
    const other = walkVideos(String(it.path)).filter((c) => !known.has(String(c.path).toLowerCase())).map((c, i) => ({ id: tracked.length + i + 1, path: c.path, relativePath: c.path.slice(String(it.path).length + 1), folderName: String(it.path).split('/').pop(), name: c.name.replace(/\.[^.]+$/, ''), size: 0, ...ref, quality: UNKNOWN_Q, languages: [{ id: 0, name: 'Unknown' }], releaseGroup: '', rejections: [], ...(kind === 'series' ? { seasonNumber: null, episodes: [] } : {}) }));
    return res.json([...tracked, ...other]);
  });
  app.get('/api/v3/manualimport', (req, res) => {
    // Folder import (movies): every video file in the folder, mapped to the
    // given movie, rejected when it isn't better than the current file.
    if (req.query.folder && fs && kind === 'movie') {
      // Like Radarr: the movie from the folder's name (title and year), or a
      // loose file's own name.
      const folder = String(req.query.folder);
      const movie = library().find((m) => m.id === Number(req.query.movieId)) || movieFromName(folder.split('/').pop(), library());
      const out = [];
      const walk = (dir) => { for (const c of fs.children(dir) || []) { if (c.type === 'file') { if (/\.(mkv|mp4|avi|m4v)$/i.test(c.name)) out.push(c); } else walk(c.path); } };
      if (fs.isFile(folder)) out.push({ type: 'file', name: folder.split('/').pop(), path: folder }); else walk(folder);
      return res.json(out.map((c, i) => {
        const q = qualityFromName(c.name);
        const cur = movie && movie.movieFile && movie.movieFile.quality && movie.movieFile.quality.quality;
        const rejections = !movie ? [{ reason: 'Unknown Movie', type: 'permanent' }] : cur && (QUALITY_RANK[q.id] || 0) <= (QUALITY_RANK[cur.id] || 0) ? [{ reason: 'Not an upgrade for existing movie file', type: 'permanent' }] : [];
        return { id: i + 1, path: c.path, relativePath: c.name, folderName: String(req.query.folder).split('/').pop(), name: c.name.replace(/\.[^.]+$/, ''), size: 61203283968, movie: movie ? { id: movie.id, title: movie.title, year: movie.year, hasFile: !!movie.movieFile } : undefined, quality: { quality: q, revision: { version: 1, real: 0, isRepack: false } }, languages: [{ id: 1, name: 'English' }], releaseGroup: '', indexerFlags: 0, rejections };
      }));
    }
    // Folder import (series): every SxxEyy video file, mapped to episodes,
    // rejected when it isn't better than those episodes' current files.
    if (req.query.folder && fs && kind === 'series') {
      // Like Sonarr: the series from the folder's name (the part before
      // SxxEyy), or a loose file's own name.
      const folder = String(req.query.folder);
      const s = library().find((x) => x.id === Number(req.query.seriesId)) || seriesFromName(folder.split('/').pop(), library());
      const out = [];
      const walk = (dir) => { for (const c of fs.children(dir) || []) { if (c.type === 'file') { if (/\.(mkv|mp4|avi|m4v)$/i.test(c.name)) out.push(c); } else walk(c.path); } };
      if (fs.isFile(folder)) out.push({ type: 'file', name: folder.split('/').pop(), path: folder }); else walk(folder);
      return res.json(out.map((c, i) => {
        const m = /S(\d+)E(\d+)/i.exec(c.name);
        const season = m ? Number(m[1]) : 1; const ep = m ? Number(m[2]) : 1;
        const epId = 5000 + season * 100 + ep;
        const q = qualityFromName(c.name);
        const cur = (episodeFiles || []).find((ef) => s && ef.seriesId === s.id && (ef.episodeIds || []).includes(epId));
        const curQ = cur && cur.quality && cur.quality.quality;
        const rejections = !s ? [{ reason: 'Unknown Series', type: 'permanent' }] : !m ? [{ reason: 'Unable to parse file', type: 'permanent' }] : curQ && (QUALITY_RANK[q.id] || 0) <= (QUALITY_RANK[curQ.id] || 0) ? [{ reason: 'Not an upgrade for existing episode file(s)', type: 'permanent' }] : [];
        return { id: i + 1, path: c.path, relativePath: c.name, folderName: '', name: c.name.replace(/\.[^.]+$/, ''), size: 9e9, series: s ? { id: s.id, title: s.title, year: s.year } : undefined, seasonNumber: season, episodes: s && m ? [{ id: epId, seasonNumber: season, episodeNumber: ep, title: `Episode ${ep}`, episodeFileId: cur ? cur.id : 0, hasFile: !!cur }] : [], quality: { quality: q, revision: { version: 1, real: 0, isRepack: false } }, languages: [{ id: 1, name: 'English' }], releaseGroup: '', releaseType: 'singleEpisode', indexerFlags: 0, rejections };
      }));
    }
    const id = String(req.query.downloadId || '');
    res.json(JSON.parse(JSON.stringify(candidates[id] || candidates.default || [])));
  });
  // Reprocess: evaluates each file for the given series or movie. With no
  // episodes, Sonarr matches them from the file name; unknown quality and
  // language are read from the name; "Not an upgrade" when the current file is
  // as good. Like Sonarr 4, the release group comes back only if one was sent.
  const groupOf = (name) => { const m = /-([A-Za-z0-9]+)$/.exec(String(name).replace(/\.[^.]+$/, '')); return m && !/^(DL|RIP)$/i.test(m[1]) ? m[1] : ''; };
  app.post('/api/v3/manualimport', (req, res) => {
    const items = Array.isArray(req.body) ? req.body : [];
    res.json(items.map((it) => {
      const name = String(it.path || '').split('/').pop();
      const quality = it.quality && it.quality.quality && it.quality.quality.id ? it.quality : { quality: qualityFromName(name), revision: { version: 1, real: 0, isRepack: false } };
      const langs = Array.isArray(it.languages) && it.languages.some((l) => l && l.id) ? it.languages : [{ id: 1, name: 'English' }];
      const rank = (q) => QUALITY_RANK[q && q.id] || 0;
      if (kind === 'series') {
        const s = library().find((x) => x.id === it.seriesId);
        if (!s) return { ...it, quality, languages: langs, episodes: [], episodeIds: undefined, rejections: [{ reason: 'Unknown Series', type: 'permanent' }] };
        let ids = (it.episodeIds || []).map(Number);
        if (!ids.length && it.seasonNumber == null) { const m = /S(\d+)E(\d+)/i.exec(name); if (m) ids = [5000 + Number(m[1]) * 100 + Number(m[2])]; }
        const fileFor = (eid) => (episodeFiles || []).find((ef) => ef.seriesId === s.id && (ef.episodeIds || []).includes(eid));
        const episodes = ids.map((eid) => { const f = fileFor(eid); return { id: eid, seriesId: s.id, seasonNumber: Math.floor((eid - 5000) / 100), episodeNumber: eid % 100, title: `Episode ${eid % 100}`, episodeFileId: f ? f.id : 0, hasFile: !!f }; });
        const rejections = [];
        if (!episodes.length) rejections.push({ reason: it.seasonNumber == null ? 'Unable to determine if file is a sample' : 'Episodes not selected', type: 'permanent' });
        const cur = episodes.map((e) => fileFor(e.id)).find(Boolean);
        const curQ = cur && cur.quality && cur.quality.quality;
        if (curQ && rank(quality.quality) <= rank(curQ)) rejections.push({ reason: `Not an upgrade for existing episode file(s). Existing quality: ${curQ.name}. New Quality ${quality.quality.name}.`, type: 'permanent' });
        return { ...it, seasonNumber: episodes.length ? episodes[0].seasonNumber : (it.seasonNumber ?? null), episodes, episodeIds: undefined, quality, languages: langs, releaseGroup: it.releaseGroup ? groupOf(name) : '', releaseType: episodes.length > 1 ? 'multiEpisode' : 'singleEpisode', rejections, customFormats: [], customFormatScore: 0 };
      }
      const m = library().find((x) => x.id === it.movieId);
      if (!m) return { ...it, quality, languages: langs, rejections: [{ reason: 'Unknown Movie', type: 'permanent' }] };
      const curQ = m.movieFile && m.movieFile.quality && m.movieFile.quality.quality;
      const rejections = curQ && rank(quality.quality) <= rank(curQ) ? [{ reason: `Not an upgrade for existing movie file. Existing quality: ${curQ.name}. New Quality ${quality.quality.name}.`, type: 'permanent' }] : [];
      return { ...it, movie: { id: m.id, title: m.title, year: m.year }, quality, languages: langs, releaseGroup: it.releaseGroup || groupOf(name), rejections, customFormats: [], customFormatScore: 0 };
    }));
  });
  app.post('/api/v3/command', (req, res) => {
    const body = req.body || {};
    const cmd = { id: nextCmd++, name: body.name, status: 'queued', polls: 0, body };
    commands.set(cmd.id, cmd);
    // Rescan: like the real apps, new files in the folder are recorded where
    // they are when they can be read (Sonarr: episode numbers; Radarr: a year
    // in the folder or file name) and aren't worse than a file already in use.
    if (body.name === 'RescanSeries' && kind === 'series' && fs && episodeFiles) {
      for (const s of library().filter((x) => !body.seriesId || x.id === body.seriesId)) {
        if (!s.path || !fs.exists(s.path)) continue;
        const walk = (dir, out = []) => { for (const c of fs.children(dir) || []) { if (c.type === 'file') { if (/\.(mkv|mp4|avi|m4v)$/i.test(c.name) && !/sample/i.test(c.name)) out.push(c); } else walk(c.path, out); } return out; };
        for (const v of walk(s.path)) {
          const rel = String(v.path).slice(String(s.path).length + 1);
          if (episodeFiles.find((ef) => ef.seriesId === s.id && String(ef.relativePath).toLowerCase() === rel.toLowerCase())) continue;
          const m = /S(\d{1,2})E(\d{1,3})/i.exec(v.name);
          if (!m) continue;
          const epId = 5000 + Number(m[1]) * 100 + Number(m[2]);
          const q = qualityFromName(v.name);
          const cur = episodeFiles.find((ef) => ef.seriesId === s.id && (ef.episodeIds || []).includes(epId));
          if (cur && (QUALITY_RANK[q.id] || 0) <= (QUALITY_RANK[cur.quality && cur.quality.quality && cur.quality.quality.id] || 0)) continue;
          if (cur) cur.episodeIds = cur.episodeIds.filter((id) => id !== epId);
          episodeFiles.push({ id: nextFileId++, seriesId: s.id, seasonNumber: Number(m[1]), relativePath: rel, path: v.path, quality: { quality: q, revision: { version: 1, real: 0, isRepack: false } }, size: 1.5e9, episodeIds: [epId], mediaInfo: { videoCodec: 'x264', audioCodec: 'AC3', audioChannels: 5.1, audioStreamCount: 1, audioLanguages: 'eng', subtitles: '', resolution: '1920x1080', runTime: '0:52:00' } });
        }
        const n = episodeFiles.filter((ef) => ef.seriesId === s.id && (ef.episodeIds || []).length).length;
        s.statistics = { ...(s.statistics || {}), episodeFileCount: n };
      }
    }
    if (body.name === 'RescanMovie' && kind === 'movie' && fs) {
      for (const m of library().filter((x) => !body.movieId || x.id === body.movieId)) {
        if (m.movieFile || !m.path || !fs.exists(m.path)) continue;
        const v = (fs.children(m.path) || []).find((c) => c.type === 'file' && /\.(mkv|mp4|avi|m4v)$/i.test(c.name) && !/sample/i.test(c.name) && /(?:^|[^0-9])(?:19|20)\d\d(?:[^0-9]|$)/.test(`${String(m.path).split('/').pop()} ${c.name}`.replace(/\b(?:2160|1080|720|480)p\b/gi, '')));
        if (!v) continue;
        m.movieFile = { id: 1000 + m.id, movieId: m.id, relativePath: v.name, path: v.path, quality: { quality: qualityFromName(v.name), revision: { version: 1, real: 0, isRepack: false } }, size: 8e9, mediaInfo: { videoCodec: 'x264', audioCodec: 'AC3', audioChannels: 5.1, audioStreamCount: 1, audioLanguages: 'eng', subtitles: '', resolution: '1920x1080', runTime: '1:50:00' } };
        m.hasFile = true;
      }
    }
    if (body.name === 'ManualImport') {
      const ids = new Set((body.files || []).map((f) => f.downloadId).filter(Boolean));
      if (ids.size) setQueue(getQueue().filter((q) => !ids.has(q.downloadId)));
      // Folder import into a series. A file already inside the series folder
      // is imported where it is: the episodes point at it and the old file
      // stays on disk with no episodes (as real Sonarr does). Otherwise
      // the file is moved in and each episode's old file is recycled.
      if (kind === 'series' && fs && episodeFiles) {
        for (const f of body.files || []) {
          if (f.downloadId) continue;
          const s = library().find((x) => x.id === f.seriesId);
          if (!s) continue;
          const name = String(f.path).split('/').pop();
          const ids = (f.episodeIds || []).map(Number);
          if (String(f.path).toLowerCase().startsWith(`${String(s.path).toLowerCase()}/`)) {
            for (const old of episodeFiles.filter((ef) => ef.seriesId === s.id && (ef.episodeIds || []).some((id) => ids.includes(id)))) old.episodeIds = old.episodeIds.filter((id) => !ids.includes(id));
            episodeFiles.push({ id: nextFileId++, seriesId: s.id, seasonNumber: Math.floor((ids[0] - 5000) / 100), relativePath: String(f.path).slice(String(s.path).length + 1), path: f.path, quality: f.quality, size: 8e9, episodeIds: ids, releaseGroup: f.releaseGroup || '' });
            continue;
          }
          for (const old of episodeFiles.filter((ef) => ef.seriesId === s.id && (ef.episodeIds || []).some((id) => (f.episodeIds || []).includes(id)))) {
            recycled.push(old.path);
            fs.remove(old.path);
            episodeFiles.splice(episodeFiles.indexOf(old), 1);
          }
          if (body.importMode !== 'copy') fs.remove(f.path);
          const season = /S(\d+)E/i.exec(name);
          const dest = `${s.path}/Season ${season ? Number(season[1]) : 1}/${name}`;
          fs.addFile(dest);
          episodeFiles.push({ id: nextFileId++, seriesId: s.id, seasonNumber: season ? Number(season[1]) : 1, relativePath: dest.slice(s.path.length + 1), path: dest, quality: f.quality, size: 8e9, episodeIds: f.episodeIds, releaseGroup: f.releaseGroup || '' });
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
          // Radarr reads the media info of a file it imports.
          m.movieFile = { id: (m.movieFile ? m.movieFile.id : 900) + 1, movieId: m.id, relativePath: name, path: `${m.path}/${name}`, quality: f.quality, size: 61203283968, mediaInfo: { videoCodec: 'x264', audioCodec: 'AC3', audioChannels: 5.1, audioStreamCount: 1, audioLanguages: 'eng', subtitles: '', resolution: '1920x1080', runTime: `${Math.floor((m.runtime || 110) / 60)}:${String((m.runtime || 110) % 60).padStart(2, '0')}:00` } };
          m.hasFile = true;
          m.sizeOnDisk = m.movieFile.size;
        }
      }
    }
    // RenameFiles: the standard demo naming, in the season folder.
    if (body.name === 'RenameFiles' && kind === 'series' && fs && episodeFiles) {
      const s = library().find((x) => x.id === body.seriesId);
      for (const fid of body.files || []) {
        const ef = s && episodeFiles.find((x) => x.id === fid && x.seriesId === s.id);
        if (!ef || !(ef.episodeIds || []).length) continue;
        const season = Math.floor((ef.episodeIds[0] - 5000) / 100);
        const eps = ef.episodeIds.map((id) => `E${String(id % 100).padStart(2, '0')}`).join('');
        const ext = (/\.[^.]+$/.exec(String(ef.path)) || ['.mkv'])[0];
        const rel = `Season ${season}/${s.title}${s.year ? ` (${s.year})` : ''} - S${String(season).padStart(2, '0')}${eps} - Episode ${ef.episodeIds[0] % 100} [${(ef.quality && ef.quality.quality && ef.quality.quality.name) || 'Unknown'}]${ext}`;
        fs.remove(`${s.path}/${ef.relativePath}`);
        ef.relativePath = rel;
        ef.path = `${s.path}/${rel}`;
        fs.addFile(ef.path);
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
  // Bulk edit (Sonarr v4, Radarr v5+): only the fields sent change.
  app.put(`/api/${v}/downloadclient/bulk`, (req, res) => {
    const b = req.body || {}; const ids = new Set((b.ids || []).map(Number));
    for (const c of clients) if (ids.has(c.id)) for (const k of ['enable', 'priority', 'removeCompletedDownloads', 'removeFailedDownloads']) if (b[k] !== undefined && b[k] !== null) c[k] = b[k];
    res.status(202).json(clients.filter((c) => ids.has(c.id)));
  });
  app.get(`/api/${v}/remotepathmapping`, (req, res) => res.json(mappings));
  app.get(`/api/${v}/indexer`, (req, res) => res.json(indexers));
  app.get(`/api/${v}/config/downloadclient`, (req, res) => res.json(dlConfig));
  app.put(`/api/${v}/config/downloadclient`, (req, res) => { Object.assign(dlConfig, req.body || {}, { id: 1 }); res.status(202).json(dlConfig); });
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

// Lookups for "Add existing folders" and Add series/movie: a small catalog
// searched by name; titles already in the library come back as the library
// entry (with its id and path), as in the real apps.
const cleanT = (t) => String(t || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/['’`]/g, '').replace(/\s*\((?:us|uk|19\d\d|20\d\d)\)\s*$/, '').replace(/[^a-z0-9]+/g, ' ').trim().replace(/^the /, '');
const EN = { id: 1, name: 'English' };
const SERIES_CATALOG = [
  ['Friends', 1994, 79168, 'NBC', 'ended', 10, 'Six friends navigate life and love in Manhattan.'],
  ["That '70s Show", 1998, 73787, 'FOX', 'ended', 8, 'Teenagers hang out in a Wisconsin basement in the 1970s.'],
  ['Ghosts (2019)', 2019, 359728, 'BBC One', 'ended', 5, 'A young couple inherit a country house full of ghosts.'],
  ['Ghosts (US)', 2021, 384435, 'CBS', 'continuing', 4, 'A couple open a bed and breakfast in a haunted house.'],
  ['Medium', 2005, 73265, 'NBC', 'ended', 7, 'A mother uses her psychic gifts to help solve crimes.'],
  ["It's Always Sunny in Philadelphia", 2005, 75805, 'FXX', 'continuing', 17, 'Five friends run a bar in Philadelphia.'],
  ['Californication', 2007, 80349, 'Showtime', 'ended', 7, 'A novelist struggles with writer’s block and his family.'],
  ['Severance', 2022, 371980, 'Apple TV+', 'continuing', 2, 'Employees at Lumon undergo a procedure that severs their memories.'],
  ['The Bear', 2022, 388477, 'FX', 'continuing', 3, 'A young chef returns to Chicago to run his family sandwich shop.'],
  ['Foundation', 2021, 358711, 'Apple TV+', 'continuing', 2, 'Exiles race to save humanity.'],
].map(([title, year, tvdbId, network, status, n, overview]) => ({ title, sortTitle: cleanT(title), year, tvdbId, network, status, overview, titleSlug: cleanT(title).replace(/ /g, '-'), seriesType: 'standard', originalLanguage: EN, runtime: 30, firstAired: `${year}-01-15T00:00:00Z`, images: [], seasons: Array.from({ length: n }, (_, i) => ({ seasonNumber: i + 1, monitored: true })) }));
const MOVIE_CATALOG = [
  ['Amélie', 2001, 194, 'Le Fabuleux Destin d’Amélie Poulain', { id: 2, name: 'French' }, 'UGC'],
  ['The Whale', 2022, 785084, 'The Whale', EN, 'A24'],
  ['Juno', 2007, 7326, 'Juno', EN, 'Fox Searchlight'],
  ['Sicario: Day of the Soldado', 2018, 400535, 'Sicario: Day of the Soldado', EN, 'Columbia'],
  ['Gladiator', 2000, 98, 'Gladiator', EN, 'DreamWorks'],
  ['Gladiator II', 2024, 558449, 'Gladiator II', EN, 'Paramount'],
  ['Dune: Part Two', 2024, 693134, 'Dune: Part Two', EN, 'Legendary'],
].map(([title, year, tmdbId, originalTitle, originalLanguage, studio]) => ({ title, originalTitle, year, tmdbId, originalLanguage, studio, status: 'released', titleSlug: `${cleanT(title).replace(/ /g, '-')}-${tmdbId}`, overview: '', runtime: 110, images: [] }));
function searchCatalog(catalog, term, library, idField) {
  let q = cleanT(term); let year = null;
  const y = /\s((?:19|20)\d\d)$/.exec(q); if (y) { year = Number(y[1]); q = q.slice(0, y.index).trim(); }
  if (!q) return [];
  const hits = catalog.map((c) => ({ c, t: cleanT(c.title), o: cleanT(c.originalTitle || '') }))
    .filter(({ t, o }) => t.includes(q) || q.includes(t) || (o && (o.includes(q) || q.includes(o))))
    .sort((a, b) => ((b.t === q || b.o === q) - (a.t === q || a.o === q)) || ((year && b.c.year === year) - (year && a.c.year === year)) || a.t.length - b.t.length);
  return hits.map(({ c }) => library().find((x) => x[idField] === c[idField]) || { ...c });
}
// Like Sonarr's and Radarr's parsers, roughly: the title before SxxEyy (or
// before the year), compared without punctuation.
function seriesFromName(name, series) {
  const base = String(name || '').replace(/\.[^.]+$/, '');
  const m = /^(.*?)[ ._-]+(?:s\d{1,2}(?:e\d{1,3})?|season)(?:[ ._-]|$)/i.exec(base);
  const title = cleanT((m ? m[1] : base).replace(/[ ._-](?:19|20)\d\d$/, '').replace(/[._]+/g, ' '));
  return title ? series.find((s) => cleanT(s.title) === title) || null : null;
}
function movieFromName(name, movies) {
  const base = String(name || '').replace(/\.[^.]+$/, '');
  const m = /^(.*?)[ ._([-]+((?:19|20)\d\d)(?:[ ._)\]-]|$)/.exec(base);
  if (!m) return null;
  const title = cleanT(m[1].replace(/[._]+/g, ' ')); const year = Number(m[2]);
  return movies.find((x) => cleanT(x.title) === title && Math.abs((x.year || 0) - year) <= 1) || null;
}
// The videos below a folder, with paths.
const videosBelow = (fs, dir) => { const out = []; const walk = (d) => { for (const c of (fs && fs.children(d)) || []) { if (c.type === 'file') { if (/\.(mkv|mp4|avi|m4v|ts)$/i.test(c.name)) out.push(c); } else walk(c.path); } }; walk(dir); return out; };
const firstVideo = (fs, dir) => { const walk = (d) => { for (const c of (fs && fs.children(d)) || []) { if (c.type === 'file') { if (/\.(mkv|mp4|avi|m4v|ts)$/i.test(c.name)) return c; } else { const f = walk(c.path); if (f) return f; } } return null; }; return walk(dir); };
const samePath = (a, b) => String(a || '').replace(/[\\/]+$/, '').toLowerCase() === String(b || '').replace(/[\\/]+$/, '').toLowerCase();

// History event numbers, as history/since takes them.
const EVENT_NAMES = { series: { 1: 'grabbed', 3: 'downloadFolderImported', 4: 'downloadFailed', 5: 'episodeFileDeleted', 6: 'episodeFileRenamed', 7: 'downloadIgnored' }, movie: { 1: 'grabbed', 3: 'downloadFolderImported', 4: 'downloadFailed', 6: 'movieFileDeleted', 8: 'movieFileRenamed', 9: 'downloadIgnored' } };
function byEventType(rows, type, kind) {
  if (type === undefined || type === '') return rows;
  const want = EVENT_NAMES[kind][Number(type)] || String(type);
  return rows.filter((r) => r.eventType === want);
}
// Demo history for Repeat downloads: a download grabbed twice and never
// imported (the same release, so SABnzbd saved it again as ".1"), one grabbed
// again after a failure, an upgrade, and one grabbed again after it was
// imported.
function repeatHistory(kind) {
  const d = (days) => new Date(Date.now() - days * 86400000).toISOString();
  const q = (name, resolution, source) => ({ quality: { name, resolution, source }, revision: { version: 1, real: 0, isRepack: false } });
  let n = 900;
  const ev = (type, days, x) => ({ id: n++, eventType: type, date: d(days), data: {}, ...x });
  if (kind === 'series') {
    const e = (seriesId, season, episode, title) => ({ seriesId, episodeId: 5000 + season * 100 + episode, episode: { id: 5000 + season * 100 + episode, seriesId, seasonNumber: season, episodeNumber: episode, title } });
    const sev5 = e(1, 1, 5, 'The You You Are'); const dex3 = e(5, 1, 3, 'Popping Cherry'); const bear5 = e(2, 3, 5, 'Children'); const fnd = e(3, 2, 1, 'In Seldon’s Shadow');
    return [
      ev('grabbed', 40, { ...sev5, sourceTitle: 'Severance.S01E05.1080p.WEB-DL-GRP', downloadId: 'SABnzbd_nzo_sev5a', quality: q('WEBDL-1080p', 1080, 'web'), data: { size: '2400000000', indexer: 'NZBgeek', releaseSource: 'Rss' } }),
      ev('grabbed', 39, { ...sev5, sourceTitle: 'Severance.S01E05.1080p.WEB-DL-GRP', downloadId: 'SABnzbd_nzo_sev5b', quality: q('WEBDL-1080p', 1080, 'web'), data: { size: '2400000000', indexer: 'NZBgeek', releaseSource: 'Rss' } }),
      ev('grabbed', 21, { ...dex3, sourceTitle: 'Dexter.S01E03.720p.HDTV.x264-FAIL', downloadId: 'SABnzbd_nzo_dex3a', quality: q('HDTV-720p', 720, 'television'), data: { size: '900000000' } }),
      ev('downloadFailed', 21, { ...dex3, sourceTitle: 'Dexter.S01E03.720p.HDTV.x264-FAIL', downloadId: 'SABnzbd_nzo_dex3a', data: { message: 'Download failed: not on your server(s)' } }),
      ev('grabbed', 20, { ...dex3, sourceTitle: 'Dexter.S01E03.1080p.BluRay.x264-GRP', downloadId: 'SABnzbd_nzo_dex3b', quality: q('Bluray-1080p', 1080, 'bluray'), data: { size: '4100000000' } }),
      ev('grabbed', 30, { ...bear5, sourceTitle: 'The.Bear.S03E05.1080p.WEB.h264-ETHEL', downloadId: 'SABnzbd_nzo_bear5a', quality: q('WEBDL-1080p', 1080, 'web'), data: { size: '1600000000' } }),
      ev('downloadFolderImported', 30, { ...bear5, sourceTitle: 'The.Bear.S03E05.1080p.WEB.h264-ETHEL', downloadId: 'SABnzbd_nzo_bear5a', quality: q('WEBDL-1080p', 1080, 'web'), data: { droppedPath: '/data/tv/The.Bear.S03E05.1080p.WEB.h264-ETHEL/the.bear.s03e05.mkv' } }),
      ev('grabbed', 12, { ...bear5, sourceTitle: 'The.Bear.S03E05.2160p.DSNP.WEB-DL-FLUX', downloadId: 'SABnzbd_nzo_bear5b', quality: q('WEBDL-2160p', 2160, 'web'), data: { size: '6100000000' } }),
      ev('downloadFolderImported', 12, { ...bear5, sourceTitle: 'The.Bear.S03E05.2160p.DSNP.WEB-DL-FLUX', downloadId: 'SABnzbd_nzo_bear5b', quality: q('WEBDL-2160p', 2160, 'web'), data: {} }),
      ev('grabbed', 60, { ...fnd, sourceTitle: 'Foundation.S02E01.2160p.ATVP.WEB-DL-FLUX', downloadId: 'SABnzbd_nzo_fnd1a', quality: q('WEBDL-2160p', 2160, 'web'), data: { size: '15000000000' } }),
      ev('downloadFolderImported', 60, { ...fnd, sourceTitle: 'Foundation.S02E01.2160p.ATVP.WEB-DL-FLUX', downloadId: 'SABnzbd_nzo_fnd1a', quality: q('WEBDL-2160p', 2160, 'web'), data: {} }),
      ev('grabbed', 25, { ...fnd, sourceTitle: 'Foundation.S02E01.2160p.ATVP.WEB-DL-FLUX', downloadId: 'SABnzbd_nzo_fnd1b', quality: q('WEBDL-2160p', 2160, 'web'), data: { size: '15000000000' } }),
      ev('downloadFolderImported', 25, { ...fnd, sourceTitle: 'Foundation.S02E01.2160p.ATVP.WEB-DL-FLUX', downloadId: 'SABnzbd_nzo_fnd1b', quality: q('WEBDL-2160p', 2160, 'web'), data: {} }),
    ];
  }
  const dune = { movieId: 1 }; const furiosa = { movieId: 3 };
  return [
    ev('grabbed', 10, { ...dune, sourceTitle: 'Dune.Part.Two.2024.2160p.UHD.BluRay.x265-TERMiNAL', downloadId: 'SABnzbd_nzo_dunea', quality: q('Bluray-2160p', 2160, 'bluray'), data: { size: '58000000000' } }),
    ev('grabbed', 9, { ...dune, sourceTitle: 'Dune.Part.Two.2024.2160p.UHD.BluRay.x265-TERMiNAL', downloadId: 'SABnzbd_nzo_duneb', quality: q('Bluray-2160p', 2160, 'bluray'), data: { size: '58000000000' } }),
    ev('grabbed', 15, { ...furiosa, sourceTitle: 'Furiosa.A.Mad.Max.Saga.2024.720p.HDTV-FAIL', downloadId: 'SABnzbd_nzo_fura', quality: q('HDTV-720p', 720, 'tv'), data: { size: '1200000000' } }),
    ev('downloadFailed', 15, { ...furiosa, sourceTitle: 'Furiosa.A.Mad.Max.Saga.2024.720p.HDTV-FAIL', downloadId: 'SABnzbd_nzo_fura', data: { message: 'Unpacking failed, archive requires a password' } }),
    ev('grabbed', 14, { ...furiosa, sourceTitle: 'Furiosa.A.Mad.Max.Saga.2024.1080p.WEB-DL-GRP', downloadId: 'SABnzbd_nzo_furb', quality: q('WEBDL-1080p', 1080, 'web'), data: { size: '9000000000' } }),
  ];
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
        clients: [demoDownloadClient(1, 'QBittorrent', { host: 'qbittorrent', port: 8080, category: 'tv-sonarr', field: 'tvCategory' }), { ...demoDownloadClient(2, 'Sabnzbd', { host: 'sabnzbd', port: 8080, category: 'tv', field: 'tvCategory' }), ...(opts.cleanupDemo ? { removeCompletedDownloads: false } : {}) }],
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
  // The cleanup demo (Untracked files, Repeat downloads): Dexter tracks two
  // season 2 episodes while seasons 1 and 3 sit in its folder untracked.
  if (opts.cleanupDemo) series.push({ id: 5, title: 'Dexter', year: 2006, tvdbId: 79349, status: 'ended', monitored: true, seasonCount: 8, network: 'Showtime', overview: 'A blood spatter analyst leads a secret double life.', path: '/data/tv/Dexter', rootFolderPath: '/data/tv', qualityProfileId: 1, seasonFolder: true, seriesType: 'standard', statistics: { episodeFileCount: 2, episodeCount: 96, percentOfEpisodes: 2.1, sizeOnDisk: 8.2e9 }, images: [] });
  for (const x of series) if (!x.originalLanguage) x.originalLanguage = EN;
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
  if (opts.cleanupDemo) {
    for (const f of ['Season 2/Dexter.S02E01.1080p.BluRay.x264-GRP.mkv', 'Season 2/Dexter.S02E02.1080p.BluRay.x264-GRP.mkv', 'Season 1/Dexter.S01E01.1080p.BluRay.x264-GRP.mkv', 'Season 1/Dexter.S01E02.1080p.BluRay.x264-GRP.mkv', 'Season 3/Dexter.S03E01.1080p.BluRay.x264-GRP.mkv', 'Season 3/Dexter.S03E01.sample.mkv', 'Season 2/Dexter.S02E01.720p.HDTV.x264-OLD.mkv', 'Season 1/Dexter Pilot Extended Cut.mkv']) fs.addFile(`/data/tv/Dexter/${f}`);
    // Leftover downloads in the root folder.
    for (const f of ['Dexter.S01E03.1080p.BluRay.x264-GRP/Dexter.S01E03.1080p.BluRay.x264-GRP.mkv', 'Dexter.S01E03.1080p.BluRay.x264-GRP/Dexter.S01E03.1080p.BluRay.x264-GRP.nfo', 'Dexter.S02E01.720p.HDTV.x264-OLD2/Dexter.S02E01.720p.HDTV.x264-OLD2.mkv', 'Dexter.S02E02.2160p.WEB-DL-GRP/Dexter.S02E02.2160p.WEB-DL-GRP.mkv', 'Dexter.S04E01.1080p.WEB-DL-GRP.mkv']) fs.addFile(`/data/tv/${f}`);
  }
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
    const known = tvdb && series.find((x) => x.tvdbId === Number(tvdb[1]));
    if (known) return res.json([known]);
    const hits = tvdb ? [] : searchCatalog(SERIES_CATALOG, term, () => series, 'tvdbId');
    if (hits.length) return res.json(hits);
    if (tvdb) return res.json([{ title: 'Arcane', year: 2021, tvdbId: Number(tvdb[1]), status: 'ended', overview: 'The origins of two iconic League champions.', network: 'Netflix', images: [], seasons: [{ seasonNumber: 1, monitored: true }, { seasonNumber: 2, monitored: true }] }]);
    res.json([
      { title: `${term || 'Andor'}`, year: 2022, tvdbId: 371980, status: 'continuing', overview: 'A drama set in the Star Wars universe.', network: 'Disney+', images: [], seasons: [] },
      { title: `${term || 'Andor'} (Documentary)`, year: 2023, tvdbId: 999001, status: 'ended', overview: 'Behind the scenes.', network: 'Disney+', images: [], seasons: [] },
    ]);
  });
  // Like Sonarr: one entry per show and per folder; the folder's files count
  // as episode files once it's added (Sonarr scans the folder).
  let addedFileId = 8000;
  app.post('/api/v3/series', (req, res) => {
    const b = req.body || {};
    if (b.tvdbId && series.some((x) => x.tvdbId === b.tvdbId)) return res.status(400).json([{ propertyName: 'TvdbId', errorMessage: 'This series has already been added', attemptedValue: b.tvdbId, severity: 'error' }]);
    const path = b.path || `${String(b.rootFolderPath || '/tv').replace(/[\\/]+$/, '')}/${b.title}`;
    if (series.some((x) => samePath(x.path, path))) return res.status(400).json([{ propertyName: 'Path', errorMessage: 'Path is already configured for an existing series', attemptedValue: path, severity: 'error' }]);
    const { addOptions } = b;
    const id = Math.max(0, ...series.map((x) => x.id)) + 1;
    // Like Sonarr's scan: files with episode numbers (S01E03, 1x03, or "03 -"
    // inside a season folder) become episode files; others aren't read.
    let read = 0;
    for (const v of videosBelow(fs, path)) {
      const rel = String(v.path).slice(path.length + 1);
      const m = /S(\d{1,2})E(\d{1,3})/i.exec(v.name) || /(\d{1,2})x(\d{2,3})/i.exec(v.name);
      const inSeason = /^Season (\d+)\//i.exec(rel); const lead = /^(\d{1,3})\s*-\s/.exec(v.name);
      const sn = m ? Number(m[1]) : inSeason && lead ? Number(inSeason[1]) : null; const en = m ? Number(m[2]) : lead ? Number(lead[1]) : null;
      if (sn == null || en == null) continue;
      read += 1;
      episodeFiles.push({ id: (addedFileId += 1), seriesId: id, seasonNumber: sn, relativePath: rel, path: v.path, quality: { quality: qualityFromName(v.name), revision: { version: 1, real: 0, isRepack: false } }, size: 1.5e9, episodeIds: [5000 + sn * 100 + en], mediaInfo: { videoCodec: 'h264', audioCodec: 'AAC', audioChannels: 2, audioStreamCount: 1, audioLanguages: 'eng', subtitles: '', resolution: '1920x1080', runTime: '0:22:00' } });
    }
    const s = { ...b, id, path, monitored: b.monitored !== false && !(addOptions && addOptions.monitor === 'none'), added: new Date().toISOString(), statistics: { episodeFileCount: read, episodeCount: read, percentOfEpisodes: read ? 100 : 0, sizeOnDisk: read * 1.5e9 } };
    series.push(s);
    res.status(201).json(s);
  });
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
  app.get('/api/v3/history/since', (req, res) => importsSince(req, { json: (rows) => res.json(byEventType(rows, req.query.eventType, 'series').concat(opts.cleanupDemo ? byEventType(repeatHistory('series'), req.query.eventType, 'series').filter((r) => Date.parse(r.date) >= (Date.parse(req.query.date || 0) || 0)) : []).sort((a, b) => a.date.localeCompare(b.date))) }));
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
    const seriesId = Number(req.query.seriesId) || 1;
    // Each episode points at the episode file that covers it, as real Sonarr does.
    const fileOf = (id) => (episodeFiles.find((f) => f.seriesId === seriesId && (f.episodeIds || []).includes(id)) || {}).id || 0;
    const count = seriesId === 1 && season === 2 ? 10 : 8;
    res.json(Array.from({ length: count }, (_, i) => { const id = 5000 + season * 100 + i + 1; const fid = fileOf(id); return { id, seriesId, seasonNumber: season, episodeNumber: i + 1, title: `Episode ${i + 1}`, airDateUtc: new Date(Date.now() - (count - i) * 86400000).toISOString(), hasFile: fid ? true : i % 3 !== 0, episodeFileId: fid, monitored: true }; }));
  });
  app.get('/api/v3/release', (req, res) => res.json(mockReleases('Severance')));
  app.post('/api/v3/release', (req, res) => res.status(201).json({ guid: req.body.guid, approved: true }));
  app.get('/api/v3/health', (req, res) => res.json([
    { id: 1, type: 'warning', message: 'Indexers unavailable due to failures: NZBgeek', source: 'IndexerStatusCheck', wikiUrl: 'https://wiki.servarr.com/sonarr/system#indexers-are-unavailable-due-to-failures' },
    ...(opts.cleanupDemo ? [{ id: 9, type: 'warning', message: 'Download client SABnzbd places downloads in the root folder /data/tv. You should not download to a root folder.', source: 'DownloadClientRootFolderCheck', wikiUrl: 'https://wiki.servarr.com/sonarr/system#downloads-in-root-folder' }] : []),
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
  const episodeFiles = opts.series ? [] : [1, 2, 3, 4].map((e) => ({ id: 700 + e, seriesId: 1, seasonNumber: 1, relativePath: `Season 1/Severance.S01E0${e}.1080p.WEB-DL.mkv`, path: `/Volumes/Media/TV/Severance/Season 1/Severance.S01E0${e}.1080p.WEB-DL.mkv`, quality: { quality: { id: 3, name: 'WEBDL-1080p', resolution: 1080 }, revision: { version: 1, real: 0, isRepack: false } }, size: 4e9, episodeIds: [5100 + e], mediaInfo: e === 3 ? null : { videoCodec: 'h264', audioCodec: 'EAC3', audioChannels: 5.1, audioStreamCount: e === 4 ? 2 : 1, audioLanguages: { 1: 'eng', 2: 'ita', 4: 'ita/eng' }[e], subtitles: e === 1 ? 'eng' : '', resolution: '1920x1080', runTime: '0:55:10' } }));
  if (opts.cleanupDemo) for (const e of [1, 2]) episodeFiles.push({ id: 750 + e, seriesId: 5, seasonNumber: 2, relativePath: `Season 2/Dexter.S02E0${e}.1080p.BluRay.x264-GRP.mkv`, path: `/data/tv/Dexter/Season 2/Dexter.S02E0${e}.1080p.BluRay.x264-GRP.mkv`, quality: { quality: { id: 7, name: 'Bluray-1080p', resolution: 1080 }, revision: { version: 1, real: 0, isRepack: false } }, size: 4.1e9, episodeIds: [5200 + e], mediaInfo: { videoCodec: 'x264', audioCodec: 'DTS', audioChannels: 5.1, audioStreamCount: 1, audioLanguages: 'eng', subtitles: 'eng', resolution: '1920x1080', runTime: '0:53:00' } });
  const recycledTv = [];
  app.locals.recycled = recycledTv;
  app.locals.fs = fs;
  // Paths are rewritten when Fix paths moves the series; keep files in step.
  const filesFor = (s) => episodeFiles.filter((ef) => ef.seriesId === s.id).map((ef) => ({ ...ef, path: `${s.path}/${ef.relativePath}` }));
  app.delete('/api/v3/episodefile/:id', (req, res) => {
    const i = episodeFiles.findIndex((ef) => ef.id === Number(req.params.id));
    if (i < 0) return res.status(404).json({ message: 'NotFound' });
    const s = series.find((x) => x.id === episodeFiles[i].seriesId);
    const where = s ? `${s.path}/${episodeFiles[i].relativePath}` : episodeFiles[i].path;
    recycledTv.push(where);
    fs.remove(where);
    episodeFiles.splice(i, 1);
    res.json({});
  });
  // Parse: just the parts the app reads (release group, numbers).
  app.get('/api/v3/parse', (req, res) => {
    const title = String(req.query.title || '');
    if (!title) return res.json(null);
    const name = String(req.query.path || title).split('/').pop().replace(/\.[^.]+$/, '');
    const m = /S(\d+)E(\d+)/i.exec(name);
    const g = /-([A-Za-z0-9]+)$/.exec(name);
    res.json({ title, parsedEpisodeInfo: { releaseGroup: g && !/^(DL|RIP)$/i.test(g[1]) ? g[1] : null, seasonNumber: m ? Number(m[1]) : 0, episodeNumbers: m ? [Number(m[2])] : [] } });
  });
  app.get('/api/v3/episodefile', (req, res) => { const s = series.find((x) => x.id === Number(req.query.seriesId)); res.json(s ? filesFor(s) : []); });
  let mediaManagementTv = { id: 1, recycleBin: opts.series ? '' : '/Volumes/Media/.recycle', recycleBinCleanupDays: 7, copyUsingHardlinks: !opts.series, rescanAfterRefresh: opts.cleanupDemo ? 'afterManual' : 'always' };
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
    { id: 1, title: 'Dune: Part Two', year: 2024, tmdbId: 693134, status: 'released', monitored: true, hasFile: true, runtime: 166, overview: 'Paul Atreides unites with the Fremen to wage war against House Harkonnen.', path: 'C:\\Media\\Movies\\Dune Part Two (2024)', rootFolderPath: 'C:\\Media\\Movies', sizeOnDisk: 32212254720, studio: 'Legendary', images: [], movieFile: { id: 101, movieId: 1, relativePath: 'Dune.Part.Two.mkv', quality: { quality: { id: 7, name: 'Bluray-1080p', resolution: 1080 }, revision: { version: 1, real: 0, isRepack: false } }, size: 32212254720, mediaInfo: { videoCodec: 'x264', audioCodec: 'DTS-HD MA', audioChannels: 7.1, audioStreamCount: 2, audioLanguages: 'ita/eng', subtitles: 'ita/eng', resolution: '1920x804', runTime: '2:46:12', videoBitrate: 24000000 } } },
    { id: 2, title: 'Oppenheimer', year: 2023, tmdbId: 872585, status: 'released', monitored: true, hasFile: true, runtime: 180, overview: 'The story of J. Robert Oppenheimer and the atomic bomb.', path: 'C:\\Media\\Movies2\\Oppenheimer (2023)', rootFolderPath: 'C:\\Media\\Movies2', sizeOnDisk: 27917287424, studio: 'Universal', images: [], movieFile: { id: 102, movieId: 2, relativePath: 'Oppenheimer.2023.1080p.mkv', quality: { quality: { id: 7, name: 'Bluray-1080p', resolution: 1080 }, revision: { version: 1, real: 0, isRepack: false } }, size: 27917287424, mediaInfo: { videoCodec: 'x265', audioCodec: '', audioChannels: 0, audioStreamCount: 0, resolution: '1920x1080', runTime: '3:00:21' } } },
    { id: 3, title: 'Furiosa', year: 2024, tmdbId: 786892, status: 'released', monitored: true, hasFile: false, runtime: 148, overview: 'The origin story of Furiosa before Mad Max: Fury Road.', path: 'C:\\Media\\Movies3\\Furiosa (2024)', rootFolderPath: 'C:\\Media\\Movies3', sizeOnDisk: 0, studio: 'Warner Bros', images: [] },
    { id: 4, title: 'Dune: Part Two', year: 2024, tmdbId: 693134, status: 'released', monitored: false, hasFile: false, runtime: 166, overview: 'Duplicate entry added on another drive.', path: 'C:\\Media\\Movies2\\Dune Part Two (2024)', rootFolderPath: 'C:\\Media\\Movies2', sizeOnDisk: 0, studio: 'Legendary', images: [] },
    { id: 5, title: '1917', year: 2019, tmdbId: 530915, status: 'released', monitored: true, hasFile: true, runtime: 119, overview: 'Two soldiers race against time to deliver a message.', path: 'C:\\Media\\Movies\\1917 (2019)', rootFolderPath: 'C:\\Media\\Movies', sizeOnDisk: 8589934592, studio: 'DreamWorks', images: [], movieFile: { id: 105, movieId: 5, relativePath: '1917.mkv', quality: { quality: { id: 19, name: 'Bluray-2160p', resolution: 2160 }, revision: { version: 1, real: 0, isRepack: false } }, size: 734003200, mediaInfo: { videoCodec: 'XviD', audioCodec: 'MP3', audioChannels: 2, audioStreamCount: 1, resolution: '720x304', runTime: '0:21:40' } } },
  ];
  if (opts.movies) movies = opts.movies.map((m) => ({ ...m }));
  else movies = fillRadarrLibrary(movies, opts.librarySize);
  // The cleanup demo: a movie with a video Radarr can't name (no year), and
  // one with a second copy in its folder.
  if (opts.cleanupDemo) movies.push(
    { id: 6, title: 'Fried Green Tomatoes', year: 1991, tmdbId: 1633, status: 'released', monitored: true, hasFile: false, runtime: 130, overview: 'A friendship across two generations in Alabama.', path: '/data/movies/Fried Green Tomatoes', rootFolderPath: '/data/movies', qualityProfileId: 1, sizeOnDisk: 0, studio: 'Universal', images: [] },
    { id: 7, title: 'Stand by Me', year: 1986, tmdbId: 235, status: 'released', monitored: true, hasFile: true, runtime: 89, overview: 'Four boys go looking for a body.', path: '/data/movies/Stand by Me (1986)', rootFolderPath: '/data/movies', qualityProfileId: 1, sizeOnDisk: 9e9, studio: 'Columbia', images: [], movieFile: { id: 107, movieId: 7, relativePath: 'Stand.by.Me.1986.1080p.BluRay.x264-GRP.mkv', path: '/data/movies/Stand by Me (1986)/Stand.by.Me.1986.1080p.BluRay.x264-GRP.mkv', quality: { quality: { id: 7, name: 'Bluray-1080p', resolution: 1080 }, revision: { version: 1, real: 0, isRepack: false } }, size: 9e9, mediaInfo: { videoCodec: 'x264', audioCodec: 'DTS', audioChannels: 5.1, audioStreamCount: 1, audioLanguages: 'eng', subtitles: 'eng', resolution: '1920x1040', runTime: '1:29:00' } } },
  );
  for (const m of movies) if (!m.originalLanguage) m.originalLanguage = EN;
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
  if (opts.cleanupDemo) for (const f of ['Fried Green Tomatoes/Fried Green Tomatoes.mkv', 'Stand by Me (1986)/Stand.by.Me.1986.1080p.BluRay.x264-GRP.mkv', 'Stand by Me (1986)/Stand.by.Me.1986.720p.WEB-DL-OLD.mkv', 'Dune.Part.Two.2024.2160p.UHD.BluRay.x265-TERMiNAL/Dune.Part.Two.2024.2160p.UHD.BluRay.x265-TERMiNAL.mkv', 'Furiosa.2024.1080p.WEB-DL-GRP/Furiosa.2024.1080p.WEB-DL-GRP.mkv', 'Stand.by.Me.1986.720p.HDTV.x264-OLD/Stand.by.Me.1986.720p.HDTV.x264-OLD.mkv']) fs.addFile(`/data/movies/${f}`);
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
  app.get('/api/v3/history/since', (req, res) => importsSince(req, { json: (rows) => res.json(byEventType(rows, req.query.eventType, 'movie').concat(opts.cleanupDemo ? byEventType(repeatHistory('movie'), req.query.eventType, 'movie').filter((r) => Date.parse(r.date) >= (Date.parse(req.query.date || 0) || 0)) : []).sort((a, b) => a.date.localeCompare(b.date))) }));
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
    const hits = tmdb ? [] : searchCatalog(MOVIE_CATALOG, term, () => movies, 'tmdbId');
    if (hits.length) return res.json(hits);
    if (tmdb) { const known = COLLECTIONS.flatMap((c) => c.movies).find((m) => m.tmdbId === Number(tmdb[1])); return res.json([known ? { ...known, titleSlug: String(known.tmdbId), overview: '' } : { title: 'The Wild Robot', year: 2024, tmdbId: Number(tmdb[1]), status: 'released', overview: 'A robot learns to survive in the wilderness.', studio: 'DreamWorks', images: [] }]); }
    res.json([
      { title: `${term || 'Gladiator II'}`, year: 2024, tmdbId: 558449, status: 'released', overview: 'Years after Maximus, Lucius must fight for Rome.', studio: 'Paramount', images: [] },
      { title: `${term || 'Gladiator'}`, year: 2000, tmdbId: 98, status: 'released', overview: 'A betrayed Roman general seeks revenge.', studio: 'DreamWorks', images: [] },
    ]);
  });
  // Like Radarr: one entry per movie and per folder; a video in the folder
  // becomes its file once it's added (Radarr scans the folder).
  app.post('/api/v3/movie', (req, res) => {
    const b = req.body || {};
    if (b.tmdbId && movies.some((x) => x.tmdbId === b.tmdbId)) return res.status(400).json([{ propertyName: 'TmdbId', errorMessage: 'This movie has already been added', attemptedValue: b.tmdbId, severity: 'error' }]);
    const path = b.path || `${String(b.rootFolderPath || '/movies').replace(/[\\/]+$/, '')}/${b.title} (${b.year})`;
    if (movies.some((x) => samePath(x.path, path))) return res.status(400).json([{ propertyName: 'Path', errorMessage: 'Path is already configured for an existing movie', attemptedValue: path, severity: 'error' }]);
    const id = Math.max(0, ...movies.map((x) => x.id)) + 1;
    // Like Radarr's scan: a file is read only when the folder or file name has a year.
    const found = firstVideo(fs, path);
    const v = found && /(?:^|[^0-9])(?:19|20)\d\d(?:[^0-9]|$)/.test(`${String(path).split('/').pop()} ${found.name}`.replace(/\b(?:2160|1080|720|480)p\b/gi, '')) ? found : null;
    const { addOptions } = b;
    const movieFile = v ? { id: 1000 + id, movieId: id, relativePath: v.name, quality: { quality: qualityFromName(v.name), revision: { version: 1, real: 0, isRepack: false } }, size: 8e9, mediaInfo: { videoCodec: 'x264', audioCodec: 'AC3', audioChannels: 5.1, audioStreamCount: 1, audioLanguages: b.originalLanguage && b.originalLanguage.name === 'French' ? 'fre' : 'eng', subtitles: '', resolution: '1920x1080', runTime: '1:50:00' } } : undefined;
    const m = { ...b, id, path, monitored: b.monitored !== false && !(addOptions && addOptions.monitor === 'none'), hasFile: !!v, sizeOnDisk: v ? 8e9 : 0, movieFile, added: new Date().toISOString() };
    movies.push(m);
    res.status(201).json(m);
  });
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
  let mediaManagement = { id: 1, rescanAfterRefresh: 'always', recycleBin: opts.movies ? '' : '/Volumes/Movies/.recycle', recycleBinCleanupDays: 7, deleteEmptyFolders: false, autoUnmonitorPreviouslyDownloadedMovies: false, copyUsingHardlinks: !opts.movies };
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
  const misc = { no_dupes: 0, no_smart_dupes: 0, dupes_propercheck: 1, complete_dir: '/downloads/complete', download_dir: '/downloads/incomplete', history_retention_option: 'all' };
  app.all('/api', (req, res) => {
    const mode = req.query.mode;
    if (mode === 'version') return res.json({ version: '4.3.2' });
    if (mode === 'get_config') {
      if (req.query.section === 'misc') return res.json({ config: { misc: req.query.keyword ? { [req.query.keyword]: misc[req.query.keyword] } : { ...misc } } });
      return res.json({ config: { misc: { ...misc }, categories: [{ name: '*', dir: '', pp: '3' }, { name: 'tv', dir: 'tv', pp: '' }, { name: 'movies', dir: 'movies', pp: '' }] } });
    }
    if (mode === 'set_config') {
      if (req.query.section !== 'misc' || !(req.query.keyword in misc)) return res.json({ status: false, error: 'Unknown setting' });
      misc[req.query.keyword] = /^\d+$/.test(String(req.query.value)) ? Number(req.query.value) : req.query.value;
      return res.json({ config: { misc: { [req.query.keyword]: misc[req.query.keyword] } } });
    }
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
    { guid: 'px-1', files: 58, title: 'Dune.Part.Two.2024.2160p.UHD.BluRay.x265-GROUP', indexerId: 1, indexer: 'NZBgeek', protocol: 'usenet', size: 32.4e9, grabs: 120, cats: [[2000, 'Movies', [[2045, 'Movies/UHD']]]], age: 40 },
    { guid: 'px-2', files: 3, title: 'Dune.Part.Two.2024.1080p.WEB-DL.DDP5.1.H.264-FLUX', indexerId: 3, indexer: 'TorrentLeech', protocol: 'torrent', size: 9.1e9, seeders: 412, leechers: 18, cats: [[2000, 'Movies', [[2040, 'Movies/HD']]]], age: 120, hash: '6a7c2b1f0e9d8c7b6a5f4e3d2c1b0a9f8e7d6c5b' },
    { guid: 'px-3', files: 44, title: 'Severance.S02E10.1080p.ATVP.WEB-DL.DDP5.1.H.264-NTb', indexerId: 1, indexer: 'NZBgeek', protocol: 'usenet', size: 2.1e9, grabs: 54, cats: [[5000, 'TV', [[5040, 'TV/HD']]]], age: 6 },
    { guid: 'px-4', files: 1, title: 'Severance.S02E10.2160p.ATVP.WEB-DL.DDP5.1.HDR.H.265-FLUX', indexerId: 3, indexer: 'TorrentLeech', protocol: 'torrent', size: 6.8e9, seeders: 250, leechers: 9, cats: [[5000, 'TV', [[5045, 'TV/UHD']]]], age: 5, magnetOnly: true, hash: '0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c' },
    { guid: 'px-5', files: 12, title: 'Andy.Weir.Project.Hail.Mary.2021.Audiobook.M4B', indexerId: 2, indexer: 'DrunkenSlug', protocol: 'usenet', size: 1.1e9, grabs: 9, cats: [[3000, 'Audio', [[3030, 'Audio/Audiobook']]]], age: 300 },
    { guid: 'px-6', files: 1, title: 'Unknown.Show.S01E01.720p.HDTV.x264-LOL', indexerId: 2, indexer: 'DrunkenSlug', protocol: 'usenet', size: 0.9e9, grabs: 1, cats: [[5000, 'TV', [[5030, 'TV/SD']]]], age: 2 },
  ];
  const grabbed = [];
  app.locals.grabbed = grabbed;
  const shape = (r, base) => {
    const link = `${base}/${r.indexerId}/download?apikey=MOCK_API_KEY&link=${encodeURIComponent(Buffer.from(r.guid).toString('base64'))}&file=${encodeURIComponent(r.title)}`;
    const magnet = r.hash ? `magnet:?xt=urn:btih:${r.hash}&dn=${encodeURIComponent(r.title)}` : null;
    return {
      guid: r.guid, title: r.title, sortTitle: r.title.toLowerCase(), indexerId: r.indexerId, indexer: r.indexer, protocol: r.protocol, size: r.size, grabs: r.grabs, files: r.files,
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

// ---------------- Readarr / Chaptarr (books, API v1) ----------------
// One mock answers like legacy Readarr (default) or like Chaptarr
// ({ flavor: 'chaptarr' }): audiobook and ebook settings side by side on an
// author, a book entry per format, format-typed profiles and root folders,
// interactive search answered as { releases }, and author/deletepreview.
// Pictures are SVG data URIs in remoteUrl, as the real apps hand out CDN URLs.
const svgUri = (svg) => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
const svgText = (text) => String(text).replace(/[<>&"']/g, '');
function wrapWords(text, width, max = 4) {
  const lines = [];
  let line = '';
  for (const word of String(text).split(/\s+/)) {
    if (line && `${line} ${word}`.length > width) { lines.push(line); line = word; } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines.slice(0, max);
}
function authorPortraitUri(name, hue) {
  const parts = String(name).split(/[\s.]+/).filter(Boolean);
  const ini = svgText(`${parts[0][0]}${parts.length > 1 ? parts[parts.length - 1][0] : ''}`.toUpperCase());
  return svgUri(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="500" viewBox="0 0 400 500"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue} 55% 58%)"/><stop offset="1" stop-color="hsl(${(hue + 50) % 360} 50% 22%)"/></linearGradient></defs><rect width="400" height="500" fill="url(#g)"/><circle cx="200" cy="200" r="92" fill="rgba(255,255,255,0.2)"/><path d="M48 500c12-128 74-190 152-190s140 62 152 190z" fill="rgba(255,255,255,0.2)"/><text x="200" y="228" fill="#fff" font-family="Georgia, serif" font-size="80" font-weight="700" text-anchor="middle">${ini}</text></svg>`);
}
function bookCoverUri(title, author, hue, square = false) {
  const H = square ? 300 : 450;
  const lines = wrapWords(title, 13).map((l, i) => `<text x="150" y="${(square ? 92 : 140) + i * 40}" fill="#fff" font-family="Georgia, serif" font-size="31" font-weight="700" text-anchor="middle">${svgText(l)}</text>`).join('');
  return svgUri(`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="${H}" viewBox="0 0 300 ${H}"><defs><linearGradient id="c" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${hue} 50% 40%)"/><stop offset="1" stop-color="hsl(${(hue + 30) % 360} 55% 15%)"/></linearGradient></defs><rect width="300" height="${H}" fill="url(#c)"/><rect x="16" y="16" width="268" height="${H - 32}" fill="none" stroke="rgba(255,255,255,0.35)" stroke-width="2"/>${lines}<text x="150" y="${H - 44}" fill="rgba(255,255,255,0.88)" font-family="Helvetica, Arial, sans-serif" font-size="17" letter-spacing="3" text-anchor="middle">${svgText(String(author).toUpperCase())}</text></svg>`);
}

// [title, series label, release date, state]; state is one value or one per
// format: file (monitored, on disk), missing, upcoming, queued (missing, in
// the queue), none (not monitored), old (on disk but not monitored).
const BOOK_LIBRARY = [
  { id: 1, name: 'Brandon Sanderson', lastFirst: 'Sanderson, Brandon', status: 'continuing', monitored: true, hue: 212, addedDays: 120, formats: ['audiobook', 'ebook'],
    overview: 'American author of epic fantasy and science fiction, best known for the Cosmere: the Mistborn books and The Stormlight Archive. He also finished Robert Jordan’s The Wheel of Time.',
    genres: ['Fantasy', 'Epic fantasy', 'Science fiction'], narrators: ['Michael Kramer', 'Kate Reading'],
    books: [
      ['The Way of Kings', 'The Stormlight Archive #1', '2010-08-31', 'file'], ['Words of Radiance', 'The Stormlight Archive #2', '2014-03-04', 'file'],
      ['Oathbringer', 'The Stormlight Archive #3', '2017-11-14', 'file'], ['Rhythm of War', 'The Stormlight Archive #4', '2020-11-17', 'file'],
      ['Wind and Truth', 'The Stormlight Archive #5', '2024-12-06', { audiobook: 'missing', ebook: 'file' }],
      ['The Final Empire', 'Mistborn #1', '2006-07-17', 'file'], ['The Well of Ascension', 'Mistborn #2', '2007-08-21', 'file'], ['The Hero of Ages', 'Mistborn #3', '2008-10-14', 'file'],
      ['Elantris', '', '2005-04-21', 'file'], ['Warbreaker', '', '2009-06-09', 'missing'], ['Tress of the Emerald Sea', '', '2023-01-01', 'file'],
      ['Isles of the Emberdark', '', 4, 'upcoming'], ['Edgedancer', 'The Stormlight Archive #2.5', '2016-10-04', 'none'],
    ] },
  { id: 2, name: 'Andy Weir', lastFirst: 'Weir, Andy', status: 'continuing', monitored: true, hue: 18, addedDays: 45, formats: ['audiobook'],
    overview: 'American novelist and former software engineer. His debut The Martian was self-published a chapter at a time before becoming a bestseller and a film.',
    genres: ['Science fiction'], narrators: ['R. C. Bray', 'Ray Porter'],
    books: [['The Martian', '', '2011-09-27', 'file'], ['Artemis', '', '2017-11-14', 'file'], ['Project Hail Mary', '', '2021-05-04', 'queued'], ['Randomize', 'Forward #6', '2019-09-17', 'old']] },
  { id: 3, name: 'Terry Pratchett', lastFirst: 'Pratchett, Terry', status: 'ended', qualityProfileId: 1, monitored: true, hue: 285, addedDays: 400, formats: ['ebook'],
    overview: 'English humorist and fantasy author of the 41 Discworld novels, a world carried through space on the backs of four elephants standing on a turtle.',
    genres: ['Fantasy', 'Humor'],
    books: [
      ['The Colour of Magic', 'Discworld #1', '1983-11-24', 'file'], ['The Light Fantastic', 'Discworld #2', '1986-06-02', 'file'], ['Equal Rites', 'Discworld #3', '1987-01-01', 'file'],
      ['Mort', 'Discworld #4', '1987-11-12', 'file'], ['Sourcery', 'Discworld #5', '1988-05-01', 'file'], ['Good Omens', '', '1990-05-01', 'file'],
    ] },
  { id: 4, name: 'Agatha Christie', lastFirst: 'Christie, Agatha', status: 'ended', qualityProfileId: 1, monitored: false, hue: 350, addedDays: 300, formats: ['audiobook'],
    overview: 'English crime novelist, creator of Hercule Poirot and Miss Marple, and the best-selling fiction writer of all time.',
    genres: ['Mystery', 'Crime'], narrators: ['Hugh Fraser'],
    books: [['The Mysterious Affair at Styles', 'Hercule Poirot #1', '1920-10-01', 'none'], ['Murder on the Orient Express', 'Hercule Poirot #10', '1934-01-01', 'none'], ['And Then There Were None', '', '1939-11-06', 'none']] },
];
const BOOK_LOOKUP = [
  { name: 'N. K. Jemisin', lastFirst: 'Jemisin, N. K.', hue: 330, status: 'continuing', overview: 'Three-time Hugo Award winner, author of The Broken Earth trilogy.', genres: ['Fantasy', 'Science fiction'],
    books: [['The Fifth Season', 'The Broken Earth #1', '2015-08-04'], ['The Obelisk Gate', 'The Broken Earth #2', '2016-08-16'], ['The Stone Sky', 'The Broken Earth #3', '2017-08-15']] },
  { name: 'Martha Wells', lastFirst: 'Wells, Martha', hue: 150, status: 'continuing', overview: 'American author of The Murderbot Diaries and The Books of the Raksura.', genres: ['Science fiction', 'Fantasy'],
    books: [['All Systems Red', 'The Murderbot Diaries #1', '2017-05-02'], ['Artificial Condition', 'The Murderbot Diaries #2', '2018-05-08'], ['Rogue Protocol', 'The Murderbot Diaries #3', '2018-08-07']] },
  { name: 'Becky Chambers', lastFirst: 'Chambers, Becky', hue: 40, status: 'continuing', overview: 'American author of the Wayfarers and Monk & Robot books.', genres: ['Science fiction'],
    books: [['The Long Way to a Small, Angry Planet', 'Wayfarers #1', '2014-07-29'], ['A Psalm for the Wild-Built', 'Monk & Robot #1', '2021-07-13']] },
  { name: 'Ursula K. Le Guin', lastFirst: 'Le Guin, Ursula K.', hue: 262, status: 'ended', overview: 'American author of the Earthsea books and the Hainish Cycle.', genres: ['Fantasy', 'Science fiction'],
    books: [['A Wizard of Earthsea', 'Earthsea #1', '1968-11-01'], ['The Left Hand of Darkness', 'Hainish Cycle #4', '1969-03-01'], ['The Dispossessed', 'Hainish Cycle #1', '1974-05-01']] },
  { name: 'Adrian Tchaikovsky', lastFirst: 'Tchaikovsky, Adrian', hue: 95, status: 'continuing', overview: 'British author of Children of Time and The Final Architecture.', genres: ['Science fiction'],
    books: [['Children of Time', 'Children of Time #1', '2015-06-04'], ['Shards of Earth', 'The Final Architecture #1', '2021-05-27']] },
];

function makeReadarr(opts = {}) {
  const chaptarr = opts.flavor === 'chaptarr';
  const name = chaptarr ? 'chaptarr' : 'readarr';
  const app = express();
  app.use(express.json());
  mountBackupMock(app, name, 'v1');
  // Chaptarr's download client and its one remote path mapping: SABnzbd runs
  // on another host and reports its folders as /mnt/user/…, which Chaptarr
  // sees under /downloads. Only the ebook folder is mapped, so audiobook
  // downloads can't be reached until a mapping is added (Folders tab).
  const SAB_ROOTS = ['/mnt/user/downloads/complete/audiobooks/', '/mnt/user/downloads/complete/ebooks/'];
  const dlClients = chaptarr ? [{
    id: 1, name: 'SABnzbd', implementation: 'Sabnzbd', implementationName: 'SABnzbd', configContract: 'SabnzbdSettings', protocol: 'usenet', enable: true, priority: 1,
    removeCompletedDownloads: true, removeFailedDownloads: true, tags: [],
    fields: [dlField('host', 'sabnzbd'), dlField('port', 8080), dlField('useSsl', false), dlField('urlBase', ''), dlField('apiKey', '********'), dlField('audiobookCategory', 'audio'), dlField('ebookCategory', 'books')],
  }] : [];
  const mappings = chaptarr ? [{ id: 1, host: 'sabnzbd', remotePath: SAB_ROOTS[1], localPath: '/downloads/complete/ebooks/', downloadClientId: 0 }] : [];
  mountDoctorMock(app, 'v1', { clients: dlClients, mappings });
  const now = Date.now();
  const day = 86400000;
  const iso = (t) => new Date(t).toISOString();
  const roots = chaptarr
    ? [
      { id: 1, name: 'Audiobooks', path: '/books/audiobooks', folderType: 1, accessible: true, freeSpace: 404942340096, totalSpace: 12000119750656,
        audiobook: { qualityProfileId: 2, metadataProfileId: 1, monitored: true, monitorExistingMode: 'all', monitorNewItems: 'all', tags: [] }, audiobookQualityProfileId: 2, audiobookMetadataProfileId: 1, audiobookMonitorNewItems: 'all' },
      { id: 2, name: 'Ebooks', path: '/books/ebooks', folderType: 2, accessible: true, freeSpace: 404942340096, totalSpace: 12000119750656,
        ebook: { qualityProfileId: 1, metadataProfileId: 2, monitored: true, monitorExistingMode: 'all', monitorNewItems: 'all', tags: [] }, ebookQualityProfileId: 1, ebookMetadataProfileId: 2, ebookMonitorNewItems: 'all' },
    ]
    : [{ id: 1, path: '/books', freeSpace: 120000000000, accessible: true, defaultQualityProfileId: 1, defaultMetadataProfileId: 1, defaultMonitorOption: 'all', defaultNewItemMonitorOption: 'all' }];
  const rootFor = (format) => (chaptarr
    ? (roots.find((r) => r.folderType === (format === 'ebook' ? 2 : 1)) || roots.find((r) => r.folderType === 0) || { path: format === 'ebook' ? '/books/ebooks' : '/books/audiobooks' }).path
    : (roots[0] || { path: '/books' }).path);
  const profiles = chaptarr ? [{ id: 1, name: 'E-Book', profileType: 'ebook' }, { id: 2, name: 'Audiobook', profileType: 'audiobook' }] : [{ id: 1, name: 'eBook' }, { id: 2, name: 'Audiobook' }];
  const metadataProfiles = chaptarr ? [{ id: 1, name: 'Audiobook Default', profileType: 'audiobook' }, { id: 2, name: 'Ebook Default', profileType: 'ebook' }] : [{ id: 1, name: 'Standard' }];
  let tags = [{ id: 1, label: 'favourites' }];
  let authors = [];
  let books = [];
  let files = [];
  let nextBook = 1; let nextFile = 1; let nextQueue = 602;
  const lookupIds = new Map(BOOK_LOOKUP.map((x, i) => [x.name, `${chaptarr ? 'hc:' : ''}${71000 + i}`]));

  // One author (and books, files) from a catalog entry.
  const addCatalogAuthor = (def, fields = {}) => {
    const formats = chaptarr ? (fields.formats || def.formats || ['audiobook']) : [];
    const id = fields.id || Math.max(0, ...authors.map((a) => a.id)) + 1;
    const folder = (f) => `${rootFor(f)}/${def.name}`;
    const a = {
      id, authorName: def.name, sortName: def.name.toLowerCase(), sortNameLastFirst: (def.lastFirst || def.name).toLowerCase(), authorNameLastFirst: def.lastFirst || def.name,
      foreignAuthorId: fields.foreignAuthorId || (chaptarr ? `hc:${250000 + id}` : `b${id}`), status: def.status, ended: def.status === 'ended',
      monitored: fields.monitored ?? def.monitored ?? true, overview: def.overview, genres: def.genres || [], ratings: { votes: 1200 + id * 37, value: 4.1 + (id % 4) / 10, popularity: 1000 },
      links: [{ url: `https://www.goodreads.com/search?q=${encodeURIComponent(def.name)}`, name: 'goodreads' }, { url: `https://hardcover.app/search?q=${encodeURIComponent(def.name)}`, name: 'hardcover' }],
      images: [{ url: `/MediaCover/${id}/poster.jpg`, coverType: 'poster', extension: '.jpg', remoteUrl: authorPortraitUri(def.name, def.hue) }],
      tags: fields.tags || [], added: iso(now - (def.addedDays || 0) * day), path: folder(formats[0] || 'audiobook'),
    };
    if (chaptarr) {
      a.lastSelectedMediaType = formats[0];
      for (const f of formats) {
        Object.assign(a, {
          [`${f}RootFolderPath`]: rootFor(f), [`${f}Folder`]: folder(f), [`${f}Monitored`]: a.monitored,
          [`${f}QualityProfileId`]: f === 'ebook' ? 1 : 2, [`${f}MetadataProfileId`]: f === 'ebook' ? 2 : 1, [`${f}MonitorNewItems`]: 'all', [`${f}Tags`]: a.tags,
        });
      }
    } else {
      Object.assign(a, { rootFolderPath: '/books', qualityProfileId: def.qualityProfileId || 1, metadataProfileId: 1, monitorNewItems: 'all' });
    }
    if (fields.extra) Object.assign(a, fields.extra);
    authors.push(a);
    const entries = chaptarr ? formats : [null];
    for (const [title, series, date, state = 'none'] of def.books || []) {
      for (const format of entries) {
        const st = typeof state === 'object' ? (state[format] || 'none') : state;
        const releaseDate = typeof date === 'number' ? iso(now + date * day) : `${date}T00:00:00Z`;
        const audio = format === 'audiobook';
        const b = {
          id: nextBook++, authorId: id, title, titleSlug: title.toLowerCase().replace(/[^a-z0-9]+/g, '-'), foreignBookId: `${chaptarr ? 'hc:' : ''}${9000 + nextBook}`,
          seriesTitle: series, ...(chaptarr ? { seriesLabels: series ? [series] : [] } : {}), releaseDate,
          monitored: fields.monitorAll ?? ['file', 'missing', 'upcoming', 'queued'].includes(st), anyEditionOk: true,
          pageCount: audio ? 0 : 250 + (title.length * 17) % 600, genres: def.genres || [],
          ratings: { votes: 5000 + title.length * 311, value: Math.round((3.7 + (title.length % 12) / 10) * 100) / 100, popularity: 500 },
          images: [{ url: `/MediaCover/Books/${nextBook - 1}/cover.jpg`, coverType: 'cover', extension: '.jpg', remoteUrl: bookCoverUri(title, def.name, (def.hue + (series ? series.length * 7 : 0)) % 360, audio) }],
          added: a.added,
        };
        if (chaptarr) {
          Object.assign(b, { mediaType: format, audiobookMonitored: audio && b.monitored, ebookMonitored: !audio && b.monitored,
            narratorNames: audio ? (def.narrators || []).slice(0, 1) : [], narrators: [], baseBookId: `hc:${4000 + (def.books.findIndex((x) => x[0] === title))}${id}` });
        }
        books.push(b);
        if (st === 'file' || st === 'old') {
          const parts = audio && title === 'Elantris' ? 12 : 1;
          for (let i = 0; i < parts; i++) {
            const ext = audio ? (parts > 1 ? 'mp3' : 'm4b') : 'epub';
            files.push({
              id: nextFile++, bookId: b.id, authorId: id, mediaType: format || undefined,
              path: `${folder(format || 'audiobook')}/${title}${parts > 1 ? `/${String(i + 1).padStart(2, '0')} - ${title}` : `/${title}`}.${ext}`,
              size: audio ? (parts > 1 ? 46137344 : 420000000 + title.length * 9000000) : 2100000 + title.length * 61000,
              quality: { quality: { id: audio ? 12 : 3, name: audio ? (parts > 1 ? 'MP3' : 'M4B') : 'EPUB' }, revision: { version: 1, real: 0, isRepack: false } },
              dateAdded: iso(now - ((title.length * 5) % 90) * day), ...(audio ? { mediaInfo: { audioFormat: ext === 'mp3' ? 'MP3' : 'AAC', audioBitrate: '64 kbps', audioChannels: 2, audioSampleRate: '44.1 kHz' } } : {}),
            });
          }
        }
      }
    }
    return a;
  };
  for (const def of BOOK_LIBRARY) addCatalogAuthor(def, { id: def.id });

  // Chaptarr mixes metadata sources, so some books are listed twice: a copy
  // from Amazon next to the Hardcover one (both monitored, or one on disk).
  const dupeOf = (title, authorId, fields = {}) => {
    const src = books.find((b) => b.title === title && b.authorId === authorId && (!chaptarr || b.mediaType === 'audiobook'));
    if (!src) return null;
    const b = { ...src, id: nextBook++, foreignBookId: `az:B0${String(7000 + nextBook).padStart(8, '0')}`, seriesTitle: '', seriesLabels: [], ratings: { votes: 40, value: 4, popularity: 1 }, ...fields };
    books.push(b);
    return b;
  };
  const warbreakerCopy = chaptarr ? dupeOf('Warbreaker', 1, { monitored: true, audiobookMonitored: true }) : null;
  if (chaptarr) dupeOf('Artemis', 2, { monitored: true, audiobookMonitored: true });

  // Files in the root folders that Chaptarr couldn't link to a book, in
  // import units (one book's folder each).
  let unmapped = [];
  if (chaptarr) {
    const unit = (root, names, size, ext, mediaType) => names.forEach((n) => unmapped.push({
      id: nextFile++, authorId: 0, bookId: 0, path: `${root}/${n}.${ext}`, size, dateAdded: iso(now - 2 * day), mediaType,
      quality: { quality: { id: ext === 'epub' ? 3 : 10, name: ext.toUpperCase() }, revision: { version: 1, real: 0, isRepack: false } },
      importUnitKey: `unit:${root.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, importUnitRoot: root,
    }));
    unit('/books/audiobooks/Brandon Sanderson - Edgedancer (2016)', ['Edgedancer - Part 01', 'Edgedancer - Part 02', 'Edgedancer - Part 03'], 61865984, 'mp3', 'audiobook');
    unit('/books/audiobooks/Sanderson.Mistborn.Secret.History.2016', ['Secret History 1 of 2', 'Secret History 2 of 2'], 98566144, 'm4b', 'audiobook');
    unit('/books/ebooks/Terry Pratchett/Pyramids', ['Pyramids - Terry Pratchett'], 1583104, 'epub', 'ebook');
  }

  const bookHasFile = (b) => files.some((f) => f.bookId === b.id);
  const bookResource = (b) => {
    const fs = files.filter((f) => f.bookId === b.id);
    return { ...b, ...(chaptarr ? { hasFiles: fs.length > 0 } : {}), statistics: { bookFileCount: fs.length, bookCount: b.monitored || fs.length ? 1 : 0, sizeOnDisk: fs.reduce((n, f) => n + f.size, 0) } };
  };
  const statsFor = (list) => {
    const ids = new Set(list.map((b) => b.id));
    const fs = files.filter((f) => ids.has(f.bookId));
    const monitored = list.filter((b) => b.monitored);
    const have = monitored.filter(bookHasFile).length;
    return { bookFileCount: fs.length, bookCount: monitored.length, availableBookCount: have, totalBookCount: list.length, sizeOnDisk: fs.reduce((n, f) => n + f.size, 0), percentOfBooks: monitored.length ? Math.round((1000 * have) / monitored.length) / 10 : 0 };
  };
  const authorResource = (a) => {
    const own = books.filter((b) => b.authorId === a.id);
    const out = { ...a, statistics: statsFor(own) };
    if (chaptarr) for (const f of ['audiobook', 'ebook']) out[`${f}Statistics`] = statsFor(own.filter((b) => b.mediaType === f));
    return out;
  };
  const authorRef = (id) => { const a = authors.find((x) => x.id === id); return a ? authorResource(a) : undefined; };
  const bookRef = (id) => { const b = books.find((x) => x.id === id); return b ? bookResource(b) : undefined; };
  const withRefs = (rec, req) => ({
    ...rec,
    ...(req.query.includeAuthor === 'true' && rec.authorId ? { author: authorRef(rec.authorId) } : {}),
    ...(req.query.includeBook === 'true' && rec.bookId ? { book: bookRef(rec.bookId) } : {}),
  });
  const paged = (list, req) => {
    const pageSize = Number(req.query.pageSize) || 20;
    const pageNo = Math.max(1, Number(req.query.page) || 1);
    return { page: pageNo, pageSize, totalRecords: list.length, records: list.slice((pageNo - 1) * pageSize, pageNo * pageSize) };
  };

  const firstBook = (title) => books.find((b) => b.title === title && (!chaptarr || b.mediaType === 'audiobook'));
  const hailMary = firstBook('Project Hail Mary');
  let queue = [
    { id: 601, title: 'Andy Weir - Project Hail Mary (2021) [M4B]', authorId: 2, bookId: hailMary && hailMary.id, status: 'downloading', trackedDownloadState: 'downloading', trackedDownloadStatus: 'ok', size: 724566016, sizeleft: 181141504, timeleft: '00:01:30', estimatedCompletionTime: iso(now + 90000), downloadClient: 'SABnzbd', indexer: 'NZBgeek', downloadId: 'rd-abc', protocol: 'usenet', quality: { quality: { id: 12, name: 'M4B' } } },
  ];
  // Chaptarr's queue also lists downloads it didn't grab (no author) and the
  // ones waiting on a person, as in a real library after a move.
  const warbreaker = firstBook('Warbreaker');
  if (chaptarr) {
    const done = { status: 'completed', trackedDownloadStatus: 'warning', sizeleft: 0, timeleft: '00:00:00', downloadClient: 'SABnzbd', protocol: 'usenet', canRetryImport: false, awaitingImportConfirmation: false, downloadClientHasPostImportCategory: false, downloadForced: false };
    const msg = (title, ...messages) => ({ title, messages });
    queue.push(
      { ...done, id: 603, title: 'Brandon Sanderson - Warbreaker [Unabridged] MP3', authorId: 1, bookId: warbreakerCopy && warbreakerCopy.id, trackedDownloadState: 'importBlocked', canRetryImport: true, size: 553648128, indexer: 'NZBgeek', downloadId: 'SABnzbd_nzo_warbreaker', outputPath: '/downloads/complete/audiobooks/Brandon Sanderson - Warbreaker', quality: { quality: { id: 10, name: 'MP3' } },
        statusMessages: [msg('Brandon Sanderson - Warbreaker', 'Import completion could not be proven for the requested files and books'), msg('Warbreaker - Part 01.mp3', `Rejected: Completed download was grabbed for 'Warbreaker' (BookId ${warbreakerCopy && warbreakerCopy.id}), but import matched 'Warbreaker' (BookId ${warbreaker && warbreaker.id}, work hc:4009).`)],
        errorMessage: 'Import completion could not be proven for the requested files and books' },
      { ...done, id: 604, title: 'Andy.Weir-The.Martian.Unabridged.2014', trackedDownloadState: 'importPending', size: 412090368, downloadId: 'SABnzbd_nzo_martian', outputPath: '/mnt/user/downloads/complete/audiobooks/Andy.Weir-The.Martian.Unabridged.2014', quality: { quality: { id: 0, name: 'Unknown' } },
        statusMessages: [msg('Andy.Weir-The.Martian.Unabridged.2014', 'Source file has not been imported'), msg('Andy.Weir-The.Martian.Unabridged.2014', 'Download path is not accessible to Chaptarr: /mnt/user/downloads/complete/audiobooks/Andy.Weir-The.Martian.Unabridged.2014. Check the download client path, remote path mapping, and container volume mappings.')],
        errorMessage: 'Source file has not been imported' },
      { ...done, id: 605, title: 'Agatha.Christie-And.Then.There.Were.None.Hugh.Fraser', status: 'failed', trackedDownloadState: 'downloading', size: 301989888, downloadId: 'SABnzbd_nzo_christie', outputPath: '/downloads/incomplete/Agatha.Christie-And.Then.There.Were.None.Hugh.Fraser', quality: { quality: { id: 0, name: 'Unknown' } },
        statusMessages: [msg('Agatha.Christie-And.Then.There.Were.None.Hugh.Fraser', 'Download wasn\u2019t grabbed by Chaptarr, skipping')], errorMessage: 'Download wasn\u2019t grabbed by Chaptarr, skipping' },
      { id: 606, title: 'Brandon Sanderson - Isles of the Emberdark [M4B]', authorId: 1, bookId: (firstBook('Isles of the Emberdark') || {}).id, status: 'delay', trackedDownloadState: 'downloading', trackedDownloadStatus: 'ok', size: 845000000, sizeleft: 845000000, timeleft: '05:30:00', estimatedCompletionTime: iso(now + 5.5 * 3600000), indexer: 'NZBgeek', protocol: 'usenet', quality: { quality: { id: 12, name: 'M4B' } }, statusMessages: [], canRetryImport: false },
      // Downloaded as MP3 parts, being converted to one M4B before the import.
      { ...done, id: 608, title: 'Brandon Sanderson - Rhythm of War [MP3]', authorId: 1, bookId: (firstBook('Rhythm of War') || {}).id, trackedDownloadState: 'importPending', trackedDownloadStatus: 'ok', size: 1932735283, indexer: 'NZBgeek', downloadId: 'SABnzbd_nzo_rhythm', outputPath: '/downloads/complete/audiobooks/Brandon Sanderson - Rhythm of War', quality: { quality: { id: 10, name: 'MP3' } },
        statusMessages: [], conversionStatus: 'converting', convertToQualityId: 12, convertToQuality: 'M4B', conversionProgress: 42.5, conversionMessage: 'Converting part 6 of 14', canCancelConversion: true },
    );
  }
  let blocklist = chaptarr ? [
    { id: 1, authorId: 2, bookIds: [hailMary && hailMary.id], sourceTitle: 'Andy Weir - Project Hail Mary (2021) [MP3] 32kbps', quality: { quality: { id: 10, name: 'MP3' } }, date: iso(now - 3 * day), protocol: 'usenet', indexer: 'DrunkenSlug', message: 'Aborted, cannot be completed - https://sabnzbd.org/not-complete' },
    { id: 2, authorId: 1, bookIds: [], sourceTitle: 'Sanderson - Rhythm of War (2020) [Dramatized Adaptation]', quality: { quality: { id: 12, name: 'M4B' } }, date: iso(now - 9 * day), protocol: 'torrent', indexer: 'AudioBookBay', message: 'Manually blocklisted' },
  ] : [];
  // Chaptarr's /ignored: downloads removed from the queue but left in the
  // download client. Stopping ignoring one still there brings it back.
  let nextIgnored = 3;
  let ignored = chaptarr ? [
    { id: 1, authorId: 0, bookId: 0, downloadId: 'SABnzbd_nzo_oldpyramids', sourceTitle: 'Terry.Pratchett-Pyramids.Unabridged.Nigel.Planer', date: iso(now - 6 * day), protocol: 'usenet', downloadClient: 'SABnzbd', downloadClientName: 'SABnzbd', isInClient: false },
    { id: 2, authorId: 0, bookId: 0, downloadId: 'SABnzbd_nzo_guards', sourceTitle: 'Terry.Pratchett-Guards.Guards.Unabridged.Nigel.Planer', date: iso(now - 2 * day), protocol: 'usenet', downloadClient: 'SABnzbd', downloadClientName: 'SABnzbd', isInClient: true,
      record: { id: 607, title: 'Terry.Pratchett-Guards.Guards.Unabridged.Nigel.Planer', status: 'completed', trackedDownloadStatus: 'warning', trackedDownloadState: 'importPending', size: 335544320, sizeleft: 0, timeleft: '00:00:00', downloadClient: 'SABnzbd', protocol: 'usenet', downloadId: 'SABnzbd_nzo_guards', canRetryImport: false,
        outputPath: '/downloads/complete/audiobooks/Terry.Pratchett-Guards.Guards.Unabridged.Nigel.Planer', quality: { quality: { id: 0, name: 'Unknown' } },
        statusMessages: [{ title: 'Terry.Pratchett-Guards.Guards.Unabridged.Nigel.Planer', messages: ['Download wasn\u2019t grabbed by Chaptarr, skipping'] }], errorMessage: 'Download wasn\u2019t grabbed by Chaptarr, skipping' } },
  ] : [];
  const history = () => {
    const imported = files.filter((f, i, all) => all.findIndex((x) => x.bookId === f.bookId) === i)
      .sort((x, y) => Date.parse(y.dateAdded) - Date.parse(x.dateAdded)).slice(0, 6)
      .map((f, i) => { const b = books.find((x) => x.id === f.bookId); return { id: 100 + i, eventType: 'bookFileImported', authorId: f.authorId, bookId: f.bookId, sourceTitle: `${authors.find((a) => a.id === f.authorId)?.authorName} - ${b?.title} [${f.quality.quality.name}]`, quality: f.quality, date: f.dateAdded }; });
    const grabbed = queue.map((q, i) => ({ id: 200 + i, eventType: 'grabbed', authorId: q.authorId, bookId: q.bookId, sourceTitle: q.title, quality: q.quality, date: iso(now - 600000), data: { indexer: q.indexer || 'NZBgeek', downloadClientName: q.downloadClient || 'SABnzbd' } }))
      .filter((r) => r.authorId);
    const problems = chaptarr ? [
      { id: 300, eventType: 'bookImportIncomplete', authorId: 1, bookId: warbreakerCopy && warbreakerCopy.id, sourceTitle: 'Brandon Sanderson - Warbreaker [Unabridged] MP3', quality: { quality: { id: 10, name: 'MP3' } }, date: iso(now - 420000),
        data: { statusMessages: JSON.stringify((queue.find((q) => q.id === 603) || {}).statusMessages || []) } },
      { id: 301, eventType: 'downloadFailed', authorId: 2, bookId: hailMary && hailMary.id, sourceTitle: 'Andy Weir - Project Hail Mary (2021) [MP3] 32kbps', quality: { quality: { id: 10, name: 'MP3' } }, date: iso(now - 3 * day), data: { message: 'Aborted, cannot be completed - https://sabnzbd.org/not-complete', downloadClientName: 'SABnzbd' } },
    ] : [];
    return [...grabbed, ...problems, ...imported].sort((x, y) => Date.parse(y.date) - Date.parse(x.date));
  };
  const releasesFor = (b) => {
    const a = authors.find((x) => x.id === b.authorId) || { authorName: 'Unknown' };
    const audio = chaptarr ? b.mediaType === 'audiobook' : false;
    const year = new Date(b.releaseDate).getUTCFullYear();
    const kinds = audio
      ? [['M4B', 724566016, 'NZBgeek', 'usenet'], ['MP3', 562036736, 'DrunkenSlug', 'usenet'], ['M4B', 1181116006, 'NZBgeek', 'usenet'], ['MP3', 398458880, 'AudioBookBay', 'torrent']]
      : [['EPUB', 3355443, 'NZBgeek', 'usenet'], ['AZW3', 4299161, 'DrunkenSlug', 'usenet'], ['EPUB', 2516582, 'NZBgeek', 'usenet'], ['PDF', 18874368, 'MyAnonamouse', 'torrent']];
    return kinds.map(([q, size, indexer, protocol], i) => ({
      guid: `rel-${b.id}-${i}`, indexerId: indexer === 'NZBgeek' ? 1 : i + 1, indexer, protocol,
      title: `${a.authorName} - ${b.title} (${year}) [${q}]${audio && i === 0 ? ' {Narrated}' : ''}`,
      size, ageHours: 30 + i * 230, age: Math.floor((30 + i * 230) / 24), quality: { quality: { id: i + 1, name: q } },
      approved: i !== 2, rejections: i === 2 ? ['Existing file on disk is of equal or higher preference'] : [],
      ...(protocol === 'torrent' ? { seeders: 42, leechers: 3 } : {}), bookId: b.id, authorId: b.authorId, publishDate: iso(now - (30 + i * 230) * 3600000),
    }));
  };

  app.use((req, res, next) => { recordCf(name, req); if (req.headers['x-api-key'] !== 'MOCK_API_KEY') return res.status(401).json({ error: 'Unauthorized' }); next(); });
  app.get('/__debug', (req, res) => res.json({ cf: cfSeen[name] || null }));
  app.get('/api/v1/system/status', (req, res) => res.json(chaptarr
    ? { version: '0.9.1000.0', appName: 'Chaptarr', instanceName: opts.instanceName || 'Chaptarr (mock)', branch: 'develop' }
    : { version: '0.4.7.2718', appName: 'Readarr', instanceName: opts.instanceName || 'Readarr (mock)' }));
  app.get('/api/v1/diskspace', (req, res) => res.json([{ path: '/', label: 'root', freeSpace: 120000000000, totalSpace: 500000000000 }]));
  app.get('/api/v1/qualityprofile', (req, res) => res.json(profiles));
  app.get('/api/v1/metadataprofile', (req, res) => res.json(metadataProfiles));
  app.get('/api/v1/tag', (req, res) => res.json(tags));
  app.post('/api/v1/tag', (req, res) => { const t = { id: Math.max(0, ...tags.map((x) => x.id)) + 1, label: String((req.body && req.body.label) || 'tag') }; tags.push(t); res.status(201).json(t); });

  app.get('/api/v1/author', (req, res) => res.json(authors.map(authorResource)));
  app.get('/api/v1/author/lookup', (req, res) => {
    const term = String(req.query.term || '').trim().toLowerCase();
    if (!term) return res.json([]);
    const inLibrary = authors.filter((a) => a.authorName.toLowerCase().includes(term)).map(authorResource);
    const found = BOOK_LOOKUP.filter((d) => d.name.toLowerCase().includes(term) && !authors.some((a) => a.authorName === d.name)).map((d) => ({
      authorName: d.name, sortName: d.name.toLowerCase(), authorNameLastFirst: d.lastFirst, foreignAuthorId: lookupIds.get(d.name), status: d.status, ended: d.status === 'ended',
      overview: d.overview, genres: d.genres, monitored: false, tags: [], ratings: { votes: 800, value: 4.2, popularity: 300 },
      images: [{ url: '', coverType: 'poster', extension: '.jpg', remoteUrl: authorPortraitUri(d.name, d.hue) }],
      links: [{ url: `https://www.goodreads.com/search?q=${encodeURIComponent(d.name)}`, name: 'goodreads' }],
      statistics: { bookFileCount: 0, bookCount: 0, availableBookCount: 0, totalBookCount: 0, sizeOnDisk: 0, percentOfBooks: 0 },
    }));
    setTimeout(() => res.json([...inLibrary, ...found]), 250);
  });
  app.get('/api/v1/author/:id', (req, res) => { const a = authorRef(Number(req.params.id)); return a ? res.json(a) : res.status(404).json({ message: 'Author not found' }); });
  app.post('/api/v1/author', (req, res) => {
    const body = req.body || {};
    if (authors.some((a) => a.foreignAuthorId === body.foreignAuthorId)) return res.status(400).json([{ propertyName: 'ForeignAuthorId', errorMessage: 'This author has already been added' }]);
    const def = BOOK_LOOKUP.find((d) => lookupIds.get(d.name) === body.foreignAuthorId || d.name === body.authorName);
    if (!def) return res.status(404).json({ message: 'Author not found on the metadata server' });
    let formats = [];
    if (chaptarr) {
      formats = ['audiobook', 'ebook'].filter((f) => body[`${f}RootFolderPath`]);
      if (!formats.length && body.rootFolderPath) { const r = roots.find((x) => x.path === body.rootFolderPath); if (r) formats = r.folderType === 2 ? ['ebook'] : r.folderType === 0 ? ['audiobook', 'ebook'] : ['audiobook']; }
      if (!formats.length) return res.status(400).json([{ propertyName: 'RootFolderPath', errorMessage: 'Choose a root folder for audiobooks or ebooks' }]);
    } else if (!body.rootFolderPath || !body.qualityProfileId || !body.metadataProfileId) {
      return res.status(400).json([{ propertyName: 'RootFolderPath', errorMessage: 'Root folder, quality profile and metadata profile are required' }]);
    }
    const monitor = (body.addOptions && body.addOptions.monitor) || 'all';
    const list = def.books.map(([t, s, d]) => [t, s, d, 'none']);
    const pick = monitor === 'all' || monitor === 'missing' ? list.map(() => true)
      : monitor === 'first' ? list.map((x, i) => i === 0) : monitor === 'latest' ? list.map((x, i) => i === list.length - 1) : list.map(() => false);
    const a = addCatalogAuthor({ ...def, books: list.map((x, i) => [x[0], x[1], x[2], pick[i] ? 'missing' : 'none']) }, {
      formats, monitored: body.monitored !== false, foreignAuthorId: body.foreignAuthorId, tags: body.tags || [],
      extra: chaptarr
        ? Object.fromEntries(formats.flatMap((f) => [[`${f}QualityProfileId`, Number(body[`${f}QualityProfileId`]) || (f === 'ebook' ? 1 : 2)], [`${f}MetadataProfileId`, Number(body[`${f}MetadataProfileId`]) || 1], [`${f}MonitorNewItems`, body[`${f}MonitorNewItems`] || 'all'], [`${f}Monitored`, body[`${f}Monitored`] !== false]]))
        : { qualityProfileId: Number(body.qualityProfileId), metadataProfileId: Number(body.metadataProfileId), monitorNewItems: body.monitorNewItems || 'all' },
    });
    a.added = iso(Date.now());
    res.status(201).json(authorResource(a));
  });
  app.put('/api/v1/author/editor', (req, res) => {
    const b = req.body || {}; const ids = new Set((b.authorIds || []).map(Number));
    const tagged = (list) => {
      const set = new Set((list || []).map(Number));
      const add = (b.tags || []).map(Number);
      if (b.applyTags === 'add') add.forEach((t) => set.add(t));
      else if (b.applyTags === 'remove') add.forEach((t) => set.delete(t));
      else if (b.applyTags === 'replace') { set.clear(); add.forEach((t) => set.add(t)); }
      return [...set];
    };
    for (const a of authors.filter((x) => ids.has(x.id))) {
      if (chaptarr) {
        // As in Chaptarr: a side only changes on authors set up for that format.
        for (const f of ['audiobook', 'ebook']) {
          if (b[`${f}RootFolderPath`] && !a[`${f}RootFolderPath`] && rootMatches(b[`${f}RootFolderPath`], f)) {
            // Chaptarr sets the format up and refreshes the author.
            gainFormat(a, f, { rootFolderPath: b[`${f}RootFolderPath`], qualityProfileId: b[`${f}QualityProfileId`], metadataProfileId: b[`${f}MetadataProfileId`], monitorNewItems: b[`${f}MonitorNewItems`], monitored: b[`${f}Monitored`] });
            continue;
          }
          if (b[`${f}RootFolderPath`] && roots.some((r) => r.path === b[`${f}RootFolderPath`])) {
            a[`${f}RootFolderPath`] = b[`${f}RootFolderPath`];
            a[`${f}Folder`] = `${b[`${f}RootFolderPath`]}/${a.authorName}`;
          }
          if (!a[`${f}RootFolderPath`]) continue;
          if (typeof b[`${f}Monitored`] === 'boolean') a[`${f}Monitored`] = b[`${f}Monitored`];
          if (b[`${f}MonitorNewItems`]) a[`${f}MonitorNewItems`] = b[`${f}MonitorNewItems`];
          if (b[`${f}QualityProfileId`]) a[`${f}QualityProfileId`] = Number(b[`${f}QualityProfileId`]);
          if (b[`${f}MetadataProfileId`]) a[`${f}MetadataProfileId`] = Number(b[`${f}MetadataProfileId`]);
          if (Array.isArray(b.tags)) a[`${f}Tags`] = tagged(a[`${f}Tags`]);
        }
        a.monitored = ['audiobook', 'ebook'].some((f) => a[`${f}Monitored`] === true);
      } else {
        if (typeof b.monitored === 'boolean') a.monitored = b.monitored;
        if (b.qualityProfileId) a.qualityProfileId = Number(b.qualityProfileId);
        if (b.metadataProfileId) a.metadataProfileId = Number(b.metadataProfileId);
        if (b.monitorNewItems) a.monitorNewItems = b.monitorNewItems;
        if (b.rootFolderPath) { a.rootFolderPath = b.rootFolderPath; a.path = `${b.rootFolderPath}/${a.authorName}`; }
      }
      if (Array.isArray(b.tags)) a.tags = tagged(a.tags);
    }
    res.status(202).json(authors.filter((x) => ids.has(x.id)).map(authorResource));
  });
  const removeAuthors = (ids) => {
    authors = authors.filter((x) => !ids.has(x.id));
    const gone = new Set(books.filter((x) => ids.has(x.authorId)).map((x) => x.id));
    books = books.filter((x) => !gone.has(x.id));
    files = files.filter((x) => !gone.has(x.bookId));
    queue = queue.filter((q) => !ids.has(q.authorId));
  };
  app.delete('/api/v1/author/editor', (req, res) => { removeAuthors(new Set(((req.body || {}).authorIds || []).map(Number))); res.json({}); });
  app.put('/api/v1/author/:id', (req, res) => {
    const a = authors.find((x) => x.id === Number(req.params.id));
    if (!a) return res.status(404).json({ message: 'Author not found' });
    const b = req.body || {};
    if (Array.isArray(b.tags)) a.tags = b.tags.map(Number);
    if (chaptarr) {
      for (const f of ['audiobook', 'ebook']) {
        // A root folder for a format the author doesn't have sets it up.
        if (!a[`${f}RootFolderPath`] && b[`${f}RootFolderPath`]) {
          if (!rootMatches(b[`${f}RootFolderPath`], f)) return res.status(400).json([{ propertyName: `${f === 'ebook' ? 'Ebook' : 'Audiobook'}RootFolderPath`, errorMessage: `${f === 'ebook' ? 'Ebook' : 'Audiobook'} root folder '${b[`${f}RootFolderPath`]}' is not configured` }]);
          gainFormat(a, f, { rootFolderPath: b[`${f}RootFolderPath`], qualityProfileId: b[`${f}QualityProfileId`], metadataProfileId: b[`${f}MetadataProfileId`], monitorNewItems: b[`${f}MonitorNewItems`], monitored: b[`${f}Monitored`] });
          continue;
        }
        if (!a[`${f}RootFolderPath`]) continue;
        if (typeof b[`${f}Monitored`] === 'boolean') a[`${f}Monitored`] = b[`${f}Monitored`];
        if (b[`${f}QualityProfileId`]) a[`${f}QualityProfileId`] = Number(b[`${f}QualityProfileId`]);
        if (b[`${f}MonitorNewItems`]) a[`${f}MonitorNewItems`] = b[`${f}MonitorNewItems`];
        if (Array.isArray(b[`${f}Tags`])) a[`${f}Tags`] = b[`${f}Tags`].map(Number);
      }
      a.monitored = ['audiobook', 'ebook'].some((f) => a[`${f}Monitored`] === true);
      return res.status(202).json(a.id);
    }
    if (typeof b.monitored === 'boolean') a.monitored = b.monitored;
    if (b.qualityProfileId) a.qualityProfileId = Number(b.qualityProfileId);
    if (b.metadataProfileId) a.metadataProfileId = Number(b.metadataProfileId);
    if (b.monitorNewItems) a.monitorNewItems = b.monitorNewItems;
    res.status(202).json(authorResource(a));
  });
  app.delete('/api/v1/author/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!authors.some((x) => x.id === id)) return res.status(404).json({ message: 'Author not found' });
    removeAuthors(new Set([id]));
    res.json({});
  });
  if (chaptarr) {
    app.post('/api/v1/author/deletepreview', (req, res) => {
      const ids = ((req.body || {}).authorIds || []).map(Number);
      if (!ids.length) return res.status(400).json({ message: 'Select authors to preview their deletion.' });
      const folders = authors.filter((a) => ids.includes(a.id)).flatMap((a) => ['audiobook', 'ebook'].filter((f) => a[`${f}Folder`]).map((f) => {
        const fs = files.filter((x) => x.authorId === a.id && x.mediaType === f);
        return { path: a[`${f}Folder`], deleteContents: true, reason: 'Author folder', bookFileCount: fs.length, size: fs.reduce((n, x) => n + x.size, 0), otherFiles: fs.length ? ['cover.jpg'] : [] };
      }));
      res.json({ recycleBin: '/books/.recycle', folders, files: [], otherAuthors: [], warnings: [] });
    });
  }

  app.get('/api/v1/book', (req, res) => {
    const authorId = Number(req.query.authorId);
    res.json(books.filter((b) => !authorId || b.authorId === authorId).map(bookResource));
  });
  app.put('/api/v1/book/monitor', (req, res) => {
    const b = req.body || {}; const ids = new Set((b.bookIds || []).map(Number));
    for (const book of books.filter((x) => ids.has(x.id))) {
      book.monitored = !!b.monitored;
      if (chaptarr) { book.audiobookMonitored = book.mediaType === 'audiobook' && book.monitored; book.ebookMonitored = book.mediaType === 'ebook' && book.monitored; }
    }
    res.status(202).json(books.filter((x) => ids.has(x.id)).map(bookResource));
  });
  app.get('/api/v1/bookfile', (req, res) => {
    if (req.query.unmapped === 'true') return res.json(chaptarr ? unmapped : []);
    const authorId = Number(req.query.authorId); const bookId = Number(req.query.bookId);
    res.json(files.filter((f) => (!authorId || f.authorId === authorId) && (!bookId || f.bookId === bookId)));
  });
  app.delete('/api/v1/bookfile/bulk', (req, res) => {
    const ids = new Set(((req.body || {}).bookFileIds || []).map(Number));
    unmapped = unmapped.filter((f) => !ids.has(f.id));
    files = files.filter((f) => !ids.has(f.id));
    res.json({});
  });
  app.get('/api/v1/release', (req, res) => {
    const b = books.find((x) => x.id === Number(req.query.bookId));
    if (!b) return res.status(400).json({ message: 'bookId is required' });
    const releases = releasesFor(b);
    setTimeout(() => res.json(chaptarr ? { releases, hiddenReleases: [], indexersQueried: 3, indexersFailed: 0 } : releases), 700);
  });
  app.post('/api/v1/release', (req, res) => {
    const rel = req.body || {};
    const [, bookId, i] = String(rel.guid || '').match(/^rel-(\d+)-(\d+)$/) || [];
    const b = books.find((x) => x.id === Number(bookId));
    if (!b) return res.status(404).json({ message: 'Couldn\u2019t find requested release in cache, try searching again' });
    const r = releasesFor(b)[Number(i)];
    queue.push({ id: nextQueue++, title: r.title, authorId: b.authorId, bookId: b.id, status: 'queued', trackedDownloadState: 'downloading', trackedDownloadStatus: 'ok', size: r.size, sizeleft: r.size, timeleft: '00:10:00', downloadClient: 'SABnzbd', indexer: r.indexer, downloadId: `rd-${nextQueue}`, protocol: r.protocol, quality: r.quality });
    res.json(r);
  });

  // Chaptarr hides downloads it can't tie to an author unless asked.
  app.get('/api/v1/queue', (req, res) => res.json(paged(queue.filter((q) => req.query.includeUnknownAuthorItems === 'true' || q.authorId).map((q) => withRefs(q, req)), req)));
  // Removing without removeFromClient only ignores the download (Chaptarr
  // lists those under /ignored and can track them again).
  const removeFromQueue = (ids, query) => {
    const gone = queue.filter((q) => ids.has(q.id));
    queue = queue.filter((q) => !ids.has(q.id));
    if (chaptarr && String(query.removeFromClient) === 'false' && String(query.blocklist) !== 'true') {
      for (const q of gone) ignored.push({ id: nextIgnored++, authorId: q.authorId || 0, bookId: q.bookId || 0, downloadId: q.downloadId, sourceTitle: q.title, date: iso(Date.now()), protocol: q.protocol || 'usenet', downloadClient: q.downloadClient, downloadClientName: q.downloadClient, isInClient: true, record: q });
    }
  };
  app.delete('/api/v1/queue/bulk', (req, res) => { removeFromQueue(new Set(((req.body || {}).ids || []).map(Number)), req.query); res.json({}); });
  app.delete('/api/v1/queue/:id', (req, res) => { removeFromQueue(new Set([Number(req.params.id)]), req.query); res.json({}); });
  if (chaptarr) {
    const view = ({ record, ...rest }) => rest;
    const stopIgnoring = (ids) => {
      for (const g of ignored.filter((x) => ids.has(x.id))) if (g.isInClient && g.record) queue.push(g.record);
      ignored = ignored.filter((x) => !ids.has(x.id));
    };
    app.get('/api/v1/ignored', (req, res) => res.json(paged([...ignored].reverse().map(view), req)));
    app.delete('/api/v1/ignored/bulk', (req, res) => { stopIgnoring(new Set(((req.body || {}).ids || []).map(Number))); res.json({}); });
    app.delete('/api/v1/ignored/:id', (req, res) => {
      if (!ignored.some((x) => x.id === Number(req.params.id))) return res.status(404).json({ message: 'Ignored download not found' });
      stopIgnoring(new Set([Number(req.params.id)]));
      res.json({});
    });
    app.post('/api/v1/queue/cancelconversion/:id', (req, res) => {
      const q = queue.find((x) => x.id === Number(req.params.id));
      if (!q) return res.status(404).json({ message: 'NotFound' });
      if (!q.canCancelConversion) return res.status(400).json({ message: 'No active conversion found for this queue item' });
      Object.assign(q, { conversionStatus: 'cancelled', conversionProgress: null, conversionMessage: 'Cancelled by user', canCancelConversion: false });
      res.json({});
    });
  }
  app.post('/api/v1/queue/grab/:id', (req, res) => {
    const q = queue.find((x) => x.id === Number(req.params.id) && x.status === 'delay');
    if (!q) return res.status(404).json({ message: 'Pending release not found' });
    Object.assign(q, { status: 'downloading', downloadClient: 'SABnzbd', downloadId: `SABnzbd_nzo_${q.id}`, sizeleft: q.size * 0.98, timeleft: '00:12:00' });
    res.json({});
  });
  app.get('/api/v1/calendar', (req, res) => {
    const start = Date.parse(req.query.start) || now - day; const end = Date.parse(req.query.end) || now + 30 * day;
    res.json(books.filter((b) => { const t = Date.parse(b.releaseDate); return t >= start && t <= end; }).map((b) => withRefs(bookResource(b), req)));
  });
  const EVENT_TYPES = { 1: 'grabbed', 3: 'bookFileImported', 4: 'downloadFailed', 5: 'bookFileDeleted', 6: 'bookFileRenamed', 7: 'bookImportIncomplete', 8: 'downloadImported', 9: 'bookFileRetagged', 11: 'bookFileConverted', 12: 'bookFileConversionFailed' };
  app.get('/api/v1/history', (req, res) => {
    const wanted = [].concat(req.query.eventType || []).map((t) => EVENT_TYPES[Number(t)]).filter(Boolean);
    res.json(paged(history().filter((r) => !wanted.length || wanted.includes(r.eventType)).map((r) => withRefs(r, req)), req));
  });
  app.get('/api/v1/wanted/missing', (req, res) => {
    const mt = req.query.mediaType;
    const list = books.filter((b) => b.monitored && !bookHasFile(b) && Date.parse(b.releaseDate) <= Date.now() && (!chaptarr || !mt || b.mediaType === mt))
      .sort((x, y) => Date.parse(y.releaseDate) - Date.parse(x.releaseDate));
    res.json(paged(list.map((b) => withRefs(bookResource(b), req)), req));
  });
  app.get('/api/v1/wanted/cutoff', (req, res) => res.json({ page: 1, pageSize: 50, totalRecords: 0, records: [] }));

  // ---- Manual import (Chaptarr's Interactive Import contract) ----
  // The edition in use (the one the import goes to unless told otherwise).
  const editionOf = (b) => (b ? editionsFor(b).find((e) => e.monitored) || null : null);
  const candidate = (id, path, size, book, extra = {}) => {
    const author = book ? authorRef(book.authorId) : undefined;
    const ext = String(path).split('.').pop().toLowerCase();
    return {
      id, path, name: String(path).split('/').pop().replace(/\.[^.]+$/, ''), size,
      ...(author ? { author } : {}), ...(book ? { book: bookResource(book), edition: editionOf(book), editionId: editionOf(book).id, foreignEditionId: editionOf(book).foreignEditionId } : {}),
      quality: { quality: { id: ext === 'epub' ? 3 : ext === 'm4b' ? 12 : 10, name: ext.toUpperCase() }, revision: { version: 1, real: 0, isRepack: false } },
      customFormats: [], isGraphicAudio: false, qualityWeight: 106, indexerFlags: 0, rejections: [], warnings: [], tags: {},
      additionalFile: false, replaceExistingFiles: false, disableReleaseSwitching: false, ...extra,
    };
  };
  const candidatesFor = (q) => {
    const req = q || {};
    if (req.downloadId === 'SABnzbd_nzo_warbreaker') {
      // Matched to the Hardcover copy, though the grab was for the Amazon one.
      return Array.from({ length: 6 }, (_, i) => candidate(9100 + i, `/downloads/complete/audiobooks/Brandon Sanderson - Warbreaker/Warbreaker - Part ${String(i + 1).padStart(2, '0')}.mp3`, 92274688, warbreaker, { downloadId: req.downloadId }));
    }
    if (req.downloadId) return []; // the folder isn't reachable, or nothing finished
    const ids = new Set([].concat(req.bookFileIds || []).map(Number));
    const picked = unmapped.filter((f) => (!ids.size || ids.has(f.id)) && (!req.folder || f.importUnitRoot === req.folder || f.path.startsWith(`${req.folder}/`)));
    return picked.map((f) => {
      if (/Edgedancer/.test(f.path)) return candidate(f.id, f.path, f.size, books.find((b) => b.title === 'Edgedancer' && b.mediaType === 'audiobook'));
      if (/Secret.History/i.test(f.path)) {
        return candidate(f.id, f.path, f.size, null, { author: authorRef(1), suggestedForeignAuthorId: 'hc:250001', suggestedAuthorName: 'Brandon Sanderson', suggestedForeignBookId: 'hc:376501', suggestedBookTitle: 'Mistborn: Secret History', suggestedForeignEditionId: 'hc:edition:376501', suggestedEditionTitle: 'Mistborn: Secret History', warnings: ['Not in the library yet: Chaptarr adds it from Hardcover'] });
      }
      return candidate(f.id, f.path, f.size, null, { rejections: [{ reason: 'Couldn\u2019t find a similar book in the library', type: 'permanent' }] });
    });
  };
  if (chaptarr) {
    app.get('/api/v1/manualimport', (req, res) => setTimeout(() => res.json(candidatesFor(req.query)), 300));
    app.post('/api/v1/manualimport', (req, res) => {
      const out = (Array.isArray(req.body) ? req.body : []).map((it) => {
        const book = books.find((b) => b.id === Number(it.bookId));
        const author = authorRef(Number(it.authorId) || (book && book.authorId));
        const edition = book ? editionOf(book) : null;
        const wrongAuthor = book && author && book.authorId !== author.id;
        return {
          id: it.id, path: it.path, ...(author ? { author } : {}), ...(book ? { book: bookResource(book), edition, editionId: Number(it.editionId) || edition.id } : {}),
          quality: it.quality, releaseGroup: it.releaseGroup, indexerFlags: it.indexerFlags || 0, downloadId: it.downloadId,
          rejections: wrongAuthor ? [{ reason: 'Book belongs to another author', type: 'permanent' }] : [], warnings: it.warnings || [],
          suggestedForeignAuthorId: it.suggestedForeignAuthorId, suggestedAuthorName: it.suggestedAuthorName, suggestedForeignBookId: it.suggestedForeignBookId, suggestedBookTitle: it.suggestedBookTitle,
          isGraphicAudio: false, additionalFile: false, replaceExistingFiles: false, disableReleaseSwitching: !!it.disableReleaseSwitching,
        };
      });
      res.status(202).json(out);
    });
    app.get('/api/v1/edition', (req, res) => {
      const ids = new Set([].concat(req.query.bookId || []).map(Number));
      res.json(books.filter((b) => ids.has(b.id)).flatMap(editionsFor));
    });
    app.get('/api/v1/rename', (req, res) => {
      const authorId = Number(req.query.authorId);
      const a = authors.find((x) => x.id === authorId);
      if (!a) return res.json([]);
      const mt = req.query.mediaType;
      const out = files.filter((f) => f.authorId === authorId && (!mt || f.mediaType === mt)).map((f) => {
        const b = books.find((x) => x.id === f.bookId);
        const base = String(f.path).split('/').pop();
        const newPath = `${a[`${f.mediaType}Folder`] || a.path}/${b.title} (${new Date(b.releaseDate).getUTCFullYear()})/${base}`;
        return { authorId, bookId: b.id, editionId: 50000 + b.id, bookFileId: f.id, id: f.id, existingPath: f.path, newPath, canOrganize: true };
      }).filter((x) => x.existingPath !== x.newPath);
      res.json(out);
    });
    app.get('/api/v1/retag', (req, res) => {
      const authorId = Number(req.query.authorId);
      const a = authors.find((x) => x.id === authorId);
      if (!a) return res.json([]);
      const def = BOOK_LIBRARY.find((d) => d.id === authorId) || {};
      const narrator = (def.narrators || [])[0] || '';
      const out = files.filter((f) => f.authorId === authorId && f.mediaType === 'audiobook').map((f) => {
        const b = books.find((x) => x.id === f.bookId);
        const parts = files.filter((x) => x.bookId === f.bookId).length;
        const n = files.filter((x) => x.bookId === f.bookId).indexOf(f) + 1;
        const changes = parts > 1
          ? [{ field: 'TITLE', oldValue: `Chapter ${n}`, newValue: b.title }, { field: 'ARTIST', oldValue: narrator, newValue: a.authorName }, { field: 'NARRATOR', newValue: narrator }, { field: 'TRACKCOUNT', newValue: '0' }]
          : [{ field: 'ALBUMARTIST', newValue: a.authorName }, { field: 'YEAR', newValue: String(new Date(b.releaseDate).getUTCFullYear()) }];
        // Like Chaptarr, bookId is the file's edition.
        return { authorId, bookId: editionOf(b).id, trackNumbers: [], bookFileId: f.id, id: f.id, path: f.path, changes };
      });
      res.json(out);
    });
    app.get('/api/v1/system/task', (req, res) => res.json([
      ['Application Update Check', 'ApplicationUpdateCheck', 360], ['Backup', 'Backup', 10080], ['Check Health', 'CheckHealth', 360],
      ['Housekeeping', 'Housekeeping', 1440], ['Import List Sync', 'ImportListSync', 5], ['Process Pending Imports', 'ProcessPendingImports', 1],
      ['Refresh Author', 'RefreshAuthor', 1440], ['Refresh Monitored Downloads', 'RefreshMonitoredDownloads', 1], ['Rescan Folders', 'RescanFolders', 1440], ['Rss Sync', 'RssSync', 15],
    ].map(([n, taskName, interval], i) => ({ id: i + 1, name: n, taskName, interval, lastExecution: iso(now - Math.min(interval, 600) * 30000), nextExecution: iso(now + Math.min(interval, 600) * 30000), lastDuration: i % 3 ? '00:00:00.4120000' : '00:01:52.7210000' }))));
    app.get('/api/v1/blocklist', (req, res) => res.json(paged(blocklist, req)));
    app.delete('/api/v1/blocklist/bulk', (req, res) => { const ids = new Set(((req.body || {}).ids || []).map(Number)); blocklist = blocklist.filter((b) => !ids.has(b.id)); res.json({}); });
    app.delete('/api/v1/blocklist/:id', (req, res) => { blocklist = blocklist.filter((b) => b.id !== Number(req.params.id)); res.json({}); });
    app.get('/api/v1/config/metadataprovider', (req, res) => res.json({ id: 1, writeAudioTags: 'no', scrubAudioTags: false, writeBookTags: 'newFiles', updateCovers: true, embedMetadata: false }));
    app.get('/api/v1/config/mediamanagement', (req, res) => res.json({ id: 1, recycleBin: '/books/.recycle', recycleBinCleanupDays: 7, bookMatchingStrictness: 'balanced', usePathAsTagsFallback: true }));
  }

  // ---- Editions, one book, folders, mappings, logs --------------------------
  // Editions follow Chaptarr's GET edition?bookId= (every format of the work,
  // the one in use monitored) and PUT book/{id} with one monitored edition.
  const NARRATOR_POOL = ['Michael Kramer', 'Kate Reading', 'Ray Porter', 'R. C. Bray', 'Hugh Fraser', 'Nigel Planer', 'Stephen Briggs', 'Full Cast'];
  const editionChoice = new Map();
  const hashOf = (s) => { let x = 7; for (const ch of String(s)) x = (x * 31 + ch.charCodeAt(0)) % 1000003; return x; };
  const editionsFor = (b) => {
    if (!b) return [];
    const author = authors.find((a) => a.id === b.authorId) || {};
    const def = BOOK_LIBRARY.find((d) => d.id === b.authorId) || BOOK_LOOKUP.find((d) => d.name === author.authorName) || {};
    const ebook = chaptarr ? b.mediaType === 'ebook' : true;
    const h0 = hashOf(b.title);
    const year = new Date(b.releaseDate).getUTCFullYear() || 2015;
    const fileCount = files.filter((f) => f.bookId === b.id).length;
    const cover = (k) => [{ url: `/MediaCoverProxy/${(h0 + k).toString(16)}/cover.jpg`, coverType: 'cover', extension: '.jpg', remoteUrl: bookCoverUri(b.title, author.authorName || '', ((def.hue || 200) + k * 47) % 360, !ebook) }];
    const base = (k, fields) => ({
      id: k === 0 ? 50000 + b.id : 60000 + b.id * 10 + k, bookId: b.id, foreignEditionId: `${b.foreignBookId}:ed${k}`, title: b.title, language: 'eng', overview: '',
      images: cover(k), links: [], ratings: { votes: Math.max(0, 900 - k * 300 + (h0 % 200)), value: 4.1 + (k % 3) / 10, popularity: 10 }, bookFileCount: k === 0 ? fileCount : 0, manualAdd: false, ...fields,
    });
    let list;
    if (ebook) {
      list = [
        base(0, { format: 'ebook', isEbook: true, publisher: 'Tor Books', pageCount: b.pageCount || 400, releaseDate: b.releaseDate, isbn13: `978076${String(h0).padStart(7, '0').slice(0, 7)}` }),
        base(1, { format: 'ebook', isEbook: true, publisher: 'Gollancz', pageCount: (b.pageCount || 400) + 24, releaseDate: `${year + 1}-03-01T00:00:00Z`, isbn13: `978057${String(h0 + 1).padStart(7, '0').slice(0, 7)}` }),
        base(2, { format: 'ebook', isEbook: true, publisher: 'Heyne', pageCount: (b.pageCount || 400) + 60, releaseDate: `${year + 2}-09-01T00:00:00Z`, language: 'ger', title: `${b.title} (German edition)` }),
      ];
    } else {
      const own = (def.narrators || []).length ? def.narrators : [NARRATOR_POOL[h0 % NARRATOR_POOL.length]];
      const second = own[1] || NARRATOR_POOL[(h0 + 3) % NARRATOR_POOL.length];
      const secs = 28000 + (h0 % 30000);
      const voice = (n) => ({ narrator: n, narratorNames: n ? [n] : [], narrators: n ? [{ name: n, isCastLabel: n === 'Full Cast' }] : [] });
      list = [
        base(0, { format: 'audiobook', isEbook: false, ...voice(own[0]), durationSeconds: secs, publisher: 'Macmillan Audio', releaseDate: b.releaseDate, asin: `B0${String(h0).padStart(8, '0').slice(0, 8)}`, chapterCount: 40 }),
        base(1, { format: 'audiobook', isEbook: false, ...voice(second), durationSeconds: secs + 2400, publisher: 'Audible Studios', releaseDate: `${Math.min(year + 6, 2024)}-05-14T00:00:00Z`, asin: `B0${String(h0 + 7).padStart(8, '0').slice(0, 8)}`, chapterCount: 52 }),
        base(2, { format: 'audiobook', isEbook: false, ...voice(own[0]), durationSeconds: 0, publisher: 'Brilliance Audio', releaseDate: `${year}-01-01T00:00:00Z` }),
        base(3, { format: 'audiobook', isEbook: false, ...voice(''), durationSeconds: 0, publisher: 'Recorded Books', releaseDate: `${year}-01-01T00:00:00Z` }),
        // Chaptarr lists the work's other formats too.
        base(4, { format: 'ebook', isEbook: true, publisher: 'Tor Books', pageCount: 412, releaseDate: b.releaseDate }),
      ];
    }
    const chosen = editionChoice.get(b.id);
    return list.map((e) => ({ ...e, monitored: chosen ? e.id === chosen : e.id === 50000 + b.id }));
  };
  if (!chaptarr) {
    app.get('/api/v1/edition', (req, res) => {
      const ids = new Set([].concat(req.query.bookId || []).map(Number));
      res.json(books.filter((b) => ids.has(b.id)).flatMap(editionsFor));
    });
  }

  // book/lookup and POST book: one book, its author too when new, with only
  // that book monitored (Chaptarr's specificBook).
  const catalogFor = (authorName) => BOOK_LIBRARY.find((d) => d.name === authorName) || BOOK_LOOKUP.find((d) => d.name === authorName);
  const localInstance = (b) => ({ id: b.id, title: b.title, titleSlug: b.titleSlug, mediaType: b.mediaType, narrator: (b.narratorNames || [])[0] || '', monitored: !!b.monitored, hasFiles: bookHasFile(b) });
  const lookupResult = (def, [title, series, date], mediaType) => {
    const a = authors.find((x) => x.authorName === def.name);
    const mine = a ? books.filter((b) => b.authorId === a.id && b.title === title) : [];
    const audio = mediaType === 'audiobook';
    const foreignBookId = mine.length ? mine[0].foreignBookId : `${chaptarr ? 'hc:' : ''}${77000 + (hashOf(title) % 9999)}`;
    return {
      title, authorTitle: `${(def.lastFirst || def.name).toLowerCase()} ${title}`, seriesTitle: series || '', ...(chaptarr ? { seriesLabels: series ? [series] : [] } : {}),
      foreignBookId, titleSlug: title.toLowerCase().replace(/[^a-z0-9]+/g, '-'), overview: `${title}, by ${def.name}.`,
      releaseDate: typeof date === 'number' ? iso(now + date * day) : `${date}T00:00:00Z`,
      monitored: false, anyEditionOk: true, ratings: { votes: 3000 + (hashOf(title) % 9000), value: 4.2, popularity: 50 }, genres: def.genres || [],
      images: [{ url: '', coverType: 'cover', extension: '.jpg', remoteUrl: bookCoverUri(title, def.name, (def.hue + 30) % 360, audio) }],
      author: {
        authorName: def.name, foreignAuthorId: a ? a.foreignAuthorId : (lookupIds.get(def.name) || `hc:${260000 + (hashOf(def.name) % 999)}`), overview: def.overview, status: def.status,
        images: [{ url: '', coverType: 'poster', extension: '.jpg', remoteUrl: authorPortraitUri(def.name, def.hue) }],
      },
      editions: [{ title, foreignEditionId: `${foreignBookId}:ed0`, monitored: true, format: audio ? 'audiobook' : 'ebook', isEbook: !audio }],
      ...(chaptarr
        ? { mediaType, authorId: 0, localAudiobookBooks: mine.filter((b) => b.mediaType === 'audiobook').map(localInstance), localEbookBooks: mine.filter((b) => b.mediaType === 'ebook').map(localInstance) }
        : { authorId: a ? a.id : 0 }),
    };
  };
  app.get('/api/v1/book/lookup', (req, res) => {
    const term = String(req.query.term || '').trim().toLowerCase();
    if (!term) return res.status(400).json({ error: 'term is required' });
    const mt = chaptarr ? (['audiobook', 'ebook'].includes(req.query.mediaType) ? req.query.mediaType : 'audiobook') : undefined;
    const out = [];
    for (const def of [...BOOK_LIBRARY, ...BOOK_LOOKUP]) {
      for (const entry of def.books || []) if (`${entry[0]} ${def.name} ${entry[1] || ''}`.toLowerCase().includes(term)) out.push(lookupResult(def, entry, mt));
    }
    setTimeout(() => res.json(out.slice(0, 25)), 250);
  });
  // One book entry, shaped like the catalog ones (no files).
  const newBook = (a, [title, series, date], format, monitored) => {
    const def = catalogFor(a.authorName) || {};
    const audio = format === 'audiobook';
    const b = {
      id: nextBook++, authorId: a.id, title, titleSlug: title.toLowerCase().replace(/[^a-z0-9]+/g, '-'), foreignBookId: `${chaptarr ? 'hc:' : ''}${9000 + nextBook}`,
      seriesTitle: series || '', ...(chaptarr ? { seriesLabels: series ? [series] : [] } : {}),
      releaseDate: typeof date === 'number' ? iso(now + date * day) : String(date).includes('T') ? date : `${date}T00:00:00Z`,
      monitored: !!monitored, anyEditionOk: true, pageCount: audio ? 0 : 250 + (title.length * 17) % 600, genres: def.genres || [],
      ratings: { votes: 5000 + title.length * 311, value: Math.round((3.7 + (title.length % 12) / 10) * 100) / 100, popularity: 500 },
      images: [{ url: `/MediaCover/Books/${nextBook - 1}/cover.jpg`, coverType: 'cover', extension: '.jpg', remoteUrl: bookCoverUri(title, a.authorName, ((def.hue || 200) + (series ? series.length * 7 : 0)) % 360, audio) }],
      added: iso(Date.now()),
    };
    if (chaptarr) Object.assign(b, { mediaType: format, audiobookMonitored: audio && !!monitored, ebookMonitored: !audio && !!monitored, narratorNames: audio ? (def.narrators || []).slice(0, 1) : [], narrators: [] });
    books.push(b);
    return b;
  };
  // An author set up for another format: Chaptarr lists their books in it,
  // monitoring them as "monitor new books" says (All: every one).
  const gainFormat = (a, f, s = {}) => {
    if (!chaptarr || a[`${f}RootFolderPath`]) return false;
    const rootPath = s.rootFolderPath || rootFor(f);
    const monitorNew = s.monitorNewItems || 'none';
    Object.assign(a, {
      [`${f}RootFolderPath`]: rootPath, [`${f}Folder`]: `${rootPath}/${a.authorName}`, [`${f}Monitored`]: s.monitored !== false,
      [`${f}QualityProfileId`]: Number(s.qualityProfileId) || (f === 'ebook' ? 1 : 2), [`${f}MetadataProfileId`]: Number(s.metadataProfileId) || (f === 'ebook' ? 2 : 1),
      [`${f}MonitorNewItems`]: monitorNew, [`${f}Tags`]: a.tags || [],
    });
    a.monitored = ['audiobook', 'ebook'].some((x) => a[`${x}Monitored`] === true);
    const titles = new Map();
    for (const b of books.filter((x) => x.authorId === a.id)) if (!titles.has(b.title)) titles.set(b.title, [b.title, b.seriesTitle, b.releaseDate]);
    for (const entry of (catalogFor(a.authorName) || {}).books || []) if (!titles.has(entry[0])) titles.set(entry[0], entry);
    for (const entry of titles.values()) if (!books.some((x) => x.authorId === a.id && x.title === entry[0] && x.mediaType === f)) newBook(a, entry, f, monitorNew === 'all');
    return true;
  };
  const rootMatches = (path, f) => roots.some((r) => r.path === String(path || '').replace(/\/+$/, '') && (!chaptarr || r.folderType === 0 || r.folderType === (f === 'ebook' ? 2 : 1)));
  app.post('/api/v1/book', (req, res) => {
    const body = req.body || {};
    const format = chaptarr ? String(req.query.mediaType || body.mediaType || '') : null;
    if (chaptarr && !['audiobook', 'ebook'].includes(format)) return res.status(400).json({ message: `Invalid mediaType parameter: '${format}'. Valid values are: audiobook, ebook` });
    const a0 = body.author || {};
    const def = catalogFor(a0.authorName);
    const entry = def && (def.books || []).find((x) => x[0] === body.title);
    if (!def || !entry) return res.status(404).json({ message: 'Book not found on the metadata server' });
    let a = authors.find((x) => (a0.foreignAuthorId && x.foreignAuthorId === a0.foreignAuthorId) || x.authorName === a0.authorName);
    const side = (k) => a0[`${format}${k}`];
    if (chaptarr && (!a || !a[`${format}RootFolderPath`]) && !rootMatches(side('RootFolderPath'), format)) {
      return res.status(400).json([{ propertyName: `${format === 'ebook' ? 'Ebook' : 'Audiobook'}RootFolderPath`, errorMessage: `Choose a root folder for ${format}s` }]);
    }
    if (!chaptarr && !a && !rootMatches(a0.rootFolderPath)) return res.status(400).json([{ propertyName: 'RootFolderPath', errorMessage: 'Choose a root folder' }]);
    if (!a) {
      const settings = chaptarr
        ? { [`${format}QualityProfileId`]: Number(side('QualityProfileId')) || (format === 'ebook' ? 1 : 2), [`${format}MetadataProfileId`]: Number(side('MetadataProfileId')) || (format === 'ebook' ? 2 : 1), [`${format}MonitorNewItems`]: side('MonitorNewItems') || 'none', [`${format}RootFolderPath`]: side('RootFolderPath'), [`${format}Folder`]: `${String(side('RootFolderPath')).replace(/\/+$/, '')}/${def.name}` }
        : { rootFolderPath: a0.rootFolderPath, qualityProfileId: Number(a0.qualityProfileId) || 1, metadataProfileId: Number(a0.metadataProfileId) || 1, monitorNewItems: a0.monitorNewItems || 'none' };
      a = addCatalogAuthor({ ...def, books: [] }, { formats: chaptarr ? [format] : undefined, foreignAuthorId: a0.foreignAuthorId || lookupIds.get(def.name), extra: settings });
      a.added = iso(Date.now());
      for (const e of def.books || []) newBook(a, e, format, e[0] === body.title);
    } else if (chaptarr && !a[`${format}RootFolderPath`]) {
      gainFormat(a, format, { rootFolderPath: side('RootFolderPath'), qualityProfileId: side('QualityProfileId'), metadataProfileId: side('MetadataProfileId'), monitorNewItems: side('MonitorNewItems') || 'none' });
    }
    let b = books.find((x) => x.authorId === a.id && x.title === body.title && (!chaptarr || x.mediaType === format));
    if (!b) b = newBook(a, entry, format, true);
    b.monitored = true;
    if (chaptarr) { b.audiobookMonitored = format === 'audiobook'; b.ebookMonitored = format === 'ebook'; }
    res.status(201).json(bookResource(b));
  });
  app.get('/api/v1/book/:id', (req, res) => {
    const b = books.find((x) => x.id === Number(req.params.id));
    if (!b) return res.status(404).json({ message: 'Book not found' });
    // Readarr hands the editions out with the book; Chaptarr under /edition.
    res.json({ ...bookResource(b), ...(chaptarr ? {} : { editions: editionsFor(b) }) });
  });
  app.put('/api/v1/book/:id', (req, res) => {
    const b = books.find((x) => x.id === Number(req.params.id));
    if (!b) return res.status(404).json({ message: 'Book not found' });
    const body = req.body || {};
    const list = editionsFor(b);
    const sent = Array.isArray(body.editions) ? body.editions : [];
    if (sent.length) {
      const ids = sent.map((e) => Number(e && e.id));
      if (ids.some((id) => !list.some((e) => e.id === id))) return res.status(400).json([{ propertyName: 'Editions', errorMessage: 'All editions must belong to the book being updated.' }]);
      const picked = sent.filter((e) => e && e.monitored);
      if (picked.length > 1 || new Set(ids).size !== ids.length) return res.status(400).json([{ propertyName: 'Editions', errorMessage: 'Submit each edition once and select at most one monitored edition.' }]);
      if (picked.length === 1) {
        const e = list.find((x) => x.id === Number(picked[0].id));
        editionChoice.set(b.id, e.id);
        if (chaptarr) b.anyEditionOk = false;
        if (!e.isEbook) b.narratorNames = e.narratorNames || [];
      }
    } else if (typeof body.anyEditionOk === 'boolean') {
      b.anyEditionOk = body.anyEditionOk;
    }
    res.status(202).json(b.id);
  });

  // A small filesystem as the app sees it (its container): library roots,
  // author folders, the download folders and a spare folder for a new root.
  const FS_BASE = ['/books/audiobooks', '/books/ebooks', '/books/comics', '/downloads/complete/audiobooks/Andy.Weir-The.Martian.Unabridged.2014', '/downloads/complete/ebooks', '/downloads/incomplete', '/config/logs'];
  const dirOf = (p) => { const s = String(p || '').trim().replace(/\/{2,}/g, '/'); return s ? (s.endsWith('/') ? s : `${s}/`) : ''; };
  const noSlash = (p) => dirOf(p).replace(/\/$/, '') || '/';
  const fsDirs = () => {
    const set = new Set(chaptarr ? FS_BASE : ['/books', '/downloads/complete', '/config/logs']);
    for (const r of roots) set.add(r.path);
    for (const a of authors) for (const k of ['audiobookFolder', 'ebookFolder', 'path']) if (a[k]) set.add(noSlash(a[k]));
    for (const u of unmapped) if (u.importUnitRoot) set.add(noSlash(u.importUnitRoot));
    for (const p of [...set]) { let q = p; while ((q = q.replace(/\/[^/]+$/, ''))) set.add(q); }
    return set;
  };
  const fsHas = (p) => fsDirs().has(noSlash(p));
  app.get('/api/v1/filesystem', (req, res) => {
    const p = noSlash(req.query.path || '/');
    const top = p === '/';
    const children = [...fsDirs()].filter((d) => (top ? /^\/[^/]+$/.test(d) : d.startsWith(`${p}/`) && !d.slice(p.length + 1).includes('/'))).sort();
    res.json({
      parent: top ? undefined : (p.replace(/\/[^/]+$/, '') || '/') + (p.replace(/\/[^/]+$/, '') ? '/' : ''),
      directories: children.map((d) => ({ type: 'folder', name: d.split('/').pop(), path: `${d}/`, size: 0, lastModified: iso(now) })),
      files: [],
    });
  });

  // Root folders: Chaptarr's per-format defaults, its "folder of one format
  // can't have the other's settings" rule, and Readarr's default* fields.
  const SIDE_KEYS = ['QualityProfileId', 'MetadataProfileId', 'Monitored', 'MonitorExistingMode', 'MonitorNewItems', 'Tags', 'MonitorExisting', 'MonitorFuture', 'MonitorExistingBooks', 'WriteAudioBookShelfMetadataJson', 'WriteAudioBookShelfCover'];
  const typeFormatsOf = (t) => (Number(t) === 0 ? ['audiobook', 'ebook'] : Number(t) === 2 ? ['ebook'] : ['audiobook']);
  const rootResource = (b, id) => {
    const out = { id, name: String(b.name || '').trim() || noSlash(b.path).split('/').pop(), path: noSlash(b.path), accessible: true, freeSpace: 404942340096, totalSpace: 12000119750656, isCalibreLibrary: false, defaultTags: b.defaultTags || [] };
    if (!chaptarr) {
      return { ...out, defaultQualityProfileId: Number(b.defaultQualityProfileId) || 1, defaultMetadataProfileId: Number(b.defaultMetadataProfileId) || 1, defaultMonitorOption: b.defaultMonitorOption || 'all', defaultNewItemMonitorOption: b.defaultNewItemMonitorOption || 'all' };
    }
    out.folderType = Number(b.folderType);
    out.placeEbooksWithAudiobooks = !!b.placeEbooksWithAudiobooks;
    for (const f of typeFormatsOf(b.folderType)) {
      const s = {
        qualityProfileId: Number(b[`${f}QualityProfileId`]) || (f === 'ebook' ? 1 : 2), metadataProfileId: Number(b[`${f}MetadataProfileId`]) || (f === 'ebook' ? 2 : 1),
        monitored: b[`${f}Monitored`] !== false, monitorExistingMode: b[`${f}MonitorExistingMode`] || 'all', monitorNewItems: b[`${f}MonitorNewItems`] || 'all', tags: b[`${f}Tags`] || [],
      };
      Object.assign(out, { [f]: s, [`${f}QualityProfileId`]: s.qualityProfileId, [`${f}MetadataProfileId`]: s.metadataProfileId, [`${f}MonitorNewItems`]: s.monitorNewItems });
    }
    return out;
  };
  const rootProblem = (b, existing) => {
    const path = noSlash(b.path);
    if (!b.path || path === '/') return [{ propertyName: 'Path', errorMessage: 'Invalid Path' }];
    if (!fsHas(path)) return [{ propertyName: 'Path', errorMessage: `Folder '${dirOf(path)}' does not exist` }];
    if (!existing && roots.some((r) => r.path === path)) return [{ propertyName: 'Path', errorMessage: 'Path is already configured as a root folder' }];
    if (chaptarr) {
      const t = Number(b.folderType);
      if (![0, 1, 2].includes(t)) return { message: `Invalid folder type: ${b.folderType}. Valid values are 0 (Mixed), 1 (Audiobook), 2 (Ebook).` };
      const other = t === 1 ? 'ebook' : t === 2 ? 'audiobook' : null;
      if (other && SIDE_KEYS.some((k) => b[`${other}${k}`] !== undefined && b[`${other}${k}`] !== null)) return { message: `${t === 1 ? 'Audiobook' : 'Ebook'}-only folders cannot have ${other} settings` };
      if (b.audiobookMonitorExistingMode && !['all', 'missing', 'existing', 'none'].includes(b.audiobookMonitorExistingMode)) return { message: 'audiobook MonitorExistingMode must be All, Missing, Existing, None, or null (unconfigured)' };
      if (b.ebookMonitorExistingMode && !['all', 'missing', 'existing', 'none'].includes(b.ebookMonitorExistingMode)) return { message: 'ebook MonitorExistingMode must be All, Missing, Existing, None, or null (unconfigured)' };
    }
    return null;
  };
  const withDefaults = (r) => {
    if (!chaptarr) return r;
    const firstOf = (t) => roots.find((x) => x.folderType === t || x.folderType === 0);
    return { ...r, isEffectiveDefaultAudiobook: firstOf(1) === r, isEffectiveDefaultEbook: firstOf(2) === r };
  };
  app.get('/api/v1/rootfolder', (req, res) => res.json(roots.map(withDefaults)));
  app.post('/api/v1/rootfolder', (req, res) => {
    const b = req.body || {};
    const problem = rootProblem(b, null);
    if (problem) return res.status(400).json(problem);
    const r = rootResource(b, Math.max(0, ...roots.map((x) => x.id)) + 1);
    roots.push(r);
    res.status(201).json(withDefaults(r));
  });
  app.put('/api/v1/rootfolder/:id', (req, res) => {
    const i = roots.findIndex((x) => x.id === Number(req.params.id));
    if (i < 0) return res.status(404).json({ message: 'Root folder not found' });
    const b = req.body || {};
    if (b.path && noSlash(b.path) !== roots[i].path) return res.status(400).json({ message: 'Cannot edit root folder path' });
    const problem = rootProblem({ ...b, path: roots[i].path }, roots[i]);
    if (problem) return res.status(400).json(problem);
    if (chaptarr && Number(b.folderType) !== roots[i].folderType && Number(b.folderType) !== 0
      && authors.some((a) => a.audiobookRootFolderPath === roots[i].path || a.ebookRootFolderPath === roots[i].path)) {
      return res.status(400).json({ message: 'Authors are assigned to this root folder, so its type can only change to audiobooks and ebooks.' });
    }
    roots[i] = rootResource({ ...b, path: roots[i].path }, roots[i].id);
    res.status(202).json(withDefaults(roots[i]));
  });
  app.delete('/api/v1/rootfolder/:id', (req, res) => {
    const i = roots.findIndex((x) => x.id === Number(req.params.id));
    if (i < 0) return res.status(404).json({ message: 'Root folder not found' });
    roots.splice(i, 1);
    res.json({});
  });

  // Remote path mappings, Chaptarr's suggestions and its test.
  if (chaptarr) {
    const clientRoots = (c) => (c && c.id === 1 ? SAB_ROOTS : []);
    const mappingProblem = (b, id = 0) => {
      if (!String(b.host || '').trim()) return [{ propertyName: 'Host', errorMessage: "'Host' must not be empty." }];
      if (!dirOf(b.remotePath)) return [{ propertyName: 'RemotePath', errorMessage: "'Remote Path' must not be empty." }];
      if (!dirOf(b.localPath) || noSlash(b.localPath) === '/') return [{ propertyName: 'LocalPath', errorMessage: 'Invalid LocalPath. LocalPath cannot be empty and must not be the root.' }];
      if (!fsHas(b.localPath)) return [{ propertyName: 'LocalPath', errorMessage: "Can't add mount point directory that doesn't exist." }];
      const scope = Number(b.downloadClientId) || 0;
      if (mappings.some((m) => m.id !== id && (Number(m.downloadClientId) || 0) === scope && (scope || m.host.toLowerCase() === String(b.host).toLowerCase()) && dirOf(m.remotePath) === dirOf(b.remotePath))) {
        return [{ propertyName: 'RemotePath', errorMessage: scope ? 'RemotePath already configured for this download client.' : 'RemotePath already configured.' }];
      }
      return null;
    };
    const mappingOf = (b, id) => ({ id, host: String(b.host).trim(), remotePath: dirOf(b.remotePath), localPath: dirOf(b.localPath), downloadClientId: Number(b.downloadClientId) || 0 });
    app.post('/api/v1/remotepathmapping', (req, res) => {
      const b = req.body || {};
      const problem = mappingProblem(b);
      if (problem) return res.status(400).json(problem);
      const m = mappingOf(b, Math.max(0, ...mappings.map((x) => x.id)) + 1);
      mappings.push(m);
      noteReachability();
      res.status(201).json(m);
    });
    app.get('/api/v1/remotepathmapping/suggestions', (req, res) => {
      const id = Number(req.query.downloadClientId) || 0;
      const host = String(req.query.host || '').toLowerCase();
      const scoped = mappings.filter((m) => (id ? Number(m.downloadClientId) === id : !Number(m.downloadClientId) && (!host || m.host.toLowerCase() === host)));
      const uniq = (list) => [...new Set(list)].sort();
      res.json({
        downloadClientPaths: uniq([...scoped.map((m) => m.remotePath), ...clientRoots(dlClients.find((c) => c.id === id))]),
        chaptarrPaths: uniq([...mappings.map((m) => m.localPath), ...roots.map((r) => dirOf(r.path))]),
      });
    });
    app.post('/api/v1/remotepathmapping/test', (req, res) => {
      const b = req.body || {};
      if (!String(b.host || '').trim() || !dirOf(b.remotePath) || !dirOf(b.localPath) || noSlash(b.localPath) === '/') return res.status(400).json([{ propertyName: 'LocalPath', errorMessage: 'Invalid mapping' }]);
      const remote = dirOf(b.remotePath); const local = dirOf(b.localPath);
      const exists = fsHas(local);
      const client = dlClients.find((c) => c.id === Number(b.downloadClientId));
      const matched = client ? clientRoots(client).find((r) => r.startsWith(remote) || remote.startsWith(r)) : null;
      const item = client ? queue.filter((q) => q.downloadClient === client.name && q.outputPath).map((q) => dirOf(q.outputPath)).find((p) => p.startsWith(remote)) : null;
      const itemLocal = item ? local + item.slice(remote.length) : undefined;
      res.json({
        downloadClientId: Number(b.downloadClientId) || 0, host: b.host, remotePath: remote, localPath: local, mappedPath: local, isMapped: local !== remote,
        localPathExists: exists, localPathWritable: exists, mappedPathExists: exists, mappedPathWritable: exists,
        downloadClientPathChecked: !!client, downloadClientPathMatched: !!matched, ...(matched ? { downloadClientMatchedPath: matched } : {}),
        downloadClientItemPathChecked: !!item, ...(item ? { downloadClientItemMappedPath: itemLocal, downloadClientItemPathExists: fsHas(itemLocal), downloadClientItemPathWritable: fsHas(itemLocal) } : { downloadClientItemPathExists: false, downloadClientItemPathWritable: false }),
      });
    });
    app.put('/api/v1/remotepathmapping/:id', (req, res) => {
      const i = mappings.findIndex((m) => m.id === Number(req.params.id));
      if (i < 0) return res.status(404).json({ message: 'NotFound' });
      const problem = mappingProblem(req.body || {}, mappings[i].id);
      if (problem) return res.status(400).json(problem);
      mappings[i] = mappingOf(req.body, mappings[i].id);
      noteReachability();
      res.status(202).json(mappings[i]);
    });
    app.delete('/api/v1/remotepathmapping/:id', (req, res) => {
      const i = mappings.findIndex((m) => m.id === Number(req.params.id));
      if (i >= 0) mappings.splice(i, 1);
      noteReachability();
      res.json({});
    });
  }

  // Log files, as the app writes them (times in UTC): a download it can't
  // reach every minute, RSS syncs, and a few warnings worth grouping.
  // The files cover the last six hours; the import error stops at the time a
  // mapping made the folder reachable, as in a real log.
  const logName = chaptarr ? 'chaptarr' : 'readarr';
  const logStamp = (t) => new Date(t).toISOString().replace('T', ' ').replace(/(\.\d)\d\dZ$/, '$1');
  const audioUnreachable = () => chaptarr && !mappings.some((m) => m.host.toLowerCase() === 'sabnzbd' && SAB_ROOTS[0].startsWith(dirOf(m.remotePath)));
  let reachableSince = 0;
  const noteReachability = () => { if (audioUnreachable()) reachableSince = 0; else if (!reachableSince) reachableSince = Date.now(); };
  const logFiles = () => {
    const out = [];
    const until = Date.now();
    for (let k = 0; k < 3; k++) {
      const end = until - k * 7200000; const start = end - 7200000;
      const lines = [];
      const add = (t, level, logger, message, extra = []) => lines.push([t, [`${logStamp(t)}|${level}|${logger}|${message}`, ...extra].join('\n')]);
      for (let t = start, i = 0; t < end; t += 60000, i++) {
        if (chaptarr && !(reachableSince && t + 1200 >= reachableSince)) add(t + 1200, 'Error', 'DownloadedBooksImportService', 'Import failed, path does not exist or is not accessible by Chaptarr: /mnt/user/downloads/complete/audiobooks/Andy.Weir-The.Martian.Unabridged.2014. Ensure the path exists and the user running Chaptarr has the correct permissions');
        if (i % 15 === 0) add(t + 400, 'Info', 'RssSyncService', `RSS Sync Completed. Reports found: ${38 + ((i * 7) % 19)}, Reports grabbed: 0`);
      }
      if (k === 0) {
        for (const [n, file] of [[1, 'Edgedancer - Part 01'], [2, 'Edgedancer - Part 02'], [3, 'Secret History 1 of 2']]) {
          add(start + n * 600000, 'Warn', 'FileMatchingService', `[HOLY-GRAIL][unrestricted/path-tags][STAGED-FTS-UNCLEAR] Structural field evidence did not produce one physically compatible Book: 1|Audiobook|base:hc:${4000 + n}:tier=1,fields=2,durationConflict=False for '${file}'`);
        }
        for (const n of [1, 2, 3]) add(start + n * 900000, 'Warn', 'AudioDurationResolver', `FFprobe returned no valid duration for '/books/audiobooks/Brandon Sanderson/Elantris/${String(n).padStart(2, '0')} - Elantris.mp3': N/A`);
      } else if (k === 1) {
        for (const n of [1, 2]) {
          add(start + n * 1800000, 'Error', 'Newznab', 'An error occurred while processing feed. https://api.nzbgeek.info/api?t=search&cat=3030&extended=1&apikey=(removed)&offset=0&limit=100&q=Warbreaker',
            ['', '[v0.9.1000.0] System.Net.Http.HttpRequestException: Response status code does not indicate success: 503 (Service Unavailable).', '   at NzbDrone.Common.Http.HttpClient.ExecuteAsync(HttpRequest request)', '   at NzbDrone.Core.Indexers.HttpIndexerBase`1.FetchPage(IndexerRequest request, IParseIndexerResponse parser)']);
        }
        add(start + 3000000, 'Warn', 'BookInfoProxy', "[SERVER-BUG-CANDIDATE] V5 returned 2 books with provider id(s) appearing in multiple pockets: [az:B01EM0LH0U, az:B07DP8M4F2] for author 'Brandon Sanderson' (hcAuthor=hc:204214)");
      } else {
        for (const [n, title] of [[1, 'Brandon Sanderson 3-Book Boxed Set'], [2, 'Mistborn [Paperback]'], [3, 'The Way of Kings (Spanish Edition)']]) {
          add(start + n * 1200000, 'Warn', 'RefreshBookService', `Book [${8000 + n}][${title}] not found in metadata and is being deleted`);
        }
      }
      lines.sort((x, y) => x[0] - y[0]);
      out.push({ filename: k === 0 ? `${logName}.txt` : `${logName}.${k - 1}.txt`, lastWriteTime: iso(end), text: `${lines.map((l) => l[1]).join('\n')}\n` });
    }
    return out;
  };
  app.get('/api/v1/log/file', (req, res) => res.json(logFiles().map((f, i, all) => ({ id: all.length - i, filename: f.filename, lastWriteTime: f.lastWriteTime, contentsUrl: `/api/v1/log/file/${f.filename}`, downloadUrl: `/logfile/${f.filename}` }))));
  app.get('/api/v1/log/file/:filename', (req, res) => {
    const f = logFiles().find((x) => x.filename === req.params.filename);
    if (!f) return res.status(404).json({ message: 'NotFound' });
    res.type('text/plain').send(f.text);
  });

  // Commands finish on the second poll; a few change the library like the real app.
  const commands = new Map();
  let nextCmd = 900;
  const runCommand = (body) => {
    const name = String(body.name || '');
    if (name === 'ManualImport') {
      for (const f of body.files || []) {
        const b = books.find((x) => x.id === Number(f.bookId));
        const ext = String(f.path).split('.').pop().toLowerCase();
        const was = unmapped.find((u) => u.path === f.path);
        unmapped = unmapped.filter((u) => u.path !== f.path);
        if (!b) continue;
        const a = authors.find((x) => x.id === b.authorId);
        files.push({ id: nextFile++, bookId: b.id, authorId: b.authorId, mediaType: b.mediaType, path: `${(a && a[`${b.mediaType}Folder`]) || '/books'}/${b.title}/${String(f.path).split('/').pop()}`, size: (was && was.size) || 92274688, quality: f.quality || { quality: { id: 10, name: ext.toUpperCase() } }, dateAdded: iso(Date.now()) });
      }
      // As in Chaptarr, a download only counts as imported when its files went
      // to the book it was grabbed for; otherwise it stays in the queue.
      const done = new Set((body.files || []).filter((f) => {
        const q = f.downloadId && queue.find((x) => x.downloadId === f.downloadId);
        return q && (!q.bookId || q.bookId === Number(f.bookId));
      }).map((f) => f.downloadId));
      queue = queue.filter((q) => !done.has(q.downloadId));
    } else if (name === 'RenameFiles') {
      for (const id of body.files || []) {
        const f = files.find((x) => x.id === Number(id));
        const b = f && books.find((x) => x.id === f.bookId);
        const a = b && authors.find((x) => x.id === b.authorId);
        if (f && b && a) f.path = `${a[`${f.mediaType}Folder`] || a.path}/${b.title} (${new Date(b.releaseDate).getUTCFullYear()})/${String(f.path).split('/').pop()}`;
      }
    } else if (name === 'RetryUnmappedMatch') {
      const edge = books.find((b) => b.title === 'Edgedancer' && b.mediaType === 'audiobook');
      for (const u of unmapped.filter((x) => /Edgedancer/.test(x.path))) files.push({ ...u, bookId: edge.id, authorId: edge.authorId, importUnitKey: undefined, importUnitRoot: undefined });
      unmapped = unmapped.filter((x) => !/Edgedancer/.test(x.path));
    }
  };
  app.post('/api/v1/command', (req, res) => {
    const body = req.body || {};
    const cmd = { id: nextCmd++, name: body.name || 'Command', status: 'queued', body, polls: 0, queued: iso(Date.now()) };
    commands.set(cmd.id, cmd);
    res.status(201).json(cmd);
  });
  app.get('/api/v1/command/:id', (req, res) => {
    const cmd = commands.get(Number(req.params.id));
    if (!cmd) return res.json({ id: Number(req.params.id), status: 'completed', message: 'Completed' });
    cmd.polls++;
    if (cmd.polls >= 2 && cmd.status !== 'completed') { runCommand(cmd.body); cmd.status = 'completed'; cmd.message = 'Completed'; } else if (cmd.status === 'queued') cmd.status = 'started';
    res.json(cmd);
  });
  // Chaptarr's RemotePathMappingCheck: the download client's folder it can't see.
  app.get('/api/v1/health', (req, res) => {
    const unreachable = chaptarr ? SAB_ROOTS.filter((r) => !mappings.some((m) => m.host.toLowerCase() === 'sabnzbd' && r.startsWith(dirOf(m.remotePath)))) : [];
    res.json(unreachable.length ? [{
      source: 'RemotePathMappingCheck', type: 'error', wikiUrl: 'https://wiki.servarr.com/readarr/system#remote-path-mapping',
      message: `You are using docker; download client SABnzbd places downloads in ${unreachable[0].replace(/\/$/, '')} but this directory does not appear to exist inside the container. Review your remote path mappings and container volume settings.`,
    }] : []);
  });
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
    ['sonarr', makeSonarr({ ...primaryLibraryOptions, cleanupDemo: true }), MOCK_PORTS.sonarr],
    ['sonarr-anime', makeSonarr({ instanceName: 'Sonarr Anime (mock)', series: [
      { id: 1, title: 'Frieren: Beyond Journey\u2019s End', year: 2023, tvdbId: 424536, status: 'continuing', monitored: true, seasonCount: 1, network: 'Nippon TV', overview: 'A mage reflects on her journey after the hero party disbands.', path: '/anime/Frieren', rootFolderPath: '/anime', statistics: { episodeFileCount: 28, episodeCount: 28, percentOfEpisodes: 100, sizeOnDisk: 21474836480 }, images: [] },
      { id: 2, title: 'Attack on Titan', year: 2013, tvdbId: 267440, status: 'ended', monitored: true, seasonCount: 4, network: 'MBS', overview: 'Humanity fights for survival against man-eating titans.', path: '/anime/Attack on Titan', rootFolderPath: '/anime', statistics: { episodeFileCount: 85, episodeCount: 88, percentOfEpisodes: 96.6, sizeOnDisk: 96636764160 }, images: [] },
      { id: 3, title: 'Jujutsu Kaisen', year: 2020, tvdbId: 377543, status: 'continuing', monitored: false, seasonCount: 2, network: 'MBS', overview: 'A student joins a secret organization of sorcerers.', path: '/anime/Jujutsu Kaisen', rootFolderPath: '/anime', statistics: { episodeFileCount: 47, episodeCount: 47, percentOfEpisodes: 100, sizeOnDisk: 53687091200 }, images: [] },
    ] }), MOCK_PORTS.sonarrAnime],
    ['radarr', makeRadarr({ ...primaryLibraryOptions, cleanupDemo: true }), MOCK_PORTS.radarr],
    ['radarr-4k', makeRadarr({ instanceName: 'Radarr 4K (mock)', movies: [
      { id: 1, title: 'Blade Runner 2049', year: 2017, tmdbId: 335984, status: 'released', monitored: true, hasFile: true, runtime: 164, overview: 'A young blade runner uncovers a long-buried secret.', path: '/movies-4k/Blade Runner 2049 (2017)', rootFolderPath: '/movies-4k', sizeOnDisk: 64424509440, tags: [3], studio: 'Alcon', images: [] },
      { id: 2, title: 'Interstellar', year: 2014, tmdbId: 157336, status: 'released', monitored: true, hasFile: true, runtime: 169, overview: 'Explorers travel through a wormhole in search of a new home.', path: '/movies-4k/Interstellar (2014)', rootFolderPath: '/movies-4k', sizeOnDisk: 75161927680, studio: 'Paramount', images: [] },
      { id: 3, title: 'Top Gun: Maverick', year: 2022, tmdbId: 361743, status: 'released', monitored: false, hasFile: false, runtime: 130, overview: 'Maverick trains a detachment of Top Gun graduates.', path: '/movies-4k/Top Gun Maverick (2022)', rootFolderPath: '/movies-4k', sizeOnDisk: 0, studio: 'Paramount', images: [] },
    ] }), MOCK_PORTS.radarr4k],
    ['lidarr', makeLidarr(), MOCK_PORTS.lidarr],
    ['readarr', makeReadarr(), MOCK_PORTS.readarr],
    ['chaptarr', makeReadarr({ flavor: 'chaptarr' }), MOCK_PORTS.chaptarr],
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
