// "Check files" dialog (System tab): files that are probably broken,
// mislabelled or in the wrong language, from Sonarr/Radarr's own media info.
import { h, mount, spinner, empty, toast, openModal, closeModal, copyable } from './ui.js';
import { scanFileHealth, worst } from './fileHealth.js';
import { roleAllows } from './roleUi.js';
import { toCsv, downloadCsv, stamp } from './csv.js';
import { LANGUAGE_CHOICES, langName } from './languages.js';
import { findUntrackedCopies } from './duplicateFinder.js';
import { episodeNumbers, isEpisodeFile } from './episodeDupes.js';
import { pathKey } from './pathDoctor.js';
import { pool } from './pathScan.js';

const LEVEL = { error: ['Problem', 'down'], warn: ['Check', 'warn'], info: ['Note', 'muted'] };

// The language you watch in: English unless changed; '' turns the check off.
const LANG_KEY = 'file-check-language';
export function fileCheckLanguage() { try { const v = localStorage.getItem(LANG_KEY); return v === null ? 'eng' : v; } catch { return 'eng'; } }
function setFileCheckLanguage(v) { try { localStorage.setItem(LANG_KEY, v); } catch { /* not remembered */ } }
// Files whose language issues you marked "Not a problem" (until the file changes).
const OK_KEY = (svc) => `file-check-language-ok-${svc}`;
function loadOk(svc) { try { const v = JSON.parse(localStorage.getItem(OK_KEY(svc)) || '[]'); return new Set(Array.isArray(v) ? v : []); } catch { return new Set(); } }
function saveOk(svc, set) { try { localStorage.setItem(OK_KEY(svc), JSON.stringify([...set].slice(-2000))); } catch { /* storage full */ } }
const isLang = (i) => i.id.startsWith('lang-');

// Episode ids for an episode file (Sonarr's episodefile has no episode list).
async function episodeIdsFor(arr, r) {
  if (Array.isArray(r.file.episodeIds) && r.file.episodeIds.length) return r.file.episodeIds;
  const eps = await arr.get(`episode?seriesId=${encodeURIComponent(r.seriesId)}`).catch(() => []);
  return (eps || []).filter((e) => e.episodeFileId === r.id).map((e) => e.id);
}

// Other copies on disk for files with a language problem: folders the app
// doesn't manage named like the title, and (Sonarr) other files for the same
// episode in the show's own folder. Map(result -> [paths]).
async function otherCopies(arr, kind, scan, flagged) {
  const out = new Map();
  if (!flagged.length) return out;
  const roots = await arr.get('rootfolder').catch(() => []);
  const ids = new Set(flagged.map((r) => (kind === 'series' ? r.seriesId : r.id)));
  const items = (scan.items || []).filter((it) => ids.has(it.id));
  const untracked = findUntrackedCopies(items, roots);
  const byItem = new Map();
  for (const u of untracked) { if (!byItem.has(u.item.id)) byItem.set(u.item.id, []); byItem.get(u.item.id).push(u.folder.path); }
  for (const r of flagged) { const list = byItem.get(kind === 'series' ? r.seriesId : r.id); if (list) out.set(r, [...list]); }
  if (kind !== 'series') return out;
  const bySeries = new Map();
  for (const r of flagged) { if (!bySeries.has(r.seriesId)) bySeries.set(r.seriesId, []); bySeries.get(r.seriesId).push(r); }
  const seriesById = new Map(items.map((s) => [s.id, s]));
  await pool([...bySeries.keys()].slice(0, 40), 3, async (sid) => {
    const s = seriesById.get(sid);
    if (!s || !s.path) return;
    const files = await arr.get(`filesystem/mediafiles?path=${encodeURIComponent(s.path)}`).catch(() => []);
    for (const r of bySeries.get(sid)) {
      const mine = episodeNumbers(String(r.file.relativePath || r.path));
      if (!mine) continue;
      for (const f of files || []) {
        if (pathKey(f.path) === pathKey(r.path) || !isEpisodeFile(f.relativePath || f.name || f.path)) continue;
        const n = episodeNumbers(f.relativePath || f.name || f.path);
        if (n && n.season === mine.season && n.episodes.some((e) => mine.episodes.includes(e))) { if (!out.has(r)) out.set(r, []); out.get(r).push(f.path); }
      }
    }
  });
  return out;
}

export async function openFileHealth(arr, ctx, kind) {
  const body = h('div', {});
  openModal({ title: `Check files — ${ctx.service.label}`, body, wide: true });
  const canWrite = roleAllows('write'); const canDelete = roleAllows('delete');
  const ok = loadOk(ctx.service.key);
  const okKey = (r) => `${kind}:${r.file && r.file.id}`;
  let language = fileCheckLanguage();
  let scan = null; let copies = new Map();
  let showNotes = false; let showOk = false;

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

  const languagePicker = () => h('label', { class: 'fh-lang' }, h('span', { class: 'dim' }, 'Language'),
    h('select', { class: 'input', 'aria-label': 'The language you watch in', onchange: (e) => { language = e.target.value; setFileCheckLanguage(language); run(); } },
      h('option', { value: '', selected: language === '' ? 'selected' : null }, 'Don’t check languages'),
      ...LANGUAGE_CHOICES.map(([code, name]) => h('option', { value: code, selected: code === language ? 'selected' : null }, name))));

  async function run() {
    const progress = h('span', { class: 'dim' }, 'Reading media info…');
    mount(body, h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center' } }, spinner(), progress));
    try { scan = await scanFileHealth(arr, { kind, language: language || null, onProgress: ({ done, total }) => { progress.textContent = `Reading media info… ${done}/${total} series`; } }); }
    catch (e) { mount(body, empty('', 'Couldn’t check files', e.message)); return; }
    copies = new Map();
    render();
    const flagged = scan.results.filter((r) => r.issues.some((i) => isLang(i) && i.level !== 'info') && !ok.has(okKey(r))).slice(0, 200);
    copies = await otherCopies(arr, kind, scan, flagged).catch(() => new Map());
    if (copies.size) render();
  }

  // Issues to show for a row: language issues marked "Not a problem" go,
  // unless they're being shown.
  const shown = (r) => r.issues.filter((i) => !(isLang(i) && ok.has(okKey(r))) || showOk);

  function render() {
    const rows = scan.results.map((r) => ({ r, issues: shown(r) })).filter((x) => x.issues.length);
    const okCount = scan.results.filter((r) => ok.has(okKey(r)) && r.issues.some(isLang)).length;
    const lvl = (x) => worst(x.issues);
    const list = rows.filter((x) => showNotes || lvl(x) !== 'info').sort((a, b) => ({ error: 0, warn: 1, info: 2 })[lvl(a)] - ({ error: 0, warn: 1, info: 2 })[lvl(b)] || a.r.title.localeCompare(b.r.title));
    const notes = rows.length - rows.filter((x) => lvl(x) !== 'info').length;
    const counts = { error: 0, warn: 0, info: 0 };
    for (const x of rows) counts[lvl(x)] += 1;
    const langCount = rows.filter((x) => x.issues.some(isLang)).length;
    mount(body,
      h('div', { class: 'meta-line', style: { marginBottom: '8px', flexWrap: 'wrap' } },
        h('span', { class: 'dim' }, `${scan.checked} files checked`),
        h('span', { class: 'pill down' }, `${counts.error} ${counts.error === 1 ? 'problem' : 'problems'}`), h('span', { class: 'pill warn' }, `${counts.warn} to check`),
        language && langCount ? h('span', { class: 'pill info' }, `${langCount} language ${langCount === 1 ? 'issue' : 'issues'}`) : null,
        notes ? h('button', { class: 'btn sm', onclick: () => { showNotes = !showNotes; render(); } }, showNotes ? 'Hide notes' : `Show ${notes} ${notes === 1 ? 'note' : 'notes'}`) : null,
        okCount ? h('button', { class: 'btn sm', onclick: () => { showOk = !showOk; render(); } }, showOk ? 'Hide the ones you marked fine' : `Show ${okCount} marked fine`) : null,
        h('span', { style: { marginLeft: 'auto', display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } },
          languagePicker(),
          h('button', { class: 'btn sm', onclick: () => downloadCsv(`file-check-${ctx.service.key}-${stamp()}.csv`, toCsv(['Title', 'Path', 'Level', 'Issue'], scan.results.flatMap((r) => r.issues.map((i) => [r.title, r.path, i.level, i.text])))) }, 'Export CSV'))),
      language && scan.languageUnknown ? h('p', { class: 'dim', style: { fontSize: '12px', margin: '0 0 8px' } }, `${scan.languageUnknown} ${scan.languageUnknown === 1 ? 'file doesn’t' : 'files don’t'} say which audio languages they have, so their language isn’t checked.`) : null,
      list.length ? h('div', { class: 'list' }, ...list.map(({ r, issues }) => {
        const level = worst(issues);
        const [label, cls] = LEVEL[level];
        const sBtn = canWrite ? h('button', { class: 'btn sm', onclick: () => search(r, sBtn) }, 'Search again') : null;
        // Two clicks: the first arms it, the second deletes the file (to the
        // Recycle Bin if one is set) and searches for a new one.
        let armed = false;
        const dBtn = canDelete && level === 'error' ? h('button', { class: 'btn sm danger confirm-btn', title: 'Delete this file (Recycle Bin if set) and search for a replacement', onclick: () => {
          if (!armed) { armed = true; dBtn.textContent = 'Delete file and search?'; setTimeout(() => { if (armed && !dBtn.disabled) { armed = false; dBtn.textContent = 'Replace'; } }, 5000); return; }
          search(r, dBtn, { replace: true });
        } }, 'Replace') : null;
        const langIssue = issues.some(isLang);
        const fine = langIssue && !ok.has(okKey(r)) ? h('button', { class: 'btn sm', title: 'Stop flagging this file’s languages', onclick: () => { ok.add(okKey(r)); saveOk(ctx.service.key, ok); render(); } }, 'Not a problem')
          : langIssue && ok.has(okKey(r)) ? h('button', { class: 'btn sm', onclick: () => { ok.delete(okKey(r)); saveOk(ctx.service.key, ok); render(); } }, 'Flag again') : null;
        const other = copies.get(r) || [];
        return h('div', { class: 'row', style: { alignItems: 'flex-start' } },
          h('div', { class: 'row-main' },
            h('div', { class: 'row-title', style: { fontSize: '13px' } }, r.title, ' ', h('span', { class: `pill ${cls}` }, label)),
            ...issues.map((i) => h('div', { style: { fontSize: '12px', marginTop: '2px' } }, '• ', i.text)),
            h('div', { class: 'mono dim', style: { fontSize: '11px', wordBreak: 'break-all', marginTop: '4px' } }, r.path),
            other.length ? h('div', { class: 'fh-other' },
              h('span', {}, other.length === 1 ? 'Another copy is on disk: ' : `${other.length} other copies are on disk: `),
              ...other.slice(0, 3).flatMap((p, i) => [i ? h('span', { class: 'dim' }, ' · ') : null, copyable(p)]),
              h('button', { class: 'btn sm', onclick: () => { closeModal(); import('./duplicates.js').then((m) => m.openDuplicates(arr, ctx, kind)); } }, 'Open Find duplicates')) : null),
          h('div', { class: 'row-actions' }, sBtn, dBtn, fine));
      })) : empty('✓', 'No problems found', `Every file has readable video and audio and looks the right size${language ? `, with ${langName(language)} audio` : ''}.`),
      h('p', { class: 'dim', style: { fontSize: '12px', marginTop: '10px' } }, `Uses the media info ${ctx.service.label} already has. A file it hasn’t analysed yet shows as unreadable until its next refresh.${language ? ` Languages come from the tags inside each file; a film or show is checked against its original language, so a Japanese anime with ${langName(language)} subtitles is fine.` : ''}`));
  }
  run();
}
