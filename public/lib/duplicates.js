// Duplicate finder for Sonarr (series) / Radarr (movie). Groups library items by
// their metadata id (tmdbId / tvdbId), falling back to title+year, and surfaces
// any group with more than one entry — the typical result of a title being added
// twice (e.g. onto different drives during a migration). Lets you pick which
// copies to delete, with an optional "delete files" toggle.
import { h, mount, spinner, empty, toast, openModal, closeModal, confirmModal, fmtBytes } from './ui.js';
import { invalidate } from './cache.js';

function keyOf(it, kind) {
  const id = kind === 'series' ? it.tvdbId : it.tmdbId;
  if (id) return `id:${id}`;
  const title = String(it.title || '').trim().toLowerCase();
  return `ty:${title}|${it.year || ''}`;
}

// Return only the groups (arrays) that contain more than one item.
export function findDuplicateGroups(items, kind) {
  const map = new Map();
  for (const it of (items || [])) {
    const k = keyOf(it, kind);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(it);
  }
  return [...map.values()].filter((g) => g.length > 1);
}

function hasFileOf(it, kind) {
  return kind === 'series' ? ((it.statistics && it.statistics.episodeFileCount) || 0) > 0 : !!it.hasFile;
}
function sizeOf(it, kind) {
  return kind === 'series' ? ((it.statistics && it.statistics.sizeOnDisk) || 0) : (it.sizeOnDisk || 0);
}

// The copy we recommend keeping: prefer one with files, then largest, then monitored.
export function keeperOf(group, kind) {
  const score = (it) => [hasFileOf(it, kind) ? 1 : 0, sizeOf(it, kind), it.monitored ? 1 : 0];
  return group.slice().sort((a, b) => {
    const sa = score(a); const sb = score(b);
    for (let i = 0; i < sa.length; i++) { if (sb[i] !== sa[i]) return sb[i] - sa[i]; }
    return 0;
  })[0];
}

export async function openDuplicates(arr, ctx, kind) {
  const itemsPath = kind === 'series' ? 'series' : 'movie';
  const body = h('div', {}, spinner());
  openModal({ title: `Duplicate ${kind === 'series' ? 'series' : 'movies'} — ${ctx.service.label}`, body, wide: true });

  let items = [];
  try { items = await arr.get(itemsPath); }
  catch (e) { return mount(body, empty('', 'Could not load library', e.message)); }
  items = Array.isArray(items) ? items : [];

  const groups = findDuplicateGroups(items, kind);
  if (!groups.length) {
    return mount(body, empty('', 'No duplicates found', `Every ${kind === 'series' ? 'series' : 'movie'} appears once.`));
  }

  const selected = new Set();
  const checks = new Map(); // id -> checkbox
  const deleteFilesChk = h('input', { type: 'checkbox' });
  const countEl = h('span', { class: 'dim' }, '0 selected');
  const deleteBtn = h('button', { class: 'btn primary danger', disabled: 'disabled', onclick: () => doDelete() }, 'Delete selected');
  const refresh = () => {
    countEl.textContent = `${selected.size} selected`;
    if (selected.size) deleteBtn.removeAttribute('disabled'); else deleteBtn.disabled = 'disabled';
  };
  const setSel = (id, on) => { if (on) selected.add(id); else selected.delete(id); const cb = checks.get(id); if (cb) cb.checked = on; refresh(); };

  const totalDupes = groups.reduce((a, g) => a + (g.length - 1), 0);

  const groupEls = groups.map((group) => {
    const keeper = keeperOf(group, kind);
    const title = `${group[0].title}${group[0].year ? ` (${group[0].year})` : ''}`;
    const rows = group.map((it) => {
      const isKeeper = it.id === keeper.id;
      const cb = h('input', { type: 'checkbox', onchange: (e) => setSel(it.id, e.currentTarget.checked) });
      checks.set(it.id, cb);
      return h('label', { class: 'row', style: { cursor: 'pointer' } },
        cb,
        h('div', { class: 'row-main', style: { marginLeft: '10px' } },
          h('div', { class: 'row-title', style: { fontSize: '13px', wordBreak: 'break-all' } }, it.path || '(no path)'),
          h('div', { class: 'meta-line', style: { marginTop: '4px' } },
            isKeeper ? h('span', { class: 'pill ok' }, 'Suggested keep') : null,
            hasFileOf(it, kind) ? h('span', { class: 'pill ok' }, 'Downloaded') : h('span', { class: 'pill warn' }, 'Missing'),
            it.monitored ? h('span', { class: 'pill info' }, 'Monitored') : h('span', { class: 'pill muted' }, 'Unmonitored'),
            sizeOf(it, kind) ? h('span', {}, fmtBytes(sizeOf(it, kind))) : null,
            h('span', { class: 'dim' }, `id ${it.id}`),
          ),
        ),
      );
    });
    const selectExtras = h('button', { class: 'btn sm', title: 'Select every copy except the suggested keeper', onclick: () => {
      for (const it of group) setSel(it.id, it.id !== keeper.id);
    } }, 'Select extras');
    return h('div', { class: 'card', style: { marginBottom: '14px' } },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' } },
        h('div', { class: 'row-title' }, title),
        h('span', { class: 'pill warn' }, `${group.length} copies`),
        h('span', { style: { marginLeft: 'auto' } }, selectExtras),
      ),
      h('div', { class: 'list' }, ...rows),
    );
  });

  const doDelete = () => {
    const ids = [...selected];
    if (!ids.length) return;
    // Warn if any group would be fully removed.
    const fullyRemoved = groups.filter((g) => g.every((it) => selected.has(it.id)));
    const df = deleteFilesChk.checked;
    confirmModal({
      title: 'Delete selected copies?',
      message: `Remove ${ids.length} ${ids.length === 1 ? 'entry' : 'entries'} from ${ctx.service.label}.${df ? ' Files on disk WILL be deleted.' : ' Files on disk are kept.'}${fullyRemoved.length ? ` Warning: ${fullyRemoved.length} title(s) would have ALL copies removed.` : ''}`,
      confirmLabel: df ? 'Delete + files' : 'Delete entries',
      danger: true,
      onConfirm: async () => {
        const status = h('div', { class: 'dim', style: { marginTop: '10px' } }, 'Deleting…');
        mount(body, status);
        let ok = 0; let fail = 0;
        for (const id of ids) {
          try { await arr.del(`${itemsPath}/${id}?deleteFiles=${df}&addImportListExclusion=false`); ok++; }
          catch { fail++; }
          status.textContent = `Deleting… ${ok + fail}/${ids.length}`;
        }
        invalidate(`arr:${ctx.service.key}:${itemsPath}`);
        toast(`Removed ${ok} ${ok === 1 ? 'entry' : 'entries'}${fail ? ` · ${fail} failed` : ''}`, fail ? 'warn' : 'success', 4000);
        closeModal();
        ctx.reload();
      },
    });
  };

  mount(body,
    h('p', { class: 'dim', style: { margin: '0 0 14px', lineHeight: '1.6' } },
      `Found ${groups.length} duplicated ${groups.length === 1 ? 'title' : 'titles'} (${totalDupes} extra ${totalDupes === 1 ? 'copy' : 'copies'}). Pick the copies to remove — “Select extras” keeps the suggested one and marks the rest.`),
    ...groupEls,
    h('div', { class: 'bulk-bar', style: { position: 'sticky', bottom: '0' } },
      h('label', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, deleteFilesChk, 'Also delete files on disk'),
      countEl,
      h('div', { style: { marginLeft: 'auto', display: 'flex', gap: '10px' } },
        h('button', { class: 'btn', onclick: closeModal }, 'Close'),
        deleteBtn,
      ),
    ),
  );
}
