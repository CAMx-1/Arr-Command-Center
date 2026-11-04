// Path doctor: pure logic behind the Sonarr/Radarr "Fix paths" tool.
//
// The tool works out which library items point at folders that no longer
// exist, looks for those folders on the disks Sonarr/Radarr can see (through
// their own filesystem API, so paths are what *they* see, e.g. inside Docker),
// and proposes a new path per item. Nothing here talks to the network; the UI
// passes in folder listings and gets plans back, which keeps it testable.

// ------------------------------------------------------------- path helpers
export function sepOf(path) {
  const p = String(path || '');
  return /^[A-Za-z]:[\\/]|^\\\\/.test(p) || (p.includes('\\') && !p.includes('/')) ? '\\' : '/';
}
export function trimSep(path) {
  const p = String(path || '');
  if (/^[A-Za-z]:[\\/]?$/.test(p)) return p.slice(0, 2) + '\\';
  if (p === '/' || p === '\\') return p;
  return p.replace(/[\\/]+$/, '');
}
export function splitPath(path) {
  const p = trimSep(path);
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  if (i < 0) return { parent: '', name: p };
  const parent = p.slice(0, i) || p.slice(0, 1);
  return { parent: /^[A-Za-z]:$/.test(parent) ? `${parent}\\` : parent, name: p.slice(i + 1) };
}
export function joinPath(dir, name, sep = sepOf(dir)) {
  const d = trimSep(dir);
  return d.endsWith('/') || d.endsWith('\\') ? `${d}${name}` : `${d}${sep}${name}`;
}
// Comparison key: case-insensitive, separator-agnostic, no trailing separator.
export function pathKey(path) {
  return trimSep(path).replace(/\\/g, '/').toLowerCase();
}
// Directory listing URL argument: Sonarr/Radarr list a folder's children when
// the path ends with a separator.
export function listingArg(dir, sep = sepOf(dir)) {
  const d = trimSep(dir);
  return d.endsWith(sep) ? d : `${d}${sep}`;
}

// Mount points that never hold media.
const SYSTEM_DIRS = /^\/(proc|sys|dev|run|etc|boot|usr|bin|sbin|lib|lib64|var|tmp|snap|opt|srv|root|app|config|System|Library|private|cores)(\/|$)/i;
export function isSystemPath(path) {
  const k = pathKey(path);
  return SYSTEM_DIRS.test(k) || /^[a-z]:\/(windows|program files|programdata)(\/|$)/i.test(k);
}

// ---------------------------------------------------------- name matching
// "Dune: Part Two (2024)" and "dune.part.two.2024.2160p.web" both reduce to
// tokens; a folder matches a movie when it starts with the title tokens and
// mentions the year.
export function tokens(text) {
  return String(text || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ').replace(/['’]/g, '').split(/[^a-z0-9]+/).filter(Boolean);
}

// Matching works on prepared records so big libraries stay fast: tokens are
// computed once per item and once per folder.
export function prepItem(item) {
  const want = splitPath(item.path).name;
  const w = tokens(want);
  const title = tokens(item.title);
  return { item, wantLower: want.toLowerCase(), wantJoined: w.join(' '), title, first: title[0] || w[0] || '', year: item.year ? String(item.year) : '' };
}
export function prepFolder(name) {
  const t = tokens(name);
  return { lower: String(name).toLowerCase(), joined: t.join(' '), tokens: t };
}

// 100 exact folder name, 90 same tokens, 75 title tokens first (+ year when
// known), 80/60 title only (no year known), 0 no match.
export function scorePrepared(f, it) {
  if (f.lower === it.wantLower) return 100;
  if (it.wantJoined && f.joined === it.wantJoined) return 90;
  const t = it.title;
  if (!t.length || f.tokens.length < t.length) return 0;
  for (let i = 0; i < t.length; i += 1) if (f.tokens[i] !== t[i]) return 0;
  if (it.year) return f.tokens.includes(it.year) ? 75 : 0;
  return f.tokens.length === t.length ? 80 : 60;
}

export function matchScore(folderName, item) {
  return scorePrepared(prepFolder(folderName), prepItem(item));
}

export function matchLabel(score) {
  return score >= 100 ? 'same folder name' : score >= 90 ? 'same name' : score >= 75 ? 'similar name' : 'title only';
}

// ---------------------------------------------------------------- scanning
// listings: Map(pathKey(dir) -> [{ name, path }]) for directories that were
// listed. A directory that couldn't be listed is simply absent.
export function existsIn(listings, path) {
  const { parent, name } = splitPath(path);
  const children = listings.get(pathKey(parent));
  if (!children) return false;
  const n = name.toLowerCase();
  return children.some((c) => c.name.toLowerCase() === n);
}

// Which items are missing on disk. Items whose parent folder couldn't be
// listed at all are missing too.
export function findMissing(items, listings) {
  return items.filter((it) => it && it.path && !existsIn(listings, it.path));
}

// Folder index from listings of candidate directories: every child folder is
// a place a missing item might have moved to.
export function buildIndex(listings, { exclude = [] } = {}) {
  const skip = new Set(exclude.map(pathKey));
  const all = [];
  for (const children of listings.values()) {
    for (const c of children) {
      if (!c || !c.path || skip.has(pathKey(c.path))) continue;
      all.push({ name: c.name, path: trimSep(c.path), parent: splitPath(c.path).parent });
    }
  }
  const seen = new Set();
  return all.filter((e) => (seen.has(pathKey(e.path)) ? false : seen.add(pathKey(e.path))));
}

// For each missing item, the candidate folders, best first. Folders already
// used by another library item are not offered (they belong to that item).
export function findCandidates(missing, index, { usedPaths = [] } = {}) {
  const used = new Set(usedPaths.map(pathKey));
  // Bucket folders by exact name and by first token; an item only looks at
  // folders that could possibly match it.
  const byLower = new Map();
  const byFirst = new Map();
  const add = (m, k, v) => { if (!k) return; if (!m.has(k)) m.set(k, []); m.get(k).push(v); };
  for (const e of index) {
    if (used.has(pathKey(e.path))) continue;
    const f = { e, p: prepFolder(e.name) };
    add(byLower, f.p.lower, f);
    add(byFirst, f.p.tokens[0], f);
  }
  const out = new Map();
  for (const it of missing) {
    const pi = prepItem(it);
    const pool = new Set([...(byLower.get(pi.wantLower) || []), ...(byFirst.get(pi.first) || []), ...(byFirst.get(pi.wantJoined.split(' ')[0]) || [])]);
    const list = [];
    for (const f of pool) {
      const score = scorePrepared(f.p, pi);
      if (score) list.push({ ...f.e, score });
    }
    list.sort((a, b) => b.score - a.score || a.path.length - b.path.length);
    out.set(it.id, list);
  }
  return out;
}

// Choose one candidate per item. When several folders match equally, prefer
// the parent that other items from the same old parent moved to (a drive moved
// as a whole), so e.g. two "Severance" folders resolve to the right drive.
export function choosePlan(missing, candidates) {
  const vote = new Map(); // oldParentKey -> Map(newParent -> count)
  const tally = (oldP, newP) => {
    const k = pathKey(oldP);
    if (!vote.has(k)) vote.set(k, new Map());
    const m = vote.get(k);
    m.set(newP, (m.get(newP) || 0) + 1);
  };
  for (const it of missing) {
    const list = candidates.get(it.id) || [];
    if (list.length === 1 || (list.length > 1 && list[0].score > list[1].score)) tally(splitPath(it.path).parent, list[0].parent);
  }
  const plan = [];
  const taken = new Set();
  for (const it of missing) {
    const list = (candidates.get(it.id) || []).filter((c) => !taken.has(pathKey(c.path)));
    if (!list.length) { plan.push({ item: it, status: 'not-found', candidates: [] }); continue; }
    const top = list.filter((c) => c.score === list[0].score);
    let pick = top[0];
    let reason = '';
    if (top.length > 1) {
      const votes = vote.get(pathKey(splitPath(it.path).parent)) || new Map();
      const ranked = [...top].sort((a, b) => (votes.get(b.parent) || 0) - (votes.get(a.parent) || 0));
      const best = votes.get(ranked[0].parent) || 0;
      const second = votes.get(ranked[1].parent) || 0;
      pick = ranked[0];
      reason = best > second ? 'same drive as its neighbours' : '';
    }
    const ambiguous = top.length > 1 && !reason;
    taken.add(pathKey(pick.path));
    // Weak matches (title only, no year) are offered but not ticked.
    const status = ambiguous ? 'ambiguous' : pick.score < 75 ? 'review' : 'found';
    plan.push({
      item: it, status, newPath: pick.path, newRoot: pick.parent,
      score: pick.score, reason: reason || matchLabel(pick.score), candidates: list,
    });
  }
  return plan;
}

// Prefix mapping for items the search couldn't place (manual "old → new").
export function remapPath(path, from, to) {
  if (!path || !from) return null;
  const f = pathKey(from);
  const p = pathKey(path);
  if (p !== f && !p.startsWith(`${f}/`)) return null;
  const rest = trimSep(path).slice(trimSep(from).length).replace(/^[\\/]+/, '');
  const sep = sepOf(to);
  return rest ? joinPath(to, rest.split(/[\\/]+/).join(sep), sep) : trimSep(to);
}

// Summary of how drives moved: "C:\Media\TV → /Volumes/Media/TV (12)".
export function moveSummary(plan) {
  const m = new Map();
  for (const p of plan) {
    if (!p.newPath) continue;
    const key = `${splitPath(p.item.path).parent}\u0000${p.newRoot}`;
    m.set(key, (m.get(key) || 0) + 1);
  }
  return [...m].map(([k, count]) => { const [from, to] = k.split('\u0000'); return { from, to, count }; }).sort((a, b) => b.count - a.count);
}

// Root folders to add (new parents that aren't roots yet) and to remove
// (inaccessible roots no item uses any more).
export function rootChanges(roots, items, changes) {
  const rootKeys = new Set((roots || []).map((r) => pathKey(r.path)));
  const finalPaths = new Map((items || []).map((it) => [it.id, it.path]));
  for (const c of changes) finalPaths.set(c.id, c.newPath);
  const add = [...new Set(changes.map((c) => trimSep(c.newRoot)))].filter((p) => p && !rootKeys.has(pathKey(p)));
  const used = (root) => [...finalPaths.values()].some((p) => p && (pathKey(p) === pathKey(root) || pathKey(p).startsWith(`${pathKey(root)}/`)));
  const remove = (roots || []).filter((r) => r.accessible === false && !used(r.path));
  return { add, remove };
}

// Undo record kept per service in localStorage.
export function undoRecord(serviceKey, changes, now = Date.now()) {
  return { version: 1, service: serviceKey, at: now, changes: changes.map((c) => ({ id: c.id, title: c.title, oldPath: c.oldPath, oldRoot: c.oldRoot, newPath: c.newPath })) };
}

// Undo history: newest first, at most `max` fixes.
export function pushUndo(history, record, max = 5) {
  const list = Array.isArray(history) ? history.filter((r) => r && r.version === 1 && Array.isArray(r.changes) && r.changes.length) : [];
  return [record, ...list].slice(0, max);
}

// Rows for a CSV of a Fix paths plan.
export const PATH_CSV_HEADERS = ['Title', 'Year', 'Status', 'Reason', 'Old path', 'New path', 'Candidates'];
export function planCsvRows(rows) {
  return (rows || []).map((r) => [r.item.title, r.item.year || '', r.status, r.reason || '', r.item.path, r.newPath || '', (r.candidates || []).length]);
}
