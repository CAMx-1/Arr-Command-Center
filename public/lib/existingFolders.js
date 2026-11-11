// "Add existing folders": folders in a root folder that Sonarr or Radarr
// doesn't manage yet (their own unmappedFolders list), matched to a show or a
// movie by name, then added at that path, as Sonarr's and Radarr's Library
// Import do. Pure; the dialog is existingFoldersUI.js.
import { pathKey, splitPath } from './pathDoctor.js';

const THIS_YEAR = new Date().getFullYear();
const fold = (s) => String(s ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '');

// For comparing titles: accents, case, "&", apostrophes, punctuation and a
// leading "The" don't count.
export function cleanTitle(s) {
  return fold(s).toLowerCase().replace(/&/g, ' and ').replace(/['’`´]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().replace(/^the /, '');
}
// The same without spaces: "d'Amélie" and "d.Amelie", "Spider-Man" and
// "Spiderman" compare equal.
export const titleKeyOf = (s) => cleanTitle(s).replace(/ /g, '');
// Lookup titles carry a year or country to tell shows apart ("Ghosts (2019)",
// "The Office (US)"); those aren't part of the name.
const COUNTRY = /\s*\((?:US|UK|AU|CA|NZ|IE|DE|FR|JP|KR|IN|ES|IT|NL|BR|MX|SE|DK|NO)\)\s*$/i;
const stripSuffix = (t) => String(t || '').replace(COUNTRY, '').replace(/\s*\((?:19|20)\d\d\)\s*$/, '').replace(COUNTRY, '').trim();

// Where a name stops being a title: quality, source, codec, audio, edition
// and language words that release names add.
// Words that are also common in titles ("Mad Max", "Charlotte's Web", "The
// French Connection", "Leave It to Beaver") aren't here.
const TAG = /^(?:\d{3,4}[pi]|4k|8k|uhd|hdr\d*|hdr10plus|dovi|sdr|bluray|blu|bdrip|brrip|bdremux|bd\d{2}|remux|webrip|webdl|hdtv|pdtv|sdtv|dvdrip|dvdr|hdrip|hddvd|x26[45]|h26[45]|hevc|avc|xvid|divx|vc1|mpeg2|av1|10bit|8bit|hi10p|dts|dtshd|ddp\d*|dd\d|aac\d*|ac3|eac3|truehd|atmos|flac|lpcm|opus|proper|repack|internal|extended|unrated|uncut|remastered|imax|multi|dual|dubbed|subbed|ita|vff|nordic|amzn|dsnp|atvp|hmax|pcok|pmtp)$/i;
const EPISODE = /(?:^|[^a-z0-9])s\d{1,3}[ ._-]?e\d{1,4}|(?:^|[^a-z0-9])\d{1,2}x\d{2,3}(?![0-9p])|(?:^|[^0-9])(?:19|20)\d\d[.\- ]\d\d[.\- ]\d\d(?![0-9])/i;
const SEASON_RANGE = /(?:^|[^a-z0-9])s\d{1,2}\s*(?:-|–|to)\s*s?\d{1,2}(?![0-9])|seasons?\s*\d{1,2}\s*(?:-|–|to)\s*\d{1,2}(?![0-9])|(?:^|[^a-z])(?:complete(?:[ ._-]series)?|all[ ._-]seasons|full[ ._-]series)(?![a-z])/i;
const SEASON = /(?:^|[^a-z0-9])s\d{1,2}(?![0-9e])|(?:^|[^a-z])season[ ._-]?\d{1,2}(?![0-9])/i;
const MOVIE_PACK = /(?:^|[^a-z])(?:pack|collection|trilogy|duology|quadrilogy|pentalogy|hexalogy|anthology|box[ ._-]?set|saga[ ._-]\d(?![0-9]))(?![a-z])|(?:^|[^0-9])\d[ ._]?-[ ._]?\d(?![0-9])|(?:19|20)\d\d[ ._]?-[ ._]?(?:19|20)\d\d/i;
const BROKEN = /^_(?:failed|unpack)_/i;
const SYSTEM = /^(?:\.|@eadir$|#recycle$|#snapshot$|\$recycle\.bin$|recycler$|system volume information$|lost\+found$|plex versions$|_duplicates to delete$)/i;

// The title and year a folder name gives, and what kind of folder it looks
// like. kind: 'title' (a show or movie folder) | 'pack' (a whole series in
// one folder) | 'episode' | 'season' (downloads, not shows) | 'collection'
// (several movies) | 'failed' | 'system' | 'no-title'.
export function parseFolder(name, mediaKind) {
  const raw = String(name || '').trim();
  if (SYSTEM.test(raw)) return { kind: 'system' };
  if (BROKEN.test(raw)) return { kind: 'failed' };
  const tv = mediaKind === 'series';
  let kind = 'title';
  if (EPISODE.test(raw)) kind = 'episode';
  else if (tv && SEASON_RANGE.test(raw)) kind = 'pack';
  else if (tv && SEASON.test(raw)) kind = 'season';
  else if (!tv && MOVIE_PACK.test(raw)) kind = 'collection';
  // Years in brackets become plain words; other bracketed parts ("[RH]",
  // "[1080p.BluRay]", "(US)") go.
  const country = (/\((US|UK|AU|CA|NZ|IE)\)/i.exec(raw) || [])[1] || null;
  const s = fold(raw)
    .replace(/[([{]\s*((?:19|20)\d\d)\s*[)\]}]/g, ' $1 ')
    .replace(/\[[^\]]*\]|\{[^}]*\}|\((?:US|UK|AU|CA|NZ|IE)\)/gi, ' ')
    .replace(/[()]/g, ' ');
  const words = s.split(/[\s._]+|(?<=[a-z0-9])-(?=[a-z])|\s-\s/i).map((w) => w.replace(/^-+|-+$/g, '')).filter(Boolean);
  let stop = words.length;
  for (let i = 0; i < words.length; i += 1) {
    const w = words[i];
    if (i > 0 && (TAG.test(w) || EPISODE.test(` ${w}`) || (tv && (/^s\d{1,2}(?:e\d+)?$/i.test(w) || /^seasons?$/i.test(w))))) { stop = i; break; }
  }
  // The year is the last 19xx/20xx word before the tags that isn't the first
  // word ("1917 2019", "Blade Runner 2049 2017", "Wonder Woman 1984 2020").
  let year = null; let end = stop;
  for (let i = stop - 1; i >= 1; i -= 1) {
    const n = Number(words[i]);
    if (/^(?:19|20)\d\d$/.test(words[i]) && n >= 1900 && n <= THIS_YEAR + 2) { year = n; end = i; break; }
  }
  const title = words.slice(0, end).join(' ').replace(/\s+-\s*$/, '').trim();
  if (!cleanTitle(title)) return { kind: kind === 'title' ? 'no-title' : kind };
  return { kind, title, year, country };
}

// What to search for. Sonarr's search is by name; Radarr reads a year too.
export function lookupTerm(parsed, mediaKind) {
  if (!parsed || !parsed.title) return '';
  return mediaKind === 'movie' && parsed.year ? `${parsed.title} ${parsed.year}` : parsed.title;
}

const idOf = (r, mediaKind) => (r ? (mediaKind === 'series' ? r.tvdbId : r.tmdbId) : null);
// How well known a result is: Sonarr's lookups have ratings.votes, Radarr's
// ratings.imdb.votes and ratings.tmdb.votes.
export function votesOf(r) {
  const x = (r && r.ratings) || {};
  return Number(x.votes) || Math.max(Number(x.imdb && x.imdb.votes) || 0, (Number(x.tmdb && x.tmdb.votes) || 0) * 20) || 0;
}
// The best of several same-name results: one already in the app first, then
// the most voted; "clear" when it has at least 10 times the votes of the
// next (Friends 1994: 1.2 million against 64 for Friends 1979).
function bestOf(cands, mediaKind, library) {
  const inApp = (r) => !!(library.get(idOf(r, mediaKind)) || r.id > 0);
  const sorted = [...cands].sort((a, b) => inApp(b) - inApp(a) || votesOf(b) - votesOf(a));
  const [top, next] = sorted;
  const clear = !next || inApp(top) !== inApp(next) || (votesOf(top) >= 1000 && votesOf(top) >= votesOf(next) * 10);
  return { top, clear };
}
const titlesOf = (r) => [r.title, r.originalTitle, ...((r.alternateTitles || []).map((a) => a && (a.title || a.sceneName)))].filter(Boolean).map((t) => cleanTitle(stripSuffix(t)));
const keysOf = (r) => titlesOf(r).map((t) => t.replace(/ /g, ''));
const yearOf = (r) => Number(r.year) || (r.firstAired ? new Date(r.firstAired).getUTCFullYear() : 0) || 0;

// Picks the lookup result for a folder, with how sure the match is:
//   exact  - the same name and year
//   likely - the same name, and no other result has it (no year in the folder)
//   unsure - the year differs, the name differs, or several results share it
//   none   - no results
// library: Map(tvdbId|tmdbId -> item already in the app).
export function matchFolder(parsed, results, mediaKind, library = new Map()) {
  const list = (Array.isArray(results) ? results : []).filter((r) => r && r.title);
  const out = (pick, confidence, why = '') => {
    const id = idOf(pick, mediaKind);
    const existing = pick ? (library.get(id) || (pick.id > 0 ? pick : null)) : null;
    return { pick, confidence, why, choices: list.slice(0, 8), existing: existing || null };
  };
  if (!list.length) return out(null, 'none', 'No match found');
  const want = cleanTitle(parsed.title);
  const wantKey = want.replace(/ /g, '');
  const same = list.filter((r) => keysOf(r).includes(wantKey));
  const yearOk = (r) => parsed.year && yearOf(r) && (mediaKind === 'movie' ? Math.abs(yearOf(r) - parsed.year) <= 1 : yearOf(r) === parsed.year);
  const what = mediaKind === 'series' ? 'shows' : 'movies';
  // A shortened name ("It's always Sunny"): titles that start with it, best known first.
  const startsWith = () => { const c = list.filter((r) => titlesOf(r).some((t) => t.startsWith(`${want} `))); return c.length ? bestOf(c, mediaKind, library).top : list[0]; };
  if (parsed.year) {
    const both = same.filter(yearOk);
    if (both.length) return out(bestOf(both, mediaKind, library).top, 'exact');
    if (same.length) { const { top } = bestOf(same, mediaKind, library); return out(top, 'unsure', `The folder says ${parsed.year}; this is ${yearOf(top) || 'undated'}`); }
    const byYear = list.filter(yearOk);
    return out(byYear.length ? bestOf(byYear, mediaKind, library).top : startsWith(), 'unsure', 'The name is different');
  }
  if (same.length === 1) return out(same[0], 'likely');
  if (same.length > 1) {
    const { top, clear } = bestOf(same, mediaKind, library);
    return clear ? out(top, 'likely', '') : out(top, 'unsure', `${same.length} ${what} have this name`);
  }
  return out(startsWith(), 'unsure', 'The name is different');
}

// A result chosen by hand from the choices: same check, confidence 'picked'.
export function choose(match, pick, mediaKind, library = new Map()) {
  const id = idOf(pick, mediaKind);
  const existing = library.get(id) || (pick && pick.id > 0 ? pick : null);
  return { ...match, pick, confidence: 'picked', why: '', existing: existing || null };
}

// "Ghosts (2019)", "Friends (1994)": the year once.
export function displayTitle(r) {
  if (!r) return '';
  const t = String(r.title || '');
  return r.year && !/\((?:19|20)\d\d\)\s*$/.test(t) ? `${t} (${r.year})` : t;
}

export const CONFIDENCE_RANK = { exact: 4, picked: 3, likely: 2, unsure: 1, none: 0 };

// One folder per title: when several folders match the same show or movie,
// the best match (then the one with more videos) is kept and the others point
// at it. rows: [{ folder, match, videos }]; returns Map(path -> keeper path).
export function sameTitleGroups(rows, mediaKind) {
  const by = new Map();
  for (const r of rows) {
    const id = r.match && !r.match.existing && idOf(r.match.pick, mediaKind);
    if (!id) continue;
    if (!by.has(id)) by.set(id, []);
    by.get(id).push(r);
  }
  const sameAs = new Map();
  for (const group of by.values()) {
    if (group.length < 2) continue;
    const keep = [...group].sort((a, b) => CONFIDENCE_RANK[b.match.confidence] - CONFIDENCE_RANK[a.match.confidence] || (b.videos || 0) - (a.videos || 0) || a.folder.path.localeCompare(b.folder.path))[0];
    for (const r of group) if (r !== keep) sameAs.set(r.folder.path, keep.folder.path);
  }
  return sameAs;
}

// A folder holding the folders of titles the app has (Sonarr's "Kids/Bluey")
// can't be added as a title itself. libraryAncestors(items) is every folder
// above an item's folder, worked out once for a whole scan.
export function libraryAncestors(items) {
  const out = new Set();
  for (const it of items || []) {
    if (!it || !it.path) continue;
    const parts = pathKey(it.path).split('/');
    for (let i = 1; i < parts.length; i += 1) out.add(parts.slice(0, i).join('/'));
  }
  return out;
}
export function holdsLibraryItems(folderPath, itemsOrAncestors) {
  const set = itemsOrAncestors instanceof Set ? itemsOrAncestors : libraryAncestors(itemsOrAncestors);
  return set.has(pathKey(folderPath));
}

const mode = (values, fallback) => {
  const counts = new Map();
  for (const v of values) if (v !== undefined && v !== null && v !== '') counts.set(v, (counts.get(v) || 0) + 1);
  let best = fallback; let n = 0;
  for (const [v, c] of counts) if (c > n) { best = v; n = c; }
  return best;
};
// Settings for a root folder, from the titles already in it (the most common
// quality profile, season folders, series type, minimum availability), else
// the library.
export function rootDefaults(rootPath, items, profiles, mediaKind) {
  const root = pathKey(rootPath);
  const inRoot = (items || []).filter((it) => pathKey(it.rootFolderPath || splitPath(it.path || '').parent) === root);
  const pool = inRoot.length ? inRoot : (items || []);
  const ids = new Set((profiles || []).map((p) => p.id));
  const profile = mode(pool.map((it) => it.qualityProfileId).filter((id) => ids.has(id)), (profiles && profiles[0] && profiles[0].id) || null);
  if (mediaKind === 'series') return { qualityProfileId: profile, seasonFolder: mode(pool.map((it) => it.seasonFolder), true) !== false, seriesType: mode(pool.map((it) => it.seriesType), 'standard') };
  return { qualityProfileId: profile, minimumAvailability: mode(pool.map((it) => it.minimumAvailability), 'released') };
}

// Sonarr: 'none' (default) monitors nothing; 'existing' the episodes on disk
// (upgrades only); 'all' every episode. Radarr: 'none' or 'movie'. Nothing is
// ever searched for when adding.
export const SERIES_MONITOR = [['none', 'Nothing (no downloads)'], ['existing', 'Episodes on disk (upgrades)'], ['all', 'All episodes']];
export const MOVIE_MONITOR = [['none', 'No (no downloads)'], ['movie', 'Yes (upgrades)']];
export const SERIES_TYPES = [['standard', 'Standard'], ['daily', 'Daily'], ['anime', 'Anime']];

// The POST series / POST movie body: the lookup result at the folder's own
// path, so Sonarr or Radarr picks up the files where they are.
export function addPayload(mediaKind, pick, folder, settings) {
  const { id, added, statistics, path, rootFolderPath, folder: _f, ...rest } = pick || {};
  const monitor = settings.monitor || 'none';
  const common = {
    ...rest,
    path: folder.path,
    rootFolderPath: folder.root,
    qualityProfileId: Number(settings.qualityProfileId),
    monitored: monitor !== 'none',
    tags: Array.isArray(settings.tags) ? settings.tags : [],
  };
  if (mediaKind === 'series') {
    return {
      ...common,
      seasonFolder: settings.seasonFolder !== false,
      seriesType: pick.seriesType && pick.seriesType !== 'standard' ? pick.seriesType : (settings.seriesType || 'standard'),
      monitorNewItems: monitor === 'all' ? 'all' : 'none',
      addOptions: { monitor: monitor === 'all' ? 'all' : monitor === 'existing' ? 'existing' : 'none', searchForMissingEpisodes: false, searchForCutoffUnmetEpisodes: false },
    };
  }
  return {
    ...common,
    minimumAvailability: settings.minimumAvailability || 'released',
    addOptions: { monitor: monitor === 'none' ? 'none' : 'movieOnly', searchForMovie: false },
  };
}

// The reason a folder isn't offered, in a few words.
export const SKIP_REASONS = {
  episode: 'Downloads of single episodes',
  season: 'Downloads of one season',
  collection: 'Several movies in one folder',
  failed: 'Failed or unfinished downloads',
  system: 'System folders',
  'no-title': 'No title in the name',
  'no-videos': 'No video files',
  holds: 'Folders that hold titles you already have',
  hidden: 'Hidden by you',
};
