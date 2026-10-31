// Bazarr subtitle-search request paths (relative to Bazarr's /api).
//
// Bazarr's PATCH /api/movies and /api/series run an `action`; without one they
// return 400 "Unknown action". /api/episodes is GET-only (PATCH is 405), so a
// single episode is searched per missing language via /api/episodes/subtitles,
// which requires seriesid, episodeid, language, forced and hi.

const flag = (value) => (value === true || String(value).toLowerCase() === 'true' ? 'True' : 'False');
const qs = (params) => new URLSearchParams(params).toString();

export function movieSearchPath(radarrId) {
  return `movies?${qs({ radarrid: radarrId, action: 'search-missing' })}`;
}

export function seriesSearchPath(sonarrSeriesId) {
  return `series?${qs({ seriesid: sonarrSeriesId, action: 'search-missing' })}`;
}

// One request per missing language of a wanted episode. If the item lists no
// languages, fall back to searching the whole series' missing subtitles.
export function episodeSearchPaths(episode = {}) {
  const langs = (Array.isArray(episode.missing_subtitles) ? episode.missing_subtitles : [])
    .filter((lang) => lang && lang.code2);
  if (!langs.length) return [seriesSearchPath(episode.sonarrSeriesId)];
  return langs.map((lang) => `episodes/subtitles?${qs({
    seriesid: episode.sonarrSeriesId,
    episodeid: episode.sonarrEpisodeId,
    language: lang.code2,
    forced: flag(lang.forced),
    hi: flag(lang.hi),
  })}`);
}

// Bazarr's own "search all wanted" actions (one request each, run server-side).
export const SEARCH_ALL_WANTED_PATHS = Object.freeze([
  'series?action=search-wanted',
  'movies?action=search-wanted',
]);
