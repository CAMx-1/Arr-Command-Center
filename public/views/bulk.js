// Multi-select bulk actions for a Sonarr series / Radarr movie library.
import { h, mount, toast, poster, confirmModal, openModal, closeModal } from '../lib/ui.js';
import { invalidate } from '../lib/cache.js';

export function bulkLibrary(root, opts) {
  const { items, kind, arr, onExit, invalidateKey } = opts;
  const isSeries = kind === 'series';
  const idOf = (it) => it.id;
  const posterUrl = (it) => { const img = (it.images || []).find((i) => i.coverType === 'poster'); return img && (img.remoteUrl || img.url); };
  const selected = new Set();

  const countEl = h('span', { class: 'dim' }, '0 selected');
  const refresh = () => { countEl.textContent = `${selected.size} selected`; };

  const doAction = async (fn, label) => {
    const ids = [...selected];
    if (!ids.length) { toast('Nothing selected', 'info'); return; }
    try { await fn(ids); if (invalidateKey) invalidate(invalidateKey); toast(label, 'success'); onExit(); }
    catch (e) { toast(e.message, 'error'); }
  };
  const monitor = (bool) => doAction(
    (ids) => isSeries ? arr.put('series/editor', { seriesIds: ids, monitored: bool }) : arr.put('movie/editor', { movieIds: ids, monitored: bool }),
    bool ? 'Monitoring selected' : 'Unmonitored selected');
  const search = () => doAction(
    (ids) => isSeries ? Promise.all(ids.map((id) => arr.post('command', { name: 'SeriesSearch', seriesId: id }))) : arr.post('command', { name: 'MoviesSearch', movieIds: ids }),
    'Searching selected');
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

  const selectAll = h('input', { type: 'checkbox' });
  const listEl = h('div', { class: 'list' });
  const renderRows = () => mount(listEl, ...items.slice(0, 500).map(rowFor));
  selectAll.addEventListener('change', () => { selected.clear(); if (selectAll.checked) items.forEach((it) => selected.add(idOf(it))); renderRows(); refresh(); });

  function rowFor(it) {
    const id = idOf(it);
    const cb = h('input', { type: 'checkbox' });
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

  const toolbar = h('div', { class: 'bulk-bar' },
    h('label', { class: 'bulk-all' }, selectAll, 'All'),
    countEl,
    h('div', { class: 'bulk-actions' },
      h('button', { class: 'btn sm', onclick: () => monitor(true) }, 'Monitor'),
      h('button', { class: 'btn sm', onclick: () => monitor(false) }, 'Unmonitor'),
      h('button', { class: 'btn sm', onclick: search }, 'Search'),
      h('button', { class: 'btn sm', onclick: tagsEditor }, 'Tags'),
      h('button', { class: 'btn sm danger', onclick: del }, 'Delete'),
      h('button', { class: 'btn sm primary', onclick: onExit }, 'Done'),
    ),
  );
  renderRows();
  mount(root, toolbar, listEl);
}
