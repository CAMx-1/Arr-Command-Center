// Free-up-space planner: what could go to win back disk space, ranked by how
// little it's likely to be missed. Nothing is deleted here: the browser
// deletes the titles you pick through Sonarr/Radarr, after you confirm.
//
// Watch data comes from Tautulli (every user's plays) joined to the apps
// through Plex (TMDB/TVDB ids, then the folder), with a title match when Plex
// isn't set up. Maintainerr exclusions and a "keep" tag in the app are always
// respected, and titles Maintainerr is already going to remove are left out.
import { serviceGet as defaultGet } from './proxy.js';
import { groupHistory } from '../public/lib/transcodes.js';
import { plexIds } from './plex.js';

const DAY = 86400000;
export const LIMITS = { neverDays: 90, staleDays: 365, recentDays: 90, newDays: 30, largeBytes: 20 * 2 ** 30 };
export const KEEP_TAG = 'keep';
const MAX_CANDIDATES = 400;

const normPath = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
const folderName = (p) => normPath(p).split('/').pop();
const parentDir = (p) => normPath(p).replace(/\/[^/]*$/, '');
const normTitle = (s) => String(s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');
const under = (child, parent) => { const c = normPath(child); const p = normPath(parent); return !!p && (c === p || c.startsWith(`${p}/`)); };

// ------------------------------------------------------------ joining
// items: [{ kind: 'movie'|'show', tmdbId, tvdbId, title, year, path, … }]
// Adds ratingKey (Plex), plays, lastPlayed (ms), transcodeShare (%), watchKnown.
export function joinWatch(items, { plexItems = null, tautRows = null, transcodeGroups = [] } = {}) {
  const byId = new Map(); const byFolder = new Map(); const byName = new Map();
  for (const p of plexItems || []) {
    const kind = p.type === 'show' ? 'show' : p.type === 'movie' ? 'movie' : null;
    if (!kind) continue;
    const ids = plexIds(p);
    if (kind === 'movie' && ids.tmdb) byId.set(`movie:${ids.tmdb}`, p);
    if (kind === 'show' && ids.tvdb) byId.set(`show:${ids.tvdb}`, p);
    const folders = kind === 'show' ? (p.Location || []).map((l) => l.path) : (p.Media || []).flatMap((m) => (m.Part || []).map((x) => parentDir(x.file)));
    for (const f of folders.filter(Boolean)) {
      byFolder.set(`${kind}:${normPath(f)}`, p);
      const k = `${kind}:${folderName(f)}`; byName.set(k, byName.has(k) && byName.get(k) !== p ? null : p);
    }
  }
  const rows = new Map(); const rowsByTitle = new Map();
  for (const r of tautRows || []) {
    rows.set(String(r.rating_key), r);
    const kind = r.media_type === 'show' || r.section_type === 'show' ? 'show' : 'movie';
    const k = `${kind}:${normTitle(r.title)}:${kind === 'movie' ? (r.year || '') : ''}`;
    rowsByTitle.set(k, rowsByTitle.has(k) ? null : r);
  }
  const share = new Map(transcodeGroups.map((g) => [String(g.ratingKey), g.share]));
  return items.map((it) => {
    // Ids first, then the folder (survives a wrong Plex match), then its name.
    const p = byId.get(it.kind === 'movie' ? `movie:${it.tmdbId}` : `show:${it.tvdbId}`)
      || byFolder.get(`${it.kind}:${normPath(it.path)}`) || byName.get(`${it.kind}:${folderName(it.path)}`) || null;
    const ratingKey = p ? String(p.ratingKey) : null;
    let row = ratingKey ? rows.get(ratingKey) : null;
    if (!row && tautRows) row = rowsByTitle.get(`${it.kind}:${normTitle(it.title)}:${it.kind === 'movie' ? (it.year || '') : ''}`) || null;
    const watchKnown = !!row;
    return {
      ...it, ratingKey: ratingKey || (row ? String(row.rating_key) : null), inPlex: !!p || !!row,
      watchKnown, plays: watchKnown ? Number(row.play_count) || 0 : null,
      lastPlayed: watchKnown && Number(row.last_played) ? Number(row.last_played) * 1000 : null,
      transcodeShare: ratingKey && share.has(ratingKey) ? share.get(ratingKey) : null,
    };
  });
}

// Maintainerr: excluded (never touched) and already scheduled to go.
// exclusions: [{ mediaServerId | plexId, parent }]; scheduled: [{ tmdbId, tvdbId, mediaServerId, deleteOn, collection }]
export function maintainerrStatus(it, { exclusions = [], scheduled = [] } = {}) {
  const rk = it.ratingKey ? String(it.ratingKey) : null;
  if (rk && exclusions.some((e) => String(e.mediaServerId ?? e.plexId ?? '') === rk || String(e.parent ?? '') === rk)) return { excluded: true };
  const hit = scheduled.find((s) => (rk && String(s.mediaServerId || '') === rk)
    || (it.kind === 'movie' && s.tmdbId && Number(s.tmdbId) === Number(it.tmdbId))
    || (it.kind === 'show' && ((s.tvdbId && Number(s.tvdbId) === Number(it.tvdbId)) || (s.tmdbId && it.tmdbId && Number(s.tmdbId) === Number(it.tmdbId)))));
  return hit ? { scheduled: hit } : {};
}

const months = (ms) => { const m = Math.round(ms / (30 * DAY)); return m >= 24 ? `${Math.round(m / 12)} years` : m >= 1 ? `${m} ${m === 1 ? 'month' : 'months'}` : `${Math.max(1, Math.round(ms / DAY))} days`; };

// Rank what could go. Returns { candidates, kept, leaving, counts }.
export function rankCandidates(items, { now = Date.now(), limits = LIMITS, hasWatchData = true, maintainerr = {}, keepTag = KEEP_TAG } = {}) {
  const candidates = []; const kept = []; const leaving = [];
  const counts = { noFiles: 0, recentlyWatched: 0, recentlyAdded: 0, small: 0 };
  for (const it of items) {
    if (!(it.size > 0)) { counts.noFiles += 1; continue; }
    const m = maintainerrStatus(it, maintainerr);
    if (m.excluded) { kept.push({ ...it, why: 'Excluded in Maintainerr' }); continue; }
    if ((it.tagLabels || []).some((t) => String(t).toLowerCase() === keepTag)) { kept.push({ ...it, why: `Tagged “${keepTag}” in ${it.serviceLabel}` }); continue; }
    if (m.scheduled) { leaving.push({ ...it, deleteOn: m.scheduled.deleteOn, collection: m.scheduled.collection }); continue; }
    const age = it.addedAt ? now - it.addedAt : Infinity;
    if (age < limits.newDays * DAY) { counts.recentlyAdded += 1; continue; }
    const since = it.lastPlayed ? now - it.lastPlayed : Infinity;
    if (it.watchKnown && since < limits.recentDays * DAY) { counts.recentlyWatched += 1; continue; }
    const reasons = []; let tier = 0;
    if (it.watchKnown && it.plays === 0 && age >= limits.neverDays * DAY) { tier = 3; reasons.push({ id: 'never', text: `Never watched in ${months(age)} since it was added` }); }
    else if (it.watchKnown && it.plays > 0 && since >= limits.staleDays * DAY) { tier = 2; reasons.push({ id: 'stale', text: `Last watched ${months(since)} ago (${it.plays} ${it.plays === 1 ? 'play' : 'plays'})` }); }
    if (it.size >= limits.largeBytes) { if (!tier) tier = 1; reasons.push({ id: 'large', text: 'Large' }); }
    if (!tier) { counts.small += 1; continue; }
    if (it.transcodeShare != null) reasons.push({ id: 'transcodes', text: `Transcoded on ${it.transcodeShare}% of plays` });
    if (!it.watchKnown) reasons.push({ id: 'unknown', text: hasWatchData ? (it.inPlex ? 'No plays recorded for it' : 'Not in Plex, so no watch history') : 'No watch history (add Tautulli)' });
    candidates.push({ ...it, tier, reasons });
  }
  candidates.sort((a, b) => b.tier - a.tier || b.size - a.size || a.title.localeCompare(b.title));
  leaving.sort((a, b) => (a.deleteOn || Infinity) - (b.deleteOn || Infinity));
  return { candidates: candidates.slice(0, MAX_CANDIDATES), more: Math.max(0, candidates.length - MAX_CANDIDATES), kept, leaving, counts };
}

// The fewest titles, in ranked order, that reach the target.
export function pickForTarget(candidates, targetBytes) {
  const picked = []; let total = 0;
  for (const c of candidates) { if (total >= targetBytes) break; picked.push(c.key); total += c.size; }
  return { picked, total };
}

// ------------------------------------------------------------ loading
const tautData = (d) => (d && d.response && d.response.data) || null;

async function loadTautulli(svc, get) {
  const libs = tautData(await get(svc, 'api/v2?cmd=get_libraries', { timeout: 20000 })) || [];
  const rows = [];
  for (const lib of libs.filter((l) => l.section_type === 'movie' || l.section_type === 'show')) {
    for (let start = 0; start < 50000; start += 1000) {
      const d = tautData(await get(svc, `api/v2?cmd=get_library_media_info&section_id=${encodeURIComponent(lib.section_id)}&start=${start}&length=1000&order_column=title`, { timeout: 30000 }));
      const page = (d && d.data) || [];
      rows.push(...page.map((r) => ({ ...r, section_type: lib.section_type })));
      if (page.length < 1000) break;
    }
  }
  const hist = tautData(await get(svc, 'api/v2?cmd=get_history&length=5000', { timeout: 30000 }).catch(() => null));
  return { rows, transcodeGroups: groupHistory((hist && hist.data) || []) };
}

async function loadMaintainerr(svc, get, now) {
  const exclusions = await get(svc, 'api/rules/exclusion', { timeout: 15000 }).catch(() => []);
  const collections = await get(svc, 'api/collections', { timeout: 15000 }).catch(() => []);
  const scheduled = [];
  for (const c of (collections || []).filter((x) => x.isActive && Number(x.deleteAfterDays) > 0)) {
    for (let page = 1; page <= 20; page += 1) {
      const d = await get(svc, `api/collections/media/${encodeURIComponent(c.id)}/content/${page}?size=100`, { timeout: 15000 }).catch(() => null);
      const list = (d && d.items) || [];
      for (const it of list) {
        const added = Date.parse(it.addDate);
        scheduled.push({ tmdbId: it.tmdbId, tvdbId: it.tvdbId, mediaServerId: it.mediaServerId ?? it.plexId, deleteOn: Number.isFinite(added) ? added + Number(c.deleteAfterDays) * DAY : null, collection: c.title });
      }
      if (list.length < 100) break;
    }
  }
  return { exclusions: Array.isArray(exclusions) ? exclusions : [], scheduled, now };
}

async function loadSeerr(svc, get) {
  const out = new Map();
  for (let skip = 0; skip < 1000; skip += 100) {
    const page = await get(svc, `api/v1/request?take=100&skip=${skip}&filter=all&sort=added`, { timeout: 20000 }).catch(() => null);
    for (const r of (page && page.results) || []) {
      const m = r.media || {};
      const key = r.type === 'tv' ? `show:${m.tvdbId}` : `movie:${m.tmdbId}`;
      if (!out.has(key)) out.set(key, { requestedBy: (r.requestedBy && (r.requestedBy.displayName || r.requestedBy.plexUsername || r.requestedBy.email)) || 'someone', mediaId: m.id || null });
    }
    if (!page || !page.results || page.results.length < 100) break;
  }
  return out;
}

const first = (cfg, type, canSee) => Object.entries(cfg.services || {}).find(([k, s]) => s.type === type && s.enabled !== false && canSee(k));

// scope: null (every disk) or a forecast disk ({ services: [{ key, roots }] }).
export async function loadSpacePlan(cfg, { get = defaultGet, plexItems = async () => null, canSee = () => true, scope = null, now = Date.now(), limits = LIMITS } = {}) {
  const notes = []; const sources = {};
  const arrs = Object.entries(cfg.services || {}).filter(([k, s]) => (s.type === 'radarr' || s.type === 'sonarr') && s.enabled !== false && canSee(k)
    && (!scope || scope.services.some((x) => x.key === k)));
  const recycleBins = {};
  const items = [];
  await Promise.all(arrs.map(async ([key, s]) => {
    const movie = s.type === 'radarr';
    try {
      const [list, tags, mm] = await Promise.all([get(s, `api/v3/${movie ? 'movie' : 'series'}`, { timeout: 30000 }), get(s, 'api/v3/tag').catch(() => []), get(s, 'api/v3/config/mediamanagement').catch(() => ({}))]);
      recycleBins[key] = { label: s.label || key, path: (mm && mm.recycleBin) || '', cleanupDays: mm && mm.recycleBinCleanupDays != null ? Number(mm.recycleBinCleanupDays) : null };
      const tagName = new Map((tags || []).map((t) => [t.id, t.label]));
      const roots = scope ? scope.services.find((x) => x.key === key).roots : null;
      for (const x of list || []) {
        if (roots && !roots.some((r) => under(x.path, r))) continue;
        const size = movie ? Number(x.sizeOnDisk) || 0 : Number((x.statistics || {}).sizeOnDisk) || 0;
        items.push({
          key: `${key}:${x.id}`, serviceKey: key, serviceLabel: s.label || key, serviceType: s.type, kind: movie ? 'movie' : 'show', id: x.id,
          title: x.title, year: x.year, path: x.path, size, monitored: x.monitored !== false, tmdbId: x.tmdbId, tvdbId: x.tvdbId,
          addedAt: Date.parse((movie && x.movieFile && x.movieFile.dateAdded) || x.added) || null,
          tagLabels: (x.tags || []).map((id) => tagName.get(id)).filter(Boolean),
          episodes: movie ? null : Number((x.statistics || {}).episodeFileCount) || 0, status: x.status || null,
        });
      }
    } catch (e) { notes.push(`Couldn’t read ${s.label || key}: ${e.message}`); }
  }));

  const tau = first(cfg, 'tautulli', canSee);
  let taut = null;
  if (tau) { try { taut = await loadTautulli(tau[1], get); sources.tautulli = tau[1].label || tau[0]; } catch (e) { notes.push(`Couldn’t read Tautulli: ${e.message}`); } }
  else notes.push('Add Tautulli to see what nobody has watched. Without it, only size counts.');
  let plex = null;
  try { plex = await plexItems(); if (plex) sources.plex = true; } catch { /* no Plex: titles are matched by name */ }
  const mt = first(cfg, 'maintainerr', canSee);
  let maintainerr = {};
  if (mt) { try { maintainerr = await loadMaintainerr(mt[1], get, now); sources.maintainerr = mt[1].label || mt[0]; } catch (e) { notes.push(`Couldn’t read Maintainerr: ${e.message}`); } }
  const seerrSvc = first(cfg, 'overseerr', canSee);
  let requests = new Map();
  if (seerrSvc) { try { requests = await loadSeerr(seerrSvc[1], get); sources.seerr = seerrSvc[0]; } catch { /* optional */ } }

  const joined = joinWatch(items, { plexItems: plex, tautRows: taut ? taut.rows : null, transcodeGroups: taut ? taut.transcodeGroups : [] })
    .map((it) => { const r = requests.get(it.kind === 'movie' ? `movie:${it.tmdbId}` : `show:${it.tvdbId}`); return r ? { ...it, requestedBy: r.requestedBy, seerrMediaId: r.mediaId } : it; });
  const ranked = rankCandidates(joined, { now, limits, hasWatchData: !!taut, maintainerr });
  return { ...ranked, total: items.length, recycleBins, sources, notes, seerrKey: seerrSvc ? seerrSvc[0] : null };
}
