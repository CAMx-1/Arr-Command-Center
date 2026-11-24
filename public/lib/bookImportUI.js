// Manual import and unmapped files for book managers (Chaptarr, legacy
// Readarr), laid out like Chaptarr's own Interactive Import: files grouped by
// the book they'd go to, a re-check after moving files to another author or
// book, then the ManualImport command, watched until it finishes. Pure logic
// is lib/bookImport.js.
import { h, mount, clear, toast, spinner, empty, openModal, closeModal, confirmModal, fmtBytes, fmtRelative } from './ui.js';
import { roleAllows } from './roleUi.js';
import { commandOutcome } from './manualImport.js';
import { FORMATS, bookCover, nameGradient, compareAuthors, bookYear } from './readarrLibrary.js';
import {
  bookImportQuery, importReadiness, defaultBookSelection, buildBookImportCommand, bookReprocessPayload, mergeBookReprocessed,
  withAuthor, withBook, pickEdition, groupImportItems, rejectionText, mediaTypeOfPath, unmappedUnits, isChaptarrItem, bookSource,
} from './bookImport.js';

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const fileName = (it) => it.name || String(it.path || '').split('/').pop() || 'File';
const itemFormat = (it) => (it.book && it.book.mediaType) || mediaTypeOfPath(it.path);

// Poll a queued command so the person learns whether it worked: the app
// accepts a command at once and may still fail it later.
export async function watchCommand(arr, cmd, { done, failed, onEnd } = {}) {
  if (!cmd || cmd.id == null) { if (onEnd) onEnd(); return; }
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, i < 5 ? 1000 : 3000));
    let state;
    try { state = await arr.get(`command/${cmd.id}`); } catch { break; }
    const outcome = commandOutcome(state);
    if (outcome === 'completed') { if (done) toast(done, 'success'); break; }
    if (outcome === 'failed') { toast(`${failed || 'It failed'}${state && state.message ? `: ${state.message}` : ''}`, 'error', 8000); break; }
  }
  if (onEnd) onEnd();
}

function smallCover(book) {
  const url = bookCover(book);
  if (url) return h('img', { class: 'import-cover', src: url, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer', onerror: function () { this.replaceWith(h('div', { class: 'import-cover', style: { backgroundImage: nameGradient(book && book.title) } })); } });
  return h('div', { class: 'import-cover', style: { backgroundImage: nameGradient(book && book.title) } });
}

// opts: { downloadId?, folder?, bookFileIds?, mediaType?, title?, messages?: string[],
//         hint?: string, label?: string (the app's name), onImported?: () => void }
export function openBookImport(arr, opts = {}) {
  const app = opts.label || 'The app';
  const body = h('div', { class: 'book-import' }, h('div', { style: { padding: '20px' } }, spinner()));
  openModal({ title: `Manual import${opts.title ? ` · ${opts.title}` : ''}`, body, wide: true });

  const lookups = {};
  const lazy = (key, load) => (lookups[key] ||= load().then((v) => (Array.isArray(v) ? v : [])).catch(() => []));
  const authorList = () => lazy('authors', () => arr.get('author')).then((list) => [...list].sort(compareAuthors));
  const bookList = (authorId) => lazy(`books:${authorId}`, () => arr.get(`book?authorId=${authorId}`));

  let items = [];
  const selected = new Set();
  const open = new Set(); // groups showing every file
  const listEl = h('div', { class: 'import-groups' });
  const statusEl = h('span', { class: 'dim' });
  const importBtn = h('button', { class: 'btn primary', type: 'button', 'data-needs': opts.downloadId ? 'write' : 'delete' }, 'Import');
  const selectAll = h('input', { type: 'checkbox', 'aria-label': 'Choose every file' });

  const refreshFooter = () => {
    const n = selected.size;
    importBtn.textContent = n ? `Import ${plural(n, 'file')}` : 'Import';
    importBtn.disabled = !n;
    selectAll.checked = n > 0 && n === items.length;
    selectAll.indeterminate = n > 0 && n < items.length;
    statusEl.textContent = `${plural(items.length, 'file')} · ${n} chosen`;
  };
  const paint = () => { mount(listEl, ...groupImportItems(items).map(groupBlock)); refreshFooter(); };

  // Re-check moved files with the app (POST manualimport writes nothing).
  const recheck = async (changed) => {
    try {
      const res = await arr.post('manualimport', changed.map((it) => bookReprocessPayload(it, opts.downloadId)));
      const byId = new Map((Array.isArray(res) ? res : []).map((x) => [x.id, x]));
      changed = changed.map((it) => mergeBookReprocessed(it, byId.get(it.id)));
    } catch (e) { toast(`Couldn’t re-check the files: ${e.message}`, 'error', 6000); }
    // Chaptarr needs an edition; if the re-check didn't pick one, use the book's monitored edition.
    const missing = changed.filter((it) => isChaptarrItem(it) && it.book && it.book.id && !(Number(it.editionId) > 0));
    if (missing.length) {
      const ids = [...new Set(missing.map((it) => it.book.id))];
      try {
        const eds = await arr.get(`edition?${ids.map((id) => `bookId=${id}`).join('&')}`);
        changed = changed.map((it) => {
          if (!missing.includes(it)) return it;
          const ed = pickEdition(eds, it.book.id);
          return ed ? { ...it, editionId: ed.id, edition: ed } : it;
        });
      } catch { /* the file says "Choose an edition" */ }
    }
    const byId = new Map(changed.map((it) => [it.id, it]));
    items = items.map((it) => byId.get(it.id) || it);
    for (const it of changed) {
      if (!importReadiness(it).problem && !(it.rejections || []).length) selected.add(it.id); else if (importReadiness(it).problem) selected.delete(it.id);
    }
    paint();
  };

  // Move files to another author and book.
  const editor = (targets, onClose) => {
    const wrap = h('div', { class: 'card import-editor' }, spinner());
    const format = itemFormat(targets[0]);
    (async () => {
      const authors = await authorList();
      const first = targets[0];
      const authorSel = h('select', { class: 'input', 'aria-label': 'Author' },
        h('option', { value: '' }, '— choose the author —'),
        ...authors.map((a) => h('option', { value: String(a.id) }, a.authorName)));
      authorSel.value = first.author && first.author.id ? String(first.author.id) : '';
      const bookSel = h('select', { class: 'input', 'aria-label': 'Book' });
      const bookHint = h('div', { class: 'dim', style: { fontSize: '12px' } });
      let books = [];
      const paintBooks = async () => {
        const id = Number(authorSel.value);
        if (!id) { mount(bookSel, h('option', { value: '' }, 'Choose the author first')); bookSel.disabled = true; return; }
        bookSel.disabled = true;
        mount(bookSel, h('option', { value: '' }, 'Loading books…'));
        const all = await bookList(id);
        books = all.filter((b) => !format || !b.mediaType || b.mediaType === format)
          .sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')) || a.id - b.id);
        const label = (b) => [b.title, bookYear(b) ? `(${bookYear(b)})` : '', b.seriesTitle ? `· ${b.seriesTitle}` : '', bookSource(b) ? `· ${bookSource(b)}` : '',
          b.statistics && Number(b.statistics.bookFileCount) > 0 ? '· on disk' : ''].filter(Boolean).join(' ');
        mount(bookSel, h('option', { value: '' }, books.length ? '— choose the book —' : 'This author has no books in this format'), ...books.map((b) => h('option', { value: String(b.id) }, label(b))));
        bookSel.disabled = !books.length;
        if (first.book && books.some((b) => b.id === first.book.id)) bookSel.value = String(first.book.id);
        mount(bookHint, books.length && format && FORMATS[format] ? `${FORMATS[format].label} only, as the files are ${FORMATS[format].label.toLowerCase()}.` : '');
      };
      authorSel.addEventListener('change', paintBooks);
      await paintBooks();
      const apply = h('button', { class: 'btn sm primary', type: 'button' }, targets.length > 1 ? `Move ${plural(targets.length, 'file')}` : 'Move file');
      apply.onclick = async () => {
        const author = authors.find((a) => String(a.id) === authorSel.value);
        const book = books.find((b) => String(b.id) === bookSel.value);
        if (!author || !book) { toast('Choose the author and the book', 'error'); return; }
        apply.disabled = true; apply.textContent = 'Checking…';
        await recheck(targets.map((it) => withBook(withAuthor(it, author), book)));
      };
      mount(wrap,
        h('div', { class: 'import-editor-grid' },
          h('label', { class: 'import-field' }, h('span', { class: 'dim' }, 'Author'), authorSel),
          h('label', { class: 'import-field' }, h('span', { class: 'dim' }, 'Book'), bookSel)),
        bookHint,
        h('div', { class: 'import-editor-actions' }, h('button', { class: 'btn sm', type: 'button', onclick: onClose }, 'Cancel'), apply));
    })();
    return wrap;
  };

  const fileRow = (it, { movable = true } = {}) => {
    const { problem } = importReadiness(it);
    const rej = (it.rejections || []).map(rejectionText).filter(Boolean);
    const warn = (it.warnings || []).filter(Boolean);
    const cb = h('input', { type: 'checkbox', 'aria-label': `Import ${fileName(it)}` });
    cb.checked = selected.has(it.id);
    cb.disabled = !!problem;
    cb.addEventListener('change', () => { if (cb.checked) selected.add(it.id); else selected.delete(it.id); paint(); });
    const slot = h('div', {});
    const move = movable ? h('button', { class: 'btn sm', type: 'button', title: 'Move this file to another author or book' }, 'Move…') : null;
    if (move) move.onclick = () => { if (slot.firstChild) clear(slot); else mount(slot, editor([it], () => clear(slot))); };
    const q = it.quality && it.quality.quality && it.quality.quality.name;
    return h('div', { class: 'import-file' },
      cb,
      h('div', { class: 'import-file-main' },
        h('div', { class: 'import-file-name' }, fileName(it)),
        h('div', { class: 'meta-line' },
          q ? h('span', { class: 'pill info' }, q) : h('span', { class: 'pill warn' }, 'No quality'),
          it.size ? h('span', {}, fmtBytes(it.size)) : null,
          it.releaseGroup ? h('span', { class: 'dim' }, it.releaseGroup) : null,
          problem ? h('span', { class: 'import-problem' }, problem) : null),
        rej.length ? h('div', { class: 'import-rejections' }, h('span', { class: 'pill warn' }, 'Rejected'), ` ${rej.join(' · ')}`) : null,
        warn.length ? h('div', { class: 'dim import-warnings' }, warn.join(' · ')) : null,
        slot),
      move);
  };

  const groupBlock = (g) => {
    const ids = g.items.map((it) => it.id);
    const ready = g.items.filter((it) => !importReadiness(it).problem);
    const chosen = ids.filter((id) => selected.has(id)).length;
    const size = g.items.reduce((n, it) => n + (Number(it.size) || 0), 0);
    const cb = h('input', { type: 'checkbox', 'aria-label': 'Choose these files', disabled: ready.length ? null : 'disabled' });
    cb.checked = chosen > 0 && chosen === ready.length;
    cb.indeterminate = chosen > 0 && chosen < ready.length;
    cb.addEventListener('change', () => { for (const it of ready) { if (cb.checked) selected.add(it.id); else selected.delete(it.id); } paint(); });
    const reasons = new Map();
    if (g.items.length > 1) for (const it of g.items) for (const r of (it.rejections || []).map(rejectionText).filter(Boolean)) reasons.set(r, (reasons.get(r) || 0) + 1);
    const slot = h('div', {});
    const change = h('button', { class: 'btn sm', type: 'button', title: 'Move these files to another author or book' }, g.book ? 'Change book…' : 'Choose book…');
    change.onclick = () => { if (slot.firstChild) clear(slot); else mount(slot, editor(g.items, () => clear(slot))); };
    const author = g.author ? g.author.authorName : g.suggestedAuthor;
    const title = g.book ? g.book.title : g.suggestedBook || 'Not matched to a book';
    const showAll = open.has(g.key) || g.items.length <= 6;
    const shown = showAll ? g.items : g.items.slice(0, 4);
    const fmt = itemFormat(g.items[0]);
    return h('div', { class: 'import-group' },
      h('div', { class: 'import-group-head' },
        cb,
        g.book ? smallCover(g.book) : h('div', { class: 'import-cover import-cover-none', 'aria-hidden': 'true' }, g.suggestedBook ? '✨' : '?'),
        h('div', { class: 'import-group-main' },
          h('div', { class: 'row-title' }, title),
          h('div', { class: 'meta-line' },
            author ? h('span', {}, author) : null,
            !g.book && g.suggestedBook ? h('span', { class: 'pill info', title: `${app} would add this from its metadata source` }, 'New from metadata') : null,
            g.book && g.book.seriesTitle ? h('span', { class: 'dim' }, g.book.seriesTitle) : null,
            g.book && bookSource(g.book) ? h('span', { class: 'dim' }, bookSource(g.book)) : null,
            fmt && FORMATS[fmt] ? h('span', { class: 'pill muted' }, `${FORMATS[fmt].icon} ${FORMATS[fmt].one}`) : null,
            h('span', {}, `${plural(g.items.length, 'file')} · ${fmtBytes(size)}`)),
          !g.book && g.suggestedBook ? h('div', { class: 'dim import-rejections' },
            `${app} matched ${g.items.length === 1 ? 'this file' : 'these files'} to “${g.suggestedBook}” from its metadata source, not to a book in the library. Tick ${g.items.length === 1 ? 'it' : 'them'} to import that way (${app} adds the book if it’s missing), or use Choose book… to pick a book you have.`) : null,
          [...reasons].slice(0, 3).map(([r, n]) => h('div', { class: 'import-rejections' }, h('span', { class: 'pill warn' }, n > 1 ? `${n} rejected` : 'Rejected'), ` ${r}`))),
        change),
      slot,
      h('div', { class: 'import-files' }, ...shown.map((it) => fileRow(it, { movable: g.items.length > 1 })),
        showAll ? null : h('button', { class: 'btn sm import-more', type: 'button', onclick: () => { open.add(g.key); paint(); } }, `Show all ${g.items.length} files`)));
  };

  importBtn.onclick = async () => {
    const chosen = items.filter((it) => selected.has(it.id));
    let command;
    try { command = buildBookImportCommand(chosen, { downloadId: opts.downloadId, all: items }); } catch (e) { toast(e.message, 'error'); return; }
    importBtn.disabled = true; importBtn.textContent = 'Importing…';
    try {
      const cmd = await arr.post('command', command);
      toast(`Importing ${plural(chosen.length, 'file')}`, 'success');
      closeModal();
      watchCommand(arr, cmd, { done: `Imported ${plural(chosen.length, 'file')}`, failed: 'The import failed', onEnd: opts.onImported });
    } catch (e) { toast(e.message, 'error', 7000); refreshFooter(); }
  };
  selectAll.addEventListener('change', () => {
    selected.clear();
    if (selectAll.checked) for (const it of items) if (!importReadiness(it).problem) selected.add(it.id);
    paint();
  });

  (async () => {
    let res;
    try { res = await arr.get(bookImportQuery(opts)); } catch (e) { mount(body, empty('⚠️', 'Couldn’t list the files', e.message)); return; }
    items = (Array.isArray(res) ? res : []).map((it, i) => ({ ...it, id: it.id != null ? it.id : `f${i}` }));
    const messages = (opts.messages || []).slice(0, 4);
    const why = messages.length || opts.hint ? h('div', { class: 'import-why' },
      h('span', { class: 'pill warn' }, 'Why it’s waiting'),
      ...messages.map((m) => h('div', { class: 'import-why-line' }, m)),
      opts.hint ? h('div', { class: 'import-why-hint' }, opts.hint) : null) : null;
    if (!items.length) {
      mount(body, why, empty('📁', 'No files to import', `${app} found no book files ${opts.downloadId ? 'for this download' : 'in this folder'}. If the download’s folder isn’t reachable from ${app}, fix the remote path mapping or the container’s volumes first.`));
      return;
    }
    for (const id of defaultBookSelection(items)) selected.add(id);
    mount(body, why,
      h('div', { class: 'import-bar' }, h('label', { class: 'import-select-all' }, selectAll, statusEl), importBtn),
      listEl,
      h('p', { class: 'dim import-foot' }, opts.downloadId
        ? `${app} imports the chosen files the way it imports downloads. Files already in the library aren’t replaced.`
        : `${app} files the chosen files into the book’s folder. Files already in the library aren’t replaced.`));
    paint();
  })();
}

// ---- Unmapped files ----------------------------------------------------------

// Files in the root folders the app couldn't link to a book: import a
// folder by hand, retry the match, or delete them.
export async function openUnmappedFiles(arr, ctx, { onChanged } = {}) {
  const label = ctx.service.label;
  const body = h('div', { class: 'unmapped' }, h('div', { style: { padding: '20px' } }, spinner()));
  openModal({ title: `Unmapped files · ${label}`, body, wide: true });
  const reopen = () => { if (onChanged) onChanged(); openUnmappedFiles(arr, ctx, { onChanged }); };
  let files;
  try { files = await arr.get('bookfile?unmapped=true'); } catch (e) { mount(body, empty('⚠️', 'Couldn’t list unmapped files', e.message)); return; }
  files = Array.isArray(files) ? files : [];
  const units = unmappedUnits(files);
  if (!units.length) { mount(body, empty('✅', 'No unmapped files', `${label} has linked every file in its root folders to a book.`)); return; }
  // Chaptarr groups unmapped files into import units and can retry the match;
  // legacy Readarr can only import a folder.
  const chaptarr = files.some((f) => f && 'importUnitKey' in f);

  const formats = [...new Set(units.map((u) => u.mediaType).filter(Boolean))];
  let format = formats.length > 1 ? '' : formats[0] || '';
  const listEl = h('div', { class: 'list' });
  const countEl = h('span', { class: 'dim' });

  const retry = chaptarr ? h('button', { class: 'btn sm primary', type: 'button', 'data-needs': 'write', title: `Ask ${label} to match these files to books again` }, 'Retry matching') : null;
  if (retry) retry.onclick = () => {
    const shown = units.filter((u) => !format || u.mediaType === format);
    const go = async () => {
      retry.disabled = true;
      try {
        const cmd = await arr.post('command', { name: 'RetryUnmappedMatch', ...(format ? { mediaType: format } : {}), unmappedFiles: { scope: 'all' } });
        toast(`${label} is matching ${plural(shown.length, 'folder')} again`, 'success');
        watchCommand(arr, cmd, { done: 'Matching finished', failed: 'Matching failed', onEnd: reopen });
      } catch (e) { toast(e.message, 'error'); retry.disabled = false; }
    };
    if (shown.length > 5) {
      confirmModal({ title: 'Match all unmapped files again?', message: `${label} reads the tags of ${plural(shown.reduce((n, u) => n + u.count, 0), 'file')} in ${plural(shown.length, 'folder')} and looks each book up again. This can take a while.`, confirmLabel: 'Retry matching', onConfirm: go });
    } else go();
  };

  const remove = async (u) => {
    let recycle = null;
    try { const mm = await arr.get('config/mediamanagement'); recycle = (mm && mm.recycleBin) || ''; } catch { recycle = null; }
    const where = recycle ? `They go to ${label}’s Recycle Bin (${recycle}).` : recycle === '' ? `${label} has no Recycle Bin set, so they’re deleted for good.` : `${label}’s Recycle Bin setting applies.`;
    confirmModal({
      title: 'Delete unmapped files', danger: true, confirmLabel: `Delete ${plural(u.count, 'file')}`,
      message: `Delete ${plural(u.count, 'file')} (${fmtBytes(u.size)}) in “${u.name}” from disk? ${where}`,
      onConfirm: async () => {
        try { await arr.del('bookfile/bulk', { bookFileIds: u.ids }); toast(`Deleted ${plural(u.count, 'file')}`, 'success'); reopen(); }
        catch (e) { if (!e.cancelled) toast(e.message, 'error', 7000); }
      },
    });
  };

  const unitRow = (u) => h('div', { class: 'row unmapped-row' },
    h('div', { class: 'row-main' },
      h('div', { class: 'row-title' }, u.name),
      h('div', { class: 'mono book-file-path dim' }, u.root),
      h('div', { class: 'meta-line', style: { marginTop: '4px' } },
        u.mediaType && FORMATS[u.mediaType] ? h('span', { class: 'pill muted' }, `${FORMATS[u.mediaType].icon} ${FORMATS[u.mediaType].one}`) : null,
        h('span', {}, plural(u.count, 'file')),
        h('span', {}, fmtBytes(u.size)),
        u.added ? h('span', { class: 'dim' }, `Found ${fmtRelative(u.added)}`) : null)),
    h('div', { class: 'row-actions' },
      roleAllows('delete') ? h('button', {
        class: 'btn sm primary', type: 'button', title: 'Choose the author and book, then import',
        onclick: () => openBookImport(arr, { folder: u.root, bookFileIds: u.ids, mediaType: u.mediaType || undefined, title: u.name, label, onImported: reopen }),
      }, 'Import…') : null,
      roleAllows('delete') ? h('button', { class: 'btn sm danger', type: 'button', onclick: () => remove(u) }, 'Delete…') : null));

  const paint = () => {
    const shown = units.filter((u) => !format || u.mediaType === format);
    mount(countEl, `${plural(shown.reduce((n, u) => n + u.count, 0), 'file')} in ${plural(shown.length, 'folder')}`);
    mount(listEl, ...shown.map(unitRow));
  };
  const seg = (f, text) => h('button', { class: `view-seg ${format === f ? 'active' : ''}`, type: 'button', onclick: (e) => { format = f; for (const b of e.currentTarget.parentElement.children) b.classList.toggle('active', b === e.currentTarget); paint(); } }, text);
  mount(body,
    h('p', { class: 'dim unmapped-intro' }, `${label} found these files in its root folders but couldn’t tell which book they belong to. Import a folder to choose the book, or retry matching after fixing the files’ tags or names.`),
    h('div', { class: 'lib-head', style: { justifyContent: 'space-between' } },
      formats.length > 1 ? h('div', { class: 'view-toggle', role: 'group', 'aria-label': 'Format' }, seg('', 'All'), ...formats.map((f) => seg(f, `${FORMATS[f] ? FORMATS[f].icon : ''} ${FORMATS[f] ? FORMATS[f].label : f}`))) : null,
      countEl, retry),
    listEl);
  paint();
}

// ---- Ignored downloads (Chaptarr) ---------------------------------------------

// Downloads removed from the queue but left in the download client: the app
// stopped tracking them. Stop ignoring makes it track them again, so those
// still in the client come back to the queue (where Fix import can take them).
export async function openIgnoredDownloads(arr, { label = 'The app', onChanged } = {}) {
  const body = h('div', { class: 'ignored' }, h('div', { style: { padding: '20px' } }, spinner()));
  openModal({ title: `Ignored downloads · ${label}`, body, wide: true });
  let data;
  try { data = await arr.get('ignored?page=1&pageSize=250&sortKey=date&sortDirection=descending'); }
  catch (e) { mount(body, empty('⚠️', 'Couldn’t list ignored downloads', e.message)); return; }
  const list = Array.isArray(data) ? data : (data && Array.isArray(data.records) ? data.records : []);
  const total = Number(data && data.totalRecords) || list.length;
  if (!list.length) { mount(body, empty('✅', 'Nothing ignored', `${label} is tracking every download it found.`)); return; }
  const stop = async (ids, btn) => {
    if (btn) btn.disabled = true;
    try {
      if (ids.length === 1) await arr.del(`ignored/${ids[0]}`); else await arr.del('ignored/bulk', { ids });
      toast(`${label} is tracking ${plural(ids.length, 'download')} again`, 'success');
      if (onChanged) onChanged();
      openIgnoredDownloads(arr, { label, onChanged });
    } catch (e) { if (!e.cancelled) toast(e.message, 'error', 7000); if (btn) btn.disabled = false; }
  };
  const inClient = list.filter((r) => r.isInClient);
  const row = (r) => h('div', { class: 'row' },
    h('div', { class: 'row-main' },
      h('div', { class: 'row-title', style: { fontSize: '14px', overflowWrap: 'anywhere' } }, r.sourceTitle || r.downloadId || `#${r.id}`),
      h('div', { class: 'meta-line', style: { marginTop: '4px' } },
        r.isInClient ? h('span', { class: 'pill info' }, 'Still in the download client') : h('span', { class: 'pill muted', title: 'Stop ignoring only clears the entry' }, 'Gone from the download client'),
        r.downloadClientName || r.downloadClient ? h('span', {}, r.downloadClientName || r.downloadClient) : null,
        r.date ? h('span', { class: 'dim' }, `Ignored ${fmtRelative(r.date)}`) : null)),
    h('div', { class: 'row-actions' },
      h('button', { class: 'btn sm', type: 'button', 'data-needs': 'delete', title: `Track this download again${r.isInClient ? ' and put it back in the queue' : ''}`, onclick: (e) => stop([r.id], e.currentTarget) }, 'Stop ignoring')));
  mount(body,
    h('p', { class: 'dim', style: { marginTop: 0 } }, `These downloads were removed from ${label}’s queue but left in the download client, so ${label} stopped tracking them. Stop ignoring puts the ones still in the download client back in the queue.`),
    h('div', { class: 'lib-head', style: { justifyContent: 'space-between' } },
      h('span', { class: 'dim' }, total > list.length ? `${list.length} of ${total}` : plural(list.length, 'download')),
      inClient.length > 1 ? h('button', { class: 'btn sm primary', type: 'button', 'data-needs': 'delete', onclick: (e) => stop(inClient.map((r) => r.id), e.currentTarget) }, `Stop ignoring the ${inClient.length} in the client`) : null),
    h('div', { class: 'list' }, ...list.map(row)));
}
