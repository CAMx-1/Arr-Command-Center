// "Fix paths" tool for Sonarr/Radarr. After moving hosts (e.g. Windows -> Mac),
// the stored root-folder and item paths point at locations that no longer exist,
// so items show as unavailable. This re-points every affected path from an old
// prefix to the real disk path WITHOUT moving files (moveFiles=false) — the
// content already lives at the new location and Plex serves it from there.
import { h, mount, clear, spinner, empty, toast, openModal, closeModal, confirmModal } from './ui.js';
import { invalidate } from './cache.js';

function stripTrail(p) { return String(p || '').replace(/[\\/]+$/, ''); }

// Re-point `path` from prefix `from` to prefix `to`, normalizing Windows
// backslashes to forward slashes. Returns null if `path` isn't under `from`.
export function remapPath(path, from, to) {
  if (!path) return null;
  const f = stripTrail(from);
  const t = stripTrail(to);
  if (!f) return null;
  const pl = path.toLowerCase();
  const fl = f.toLowerCase();
  // Match only a full path segment boundary (avoid C:\Media\TV matching C:\Media\TVShows).
  if (pl !== fl && !pl.startsWith(fl + '\\') && !pl.startsWith(fl + '/')) return null;
  let rest = path.slice(f.length).replace(/\\/g, '/');
  if (rest && !rest.startsWith('/')) rest = '/' + rest;
  return t + rest;
}

function rootStatusRow(r) {
  const bad = r.accessible === false;
  return h('div', { class: 'row' },
    h('div', { class: 'row-main' },
      h('div', { class: 'row-title', style: { fontSize: '13px', wordBreak: 'break-all' } }, r.path || '(unknown)'),
      h('div', { class: 'meta-line', style: { marginTop: '4px' } },
        h('span', { class: `pill ${bad ? 'down' : 'ok'}` }, bad ? 'Not available' : 'Accessible'),
      ),
    ),
  );
}

export async function openPathFix(arr, ctx, kind) {
  const itemsPath = kind === 'series' ? 'series' : 'movie';
  const body = h('div', {}, spinner());
  openModal({ title: `Fix media paths — ${ctx.service.label}`, body, wide: true });

  let roots = [];
  let items = [];
  try {
    [roots, items] = await Promise.all([
      arr.get('rootfolder').catch(() => []),
      arr.get(itemsPath),
    ]);
  } catch (e) {
    return mount(body, empty('', 'Could not load paths', e.message));
  }
  roots = Array.isArray(roots) ? roots : [];
  items = Array.isArray(items) ? items : [];

  // Smart prefills: map the first inaccessible root -> the first accessible one.
  const badRoot = roots.find((r) => r.accessible === false && r.path);
  const goodRoot = roots.find((r) => r.accessible !== false && r.path);
  const fromPrefill = (badRoot && badRoot.path) || (items.find((i) => i.rootFolderPath)?.rootFolderPath) || '';
  const toPrefill = (goodRoot && goodRoot.path) || '';

  const fromInput = h('input', { class: 'input', value: fromPrefill, placeholder: 'C:\\\\Media\\\\Movies' });
  const toInput = h('input', { class: 'input', value: toPrefill, placeholder: '/Volumes/Media/Movies' });
  const addRootChk = h('input', { type: 'checkbox', checked: 'checked' });
  const rescanChk = h('input', { type: 'checkbox', checked: 'checked' });
  const previewArea = h('div', { style: { marginTop: '14px' } });
  const applyBtn = h('button', { class: 'btn primary', disabled: 'disabled', onclick: () => apply() }, 'Apply');
  let affected = [];

  const field = (label, control, hint) => h('div', {},
    h('div', { class: 'section-title', style: { margin: '0 0 6px' } }, label),
    control,
    hint ? h('div', { class: 'dim', style: { fontSize: '11px', marginTop: '4px' } }, hint) : null,
  );

  const computePreview = () => {
    const from = fromInput.value.trim();
    const to = toInput.value.trim();
    affected = [];
    if (!from || !to) { mount(previewArea, h('div', { class: 'dim' }, 'Enter both the old and new path.')); applyBtn.disabled = 'disabled'; return; }
    for (const it of items) {
      const np = remapPath(it.path, from, to);
      if (np && np !== it.path) affected.push({ it, np });
    }
    if (!affected.length) {
      mount(previewArea, h('div', { class: 'dim' }, `No ${kind === 'series' ? 'series' : 'movies'} have a path under “${from}”.`));
      applyBtn.disabled = 'disabled';
      return;
    }
    applyBtn.removeAttribute('disabled');
    mount(previewArea,
      h('div', { class: 'section-title' }, `${affected.length} ${affected.length === 1 ? 'item' : 'items'} will be re-pointed`),
      h('div', { class: 'list', style: { maxHeight: '320px', overflowY: 'auto' } }, ...affected.slice(0, 40).map(({ it, np }) => h('div', { class: 'row' },
        h('div', { class: 'row-main' },
          h('div', { class: 'row-title', style: { fontSize: '13px' } }, it.title),
          h('div', { class: 'meta-line dim', style: { marginTop: '4px', wordBreak: 'break-all', display: 'block' } },
            h('div', {}, `− ${it.path}`),
            h('div', { style: { color: 'var(--green, #22c55e)' } }, `+ ${np}`),
          ),
        ),
      ))),
      affected.length > 40 ? h('div', { class: 'dim', style: { marginTop: '6px' } }, `…and ${affected.length - 40} more`) : null,
    );
  };

  const apply = () => {
    const to = toInput.value.trim();
    if (!affected.length) return;
    confirmModal({
      title: 'Re-point paths?',
      message: `Update the stored path for ${affected.length} ${affected.length === 1 ? 'item' : 'items'} to the new location. Files are NOT moved (moveFiles=false) — only ${ctx.service.label}'s database is updated.`,
      confirmLabel: 'Re-point paths',
      onConfirm: async () => {
        const status = h('div', { class: 'dim', style: { marginTop: '10px' } }, 'Starting…');
        mount(previewArea, status);
        applyBtn.disabled = 'disabled';
        // Register the new root folder so future adds use it (ignore if it exists).
        if (addRootChk.checked) {
          try { await arr.post('rootfolder', { path: to }); } catch { /* already exists / not required */ }
        }
        let ok = 0; let fail = 0;
        for (const { it, np } of affected) {
          try {
            await arr.put(`${itemsPath}/${it.id}?moveFiles=false`, { ...it, path: np, rootFolderPath: to });
            ok++;
          } catch { fail++; }
          status.textContent = `Re-pointing… ${ok + fail}/${affected.length}`;
        }
        // Trigger a rescan so the arr re-reads the (now-reachable) disk and marks
        // the files present — otherwise items stay "missing" until a manual refresh.
        if (rescanChk.checked && ok) {
          status.textContent = 'Re-pointed — starting library rescan…';
          try { await arr.post('command', { name: kind === 'series' ? 'RefreshSeries' : 'RefreshMovie' }); } catch { /* best effort */ }
        }
        invalidate(`arr:${ctx.service.key}:${itemsPath}`);
        toast(`Re-pointed ${ok} ${ok === 1 ? 'item' : 'items'}${fail ? ` · ${fail} failed` : ''}${rescanChk.checked && ok ? ' · rescan started' : ''}`, fail ? 'warn' : 'success', 4000);
        closeModal();
        ctx.reload();
      },
    });
  };

  fromInput.addEventListener('input', computePreview);
  toInput.addEventListener('input', computePreview);

  const anyBad = roots.some((r) => r.accessible === false);
  mount(body,
    h('p', { class: 'dim', style: { margin: '0 0 14px', lineHeight: '1.6' } },
      'After moving hosts, ', ctx.service.label, ' still points at the old paths. Map the old location prefix to the real disk path below, preview the changes, then apply. ',
      h('b', {}, 'Files are not moved'), ' — only the stored paths are corrected.'),
    h('div', { class: 'section-title' }, 'Root folders'),
    roots.length ? h('div', { class: 'list', style: { marginBottom: '4px' } }, ...roots.map(rootStatusRow)) : h('div', { class: 'dim' }, 'No root folders reported.'),
    anyBad ? h('div', { class: 'dim', style: { fontSize: '12px', margin: '2px 0 14px' } }, 'A red “Not available” root is the cause — its path no longer exists on this machine.') : h('div', { style: { height: '10px' } }),
    h('div', { class: 'grid', style: { gap: '14px' } },
      field('Old path (find)', fromInput, 'The prefix that no longer exists, e.g. C:\\Media\\Movies'),
      field('New path (replace with)', toInput, 'The real path on this machine that Plex serves from, e.g. /Volumes/Media/Movies'),
      h('label', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, addRootChk, 'Also add the new path as a root folder'),
      h('label', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, rescanChk, 'Rescan the library afterwards (marks files available)'),
    ),
    h('div', { style: { display: 'flex', gap: '10px', marginTop: '14px' } },
      h('button', { class: 'btn', onclick: computePreview }, 'Preview'),
      applyBtn,
    ),
    previewArea,
  );

  // Auto-preview if we have a confident prefill.
  if (fromPrefill && toPrefill) computePreview();
}
