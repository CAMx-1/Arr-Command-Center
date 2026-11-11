// "Add existing folders" (System tab): folders in the root folders that Sonarr
// or Radarr doesn't manage yet, matched by name, added at their own path.
// Nothing is moved, renamed or searched for; monitoring is off by default.
import { h, mount, spinner, empty, toast, openModal, copyable } from './ui.js';
import { roleAllows } from './roleUi.js';
import { invalidate } from './cache.js';
import { pathKey } from './pathDoctor.js';
import { toCsv, downloadCsv, stamp } from './csv.js';
import { SERIES_MONITOR, MOVIE_MONITOR, SERIES_TYPES, SKIP_REASONS, displayTitle } from './existingFolders.js';
import { readExistingFolders, lookUpRows, lookUpRow, pickChoice, markSameTitles, canAdd, tickedByDefault, addRows, linkAddedFiles, folderCsvRows, FOLDER_CSV_HEADERS } from './existingFoldersScan.js';

const HIDE_KEY = (svc) => `add-folders-hidden-${svc}`;
function loadHidden(svc) { try { const v = JSON.parse(localStorage.getItem(HIDE_KEY(svc)) || '[]'); return new Set(Array.isArray(v) ? v : []); } catch { return new Set(); } }
function saveHidden(svc, set) { try { localStorage.setItem(HIDE_KEY(svc), JSON.stringify([...set].slice(-3000))); } catch { /* storage full */ } }

const CONF = {
  exact: ['Same name and year', 'ok'],
  likely: ['Same name', 'ok'],
  picked: ['Chosen by you', 'info'],
  unsure: ['Check', 'warn'],
  none: ['No match found', 'muted'],
};
const MIN_AVAIL = [['announced', 'Announced'], ['inCinemas', 'In cinemas'], ['released', 'Released']];

export async function openExistingFolders(arr, ctx, kind) {
  const app = ctx.service.label;
  const series = kind === 'series';
  const noun = (n) => (series ? 'series' : n === 1 ? 'movie' : 'movies');
  const body = h('div', { class: 'addf' });
  openModal({ title: `Add existing folders — ${app}`, body, wide: true });
  const canWrite = roleAllows('write');
  const hidden = loadHidden(ctx.service.key);

  const progress = h('span', { class: 'dim' }, 'Reading root folders…');
  mount(body, h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center' } }, spinner(), progress));
  let scan;
  try {
    scan = await readExistingFolders(arr, { kind, hidden, onProgress: ({ stage, done, total }) => {
      progress.textContent = stage === 'roots' ? `Reading root folders… ${done}/${total}` : `Counting video files… ${done}/${total} folders`;
    } });
  } catch (e) { mount(body, empty('', 'Couldn’t read the root folders', e.message)); return; }
  if (!scan.roots.length) { mount(body, empty('', 'No root folders to read', `${app} has no root folder it can reach.`)); return; }

  const ticked = new Set();
  const settings = { monitor: 'none', roots: new Map([...scan.defaults].map(([root, d]) => [root, { ...d }])) };
  let looking = true; let lookedUp = 0; let adding = false; let checking = null;
  const results = { linked: [], unread: [] };
  let showSkipped = false; let showExisting = false;

  const idOf = (r) => (r.match && r.match.pick ? (series ? r.match.pick.tvdbId : r.match.pick.tmdbId) : null);
  const settingsFor = (row) => ({ ...(settings.roots.get(row.folder.root) || {}), monitor: settings.monitor });

  // ------------------------------------------------------------ on screen
  // The pieces that change on their own, so a tick or a lookup updates only
  // what it touches (a full redraw of hundreds of rows takes most of a second).
  const rowEls = new Map();
  let progressEl = null; let countsEl = null; let settingsEl = null; let skippedEl = null; let resultsEl = null;
  const keep = (row) => { const el = rowEl(row); rowEls.set(row, el); return el; };
  const refreshRow = (row) => { const el = rowEls.get(row); if (el && el.isConnected) el.replaceWith(keep(row)); };
  const offerRows = () => scan.rows.filter((r) => !(r.match && r.match.existing) || r.status === 'added');
  const existingRows = () => scan.rows.filter((r) => r.match && r.match.existing && r.status !== 'added');

  // One folder per title: ticking one unticks the others for the same title.
  function tick(row, on) {
    if (on) {
      for (const other of scan.rows) {
        if (other === row || !ticked.has(other) || !idOf(other) || idOf(other) !== idOf(row)) continue;
        ticked.delete(other);
        const box = rowEls.get(other) && rowEls.get(other).querySelector('input[type=checkbox]');
        if (box) box.checked = false;
      }
      ticked.add(row);
    } else ticked.delete(row);
    refreshCounts();
  }
  // After a match changes, rows marked "same show/movie as…" can change too.
  // tickIt: tick the row (a match you chose) or a test run after re-marking.
  function rematched(row, tickIt) {
    const before = new Map(scan.rows.map((r) => [r, r.sameAs]));
    markSameTitles(scan.rows, kind);
    const want = typeof tickIt === 'function' ? tickIt() : tickIt;
    if (want && canAdd(row) && canWrite && !row.sameAs) tick(row, true); else ticked.delete(row);
    for (const r of scan.rows) if (r === row || before.get(r) !== r.sameAs) { if (r.sameAs) ticked.delete(r); refreshRow(r); }
    refreshCounts();
  }

  // ------------------------------------------------------------- settings
  function settingsCard() {
    const opts = series ? SERIES_MONITOR : MOVIE_MONITOR;
    const monitor = h('select', { class: 'input', 'aria-label': 'Monitor', onchange: (e) => { settings.monitor = e.target.value; refreshSettings(); } },
      ...opts.map(([v, label]) => h('option', { value: v, selected: v === settings.monitor ? 'selected' : null }, label)));
    const profileOpts = (sel) => (scan.profiles || []).map((p) => h('option', { value: p.id, selected: Number(sel) === p.id ? 'selected' : null }, p.name));
    const rootRows = [...settings.roots].filter(([root]) => scan.rows.some((r) => r.folder.root === root)).map(([root, d]) => h('div', { class: 'addf-root' },
      h('div', { class: 'mono addf-root-path' }, root),
      h('label', { class: 'addf-field' }, h('span', { class: 'dim' }, 'Quality profile'),
        h('select', { class: 'input', 'aria-label': `Quality profile for ${root}`, onchange: (e) => { d.qualityProfileId = Number(e.target.value); } }, ...profileOpts(d.qualityProfileId))),
      series ? h('label', { class: 'addf-field' }, h('span', { class: 'dim' }, 'Series type'),
        h('select', { class: 'input', 'aria-label': `Series type for ${root}`, onchange: (e) => { d.seriesType = e.target.value; } },
          ...SERIES_TYPES.map(([v, label]) => h('option', { value: v, selected: v === (d.seriesType || 'standard') ? 'selected' : null }, label)))) : null,
      series
        ? h('label', { class: 'addf-switch' }, h('input', { type: 'checkbox', role: 'switch', checked: d.seasonFolder !== false ? 'checked' : null, onchange: (e) => { d.seasonFolder = e.target.checked; } }), 'Season folders')
        : h('label', { class: 'addf-field' }, h('span', { class: 'dim' }, 'Minimum availability'),
          h('select', { class: 'input', 'aria-label': `Minimum availability for ${root}`, onchange: (e) => { d.minimumAvailability = e.target.value; } },
            ...MIN_AVAIL.map(([v, label]) => h('option', { value: v, selected: v === d.minimumAvailability ? 'selected' : null }, label))))));
    return h('div', { class: 'card addf-settings' },
      h('label', { class: 'addf-field' }, h('span', { class: 'dim' }, series ? 'Monitor' : 'Monitored'), monitor),
      h('p', { class: 'dim addf-note' }, settings.monitor === 'none'
        ? `${app} won’t download anything for these. Nothing is searched for when they’re added.`
        : `Nothing is searched for when they’re added, but ${app} can download ${series ? (settings.monitor === 'all' ? 'missing and better episodes' : 'better copies of the episodes you have') : 'a better copy'} later.`),
      ...rootRows);
  }
  function refreshSettings() { if (settingsEl && settingsEl.isConnected) { const next = settingsCard(); settingsEl.replaceWith(next); settingsEl = next; } }

  // ----------------------------------------------------------------- rows
  function matchSelect(row) {
    const m = row.match;
    if (!m || !m.choices.length) return null;
    return h('select', { class: 'input addf-pick', 'aria-label': `Match for ${row.folder.name}`, disabled: adding || row.status === 'added' ? 'disabled' : null, onchange: (e) => {
      pickChoice(row, m.choices[Number(e.target.value)], { kind, library: scan.library });
      rematched(row, true);
    } }, ...m.choices.map((c, i) => h('option', { value: i, selected: c === m.pick ? 'selected' : null }, `${displayTitle(c)}${c.network || c.studio ? ` · ${c.network || c.studio}` : ''}`)));
  }
  function searchAgain(row, holder) {
    const input = h('input', { class: 'input', type: 'search', value: row.term || '', placeholder: 'Another name to search for', 'aria-label': `Search name for ${row.folder.name}` });
    const go = h('button', { class: 'btn sm', type: 'button', onclick: async () => {
      const term = input.value.trim(); if (!term) return;
      go.disabled = true;
      await lookUpRow(arr, row, { kind, library: scan.library, term });
      rematched(row, () => tickedByDefault(row));
    } }, 'Search');
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go.click(); });
    mount(holder, h('div', { class: 'addf-search' }, input, go));
    input.focus();
  }
  function rowEl(row) {
    const m = row.match;
    const holder = h('div', {});
    const box = canWrite ? h('input', { type: 'checkbox', checked: ticked.has(row) ? 'checked' : null, disabled: !canAdd(row) || adding ? 'disabled' : null, 'aria-label': `Add ${row.folder.name}`, onchange: (e) => tick(row, e.target.checked) }) : null;
    const [label, cls] = m ? CONF[m.confidence] || CONF.none : ['Looking up…', 'muted'];
    const status = row.status === 'added' ? h('span', { class: 'pill ok' }, 'Added')
      : row.status === 'failed' ? h('span', { class: 'pill down' }, row.error)
        : m && m.existing ? h('span', { class: 'pill muted' }, `Already in ${app}${m.existing.path ? ` at ${m.existing.path}` : ''}`)
          : row.sameAs ? h('span', { class: 'pill muted' }, `Same ${series ? 'show' : 'movie'} as ${row.sameAs.split(/[\\/]/).pop()}`)
            : h('span', { class: `pill ${cls}` }, label);
    return h('div', { class: `row addf-row${row.status === 'added' ? ' done' : ''}` },
      box ? h('label', { class: 'addf-tick' }, box) : null,
      h('div', { class: 'row-main' },
        h('div', { class: 'row-title addf-name' }, row.folder.name, ' ', h('span', { class: 'dim' }, row.videos == null ? '' : `${row.videos} video ${row.videos === 1 ? 'file' : 'files'}`), row.parsed.kind === 'pack' ? h('span', { class: 'pill muted' }, 'Several seasons in one folder') : null),
        h('div', { class: 'addf-path' }, copyable(row.folder.path)),
        h('div', { class: 'addf-match' }, m ? (matchSelect(row) || h('span', { class: 'dim' }, 'No match found')) : null, status,
          m && m.why && m.confidence === 'unsure' ? h('span', { class: 'dim addf-why' }, m.why) : null),
        holder),
      h('div', { class: 'row-actions' },
        m && row.status !== 'added' && canWrite ? h('button', { class: 'btn sm', type: 'button', title: 'Search for a different name', onclick: () => searchAgain(row, holder) }, 'Search…') : null,
        row.status !== 'added' ? h('button', { class: 'btn sm', type: 'button', title: 'Don’t offer this folder again', onclick: () => {
          hidden.add(pathKey(row.folder.path)); saveHidden(ctx.service.key, hidden);
          ticked.delete(row); scan.rows = scan.rows.filter((r) => r !== row);
          scan.skipped.push({ folder: row.folder, reason: 'hidden', parsed: row.parsed });
          const el = rowEls.get(row); if (el) el.remove(); rowEls.delete(row);
          refreshCounts(); refreshSkipped();
        } }, 'Hide') : null));
  }

  function skippedSection() {
    if (!scan.skipped.length) return h('div', {});
    const groups = new Map();
    for (const s of scan.skipped) { if (!groups.has(s.reason)) groups.set(s.reason, []); groups.get(s.reason).push(s); }
    return h('div', { style: { marginTop: '12px' } },
      h('button', { class: 'btn sm', type: 'button', 'aria-expanded': String(showSkipped), onclick: () => { showSkipped = !showSkipped; refreshSkipped(); } }, showSkipped ? 'Hide folders that aren’t offered' : `Folders that aren’t offered (${scan.skipped.length})`),
      showSkipped ? h('div', { class: 'addf-skipped' }, ...[...groups].map(([reason, list]) => h('div', {},
        h('div', { class: 'addf-skip-title' }, `${SKIP_REASONS[reason] || reason} (${list.length})`),
        h('div', { class: 'dim addf-skip-names' }, list.slice(0, 60).map((s) => s.folder.name).join(' · '), list.length > 60 ? ` · and ${list.length - 60} more` : ''),
        reason === 'hidden' ? h('button', { class: 'btn sm', type: 'button', onclick: () => { for (const s of list) hidden.delete(pathKey(s.folder.path)); saveHidden(ctx.service.key, hidden); toast('Hidden folders will be offered again next time', 'success'); } }, 'Show them again next time') : null))) : null);
  }
  function refreshSkipped() { if (skippedEl && skippedEl.isConnected) { const next = skippedSection(); skippedEl.replaceWith(next); skippedEl = next; } }

  // --------------------------------------------------------------- counts
  const go = h('button', { class: 'btn primary confirm-btn', type: 'button' });
  let armed = false;
  function updateGo() {
    const n = scan.rows.filter((r) => ticked.has(r) && canAdd(r)).length;
    go.disabled = !n || adding || !canWrite;
    if (!adding) go.textContent = n ? (armed ? `Add ${n} ${noun(n)}? Click again` : `Add ${n} ${noun(n)}`) : `Choose ${series ? 'series' : 'movies'} to add`;
  }
  function countsContent() {
    const offer = offerRows(); const existing = existingRows();
    const ready = offer.filter((r) => r.match && ['exact', 'likely', 'picked'].includes(r.match.confidence) && !r.sameAs && r.status !== 'added').length;
    const check = offer.filter((r) => r.match && (r.match.confidence === 'unsure' || r.match.confidence === 'none' || r.sameAs) && r.status !== 'added').length;
    const added = scan.rows.filter((r) => r.status === 'added').length;
    return [
      h('span', { class: 'pill ok' }, `${ready} ready`), h('span', { class: 'pill warn' }, `${check} to check`),
      existing.length ? h('span', { class: 'pill muted' }, `${existing.length} already in ${app}`) : null,
      added ? h('span', { class: 'pill info' }, `${added} added`) : null,
      h('button', { class: 'btn sm', type: 'button', style: { marginLeft: 'auto' }, onclick: () => downloadCsv(`existing-folders-${ctx.service.key}-${stamp()}.csv`, toCsv(FOLDER_CSV_HEADERS, folderCsvRows(scan.rows, scan.skipped, { app, reasons: SKIP_REASONS }))) }, 'Export CSV'),
    ];
  }
  function refreshCounts() { if (countsEl && countsEl.isConnected) mount(countsEl, ...countsContent()); updateGo(); }

  // ---------------------------------------------------------------- adding
  go.addEventListener('click', async () => {
    const chosen = scan.rows.filter((r) => ticked.has(r) && canAdd(r));
    if (!chosen.length) return;
    if (!armed) { armed = true; updateGo(); setTimeout(() => { if (armed && !adding) { armed = false; updateGo(); } }, 6000); return; }
    armed = false; adding = true; updateGo();
    for (const r of chosen) refreshRow(r); // their boxes and pickers lock
    const res = await addRows(arr, chosen, { kind, settingsFor, onProgress: ({ done, total, row }) => { go.textContent = `Adding ${done} of ${total}…`; refreshRow(row); } });
    adding = false;
    for (const r of res.added) ticked.delete(r);
    invalidate(`arr:${ctx.service.key}:${series ? 'series' : 'movie'}`);
    invalidate(`arr:${ctx.service.key}:rootfolder`);
    if (res.failed.length) toast(`${res.failed.length} couldn’t be added; see the list`, 'error', 8000);
    if (!res.added.length) { paint(); return; }
    // Wait for the app to read the new folders, then link the movie files it
    // couldn't parse and list the files it still can't read.
    checking = `${app} is reading the files in ${res.added.length} ${res.added.length === 1 ? 'folder' : 'folders'}…`;
    paint();
    try {
      const link = await linkAddedFiles(arr, res.added, { kind, link: roleAllows('delete'), onProgress: ({ done, total }) => { checking = `Checking the files ${app} read… ${done}/${total}`; refreshResults(); } });
      results.linked.push(...link.linked); results.unread.push(...link.unread);
      toast(`Added ${res.added.length} ${noun(res.added.length)}${link.linked.length ? `; linked ${link.linked.length} ${link.linked.length === 1 ? 'file' : 'files'} ${app} couldn’t match by name` : ''}`, 'success', 7000);
    } catch (e) { toast(`Added ${res.added.length} ${noun(res.added.length)}, but couldn’t check their files: ${e.message}`, 'warn', 8000); }
    checking = null;
    paint();
  });

  function resultsCard() {
    if (checking) return h('div', { class: 'card addf-results' }, h('div', { class: 'meta-line' }, spinner(), h('span', {}, checking)));
    if (!results.linked.length && !results.unread.length) return h('div', {});
    const files = results.unread.reduce((n, u) => n + u.files.length, 0);
    return h('div', { class: 'card addf-results' },
      results.linked.length ? h('div', {},
        h('div', { class: 'addf-skip-title' }, `Linked ${results.linked.length} ${results.linked.length === 1 ? 'file' : 'files'} where ${results.linked.length === 1 ? 'it is' : 'they are'}`),
        h('p', { class: 'dim addf-note' }, `${app} couldn’t tell which movie ${results.linked.length === 1 ? 'this file is' : 'these files are'} from the name (it needs a year), so they were linked with its Manual Import. Nothing was moved or renamed; the quality comes from the name, or from the file type as ${app} does.`),
        h('div', { class: 'dim addf-skip-names' }, results.linked.map((x) => `${x.row.folder.name} (${x.quality})`).join(' · '))) : null,
      results.unread.length ? h('div', {},
        h('div', { class: 'addf-skip-title' }, `${files} ${files === 1 ? 'file' : 'files'} in ${results.unread.length} ${results.unread.length === 1 ? 'folder' : 'folders'} ${app} didn’t read`),
        h('p', { class: 'dim addf-note' }, series
          ? `${app} needs episode numbers in the name (S01E03, 1x03 or “03 - …” in a season folder). Use Wanted → Manual Import in ${app} to match ${files === 1 ? 'it' : 'them'} to episodes.`
          : results.unread.some((u) => u.reason === 'role')
            ? `${app} couldn’t tell which movie ${files === 1 ? 'this file is' : 'these files are'} from the name (it needs a year), and your role can’t link files. An admin can, or use Manual Import in ${app}.`
            : `The file name doesn’t match the movie (for example a sequel in the same folder). Use Manual Import in ${app} to choose the movie for ${files === 1 ? 'it' : 'each'}.`),
        ...results.unread.slice(0, 20).map((u) => h('div', { class: 'addf-unread' }, h('b', {}, u.row.folder.name), ': ', ...u.files.slice(0, 4).flatMap((f, i) => [i ? ' · ' : '', copyable(f, f.split(/[\\/]/).pop())]), u.files.length > 4 ? ` · and ${u.files.length - 4} more` : '')),
        results.unread.length > 20 ? h('div', { class: 'dim addf-note' }, `And ${results.unread.length - 20} more folders (in the CSV).`) : null) : null);
  }
  function refreshResults() { if (resultsEl && resultsEl.isConnected) { const next = resultsCard(); resultsEl.replaceWith(next); resultsEl = next; } }

  // ----------------------------------------------------------------- paint
  function paint() {
    const offer = offerRows(); const existing = existingRows();
    updateGo();
    rowEls.clear();
    progressEl = looking ? h('span', {}, `Looking up ${lookedUp} of ${scan.rows.length}…`) : null;
    countsEl = h('div', { class: 'meta-line addf-counts' }, ...countsContent());
    settingsEl = scan.rows.length ? settingsCard() : h('div', {});
    skippedEl = skippedSection();
    resultsEl = resultsCard();
    mount(body,
      h('p', { class: 'dim settings-copy' }, `Folders in your root folders that ${app} doesn’t manage yet, matched by name. Adding one points ${app} at the folder as it is: nothing is moved, renamed or downloaded.`),
      looking ? h('div', { class: 'meta-line', style: { marginBottom: '8px' } }, spinner(), progressEl) : null,
      resultsEl, settingsEl, countsEl,
      offer.length ? h('div', { class: 'list' }, ...offer.map(keep)) : empty('✓', 'No folders to add', `Every folder in ${app}’s root folders that looks like a ${series ? 'show' : 'movie'} is already in ${app}.`),
      existing.length ? h('div', {},
        h('button', { class: 'btn sm', type: 'button', style: { marginTop: '12px' }, 'aria-expanded': String(showExisting), onclick: () => { showExisting = !showExisting; paint(); } }, showExisting ? `Hide titles already in ${app}` : `Already in ${app} under another folder (${existing.length})`),
        showExisting ? h('div', {}, h('p', { class: 'dim addf-note' }, `These are other copies of titles ${app} has. Find duplicates can compare them with the copy ${app} uses.`), h('div', { class: 'list' }, ...existing.map(keep))) : null) : null,
      skippedEl,
      canWrite ? h('div', { class: 'addf-foot' }, go) : h('p', { class: 'dim settings-copy' }, `Your role can’t add ${series ? 'series' : 'movies'}.`));
  }

  // While lookups run: swap in the rows that changed, the counts and the
  // progress, a few times a second.
  const dirty = new Set(); let flushTimer = null;
  function flush() {
    flushTimer = null;
    for (const row of dirty) refreshRow(row);
    dirty.clear();
    if (progressEl) progressEl.textContent = `Looking up ${lookedUp} of ${scan.rows.length}…`;
    refreshCounts();
  }

  for (const r of scan.rows) r.status = 'queued';
  paint();
  await lookUpRows(arr, scan.rows, { kind, library: scan.library, onRow: (row) => {
    lookedUp += 1;
    if (tickedByDefault(row) && canWrite) ticked.add(row);
    dirty.add(row);
    if (!flushTimer) flushTimer = setTimeout(flush, 250);
  } });
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  // A later folder can match a title an earlier one was ticked for.
  for (const r of scan.rows) if (r.sameAs) ticked.delete(r);
  looking = false;
  paint();
}
