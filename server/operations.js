import { serviceGet as defaultServiceGet } from './proxy.js';

const pad = (n) => String(n ?? 0).padStart(2, '0');
const ts = (value, fallback) => Number.isFinite(new Date(value).getTime()) ? new Date(value).getTime() : fallback;

function item(base, svc, now) {
  return {
    id: base.id,
    kind: base.kind,
    severity: base.severity || 'info',
    title: base.title || 'Activity',
    detail: base.detail || '',
    at: base.at || now,
    serviceKey: svc.key,
    serviceLabel: svc.label || svc.key,
    serviceType: svc.type,
    tab: base.tab || '',
    action: base.action || null,
  };
}

export function summarizeOperations(inbox, errors = []) {
  const byKind = {};
  const bySeverity = {};
  for (const entry of inbox) {
    byKind[entry.kind] = (byKind[entry.kind] || 0) + 1;
    bySeverity[entry.severity] = (bySeverity[entry.severity] || 0) + 1;
  }
  return {
    total: inbox.length,
    critical: bySeverity.critical || 0,
    warning: bySeverity.warning || 0,
    approvals: byKind.approval || 0,
    missing: (byKind.missing || 0) + (byKind.subtitle || 0),
    health: byKind.health || 0,
    serviceErrors: errors.length,
  };
}

async function collectArr(svc, serviceGet, now) {
  const include = svc.type === 'sonarr' ? 'includeSeries=true&includeEpisode=true' : 'includeMovie=true';
  const [queue, history, missing, health] = await Promise.all([
    serviceGet(svc, 'api/v3/queue?page=1&pageSize=50').catch(() => ({ records: [] })),
    serviceGet(svc, `api/v3/history?page=1&pageSize=30&sortKey=date&sortDirection=descending&${include}`).catch(() => ({ records: [] })),
    serviceGet(svc, 'api/v3/wanted/missing?page=1&pageSize=30&sortKey=airDateUtc&sortDirection=descending').catch(() => ({ records: [] })),
    serviceGet(svc, 'api/v3/health').catch(() => []),
  ]);
  const inbox = [];
  const activity = [];
  for (const h of (health || [])) inbox.push(item({
    id: `${svc.key}:health:${h.id || h.source || h.message}`,
    kind: 'health', severity: h.type === 'error' ? 'critical' : 'warning', title: h.source || 'Service health warning', detail: h.message, tab: 'system',
  }, svc, now));
  for (const q of (queue.records || [])) {
    const title = q.title || q.sourceTitle || 'Queued download';
    const state = String(q.trackedDownloadState || q.status || '').toLowerCase();
    activity.push(item({ id: `${svc.key}:queue:${q.id}`, kind: 'queue', title, detail: `${q.status || 'queued'}${q.timeleft ? ` · ${q.timeleft} remaining` : ''}`, tab: 'queue' }, svc, now));
    if (/fail|warn|stalled|error|importpending/.test(state)) inbox.push(item({ id: `${svc.key}:queue-problem:${q.id}`, kind: 'queue', severity: /fail|error/.test(state) ? 'critical' : 'warning', title, detail: q.statusMessages?.map((x) => x.title).join(' · ') || q.status || state, tab: 'queue' }, svc, now));
  }
  for (const r of (history.records || [])) {
    if (!['downloadFolderImported', 'downloadFailed', 'grabbed'].includes(r.eventType)) continue;
    const media = svc.type === 'sonarr'
      ? `${r.series?.title || r.sourceTitle || 'Unknown'}${r.episode ? ` S${pad(r.episode.seasonNumber)}E${pad(r.episode.episodeNumber)}` : ''}`
      : (r.movie?.title || r.sourceTitle || 'Unknown');
    const failed = r.eventType === 'downloadFailed';
    const event = item({ id: `${svc.key}:history:${r.id}`, kind: failed ? 'failure' : r.eventType === 'grabbed' ? 'grab' : 'import', severity: failed ? 'critical' : 'info', title: media, detail: failed ? 'Download failed' : r.eventType === 'grabbed' ? 'Release grabbed' : 'Downloaded and imported', at: ts(r.date, now), tab: 'history' }, svc, now);
    activity.push(event);
    if (failed) inbox.push(event);
  }
  for (const r of (missing.records || []).slice(0, 20)) {
    const title = svc.type === 'sonarr'
      ? `${r.series?.title || 'Unknown'} · S${pad(r.seasonNumber)}E${pad(r.episodeNumber)}`
      : `${r.title || 'Unknown'}${r.year ? ` (${r.year})` : ''}`;
    inbox.push(item({ id: `${svc.key}:missing:${r.id}`, kind: 'missing', severity: 'warning', title, detail: 'Monitored media is missing', at: ts(r.airDateUtc || r.digitalRelease, now), tab: 'wanted' }, svc, now));
  }
  return { inbox, activity };
}

const REQUEST_STATUS = { 1: 'Pending', 2: 'Approved', 3: 'Declined' };
const ISSUE_TYPE = { 1: 'Video', 2: 'Audio', 3: 'Subtitles', 4: 'Other' };

async function collectOverseerr(svc, serviceGet, now) {
  const results = await Promise.allSettled([
    serviceGet(svc, 'api/v1/request?filter=pending&take=30'),
    serviceGet(svc, 'api/v1/request?take=30&sort=added'),
    serviceGet(svc, 'api/v1/issue?filter=open&take=30'),
  ]);
  if (results.every((result) => result.status === 'rejected')) throw results[0].reason;
  const [pendingData, recentData, issueData] = results.map((result) => result.status === 'fulfilled' ? result.value : { results: [] });
  const requests = new Map();
  const addRequest = (r) => {
    const media = r.media || {};
    const pending = Number(r.status) === 1;
    requests.set(r.id, item({
      id: `${svc.key}:request:${r.id}`, kind: 'seerr-request', severity: pending ? 'warning' : 'info',
      title: media.title || media.name || `Request #${r.id}`,
      detail: `${REQUEST_STATUS[r.status] || 'Requested'} by ${r.requestedBy?.displayName || r.requestedBy?.email || 'unknown'}`,
      at: ts(r.createdAt, now), tab: pending ? 'pending' : 'all',
      action: pending ? { type: 'overseerr-request', requestId: r.id } : null,
    }, svc, now));
  };
  for (const r of (recentData.results || [])) addRequest(r);
  for (const r of (pendingData.results || [])) addRequest(r); // pending data wins when lists overlap

  const issues = (issueData.results || []).map((issue) => {
    const media = issue.media || {};
    const type = ISSUE_TYPE[issue.issueType] || 'Issue';
    const episode = issue.problemSeason != null
      ? ` · S${pad(issue.problemSeason)}${issue.problemEpisode != null ? `E${pad(issue.problemEpisode)}` : ''}`
      : '';
    const latestComment = Array.isArray(issue.comments) && issue.comments.length
      ? issue.comments[issue.comments.length - 1].message
      : '';
    return item({
      id: `${svc.key}:issue:${issue.id}`, kind: 'seerr-issue', severity: 'warning',
      title: media.title || media.name || `Issue #${issue.id}`,
      detail: `${type} issue${episode} · reported by ${issue.createdBy?.displayName || 'unknown'}${latestComment ? ` · ${latestComment}` : ''}`,
      at: ts(issue.createdAt, now), tab: 'issues', action: { type: 'overseerr-issue', issueId: issue.id },
    }, svc, now);
  });
  return { inbox: [], activity: [], seerr: [...requests.values(), ...issues] };
}

async function collectBazarr(svc, serviceGet, now) {
  const [episodes, movies] = await Promise.all([
    serviceGet(svc, 'api/episodes/wanted').catch(() => ({ data: [] })),
    serviceGet(svc, 'api/movies/wanted').catch(() => ({ data: [] })),
  ]);
  const inbox = [];
  for (const [kind, records] of [['episode', episodes.data || []], ['movie', movies.data || []]]) {
    for (const r of records.slice(0, 20)) inbox.push(item({
      id: `${svc.key}:subtitle:${kind}:${r.sonarrSeriesId || r.radarrId || r.episodeid || r.title}`,
      kind: 'subtitle', severity: 'warning', title: r.seriesTitle || r.title || 'Missing subtitles',
      detail: `Missing ${(r.missing_subtitles || []).map((x) => x.name || x.code2).join(', ') || 'subtitles'}`, tab: 'wanted',
    }, svc, now));
  }
  return { inbox, activity: [] };
}

export async function collectOperations(cfg, { serviceGet = defaultServiceGet, now = Date.now(), limit = 100 } = {}) {
  const inbox = [];
  const activity = [];
  const seerr = [];
  const errors = [];
  const services = Object.entries(cfg.services || {})
    .filter(([, svc]) => svc.enabled !== false && (svc.baseUrl || svc.sample))
    .map(([key, svc]) => ({ ...svc, key }));
  await Promise.all(services.map(async (svc) => {
    try {
      let result = { inbox: [], activity: [], seerr: [] };
      if (svc.type === 'sonarr' || svc.type === 'radarr') result = await collectArr(svc, serviceGet, now);
      else if (svc.type === 'overseerr') result = await collectOverseerr(svc, serviceGet, now);
      else if (svc.type === 'bazarr') result = await collectBazarr(svc, serviceGet, now);
      inbox.push(...result.inbox); activity.push(...result.activity); seerr.push(...(result.seerr || []));
    } catch (error) {
      errors.push({ serviceKey: svc.key, serviceLabel: svc.label || svc.key, message: error.message || String(error) });
    }
  }));
  const severityOrder = { critical: 0, warning: 1, info: 2 };
  inbox.sort((a, b) => (severityOrder[a.severity] ?? 3) - (severityOrder[b.severity] ?? 3) || b.at - a.at);
  activity.sort((a, b) => b.at - a.at);
  seerr.sort((a, b) => (severityOrder[a.severity] ?? 3) - (severityOrder[b.severity] ?? 3) || b.at - a.at);
  const seerrSummary = {
    total: seerr.length,
    requests: seerr.filter((entry) => entry.kind === 'seerr-request').length,
    pending: seerr.filter((entry) => entry.action?.type === 'overseerr-request').length,
    issues: seerr.filter((entry) => entry.kind === 'seerr-issue').length,
  };
  const dashboardSeerr = [
    ...seerr.filter((entry) => entry.kind === 'seerr-request').sort((a, b) => b.at - a.at).slice(0, 5),
    ...seerr.filter((entry) => entry.kind === 'seerr-issue').sort((a, b) => b.at - a.at),
  ];
  return {
    generatedAt: now,
    summary: summarizeOperations(inbox, errors),
    seerrSummary,
    inbox: inbox.slice(0, limit),
    activity: activity.slice(0, limit),
    seerr: dashboardSeerr.slice(0, limit),
    errors,
  };
}

let cache = null;
export async function getOperations(cfg, opts = {}) {
  const now = Date.now();
  const ttlMs = Number(opts.ttlMs ?? 5000);
  if (cache && cache.cfg === cfg && now - cache.at < ttlMs) return cache.value;
  const value = await collectOperations(cfg, opts);
  cache = { cfg, at: now, value };
  return value;
}

export function clearOperationsCache() { cache = null; }
