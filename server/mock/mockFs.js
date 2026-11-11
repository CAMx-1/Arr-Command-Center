// A small virtual filesystem for the Sonarr/Radarr mocks, so the Fix paths
// tool can be exercised end to end: folder listings (/api/v3/filesystem),
// disk space, and root folders whose "accessible" flag and unmapped folders
// come from the tree. Behaviour follows Sonarr/Radarr's FileSystemController:
// a path ending in a separator lists that folder; anything else lists its
// parent; a folder that doesn't exist returns no directories.

const norm = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '') || '/';

export function createMockFs(tree, { disks = [] } = {}) {
  // tree: { 'Volumes': { 'Media': { 'TV': { 'Severance': {}, ... } } } }
  const lookup = (path) => {
    const parts = norm(path).split('/').filter(Boolean);
    let node = tree;
    for (const part of parts) {
      if (!node || typeof node !== 'object') return null;
      const key = Object.keys(node).find((k) => k === part);
      if (key === undefined) return null;
      node = node[key];
    }
    return node;
  };
  const isWinPath = (p) => /^[A-Za-z]:|\\/.test(String(p || ''));
  const exists = (path) => !isWinPath(path) && !!lookup(path);
  const children = (path) => {
    if (isWinPath(path)) return null;
    const node = lookup(path);
    if (!node || typeof node !== 'object') return null;
    const base = norm(path) === '/' ? '' : norm(path);
    return Object.keys(node).sort().map((name) => ({ type: node[name] && node[name].__file ? 'file' : 'folder', name, path: `${base}/${name}${node[name] && node[name].__file ? '' : '/'}` }));
  };
  const mkdirp = (path) => {
    let node = tree;
    for (const part of norm(path).split('/').filter(Boolean)) node = node[part] = node[part] || {};
  };
  const remove = (path) => {
    const parts = norm(path).split('/').filter(Boolean);
    const name = parts.pop();
    const parent = lookup(`/${parts.join('/')}`);
    if (parent && typeof parent === 'object') delete parent[name];
  };
  const addFile = (path) => {
    const parts = norm(path).split('/').filter(Boolean);
    const name = parts.pop();
    mkdirp(`/${parts.join('/')}`);
    lookup(`/${parts.join('/')}`)[name] = { __file: true };
  };

  function mount(app, { getItems, rootFolders, prefix = '/api/v3' }) {
    app.get(`${prefix}/filesystem`, (req, res) => {
      const q = String(req.query.path || '');
      const dir = q === '' ? '/' : /[\\/]$/.test(q) ? q : q.slice(0, Math.max(q.lastIndexOf('/'), q.lastIndexOf('\\')) + 1);
      const parentOf = (p) => { const n = norm(p); if (n === '/') return null; const up = n.slice(0, n.lastIndexOf('/')); return up ? `${up}/` : '/'; };
      const list = dir ? children(dir) : null;
      if (!list) return res.json({ parent: dir ? parentOf(dir) : null, directories: [], files: [] });
      res.json({
        parent: parentOf(dir),
        directories: list.filter((c) => c.type === 'folder').map((c) => ({ type: 'folder', name: c.name, path: c.path, size: 0, lastModified: new Date(0).toISOString() })),
        files: req.query.includeFiles === 'true' ? list.filter((c) => c.type === 'file').map((c) => ({ type: 'file', name: c.name, path: c.path })) : [],
      });
    });
    app.get(`${prefix}/filesystem/type`, (req, res) => res.json({ type: 'folder' })); // same as Sonarr: never reveals existence
    // Video files anywhere below a folder (Sonarr/Radarr scan recursively).
    app.get(`${prefix}/filesystem/mediafiles`, (req, res) => {
      const out = [];
      const walk = (dir) => { for (const c of children(dir) || []) { if (c.type === 'file') { if (/\.(mkv|mp4|avi|m4v|ts)$/i.test(c.name)) out.push({ path: c.path, relativePath: c.name, name: c.name }); } else walk(c.path); } };
      walk(String(req.query.path || ''));
      res.json(out);
    });
    app.get(`${prefix}/diskspace`, (req, res) => res.json(disks));
    const rootView = (r) => {
      const accessible = exists(r.path);
      const used = new Set(getItems().map((it) => norm(it.path).toLowerCase()));
      const unmapped = accessible ? (children(r.path) || []).filter((c) => c.type === 'folder' && !used.has(norm(c.path).toLowerCase()))
        .map((c) => ({ name: c.name, path: norm(c.path), relativePath: c.name })) : [];
      // Like the real apps: the free space of the disk the folder is on.
      const disk = disks.filter((d) => { const dp = norm(d.path); const rp = norm(r.path); return dp === '/' ? rp.startsWith('/') : rp === dp || rp.startsWith(`${dp}/`); }).sort((a, b) => norm(b.path).length - norm(a.path).length)[0];
      return { ...r, accessible, freeSpace: accessible ? r.freeSpace || (disk ? disk.freeSpace : 1099511627776) : 0, unmappedFolders: unmapped };
    };
    app.get(`${prefix}/rootfolder`, (req, res) => res.json(rootFolders().map(rootView)));
    // ?timeout=false is the full list (the list above stops after 5 s in the real apps).
    app.get(`${prefix}/rootfolder/:id`, (req, res) => {
      const r = rootFolders().find((x) => x.id === Number(req.params.id));
      return r ? res.json(rootView(r)) : res.status(404).json({ message: 'NotFound' });
    });
    app.post(`${prefix}/rootfolder`, (req, res) => {
      const path = String((req.body && req.body.path) || '');
      if (!exists(path)) return res.status(400).json([{ propertyName: 'Path', errorMessage: "Folder '" + path + "' does not exist" }]);
      if (rootFolders().some((r) => norm(r.path).toLowerCase() === norm(path).toLowerCase())) return res.status(400).json([{ propertyName: 'Path', errorMessage: 'Path is already configured as a root folder' }]);
      const rf = { id: Math.max(0, ...rootFolders().map((r) => r.id)) + 1, path: norm(path) };
      rootFolders().push(rf);
      res.status(201).json(rootView(rf));
    });
    app.delete(`${prefix}/rootfolder/:id`, (req, res) => {
      const list = rootFolders();
      const i = list.findIndex((r) => r.id === Number(req.params.id));
      if (i < 0) return res.status(404).json({ message: 'NotFound' });
      list.splice(i, 1);
      res.json({});
    });
  }

  return { mount, exists, children, mkdirp, remove, addFile };
}

// Demo scenario: a library moved from a Windows PC (C:\Media\...) to a Mac
// with three external drives. Shows split across drives, a duplicate title on
// two drives, a release-named folder, and one title that is gone.
export function sonarrDemoFs() {
  return createMockFs({
    Volumes: {
      // Severance: 1080p episodes on Media; a 2160p copy of S01E01-03 plus a
      // missing S02E10 on Archive/TV2.
      Media: { TV: { Severance: { 'Season 1': Object.fromEntries([1, 2, 3, 4].map((e) => [`Severance.S01E0${e}.1080p.WEB-DL.mkv`, { __file: true }])) }, 'The Bear': {}, 'Shogun (2024)': {} } },
      Archive: { TV: { Foundation: {} }, TV2: { Severance: { 'Season 1': Object.fromEntries([1, 2, 3].map((e) => [`Severance.S01E0${e}.2160p.UHD.BluRay.mkv`, { __file: true }])), 'Season 2': { 'Severance.S02E10.2160p.WEB.mkv': { __file: true } } } } },
    },
    config: { logs: {} }, proc: {},
    // Folders Sonarr doesn't manage yet ("Add existing folders"): shows to
    // add, one already in Sonarr under another folder, and downloads that
    // aren't shows.
    data: { tv: {
      Friends: { 'Season 01': { 'Friends.S01E01.The.One.Where.Monica.Gets.a.Roommate.1080p.WEB-DL.mkv': { __file: true }, 'Friends.S01E02.The.One.with.the.Sonogram.at.the.End.1080p.WEB-DL.mkv': { __file: true }, 'The One with the Thumb.mkv': { __file: true } } },
      'That 70s Show': { 'Season 1': { 'That.70s.Show.S01E01.1080p.WEB-DL.mkv': { __file: true } } },
      Ghosts: { 'Season 1': { 'Ghosts.S01E01.1080p.WEB.mkv': { __file: true } } },
      'Medium (2005)': { 'Season 1': { 'Medium.S01E01.Pilot.1080p.WEB-DL.mkv': { __file: true } } },
      "It's always Sunny": { 'Season 1': { 'Its.Always.Sunny.in.Philadelphia.S01E01.1080p.mkv': { __file: true } } },
      'Californication Season S01-S02 1080p BluRay x264-MIXED': { 'Season 1': { 'Californication.S01E01.1080p.BluRay.x264.mkv': { __file: true } }, 'Season 2': { 'Californication.S02E01.1080p.BluRay.x264.mkv': { __file: true } } },
      'Severance 4K': { 'Season 1': { 'Severance.S01E01.2160p.WEB-DL.mkv': { __file: true } } },
      'Severance.S01E05.1080p.WEB-DL-GRP': { 'Severance.S01E05.1080p.WEB-DL-GRP.mkv': { __file: true } },
      'Bluey.S02.1080p.WEB-DL-GRP': { 'Bluey.S02E01.1080p.WEB-DL-GRP.mkv': { __file: true } },
      '_FAILED_Some.Show.S01E01.1080p.WEB': {},
      'Old Recordings': {},
    }, usenet: { tv: {} } },
  }, { disks: [
    { path: '/', label: 'Macintosh HD', freeSpace: 312e9, totalSpace: 994e9 },
    { path: '/Volumes/Media', label: 'Media', freeSpace: 1.2e12, totalSpace: 8e12 },
    { path: '/Volumes/Archive', label: 'Archive', freeSpace: 3.1e12, totalSpace: 12e12 },
  ] });
}

// Lidarr demo: music moved from /music to /data/media/music; Miles Davis was
// renamed on disk with a "The" prefix-free folder.
export function lidarrDemoFs() {
  return createMockFs({
    data: { media: { music: { Radiohead: {}, 'Daft Punk': {}, 'Miles Davis': {} } } },
    config: {},
  }, { disks: [{ path: '/', label: 'root', freeSpace: 2e11, totalSpace: 1e12 }, { path: '/data', label: 'data', freeSpace: 3e12, totalSpace: 8e12 }] });
}

export function radarrDemoFs() {
  return createMockFs({
    Volumes: {
      Movies: { 'Dune Part Two (2024)': { 'Dune.Part.Two.mkv': { __file: true } }, '1917.2019.PROPER.1080p.BluRay.x265': { '1917.mkv': { __file: true } } },
      Movies2: { 'Oppenheimer (2023)': {}, 'Dune Part Two (2024)': { 'Dune.Part.Two.2024.2160p.UHD.BluRay.mkv': { __file: true } } },
      Movies3: { 'Furiosa.A.Mad.Max.Saga.2024.2160p.UHD.BluRay': { 'Furiosa.2024.2160p.mkv': { __file: true } }, 'Furiosa (2024) extras': { 'notes.txt': { __file: true } }, downloads: { movies: {} } },
    },
    config: {},
    // Folders Radarr doesn't manage yet ("Add existing folders").
    data: { movies: {
      'Amelie (2001)': { 'Amelie.2001.1080p.BluRay.x264.mkv': { __file: true } },
      'The.Whale.2022.1080p.BluRay.x264-SPHD': { 'The.Whale.2022.1080p.BluRay.x264-SPHD.mkv': { __file: true }, 'The.Whale.2022.1080p.BluRay.x264-SPHD.nfo': { __file: true } },
      Juno: { 'Juno.mkv': { __file: true } },
      Gladiator: { 'Gladiator.mkv': { __file: true } },
      'Sicario-Day.of.the.Soldado.[2018].[1080p.BluRay.x265-DarQ]': { 'Sicario-Day.of.the.Soldado.2018.mkv': { __file: true } },
      'James.Bond.PACK.1080p.BluRay.x264-HDSpace': { 'Dr.No.1962.1080p.BluRay.mkv': { __file: true }, 'Goldfinger.1964.1080p.BluRay.mkv': { __file: true } },
      'Home Videos': {},
    }, usenet: { movies: {} } },
  }, { disks: [
    { path: '/', label: 'Macintosh HD', freeSpace: 312e9, totalSpace: 994e9 },
    { path: '/Volumes/Movies', label: 'Movies', freeSpace: 0.8e12, totalSpace: 6e12 },
    { path: '/Volumes/Movies2', label: 'Movies2', freeSpace: 1.4e12, totalSpace: 6e12 },
    { path: '/Volumes/Movies3', label: 'Movies3', freeSpace: 2.9e12, totalSpace: 4e12 },
  ] });
}
