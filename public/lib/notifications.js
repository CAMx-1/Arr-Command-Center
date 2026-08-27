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
};
export function notifKind(kind) { return KIND[kind] || { label: kind, cls: 'muted' }; }

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

  for (const f of listFailed()) {
    events.push({ id: `failedreq:${f.id}`, svcKey: f.svcKey, label: 'Seerr', title: f.title || 'Request', kind: 'reqfailed', at: f.at || Date.now() });
  }

  events.sort((a, b) => b.at - a.at);
  return events.slice(0, 40);
}
