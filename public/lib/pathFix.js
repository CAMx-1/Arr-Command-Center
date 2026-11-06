// "Fix paths" for Sonarr/Radarr, rebuilt around what the app itself can see.
//
// 1. Scan: list the folder every item should be in (through Sonarr/Radarr's
//    own filesystem API, so Docker and network-share paths are what *they*
//    see), and mark the items whose folder is gone.
// 2. Find: walk the disks and root folders they report, and match folder
//    names to the missing items, so moved drives are found automatically,
//    including libraries split across several drives and release-named
//    folders. Anything left can be pointed at a folder with the browser or a
//    manual "old → new" prefix.
// 3. Apply: re-point only the ticked items, without moving files, add the new
//    root folders, optionally remove the dead ones, and refresh just those
//    items. The previous paths are kept so the whole fix can be undone.
import { h, mount, spinner, empty, toast, openModal, closeModal } from './ui.js';
import { invalidate } from './cache.js';
import { roleAllows } from './roleUi.js';
import { scanLibrary, listDir, applyChanges, undoChanges, kindInfo } from './pathScan.js';
import { splitPath, trimSep, pathKey, remapPath, moveSummary, rootChanges, undoRecord, isSystemPath, pushUndo, planCsvRows, PATH_CSV_HEADERS } from './pathDoctor.js';
import { toCsv, downloadCsv, stamp } from './csv.js';

// Undo history: the last five fixes per service, newest first. An older
// single-record value (before history existed) is read as a one-item list.
const undoKey = (serviceKey) => `acc:pathfix-undo:${serviceKey}`;
export function readUndoHistory(serviceKey) {
  try {
    const v = JSON.parse(localStorage.getItem(undoKey(serviceKey)) || 'null');
    return (Array.isArray(v) ? v : v ? [v] : []).filter((r) => r && r.version === 1 && Array.isArray(r.changes) && r.changes.length);
  } catch { return []; }
}
const saveHistory = (serviceKey, list) => { try { if (list.length) localStorage.setItem(undoKey(serviceKey), JSON.stringify(list)); else localStorage.removeItem(undoKey(serviceKey)); } catch { /* ignore */ } };
const readUndo = (serviceKey) => readUndoHistory(serviceKey)[0] || null;
const writeUndo = (serviceKey, rec) => saveHistory(serviceKey, pushUndo(readUndoHistory(serviceKey), rec));
const dropUndo = (serviceKey, rec) => saveHistory(serviceKey, readUndoHistory(serviceKey).filter((r) => r.at !== rec.at));

const STATUS = {
  found: ['Found', 'ok'], review: ['Check this', 'warn'], ambiguous: ['Pick one', 'warn'],
  'not-found': ['Not found', 'down'], manual: ['Your choice', 'info'], 'manual-missing': ['Folder not there', 'down'],
};

// Inline folder browser using the app's own filesystem view.
function folderBrowser(arr, start, onPick, onClose) {
  const wrap = h('div', { class: 'card', style: { margin: '8px 0', padding: '10px' } });
  // Keyboard: ↑/↓ move, Enter/→ open, ←/Backspace go up, Home/End jump.
  let currentDir = start;
  function listKeys(e) {
    const items = [...wrap.querySelectorAll('.folder-item')];
    if (!items.length) return;
    const i = Math.max(0, items.indexOf(document.activeElement));
    const focus = (n) => { e.preventDefault(); items.forEach((el) => el.setAttribute('tabindex', '-1')); const el = items[Math.max(0, Math.min(items.length - 1, n))]; el.setAttribute('tabindex', '0'); el.focus(); };
    if (e.key === 'ArrowDown') focus(i + 1);
    else if (e.key === 'ArrowUp') focus(i - 1);
    else if (e.key === 'Home') focus(0);
    else if (e.key === 'End') focus(items.length - 1);
    else if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowRight') { e.preventDefault(); go(items[i].dataset.path); }
    else if ((e.key === 'ArrowLeft' || e.key === 'Backspace') && currentDir) { e.preventDefault(); const up = splitPath(currentDir).parent; if (up && up !== currentDir) go(up); }
  }
  const go = async (dir) => {
    currentDir = dir;
    mount(wrap, spinner());
    const children = dir ? await listDir(arr, dir) : null;
    const up = dir ? splitPath(dir).parent : '';
    const crumbs = h('div', { class: 'mono', style: { fontSize: '12px', wordBreak: 'break-all', marginBottom: '6px' } }, dir || '(choose a disk)');
    mount(wrap,
      crumbs,
      h('div', { class: 'meta-line', style: { marginBottom: '6px' } },
        up && up !== dir ? h('button', { class: 'btn sm', onclick: () => go(up) }, '↑ Up') : null,
        dir ? h('button', { class: 'btn sm primary', onclick: () => onPick(trimSep(dir)) }, 'Use this folder') : null,
        h('button', { class: 'btn sm', onclick: onClose }, 'Close')),
      children
        ? (children.length
          ? h('div', { class: 'list folder-list', role: 'listbox', 'aria-label': `Folders in ${dir}`, style: { maxHeight: '220px', overflowY: 'auto' }, onkeydown: listKeys }, ...children.filter((c) => !isSystemPath(c.path) && !c.name.startsWith('.')).map((c) => h('div', {
            class: 'row clickable folder-item', role: 'option', tabindex: '-1', 'aria-label': `Open ${c.name}`, style: { padding: '6px 10px' }, dataset: { path: c.path },
            onclick: () => go(c.path),
          }, h('span', { 'aria-hidden': 'true' }, '📁 '), c.name)))
          : h('div', { class: 'dim' }, 'No folders here.'))
        : h('div', { class: 'dim' }, dir ? 'This folder can’t be read (it may not exist).' : ''));
    const first = wrap.querySelector('.folder-item');
    if (first) { first.setAttribute('tabindex', '0'); first.focus({ preventScroll: true }); }
  };
  go(start);
  return wrap;
}

export async function openPathFix(arr, ctx, kind) {
  const body = h('div', {});
  openModal({ title: `Fix paths — ${ctx.service.label}`, body, wide: true });
  await scanInto(body, arr, ctx, kind);
}

// Scans and renders into the open dialog; "Scan again" and Undo re-run it in
// place (closing and reopening the dialog would race its history entry).
async function scanInto(body, arr, ctx, kind) {
  const serviceKey = ctx.service.key;
  const noun = kindInfo(kind).noun;
  const canApply = roleAllows('admin');
  const progress = h('div', { class: 'dim' }, 'Checking where everything is…');
  mount(body, h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center' } }, spinner(), progress));

  let scan;
  try {
    scan = await scanLibrary(arr, { kind, onProgress: ({ listed }) => { progress.textContent = `Checking folders on ${ctx.service.label}’s disks… (${listed})`; } });
  } catch (e) {
    mount(body, empty('', 'Could not scan', e.message));
    return;
  }

  // Working state: one row per missing item.
  const rows = scan.plan.map((p) => ({
    item: p.item, status: p.status, candidates: p.candidates || [], reason: p.reason || '', mediaFiles: p.mediaFiles,
    newPath: p.newPath || '', newRoot: p.newRoot || '', selected: p.status === 'found', browsing: false,
  }));

  const history = readUndoHistory(serviceKey);
  const undo = history[0] || null;
  const listEl = h('div', {});
  const footEl = h('div', {});
  const summaryEl = h('div', {});
  const opts = { addRoots: true, removeRoots: false, refresh: true };

  const changes = () => rows.filter((r) => r.selected && r.newPath).map((r) => ({
    id: r.item.id, title: r.item.title, oldPath: r.item.path, oldRoot: r.item.rootFolderPath || splitPath(r.item.path).parent, newPath: r.newPath, newRoot: r.newRoot,
  }));

  async function setManual(row, folder) {
    row.newPath = trimSep(folder);
    row.newRoot = splitPath(folder).parent;
    // Confirm the folder is really there (its parent lists it).
    const siblings = await listDir(arr, row.newRoot);
    const ok = !!(siblings && siblings.some((c) => pathKey(c.path) === pathKey(row.newPath)));
    row.status = ok ? 'manual' : 'manual-missing';
    row.selected = ok;
    row.reason = ok ? 'chosen by you' : 'that folder isn’t visible to the app';
    row.browsing = false;
    render();
  }

  function itemRow(row) {
    const [label, cls] = STATUS[row.status] || [row.status, 'muted'];
    const box = h('input', { type: 'checkbox', checked: row.selected ? 'checked' : null, disabled: !row.newPath || row.status === 'manual-missing' ? 'disabled' : null, 'aria-label': `Fix ${row.item.title}` });
    box.addEventListener('change', () => { row.selected = box.checked; renderFoot(); });
    const pick = row.candidates.length > 1 ? h('select', { class: 'input', style: { width: 'auto', maxWidth: '100%' }, 'aria-label': 'Choose the folder' },
      ...row.candidates.slice(0, 8).map((c) => h('option', { value: c.path, selected: pathKey(c.path) === pathKey(row.newPath) ? 'selected' : null }, `${c.path}  (${c.score >= 100 ? 'same name' : c.score >= 75 ? 'similar' : 'title only'})`))) : null;
    if (pick) pick.addEventListener('change', () => { const c = row.candidates.find((x) => x.path === pick.value); row.newPath = c.path; row.newRoot = c.parent; row.status = 'found'; row.selected = true; row.reason = 'chosen by you'; render(); });
    const start = row.newRoot || (scan.disks.find((d) => !isSystemPath(d.path)) || {}).path || '/';
    return h('div', { class: 'row', style: { alignItems: 'flex-start', gap: '10px' } },
      h('div', { style: { paddingTop: '3px' } }, box),
      h('div', { class: 'row-main' },
        h('div', { class: 'row-title', style: { fontSize: '14px' } }, row.item.title, row.item.year ? h('span', { class: 'dim' }, ` (${row.item.year})`) : null),
        h('div', { class: 'meta-line', style: { marginTop: '2px' } }, h('span', { class: `pill ${cls}` }, label), row.reason ? h('span', { class: 'dim' }, row.reason) : null,
          row.mediaFiles > 0 ? h('span', { class: 'dim' }, `${row.mediaFiles} video ${row.mediaFiles === 1 ? 'file' : 'files'}`) : null),
        h('div', { class: 'mono dim', style: { fontSize: '12px', wordBreak: 'break-all', marginTop: '4px' } }, `− ${row.item.path}`),
        row.newPath ? h('div', { class: 'mono', style: { fontSize: '12px', wordBreak: 'break-all', color: row.status === 'manual-missing' ? 'var(--red, #ef4444)' : 'var(--green, #16a34a)' } }, `+ ${row.newPath}`) : null,
        pick ? h('div', { style: { marginTop: '6px' } }, pick) : null,
        row.browsing ? folderBrowser(arr, start, (folder) => setManual(row, folder), () => { row.browsing = false; render(); }) : null),
      canApply ? h('div', { class: 'row-actions' }, h('button', { class: 'btn sm', onclick: () => { row.browsing = !row.browsing; render(); } }, 'Browse…')) : null);
  }

  function manualMapping() {
    const unplaced = rows.filter((r) => !r.newPath || r.status === 'manual-missing');
    if (!unplaced.length || !canApply) return null;
    // Suggestions: old parents of the unplaced items, and every folder the
    // scan saw on the disks (what the app can reach now).
    const fromId = `pf-from-${Math.random().toString(36).slice(2, 8)}`;
    const toId = `pf-to-${Math.random().toString(36).slice(2, 8)}`;
    const oldParents = [...new Set(unplaced.map((r) => splitPath(r.item.path).parent))];
    const reachable = [...new Set([...scan.disks.map((d) => trimSep(d.path)), ...scan.roots.filter((r) => r.accessible !== false).map((r) => trimSep(r.path)), ...[...scan.listings.values()].flat().map((c) => c.path)])]
      .filter((p) => p && !isSystemPath(p)).sort().slice(0, 300);
    const fromList = h('datalist', { id: fromId }, ...oldParents.map((v) => h('option', { value: v })));
    const toList = h('datalist', { id: toId }, ...reachable.map((v) => h('option', { value: v })));
    const from = h('input', { class: 'input mono', list: fromId, placeholder: oldParents[0], value: oldParents[0], style: { flex: '1', minWidth: '0' }, 'aria-label': 'Old folder' });
    const to = h('input', { class: 'input mono', list: toId, placeholder: reachable[0] || '/Volumes/Media/TV', style: { flex: '1', minWidth: '0' }, 'aria-label': 'Where it is now' });
    const browseSlot = h('div', {});
    const run = async (btn) => {
      if (!to.value.trim()) { toast('Choose the new folder first', 'info'); return; }
      btn.disabled = true;
      let placed = 0;
      for (const r of unplaced) {
        const np = remapPath(r.item.path, from.value.trim(), to.value.trim());
        if (!np) continue;
        await setManual(r, np);
        if (r.status === 'manual') placed += 1;
      }
      toast(placed ? `Placed ${placed} of ${unplaced.length}` : 'None of them are in that folder', placed ? 'success' : 'warn');
      btn.disabled = false;
    };
    const runBtn = h('button', { class: 'btn sm primary', onclick: () => run(runBtn) }, 'Try it');
    return h('div', { class: 'card', style: { marginTop: '12px', padding: '12px' } },
      h('div', { class: 'section-title', style: { margin: '0 0 6px' } }, 'Moved a whole folder?'),
      h('p', { class: 'dim', style: { margin: '0 0 8px', fontSize: '12px' } }, `Give the old folder and where it is now; each of the ${unplaced.length} unplaced ${unplaced.length === 1 ? 'item' : 'items'} is checked before it’s used.`),
      h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } }, from, h('span', { class: 'dim' }, '→'), to,
        h('button', { class: 'btn sm', onclick: () => mount(browseSlot, folderBrowser(arr, (scan.disks.find((d) => !isSystemPath(d.path)) || {}).path || '/', (f) => { to.value = f; mount(browseSlot); }, () => mount(browseSlot))) }, 'Browse…'), runBtn),
      browseSlot, fromList, toList);
  }

  function renderSummary() {
    const fine = scan.items.length - scan.missing.length;
    const deadRoots = scan.roots.filter((r) => r.accessible === false);
    const moves = moveSummary(rows.filter((r) => r.newPath && r.status !== 'manual-missing').map((r) => ({ item: r.item, newPath: r.newPath, newRoot: r.newRoot })));
    mount(summaryEl,
      undo && canApply ? h('div', { class: 'card', style: { padding: '10px 12px', marginBottom: '12px' } },
        ...history.map((rec, i) => h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', marginTop: i ? '6px' : '0' } },
          h('span', { class: 'dim', style: { flex: '1' } }, `${i === 0 ? 'Last fix' : 'Earlier fix'}: ${rec.changes.length} ${rec.changes.length === 1 ? 'item' : 'items'} on ${new Date(rec.at).toLocaleString()}.`),
          h('button', { class: 'btn sm', onclick: () => runUndo(rec) }, i === 0 ? 'Undo last fix' : 'Undo this fix')))) : null,
      h('div', { class: 'meta-line', style: { marginBottom: '8px', flexWrap: 'wrap' } },
        h('span', { class: 'pill ok' }, `${fine} in place`),
        scan.missing.length ? h('span', { class: 'pill down' }, `${scan.missing.length} missing`) : null,
        deadRoots.length ? h('span', { class: 'pill warn' }, `${deadRoots.length} root ${deadRoots.length === 1 ? 'folder' : 'folders'} not reachable`) : null,
        h('span', { class: 'dim' }, `${scan.listed} folders checked`)),
      scan.budgetHit ? h('p', { class: 'dim', style: { fontSize: '12px' } }, 'Stopped searching after many folders. Anything not found can be pointed at with Browse.') : null,
      moves.length ? h('div', {},
        h('div', { class: 'section-title', style: { margin: '6px 0' } }, 'Where things moved'),
        h('div', { class: 'list' }, ...moves.map((m) => h('div', { class: 'row', style: { padding: '6px 10px' } },
          h('div', { class: 'row-main mono', style: { fontSize: '12px', wordBreak: 'break-all' } }, `${m.from} → ${m.to}`),
          h('span', { class: 'pill info' }, `${m.count}`))))) : null);
  }

  // Unreachable root folders that no item uses any more cause a health
  // warning in Sonarr/Radarr; offer to remove them once everything is fixed.
  function deadRootCleanup() {
    const { remove } = rootChanges(scan.roots, scan.items, []);
    if (!remove.length || !canApply) return null;
    const btn = h('button', { class: 'btn sm danger confirm-btn', onclick: async () => {
      btn.disabled = true;
      let n = 0;
      for (const r of remove) { try { await arr.del(`rootfolder/${r.id}`); n += 1; } catch { /* leave it */ } }
      toast(`Removed ${n} of ${remove.length} root folders`, n === remove.length ? 'success' : 'warn');
      scanInto(body, arr, ctx, kind);
    } }, `Remove ${remove.length === 1 ? 'it' : 'them'}`);
    return h('div', { class: 'card', style: { padding: '10px 12px', marginTop: '10px', display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' } },
      h('span', { style: { flex: '1' } }, `${remove.length} root ${remove.length === 1 ? 'folder isn’t' : 'folders aren’t'} reachable and nothing uses ${remove.length === 1 ? 'it' : 'them'}: `, h('span', { class: 'mono' }, remove.map((r) => r.path).join(', '))),
      btn);
  }

  function renderFoot() {
    const ch = changes();
    const roots = rootChanges(scan.roots, scan.items, ch);
    const check = (key, text) => { const b = h('input', { type: 'checkbox', role: 'switch', checked: opts[key] ? 'checked' : null }); b.addEventListener('change', () => { opts[key] = b.checked; }); return h('label', { style: { display: 'flex', gap: '8px', alignItems: 'flex-start' } }, b, h('span', {}, text)); };
    if (!canApply) { mount(footEl, h('p', { class: 'dim settings-copy' }, 'Only admins can change paths.')); return; }
    if (!rows.length) { mount(footEl, h('div', { style: { display: 'flex', justifyContent: 'flex-end', marginTop: '12px' } }, h('button', { class: 'btn', onclick: closeModal }, 'Close'))); return; }
    const csvBtn = h('button', { class: 'btn', onclick: () => downloadCsv(`fix-paths-plan-${serviceKey}-${stamp()}.csv`, toCsv(PATH_CSV_HEADERS, planCsvRows(rows))) }, 'Export CSV');
    const applyBtn = h('button', { class: 'btn primary', disabled: ch.length ? null : 'disabled', onclick: () => runApply(ch, roots, applyBtn) }, ch.length ? `Re-point ${ch.length} ${ch.length === 1 ? 'item' : 'items'}` : 'Nothing selected');
    mount(footEl,
      h('div', { class: 'grid', style: { gap: '8px', marginTop: '14px' } },
        roots.add.length ? check('addRoots', `Add ${roots.add.length} new root ${roots.add.length === 1 ? 'folder' : 'folders'}: ${roots.add.join(', ')}`) : null,
        roots.remove.length ? check('removeRoots', `Remove ${roots.remove.length} unreachable root ${roots.remove.length === 1 ? 'folder' : 'folders'} nothing uses any more: ${roots.remove.map((r) => r.path).join(', ')}`) : null,
        check('refresh', `Rescan just these ${noun} afterwards`)),
      h('p', { class: 'dim', style: { fontSize: '12px' } }, 'Files are not moved; only the paths ', ctx.service.label, ' stores are changed. You can undo afterwards.'),
      h('div', { style: { display: 'flex', gap: '10px', marginTop: '10px', justifyContent: 'flex-end' } }, csvBtn, h('button', { class: 'btn', onclick: closeModal }, 'Close'), applyBtn));
  }

  function render() {
    const groups = [
      ['Found', rows.filter((r) => ['found', 'manual'].includes(r.status))],
      ['Needs a look', rows.filter((r) => ['review', 'ambiguous', 'manual-missing'].includes(r.status))],
      ['Not found', rows.filter((r) => r.status === 'not-found')],
    ].filter(([, l]) => l.length);
    renderSummary();
    mount(listEl, ...(groups.length ? groups.flatMap(([title, list]) => [
      h('div', { class: 'section-title', style: { margin: '14px 0 6px' } }, `${title} (${list.length})`),
      h('div', { class: 'list' }, ...list.map(itemRow)),
    ]) : [empty('✓', `All ${noun} are where ${ctx.service.label} expects them`, 'Nothing to re-point.'), deadRootCleanup()]),
    manualMapping());
    renderFoot();
  }

  async function runApply(ch, roots, btn) {
    btn.disabled = true;
    const status = h('div', { class: 'dim' }, 'Re-pointing…');
    mount(footEl, status);
    const res = await applyChanges(arr, {
      kind, changes: ch, addRoots: opts.addRoots ? roots.add : [], removeRoots: opts.removeRoots ? roots.remove : [], refresh: opts.refresh,
      onProgress: ({ done, total }) => { status.textContent = `Re-pointing… ${done}/${total}`; },
    });
    if (res.ok.length) writeUndo(serviceKey, undoRecord(serviceKey, res.ok));
    invalidate(`arr:${serviceKey}:${kindInfo(kind).path}`);
    toast(`Re-pointed ${res.ok.length} of ${ch.length}${res.refreshed ? ' · rescan started' : ''}`, res.failed.length ? 'warn' : 'success');
    mount(body,
      h('div', { class: 'meta-line', style: { flexWrap: 'wrap', marginBottom: '10px' } },
        h('span', { class: 'pill ok' }, `${res.ok.length} re-pointed`),
        res.failed.length ? h('span', { class: 'pill down' }, `${res.failed.length} failed`) : null,
        res.rootsAdded.length ? h('span', { class: 'pill info' }, `${res.rootsAdded.length} root folders added`) : null,
        res.rootsRemoved.length ? h('span', { class: 'pill muted' }, `${res.rootsRemoved.length} old root folders removed`) : null,
        res.refreshed ? h('span', { class: 'pill info' }, 'rescan started') : null),
      res.failed.length ? h('div', { class: 'list' }, ...res.failed.map((f) => h('div', { class: 'row' }, h('div', { class: 'row-main' }, h('div', { class: 'row-title', style: { fontSize: '13px' } }, f.title), h('div', { class: 'dim', style: { fontSize: '12px' } }, f.error))))) : null,
      res.rootsFailed.length ? h('p', { class: 'dim' }, `Couldn’t add: ${res.rootsFailed.map((r) => `${r.path} (${r.error})`).join(', ')}`) : null,
      h('div', { style: { display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '12px' } },
        res.ok.length ? h('button', { class: 'btn', onclick: () => runUndo(readUndo(serviceKey)) }, 'Undo') : null,
        h('button', { class: 'btn', onclick: () => downloadCsv(`fix-paths-${serviceKey}-${stamp()}.csv`, toCsv(['Title', 'Old path', 'New path', 'Result'], [...res.ok.map((c) => [c.title, c.oldPath, c.newPath, 'ok']), ...res.failed.map((c) => [c.title, c.oldPath, c.newPath, c.error])])) }, 'Export CSV'),
        h('button', { class: 'btn', onclick: () => scanInto(body, arr, ctx, kind) }, 'Scan again'),
        h('button', { class: 'btn primary', onclick: () => { closeModal(); ctx.reload(); } }, 'Done')));
  }

  async function runUndo(record) {
    if (!record) return;
    mount(body, h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center' } }, spinner(), h('span', { class: 'dim' }, `Putting ${record.changes.length} ${record.changes.length === 1 ? 'item' : 'items'} back…`)));
    const res = await undoChanges(arr, { kind, record });
    if (!res.failed.length) dropUndo(serviceKey, record);
    invalidate(`arr:${serviceKey}:${kindInfo(kind).path}`);
    toast(`Restored ${res.ok.length} of ${record.changes.length}`, res.failed.length ? 'warn' : 'success');
    scanInto(body, arr, ctx, kind);
  }

  mount(body,
    h('p', { class: 'dim', style: { margin: '0 0 12px', lineHeight: '1.6' } },
      `Checked every ${kindInfo(kind).one} folder against the disks ${ctx.service.label} can see, and looked for the missing ones there.`),
    summaryEl, listEl, footEl);
  render();
}

