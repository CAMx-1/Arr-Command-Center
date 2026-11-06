// Weekly "recently added" digest: what Sonarr and Radarr imported in the last
// N days, grouped by show and movie, sent through the notification channels
// (category "digest") and push. Off until an admin turns it on.
import { serviceGet } from './proxy.js';

export const DEFAULT_SETTINGS = { enabled: false, day: 0, hour: 18, days: 7, lastSent: null };
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const IMPORT = /^(downloadFolderImported|3)$/;
const pad = (n) => String(n).padStart(2, '0');
const poster = (images) => ((images || []).find((i) => i.coverType === 'poster') || {}).remoteUrl || '';
const resOf = (q) => ((/(\d{3,4}p)/.exec((q && q.quality && q.quality.name) || '') || [])[1] || '');

// Imports only (eventType 3 = downloadFolderImported in both apps), newest
// first, one page at a time until the page reaches past the start date.
// No includeSeries/includeEpisode/includeMovie: on big libraries those make
// each page take a minute or more, so the few titles involved are looked up
// separately afterwards (enrich).
const PAGE = 100;
// Timed call that records one log line (path only: keys travel in headers).
async function timed(log, svc, path, get, timeout, extra = () => ({})) {
  const t0 = Date.now();
  try {
    const d = await get(svc, path, { timeout });
    log({ service: svc.label, path, ok: true, ms: Date.now() - t0, records: d && Array.isArray(d.records) ? d.records.length : Array.isArray(d) ? d.length : undefined, total: d && d.totalRecords, ...extra(d) });
    return d;
  } catch (e) {
    log({ service: svc.label, path, ok: false, ms: Date.now() - t0, error: e.name === 'AbortError' ? `timed out after ${Math.round(timeout / 1000)} s` : e.message, status: e.status, code: e.cause && e.cause.code });
    throw e;
  }
}

const rangeOf = (list, from) => {
  const dates = (list || []).map((r) => Date.parse(r.date)).filter(Number.isFinite);
  return dates.length ? { oldest: new Date(Math.min(...dates)).toISOString(), newest: new Date(Math.max(...dates)).toISOString(), inRange: dates.filter((t) => t >= from).length } : {};
};

// Preferred: history/since with the import filter and no includes. Only the
// period's imports come back, whatever sorting the app does. Falls back to
// the paged history if that fails (older versions, or a timeout).
export async function importsSince(svc, type, since, get, opts = {}) {
  const log = opts.log || (() => {});
  const from = Date.parse(since);
  try {
    const d = await timed(log, svc, `api/v3/history/since?date=${encodeURIComponent(since)}&eventType=3`, get, 60000, (x) => rangeOf(Array.isArray(x) ? x : [], from));
    if (Array.isArray(d)) return d;
  } catch (e) {
    if (e.status === 401) throw e;
    log({ service: svc.label, ok: true, note: 'history/since didn’t work here; using the paged history instead' });
  }
  return pagedImports(svc, type, since, get, opts);
}

// A new file date alone isn't enough: moving or re-scanning files (after
// fixing paths, say) gives existing movies a fresh date. So a file-only movie
// counts when Radarr also grabbed it in the period, or the movie itself was
// added to Radarr in the period (that date doesn't change when files move).
export async function filesAddedSince(svc, since, get, log, already = new Set()) {
  const from = Date.parse(since);
  const list = await timed(log, svc, 'api/v3/movie', get, 60000, (d) => ({ records: Array.isArray(d) ? d.length : undefined }));
  const withNewFile = (Array.isArray(list) ? list : []).filter((m) => m.movieFile && Date.parse(m.movieFile.dateAdded) >= from && !already.has(m.id));
  if (!withNewFile.length) return [];
  const events = await timed(log, svc, `api/v3/history/since?date=${encodeURIComponent(since)}`, get, 60000).catch(() => []);
  const grabbed = new Set((Array.isArray(events) ? events : []).filter((e) => /^(grabbed|1)$/.test(String(e.eventType))).map((e) => e.movieId));
  const keep = withNewFile.filter((m) => grabbed.has(m.id) || Date.parse(m.added) >= from);
  log({ service: svc.label, ok: true, note: `${withNewFile.length} movies have a file dated since ${since.slice(0, 10)}; counting ${keep.length} (grabbed or added to Radarr in that time), skipping ${withNewFile.length - keep.length} existing movies whose files were moved or rescanned` });
  return keep;
}

// When an app has no imports in the period, list which event types it did
// record then, to show how its downloads are being logged.
export async function eventTypesSince(svc, since, get, log) {
  try {
    const d = await get(svc, `api/v3/history/since?date=${encodeURIComponent(since)}`, { timeout: 60000 });
    const counts = {};
    for (const r of Array.isArray(d) ? d : []) counts[r.eventType] = (counts[r.eventType] || 0) + 1;
    log({ service: svc.label, ok: true, note: Object.keys(counts).length ? `no imports in range; events recorded since then: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ')}` : 'no history events at all in range' });
  } catch (e) { log({ service: svc.label, ok: false, note: `couldn’t list event types: ${e.message}` }); }
}

async function pagedImports(svc, type, since, get, { maxPages = 40, log = () => {} } = {}) {
  const from = Date.parse(since);
  const path = (page) => `api/v3/history?page=${page}&pageSize=${PAGE}&sortKey=date&sortDirection=descending&eventType=3`;
  const fetchPage = async (page) => {
    const d = await timed(log, svc, path(page), get, 60000, (data) => {
      const dates = ((data && data.records) || []).map((r) => Date.parse(r.date)).filter(Number.isFinite);
      if (!dates.length) return {};
      return { oldest: new Date(Math.min(...dates)).toISOString(), newest: new Date(Math.max(...dates)).toISOString(), inRange: dates.filter((t) => t >= from).length };
    });
    return { recs: (d && Array.isArray(d.records)) ? d.records : [], total: Number(d && d.totalRecords) || 0 };
  };
  const first = await fetchPage(1);
  const rows = [...first.recs];
  const t = (r) => Date.parse(r.date);
  // Some versions ignore sortKey and return oldest first. Spot that from the
  // page itself and read from the last page backwards instead.
  const ascending = first.recs.length > 1 && t(first.recs[0]) < t(first.recs[first.recs.length - 1]);
  if (ascending) {
    log({ service: svc.label, note: 'results came oldest first; reading from the newest end', ok: true });
    const last = Math.ceil(first.total / PAGE);
    for (let page = last, n = 0; page > 1 && n < maxPages; page--, n++) {
      const { recs } = await fetchPage(page);
      rows.push(...recs);
      if (!recs.length || recs.some((r) => t(r) < from)) break;
    }
    return rows;
  }
  if (first.recs.length < PAGE || first.recs.some((r) => t(r) < from)) return rows;
  for (let page = 2; page <= maxPages; page++) {
    const { recs } = await fetchPage(page);
    rows.push(...recs);
    if (recs.length < PAGE || recs.some((r) => t(r) < from)) break;
  }
  return rows;
}

export function readError(e) {
  if (e && (e.name === 'AbortError' || /aborted/i.test(e.message || ''))) return 'didn’t answer within 60 seconds';
  if (e && e.status === 401) return 'rejected the API key';
  if (e && e.status) return `answered HTTP ${e.status}`;
  return (e && e.cause && e.cause.code === 'ECONNREFUSED') ? 'isn’t reachable' : (e && e.message) || 'couldn’t be read';
}

// Attach series + episode (Sonarr) or movie (Radarr) to each import. One
// request per title and one per 50 episodes; a failed lookup only loses that
// title's details.
export async function enrich(svc, type, rows, get, log = () => {}) {
  const need = rows.filter((r) => (type === 'sonarr' ? !r.series || !r.episode : !r.movie));
  if (!need.length) return rows;
  const one = async (path) => timed(log, svc, path, get, 30000).catch(() => null);
  if (type === 'sonarr') {
    const series = new Map();
    for (const id of [...new Set(need.map((r) => r.seriesId).filter(Boolean))]) series.set(id, await one(`api/v3/series/${id}`));
    const eps = new Map();
    const ids = [...new Set(need.map((r) => r.episodeId).filter(Boolean))];
    for (let i = 0; i < ids.length; i += 50) {
      const list = await one(`api/v3/episode?${ids.slice(i, i + 50).map((id) => `episodeIds=${id}`).join('&')}`);
      for (const e of Array.isArray(list) ? list : []) eps.set(e.id, e);
    }
    return rows.map((r) => ({ ...r, series: r.series || series.get(r.seriesId) || undefined, episode: r.episode || eps.get(r.episodeId) || undefined }));
  }
  const movies = new Map();
  for (const id of [...new Set(need.map((r) => r.movieId).filter(Boolean))]) movies.set(id, await one(`api/v3/movie/${id}`));
  return rows.map((r) => ({ ...r, movie: r.movie || movies.get(r.movieId) || undefined }));
}

// After a failure: does the app answer at all, and is a bare one-row history
// request also slow? Tells "unreachable" apart from "history is slow".
async function probe(svc, get, log) {
  await timed(log, svc, 'api/v3/system/status', get, 10000).catch(() => {});
  await timed(log, svc, 'api/v3/history?page=1&pageSize=1&sortKey=date&sortDirection=descending', get, 30000).catch(() => {});
  await timed(log, svc, 'api/v3/history?page=1&pageSize=1&sortKey=date&sortDirection=descending&eventType=3', get, 30000).catch(() => {});
}

export async function collectDigest(cfg, { days = 7, now = Date.now(), get = serviceGet, log: sink = () => {} } = {}) {
  const since = new Date(now - days * 86400000).toISOString();
  const log = [];
  const add = (entry) => { const e = { at: new Date().toISOString(), ...entry }; log.push(e); sink(e); };
  const shows = new Map(); const movies = new Map(); const errors = [];
  let sources = 0;
  for (const [key, svc] of Object.entries(cfg.services || {})) {
    const type = svc.type || key;
    if (type !== 'sonarr' && type !== 'radarr') continue;
    sources += 1;
    let rows;
    const s = { ...svc, label: svc.label || key };
    try {
      const recent = (await importsSince(s, type, since, get, { log: add })).filter((r) => IMPORT.test(String(r.eventType)) && Date.parse(r.date) >= Date.parse(since));
      rows = await enrich(s, type, recent, get, add);
      // Radarr: also movies whose file was added in the period. Files that
      // arrive through a library rescan (copied in by hand or another tool)
      // never get an import event in history.
      if (type === 'radarr') {
        const seen = new Set(rows.map((r) => r.movieId || (r.movie && r.movie.id)));
        const extra = await filesAddedSince(s, since, get, add, seen).catch(() => []);
        for (const m of extra) rows.push({ eventType: 'downloadFolderImported', date: m.movieFile.dateAdded, movieId: m.id, movie: m, quality: m.movieFile.quality, viaFile: true });
      }
      if (!rows.length) await eventTypesSince(s, since, get, add);
    }
    catch (e) { errors.push({ service: s.label, error: readError(e) }); await probe(s, get, add); continue; }
    for (const r of Array.isArray(rows) ? rows : []) {
      if (!IMPORT.test(String(r.eventType)) || Date.parse(r.date) < Date.parse(since)) continue;
      if (type === 'sonarr' && r.series) {
        const id = `${r.series.tvdbId || r.series.title}`;
        const s = shows.get(id) || { title: r.series.title, year: r.series.year, poster: poster(r.series.images), episodes: new Map(), last: r.date };
        if (r.episode) s.episodes.set(`${r.episode.seasonNumber}x${r.episode.episodeNumber}`, { season: r.episode.seasonNumber, episode: r.episode.episodeNumber, title: r.episode.title });
        if (r.date > s.last) s.last = r.date;
        shows.set(id, s);
      } else if (type === 'radarr' && r.movie) {
        const id = `${r.movie.tmdbId || r.movie.title}`;
        const prev = movies.get(id);
        if (!prev || r.date > prev.last) movies.set(id, { title: r.movie.title, year: r.movie.year, poster: poster(r.movie.images), quality: resOf(r.quality), last: r.date });
      }
    }
  }
  const byNewest = (a, b) => String(b.last).localeCompare(String(a.last));
  return {
    days, since,
    movies: [...movies.values()].sort(byNewest),
    shows: [...shows.values()].map((s) => ({ ...s, episodes: [...s.episodes.values()].sort((a, b) => a.season - b.season || a.episode - b.episode) })).sort(byNewest),
    errors, sources, log,
  };
}

// "S03E01–E03" for a run in one season, otherwise a short list.
export function episodeRange(eps) {
  if (!eps.length) return '';
  if (eps.length === 1) return `S${pad(eps[0].season)}E${pad(eps[0].episode)}${eps[0].title ? ` “${eps[0].title}”` : ''}`;
  const seasons = [...new Set(eps.map((e) => e.season))];
  if (seasons.length === 1) {
    const nums = eps.map((e) => e.episode);
    const run = nums.every((n, i) => i === 0 || n === nums[i - 1] + 1);
    return run ? `S${pad(seasons[0])}E${pad(nums[0])}–E${pad(nums[nums.length - 1])}` : `S${pad(seasons[0])} E${nums.map(pad).join(', E')}`;
  }
  return seasons.map((s) => `S${pad(s)}`).join(', ');
}

export function formatDigest(d, { maxLines = 40 } = {}) {
  const nEps = d.shows.reduce((n, s) => n + s.episodes.length, 0);
  const parts = [];
  if (d.movies.length) parts.push(`${d.movies.length} ${d.movies.length === 1 ? 'movie' : 'movies'}`);
  if (nEps) parts.push(`${nEps} ${nEps === 1 ? 'episode' : 'episodes'} of ${d.shows.length} ${d.shows.length === 1 ? 'show' : 'shows'}`);
  const period = d.days === 7 ? 'this week' : `in the last ${d.days} days`;
  const title = parts.length ? `New ${period}: ${parts.join(' and ')}` : `Nothing new ${period}`;
  const lines = [];
  if (d.movies.length) { lines.push('Movies'); for (const m of d.movies) lines.push(`• ${m.title}${m.year ? ` (${m.year})` : ''}${m.quality ? ` · ${m.quality}` : ''}`); }
  if (d.shows.length) {
    if (lines.length) lines.push('');
    lines.push('TV');
    for (const s of d.shows) lines.push(`• ${s.title} · ${s.episodes.length === 1 ? episodeRange(s.episodes) : `${s.episodes.length} episodes (${episodeRange(s.episodes)})`}`);
  }
  let shown = lines;
  if (lines.length > maxLines) shown = [...lines.slice(0, maxLines - 1), `…and ${lines.length - maxLines + 1} more`];
  if (!parts.length) shown = [`Nothing was imported in the last ${d.days} days.`];
  const image = (d.movies[0] && d.movies[0].poster) || (d.shows[0] && d.shows[0].poster) || '';
  // Errors are for the admin only; they never go into the message people get.
  return { title, body: shown.join('\n'), image, empty: !parts.length, errors: d.errors, sources: d.sources, log: d.log };
}

// Due when today is the chosen weekday, the hour has passed, and it hasn't
// been sent in the last 6 days.
export function isDue(settings, now = Date.now()) {
  if (!settings.enabled) return false;
  const d = new Date(now);
  if (d.getDay() !== Number(settings.day) || d.getHours() < Number(settings.hour)) return false;
  return !settings.lastSent || now - Date.parse(settings.lastSent) > 6 * 86400000;
}

export function describeSchedule(s) { return `${DAY_NAMES[Number(s.day)] || 'Sunday'}s at ${pad(Number(s.hour))}:00`; }

export function normalizeSettings(input, prev = DEFAULT_SETTINGS) {
  const out = { ...DEFAULT_SETTINGS, ...prev };
  if (typeof input.enabled === 'boolean') out.enabled = input.enabled;
  if (input.day != null) { const v = Number(input.day); if (!Number.isInteger(v) || v < 0 || v > 6) return { error: 'Day must be 0 (Sunday) to 6' }; out.day = v; }
  if (input.hour != null) { const v = Number(input.hour); if (!Number.isInteger(v) || v < 0 || v > 23) return { error: 'Hour must be 0 to 23' }; out.hour = v; }
  if (input.days != null) { const v = Number(input.days); if (!Number.isInteger(v) || v < 1 || v > 31) return { error: 'Days must be 1 to 31' }; out.days = v; }
  return { settings: out };
}

export function createDigest({ cfg, store, send, get = serviceGet, now = () => Date.now(), logLine = () => {} }) {
  const settings = () => ({ ...DEFAULT_SETTINGS, ...store.get('digest', {}) });
  async function build() { return formatDigest(await collectDigest(cfg, { days: settings().days, now: now(), get, log: logLine })); }
  const errText = (errs) => errs.map((e) => `${e.service} ${e.error}`).join('; ');
  async function sendNow({ skipEmpty = false, scheduled = false } = {}) {
    const msg = await build();
    // A failed read isn't an empty week: don't tell people "nothing new".
    if (msg.errors.length && msg.errors.length >= msg.sources) { const e = new Error(`Couldn’t read ${errText(msg.errors)}`); e.status = 502; throw e; }
    // On schedule, retry later (every 5 minutes for the rest of the day)
    // rather than send a digest that's missing an app.
    if (scheduled && msg.errors.length) return { retry: true, ...msg };
    if (skipEmpty && msg.empty) return { skipped: true, ...msg };
    const result = await send({ title: msg.title, body: msg.body, image: msg.image, url: '/#/', category: 'digest' });
    store.set('digest', { ...settings(), lastSent: new Date(now()).toISOString() });
    return { ...msg, result };
  }
  async function tick() { if (isDue(settings(), now())) return sendNow({ skipEmpty: true, scheduled: true }).catch((e) => ({ retry: true, error: e.message })); return null; }
  return { settings, build, sendNow, tick, save: (input) => { const r = normalizeSettings(input, settings()); if (r.settings) store.set('digest', r.settings); return r; } };
}
