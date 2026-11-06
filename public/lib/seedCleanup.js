// Seeding clean-up for qBittorrent: finished torrents that have reached a
// ratio or seeding time, per category or tracker, with a preview before
// anything is removed. Torrents tagged "keep" are never touched. Pure except
// the loader.

export const DEFAULT_RULES = { ratio: 2, days: 14, mode: 'either', categories: [], trackers: [], deleteFiles: false, keepTag: 'keep' };

export const trackerHost = (url) => { try { return new URL(String(url)).hostname.replace(/^(tracker|announce)\./, ''); } catch { return ''; } };
const finished = (t) => Number(t.progress) >= 1;
const tagsOf = (t) => String(t.tags || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);

export function evaluate(t, rules = DEFAULT_RULES, now = Date.now()) {
  const days = Number(t.seeding_time) ? Number(t.seeding_time) / 86400 : t.completion_on ? Math.max(0, (now / 1000 - Number(t.completion_on)) / 86400) : 0;
  const ratio = Number(t.ratio) || 0;
  const hitRatio = rules.ratio > 0 && ratio >= rules.ratio;
  const hitTime = rules.days > 0 && days >= rules.days;
  // "both": every limit that's set must be reached (a 0 limit is ignored).
  const met = rules.mode === 'both' ? (rules.ratio > 0 || rules.days > 0) && (!(rules.ratio > 0) || hitRatio) && (!(rules.days > 0) || hitTime) : hitRatio || hitTime;
  const why = [hitRatio ? `ratio ${ratio.toFixed(2)} ≥ ${rules.ratio}` : null, hitTime ? `seeded ${Math.floor(days)} days ≥ ${rules.days}` : null].filter(Boolean);
  return { met, days: Math.floor(days), ratio, why };
}

// Returns { remove, keep } with a reason for each kept torrent.
export function planCleanup(torrents, rules = DEFAULT_RULES, now = Date.now()) {
  const remove = []; const keep = [];
  const cats = new Set((rules.categories || []).map(String));
  const trks = new Set((rules.trackers || []).map(String));
  for (const t of torrents || []) {
    const host = trackerHost(t.tracker);
    const base = { hash: t.hash, name: t.name, size: Number(t.size) || 0, category: t.category || '', tracker: host };
    if (!finished(t)) continue;
    if (rules.keepTag && tagsOf(t).includes(String(rules.keepTag).toLowerCase())) { keep.push({ ...base, reason: `tagged “${rules.keepTag}”` }); continue; }
    if (cats.size && !cats.has(t.category || '')) { keep.push({ ...base, reason: 'other category' }); continue; }
    if (trks.size && !trks.has(host)) { keep.push({ ...base, reason: 'other tracker' }); continue; }
    const e = evaluate(t, rules, now);
    if (e.met) remove.push({ ...base, ...e });
    else keep.push({ ...base, ...e, reason: `not there yet (ratio ${e.ratio.toFixed(2)}, ${e.days} days)` });
  }
  return { remove, keep, bytes: remove.reduce((n, r) => n + r.size, 0) };
}

export function options(torrents) {
  const done = (torrents || []).filter(finished);
  return {
    categories: [...new Set(done.map((t) => t.category || ''))].sort(),
    trackers: [...new Set(done.map((t) => trackerHost(t.tracker)).filter(Boolean))].sort(),
  };
}

// qBittorrent's delete takes hashes joined by "|".
export const deleteParams = (hashes, deleteFiles) => ({ hashes: hashes.join('|'), deleteFiles: deleteFiles ? 'true' : 'false' });
