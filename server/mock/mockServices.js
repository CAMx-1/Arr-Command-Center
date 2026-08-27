// Bundled mock services that emulate the subset of Sonarr / Radarr / Overseerr /
// SABnzbd APIs the dashboard uses. Lets you run and test the whole app locally
// without any real services. Each mock REQUIRES the API key, which proves the
// proxy is correctly injecting auth end-to-end. Cloudflare Access headers are
// recorded on a /__debug endpoint so you can confirm header injection too.
import express from 'express';

export const MOCK_PORTS = {
  sonarr: 18989,
  radarr: 17878,
  overseerr: 15055,
  sabnzbd: 18080,
  tautulli: 18181,
};

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

// ---------------- Sonarr ----------------
function makeSonarr() {
  const app = express();
  app.use(express.json());
  let series = [
    { id: 1, title: 'Severance', year: 2022, status: 'continuing', monitored: true, seasonCount: 2, network: 'Apple TV+', overview: 'Employees at Lumon undergo a procedure that severs work and personal memories.', statistics: { episodeFileCount: 18, episodeCount: 19, percentOfEpisodes: 94.7, sizeOnDisk: 40802189312 }, images: [] },
    { id: 2, title: 'The Bear', year: 2022, status: 'continuing', monitored: true, seasonCount: 3, network: 'FX', overview: 'A young chef returns to Chicago to run his family sandwich shop.', statistics: { episodeFileCount: 28, episodeCount: 28, percentOfEpisodes: 100, sizeOnDisk: 30064771072 }, images: [] },
    { id: 3, title: 'Foundation', year: 2021, status: 'continuing', monitored: false, seasonCount: 2, network: 'Apple TV+', overview: 'A band of exiles races to save humanity and rebuild civilization.', statistics: { episodeFileCount: 20, episodeCount: 20, percentOfEpisodes: 100, sizeOnDisk: 64424509440 }, images: [] },
  ];
  let queue = [
    { id: 101, title: 'Severance S02E10', seriesId: 1, status: 'downloading', trackedDownloadState: 'downloading', size: 2147483648, sizeleft: 536870912, timeleft: '00:04:12', estimatedCompletionTime: new Date(Date.now() + 252000).toISOString(), downloadClient: 'SABnzbd', indexer: 'NZBgeek' },
  ];

  app.use((req, res, next) => {
    recordCf('sonarr', req);
    if (req.headers['x-api-key'] !== 'MOCK_API_KEY') return res.status(401).json({ error: 'Unauthorized (missing X-Api-Key)' });
    next();
  });
  app.get('/__debug', (req, res) => res.json({ cf: cfSeen.sonarr || null }));
  app.get('/api/v3/system/status', (req, res) => res.json({ version: '4.0.10.2544', appName: 'Sonarr', instanceName: 'Sonarr (mock)' }));
  app.get('/api/v3/rootfolder', (req, res) => res.json([{ id: 1, path: '/tv', freeSpace: 824633720832, accessible: true }]));
  app.get('/api/v3/qualityprofile', (req, res) => res.json([{ id: 1, name: 'HD-1080p' }, { id: 2, name: 'Ultra-HD' }, { id: 3, name: 'Any' }]));
  app.get('/api/v3/series', (req, res) => res.json(series));
  app.get('/api/v3/queue', (req, res) => res.json({ page: 1, pageSize: 20, totalRecords: queue.length, records: queue }));
  app.delete('/api/v3/queue/:id', (req, res) => { queue = queue.filter(q => q.id !== Number(req.params.id)); res.json({}); });
  app.get('/api/v3/calendar', (req, res) => {
    const now = Date.now();
    res.json([
      { id: 9001, seriesId: 1, title: 'Cold Harbor', seasonNumber: 2, episodeNumber: 10, airDateUtc: new Date(now + 86400000).toISOString(), hasFile: false, monitored: true, series: { title: 'Severance' } },
      { id: 9002, seriesId: 2, title: 'Next', seasonNumber: 3, episodeNumber: 1, airDateUtc: new Date(now + 3 * 86400000).toISOString(), hasFile: false, monitored: true, series: { title: 'The Bear' } },
    ]);
  });
  app.get('/api/v3/series/lookup', (req, res) => {
    const term = (req.query.term || '').toString();
    res.json([
      { title: `${term || 'Andor'}`, year: 2022, tvdbId: 371980, status: 'continuing', overview: 'A drama set in the Star Wars universe.', network: 'Disney+', images: [], seasons: [] },
      { title: `${term || 'Andor'} (Documentary)`, year: 2023, tvdbId: 999001, status: 'ended', overview: 'Behind the scenes.', network: 'Disney+', images: [], seasons: [] },
    ]);
  });
  app.post('/api/v3/series', (req, res) => { const s = { id: series.length + 1, ...req.body, statistics: { episodeFileCount: 0, episodeCount: 0, percentOfEpisodes: 0, sizeOnDisk: 0 } }; series.push(s); res.status(201).json(s); });
  app.get('/api/v3/history', (req, res) => res.json({ page: 1, pageSize: 40, totalRecords: 3, records: [
    { id: 1, eventType: 'downloadFolderImported', sourceTitle: 'Severance.S02E10.1080p.WEB-DL', date: new Date(Date.now() - 3600000).toISOString(), quality: { quality: { name: 'WEBDL-1080p' } }, series: { title: 'Severance' }, episode: { seasonNumber: 2, episodeNumber: 10 } },
    { id: 2, eventType: 'downloadFailed', sourceTitle: 'The.Bear.S03E05.1080p', date: new Date(Date.now() - 9000000).toISOString(), quality: { quality: { name: 'WEBDL-1080p' } }, series: { title: 'The Bear' }, episode: { seasonNumber: 3, episodeNumber: 5 } },
    { id: 3, eventType: 'grabbed', sourceTitle: 'Foundation.S02E01.2160p', date: new Date(Date.now() - 18000000).toISOString(), quality: { quality: { name: 'WEBDL-2160p' } }, series: { title: 'Foundation' }, episode: { seasonNumber: 2, episodeNumber: 1 } },
  ] }));
  app.post('/api/v3/command', (req, res) => res.status(201).json({ id: Math.floor(Math.random() * 1000), name: req.body.name, status: 'queued' }));
  app.get('/api/v3/episode', (req, res) => {
    const season = Number(req.query.seasonNumber) || 1;
    res.json(Array.from({ length: 8 }, (_, i) => ({ id: 5000 + season * 100 + i + 1, seriesId: Number(req.query.seriesId) || 1, seasonNumber: season, episodeNumber: i + 1, title: `Episode ${i + 1}`, airDateUtc: new Date(Date.now() - (8 - i) * 86400000).toISOString(), hasFile: i % 3 !== 0, monitored: true })));
  });
  app.get('/api/v3/release', (req, res) => res.json(mockReleases('Severance')));
  app.post('/api/v3/release', (req, res) => res.status(201).json({ guid: req.body.guid, approved: true }));
  return app;
}

// ---------------- Radarr ----------------
function makeRadarr() {
  const app = express();
  app.use(express.json());
  let movies = [
    { id: 1, title: 'Dune: Part Two', year: 2024, status: 'released', monitored: true, hasFile: true, runtime: 166, overview: 'Paul Atreides unites with the Fremen to wage war against House Harkonnen.', sizeOnDisk: 32212254720, studio: 'Legendary', images: [] },
    { id: 2, title: 'Oppenheimer', year: 2023, status: 'released', monitored: true, hasFile: true, runtime: 180, overview: 'The story of J. Robert Oppenheimer and the atomic bomb.', sizeOnDisk: 27917287424, studio: 'Universal', images: [] },
    { id: 3, title: 'Furiosa', year: 2024, status: 'released', monitored: true, hasFile: false, runtime: 148, overview: 'The origin story of Furiosa before Mad Max: Fury Road.', sizeOnDisk: 0, studio: 'Warner Bros', images: [] },
  ];
  let queue = [
    { id: 201, title: 'Furiosa 2024 2160p', movieId: 3, status: 'downloading', trackedDownloadState: 'downloading', size: 21474836480, sizeleft: 6442450944, timeleft: '00:11:38', downloadClient: 'SABnzbd', indexer: 'DrunkenSlug' },
  ];

  app.use((req, res, next) => {
    recordCf('radarr', req);
    if (req.headers['x-api-key'] !== 'MOCK_API_KEY') return res.status(401).json({ error: 'Unauthorized (missing X-Api-Key)' });
    next();
  });
  app.get('/__debug', (req, res) => res.json({ cf: cfSeen.radarr || null }));
  app.get('/api/v3/system/status', (req, res) => res.json({ version: '5.11.0.9244', appName: 'Radarr', instanceName: 'Radarr (mock)' }));
  app.get('/api/v3/rootfolder', (req, res) => res.json([{ id: 1, path: '/movies', freeSpace: 1099511627776, accessible: true }]));
  app.get('/api/v3/qualityprofile', (req, res) => res.json([{ id: 1, name: 'HD-1080p' }, { id: 2, name: 'Ultra-HD' }, { id: 3, name: 'Any' }]));
  app.get('/api/v3/movie', (req, res) => res.json(movies));
  app.get('/api/v3/calendar', (req, res) => res.json([
    { id: 1, title: 'Furiosa', year: 2024, digitalRelease: new Date(Date.now() + 5 * 86400000).toISOString(), hasFile: false, images: [] },
    { id: 2, title: 'Gladiator II', year: 2024, inCinemas: new Date(Date.now() + 15 * 86400000).toISOString(), hasFile: false, images: [] },
    { id: 3, title: 'Nosferatu', year: 2024, physicalRelease: new Date(Date.now() + 25 * 86400000).toISOString(), hasFile: false, images: [] },
  ]));
  app.get('/api/v3/history', (req, res) => res.json({ page: 1, pageSize: 40, totalRecords: 2, records: [
    { id: 1, eventType: 'downloadFolderImported', sourceTitle: 'Dune.Part.Two.2024.2160p.WEB-DL', date: new Date(Date.now() - 3600000).toISOString(), quality: { quality: { name: 'WEBDL-2160p' } }, movie: { title: 'Dune: Part Two' } },
    { id: 2, eventType: 'downloadFailed', sourceTitle: 'Furiosa.2024.1080p.WEBRip', date: new Date(Date.now() - 10800000).toISOString(), quality: { quality: { name: 'WEBRip-1080p' } }, movie: { title: 'Furiosa' } },
  ] }));
  app.get('/api/v3/queue', (req, res) => res.json({ page: 1, pageSize: 20, totalRecords: queue.length, records: queue }));
  app.delete('/api/v3/queue/:id', (req, res) => { queue = queue.filter(q => q.id !== Number(req.params.id)); res.json({}); });
  app.get('/api/v3/movie/lookup', (req, res) => {
    const term = (req.query.term || '').toString();
    res.json([
      { title: `${term || 'Gladiator II'}`, year: 2024, tmdbId: 558449, status: 'released', overview: 'Years after Maximus, Lucius must fight for Rome.', studio: 'Paramount', images: [] },
      { title: `${term || 'Gladiator'}`, year: 2000, tmdbId: 98, status: 'released', overview: 'A betrayed Roman general seeks revenge.', studio: 'DreamWorks', images: [] },
    ]);
  });
  app.post('/api/v3/movie', (req, res) => { const m = { id: movies.length + 1, ...req.body, hasFile: false, sizeOnDisk: 0 }; movies.push(m); res.status(201).json(m); });
  app.get('/api/v3/release', (req, res) => res.json(mockReleases('Furiosa')));
  app.post('/api/v3/release', (req, res) => res.status(201).json({ guid: req.body.guid, approved: true }));
  app.post('/api/v3/command', (req, res) => res.status(201).json({ id: Math.floor(Math.random() * 1000), name: req.body.name, status: 'queued' }));
  return app;
}

// ---------------- Overseerr ----------------
function makeOverseerr() {
  const app = express();
  app.use(express.json());
  let requests = [
    { id: 11, status: 1, type: 'movie', createdAt: new Date(Date.now() - 3600000).toISOString(), media: { tmdbId: 533535, status: 3, title: 'Deadpool & Wolverine', mediaType: 'movie' }, requestedBy: { displayName: 'cameron', email: 'cameron@example.com' } },
    { id: 12, status: 1, type: 'tv', createdAt: new Date(Date.now() - 7200000).toISOString(), media: { tmdbId: 94997, status: 2, title: 'House of the Dragon', mediaType: 'tv' }, requestedBy: { displayName: 'guest', email: 'guest@example.com' } },
    { id: 13, status: 2, type: 'movie', createdAt: new Date(Date.now() - 172800000).toISOString(), media: { tmdbId: 786892, status: 5, title: 'Furiosa', mediaType: 'movie' }, requestedBy: { displayName: 'cameron', email: 'cameron@example.com' } },
  ];

  app.use((req, res, next) => {
    recordCf('overseerr', req);
    if (req.headers['x-api-key'] !== 'MOCK_API_KEY') return res.status(401).json({ error: 'Unauthorized (missing X-Api-Key)' });
    next();
  });
  app.get('/__debug', (req, res) => res.json({ cf: cfSeen.overseerr || null }));
  app.get('/api/v1/status', (req, res) => res.json({ version: '1.33.2', commitTag: 'mock', updateAvailable: false }));
  const mockCast = [
    { id: 1, name: 'Jane Doe', character: 'Lead Role', profilePath: null, order: 0 },
    { id: 2, name: 'John Smith', character: 'Supporting Role', profilePath: null, order: 1 },
    { id: 3, name: 'Alex Rivera', character: 'Antagonist', profilePath: null, order: 2 },
    { id: 4, name: 'Sam Chen', character: 'Sidekick', profilePath: null, order: 3 },
  ];
  app.get('/api/v1/movie/:id', (req, res) => res.json({
    id: Number(req.params.id), title: 'Mock Movie', overview: 'A thrilling mock movie used to demonstrate the details popout with description, ratings, genres and cast.',
    voteAverage: 7.8, voteCount: 4213, genres: [{ name: 'Action' }, { name: 'Sci-Fi' }], runtime: 132, releaseDate: '2024-05-01',
    tagline: 'Every demo has its hero.', status: 'Released', posterPath: null, backdropPath: null, credits: { cast: mockCast },
  }));
  app.get('/api/v1/tv/:id', (req, res) => res.json({
    id: Number(req.params.id), name: 'Mock Show', overview: 'A gripping mock series used to demonstrate the details popout including seasons and cast.',
    voteAverage: 8.4, voteCount: 2890, genres: [{ name: 'Drama' }, { name: 'Mystery' }], episodeRunTime: [50], firstAirDate: '2023-09-10',
    tagline: 'Binge responsibly.', status: 'Returning Series', posterPath: null, backdropPath: null,
    seasons: [{ seasonNumber: 1, name: 'Season 1', episodeCount: 8 }, { seasonNumber: 2, name: 'Season 2', episodeCount: 10 }],
    mediaInfo: { status: 4, seasons: [{ seasonNumber: 1, status: 5 }] },
    credits: { cast: mockCast },
  }));
  app.get('/api/v1/request', (req, res) => {
    const filter = req.query.filter;
    let results = requests;
    if (filter === 'pending') results = requests.filter(r => r.status === 1);
    res.json({ pageInfo: { pages: 1, pageSize: 20, results: results.length, page: 1 }, results });
  });
  app.get('/api/v1/request/count', (req, res) => res.json({ total: requests.length, pending: requests.filter(r => r.status === 1).length, approved: requests.filter(r => r.status === 2).length, declined: requests.filter(r => r.status === 3).length }));
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
  app.get('/api/v1/search', (req, res) => {
    const q = (req.query.query || '').toString();
    res.json({ page: 1, totalPages: 1, totalResults: 2, results: [
      { id: 1184918, mediaType: 'movie', title: q || 'The Wild Robot', overview: 'A robot learns to survive in the wilderness.', releaseDate: '2024-09-12', voteAverage: 8.3, posterPath: null },
      { id: 94605, mediaType: 'tv', name: q || 'Arcane', overview: 'The origins of two iconic League champions.', firstAirDate: '2021-11-06', voteAverage: 8.7, posterPath: null },
    ] });
  });
  app.post('/api/v1/request', (req, res) => { const nr = { id: 100 + requests.length, status: 1, type: req.body.mediaType, createdAt: new Date().toISOString(), media: { tmdbId: req.body.mediaId, status: 2, mediaType: req.body.mediaType }, requestedBy: { displayName: 'you' } }; requests.push(nr); res.status(201).json(nr); });
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
    { nzo_id: 'SABnzbd_nzo_h1', name: 'Dune.Part.Two.2024.2160p', status: 'Completed', category: 'movies', size: '30.0 GB', bytes: 32212254720, completed: Math.floor((Date.now() - 3600000) / 1000), download_time: 842, storage: '/data/movies' },
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
    if (cmd === 'get_activity') {
      const total = sessions.reduce((a, s) => a + Number(s.bandwidth), 0);
      return res.json(wrap({ stream_count: String(sessions.length), stream_count_direct_play: 1, stream_count_transcode: 1, total_bandwidth: total, wan_bandwidth: total, sessions }));
    }
    if (cmd === 'terminate_session') {
      const id = req.query.session_id, key = req.query.session_key;
      sessions = sessions.filter((s) => s.session_id !== id && s.session_key !== key);
      return res.json(wrap({}));
    }
    if (cmd === 'get_history') {
      return res.json(wrap({ recordsFiltered: 2, recordsTotal: 2, data: [
        { full_title: 'Oppenheimer', user: 'cameron', player: 'Apple TV', media_type: 'movie', thumb: '/library/metadata/10/thumb/10', date: Math.floor((Date.now() - 3600000) / 1000), watched_status: 1, percent_complete: 100, duration: 10800 },
        { full_title: 'Severance - S02E01', user: 'guest', player: 'Chrome', media_type: 'episode', grandparent_thumb: '/library/metadata/11/thumb/11', date: Math.floor((Date.now() - 86400000) / 1000), watched_status: 1, percent_complete: 96, duration: 3600 },
      ] }));
    }
    if (cmd === 'get_home_stats') {
      return res.json(wrap([
        { stat_id: 'top_movies', stat_title: 'Most Watched Movies', rows: [{ title: 'Dune: Part Two', total_plays: 12 }, { title: 'Oppenheimer', total_plays: 9 }] },
        { stat_id: 'top_tv', stat_title: 'Most Watched Shows', rows: [{ title: 'The Bear', total_plays: 22 }, { title: 'Severance', total_plays: 18 }] },
        { stat_id: 'top_users', stat_title: 'Most Active Users', rows: [{ friendly_name: 'cameron', total_plays: 40 }, { friendly_name: 'guest', total_plays: 11 }] },
        { stat_id: 'top_platforms', stat_title: 'Most Active Platforms', rows: [{ platform: 'Apple TV', total_plays: 25 }, { platform: 'Chrome', total_plays: 26 }] },
      ]));
    }
    return res.json(wrap({}));
  });
  return app;
}

export function startMockServices() {
  const defs = [
    ['sonarr', makeSonarr(), MOCK_PORTS.sonarr],
    ['radarr', makeRadarr(), MOCK_PORTS.radarr],
    ['overseerr', makeOverseerr(), MOCK_PORTS.overseerr],
    ['sabnzbd', makeSab(), MOCK_PORTS.sabnzbd],
    ['tautulli', makeTautulli(), MOCK_PORTS.tautulli],
  ];
  const servers = [];
  for (const [name, app, port] of defs) {
    const server = app.listen(port, '127.0.0.1', () => {
      console.log(`  [mock] ${name} listening on http://127.0.0.1:${port}`);
    });
    servers.push(server);
  }
  return servers;
}
