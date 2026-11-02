// Bazarr subtitle status for Sonarr/Radarr detail views.
//
// Bazarr keys its records by the Sonarr series/episode ids and the Radarr
// movie id, so a Sonarr series or Radarr movie can be looked up directly:
//   GET /api/movies?radarrid[]=<id>     -> { data: [movie] }
//   GET /api/episodes?seriesid[]=<id>   -> { data: [episode, ...] }
import { movieSearchPath, seriesSearchPath, episodeSearchPaths } from './bazarrSearch.js';

export function bazarrServices(services = []) {
  return services.filter((s) => s && s.type === 'bazarr' && s.configured !== false);
}

const langLabel = (l) => {
  if (!l) return '';
  const code = String(l.code2 || l.code3 || l.name || '').toUpperCase();
  return `${code}${l.forced ? ' forced' : ''}${l.hi ? ' HI' : ''}`;
};
// Bazarr lists external subtitles with a path; embedded ones have path null.
const present = (list) => (Array.isArray(list) ? list : []).filter((s) => s && (s.code2 || s.name));

export function movieSubtitleStatus(record) {
  if (!record) return null;
  const have = present(record.subtitles).map(langLabel);
  const missing = present(record.missing_subtitles).map(langLabel);
  return { have: [...new Set(have)], missing: [...new Set(missing)], searchPaths: missing.length ? [movieSearchPath(record.radarrId)] : [] };
}

export function seriesSubtitleStatus(episodes, seriesId) {
  const list = (Array.isArray(episodes) ? episodes : []).filter((e) => e && (seriesId == null || e.sonarrSeriesId === seriesId));
  if (!list.length) return null;
  const missingEps = list
    .map((e) => ({ ...e, missing: present(e.missing_subtitles) }))
    .filter((e) => e.missing.length)
    .sort((a, b) => (a.season - b.season) || (a.episode - b.episode));
  const have = new Set(list.flatMap((e) => present(e.subtitles).map(langLabel)));
  return {
    episodes: list.length,
    complete: list.length - missingEps.length,
    have: [...have],
    missing: missingEps.map((e) => ({
      id: e.sonarrEpisodeId,
      label: `S${String(e.season ?? 0).padStart(2, '0')}E${String(e.episode ?? 0).padStart(2, '0')}${e.title ? ` · ${e.title}` : ''}`,
      langs: e.missing.map(langLabel),
      searchPaths: episodeSearchPaths({ sonarrSeriesId: e.sonarrSeriesId, sonarrEpisodeId: e.sonarrEpisodeId, missing_subtitles: e.missing }),
    })),
    searchAllPath: missingEps.length ? seriesSearchPath(list[0].sonarrSeriesId) : null,
  };
}

// Query each Bazarr instance until one knows the item.
export async function loadSubtitleStatus(api, services, { isTv, id }) {
  for (const svc of bazarrServices(services)) {
    const bz = api.bazarr(svc.key);
    try {
      if (isTv) {
        const r = await bz.get(`episodes?seriesid[]=${encodeURIComponent(id)}`);
        const status = seriesSubtitleStatus(r && r.data, id);
        if (status) return { svc, bz, status };
      } else {
        const r = await bz.get(`movies?radarrid[]=${encodeURIComponent(id)}`);
        const rec = ((r && r.data) || []).find((m) => m.radarrId === id);
        const status = movieSubtitleStatus(rec);
        if (status) return { svc, bz, status };
      }
    } catch { /* try the next instance */ }
  }
  return null;
}
