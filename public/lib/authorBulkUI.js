// Select many authors of a book manager (Chaptarr, legacy Readarr) and act on
// them at once, like the Select mode of the Sonarr and Radarr libraries:
// monitor, search, refresh, edit (monitoring, quality and metadata profile,
// root folder; Chaptarr per format), tags and remove. Pure logic is
// lib/authorBulk.js; views/bulk.js is the Sonarr/Radarr counterpart.
import { h, mount, toast, openModal, closeModal, confirmModal, fmtBytes, pct, rootFolderLabel } from './ui.js';
import { invalidate, cachedGet } from './cache.js';
import { compactTable } from './tableView.js';
import { actionGroup } from './actions.js';
import { runBatch, summarizeBatch, batchSummaryText } from './batch.js';
import { restoreSelection, persistSelection, clearSelection } from './workflowState.js';
import { FORMATS, NEW_ITEM_OPTIONS, authorFormats, authorStats, profilesFor, folderFormats } from './readarrLibrary.js';
import { bulkFormats, anyFormatAware, bulkMissingCount, searchTargets, authorEditorBody, authorEditorDeleteBody, hasEditorChanges } from './authorBulk.js';
import { watchCommand } from './bookImportUI.js';

const RENDER_CAP = 500;
const SEARCH_CONCURRENCY = 4;
const SEARCH_CONFIRM_OVER = 10;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const names = (list, n = 4) => list.slice(0, n).map((a) => a.authorName).join(', ') + (list.length > n ? ` and ${list.length - n} more` : '');

//   opts: { authors, filtered, arr, ctx, onExit, thumb(author), mode,
//           columns, sortKey, direction, describeDelete(ids) -> Promise<text> }
export function bulkAuthors(root, opts) {
  const {
    authors, filtered = authors, arr, ctx, onExit, thumb, describeDelete,
    mode = 'list', columns = [], sortKey = 'name', direction = 'asc',
  } = opts;
  const label = ctx.service.label;
  const cacheKey = `arr:${ctx.service.key}:author`;
  const persistScope = `${ctx.service.key}:authors`;
  const tableMode = mode === 'table' && columns.length > 0;
  let tableSort = sortKey;
  let tableDir = direction;

  const scopes = {
    filtered: { label: 'Filtered', items: filtered },
    library: { label: 'Library', items: authors },
  };
  let scope = filtered.length !== authors.length ? 'filtered' : 'library';
  const scopeItems = () => scopes[scope].items;
  const byId = new Map(authors.map((a) => [a.id, a]));
  const selected = new Set([...restoreSelection(persistScope, authors).keys()]);
  const chosen = () => [...selected].map((id) => byId.get(id)).filter(Boolean);
  const formatAware = anyFormatAware(authors);

  const selectAll = h('input', { type: 'checkbox', 'aria-label': 'Select every author shown' });
  const countEl = h('span', { class: 'dim' });
  const listEl = h('div', { class: tableMode ? 'bulk-table-view' : 'list' });
  const actionEls = [];

  const refresh = () => {
    const shown = scopeItems();
    const inScope = shown.filter((a) => selected.has(a.id)).length;
    countEl.textContent = `${selected.size} selected`;
    selectAll.checked = shown.length > 0 && inScope === shown.length;
    selectAll.indeterminate = inScope > 0 && inScope < shown.length;
    for (const btn of actionEls) btn.disabled = selected.size === 0;
    persistSelection(persistScope, selected);
  };
  const toggle = (a, on = !selected.has(a.id)) => { if (on) selected.add(a.id); else selected.delete(a.id); refresh(); };
  const exit = () => { persistSelection(persistScope, selected); onExit(); };
  const changed = (message) => { invalidate(cacheKey); toast(message, 'success'); exit(); };

  const rowFor = (a) => {
    const cb = h('input', { type: 'checkbox', 'aria-label': `Select ${a.authorName || 'author'}` });
    cb.checked = selected.has(a.id);
    cb.addEventListener('change', () => toggle(a, cb.checked));
    const st = authorStats(a);
    return h('label', { class: 'row bulk-row author-row' },
      h('span', { class: 'bulk-check' }, cb),
      thumb(a),
      h('div', { class: 'row-main' },
        h('div', { class: 'row-title' }, a.authorName || 'Unknown author'),
        h('div', { class: 'meta-line', style: { marginTop: '4px' } },
          ...authorFormats(a).map((f) => h('span', { class: 'pill muted' }, `${FORMATS[f].icon} ${FORMATS[f].label}`)),
          a.monitored ? h('span', { class: 'pill info' }, 'Monitored') : h('span', { class: 'pill muted' }, 'Unmonitored'),
          h('span', {}, plural(st.files, 'file')),
          st.size ? h('span', {}, fmtBytes(st.size)) : null,
          st.monitored ? h('span', { class: 'dim' }, `${st.have}/${st.monitored} monitored on disk`) : null),
        st.percent !== null ? h('div', { class: 'progress' }, h('span', { style: { width: pct(st.percent) } })) : null));
  };
  const renderRows = () => {
    const shown = scopeItems().slice(0, RENDER_CAP);
    if (tableMode) {
      return mount(listEl, compactTable(shown, {
        columns, sortKey: tableSort, direction: tableDir, selected, selectionLabel: 'Select', windowed: true,
        onSort: (k, dir) => { tableSort = k; tableDir = dir; renderRows(); },
        onToggle: (a) => toggle(a), onOpen: (a) => { toggle(a); renderRows(); },
      }));
    }
    mount(listEl, ...shown.map(rowFor),
      scopeItems().length > RENDER_CAP ? h('p', { class: 'dim', style: { textAlign: 'center' } }, `Showing the first ${RENDER_CAP} of ${scopeItems().length}. All selects every one of them.`) : null);
  };
  selectAll.addEventListener('change', () => {
    for (const a of scopeItems()) { if (selectAll.checked) selected.add(a.id); else selected.delete(a.id); }
    renderRows(); refresh();
  });

  // ---- Actions ----
  const put = async (change, message) => {
    const list = chosen();
    const body = authorEditorBody(list.map((a) => a.id), change, { formatAware });
    if (!hasEditorChanges(body)) { toast('Nothing to change', 'info'); return false; }
    try { await arr.put('author/editor', body); changed(message(list)); return true; }
    catch (e) { toast(e.message, 'error', 7000); return false; }
  };
  const monitor = (on) => put({ monitored: on }, (list) => `${on ? 'Monitoring' : 'Stopped monitoring'} ${plural(list.length, 'author')}`);

  const searchAll = () => {
    const picked = chosen();
    const list = searchTargets(picked);
    if (!list.length) { toast(`Nothing to search: every monitored book of ${picked.length === 1 ? 'this author' : 'these authors'} is on disk`, 'info', 4000); return; }
    const missing = bulkMissingCount(list);
    const go = () => runSearch(list);
    if (missing > SEARCH_CONFIRM_OVER) {
      confirmModal({
        title: 'Search for many books?',
        message: `This searches your indexers for ${plural(missing, 'missing book')} by ${plural(list.length, 'author')}. Indexers often limit how many searches they allow a day.`,
        confirmLabel: `Search ${plural(missing, 'book')}`,
        onConfirm: go,
      });
    } else go();
  };
  const runSearch = async (list) => {
    const total = list.length;
    const bar = h('span', { style: { width: '0%' } });
    const progressText = h('div', { class: 'dim', style: { marginTop: '6px' } }, `0 / ${total}`);
    openModal({ title: 'Search', body: h('div', {}, h('div', {}, `Searching for the missing books of ${plural(total, 'author')}…`), h('div', { class: 'progress', style: { marginTop: '8px' } }, bar), progressText) });
    const results = await runBatch(list.map((a) => a.id), (id) => arr.post('command', { name: 'AuthorSearch', authorId: id }), {
      concurrency: SEARCH_CONCURRENCY,
      onProgress: ({ done }) => { bar.style.width = pct((done / total) * 100); progressText.textContent = `${done} / ${total}`; },
    });
    const summary = summarizeBatch(results);
    if (!summary.failed) { closeModal(); toast(`Searching for the missing books of ${plural(summary.succeeded, 'author')}`, 'success'); return; }
    openModal({
      title: 'Search',
      body: h('div', {},
        h('div', { class: 'bulk-summary' }, batchSummaryText(summary, 'author')),
        h('div', { class: 'list bulk-failure-list', style: { marginTop: '10px' } }, ...summary.failures.slice(0, 100).map((f) => h('div', { class: 'row' }, h('div', { class: 'row-main' },
          h('div', { class: 'row-title' }, (byId.get(f.item) || {}).authorName || `#${f.item}`),
          h('div', { class: 'meta-line', style: { marginTop: '4px' } }, h('span', { class: 'pill down' }, f.message))))))),
      footer: h('div', { class: 'modal-actions' },
        h('button', { class: 'btn', type: 'button', onclick: closeModal }, 'Close'),
        h('button', { class: 'btn primary', type: 'button', onclick: () => runSearch(summary.failures.map((f) => byId.get(f.item)).filter(Boolean)) }, `Retry ${summary.failed}`)),
    });
  };

  const refreshAuthors = async () => {
    const list = chosen();
    try {
      const cmd = await arr.post('command', { name: 'BulkRefreshAuthor', authorIds: list.map((a) => a.id) });
      toast(`Refreshing ${plural(list.length, 'author')} and rescanning their folders`, 'success');
      watchCommand(arr, cmd, { done: 'Refresh finished', failed: 'The refresh failed', onEnd: () => invalidate(cacheKey) });
    } catch (e) { toast(e.message, 'error'); }
  };

  const openEdit = async () => {
    const list = chosen();
    const key = ctx.service.key;
    const [profiles, metas, roots] = await Promise.all([
      cachedGet(`arr:${key}:qualityprofile`, () => arr.get('qualityprofile'), 600000).catch(() => []),
      // Metadata profiles are an admin read here; others leave them as they are.
      cachedGet(`arr:${key}:metadataprofile`, () => arr.get('metadataprofile'), 600000).catch(() => null),
      cachedGet(`arr:${key}:rootfolder`, () => arr.get('rootfolder'), 600000).catch(() => []),
    ]);
    const formats = formatAware ? bulkFormats(list) : [null];
    if (!formats.length) { toast(`None of these authors has a root folder in ${label} yet`, 'info'); return; }
    const noChange = ['', 'No change'];
    const select = (options, aria) => h('select', { class: 'input', 'aria-label': aria }, ...[noChange, ...options].map(([v, text]) => h('option', { value: String(v) }, text)));
    const field = (text, control) => h('label', { class: 'pw-field' }, h('span', { class: 'pw-field-label' }, text), control);
    const sides = formats.map((f) => {
      const what = f ? `${FORMATS[f].label}: ` : '';
      const fits = (r) => !f || !folderFormats(r).length || folderFormats(r).includes(f);
      const mon = select([['true', 'Monitored'], ['false', 'Not monitored']], `${what}monitored`);
      const ni = select(NEW_ITEM_OPTIONS, `${what}monitor new books`);
      const qList = profilesFor(profiles, f);
      const qp = qList.length ? select(qList.map((p) => [p.id, p.name]), `${what}quality profile`) : null;
      const mList = Array.isArray(metas) ? profilesFor(metas, f) : [];
      const mp = mList.length ? select(mList.map((p) => [p.id, p.name]), `${what}metadata profile`) : null;
      const rList = (Array.isArray(roots) ? roots : []).filter(fits);
      const rf = rList.length ? select(rList.map((r) => [r.path, rootFolderLabel(r)]), `${what}root folder`) : null;
      const count = f ? list.filter((a) => authorFormats(a).includes(f)).length : list.length;
      return {
        f, mon, ni, qp, mp, rf,
        el: h('div', { class: f ? 'edit-format' : 'pw-form' },
          f ? h('div', { class: 'edit-format-title' }, `${FORMATS[f].icon} ${FORMATS[f].label}`, h('span', { class: 'dim', style: { fontWeight: 400 } }, ` · ${plural(count, 'author')}`)) : null,
          field('Monitored', mon), field('Monitor new books', ni),
          qp ? field('Quality profile', qp) : null, mp ? field('Metadata profile', mp) : null, rf ? field('Root folder', rf) : null),
      };
    });
    const move = h('input', { type: 'checkbox', role: 'switch' });
    const anyRoots = sides.some((s) => s.rf);
    const pick = (get) => (formatAware ? Object.fromEntries(sides.map((s) => [s.f, get(s)])) : get(sides[0]));
    const save = async (btn) => {
      btn.disabled = true;
      const change = {
        monitored: pick((s) => (s.mon.value === '' ? undefined : s.mon.value === 'true')),
        monitorNewItems: pick((s) => s.ni.value),
        qualityProfileId: pick((s) => (s.qp ? s.qp.value : '')),
        metadataProfileId: pick((s) => (s.mp ? s.mp.value : '')),
        rootFolderPath: pick((s) => (s.rf ? s.rf.value : '')),
        moveFiles: move.checked,
      };
      const ok = await put(change, (l) => `Saved ${plural(l.length, 'author')}`);
      if (ok) closeModal(); else btn.disabled = false;
    };
    openModal({
      title: `Edit ${plural(list.length, 'author')}`,
      wide: sides.length > 1,
      body: h('div', { class: 'grid', style: { gap: '14px' } },
        h('p', { class: 'dim', style: { margin: 0 } }, `${names(list)}. Only what you change is saved; everything left at No change stays as it is on each author.`),
        h('div', { class: 'bulk-edit-formats' }, ...sides.map((s) => s.el)),
        anyRoots ? h('label', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, move, 'Move the files to the new root folder') : null,
        anyRoots ? h('div', { class: 'dim', style: { fontSize: '12px' } }, `Off: ${label} only updates where it expects each author’s folder. On: ${label} moves the folders.`) : null),
      footer: h('div', { class: 'modal-actions' },
        h('button', { class: 'btn', type: 'button', onclick: closeModal }, 'Cancel'),
        h('button', { class: 'btn primary', type: 'button', onclick: (e) => save(e.currentTarget) }, 'Save')),
    });
  };

  const openTags = async () => {
    const list = chosen();
    let tags = [];
    try { tags = await arr.get('tag'); } catch { /* none */ }
    tags = Array.isArray(tags) ? tags : [];
    const sel = h('select', { class: 'input', 'aria-label': 'Tag' }, h('option', { value: '' }, tags.length ? 'Choose a tag' : 'No tags yet'), ...tags.map((t) => h('option', { value: t.id }, t.label)));
    const fresh = h('input', { class: 'input', placeholder: 'or create a new tag', 'aria-label': 'New tag' });
    const apply = async (applyTags, btn) => {
      let tagId = Number(sel.value);
      const text = fresh.value.trim();
      btn.disabled = true;
      if (text) {
        try { tagId = (await arr.post('tag', { label: text })).id; } catch (e) { toast(e.message, 'error'); btn.disabled = false; return; }
      }
      if (!tagId) { toast('Choose or type a tag', 'info'); btn.disabled = false; return; }
      const ok = await put({ tags: [tagId], applyTags }, (l) => `Tag ${applyTags === 'add' ? 'added to' : 'removed from'} ${plural(l.length, 'author')}`);
      if (ok) closeModal(); else btn.disabled = false;
    };
    openModal({
      title: `Tags · ${plural(list.length, 'author')}`,
      body: h('div', { class: 'pw-form' },
        h('label', { class: 'pw-field' }, h('span', { class: 'pw-field-label' }, 'Tag'), sel),
        h('label', { class: 'pw-field' }, h('span', { class: 'pw-field-label' }, 'New tag'), fresh)),
      footer: h('div', { class: 'modal-actions' },
        h('button', { class: 'btn', type: 'button', onclick: closeModal }, 'Cancel'),
        h('button', { class: 'btn', type: 'button', onclick: (e) => apply('remove', e.currentTarget) }, 'Remove'),
        h('button', { class: 'btn primary', type: 'button', onclick: (e) => apply('add', e.currentTarget) }, 'Add')),
    });
  };

  const openDelete = () => {
    const list = chosen();
    const deleteFiles = h('input', { type: 'checkbox', role: 'switch' });
    const go = async () => {
      try {
        await arr.del('author/editor', authorEditorDeleteBody(list.map((a) => a.id), { deleteFiles: deleteFiles.checked, formatAware }));
        for (const a of list) selected.delete(a.id);
        changed(`Removed ${plural(list.length, 'author')}`);
      } catch (e) { if (!e.cancelled) toast(e.message, 'error', 7000); }
    };
    const confirmRemove = async (btn) => {
      if (!deleteFiles.checked) { closeModal(); go(); return; }
      btn.disabled = true;
      let detail = `${label}’s Recycle Bin setting applies.`;
      if (formatAware && describeDelete) {
        try { detail = await describeDelete(list.map((a) => a.id)); }
        catch (e) { toast(`Couldn’t check which files would be deleted, so nothing was removed: ${e.message}`, 'error', 7000); btn.disabled = false; return; }
      }
      confirmModal({
        title: 'Remove authors and delete their files',
        message: `Remove ${plural(list.length, 'author')} from ${label} and delete their files? ${detail}`,
        confirmLabel: 'Remove and delete files', danger: true, onConfirm: go,
      });
    };
    openModal({
      title: `Remove ${plural(list.length, 'author')}`,
      body: h('div', { class: 'grid', style: { gap: '12px' } },
        h('p', { style: { margin: 0 } }, `${names(list, 6)} will be removed from ${label}, with their books.`),
        h('label', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, deleteFiles, 'Also delete their files'),
        h('div', { class: 'dim', style: { fontSize: '12px' } }, 'Off: the files stay on disk, and adding the author again finds them.')),
      footer: h('div', { class: 'modal-actions' },
        h('button', { class: 'btn', type: 'button', onclick: closeModal }, 'Cancel'),
        h('button', { class: 'btn danger', type: 'button', onclick: (e) => confirmRemove(e.currentTarget) }, 'Remove')),
    });
  };

  const group = actionGroup([
    { label: 'Monitor', title: 'Monitor the selected authors', onClick: () => monitor(true) },
    { label: 'Unmonitor', title: 'Stop monitoring the selected authors', onClick: () => monitor(false) },
    { label: 'Search', primary: true, title: 'Search for the missing monitored books of the selected authors', onClick: searchAll },
    { label: 'Refresh', title: 'Refresh the selected authors from the metadata source and rescan their folders', onClick: refreshAuthors },
    { label: 'Edit…', title: 'Monitoring, profiles and root folder', onClick: openEdit },
    { label: 'Tags…', title: 'Add or remove a tag', onClick: openTags },
    { label: 'Remove…', variant: 'danger', needs: 'delete', title: 'Remove the selected authors', onClick: openDelete },
  ], { sheetTitle: 'Selected authors' });
  group.querySelectorAll('button:not(.ag-more)').forEach((b) => actionEls.push(b));
  const clearBtn = h('button', { class: 'btn sm hex-btn', type: 'button', title: 'Clear the selection', onclick: () => { selected.clear(); clearSelection(persistScope); renderRows(); refresh(); } }, 'Clear');
  actionEls.push(clearBtn);
  const doneBtn = h('button', { class: 'btn sm primary hex-btn', type: 'button', onclick: exit }, 'Done');

  const scopeSel = h('select', { class: 'input sm', title: 'Which authors All selects', 'aria-label': 'Selection scope' },
    ...Object.entries(scopes).map(([k, d]) => h('option', { value: k, selected: k === scope ? 'selected' : null }, `${d.label} (${d.items.length})`)));
  scopeSel.addEventListener('change', () => { scope = scopeSel.value; renderRows(); refresh(); });

  mount(root,
    h('div', { class: 'bulk-bar' },
      h('label', { class: 'bulk-all' }, selectAll, 'All'),
      filtered.length !== authors.length ? h('label', { class: 'bulk-scope' }, h('span', { class: 'sr-only' }, 'Scope'), scopeSel) : null,
      countEl,
      h('div', { class: 'bulk-actions' }, group, clearBtn, doneBtn)),
    listEl);
  renderRows();
  refresh();
}
