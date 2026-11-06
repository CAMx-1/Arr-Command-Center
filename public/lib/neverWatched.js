// "Requested but never watched": Seerr requests that have been available for
// a while, checked against Tautulli's play history. Joins on the Plex rating
// key Seerr stores for each media item (media.ratingKey), so titles never
// have to match. Pure except loadNeverWatched().

const lower = (s) => String(s || '').trim().toLowerCase();
const DAY = 86400000;

export function requesterNames(by) {
  return new Set([by && by.plexUsername, by && by.username, by && by.displayName, by && by.email && String(by.email).split('@')[0]].filter(Boolean).map(lower));
}

export function playedBy(entry, by) {
  if (by && by.plexId && entry.user_id != null && String(entry.user_id) === String(by.plexId)) return true;
  const names = requesterNames(by);
  return names.has(lower(entry.user)) || names.has(lower(entry.friendly_name));
}

// requests: Seerr request objects; history: Map(ratingKey -> Tautulli entries
// or null when it couldn't be checked); library: Map('movie:tmdbId' |
// 'tv:tvdbId' -> [{ serviceKey, label, id, title, year, sizeOnDisk }]).
export function findNeverWatched({ requests, history, library = new Map(), now = Date.now(), minDays = 90 }) {
  const rows = [];
  const seen = new Set();
  for (const r of requests || []) {
    const m = r.media || {};
    if (m.status !== 5 && m.status !== 4) continue; // available / partly available
    const added = Date.parse(m.mediaAddedAt || r.updatedAt || r.createdAt);
    if (!Number.isFinite(added) || now - added < minDays * DAY) continue;
    const type = r.type === 'tv' || m.mediaType === 'tv' ? 'tv' : 'movie';
    const libKey = type === 'tv' ? `tv:${m.tvdbId}` : `movie:${m.tmdbId}`;
    const dedupe = `${libKey}:${lower(r.requestedBy && r.requestedBy.displayName)}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    const entries = m.ratingKey ? history.get(String(m.ratingKey)) : null;
    const matches = library.get(libKey) || [];
    const base = {
      requestId: r.id, mediaId: m.id, type, tmdbId: m.tmdbId, tvdbId: m.tvdbId, ratingKey: m.ratingKey || null,
      title: (matches[0] && matches[0].title) || m.title || `${type === 'tv' ? 'Show' : 'Movie'} ${m.tmdbId}`,
      year: matches[0] && matches[0].year,
      requestedBy: (r.requestedBy && (r.requestedBy.displayName || r.requestedBy.plexUsername || r.requestedBy.email)) || 'someone',
      requestedAt: r.createdAt, addedAt: new Date(added).toISOString(), daysAvailable: Math.floor((now - added) / DAY),
      matches, size: matches.reduce((s, x) => s + (Number(x.sizeOnDisk) || 0), 0),
    };
    if (!entries) { rows.push({ ...base, status: 'unknown', plays: 0, requesterPlays: 0, lastPlayed: null, watchers: [] }); continue; }
    const requesterPlays = entries.filter((e) => playedBy(e, r.requestedBy)).length;
    if (requesterPlays) continue; // the requester watched it: nothing to do
    const watchers = [...new Set(entries.map((e) => e.friendly_name || e.user).filter(Boolean))];
    const last = entries.reduce((t, e) => Math.max(t, Number(e.date) || 0), 0);
    rows.push({ ...base, status: entries.length ? 'others' : 'never', plays: entries.length, requesterPlays: 0, lastPlayed: last ? new Date(last * 1000).toISOString() : null, watchers });
  }
  const order = { never: 0, others: 1, unknown: 2 };
  return rows.sort((a, b) => order[a.status] - order[b.status] || b.daysAvailable - a.daysAvailable);
}

export function libraryIndex(instances) {
  const idx = new Map();
  for (const inst of instances) {
    for (const it of inst.items || []) {
      const key = inst.kind === 'tv' ? `tv:${it.tvdbId}` : `movie:${it.tmdbId}`;
      if ((inst.kind === 'tv' ? it.tvdbId : it.tmdbId) == null) continue;
      const list = idx.get(key) || [];
      list.push({ serviceKey: inst.serviceKey, label: inst.label, kind: inst.kind, id: it.id, title: it.title, year: it.year, monitored: it.monitored, sizeOnDisk: it.sizeOnDisk ?? (it.statistics && it.statistics.sizeOnDisk) ?? 0 });
      idx.set(key, list);
    }
  }
  return idx;
}

// seerr: { get }, tautulli: { get(cmd, params) } or null, arrs: [{ serviceKey,
// label, kind 'movie'|'tv', arr }]
export async function loadNeverWatched({ seerr, tautulli, arrs = [], minDays = 90, now = Date.now(), maxRequests = 2000 }) {
  const requests = [];
  for (let skip = 0; skip < maxRequests; skip += 100) {
    const page = await seerr.get(`request?take=100&skip=${skip}&filter=all&sort=added`);
    requests.push(...((page && page.results) || []));
    if (!page || !page.results || page.results.length < 100) break;
  }
  const instances = await Promise.all(arrs.map(async (a) => ({ ...a, items: await a.arr.get(a.kind === 'tv' ? 'series' : 'movie').catch(() => []) })));
  const library = libraryIndex(instances);
  const history = new Map();
  if (tautulli) {
    const due = [...new Map(requests.filter((r) => r.media && r.media.ratingKey && (r.media.status === 5 || r.media.status === 4)).map((r) => [String(r.media.ratingKey), r.type === 'tv' ? 'tv' : 'movie'])).entries()];
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(4, due.length) }, async () => {
      while (next < due.length) {
        const [key, type] = due[next++];
        try {
          const d = await tautulli.get('get_history', { [type === 'tv' ? 'grandparent_rating_key' : 'rating_key']: key, length: 200 });
          history.set(key, (d && d.data) || []);
        } catch { /* left unknown */ }
      }
    }));
  }
  return { rows: findNeverWatched({ requests, history, library, now, minDays }), requests: requests.length, hasTautulli: !!tautulli };
}

// What "Unmonitor" and "Delete" send to Radarr/Sonarr.
export function arrActionRequests(match, action) {
  const tv = match.kind === 'tv';
  if (action === 'unmonitor') return { method: 'PUT', path: tv ? 'series/editor' : 'movie/editor', body: tv ? { seriesIds: [match.id], monitored: false } : { movieIds: [match.id], monitored: false } };
  if (action === 'delete') return { method: 'DELETE', path: `${tv ? 'series' : 'movie'}/${match.id}?deleteFiles=true&addImportExclusion=false` };
  throw new Error(`Unknown action ${action}`);
}
