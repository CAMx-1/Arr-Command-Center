// "Untracked files" (System tab): videos the app doesn't track, in two places.
//   1. Inside a show's or movie's own folder (the Dexter case): the app's own
//      rescan records them where they are; what's left is explained.
//   2. Leftover downloads in a root folder: checked with the app's Manual
//      Import, then imported, or listed. Nothing here deletes or moves a file
//      by itself; imports are the app's own.
import { h, mount, spinner, empty, toast, openModal, closeModal, copyable, fmtBytes, tabs } from './ui.js';
import { roleAllows } from './roleUi.js';
import { invalidate } from './cache.js';
import { toCsv, downloadCsv, stamp } from './csv.js';
import { scanUntracked, rescanAndRecheck, explainSeries, classifyMovieEntry, importEpisodeFiles, linkMovies, seasonsText, rescanSettingFinding } from './untrackedFiles.js';
import { leftoverCandidates, checkLeftovers, leftoverSummary, importLeftovers, leftoverCsvRows, redundantPaths, LEFTOVER_CSV_HEADERS, LEFTOVER_LABEL } from './leftoverDownloads.js';

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const pill = (text, cls) => h('span', { class: `pill ${cls}` }, text);

export async function openUntracked(arr, ctx, kind, { tab = 'folders' } = {}) {
  const app = ctx.service.label;
  const series = kind === 'series';
  const thing = series ? 'show' : 'movie';
  const body = h('div', { class: 'utf' });
  openModal({ title: `Untracked files — ${app}`, body, wide: true });
  const canWrite = roleAllows('write'); const canDelete = roleAllows('delete'); const isAdmin = roleAllows('admin');
  const openDuplicates = () => { closeModal(); import('./duplicates.js').then((m) => m.openDuplicates(arr, ctx, kind)); };
  const open = () => body.isConnected;
  // Both tabs draw into one panel: each only redraws while it's shown.
  let active = tab === 'leftovers' ? 'leftovers' : 'folders';

  // ============================================================= part 1
  const A = { phase: 'new', progress: '', scan: null, after: null, explained: new Map(), ticked: new Set(), busy: false, mm: null };
  let aEl = null;
  const paintA = () => { if (active === 'folders' && aEl && aEl.isConnected) renderFolders(aEl); };

  async function startScan() {
    A.phase = 'scanning'; A.progress = `Reading ${thing} folders…`; paintA();
    try {
      A.scan = await scanUntracked(arr, { kind, onProgress: ({ done, total }) => { A.progress = `Reading ${thing} folders… ${done} of ${total}`; if (done % 10 === 0) paintA(); } });
      A.mm = A.scan.mm; A.phase = 'ready';
    } catch (e) { A.phase = 'error'; A.error = e.message; }
    paintA();
  }

  async function rescan() {
    const entries = A.scan.entries.filter((e) => e.files.length);
    A.phase = 'rescanning'; A.progress = `${app} is rescanning ${plural(entries.length, 'folder', 'folders')}…`; paintA();
    try {
      A.after = await rescanAndRecheck(arr, kind, entries, { onProgress: ({ stage, done, total }) => { A.progress = stage === 'rescan' ? `${app} is rescanning… ${done} of ${total} folders done` : `Checking again… ${done} of ${total}`; paintA(); } });
      invalidate(`arr:${ctx.service.key}:${series ? 'series' : 'movie'}`);
      A.phase = 'explaining'; paintA();
      await explainAll();
      A.phase = 'explained';
      toast(A.after.pickedUp ? `${app} picked up ${plural(A.after.pickedUp, 'file', 'files')}` : `${app} didn’t pick up any of them`, A.after.pickedUp ? 'success' : 'info', 6000);
    } catch (e) { A.phase = 'ready'; toast(e.message, 'error'); }
    paintA();
  }

  async function explainAll() {
    A.explained.clear(); A.ticked.clear();
    const entries = A.after.entries.filter((e) => e.files.length);
    let done = 0;
    for (const e of entries) {
      if (!open()) return;
      A.progress = `Asking ${app} about the files that are left… ${done} of ${entries.length} ${series ? 'shows' : 'movies'}`; paintA();
      let rows;
      if (series) { try { rows = await explainSeries(arr, e); } catch (err) { rows = e.files.map((f) => ({ file: f, kind: 'unreadable', why: [err.message], codes: '' })); } }
      else rows = classifyMovieEntry(e);
      A.explained.set(e, rows);
      for (const r of rows) if ((r.kind === 'import' || r.kind === 'link') && canDelete) A.ticked.add(r);
      done += 1;
    }
  }

  async function addPicked() {
    A.busy = true; paintA();
    let ok = 0; let tried = 0;
    try {
      for (const [e, rows] of A.explained) {
        const mine = rows.filter((r) => A.ticked.has(r));
        if (!mine.length) continue;
        tried += mine.length;
        if (series) { const got = await importEpisodeFiles(arr, e, mine.map((r) => r.answer)); for (const r of mine) if (got.has(r.file.path)) { r.done = true; ok += 1; } }
        else { const got = await linkMovies(arr, mine.map((r) => ({ entry: e, file: r.file }))); for (const r of mine) if (got.has(e.item.id)) { r.done = true; ok += 1; } }
        for (const r of mine) A.ticked.delete(r);
      }
      invalidate(`arr:${ctx.service.key}:${series ? 'series' : 'movie'}`);
      toast(ok === tried ? `${series ? 'Added' : 'Linked'} ${plural(ok, 'file', 'files')} where ${ok === 1 ? 'it is' : 'they are'}` : `${series ? 'Added' : 'Linked'} ${ok} of ${tried}; ${app} didn’t take the rest`, ok === tried ? 'success' : 'warn', 7000);
    } catch (e) { toast(e.message, 'error'); }
    A.busy = false; paintA();
  }

  const KIND = {
    import: ['Can be added', 'ok', (r) => `${app} has no file for ${r.codes} yet`],
    link: ['Can be linked', 'ok', () => `${app} can’t tell it’s this movie from the name (it needs a year)`],
    better: ['Better than the file in use', 'info', (r) => `Better than the file ${app} uses for ${r.codes}`],
    copy: ['Another copy', 'muted', (r) => (series ? `Another file is used for ${r.codes}` : `${app} uses another file for this movie`)],
    choose: ['Choose one', 'warn', () => 'Several videos are named for this movie: choose one in Manual Import'],
    unmatched: ['Not recognised', 'warn', () => (series ? `${app} can’t tell which episode this is` : 'The file name doesn’t match the movie')],
    blocked: ['Won’t import', 'warn', (r) => r.why.join('; ')],
    unreadable: ['Couldn’t check', 'down', (r) => r.why.join('; ') || 'No answer for this file'],
  };

  function settingCard() {
    const f = rescanSettingFinding(A.mm && A.mm.rescanAfterRefresh, app);
    if (!f) return null;
    let armed = false;
    const btn = isAdmin ? h('button', { class: 'btn sm primary confirm-btn', type: 'button', onclick: async () => {
      if (!armed) { armed = true; btn.textContent = 'Change it? Click again'; setTimeout(() => { if (armed) { armed = false; btn.textContent = 'Set to Always'; } }, 6000); return; }
      btn.disabled = true;
      try { const mm = await arr.get('config/mediamanagement'); const saved = await arr.put('config/mediamanagement', { ...mm, rescanAfterRefresh: 'always' }); A.mm = saved || { ...mm, rescanAfterRefresh: 'always' }; toast(`${app} now rescans folders after every refresh`, 'success'); paintA(); }
      catch (e) { toast(e.message, 'error'); btn.disabled = false; }
    } }, 'Set to Always') : null;
    return h('div', { class: 'card utf-finding' },
      h('div', { class: 'row-title' }, pill('Setting', 'warn'), ' ', f.title),
      h('p', { class: 'dim addf-note' }, `${f.detail} It’s in ${app} → Settings → Media Management (Show Advanced): “Rescan ${series ? 'Series' : 'Movie'} Folder after Refresh”.`),
      btn ? h('div', {}, btn) : h('p', { class: 'dim addf-note' }, 'An admin can change it.'));
  }

  function entryHead(e) {
    const it = e.item;
    const numbered = e.files.filter((f) => f.numbers);
    const unnumbered = e.files.length - numbered.length;
    const what = series
      ? `${plural(e.files.length, 'video', 'videos')} not tracked${seasonsText(numbered) ? ` · ${seasonsText(numbered)}` : ''}${unnumbered ? ` · ${plural(unnumbered, 'without an episode number', 'without episode numbers')}` : ''}`
      : it.hasFile || it.movieFile ? `${app} uses ${String((it.movieFile && it.movieFile.relativePath) || 'a file').split(/[\\/]/).pop()}; ${plural(e.files.length, 'other video', 'other videos')}` : `${app} has no file for it; ${plural(e.files.length, 'video', 'videos')} in its folder`;
    return h('div', {},
      h('div', { class: 'row-title addf-name' }, `${it.title}${it.year ? ` (${it.year})` : ''}`, ' ', h('span', { class: 'dim' }, what)),
      h('div', { class: 'addf-path' }, copyable(it.path)),
      e.disc ? h('div', { class: 'dim addf-note' }, `Also a Blu-ray or DVD folder structure (${plural(e.disc, 'file', 'files')}); ${app} can’t import those.`) : null);
  }

  function fileList(files, max = 8) {
    const shown = files.slice(0, max);
    return h('div', { class: 'utf-files' }, ...shown.map((f) => h('div', { class: 'mono dim' }, f.rel || f.name)), files.length > max ? h('div', { class: 'dim' }, `and ${files.length - max} more`) : null);
  }

  function renderFolders(el) {
    aEl = el;
    if (A.phase === 'new') { setTimeout(startScan, 0); A.phase = 'scanning'; }
    if (A.phase === 'scanning') return mount(el, h('div', { class: 'meta-line' }, spinner(), h('span', {}, A.progress)));
    if (A.phase === 'error') return mount(el, empty('', `Couldn’t read the ${thing} folders`, A.error));
    const intro = h('p', { class: 'dim settings-copy' }, `Videos inside a ${thing}’s own folder that ${app} doesn’t track. A rescan makes ${app} record the ones it can read where they are: nothing is moved, renamed or downloaded.`);
    if (A.phase === 'ready') {
      const entries = A.scan.entries;
      const files = entries.reduce((n, e) => n + e.files.length, 0);
      const rescannable = entries.filter((e) => e.files.length);
      const btn = canWrite && rescannable.length ? h('button', { class: 'btn primary', type: 'button', onclick: rescan }, `Rescan ${plural(rescannable.length, series ? 'show' : 'movie', series ? 'shows' : 'movies')}`) : null;
      return mount(el, intro, settingCard(),
        h('div', { class: 'meta-line addf-counts' }, h('span', { class: 'dim' }, `${plural(A.scan.checked, `${thing} folder`, `${thing} folders`)} checked`), pill(`${plural(files, 'video', 'videos')} not tracked`, files ? 'warn' : 'ok'), entries.length ? pill(`in ${plural(entries.length, series ? 'show' : 'movie', series ? 'shows' : 'movies')}`, 'muted') : null, A.scan.unreadable ? pill(`${A.scan.unreadable} not readable`, 'muted') : null,
          entries.length ? h('button', { class: 'btn sm', type: 'button', style: { marginLeft: 'auto' }, onclick: () => downloadCsv(`untracked-${ctx.service.key}-${stamp()}.csv`, toCsv(['Title', 'Folder', 'File'], entries.flatMap((e) => e.files.map((f) => [e.item.title, e.item.path, f.path])))) }, 'Export CSV') : null),
        entries.length ? h('div', { class: 'list' }, ...entries.map((e) => h('div', { class: 'row', style: { alignItems: 'flex-start' } }, h('div', { class: 'row-main' }, entryHead(e), fileList(e.files))))) : empty('✓', 'Nothing untracked', `Every video in the ${thing} folders is one ${app} tracks.`),
        btn ? h('div', { class: 'addf-foot' }, btn) : rescannable.length ? h('p', { class: 'dim settings-copy' }, 'Your role can’t start a rescan.') : null);
    }
    if (A.phase === 'rescanning' || A.phase === 'explaining') return mount(el, intro, h('div', { class: 'meta-line' }, spinner(), h('span', {}, A.progress)));
    // explained
    const entries = A.after.entries;
    const rowsAll = [...A.explained.values()].flat();
    const n = rowsAll.filter((r) => A.ticked.has(r)).length;
    const anyCopies = rowsAll.some((r) => r.kind === 'copy' || r.kind === 'better');
    let armed = false;
    const go = h('button', { class: 'btn primary confirm-btn', type: 'button', disabled: !n || A.busy ? 'disabled' : null, onclick: () => {
      if (!armed) { armed = true; go.textContent = `${series ? 'Add' : 'Link'} ${plural(n, 'file', 'files')}? Click again`; setTimeout(() => { if (armed && !A.busy) { armed = false; go.textContent = label; } }, 6000); return; }
      addPicked();
    } });
    const label = A.busy ? 'Working…' : n ? `${series ? 'Add' : 'Link'} ${plural(n, 'file', 'files')} where ${n === 1 ? 'it is' : 'they are'}` : `Choose files to ${series ? 'add' : 'link'}`;
    go.textContent = label;
    return mount(el, intro, settingCard(),
      h('div', { class: 'card utf-result' }, h('div', { class: 'row-title' }, A.after.pickedUp ? `${app} picked up ${plural(A.after.pickedUp, 'file', 'files')}.` : `${app} didn’t pick up any of them.`, ' ', entries.length ? `${plural(rowsAll.length, 'file is', 'files are')} still untracked:` : 'Nothing is left untracked.'),
        A.after.failed ? h('p', { class: 'dim addf-note' }, `${plural(A.after.failed, 'rescan', 'rescans')} didn’t finish; ${app}’s queue (System → Tasks) shows why.`) : null),
      entries.length ? h('div', { class: 'list' }, ...entries.map((e) => {
        const rows = A.explained.get(e) || [];
        return h('div', { class: 'row', style: { alignItems: 'flex-start' } }, h('div', { class: 'row-main' }, entryHead(e),
          ...rows.slice(0, 40).map((r) => {
            const [word, cls, text] = KIND[r.kind] || KIND.blocked;
            const box = (r.kind === 'import' || r.kind === 'link') && canDelete && !r.done ? h('input', { type: 'checkbox', checked: A.ticked.has(r) ? 'checked' : null, 'aria-label': `${series ? 'Add' : 'Link'} ${r.file.name}`, onchange: (ev) => { if (ev.target.checked) A.ticked.add(r); else A.ticked.delete(r); paintA(); } }) : null;
            return h('label', { class: 'utf-file' }, box, h('span', { class: 'utf-file-main' }, h('span', { class: 'mono' }, r.file.rel || r.file.name), ' ', r.done ? pill(series ? 'Added' : 'Linked', 'ok') : pill(word, cls), h('span', { class: 'dim' }, ` ${text(r)}`)));
          }),
          rows.length > 40 ? h('div', { class: 'dim addf-note' }, `and ${rows.length - 40} more (in the CSV)`) : null));
      })) : null,
      anyCopies ? h('div', { class: 'card utf-finding' }, h('p', { class: 'addf-note' }, `Some are other copies of ${series ? 'episodes' : 'movies'} ${app} already has a file for. Find duplicates compares each copy with the one ${app} uses.`), h('div', {}, h('button', { class: 'btn sm', type: 'button', onclick: openDuplicates }, 'Open Find duplicates'))) : null,
      rowsAll.some((r) => r.kind === 'unmatched' || r.kind === 'choose') ? h('p', { class: 'dim settings-copy' }, `For the ones ${app} doesn’t recognise, use Manual Import in ${app} (Wanted → Missing → Manual Import) and choose the ${series ? 'episode' : 'movie'} yourself.`) : null,
      !canDelete && rowsAll.some((r) => (r.kind === 'import' || r.kind === 'link') && !r.done) ? h('p', { class: 'dim settings-copy' }, `Only admins can ${series ? 'add' : 'link'} them here.`) : null,
      entries.length ? h('div', { class: 'addf-foot' }, h('button', { class: 'btn sm', type: 'button', onclick: () => downloadCsv(`untracked-${ctx.service.key}-${stamp()}.csv`, toCsv(['Title', 'Folder', 'File', 'Episodes', 'Status'], entries.flatMap((e) => (A.explained.get(e) || []).map((r) => [e.item.title, e.item.path, r.file.path, r.codes || '', r.done ? (series ? 'added' : 'linked') : KIND[r.kind] ? KIND[r.kind][2](r) : r.kind])))) }, 'Export CSV'), canDelete && rowsAll.some((r) => (r.kind === 'import' || r.kind === 'link') && !r.done) ? go : null) : null);
  }

  // ============================================================= part 2
  const B = { phase: 'new', progress: '', found: null, stop: false, ticked: new Set(), started: 0, busy: false, show: {}, mm: null };
  let bEl = null;
  const paintB = () => { if (active === 'leftovers' && bEl && bEl.isConnected) renderLeftovers(bEl); };

  async function find() {
    B.phase = 'finding'; paintB();
    try {
      const [found, mm] = await Promise.all([leftoverCandidates(arr, { kind }), arr.get('config/mediamanagement').catch(() => null)]);
      B.found = found; B.mm = mm; B.phase = 'found';
    } catch (e) { B.phase = 'error'; B.error = e.message; }
    paintB();
  }
  async function check() {
    B.phase = 'checking'; B.stop = false; B.started = Date.now(); paintB();
    const total = B.found.candidates.length;
    const already = B.found.candidates.filter((c) => c.status === 'checked').length;
    let last = 0;
    await checkLeftovers(arr, B.found.candidates, { kind, shouldStop: () => B.stop || !open(), onProgress: ({ done }) => {
      const newly = Math.max(1, done - already); const per = (Date.now() - B.started) / newly; const left = Math.round(((total - done) * per) / 60000);
      B.progress = `Checked ${done} of ${total}${done - already >= 6 ? ` · about ${left < 1 ? 'a minute' : plural(left, 'minute', 'minutes')} left` : ''}`;
      if (Date.now() - last > 700) { last = Date.now(); paintB(); }
    } });
    for (const c of B.found.candidates) for (const x of c.items || []) if (x.cls === 'missing' && canDelete && !x.imported) B.ticked.add(x);
    B.phase = B.found.candidates.every((c) => c.status === 'checked' || c.status === 'error') ? 'done' : 'stopped';
    paintB();
  }

  async function importPicked() {
    const picks = [];
    for (const c of B.found.candidates) for (const x of c.items || []) if (B.ticked.has(x) && !x.imported) picks.push(x);
    if (!picks.length) return;
    B.busy = true; B.progress = `${app} is importing ${plural(picks.length, 'file', 'files')}…`; paintB();
    try {
      const res = await importLeftovers(arr, picks.map((x) => ({ item: x.item, candidate: x.candidate })), { kind, onProgress: ({ done, total }) => { B.progress = `${app} is importing… ${done} of ${total}`; paintB(); } });
      let ok = 0;
      for (const x of picks) { B.ticked.delete(x); if (res.moved.has(x.item.path)) { x.imported = true; ok += 1; } }
      invalidate(`arr:${ctx.service.key}:${series ? 'series' : 'movie'}`);
      toast(ok === picks.length ? `Imported ${plural(ok, 'file', 'files')}` : `Imported ${ok} of ${picks.length}; ${app}’s Activity → History shows why the rest weren’t`, ok === picks.length ? 'success' : 'warn', 8000);
    } catch (e) { toast(e.message, 'error'); }
    B.busy = false; paintB();
  }

  function group(cls, rows, { tickable = false } = {}) {
    if (!rows.length) return null;
    const max = B.show[cls] || 25;
    const bytes = rows.reduce((n, x) => n + (Number(x.item.size) || 0), 0);
    const NOTE = {
      missing: `${app} has no file for these. Importing moves each one into its ${thing}’s folder and renames it, as ${app} does with downloads.`,
      upgrade: `Better than the file ${app} uses now. Importing replaces that file, which goes to ${!B.mm ? `${app}’s Recycle Bin if one is set` : B.mm.recycleBin ? `${app}’s Recycle Bin (${B.mm.recycleBin})` : `${app}’s Recycle Bin; none is set, so the old files would be deleted`}.`,
      redundant: `${app} already has the same or a better file for each of these. They’re listed and exported only: nothing here deletes them. When you’ve checked them, remove the folders yourself.`,
      unknown: `${app} doesn’t have these ${thing}s. Add the ${thing} in ${app} first if you want them.`,
      unmatched: `${app} can’t tell which episode these are. Manual Import in ${app} lets you choose.`,
      blocked: `${app} won’t import these, for the reason shown.`,
    }[cls];
    return h('div', { class: 'utf-group' },
      h('div', { class: 'addf-skip-title' }, `${LEFTOVER_LABEL[cls]} (${plural(rows.length, 'file', 'files')}${bytes ? `, ${fmtBytes(bytes)}` : ''})`),
      h('p', { class: 'dim addf-note' }, NOTE),
      cls === 'redundant' ? h('div', { class: 'meta-line' }, h('button', { class: 'btn sm', type: 'button', onclick: () => { const text = redundantPaths(B.found.candidates).join('\n'); if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => toast('Copied the paths', 'success', 1600)).catch(() => {}); } }, 'Copy their paths')) : null,
      h('div', { class: 'list' }, ...rows.slice(0, max).map((x) => {
        const box = tickable && canDelete && !x.imported ? h('input', { type: 'checkbox', checked: B.ticked.has(x) ? 'checked' : null, 'aria-label': `Import ${x.item.path}`, onchange: (ev) => { if (ev.target.checked) B.ticked.add(x); else B.ticked.delete(x); paintB(); } }) : null;
        const q = x.item.quality && x.item.quality.quality && x.item.quality.quality.name;
        return h('label', { class: 'row utf-left' }, box,
          h('div', { class: 'row-main' },
            h('div', { class: 'row-title addf-name' }, x.title || x.candidate.name, x.codes ? h('span', { class: 'dim' }, x.codes) : null, q ? pill(q, 'muted') : null, x.item.size ? h('span', { class: 'dim' }, fmtBytes(Number(x.item.size))) : null, x.imported ? pill('Imported', 'ok') : null),
            h('div', { class: 'addf-path' }, copyable(x.item.path)),
            x.why.length && cls !== 'redundant' ? h('div', { class: 'dim addf-note' }, x.why.join('; ')) : null));
      })),
      rows.length > max ? h('button', { class: 'btn sm', type: 'button', onclick: () => { B.show[cls] = max + 100; paintB(); } }, `Show ${Math.min(100, rows.length - max)} more`) : null);
  }

  // Download folders with no videos left (the app imported them, or they
  // never had any): listed, not deleted.
  function emptyGroup(list) {
    if (!list.length) return null;
    return h('div', { class: 'utf-group' },
      h('div', { class: 'addf-skip-title' }, `Download folders with no videos left (${list.length})`),
      h('p', { class: 'dim addf-note' }, `Usually ${app} imported the video and the rest stayed behind (.nfo, .nzb, subtitles)${list.some((c) => /^_FAILED_/i.test(c.name)) ? ', or the download failed (SABnzbd names those “_FAILED_…”)' : ''}. ${app} only clears a download’s folder when the folder is named like the download, so second copies SABnzbd saved as “.1” stay. Nothing here deletes them.`),
      h('div', { class: 'meta-line' }, h('button', { class: 'btn sm', type: 'button', onclick: () => { const text = list.map((c) => c.path).join('\n'); if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => toast('Copied the paths', 'success', 1600)).catch(() => {}); } }, 'Copy their paths')),
      h('div', { class: 'dim addf-skip-names' }, list.slice(0, 60).map((c) => c.name).join(' · '), list.length > 60 ? ` · and ${list.length - 60} more` : ''));
  }

  function renderLeftovers(el) {
    bEl = el;
    if (B.phase === 'new') { setTimeout(find, 0); B.phase = 'finding'; }
    const intro = h('p', { class: 'dim settings-copy' }, `Downloads left in a root folder next to the ${thing}s: ${series ? 'episode and season downloads, release folders, loose videos' : 'release folders and loose videos'}. ${app} checks each one with its own Manual Import. Nothing is deleted here; redundant downloads are listed for you to remove.`);
    if (B.phase === 'finding') return mount(el, intro, h('div', { class: 'meta-line' }, spinner(), h('span', {}, 'Reading the root folders…')));
    if (B.phase === 'error') return mount(el, intro, empty('', 'Couldn’t read the root folders', B.error));
    const cands = B.found.candidates;
    if (!cands.length) return mount(el, intro, empty('✓', 'No leftover downloads', `${app}’s root folders hold only ${thing} folders.`));
    const byRoot = new Map(); for (const c of cands) byRoot.set(c.root, (byRoot.get(c.root) || 0) + 1);
    const where = h('div', { class: 'meta-line addf-counts' }, ...[...byRoot].map(([r, n]) => pill(`${r}: ${n}`, 'muted')));
    if (B.phase === 'found') {
      return mount(el, intro, where,
        h('div', { class: 'card utf-finding' },
          h('div', { class: 'row-title' }, `${plural(cands.length, 'download', 'downloads')} to check`),
          h('p', { class: 'dim addf-note' }, `${app} reads each file’s media info, so this takes a while for big folders. The time left shows once the first few are done. You can stop and carry on later while the dialog is open.`),
          h('button', { class: 'btn primary', type: 'button', onclick: check }, 'Check them')));
    }
    const sum = leftoverSummary(cands);
    const by = (cls) => cands.flatMap((c) => (c.items || []).filter((x) => x.cls === cls));
    const counts = h('div', { class: 'meta-line addf-counts' },
      ...['missing', 'upgrade', 'redundant', 'unknown', 'unmatched', 'blocked'].filter((k) => sum.by[k].files).map((k) => pill(`${sum.by[k].files} ${LEFTOVER_LABEL[k].toLowerCase()}`, { missing: 'ok', upgrade: 'info', redundant: 'warn', unknown: 'muted', unmatched: 'muted', blocked: 'muted' }[k])),
      sum.imported.files ? pill(`${sum.imported.files} imported`, 'ok') : null,
      sum.errors ? pill(`${sum.errors} couldn’t be checked`, 'down') : null,
      h('button', { class: 'btn sm', type: 'button', style: { marginLeft: 'auto' }, onclick: () => downloadCsv(`leftover-downloads-${ctx.service.key}-${stamp()}.csv`, toCsv(LEFTOVER_CSV_HEADERS, leftoverCsvRows(cands))) }, 'Export CSV'));
    if (B.phase === 'checking') {
      return mount(el, intro, where, h('div', { class: 'meta-line', style: { marginBottom: '8px' } }, spinner(), h('span', {}, B.progress || 'Starting…'), h('button', { class: 'btn sm', type: 'button', onclick: () => { B.stop = true; B.progress = 'Stopping after the ones in progress…'; paintB(); } }, 'Stop')), counts);
    }
    const n = [...B.ticked].filter((x) => !x.imported).length;
    const replacing = [...B.ticked].some((x) => x.cls === 'upgrade');
    const ack = h('input', { type: 'checkbox' });
    let armed = false;
    // Red only when an import replaces a file (the old one goes to the Recycle Bin).
    const go = h('button', { class: `btn primary${replacing ? ' danger' : ''} confirm-btn`, type: 'button' });
    const label = () => (B.busy ? B.progress : n ? `Import ${plural(n, 'file', 'files')}` : 'Choose files to import');
    const setGo = () => { go.textContent = armed ? `Import ${plural(n, 'file', 'files')}? Click again` : label(); go.disabled = !n || B.busy || (replacing && !(B.mm && B.mm.recycleBin) && !ack.checked); };
    ack.addEventListener('change', setGo);
    go.addEventListener('click', () => { if (!armed) { armed = true; setGo(); setTimeout(() => { if (armed && !B.busy) { armed = false; setGo(); } }, 6000); return; } armed = false; importPicked(); });
    setGo();
    return mount(el, intro, where,
      B.phase === 'stopped' ? h('div', { class: 'meta-line', style: { marginBottom: '8px' } }, h('span', { class: 'dim' }, `Stopped: ${sum.checked} of ${cands.length} checked.`), h('button', { class: 'btn sm', type: 'button', onclick: check }, 'Carry on')) : null,
      counts,
      group('missing', by('missing'), { tickable: true }),
      group('upgrade', by('upgrade'), { tickable: true }),
      group('redundant', by('redundant')),
      group('unknown', by('unknown')),
      group('unmatched', by('unmatched')),
      group('blocked', by('blocked')),
      emptyGroup(cands.filter((c) => c.status === 'checked' && c.type === 'folder' && !(c.items || []).length)),
      !cands.some((c) => (c.items || []).some((x) => (x.cls === 'missing' || x.cls === 'upgrade') && !x.imported)) ? null
      : canDelete ? h('div', { class: 'addf-foot utf-foot' },
        replacing && !(B.mm && B.mm.recycleBin) ? h('label', { class: 'utf-ack' }, ack, B.mm ? 'No Recycle Bin is set: replaced files are deleted. I understand.' : 'Couldn’t read the Recycle Bin setting: replaced files may be deleted. I understand.') : null, go)
        : h('p', { class: 'dim settings-copy' }, 'Only admins can import here: an import can replace a file.'));
  }

  // ============================================================= tabs
  const panel = h('div', { class: 'utf-panel' });
  const bar = tabs(panel, [
    { id: 'folders', label: series ? 'In show folders' : 'In movie folders', render: renderFolders },
    { id: 'leftovers', label: 'Leftover downloads', render: renderLeftovers },
  ], null, { activeId: active, onChange: (id) => { active = id; } });
  mount(body, bar, panel);
}
