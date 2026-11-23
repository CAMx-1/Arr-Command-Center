// Pure (DOM-free) helpers for book managers (Chaptarr, legacy Readarr):
// manual import, the queue, unmapped files, retag previews and books listed
// twice. The UI is lib/bookImportUI.js, lib/bookToolsUI.js and
// views/readarr.js.
//
// Manual import works the way Chaptarr's own Interactive Import does (API v1):
//   GET  manualimport?downloadId=…  or  ?folder=…[&bookFileIds=…&mediaType=…]
//   POST manualimport [items]   re-checks items after a change (writes nothing)
//   POST command { name: 'ManualImport', importMode: 'auto', files, previewFiles }
// Chaptarr wants authorId, bookId and editionId for each file; legacy Readarr
// wants the book's foreignEditionId. A file Chaptarr only matched to metadata
// (an author who isn't in the library yet) goes in as a suggestion instead.

const lc = (v) => String(v ?? '').toLowerCase();
const hasId = (x) => !!(x && Number(x.id) > 0);

// Chaptarr's import candidates carry fields legacy Readarr's don't.
export function isChaptarrItem(item) {
  return !!item && ('isGraphicAudio' in item || 'editionId' in item || 'warnings' in item || 'suggestedForeignAuthorId' in item);
}

export function bookImportQuery({ downloadId, folder, bookFileIds, mediaType, filterExistingFiles = true } = {}) {
  const p = new URLSearchParams();
  if (downloadId) p.set('downloadId', downloadId);
  else if (folder) p.set('folder', folder);
  if (!downloadId) for (const id of bookFileIds || []) p.append('bookFileIds', String(id));
  if (mediaType) p.set('mediaType', mediaType);
  p.set('filterExistingFiles', String(filterExistingFiles !== false));
  return `manualimport?${p.toString()}`;
}

// What a file still needs before it can be imported, checked the way
// Chaptarr's Interactive Import checks it. problem is null when the file is
// ready; suggestion is true when it goes in as a metadata suggestion.
export function importReadiness(item) {
  if (!item) return { problem: 'Missing file', suggestion: false };
  const localAuthor = hasId(item.author);
  const suggestedAuthor = !!item.suggestedForeignAuthorId;
  const book = hasId(item.book);
  const edition = isChaptarrItem(item) ? Number(item.editionId) > 0 : !!(item.foreignEditionId || Number(item.editionId) > 0);
  const suggestion = !(localAuthor && book && edition) && suggestedAuthor;
  let problem = null;
  if (!localAuthor && !suggestedAuthor) problem = 'Choose the author and book';
  else if (localAuthor && !book && !suggestion) problem = 'Choose the book';
  else if (localAuthor && book && !edition && !suggestion) problem = 'Choose an edition';
  else if (!item.quality || !item.quality.quality) problem = 'Choose a quality';
  return { problem, suggestion };
}

// Files that start out ticked: ready, without rejections, and not marked
// "don't select" by Chaptarr. Files that would add a book from metadata
// start unticked unless Chaptarr says otherwise, as in its own Interactive
// Import. Rejected files can still be ticked by hand.
export function defaultBookSelection(items) {
  return (items || [])
    .filter((it) => {
      if (it.selectByDefault === false || (it.rejections || []).length) return false;
      const { problem, suggestion } = importReadiness(it);
      return !problem && (!suggestion || it.selectByDefault === true);
    })
    .map((it) => it.id);
}

const SUGGESTION_FIELDS = ['suggestedForeignAuthorId', 'suggestedAuthorName', 'suggestedForeignBookId', 'suggestedBookTitle', 'suggestedForeignEditionId', 'suggestedEditionTitle'];
const dropUndefined = (o) => { for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k]; return o; };

// One entry of the ManualImport command's files.
export function buildBookImportFile(item, downloadId) {
  const { suggestion } = importReadiness(item);
  const file = {
    path: item.path,
    authorId: !suggestion && hasId(item.author) ? item.author.id : 0,
    bookId: !suggestion && hasId(item.book) ? item.book.id : 0,
    quality: item.quality,
    releaseGroup: item.releaseGroup,
    indexerFlags: item.indexerFlags || 0,
    downloadId: item.downloadId || downloadId || undefined,
    disableReleaseSwitching: !!item.disableReleaseSwitching,
  };
  if (isChaptarrItem(item)) {
    file.editionId = !suggestion && file.bookId && Number(item.editionId) > 0 ? Number(item.editionId) : 0;
    file.selectionSource = suggestion ? 'userMetadataSuggestion' : 'automatic';
    if (suggestion) {
      Object.assign(file, {
        foreignAuthorId: item.suggestedForeignAuthorId, foreignAuthorName: item.suggestedAuthorName,
        foreignBookId: item.suggestedForeignBookId, foreignBookTitle: item.suggestedBookTitle,
        foreignEditionId: item.suggestedForeignEditionId, foreignEditionTitle: item.suggestedEditionTitle,
      });
    }
  } else {
    file.foreignEditionId = item.foreignEditionId;
  }
  return dropUndefined(file);
}

const fileLabel = (it) => it.name || it.relativePath || String(it.path || '').split('/').pop() || 'File';

// The ManualImport command. Throws with a readable message when a chosen file
// isn't ready. Existing files are never replaced: Chaptarr asks for an extra
// confirmation for that, which this app doesn't give.
export function buildBookImportCommand(selected, { downloadId, all } = {}) {
  const list = selected || [];
  if (!list.length) throw new Error('Choose at least one file');
  for (const it of list) {
    const { problem } = importReadiness(it);
    if (problem) throw new Error(`${fileLabel(it)}: ${problem.toLowerCase()}`);
  }
  return {
    name: 'ManualImport',
    importMode: 'auto',
    replaceExistingFiles: false,
    files: list.map((it) => buildBookImportFile(it, downloadId)),
    previewFiles: (all || list).map((it) => dropUndefined({ path: it.path, bookId: hasId(it.book) ? it.book.id : 0, downloadId: it.downloadId || downloadId || undefined })),
  };
}

// Body item for POST manualimport after the author or book changed.
export function bookReprocessPayload(item, downloadId) {
  const out = {
    id: item.id, path: item.path, name: item.name,
    authorId: hasId(item.author) ? item.author.id : undefined,
    bookId: hasId(item.book) ? item.book.id : undefined,
    quality: item.quality, releaseGroup: item.releaseGroup, indexerFlags: item.indexerFlags || 0,
    downloadId: item.downloadId || downloadId || undefined,
    additionalFile: !!item.additionalFile, replaceExistingFiles: false, disableReleaseSwitching: !!item.disableReleaseSwitching,
  };
  if (isChaptarrItem(item)) {
    out.editionId = Number(item.editionId) > 0 ? Number(item.editionId) : undefined;
    for (const k of SUGGESTION_FIELDS) out[k] = item[k];
    out.warnings = item.warnings || [];
  } else {
    out.foreignEditionId = item.foreignEditionId;
  }
  return dropUndefined(out);
}

// A file moved to another author: the book and edition have to be chosen again.
export function withAuthor(item, author) {
  const next = { ...item, author: author || undefined, book: undefined, edition: undefined, editionId: undefined, foreignEditionId: undefined, rejections: [] };
  for (const k of SUGGESTION_FIELDS) next[k] = undefined;
  return next;
}
// A file moved to another book of the same author: the edition is re-picked.
export function withBook(item, book) {
  const next = { ...item, book: book || undefined, edition: undefined, editionId: undefined, foreignEditionId: undefined, rejections: [] };
  for (const k of SUGGESTION_FIELDS) if (k !== 'suggestedForeignAuthorId' && k !== 'suggestedAuthorName') next[k] = undefined;
  return next;
}

// Chaptarr's answer to a re-check, merged into the file. The answer leaves
// out fields it wasn't sent (the name), so the file keeps its own.
const MERGE_FIELDS = ['author', 'book', 'edition', 'editionId', 'foreignEditionId', 'quality', 'rejections', 'warnings', 'releaseGroup',
  'indexerFlags', 'customFormats', 'isGraphicAudio', 'disableReleaseSwitching', ...SUGGESTION_FIELDS];
export function mergeBookReprocessed(item, processed) {
  if (!processed) return item;
  const next = { ...item };
  for (const k of MERGE_FIELDS) if (processed[k] !== undefined && processed[k] !== null) next[k] = processed[k];
  return next;
}

// A book's editions (GET edition?bookId=) -> the one to import into: the
// monitored edition, else the first.
export function pickEdition(editions, bookId) {
  const list = (Array.isArray(editions) ? editions : []).filter((e) => e && (!bookId || !e.bookId || e.bookId === bookId));
  return list.find((e) => e.monitored) || list[0] || null;
}

// Import candidates grouped by the book they'd go to, for display.
export function groupImportItems(items) {
  const groups = new Map();
  for (const it of items || []) {
    const suggestion = !hasId(it.book) && it.suggestedBookTitle;
    const key = hasId(it.book) ? `b:${it.book.id}` : suggestion ? `s:${lc(it.suggestedForeignBookId || it.suggestedBookTitle)}` : 'none';
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        author: hasId(it.author) ? it.author : null,
        book: hasId(it.book) ? it.book : null,
        suggestedAuthor: it.suggestedAuthorName || '',
        suggestedBook: suggestion || '',
        items: [],
      });
    }
    groups.get(key).items.push(it);
  }
  // Matched books first, then suggestions, then files with no match.
  const rank = (g) => (g.book ? 0 : g.suggestedBook ? 1 : 2);
  return [...groups.values()].sort((a, b) => rank(a) - rank(b) || String((a.book && a.book.title) || a.suggestedBook).localeCompare(String((b.book && b.book.title) || b.suggestedBook)));
}

export function rejectionText(r) {
  return typeof r === 'string' ? r : String((r && (r.reason || r.message)) || '').trim();
}

// ---- Queue -----------------------------------------------------------------

const STUCK_STATES = new Set(['importblocked', 'importfailed']);

// Finished downloads that won't import by themselves.
export function isBookImportStuck(r) {
  if (!r) return false;
  const state = lc(r.trackedDownloadState);
  const status = lc(r.trackedDownloadStatus);
  if (STUCK_STATES.has(state)) return true;
  if (state === 'importpending' && (status === 'warning' || status === 'error')) return true;
  return !state && lc(r.status) === 'completed' && status === 'warning';
}

// Which actions Chaptarr's own queue offers for a record.
export function bookQueueActions(r) {
  const status = lc(r && r.status);
  const state = lc(r && r.trackedDownloadState);
  const finished = status === 'completed' || ['importpending', 'importblocked', 'importfailed'].includes(state);
  return {
    importFiles: !!(r && r.downloadId) && finished && state !== 'imported' && state !== 'importing',
    stuck: isBookImportStuck(r),
    retry: !!(r && r.canRetryImport && r.downloadId),
    grab: status === 'delay' || status === 'downloadclientunavailable',
    ignore: !!(r && r.downloadId),
  };
}

// Every message the app gave for a record, without repeats.
export function bookQueueMessages(r) {
  const out = [];
  const push = (s) => { const t = String(s || '').trim(); if (t && !out.includes(t)) out.push(t); };
  for (const g of (r && r.statusMessages) || []) {
    const msgs = (g && g.messages) || [];
    if (msgs.length) msgs.forEach(push); else push(g && g.title);
  }
  push(r && r.errorMessage);
  return out;
}

// Messages that only say "not imported" go last, so the one shown first says why.
const GENERIC = /^(source file has not been imported|import completion could not be proven|one or more (books|files) expected in this release were not imported|no files found are eligible for import)/i;
export function bookQueueReasons(r) {
  const all = bookQueueMessages(r);
  return [...all.filter((m) => !GENERIC.test(m)), ...all.filter((m) => GENERIC.test(m))];
}

// What a reason points at, so the row can offer the right fix.
export function queueProblemKind(r) {
  const text = bookQueueMessages(r).join(' \n ');
  if (/not accessible|does not exist|path not found|isn.t accessible|remote path mapping/i.test(text)) return 'path';
  if (/wasn.t grabbed by|was not grabbed by/i.test(text)) return 'notGrabbed';
  if (/grabbed for .* but import matched|matched .* bookid/i.test(text)) return 'otherBook';
  if (/no audio|no files found|no eligible|not a valid|no book files/i.test(text)) return 'noFiles';
  return isBookImportStuck(r) ? 'stuck' : '';
}

export function isUnknownAuthor(r) {
  return !!r && !(Number(r.authorId) > 0) && !hasId(r.author);
}

// Whether a download's folder looks like it's inside one of the app's root
// folders (the library). The download client and the app can see one folder
// under different paths (Docker), so a folder whose parent has the root
// folder's name counts too. Removing such a download from the client can
// delete files the library already uses. Returns the root folder's path.
export function inLibraryFolder(outputPath, roots) {
  const p = String(outputPath || '').replace(/\/+$/, '');
  if (!p) return null;
  for (const r of roots || []) {
    const root = String((r && typeof r === 'object' ? r.path : r) || '').replace(/\/+$/, '');
    if (!root) continue;
    if (lc(p).startsWith(`${lc(root)}/`)) return root;
    const name = lc(basename(root));
    if (name && lc(basename(dirname(p))) === name) return root;
  }
  return null;
}

// Records that need a person: stuck imports, failed downloads and warnings.
export function needsAttention(r) {
  if (!r) return false;
  if (isBookImportStuck(r)) return true;
  const status = lc(r.status);
  const tds = lc(r.trackedDownloadStatus);
  return status === 'failed' || status === 'warning' || tds === 'warning' || tds === 'error';
}

export const QUEUE_FILTERS = [
  { id: 'all', label: 'All', test: () => true },
  { id: 'attention', label: 'Needs attention', test: needsAttention },
  { id: 'active', label: 'Downloading', test: (r) => !needsAttention(r) },
];

export function queueCounts(records) {
  const out = { all: 0, attention: 0, active: 0, unknown: 0 };
  for (const r of records || []) {
    out.all++;
    if (needsAttention(r)) out.attention++; else out.active++;
    if (isUnknownAuthor(r)) out.unknown++;
  }
  return out;
}

// ---- Unmapped files ----------------------------------------------------------

const AUDIO_EXT = new Set(['mp3', 'm4a', 'm4b', 'aac', 'flac', 'ogg', 'oga', 'opus', 'wma', 'wav', 'aif', 'aiff', 'alac', 'ape', 'wv', 'mka', 'mp4', 'mp2', 'spx', 'dsf']);
const EBOOK_EXT = new Set(['epub', 'mobi', 'azw', 'azw3', 'kfx', 'pdf', 'cbz', 'cbr', 'cb7', 'djvu', 'fb2', 'txt', 'rtf', 'lit', 'pdb', 'docx', 'doc']);
export function mediaTypeOfPath(path) {
  const ext = lc(String(path || '').split('.').pop());
  if (AUDIO_EXT.has(ext)) return 'audiobook';
  if (EBOOK_EXT.has(ext)) return 'ebook';
  return '';
}
const dirname = (p) => String(p || '').replace(/\/[^/]*$/, '');
const basename = (p) => String(p || '').replace(/\/+$/, '').split('/').pop();

// GET bookfile?unmapped=true -> one entry per import unit (a book's folder,
// as Chaptarr groups them) and format, largest share of the work first.
export function unmappedUnits(files) {
  const units = new Map();
  for (const f of files || []) {
    const mediaType = f.mediaType || mediaTypeOfPath(f.path);
    const unit = f.importUnitKey || `dir:${dirname(f.path)}`;
    const key = `${unit}|${mediaType}`;
    if (!units.has(key)) {
      const root = f.importUnitRoot || dirname(f.path);
      units.set(key, { key, root, name: basename(root) || root, mediaType, files: [], size: 0, added: 0 });
    }
    const u = units.get(key);
    u.files.push(f);
    u.size += Number(f.size) || 0;
    u.added = Math.max(u.added, Date.parse(f.dateAdded) || 0);
  }
  const list = [...units.values()].map((u) => ({ ...u, ids: u.files.map((f) => f.id), count: u.files.length }));
  // Chaptarr can split one folder into several units (a UK and a US epub):
  // single files that would share a name are named after the file instead.
  const names = new Map();
  for (const u of list) names.set(u.name, (names.get(u.name) || 0) + 1);
  for (const u of list) if (names.get(u.name) > 1 && u.count === 1) u.name = basename(u.files[0].path);
  return list.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
}

// ---- Retag preview -----------------------------------------------------------

const FIELD_LABELS = {
  TITLE: 'Title', ALBUM: 'Album', ARTIST: 'Artist', ALBUMARTIST: 'Album artist', COMPOSER: 'Composer', NARRATOR: 'Narrator',
  YEAR: 'Year', DATE: 'Date', PUBLISHER: 'Publisher', TRACKNUMBER: 'Track number', TRACKCOUNT: 'Track count', DISCNUMBER: 'Disc number',
  DISCCOUNT: 'Disc count', GENRE: 'Genre', GENRES: 'Genres', COMMENT: 'Comment', SERIES: 'Series', SERIESPART: 'Series number',
  ISBN: 'ISBN', ASIN: 'ASIN', LANGUAGE: 'Language', DESCRIPTION: 'Description', COVER: 'Cover', IMAGE: 'Cover', SUBTITLE: 'Subtitle',
};
export function retagFieldLabel(field) {
  const f = String(field || '').toUpperCase().replace(/[^A-Z]/g, '');
  return FIELD_LABELS[f] || String(field || '').toLowerCase().replace(/(^|[\s_-])\w/g, (c) => c.toUpperCase()).replace(/[_-]/g, ' ');
}

// GET retag?authorId= -> per book: its files and, per tag, how many files
// change and an example. titlesCollapse marks a book whose files' own titles
// (chapter names) would all become one title. A preview's bookId is the
// file's edition, not its book, so the author's files (GET bookfile?authorId=)
// say which book each file is; without them a group is named after its folder.
export function retagSummary(previews, books = [], files = []) {
  const byBook = new Map();
  const titleOf = new Map((books || []).map((b) => [b.id, b.title]));
  const bookOfFile = new Map((files || []).filter((f) => f && Number(f.bookId) > 0).map((f) => [f.id, Number(f.bookId)]));
  for (const p of previews || []) {
    if (!p || !(p.changes || []).length) continue;
    const bookId = bookOfFile.get(p.bookFileId ?? p.id) || 0;
    const key = bookId ? `b:${bookId}` : `e:${p.bookId || 0}`;
    if (!byBook.has(key)) byBook.set(key, { key, bookId, title: (bookId && titleOf.get(bookId)) || basename(dirname(p.path)), files: [], fields: new Map() });
    const g = byBook.get(key);
    g.files.push(p);
    for (const c of p.changes) {
      const field = String(c.field || '');
      if (!g.fields.has(field)) g.fields.set(field, { field, label: retagFieldLabel(field), count: 0, olds: new Set(), news: new Set(), example: c });
      const s = g.fields.get(field);
      s.count++;
      s.olds.add(c.oldValue ?? '');
      s.news.add(c.newValue ?? '');
    }
  }
  return [...byBook.values()].map((g) => {
    const fields = [...g.fields.values()].map((s) => ({ field: s.field, label: s.label, count: s.count, distinctOld: s.olds.size, distinctNew: s.news.size, example: s.example }));
    const title = fields.find((f) => f.field.toUpperCase() === 'TITLE');
    return {
      key: g.key, bookId: g.bookId, title: g.title, files: g.files, ids: g.files.map((f) => f.bookFileId || f.id),
      fields,
      titlesCollapse: !!title && title.count > 1 && title.distinctOld > 1 && title.distinctNew === 1,
    };
  }).sort((a, b) => String(a.title).localeCompare(String(b.title)));
}

// ---- Books listed twice ------------------------------------------------------

// Titles compared without case, punctuation or a leading article. Anything
// else that differs ("Part 2", "Vol. 1", "[Dramatized Adaptation]") makes
// it another book.
export function normalizeBookTitle(title) {
  return lc(title)
    .replace(/&/g, ' and ')
    .replace(/^\s*(the|a|an)\s+/, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

// Where a book's metadata came from, from its id prefix (Chaptarr: hc:, gr:, az:, ol:).
const SOURCES = { hc: 'Hardcover', gr: 'Goodreads', az: 'Amazon', ol: 'Open Library', gb: 'Google Books', au: 'Audible', ab: 'Audible', isbn: 'ISBN' };
const SOURCE_RANK = ['hc', 'gr', 'ol', 'gb', 'au', 'ab', 'az'];
const sourceKey = (b) => lc((String((b && b.foreignBookId) || '').match(/^([a-z]+):/i) || [])[1]);
export function bookSource(b) {
  const k = sourceKey(b);
  return k ? (SOURCES[k] || k.toUpperCase()) : '';
}

const bookHasFiles = (b) => !!(b && (b.hasFiles || b.hasFile || (b.statistics && Number(b.statistics.bookFileCount) > 0)));

// Books of one author that look like the same book (same title and format),
// from Chaptarr mixing metadata sources. When copies are monitored, each is
// searched for and downloaded on its own, so one book gets downloaded twice.
//   keep:      the copy to keep monitored: one with files, else the one in a
//              series, from the first metadata source, with the most ratings
//   redundant: the other monitored copies without files (safe to unmonitor:
//              no file changes, and they can be monitored again)
export function duplicateBooks(books, { hasFile = bookHasFiles } = {}) {
  const groups = new Map();
  for (const b of books || []) {
    const t = normalizeBookTitle(b && b.title);
    if (!t) continue;
    const key = `${b.mediaType || ''}|${t}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(b);
  }
  const rank = (b) => { const i = SOURCE_RANK.indexOf(sourceKey(b)); return i < 0 ? SOURCE_RANK.length : i; };
  const votes = (b) => Number(b && b.ratings && b.ratings.votes) || 0;
  const out = [];
  for (const [key, list] of groups) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) => Number(hasFile(b)) - Number(hasFile(a))
      || Number(!!b.seriesTitle) - Number(!!a.seriesTitle)
      || rank(a) - rank(b) || votes(b) - votes(a) || a.id - b.id);
    const keep = sorted[0];
    const redundant = sorted.filter((b) => b !== keep && b.monitored && !hasFile(b));
    out.push({ key, title: keep.title, mediaType: keep.mediaType || '', books: sorted, keep, withFiles: sorted.filter(hasFile).length, redundant });
  }
  return out.sort((a, b) => b.redundant.length - a.redundant.length || String(a.title).localeCompare(String(b.title)));
}
