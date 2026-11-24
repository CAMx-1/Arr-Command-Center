// Pure (DOM-free) helpers for editing many authors at once in a book manager
// (Chaptarr, legacy Readarr) through its author editor: PUT author/editor and
// DELETE author/editor. Chaptarr keeps audiobook and ebook settings apart, so
// a change can name the format it applies to. The UI is lib/authorBulkUI.js.
import { isFormatAware, authorFormats, authorStats } from './readarrLibrary.js';

const FORMAT_KEYS = ['audiobook', 'ebook'];
const NEW_ITEMS = new Set(['all', 'new', 'none']);
const APPLY_TAGS = new Set(['add', 'remove', 'replace']);

// The formats any of these authors is set up for, audiobooks first. Empty
// for legacy Readarr, which has one set of settings per author.
export function bulkFormats(authors) {
  const seen = new Set((authors || []).flatMap((a) => authorFormats(a)));
  return FORMAT_KEYS.filter((f) => seen.has(f));
}

export function anyFormatAware(authors) {
  return (authors || []).some((a) => isFormatAware(a));
}

// Monitored books not on disk, summed: what a search of these authors asks
// the indexers for.
export function bulkMissingCount(authors) {
  return (authors || []).reduce((n, a) => {
    const st = authorStats(a);
    return n + Math.max(0, st.monitored - st.have);
  }, 0);
}

// The authors worth an AuthorSearch: those with monitored books missing, or
// every one of them when the app sent no statistics to tell.
export function searchTargets(authors) {
  const list = (authors || []).filter(Boolean);
  if (!list.every((a) => a.statistics)) return list;
  return list.filter((a) => { const st = authorStats(a); return st.monitored > st.have; });
}

// A value given for both formats (a plain value) or per format
// ({ audiobook, ebook }). Empty strings and null mean "no change".
function perFormat(value, f) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value[f];
  return value;
}
const given = (v) => v !== undefined && v !== null && v !== '';
const id = (v) => (given(v) && Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);

// PUT author/editor body. `change` fields left out (or '' / null) stay as
// they are on every author:
//   monitored: true | false, format: 'audiobook' | 'ebook' | '' (Chaptarr:
//   which side to change; '' both), or monitored: { audiobook, ebook };
//   monitorNewItems, qualityProfileId, metadataProfileId, rootFolderPath:
//   one value, or { audiobook, ebook } for Chaptarr; moveFiles;
//   tags: [ids] with applyTags 'add' | 'remove' | 'replace'.
// Chaptarr only applies a side to authors set up for that format.
export function authorEditorBody(ids, change = {}, { formatAware = false } = {}) {
  const body = { authorIds: [...new Set((ids || []).map(Number).filter((n) => n > 0))] };
  const c = change || {};
  if (formatAware) {
    const sides = c.format && FORMAT_KEYS.includes(c.format) ? [c.format] : FORMAT_KEYS;
    for (const f of FORMAT_KEYS) {
      const mon = typeof c.monitored === 'boolean' ? (sides.includes(f) ? c.monitored : undefined) : perFormat(c.monitored, f);
      if (typeof mon === 'boolean') body[`${f}Monitored`] = mon;
      const ni = perFormat(c.monitorNewItems, f);
      if (NEW_ITEMS.has(ni)) body[`${f}MonitorNewItems`] = ni;
      const qp = id(perFormat(c.qualityProfileId, f));
      if (qp) body[`${f}QualityProfileId`] = qp;
      const mp = id(perFormat(c.metadataProfileId, f));
      if (mp) body[`${f}MetadataProfileId`] = mp;
      const root = perFormat(c.rootFolderPath, f);
      if (given(root)) body[`${f}RootFolderPath`] = String(root);
    }
  } else {
    const mon = typeof c.monitored === 'boolean' ? c.monitored : null;
    if (mon !== null) body.monitored = mon;
    if (NEW_ITEMS.has(c.monitorNewItems)) body.monitorNewItems = c.monitorNewItems;
    const qp = id(c.qualityProfileId);
    if (qp) body.qualityProfileId = qp;
    const mp = id(c.metadataProfileId);
    if (mp) body.metadataProfileId = mp;
    if (given(c.rootFolderPath) && typeof c.rootFolderPath !== 'object') body.rootFolderPath = String(c.rootFolderPath);
  }
  const roots = formatAware ? FORMAT_KEYS.some((f) => body[`${f}RootFolderPath`]) : !!body.rootFolderPath;
  if (roots) body.moveFiles = !!c.moveFiles;
  if (Array.isArray(c.tags) && c.tags.length && APPLY_TAGS.has(c.applyTags)) {
    body.tags = [...new Set(c.tags.map(Number).filter((n) => n > 0))];
    body.applyTags = c.applyTags;
  }
  return body;
}

// True when the body would change something (more than the ids).
export function hasEditorChanges(body) {
  return Object.keys(body || {}).some((k) => k !== 'authorIds' && k !== 'moveFiles');
}

// DELETE author/editor body. Chaptarr asks which formats to remove; removing
// the whole author means both, and other authors' files in the same folders
// stay.
export function authorEditorDeleteBody(ids, { deleteFiles = false, addImportListExclusion = false, formatAware = false } = {}) {
  const body = {
    authorIds: [...new Set((ids || []).map(Number).filter((n) => n > 0))],
    deleteFiles: !!deleteFiles,
    addImportListExclusion: !!addImportListExclusion,
  };
  if (formatAware) Object.assign(body, { applyToBothFormats: true, deleteOtherAuthorsFiles: false });
  return body;
}
