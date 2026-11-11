// File health checks from the media info Sonarr/Radarr already store for each
// file (no extra disk reads). Pure; flags files that are probably broken or
// mislabelled so they can be searched again.
//
// Checks:
//   unreadable  - no media info at all (the file couldn't be analysed)
//   no-audio    - no audio stream
//   no-video    - no video stream
//   short       - runtime well under the expected length (truncated / sample)
//   tiny        - smaller than the quality's minimum size for its runtime
//   mislabelled - quality says 2160p but the picture is HD (or the reverse)
//   old-codec   - XviD/DivX/MPEG-2/WMV and similar
//   lang-*      - audio and subtitle languages (see languageIssues), when a
//                 language is given

import { joinPath, sepOf } from './pathDoctor.js';
import { langCode, langList, langName } from './languages.js';

const OLD_CODECS = /^(xvid|divx|mpeg-?4( part 2| visual)?|mpeg-?2|mpeg2video|wmv\d?|vc-?1|h\.?263|msmpeg4)/i;

export function parseRuntime(rt) {
  if (rt == null || rt === '') return 0;
  if (typeof rt === 'number') return rt; // seconds
  const parts = String(rt).split(':').map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return 0;
  return parts.reduce((s, n) => s * 60 + n, 0);
}

const heightOf = (mi) => {
  const m = /x(\d+)/i.exec(String((mi && mi.resolution) || ''));
  return m ? Number(m[1]) : Number(mi && mi.height) || 0;
};

// Audio and subtitle languages against the language you watch in. Files whose
// audio languages aren't tagged are left alone.
//   lang-missing - no audio in your language. A problem when the title's
//                  original language is yours (an Italian-only copy of an
//                  English film); to check when the original isn't known.
//   lang-second  - your language is there but isn't the first audio track,
//                  and the first isn't the original language either (iTA-ENG
//                  releases). Many players start with the first track.
//   lang-subs    - a foreign-language title with neither audio nor subtitles
//                  in your language inside the file.
export function languageIssues(mi, { language = null, original = null } = {}) {
  const want = langCode(language);
  if (!want || !mi) return [];
  const audio = langList(mi.audioLanguages);
  const known = audio.filter(Boolean);
  if (!known.length) return [];
  const orig = langCode(original);
  const W = langName(want);
  const names = (codes) => [...new Set(codes)].map(langName).join(', ');
  if (!known.includes(want)) {
    if (orig && orig !== want) {
      if (langList(mi.subtitles).includes(want)) return [];
      return [{ id: 'lang-subs', level: 'info', text: `${names(known)} audio and no ${W} subtitles in the file (subtitle files next to it aren’t checked)` }];
    }
    return [{ id: 'lang-missing', level: orig ? 'error' : 'warn', text: `No ${W} audio: ${names(known)} only` }];
  }
  const first = audio[0];
  if (first && first !== want && first !== orig) {
    return [{ id: 'lang-second', level: 'warn', text: `${W} is audio track ${audio.indexOf(want) + 1} of ${audio.length}; the first is ${langName(first)}, which many players start with` }];
  }
  return [];
}
// True when the file's audio languages are tagged (so the check could run).
export const hasAudioLanguages = (mi) => !!(mi && langList(mi.audioLanguages).some(Boolean));

// file: { size, quality, mediaInfo, relativePath }, expectedMinutes: from the
// movie/episode, defs: Map(qualityId -> { minSize MB/min, profile? }),
// language: the language you watch in (none: no language checks), original:
// the title's original language.
export function checkFile(file, { expectedMinutes = 0, defs = new Map(), language = null, original = null } = {}) {
  const issues = [];
  const mi = file && file.mediaInfo;
  if (!mi || (!mi.videoCodec && !mi.audioCodec && !mi.runTime)) {
    issues.push({ id: 'unreadable', level: 'error', text: 'No media info: the file may be damaged or unreadable' });
    return issues;
  }
  if (!mi.videoCodec) issues.push({ id: 'no-video', level: 'error', text: 'No video stream' });
  if (!mi.audioCodec || Number(mi.audioChannels) === 0 || Number(mi.audioStreamCount) === 0) issues.push({ id: 'no-audio', level: 'error', text: 'No audio stream' });
  const secs = parseRuntime(mi.runTime);
  if (expectedMinutes > 0 && secs > 0 && secs < expectedMinutes * 60 * 0.6) {
    issues.push({ id: 'short', level: 'error', text: `Runs ${Math.round(secs / 60)} min; expected about ${expectedMinutes} min` });
  } else if (secs === 0) {
    issues.push({ id: 'short', level: 'warn', text: 'Runtime is unknown' });
  }
  const q = file.quality && file.quality.quality;
  const def = q && defs.get(q.id);
  const minutes = secs ? secs / 60 : expectedMinutes;
  if (def && def.minSize && minutes > 0 && file.size) {
    const mbPerMin = file.size / 1048576 / minutes;
    if (mbPerMin < def.minSize * 0.5) issues.push({ id: 'tiny', level: 'warn', text: def.profile ? `Only ${mbPerMin.toFixed(1)} MB/min; the ${def.profile} profile asks for at least ${def.minSize} MB/min for ${q.name}` : `Only ${mbPerMin.toFixed(1)} MB/min; ${q.name} is normally at least ${def.minSize} MB/min` });
  }
  const height = heightOf(mi);
  const res = Number(q && q.resolution) || 0;
  if (height && res) {
    if (res >= 2160 && height < 1500) issues.push({ id: 'mislabelled', level: 'warn', text: `Labelled ${q.name} but the picture is ${height}p` });
    else if (res <= 1080 && height >= 2000) issues.push({ id: 'mislabelled', level: 'info', text: `Labelled ${q.name} but the picture is ${height}p` });
  }
  if (mi.videoCodec && OLD_CODECS.test(mi.videoCodec)) issues.push({ id: 'old-codec', level: 'info', text: `Old video codec (${mi.videoCodec})` });
  issues.push(...languageIssues(mi, { language, original }));
  return issues;
}

const RANK = { error: 3, warn: 2, info: 1 };
export function worst(issues) { return issues.reduce((w, i) => (RANK[i.level] > RANK[w] ? i.level : w), 'info'); }

// profileDefs (Sonarr 5): sizes from the item's own quality profile, used
// instead of the quality definitions when the profile has them.
// Movies: one file each (movieFile on the movie).
export function checkMovies(movies, defs, profileDefs = new Map(), { language = null } = {}) {
  return (movies || []).filter((m) => m.movieFile).map((m) => ({
    id: m.id, title: `${m.title}${m.year ? ` (${m.year})` : ''}`, file: m.movieFile, path: joinPath(m.path, String(m.movieFile.relativePath).split(/[\\/]/).join(sepOf(m.path)), sepOf(m.path)),
    issues: checkFile(m.movieFile, { expectedMinutes: Number(m.runtime) || 0, defs: profileDefs.get(m.qualityProfileId) || defs, language, original: m.originalLanguage }),
  })).filter((r) => r.issues.length);
}

// Episodes: files from episodefile?seriesId=..., runtime from the series.
export function checkEpisodeFiles(series, files, defs, profileDefs = new Map(), { language = null } = {}) {
  const use = profileDefs.get(series.qualityProfileId) || defs;
  return (files || []).map((f) => ({
    id: f.id, seriesId: series.id, title: `${series.title} · ${f.relativePath ? f.relativePath.split(/[\\/]/).pop() : `file ${f.id}`}`, file: f, path: f.path || joinPath(series.path, String(f.relativePath || '').split(/[\\/]/).join(sepOf(series.path)), sepOf(series.path)),
    issues: checkFile(f, { expectedMinutes: Number(series.runtime) || 0, defs: use, language, original: series.originalLanguage }),
  })).filter((r) => r.issues.length);
}

export function defsMap(qualitydefinition) {
  return new Map((qualitydefinition || []).filter((d) => d.quality).map((d) => [d.quality.id, { minSize: Number(d.minSize) || 0, maxSize: Number(d.maxSize) || 0 }]));
}

// Sonarr 5 keeps size limits on each quality in each quality profile; its
// quality definitions no longer have them. profileId -> Map(qualityId ->
// { minSize, maxSize, profile }), for profiles that have any.
export function profileSizesMap(qualityprofiles) {
  const out = new Map();
  for (const p of qualityprofiles || []) {
    const sizes = new Map();
    const walk = (items) => {
      for (const it of items || []) {
        if (it.items && it.items.length) walk(it.items);
        else if (it.quality && (it.minSize != null || it.maxSize != null)) sizes.set(it.quality.id, { minSize: Number(it.minSize) || 0, maxSize: Number(it.maxSize) || 0, profile: p.name });
      }
    };
    walk(p.items);
    if (sizes.size) out.set(p.id, sizes);
  }
  return out;
}

// Network side: read files, quality definitions and profiles, then check them.
// languageUnknown: files with media info whose audio languages aren't tagged.
export async function scanFileHealth(arr, { kind, maxSeries = 400, onProgress = () => {}, language = null } = {}) {
  const [qd, qp] = await Promise.all([arr.get('qualitydefinition').catch(() => []), arr.get('qualityprofile').catch(() => [])]);
  const defs = defsMap(qd);
  const profileDefs = profileSizesMap(qp);
  if (kind !== 'series') {
    const movies = await arr.get('movie');
    const withFile = (movies || []).filter((m) => m.movieFile);
    return { checked: withFile.length, results: checkMovies(movies, defs, profileDefs, { language }), languageUnknown: withFile.filter((m) => m.movieFile.mediaInfo && !hasAudioLanguages(m.movieFile.mediaInfo)).length, items: withFile };
  }
  const series = ((await arr.get('series')) || []).filter((s) => (s.statistics && s.statistics.episodeFileCount) || 0).slice(0, maxSeries);
  const results = [];
  let checked = 0; let done = 0; let languageUnknown = 0;
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, series.length) }, async () => {
    while (next < series.length) {
      const s = series[next++];
      const files = await arr.get(`episodefile?seriesId=${encodeURIComponent(s.id)}`).catch(() => []);
      checked += (files || []).length;
      languageUnknown += (files || []).filter((f) => f.mediaInfo && !hasAudioLanguages(f.mediaInfo)).length;
      results.push(...checkEpisodeFiles(s, files, defs, profileDefs, { language }));
      onProgress({ done: ++done, total: series.length });
    }
  }));
  return { checked, results, languageUnknown, items: series };
}
