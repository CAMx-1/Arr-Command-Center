// Interactive-search release filters, remembered per Sonarr/Radarr instance
// (so a 4K instance can default to 2160p while the HD one shows everything).
// Pure helpers — the UI lives in views/releaseSearch.js.

export const RESOLUTIONS = ['2160p', '1080p', '720p', 'SD'];
export const DEFAULT_FILTERS = Object.freeze({ resolutions: [], protocol: 'any', minGB: '', maxGB: '', hideRejected: false });
const key = (svcKey) => `release-filters:${svcKey}`;
const storageFor = (s) => s || globalThis.localStorage;

export function loadReleaseFilters(svcKey, storage) {
  try {
    const v = JSON.parse(storageFor(storage).getItem(key(svcKey)) || 'null');
    if (!v || typeof v !== 'object') return { ...DEFAULT_FILTERS };
    return {
      resolutions: Array.isArray(v.resolutions) ? v.resolutions.filter((r) => RESOLUTIONS.includes(r)) : [],
      protocol: ['any', 'usenet', 'torrent'].includes(v.protocol) ? v.protocol : 'any',
      minGB: numOrBlank(v.minGB), maxGB: numOrBlank(v.maxGB),
      hideRejected: !!v.hideRejected,
    };
  } catch { return { ...DEFAULT_FILTERS }; }
}

export function saveReleaseFilters(svcKey, filters, storage) {
  try { storageFor(storage).setItem(key(svcKey), JSON.stringify(filters)); } catch { /* ignore */ }
}

export function isDefaultFilters(f) {
  return !f.resolutions.length && f.protocol === 'any' && f.minGB === '' && f.maxGB === '' && !f.hideRejected;
}

function numOrBlank(v) {
  if (v === '' || v === null || v === undefined) return '';
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : '';
}

// Resolution bucket for a release: prefer the parsed quality resolution, then
// fall back to the quality name / title.
export function releaseResolution(rel) {
  const res = Number(rel?.quality?.quality?.resolution);
  if (res >= 2000) return '2160p';
  if (res >= 1000) return '1080p';
  if (res >= 700) return '720p';
  if (res > 0) return 'SD';
  const text = `${rel?.quality?.quality?.name || ''} ${rel?.title || ''}`;
  if (/2160p|4k|uhd/i.test(text)) return '2160p';
  if (/1080p/i.test(text)) return '1080p';
  if (/720p/i.test(text)) return '720p';
  return 'SD';
}

const GB = 1024 ** 3;
export function filterReleases(releases, f) {
  const min = f.minGB === '' ? 0 : Number(f.minGB) * GB;
  const max = f.maxGB === '' ? Infinity : Number(f.maxGB) * GB;
  return (releases || []).filter((r) => {
    if (f.hideRejected && !r.approved) return false;
    if (f.protocol !== 'any' && r.protocol !== f.protocol) return false;
    if (f.resolutions.length && !f.resolutions.includes(releaseResolution(r))) return false;
    const size = Number(r.size) || 0;
    return size >= min && size <= max;
  });
}
