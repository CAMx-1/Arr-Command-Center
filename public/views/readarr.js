// Readarr-compatible book managers (Chaptarr, legacy Readarr), laid out like
// the Sonarr and Radarr pages: authors with their pictures as a honeycomb,
// list or table; an author page with every book (monitor, automatic and
// interactive search, files, rename and retag previews, books listed twice);
// add, edit and remove authors, one or many at once (Select); Wanted, Queue
// (with manual import and ignored downloads), Calendar
// and History with book covers; and System (health, tasks, blocklist,
// unmapped files). Chaptarr keeps audiobook and ebook settings side by side;
// lib/readarrLibrary.js handles both shapes.
import { h, mount, tabs, skeletonList, empty, toast, fmtBytes, fmtDate, fmtRelative, timeEl, pct, openModal, closeModal, confirmModal, rootFolderLabel, swipeToAction } from '../lib/ui.js';
import { posterHexCard, pagedLibrary } from '../lib/hive.js';
import { viewToggle, effectiveMode } from '../lib/viewMode.js';
import { cachedGet, cachedList, invalidate } from '../lib/cache.js';
import { libraryFilter } from '../lib/libraryFilter.js';
import { compactTable } from '../lib/tableView.js';
import { actionGroup } from '../lib/actions.js';
import { openLookupModal } from '../lib/lookupSearch.js';
import { tagEditor, loadTags } from '../lib/arrActions.js';
import { removeWithUndo, openRemoveQueueDialog, removeQueueQuery } from '../lib/queueActions.js';
import { queueStateLabel } from '../lib/manualImport.js';
import { liveRefresh } from '../lib/live.js';
import { getAddDefaults, setAddDefaults } from '../lib/addDefaults.js';
import { roleAllows } from '../lib/roleUi.js';
import { openTidyUp } from '../lib/tidyUpUI.js';
import { dismissKeyboardOnEnter } from '../lib/nativeApp.js';
import { openReleaseSearch } from './releaseSearch.js';
import { showReadarrNotice } from './musicbooks.js';
import { blocklistSection } from './arrSystem.js';
import { openBookImport, openUnmappedFiles, openIgnoredDownloads, watchCommand } from '../lib/bookImportUI.js';
import { openBookRename, openBookRetag, openDuplicateBooks } from '../lib/bookToolsUI.js';
import { bulkAuthors } from '../lib/authorBulkUI.js';
import {
  bookQueueActions, bookQueueReasons, bookQueueMessages, queueProblemKind, isUnknownAuthor, needsAttention, queueCounts, QUEUE_FILTERS,
  inLibraryFolder, duplicateBooks, unmappedUnits, bookSource,
} from '../lib/bookImport.js';
import {
  FORMATS, MONITOR_OPTIONS, NEW_ITEM_OPTIONS, BOOK_FILTERS,
  authorImage, bookCover, initials, nameGradient, isFormatAware, authorFormats, compareAuthors, authorSortKey,
  authorStats, authorStatusLabel, hasBookFile, bookState, bookDate, bookYear, filterBooks, bookCounts, groupBySeries,
  folderFormats, folderDefaults, profilesFor, buildAuthorAddPayload, buildAuthorUpdate, authorDeleteQuery, deletePreviewSummary,
} from '../lib/readarrLibrary.js';

const authorsKey = (ctx) => `arr:${ctx.service.key}:author`;
const records = (d) => (Array.isArray(d) ? d : (d && Array.isArray(d.records) ? d.records : []));
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// Set when an author is opened from this app's own pages, so "‹ Authors" can
// go back (keeping the filter and scroll) instead of stacking history.
let returnTo = null;

async function run(arr, body, message) {
  try { await arr.post('command', body); toast(message, 'success'); return true; }
  catch (e) { toast(e.message, 'error'); return false; }
}

// Searching sends one indexer query per book, and indexers cap queries per
// day, so a search over many books asks first (as Chaptarr's own page does).
const SEARCH_CONFIRM_OVER = 10;
function searchBooks(arr, body, count, what) {
  const go = () => run(arr, body, `Searching for ${what}`);
  if (!(count > SEARCH_CONFIRM_OVER)) return go();
  confirmModal({
    title: 'Search for many books?',
    message: `This searches your indexers for ${plural(count, 'book')} (${what}). Indexers often limit how many searches they allow a day.`,
    confirmLabel: `Search ${plural(count, 'book')}`,
    onConfirm: go,
  });
  return null;
}
const missingOf = (a) => { const st = authorStats(a); return Math.max(0, st.monitored - st.have); };

function openAuthor(ctx, a) {
  returnTo = { key: ctx.service.key, authorId: a.id };
  ctx.go(ctx.service.key, { ...ctx.params, author: a.id });
}

export async function renderReadarr(root, ctx) {
  const svc = ctx.service;
  const arr = ctx.api.arrV1(svc.key);
  if (!svc.configured) {
    ctx.setActions();
    return mount(root, empty('📚', `${svc.label} isn’t configured`, 'Set the URL and API key in Settings.'));
  }
  const authorId = Number(ctx.params.author);
  if (authorId > 0) return renderAuthorPage(root, ctx, arr, authorId);

  ctx.setActions(
    viewToggle(svc.key, (mode) => ctx.setParams({ mode }, { reload: true }), ctx.params.mode, { table: true }),
    h('button', { class: 'btn', title: 'Entries that waste searches or clutter the library, with bulk fixes', onclick: () => openTidyUp(arr, ctx, 'author') }, 'Tidy up'),
    h('button', { class: 'btn primary', 'data-needs': 'write', onclick: () => openAddAuthor(arr, ctx) }, '+ Add Author'),
  );
  const notice = h('div', {});
  const body = h('div', {});
  const bar = tabs(body, [
    { id: 'library', label: 'Library', render: (c) => tabAuthors(c, arr, ctx) },
    { id: 'wanted', label: 'Wanted', render: (c) => tabWanted(c, arr, ctx) },
    { id: 'queue', label: 'Queue', render: (c) => tabQueue(c, arr, ctx) },
    { id: 'calendar', label: 'Calendar', render: (c) => tabCalendar(c, arr, ctx) },
    { id: 'history', label: 'History', render: (c) => tabHistory(c, arr, ctx) },
    { id: 'system', label: 'System', render: (c) => tabSystem(c, arr, ctx) },
  ], `tabs-${svc.key}`, {
    activeId: ctx.params.tab,
    onChange: (id) => ctx.setParams({ tab: id === 'library' ? '' : id }),
  });
  mount(root, notice, bar, body);
  showReadarrNotice(notice, ctx, svc);
}

// ---- Pictures --------------------------------------------------------------

function authorThumb(a, cls = '') {
  const url = authorImage(a);
  const klass = cls || 'poster';
  const fallback = () => h('div', { class: `${klass} author-initials`, style: { backgroundImage: nameGradient(a && a.authorName) }, 'aria-hidden': 'true' }, initials(a && a.authorName));
  if (!url) return fallback();
  return h('img', { class: klass, src: url, alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer', onerror: function () { this.replaceWith(fallback()); } });
}

function bookCoverEl(b) {
  const url = bookCover(b);
  const icon = (b && b.mediaType && FORMATS[b.mediaType] && FORMATS[b.mediaType].icon) || '📚';
  const fallback = () => h('div', { class: 'poster book-cover book-cover-fallback', style: { backgroundImage: nameGradient(b && b.title) }, 'aria-hidden': 'true' }, icon);
  if (!url) return fallback();
  return h('img', { class: 'poster book-cover', src: url, alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer', onerror: function () { this.replaceWith(fallback()); } });
}

// ---- Library ---------------------------------------------------------------

async function tabAuthors(root, arr, ctx) {
  mount(root, skeletonList());
  const key = ctx.service.key;
  try {
    const authors = [...await cachedList(authorsKey(ctx), () => arr.get('author'), 300000, `${ctx.service.label} authors`)].sort(compareAuthors);
    if (!authors.length) {
      return mount(root, empty('📚', 'No authors yet', 'Add an author to get started', roleAllows('write') ? { label: '+ Add Author', onClick: () => openAddAuthor(arr, ctx) } : undefined));
    }
    const mode = ['hex', 'list', 'table'].includes(ctx.params.mode) ? ctx.params.mode : effectiveMode(key);
    let sortKey = ctx.params.sort || 'name';
    let direction = ctx.params.dir === 'desc' ? 'desc' : 'asc';
    let filtered = authors;
    const listWrap = h('div', {});
    const count = h('span', { class: 'dim lib-count' });
    const columns = [
      { key: 'name', label: 'Author', value: authorSortKey, render: (a) => a.authorName || '—' },
      { key: 'status', label: 'Status', value: (a) => a.status || '', render: (a) => authorStatusLabel(a) || '—' },
      { key: 'monitoredBooks', label: 'Monitored books', value: (a) => authorStats(a).monitored },
      { key: 'files', label: 'Files', value: (a) => authorStats(a).files },
      { key: 'size', label: 'On disk', value: (a) => authorStats(a).size, render: (a) => fmtBytes(authorStats(a).size) },
      { key: 'monitored', label: 'Monitored', value: (a) => (a.monitored ? 1 : 0), render: (a) => (a.monitored ? 'Yes' : 'No') },
      { key: 'added', label: 'Added', value: (a) => Date.parse(a.added) || 0, render: (a) => (a.added ? fmtDate(a.added) : '—') },
    ];
    const renderList = (items) => {
      filtered = items;
      mount(count, items.length === authors.length ? plural(authors.length, 'author') : `${items.length} of ${plural(authors.length, 'author')}`);
      if (!items.length) return mount(listWrap, empty('', 'No matches', 'No authors match this filter'));
      if (mode === 'table') {
        return mount(listWrap, compactTable(items, {
          columns, sortKey, direction, windowed: true,
          onSort: (k, dir) => { sortKey = k; direction = dir; ctx.setParams({ sort: k === 'name' ? '' : k, dir: dir === 'asc' ? '' : dir }); renderList(filtered); },
          onOpen: (a) => openAuthor(ctx, a),
        }));
      }
      mount(listWrap, pagedLibrary(items, { isHex: mode === 'hex', makeCard: (a) => authorHex(a, arr, ctx), makeRow: (a) => authorRow(a, arr, ctx) }));
    };
    const head = h('div', { class: 'lib-head' }, count,
      libraryFilter('author', authors, renderList, {
        initialTerm: ctx.params.q || '', initialStatus: ctx.params.status || 'all',
        onStateChange: ({ term, status }) => ctx.setParams({ q: term, status: status === 'all' ? '' : status }),
      }),
      h('button', {
        class: 'btn sm', type: 'button', 'data-needs': 'write', title: 'Select authors to monitor, search, edit, tag or remove many at once',
        onclick: () => bulkAuthors(root, {
          authors, filtered, arr, ctx, mode, columns, sortKey, direction,
          thumb: (a) => authorThumb(a),
          describeDelete: async (ids) => previewText(deletePreviewSummary(await arr.post('author/deletepreview', { authorIds: ids, applyToBothFormats: true }))),
          onExit: () => tabAuthors(root, arr, ctx),
        }),
      }, '☑ Select'),
    );
    mount(root, unmappedNotice(arr, ctx), head, listWrap);
  } catch (err) {
    mount(root, empty('', 'Failed to load authors', err.message, { label: 'Retry', onClick: () => tabAuthors(root, arr, ctx) }));
  }
}

// "N files aren't linked to a book" above the library, filled in once the
// app answers (nothing shows when every file is linked or the call fails).
function unmappedNotice(arr, ctx) {
  const el = h('div', {});
  cachedGet(`arr:${ctx.service.key}:unmapped`, () => arr.get('bookfile?unmapped=true'), 300000).then((files) => {
    const units = unmappedUnits(Array.isArray(files) ? files : []);
    if (!units.length || !el.isConnected) return;
    const n = units.reduce((s, u) => s + u.count, 0);
    mount(el, h('div', { class: 'attention-banner notice-banner' },
      h('span', { class: 'pill warn' }, `${plural(n, 'file')} not linked`),
      h('span', { class: 'dim' }, `${ctx.service.label} found ${plural(n, 'file')} in ${plural(units.length, 'folder')} it couldn’t link to a book.`),
      h('button', { class: 'btn sm', type: 'button', onclick: () => openUnmappedFiles(arr, ctx, { onChanged: () => invalidate(`arr:${ctx.service.key}:unmapped`) }) }, 'Review')));
  }).catch(() => {});
  return el;
}

function authorActions(a, arr, ctx) {
  return actionGroup([
    { label: 'Books', title: 'All books by this author', needs: 'read', primary: true, onClick: () => openAuthor(ctx, a) },
    { label: 'Search', title: 'Search for the missing monitored books', onClick: () => searchBooks(arr, { name: 'AuthorSearch', authorId: a.id }, missingOf(a), `${a.authorName}’s missing books`) },
    { label: 'Edit', title: 'Edit / remove', onClick: () => openEditAuthor(arr, ctx, a) },
  ], { sheetTitle: a.authorName });
}

function formatIcons(a) {
  return authorFormats(a).map((f) => FORMATS[f].icon).join(' ');
}

function authorHex(a, arr, ctx) {
  const st = authorStats(a);
  const sub = [formatIcons(a), [st.size ? fmtBytes(st.size) : null, st.monitored ? `${st.monitored} monitored` : null].filter(Boolean).join(' · ')].filter(Boolean).join('  ');
  return posterHexCard({
    posterUrl: authorImage(a),
    gradient: nameGradient(a.authorName),
    title: a.authorName || 'Unknown author',
    pills: [
      a.monitored ? { label: 'Monitored', cls: 'info' } : { label: 'Unmonitored', cls: 'muted' },
      st.files ? { label: plural(st.files, 'file'), cls: 'ok' } : null,
    ],
    sub,
    progress: st.percent,
    actions: authorActions(a, arr, ctx),
    onClick: () => openAuthor(ctx, a),
  });
}

function authorRow(a, arr, ctx) {
  const st = authorStats(a);
  const status = authorStatusLabel(a);
  return h('div', { class: 'row clickable author-row', onclick: () => openAuthor(ctx, a) },
    authorThumb(a),
    h('div', { class: 'row-main' },
      h('div', { class: 'row-title' }, a.authorName || 'Unknown author'),
      h('div', { class: 'meta-line', style: { marginTop: '4px' } },
        ...authorFormats(a).map((f) => h('span', { class: 'pill muted' }, `${FORMATS[f].icon} ${FORMATS[f].label}`)),
        h('span', {}, plural(st.files, 'file')),
        h('span', {}, fmtBytes(st.size)),
        st.monitored ? h('span', {}, `${st.monitored} monitored`) : null,
        status ? h('span', { class: `pill ${a.status === 'continuing' ? 'ok' : 'muted'}` }, status) : null,
        a.monitored ? h('span', { class: 'pill info' }, 'Monitored') : h('span', { class: 'pill muted' }, 'Unmonitored'),
      ),
      st.percent !== null ? h('div', { class: 'progress', title: `${st.have} of ${st.monitored} monitored books on disk` }, h('span', { style: { width: pct(st.percent) } })) : null,
    ),
    authorActions(a, arr, ctx),
  );
}

// ---- Author page -----------------------------------------------------------

const LINK_NAMES = { goodreads: 'Goodreads', hardcover: 'Hardcover', amazon: 'Amazon', audible: 'Audible', openlibrary: 'Open Library', wikipedia: 'Wikipedia', google: 'Google Books', googlebooks: 'Google Books', isfdb: 'ISFDB' };
const linkLabel = (name) => LINK_NAMES[String(name || '').toLowerCase().replace(/\s+/g, '')] || String(name || 'Link').replace(/^./, (c) => c.toUpperCase());

async function renderAuthorPage(root, ctx, arr, authorId) {
  const svc = ctx.service;
  const { author: _author, books: _books, format: _format, ...libraryParams } = ctx.params;
  const back = () => {
    if (returnTo && returnTo.key === svc.key && returnTo.authorId === authorId) { returnTo = null; history.back(); }
    else ctx.go(svc.key, libraryParams);
  };
  ctx.setActions(h('button', { class: 'btn', onclick: back }, '‹ Authors'));
  // Everything below goes into this element, so a slow load can't paint over
  // the page the user moved on to.
  const pageEl = h('div', { class: 'author-page' }, h('div', { class: 'author-hero author-hero-loading' }), skeletonList(4));
  mount(root, pageEl);

  let author; let books; let files;
  try {
    [author, books, files] = await Promise.all([
      arr.get(`author/${authorId}`),
      arr.get(`book?authorId=${authorId}`),
      arr.get(`bookfile?authorId=${authorId}`).catch(() => []),
    ]);
  } catch (err) {
    const gone = err.status === 404;
    return mount(pageEl, empty('', gone ? 'Author not found' : 'Couldn’t load this author', gone ? 'It may have been removed.' : err.message, { label: '‹ Back to authors', onClick: back }));
  }
  books = Array.isArray(books) ? books : [];
  files = Array.isArray(files) ? files : [];
  const filesByBook = new Map();
  for (const f of files) {
    if (!filesByBook.has(f.bookId)) filesByBook.set(f.bookId, []);
    filesByBook.get(f.bookId).push(f);
  }

  // Chaptarr: one list per format, as in its own author page.
  const formats = authorFormats(author);
  const switchable = [...new Set([...formats, ...books.map((b) => b.mediaType)])].filter((f) => FORMATS[f]);
  const showSwitch = switchable.length > 1;
  const state = {
    format: !switchable.length ? '' : switchable.includes(ctx.params.format) ? ctx.params.format
      : switchable.includes(author.lastSelectedMediaType) ? author.lastSelectedMediaType : switchable[0],
    filter: BOOK_FILTERS.some((f) => f.id === ctx.params.books) ? ctx.params.books : 'relevant',
    term: '',
    collapsed: null, // the series the user folded, once they fold or unfold one
  };
  const inFormat = (x) => !state.format || !x.mediaType || x.mediaType === state.format;
  const bookSize = (b) => (filesByBook.get(b.id) || []).reduce((n, f) => n + (Number(f.size) || 0), 0) || Number(b.statistics && b.statistics.sizeOnDisk) || 0;

  const heroSlot = h('div', {});
  const listSlot = h('div', {});
  const countEl = h('span', { class: 'dim' });

  const setMonitored = async (list, monitored, btn) => {
    if (!list.length) return;
    if (btn) btn.disabled = true;
    try {
      await arr.put('book/monitor', { bookIds: list.map((b) => b.id), monitored });
      for (const b of list) { b.monitored = monitored; if (b.mediaType) b[`${b.mediaType}Monitored`] = monitored; }
      invalidate(authorsKey(ctx));
      toast(list.length === 1 ? `${monitored ? 'Monitoring' : 'Stopped monitoring'} ${list[0].title}` : `${monitored ? 'Monitoring' : 'Stopped monitoring'} ${list.length} books`, 'success', 1800);
      renderHero();
      renderBooks();
    } catch (e) {
      toast(e.message, 'error');
      if (btn) btn.disabled = false;
    }
  };

  const renderHero = () => {
    const shown = books.filter(inFormat);
    const c = bookCounts(shown);
    const size = files.filter(inFormat).reduce((n, f) => n + (Number(f.size) || 0), 0);
    const img = authorImage(author);
    const status = authorStatusLabel(author);
    const stat = (n, label) => h('span', {}, h('b', {}, String(n)), ` ${label}`);
    const links = (author.links || []).filter((l) => l && /^https?:\/\//i.test(l.url)).slice(0, 5)
      .map((l) => h('a', { class: 'author-link', href: l.url, target: '_blank', rel: 'noopener noreferrer' }, linkLabel(l.name)));
    mount(heroSlot, h('div', { class: 'author-hero' },
      h('div', { class: 'author-hero-bg', style: { backgroundImage: img ? `url(${JSON.stringify(img)})` : nameGradient(author.authorName) } }),
      h('div', { class: 'author-hero-inner' },
        authorThumb(author, 'author-portrait'),
        h('div', { class: 'author-heading' },
          h('h2', { class: 'author-name' }, author.authorName || 'Unknown author'),
          h('div', { class: 'author-badges' },
            status ? h('span', { class: `pill ${author.status === 'continuing' ? 'ok' : 'muted'}` }, status) : null,
            author.monitored ? h('span', { class: 'pill info' }, 'Monitored') : h('span', { class: 'pill muted' }, 'Unmonitored'),
            ...formats.map((f) => h('span', { class: 'pill muted' }, `${FORMATS[f].icon} ${FORMATS[f].label}`)),
            author.ratings && Number(author.ratings.value) ? h('span', { class: 'rating-badge' }, `★ ${Number(author.ratings.value).toFixed(1)}`) : null,
          ),
          h('div', { class: 'author-stats' },
            stat(c.ondisk, 'on disk'), stat(c.monitored, 'monitored'), c.missing ? stat(c.missing, 'missing') : null,
            stat(c.total, c.total === 1 ? 'book' : 'books'), h('span', {}, fmtBytes(size)),
          ),
          (author.genres || []).length ? h('div', { class: 'detail-genres' }, ...author.genres.slice(0, 6).map((g) => h('span', { class: 'genre-chip' }, g))) : null,
          links.length ? h('div', { class: 'author-links' }, ...links) : null,
          h('div', { class: 'author-actions' },
            h('button', { class: 'btn primary', 'data-needs': 'write', title: 'Search for the missing monitored books', onclick: () => searchBooks(arr, { name: 'AuthorSearch', authorId: author.id }, bookCounts(books).missing, `${author.authorName}’s missing books`) }, 'Search monitored'),
            h('button', { class: 'btn', 'data-needs': 'write', title: 'Refresh the author from the metadata source and rescan the folder', onclick: () => run(arr, { name: 'RefreshAuthor', authorId: author.id }, `Refreshing ${author.authorName}`) }, 'Refresh & scan'),
            h('button', { class: 'btn', 'data-needs': 'write', title: 'Preview renaming the files to the app’s naming settings', onclick: () => openBookRename(arr, { author, mediaType: state.format, label: svc.label }) }, 'Rename…'),
            h('button', { class: 'btn', 'data-needs': 'write', title: 'Preview writing the author, title and narrator into the files’ tags', onclick: () => openBookRetag(arr, { author, books, files, mediaType: state.format, label: svc.label }) }, 'Write tags…'),
            h('button', { class: 'btn', 'data-needs': 'write', title: 'Edit / remove', onclick: () => openEditAuthor(arr, ctx, author, { onRemoved: () => ctx.go(svc.key, libraryParams) }) }, 'Edit'),
          ),
        ),
      ),
    ));
    renderDupes();
  };

  // Books listed twice (several metadata sources) with more than one copy
  // monitored: each copy is searched for, so the book can download twice.
  const dupeSlot = h('div', {});
  const renderDupes = () => {
    const groups = duplicateBooks(books.filter(inFormat)).filter((g) => g.redundant.length);
    if (!groups.length) { mount(dupeSlot); return; }
    mount(dupeSlot, h('div', { class: 'attention-banner notice-banner' },
      h('span', { class: 'pill warn' }, `${plural(groups.length, 'book')} listed twice`),
      h('span', { class: 'dim' }, `${groups.slice(0, 3).map((g) => g.title).join(', ')}${groups.length > 3 ? '…' : ''}: more than one copy is monitored, so ${svc.label} can download ${groups.length === 1 ? 'it' : 'them'} twice.`),
      h('button', { class: 'btn sm', type: 'button', onclick: () => openDuplicateBooks(arr, ctx, { books: books.filter(inFormat), title: `Books listed twice · ${author.authorName}`, onChanged: () => { renderHero(); renderBooks(); } }) }, 'Review')));
  };

  const overviewText = String(author.overview || '').trim();
  let overviewEl = null;
  if (overviewText) {
    const p = h('p', { class: 'author-overview clamped' }, overviewText);
    const more = h('button', { class: 'btn sm', type: 'button', onclick: () => { more.textContent = p.classList.toggle('clamped') ? 'More' : 'Less'; } }, 'More');
    overviewEl = h('div', { class: 'author-overview-wrap' }, p, overviewText.length > 280 ? more : null);
  }

  const filterSel = h('select', { class: 'input lib-filter-select', 'aria-label': 'Which books' }, ...BOOK_FILTERS.map((f) => h('option', { value: f.id }, f.label)));
  filterSel.value = state.filter;
  filterSel.addEventListener('change', () => {
    state.filter = filterSel.value; state.collapsed = null;
    ctx.setParams({ books: state.filter === 'relevant' ? '' : state.filter });
    renderBooks();
  });
  const search = dismissKeyboardOnEnter(h('input', { class: 'input lib-filter-search', type: 'search', placeholder: 'Filter books…', 'aria-label': 'Filter books', enterkeyhint: 'search', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' }));
  search.addEventListener('input', () => { state.term = search.value; renderBooks(); });
  const formatToggle = showSwitch ? h('div', { class: 'view-toggle', role: 'group', 'aria-label': 'Format' }, ...switchable.map((f) => h('button', {
    class: `view-seg ${state.format === f ? 'active' : ''}`, type: 'button', dataset: { format: f },
    onclick: (e) => {
      if (state.format === f) return;
      state.format = f; state.collapsed = null;
      for (const b of e.currentTarget.parentElement.children) b.classList.toggle('active', b.dataset.format === f);
      ctx.setParams({ format: f });
      renderHero(); renderBooks();
    },
  }, `${FORMATS[f].icon} ${FORMATS[f].label}`))) : null;
  const foldBtn = h('button', { class: 'btn sm', type: 'button' }, 'Collapse all');
  const toolbar = h('div', { class: 'book-toolbar' },
    h('div', { class: 'book-toolbar-title' }, h('span', { class: 'section-title' }, 'Books'), countEl),
    h('div', { class: 'book-tools' }, formatToggle, h('div', { class: 'lib-filter' }, search, filterSel), foldBtn),
  );

  const bookRow = (b, position) => {
    const fs = filesByBook.get(b.id) || [];
    const st = bookState(b);
    const year = bookYear(b);
    const quality = fs.map((f) => f.quality && f.quality.quality && f.quality.quality.name).find(Boolean);
    const size = bookSize(b);
    const narrators = narratorNames(b);
    return h('div', { class: 'row book-row' },
      bookCoverEl(b),
      h('div', { class: 'row-main' },
        h('div', { class: 'row-title' }, position !== null && position !== undefined ? h('span', { class: 'book-pos' }, `#${position}`) : null, b.title || 'Untitled'),
        h('div', { class: 'meta-line', style: { marginTop: '3px' } },
          h('span', { class: `pill ${st.cls}` }, st.label),
          year ? h('span', {}, String(year)) : null,
          quality ? h('span', { class: 'pill info' }, quality) : null,
          size ? h('span', {}, fmtBytes(size)) : null,
          fs.length > 1 ? h('span', {}, plural(fs.length, 'file')) : null,
          narrators.length ? h('span', { class: 'dim' }, `Narrated by ${narrators.slice(0, 2).join(', ')}`) : null,
          b.ratings && Number(b.ratings.value) ? h('span', { title: `${(b.ratings.votes || 0).toLocaleString()} ratings` }, `★ ${Number(b.ratings.value).toFixed(1)}`) : null,
        ),
      ),
      h('div', { class: 'row-actions book-actions' },
        h('button', {
          class: `btn sm hex-btn ${b.monitored ? 'primary' : ''}`, type: 'button', 'data-needs': 'write', 'aria-pressed': String(!!b.monitored),
          title: b.monitored ? 'Stop monitoring this book' : 'Monitor this book',
          onclick: (e) => setMonitored([b], !b.monitored, e.currentTarget),
        }, b.monitored ? 'Monitored' : 'Unmonitored'),
        actionGroup([
          { label: 'Search', title: 'Automatic search', primary: true, onClick: () => run(arr, { name: 'BookSearch', bookIds: [b.id] }, `Searching for ${b.title}`) },
          { label: 'Interactive', title: 'Interactive search: pick a release yourself', onClick: () => openReleaseSearch(ctx, svc.key, `bookId=${b.id}`, b.title, { version: 'v1', media: 'book', grab: { bookId: b.id } }) },
          { label: 'Info', title: 'Details and files', onClick: () => openBookInfo(b, fs, author) },
        ], { sheetTitle: b.title }),
      ),
    );
  };

  const seriesBlock = (g, single, collapsed, onToggle) => {
    const onDisk = g.books.filter(hasBookFile).length;
    const size = g.books.reduce((n, b) => n + bookSize(b), 0);
    const monitoredIds = g.books.filter((b) => b.monitored).map((b) => b.id);
    const allMonitored = monitoredIds.length === g.books.length;
    const head = h('div', {
      class: 'season-head series-head', role: 'button', tabindex: '0', 'aria-expanded': String(!collapsed),
      title: collapsed ? 'Show these books' : 'Hide these books', onclick: onToggle,
      onkeydown: (e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onToggle(); } },
    },
    h('span', { class: 'season-caret' }, collapsed ? '\u25b8' : '\u25be'),
    h('div', { class: 'season-title' }, g.name || (single ? 'Books' : 'Standalone and other books')),
    h('span', { class: 'dim nowrap' }, `${onDisk}/${g.books.length} on disk${size ? ` · ${fmtBytes(size)}` : ''}`),
    h('button', {
      class: `btn sm hex-btn ${allMonitored ? 'primary' : ''}`, type: 'button', 'data-needs': 'write', style: { marginLeft: 'auto' },
      title: allMonitored ? `Stop monitoring these ${g.books.length} books` : `Monitor these ${g.books.length} books`,
      onclick: (e) => { e.stopPropagation(); setMonitored(g.books, !allMonitored, e.currentTarget); },
    }, allMonitored ? 'Monitored' : monitoredIds.length ? `${monitoredIds.length}/${g.books.length} monitored` : 'Unmonitored'),
    h('button', {
      class: 'btn sm hex-btn', type: 'button', 'data-needs': 'write', disabled: monitoredIds.length ? null : 'disabled',
      title: monitoredIds.length ? `Search for the ${plural(monitoredIds.length, 'monitored book')}` : 'Monitor a book first',
      onclick: (e) => { e.stopPropagation(); searchBooks(arr, { name: 'BookSearch', bookIds: monitoredIds }, monitoredIds.length, g.name ? `the monitored books in ${g.name}` : plural(monitoredIds.length, 'monitored book')); },
    }, 'Search'),
    );
    return h('div', { class: 'season-block series-block' }, head, collapsed ? null : h('div', { class: 'list' }, ...g.books.map((b) => bookRow(b, g.positions.get(b.id)))));
  };

  const renderBooks = () => {
    const formatBooks = books.filter(inFormat);
    const shown = filterBooks(formatBooks, { filter: state.filter, term: state.term });
    mount(countEl, shown.length === formatBooks.length ? plural(formatBooks.length, 'book') : `${shown.length} of ${plural(formatBooks.length, 'book')}`);
    if (!shown.length) {
      foldBtn.hidden = true;
      const label = (BOOK_FILTERS.find((f) => f.id === state.filter) || BOOK_FILTERS[0]).label.toLowerCase();
      if (!formatBooks.length) return mount(listSlot, empty('📚', 'No books yet', `${svc.label} hasn’t listed any books for this author yet. Try Refresh & scan.`));
      return mount(listSlot, empty('📚', 'No books match', state.term ? 'Try another title.' : `None of the ${plural(formatBooks.length, 'book')} is ${label}.`,
        state.filter !== 'all' ? { label: 'Show all books', onClick: () => { filterSel.value = 'all'; filterSel.dispatchEvent(new Event('change')); } } : undefined));
    }
    const groups = groupBySeries(shown);
    // Long lists start with every series folded, like the Sonarr season browser.
    const auto = shown.length > 120 || groups.length > 20;
    const isCollapsed = (name) => (state.collapsed ? state.collapsed.has(name) : auto);
    const allCollapsed = groups.every((g) => isCollapsed(g.name));
    foldBtn.hidden = groups.length < 2;
    foldBtn.textContent = allCollapsed ? 'Expand all' : 'Collapse all';
    foldBtn.onclick = () => { state.collapsed = allCollapsed ? new Set() : new Set(groups.map((g) => g.name)); renderBooks(); };
    const toggle = (name) => {
      if (!state.collapsed) state.collapsed = new Set(auto ? groups.map((g) => g.name) : []);
      if (state.collapsed.has(name)) state.collapsed.delete(name); else state.collapsed.add(name);
      renderBooks();
    };
    mount(listSlot, ...groups.map((g) => seriesBlock(g, groups.length === 1, isCollapsed(g.name), () => toggle(g.name))));
  };

  mount(pageEl, heroSlot, dupeSlot, overviewEl, toolbar, listSlot);
  renderHero();
  renderBooks();
}

function narratorNames(b) {
  const list = Array.isArray(b && b.narratorNames) && b.narratorNames.length ? b.narratorNames : ((b && b.narrators) || []).map((n) => (typeof n === 'string' ? n : n && n.name));
  return list.filter(Boolean);
}

function mediaInfoBits(mi) {
  if (!mi || typeof mi !== 'object') return [];
  return [mi.audioFormat || mi.audioCodec, mi.audioBitrate, mi.audioChannels ? `${mi.audioChannels} ch` : null, mi.audioSampleRate, mi.runTime || mi.duration].filter((x) => x !== null && x !== undefined && x !== '').map(String);
}

function openBookInfo(b, fs, author) {
  const cover = bookCover(b);
  const st = bookState(b);
  const narrators = narratorNames(b);
  const total = fs.reduce((n, f) => n + (Number(f.size) || 0), 0);
  const facts = [
    ['Author', author && author.authorName],
    ['Series', b.seriesTitle],
    ['Released', bookDate(b.releaseDate)],
    ['Format', b.mediaType && FORMATS[b.mediaType] ? FORMATS[b.mediaType].one : ''],
    ['Pages', b.pageCount ? String(b.pageCount) : ''],
    ['Narrators', narrators.join(', ')],
    ['Rating', b.ratings && Number(b.ratings.value) ? `★ ${Number(b.ratings.value).toFixed(2)} (${(b.ratings.votes || 0).toLocaleString()} ratings)` : ''],
    ['Genres', (b.genres || []).slice(0, 6).join(', ')],
  ].filter(([, v]) => v);
  const fileRow = (f) => h('div', { class: 'row' }, h('div', { class: 'row-main' },
    h('div', { class: 'mono book-file-path' }, f.path || '—'),
    h('div', { class: 'meta-line', style: { marginTop: '4px' } },
      f.quality && f.quality.quality && f.quality.quality.name ? h('span', { class: 'pill info' }, f.quality.quality.name) : null,
      h('span', {}, fmtBytes(Number(f.size) || 0)),
      ...mediaInfoBits(f.mediaInfo).map((t) => h('span', {}, t)),
      f.dateAdded ? h('span', { class: 'dim' }, `Added ${fmtRelative(f.dateAdded)}`) : null,
    ),
  ));
  openModal({
    title: b.title || 'Book',
    wide: true,
    body: h('div', { class: 'book-info' },
      h('div', { class: 'book-info-head' },
        cover ? h('img', { class: 'book-info-cover', src: cover, alt: '', referrerpolicy: 'no-referrer' }) : null,
        h('div', { class: 'book-info-meta' },
          h('div', { class: 'meta-line' }, h('span', { class: `pill ${st.cls}` }, st.label), b.monitored ? h('span', { class: 'pill info' }, 'Monitored') : h('span', { class: 'pill muted' }, 'Unmonitored')),
          h('dl', { class: 'book-info-facts' }, ...facts.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])),
        ),
      ),
      b.overview ? h('p', { class: 'detail-overview' }, b.overview) : null,
      h('div', { class: 'section-title' }, fs.length ? `${plural(fs.length, 'file')} · ${fmtBytes(total)}` : 'Files'),
      fs.length ? h('div', { class: 'list' }, ...fs.map(fileRow)) : h('div', { class: 'dim' }, 'Nothing on disk for this book.'),
    ),
  });
}

// ---- Add an author ---------------------------------------------------------

function field(label, control) {
  return h('div', {}, h('div', { class: 'section-title', style: { margin: '0 0 6px' } }, label), control);
}
function selectOf(options, value) {
  const sel = h('select', { class: 'input' }, ...options.map(([v, label]) => h('option', { value: String(v) }, label)));
  if (value !== null && value !== undefined && options.some(([v]) => String(v) === String(value))) sel.value = String(value);
  return sel;
}
function switchOf(checked, label) {
  const input = h('input', { type: 'checkbox', role: 'switch', checked: checked ? 'checked' : null });
  return { input, el: h('label', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, input, label) };
}
const firstKnown = (list, candidates) => {
  for (const c of candidates) if (c !== null && c !== undefined && list.some((p) => String(p.id) === String(c))) return c;
  return list[0] ? list[0].id : null;
};
function folderLabel(f) {
  const fmts = folderFormats(f);
  const kind = fmts.length === 2 ? 'Audiobooks and ebooks' : fmts.length ? FORMATS[fmts[0]].label : '';
  return kind ? `${rootFolderLabel(f)} · ${kind}` : rootFolderLabel(f);
}

function openAddAuthor(arr, ctx) {
  let library = [];
  cachedList(authorsKey(ctx), () => arr.get('author'), 300000).then((list) => { library = list; }).catch(() => {});
  openLookupModal({
    title: 'Add Author',
    placeholder: 'Search for an author…',
    lookup: (term) => arr.get(`author/lookup?term=${encodeURIComponent(term)}`),
    renderRow: (r) => lookupRow(r, arr, ctx, library),
  });
}

function lookupRow(r, arr, ctx, library) {
  // Chaptarr mixes metadata sources (hc:, gr:, ...), so the same author can
  // come back under another id: fall back to the name.
  const norm = (n) => String(n || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  const existing = library.find((a) => (r.foreignAuthorId && a.foreignAuthorId === r.foreignAuthorId) || (r.id && a.id === r.id))
    || library.find((a) => norm(a.authorName) && norm(a.authorName) === norm(r.authorName));
  const sub = r.overview || r.disambiguation || (r.genres || []).slice(0, 3).join(', ');
  return h('div', { class: 'row' },
    authorThumb(r),
    h('div', { class: 'row-main' },
      h('div', { class: 'row-title' }, r.authorName || 'Unknown author'),
      sub ? h('div', { class: 'row-sub' }, sub) : null,
    ),
    h('div', { class: 'row-actions' },
      existing
        ? h('button', { class: 'btn sm', title: 'Already in the library: open it', onclick: () => { closeModal(); openAuthor(ctx, existing); } }, 'In library')
        : h('button', { class: 'btn sm primary', 'data-needs': 'write', onclick: () => confirmAddAuthor(r, arr, ctx) }, '+ Add'),
    ),
  );
}

async function confirmAddAuthor(r, arr, ctx) {
  const key = ctx.service.key;
  const label = ctx.service.label;
  let folders = []; let profiles = []; let metas = null;
  try { folders = await cachedGet(`arr:${key}:rootfolder`, () => arr.get('rootfolder'), 600000); } catch { /* none */ }
  try { profiles = await cachedGet(`arr:${key}:qualityprofile`, () => arr.get('qualityprofile'), 600000); } catch { /* none */ }
  // Metadata profiles are an admin read here; others get the folder's default.
  try { metas = await cachedGet(`arr:${key}:metadataprofile`, () => arr.get('metadataprofile'), 600000); } catch { metas = null; }
  folders = Array.isArray(folders) ? folders : [];
  profiles = Array.isArray(profiles) ? profiles : [];
  metas = Array.isArray(metas) ? metas : null;
  if (!folders.length) { toast(`${label} has no root folder yet. Add one in its Media Management settings first.`, 'error', 6000); return; }

  const saved = getAddDefaults(key) || {};
  const start = folders.find((f) => f.path === saved.rootFolderPath && f.accessible !== false) || folders.find((f) => f.accessible !== false) || folders[0];
  const folderSel = h('select', { class: 'input' }, ...folders.map((f) => h('option', { value: f.path }, folderLabel(f))));
  folderSel.value = start.path;
  const monitorSel = selectOf(MONITOR_OPTIONS, 'all');
  const newSel = selectOf(NEW_ITEM_OPTIONS, 'all');
  const search = switchOf(saved.searchOnAdd !== false, 'Search for missing books');
  const profileSlot = h('div', { class: 'grid', style: { gap: '14px' } });
  let picks = {};
  const folderNow = () => folders.find((f) => f.path === folderSel.value) || start;
  const renderProfiles = () => {
    const folder = folderNow();
    const fmts = folderFormats(folder);
    const d = folderDefaults(folder, fmts[0] || null);
    monitorSel.value = d.monitor || (saved.monitored === false ? 'none' : 'all');
    newSel.value = d.monitorNewItems || 'all';
    picks = {};
    mount(profileSlot, ...(fmts.length ? fmts : [null]).map((f) => {
      const def = folderDefaults(folder, f);
      const qList = profilesFor(profiles, f);
      const mList = metas ? profilesFor(metas, f) : [];
      const qSel = qList.length ? selectOf(qList.map((p) => [p.id, p.name]), firstKnown(qList, [def.qualityProfileId, saved.qualityProfileId])) : null;
      const mSel = mList.length ? selectOf(mList.map((p) => [p.id, p.name]), firstKnown(mList, [def.metadataProfileId])) : null;
      picks[f || ''] = { qSel, mSel, metadataDefault: def.metadataProfileId ?? (mList[0] && mList[0].id) ?? 1 };
      const what = f && fmts.length > 1 ? `${FORMATS[f].one} ` : '';
      return h('div', { class: 'grid', style: { gap: '14px' } },
        qSel ? field(`${what}quality profile`.replace(/^./, (c) => c.toUpperCase()), qSel) : null,
        mSel ? field(`${what}metadata profile`.replace(/^./, (c) => c.toUpperCase()), mSel) : null,
      );
    }));
  };
  folderSel.addEventListener('change', renderProfiles);
  renderProfiles();

  const doAdd = async (btn) => {
    const folder = folderNow();
    const fmts = folderFormats(folder);
    const pick = (f) => picks[f || ''] || {};
    const q = (f) => (pick(f).qSel ? pick(f).qSel.value : undefined);
    const m = (f) => (pick(f).mSel ? pick(f).mSel.value : pick(f).metadataDefault);
    const choice = {
      rootFolder: folder, monitor: monitorSel.value, monitorNewItems: newSel.value, searchOnAdd: search.input.checked, tags: [],
      qualityProfileId: q(fmts[0]), metadataProfileId: m(fmts[0]),
      perFormat: Object.fromEntries(fmts.map((f) => [f, { qualityProfileId: q(f), metadataProfileId: m(f) }])),
    };
    btn.disabled = true;
    try {
      await arr.post('author', buildAuthorAddPayload(r, choice));
      setAddDefaults(key, { qualityProfileId: choice.qualityProfileId, rootFolderPath: folder.path, monitored: choice.monitor !== 'none', searchOnAdd: choice.searchOnAdd });
      invalidate(authorsKey(ctx));
      toast(`Added ${r.authorName}. ${label} is fetching their books.`, 'success', 3500);
      closeModal();
      ctx.reload();
    } catch (e) {
      toast(e.message, 'error', 6000);
      btn.disabled = false;
    }
  };

  openModal({
    title: `Add “${r.authorName}”`,
    body: h('div', { class: 'grid', style: { gap: '14px' } },
      field('Root folder', folderSel),
      profileSlot,
      field('Monitor', monitorSel),
      field('Monitor new books', newSel),
      search.el,
    ),
    footer: h('div', { style: { display: 'flex', gap: '10px' } },
      h('button', { class: 'btn', onclick: closeModal }, 'Cancel'),
      h('button', { class: 'btn primary', onclick: (e) => doAdd(e.currentTarget) }, 'Add Author'),
    ),
  });
}

// ---- Edit / remove an author -----------------------------------------------

async function openEditAuthor(arr, ctx, listed, { onRemoved } = {}) {
  const key = ctx.service.key;
  let a = listed;
  try { a = await arr.get(`author/${listed.id}`); } catch { /* edit what the list had */ }
  let profiles = [];
  try { profiles = await cachedGet(`arr:${key}:qualityprofile`, () => arr.get('qualityprofile'), 600000); } catch { /* none */ }
  profiles = Array.isArray(profiles) ? profiles : [];
  const allTags = await loadTags(arr);
  const tagIds = [...(a.tags || [])];
  const formats = authorFormats(a);
  const sides = (formats.length ? formats : [null]).map((f) => {
    const monitored = f ? a[`${f}Monitored`] !== false : !!a.monitored;
    const mon = switchOf(monitored, f ? `Monitor ${FORMATS[f].label.toLowerCase()}` : 'Monitored');
    const list = profilesFor(profiles, f);
    const prof = list.length ? selectOf(list.map((p) => [p.id, p.name]), f ? a[`${f}QualityProfileId`] : a.qualityProfileId) : null;
    const newItems = selectOf(NEW_ITEM_OPTIONS, (f ? a[`${f}MonitorNewItems`] : a.monitorNewItems) || 'all');
    return {
      f, mon, prof, newItems,
      el: h('div', { class: 'edit-format' },
        f ? h('div', { class: 'edit-format-title' }, `${FORMATS[f].icon} ${FORMATS[f].label}`) : null,
        mon.el,
        prof ? field('Quality profile', prof) : null,
        field('Monitor new books', newItems),
      ),
    };
  });
  const cmdButton = (label, body, message) => {
    const btn = h('button', { class: 'btn sm', type: 'button' }, label);
    btn.onclick = async () => { btn.disabled = true; await run(arr, body, message); btn.disabled = false; };
    return btn;
  };
  const deleteFiles = switchOf(false, 'Also delete the author’s files (when removing)');

  const save = async (btn) => {
    const changes = { tags: tagIds };
    if (formats.length) {
      changes.formats = Object.fromEntries(sides.map((s) => [s.f, { monitored: s.mon.input.checked, qualityProfileId: s.prof && s.prof.value, monitorNewItems: s.newItems.value }]));
    } else {
      const s = sides[0];
      Object.assign(changes, { monitored: s.mon.input.checked, qualityProfileId: s.prof && s.prof.value, monitorNewItems: s.newItems.value });
    }
    btn.disabled = true;
    try {
      await arr.put(`author/${a.id}`, buildAuthorUpdate(a, changes));
      invalidate(authorsKey(ctx));
      toast(`Saved ${a.authorName}`, 'success');
      closeModal();
      ctx.reload();
    } catch (e) {
      toast(e.message, 'error', 6000);
      btn.disabled = false;
    }
  };

  openModal({
    title: `Edit “${a.authorName}”`,
    body: h('div', { class: 'grid', style: { gap: '14px' } },
      ...sides.map((s) => s.el),
      field('Tags', tagEditor(allTags, tagIds, arr)),
      field('Maintenance', h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
        cmdButton('Refresh & scan', { name: 'RefreshAuthor', authorId: a.id }, `Refreshing ${a.authorName}`),
      )),
      h('div', { 'data-needs': 'delete' }, deleteFiles.el),
    ),
    footer: h('div', { style: { display: 'flex', gap: '10px', justifyContent: 'space-between', width: '100%' } },
      h('button', { class: 'btn danger sm', 'data-needs': 'delete', onclick: () => removeAuthor(arr, ctx, a, deleteFiles.input.checked, onRemoved) }, 'Remove'),
      h('div', { style: { display: 'flex', gap: '10px' } },
        h('button', { class: 'btn', onclick: closeModal }, 'Cancel'),
        h('button', { class: 'btn primary', onclick: (e) => save(e.currentTarget) }, 'Save'),
      ),
    ),
  });
}

function previewText(s) {
  const parts = [];
  if (s.bookFiles || s.size) {
    parts.push(`That is ${plural(s.bookFiles, 'book file')} (${fmtBytes(s.size)}) in ${plural(s.folders, 'folder')}${s.otherFiles ? `, plus ${plural(s.otherFiles, 'other file')}` : ''}.`);
  } else {
    parts.push('No book files are on disk for this author.');
  }
  parts.push(s.recycleBin ? `They go to the Recycle Bin (${s.recycleBin}).` : 'No Recycle Bin is set, so they are deleted permanently.');
  if (s.otherAuthors.length) parts.push(`Files of ${s.otherAuthors.map((o) => o.name).filter(Boolean).join(', ')} in the same folders are kept.`);
  if (s.warnings.length) parts.push(s.warnings.join(' '));
  return parts.join(' ');
}

async function removeAuthor(arr, ctx, a, deleteFiles, onRemoved) {
  const label = ctx.service.label;
  let detail = '';
  // Chaptarr can say beforehand which folders and files would go.
  if (deleteFiles && isFormatAware(a)) {
    try { detail = previewText(deletePreviewSummary(await arr.post('author/deletepreview', { authorIds: [a.id], applyToBothFormats: true }))); }
    catch (e) { toast(`Couldn’t check which files would be deleted, so nothing was removed: ${e.message}`, 'error', 7000); return; }
  }
  confirmModal({
    title: 'Remove author',
    message: deleteFiles
      ? `Remove ${a.authorName} from ${label} and delete their files? ${detail || `${label}’s Recycle Bin setting applies.`}`
      : `Remove ${a.authorName} from ${label}? Their files stay on disk.`,
    confirmLabel: deleteFiles ? 'Remove and delete files' : 'Remove',
    danger: true,
    onConfirm: async () => {
      try {
        await arr.del(`author/${a.id}?${authorDeleteQuery(a, { deleteFiles })}`);
        invalidate(authorsKey(ctx));
        toast(`Removed ${a.authorName}`, 'success');
        if (onRemoved) onRemoved(); else ctx.reload();
      } catch (e) {
        if (!e.cancelled) toast(e.message, 'error', 6000);
      }
    },
  });
}

// ---- Wanted, Queue, Calendar, History --------------------------------------

function bookLine(r) {
  const author = r.author && r.author.authorName;
  return [author, r.seriesTitle].filter(Boolean).join(' · ');
}

async function tabWanted(root, arr, ctx, mode = 'missing') {
  mount(root, skeletonList());
  const endpoint = mode === 'cutoff' ? 'wanted/cutoff' : 'wanted/missing';
  const pageSize = 50;
  try {
    const data = await arr.get(`${endpoint}?page=1&pageSize=${pageSize}&sortKey=releaseDate&sortDirection=descending&includeAuthor=true`);
    let shown = records(data);
    const total = Number(data && data.totalRecords) || shown.length;
    const seg = (m, label) => h('button', { class: `view-seg ${mode === m ? 'active' : ''}`, onclick: () => { if (mode !== m) tabWanted(root, arr, ctx, m); } }, label);
    const searchAll = h('button', {
      class: 'btn sm primary', 'data-needs': 'write', title: `Search for every ${mode === 'cutoff' ? 'book below its quality cutoff' : 'missing monitored book'}`,
      onclick: () => searchBooks(arr, { name: mode === 'cutoff' ? 'CutoffUnmetBookSearch' : 'MissingBookSearch' }, total, `every ${mode === 'cutoff' ? 'book below its quality cutoff' : 'missing book'}`),
    }, 'Search all');
    const head = h('div', { class: 'lib-head', style: { justifyContent: 'space-between' } },
      h('div', { class: 'view-toggle wanted-toggle', role: 'group', 'aria-label': 'Wanted list' }, seg('missing', 'Missing'), seg('cutoff', 'Cutoff Unmet')),
      h('span', { class: 'dim', style: { marginRight: 'auto' } }, total ? plural(total, 'book') : ''),
      searchAll,
    );
    if (!shown.length) return mount(root, head, empty('✅', mode === 'cutoff' ? 'Nothing below cutoff' : 'Nothing missing', 'Every monitored book is on disk.'));
    const list = h('div', { class: 'list' }, ...shown.map((r) => wantedRow(r, arr, ctx)));
    let page = 1;
    const more = h('button', { class: 'btn' }, `Show more (${total - shown.length} more)`);
    more.onclick = async () => {
      more.disabled = true;
      try {
        const next = records(await arr.get(`${endpoint}?page=${page + 1}&pageSize=${pageSize}&sortKey=releaseDate&sortDirection=descending&includeAuthor=true`));
        page++;
        shown = shown.concat(next);
        for (const r of next) list.appendChild(wantedRow(r, arr, ctx));
        more.textContent = `Show more (${Math.max(0, total - shown.length)} more)`;
        more.disabled = false;
        if (!next.length || shown.length >= total) moreWrap.remove();
      } catch (e) { toast(e.message, 'error'); more.disabled = false; }
    };
    const moreWrap = h('div', { class: 'load-more' }, more);
    mount(root, head, list, shown.length < total ? moreWrap : null);
  } catch (err) {
    mount(root, empty('', 'Failed to load wanted books', err.message, { label: 'Retry', onClick: () => tabWanted(root, arr, ctx, mode) }));
  }
}

function wantedRow(r, arr, ctx) {
  const line = bookLine(r);
  return h('div', { class: 'row book-row' },
    bookCoverEl(r),
    h('div', { class: 'row-main' },
      h('div', { class: 'row-title' }, r.title || 'Untitled'),
      line ? h('div', { class: 'row-sub' }, line) : null,
      h('div', { class: 'meta-line', style: { marginTop: '4px' } },
        r.releaseDate ? h('span', {}, `Released ${bookDate(r.releaseDate)}`) : null,
        r.mediaType && FORMATS[r.mediaType] ? h('span', { class: 'pill muted' }, `${FORMATS[r.mediaType].icon} ${FORMATS[r.mediaType].one}`) : null,
      ),
    ),
    actionGroup([
      { label: 'Search', title: 'Automatic search', primary: true, onClick: () => run(arr, { name: 'BookSearch', bookIds: [r.id] }, `Searching for ${r.title}`) },
      { label: 'Interactive', title: 'Interactive search: pick a release yourself', onClick: () => openReleaseSearch(ctx, ctx.service.key, `bookId=${r.id}`, r.title, { version: 'v1', media: 'book', grab: { bookId: r.id } }) },
      r.authorId ? { label: 'Author', title: 'Open the author', needs: 'read', onClick: () => openAuthor(ctx, { id: r.authorId }) } : null,
    ], { sheetTitle: r.title }),
  );
}

// Like Chaptarr's own queue: downloads it didn't grab (unknown author) are
// listed too, problems first in a summary that filters the list, and each
// row offers what Chaptarr offers: manual import, retry import, grab a
// delayed release, remove (optionally blocklisting) or ignore.
const PROBLEM_TEXT = {
  path: (n, app) => `${n} in a folder ${app} can’t reach`,
  notGrabbed: (n, app) => `${n} not grabbed by ${app}`,
  otherBook: (n) => `${n} matched another book`,
  noFiles: (n) => `${n} with no book files`,
  stuck: (n) => `${n} waiting for a manual import`,
  failed: (n) => `${n} failed`,
  other: (n) => `${n} with warnings`,
};
const problemOf = (r) => queueProblemKind(r) || (String(r.status).toLowerCase() === 'failed' ? 'failed' : 'other');

async function tabQueue(root, arr, ctx) {
  const app = ctx.service.label;
  const wrap = h('div', {});
  mount(root, wrap);
  const PAGE = 250;
  let list = [];
  let total = 0;
  let roots = [];
  cachedGet(`arr:${ctx.service.key}:rootfolder`, () => arr.get('rootfolder'), 600000).then((r) => { roots = Array.isArray(r) ? r : []; if (list.length) paint(); }).catch(() => {});
  let filter = ctx.params.queue || 'all';
  const setFilter = (f) => { filter = f; ctx.setParams({ queue: f === 'all' ? '' : f }); paint(); };
  // Chaptarr lists the downloads removed from the queue but left in the
  // download client (legacy Readarr has no such list: the count stays 0).
  let ignored = 0;
  const countIgnored = () => arr.get('ignored?page=1&pageSize=1')
    .then((d) => { const n = Number(d && d.totalRecords) || 0; if (n !== ignored) { ignored = n; paint(); } })
    .catch(() => {});
  const ignoredBtn = () => (ignored ? h('button', {
    class: 'btn sm', type: 'button', title: `Downloads removed from the queue but left in the download client, which ${app} no longer tracks`,
    onclick: () => openIgnoredDownloads(arr, { label: app, onChanged: () => reload() }),
  }, `Ignored ${ignored}`) : null);
  const reload = () => { load(true); countIgnored(); };
  const test = (r) => {
    if (filter.startsWith('kind:')) return needsAttention(r) && problemOf(r) === filter.slice(5);
    const def = QUEUE_FILTERS.find((f) => f.id === filter) || QUEUE_FILTERS[0];
    return def.test(r);
  };

  function paint() {
    if (!list.length) {
      const btn = ignoredBtn();
      mount(wrap, empty('📥', 'Queue is empty', 'Nothing downloading right now'), btn ? h('div', { class: 'load-more' }, btn) : null);
      return;
    }
    const counts = queueCounts(list);
    const kinds = new Map();
    for (const r of list.filter(needsAttention)) { const k = problemOf(r); kinds.set(k, (kinds.get(k) || 0) + 1); }
    const shown = list.filter(test);
    const problemsOnly = filter === 'attention' || filter.startsWith('kind:');
    const seg = (id, text) => h('button', { class: `view-seg ${filter === id ? 'active' : ''}`, type: 'button', onclick: () => setFilter(id) }, text);
    const head = h('div', { class: 'lib-head queue-head' },
      h('div', { class: 'view-toggle', role: 'group', 'aria-label': 'Which downloads' },
        seg('all', `All ${counts.all}`), seg('attention', `Needs attention ${counts.attention}`), seg('active', `Downloading ${counts.active}`)),
      h('span', { class: 'dim', style: { marginRight: 'auto' } }, counts.unknown ? `${plural(counts.unknown, 'download')} with an unknown author` : ''),
      ignoredBtn(),
      problemsOnly && shown.length > 1 ? h('button', {
        class: 'btn sm danger', type: 'button', 'data-needs': 'delete',
        title: 'Remove every download shown here from the queue',
        onclick: () => openBulkRemove(arr, shown, { app, roots, onDone: reload }),
      }, `Remove ${shown.length}…`) : null,
    );
    const banner = kinds.size ? h('div', { class: 'attention-banner queue-summary' },
      h('span', { class: 'pill down' }, `${counts.attention} need${counts.attention === 1 ? 's' : ''} attention`),
      h('div', { class: 'queue-kinds' }, ...[...kinds].sort((a, b) => b[1] - a[1]).map(([k, n]) => h('button', {
        class: `queue-kind ${filter === `kind:${k}` ? 'active' : ''}`, type: 'button', title: 'Show only these',
        onclick: () => setFilter(filter === `kind:${k}` ? 'attention' : `kind:${k}`),
      }, (PROBLEM_TEXT[k] || PROBLEM_TEXT.other)(n, app))))) : null;
    const hint = filter === 'kind:path' ? h('p', { class: 'dim queue-hint' },
      `${app} runs somewhere that can’t see these download folders. Add a remote path mapping in ${app} (Settings → Download Clients) from the download client’s folder to the same folder as ${app} sees it, or mount that folder into ${app}’s container. Then use Retry import or Fix import.`)
      : filter === 'kind:notGrabbed' ? h('p', { class: 'dim queue-hint' },
        `These are in the download client’s category for ${app}, but ${app} didn’t grab them, so it won’t import them by itself. Use Fix import to choose the book, or remove them from the queue (Ignore keeps them in the download client).`)
        : filter === 'kind:otherBook' ? h('p', { class: 'dim queue-hint' },
          `These books are listed twice: ${app} grabbed the download for one copy and matched the files to the other, so it won’t finish them by itself. Fix import says what to do with each. Books listed twice (System tab) stops monitoring the extra copies, so ${app} doesn’t grab the same book again.`)
          : null;
    mount(wrap, banner, head, hint,
      shown.length ? h('div', { class: 'list' }, ...shown.map((r) => queueRow(r, arr, ctx, reload, roots))) : empty('', 'Nothing here', 'No download matches this filter.'),
      total > list.length ? h('p', { class: 'dim', style: { textAlign: 'center' } }, `Showing the first ${list.length} of ${total} downloads.`) : null);
  }

  async function load(silent) {
    if (!silent) mount(wrap, skeletonList());
    try {
      const data = await arr.get(`queue?page=1&pageSize=${PAGE}&includeUnknownAuthorItems=true&includeAuthor=true&includeBook=true`);
      list = records(data);
      total = Number(data && data.totalRecords) || list.length;
      paint();
    } catch (err) {
      if (!silent) mount(wrap, empty('', 'Failed to load queue', err.message, { label: 'Retry', onClick: () => load(false) }));
    }
  }
  await load(false);
  countIgnored();
  liveRefresh(wrap, ctx.service, 5000, () => load(true));
}

function queueRow(r, arr, ctx, reload, roots = []) {
  const app = ctx.service.label;
  const size = Number(r.size) || 0;
  const left = Number(r.sizeleft) || 0;
  const prog = size ? ((size - left) / size) * 100 : 0;
  const book = r.book || {};
  const can = bookQueueActions(r);
  const reasons = bookQueueReasons(r);
  const kind = queueProblemKind(r);
  const attention = needsAttention(r);
  const downloading = String(r.trackedDownloadState || r.status || '').toLowerCase() === 'downloading' && String(r.status).toLowerCase() !== 'failed';
  const quality = r.quality && r.quality.quality && r.quality.quality.name;
  const onDone = () => (reload ? reload() : ctx.reload());
  // A download that sits in the library folder: removing it from the client
  // can delete files the library uses, so removing only ignores it by default.
  const libraryRoot = inLibraryFolder(r.outputPath, roots);
  const libraryWarning = libraryRoot ? `This download’s folder looks like it’s inside ${app}’s library (${libraryRoot}). Removing it from the download client can delete those files, including any ${app} already lists as books. Leave the switch off to only ignore it here.` : '';
  const remove = () => removeWithUndo(arr, r, { removeFromClient: !libraryRoot }, { onDone, rowEl: row });
  const pathHint = kind === 'path' ? `${app} can’t reach ${r.outputPath || 'this download’s folder'}. Add a remote path mapping in ${app} (Settings → Download Clients), or mount the folder into its container.` : '';
  // Grabbed for one copy of a book listed twice, matched to the other copy:
  // the download only counts as imported when the files go to the copy it was grabbed for.
  const grabbedFor = [book.title, bookSource(book)].filter(Boolean).join(' · ');
  const otherHint = kind === 'otherBook' ? `The book is listed twice: ${app} grabbed this for one copy and matched the files to the other. If the other copy already has these files, remove this download. To import it anyway, use Change book… and pick the copy it was grabbed for${grabbedFor ? ` (${grabbedFor})` : ''}, so ${app} counts the download as done.` : '';
  const actions = [
    can.importFiles ? {
      label: can.stuck ? '\u21E9 Fix import' : '\u21E9 Import', variant: can.stuck ? 'primary' : undefined, primary: can.stuck,
      title: can.stuck ? 'This download finished but wasn’t imported: choose the book and import it' : 'Import the downloaded files by hand',
      onClick: () => openBookImport(arr, { downloadId: r.downloadId, title: book.title || r.title, messages: reasons, hint: pathHint || otherHint, label: app, onImported: onDone }),
    } : null,
    can.retry ? {
      label: 'Retry import', title: `Ask ${app} to try importing this download again`,
      onClick: async () => {
        try {
          const cmd = await arr.post('command', { name: 'RetryFailedImport', downloadId: r.downloadId });
          toast(`Retrying the import of ${book.title || r.title}`, 'success');
          watchCommand(arr, cmd, { failed: 'The retry failed', onEnd: onDone });
        } catch (e) { toast(e.message, 'error'); }
      },
    } : null,
    can.grab ? {
      label: 'Grab now', primary: !can.stuck, title: 'Send this delayed release to the download client now',
      onClick: async () => {
        try { await arr.post(`queue/grab/${r.id}`, {}); toast(`Grabbing ${r.title}`, 'success'); onDone(); } catch (e) { toast(e.message, 'error'); }
      },
    } : null,
    { label: 'Remove…', title: 'Remove from the queue, optionally blocklisting the release', variant: 'danger', primary: !can.stuck && !can.grab, onClick: () => openRemoveQueueDialog(arr, r, { onDone, rowEl: row, removeFromClient: !libraryRoot, warning: libraryWarning }) },
    r.bookId || book.id ? { label: 'Blocklist & search', needs: 'delete', title: 'Blocklist this release and search for another', onClick: () => removeWithUndo(arr, r, { removeFromClient: !libraryRoot, blocklist: true, search: true }, { onDone, rowEl: row }) } : null,
    r.authorId ? { label: 'Author', needs: 'read', title: 'Open the author', onClick: () => openAuthor(ctx, { id: r.authorId }) } : null,
  ];
  const stateCls = attention ? (kind === 'notGrabbed' ? 'warn' : 'down') : 'info';
  const row = h('div', { class: `row book-row${attention ? ' queue-attention' : ''}` },
    bookCoverEl({ ...book, title: book.title || r.title }),
    h('div', { class: 'row-main' },
      h('div', { class: 'row-title' }, book.title || r.title || `#${r.id}`),
      h('div', { class: 'row-sub' }, [r.author && r.author.authorName, book.title ? r.title : null].filter(Boolean).join(' · ')),
      h('div', { class: 'meta-line', style: { marginTop: '4px' } },
        h('span', { class: `pill ${stateCls}` }, String(r.status).toLowerCase() === 'failed' ? 'Failed' : queueStateLabel(r)),
        isUnknownAuthor(r) ? h('span', { class: 'pill muted', title: `${app} didn’t grab this download, or can’t tell which book it is` }, 'Unknown author') : null,
        quality && !/^unknown$/i.test(quality) ? h('span', { class: 'pill info' }, quality) : null,
        downloading ? h('span', {}, `${fmtBytes(left)} left`) : size ? h('span', {}, fmtBytes(size)) : null,
        downloading && r.timeleft ? h('span', {}, `ETA ${r.timeleft}`) : null,
        r.downloadClient ? h('span', {}, r.downloadClient) : null,
        r.indexer ? h('span', { class: 'dim' }, r.indexer) : null,
      ),
      attention && reasons.length ? h('div', { class: `queue-reason ${kind === 'notGrabbed' ? 'soft' : ''}`, title: bookQueueMessages(r).join('\n') },
        reasons[0] + (reasons.length > 1 ? ` (+${reasons.length - 1} more)` : '')) : null,
      attention && r.outputPath ? h('div', { class: 'mono book-file-path dim' }, r.outputPath) : null,
      downloading ? h('div', { class: 'progress' }, h('span', { style: { width: pct(prog) } })) : null,
    ),
    actionGroup(actions, { sheetTitle: book.title || r.title }),
  );
  return swipeToAction(row, remove);
}

// Remove many downloads at once (Chaptarr's DELETE queue/bulk). Ignoring is
// the default: the downloads stay in the download client and the app stops
// tracking them; nothing is deleted unless "Remove from the download client"
// is ticked.
function openBulkRemove(arr, list, { app, roots = [], onDone }) {
  const opt = (label, hint, checked) => {
    const input = h('input', { type: 'checkbox', role: 'switch', checked: checked ? 'checked' : null });
    return { input, row: h('label', { class: 'queue-remove-opt' }, input, h('span', {}, h('strong', {}, label), h('span', { class: 'dim' }, hint))) };
  };
  const fromClient = opt('Remove from the download client', 'Deletes the downloads and their files from the client. Off: the downloads are only ignored here.', false);
  const blocklist = opt('Blocklist these releases', `${app} won’t grab them again`, false);
  const withBook = list.filter((r) => r.bookId || (r.book && r.book.id)).length;
  const inLibrary = list.filter((r) => inLibraryFolder(r.outputPath, roots)).length;
  const go = async () => {
    closeModal();
    const opts = { removeFromClient: fromClient.input.checked, blocklist: blocklist.input.checked, search: false };
    try {
      await arr.del(`queue/bulk?${removeQueueQuery(opts)}`, { ids: list.map((r) => r.id) });
      toast(`${opts.removeFromClient ? 'Removed' : 'Ignored'} ${plural(list.length, 'download')}`, 'success');
    } catch (e) { if (!e.cancelled) toast(e.message, 'error', 7000); }
    onDone();
  };
  openModal({
    title: `Remove ${plural(list.length, 'download')} from the queue`,
    body: h('div', { class: 'queue-remove' },
      h('p', { class: 'queue-remove-title' }, list.slice(0, 4).map((r) => (r.book && r.book.title) || r.title).join(' · ') + (list.length > 4 ? ` and ${list.length - 4} more` : '')),
      inLibrary ? h('p', { class: 'queue-remove-warning' }, `${plural(inLibrary, 'download')} ${inLibrary === 1 ? 'looks' : 'look'} like ${inLibrary === 1 ? 'it’s' : 'they’re'} inside ${app}’s library folder. Removing them from the download client can delete files the library uses.`) : null,
      fromClient.row, blocklist.row,
      withBook < list.length ? h('p', { class: 'dim', style: { fontSize: '12px' } }, `${app} can only blocklist downloads it knows the book of (${withBook} of ${list.length}).`) : null),
    footer: h('div', { class: 'modal-actions' }, h('button', { class: 'btn', type: 'button', onclick: closeModal }, 'Cancel'), h('button', { class: 'btn danger', type: 'button', onclick: go }, 'Remove')),
  });
}

async function tabCalendar(root, arr, ctx) {
  mount(root, skeletonList());
  try {
    const start = new Date(); start.setDate(start.getDate() - 7);
    const end = new Date(); end.setDate(end.getDate() + 60);
    const items = records(await arr.get(`calendar?start=${start.toISOString()}&end=${end.toISOString()}&includeAuthor=true`)).filter((b) => b.releaseDate);
    if (!items.length) return mount(root, empty('📅', 'Nothing scheduled', 'No book releases from last week through the next two months'));
    items.sort((a, b) => new Date(a.releaseDate) - new Date(b.releaseDate));
    mount(root, h('div', { class: 'list' }, ...items.map((b) => calRow(b, ctx))));
  } catch (err) {
    mount(root, empty('', 'Failed to load calendar', err.message, { label: 'Retry', onClick: () => tabCalendar(root, arr, ctx) }));
  }
}

function calRow(b, ctx) {
  const st = bookState(b);
  const line = bookLine(b);
  return h('div', { class: `row book-row${b.authorId ? ' clickable' : ''}`, onclick: b.authorId ? () => openAuthor(ctx, { id: b.authorId }) : null },
    bookCoverEl(b),
    h('div', { class: 'row-main' },
      h('div', { class: 'row-title' }, b.title || 'Untitled'),
      line ? h('div', { class: 'row-sub' }, line) : null,
      h('div', { class: 'meta-line', style: { marginTop: '4px' } },
        h('span', {}, bookDate(b.releaseDate), ' · ', fmtRelative(b.releaseDate)),
        h('span', { class: `pill ${st.cls}` }, st.label),
        b.mediaType && FORMATS[b.mediaType] ? h('span', { class: 'pill muted' }, `${FORMATS[b.mediaType].icon} ${FORMATS[b.mediaType].one}`) : null,
      ),
    ),
  );
}

function bookEventInfo(type) {
  const t = String(type || '');
  if (/incomplete/i.test(t)) return { label: 'Import incomplete', cls: 'warn' };
  if (/grabbed/i.test(t)) return { label: 'Grabbed', cls: 'info' };
  if (/conversionfailed/i.test(t)) return { label: 'Conversion failed', cls: 'down' };
  if (/imported/i.test(t)) return { label: 'Imported', cls: 'ok' };
  if (/failed/i.test(t)) return { label: 'Failed', cls: 'down' };
  if (/deleted/i.test(t)) return { label: 'Deleted', cls: 'muted' };
  if (/retagged/i.test(t)) return { label: 'Tags written', cls: 'muted' };
  if (/renamed/i.test(t)) return { label: 'Renamed', cls: 'muted' };
  if (/converted/i.test(t)) return { label: 'Converted', cls: 'muted' };
  if (/ignored/i.test(t)) return { label: 'Ignored', cls: 'muted' };
  if (/split/i.test(t)) return { label: 'Author split', cls: 'muted' };
  if (/merged/i.test(t)) return { label: 'Authors merged', cls: 'muted' };
  return { label: t || 'Event', cls: 'muted' };
}

// History event types (EntityHistoryEventType in Readarr and Chaptarr).
const HISTORY_FILTERS = [
  { id: 'all', label: 'All', types: [] },
  { id: 'grabbed', label: 'Grabbed', types: [1] },
  { id: 'imported', label: 'Imported', types: [3, 8] },
  { id: 'failed', label: 'Failed', types: [4, 7, 12] },
  { id: 'files', label: 'Files changed', types: [5, 6, 9, 11] },
];

// The one line worth reading from an event's data.
function historyDetail(r) {
  const d = r.data || {};
  if (d.message) return d.message;
  if (d.statusMessages) {
    try {
      const fake = { statusMessages: JSON.parse(d.statusMessages) };
      const reasons = bookQueueReasons(fake);
      if (reasons.length) return reasons[0];
    } catch { /* not JSON */ }
  }
  if (d.details) return d.details;
  if (d.importedPath) return `→ ${String(d.importedPath).split('/').slice(-3).join('/')}`;
  if (/grabbed/i.test(r.eventType) && (d.indexer || d.downloadClientName || d.downloadClient)) return [d.indexer, d.downloadClientName || d.downloadClient].filter(Boolean).join(' → ');
  return '';
}

async function tabHistory(root, arr, ctx) {
  const pageSize = 40;
  let filter = HISTORY_FILTERS.some((f) => f.id === ctx.params.events) ? ctx.params.events : 'all';
  const wrap = h('div', {});
  const seg = (f) => h('button', { class: `view-seg ${filter === f.id ? 'active' : ''}`, type: 'button', onclick: (e) => {
    if (filter === f.id) return;
    filter = f.id;
    for (const b of e.currentTarget.parentElement.children) b.classList.toggle('active', b === e.currentTarget);
    ctx.setParams({ events: f.id === 'all' ? '' : f.id });
    load();
  } }, f.label);
  const head = h('div', { class: 'lib-head', style: { justifyContent: 'flex-start' } }, h('div', { class: 'view-toggle', role: 'group', 'aria-label': 'Which events' }, ...HISTORY_FILTERS.map(seg)));
  mount(root, head, wrap);
  const url = (page) => {
    const types = (HISTORY_FILTERS.find((f) => f.id === filter) || HISTORY_FILTERS[0]).types;
    return `history?page=${page}&pageSize=${pageSize}&sortKey=date&sortDirection=descending&includeAuthor=true&includeBook=true${types.map((t) => `&eventType=${t}`).join('')}`;
  };
  async function load() {
    mount(wrap, skeletonList());
    try {
      const data = await arr.get(url(1));
      let shown = records(data);
      const total = Number(data && data.totalRecords) || shown.length;
      if (!shown.length) return mount(wrap, empty('🕓', filter === 'all' ? 'No history yet' : 'Nothing here', filter === 'all' ? '' : 'No event of this kind yet.'));
      const list = h('div', { class: 'list' }, ...shown.map((r) => historyRow(r, ctx)));
      let page = 1;
      const more = h('button', { class: 'btn' }, `Show more (${total - shown.length} more)`);
      const moreWrap = h('div', { class: 'load-more' }, more);
      more.onclick = async () => {
        more.disabled = true;
        try {
          const next = records(await arr.get(url(page + 1)));
          page++;
          shown = shown.concat(next);
          for (const r of next) list.appendChild(historyRow(r, ctx));
          more.textContent = `Show more (${Math.max(0, total - shown.length)} more)`;
          more.disabled = false;
          if (!next.length || shown.length >= total) moreWrap.remove();
        } catch (e) { toast(e.message, 'error'); more.disabled = false; }
      };
      mount(wrap, list, shown.length < total ? moreWrap : null);
    } catch (err) {
      mount(wrap, empty('', 'Failed to load history', err.message, { label: 'Retry', onClick: load }));
    }
  }
  await load();
}

function historyRow(r, ctx) {
  const info = bookEventInfo(r.eventType);
  const book = r.book || {};
  const quality = r.quality && r.quality.quality && r.quality.quality.name;
  const detail = historyDetail(r);
  return h('div', { class: `row book-row${r.authorId ? ' clickable' : ''}`, onclick: r.authorId ? () => openAuthor(ctx, { id: r.authorId }) : null },
    bookCoverEl({ ...book, title: book.title || r.sourceTitle }),
    h('div', { class: 'row-main' },
      h('div', { class: 'row-title' }, book.title || r.sourceTitle || 'Unknown'),
      h('div', { class: 'row-sub' }, [r.author && r.author.authorName, book.title ? r.sourceTitle : null].filter(Boolean).join(' · ')),
      h('div', { class: 'meta-line', style: { marginTop: '4px' } },
        h('span', { class: `pill ${info.cls}` }, info.label),
        quality ? h('span', {}, quality) : null,
        r.date ? timeEl(r.date) : null,
      ),
      detail ? h('div', { class: `history-detail ${info.cls === 'down' || info.cls === 'warn' ? 'bad' : ''}` }, detail) : null,
    ),
  );
}

// ---- System ----------------------------------------------------------------

const HEALTH_CLS = { error: 'down', warning: 'warn', notice: 'info' };
// Commands the server lets only admins run (server/roles.js ADMIN_COMMANDS).
const ADMIN_COMMAND = /delete|backup|update|restart|shutdown|clear|reset|cleanup/i;
function everyLabel(mins) {
  const m = Number(mins) || 0;
  if (!m) return '';
  if (m % 10080 === 0) return m === 10080 ? 'Every week' : `Every ${m / 10080} weeks`;
  if (m % 1440 === 0) return m === 1440 ? 'Every day' : `Every ${m / 1440} days`;
  if (m % 60 === 0) return m === 60 ? 'Every hour' : `Every ${m / 60} hours`;
  return m === 1 ? 'Every minute' : `Every ${m} minutes`;
}
const isPathCheck = (c) => /RemotePathMapping|RootFolder|MountCheck|DownloadClientRootFolder|ImportMechanism/i.test((c && c.source) || '')
  || /not accessible|does not exist|remote path|docker/i.test((c && c.message) || '');
// "00:01:52.7210000" -> "1m 52s"; under a second -> '' (not worth showing).
function durationLabel(span) {
  const m = String(span || '').match(/^(?:(\d+)\.)?(\d+):(\d+):(\d+)(?:\.\d+)?$/);
  if (!m) return '';
  const secs = (Number(m[1] || 0) * 86400) + (Number(m[2]) * 3600) + (Number(m[3]) * 60) + Number(m[4]);
  if (secs < 1) return '';
  const hh = Math.floor(secs / 3600); const mm = Math.floor((secs % 3600) / 60); const ss = secs % 60;
  return [hh ? `${hh}h` : '', mm ? `${mm}m` : '', !hh && ss ? `${ss}s` : ''].filter(Boolean).join(' ');
}

async function tabSystem(root, arr, ctx) {
  const app = ctx.service.label;
  mount(root, skeletonList());
  try {
    const [health, disks, status, tasks, blocklist] = await Promise.all([
      arr.get('health').catch(() => []),
      arr.get('diskspace').catch(() => []),
      arr.get('system/status').catch(() => ({})),
      arr.get('system/task').catch(() => []),
      arr.get('blocklist?page=1&pageSize=20&sortKey=date&sortDirection=descending').catch(() => ({ records: [] })),
    ]);
    const reload = () => tabSystem(root, arr, ctx);
    const command = (name, label, title, extra = {}) => {
      const btn = h('button', { class: 'btn sm', type: 'button', title, 'data-needs': ADMIN_COMMAND.test(name) ? 'admin' : 'write' }, label);
      btn.onclick = async () => {
        btn.disabled = true;
        try {
          const cmd = await arr.post('command', { name, ...extra });
          toast(`${label}: started`, 'success');
          watchCommand(arr, cmd, { done: `${label}: done`, failed: `${label} failed`, onEnd: () => { btn.disabled = false; } });
        } catch (e) { toast(e.message, 'error'); btn.disabled = false; }
      };
      return btn;
    };
    const searchMissing = h('button', { class: 'btn sm', type: 'button', 'data-needs': 'write', title: 'Search for every missing monitored book' }, 'Search missing');
    searchMissing.onclick = async () => {
      let total = 0;
      try { total = Number((await arr.get('wanted/missing?page=1&pageSize=1')).totalRecords) || 0; } catch { /* unknown */ }
      if (!total) { toast('No monitored book is missing', 'info'); return; }
      searchBooks(arr, { name: 'MissingBookSearch' }, total, 'every missing book');
    };
    const dupes = h('button', { class: 'btn sm', type: 'button', title: 'Books listed more than once, which can be downloaded twice' }, 'Books listed twice');
    dupes.onclick = async () => {
      dupes.disabled = true;
      try {
        const [books, authors] = await Promise.all([arr.get('book'), cachedList(authorsKey(ctx), () => arr.get('author'), 300000)]);
        openDuplicateBooks(arr, ctx, { books: Array.isArray(books) ? books : [], authors, title: `Books listed twice · ${app}` });
      } catch (e) { toast(e.message, 'error'); }
      dupes.disabled = false;
    };
    const taskRow = (t) => h('div', { class: 'row task-row' },
      h('div', { class: 'row-main' },
        h('div', { class: 'row-title', style: { fontSize: '14px' } }, t.name || t.taskName),
        h('div', { class: 'meta-line', style: { marginTop: '4px' } },
          t.interval ? h('span', { class: 'dim' }, everyLabel(t.interval)) : null,
          t.lastExecution ? h('span', {}, 'Last ', timeEl(t.lastExecution)) : null,
          t.nextExecution ? h('span', { class: 'dim' }, `Next ${fmtRelative(t.nextExecution)}`) : null,
          durationLabel(t.lastDuration) ? h('span', { class: 'dim' }, `took ${durationLabel(t.lastDuration)}`) : null)),
      h('div', { class: 'row-actions' }, command(t.taskName || t.name, 'Run now', `Run ${t.name || t.taskName} now`)));
    const pathChecks = (health || []).filter(isPathCheck).length;
    mount(root,
      h('div', { class: 'section-title' }, 'Maintenance'),
      h('div', { class: 'meta-line system-actions' },
        command('RssSync', 'RSS sync', 'Check the indexers’ RSS feeds for new releases now'),
        command('RefreshMonitoredDownloads', 'Check downloads', 'Ask the download clients for finished downloads now'),
        command('RefreshAuthor', 'Refresh all authors', 'Refresh every author from the metadata source and rescan their folders'),
        command('RescanFolders', 'Rescan folders', 'Scan the root folders for new, changed and removed files'),
        searchMissing,
        command('CheckHealth', 'Check health', 'Run the health checks again'),
        command('Backup', 'Back up', `Make a ${app} backup now`),
        h('button', { class: 'btn sm', type: 'button', title: 'Files in the root folders that aren’t linked to a book', onclick: () => openUnmappedFiles(arr, ctx, { onChanged: () => invalidate(`arr:${ctx.service.key}:unmapped`) }) }, 'Unmapped files'),
        dupes,
        h('button', { class: 'btn sm', type: 'button', title: 'Entries that waste searches or clutter the library, with bulk fixes', onclick: () => openTidyUp(arr, ctx, 'author') }, 'Tidy up'),
        roleAllows('admin') ? h('button', { class: 'btn sm', type: 'button', title: 'Read-only checks: folders, download clients, remote path mappings, Prowlarr sync', onclick: () => import('../lib/setupDoctorUI.js').then((m) => m.openSetupDoctor(ctx, { service: ctx.service.key })) }, 'Setup doctor') : null),
      h('div', { class: 'section-title' }, 'Health'),
      (health && health.length)
        ? h('div', { class: 'list' }, ...health.map((c) => h('div', { class: 'row' },
          h('div', { class: 'row-main' },
            h('div', { class: 'row-title', style: { fontSize: '14px', overflowWrap: 'anywhere' } }, c.message || c.source),
            h('div', { class: 'meta-line', style: { marginTop: '4px' } },
              h('span', { class: `pill ${HEALTH_CLS[c.type] || 'muted'}` }, c.type || 'notice'),
              c.source ? h('span', { class: 'dim' }, c.source) : null,
              isPathCheck(c) ? h('button', { class: 'btn sm', type: 'button', title: 'Downloads waiting because of this', onclick: () => ctx.setParams({ tab: 'queue', queue: 'kind:path' }, { reload: true }) }, 'Show downloads') : null,
              c.wikiUrl ? h('a', { class: 'btn sm', href: c.wikiUrl, target: '_blank', rel: 'noopener noreferrer' }, 'Help') : null)))))
        : h('div', { class: 'dim' }, 'No health issues.'),
      pathChecks && roleAllows('admin') ? h('p', { class: 'dim', style: { fontSize: '12px' } }, `The Setup doctor above compares ${app}’s download clients, remote path mappings and folders and says what to change.`) : null,
      h('div', { class: 'section-title' }, 'Disk space'),
      (disks || []).length ? h('div', { class: 'list' }, ...disks.map((d) => {
        const used = (d.totalSpace || 0) - (d.freeSpace || 0);
        const p = d.totalSpace ? (used / d.totalSpace) * 100 : 0;
        return h('div', { class: 'row' }, h('div', { class: 'row-main' },
          h('div', { class: 'row-title', style: { fontSize: '14px' } }, d.path || d.label || 'Disk'),
          h('div', { class: 'meta-line', style: { marginTop: '4px' } },
            h('span', {}, `${fmtBytes(d.freeSpace)} free of ${fmtBytes(d.totalSpace)}`),
            h('span', { class: `pill ${p > 90 ? 'down' : p > 75 ? 'warn' : 'ok'}` }, `${Math.round(p)}% used`)),
          h('div', { class: 'progress' }, h('span', { style: { width: pct(p) } }))));
      })) : h('div', { class: 'dim' }, `${app} reported no disks.`),
      (tasks || []).length ? h('div', { class: 'section-title' }, 'Scheduled tasks') : null,
      (tasks || []).length ? h('div', { class: 'list' }, ...[...tasks].sort((a, b) => String(a.name).localeCompare(String(b.name))).map(taskRow)) : null,
      h('div', { class: 'section-title' }, 'System'),
      h('div', { class: 'card' },
        ...[
          ['App', [status.appName || app, status.instanceName && status.instanceName !== status.appName ? `(${status.instanceName})` : ''].filter(Boolean).join(' ')],
          ['Version', [status.version, status.branch ? `· ${status.branch}` : ''].filter(Boolean).join(' ')],
          ['OS', status.osName ? `${status.osName} ${status.osVersion || ''}`.trim() : ''],
          ['Runtime', status.runtimeVersion ? `${status.runtimeName || '.NET'} ${status.runtimeVersion}` : ''],
          ['Docker', status.isDocker === undefined ? '' : status.isDocker ? 'Yes' : 'No'],
          ['Started', status.startTime ? fmtRelative(status.startTime) : ''],
          ['Database', status.databaseType ? `${status.databaseType} ${status.databaseVersion || ''}`.trim() : ''],
        ].filter(([, v]) => v).map(([k, v]) => h('div', { class: 'setting-row' }, h('span', { class: 'dim' }, k), h('span', { class: 'right' }, v)))),
      h('div', { class: 'section-title' }, 'Blocklist'),
      blocklistSection(blocklist, arr, reload),
    );
  } catch (err) {
    mount(root, empty('', 'Failed to load system info', err.message, { label: 'Retry', onClick: () => tabSystem(root, arr, ctx) }));
  }
}
