// Duplicate engine for Sonarr/Radarr (pure; no network).
//
// Library duplicates are grouped by shared external ids (TMDB / TVDB / IMDb),
// which catches copies whose titles differ ("Dune: Part Two" vs "Dune Part
// Two"), and, as a weaker signal, by the same title and year when ids are
// missing or disagree. Each group says how sure it is and why.
//
// Within a group, copies are ranked so the one to keep comes first: on disk
// beats missing, then more of the content (episodes / a movie file), better
// quality, larger, monitored, and added earlier. Every rank comes with the
// reasons, so the suggestion can be read and overridden.
//
// Deleting is guarded: an entry that shares its folder with a copy being kept
// must never be deleted with files, because that would delete the kept copy's
// files too.
import { tokens, pathKey, splitPath, prepItem, prepFolder, scorePrepared } from './pathDoctor.js';

const ID_FIELDS = { movie: ['tmdbId', 'imdbId'], series: ['tvdbId', 'tmdbId', 'imdbId'] };

export function titleKey(it) {
  const t = tokens(it && it.title).filter((w) => w !== 'the' && w !== 'a' && w !== 'an');
  return t.length ? `${t.join(' ')}|${(it && it.year) || ''}` : '';
}

const ID_LABEL = { tmdbId: 'TMDB', tvdbId: 'TVDB', imdbId: 'IMDb' };
const idVal = (v) => (v && v !== 0 && v !== '0' ? String(v).toLowerCase() : '');

function unionFind(n) {
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  return { find, union: (a, b) => { const ra = find(a); const rb = find(b); if (ra !== rb) parent[rb] = ra; return ra; } };
}

// Groups of library entries that are the same title.
//  1. Entries sharing any external id are the same title ("certain").
//  2. Entries with the same title and year are joined too ("possible"),
//     unless their ids say they're different (e.g. two films with the same
//     name and year, or a remake).
export function groupDuplicates(items, kind) {
  const list = (items || []).filter(Boolean);
  const fields = ID_FIELDS[kind] || [];
  const byId = unionFind(list.length);
  const seen = new Map();
  list.forEach((it, i) => {
    for (const f of fields) {
      const v = idVal(it[f]);
      if (!v) continue;
      const k = `${f}:${v}`;
      if (seen.has(k)) byId.union(seen.get(k), i); else seen.set(k, i);
    }
  });
  // Merged groups and the ids each holds; a title link is only made when the
  // two groups' ids don't contradict each other (checked on the merged groups,
  // so an id-less entry can't bridge two different titles).
  const all = unionFind(list.length);
  const ids = new Map();
  list.forEach((it, i) => all.union(byId.find(i), i));
  list.forEach((it, i) => {
    const r = all.find(i);
    if (!ids.has(r)) ids.set(r, Object.fromEntries(fields.map((f) => [f, new Set()])));
    for (const f of fields) { const v = idVal(it[f]); if (v) ids.get(r)[f].add(v); }
  });
  const compatible = (a, b) => fields.every((f) => {
    const x = ids.get(a)[f]; const y = ids.get(b)[f];
    return !x.size || !y.size || [...x].some((v) => y.has(v));
  });
  const byTitle = new Map();
  list.forEach((it, i) => { const k = titleKey(it); if (k) { if (!byTitle.has(k)) byTitle.set(k, []); byTitle.get(k).push(i); } });
  for (const idxs of byTitle.values()) {
    // Groups with ids first, so id-less entries attach to them.
    const ordered = [...idxs].sort((a, b) => fields.some((f) => idVal(list[b][f])) - fields.some((f) => idVal(list[a][f])));
    for (let a = 0; a < ordered.length; a += 1) {
      for (let b = a + 1; b < ordered.length; b += 1) {
        const ra = all.find(ordered[a]); const rb = all.find(ordered[b]);
        if (ra === rb || !compatible(ra, rb)) continue;
        const merged = all.union(ra, rb);
        const other = merged === ra ? rb : ra;
        for (const f of fields) for (const v of ids.get(other)[f]) ids.get(merged)[f].add(v);
      }
    }
  }
  const groups = new Map();
  list.forEach((it, i) => { const r = all.find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(i); });
  return [...groups.values()].filter((g) => g.length > 1).map((idxs) => {
    const group = idxs.map((i) => list[i]);
    const certain = new Set(idxs.map((i) => byId.find(i))).size === 1;
    const shared = fields.filter((f) => { const vals = group.map((it) => idVal(it[f])); return vals.every(Boolean) && new Set(vals).size === 1; });
    const paths = group.map((it) => pathKey(it.path || ''));
    return {
      key: group.map((it) => it.id).sort((a, b) => a - b).join('-'),
      title: `${group[0].title}${group[0].year ? ` (${group[0].year})` : ''}`,
      items: group,
      confidence: certain ? 'certain' : 'possible',
      why: certain ? (shared.length ? `same ${shared.map((f) => ID_LABEL[f]).join(' and ')} id` : 'linked by shared ids') : 'same title and year; ids are missing',
      sharedPath: paths.some((p, i) => p && paths.indexOf(p) !== i),
    };
  }).sort((a, b) => (b.confidence === 'certain') - (a.confidence === 'certain') || a.title.localeCompare(b.title));
}

// ------------------------------------------------------------- ranking
const RES = { 2160: 4, 1080: 3, 720: 2, 576: 1, 480: 1 };
export function qualityOf(it, kind) {
  if (kind === 'series') return null;
  const q = it.movieFile && it.movieFile.quality && it.movieFile.quality.quality;
  if (!q) return null;
  return { name: q.name || '', resolution: Number(q.resolution) || 0, rank: RES[Number(q.resolution)] || 0 };
}
export const hasContent = (it, kind) => (kind === 'series'
  ? ((it.statistics && it.statistics.episodeFileCount) || 0) > 0
  : !!it.hasFile || !!it.movieFile);
export const sizeOf = (it, kind) => (kind === 'series' ? ((it.statistics && it.statistics.sizeOnDisk) || 0) : (it.sizeOnDisk || (it.movieFile && it.movieFile.size) || 0));
const episodes = (it) => ((it.statistics && it.statistics.episodeFileCount) || 0);

// onDisk: Map(item.id -> true/false/undefined) from a folder check.
export function rankCopies(group, kind, { onDisk = new Map() } = {}) {
  const score = (it) => {
    const q = qualityOf(it, kind);
    return [
      onDisk.get(it.id) === false ? 0 : 1,
      hasContent(it, kind) ? 1 : 0,
      kind === 'series' ? episodes(it) : 0,
      q ? q.rank : 0,
      (it.movieFile && it.movieFile.customFormatScore) || 0,
      sizeOf(it, kind),
      it.monitored ? 1 : 0,
      -(Date.parse(it.added || '') || Infinity),
      -it.id,
    ];
  };
  const ranked = group.map((it) => ({ it, s: score(it) })).sort((a, b) => {
    for (let i = 0; i < a.s.length; i += 1) if (b.s[i] !== a.s[i]) return b.s[i] - a.s[i];
    return 0;
  }).map((x) => x.it);
  const keep = ranked[0];
  return ranked.map((it, i) => ({ item: it, keep: i === 0, reasons: reasonsFor(it, keep, kind, onDisk) }));
}

function reasonsFor(it, keep, kind, onDisk) {
  const r = [];
  if (onDisk.get(it.id) === false) r.push({ text: 'folder missing on disk', good: false });
  else if (onDisk.get(it.id) === true) r.push({ text: 'folder on disk', good: true });
  if (kind === 'series') r.push({ text: `${episodes(it)} episode files`, good: episodes(it) > 0 && episodes(it) >= episodes(keep) });
  else r.push({ text: hasContent(it, kind) ? 'has the movie file' : 'no movie file', good: hasContent(it, kind) });
  const q = qualityOf(it, kind);
  if (q && q.name) r.push({ text: q.name, good: !qualityOf(keep, kind) || q.rank >= qualityOf(keep, kind).rank });
  r.push({ text: it.monitored ? 'monitored' : 'not monitored', good: !!it.monitored });
  return r;
}

// Default selection: every copy except the suggested keeper — but only in
// groups we're sure about. "Possible" groups start unselected.
export function defaultSelection(groupsRanked) {
  const sel = new Set();
  for (const g of groupsRanked) if (g.confidence === 'certain') for (const c of g.ranked) if (!c.keep) sel.add(c.item.id);
  return sel;
}

// Safe delete plan. Returns per-id { deleteFiles } and warnings.
export function deletePlan(groupsRanked, selected, { deleteFiles = false } = {}) {
  const plan = [];
  const warnings = [];
  for (const g of groupsRanked) {
    const chosen = g.ranked.filter((c) => selected.has(c.item.id));
    if (!chosen.length) continue;
    const kept = g.ranked.filter((c) => !selected.has(c.item.id));
    if (!kept.length) warnings.push({ type: 'all-copies', title: g.title });
    const keptPaths = new Set(kept.map((c) => pathKey(c.item.path || '')));
    for (const c of chosen) {
      const shares = c.item.path && keptPaths.has(pathKey(c.item.path));
      if (shares && deleteFiles) warnings.push({ type: 'shared-folder', title: g.title, path: c.item.path });
      plan.push({ id: c.item.id, title: g.title, path: c.item.path, deleteFiles: deleteFiles && !shares });
    }
  }
  return { plan, warnings };
}

// ------------------------------------------------- copies outside the app
// Folders inside root folders that no item uses (Sonarr/Radarr's
// unmappedFolders) whose name matches a library item: a second copy the app
// doesn't manage.
export function findUntrackedCopies(items, roots) {
  const prepped = (items || []).filter((it) => it && it.title).map(prepItem);
  const byFirst = new Map();
  for (const p of prepped) { if (!byFirst.has(p.first)) byFirst.set(p.first, []); byFirst.get(p.first).push(p); }
  const out = [];
  for (const r of roots || []) {
    for (const f of r.unmappedFolders || []) {
      const name = f.name || splitPath(f.path || '').name;
      const pf = prepFolder(name);
      let best = null;
      for (const p of byFirst.get(pf.tokens[0]) || []) {
        const s = scorePrepared(pf, p);
        if (s >= 75 && (!best || s > best.score)) best = { item: p.item, score: s };
      }
      if (best) out.push({ item: best.item, score: best.score, folder: { name, path: f.path || `${r.path}/${name}` }, root: r.path });
    }
  }
  return out;
}

// ---------------------------------------------------- "not a duplicate"
// The user's "not a duplicate" choices: a set of group keys (sorted item ids).
// A group comes back if a new copy joins it, because its key changes.
export function splitIgnored(groups, ignored) {
  const set = ignored instanceof Set ? ignored : new Set(ignored || []);
  return { shown: groups.filter((g) => !set.has(g.key)), hidden: groups.filter((g) => set.has(g.key)) };
}

// Rows for a CSV report of the scan.
export const DUP_CSV_HEADERS = ['Kind', 'Title', 'Confidence', 'Reason', 'Path', 'Suggested', 'On disk', 'Has files', 'Quality', 'Size (bytes)', 'Monitored'];
export function duplicateCsvRows(scan, kind) {
  const rows = [];
  for (const g of scan.groups || []) {
    for (const c of g.ranked || []) {
      const q = qualityOf(c.item, kind);
      rows.push(['entry', g.title, g.confidence, g.why, c.item.path || '', c.keep ? 'keep' : 'extra',
        scan.onDisk && scan.onDisk.get(c.item.id) === false ? 'no' : 'yes', hasContent(c.item, kind) ? 'yes' : 'no',
        q ? q.name : '', sizeOf(c.item, kind), c.item.monitored ? 'yes' : 'no']);
    }
  }
  for (const u of scan.untracked || []) {
    rows.push(['unmanaged copy', `${u.item.title}${u.item.year ? ` (${u.item.year})` : ''}`, '', `managed copy: ${u.item.path}`, u.folder.path, '',
      'yes', u.videoFiles ? 'yes' : 'no', '', '', '']);
  }
  for (const x of scan.crossInstance || []) {
    rows.push(['other instance', `${x.item.title}${x.item.year ? ` (${x.item.year})` : ''}`, '', x.service.label, x.other.path || '', '', '', '', '', '', '']);
  }
  return rows;
}
