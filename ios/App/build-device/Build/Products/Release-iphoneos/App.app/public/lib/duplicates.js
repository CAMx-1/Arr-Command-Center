// Duplicate finder for Sonarr (series) / Radarr (movie). Detects two kinds of
// duplicates:
//   1) Duplicate LIBRARY ENTRIES — the same title added more than once (grouped
//      by normalized title + year, so it catches copies even when metadata ids
//      differ). These are deletable through the arr.
//   2) UNTRACKED copies ON DISK — folders that exist inside a root folder but are
//      NOT attached to any managed item (arr `unmappedFolders`). This is the
//      classic "Plex shows a duplicate but Radarr only sees one" case: the arr
//      tracks one path while a second copy sits on another drive. The arr can't
//      delete files it doesn't manage, so these are surfaced with their full path
//      to remove on disk (or via Plex with media deletion enabled).
import { h, mount, spinner, empty, toast, openModal, closeModal, confirmModal, fmtBytes, copyable } from './ui.js';
import { invalidate } from './cache.js';

function normTitle(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// Parse "1917.2019.PROPER.1080p.BluRay.x265" -> { title:'1917', year:2019 }.
export function parseTitleYear(name) {
  const cleaned = String(name || '').replace(/[._]+/g, ' ');
  const m = cleaned.match(/^(.*?)[\s(]+((?:19|20)\d{2})\b/);
  if (m) return { title: m[1].trim(), year: Number(m[2]) };
  return { title: cleaned.trim(), year: null };
}

function keyOf(it) {
  const t = normTitle(it.title);
  if (!t) return `uniq:${it.id}`; // never group title-less items
  return `ty:${t}|${it.year || ''}`;
}

// Groups of library ENTRIES that appear more than once (same title + year).
export function findDuplicateGroups(items) {
  const map = new Map();
  for (const it of (items || [])) {
    const k = keyOf(it);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(it);
  }
  return [...map.values()].filter((g) => g.length > 1);
}

// Match each root-folder unmapped folder to a library item by title (+year when
// both are known). Returns [{ item, folder }].
export function findUntrackedCopies(items, roots) {
  const byTitle = new Map();
  for (const it of (items || [])) {
    const t = normTitle(it.title);
    if (!t) continue;
    if (!byTitle.has(t)) byTitle.set(t, []);
    byTitle.get(t).push(it);
  }
  const out = [];
  for (const r of (roots || [])) {
    for (const f of (r.unmappedFolders || [])) {
      const name = f.name || f.relativePath || (f.path || '').split(/[\\/]/).pop();
      const { title, year } = parseTitleYear(name);
      const cands = byTitle.get(normTitle(title));
      if (!cands) continue;
      const match = cands.find((it) => !year || !it.year || it.year === year) || cands[0];
      if (match) out.push({ item: match, folder: { name, path: f.path || `${r.path}/${name}` } });
    }
  }
  return out;
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
  openModal({ title: `Duplicates — ${ctx.service.label}`, body, wide: true });

  let items = [];
  let roots = [];
  try {
    [items, roots] = await Promise.all([
      arr.get(itemsPath),
      arr.get('rootfolder').catch(() => []),
    ]);
  } catch (e) { return mount(body, empty('', 'Could not load library', e.message)); }
  items = Array.isArray(items) ? items : [];
  roots = Array.isArray(roots) ? roots : [];

  const groups = findDuplicateGroups(items);
  const untracked = findUntrackedCopies(items, roots);

  if (!groups.length && !untracked.length) {
    return mount(body, empty('', 'No duplicates found', `No repeated ${kind === 'series' ? 'series' : 'movies'} and no untracked copies in the root folders.`));
  }

  // ---- Section 1: duplicate library entries (deletable) ----
  const selected = new Set();
  const checks = new Map();
  const deleteFilesChk = h('input', { type: 'checkbox' });
  const countEl = h('span', { class: 'dim' }, '0 selected');
  const deleteBtn = h('button', { class: 'btn primary danger', disabled: 'disabled', onclick: () => doDelete() }, 'Delete selected');
  const refresh = () => { countEl.textContent = `${selected.size} selected`; if (selected.size) deleteBtn.removeAttribute('disabled'); else deleteBtn.disabled = 'disabled'; };
  const setSel = (id, on) => { if (on) selected.add(id); else selected.delete(id); const cb = checks.get(id); if (cb) cb.checked = on; refresh(); };

  const groupEls = groups.map((group) => {
    const keeper = keeperOf(group, kind);
    const title = `${group[0].title}${group[0].year ? ` (${group[0].year})` : ''}`;
    const rows = group.map((it) => {
      const cb = h('input', { type: 'checkbox', onchange: (e) => setSel(it.id, e.currentTarget.checked) });
      checks.set(it.id, cb);
      return h('label', { class: 'row', style: { cursor: 'pointer' } },
        cb,
        h('div', { class: 'row-main', style: { marginLeft: '10px' } },
          h('div', { class: 'row-title', style: { fontSize: '13px', wordBreak: 'break-all' } }, it.path || '(no path)'),
          h('div', { class: 'meta-line', style: { marginTop: '4px' } },
            it.id === keeper.id ? h('span', { class: 'pill ok' }, 'Suggested keep') : null,
            hasFileOf(it, kind) ? h('span', { class: 'pill ok' }, 'Downloaded') : h('span', { class: 'pill warn' }, 'Missing'),
            it.monitored ? h('span', { class: 'pill info' }, 'Monitored') : h('span', { class: 'pill muted' }, 'Unmonitored'),
            sizeOf(it, kind) ? h('span', {}, fmtBytes(sizeOf(it, kind))) : null,
          ),
        ),
      );
    });
    const selectExtras = h('button', { class: 'btn sm', onclick: () => { for (const it of group) setSel(it.id, it.id !== keeper.id); } }, 'Select extras');
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
    const df = deleteFilesChk.checked;
    const fullyRemoved = groups.filter((g) => g.every((it) => selected.has(it.id)));
    confirmModal({
      title: 'Delete selected copies?',
      message: `Remove ${ids.length} ${ids.length === 1 ? 'entry' : 'entries'} from ${ctx.service.label}.${df ? ' Files on disk WILL be deleted.' : ' Files on disk are kept.'}${fullyRemoved.length ? ` Warning: ${fullyRemoved.length} title(s) would have ALL copies removed.` : ''}`,
      confirmLabel: df ? 'Delete + files' : 'Delete entries', danger: true,
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
        closeModal(); ctx.reload();
      },
    });
  };

  // ---- Section 2: untracked copies on disk (informational) ----
  const untrackedEl = untracked.length ? h('div', {},
    h('div', { class: 'section-title', style: { marginTop: '8px' } }, `Untracked copies on disk (${untracked.length})`),
    h('p', { class: 'dim', style: { margin: '0 0 10px', lineHeight: '1.55', fontSize: '13px' } },
      `These folders sit inside a root folder but aren't attached to any ${kind === 'series' ? 'series' : 'movie'} — ${ctx.service.label} manages a different copy, so Plex sees a duplicate. `,
      ctx.service.label, ` can't delete files it doesn't manage; remove these on disk or in Plex (with media deletion enabled).`),
    h('div', { class: 'list' }, ...untracked.map(({ item, folder }) => h('div', { class: 'row' },
      h('div', { class: 'row-main' },
        h('div', { class: 'row-title', style: { fontSize: '13px' } }, `${item.title}${item.year ? ` (${item.year})` : ''}`, h('span', { class: 'pill muted', style: { marginLeft: '8px' } }, 'untracked copy')),
        h('div', { class: 'meta-line', style: { marginTop: '4px', wordBreak: 'break-all', display: 'block' } },
          h('div', { class: 'dim' }, 'Managed copy: ', item.path || '(unknown)'),
          h('div', {}, 'Extra copy: ', copyable(folder.path)),
        ),
      ),
    )))) : null;

  const parts = [];
  if (groups.length) {
    const totalDupes = groups.reduce((a, g) => a + (g.length - 1), 0);
    parts.push(h('p', { class: 'dim', style: { margin: '0 0 14px', lineHeight: '1.6' } },
      `${groups.length} duplicated ${groups.length === 1 ? 'entry' : 'entries'} (${totalDupes} extra ${totalDupes === 1 ? 'copy' : 'copies'}). “Select extras” keeps the suggested copy and marks the rest.`));
    parts.push(...groupEls);
    parts.push(h('div', { class: 'bulk-bar', style: { position: 'sticky', bottom: '0' } },
      h('label', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, deleteFilesChk, 'Also delete files on disk'),
      countEl,
      h('div', { style: { marginLeft: 'auto', display: 'flex', gap: '10px' } },
        h('button', { class: 'btn', onclick: closeModal }, 'Close'),
        deleteBtn,
      ),
    ));
  }
  if (untrackedEl) parts.push(untrackedEl);
  if (!groups.length) parts.push(h('div', { style: { display: 'flex', justifyContent: 'flex-end', marginTop: '14px' } }, h('button', { class: 'btn', onclick: closeModal }, 'Close')));

  mount(body, ...parts);
}
