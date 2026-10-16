// Live progress for Seerr requests: where an approved request is in the
// pipeline (searching → queued → downloading % → importing → available), by
// matching it to the Sonarr/Radarr library and download queue.
//
// Matching: Seerr's media.externalServiceId is the Sonarr series / Radarr
// movie id on the instance it was sent to; fall back to tvdbId/tmdbId against
// every configured instance's library.

const SEERR_MEDIA = { AVAILABLE: 5, PARTIAL: 4, PROCESSING: 3, PENDING: 2 };
const REQ = { PENDING: 1, APPROVED: 2, DECLINED: 3, FAILED: 4, COMPLETED: 5 };

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

// "00:11:38" | "1.02:03:04" → seconds
export function parseTimeleft(t) {
  if (!t || typeof t !== 'string') return null;
  const m = /^(?:(\d+)\.)?(\d+):(\d+):(\d+)$/.exec(t.trim());
  if (!m) return null;
  return num(m[1]) * 86400 + num(m[2]) * 3600 + num(m[3]) * 60 + num(m[4]);
}
export function fmtEta(sec) {
  if (sec == null) return '';
  if (sec < 60) return '<1m';
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}

// Queue records that are already finished. Sonarr/Radarr keep completed
// torrents in the queue while they seed (state "imported"), often with a
// warning attached; those are done, not problems.
const DONE_STATES = new Set(['imported', 'ignored']);
const stateOf = (r) => String(r.trackedDownloadState || r.status || '').toLowerCase();

// Aggregate the queue records belonging to one library item.
export function summarizeQueue(records) {
  const active = records.filter((r) => !DONE_STATES.has(stateOf(r)));
  if (!active.length) return null;
  const size = active.reduce((s, r) => s + num(r.size), 0);
  const left = active.reduce((s, r) => s + num(r.sizeleft), 0);
  const states = active.map(stateOf);
  const etas = active.map((r) => parseTimeleft(r.timeleft)).filter((x) => x != null);
  // Only an explicit importBlocked means the user must act; a warning on a
  // downloading item (slow/stalled) is still just downloading.
  const blockedCount = states.filter((s) => s === 'importblocked').length;
  const importing = states.some((s) => s === 'importpending' || s === 'importing');
  const downloading = states.some((s) => s === 'downloading');
  const failed = states.some((s) => s === 'failed' || s === 'failedpending');
  const queued = states.every((s) => s === 'queued' || s === 'delay' || s === 'paused' || s === '');
  return {
    count: active.length,
    blockedCount,
    percent: size > 0 ? Math.round(((size - left) / size) * 100) : 0,
    eta: etas.length ? Math.max(...etas) : null,
    state: downloading ? 'downloading' : failed ? 'failed' : blockedCount ? 'blocked' : importing ? 'importing' : queued ? 'queued' : 'downloading',
  };
}

// The request's pipeline stage (pure). `lib` = { item, svc } or null;
// `queue` = summarizeQueue(...) or null.
export function requestStage(request, { lib = null, queue = null } = {}) {
  const media = request.media || {};
  if (request.status === REQ.PENDING) return { stage: 'approval', label: 'Awaiting approval', cls: 'warn' };
  if (request.status === REQ.DECLINED) return { stage: 'declined', label: 'Declined', cls: 'down' };
  if (request.status === REQ.FAILED) return { stage: 'failed', label: 'Request failed', cls: 'down' };
  const haveMedia = media.status === SEERR_MEDIA.AVAILABLE || media.status === SEERR_MEDIA.PARTIAL;
  if (queue) {
    // Already watchable: a stuck extra download (e.g. an upgrade) is a note,
    // not a broken request.
    if (haveMedia && (queue.state === 'blocked' || queue.state === 'failed')) {
      const what = queue.state === 'blocked' ? (queue.blockedCount === 1 ? '1 import needs attention' : `${queue.blockedCount} imports need attention`) : 'an upgrade failed';
      return { stage: 'available', label: `${media.status === SEERR_MEDIA.PARTIAL ? 'Partially available' : 'Available'} · ${what}`, cls: 'ok' };
    }
    if (queue.state === 'failed') return { stage: 'failed', label: 'Download failed', cls: 'down', percent: queue.percent };
    if (queue.state === 'blocked') return { stage: 'blocked', label: queue.blockedCount > 1 ? `${queue.blockedCount} imports need attention` : 'Import needs attention', cls: 'down', percent: 100 };
    if (queue.state === 'importing') return { stage: 'importing', label: 'Importing', cls: 'info', percent: 100 };
    if (queue.state === 'queued') return { stage: 'queued', label: 'Queued', cls: 'info', percent: queue.percent };
    const upgrading = media.status === SEERR_MEDIA.AVAILABLE;
    return { stage: 'downloading', label: `${upgrading ? 'Upgrading' : 'Downloading'} ${queue.percent}%${queue.eta != null ? ` · ${fmtEta(queue.eta)} left` : ''}${queue.count > 1 ? ` · ${queue.count} items` : ''}`, cls: 'info', percent: queue.percent };
  }
  if (media.status === SEERR_MEDIA.AVAILABLE) return { stage: 'available', label: 'Available', cls: 'ok' };
  if (media.status === SEERR_MEDIA.PARTIAL) return { stage: 'partial', label: 'Partially available', cls: 'ok' };
  const item = lib && lib.item;
  if (item && (item.hasFile || (item.statistics && item.statistics.episodeFileCount > 0 && item.statistics.percentOfEpisodes >= 100))) {
    return { stage: 'available', label: 'Available', cls: 'ok' };
  }
  if (item) return { stage: 'searching', label: `Searching in ${lib.svc.label}`, cls: 'info' };
  return { stage: 'sent', label: request.status === REQ.COMPLETED ? 'Completed' : 'Approved · waiting for Sonarr/Radarr', cls: 'muted' };
}

// Find the library item for a request across instances.
export function findLibraryItem(request, libraries) {
  const media = request.media || {};
  const isTv = (request.type || media.mediaType) === 'tv';
  const want = isTv ? 'sonarr' : 'radarr';
  const pools = libraries.filter((l) => l.svc.type === want);
  if (media.externalServiceId != null) {
    for (const l of pools) {
      const hit = l.items.find((i) => i.id === media.externalServiceId && ((isTv && media.tvdbId ? i.tvdbId === media.tvdbId : true) && (!isTv && media.tmdbId ? i.tmdbId === media.tmdbId : true)));
      if (hit) return { svc: l.svc, item: hit };
    }
  }
  for (const l of pools) {
    const hit = l.items.find((i) => (isTv ? (media.tvdbId && i.tvdbId === media.tvdbId) || (media.tmdbId && i.tmdbId === media.tmdbId) : media.tmdbId && i.tmdbId === media.tmdbId));
    if (hit) return { svc: l.svc, item: hit };
  }
  return null;
}

// `seasons` = requested season numbers (TV); queue items for other seasons
// of the same series don't belong to this request.
export function queueFor(found, queues, seasons = null) {
  if (!found) return null;
  const q = queues.find((x) => x.svc.key === found.svc.key);
  if (!q) return null;
  const key = found.svc.type === 'sonarr' ? 'seriesId' : 'movieId';
  let records = q.records.filter((r) => r[key] === found.item.id);
  if (found.svc.type === 'sonarr' && seasons && seasons.length) {
    const want = new Set(seasons);
    records = records.filter((r) => {
      const sn = r.seasonNumber ?? (r.episode && r.episode.seasonNumber);
      return sn == null || want.has(sn); // unknown season: keep
    });
  }
  return summarizeQueue(records);
}

export function requestedSeasons(request) {
  const list = (request.seasons || []).map((x) => Number(x.seasonNumber)).filter((n) => Number.isFinite(n));
  return list.length ? list : null;
}
