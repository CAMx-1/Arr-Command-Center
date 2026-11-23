// Readarr-compatible book managers (Chaptarr, legacy Readarr), laid out like
// the Sonarr and Radarr pages: authors with their pictures as a honeycomb,
// list or table; an author page with every book (monitor, automatic and
// interactive search, files); add, edit and remove authors; and Wanted, Queue,
// Calendar and History with book covers. Chaptarr keeps audiobook and ebook
// settings side by side; lib/readarrLibrary.js handles both shapes.
import { h, mount, tabs, skeletonList, empty, toast, fmtBytes, fmtDate, fmtRelative, timeEl, pct, openModal, closeModal, confirmModal, rootFolderLabel, swipeToAction } from '../lib/ui.js';
import { posterHexCard, pagedLibrary } from '../lib/hive.js';
import { viewToggle, effectiveMode } from '../lib/viewMode.js';
import { cachedGet, cachedList, invalidate } from '../lib/cache.js';
import { libraryFilter } from '../lib/libraryFilter.js';
import { compactTable } from '../lib/tableView.js';
import { actionGroup } from '../lib/actions.js';
import { openLookupModal } from '../lib/lookupSearch.js';
import { tagEditor, loadTags, queueStatePill, queueStuckReason } from '../lib/arrActions.js';
import { removeWithUndo, openRemoveQueueDialog } from '../lib/queueActions.js';
import { liveRefresh } from '../lib/live.js';
import { getAddDefaults, setAddDefaults } from '../lib/addDefaults.js';
import { roleAllows } from '../lib/roleUi.js';
import { openTidyUp } from '../lib/tidyUpUI.js';
import { dismissKeyboardOnEnter } from '../lib/nativeApp.js';
import { openReleaseSearch } from './releaseSearch.js';
import { showReadarrNotice } from './musicbooks.js';
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
    );
    mount(root, head, listWrap);
  } catch (err) {
    mount(root, empty('', 'Failed to load authors', err.message, { label: 'Retry', onClick: () => tabAuthors(root, arr, ctx) }));
  }
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
            h('button', { class: 'btn', 'data-needs': 'write', title: 'Edit / remove', onclick: () => openEditAuthor(arr, ctx, author, { onRemoved: () => ctx.go(svc.key, libraryParams) }) }, 'Edit'),
          ),
        ),
      ),
    ));
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

  mount(pageEl, heroSlot, overviewEl, toolbar, listSlot);
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

async function tabQueue(root, arr, ctx) {
  const wrap = h('div', {});
  mount(root, wrap);
  const load = async (silent) => {
    if (!silent) mount(wrap, skeletonList());
    try {
      const list = records(await arr.get('queue?page=1&pageSize=50&includeAuthor=true&includeBook=true'));
      if (!list.length) { mount(wrap, empty('📥', 'Queue is empty', 'Nothing downloading right now')); return; }
      mount(wrap, h('div', { class: 'list' }, ...list.map((r) => queueRow(r, arr, ctx))));
    } catch (err) {
      if (!silent) mount(wrap, empty('', 'Failed to load queue', err.message));
    }
  };
  await load(false);
  liveRefresh(wrap, ctx.service, 5000, () => load(true));
}

function queueRow(r, arr, ctx) {
  const size = Number(r.size) || 0;
  const left = Number(r.sizeleft) || 0;
  const prog = size ? ((size - left) / size) * 100 : 0;
  const book = r.book || {};
  const remove = () => removeWithUndo(arr, r, { removeFromClient: true }, { onDone: () => ctx.reload(), rowEl: row });
  const quality = r.quality && r.quality.quality && r.quality.quality.name;
  const row = h('div', { class: 'row book-row' },
    bookCoverEl({ ...book, title: book.title || r.title }),
    h('div', { class: 'row-main' },
      h('div', { class: 'row-title' }, book.title || r.title || `#${r.id}`),
      h('div', { class: 'row-sub' }, [r.author && r.author.authorName, book.title ? r.title : null].filter(Boolean).join(' · ')),
      h('div', { class: 'meta-line', style: { marginTop: '4px' } },
        queueStatePill(r),
        quality ? h('span', { class: 'pill info' }, quality) : null,
        h('span', {}, `${fmtBytes(left)} left`),
        r.timeleft ? h('span', {}, `ETA ${r.timeleft}`) : null,
        r.downloadClient ? h('span', {}, r.downloadClient) : null,
      ),
      queueStuckReason(r),
      h('div', { class: 'progress' }, h('span', { style: { width: pct(prog) } })),
    ),
    actionGroup([
      { label: 'Remove…', title: 'Remove from the queue', variant: 'danger', primary: true, onClick: () => openRemoveQueueDialog(arr, r, { onDone: () => ctx.reload(), rowEl: row }) },
    ], { sheetTitle: r.title }),
  );
  return swipeToAction(row, remove);
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
  if (/imported/i.test(t)) return { label: 'Imported', cls: 'ok' };
  if (/failed/i.test(t)) return { label: 'Failed', cls: 'down' };
  if (/deleted/i.test(t)) return { label: 'Deleted', cls: 'muted' };
  if (/renamed|retagged/i.test(t)) return { label: 'Renamed', cls: 'muted' };
  if (/ignored/i.test(t)) return { label: 'Ignored', cls: 'muted' };
  return { label: t || 'Event', cls: 'muted' };
}

async function tabHistory(root, arr, ctx) {
  mount(root, skeletonList());
  try {
    const list = records(await arr.get('history?page=1&pageSize=40&sortKey=date&sortDirection=descending&includeAuthor=true&includeBook=true'));
    if (!list.length) return mount(root, empty('🕓', 'No history yet'));
    mount(root, h('div', { class: 'list' }, ...list.map((r) => historyRow(r, ctx))));
  } catch (err) {
    mount(root, empty('', 'Failed to load history', err.message, { label: 'Retry', onClick: () => tabHistory(root, arr, ctx) }));
  }
}

function historyRow(r, ctx) {
  const info = bookEventInfo(r.eventType);
  const book = r.book || {};
  const quality = r.quality && r.quality.quality && r.quality.quality.name;
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
    ),
  );
}
