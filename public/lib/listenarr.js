// Listenarr (audiobooks, Sonarr-style) client + normalizers.
// API: /api/v1/..., X-Api-Key header (added by the proxy). Listenarr is pre-1.0,
// so every normalizer tolerates missing fields and either-case keys.
// References (Listenarrs/Listenarr, canary): fe/src/services/api.ts,
// fe/src/types/index.ts, listenarr.api/Features/{Library,Downloads,Search,
// ActivityHistory,SystemDiagnostics,Images}.

const pick = (o, ...keys) => { for (const k of keys) { if (o && o[k] != null) return o[k]; } return undefined; };
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const list = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
const names = (v) => list(v).map((x) => (typeof x === 'string' ? x : x && (x.name || x.Name))).filter(Boolean);

// Cover URL usable from the browser. Relative Listenarr image paths are routed
// through ACC's proxy (which adds the API key); absolute URLs are left alone.
export function coverUrl(svcKey, imageUrl, asin) {
  const u = typeof imageUrl === 'string' ? imageUrl.trim() : '';
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith('/')) return `/api/proxy/${svcKey}/${u.replace(/^\/+/, '')}`;
  if (asin) return `/api/proxy/${svcKey}/api/v1/images/${encodeURIComponent(asin)}`;
  return null;
}

// Library list item → common shape.
// status: 'downloading' | 'no-file' | 'quality-mismatch' | 'quality-match'.
export function normalizeBook(b, svcKey) {
  const files = list(pick(b, 'files', 'Files'));
  const fileCount = num(pick(b, 'fileCount', 'FileCount')) || files.length;
  const size = num(pick(b, 'fileSize', 'FileSize')) || files.reduce((s, f) => s + num(f && (f.size ?? f.Size)), 0);
  const status = String(pick(b, 'status', 'Status') || '').toLowerCase() || (fileCount > 0 ? 'quality-match' : 'no-file');
  const asin = pick(b, 'asin', 'Asin');
  const series = pick(b, 'series', 'Series');
  const seriesNumber = pick(b, 'seriesNumber', 'SeriesNumber');
  return {
    id: pick(b, 'id', 'Id'),
    title: pick(b, 'title', 'Title') || 'Untitled',
    subtitle: pick(b, 'subtitle', 'Subtitle') || '',
    authors: names(pick(b, 'authors', 'Authors')),
    narrators: names(pick(b, 'narrators', 'Narrators')),
    series: series ? `${series}${seriesNumber ? ` #${seriesNumber}` : ''}` : '',
    year: pick(b, 'publishYear', 'PublishYear') || String(pick(b, 'publishedDate', 'PublishedDate') || '').slice(0, 4),
    asin,
    monitored: pick(b, 'monitored', 'Monitored') !== false,
    wanted: pick(b, 'wanted', 'Wanted') === true || (status === 'no-file' && pick(b, 'monitored', 'Monitored') !== false),
    status,
    hasFiles: fileCount > 0,
    size,
    runtime: num(pick(b, 'runtime', 'Runtime')), // minutes
    cover: coverUrl(svcKey, pick(b, 'imageUrl', 'ImageUrl'), asin),
  };
}

export const BOOK_STATUS = {
  downloading: ['Downloading', 'info'],
  'no-file': ['Missing', 'warn'],
  'quality-mismatch': ['Below cutoff', 'warn'],
  'quality-match': ['Downloaded', 'ok'],
};

// GET /download/queue returns { items: [...] } (QueueSnapshot) or, on older
// builds, a bare array.
export function normalizeQueue(snapshot) {
  const items = Array.isArray(snapshot) ? snapshot : list(snapshot && (snapshot.items || snapshot.Items));
  return items.map((q) => {
    const size = num(pick(q, 'size', 'Size', 'totalSize'));
    const done = num(pick(q, 'downloaded', 'Downloaded', 'downloadedSize'));
    const progress = pick(q, 'progress', 'Progress');
    return {
      id: String(pick(q, 'id', 'Id') ?? ''),
      clientId: pick(q, 'downloadClientId', 'DownloadClientId') || '',
      title: pick(q, 'title', 'Title') || 'Unknown',
      author: pick(q, 'author', 'Author') || '',
      status: String(pick(q, 'status', 'Status') || 'queued').toLowerCase(),
      progress: progress != null ? Math.max(0, Math.min(100, num(progress))) : (size ? (done / size) * 100 : 0),
      size, downloaded: done,
      speed: num(pick(q, 'downloadSpeed', 'DownloadSpeed')),
      eta: pick(q, 'eta', 'Eta') != null ? num(pick(q, 'eta', 'Eta')) : null,
      client: pick(q, 'downloadClient', 'DownloadClient', 'downloadClientName') || '',
      quality: pick(q, 'quality', 'Quality') || '',
      error: pick(q, 'errorMessage', 'ErrorMessage') || '',
      canRemove: pick(q, 'canRemove', 'CanRemove') !== false,
    };
  });
}

export function normalizeHistory(resp) {
  const rows = Array.isArray(resp) ? resp : list(resp && (resp.history || resp.History));
  return rows.map((r) => ({
    id: pick(r, 'id', 'Id'),
    title: pick(r, 'audiobookTitle', 'AudiobookTitle') || '',
    event: pick(r, 'eventType', 'EventType') || '',
    message: pick(r, 'message', 'Message') || '',
    source: pick(r, 'source', 'Source') || '',
    when: pick(r, 'timestamp', 'Timestamp') || null,
  }));
}

// Metadata search result (POST /search { mode: 'Simple' }) → display shape.
export function normalizeSearchResult(r, svcKey) {
  const asin = pick(r, 'asin', 'Asin');
  return {
    raw: r,
    asin,
    title: pick(r, 'title', 'Title') || 'Untitled',
    subtitle: pick(r, 'subtitle', 'Subtitle') || '',
    authors: names(pick(r, 'authors', 'Authors')).length ? names(pick(r, 'authors', 'Authors')) : names(pick(r, 'artist', 'Artist')),
    narrators: names(pick(r, 'narrators', 'Narrators', 'narrator')),
    series: pick(r, 'series', 'Series') || '',
    year: String(pick(r, 'releaseDate', 'publishDate', 'publishedDate', 'PublishedDate') || '').slice(0, 4),
    runtime: num(pick(r, 'lengthMinutes', 'runtime', 'Runtime')),
    cover: coverUrl(svcKey, pick(r, 'imageUrl', 'ImageUrl'), null),
  };
}

// AudibleBookMetadata body for POST /library/add, built from a search result.
export function metadataFromResult(r) {
  const raw = r.raw || {};
  const out = {
    title: r.title,
    subtitle: r.subtitle || undefined,
    authors: r.authors,
    narrators: r.narrators.length ? r.narrators : undefined,
    asin: r.asin || '',
    series: raw.series || undefined,
    seriesNumber: raw.seriesNumber || undefined,
    seriesAsin: raw.seriesAsin || undefined,
    description: raw.description || undefined,
    publisher: raw.publisher || undefined,
    language: raw.language || undefined,
    genres: Array.isArray(raw.genres) ? raw.genres : undefined,
    runtime: r.runtime || undefined,
    publishYear: r.year || undefined,
    publishedDate: raw.releaseDate || raw.publishDate || undefined,
    imageUrl: raw.imageUrl || undefined,
    metadataSource: raw.metadataSource || undefined,
    source: raw.source || undefined,
  };
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out;
}

export function isInLibrary(result, books) {
  const norm = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  return (books || []).some((b) => (result.asin && b.asin && b.asin === result.asin)
    || (norm(b.title) === norm(result.title) && (b.authors[0] || '') === (result.authors[0] || '')));
}

// Listenarr root folders carry no free space; /system/storage lists disks with
// a mount path. Attach each root folder's free space from the disk whose path
// is its longest prefix (case-insensitive, either slash style).
export function withFreeSpace(folders, storage) {
  const norm = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  const disks = list(storage && (storage.disks || storage.Disks)).map((d) => ({ path: norm(pick(d, 'path', 'Path')), free: pick(d, 'freeBytes', 'FreeBytes') }));
  return list(folders).map((f) => {
    const fp = norm(pick(f, 'path', 'Path'));
    let best = null;
    for (const d of disks) {
      if (d.free == null) continue;
      const under = d.path === '' || fp === d.path || fp.startsWith(`${d.path}/`);
      if (under && (!best || d.path.length > best.path.length)) best = d;
    }
    return { id: pick(f, 'id', 'Id'), name: pick(f, 'name', 'Name') || '', path: pick(f, 'path', 'Path') || '', isDefault: pick(f, 'isDefault', 'IsDefault') === true, freeSpace: best ? Number(best.free) : null };
  });
}

export function listenarrClient(api, key) {
  const get = (p) => api.proxy(key, `api/v1/${p}`);
  const send = (method, p, body) => api.proxy(key, `api/v1/${p}`, { method, body });
  return {
    info: () => get('system/info'),
    health: () => get('system/health').catch(() => null),
    library: async () => list(await get('library')).map((b) => normalizeBook(b, key)),
    queue: async () => normalizeQueue(await get('download/queue')),
    removeFromQueue: (item) => send('DELETE', `download/queue/${encodeURIComponent(item.id)}${item.clientId ? `?downloadClientId=${encodeURIComponent(item.clientId)}` : ''}`),
    history: async (limit = 50) => normalizeHistory(await get(`history?limit=${limit}`)),
    profiles: async () => list(await get('qualityprofile')),
    rootFolders: async () => {
      const [folders, storage] = await Promise.all([get('rootfolders'), get('system/storage').catch(() => null)]);
      return withFreeSpace(folders, storage);
    },
    // Full destination for a book inside a chosen root (same as Listenarr's UI).
    previewPath: (result, destinationRoot) => send('POST', 'library/preview-path', { metadata: metadataFromResult(result), destinationRoot }),
    search: async (query) => {
      const resp = await send('POST', 'search', { mode: 'Simple', query, region: 'us' });
      const rows = Array.isArray(resp) ? resp : list(resp && (resp.results || resp.metadataResults || resp.MetadataResults));
      return rows.map((r) => normalizeSearchResult(r, key));
    },
    add: (result, { qualityProfileId, monitored = true, autoSearch = true, destinationPath } = {}) => send('POST', 'library/add', {
      metadata: metadataFromResult(result),
      monitored,
      qualityProfileId: qualityProfileId || undefined,
      autoSearch,
      destinationPath: destinationPath || undefined,
    }),
    searchAndDownload: (audiobookId) => send('POST', 'download/search-and-download', { audiobookId }),
  };
}
