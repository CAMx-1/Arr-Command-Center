// Clients + normalizers for Autobrr, Maintainerr, Tdarr and Audiobookshelf.
// Everything goes through api.proxy(), so the server (or local mode) injects
// credentials. Normalizers are pure so they're unit-tested directly.

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const GB = 1e9;
const MB = 1e6;

// ---------------------------------------------------------------- Autobrr
const PUSH_STATE = {
  PUSH_APPROVED: { label: 'Pushed', cls: 'ok' },
  PUSH_REJECTED: { label: 'Rejected', cls: 'warn' },
  PUSH_ERROR: { label: 'Error', cls: 'down' },
  PENDING: { label: 'Pending', cls: 'info' },
};

// A release's outcome is the "worst" of its per-action statuses (an error on
// any action matters more than an approval on another).
export function autobrrReleaseStatus(release = {}) {
  const actions = Array.isArray(release.action_status) ? release.action_status : [];
  const order = ['PUSH_ERROR', 'PUSH_REJECTED', 'PENDING', 'PUSH_APPROVED'];
  const found = order.find((s) => actions.some((a) => a.status === s));
  if (found) {
    const first = actions.find((a) => a.status === found);
    return { status: found, ...PUSH_STATE[found], client: first.client || '', reason: (first.rejections || []).join(', ') };
  }
  if (release.filter_status === 'FILTER_REJECTED') return { status: 'FILTER_REJECTED', label: 'Filtered', cls: 'muted', client: '', reason: (release.rejections || []).join(', ') };
  return { status: 'MATCHED', label: 'Matched', cls: 'info', client: '', reason: '' };
}

export function normalizeAutobrrRelease(r = {}) {
  return {
    id: r.id, name: r.name || r.title || 'Release', title: r.title || '',
    indexer: (r.indexer && (r.indexer.name || r.indexer.identifier)) || '',
    filter: r.filter || '', size: num(r.size), timestamp: r.timestamp || null,
    protocol: r.protocol || '', resolution: r.resolution || '', ...autobrrReleaseStatus(r),
  };
}

export function autobrrClient(api, key) {
  const get = (p) => api.proxy(key, `api/${p}`);
  return {
    version: async () => (await get('config')).version || '',
    stats: () => get('release/stats'),
    releases: async ({ limit = 30, pushStatus = '' } = {}) => {
      const qs = new URLSearchParams({ limit: String(limit) });
      if (pushStatus) qs.set('push_status', pushStatus);
      const data = await get(`release?${qs}`);
      return (data?.data || []).map(normalizeAutobrrRelease);
    },
    filters: async () => (await get('filters?sort=name-asc')) || [],
    setFilterEnabled: (id, enabled) => api.proxy(key, `api/filters/${encodeURIComponent(id)}/enabled`, { method: 'PUT', body: { enabled: !!enabled } }),
    irc: async () => (await get('irc')) || [],
  };
}

// ------------------------------------------------------------ Maintainerr
// /api/app/status returns a JSON-encoded string, so it may arrive double-encoded.
export function parseMaintainerrStatus(value) {
  let data = value;
  if (typeof data === 'string') { try { data = JSON.parse(data); } catch { return {}; } }
  return data && typeof data === 'object' ? data : {};
}

// Deletion date isn't stored: it's the day the item entered the collection
// plus the collection's grace period. Null when the collection never deletes.
export function maintainerrDeletionDate(item = {}, collection = {}) {
  const days = collection.deleteAfterDays;
  if (days == null || !item.addDate) return null;
  const added = new Date(item.addDate).getTime();
  if (!Number.isFinite(added)) return null;
  return new Date(added + Number(days) * 86400000);
}

export function normalizeMaintainerrItem(item = {}, collection = {}, nowMs = Date.now()) {
  const deletion = maintainerrDeletionDate(item, collection);
  const daysLeft = deletion ? Math.ceil((deletion.getTime() - nowMs) / 86400000) : null;
  return {
    id: item.id, mediaId: String(item.mediaServerId ?? ''), collectionId: item.collectionId ?? collection.id,
    title: item.mediaData?.title || (item.tmdbId ? `TMDB ${item.tmdbId}` : 'Unknown title'),
    type: item.mediaData?.type || collection.type || '', size: num(item.sizeBytes),
    image: item.image_path || '', addDate: item.addDate || null, deletionDate: deletion,
    daysLeft, overdue: daysLeft != null && daysLeft <= 0,
  };
}

export function maintainerrClient(api, key) {
  const get = (p) => api.proxy(key, `api/${p}`);
  return {
    status: async () => parseMaintainerrStatus(await get('app/status')),
    collections: async () => (await get('collections')) || [],
    media: async (collection, { page = 1, size = 50 } = {}) => {
      const data = await get(`collections/media/${encodeURIComponent(collection.id)}/content/${page}?size=${size}`);
      return { total: num(data?.totalSize), items: (data?.items || []).map((it) => normalizeMaintainerrItem(it, collection)) };
    },
    setCollectionActive: (id, active) => get(`collections/${active ? 'activate' : 'deactivate'}/${encodeURIComponent(id)}`),
    runRules: () => api.proxy(key, 'api/rules/execute', { method: 'POST' }),
    // Exclude an item from this collection's rules (action 0 = add exclusion).
    exclude: (item) => api.proxy(key, 'api/rules/exclusion', { method: 'POST', body: { mediaId: item.mediaId, collectionId: item.collectionId, action: 0 } }),
  };
}

// ------------------------------------------------------------------ Tdarr
const pieValue = (list, name) => num((list || []).find((x) => x.name === name)?.value);

export function normalizeTdarrStats(data = {}) {
  const p = data.pieStats || {};
  const tStatus = p.status?.transcode || [];
  const hStatus = p.status?.healthcheck || [];
  return {
    totalFiles: num(p.totalFiles), transcodes: num(p.totalTranscodeCount), healthChecks: num(p.totalHealthCheckCount),
    spaceSaved: num(p.sizeDiff) * GB, // Tdarr reports GB
    transcodeSuccess: pieValue(tStatus, 'Transcode success'), transcodeErrors: pieValue(tStatus, 'Transcode error'),
    transcodeQueued: pieValue(tStatus, 'Queued'), healthErrors: pieValue(hStatus, 'Error'), healthQueued: pieValue(hStatus, 'Queued'),
    codecs: p.video?.codecs || [], resolutions: p.video?.resolutions || [],
  };
}

const baseName = (path) => String(path || '').split(/[\\/]/).pop() || String(path || '');

export function normalizeTdarrWorkers(nodes = {}) {
  const out = [];
  for (const [nodeId, node] of Object.entries(nodes || {})) {
    for (const [workerId, w] of Object.entries(node?.workers || {})) {
      out.push({
        id: w._id || workerId, nodeId, node: node.nodeName || nodeId, nodePaused: !!node.nodePaused,
        file: w.file || '', name: baseName(w.file), type: w.job?.type || w.workerType || '',
        percentage: Math.max(0, Math.min(100, num(w.percentage))), fps: num(w.fps), eta: w.ETA || '',
        status: w.status || '', originalSize: num(w.originalfileSizeInGbytes) * GB,
        estimatedSize: w.estSize ? num(w.estSize) * GB : null,
      });
    }
  }
  return out;
}

export function normalizeTdarrNodes(nodes = {}) {
  return Object.entries(nodes || {}).map(([id, n]) => ({ id, name: n?.nodeName || id, paused: !!n?.nodePaused, workers: Object.keys(n?.workers || {}).length }));
}

export function normalizeTdarrQueueItem(item = {}) {
  return {
    id: item._id, file: item.file || '', name: baseName(item.file), size: num(item.file_size) * MB, // Tdarr reports MB
    codec: item.video_codec_name || '', resolution: item.video_resolution || '', container: item.container || '',
    transcode: item.TranscodeDecisionMaker || '', health: item.HealthCheck || '',
  };
}

// table1 = transcode queue, table3 = transcode errors (Tdarr status tables).
export const TDARR_TABLES = { queue: 'table1', errors: 'table3' };

export function tdarrClient(api, key) {
  const post = (p, data) => api.proxy(key, `api/v2/${p}`, { method: 'POST', body: { data } });
  return {
    stats: async () => normalizeTdarrStats(await post('stats/get-pies', { libraryId: '' })),
    nodes: () => api.proxy(key, 'api/v2/get-nodes'),
    table: async (table, { start = 0, pageSize = 50 } = {}) => {
      const data = await post('client/status-tables', { start, pageSize, filters: [], sorts: [], opts: { table } });
      return { total: num(data?.totalCount), items: (data?.array || []).map(normalizeTdarrQueueItem) };
    },
  };
}

// --------------------------------------------------------- Audiobookshelf
// Covers are public in Audiobookshelf, but routing through the proxy keeps the
// service URL private and works behind Cloudflare Access.
export function absCoverUrl(serviceKey, itemId, width = 300) {
  if (!itemId) return '';
  return `/api/proxy/${encodeURIComponent(serviceKey)}/api/items/${encodeURIComponent(itemId)}/cover?width=${width}&format=webp`;
}

export function fmtDuration(seconds) {
  const s = Math.max(0, Math.round(num(seconds)));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

export function normalizeAbsItem(serviceKey, item = {}, progressById = {}) {
  const md = item.media?.metadata || {};
  const progress = progressById[item.id];
  return {
    id: item.id, libraryId: item.libraryId, mediaType: item.mediaType || 'book',
    title: md.title || 'Untitled', author: md.authorName || md.author || '', narrator: md.narratorName || '',
    series: md.seriesName || '', duration: num(item.media?.duration), size: num(item.size || item.media?.size),
    episodes: num(item.media?.numEpisodes), addedAt: item.addedAt || null,
    cover: absCoverUrl(serviceKey, item.id),
    progress: progress != null ? Math.max(0, Math.min(1, num(progress))) : null,
  };
}

export function normalizeAbsSession(serviceKey, s = {}) {
  const duration = num(s.duration);
  return {
    id: s.id, itemId: s.libraryItemId, title: s.displayTitle || 'Unknown', author: s.displayAuthor || '',
    user: s.user?.username || '', device: [s.deviceInfo?.clientName, s.deviceInfo?.deviceName].filter(Boolean).join(' · '),
    currentTime: num(s.currentTime), duration, progress: duration > 0 ? Math.min(1, num(s.currentTime) / duration) : 0,
    cover: absCoverUrl(serviceKey, s.libraryItemId), updatedAt: s.updatedAt || null,
  };
}

export function absClient(api, key) {
  const get = (p) => api.proxy(key, p);
  const progressMap = async () => {
    try {
      const data = await get('api/me/progress');
      return Object.fromEntries((data?.mediaProgress || []).filter((p) => !p.isFinished).map((p) => [p.libraryItemId, p.progress]));
    } catch { return {}; }
  };
  return {
    version: async () => (await get('status'))?.serverVersion || '',
    libraries: async () => (await get('api/libraries'))?.libraries || [],
    stats: (libraryId) => get(`api/libraries/${encodeURIComponent(libraryId)}/stats`),
    recent: async (libraryId, limit = 24) => {
      const [data, progress] = await Promise.all([
        get(`api/libraries/${encodeURIComponent(libraryId)}/items?limit=${limit}&page=0&sort=addedAt&desc=1&minified=1`),
        progressMap(),
      ]);
      return (data?.results || []).map((it) => normalizeAbsItem(key, it, progress));
    },
    inProgress: async () => {
      const [data, progress] = await Promise.all([get('api/me/items-in-progress?limit=25'), progressMap()]);
      return (data?.libraryItems || []).map((it) => normalizeAbsItem(key, it, progress));
    },
    // Admin-only in Audiobookshelf; a non-admin token gets 403/404.
    sessions: async () => ((await get('api/sessions/open'))?.sessions || []).map((s) => normalizeAbsSession(key, s)),
  };
}
