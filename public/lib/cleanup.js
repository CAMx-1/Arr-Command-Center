// Watch-based cleanup suggestions (pure; unit-tested).
//
// Joins Sonarr/Radarr library items with Tautulli watch history and ranks
// what's taking space without being watched: never watched since added, or
// not watched for N days. Matching uses Tautulli's grandparent/title + year
// (Tautulli history has no TMDB/TVDB ids) after normalizing punctuation.

const DAY = 86400000;
export const norm = (t) => String(t || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '');

// Tautulli get_history rows → Map(normalizedTitle -> { last, plays, users:Set })
export function watchIndex(rows) {
  const idx = new Map();
  for (const r of rows || []) {
    const isEp = r.media_type === 'episode';
    const raw = isEp ? (r.grandparent_title || String(r.full_title || '').split(' - ')[0]) : (r.title || r.full_title);
    const key = norm(raw);
    if (!key) continue;
    const when = Number(r.stopped || r.date || r.started) * 1000;
    const year = Number(r.year) || null;
    for (const k of year && !isEp ? [key, `${key}|${year}`] : [key]) {
      const e = idx.get(k) || { last: 0, plays: 0, users: new Set() };
      e.last = Math.max(e.last, when || 0);
      e.plays += 1;
      if (r.user || r.friendly_name) e.users.add(r.friendly_name || r.user);
      idx.set(k, e);
    }
  }
  return idx;
}

function addedAt(item) {
  const t = Date.parse(item.added || item.movieFile?.dateAdded || '');
  return Number.isFinite(t) ? t : null;
}
function sizeOf(item) { return Number(item.sizeOnDisk ?? item.statistics?.sizeOnDisk) || 0; }

// libraries: [{ svc, items }]; options: { staleDays, minAgeDays, now }
// Returns suggestions sorted by size (desc).
export function cleanupSuggestions(libraries, history, { staleDays = 180, minAgeDays = 60, now = Date.now(), keepTags = [] } = {}) {
  const idx = history instanceof Map ? history : watchIndex(history);
  const out = [];
  for (const { svc, items } of libraries) {
    for (const item of items || []) {
      const size = sizeOf(item);
      if (!size) continue; // nothing to free
      if (keepTags.length && (item.tags || []).some((t) => keepTags.includes(t))) continue;
      const added = addedAt(item);
      const ageDays = added ? Math.floor((now - added) / DAY) : null;
      const k = norm(item.title);
      const w = (svc.type === 'radarr' && item.year && idx.get(`${k}|${item.year}`)) || idx.get(k) || null;
      let reason = null;
      if (!w || !w.plays) {
        if (ageDays == null || ageDays >= minAgeDays) reason = 'never';
      } else {
        const idle = Math.floor((now - w.last) / DAY);
        if (idle >= staleDays) reason = 'stale';
      }
      if (!reason) continue;
      out.push({
        svc, item, size, reason, ageDays,
        lastWatched: w && w.last ? w.last : null,
        plays: w ? w.plays : 0,
        users: w ? [...w.users] : [],
        kind: svc.type === 'sonarr' ? 'series' : 'movie',
      });
    }
  }
  return out.sort((a, b) => b.size - a.size);
}

export function totalSize(list) { return list.reduce((s, x) => s + x.size, 0); }
