// Pure (DOM-free) helpers for Sonarr/Radarr manual ("interactive") import.
// The modal UI lives in arrActions.js; everything here is unit-testable.
//
//   kind: 'series' (Sonarr) | 'movie' (Radarr)
//
// Wire contract (Sonarr/Radarr v3, mirrors their own InteractiveImport UI):
//   GET  manualimport?downloadId=…|folder=…&filterExistingFiles=true → candidates
//   POST manualimport [items]                                        → reprocess (re-evaluate rejections)
//   POST command { name: 'ManualImport', importMode, files: [...] }  → import

// Tracked-download states where the *arr has finished downloading but could
// not (or will not) import on its own.
const STUCK_STATES = new Set(['importblocked', 'importfailed']);

const lc = (v) => String(v || '').toLowerCase();

// True when a queue record is a completed download waiting on a human.
export function isImportStuck(record) {
  if (!record) return false;
  const state = lc(record.trackedDownloadState);
  const status = lc(record.trackedDownloadStatus);
  if (STUCK_STATES.has(state)) return true;
  if (state === 'importpending' && (status === 'warning' || status === 'error')) return true;
  // Older builds don't always set trackedDownloadState — fall back to a
  // completed download carrying a warning.
  if (!state && lc(record.status) === 'completed' && status === 'warning') return true;
  return false;
}

// Whether offering manual import makes sense at all (needs a downloadId, and
// the download must be finished — still-downloading items have no files yet).
export function canManualImport(record) {
  if (!record || !record.downloadId) return false;
  if (isImportStuck(record)) return true;
  const state = lc(record.trackedDownloadState);
  if (state === 'importpending') return true;
  if (state === 'downloading' || state === 'importing' || state === 'imported' || state.startsWith('failed')) return false;
  return lc(record.status) === 'completed';
}

// Human-readable label for a tracked-download state.
export function queueStateLabel(record) {
  const map = {
    downloading: 'Downloading', importpending: 'Import pending', importblocked: 'Import blocked',
    importfailed: 'Import failed', importing: 'Importing', imported: 'Imported',
    failedpending: 'Failed', failed: 'Failed', ignored: 'Ignored',
  };
  return map[lc(record && record.trackedDownloadState)] || (record && record.status) || 'unknown';
}

// Flatten the *arr's statusMessages ([{ title, messages: [] }]) + errorMessage
// into a de-duplicated list of strings explaining why a download is stuck.
export function queueStatusMessages(record) {
  const out = [];
  const push = (s) => { const t = String(s || '').trim(); if (t && !out.includes(t)) out.push(t); };
  for (const group of (record && record.statusMessages) || []) {
    const msgs = (group && group.messages) || [];
    if (msgs.length) msgs.forEach(push); else push(group && group.title);
  }
  push(record && record.errorMessage);
  return out;
}

// Query string for fetching import candidates.
export function manualImportQuery({ downloadId, folder } = {}) {
  const params = new URLSearchParams();
  if (downloadId) params.set('downloadId', downloadId);
  else if (folder) params.set('folder', folder);
  params.set('filterExistingFiles', 'true');
  return `manualimport?${params.toString()}`;
}

// "S02E10" / "S02E10, S02E11"
export function episodeLabel(item) {
  return ((item && item.episodes) || [])
    .map((e) => `S${String(e.seasonNumber ?? item.seasonNumber ?? 0).padStart(2, '0')}E${String(e.episodeNumber).padStart(2, '0')}`)
    .join(', ');
}

// Why an item can't be imported yet (null when it's ready). Mirrors the
// checks Sonarr/Radarr's own UI runs before sending the command.
export function validateImportItem(kind, item) {
  if (!item) return 'Missing file';
  if (kind === 'series') {
    if (!item.series) return 'Choose a series';
    if (item.seasonNumber == null || Number.isNaN(Number(item.seasonNumber))) return 'Choose a season';
    if (!item.episodes || !item.episodes.length) return 'Choose episode(s)';
  } else if (!item.movie) return 'Choose a movie';
  if (!item.quality || !item.quality.quality) return 'Choose a quality';
  if (!item.languages) return 'Choose a language';
  return null;
}

// Pre-select files that are ready and have no rejections. Rejected files stay
// selectable (manual import can force past e.g. "Not an upgrade") but opt-in.
export function defaultSelection(kind, items) {
  return (items || []).filter((it) => !validateImportItem(kind, it) && !((it.rejections || []).length)).map((it) => it.id);
}

// One entry of the ManualImport command's `files` array.
export function buildImportFile(kind, item, downloadId) {
  const file = {
    path: item.path,
    folderName: item.folderName,
    releaseGroup: item.releaseGroup,
    quality: item.quality,
    languages: item.languages,
    indexerFlags: item.indexerFlags || 0,
    downloadId: downloadId || item.downloadId || undefined,
  };
  if (kind === 'series') {
    file.seriesId = item.series.id;
    file.episodeIds = item.episodes.map((e) => e.id);
    file.releaseType = item.releaseType;
    if (item.episodeFileId) file.episodeFileId = item.episodeFileId;
  } else {
    file.movieId = item.movie.id;
    if (item.movieFileId) file.movieFileId = item.movieFileId;
  }
  // Drop undefined keys so the payload stays tidy.
  for (const k of Object.keys(file)) if (file[k] === undefined) delete file[k];
  return file;
}

// The full command body. Throws with a readable message if any selected item
// isn't ready. When importing a tracked download the *arr requires 'auto'.
export function buildImportCommand(kind, items, { downloadId, importMode } = {}) {
  const list = items || [];
  if (!list.length) throw new Error('Select at least one file');
  for (const it of list) {
    const problem = validateImportItem(kind, it);
    if (problem) throw new Error(`${it.name || it.relativePath || it.path}: ${problem}`);
  }
  const mode = downloadId ? 'auto' : (importMode === 'copy' ? 'copy' : importMode === 'move' ? 'move' : 'auto');
  return { name: 'ManualImport', importMode: mode, files: list.map((it) => buildImportFile(kind, it, downloadId)) };
}

// Body for POST manualimport (reprocess) after the user changes a mapping.
export function reprocessPayload(kind, item, downloadId) {
  const base = {
    id: item.id, path: item.path, downloadId: downloadId || item.downloadId,
    releaseGroup: item.releaseGroup, quality: item.quality, languages: item.languages,
    indexerFlags: item.indexerFlags || 0,
  };
  if (kind === 'series') {
    return { ...base, seriesId: item.series ? item.series.id : undefined, seasonNumber: item.seasonNumber, episodeIds: (item.episodes || []).map((e) => e.id), releaseType: item.releaseType };
  }
  return { ...base, movieId: item.movie ? item.movie.id : undefined };
}

// Merge a reprocess response into the local item. The server doesn't echo the
// series object back (Sonarr), so keep our own series/movie unless provided.
export function mergeReprocessed(kind, item, processed) {
  if (!processed) return item;
  const next = { ...item };
  for (const k of ['seasonNumber', 'episodes', 'rejections', 'quality', 'languages', 'releaseGroup', 'releaseType', 'indexerFlags', 'customFormats', 'customFormatScore']) {
    if (processed[k] !== undefined && processed[k] !== null) next[k] = processed[k];
  }
  if (kind === 'movie' && processed.movie) next.movie = processed.movie;
  return next;
}

// Season numbers for a series (real Sonarr: `seasons[]`; fall back to seasonCount).
export function seriesSeasons(series) {
  if (!series) return [];
  if (Array.isArray(series.seasons) && series.seasons.length) {
    return series.seasons.map((s) => s.seasonNumber).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  }
  const n = Number(series.seasonCount) || 0;
  return Array.from({ length: n }, (_, i) => i + 1);
}

// Build the quality model the import command expects from a qualitydefinition entry.
export function qualityFromDefinition(def, previous) {
  if (!def || !def.quality) return previous;
  return { quality: def.quality, revision: (previous && previous.revision) || { version: 1, real: 0, isRepack: false } };
}

// Terminal command states reported by GET command/{id}.
export function commandOutcome(cmd) {
  const s = lc(cmd && (cmd.status || cmd.state));
  if (s === 'completed') return 'completed';
  if (s === 'failed' || s === 'aborted' || s === 'cancelled' || s === 'orphaned') return 'failed';
  return 'pending';
}
