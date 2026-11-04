// "Keep this copy instead" for Radarr (and, per episode, Sonarr): replace a movie's current file with a
// better copy sitting in a folder Radarr doesn't manage, using Radarr's own
// Manual Import. Radarr moves the new file into the movie's folder (renamed by
// its naming rules) and removes the old file itself, through its Recycle Bin
// when one is set. Arr Command Center never touches the drives.
import { buildImportCommand, commandOutcome } from './manualImport.js';

const RANK = (q) => {
  const r = Number(q && q.quality && q.quality.resolution) || 0;
  const name = String((q && q.quality && q.quality.name) || '');
  return r * 10 + (/remux/i.test(name) ? 3 : /bluray/i.test(name) ? 2 : /web/i.test(name) ? 1 : 0);
};

// What would happen: the current file, the candidate files in the other
// folder (with Radarr's own rejections), and whether a Recycle Bin is set.
export async function prepareKeepCopy(arr, { item, folder }) {
  const [files, candidates, mm] = await Promise.all([
    arr.get(`moviefile?movieId=${encodeURIComponent(item.id)}`).catch(() => []),
    arr.get(`manualimport?folder=${encodeURIComponent(folder)}&movieId=${encodeURIComponent(item.id)}&filterExistingFiles=false`),
    arr.get('config/mediamanagement').catch(() => ({})),
  ]);
  const current = (Array.isArray(files) ? files : [])[0] || item.movieFile || null;
  const list = (Array.isArray(candidates) ? candidates : [])
    .map((c) => ({ ...c, movie: c.movie || { id: item.id, title: item.title, year: item.year } }))
    .sort((a, b) => RANK(b.quality) - RANK(a.quality) || (b.size || 0) - (a.size || 0));
  const best = list[0] || null;
  return {
    current,
    candidates: list,
    best,
    recycleBin: (mm && mm.recycleBin) || '',
    better: !!(best && (!current || RANK(best.quality) > RANK(current.quality))),
    notUpgrade: !!(best && (best.rejections || []).some((r) => /not an upgrade/i.test(r.reason || ''))),
  };
}

// Sonarr, per episode: each video file in the other folder against the
// current file for the same episode(s). `upgrade` rows are preselected.
export async function prepareKeepCopySeries(arr, { item, folder }) {
  const [files, candidates, mm] = await Promise.all([
    arr.get(`episodefile?seriesId=${encodeURIComponent(item.id)}`).catch(() => []),
    arr.get(`manualimport?folder=${encodeURIComponent(folder)}&seriesId=${encodeURIComponent(item.id)}&filterExistingFiles=false`),
    arr.get('config/mediamanagement').catch(() => ({})),
  ]);
  const byEpisode = new Map();
  for (const f of Array.isArray(files) ? files : []) for (const id of f.episodeIds || (f.episodeId ? [f.episodeId] : [])) byEpisode.set(id, f);
  const rows = (Array.isArray(candidates) ? candidates : []).filter((c) => (c.episodes || []).length).map((c) => {
    const current = (c.episodes || []).map((e) => byEpisode.get(e.id)).find(Boolean) || null;
    const notUpgrade = (c.rejections || []).some((r) => /not an upgrade/i.test(r.reason || ''));
    const better = !current || RANK(c.quality) > RANK(current.quality);
    return { file: { ...c, series: c.series || { id: item.id, title: item.title } }, current, better: better && !notUpgrade, missingNow: !current, notUpgrade };
  }).sort((a, b) => a.file.seasonNumber - b.file.seasonNumber || (a.file.episodes[0].episodeNumber - b.file.episodes[0].episodeNumber));
  return { rows, recycleBin: (mm && mm.recycleBin) || '' };
}

export async function runKeepCopySeries(arr, { item, files, ...rest }) {
  if (!files.length) throw new Error('Choose at least one episode');
  return runImport(arr, { kind: 'series', item, files, ...rest });
}

// Imports `file` for the movie (move mode) and waits for Radarr to finish.
export async function runKeepCopy(arr, { item, file, ...rest }) {
  return runImport(arr, { kind: 'movie', item, files: [{ ...file, movie: file.movie || { id: item.id } }], ...rest });
}

async function runImport(arr, { kind, item, files, wait = 1000, timeoutMs = 120000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const body = buildImportCommand(kind, files, { importMode: 'move' });
  const cmd = await arr.post('command', body);
  const started = Date.now();
  let state = cmd;
  while (commandOutcome(state) === 'pending' && Date.now() - started < timeoutMs) {
    await sleep(wait);
    state = await arr.get(`command/${cmd.id}`);
  }
  const outcome = commandOutcome(state);
  const app = kind === 'series' ? 'Sonarr' : 'Radarr';
  if (outcome !== 'completed') throw new Error(outcome === 'failed' ? (state.message || `${app} reported the import failed`) : `${app} is still importing; check Activity in a minute`);
  const now = await arr.get(kind === 'series' ? `episodefile?seriesId=${encodeURIComponent(item.id)}` : `moviefile?movieId=${encodeURIComponent(item.id)}`).catch(() => []);
  return { command: state, now: kind === 'series' ? (Array.isArray(now) ? now : []) : ((Array.isArray(now) ? now : [])[0] || null) };
}
