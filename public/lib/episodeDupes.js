// Episode-level duplicates for Sonarr (pure; no network): the same episode as
// more than one video file. Copies can sit next to the file Sonarr tracks (in
// the show's own folder), in another Sonarr entry for the same show, in a
// folder Sonarr doesn't manage, or somewhere only Plex sees. Grouped by season.
import { pathKey, joinPath } from './pathDoctor.js';

// ------------------------------------------------------------ file names
// Sonarr's own disk scan leaves these out (DiskScanService.FilterPaths), so
// they aren't episodes: extras folders, Plex's optimized versions, NAS
// thumbnails, hidden folders, and "-trailer"-style extras. Samples too.
const EXTRAS_DIR = /(?:\\|\/|^)(?:extras|extrafanart|behind the scenes|deleted scenes|featurettes|interviews|other|scenes|samples|shorts|trailers)(?:\\|\/)/i;
const SKIP_DIR = /(?:\\|\/|^)(?:@eadir|\.@__thumb|plex versions|\.[^\\/]+)(?:\\|\/)/i;
const EXTRA_FILE = /-(?:trailer|other|behindthescenes|deleted|featurette|interview|scene|short)\.[^.]+$/i;
const SKIP_FILE = /^\.(?:_|unmanic|DS_Store$)|^Thumbs\.db$/i;
const SAMPLE = /(?:^|[\s._-])sample(?:[\s._-]|\.[^.]+$)/i;
const VIDEO = /\.(?:mkv|mp4|m4v|avi|ts|m2ts|mov|wmv|mpg|mpeg|webm|divx|xvid|vob|iso|strm)$/i;

const nameOf = (p) => String(p || '').split(/[\\/]/).pop();

// relativePath: the file's path inside the folder that was listed.
export function isEpisodeFile(relativePath) {
  const rel = String(relativePath || '');
  const name = nameOf(rel);
  if (!name || !VIDEO.test(name) || SKIP_FILE.test(name) || EXTRA_FILE.test(name) || SAMPLE.test(name)) return false;
  const dir = rel.slice(0, rel.length - name.length);
  return !EXTRAS_DIR.test(dir) && !SKIP_DIR.test(dir);
}

// Season and episode numbers from a file name: S01E02, S01E02E03,
// S01E02-E04 or S01E02-04 (a range), 1x02, 1x02-03. Null when there are none:
// daily and absolute-numbered (anime) names are left out, not guessed.
export function episodeNumbers(relativePath) {
  const name = nameOf(relativePath);
  const sxe = /(?:^|[^a-z0-9])s(\d{1,3})[ ._-]?e(\d{1,4})(?![0-9])/i.exec(name);
  if (sxe) {
    const season = Number(sxe[1]);
    const eps = [Number(sxe[2])];
    let rest = name.slice(sxe.index + sxe[0].length);
    for (;;) {
      const more = /^[ ._]?-?[ ._]?e(\d{1,4})(?![0-9])/i.exec(rest); // E03, -E03, .E03
      const range = /^-(\d{1,4})(?![0-9p])/i.exec(rest); // -03 (not -1080p)
      const m = more || range;
      if (!m) break;
      const n = Number(m[1]);
      const last = eps[eps.length - 1];
      const isRange = range || /-/.test(m[0]);
      if (isRange && n > last && n - last <= 50) for (let e = last + 1; e <= n; e += 1) eps.push(e);
      else if (n > last && n - last <= 50) eps.push(n);
      else break;
      rest = rest.slice(m[0].length);
    }
    return { season, episodes: [...new Set(eps)] };
  }
  const x = /(?:^|[^0-9a-z])(\d{1,2})x(\d{2,3})(?:-(\d{2,3}))?(?![0-9p])/i.exec(name);
  if (x) {
    const a = Number(x[2]); const b = x[3] ? Number(x[3]) : a;
    const eps = [];
    for (let e = a; e <= (b > a && b - a <= 50 ? b : a); e += 1) eps.push(e);
    return { season: Number(x[1]), episodes: eps };
  }
  return null;
}

// --------------------------------------------------------------- quality
const RES_RANK = (r) => (r >= 2160 ? 4 : r >= 1080 ? 3 : r >= 720 ? 2 : r > 0 ? 1 : 0);
const SOURCE_RANK = { remux: 5, bluray: 4, webdl: 3, webrip: 2, hdtv: 1, dvd: 1, unknown: 0 };
const SOURCE_LABEL = { remux: 'Remux', bluray: 'BluRay', webdl: 'WEB-DL', webrip: 'WEBRip', hdtv: 'HDTV', dvd: 'DVD', unknown: '' };
const rankOf = (resolution, source) => RES_RANK(resolution) * 10 + (SOURCE_RANK[source] || 0);

// A guess from the file name, for files Sonarr doesn't track.
export function qualityFromName(name) {
  const n = nameOf(name);
  const r = /(?:^|[^a-z0-9])(2160|1080|720|576|480)[pi](?![a-z0-9])/i.exec(n);
  const resolution = r ? Number(r[1]) : /(?:^|[^a-z0-9])(?:4k|uhd)(?![a-z0-9])/i.test(n) ? 2160 : 0;
  const source = /(?:^|[^a-z0-9])(?:bd)?remux(?![a-z0-9])/i.test(n) ? 'remux'
    : /(?:^|[^a-z0-9])(?:blu-?ray|bdrip|brrip)(?![a-z0-9])/i.test(n) ? 'bluray'
      : /(?:^|[^a-z0-9])web[ ._-]?rip(?![a-z0-9])/i.test(n) ? 'webrip'
        : /(?:^|[^a-z0-9])(?:web[ ._-]?dl|web)(?![a-z0-9])/i.test(n) ? 'webdl'
          : /(?:^|[^a-z0-9])(?:hdtv|pdtv|sdtv|dsr)(?![a-z0-9])/i.test(n) ? 'hdtv'
            : /(?:^|[^a-z0-9])dvd(?:rip|r)?(?![a-z0-9])/i.test(n) ? 'dvd' : 'unknown';
  const name2 = [resolution ? `${resolution}p` : '', SOURCE_LABEL[source]].filter(Boolean).join(' ');
  return { name: name2 || 'unknown quality', resolution, source, rank: rankOf(resolution, source), guessed: true };
}

// Sonarr's quality for a file it tracks ({ quality: { name, resolution, source } }).
const SONARR_SOURCE = { blurayRaw: 'remux', bluray: 'bluray', web: 'webdl', webRip: 'webrip', television: 'hdtv', televisionRaw: 'hdtv', dvd: 'dvd' };
export function qualityFromSonarr(q) {
  const x = (q && q.quality) || {};
  const source = /remux/i.test(x.name || '') ? 'remux' : SONARR_SOURCE[x.source] || (/webrip/i.test(x.name || '') ? 'webrip' : /web/i.test(x.name || '') ? 'webdl' : /bluray/i.test(x.name || '') ? 'bluray' : /hdtv/i.test(x.name || '') ? 'hdtv' : 'unknown');
  const resolution = Number(x.resolution) || 0;
  return { name: x.name || 'unknown quality', resolution, source, rank: rankOf(resolution, source), guessed: false };
}

// --------------------------------------------------------------- grouping
// Files Plex and Sonarr see under different mount points are matched on the
// last two parts of the path (season folder and file name).
const tail = (p) => String(p || '').replace(/\\/g, '/').split('/').filter(Boolean).slice(-2).join('/').toLowerCase();
const WHERE_ORDER = { tracked: 0, 'other-entry': 1, extra: 2, unmanaged: 3, plex: 4 };

// entries: [{ item, primary, episodes: [EpisodeResource], files: [EpisodeFileResource] }]
//   (episodes and files are empty before the details are loaded)
// disk: [{ where: 'entry' | 'unmanaged', entryId, folder, files: [{ path, relativePath, name }] }]
// sizes: Map(pathKey -> bytes) for files Sonarr doesn't track
// plex: [{ season, episode, parts: [{ file, size }] }]
export function showDuplicates({ entries = [], disk = [], sizes = new Map(), plex = [] } = {}) {
  const titles = new Map();
  const seasonEpisodes = new Map(); // season -> Set(episode) Sonarr knows about
  const byEp = new Map();
  const get = (season, episode) => {
    const k = `${season}:${episode}`;
    if (!byEp.has(k)) byEp.set(k, { season, episode, title: '', copies: new Map() });
    return byEp.get(k);
  };
  const add = (season, episode, copy) => {
    const e = get(season, episode);
    const k = pathKey(copy.path);
    const had = e.copies.get(k);
    // The same file can be listed twice (tracked, then on disk): keep the best label.
    if (!had || WHERE_ORDER[copy.where] < WHERE_ORDER[had.where]) e.copies.set(k, { ...had, ...copy, inPlex: (had && had.inPlex) || copy.inPlex || false });
  };
  const tracked = new Set();
  for (const en of entries) {
    const files = new Map((en.files || []).map((f) => [f.id, f]));
    const where = en.primary ? 'tracked' : 'other-entry';
    const covered = new Set();
    for (const x of en.episodes || []) {
      titles.set(`${x.seasonNumber}:${x.episodeNumber}`, x.title || '');
      if (!seasonEpisodes.has(x.seasonNumber)) seasonEpisodes.set(x.seasonNumber, new Set());
      seasonEpisodes.get(x.seasonNumber).add(x.episodeNumber);
      const f = x.episodeFileId ? files.get(x.episodeFileId) : null;
      if (!f) continue;
      covered.add(f.id);
      const path = f.path || joinPath(en.item.path, f.relativePath || '');
      tracked.add(pathKey(path));
      add(x.seasonNumber, x.episodeNumber, { path, where, entryId: en.item.id, quality: qualityFromSonarr(f.quality), size: Number(f.size) || null, fileId: f.id });
    }
    // Files no episode points at (older Sonarr, or a demo): use the name.
    for (const f of en.files || []) {
      if (covered.has(f.id)) continue;
      const path = f.path || joinPath(en.item.path, f.relativePath || '');
      const n = episodeNumbers(f.relativePath || path);
      tracked.add(pathKey(path));
      if (!n) continue;
      for (const ep of n.episodes) add(n.season, ep, { path, where, entryId: en.item.id, quality: qualityFromSonarr(f.quality), size: Number(f.size) || null, fileId: f.id });
    }
  }
  const unmatched = [];
  for (const d of disk) {
    for (const f of d.files || []) {
      const key = pathKey(f.path);
      if (tracked.has(key)) continue; // the file Sonarr already tracks
      const rel = f.relativePath || f.name || f.path;
      if (!isEpisodeFile(rel)) continue;
      const n = episodeNumbers(rel);
      if (!n) { unmatched.push({ path: f.path, where: d.where === 'unmanaged' ? 'unmanaged' : 'extra', folder: d.folder }); continue; }
      const size = sizes.has(key) ? sizes.get(key) : null;
      for (const ep of n.episodes) {
        add(n.season, ep, { path: f.path, where: d.where === 'unmanaged' ? 'unmanaged' : 'extra', entryId: d.entryId || null, folder: d.folder, quality: qualityFromName(f.name || rel), size });
      }
    }
  }
  for (const p of plex || []) {
    if (p.season == null || p.episode == null) continue;
    const e = get(Number(p.season), Number(p.episode));
    e.plexFiles = (p.parts || []).length;
    for (const part of p.parts || []) {
      const t = tail(part.file);
      const hit = [...e.copies.values()].find((c) => tail(c.path) === t);
      if (hit) { hit.inPlex = true; if (hit.size == null && part.size) hit.size = Number(part.size); }
      else add(e.season, e.episode, { path: part.file, where: 'plex', quality: qualityFromName(part.file), size: Number(part.size) || null, inPlex: true });
    }
  }

  // Episodes with more than one copy, best copy first.
  const seasons = new Map();
  for (const e of byEp.values()) {
    if (e.copies.size < 2) continue;
    e.title = titles.get(`${e.season}:${e.episode}`) || '';
    const copies = [...e.copies.values()].sort((a, b) => b.quality.rank - a.quality.rank
      || WHERE_ORDER[a.where] - WHERE_ORDER[b.where] || (b.size || 0) - (a.size || 0) || a.path.localeCompare(b.path));
    copies[0].best = true;
    const mine = copies.find((c) => c.where === 'tracked');
    // A copy Sonarr could import instead (not a Plex-only path, not another
    // entry's tracked file) that beats the file it has, or fills a gap.
    const better = copies.find((c) => (c.where === 'extra' || c.where === 'unmanaged') && (!mine || c.quality.rank > mine.quality.rank)) || null;
    const extraBytes = copies.slice(1).reduce((n, c) => n + (c.size || 0), 0);
    const row = { season: e.season, episode: e.episode, title: e.title, copies, plexFiles: e.plexFiles || 0, better, extraBytes, sonarrFile: mine || null };
    if (!seasons.has(e.season)) seasons.set(e.season, []);
    seasons.get(e.season).push(row);
  }
  const list = [...seasons.entries()].map(([season, eps]) => ({
    season,
    episodes: eps.sort((a, b) => a.episode - b.episode),
    known: seasonEpisodes.has(season) ? seasonEpisodes.get(season).size : null,
    extraBytes: eps.reduce((n, e) => n + e.extraBytes, 0),
    better: eps.filter((e) => e.better).length,
  })).sort((a, b) => (a.season === 0) - (b.season === 0) || a.season - b.season); // specials last
  return {
    seasons: list,
    unmatched,
    episodes: list.reduce((n, s) => n + s.episodes.length, 0),
    extraBytes: list.reduce((n, s) => n + s.extraBytes, 0),
    better: list.reduce((n, s) => n + s.better, 0),
  };
}

export const seasonName = (n) => (Number(n) === 0 ? 'Specials' : `Season ${n}`);
export const episodeCode = (s, e) => `S${String(s).padStart(2, '0')}E${String(e).padStart(2, '0')}`;

// What a copy is, in a few words (also used in the CSV).
export function copyRole(c, primaryId, app = 'Sonarr') {
  if (c.where === 'tracked') return `${app}’s file`;
  if (c.where === 'other-entry') return `${app}’s file in the other entry`;
  if (c.where === 'extra') return c.entryId === primaryId ? `Not tracked, next to ${app}’s files` : 'Not tracked, in the other entry’s folder';
  if (c.where === 'unmanaged') return `In a folder ${app} doesn’t manage`;
  return 'Only Plex sees this one';
}

// CSV rows (the duplicate finder's columns) for one show's duplicate episodes.
export function episodeCsvRows(show, detail, app = 'Sonarr') {
  const rows = [];
  for (const sn of (detail && detail.seasons) || []) {
    for (const e of sn.episodes) {
      for (const c of e.copies) {
        rows.push(['episode', `${show.title} ${episodeCode(e.season, e.episode)}${e.title ? ` ${e.title}` : ''}`, '', copyRole(c, show.primary && show.primary.id, app), c.path,
          c.best ? 'keep' : 'extra', 'yes', 'yes', c.quality.name, c.size || '', '']);
      }
    }
  }
  return rows;
}
