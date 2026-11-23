// Author tools for book managers (Chaptarr, legacy Readarr): preview and
// run Rename and Retag the way Chaptarr's author page does, and find books
// listed twice. Pure logic is lib/bookImport.js.
import { h, mount, toast, spinner, empty, openModal, closeModal, confirmModal } from './ui.js';
import { invalidate } from './cache.js';
import { FORMATS } from './readarrLibrary.js';
import { retagSummary, duplicateBooks, bookSource, mediaTypeOfPath } from './bookImport.js';
import { watchCommand } from './bookImportUI.js';

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const tail = (p, n = 2) => String(p || '').split('/').slice(-n).join('/');
const year = (b) => { const t = Date.parse(b && b.releaseDate); return Number.isFinite(t) ? new Date(t).getUTCFullYear() : ''; };

// The common folder of a list of paths, so rows can show only what differs.
function commonDir(paths) {
  const split = paths.filter(Boolean).map((p) => String(p).split('/'));
  if (!split.length) return '';
  const first = split[0];
  let i = 0;
  while (i < first.length - 1 && split.every((s) => s[i] === first[i])) i++;
  return first.slice(0, i).join('/');
}
const after = (p, dir) => (dir && String(p).startsWith(`${dir}/`) ? String(p).slice(dir.length + 1) : String(p || ''));

// ---- Rename ------------------------------------------------------------------

export function openBookRename(arr, { author, mediaType = '', label = 'The app', onDone } = {}) {
  const body = h('div', {}, h('div', { style: { padding: '20px' } }, spinner()));
  openModal({ title: `Rename files · ${author.authorName}`, body, wide: true });
  (async () => {
    let items;
    try { items = await arr.get(`rename?authorId=${author.id}${mediaType ? `&mediaType=${encodeURIComponent(mediaType)}` : ''}`); }
    catch (e) { mount(body, empty('⚠️', 'Couldn’t load the rename preview', e.message)); return; }
    items = (Array.isArray(items) ? items : []).filter((it) => it.existingPath !== it.newPath || it.canOrganize === false);
    if (!items.length) { mount(body, empty('✅', 'Nothing to rename', `Every file already follows ${label}’s naming.`)); return; }
    const ok = items.filter((it) => it.canOrganize !== false);
    const blocked = items.filter((it) => it.canOrganize === false);
    const dir = commonDir(items.flatMap((it) => [it.existingPath, it.newPath]));
    const ids = ok.map((it) => it.bookFileId ?? it.id).filter((x) => x != null);
    const apply = h('button', { class: 'btn primary', type: 'button', 'data-needs': 'write', disabled: ids.length ? null : 'disabled' }, `Rename ${plural(ids.length, 'file')}`);
    apply.onclick = async () => {
      apply.disabled = true; apply.textContent = 'Renaming…';
      try {
        const cmd = await arr.post('command', { name: 'RenameFiles', authorId: author.id, files: ids });
        toast(`Renaming ${plural(ids.length, 'file')}`, 'success');
        closeModal();
        watchCommand(arr, cmd, { done: `Renamed ${plural(ids.length, 'file')}`, failed: 'Renaming failed', onEnd: onDone });
      } catch (e) { toast(e.message, 'error'); apply.disabled = false; apply.textContent = `Rename ${plural(ids.length, 'file')}`; }
    };
    const row = (it) => h('div', { class: 'row' }, h('div', { class: 'row-main' },
      h('div', { class: 'dim rename-old' }, after(it.existingPath, dir)),
      h('div', { class: 'rename-new' }, `→ ${after(it.newPath, dir)}`),
      it.canOrganize === false && it.reason ? h('div', { class: 'import-problem' }, it.reason) : null));
    mount(body,
      h('div', { class: 'import-bar' }, h('span', { class: 'dim' }, `${plural(ok.length, 'file')} would be renamed${dir ? ` in ${dir}` : ''}.`), apply),
      h('div', { class: 'list' }, ...ok.slice(0, 300).map(row)),
      ok.length > 300 ? h('p', { class: 'dim' }, `…and ${ok.length - 300} more.`) : null,
      blocked.length ? h('div', { class: 'section-title' }, `${label} can’t move ${plural(blocked.length, 'file')}`) : null,
      blocked.length ? h('div', { class: 'list' }, ...blocked.slice(0, 50).map(row)) : null);
  })();
}

// ---- Retag ---------------------------------------------------------------------

// Chaptarr writes the tags shown here into the files (title, author, narrator
// and the rest). Books whose chapter titles would all become the book's title
// start unticked, with a warning. files: the author's book files, to name
// each book.
export function openBookRetag(arr, { author, books = [], files = [], mediaType = '', label = 'The app', onDone } = {}) {
  const body = h('div', {}, h('div', { style: { padding: '20px' } }, spinner()));
  openModal({ title: `Write tags · ${author.authorName}`, body, wide: true });
  (async () => {
    let previews; let settings = null;
    try {
      [previews, settings] = await Promise.all([
        arr.get(`retag?authorId=${author.id}${mediaType ? `&mediaType=${encodeURIComponent(mediaType)}` : ''}`),
        arr.get('config/metadataprovider').catch(() => null),
      ]);
    } catch (e) { mount(body, empty('⚠️', 'Couldn’t load the tag preview', e.message)); return; }
    const groups = retagSummary(Array.isArray(previews) ? previews : [], books, files);
    if (!groups.length) { mount(body, empty('✅', 'Tags are up to date', `The files’ tags already match ${label}’s metadata.`)); return; }
    const chosen = new Set(groups.filter((g) => !g.titlesCollapse).map((g) => g.key));
    const ebooks = groups.some((g) => g.files.some((f) => mediaTypeOfPath(f.path) === 'ebook'));
    const covers = h('input', { type: 'checkbox', role: 'switch' });
    const embed = h('input', { type: 'checkbox', role: 'switch' });
    const apply = h('button', { class: 'btn primary', type: 'button', 'data-needs': 'write' });
    const count = () => groups.filter((g) => chosen.has(g.key)).reduce((n, g) => n + g.ids.length, 0);
    const refresh = () => { const n = count(); apply.textContent = n ? `Write tags to ${plural(n, 'file')}` : 'Write tags'; apply.disabled = !n; };

    const fieldLine = (f, files) => {
      const ex = f.example || {};
      const many = f.distinctOld > 1;
      return h('div', { class: 'retag-field' },
        h('span', { class: 'retag-field-name' }, f.label),
        h('span', { class: 'retag-change' },
          ex.oldValue ? h('span', { class: 'retag-old' }, ex.oldValue) : h('span', { class: 'dim' }, '(empty)'),
          ' → ',
          ex.newValue ? h('span', { class: 'retag-new' }, ex.newValue) : h('span', { class: 'dim' }, '(empty)')),
        h('span', { class: 'dim' }, many ? `${f.count} of ${files} files, ${f.distinctOld} different values now` : f.count === files ? (files > 1 ? `all ${files} files` : '') : `${f.count} of ${files} files`));
    };
    const groupBlock = (g) => {
      const cb = h('input', { type: 'checkbox', 'aria-label': `Write tags for ${g.title || 'this book'}` });
      cb.checked = chosen.has(g.key);
      cb.addEventListener('change', () => { if (cb.checked) chosen.add(g.key); else chosen.delete(g.key); refresh(); });
      const details = h('details', { class: 'retag-files' }, h('summary', {}, `Every change, file by file (${g.files.length})`),
        ...g.files.slice(0, 200).map((f) => h('div', { class: 'retag-file' },
          h('div', { class: 'mono retag-path' }, tail(f.path)),
          ...(f.changes || []).map((c) => h('div', { class: 'retag-file-change' }, h('b', {}, c.field), ` ${c.oldValue || '(empty)'} → ${c.newValue || '(empty)'}`)))));
      return h('div', { class: 'import-group' },
        h('label', { class: 'import-group-head' }, cb,
          h('div', { class: 'import-group-main' },
            h('div', { class: 'row-title' }, g.title || 'Book'),
            h('div', { class: 'dim' }, plural(g.files.length, 'file')))),
        g.titlesCollapse ? h('div', { class: 'retag-warning' }, `Each file has its own title now (chapter names). Writing tags gives every file the same title, so players show “${(g.fields.find((f) => f.field.toUpperCase() === 'TITLE').example || {}).newValue || 'the book title'}” for every chapter.`) : null,
        h('div', { class: 'retag-fields' }, ...g.fields.map((f) => fieldLine(f, g.files.length))),
        details);
    };
    apply.onclick = async () => {
      const ids = groups.filter((g) => chosen.has(g.key)).flatMap((g) => g.ids);
      if (!ids.length) return;
      apply.disabled = true; apply.textContent = 'Writing…';
      try {
        const cmd = await arr.post('command', { name: 'RetagFiles', authorId: author.id, files: ids, updateCovers: covers.checked, embedMetadata: embed.checked });
        toast(`Writing tags to ${plural(ids.length, 'file')}`, 'success');
        closeModal();
        watchCommand(arr, cmd, { done: `Wrote tags to ${plural(ids.length, 'file')}`, failed: 'Writing tags failed', onEnd: onDone });
      } catch (e) { toast(e.message, 'error'); refresh(); }
    };
    refresh();
    mount(body,
      h('p', { class: 'dim', style: { marginTop: 0 } }, `${label} writes these tags into the files. Nothing is renamed or moved. Untick a book to leave its files alone.`),
      settings && settings.scrubAudioTags ? h('div', { class: 'retag-warning' }, `“Scrub existing tags” is on in ${label}, so every other tag in these audio files is removed first.`) : null,
      ebooks ? h('div', { class: 'retag-options' },
        h('label', { class: 'queue-remove-opt' }, covers, h('span', {}, h('strong', {}, 'Update covers'), h('span', { class: 'dim' }, 'Calibre libraries: set the book covers to the ones in the app'))),
        h('label', { class: 'queue-remove-opt' }, embed, h('span', {}, h('strong', {}, 'Embed metadata'), h('span', { class: 'dim' }, 'Calibre libraries: write the metadata into the book files')))) : null,
      h('div', { class: 'import-bar' }, h('span', { class: 'dim' }, `${plural(groups.reduce((n, g) => n + g.files.length, 0), 'file')} in ${plural(groups.length, 'book')} would change.`), apply),
      h('div', { class: 'import-groups' }, ...groups.map(groupBlock)));
  })();
}

// ---- Books listed twice ----------------------------------------------------------

// The same book listed more than once (metadata from several sources). Each
// monitored copy is searched for and downloaded on its own, so the fix is to
// stop monitoring the copies without files. Nothing on disk changes.
//   books: the books to check (one author, or the whole library)
//   authors: optional, to name the author of each group
export function openDuplicateBooks(arr, ctx, { books = [], authors = [], title = 'Books listed twice', onChanged } = {}) {
  const label = ctx.service.label;
  const byAuthor = new Map();
  for (const b of books) { if (!byAuthor.has(b.authorId)) byAuthor.set(b.authorId, []); byAuthor.get(b.authorId).push(b); }
  const names = new Map((authors || []).map((a) => [a.id, a.authorName]));
  const groups = [...byAuthor].flatMap(([authorId, list]) => duplicateBooks(list).map((g) => ({ ...g, authorId })));
  const actionable = groups.filter((g) => g.redundant.length);
  const body = h('div', { class: 'dupe-books' });
  openModal({ title, body, wide: true });
  if (!groups.length) { mount(body, empty('✅', 'No book is listed twice', `Each book is in ${label} once per format.`)); return; }
  const redundant = actionable.flatMap((g) => g.redundant);
  const fix = h('button', { class: 'btn primary', type: 'button', 'data-needs': 'write', disabled: redundant.length ? null : 'disabled' },
    redundant.length ? `Stop monitoring ${plural(redundant.length, 'copy', 'copies')}` : 'Nothing to change');
  fix.onclick = () => confirmModal({
    title: 'Stop monitoring the extra copies?',
    message: `${label} stops searching for ${plural(redundant.length, 'copy', 'copies')} that have no files while another copy is kept. Nothing on disk changes, and you can monitor them again from the author’s page.`,
    confirmLabel: `Stop monitoring ${redundant.length}`,
    onConfirm: async () => {
      try {
        await arr.put('book/monitor', { bookIds: redundant.map((b) => b.id), monitored: false });
        for (const b of redundant) { b.monitored = false; if (b.mediaType) b[`${b.mediaType}Monitored`] = false; }
        invalidate(`arr:${ctx.service.key}:author`);
        toast(`Stopped monitoring ${plural(redundant.length, 'copy', 'copies')}`, 'success');
        if (onChanged) onChanged();
      } catch (e) { toast(e.message, 'error', 6000); }
    },
  });
  const copy = (b, g) => {
    const files = Number(b.statistics && b.statistics.bookFileCount) || 0;
    const role = b === g.keep ? h('span', { class: 'pill ok' }, files ? 'Keep: has files' : 'Keep') : g.redundant.includes(b) ? h('span', { class: 'pill warn' }, 'Stop monitoring') : h('span', { class: 'pill muted' }, b.monitored ? 'Monitored' : 'Not monitored');
    return h('div', { class: 'dupe-copy' },
      role,
      h('span', {}, b.title),
      year(b) ? h('span', { class: 'dim' }, String(year(b))) : null,
      b.seriesTitle ? h('span', { class: 'dim' }, b.seriesTitle) : null,
      bookSource(b) ? h('span', { class: 'pill muted' }, bookSource(b)) : null,
      files ? h('span', { class: 'dim' }, plural(files, 'file')) : null);
  };
  const block = (g) => h('div', { class: 'import-group' },
    h('div', { class: 'row-title' }, g.title,
      g.mediaType && FORMATS[g.mediaType] ? h('span', { class: 'pill muted', style: { marginLeft: '8px' } }, `${FORMATS[g.mediaType].icon} ${FORMATS[g.mediaType].one}`) : null),
    names.get(g.authorId) ? h('div', { class: 'dim' }, names.get(g.authorId)) : null,
    h('div', { class: 'dupe-copies' }, ...g.books.map((b) => copy(b, g))));
  const others = groups.filter((g) => !g.redundant.length);
  mount(body,
    h('p', { class: 'dim', style: { marginTop: 0 } }, actionable.length
      ? `${plural(actionable.length, 'book')} ${actionable.length === 1 ? 'is' : 'are'} listed more than once with more than one copy monitored, so ${label} searches for each copy and can download the book twice.`
      : `Some books are listed more than once, but only one copy of each is monitored.`),
    h('div', { class: 'import-bar' }, h('span', { class: 'dim' }, `${plural(groups.length, 'book')} listed twice or more`), fix),
    h('div', { class: 'import-groups' }, ...actionable.map(block)),
    others.length ? h('details', { class: 'dupe-others' }, h('summary', {}, `${plural(others.length, 'other book')} listed twice, with nothing to change`), h('div', { class: 'import-groups' }, ...others.map(block))) : null);
}
