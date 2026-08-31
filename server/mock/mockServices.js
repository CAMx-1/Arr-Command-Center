// Bundled mock services that emulate the subset of Sonarr / Radarr / Overseerr /
// SABnzbd APIs the dashboard uses. Lets you run and test the whole app locally
// without any real services. Each mock REQUIRES the API key, which proves the
// proxy is correctly injecting auth end-to-end. Cloudflare Access headers are
// recorded on a /__debug endpoint so you can confirm header injection too.
import express from 'express';

export const MOCK_PORTS = {
  sonarr: 18989,
  sonarrAnime: 18990,
  radarr: 17878,
  radarr4k: 17879,
  overseerr: 15055,
  sabnzbd: 18080,
  tautulli: 18181,
  bazarr: 16767,
  qbittorrent: 18081,
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
function makeSonarr(opts = {}) {
  const app = express();
  app.use(express.json());
  let series = [
    { id: 1, title: 'Severance', year: 2022, tvdbId: 371980, status: 'continuing', monitored: true, seasonCount: 2, network: 'Apple TV+', overview: 'Employees at Lumon undergo a procedure that severs work and personal memories.', path: 'C:\\Media\\TV\\Severance', rootFolderPath: 'C:\\Media\\TV', statistics: { episodeFileCount: 18, episodeCount: 19, percentOfEpisodes: 94.7, sizeOnDisk: 40802189312 }, images: [] },
    { id: 2, title: 'The Bear', year: 2022, tvdbId: 388477, status: 'continuing', monitored: true, seasonCount: 3, network: 'FX', overview: 'A young chef returns to Chicago to run his family sandwich shop.', path: 'C:\\Media\\TV\\The Bear', rootFolderPath: 'C:\\Media\\TV', statistics: { episodeFileCount: 28, episodeCount: 28, percentOfEpisodes: 100, sizeOnDisk: 30064771072 }, images: [] },
    { id: 3, title: 'Foundation', year: 2021, tvdbId: 358711, status: 'continuing', monitored: false, seasonCount: 2, network: 'Apple TV+', overview: 'A band of exiles races to save humanity and rebuild civilization.', path: 'C:\\Media\\TV\\Foundation', rootFolderPath: 'C:\\Media\\TV', statistics: { episodeFileCount: 20, episodeCount: 20, percentOfEpisodes: 100, sizeOnDisk: 64424509440 }, images: [] },
    { id: 4, title: 'Severance', year: 2022, tvdbId: 371980, status: 'continuing', monitored: false, seasonCount: 2, network: 'Apple TV+', overview: 'Duplicate entry added on another drive.', path: 'C:\\Media\\TV2\\Severance', rootFolderPath: 'C:\\Media\\TV2', statistics: { episodeFileCount: 0, episodeCount: 19, percentOfEpisodes: 0, sizeOnDisk: 0 }, images: [] },
  ];
  if (opts.series) series = opts.series.map((s) => ({ ...s }));
  let queue = [
    { id: 101, title: 'Severance S02E10', seriesId: 1, status: 'downloading', trackedDownloadState: 'downloading', size: 2147483648, sizeleft: 536870912, timeleft: '00:04:12', estimatedCompletionTime: new Date(Date.now() + 252000).toISOString(), downloadClient: 'SABnzbd', indexer: 'NZBgeek' },
  ];

  app.use((req, res, next) => {
    recordCf('sonarr', req);
    if (req.headers['x-api-key'] !== 'MOCK_API_KEY') return res.status(401).json({ error: 'Unauthorized (missing X-Api-Key)' });
    next();
  });
  app.get('/__debug', (req, res) => res.json({ cf: cfSeen.sonarr || null }));
  app.get('/api/v3/system/status', (req, res) => res.json({ version: '4.0.10.2544', appName: 'Sonarr', instanceName: opts.instanceName || 'Sonarr (mock)' }));
  let rootFolders = [{ id: 1, path: 'C:\\Media\\TV', freeSpace: 0, accessible: false, unmappedFolders: [] }];
  app.get('/api/v3/rootfolder', (req, res) => res.json(rootFolders));
  app.post('/api/v3/rootfolder', (req, res) => { const rf = { id: rootFolders.length + 1, path: req.body.path, freeSpace: 500000000000, accessible: true, unmappedFolders: [] }; rootFolders.push(rf); res.status(201).json(rf); });
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
  app.get('/api/v3/health', (req, res) => res.json([
    { id: 1, type: 'warning', message: 'Indexers unavailable due to failures: NZBgeek', source: 'IndexerStatusCheck', wikiUrl: 'https://wiki.servarr.com/sonarr/system#indexers-are-unavailable-due-to-failures' },
  ]));
  app.put('/api/v3/series/editor', (req, res) => {
    const ids = (req.body && req.body.seriesIds) || [];
    for (const s of series) {
      if (!ids.includes(s.id)) continue;
      if (req.body.monitored !== undefined) s.monitored = req.body.monitored;
      if (req.body.rootFolderPath) { const root = String(req.body.rootFolderPath).replace(/[\\/]+$/, ''); s.rootFolderPath = req.body.rootFolderPath; s.path = `${root}/${s.title}`; }
    }
    res.json(series.filter((s) => ids.includes(s.id)));
  });
  app.delete('/api/v3/series/editor', (req, res) => { const ids = (req.body && req.body.seriesIds) || []; series = series.filter((s) => !ids.includes(s.id)); res.json({}); });
  app.put('/api/v3/series/:id', (req, res) => {
    const id = Number(req.params.id);
    const idx = series.findIndex((s) => s.id === id);
    if (idx === -1) return res.status(404).json({ error: 'not found' });
    series[idx] = { ...series[idx], ...req.body, id };
    res.json(series[idx]);
  });
  app.delete('/api/v3/series/:id', (req, res) => { series = series.filter((s) => s.id !== Number(req.params.id)); res.json({}); });
  app.get('/api/v3/wanted/missing', (req, res) => res.json({ page: 1, pageSize: 50, totalRecords: 2, records: [
    { id: 7001, seriesId: 1, seasonNumber: 2, episodeNumber: 10, title: 'Cold Harbor', airDateUtc: new Date(Date.now() - 86400000).toISOString(), series: { title: 'Severance' } },
    { id: 7002, seriesId: 2, seasonNumber: 3, episodeNumber: 5, title: 'Children', airDateUtc: new Date(Date.now() - 2 * 86400000).toISOString(), series: { title: 'The Bear' } },
  ] }));
  app.get('/api/v3/wanted/cutoff', (req, res) => res.json({ page: 1, pageSize: 50, totalRecords: 1, records: [
    { id: 7101, seriesId: 3, seasonNumber: 2, episodeNumber: 1, title: 'In Seldon\u2019s Shadow', airDateUtc: new Date(Date.now() - 5 * 86400000).toISOString(), series: { title: 'Foundation' } },
  ] }));
  return app;
}

// ---------------- Radarr ----------------
function makeRadarr(opts = {}) {
  const app = express();
  app.use(express.json());
  let movies = [
    { id: 1, title: 'Dune: Part Two', year: 2024, tmdbId: 693134, status: 'released', monitored: true, hasFile: true, runtime: 166, overview: 'Paul Atreides unites with the Fremen to wage war against House Harkonnen.', path: 'C:\\Media\\Movies\\Dune Part Two (2024)', rootFolderPath: 'C:\\Media\\Movies', sizeOnDisk: 32212254720, studio: 'Legendary', images: [] },
    { id: 2, title: 'Oppenheimer', year: 2023, tmdbId: 872585, status: 'released', monitored: true, hasFile: true, runtime: 180, overview: 'The story of J. Robert Oppenheimer and the atomic bomb.', path: 'C:\\Media\\Movies2\\Oppenheimer (2023)', rootFolderPath: 'C:\\Media\\Movies2', sizeOnDisk: 27917287424, studio: 'Universal', images: [] },
    { id: 3, title: 'Furiosa', year: 2024, tmdbId: 786892, status: 'released', monitored: true, hasFile: false, runtime: 148, overview: 'The origin story of Furiosa before Mad Max: Fury Road.', path: 'C:\\Media\\Movies3\\Furiosa (2024)', rootFolderPath: 'C:\\Media\\Movies3', sizeOnDisk: 0, studio: 'Warner Bros', images: [] },
    { id: 4, title: 'Dune: Part Two', year: 2024, tmdbId: 693134, status: 'released', monitored: false, hasFile: false, runtime: 166, overview: 'Duplicate entry added on another drive.', path: 'C:\\Media\\Movies2\\Dune Part Two (2024)', rootFolderPath: 'C:\\Media\\Movies2', sizeOnDisk: 0, studio: 'Legendary', images: [] },
    { id: 5, title: '1917', year: 2019, tmdbId: 530915, status: 'released', monitored: true, hasFile: true, runtime: 119, overview: 'Two soldiers race against time to deliver a message.', path: 'C:\\Media\\Movies\\1917 (2019)', rootFolderPath: 'C:\\Media\\Movies', sizeOnDisk: 8589934592, studio: 'DreamWorks', images: [] },
  ];
  if (opts.movies) movies = opts.movies.map((m) => ({ ...m }));
  let queue = [
    { id: 201, title: 'Furiosa 2024 2160p', movieId: 3, status: 'downloading', trackedDownloadState: 'downloading', size: 21474836480, sizeleft: 6442450944, timeleft: '00:11:38', downloadClient: 'SABnzbd', indexer: 'DrunkenSlug' },
  ];

  app.use((req, res, next) => {
    recordCf('radarr', req);
    if (req.headers['x-api-key'] !== 'MOCK_API_KEY') return res.status(401).json({ error: 'Unauthorized (missing X-Api-Key)' });
    next();
  });
  app.get('/__debug', (req, res) => res.json({ cf: cfSeen.radarr || null }));
  app.get('/api/v3/system/status', (req, res) => res.json({ version: '5.11.0.9244', appName: 'Radarr', instanceName: opts.instanceName || 'Radarr (mock)' }));
  let rootFolders = [
    { id: 1, path: 'C:\\Media\\Movies', freeSpace: 0, accessible: false, unmappedFolders: [] },
    { id: 2, path: 'C:\\Media\\Movies2', freeSpace: 0, accessible: false, unmappedFolders: [{ name: '1917.2019.PROPER.1080p.BluRay.x265', path: 'C:\\Media\\Movies2\\1917.2019.PROPER.1080p.BluRay.x265', relativePath: '1917.2019.PROPER.1080p.BluRay.x265' }] },
    { id: 3, path: 'C:\\Media\\Movies3', freeSpace: 0, accessible: false, unmappedFolders: [] },
  ];
  app.get('/api/v3/rootfolder', (req, res) => res.json(rootFolders));
  app.post('/api/v3/rootfolder', (req, res) => { const rf = { id: rootFolders.length + 1, path: req.body.path, freeSpace: 900000000000, accessible: true, unmappedFolders: [] }; rootFolders.push(rf); res.status(201).json(rf); });
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
  app.get('/api/v3/health', (req, res) => res.json([]));
  app.put('/api/v3/movie/editor', (req, res) => {
    const ids = (req.body && req.body.movieIds) || [];
    for (const m of movies) {
      if (!ids.includes(m.id)) continue;
      if (req.body.monitored !== undefined) m.monitored = req.body.monitored;
      if (req.body.rootFolderPath) { const root = String(req.body.rootFolderPath).replace(/[\\/]+$/, ''); m.rootFolderPath = req.body.rootFolderPath; m.path = `${root}/${m.title} (${m.year})`; }
    }
    res.json(movies.filter((m) => ids.includes(m.id)));
  });
  app.delete('/api/v3/movie/editor', (req, res) => { const ids = (req.body && req.body.movieIds) || []; movies = movies.filter((m) => !ids.includes(m.id)); res.json({}); });
  app.put('/api/v3/movie/:id', (req, res) => {
    const id = Number(req.params.id);
    const idx = movies.findIndex((m) => m.id === id);
    if (idx === -1) return res.status(404).json({ error: 'not found' });
    movies[idx] = { ...movies[idx], ...req.body, id };
    res.json(movies[idx]);
  });
  app.delete('/api/v3/movie/:id', (req, res) => { movies = movies.filter((m) => m.id !== Number(req.params.id)); res.json({}); });
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

// ---------------- Bazarr (subtitle manager) ----------------
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

  app.get('/api/series', (req, res) => res.json({ data: series, total: series.length }));
  app.get('/api/movies', (req, res) => res.json({ data: movies, total: movies.length }));

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
  // Search subtitles for a wanted episode -> "download" it (move to history).
  app.patch('/api/episodes', (req, res) => {
    const epId = Number(req.query.episodeid || (req.body && req.body.episodeid));
    const item = wantedEpisodes.find((w) => w.sonarrEpisodeId === epId);
    if (item) {
      const lang = item.missing_subtitles[0] || L.en;
      wantedEpisodes = wantedEpisodes.filter((w) => w.sonarrEpisodeId !== epId);
      const s = series.find((x) => x.sonarrSeriesId === item.sonarrSeriesId);
      if (s && s.episodeMissingCount > 0) s.episodeMissingCount -= 1;
      seriesHistory.unshift({ action: 2, timestamp: new Date().toISOString(), description: `${lang.name} subtitles manually downloaded from OpenSubtitles.com with a score of 100%.`, language: lang, provider: 'opensubtitlescom', score: '100%', seriesTitle: item.seriesTitle, episode_number: item.episode_number, episodeTitle: item.episodeTitle, sonarrSeriesId: item.sonarrSeriesId, sonarrEpisodeId: epId });
    }
    res.json({});
  });
  // Search subtitles for a wanted movie -> "download" it.
  app.patch('/api/movies', (req, res) => {
    const rid = Number(req.query.radarrid || (req.body && req.body.radarrid));
    const item = wantedMovies.find((w) => w.radarrId === rid);
    if (item) {
      const lang = item.missing_subtitles[0] || L.en;
      wantedMovies = wantedMovies.filter((w) => w.radarrId !== rid);
      const m = movies.find((x) => x.radarrId === rid);
      if (m) { m.subtitles = [...(m.subtitles || []), have(lang.code2, `${m.path}/subtitle.${lang.code2}.srt`)]; m.missing_subtitles = (m.missing_subtitles || []).filter((s) => s.code2 !== lang.code2); }
      movieHistory.unshift({ action: 2, timestamp: new Date().toISOString(), description: `${lang.name} subtitles manually downloaded from OpenSubtitles.com with a score of 100%.`, language: lang, provider: 'opensubtitlescom', score: '100%', title: item.title, radarrId: rid });
    }
    res.json({});
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
    res.json(list);
  });
  const applyHashes = (req, fn) => {
    const hashes = String((req.body && req.body.hashes) || req.query.hashes || '');
    const set = hashes === 'all' ? torrents.map((t) => t.hash) : hashes.split('|');
    for (const t of torrents) if (set.includes(t.hash)) fn(t);
  };
  app.post('/api/v2/torrents/pause', (req, res) => { applyHashes(req, (t) => { t.state = t.progress >= 1 ? 'pausedUP' : 'pausedDL'; t.dlspeed = 0; t.upspeed = 0; }); res.send(''); });
  app.post('/api/v2/torrents/resume', (req, res) => { applyHashes(req, (t) => { t.state = t.progress >= 1 ? 'uploading' : 'downloading'; if (t.progress < 1) t.dlspeed = 8000000; }); res.send(''); });
  app.post('/api/v2/torrents/delete', (req, res) => { const hashes = String((req.body && req.body.hashes) || ''); const set = hashes === 'all' ? torrents.map((t) => t.hash) : hashes.split('|'); torrents = torrents.filter((t) => !set.includes(t.hash)); res.send(''); });
  app.post('/api/v2/torrents/recheck', (req, res) => res.send(''));
  return app;
}

export function startMockServices() {
  const defs = [
    ['sonarr', makeSonarr(), MOCK_PORTS.sonarr],
    ['sonarr-anime', makeSonarr({ instanceName: 'Sonarr Anime (mock)', series: [
      { id: 1, title: 'Frieren: Beyond Journey\u2019s End', year: 2023, tvdbId: 424536, status: 'continuing', monitored: true, seasonCount: 1, network: 'Nippon TV', overview: 'A mage reflects on her journey after the hero party disbands.', path: '/anime/Frieren', rootFolderPath: '/anime', statistics: { episodeFileCount: 28, episodeCount: 28, percentOfEpisodes: 100, sizeOnDisk: 21474836480 }, images: [] },
      { id: 2, title: 'Attack on Titan', year: 2013, tvdbId: 267440, status: 'ended', monitored: true, seasonCount: 4, network: 'MBS', overview: 'Humanity fights for survival against man-eating titans.', path: '/anime/Attack on Titan', rootFolderPath: '/anime', statistics: { episodeFileCount: 85, episodeCount: 88, percentOfEpisodes: 96.6, sizeOnDisk: 96636764160 }, images: [] },
      { id: 3, title: 'Jujutsu Kaisen', year: 2020, tvdbId: 377543, status: 'continuing', monitored: false, seasonCount: 2, network: 'MBS', overview: 'A student joins a secret organization of sorcerers.', path: '/anime/Jujutsu Kaisen', rootFolderPath: '/anime', statistics: { episodeFileCount: 47, episodeCount: 47, percentOfEpisodes: 100, sizeOnDisk: 53687091200 }, images: [] },
    ] }), MOCK_PORTS.sonarrAnime],
    ['radarr', makeRadarr(), MOCK_PORTS.radarr],
    ['radarr-4k', makeRadarr({ instanceName: 'Radarr 4K (mock)', movies: [
      { id: 1, title: 'Blade Runner 2049', year: 2017, tmdbId: 335984, status: 'released', monitored: true, hasFile: true, runtime: 164, overview: 'A young blade runner uncovers a long-buried secret.', path: '/movies-4k/Blade Runner 2049 (2017)', rootFolderPath: '/movies-4k', sizeOnDisk: 64424509440, studio: 'Alcon', images: [] },
      { id: 2, title: 'Interstellar', year: 2014, tmdbId: 157336, status: 'released', monitored: true, hasFile: true, runtime: 169, overview: 'Explorers travel through a wormhole in search of a new home.', path: '/movies-4k/Interstellar (2014)', rootFolderPath: '/movies-4k', sizeOnDisk: 75161927680, studio: 'Paramount', images: [] },
      { id: 3, title: 'Top Gun: Maverick', year: 2022, tmdbId: 361743, status: 'released', monitored: false, hasFile: false, runtime: 130, overview: 'Maverick trains a detachment of Top Gun graduates.', path: '/movies-4k/Top Gun Maverick (2022)', rootFolderPath: '/movies-4k', sizeOnDisk: 0, studio: 'Paramount', images: [] },
    ] }), MOCK_PORTS.radarr4k],
    ['overseerr', makeOverseerr(), MOCK_PORTS.overseerr],
    ['sabnzbd', makeSab(), MOCK_PORTS.sabnzbd],
    ['tautulli', makeTautulli(), MOCK_PORTS.tautulli],
    ['bazarr', makeBazarr(), MOCK_PORTS.bazarr],
    ['qbittorrent', makeQbittorrent(), MOCK_PORTS.qbittorrent],
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
