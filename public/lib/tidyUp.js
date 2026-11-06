// Library tidy-up for Sonarr/Radarr: entries that cost searches or clutter
// the library for no benefit, each with a bulk fix. Pure except the loader.

const YEAR = 365.25 * 86400000;

export const RULES = {
  'ended-complete': { title: 'Ended shows still monitored', why: 'Every episode is downloaded and the show has ended, so monitoring only adds work.', fix: 'unmonitor' },
  'old-missing': { title: 'Missing for 2+ years after release', why: 'Monitored but never found. Each search costs indexer hits and usually fails again.', fix: 'unmonitor' },
  'dead-entry': { title: 'Unmonitored with no files', why: 'Not wanted and nothing on disk: these entries only clutter the library.', fix: 'delete' },
  'no-profile': { title: 'Quality profile missing', why: 'Their profile was deleted, so searches and upgrades behave unpredictably.', fix: 'profile' },
  'no-root': { title: 'Root folder missing', why: 'Their root folder isn’t in this app any more (or isn’t reachable).', fix: 'paths' },
};

// When it became watchable at home: the latest known release date, or the
// end of its year when the app has no dates.
const releaseTime = (m) => {
  const dates = [m.digitalRelease, m.physicalRelease, m.inCinemas].map((d) => Date.parse(d)).filter(Number.isFinite);
  return dates.length ? Math.max(...dates) : (m.year ? Date.UTC(m.year, 11, 31) : 0);
};

export function findTidyUp({ kind, items, roots = [], profiles = [], now = Date.now() }) {
  const rootPaths = new Set(roots.filter((r) => r.accessible !== false).map((r) => String(r.path).replace(/[\\/]+$/, '').toLowerCase()));
  const profileIds = new Set(profiles.map((p) => p.id));
  const out = Object.fromEntries(Object.keys(RULES).map((k) => [k, []]));
  for (const it of items || []) {
    const s = it.statistics || {};
    const files = kind === 'series' ? Number(s.episodeFileCount) || 0 : (it.hasFile ? 1 : 0);
    if (kind === 'series' && it.monitored && it.status === 'ended' && files > 0 && files >= (Number(s.episodeCount) || Infinity)) out['ended-complete'].push(it);
    if (kind === 'movie' && it.monitored && !it.hasFile && it.status === 'released' && releaseTime(it) && now - releaseTime(it) > 2 * YEAR - 86400000) out['old-missing'].push(it);
    if (!it.monitored && files === 0) out['dead-entry'].push(it);
    if (it.qualityProfileId != null && profiles.length && !profileIds.has(it.qualityProfileId)) out['no-profile'].push(it);
    const root = String(it.rootFolderPath || '').replace(/[\\/]+$/, '').toLowerCase();
    if (root && roots.length && !rootPaths.has(root)) out['no-root'].push(it);
  }
  return Object.entries(out).filter(([, list]) => list.length).map(([id, list]) => ({ id, ...RULES[id], items: list }));
}

export function fixRequest(kind, rule, ids, { profileId } = {}) {
  const key = kind === 'series' ? 'seriesIds' : 'movieIds';
  const path = kind === 'series' ? 'series/editor' : 'movie/editor';
  if (rule === 'unmonitor') return { method: 'PUT', path, body: { [key]: ids, monitored: false } };
  if (rule === 'profile') return { method: 'PUT', path, body: { [key]: ids, qualityProfileId: Number(profileId) } };
  if (rule === 'delete') return { method: 'DELETE', path, body: { [key]: ids, deleteFiles: false, addImportExclusion: false } };
  throw new Error(`No bulk fix for ${rule}`);
}

export async function loadTidyUp(arr, kind) {
  const [items, roots, profiles] = await Promise.all([arr.get(kind === 'series' ? 'series' : 'movie'), arr.get('rootfolder').catch(() => []), arr.get('qualityprofile').catch(() => [])]);
  return { groups: findTidyUp({ kind, items, roots, profiles }), profiles, total: (items || []).length };
}
