// Ratings (Rotten Tomatoes / IMDb) and "where to watch" for the detail popup,
// normalized from Seerr's /movie/{id}/ratingscombined, /tv/{id}/ratings and
// the watchProviders array on movie/tv details (pure; unit-tested).

const safeUrl = (u) => (typeof u === 'string' && /^https:\/\//.test(u) ? u : null);
const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

export function normalizeRatings(data) {
  if (!data || typeof data !== 'object') return [];
  const rt = data.rt !== undefined || data.imdb !== undefined ? data.rt : data; // TV returns RT fields directly
  const imdb = data.imdb;
  const out = [];
  if (rt && typeof rt === 'object') {
    const critics = num(rt.criticsScore);
    if (critics != null) out.push({ source: 'rt-critics', value: `${critics}%`, label: rt.criticsRating || 'Critics', tone: /rotten/i.test(rt.criticsRating || '') || critics < 60 ? 'rotten' : 'fresh', url: safeUrl(rt.url) });
    const aud = num(rt.audienceScore);
    if (aud != null) out.push({ source: 'rt-audience', value: `${aud}%`, label: 'Audience', tone: /spilled/i.test(rt.audienceRating || '') || aud < 60 ? 'rotten' : 'fresh', url: safeUrl(rt.url) });
  }
  if (imdb && typeof imdb === 'object') {
    const v = num(imdb.criticsScore);
    if (v != null) out.push({ source: 'imdb', value: v.toFixed(1), label: 'IMDb', tone: 'imdb', url: safeUrl(imdb.url) });
  }
  return out;
}

const logo = (p) => (p ? `https://image.tmdb.org/t/p/w92${p}` : null);
const list = (arr) => (Array.isArray(arr) ? [...arr].sort((a, b) => (a.displayPriority ?? 99) - (b.displayPriority ?? 99)).map((p) => ({ id: p.id, name: p.name, logo: logo(p.logoPath) })) : []);

// Pick the region's providers (fallback US, then the first region present).
export function providersFor(watchProviders, region = 'US') {
  if (!Array.isArray(watchProviders) || !watchProviders.length) return null;
  const want = String(region || 'US').toUpperCase();
  const r = watchProviders.find((x) => x.iso_3166_1 === want) || watchProviders.find((x) => x.iso_3166_1 === 'US') || watchProviders[0];
  const stream = list(r.flatrate);
  const seen = new Set(stream.map((p) => p.id));
  const free = list(r.free || r.ads).filter((p) => !seen.has(p.id) && seen.add(p.id));
  const rent = list(r.rent).filter((p) => !seen.has(p.id) && seen.add(p.id));
  const buy = list(r.buy).filter((p) => !seen.has(p.id) && seen.add(p.id));
  if (!stream.length && !free.length && !rent.length && !buy.length) return null;
  return { region: r.iso_3166_1, link: safeUrl(r.link), stream, free, rent, buy };
}

// Viewer's region from the browser locale (e.g. en-GB → GB).
export function guessRegion() {
  try {
    const loc = (navigator.languages && navigator.languages[0]) || navigator.language || 'en-US';
    const m = /[-_]([A-Za-z]{2})\b/.exec(loc);
    return m ? m[1].toUpperCase() : 'US';
  } catch { return 'US'; }
}
