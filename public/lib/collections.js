// "Complete your collections" for Radarr: TMDB collections (trilogies,
// franchises) where you have some films but not all. Uses Radarr's own
// collection list (GET collection, Radarr v4.2+), so no TMDB key is needed.

export function incomplete(collections, { includeUnreleased = false, now = Date.now() } = {}) {
  const year = new Date(now).getUTCFullYear();
  const out = [];
  for (const c of collections || []) {
    const movies = c.movies || [];
    const have = movies.filter((m) => m.isExisting);
    if (!have.length) continue; // only collections you've started
    const missing = movies.filter((m) => !m.isExisting && !m.isExcluded && (includeUnreleased || (m.status !== 'announced' && m.status !== 'tba' && (!m.year || m.year <= year))));
    if (!missing.length) continue;
    out.push({ id: c.id, title: c.title, tmdbId: c.tmdbId, have: have.length, total: movies.length, missing: missing.sort((a, b) => (a.year || 9999) - (b.year || 9999)), haveTitles: have.map((m) => m.title) });
  }
  // Nearly complete first: one film away from done is the most satisfying.
  return out.sort((a, b) => a.missing.length - b.missing.length || b.have - a.have || a.title.localeCompare(b.title));
}

export const posterOf = (m) => ((m.images || []).find((i) => i.coverType === 'poster') || {}).remoteUrl || '';

// Add one missing film the way Radarr's Add screen does: look it up by TMDB
// id, then POST it with the chosen profile and folder.
export async function addMissing(arr, movie, { qualityProfileId, rootFolderPath, search = true }) {
  const found = await arr.get(`movie/lookup?term=${encodeURIComponent(`tmdb:${movie.tmdbId}`)}`);
  const item = (found || []).find((x) => x.tmdbId === movie.tmdbId) || (found || [])[0] || movie;
  return arr.post('movie', {
    title: item.title, year: item.year, tmdbId: movie.tmdbId, titleSlug: item.titleSlug, images: item.images || [],
    qualityProfileId: Number(qualityProfileId), rootFolderPath, monitored: true, minimumAvailability: 'released',
    addOptions: { searchForMovie: !!search },
  });
}
