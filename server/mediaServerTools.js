// Jellyfin and Emby tools: wrong matches (compared with Sonarr/Radarr by
// folder, like the Plex check), Identify to fix one, and titles that keep
// transcoding (from the Playback Reporting plugin's play log).
import { serviceGet as defaultGet, serviceRequest as defaultRequest } from './proxy.js';
import { findWrongMatches } from './plex.js';
import { groupHistory, codecName } from '../public/lib/transcodes.js';

const DAY = 86400000;
const lc = (v) => String(v || '').toLowerCase();

// A Jellyfin/Emby item in the shape findWrongMatches reads (Plex's).
export function asPlexLike(item) {
  const ids = Object.fromEntries(Object.entries(item.ProviderIds || {}).map(([k, v]) => [lc(k), String(v)]).filter(([, v]) => v));
  const show = item.Type === 'Series';
  return {
    ratingKey: item.Id, type: show ? 'show' : 'movie', title: item.Name, year: item.ProductionYear,
    Guid: ['tmdb', 'tvdb', 'imdb'].filter((k) => ids[k]).map((k) => ({ id: `${k}://${ids[k]}` })),
    ...(show ? { Location: item.Path ? [{ path: item.Path }] : [] } : { Media: item.Path ? [{ Part: [{ file: item.Path }] }] : [] }),
  };
}

// Which id to compare. Jellyfin often has only TMDB ids for shows (TVDB is a
// plugin since 10.9), so shows use TVDB when both sides have it, else TMDB.
// An item with no TMDB/TVDB id at all is unmatched, so it's flagged.
export function mediaPick(type, ids, a) {
  if (type === 'show') {
    if (ids.tvdb && a.tvdbId) return { key: 'tvdb', want: String(a.tvdbId) };
    if (ids.tmdb && a.tmdbId) return { key: 'tmdb', want: String(a.tmdbId) };
    if (!ids.tvdb && !ids.tmdb) return a.tvdbId ? { key: 'tvdb', want: String(a.tvdbId) } : a.tmdbId ? { key: 'tmdb', want: String(a.tmdbId) } : null;
    return null; // ids we can't compare with this Sonarr entry
  }
  if (ids.tmdb && a.tmdbId) return { key: 'tmdb', want: String(a.tmdbId) };
  if (ids.imdb && a.imdbId) return { key: 'imdb', want: String(a.imdbId) };
  if (!ids.tmdb && !ids.imdb && a.tmdbId) return { key: 'tmdb', want: String(a.tmdbId) };
  return null;
}

export async function mediaLibraryItems(svc, { get = defaultGet } = {}) {
  const out = [];
  for (let start = 0; start < 100000; start += 2000) {
    const d = await get(svc, `Items?Recursive=true&IncludeItemTypes=Movie,Series&Fields=ProviderIds,Path,ProductionYear&StartIndex=${start}&Limit=2000`, { timeout: 30000 });
    const page = (d && d.Items) || [];
    out.push(...page);
    if (page.length < 2000 || (d && out.length >= Number(d.TotalRecordCount))) break;
  }
  return out;
}

export async function mediaMismatches(svc, arrItems, opts = {}) {
  const items = await mediaLibraryItems(svc, opts);
  const r = findWrongMatches(items.map(asPlexLike), arrItems, { pickId: mediaPick });
  return { checked: items.length, compared: r.compared, items: r.items };
}

const ID_KEYS = { tmdb: 'Tmdb', tvdb: 'Tvdb', imdb: 'Imdb' };
// The fields of a RemoteSearchResult that Identify needs. ImageUrl is left
// out, so the server never fetches an address the browser supplied; it
// downloads art from its own providers when it refreshes.
export function cleanResult(r) {
  const o = r && typeof r === 'object' ? r : {};
  const ProviderIds = Object.fromEntries(Object.entries(o.ProviderIds || {}).filter(([k, v]) => /^[A-Za-z]{2,20}$/.test(k) && /^[\w.-]{1,40}$/.test(String(v))).map(([k, v]) => [k, String(v)]));
  if (!o.Name || !Object.keys(ProviderIds).length) throw Object.assign(new Error('Pick one of the results'), { status: 400 });
  return {
    Name: String(o.Name).slice(0, 300), ProviderIds,
    ...(Number(o.ProductionYear) ? { ProductionYear: Number(o.ProductionYear) } : {}),
    ...(o.PremiereDate && !Number.isNaN(Date.parse(o.PremiereDate)) ? { PremiereDate: new Date(o.PremiereDate).toISOString() } : {}),
    ...(o.SearchProviderName ? { SearchProviderName: String(o.SearchProviderName).slice(0, 60) } : {}),
  };
}

// Identify candidates, searched with the title, year and id Sonarr/Radarr have.
export async function matchCandidates(svc, { kind, title, year, idType, id }, { request = defaultRequest } = {}) {
  const ProviderIds = ID_KEYS[idType] && /^[\w.-]{1,40}$/.test(String(id || '')) ? { [ID_KEYS[idType]]: String(id) } : {};
  const body = { SearchInfo: { Name: String(title || '').slice(0, 300), ...(Number(year) ? { Year: Number(year) } : {}), ProviderIds }, IncludeDisabledProviders: false };
  const list = await request(svc, `Items/RemoteSearch/${kind === 'show' ? 'Series' : 'Movie'}`, { method: 'POST', body });
  return (list || []).map((r) => {
    const ids = Object.fromEntries(Object.entries(r.ProviderIds || {}).map(([k, v]) => [lc(k), String(v)]));
    let result = null;
    try { result = cleanResult(r); } catch { /* no ids: can't be applied */ }
    return { name: r.Name, year: r.ProductionYear || null, provider: r.SearchProviderName || '', ids, matchesArr: !!(idType && ids[idType] && ids[idType] === String(id)), result };
  }).filter((c) => c.result);
}

export async function applyMatch(svc, itemId, result, { request = defaultRequest } = {}) {
  if (!/^[A-Za-z0-9-]{1,64}$/.test(String(itemId))) throw Object.assign(new Error('Bad item'), { status: 400 });
  await request(svc, `Items/RemoteSearch/Apply/${encodeURIComponent(itemId)}?replaceAllImages=true`, { method: 'POST', body: cleanResult(result) });
}

// ------------------------------------------------------------ transcodes
// Playback Reporting records "DirectPlay", "DirectStream", or
// "Transcode (v:h264 a:aac)" where "direct" means that stream wasn't converted.
export function parseMethod(method) {
  const m = String(method || '');
  if (/^transcode/i.test(m)) {
    const d = /\(v:([^ )]+)\s+a:([^ )]+)\)/i.exec(m);
    return { decision: 'transcode', video: d ? lc(d[1]) : null, audio: d ? lc(d[2]) : null };
  }
  return { decision: /^directstream/i.test(m) ? 'copy' : 'direct play', video: null, audio: null };
}

// Episode names are "Show - s01e02 - Title".
const showOf = (name) => { const m = /^(.*?) - s\d+e\d+/i.exec(String(name || '')); return m ? m[1].trim() : null; };

export function rowsFromReport(report) {
  const cols = (report && (report.colums || report.columns)) || [];
  const at = (k) => cols.indexOf(k);
  return ((report && report.results) || []).map((row, i) => {
    const get = (k) => (at(k) >= 0 ? row[at(k)] : null);
    const type = lc(get('ItemType'));
    const name = get('ItemName') || '';
    const show = type === 'episode' ? (showOf(name) || name) : null;
    const pm = parseMethod(get('PlaybackMethod'));
    return {
      id: i + 1, media_type: type === 'episode' ? 'episode' : 'movie', title: show ? undefined : name, full_title: name,
      grandparent_title: show || undefined, rating_key: get('ItemId'), grandparent_rating_key: show ? `series:${lc(show)}` : undefined,
      transcode_decision: pm.decision, video: pm.video, audio: pm.audio, player: get('ClientName') || get('DeviceName') || '', user: get('UserName') || get('UserId') || '',
      date: get('DateCreated'),
    };
  });
}

// Why, from the recorded methods (Playback Reporting doesn't keep more).
export function reasonsFromRows(rows) {
  const tx = rows.filter((r) => r.transcode_decision === 'transcode');
  const out = [];
  const video = tx.filter((r) => r.video && r.video !== 'direct');
  const audioOnly = tx.filter((r) => r.video === 'direct' && r.audio && r.audio !== 'direct');
  const unknown = tx.filter((r) => !r.video);
  if (video.length) {
    const to = [...new Set(video.map((r) => codecName(r.video)))].join(' or ');
    out.push({ id: 'video', text: `The video is converted to ${to} on ${video.length} of ${tx.length} ${tx.length === 1 ? 'play' : 'plays'}`, fix: 'Usually the player can’t play the file’s video codec, or its quality setting is lower than the file. Raise the quality setting on that device, or get a release in a codec it plays (H.264 plays almost everywhere).' });
  }
  if (audioOnly.length) {
    const to = [...new Set(audioOnly.map((r) => codecName(r.audio)))].join(' or ');
    out.push({ id: 'audio', text: `Only the audio is converted (to ${to}) on ${audioOnly.length} of ${tx.length} ${tx.length === 1 ? 'play' : 'plays'}`, fix: 'Usually cheap. A release with AC3/EAC3 audio avoids it; so does audio passthrough on the device.', light: true });
  }
  if (unknown.length && !video.length && !audioOnly.length) out.push({ id: 'unknown', text: 'Converted (no details recorded)', fix: 'Check the play in the server’s dashboard while it plays.' });
  return out;
}

export async function loadMediaTranscodes(svc, { days = 30, request = defaultRequest, now = Date.now() } = {}) {
  const n = Math.min(365, Math.max(1, Math.round(Number(days) || 30)));
  const since = new Date(now - n * DAY).toISOString().slice(0, 10); // computed, never from the request
  const sql = `SELECT ItemId, ItemType, ItemName, PlaybackMethod, ClientName, DeviceName, UserId, DateCreated FROM PlaybackActivity WHERE DateCreated >= '${since}' AND ItemType IN ('Movie', 'Episode') ORDER BY DateCreated DESC LIMIT 5000`;
  let report;
  try { report = await request(svc, 'user_usage_stats/submit_custom_query', { method: 'POST', body: { CustomQueryString: sql, ReplaceUserId: true } }); }
  catch (e) {
    if (e.status === 404) throw Object.assign(new Error('Install the Playback Reporting plugin (Dashboard → Plugins → Catalog) to see which titles transcode. It starts recording from when it’s installed.'), { status: 404 });
    throw e;
  }
  if (report && report.message && !(report.results || []).length && /error/i.test(report.message)) throw new Error('Playback Reporting couldn’t read its play log');
  const rows = rowsFromReport(report);
  const groups = groupHistory(rows).slice(0, 25).map((g) => {
    const mine = rows.filter((r) => (g.kind === 'show' ? r.grandparent_rating_key === g.ratingKey : r.rating_key === g.ratingKey));
    return { ...g, reasons: reasonsFromRows(mine) };
  });
  return { groups, plays: rows.length, days: n };
}
