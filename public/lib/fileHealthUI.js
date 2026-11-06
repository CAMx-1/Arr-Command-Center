// "Check files" dialog (System tab): files that are probably broken or
// mislabelled, from Sonarr/Radarr's own media info.
import { h, mount, spinner, empty, toast, openModal, closeModal } from './ui.js';
import { scanFileHealth, worst } from './fileHealth.js';
import { roleAllows } from './roleUi.js';
import { toCsv, downloadCsv, stamp } from './csv.js';

const LEVEL = { error: ['Problem', 'down'], warn: ['Check', 'warn'], info: ['Note', 'muted'] };

// Episode ids for an episode file (Sonarr's episodefile has no episode list).
async function episodeIdsFor(arr, r) {
  if (Array.isArray(r.file.episodeIds) && r.file.episodeIds.length) return r.file.episodeIds;
  const eps = await arr.get(`episode?seriesId=${encodeURIComponent(r.seriesId)}`).catch(() => []);
  return (eps || []).filter((e) => e.episodeFileId === r.id).map((e) => e.id);
}

export async function openFileHealth(arr, ctx, kind) {
  const body = h('div', {});
  openModal({ title: `Check files — ${ctx.service.label}`, body, wide: true });
  const progress = h('span', { class: 'dim' }, 'Reading media info…');
  mount(body, h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center' } }, spinner(), progress));
  let scan;
  try { scan = await scanFileHealth(arr, { kind, onProgress: ({ done, total }) => { progress.textContent = `Reading media info… ${done}/${total} series`; } }); }
  catch (e) { mount(body, empty('', 'Couldn’t check files', e.message)); return; }
  const canWrite = roleAllows('write'); const canDelete = roleAllows('delete');
  let showNotes = false;

  const search = async (r, btn, { replace = false } = {}) => {
    btn.disabled = true;
    try {
      if (kind === 'series') {
        const ids = await episodeIdsFor(arr, r);
        if (replace) await arr.del(`episodefile/${r.id}`);
        await arr.post('command', ids.length ? { name: 'EpisodeSearch', episodeIds: ids } : { name: 'SeriesSearch', seriesId: r.seriesId });
      } else {
        if (replace) await arr.del(`moviefile/${r.file.id}`);
        await arr.post('command', { name: 'MoviesSearch', movieIds: [r.id] });
      }
      toast(replace ? `Deleted the file and searched for ${r.title}` : `Searching for ${r.title}`, 'success');
      btn.textContent = replace ? 'Deleted · searching' : 'Searching';
    } catch (e) { toast(e.message, 'error'); btn.disabled = false; }
  };

  function render() {
    const list = scan.results.filter((r) => showNotes || worst(r.issues) !== 'info').sort((a, b) => ({ error: 0, warn: 1, info: 2 })[worst(a.issues)] - ({ error: 0, warn: 1, info: 2 })[worst(b.issues)] || a.title.localeCompare(b.title));
    const notes = scan.results.length - scan.results.filter((r) => worst(r.issues) !== 'info').length;
    const counts = { error: 0, warn: 0, info: 0 };
    for (const r of scan.results) counts[worst(r.issues)] += 1;
    mount(body,
      h('div', { class: 'meta-line', style: { marginBottom: '8px', flexWrap: 'wrap' } },
        h('span', { class: 'dim' }, `${scan.checked} files checked`),
        h('span', { class: 'pill down' }, `${counts.error} problems`), h('span', { class: 'pill warn' }, `${counts.warn} to check`),
        notes ? h('button', { class: 'btn sm', onclick: () => { showNotes = !showNotes; render(); } }, showNotes ? 'Hide notes' : `Show ${notes} notes`) : null,
        h('button', { class: 'btn sm', style: { marginLeft: 'auto' }, onclick: () => downloadCsv(`file-check-${ctx.service.key}-${stamp()}.csv`, toCsv(['Title', 'Path', 'Level', 'Issue'], scan.results.flatMap((r) => r.issues.map((i) => [r.title, r.path, i.level, i.text])))) }, 'Export CSV')),
      list.length ? h('div', { class: 'list' }, ...list.map((r) => {
        const [label, cls] = LEVEL[worst(r.issues)];
        const sBtn = canWrite ? h('button', { class: 'btn sm', onclick: () => search(r, sBtn) }, 'Search again') : null;
        // Two clicks: the first arms it, the second deletes the file (to the
        // Recycle Bin if one is set) and searches for a new one.
        let armed = false;
        const dBtn = canDelete && worst(r.issues) === 'error' ? h('button', { class: 'btn sm danger confirm-btn', title: 'Delete this file (Recycle Bin if set) and search for a replacement', onclick: () => {
          if (!armed) { armed = true; dBtn.textContent = 'Delete file and search?'; setTimeout(() => { if (armed && !dBtn.disabled) { armed = false; dBtn.textContent = 'Replace'; } }, 5000); return; }
          search(r, dBtn, { replace: true });
        } }, 'Replace') : null;
        return h('div', { class: 'row', style: { alignItems: 'flex-start' } },
          h('div', { class: 'row-main' },
            h('div', { class: 'row-title', style: { fontSize: '13px' } }, r.title, ' ', h('span', { class: `pill ${cls}` }, label)),
            ...r.issues.map((i) => h('div', { style: { fontSize: '12px', marginTop: '2px' } }, '• ', i.text)),
            h('div', { class: 'mono dim', style: { fontSize: '11px', wordBreak: 'break-all', marginTop: '4px' } }, r.path)),
          h('div', { class: 'row-actions' }, sBtn, dBtn));
      })) : empty('✓', 'No problems found', 'Every file has readable video and audio and looks the right size.'),
      h('p', { class: 'dim', style: { fontSize: '12px', marginTop: '10px' } }, `Uses the media info ${ctx.service.label} already has. A file it hasn’t analysed yet shows as unreadable until its next refresh.`));
  }
  render();
}
