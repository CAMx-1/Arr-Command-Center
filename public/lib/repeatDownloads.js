// "Repeat downloads": why things are downloaded more than once, from the
// app's own history, and the settings that cause it. Pure analysis plus the
// network side; the dialog is repeatDownloadsUI.js.
import { qualityFromSonarr, episodeCode } from './episodeDupes.js';

const list = (x) => (Array.isArray(x) ? x : []);
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const lc = (s) => String(s || '').toLowerCase();
const OUTCOMES = new Set(['downloadFolderImported', 'downloadFailed', 'downloadIgnored']);
const keyOf = (r, kind) => (kind === 'series' ? `${r.seriesId}:${r.episodeId}` : `${r.movieId}`);

// History event numbers: grabbed, imported from the download folder, failed,
// ignored (Sonarr 7, Radarr 9).
export const HISTORY_TYPES = { series: [1, 3, 4, 7], movie: [1, 3, 4, 9] };

// Is the new grab better than what was imported? Quality first (resolution,
// then source), then a proper/repack, then the custom format score.
export function betterThan(grab, imported) {
  const a = qualityFromSonarr(grab.quality); const b = qualityFromSonarr(imported.quality);
  if (a.rank !== b.rank) return a.rank > b.rank;
  const va = Number(grab.quality && grab.quality.revision && grab.quality.revision.version) || 1;
  const vb = Number(imported.quality && imported.quality.revision && imported.quality.revision.version) || 1;
  if (va !== vb) return va > vb;
  const sa = Number(grab.customFormatScore ?? (grab.data && grab.data.customFormatScore)) || 0;
  const sb = Number(imported.customFormatScore ?? (imported.data && imported.data.customFormatScore)) || 0;
  return sa > sb;
}

// Pure. records: history (any order). queueIds: download ids still in the
// queue (lower case). staleMs: a grab with no outcome this old counts as
// never imported.
//   repeats: every grab after the first for the same episode or movie, with
//            the cause, from what happened to the grab before it:
//              failed  - that download failed
//              ignored - it was ignored
//              upgrade - it was imported, and this release is better
//              again   - it was imported, and this release isn't better
//              lost    - it hadn't been imported (or failed) yet when this
//                        grab happened, or never was: the app lost track of
//                        it, or someone grabbed it again by hand
//            same: the very release grabbed before (SABnzbd saves it again
//            as a ".1" folder)
//   never:   grabs with no import, failure or ignore, not in the queue
//   titles:  episodes and movies grabbed more than once, most first
export function analyzeHistory(records, { kind, queueIds = new Set(), now = Date.now(), staleMs = 12 * 3600000 } = {}) {
  const evs = list(records).filter((r) => r && r.date && r.eventType).map((r) => ({ ...r, t: Date.parse(r.date), type: String(r.eventType) })).filter((r) => Number.isFinite(r.t)).sort((a, b) => a.t - b.t);
  const byKey = new Map(); const byDl = new Map();
  for (const r of evs) {
    const k = keyOf(r, kind);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(r);
    if (r.downloadId && OUTCOMES.has(r.type)) { const d = lc(r.downloadId); if (!byDl.has(d)) byDl.set(d, []); byDl.get(d).push(r); }
  }
  const outcomeOf = (g, next) => {
    if (g.downloadId) {
      const xs = (byDl.get(lc(g.downloadId)) || []).filter((x) => x.t >= g.t);
      const o = xs.find((x) => keyOf(x, kind) === keyOf(g, kind)) || xs[0];
      if (o) return o;
    }
    return (byKey.get(keyOf(g, kind)) || []).find((x) => OUTCOMES.has(x.type) && x.t >= g.t && (!next || x.t < next.t) && !x.downloadId) || null;
  };
  const repeats = []; const never = []; const titles = [];
  let grabs = 0;
  for (const [key, xs] of byKey) {
    const gs = xs.filter((x) => x.type === 'grabbed');
    grabs += gs.length;
    gs.forEach((g, i) => { g.outcome = outcomeOf(g, gs[i + 1]); });
    const mine = [];
    for (let i = 1; i < gs.length; i += 1) {
      const g = gs[i]; const prev = gs[i - 1]; const o = prev.outcome;
      const cause = !o || o.t > g.t ? 'lost' : o.type === 'downloadFailed' ? 'failed' : o.type === 'downloadIgnored' ? 'ignored' : betterThan(g, o) ? 'upgrade' : 'again';
      const same = gs.slice(0, i).some((p) => norm(p.sourceTitle) && norm(p.sourceTitle) === norm(g.sourceTitle));
      const r = { key, grab: g, prev, outcome: o, cause, same };
      repeats.push(r); mine.push(r);
    }
    for (const g of gs) if (!g.outcome && now - g.t > staleMs && !(g.downloadId && queueIds.has(lc(g.downloadId)))) never.push(g);
    if (gs.length > 1) titles.push({ key, grabs: gs, repeats: mine, sample: gs[gs.length - 1] });
  }
  titles.sort((a, b) => b.grabs.length - a.grabs.length || b.sample.t - a.sample.t);
  never.sort((a, b) => b.t - a.t);
  const byCause = { failed: 0, ignored: 0, upgrade: 0, again: 0, lost: 0 };
  for (const r of repeats) byCause[r.cause] += 1;
  const sizeOf = (g) => Number((g.data && (g.data.size || g.data.Size)) || g.size) || 0;
  return {
    repeats, never, titles,
    counts: {
      grabs, titles: titles.length, repeats: repeats.length, byCause, same: repeats.filter((r) => r.same).length,
      wastedBytes: repeats.filter((r) => r.cause === 'again' || r.cause === 'lost' || r.same).reduce((n, r) => n + sizeOf(r.grab), 0),
      never: never.length, neverBytes: never.reduce((n, g) => n + sizeOf(g), 0),
    },
  };
}

// What a history record is about: "Severance · S01E05" or "Dune: Part Two (2024)".
export function titleOf(r, kind, names) {
  if (kind === 'series') {
    const s = names.get(r.seriesId);
    const e = r.episode;
    const code = e ? episodeCode(e.seasonNumber, e.episodeNumber) : '';
    return `${s || r.sourceTitle || 'Unknown show'}${code ? ` · ${code}` : ''}`;
  }
  return names.get(r.movieId) || r.sourceTitle || 'Unknown movie';
}

// SABnzbd's duplicate detection options (misc no_dupes / no_smart_dupes).
export const SAB_DUPES = { 0: 'Off', 4: 'Tag job', 2: 'Pause', 3: 'Fail job (move to History)', 1: 'Discard' };
const USENET = new Set(['sabnzbd', 'nzbget']);
const CLIENT_NAME = { sabnzbd: 'SABnzbd', nzbget: 'NZBGet', qbittorrent: 'qBittorrent', transmission: 'Transmission', deluge: 'Deluge' };

// Pure: the settings that make things download twice, or never import.
// clients: the app's download clients; dlcfg: config/downloadclient;
// health: the app's health checks; sab: [{ key, label, misc }] (misc from
// SABnzbd's get_config). Each finding: { id, severity, title, detail, fix }
// where fix (admins) is { label, action }.
export function settingsFindings({ app, kind, clients = null, dlcfg = null, health = [], sab = [] }) {
  const out = [];
  const lib = kind === 'series' ? 'show' : 'movie';
  if (dlcfg && dlcfg.enableCompletedDownloadHandling === false) {
    out.push({ id: 'cdh', severity: 'problem', title: `${app} doesn’t import finished downloads`, detail: 'Completed Download Handling is off, so finished downloads stay where the download client put them.', fix: { label: 'Turn it on', action: { type: 'dlcfg', enableCompletedDownloadHandling: true } } });
  }
  const usenet = list(clients).filter((c) => c.enable !== false && USENET.has(lc(c.implementation)));
  const keep = usenet.filter((c) => c.removeCompletedDownloads === false);
  if (keep.length) {
    const names = keep.map((c) => c.name || CLIENT_NAME[lc(c.implementation)] || c.implementation).join(', ');
    out.push({ id: 'remove-completed', severity: 'warning', title: `Finished downloads stay in ${names}’s history`, detail: `${app} only reads the newest 60 downloads in its category of the download history, so when many finish close together, older ones can drop out of view before they’re imported. They’re left in the download folder and downloaded again. With “Remove Completed” on, ${app} removes each download from the history once it’s imported, along with what’s left of its download folder; the imported file in the library isn’t touched. It does the same at once for downloads it already imported that are still in the history.`, fix: { label: 'Turn on Remove Completed', action: { type: 'bulk', ids: keep.map((c) => c.id), field: 'removeCompletedDownloads' } } });
  }
  const keepFailed = usenet.filter((c) => c.removeFailedDownloads === false);
  if (keepFailed.length) {
    out.push({ id: 'remove-failed', severity: 'info', title: 'Failed downloads stay in the download client', detail: `${app} leaves failed downloads in ${keepFailed.map((c) => c.name || c.implementation).join(', ')} after it blocklists them. TRaSH’s guide recommends removing them.`, fix: { label: 'Turn on Remove Failed', action: { type: 'bulk', ids: keepFailed.map((c) => c.id), field: 'removeFailedDownloads' } } });
  }
  for (const h of list(health)) {
    const src = String(h.source || '');
    if (src === 'DownloadClientRootFolderCheck') out.push({ id: `health:${src}:${norm(h.message)}`, severity: 'problem', title: `Downloads are saved inside a ${lib} library folder`, detail: `${h.message} Finished downloads then sit next to the ${lib}s, and anything that isn’t imported stays there (see Untracked files → Leftover downloads).`, fix: null, help: `Give the download client its own folder outside the root folders (in SABnzbd: Config → Folders and Categories), then point ${app}’s download client at it.` });
    else if (src === 'RemotePathMappingCheck' || src === 'DownloadClientCheck' || src === 'ImportMechanismCheck') out.push({ id: `health:${src}:${norm(h.message)}`, severity: 'warning', title: `${app} reports a download problem`, detail: h.message, fix: null });
  }
  for (const s of sab) {
    if (!s.misc) { out.push({ id: `sab:${s.key}:unread`, severity: 'info', title: `Couldn’t read ${s.label}’s settings`, detail: s.error || 'Checking them needs an admin.', fix: null }); continue; }
    const dupes = Number(s.misc.no_dupes);
    if (dupes === 0) out.push({ id: `sab:${s.key}:no_dupes`, severity: 'warning', title: `${s.label} downloads the same release again`, detail: `Its identical-download detection is off, so when ${app} sends a release it already downloaded, ${s.label} downloads it again into a “.1” folder. With “Fail job”, ${s.label} stops at once and ${app} sees a failed download, blocklists that release and looks for another one only if it still needs it.`, fix: { label: 'Set to Fail job', action: { type: 'sab', service: s.key, keyword: 'no_dupes', value: 3 } } });
    const smartKey = s.misc.no_smart_dupes !== undefined ? 'no_smart_dupes' : 'no_series_dupes';
    const smart = Number(s.misc[smartKey]);
    if ([1, 2, 3].includes(smart)) out.push({ id: `sab:${s.key}:${smartKey}`, severity: 'warning', title: `${s.label}’s smart duplicate detection blocks upgrades`, detail: `It’s set to “${SAB_DUPES[smart]}” for releases of the same episode or movie, which stops the better releases ${app} sends (upgrades, propers, repacks). ${app} already decides what’s worth downloading.`, fix: { label: 'Turn it off', action: { type: 'sab', service: s.key, keyword: smartKey, value: 0 } } });
  }
  const order = { problem: 0, warning: 1, info: 2 };
  return out.sort((a, b) => order[a.severity] - order[b.severity]);
}

// Network: history, queue, settings and health from the app, and SABnzbd's
// duplicate settings. sab: [{ key, label, get(params) }]. Settings need an
// admin; without them the history part still works.
export async function gatherRepeatDownloads(arr, kind, { days = 90, sab = [], now = Date.now() } = {}) {
  const since = new Date(now - days * 86400000).toISOString();
  const inc = kind === 'series' ? '&includeEpisode=true' : '';
  const errors = [];
  const [parts, items, queue, clients, dlcfg, health] = await Promise.all([
    Promise.all(HISTORY_TYPES[kind].map((t) => arr.get(`history/since?date=${encodeURIComponent(since)}&eventType=${t}${inc}`).then(list).catch((e) => { errors.push(e.message); return []; }))),
    arr.get(kind === 'series' ? 'series' : 'movie').then(list).catch(() => []),
    arr.get('queue?page=1&pageSize=1000&includeUnknownSeriesItems=true&includeUnknownMovieItems=true').then((q) => list(q && q.records)).catch(() => []),
    arr.get('downloadclient').then(list).catch(() => null),
    arr.get('config/downloadclient').catch(() => null),
    arr.get('health').then(list).catch(() => []),
  ]);
  const usesSab = list(clients).some((c) => c.enable !== false && lc(c.implementation) === 'sabnzbd');
  const sabRead = clients && usesSab ? await Promise.all(sab.map(async (s) => {
    try { const d = await s.get({ mode: 'get_config', section: 'misc' }); return { key: s.key, label: s.label, misc: (d && d.config && d.config.misc) || null }; }
    catch (e) { return { key: s.key, label: s.label, misc: null, error: e.message }; }
  })) : [];
  const names = new Map(items.map((it) => [it.id, `${it.title}${it.year ? ` (${it.year})` : ''}`]));
  const queueIds = new Set(queue.map((q) => lc(q.downloadId)).filter(Boolean));
  return { records: parts.flat(), names, queueIds, clients, dlcfg, health, sab: sabRead, usesSab, admin: clients !== null, since, days, errors };
}

// Applies one fix. api: { sab(key, params) }.
export async function applyFix(action, { arr, api }) {
  if (action.type === 'sab') return api.sab(action.service, { mode: 'set_config', section: 'misc', keyword: action.keyword, value: String(action.value) });
  if (action.type === 'bulk') return arr.put('downloadclient/bulk', { ids: action.ids, [action.field]: true });
  if (action.type === 'dlcfg') { const cfg = await arr.get('config/downloadclient'); return arr.put('config/downloadclient', { ...cfg, enableCompletedDownloadHandling: true }); }
  if (action.type === 'mm') { const mm = await arr.get('config/mediamanagement'); return arr.put('config/mediamanagement', { ...mm, ...action.set }); }
  throw new Error(`Unknown fix ${action.type}`);
}

export const CAUSE_TEXT = {
  failed: 'after a failed download',
  ignored: 'after a download you ignored',
  upgrade: 'an upgrade',
  again: 'again after it was imported',
  lost: 'before the first one was imported',
};
export const REPEAT_CSV_HEADERS = ['Title', 'Downloaded', 'Release', 'Quality', 'Why it was downloaded again', 'Same release as before', 'Outcome'];
export function repeatCsvRows(analysis, { kind, names }) {
  const rows = [];
  for (const t of analysis.titles) {
    t.grabs.forEach((g, i) => {
      const r = i ? t.repeats[i - 1] : null;
      const o = g.outcome;
      rows.push([titleOf(g, kind, names), g.date, g.sourceTitle || '', (g.quality && g.quality.quality && g.quality.quality.name) || '', r ? CAUSE_TEXT[r.cause] : 'first download', r && r.same ? 'yes' : '', o ? ({ downloadFolderImported: 'imported', downloadFailed: 'failed', downloadIgnored: 'ignored' }[o.type] || o.type) : 'never imported']);
    });
  }
  return rows;
}
