// Pure helpers for Readarr-compatible book managers (Chaptarr, legacy
// Readarr): pictures, statistics, series grouping, book states and the
// add/edit/remove request bodies. The network side is views/readarr.js.
//
// Chaptarr keeps audiobook and ebook settings side by side on one author
// (audiobookQualityProfileId, ebookRootFolderPath, ...) and gives each format
// its own book entries (mediaType). Readarr has a single set of fields.

export const FORMATS = {
  audiobook: { key: 'audiobook', label: 'Audiobooks', one: 'Audiobook', icon: '🎧' },
  ebook: { key: 'ebook', label: 'Ebooks', one: 'Ebook', icon: '📖' },
};

// Readarr / Chaptarr "Monitor" choices when adding an author (MonitorTypes),
// and "Monitor new books" (NewItemMonitorTypes).
export const MONITOR_OPTIONS = [
  ['all', 'All books'], ['future', 'Future books'], ['missing', 'Missing books'],
  ['existing', 'Existing books'], ['first', 'First book'], ['latest', 'Latest book'], ['none', 'None'],
];
export const NEW_ITEM_OPTIONS = [['all', 'All new books'], ['new', 'New releases only'], ['none', 'None']];

// ---- Pictures -------------------------------------------------------------

const isHttp = (u) => typeof u === 'string' && /^https?:\/\//i.test(u);
const isDataImage = (u) => typeof u === 'string' && /^data:image\//i.test(u);

// First browser-loadable image among `types` (null = any type). The app's own
// /MediaCover paths need its login session, so only absolute URLs are used:
// remoteUrl (the metadata CDN), or url when the app already made it absolute.
export function imageUrl(images, types = [null]) {
  const list = Array.isArray(images) ? images.filter(Boolean) : [];
  for (const type of types) {
    for (const img of list) {
      if (type && img.coverType !== type) continue;
      if (isHttp(img.remoteUrl) || isDataImage(img.remoteUrl)) return img.remoteUrl;
      if (isHttp(img.url)) return img.url;
    }
  }
  return '';
}
export function authorImage(a) {
  return imageUrl(a && a.images, ['poster', 'headshot', null]) || (isHttp(a && a.remotePoster) ? a.remotePoster : '');
}
export function bookCover(b) {
  return imageUrl(b && b.images, ['cover', null]) || (isHttp(b && b.remoteCover) ? b.remoteCover : '');
}

export function initials(name) {
  const parts = String(name || '').split(/[\s.]+/).filter((p) => /[\p{L}\p{N}]/u.test(p));
  if (!parts.length) return '?';
  const first = [...parts[0]][0];
  const last = parts.length > 1 ? [...parts[parts.length - 1]][0] : '';
  return `${first}${last}`.toUpperCase();
}
export function nameHue(name) {
  let hash = 0;
  for (const ch of String(name || '')) hash = (hash * 31 + ch.codePointAt(0)) % 360;
  return hash;
}
// Stand-in for an author with no picture (the honeycomb tile background).
export function nameGradient(name) {
  const hue = nameHue(name);
  return `linear-gradient(160deg, hsl(${hue} 42% 42%), hsl(${(hue + 40) % 360} 48% 22%))`;
}

// ---- Authors --------------------------------------------------------------

// Chaptarr-style author, root folder or profile (formats side by side).
export function isFormatAware(x) {
  if (!x || typeof x !== 'object') return false;
  return x.folderType !== undefined || x.profileType !== undefined
    || 'audiobookMonitored' in x || 'audiobookStatistics' in x || 'ebookStatistics' in x
    || 'audiobookRootFolderPath' in x || 'ebookRootFolderPath' in x;
}

// The formats a Chaptarr author is set up for (those with a root folder).
export function authorFormats(a) {
  if (!isFormatAware(a)) return [];
  return ['audiobook', 'ebook'].filter((f) => a[`${f}RootFolderPath`] || a[`${f}Folder`]);
}

export function authorSortKey(a) {
  return String((a && (a.sortNameLastFirst || a.authorNameLastFirst || a.sortName || a.authorName)) || '').toLowerCase();
}
export function compareAuthors(a, b) {
  return authorSortKey(a).localeCompare(authorSortKey(b)) || String(a.authorName || '').localeCompare(String(b.authorName || ''));
}

// Library numbers from the app's own statistics. bookCount is the number of
// monitored books; availableBookCount the monitored ones on disk; one
// audiobook can be many files, so files are counted apart from books.
// Chaptarr also counts each format apart (audiobookStatistics, ...).
export function authorStats(a, format = '') {
  const s = (format && a && a[`${format}Statistics`]) || (a && a.statistics) || {};
  const monitored = Number(s.bookCount) || 0;
  const have = Number(s.availableBookCount) || 0;
  const percent = monitored ? Math.max(0, Math.min(100, Number.isFinite(Number(s.percentOfBooks)) && Number(s.percentOfBooks) > 0 ? Number(s.percentOfBooks) : (100 * have) / monitored)) : null;
  return { files: Number(s.bookFileCount) || 0, size: Number(s.sizeOnDisk) || 0, monitored, have, total: Number(s.totalBookCount) || 0, percent };
}

export function authorStatusLabel(a) {
  if (!a || !a.status) return '';
  return a.status === 'ended' ? 'Ended' : a.status === 'continuing' ? 'Continuing' : String(a.status);
}

// ---- Books ----------------------------------------------------------------

export function hasBookFile(b) {
  return !!(b && (b.hasFiles || b.hasFile || (b.statistics && Number(b.statistics.bookFileCount) > 0)));
}
export function isReleased(b, now = Date.now()) {
  const t = Date.parse(b && b.releaseDate);
  return !Number.isFinite(t) || t <= now;
}
// A release date as a day. Books carry a date at midnight UTC, which
// toLocaleDateString would show as the day before west of Greenwich.
export function bookDate(dateish) {
  const t = Date.parse(dateish);
  if (!Number.isFinite(t)) return '';
  const d = new Date(t);
  const midnightUtc = d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', ...(midnightUtc ? { timeZone: 'UTC' } : {}) });
}
export function bookYear(b) {
  const t = Date.parse(b && b.releaseDate);
  return Number.isFinite(t) ? new Date(t).getUTCFullYear() : null;
}
const releaseTime = (b) => { const t = Date.parse(b && b.releaseDate); return Number.isFinite(t) ? t : Infinity; };

export function bookState(b, now = Date.now()) {
  if (hasBookFile(b)) return { id: 'ondisk', label: 'On disk', cls: 'ok' };
  if (!b || !b.monitored) return { id: 'unmonitored', label: 'Not monitored', cls: 'muted' };
  if (!isReleased(b, now)) return { id: 'upcoming', label: 'Not released yet', cls: 'info' };
  return { id: 'missing', label: 'Missing', cls: 'warn' };
}

export const BOOK_FILTERS = [
  { id: 'relevant', label: 'Monitored or on disk', test: (b) => !!b.monitored || hasBookFile(b) },
  { id: 'missing', label: 'Missing', test: (b) => bookState(b).id === 'missing' },
  { id: 'ondisk', label: 'On disk', test: (b) => hasBookFile(b) },
  { id: 'unmonitored', label: 'Not monitored', test: (b) => !b.monitored && !hasBookFile(b) },
  { id: 'all', label: 'All books', test: () => true },
];

export function filterBooks(books, { filter = 'relevant', term = '', format = '' } = {}) {
  const def = BOOK_FILTERS.find((f) => f.id === filter) || BOOK_FILTERS[0];
  const t = String(term || '').trim().toLowerCase();
  return (books || []).filter((b) => (!format || !b.mediaType || b.mediaType === format)
    && def.test(b)
    && (!t || `${b.title || ''} ${b.seriesTitle || ''}`.toLowerCase().includes(t)));
}

// Counts for the author page (from the books themselves, not the statistics).
export function bookCounts(books, now = Date.now()) {
  const out = { total: 0, ondisk: 0, monitored: 0, missing: 0, upcoming: 0 };
  for (const b of books || []) {
    out.total++;
    if (b.monitored) out.monitored++;
    const st = bookState(b, now).id;
    if (st === 'ondisk') out.ondisk++;
    else if (st === 'missing') out.missing++;
    else if (st === 'upcoming') out.upcoming++;
  }
  return out;
}

// "The Empyrean #3.5" -> { name: 'The Empyrean', position: 3.5 }. Readarr
// joins several series with "; ".
export function parseSeriesLabel(label) {
  const text = String(label || '').trim();
  if (!text) return null;
  const m = text.match(/^(.*?)\s*\(?#\s*(\d+(?:\.\d+)?)(?:\s*[-–]\s*\d+(?:\.\d+)?)?\)?\s*$/);
  if (m && m[1].trim()) return { name: m[1].trim().replace(/[,;:]$/, ''), position: Number(m[2]) };
  return { name: text, position: null };
}
export function bookSeries(b) {
  const labels = Array.isArray(b && b.seriesLabels) && b.seriesLabels.length
    ? b.seriesLabels
    : String((b && b.seriesTitle) || '').split(';');
  for (const label of labels) { const s = parseSeriesLabel(label); if (s) return s; }
  return null;
}

// Books grouped by their (first) series, each in reading order, series by
// first release; books in no series come last.
export function groupBySeries(books) {
  const groups = new Map();
  for (const b of books || []) {
    const s = bookSeries(b);
    const key = s ? s.name.toLowerCase() : '';
    if (!groups.has(key)) groups.set(key, { name: s ? s.name : '', items: [] });
    groups.get(key).items.push({ book: b, position: s ? s.position : null });
  }
  const list = [...groups.values()].map((g) => {
    g.items.sort((x, y) => (x.position ?? Infinity) - (y.position ?? Infinity)
      || releaseTime(x.book) - releaseTime(y.book)
      || String(x.book.title || '').localeCompare(String(y.book.title || '')));
    return { name: g.name, books: g.items.map((i) => i.book), positions: new Map(g.items.map((i) => [i.book.id, i.position])) };
  });
  const first = (g) => Math.min(...g.books.map(releaseTime));
  list.sort((a, b) => (a.name ? 0 : 1) - (b.name ? 0 : 1) || first(a) - first(b) || a.name.localeCompare(b.name));
  return list;
}

// ---- Requests -------------------------------------------------------------

// Chaptarr root folder type: 0 holds both formats, 1 audiobooks, 2 ebooks.
export function folderFormats(folder) {
  if (!folder || folder.folderType === undefined || folder.folderType === null) return [];
  const t = Number(folder.folderType);
  if (t === 2) return ['ebook'];
  if (t === 0) return ['audiobook', 'ebook'];
  return ['audiobook'];
}

const known = (list, value) => list.some(([v]) => v === value);
function monitorChoice(value) {
  const v = String(value || '').toLowerCase();
  return known(MONITOR_OPTIONS, v) ? v : null;
}
function newItemChoice(value) {
  const v = String(value || '').toLowerCase();
  return known(NEW_ITEM_OPTIONS, v) ? v : null;
}

// What a root folder suggests for a new author (Chaptarr per format, Readarr
// through its default* fields).
export function folderDefaults(folder, format = null) {
  if (!folder) return {};
  if (format) {
    const side = folder[format] || {};
    return {
      qualityProfileId: side.qualityProfileId ?? folder[`${format}QualityProfileId`] ?? null,
      metadataProfileId: side.metadataProfileId ?? folder[`${format}MetadataProfileId`] ?? null,
      monitor: monitorChoice(side.monitorExistingMode ?? folder[`${format}MonitorExistingMode`]),
      monitorNewItems: newItemChoice(side.monitorNewItems ?? folder[`${format}MonitorNewItems`]),
    };
  }
  return {
    qualityProfileId: folder.defaultQualityProfileId ?? null,
    metadataProfileId: folder.defaultMetadataProfileId ?? null,
    monitor: monitorChoice(folder.defaultMonitorOption),
    monitorNewItems: newItemChoice(folder.defaultNewItemMonitorOption),
  };
}

// Profiles that fit a format (Chaptarr profiles carry profileType; Readarr's
// don't, so all of them fit).
export function profilesFor(profiles, format) {
  const list = Array.isArray(profiles) ? profiles : [];
  if (!format) return list;
  const typed = list.filter((p) => p && p.profileType);
  return typed.length ? typed.filter((p) => p.profileType === format) : list;
}

// POST author body for an author/lookup result.
//   choice: { rootFolder, qualityProfileId, metadataProfileId, monitor,
//             monitorNewItems, searchOnAdd, tags,
//             perFormat: { audiobook: { qualityProfileId, metadataProfileId }, ... } }
//   Chaptarr with a root folder per format: choice.formats = { audiobook:
//   { rootFolder, qualityProfileId, metadataProfileId }, ebook: {...} } adds
//   the author for each format listed.
export function buildAuthorAddPayload(lookup, choice = {}) {
  const base = { ...(lookup || {}) };
  delete base.id;
  const folder = choice.rootFolder || {};
  const tags = Array.isArray(choice.tags) ? choice.tags : [];
  const monitor = monitorChoice(choice.monitor) || 'all';
  const monitorNewItems = newItemChoice(choice.monitorNewItems) || 'all';
  const addOptions = { monitor, searchForMissingBooks: !!choice.searchOnAdd };
  const picked = choice.formats && typeof choice.formats === 'object'
    ? Object.keys(choice.formats).filter((f) => FORMATS[f] && choice.formats[f] && choice.formats[f].rootFolder)
    : null;
  const formats = picked || folderFormats(folder);
  const num = (v) => (v === null || v === undefined || v === '' ? undefined : Number(v));
  if (!formats.length) {
    return {
      ...base, rootFolderPath: folder.path, qualityProfileId: num(choice.qualityProfileId), metadataProfileId: num(choice.metadataProfileId),
      monitored: true, monitorNewItems, addOptions, tags,
    };
  }
  const out = { ...base, monitored: true, addOptions, tags };
  for (const f of formats) {
    const side = (picked ? choice.formats[f] : (choice.perFormat && choice.perFormat[f])) || {};
    out[`${f}RootFolderPath`] = picked ? side.rootFolder.path : folder.path;
    out[`${f}QualityProfileId`] = num(side.qualityProfileId ?? choice.qualityProfileId);
    out[`${f}MetadataProfileId`] = num(side.metadataProfileId ?? choice.metadataProfileId);
    out[`${f}Monitored`] = true;
    out[`${f}MonitorNewItems`] = monitorNewItems;
    out[`${f}Tags`] = tags;
  }
  if (formats.length === 1) out.lastSelectedMediaType = formats[0];
  return out;
}

// ---- One book --------------------------------------------------------------

// The copies of a book/lookup result already in the library, per format
// (Chaptarr marks them on the result).
export function lookupLocalCopies(lookup) {
  const r = lookup || {};
  const list = (k) => (Array.isArray(r[k]) ? r[k].filter(Boolean) : []);
  return { audiobook: list('localAudiobookBooks'), ebook: list('localEbookBooks') };
}

// POST book body for a book/lookup result: the book and, when the author
// isn't in the library (or not for this format), the author too, with only
// this book monitored (Chaptarr's "specificBook").
//   choice: { format, rootFolder, qualityProfileId, metadataProfileId,
//             monitorNewItems, searchOnAdd, tags }
export function buildBookAddPayload(lookup, choice = {}) {
  const book = JSON.parse(JSON.stringify(lookup || {}));
  const author = { ...(book.author || {}) };
  const folder = choice.rootFolder || {};
  const tags = Array.isArray(choice.tags) ? choice.tags : [];
  const num = (v) => (v === null || v === undefined || v === '' ? undefined : Number(v));
  const newItems = newItemChoice(choice.monitorNewItems) || 'none';
  const foreignId = book.foreignBookId || book.foreignId || book.hardcoverBookId || book.goodreadsBookId;
  const format = FORMATS[choice.format] ? choice.format : null;
  if (format) {
    Object.assign(author, {
      [`${format}RootFolderPath`]: folder.path,
      [`${format}QualityProfileId`]: num(choice.qualityProfileId),
      [`${format}MetadataProfileId`]: num(choice.metadataProfileId),
      [`${format}Monitored`]: true,
      [`${format}MonitorNewItems`]: newItems,
      [`${format}Tags`]: tags,
      tags, monitored: true,
      addOptions: { monitor: 'specificBook', booksToMonitor: foreignId ? [foreignId] : [], searchForMissingBooks: false },
    });
    book.mediaType = format;
    book.audiobookMonitored = format === 'audiobook';
    book.ebookMonitored = format === 'ebook';
    book.id = 0;
    book.localBookId = null;
  } else {
    Object.assign(author, {
      rootFolderPath: folder.path, qualityProfileId: num(choice.qualityProfileId), metadataProfileId: num(choice.metadataProfileId),
      monitored: true, monitorNewItems: newItems, tags,
      addOptions: { monitor: 'none', searchForMissingBooks: false },
    });
    delete book.id;
  }
  book.author = author;
  book.monitored = true;
  book.addOptions = { ...(book.addOptions || {}), searchForNewBook: !!choice.searchOnAdd };
  if (Array.isArray(book.editions) && book.editions.length) {
    if (!book.editions.some((e) => e && e.monitored)) book.editions[0].monitored = true;
  } else if (format) {
    book.editions = [{ monitored: true, manualAdd: false, title: book.title, overview: book.overview || '' }];
  }
  return book;
}

// ---- Another format for an author (Chaptarr) -------------------------------

// Formats the app has a root folder for that this author isn't set up for.
export function addableFormats(author, folders) {
  if (!isFormatAware(author)) return [];
  const have = new Set(authorFormats(author));
  const offered = new Set((folders || []).flatMap(folderFormats));
  return ['audiobook', 'ebook'].filter((f) => offered.has(f) && !have.has(f));
}

// The fields that set a format up on an author: PUT author/{id} (with the
// author) or PUT author/editor (with authorIds). Chaptarr then refreshes the
// author and lists their books in that format, monitoring them as
// "monitor new books" says.
//   choice: { rootFolder, qualityProfileId, metadataProfileId, monitorNewItems }
export function formatSetupFields(format, choice = {}) {
  const num = (v) => (v === null || v === undefined || v === '' ? undefined : Number(v));
  return {
    [`${format}RootFolderPath`]: choice.rootFolder && choice.rootFolder.path,
    [`${format}QualityProfileId`]: num(choice.qualityProfileId),
    [`${format}MetadataProfileId`]: num(choice.metadataProfileId),
    [`${format}Monitored`]: true,
    [`${format}MonitorNewItems`]: newItemChoice(choice.monitorNewItems) || 'none',
  };
}
export function buildFormatSetup(author, format, choice = {}) {
  return { ...(author || {}), ...formatSetupFields(format, choice), monitored: true };
}

// PUT author/{id} body: the stored author with the edited fields.
//   changes: { tags, monitored, qualityProfileId, monitorNewItems,
//              formats: { audiobook: { monitored, qualityProfileId, monitorNewItems }, ebook: {...} } }
export function buildAuthorUpdate(author, changes = {}) {
  const out = { ...(author || {}) };
  if (Array.isArray(changes.tags)) out.tags = [...changes.tags];
  const formats = authorFormats(author);
  if (formats.length) {
    for (const f of formats) {
      const c = (changes.formats && changes.formats[f]) || {};
      if (typeof c.monitored === 'boolean') out[`${f}Monitored`] = c.monitored;
      if (c.qualityProfileId) out[`${f}QualityProfileId`] = Number(c.qualityProfileId);
      const ni = newItemChoice(c.monitorNewItems);
      if (ni) out[`${f}MonitorNewItems`] = ni;
      if (Array.isArray(changes.tags)) out[`${f}Tags`] = [...changes.tags];
    }
    out.monitored = formats.some((f) => out[`${f}Monitored`] === true);
    return out;
  }
  if (typeof changes.monitored === 'boolean') out.monitored = changes.monitored;
  if (changes.qualityProfileId) out.qualityProfileId = Number(changes.qualityProfileId);
  const ni = newItemChoice(changes.monitorNewItems);
  if (ni) out.monitorNewItems = ni;
  return out;
}

// DELETE author/{id} query. Chaptarr asks which formats to remove; the whole
// author means both.
export function authorDeleteQuery(author, { deleteFiles = false } = {}) {
  const q = new URLSearchParams({ deleteFiles: String(!!deleteFiles), addImportListExclusion: 'false' });
  if (isFormatAware(author)) q.set('applyToBothFormats', 'true');
  return q.toString();
}

// Chaptarr's author/deletepreview answer, summed up for the confirmation.
export function deletePreviewSummary(preview) {
  const p = preview || {};
  const folders = Array.isArray(p.folders) ? p.folders : [];
  const files = Array.isArray(p.files) ? p.files : [];
  return {
    folders: folders.length,
    wholeFolders: folders.filter((f) => f && f.deleteContents).length,
    bookFiles: folders.reduce((n, f) => n + (Number(f && f.bookFileCount) || 0), 0),
    otherFiles: files.length + folders.reduce((n, f) => n + ((f && Array.isArray(f.otherFiles)) ? f.otherFiles.length : 0), 0),
    size: folders.reduce((n, f) => n + (Number(f && f.size) || 0), 0),
    recycleBin: p.recycleBin || '',
    otherAuthors: (Array.isArray(p.otherAuthors) ? p.otherAuthors : []).filter(Boolean),
    warnings: (Array.isArray(p.warnings) ? p.warnings : []).filter(Boolean),
  };
}
