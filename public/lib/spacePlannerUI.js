// "Free up space": pick a disk and how much to free; titles nobody is likely
// to miss are ranked and ticked until the target is met. Admins delete the
// ticked titles through Sonarr/Radarr (files included), after a second click.
import { h, mount, spinner, empty, toast, fmtBytes, fmtDate, pct, openModal } from './ui.js';
import { api } from './api.js';
import { roleAllows } from './roleUi.js';
import { toCsv, downloadCsv, stamp } from './csv.js';

const GiB = 2 ** 30;
const TIER = { 3: ['down', 'Nobody watched'], 2: ['warn', 'Not watched in a year'], 1: ['muted', 'Large, not watched lately'] };

// How much to free: back to 15% free, or two months at the current rate,
// whichever is more (at least 50 GB, rounded up to 50 GB).
export function defaultTarget(disk) {
  if (!disk) return 500 * GiB;
  const want = Math.max(disk.total ? 0.15 * disk.total - disk.free : 0, (disk.rate || 0) * 60, 50 * GiB);
  return Math.ceil(want / (50 * GiB)) * 50 * GiB;
}

export async function openSpacePlanner(ctx, { disk = null } = {}) {
  const body = h('div', {}, spinner());
  openModal({ title: 'Free up space', body, wide: true });
  let disks = [];
  try { disks = ((await api.getJson('/api/disks/forecast')).disks) || []; } catch { /* the planner still works for all disks */ }
  let diskKey = disk ? disk.key : '';
  const diskSel = h('select', { class: 'input', style: { width: 'auto' }, 'aria-label': 'Disk' },
    h('option', { value: '' }, 'All disks'), ...disks.map((d) => h('option', { value: d.key, selected: d.key === diskKey ? 'selected' : null }, `${d.label} (${fmtBytes(d.free)} free)`)));
  const target = h('input', { class: 'input', type: 'number', min: '1', step: '10', style: { width: '110px' }, 'aria-label': 'Gigabytes to free' });
  const head = h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '10px' } },
    h('span', { class: 'dim', style: { fontSize: '13px' } }, 'Free'), target, h('span', { class: 'dim', style: { fontSize: '13px' } }, 'GB on'), diskSel);
  const out = h('div', {});
  mount(body, head, out);
  let plan = null; let picked = new Set();
  const setTarget = (bytes) => { target.value = String(Math.round(bytes / GiB)); };
  setTarget(defaultTarget(disks.find((d) => d.key === diskKey)));
  diskSel.addEventListener('change', () => { diskKey = diskSel.value; setTarget(defaultTarget(disks.find((d) => d.key === diskKey))); load(); });
  // Re-pick only when the number really changed: the browser sends another
  // change event when the box loses focus, which would redraw the list under
  // the click that caused it (and swallow that click).
  let lastGoal = null;
  target.addEventListener('change', () => { if (plan && target.value !== lastGoal) { autoPick(); render(); } });

  function autoPick() {
    lastGoal = target.value;
    const goal = Math.max(1, Number(target.value) || 0) * GiB;
    picked = new Set(); let sum = 0;
    for (const c of plan.candidates) { if (sum >= goal) break; picked.add(c.key); sum += c.size; }
  }

  async function load() {
    mount(out, h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center' } }, spinner(), h('span', { class: 'dim' }, 'Checking the libraries and watch history…')));
    try { plan = await api.getJson(`/api/space/plan${diskKey ? `?disk=${encodeURIComponent(diskKey)}` : ''}`); }
    catch (e) { mount(out, empty('', 'Couldn’t make a plan', e.message)); return; }
    autoPick();
    render();
  }

  function render() {
    const goal = Math.max(1, Number(target.value) || 0) * GiB;
    const chosen = plan.candidates.filter((c) => picked.has(c.key));
    const sum = chosen.reduce((n, c) => n + c.size, 0);
    const where = plan.scope ? plan.scope.label : 'all disks';
    if (!plan.candidates.length && !plan.kept.length && !plan.leaving.length) {
      mount(out, empty('', plan.scope && !plan.total ? `No Sonarr or Radarr titles are on ${where}` : 'Nothing to suggest',
        plan.scope && !plan.total ? 'As far as the apps say, none of their titles are stored on this disk.' : `All ${plan.total} titles with files were watched recently, added recently, or are small.`,
        plan.scope ? { label: 'Look at all disks', onClick: () => { diskSel.value = ''; diskKey = ''; setTarget(defaultTarget(null)); load(); } } : null));
      return;
    }
    const canDelete = roleAllows('delete');
    const services = [...new Set(chosen.map((c) => c.serviceKey))];
    const noBin = services.filter((k) => plan.recycleBins[k] && !plan.recycleBins[k].path);
    const withBin = services.filter((k) => plan.recycleBins[k] && plan.recycleBins[k].path);
    const anySeerr = chosen.some((c) => c.seerrMediaId) && plan.seerrKey;
    const excl = h('input', { type: 'checkbox', role: 'switch', checked: 'checked' });
    const seerrSw = h('input', { type: 'checkbox', role: 'switch', checked: 'checked' });
    const ack = h('input', { type: 'checkbox' });
    const del = h('button', { class: 'btn sm danger', disabled: chosen.length ? null : 'disabled' }, chosen.length ? `Delete ${chosen.length} (${fmtBytes(sum)})` : 'Nothing ticked');
    const sync = () => { del.disabled = !chosen.length || (noBin.length > 0 && !ack.checked); };
    ack.addEventListener('change', sync); sync();
    del.onclick = async () => {
      if (del.dataset.armed !== '1') { del.dataset.armed = '1'; del.textContent = `Delete ${chosen.length} ${chosen.length === 1 ? 'title' : 'titles'} and their files?`; return; }
      del.disabled = true;
      let ok = 0; let freed = 0; const failed = [];
      for (let i = 0; i < chosen.length; i++) {
        const c = chosen[i];
        del.textContent = `Deleting ${i + 1} of ${chosen.length}…`;
        try {
          const path = c.kind === 'movie' ? `api/v3/movie/${c.id}?deleteFiles=true&addImportExclusion=${excl.checked}` : `api/v3/series/${c.id}?deleteFiles=true&addImportListExclusion=${excl.checked}`;
          await api.proxy(c.serviceKey, path, { method: 'DELETE' });
          ok += 1; freed += c.size;
          if (anySeerr && seerrSw.checked && c.seerrMediaId) await api.seerr(plan.seerrKey).del(`media/${c.seerrMediaId}`).catch(() => {});
        } catch (e) { if (e.cancelled) break; failed.push(`${c.title}: ${e.message}`); }
      }
      if (!ok && !failed.length) { del.disabled = false; del.dataset.armed = ''; del.textContent = `Delete ${chosen.length} (${fmtBytes(sum)})`; return; }
      toast(failed.length ? `Deleted ${ok}; ${failed.length} failed (${failed[0]})` : `Deleted ${ok} ${ok === 1 ? 'title' : 'titles'} (${fmtBytes(freed)})${withBin.length ? '. Files in a Recycle Bin free their space when the bin is cleared.' : ''}`, failed.length ? 'warn' : 'success', 8000);
      load();
    };
    const row = (c) => {
      const cb = h('input', { type: 'checkbox', checked: picked.has(c.key) ? 'checked' : null, 'aria-label': `Include ${c.title}`, onchange: (e) => { if (e.target.checked) picked.add(c.key); else picked.delete(c.key); render(); } });
      const [cls, word] = c.tier === 1 && !c.watchKnown ? ['muted', 'Large, no watch history'] : (TIER[c.tier] || TIER[1]);
      return h('label', { class: 'row', style: { alignItems: 'flex-start', gap: '10px', cursor: 'pointer', padding: '8px 12px' } }, cb,
        h('div', { class: 'row-main' },
          h('div', { class: 'row-title', style: { fontSize: '14px' } }, `${c.title}${c.year ? ` (${c.year})` : ''}`, ' ', h('span', { class: `pill ${cls}` }, word), ' ', h('span', { class: 'pill muted' }, c.serviceLabel),
            c.kind === 'show' && c.episodes ? h('span', { class: 'dim', style: { fontSize: '12px', marginLeft: '6px' } }, `${c.episodes} episodes`) : null),
          h('div', { style: { fontSize: '12px' } }, h('b', {}, fmtBytes(c.size)), ' · ', c.reasons.map((r) => r.text).join(' · '), c.requestedBy ? ` · requested by ${c.requestedBy}` : ''),
          h('div', { class: 'mono dim', style: { fontSize: '11px', wordBreak: 'break-all' } }, c.path)));
    };
    const csv = h('button', { class: 'btn sm', onclick: () => downloadCsv(`free-up-space-${stamp()}.csv`, toCsv(['Title', 'Year', 'App', 'Size (GB)', 'Why', 'Requested by', 'Path', 'Ticked'],
      plan.candidates.map((c) => [c.title, c.year || '', c.serviceLabel, (c.size / GiB).toFixed(1), c.reasons.map((r) => r.text).join('; '), c.requestedBy || '', c.path, picked.has(c.key) ? 'yes' : '']))) }, 'CSV');
    const binNotes = [
      ...noBin.map((k) => h('div', { style: { fontSize: '12px', color: 'var(--red)' } }, `${plan.recycleBins[k].label} has no Recycle Bin, so its files are deleted for good (Settings → Media Management → Recycling Bin).`)),
      ...withBin.map((k) => { const b = plan.recycleBins[k]; return h('div', { class: 'dim', style: { fontSize: '12px' } }, `${b.label} moves deleted files to ${b.path}. They only free space when the bin is cleared${b.cleanupDays ? ` (${b.label} clears files older than ${b.cleanupDays} days)` : ' (automatic clean-up is off, so clear it yourself)'}.`); }),
    ];
    const leavingBytes = plan.leaving.reduce((n, x) => n + x.size, 0);
    const soonest = plan.leaving.find((x) => x.deleteOn);
    mount(out,
      h('div', { style: { margin: '0 0 8px' } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' } },
          h('b', {}, `Ticked: ${chosen.length} ${chosen.length === 1 ? 'title' : 'titles'}, ${fmtBytes(sum)}`), h('span', { class: 'dim', style: { fontSize: '13px' } }, `of ${fmtBytes(goal)} on ${where}`),
          h('span', { style: { flex: '1' } }), h('button', { class: 'btn sm', onclick: () => { autoPick(); render(); } }, 'Re-pick'), csv),
        h('div', { class: 'progress', style: { margin: '6px 0' } }, h('span', { style: { width: pct((sum / goal) * 100) } }))),
      ...plan.notes.map((n) => h('p', { class: 'dim', style: { fontSize: '12px', margin: '0 0 4px' } }, n)),
      h('p', { class: 'dim', style: { fontSize: '12px', margin: '0 0 8px' } }, 'Ranked: nobody watched it, then not watched in a year, then large titles nobody watched in the last 3 months; biggest first within each. Titles added in the last month, watched in the last 3 months, excluded in Maintainerr or tagged “keep” in the app are never suggested.'),
      plan.leaving.length ? h('p', { style: { fontSize: '13px', margin: '0 0 8px' } }, `Maintainerr is already removing ${plan.leaving.length} ${plan.leaving.length === 1 ? 'title' : 'titles'} (${fmtBytes(leavingBytes)})${soonest ? `, the first around ${fmtDate(soonest.deleteOn)}` : ''}: ${plan.leaving.slice(0, 4).map((x) => x.title).join(', ')}${plan.leaving.length > 4 ? '…' : ''}. They aren’t listed here.`) : null,
      plan.candidates.length ? h('div', { class: 'list', style: { maxHeight: '46vh', overflowY: 'auto' } }, ...plan.candidates.map(row)) : h('p', { class: 'dim' }, 'Nothing else to suggest.'),
      plan.more ? h('p', { class: 'dim', style: { fontSize: '12px' } }, `Showing the top ${plan.candidates.length}; ${plan.more} more aren’t listed.`) : null,
      plan.kept.length ? h('details', { style: { marginTop: '10px' } }, h('summary', { class: 'dim', style: { cursor: 'pointer' } }, `Kept on purpose (${plan.kept.length})`),
        h('div', { class: 'list', style: { marginTop: '6px' } }, ...plan.kept.map((k) => h('div', { class: 'row', style: { padding: '6px 12px' } }, h('div', { class: 'row-main' },
          h('div', { class: 'row-title', style: { fontSize: '13px' } }, `${k.title}${k.year ? ` (${k.year})` : ''}`, ' ', h('span', { class: 'pill muted' }, k.serviceLabel)),
          h('div', { class: 'dim', style: { fontSize: '12px' } }, `${fmtBytes(k.size)} · ${k.why}`)))))) : null,
      h('div', { style: { borderTop: '1px solid var(--border)', marginTop: '12px', paddingTop: '10px', display: 'grid', gap: '8px' } },
        ...binNotes,
        canDelete ? h('div', { style: { display: 'flex', gap: '14px', alignItems: 'center', flexWrap: 'wrap', fontSize: '13px' } },
          h('label', { style: { display: 'flex', gap: '6px', alignItems: 'center' } }, excl, 'Stop import lists adding them again'),
          anySeerr ? h('label', { style: { display: 'flex', gap: '6px', alignItems: 'center' } }, seerrSw, 'Clear them in Seerr so they can be requested again') : null,
          noBin.length ? h('label', { style: { display: 'flex', gap: '6px', alignItems: 'center', color: 'var(--red)' } }, ack, 'I understand some files are deleted for good') : null,
          h('span', { style: { flex: '1' } }), del)
          : h('p', { class: 'dim', style: { fontSize: '12px', margin: '0' } }, 'Only admins can delete. Use CSV to pass the list on.')));
  }
  load();
}
