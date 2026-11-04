// Duplicate finder for Sonarr (series) / Radarr (movies).
//
//  • Duplicate library entries: grouped by shared TMDB/TVDB/IMDb ids (sure)
//    or by title and year when ids are missing (possible). Copies are ranked
//    with reasons (on disk, content, quality, size, monitored) and the extras
//    in sure groups are preselected. Deleting never removes the files of a
//    folder that a kept copy also uses.
//  • Untracked copies: folders inside a root folder that no item uses but
//    whose name matches a title, with how many video files they hold. When the
//    managed copy's folder is gone, the untracked one can be used instead.
//  • Other instances: the same title in another Sonarr/Radarr (e.g. a 4K or
//    anime instance), shown for reference.
import { h, mount, spinner, empty, toast, openModal, closeModal, fmtBytes, copyable } from './ui.js';
import { openPathFix } from './pathFix.js';
import { prepareKeepCopy, runKeepCopy, prepareKeepCopySeries, runKeepCopySeries } from './keepCopy.js';
import { invalidate } from './cache.js';
import { isLocalMode } from './connections.js';
import { roleAllows } from './roleUi.js';
import { scanDuplicates } from './duplicateScan.js';
import { defaultSelection, deletePlan, sizeOf, hasContent, qualityOf, splitIgnored, duplicateCsvRows, DUP_CSV_HEADERS } from './duplicateFinder.js';
import { toCsv, downloadCsv, stamp } from './csv.js';

const ignoreKey = (serviceKey) => `acc:dup-ignore:${serviceKey}`;
export function loadIgnored(serviceKey) { try { const v = JSON.parse(localStorage.getItem(ignoreKey(serviceKey)) || '[]'); return new Set(Array.isArray(v) ? v : []); } catch { return new Set(); } }
function saveIgnored(serviceKey, set) { try { localStorage.setItem(ignoreKey(serviceKey), JSON.stringify([...set].slice(-500))); } catch { /* ignore */ } }
import { applyChanges } from './pathScan.js';
import { splitPath } from './pathDoctor.js';

function otherInstances(ctx, kind) {
  const type = ctx.service.type;
  return (ctx.state.services || []).filter((s) => s.type === type && s.key !== ctx.service.key && s.configured)
    .map((s) => ({ service: s, arr: ctx.api.arr(s.key) }));
}

export async function openDuplicates(arr, ctx, kind) {
  const body = h('div', {});
  openModal({ title: `Duplicates — ${ctx.service.label}`, body, wide: true });
  await scanInto(body, arr, ctx, kind);
}

async function scanInto(body, arr, ctx, kind) {
  const noun = kind === 'series' ? 'series' : 'movies';
  const itemsPath = kind === 'series' ? 'series' : 'movie';
  const canDelete = roleAllows('delete');
  const canFix = roleAllows('admin');
  mount(body, h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center' } }, spinner(), h('span', { class: 'dim' }, `Looking for duplicate ${noun}…`)));
  let scan;
  const plex = (ctx.state.services || []).some((s) => s.type === 'plex' && s.configured) && !isLocalMode() ? () => ctx.api.plex.duplicates() : null;
  try { scan = await scanDuplicates(arr, { kind, others: otherInstances(ctx, kind), plexDuplicates: plex }); }
  catch (e) { mount(body, empty('', 'Could not load the library', e.message)); return; }

  // "Not a duplicate" choices are kept per service and hide those groups.
  const ignored = loadIgnored(ctx.service.key);
  const allGroups = scan.groups;
  const split = splitIgnored(allGroups, ignored);
  let showHidden = false;
  scan.groups = split.shown;
  const selected = defaultSelection(scan.groups);
  const opts = { deleteFiles: false, exclude: false };
  const groupsEl = h('div', {});
  const footEl = h('div', {});

  const pill = (text, cls) => h('span', { class: `pill ${cls}` }, text);
  function copyRow(g, c) {
    const it = c.item;
    const cb = h('input', { type: 'checkbox', checked: selected.has(it.id) ? 'checked' : null, disabled: canDelete ? null : 'disabled', 'aria-label': `Delete ${it.path}` });
    cb.addEventListener('change', () => { if (cb.checked) selected.add(it.id); else selected.delete(it.id); renderFoot(); });
    const q = qualityOf(it, kind);
    return h('label', { class: 'row', style: { cursor: canDelete ? 'pointer' : 'default', alignItems: 'flex-start', gap: '10px' } },
      h('div', { style: { paddingTop: '3px' } }, cb),
      h('div', { class: 'row-main' },
        h('div', { class: 'row-title mono', style: { fontSize: '12px', wordBreak: 'break-all' } }, it.path || '(no path)'),
        h('div', { class: 'meta-line', style: { marginTop: '4px', flexWrap: 'wrap' } },
          c.keep ? pill('Suggested keep', 'ok') : null,
          scan.onDisk.get(it.id) === false ? pill('Folder missing', 'down') : null,
          hasContent(it, kind) ? pill(kind === 'series' ? `${(it.statistics && it.statistics.episodeFileCount) || 0}/${(it.statistics && it.statistics.episodeCount) || 0} episodes` : 'Downloaded', 'ok') : pill('No files', 'warn'),
          q ? pill(q.name, 'info') : null,
          sizeOf(it, kind) ? h('span', {}, fmtBytes(sizeOf(it, kind))) : null,
          it.monitored ? pill('Monitored', 'info') : pill('Unmonitored', 'muted'))));
  }

  function hiddenNote() {
    if (!split.hidden.length) return null;
    return h('div', { class: 'dim', style: { fontSize: '12px', margin: '0 0 8px', display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } },
      `${split.hidden.length} marked “not a duplicate”.`,
      h('button', { class: 'btn sm', type: 'button', onclick: () => { showHidden = !showHidden; renderGroups(); } }, showHidden ? 'Hide them' : 'Show them'),
      showHidden ? h('div', { style: { width: '100%' } }, ...split.hidden.map((g) => h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', margin: '4px 0' } },
        h('span', {}, g.title),
        h('button', { class: 'btn sm', type: 'button', onclick: () => { ignored.delete(g.key); saveIgnored(ctx.service.key, ignored); split.hidden = split.hidden.filter((x) => x.key !== g.key); scan.groups = [...scan.groups, g]; for (const id of defaultSelection([g])) selected.add(id); renderGroups(); renderFoot(); } }, 'Show again')))) : null);
  }

  function renderGroups() {
    if (!scan.groups.length) { mount(groupsEl, hiddenNote()); return; }
    const sure = scan.groups.filter((g) => g.confidence === 'certain');
    mount(groupsEl,
      h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
        h('div', { class: 'section-title', style: { margin: '6px 0', flex: '1' } }, `Duplicate entries (${scan.groups.length})`),
        exportBtn()),
      hiddenNote(),
      h('p', { class: 'dim', style: { margin: '0 0 10px', fontSize: '13px', lineHeight: '1.55' } },
        sure.length ? `${sure.length} ${sure.length === 1 ? 'is' : 'are'} the same title by id; their extra copies are selected. ` : '',
        scan.groups.length > sure.length ? 'Groups marked “possible” only share a title and year, so nothing in them is selected.' : ''),
      ...scan.groups.map((g) => {
        const keeper = g.ranked[0];
        const pickExtras = h('button', { class: 'btn sm', type: 'button', onclick: () => { for (const c of g.ranked) { if (c.keep) selected.delete(c.item.id); else selected.add(c.item.id); } renderGroups(); renderFoot(); } }, 'Select extras');
        return h('div', { class: 'card', style: { marginBottom: '12px' } },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px', flexWrap: 'wrap' } },
            h('div', { class: 'row-title' }, g.title),
            pill(`${g.items.length} copies`, 'warn'),
            pill(g.confidence === 'certain' ? 'Same title' : 'Possible', g.confidence === 'certain' ? 'down' : 'muted'),
            h('span', { class: 'dim', style: { fontSize: '12px' } }, g.why),
            g.sharedPath ? pill('Two entries share a folder', 'warn') : null,
            h('span', { style: { marginLeft: 'auto', display: 'flex', gap: '6px' } },
              h('button', { class: 'btn sm', type: 'button', title: 'Hide this group from future scans', onclick: () => { ignored.add(g.key); saveIgnored(ctx.service.key, ignored); for (const c of g.ranked) selected.delete(c.item.id); scan.groups = scan.groups.filter((x) => x.key !== g.key); split.hidden.push(g); renderGroups(); renderFoot(); toast(`${g.title} marked as not a duplicate`, 'info'); } }, 'Not a duplicate'),
              canDelete ? pickExtras : null)),
          h('div', { class: 'dim', style: { fontSize: '12px', marginBottom: '6px' } }, `Keep suggestion: ${keeper.reasons.filter((r) => r.good).map((r) => r.text).join(', ') || 'first added'}.`),
          h('div', { class: 'list' }, ...g.ranked.map((c) => copyRow(g, c))));
      }));
  }

  function exportBtn() {
    return h('button', { class: 'btn sm', type: 'button', onclick: () => {
      downloadCsv(`duplicates-${ctx.service.key}-${stamp()}.csv`, toCsv(DUP_CSV_HEADERS, duplicateCsvRows(scan, kind)));
    } }, 'Export CSV');
  }

  function renderFoot() {
    if (!scan.groups.length || !canDelete) { mount(footEl, scan.groups.length ? h('p', { class: 'dim settings-copy' }, 'Only admins can delete entries.') : null); return; }
    const { plan, warnings } = deletePlan(scan.groups, selected, { deleteFiles: opts.deleteFiles });
    const df = h('input', { type: 'checkbox', checked: opts.deleteFiles ? 'checked' : null });
    df.addEventListener('change', () => { opts.deleteFiles = df.checked; renderFoot(); });
    const ex = h('input', { type: 'checkbox', checked: opts.exclude ? 'checked' : null });
    ex.addEventListener('change', () => { opts.exclude = ex.checked; });
    const shared = warnings.filter((w) => w.type === 'shared-folder');
    const allGone = warnings.filter((w) => w.type === 'all-copies');
    const btn = h('button', { class: 'btn primary danger confirm-btn', disabled: plan.length ? null : 'disabled', onclick: () => confirmDelete(plan, allGone) }, plan.length ? `Delete ${plan.length} ${plan.length === 1 ? 'entry' : 'entries'}` : 'Nothing selected');
    mount(footEl, h('div', { class: 'bulk-bar', style: { position: 'sticky', bottom: '0', flexWrap: 'wrap', gap: '10px' } },
      h('label', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, df, 'Also delete their files'),
      h('label', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, ex, 'Stop import lists re-adding them'),
      shared.length ? h('span', { class: 'pill warn', title: shared.map((w) => w.path).join('\n') }, `${shared.length} share a kept folder: their files are kept`) : null,
      allGone.length ? h('span', { class: 'pill down' }, `Every copy of ${allGone.map((w) => w.title).join(', ')} is selected`) : null,
      h('div', { style: { marginLeft: 'auto', display: 'flex', gap: '10px' } }, h('button', { class: 'btn', onclick: closeModal }, 'Close'), btn)));
  }

  // Confirmation happens in the footer so the dialog (and the rescan after
  // deleting) stays open.
  function confirmDelete(plan, allGone) {
    const withFiles = plan.filter((p) => p.deleteFiles).length;
    const message = `${withFiles ? `${withFiles} with their files on disk. ` : ''}${plan.length - withFiles ? `${plan.length - withFiles} as entries only: files stay, and those folders will then show as copies ${ctx.service.label} doesn’t manage. ` : ''}${allGone.length ? `No copy of ${allGone.map((w) => w.title).join(', ')} will be left. ` : ''}This can’t be undone.`;
    mount(footEl, h('div', { class: 'bulk-bar', style: { position: 'sticky', bottom: '0', flexWrap: 'wrap', gap: '10px' } },
      h('span', { style: { flex: '1', minWidth: '240px' } }, h('b', {}, `Delete ${plan.length} ${plan.length === 1 ? 'entry' : 'entries'}? `), message),
      h('button', { class: 'btn', onclick: renderFoot }, 'Cancel'),
      h('button', { class: 'btn primary danger confirm-btn', onclick: () => runDelete(plan) }, 'Delete')));
  }
  function runDelete(plan) {
    ({
      onConfirm: async () => {
        const status = h('div', { class: 'dim' }, 'Deleting…');
        mount(footEl, status);
        let ok = 0; const failed = [];
        for (const p of plan) {
          try { await arr.del(`${itemsPath}/${p.id}?deleteFiles=${p.deleteFiles}&addImportListExclusion=${opts.exclude}`); ok += 1; }
          catch (e) { failed.push(`${p.path}: ${e.message}`); }
          status.textContent = `Deleting… ${ok + failed.length}/${plan.length}`;
        }
        invalidate(`arr:${ctx.service.key}:${itemsPath}`);
        toast(`Deleted ${ok} of ${plan.length}${failed.length ? `; ${failed.length} failed` : ''}`, failed.length ? 'warn' : 'success', 5000);
        scanInto(body, arr, ctx, kind);
      },
    }).onConfirm();
  }

  function untrackedSection() {
    if (!scan.untracked.length) return null;
    return h('div', {},
      h('div', { class: 'section-title', style: { margin: '14px 0 6px' } }, `Copies ${ctx.service.label} doesn’t manage (${scan.untracked.length})`),
      h('p', { class: 'dim', style: { margin: '0 0 8px', fontSize: '13px', lineHeight: '1.55' } }, `Folders in a root folder that no ${kind === 'series' ? 'series' : 'movie'} uses, named like one you have. Plex may show these as duplicates. ${ctx.service.label} can’t delete files it doesn’t manage; remove them on disk or in Plex.`),
      h('div', { class: 'list' }, ...scan.untracked.map((u) => {
        const swap = !u.managedOnDisk && u.videoFiles > 0 && canFix ? h('button', { class: 'btn sm primary', onclick: async (e) => {
          e.currentTarget.disabled = true;
          const res = await applyChanges(arr, { kind, changes: [{ id: u.item.id, title: u.item.title, oldPath: u.item.path, oldRoot: u.item.rootFolderPath, newPath: u.folder.path, newRoot: splitPath(u.folder.path).parent }] });
          toast(res.ok.length ? `${u.item.title} now uses ${u.folder.path}` : `Couldn’t switch: ${(res.failed[0] || {}).error || 'failed'}`, res.ok.length ? 'success' : 'error');
          scanInto(body, arr, ctx, kind);
        } }, 'Use this copy') : null;
        const panel = h('div', {});
        const keep = u.managedOnDisk && u.videoFiles > 0 && canFix
          ? h('button', { class: 'btn sm', onclick: () => (kind === 'series' ? openKeepPanelSeries(panel, u) : openKeepPanel(panel, u)) }, kind === 'series' ? 'Use episodes from this copy…' : 'Keep this copy instead…') : null;
        return h('div', { class: 'row', style: { alignItems: 'flex-start', flexWrap: 'wrap' } },
          h('div', { class: 'row-main' },
            h('div', { class: 'row-title', style: { fontSize: '13px' } }, `${u.item.title}${u.item.year ? ` (${u.item.year})` : ''}`),
            h('div', { class: 'meta-line', style: { marginTop: '4px', flexWrap: 'wrap' } },
              u.videoFiles == null ? null : u.videoFiles ? pill(`${u.videoFiles} video ${u.videoFiles === 1 ? 'file' : 'files'}`, 'info') : pill('No video files (extras?)', 'muted'),
              u.managedOnDisk ? null : pill('Managed copy is missing', 'down'),
              u.inPlex ? pill('Plex shows this as a duplicate', 'warn') : null),
            h('div', { class: 'dim', style: { fontSize: '12px', wordBreak: 'break-all', marginTop: '4px' } }, 'Managed: ', h('span', { class: 'mono' }, u.item.path || '(unknown)')),
            h('div', { style: { fontSize: '12px', wordBreak: 'break-all' } }, 'Extra: ', copyable(u.folder.path)),
            panel),
          swap || keep ? h('div', { class: 'row-actions' }, swap, keep) : null);
      })));
  }

  // Replace the managed movie file with the one in the extra folder, using
  // Radarr's Manual Import; Radarr removes the old file (Recycle Bin if set).
  async function openKeepPanel(panel, u) {
    mount(panel, h('div', { class: 'dim', style: { marginTop: '8px' } }, 'Asking Radarr what it would do…'));
    let prep;
    try { prep = await prepareKeepCopy(arr, { item: u.item, folder: u.folder.path }); }
    catch (e) { mount(panel, h('div', { class: 'dim', style: { marginTop: '8px' } }, `Radarr couldn’t read that folder: ${e.message}`)); return; }
    if (!prep.best) { mount(panel, h('div', { class: 'dim', style: { marginTop: '8px' } }, 'Radarr found no video file it can import there.')); return; }
    const q = (x) => (x && x.quality && x.quality.quality && x.quality.quality.name) || 'unknown quality';
    const size = (x) => (x && x.size ? ` · ${fmtBytes(x.size)}` : '');
    const ack = h('input', { type: 'checkbox' });
    const go = h('button', { class: 'btn sm primary danger confirm-btn', disabled: prep.recycleBin && prep.better ? null : 'disabled' }, 'Replace the current file');
    const enable = () => { go.disabled = (!prep.recycleBin || !prep.better) && !ack.checked; };
    ack.addEventListener('change', enable);
    const risks = [
      !prep.better ? (prep.notUpgrade ? 'Radarr says this copy is not an upgrade.' : 'This copy isn’t better quality than the current file.') : null,
      !prep.recycleBin ? 'Radarr has no Recycle Bin set, so the current file will be deleted permanently (Settings → Media Management → Recycling Bin).' : null,
    ].filter(Boolean);
    go.addEventListener('click', async () => {
      go.disabled = true;
      mount(panel, h('div', { class: 'dim', style: { marginTop: '8px' } }, 'Radarr is importing the file…'));
      try {
        const res = await runKeepCopy(arr, { item: u.item, file: prep.best });
        toast(`${u.item.title} now uses ${q(res.now || prep.best)}${prep.recycleBin ? '; the old file is in the Recycle Bin' : ''}`, 'success', 6000);
        invalidate(`arr:${ctx.service.key}:${itemsPath}`);
        scanInto(body, arr, ctx, kind);
      } catch (e) { mount(panel, h('div', { style: { marginTop: '8px', color: 'var(--red, #ef4444)' } }, e.message)); }
    });
    mount(panel, h('div', { class: 'card', style: { marginTop: '8px', padding: '10px' } },
      h('div', { style: { fontSize: '13px' } }, h('b', {}, 'Now: '), q(prep.current), size(prep.current)),
      h('div', { style: { fontSize: '13px', marginBottom: '6px' } }, h('b', {}, 'This copy: '), q(prep.best), size(prep.best), prep.candidates.length > 1 ? h('span', { class: 'dim' }, ` (best of ${prep.candidates.length} files)`) : null),
      h('p', { class: 'dim', style: { fontSize: '12px', margin: '0 0 6px' } }, `Radarr moves this file into ${u.item.path}, renames it, and removes the current file${prep.recycleBin ? ` to its Recycle Bin (${prep.recycleBin})` : ''}. Arr Command Center doesn’t touch the drives.`),
      ...risks.map((r) => h('div', { class: 'pill warn', style: { display: 'block', whiteSpace: 'normal', margin: '0 0 6px' } }, r)),
      risks.length ? h('label', { style: { display: 'flex', gap: '8px', alignItems: 'center', fontSize: '13px', marginBottom: '6px' } }, ack, 'I understand; replace it anyway') : null,
      h('div', { style: { display: 'flex', gap: '8px', justifyContent: 'flex-end' } }, h('button', { class: 'btn sm', onclick: () => mount(panel) }, 'Cancel'), go)));
    enable();
  }

  // Sonarr: pick which episodes to take from the other copy. Upgrades and
  // episodes you don't have yet are preselected; Sonarr replaces each chosen
  // episode's file (Recycle Bin if set) and leaves the rest alone.
  async function openKeepPanelSeries(panel, u) {
    mount(panel, h('div', { class: 'dim', style: { marginTop: '8px' } }, 'Asking Sonarr what it would do…'));
    let prep;
    try { prep = await prepareKeepCopySeries(arr, { item: u.item, folder: u.folder.path }); }
    catch (e) { mount(panel, h('div', { class: 'dim', style: { marginTop: '8px' } }, `Sonarr couldn’t read that folder: ${e.message}`)); return; }
    if (!prep.rows.length) { mount(panel, h('div', { class: 'dim', style: { marginTop: '8px' } }, 'Sonarr found no episode files it can import there.')); return; }
    const q = (x) => (x && x.quality && x.quality.quality && x.quality.quality.name) || '—';
    const pick = new Set(prep.rows.filter((r) => r.better).map((r, i) => i));
    const idx = new Map(prep.rows.map((r, i) => [r, i]));
    const ack = h('input', { type: 'checkbox' });
    const go = h('button', { class: 'btn sm primary danger confirm-btn' });
    const paint = () => {
      const replacing = prep.rows.filter((r) => pick.has(idx.get(r)) && r.current).length;
      go.textContent = pick.size ? `Import ${pick.size} ${pick.size === 1 ? 'episode' : 'episodes'}` : 'Choose episodes';
      go.disabled = !pick.size || (replacing && !prep.recycleBin && !ack.checked);
    };
    ack.addEventListener('change', paint);
    const rowsEl = h('div', { class: 'list', style: { maxHeight: '240px', overflowY: 'auto', margin: '6px 0' } }, ...prep.rows.map((r) => {
      const i = idx.get(r);
      const cb = h('input', { type: 'checkbox', checked: pick.has(i) ? 'checked' : null, 'aria-label': `Import ${r.file.name}` });
      cb.addEventListener('change', () => { if (cb.checked) pick.add(i); else pick.delete(i); paint(); });
      const ep = r.file.episodes.map((e) => `S${String(e.seasonNumber ?? r.file.seasonNumber).padStart(2, '0')}E${String(e.episodeNumber).padStart(2, '0')}`).join(', ');
      return h('label', { class: 'row', style: { padding: '6px 10px', gap: '8px', cursor: 'pointer' } }, cb,
        h('div', { class: 'row-main' },
          h('div', { style: { fontSize: '13px' } }, h('b', {}, ep), ` · ${q(r.current)} → ${q(r.file)}`),
          h('div', { class: 'meta-line' }, r.missingNow ? h('span', { class: 'pill info' }, 'you don’t have this one') : r.better ? h('span', { class: 'pill ok' }, 'upgrade') : h('span', { class: 'pill muted' }, r.notUpgrade ? 'Sonarr: not an upgrade' : 'not better'))));
    }));
    go.addEventListener('click', async () => {
      go.disabled = true;
      const files = prep.rows.filter((r) => pick.has(idx.get(r))).map((r) => r.file);
      mount(panel, h('div', { class: 'dim', style: { marginTop: '8px' } }, `Sonarr is importing ${files.length} ${files.length === 1 ? 'episode' : 'episodes'}…`));
      try {
        await runKeepCopySeries(arr, { item: u.item, files });
        toast(`Imported ${files.length} ${files.length === 1 ? 'episode' : 'episodes'} of ${u.item.title}${prep.recycleBin ? '; replaced files are in the Recycle Bin' : ''}`, 'success', 6000);
        invalidate(`arr:${ctx.service.key}:${itemsPath}`);
        scanInto(body, arr, ctx, kind);
      } catch (e) { mount(panel, h('div', { style: { marginTop: '8px', color: 'var(--red, #ef4444)' } }, e.message)); }
    });
    mount(panel, h('div', { class: 'card', style: { marginTop: '8px', padding: '10px' } },
      h('p', { class: 'dim', style: { fontSize: '12px', margin: '0 0 4px' } }, `Sonarr moves each chosen file into ${u.item.path}, renames it, and removes that episode’s current file${prep.recycleBin ? ` to its Recycle Bin (${prep.recycleBin})` : ''}. Arr Command Center doesn’t touch the drives.`),
      rowsEl,
      prep.recycleBin ? null : h('div', { class: 'pill warn', style: { display: 'block', whiteSpace: 'normal', margin: '0 0 6px' } }, 'Sonarr has no Recycle Bin set, so replaced files are deleted permanently.'),
      prep.recycleBin ? null : h('label', { style: { display: 'flex', gap: '8px', alignItems: 'center', fontSize: '13px', marginBottom: '6px' } }, ack, 'I understand; replace them anyway'),
      h('div', { style: { display: 'flex', gap: '8px', justifyContent: 'flex-end' } }, h('button', { class: 'btn sm', onclick: () => mount(panel) }, 'Cancel'), go)));
    paint();
  }

  function crossSection() {
    if (!scan.crossInstance.length) return null;
    return h('div', {},
      h('div', { class: 'section-title', style: { margin: '14px 0 6px' } }, `Also in another instance (${scan.crossInstance.length})`),
      h('div', { class: 'list' }, ...scan.crossInstance.map((x) => h('div', { class: 'row' },
        h('div', { class: 'row-main' },
          h('div', { class: 'row-title', style: { fontSize: '13px' } }, `${x.item.title}${x.item.year ? ` (${x.item.year})` : ''}`),
          h('div', { class: 'meta-line', style: { marginTop: '4px', flexWrap: 'wrap' } },
            pill(x.service.label, 'info'), x.intended ? h('span', { class: 'dim' }, 'probably on purpose') : pill('check this', 'warn'),
            h('span', { class: 'mono dim', style: { fontSize: '12px', wordBreak: 'break-all' } }, x.other.path || ''))),
        h('div', { class: 'row-actions' }, h('a', { class: 'btn sm', href: `#/${encodeURIComponent(x.service.key)}`, onclick: () => closeModal() }, 'Open'))))));
  }

  const nothing = !scan.groups.length && !scan.untracked.length && !scan.crossInstance.length && !split.hidden.length;
  const missingCopies = scan.groups.some((g) => g.items.some((it) => scan.onDisk.get(it.id) === false));
  const fixHint = missingCopies && canFix ? h('div', { class: 'card', style: { padding: '10px 12px', marginBottom: '12px', display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' } },
    h('span', { style: { flex: '1' } }, `Some copies’ folders aren’t on disk where ${ctx.service.label} expects them. Fix paths first so the suggestions compare what’s really there.`),
    h('button', { class: 'btn sm primary', onclick: () => openPathFix(arr, ctx, kind) }, 'Fix paths')) : null;
  mount(body,
    nothing ? empty('✓', 'No duplicates found', `No repeated ${noun}, no untracked copies, nothing shared with another instance.`) : null,
    fixHint, groupsEl, footEl, untrackedSection(), crossSection(),
    nothing || !scan.groups.length ? h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '14px' } }, nothing ? null : exportBtn(), h('button', { class: 'btn', onclick: closeModal }, 'Close')) : null);
  renderGroups();
  renderFoot();
}
