import { h, mount, clear, toast, spinner, empty, openModal, closeModal, fmtBytes } from './ui.js';
import {
  manualImportQuery, validateImportItem, defaultSelection, buildImportCommand, reprocessPayload,
  mergeReprocessed, episodeLabel, seriesSeasons, qualityFromDefinition, commandOutcome,
  canManualImport, isImportStuck, queueStateLabel, queueStatusMessages,
} from './manualImport.js';

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
// Fixes stuck downloads ("Import blocked", "No files found are eligible",
// "Unable to parse", "Not an upgrade", …): list the download's files, let the
// user re-map series/season/episodes (Sonarr) or movie (Radarr) and quality,
// re-evaluate via the *arr's reprocess endpoint, then send ManualImport and
// watch the command until it finishes. Pure logic lives in manualImport.js.
//
//   kind : 'series' | 'movie'
//   opts : { downloadId?, folder?, title?, messages?: string[], onImported?: () => void }
export function openManualImport(client, kind, opts = {}) {
  const body = h('div', {}, h('div', { style: { padding: '20px' } }, spinner()));
  openModal({ title: `Manual import${opts.title ? ` · ${opts.title}` : ''}`, body, wide: true });

  // Lazily-loaded pickers, shared across rows.
  const lookups = {};
  const lazy = (key, path) => (lookups[key] ||= client.get(path).then((v) => (Array.isArray(v) ? v : [])).catch(() => []));
  const libraryList = () => lazy('library', kind === 'series' ? 'series' : 'movie')
    .then((list) => [...list].sort((a, b) => String(a.title).localeCompare(String(b.title))));
  const qualityList = () => lazy('quality', 'qualitydefinition');
  const episodeList = (seriesId, season) => lazy(`ep:${seriesId}:${season}`, `episode?seriesId=${seriesId}&seasonNumber=${season}`)
    .then((eps) => eps.filter((e) => e.seasonNumber === season).sort((a, b) => a.episodeNumber - b.episodeNumber));

  let items = [];
  const selected = new Set();
  const listEl = h('div', { class: 'list' });
  const statusEl = h('div', { class: 'dim', style: { fontSize: '13px' } });
  const importBtn = h('button', { class: 'btn primary', type: 'button' }, 'Import');
  const selectAll = h('input', { type: 'checkbox', 'aria-label': 'Select all files' });

  const refreshFooter = () => {
    const n = selected.size;
    importBtn.textContent = n ? `Import ${n} file${n === 1 ? '' : 's'}` : 'Import';
    importBtn.disabled = !n;
    selectAll.checked = n > 0 && n === items.length;
    selectAll.indeterminate = n > 0 && n < items.length;
    statusEl.textContent = `${items.length} file${items.length === 1 ? '' : 's'} · ${n} selected`;
  };

  // Re-evaluate a single item on the server after the user edits it, so the
  // rejection list (and parsed languages/quality) reflect the new mapping.
  const reprocess = async (idx) => {
    try {
      const res = await client.post('manualimport', [reprocessPayload(kind, items[idx], opts.downloadId)]);
      const processed = Array.isArray(res) ? res[0] : null;
      items[idx] = mergeReprocessed(kind, items[idx], processed);
    } catch (e) { toast(`Re-check failed: ${e.message}`, 'error'); }
  };

  const renderRows = () => {
    mount(listEl, ...items.map((it, idx) => renderRow(it, idx)));
    refreshFooter();
  };

  const renderRow = (it, idx) => {
    const id = it.id;
    const problem = validateImportItem(kind, it);
    const rej = it.rejections || [];
    const mapped = kind === 'series' ? it.series : it.movie;
    const qn = it.quality && it.quality.quality && it.quality.quality.name;
    const langs = (it.languages || []).map((l) => l.name).filter(Boolean).join(', ');
    const eps = kind === 'series' ? episodeLabel(it) : '';

    const cb = h('input', { type: 'checkbox', 'aria-label': `Import ${it.name || it.path}` });
    cb.checked = selected.has(id);
    cb.disabled = !!problem;
    cb.addEventListener('change', () => { if (cb.checked) selected.add(id); else selected.delete(id); refreshFooter(); });

    const editorWrap = h('div', {});
    const editBtn = h('button', { class: 'btn sm', type: 'button' }, problem ? 'Fix mapping…' : 'Edit…');
    editBtn.onclick = () => {
      if (editorWrap.firstChild) { clear(editorWrap); return; }
      mount(editorWrap, importEditor(it, idx));
    };

    return h('div', { class: 'row', style: { alignItems: 'flex-start', flexWrap: 'wrap' } },
      h('span', { style: { marginRight: '10px', paddingTop: '3px' } }, cb),
      h('div', { class: 'row-main', style: { minWidth: '0' } },
        h('div', { class: 'row-title', style: { fontSize: '13px', wordBreak: 'break-all' } }, it.relativePath || it.name || it.path),
        h('div', { class: 'meta-line', style: { marginTop: '4px' } },
          mapped
            ? h('span', { class: 'pill ok' }, `${mapped.title || 'Matched'}${eps ? ` · ${eps}` : ''}`)
            : h('span', { class: 'pill down' }, 'Unmatched'),
          qn ? h('span', { class: 'pill info' }, qn) : h('span', { class: 'pill warn' }, 'No quality'),
          langs ? h('span', {}, langs) : null,
          it.releaseGroup ? h('span', {}, it.releaseGroup) : null,
          it.size ? h('span', {}, fmtBytes(it.size)) : null,
        ),
        problem ? h('div', { style: { color: 'var(--red)', marginTop: '4px', fontSize: '12px' } }, problem) : null,
        rej.length ? h('div', { class: 'dim', style: { marginTop: '4px', fontSize: '12px' } },
          h('span', { class: 'pill warn', style: { marginRight: '6px' } }, 'Rejected'), rej.map((r) => r.reason).join(' · ')) : null,
        editorWrap,
      ),
      h('div', { class: 'row-actions' }, editBtn),
    );
  };

  // Inline editor for one file: series/season/episodes or movie, plus quality.
  const importEditor = (it, idx) => {
    const wrap = h('div', { class: 'card', style: { marginTop: '10px', padding: '12px', display: 'grid', gap: '10px' } }, spinner());
    const field = (label, control) => h('label', { style: { display: 'grid', gap: '4px', fontSize: '12px' } }, h('span', { class: 'dim' }, label), control);
    // Multi-control fields (episode checkboxes) must not sit inside a <label>.
    const group = (label, control) => h('div', { role: 'group', 'aria-label': label, style: { display: 'grid', gap: '4px', fontSize: '12px' } }, h('span', { class: 'dim' }, label), control);
    (async () => {
      const [library, qualities] = await Promise.all([libraryList(), qualityList()]);
      const draft = { ...it };

      const libSelect = h('select', { class: 'input', 'aria-label': kind === 'series' ? 'Series' : 'Movie' },
        h('option', { value: '' }, kind === 'series' ? '— choose series —' : '— choose movie —'),
        ...library.map((x) => h('option', { value: String(x.id) }, x.year ? `${x.title} (${x.year})` : x.title)));
      libSelect.value = String((kind === 'series' ? draft.series?.id : draft.movie?.id) ?? '');

      const qSelect = h('select', { class: 'input', 'aria-label': 'Quality' },
        h('option', { value: '' }, '— choose quality —'),
        ...qualities.map((q) => h('option', { value: String(q.quality?.id) }, q.title || q.quality?.name)));
      qSelect.value = String(draft.quality?.quality?.id ?? '');

      const seasonSelect = h('select', { class: 'input', 'aria-label': 'Season' });
      const episodeBox = h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px 12px', maxHeight: '160px', overflowY: 'auto' } });
      const chosenEps = new Set((draft.episodes || []).map((e) => e.id));
      let seasonEpisodes = [];

      const renderSeasons = () => {
        const s = library.find((x) => x.id === draft.series?.id);
        const seasons = seriesSeasons(s);
        mount(seasonSelect, h('option', { value: '' }, '— season —'), ...seasons.map((n) => h('option', { value: String(n) }, n === 0 ? 'Specials' : `Season ${n}`)));
        seasonSelect.value = draft.seasonNumber != null ? String(draft.seasonNumber) : '';
      };
      const renderEpisodes = async () => {
        if (!draft.series || draft.seasonNumber == null) { mount(episodeBox, h('span', { class: 'dim' }, 'Pick a season first')); return; }
        mount(episodeBox, spinner());
        seasonEpisodes = await episodeList(draft.series.id, draft.seasonNumber);
        if (!seasonEpisodes.length) { mount(episodeBox, h('span', { class: 'dim' }, 'No episodes found for this season')); return; }
        mount(episodeBox, ...seasonEpisodes.map((e) => {
          const box = h('input', { type: 'checkbox' });
          box.checked = chosenEps.has(e.id);
          box.addEventListener('change', () => { if (box.checked) chosenEps.add(e.id); else chosenEps.delete(e.id); });
          return h('label', { style: { display: 'inline-flex', gap: '6px', alignItems: 'center', fontSize: '12px' } }, box,
            `E${String(e.episodeNumber).padStart(2, '0')}${e.title ? ` · ${e.title}` : ''}`);
        }));
      };

      libSelect.addEventListener('change', () => {
        const pick = library.find((x) => String(x.id) === libSelect.value) || null;
        if (kind === 'series') { draft.series = pick; draft.seasonNumber = undefined; chosenEps.clear(); renderSeasons(); renderEpisodes(); }
        else draft.movie = pick;
      });
      seasonSelect.addEventListener('change', () => {
        draft.seasonNumber = seasonSelect.value === '' ? undefined : Number(seasonSelect.value);
        chosenEps.clear(); renderEpisodes();
      });

      const apply = h('button', { class: 'btn sm primary', type: 'button' }, 'Apply');
      const cancel = h('button', { class: 'btn sm', type: 'button', onclick: () => clear(wrap.parentNode || wrap) }, 'Cancel');
      apply.onclick = async () => {
        const qDef = qualities.find((q) => String(q.quality?.id) === qSelect.value);
        draft.quality = qualityFromDefinition(qDef, draft.quality);
        if (kind === 'series') draft.episodes = seasonEpisodes.filter((e) => chosenEps.has(e.id));
        apply.disabled = true; apply.textContent = 'Checking…';
        items[idx] = draft;
        await reprocess(idx);
        if (validateImportItem(kind, items[idx])) selected.delete(items[idx].id); else selected.add(items[idx].id);
        renderRows();
      };

      const controls = [field(kind === 'series' ? 'Series' : 'Movie', libSelect)];
      if (kind === 'series') {
        renderSeasons(); renderEpisodes();
        controls.push(field('Season', seasonSelect), group('Episodes', episodeBox));
      }
      controls.push(field('Quality', qSelect));
      mount(wrap, ...controls, h('div', { style: { display: 'flex', gap: '8px', justifyContent: 'flex-end' } }, cancel, apply));
    })();
    return wrap;
  };

  // Poll the queued command so the user learns whether the import actually
  // worked (the *arr accepts the command immediately, then may still fail).
  const watchCommand = async (cmd, count) => {
    if (!cmd || cmd.id == null) { opts.onImported && opts.onImported(); return; }
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, i < 5 ? 1000 : 3000));
      let state;
      try { state = await client.get(`command/${cmd.id}`); } catch { break; }
      const outcome = commandOutcome(state);
      if (outcome === 'completed') { toast(`Imported ${count} file${count === 1 ? '' : 's'}`, 'success'); break; }
      if (outcome === 'failed') { toast(`Import failed${state && state.message ? `: ${state.message}` : ''}`, 'error'); break; }
    }
    opts.onImported && opts.onImported();
  };

  importBtn.onclick = async () => {
    const chosen = items.filter((it) => selected.has(it.id));
    let command;
    try { command = buildImportCommand(kind, chosen, { downloadId: opts.downloadId }); }
    catch (e) { toast(e.message, 'error'); return; }
    importBtn.disabled = true; importBtn.textContent = 'Importing…';
    try {
      const cmd = await client.post('command', command);
      toast(`Import started for ${chosen.length} file${chosen.length === 1 ? '' : 's'}`, 'success');
      closeModal();
      watchCommand(cmd, chosen.length);
    } catch (e) { toast(e.message, 'error'); refreshFooter(); }
  };

  selectAll.addEventListener('change', () => {
    selected.clear();
    if (selectAll.checked) items.forEach((it) => { if (!validateImportItem(kind, it)) selected.add(it.id); });
    renderRows();
  });

  (async () => {
    let res;
    try { res = await client.get(manualImportQuery(opts)); }
    catch (e) { mount(body, empty('⚠️', 'Failed to load files', e.message)); return; }
    items = (Array.isArray(res) ? res : []).map((it, i) => ({ ...it, id: it.id != null ? it.id : `f${i}` }));
    const messages = opts.messages || [];
    const why = messages.length ? h('div', { class: 'attention-banner', style: { marginBottom: '10px', flexDirection: 'column', alignItems: 'flex-start' } },
      h('span', { class: 'pill warn' }, 'Why it’s stuck'),
      ...messages.slice(0, 6).map((m) => h('div', { class: 'dim', style: { fontSize: '12px' } }, m))) : null;
    if (!items.length) {
      mount(body, why, empty('📁', 'No importable files found', 'The *arr could not find any video files for this download. Check the download client finished and the path is reachable.'));
      return;
    }
    defaultSelection(kind, items).forEach((id) => selected.add(id));
    mount(body,
      why,
      h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', marginBottom: '10px', flexWrap: 'wrap' } },
        h('label', { style: { display: 'inline-flex', alignItems: 'center', gap: '8px' } }, selectAll, statusEl),
        importBtn),
      listEl,
    );
    renderRows();
  })();
}

// Queue-row helpers shared by the Sonarr/Radarr Queue tabs.
// Returns the "Import" action for a queue record (or null when the download
// isn't finished). Stuck downloads get it as the primary (mobile-visible) action.
export function queueImportAction(client, kind, record, ctx) {
  if (!canManualImport(record)) return null;
  const stuck = isImportStuck(record);
  return {
    label: stuck ? '\u21E9 Fix import' : '\u21E9 Import',
    title: stuck ? 'This download finished but could not be imported — review and import manually' : 'Manually import completed files',
    variant: stuck ? 'primary' : undefined,
    primary: stuck,
    onClick: () => openManualImport(client, kind, {
      downloadId: record.downloadId,
      title: record.title,
      messages: queueStatusMessages(record),
      onImported: () => ctx && ctx.reload && ctx.reload(),
    }),
  };
}

// Status pill + the first reason a download is stuck (null for healthy items).
export function queueStatePill(record) {
  const stuck = isImportStuck(record);
  return h('span', { class: `pill ${stuck ? 'down' : 'info'}` }, queueStateLabel(record));
}
export function queueStuckReason(record) {
  if (!isImportStuck(record)) return null;
  const msgs = queueStatusMessages(record);
  if (!msgs.length) return null;
  return h('div', { class: 'row-sub', style: { color: 'var(--red)', fontSize: '12px', marginTop: '4px' } },
    msgs[0] + (msgs.length > 1 ? ` (+${msgs.length - 1} more)` : ''));
}
