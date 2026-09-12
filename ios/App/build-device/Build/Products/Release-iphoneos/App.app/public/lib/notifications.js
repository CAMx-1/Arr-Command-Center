// Aggregates recent notable events (downloads imported/failed from Sonarr/Radarr
// history, plus failed Seerr requests) into a notifications feed with an unread
// count based on a locally-stored "last seen" timestamp.
import { listFailed } from './failedRequests.js';

const SEEN_KEY = 'notif-last-seen';

export function getLastSeen() { return Number(localStorage.getItem(SEEN_KEY)) || 0; }
export function markSeen() { localStorage.setItem(SEEN_KEY, String(Date.now())); }

const KIND = {
  imported: { label: 'Downloaded', cls: 'ok' },
  failed: { label: 'Download failed', cls: 'down' },
  reqfailed: { label: 'Request failed', cls: 'warn' },
  health: { label: 'Health', cls: 'warn' },
  healthError: { label: 'Health', cls: 'down' },
  approval: { label: 'Needs approval', cls: 'warn' },
};
export function notifKind(kind) { return KIND[kind] || { label: kind, cls: 'muted' }; }

// Health checks have no timestamp; assign a stable "first observed" time per
// unique issue so a new issue bumps the unread badge once (not on every poll).
const firstSeen = new Map();
function stableAt(id) { if (!firstSeen.has(id)) firstSeen.set(id, Date.now()); return firstSeen.get(id); }

export async function fetchNotifications(ctx) {
  const { api, state } = ctx;
  const events = [];

  const arrs = state.services.filter((s) => s.type === 'sonarr' || s.type === 'radarr');
  await Promise.all(arrs.map(async (svc) => {
    const inc = svc.type === 'sonarr' ? 'includeSeries=true&includeEpisode=true' : 'includeMovie=true';
    try {
      const data = await api.arr(svc.key).get(`history?page=1&pageSize=25&sortKey=date&sortDirection=descending&${inc}`);
      for (const r of (data.records || [])) {
        if (r.eventType !== 'downloadFolderImported' && r.eventType !== 'downloadFailed') continue;
        const title = svc.type === 'sonarr'
          ? (((r.series && r.series.title) || r.sourceTitle) + (r.episode ? ` S${String(r.episode.seasonNumber).padStart(2, '0')}E${String(r.episode.episodeNumber).padStart(2, '0')}` : ''))
          : ((r.movie && r.movie.title) || r.sourceTitle);
        events.push({
          id: `${svc.key}:${r.id}`, svcKey: svc.key, label: svc.label,
          title, kind: r.eventType === 'downloadFailed' ? 'failed' : 'imported',
          at: new Date(r.date).getTime() || 0,
        });
      }
    } catch { /* ignore per-service */ }
  }));

  // Service health checks. Sonarr/Radarr are intentionally excluded — their
  // health warnings (e.g. transient indexer failures) are noisy and re-appeared
  // on every poll. View those in each app's System tab instead.
  const healthSvcs = state.services.filter((s) => ['prowlarr', 'bazarr'].includes(s.type) && s.configured);
  await Promise.all(healthSvcs.map(async (svc) => {
    try {
      let checks = [];
      if (svc.type === 'prowlarr') checks = await api.prowlarr(svc.key).get('health');
      else if (svc.type === 'bazarr') { const r = await api.bazarr(svc.key).get('system/health'); checks = (r && r.data) || []; }
      else checks = await api.arr(svc.key).get('health');
      for (const c of (checks || [])) {
        const msg = c.message || c.issue || c.source || 'Health issue';
        const id = `${svc.key}:health:${msg}`;
        events.push({
          id, svcKey: svc.key, label: svc.label, title: msg,
          kind: c.type === 'error' ? 'healthError' : 'health',
          at: stableAt(id),
        });
      }
    } catch { /* ignore per-service */ }
  }));

  // Overseerr pending approvals.
  const seerrs = state.services.filter((s) => s.type === 'overseerr' && s.configured);
  await Promise.all(seerrs.map(async (svc) => {
    try {
      const data = await api.seerr(svc.key).get('request?filter=pending&take=10');
      for (const r of (data.results || [])) {
        const media = r.media || {};
        const title = media.title || media.name || `#${media.tmdbId || '?'}`;
        const id = `${svc.key}:approval:${r.id}`;
        events.push({
          id, svcKey: svc.key, label: svc.label, title,
          kind: 'approval', at: new Date(r.createdAt).getTime() || stableAt(id),
        });
      }
    } catch { /* ignore per-service */ }
  }));

  for (const f of listFailed()) {
    events.push({ id: `failedreq:${f.id}`, svcKey: f.svcKey, label: 'Seerr', title: f.title || 'Request', kind: 'reqfailed', at: f.at || Date.now() });
  }

  events.sort((a, b) => b.at - a.at);
  return events.slice(0, 40);
}
