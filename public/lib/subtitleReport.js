// Missing-subtitles report from Bazarr's wanted lists: counts per language,
// episodes grouped by show, and the search requests for a selection. Pure.
import { seriesSearchPath, movieSearchPath } from './bazarrSearch.js';

const flag = (v) => (v ? 'True' : 'False');
const qs = (o) => new URLSearchParams(Object.entries(o).map(([k, v]) => [k, String(v)])).toString();

export function langKey(l) { return `${l.code2 || '??'}${l.forced ? ':forced' : ''}${l.hi ? ':hi' : ''}`; }
export function langLabel(l) { return `${l.name || l.code2 || '??'}${l.forced ? ' (forced)' : ''}${l.hi ? ' (HI)' : ''}`; }
const missing = (x) => (Array.isArray(x.missing_subtitles) ? x.missing_subtitles : []).filter((l) => l && l.code2);

export function summarize(episodes = [], movies = []) {
  const langs = new Map();
  const bump = (l, side) => { const k = langKey(l); const e = langs.get(k) || { key: k, label: langLabel(l), episodes: 0, movies: 0 }; e[side] += 1; langs.set(k, e); };
  for (const e of episodes) for (const l of missing(e)) bump(l, 'episodes');
  for (const m of movies) for (const l of missing(m)) bump(l, 'movies');
  const shows = new Map();
  for (const e of episodes) {
    const s = shows.get(e.sonarrSeriesId) || { seriesId: e.sonarrSeriesId, title: e.seriesTitle || `Series ${e.sonarrSeriesId}`, episodes: [], langs: new Set() };
    s.episodes.push(e); for (const l of missing(e)) s.langs.add(langKey(l));
    shows.set(e.sonarrSeriesId, s);
  }
  return {
    languages: [...langs.values()].sort((a, b) => (b.episodes + b.movies) - (a.episodes + a.movies) || a.label.localeCompare(b.label)),
    shows: [...shows.values()].map((s) => ({ ...s, langs: [...s.langs] })).sort((a, b) => b.episodes.length - a.episodes.length || a.title.localeCompare(b.title)),
    movies: movies.slice().sort((a, b) => String(a.title).localeCompare(String(b.title))),
  };
}

export const hasLang = (item, key) => !key || missing(item).some((l) => langKey(l) === key);

// Requests to search the selected shows and movies, limited to one language
// when `lang` is set. Episodes get one request per missing language; movies
// use the per-language call when filtered, else Bazarr's search-missing.
export function searchPaths({ episodes = [], movies = [], seriesIds = new Set(), radarrIds = new Set(), lang = null }) {
  const out = [];
  for (const e of episodes) {
    if (!seriesIds.has(e.sonarrSeriesId)) continue;
    const ls = missing(e).filter((l) => !lang || langKey(l) === lang);
    if (!missing(e).length && !lang) { out.push(seriesSearchPath(e.sonarrSeriesId)); continue; }
    for (const l of ls) out.push(`episodes/subtitles?${qs({ seriesid: e.sonarrSeriesId, episodeid: e.sonarrEpisodeId, language: l.code2, forced: flag(l.forced), hi: flag(l.hi) })}`);
  }
  for (const m of movies) {
    if (!radarrIds.has(m.radarrId)) continue;
    if (!lang) { out.push(movieSearchPath(m.radarrId)); continue; }
    for (const l of missing(m).filter((x) => langKey(x) === lang)) out.push(`movies/subtitles?${qs({ radarrid: m.radarrId, language: l.code2, forced: flag(l.forced), hi: flag(l.hi) })}`);
  }
  return [...new Set(out)];
}
