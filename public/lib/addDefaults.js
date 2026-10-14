// Remembered "add" settings per Sonarr/Radarr instance (quality profile, root
// folder, monitor, search-on-add) and the preferred instance per media type,
// so global Search can add a title in one tap. Pure helpers are exported for
// tests; storage is localStorage (synced by fallbackSync like other prefs).

const KEY = (svcKey) => `add-defaults-${svcKey}`;
const INSTANCE_KEY = (mediaType) => `add-instance-${mediaType}`;

function read(key) {
  try { const v = JSON.parse(localStorage.getItem(key) || 'null'); return v && typeof v === 'object' ? v : null; } catch { return null; }
}

export function getAddDefaults(svcKey) { return read(KEY(svcKey)); }

export function setAddDefaults(svcKey, { qualityProfileId, rootFolderPath, monitored = true, searchOnAdd = true }) {
  try {
    localStorage.setItem(KEY(svcKey), JSON.stringify({ qualityProfileId: Number(qualityProfileId), rootFolderPath: String(rootFolderPath), monitored: !!monitored, searchOnAdd: !!searchOnAdd }));
  } catch { /* storage full/blocked: defaults just aren't remembered */ }
}

export function clearAddDefaults(svcKey) { try { localStorage.removeItem(KEY(svcKey)); } catch { /* ignore */ } }

// Saved defaults are only usable while the profile and root folder still exist
// on the instance; otherwise return null so the caller asks again.
export function resolveAddDefaults(saved, profiles = [], folders = []) {
  if (!saved) return null;
  const profile = profiles.find((p) => p.id === Number(saved.qualityProfileId));
  const folder = folders.find((f) => f.path === saved.rootFolderPath);
  if (!profile || !folder) return null;
  return { qualityProfileId: profile.id, profileName: profile.name, rootFolderPath: folder.path, monitored: saved.monitored !== false, searchOnAdd: saved.searchOnAdd !== false };
}

// Initial picks for the options sheet: saved values if still valid, else the
// first profile/folder the instance reports.
export function initialAddChoices(saved, profiles = [], folders = []) {
  const r = resolveAddDefaults(saved, profiles, folders);
  if (r) return r;
  return {
    qualityProfileId: profiles[0]?.id ?? null,
    // Skip folders Sonarr/Radarr report as unavailable (e.g. an unmounted drive).
    rootFolderPath: (folders.find((f) => f.accessible !== false) || folders[0])?.path ?? null,
    monitored: saved ? saved.monitored !== false : true,
    searchOnAdd: saved ? saved.searchOnAdd !== false : true,
  };
}

// The instance one-tap Add targets for a media type: the remembered one if it's
// still configured, else the first configured instance of the matching type.
export function preferredInstance(services, mediaType, rememberedKey) {
  const type = mediaType === 'tv' ? 'sonarr' : 'radarr';
  const list = (services || []).filter((s) => s.type === type && s.configured !== false);
  return list.find((s) => s.key === rememberedKey) || list[0] || null;
}
export function getPreferredInstanceKey(mediaType) { try { return localStorage.getItem(INSTANCE_KEY(mediaType)); } catch { return null; } }
export function setPreferredInstanceKey(mediaType, svcKey) { try { localStorage.setItem(INSTANCE_KEY(mediaType), svcKey); } catch { /* ignore */ } }

// Sonarr/Radarr POST body for a lookup result.
export function buildAddPayload(mediaType, item, choice) {
  const common = {
    title: item.title, year: item.year, titleSlug: item.titleSlug, images: item.images || [],
    qualityProfileId: Number(choice.qualityProfileId), rootFolderPath: choice.rootFolderPath,
    monitored: choice.monitored !== false,
  };
  if (mediaType === 'tv') {
    return { ...common, tvdbId: item.tvdbId, seasons: item.seasons || [], seasonFolder: true, addOptions: { monitor: choice.monitored !== false ? 'all' : 'none', searchForMissingEpisodes: !!choice.searchOnAdd } };
  }
  return { ...common, tmdbId: item.tmdbId, addOptions: { searchForMovie: !!choice.searchOnAdd } };
}

// Drop lookup results already in the library (movies by tmdbId, series by
// tvdbId, falling back to normalized title + year).
const norm = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
export function notInLibrary(results, mediaType, library) {
  const lib = (library || []).filter((x) => x.mediaType === mediaType);
  const ids = new Set(lib.map((x) => (mediaType === 'tv' ? x.tvdbId : x.tmdbId)).filter(Boolean));
  const names = new Set(lib.map((x) => `${norm(x.title)}|${x.year || ''}`));
  return (results || []).filter((r) => {
    const id = mediaType === 'tv' ? r.tvdbId : r.tmdbId;
    if (id && ids.has(id)) return false;
    return !names.has(`${norm(r.title)}|${r.year || ''}`);
  });
}
