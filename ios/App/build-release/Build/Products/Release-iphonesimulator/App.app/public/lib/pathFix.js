// "Fix paths" tool for Sonarr/Radarr. After moving hosts (e.g. Windows -> Mac),
// the stored root-folder and item paths point at locations that no longer exist,
// so items show as unavailable. Supports MULTIPLE drive mappings (e.g. Movies,
// Movies2, Movies3 each to their own new disk) so libraries spread across drives
// aren't collapsed into a single root. Re-points paths WITHOUT moving files
// (moveFiles=false) — the content already lives at the new location.
import { h, mount, spinner, empty, toast, openModal, closeModal, confirmModal } from './ui.js';
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
  // Match only a full path segment boundary (avoid C:\Media\Movies matching C:\Media\Movies2).
  if (pl !== fl && !pl.startsWith(fl + '\\') && !pl.startsWith(fl + '/')) return null;
  let rest = path.slice(f.length).replace(/\\/g, '/');
  if (rest && !rest.startsWith('/')) rest = '/' + rest;
  return t + rest;
}

// Given a path and a list of {from,to} mappings, pick the most specific match
// (longest `from` first) so e.g. ".../Movies3" wins over ".../Movies". Returns
// { np, to } or null.
export function pickRemap(path, mappings) {
  const valid = mappings
    .filter((m) => m.from && m.to)
    .sort((a, b) => stripTrail(b.from).length - stripTrail(a.from).length);
  for (const m of valid) {
    const np = remapPath(path, m.from, m.to);
    if (np && np !== path) return { np, to: stripTrail(m.to) };
  }
  return null;
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

  const addRootChk = h('input', { type: 'checkbox', checked: 'checked' });
  const rescanChk = h('input', { type: 'checkbox', checked: 'checked' });
  const previewArea = h('div', { style: { marginTop: '14px' } });
  const applyBtn = h('button', { class: 'btn primary', disabled: 'disabled', onclick: () => apply() }, 'Apply');
  let affected = [];

  // ---- Mapping rows (one per drive/root) ----
  const mapList = h('div', {});
  const makeRow = (from = '', to = '') => {
    const fromI = h('input', { class: 'input', value: from, placeholder: 'C:\\\\Media\\\\Movies2', style: { flex: '1', minWidth: '0' } });
    const toI = h('input', { class: 'input', value: to, placeholder: '/Volumes/Movies2', style: { flex: '1', minWidth: '0' } });
    fromI.addEventListener('input', computePreview);
    toI.addEventListener('input', computePreview);
    const row = h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px' } },
      fromI, h('span', { class: 'dim' }, '→'), toI,
      h('button', { class: 'btn sm', title: 'Remove mapping', onclick: () => { row.remove(); computePreview(); } }, '✕'),
    );
    row._from = fromI; row._to = toI;
    return row;
  };
  const getMappings = () => [...mapList.children].map((r) => ({ from: r._from.value.trim(), to: r._to.value.trim() }));

  // Prefill: one row per known root folder (inaccessible ones need a new path).
  if (roots.length) {
    for (const r of roots) mapList.appendChild(makeRow(r.path, r.accessible === false ? '' : r.path));
  } else {
    mapList.appendChild(makeRow());
  }

  const field = (label, control, hint) => h('div', {},
    h('div', { class: 'section-title', style: { margin: '0 0 6px' } }, label),
    control,
    hint ? h('div', { class: 'dim', style: { fontSize: '11px', marginTop: '4px' } }, hint) : null,
  );

  function computePreview() {
    const mappings = getMappings();
    affected = [];
    if (!mappings.some((m) => m.from && m.to)) {
      mount(previewArea, h('div', { class: 'dim' }, 'Fill in at least one old → new mapping.'));
      applyBtn.disabled = 'disabled';
      return;
    }
    for (const it of items) {
      const r = pickRemap(it.path, mappings);
      if (r) affected.push({ it, np: r.np, to: r.to });
    }
    if (!affected.length) {
      mount(previewArea, h('div', { class: 'dim' }, `No ${kind === 'series' ? 'series' : 'movies'} match those old paths.`));
      applyBtn.disabled = 'disabled';
      return;
    }
    applyBtn.removeAttribute('disabled');
    // Per-destination summary so multi-drive splits are obvious.
    const byDest = new Map();
    for (const a of affected) byDest.set(a.to, (byDest.get(a.to) || 0) + 1);
    mount(previewArea,
      h('div', { class: 'section-title' }, `${affected.length} ${affected.length === 1 ? 'item' : 'items'} will be re-pointed`),
      h('div', { class: 'meta-line', style: { marginBottom: '8px', flexWrap: 'wrap' } },
        ...[...byDest].map(([dest, n]) => h('span', { class: 'pill info' }, `${n} → ${dest}`))),
      h('div', { class: 'list', style: { maxHeight: '300px', overflowY: 'auto' } }, ...affected.slice(0, 40).map(({ it, np }) => h('div', { class: 'row' },
        h('div', { class: 'row-main' },
          h('div', { class: 'row-title', style: { fontSize: '13px' } }, it.title),
          h('div', { class: 'dim', style: { marginTop: '4px', wordBreak: 'break-all' } },
            h('div', {}, `− ${it.path}`),
            h('div', { style: { color: 'var(--green, #22c55e)' } }, `+ ${np}`),
          ),
        ),
      ))),
      affected.length > 40 ? h('div', { class: 'dim', style: { marginTop: '6px' } }, `…and ${affected.length - 40} more`) : null,
    );
  }

  const apply = () => {
    if (!affected.length) return;
    const dests = [...new Set(affected.map((a) => a.to))];
    confirmModal({
      title: 'Re-point paths?',
      message: `Update the stored path for ${affected.length} ${affected.length === 1 ? 'item' : 'items'} across ${dests.length} ${dests.length === 1 ? 'destination' : 'destinations'}. Files are NOT moved (moveFiles=false) — only ${ctx.service.label}'s database is updated.`,
      confirmLabel: 'Re-point paths',
      onConfirm: async () => {
        const status = h('div', { class: 'dim', style: { marginTop: '10px' } }, 'Starting…');
        mount(previewArea, status);
        applyBtn.disabled = 'disabled';
        // Register each destination as a root folder (ignore if it exists).
        if (addRootChk.checked) {
          for (const dest of dests) { try { await arr.post('rootfolder', { path: dest }); } catch { /* exists / not required */ } }
        }
        let ok = 0; let fail = 0;
        for (const { it, np, to } of affected) {
          try {
            await arr.put(`${itemsPath}/${it.id}?moveFiles=false`, { ...it, path: np, rootFolderPath: to });
            ok++;
          } catch { fail++; }
          status.textContent = `Re-pointing… ${ok + fail}/${affected.length}`;
        }
        if (rescanChk.checked && ok) {
          status.textContent = 'Re-pointed — starting library rescan…';
          try { await arr.post('command', { name: kind === 'series' ? 'RefreshSeries' : 'RefreshMovie' }); } catch { /* best effort */ }
        }
        invalidate(`arr:${ctx.service.key}:${itemsPath}`);
        toast(`Re-pointed ${ok} ${ok === 1 ? 'item' : 'items'} across ${dests.length} ${dests.length === 1 ? 'root' : 'roots'}${fail ? ` · ${fail} failed` : ''}${rescanChk.checked && ok ? ' · rescan started' : ''}`, fail ? 'warn' : 'success', 4500);
        closeModal();
        ctx.reload();
      },
    });
  };

  const anyBad = roots.some((r) => r.accessible === false);
  mount(body,
    h('p', { class: 'dim', style: { margin: '0 0 14px', lineHeight: '1.6' } },
      'After moving hosts, ', ctx.service.label, ' still points at the old paths. Add one mapping per drive (old prefix → real disk path), preview, then apply. ',
      h('b', {}, 'Files are not moved'), ' — only the stored paths are corrected. Each item follows the most specific matching mapping, so libraries spread across multiple drives stay on their own drive.'),
    h('div', { class: 'section-title' }, 'Root folders'),
    roots.length ? h('div', { class: 'list', style: { marginBottom: '4px' } }, ...roots.map(rootStatusRow)) : h('div', { class: 'dim' }, 'No root folders reported.'),
    anyBad ? h('div', { class: 'dim', style: { fontSize: '12px', margin: '2px 0 14px' } }, 'A red “Not available” root no longer exists on this machine — give it a new path below.') : h('div', { style: { height: '10px' } }),
    h('div', { class: 'section-title' }, 'Path mappings (old → new)'),
    mapList,
    h('button', { class: 'btn sm', style: { marginBottom: '12px' }, onclick: () => { mapList.appendChild(makeRow()); } }, '＋ Add mapping'),
    h('div', { class: 'grid', style: { gap: '10px' } },
      h('label', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, addRootChk, 'Also add each new path as a root folder'),
      h('label', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, rescanChk, 'Rescan the library afterwards (marks files available)'),
    ),
    h('div', { style: { display: 'flex', gap: '10px', marginTop: '14px' } },
      h('button', { class: 'btn', onclick: computePreview }, 'Preview'),
      applyBtn,
    ),
    previewArea,
  );

  computePreview();
}
