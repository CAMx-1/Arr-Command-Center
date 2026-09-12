// Multi-select bulk actions for a Sonarr series / Radarr movie library.
//
// Scopes (from the call site): the bulk view can target three explicit sets so
// "select all" means something precise even on a filtered library:
//   • visible  — the rows currently rendered (the filtered set, capped)
//   • filtered — everything matching the active search/status filter
//   • library  — the entire library, ignoring the filter
// The call site passes `filteredItems` (its current filter result) and `items`
// (the full library); this view derives the three scopes from them.
//
// Long-running per-item work (Sonarr/Radarr search) runs through the bounded,
// fault-isolated batch runner (lib/batch.js) with a live progress bar, a
// per-item failure list, a "Retry failed" affordance, and a batch error
// summary — one slow/broken item can no longer abort or flood the whole run.
//
// Selection is service-scoped and persisted (lib/workflowState.js) so it is
// restored on entry and preserved for the library view on return, and the
// table/list presentation (mode, columns, sort) is carried back out on exit.
import { h, mount, toast, poster, confirmModal, openModal, closeModal, pct } from '../lib/ui.js';
import { invalidate } from '../lib/cache.js';
import { compactTable } from '../lib/tableView.js';
import { actionGroup } from '../lib/actions.js';
import { runBatch, summarizeBatch, batchSummaryText } from '../lib/batch.js';
import { restoreSelection, persistSelection, clearSelection } from '../lib/workflowState.js';

const RENDER_CAP = 500;
const SEARCH_CONCURRENCY = 4;

export function bulkLibrary(root, opts) {
  const {
    items, kind, arr, onExit, invalidateKey,
    mode = 'list', columns = [], sortKey = 'title', direction = 'asc',
    filteredItems = items, scope, initialSelectedIds,
  } = opts;
  const isSeries = kind === 'series';
  const noun = isSeries ? 'series' : 'movie';
  const tableMode = mode === 'table' && columns.length > 0;
  let tableSortKey = sortKey;
  let tableDirection = direction;
  const idOf = (it) => it.id;
  const posterUrl = (it) => { const img = (it.images || []).find((i) => i.coverType === 'poster'); return img && (img.remoteUrl || img.url); };
  const persistScope = scope || (isSeries ? 'sonarr' : 'radarr');

  // Explicit scopes derived from the call site's library + filter result.
  const filtered = filteredItems || items;
  const scopes = {
    visible: { label: 'Visible', items: filtered.slice(0, RENDER_CAP) },
    filtered: { label: 'Filtered', items: filtered },
    library: { label: 'Library', items },
  };
  // Default to the filtered scope so bulk respects the filter the user arrived
  // with; fall back to library when there is no active filter.
  let currentScope = filtered.length && filtered.length !== items.length ? 'filtered' : 'library';
  const scopeItems = () => scopes[currentScope].items;

  // Restore prior selection (comparison/bulk), intersected with the library so
  // stale ids (deleted items) are dropped. The call site's live selection
  // (`initialSelectedIds`) wins when provided; otherwise fall back to the
  // persisted service-scoped selection.
  const restoredIds = initialSelectedIds != null
    ? [...initialSelectedIds]
    : [...restoreSelection(persistScope, items).keys()];
  const validIds = new Set(items.map((it) => idOf(it)));
  const selected = new Set(restoredIds.filter((id) => validIds.has(id)));
  // Keep an id->item map so actions can reference full items regardless of scope.
  const itemById = new Map(items.map((it) => [idOf(it), it]));

  const persist = () => persistSelection(persistScope, selected);

  const selectAll = h('input', { type: 'checkbox', 'aria-label': `Select all in ${scopes[currentScope].label.toLowerCase()} scope` });
  const countEl = h('span', { class: 'dim' }, '0 selected');

  // Action buttons are captured so we can disable them at zero selection.
  const actionEls = [];
  const registerAction = (btn, { alwaysEnabled = false } = {}) => { btn.dataset.always = alwaysEnabled ? '1' : ''; actionEls.push(btn); return btn; };

  const refresh = () => {
    const scoped = scopeItems();
    const inScopeSelected = scoped.filter((it) => selected.has(idOf(it))).length;
    countEl.textContent = `${selected.size} selected`;
    selectAll.checked = scoped.length > 0 && inScopeSelected === scoped.length;
    selectAll.indeterminate = inScopeSelected > 0 && inScopeSelected < scoped.length;
    const none = selected.size === 0;
    for (const btn of actionEls) { if (btn.dataset.always !== '1') btn.disabled = none; }
    persist();
  };

  const doAction = async (fn, label) => {
    const ids = [...selected];
    if (!ids.length) { toast('Nothing selected', 'info'); return; }
    try { await fn(ids); if (invalidateKey) invalidate(invalidateKey); toast(label, 'success'); returnToLibrary(); }
    catch (e) { toast(e.message, 'error'); }
  };
  const monitor = (bool) => doAction(
    (ids) => isSeries ? arr.put('series/editor', { seriesIds: ids, monitored: bool }) : arr.put('movie/editor', { movieIds: ids, monitored: bool }),
    bool ? 'Monitoring selected' : 'Unmonitored selected');

  // ---- Per-item search: bounded, fault-isolated, with progress + retry ----
  const searchWorker = (id) => isSeries
    ? arr.post('command', { name: 'SeriesSearch', seriesId: id })
    : arr.post('command', { name: 'MoviesSearch', movieIds: [id] });

  const search = async () => {
    const ids = [...selected];
    if (!ids.length) { toast('Nothing selected', 'info'); return; }
    await runSearchBatch(ids);
  };

  const runSearchBatch = async (ids) => {
    const total = ids.length;
    const bar = h('span', { style: { width: '0%' } });
    const progressText = h('div', { class: 'dim', style: { marginTop: '6px' } }, `0 / ${total}`);
    const body = h('div', {},
      h('div', {}, `Searching ${total} ${total === 1 ? noun : `${noun}${isSeries ? '' : 's'}`}…`),
      h('div', { class: 'progress', style: { marginTop: '8px' } }, bar),
      progressText,
    );
    openModal({ title: 'Bulk search', body });
    const results = await runBatch(ids, (id) => searchWorker(id), {
      concurrency: SEARCH_CONCURRENCY,
      onProgress: ({ done }) => { bar.style.width = pct((done / total) * 100); progressText.textContent = `${done} / ${total}`; },
    });
    const summary = summarizeBatch(results);
    if (invalidateKey) invalidate(invalidateKey);
    if (!summary.failed) {
      closeModal();
      toast(`Searching ${summary.succeeded} ${summary.succeeded === 1 ? noun : `${noun}${isSeries ? '' : 's'}`}`, 'success');
      return;
    }
    showBatchSummary(summary, 'Bulk search');
  };

  // Failure list + batch error summary + Retry failed.
  const showBatchSummary = (summary, title) => {
    const failIds = summary.failures.map((f) => f.item);
    const list = h('div', { class: 'list bulk-failure-list' },
      ...summary.failures.slice(0, 100).map((f) => {
        const item = itemById.get(f.item);
        return h('div', { class: 'row' },
          h('div', { class: 'row-main' },
            h('div', { class: 'row-title' }, (item && item.title) || `#${f.item}`),
            h('div', { class: 'meta-line', style: { marginTop: '4px' } }, h('span', { class: 'pill down' }, f.message)),
          ),
        );
      }),
    );
    openModal({
      title,
      body: h('div', {},
        h('div', { class: 'bulk-summary' }, batchSummaryText(summary, noun)),
        h('div', { class: 'section-title', style: { margin: '12px 0 6px' } }, `Failed (${summary.failed})`),
        list,
      ),
      footer: h('div', { style: { display: 'flex', gap: '10px', justifyContent: 'flex-end', width: '100%' } },
        h('button', { class: 'btn', onclick: closeModal }, 'Close'),
        // Reuse the shared 'modal' overlay in place — runSearchBatch()'s
        // openModal() replaces this summary with the progress view. Do NOT
        // closeModal() first: closing pops the overlay's history entry
        // asynchronously while the immediate re-open pushes a new one, which
        // desyncs the overlay/history bookkeeping and back-navigates the page.
        h('button', { class: 'btn primary', onclick: () => { runSearchBatch(failIds); } }, `Retry failed (${summary.failed})`),
      ),
    });
  };

  const del = () => {
    const ids = [...selected];
    if (!ids.length) { toast('Nothing selected', 'info'); return; }
    confirmModal({
      title: 'Delete selected', message: `Remove ${ids.length} item(s) from ${isSeries ? 'Sonarr' : 'Radarr'}? Files on disk are kept.`,
      confirmLabel: 'Delete', danger: true,
      onConfirm: () => doAction((sel) => isSeries ? arr.del('series/editor', { seriesIds: sel, deleteFiles: false }) : arr.del('movie/editor', { movieIds: sel, deleteFiles: false }), 'Removed selected'),
    });
  };
  const tagsEditor = async () => {
    const ids = [...selected];
    if (!ids.length) { toast('Nothing selected', 'info'); return; }
    let tags = [];
    try { tags = await arr.get('tag'); } catch { /* ignore */ }
    const sel = h('select', { class: 'input' }, ...tags.map((t) => h('option', { value: t.id }, t.label)));
    const newTag = h('input', { class: 'input', placeholder: 'or create a new tag' });
    const apply = async (mode) => {
      let tagId = Number(sel.value);
      const label = newTag.value.trim();
      if (label) { try { const created = await arr.post('tag', { label }); tagId = created.id; } catch (e) { toast(e.message, 'error'); return; } }
      if (!tagId) { toast('Pick or enter a tag', 'info'); return; }
      const key = isSeries ? 'seriesIds' : 'movieIds';
      try {
        await arr.put(isSeries ? 'series/editor' : 'movie/editor', { [key]: ids, tags: [tagId], applyTags: mode });
        if (invalidateKey) invalidate(invalidateKey);
        toast(`Tag ${mode === 'add' ? 'added to' : 'removed from'} ${ids.length} item(s)`, 'success');
        closeModal();
      } catch (e) { toast(e.message, 'error'); }
    };
    openModal({
      title: `Tags · ${ids.length} selected`,
      body: h('div', { class: 'pw-form' },
        h('label', { class: 'pw-field' }, h('span', { class: 'pw-field-label' }, 'Tag'), sel),
        h('label', { class: 'pw-field' }, h('span', { class: 'pw-field-label' }, 'New tag'), newTag),
      ),
      footer: h('div', { style: { display: 'flex', gap: '10px', justifyContent: 'flex-end', width: '100%' } },
        h('button', { class: 'btn', onclick: closeModal }, 'Cancel'),
        h('button', { class: 'btn', onclick: () => apply('remove') }, 'Remove'),
        h('button', { class: 'btn primary', onclick: () => apply('add') }, 'Add'),
      ),
    });
  };

  const rootEditor = async () => {
    const ids = [...selected];
    if (!ids.length) { toast('Nothing selected', 'info'); return; }
    let roots = [];
    try { roots = await arr.get('rootfolder'); } catch { /* ignore */ }
    const sel = h('select', { class: 'input' }, ...roots.map((r) => h('option', { value: r.path }, `${r.path}${r.accessible === false ? ' (not available)' : ''}`)));
    const moveChk = h('input', { type: 'checkbox' });
    const apply = async () => {
      const rootFolderPath = sel.value;
      if (!rootFolderPath) { toast('Pick a root folder', 'info'); return; }
      const key = isSeries ? 'seriesIds' : 'movieIds';
      try {
        await arr.put(isSeries ? 'series/editor' : 'movie/editor', { [key]: ids, rootFolderPath, moveFiles: moveChk.checked });
        if (invalidateKey) invalidate(invalidateKey);
        toast(`Moved ${ids.length} item(s) to ${rootFolderPath}${moveChk.checked ? ' (files moved)' : ' (re-pointed)'}`, 'success');
        closeModal(); returnToLibrary();
      } catch (e) { toast(e.message, 'error'); }
    };
    openModal({
      title: `Root folder · ${ids.length} selected`,
      body: h('div', { class: 'pw-form' },
        h('label', { class: 'pw-field' }, h('span', { class: 'pw-field-label' }, 'Move to'), sel),
        h('label', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, moveChk, 'Move files on disk (leave off to only update the stored path)'),
        h('div', { class: 'dim', style: { fontSize: '12px' } }, 'Use this to correct items that ended up on the wrong drive.'),
      ),
      footer: h('div', { style: { display: 'flex', gap: '10px', justifyContent: 'flex-end', width: '100%' } },
        h('button', { class: 'btn', onclick: closeModal }, 'Cancel'),
        h('button', { class: 'btn primary', onclick: apply }, 'Move'),
      ),
    });
  };

  // On return to the library, persist the current selection so the library view
  // restores it, and hand back control (call site re-renders with same mode).
  const returnToLibrary = () => { persist(); onExit(); };

  const listEl = h('div', { class: tableMode ? 'bulk-table-view' : 'list' });
  const toggleSelected = (it) => {
    const id = idOf(it);
    if (selected.has(id)) selected.delete(id); else selected.add(id);
    refresh();
    renderRows();
  };
  const renderRows = () => {
    const visibleItems = scopeItems().slice(0, RENDER_CAP);
    if (tableMode) {
      return mount(listEl, compactTable(visibleItems, {
        columns,
        sortKey: tableSortKey,
        direction: tableDirection,
        selected,
        selectionLabel: 'Select',
        onSort: (key, nextDirection) => { tableSortKey = key; tableDirection = nextDirection; renderRows(); },
        onToggle: toggleSelected,
        onOpen: toggleSelected,
      }));
    }
    mount(listEl, ...visibleItems.map(rowFor));
  };
  selectAll.addEventListener('change', () => {
    const scoped = scopeItems();
    if (selectAll.checked) scoped.forEach((it) => selected.add(idOf(it)));
    else scoped.forEach((it) => selected.delete(idOf(it)));
    renderRows();
    refresh();
  });

  function rowFor(it) {
    const id = idOf(it);
    const cb = h('input', { type: 'checkbox', 'aria-label': `Select ${it.title || 'item'}` });
    cb.checked = selected.has(id);
    cb.addEventListener('change', () => { if (cb.checked) selected.add(id); else selected.delete(id); refresh(); });
    const downloaded = isSeries ? (it.statistics && it.statistics.episodeFileCount > 0) : it.hasFile;
    return h('div', { class: 'row' },
      h('label', { class: 'bulk-check' }, cb),
      poster(posterUrl(it), ''),
      h('div', { class: 'row-main' },
        h('div', { class: 'row-title' }, `${it.title}${it.year ? ` (${it.year})` : ''}`),
        h('div', { class: 'meta-line', style: { marginTop: '4px' } },
          it.monitored ? h('span', { class: 'pill info' }, 'Monitored') : h('span', { class: 'pill muted' }, 'Unmonitored'),
          downloaded ? h('span', { class: 'pill ok' }, 'Downloaded') : h('span', { class: 'pill warn' }, 'Missing'),
        ),
      ),
    );
  }

  // Scope selector: switching scope keeps the current selection and just
  // changes which candidate set "select all" and the rows show.
  const scopeSel = h('select', { class: 'input sm', title: 'Which items bulk actions target', 'aria-label': 'Selection scope' },
    ...Object.entries(scopes).map(([key, def]) => h('option', { value: key, selected: key === currentScope ? 'selected' : null }, `${def.label} (${def.items.length})`)),
  );
  scopeSel.addEventListener('change', () => { currentScope = scopeSel.value; renderRows(); refresh(); });

  // Actions via the foundation action-group primitive so they collapse into the
  // mobile bottom-sheet like every other row surface. Disabled state is driven
  // by refresh(); we tag the button elements after render.
  const actionGroupEl = actionGroup([
    { label: 'Monitor', onClick: () => monitor(true) },
    { label: 'Unmonitor', onClick: () => monitor(false) },
    { label: 'Search', primary: true, onClick: search },
    { label: 'Tags', onClick: tagsEditor },
    { label: 'Root', title: 'Move selected to a different root folder / drive', onClick: rootEditor },
    { label: 'Delete', variant: 'danger', onClick: del },
  ], { sheetTitle: 'Bulk actions' });
  // Collect the concrete buttons (skip the mobile "More" affordance) so zero
  // selection disables them.
  actionGroupEl.querySelectorAll('button:not(.ag-more)').forEach((btn) => registerAction(btn));

  const doneBtn = registerAction(h('button', { class: 'btn sm primary hex-btn', onclick: returnToLibrary }, 'Done'), { alwaysEnabled: true });
  const clearBtn = registerAction(h('button', { class: 'btn sm hex-btn', title: 'Clear selection', onclick: () => { selected.clear(); clearSelection(persistScope); renderRows(); refresh(); } }, 'Clear'));

  const toolbar = h('div', { class: 'bulk-bar' },
    h('label', { class: 'bulk-all' }, selectAll, 'All'),
    h('label', { class: 'bulk-scope' }, h('span', { class: 'sr-only' }, 'Scope'), scopeSel),
    countEl,
    h('div', { class: 'bulk-actions' }, actionGroupEl, clearBtn, doneBtn),
  );
  renderRows();
  refresh();
  mount(root, toolbar, listEl);
}
