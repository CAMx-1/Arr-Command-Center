import { h, mount, clear, toast, spinner, empty, openModal, closeModal, fmtBytes } from './ui.js';

// Shared Sonarr/Radarr actions used by both edit modals.
//   kind: 'series' (Sonarr) | 'movie' (Radarr)
//   client: api.arr(serviceKey)

// ---- Tag editor -----------------------------------------------------------
// Renders current tags as removable chips + an add box (existing or new tag).
// `currentIds` is mutated in place; read it back when saving.
export function tagEditor(allTags, currentIds, client) {
  const byId = new Map(allTags.map((t) => [t.id, t.label]));
  const chips = h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px', minHeight: '10px' } });
  const dl = h('datalist', { id: `arr-tags-${Math.random().toString(36).slice(2, 7)}` }, ...allTags.map((t) => h('option', { value: t.label })));
  const input = h('input', { class: 'input', placeholder: 'Add a tag…', list: dl.id, style: { flex: '1' } });

  const renderChips = () => {
    clear(chips);
    if (!currentIds.length) { chips.appendChild(h('span', { class: 'dim', style: { fontSize: '12px' } }, 'No tags')); return; }
    for (const id of currentIds) {
      const label = byId.get(id) || `#${id}`;
      chips.appendChild(h('span', { class: 'pill muted', style: { display: 'inline-flex', alignItems: 'center', gap: '6px' } },
        label,
        h('button', {
          title: 'Remove tag',
          style: { border: 'none', background: 'none', color: 'inherit', cursor: 'pointer', fontSize: '12px', lineHeight: '1', padding: '0' },
          onclick: () => { const i = currentIds.indexOf(id); if (i >= 0) currentIds.splice(i, 1); renderChips(); },
        }, '✕'),
      ));
    }
  };
  const addTag = async () => {
    const label = input.value.trim();
    if (!label) return;
    input.value = '';
    let tag = allTags.find((t) => t.label.toLowerCase() === label.toLowerCase());
    if (!tag) {
      try { tag = await client.post('tag', { label }); allTags.push(tag); byId.set(tag.id, tag.label); dl.appendChild(h('option', { value: tag.label })); }
      catch (e) { toast(e.message, 'error'); return; }
    }
    if (!currentIds.includes(tag.id)) currentIds.push(tag.id);
    renderChips();
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } });
  renderChips();
  return h('div', {}, chips, h('div', { style: { display: 'flex', gap: '8px', marginTop: '8px' } }, input, h('button', { class: 'btn sm', onclick: addTag }, 'Add')), dl);
}

// ---- Refresh / Rescan / Rename buttons ------------------------------------
export function arrCommandBar(client, kind, id) {
  const run = async (btn, cmd, msg) => {
    const orig = btn.textContent; btn.disabled = true; btn.textContent = '…';
    try { await client.post('command', cmd); toast(msg, 'success'); }
    catch (e) { toast(e.message, 'error'); }
    btn.disabled = false; btn.textContent = orig;
  };
  const refresh = h('button', { class: 'btn sm' }, 'Refresh');
  refresh.onclick = () => run(refresh, kind === 'series' ? { name: 'RefreshSeries', seriesId: id } : { name: 'RefreshMovie', movieIds: [id] }, 'Refresh queued');
  const rescan = h('button', { class: 'btn sm' }, 'Rescan');
  rescan.onclick = () => run(rescan, kind === 'series' ? { name: 'RescanSeries', seriesId: id } : { name: 'RescanMovie', movieIds: [id] }, 'Rescan queued');
  const rename = h('button', { class: 'btn sm' }, 'Rename…');
  rename.onclick = () => openRenamePreview(client, kind, id);
  return h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } }, refresh, rescan, rename);
}

// ---- Rename preview -------------------------------------------------------
export function openRenamePreview(client, kind, id) {
  const body = h('div', {}, h('div', { style: { padding: '20px' } }, spinner()));
  openModal({ title: 'Rename files', body, wide: true });
  (async () => {
    let items;
    try { items = await client.get(kind === 'series' ? `rename?seriesId=${id}` : `rename?movieId=${id}`); }
    catch (e) { mount(body, empty('⚠️', 'Failed to load preview', e.message)); return; }
    items = Array.isArray(items) ? items : [];
    if (!items.length) { mount(body, empty('✅', 'Already organized', 'No files need renaming.')); return; }
    const fileIds = items.map((it) => (kind === 'series' ? it.episodeFileId : it.movieFileId)).filter((x) => x != null);
    const apply = h('button', { class: 'btn primary' }, `Rename ${fileIds.length} file(s)`);
    apply.onclick = async () => {
      apply.disabled = true; apply.textContent = 'Renaming…';
      try {
        const cmd = kind === 'series' ? { name: 'RenameFiles', seriesId: id, files: fileIds } : { name: 'RenameFiles', movieId: id, files: fileIds };
        await client.post('command', cmd);
        toast('Rename queued', 'success'); closeModal();
      } catch (e) { toast(e.message, 'error'); apply.disabled = false; apply.textContent = `Rename ${fileIds.length} file(s)`; }
    };
    mount(body,
      h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '10px' } },
        h('div', { class: 'dim' }, `${items.length} file(s) would be renamed:`), apply),
      h('div', { class: 'list' }, ...items.map((it) => h('div', { class: 'row' }, h('div', { class: 'row-main' },
        h('div', { class: 'dim', style: { fontSize: '12px', wordBreak: 'break-all' } }, it.existingPath),
        h('div', { style: { fontSize: '13px', marginTop: '2px', wordBreak: 'break-all' } }, `→ ${it.newPath}`),
      )))),
    );
  })();
}

// Fetch the tag list for a service (best-effort → []).
export async function loadTags(client) {
  try { const t = await client.get('tag'); return Array.isArray(t) ? t : []; }
  catch { return []; }
}

// ---- Manual / interactive import ------------------------------------------
// Fixes stuck downloads: fetch the completed files the *arr couldn't auto-import,
// let the user pick, then trigger a ManualImport command with the guessed
// series/movie + quality metadata. `kind`: 'series' | 'movie'.
export function openManualImport(client, kind, opts = {}) {
  const body = h('div', {}, h('div', { style: { padding: '20px' } }, spinner()));
  openModal({ title: `Manual import${opts.title ? ` · ${opts.title}` : ''}`, body, wide: true });
  (async () => {
    const query = opts.downloadId
      ? `manualimport?downloadId=${encodeURIComponent(opts.downloadId)}&filterExistingFiles=true`
      : (opts.folder ? `manualimport?folder=${encodeURIComponent(opts.folder)}&filterExistingFiles=true` : 'manualimport');
    let items;
    try { items = await client.get(query); } catch (e) { mount(body, empty('⚠️', 'Failed to load', e.message)); return; }
    items = Array.isArray(items) ? items : [];
    if (!items.length) { mount(body, empty('📁', 'Nothing to import', 'No completed files were found for this download yet.')); return; }

    const idOf = (it, idx) => (it.id != null ? it.id : idx);
    const chosen = new Set(items.map((it, idx) => [it, idx]).filter(([it]) => (kind === 'series' ? it.series : it.movie) && !(it.rejections || []).length).map(([it, idx]) => idOf(it, idx)));

    const rows = items.map((it, idx) => {
      const id = idOf(it, idx);
      const mapped = kind === 'series' ? it.series : it.movie;
      const qn = it.quality && it.quality.quality && it.quality.quality.name;
      const rej = it.rejections || [];
      const cb = h('input', { type: 'checkbox', checked: chosen.has(id) ? 'checked' : null, disabled: mapped ? null : 'disabled' });
      cb.addEventListener('change', () => { if (cb.checked) chosen.add(id); else chosen.delete(id); });
      const eps = (it.episodes || []).map((e) => `S${String(e.seasonNumber ?? it.seasonNumber ?? 0).padStart(2, '0')}E${String(e.episodeNumber).padStart(2, '0')}`).join(', ');
      return h('label', { class: 'row', style: { alignItems: 'flex-start', cursor: 'pointer' } },
        h('span', { style: { marginRight: '10px', paddingTop: '3px' } }, cb),
        h('div', { class: 'row-main' },
          h('div', { class: 'row-title', style: { fontSize: '13px', wordBreak: 'break-all' } }, it.name || it.relativePath || it.path),
          h('div', { class: 'meta-line', style: { marginTop: '4px' } },
            mapped ? h('span', { class: 'pill ok' }, `${mapped.title || 'Matched'}${kind === 'series' && eps ? ` · ${eps}` : ''}`) : h('span', { class: 'pill down' }, 'Unmatched'),
            qn ? h('span', { class: 'pill info' }, qn) : null,
            it.size ? h('span', {}, fmtBytes(it.size)) : null,
          ),
          rej.length ? h('div', { style: { color: 'var(--red)', marginTop: '4px', fontSize: '12px' } }, rej.map((r) => r.reason).join(' · ')) : null,
        ),
      );
    });

    const importBtn = h('button', { class: 'btn primary' }, 'Import selected');
    importBtn.onclick = async () => {
      const files = items.map((it, idx) => ({ it, id: idOf(it, idx) })).filter(({ id }) => chosen.has(id)).map(({ it }) => {
        const base = { path: it.path, quality: it.quality, languages: it.languages, releaseGroup: it.releaseGroup, indexerFlags: it.indexerFlags || 0 };
        return kind === 'series'
          ? { ...base, seriesId: it.series.id, episodeIds: (it.episodes || []).map((e) => e.id) }
          : { ...base, movieId: it.movie.id };
      });
      if (!files.length) { toast('Select at least one matched file', 'error'); return; }
      importBtn.disabled = true; importBtn.textContent = 'Importing…';
      try { await client.post('command', { name: 'ManualImport', importMode: 'auto', files }); toast(`Importing ${files.length} file(s)`, 'success'); closeModal(); }
      catch (e) { toast(e.message, 'error'); importBtn.disabled = false; importBtn.textContent = 'Import selected'; }
    };

    mount(body,
      h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', marginBottom: '10px' } },
        h('div', { class: 'dim' }, `${items.length} file(s) found — pick what to import`), importBtn),
      h('div', { class: 'list' }, ...rows),
    );
  })();
}
