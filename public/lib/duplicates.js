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
import { scanDuplicates, buildShows, loadShowDetails } from './duplicateScan.js';
import { episodeCode, seasonName, copyRole, episodeCsvRows, isEpisodeFile } from './episodeDupes.js';
import { defaultSelection, deletePlan, sizeOf, hasContent, qualityOf, splitIgnored, duplicateCsvRows, DUP_CSV_HEADERS } from './duplicateFinder.js';
import { toCsv, downloadCsv, stamp } from './csv.js';

const ignoreKey = (serviceKey) => `acc:dup-ignore:${serviceKey}`;
export function loadIgnored(serviceKey) { try { const v = JSON.parse(localStorage.getItem(ignoreKey(serviceKey)) || '[]'); return new Set(Array.isArray(v) ? v : []); } catch { return new Set(); } }
function saveIgnored(serviceKey, set) { try { localStorage.setItem(ignoreKey(serviceKey), JSON.stringify([...set].slice(-500))); } catch { /* ignore */ } }
import { applyChanges, pool } from './pathScan.js';
import { splitPath, pathKey } from './pathDoctor.js';

const CHEVRON = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
const domId = (text) => `dup-${String(text).replace(/[^a-z0-9]+/gi, '-')}`;

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
  const progress = h('span', { class: 'dim' }, `Looking for duplicate ${noun}…`);
  mount(body, h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center' } }, spinner(), progress));
  let scan;
  const plex = (ctx.state.services || []).some((s) => s.type === 'plex' && s.configured) && !isLocalMode() ? () => ctx.api.plex.duplicates() : null;
  const onProgress = ({ done, total }) => { if (total > 1) progress.textContent = `Reading each show’s folder… ${done} of ${total}`; };
  try { scan = await scanDuplicates(arr, { kind, others: otherInstances(ctx, kind), plexDuplicates: plex, onProgress }); }
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
  // Sonarr lists shows (with their seasons); Radarr lists the groups.
  const rerender = () => (kind === 'series' ? renderShows() : renderGroups());

  const pill = (text, cls) => h('span', { class: `pill ${cls}` }, text);
  function copyRow(g, c) {
    const it = c.item;
    const cb = h('input', { type: 'checkbox', checked: selected.has(it.id) ? 'checked' : null, disabled: canDelete ? null : 'disabled', 'aria-label': `Delete ${it.path}` });
    cb.addEventListener('change', () => { if (cb.checked) selected.add(it.id); else selected.delete(it.id); renderFoot(); });
    const q = qualityOf(it, kind);
    const onDisk = kind === 'series' && scan.perItem && scan.perItem.get(it.id) ? scan.perItem.get(it.id).files.filter((f) => isEpisodeFile(f.relativePath || f.name)).length : null;
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
          onDisk ? h('span', { class: 'dim' }, `${onDisk} video ${onDisk === 1 ? 'file' : 'files'} in the folder`) : null,
          it.monitored ? pill('Monitored', 'info') : pill('Unmonitored', 'muted'))));
  }

  function hiddenNote() {
    if (!split.hidden.length) return null;
    return h('div', { class: 'dim', style: { fontSize: '12px', margin: '0 0 8px', display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } },
      `${split.hidden.length} marked “not a duplicate”.`,
      h('button', { class: 'btn sm', type: 'button', onclick: () => { showHidden = !showHidden; rerender(); } }, showHidden ? 'Hide them' : 'Show them'),
      showHidden ? h('div', { style: { width: '100%' } }, ...split.hidden.map((g) => h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', margin: '4px 0' } },
        h('span', {}, g.title),
        h('button', { class: 'btn sm', type: 'button', onclick: () => { ignored.delete(g.key); saveIgnored(ctx.service.key, ignored); split.hidden = split.hidden.filter((x) => x.key !== g.key); scan.groups = [...scan.groups, g]; for (const id of defaultSelection([g])) selected.add(id); rerender(); renderFoot(); } }, 'Show again')))) : null);
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
      ...scan.groups.map((g) => h('div', { class: 'card', style: { marginBottom: '12px' } }, ...groupParts(g, { title: true }))));
  }

  // A group of library entries: what it is, the keep suggestion and the copies.
  function groupParts(g, { title = false } = {}) {
    const keeper = g.ranked[0];
    const pickExtras = h('button', { class: 'btn sm', type: 'button', onclick: () => { for (const c of g.ranked) { if (c.keep) selected.delete(c.item.id); else selected.add(c.item.id); } rerender(); renderFoot(); } }, 'Select extras');
    return [
      h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px', flexWrap: 'wrap' } },
        title ? h('div', { class: 'row-title' }, g.title) : h('div', { class: 'dup-sub' }, `${g.items.length} entries for this show in ${ctx.service.label}`),
        title ? pill(`${g.items.length} copies`, 'warn') : null,
        pill(g.confidence === 'certain' ? 'Same title' : 'Possible', g.confidence === 'certain' ? 'down' : 'muted'),
        h('span', { class: 'dim', style: { fontSize: '12px' } }, g.why),
        g.sharedPath ? pill('Two entries share a folder', 'warn') : null,
        h('span', { style: { marginLeft: 'auto', display: 'flex', gap: '6px' } },
          h('button', { class: 'btn sm', type: 'button', title: 'Hide this group from future scans', onclick: () => { ignored.add(g.key); saveIgnored(ctx.service.key, ignored); for (const c of g.ranked) selected.delete(c.item.id); scan.groups = scan.groups.filter((x) => x.key !== g.key); split.hidden.push(g); rerender(); renderFoot(); toast(`${g.title} marked as not a duplicate`, 'info'); } }, 'Not a duplicate'),
          canDelete ? pickExtras : null)),
      h('div', { class: 'dim', style: { fontSize: '12px', marginBottom: '6px' } }, `Keep suggestion: ${keeper.reasons.filter((r) => r.good).map((r) => r.text).join(', ') || 'first added'}.`),
      h('div', { class: 'list' }, ...g.ranked.map((c) => copyRow(g, c))),
    ];
  }

  function exportBtn() {
    const btn = h('button', { class: 'btn sm', type: 'button', onclick: async () => {
      let episodes = [];
      if (kind === 'series' && shows.length) {
        // Every show's episodes, so the file lists the duplicate episodes too.
        btn.disabled = true;
        let n = 0;
        const per = await pool(shows, 3, async (sh) => {
          const r = await showDetails(sh).catch(() => null);
          btn.textContent = `Reading episodes… ${++n} of ${shows.length}`;
          return r ? episodeCsvRows(sh, r, ctx.service.label) : [];
        });
        episodes = per.flat();
        btn.disabled = false; btn.textContent = 'Export CSV';
      }
      downloadCsv(`duplicates-${ctx.service.key}-${stamp()}.csv`, toCsv(DUP_CSV_HEADERS, duplicateCsvRows(scan, kind).concat(episodes)));
    } }, 'Export CSV');
    return btn;
  }

  // ------------------------------------------------ Sonarr: by show, then season
  const showsEl = h('div', {});
  const openShows = new Set();
  const openSeasons = new Set();
  const details = new Map(); // show key -> Promise of loadShowDetails
  let shows = [];
  function showDetails(sh) {
    if (!details.has(sh.key)) details.set(sh.key, loadShowDetails(arr, sh).catch((e) => { details.delete(sh.key); throw e; }));
    return details.get(sh.key);
  }

  function renderShows() {
    shows = buildShows(scan, ignored);
    if (shows.length === 1) openShows.add(shows[0].key);
    const eps = shows.reduce((n, sh) => n + sh.summary.episodes, 0);
    const withEps = shows.filter((sh) => sh.summary.episodes).length;
    mount(showsEl,
      shows.length ? h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
        h('div', { class: 'section-title', style: { margin: '6px 0', flex: '1' } }, `Shows with duplicates (${shows.length})`),
        exportBtn()) : null,
      hiddenNote(),
      shows.length ? h('p', { class: 'dim', style: { margin: '0 0 10px', fontSize: '13px', lineHeight: '1.55' } },
        eps ? `${eps} ${eps === 1 ? 'episode is' : 'episodes are'} on disk more than once, in ${withEps} ${withEps === 1 ? 'show' : 'shows'}. ` : '',
        'Open a show to see where its copies are and, season by season, each episode that has more than one file.') : null,
      ...shows.map(showCard));
  }

  function showPills(sh) {
    const n = sh.summary.episodes; const seasons = sh.summary.seasons;
    return [
      n ? pill(`${n} duplicate ${n === 1 ? 'episode' : 'episodes'}`, 'warn') : null,
      n ? h('span', { class: 'dim', style: { fontSize: '12px' } }, seasons.length === 1 ? seasonName(seasons[0]) : `${seasons.length} seasons`) : null,
      sh.group ? pill(`${sh.entries.length} entries`, sh.group.confidence === 'certain' ? 'down' : 'muted') : null,
      sh.untracked.length ? pill(`${sh.untracked.length} unmanaged ${sh.untracked.length === 1 ? 'folder' : 'folders'}`, 'info') : null,
    ].filter(Boolean);
  }

  // A show: collapsed to one line; open, it lists where the copies are and
  // the seasons that have duplicate episodes.
  function showCard(sh) {
    const id = domId(sh.key);
    const bodyEl = h('div', { class: 'dup-body', id });
    const head = h('button', { type: 'button', class: 'dup-head', 'aria-controls': id },
      h('span', { class: 'dup-chev', html: CHEVRON }),
      h('span', { class: 'dup-title' }, sh.title),
      h('span', { class: 'dup-pills' }, ...showPills(sh)));
    const card = h('div', { class: 'card dup-show' }, head, bodyEl);
    const paint = () => {
      const open = openShows.has(sh.key);
      head.setAttribute('aria-expanded', String(open));
      card.classList.toggle('open', open);
      bodyEl.hidden = !open;
      if (open) mount(bodyEl, ...showBody(sh)); else mount(bodyEl);
    };
    head.addEventListener('click', () => { if (openShows.has(sh.key)) openShows.delete(sh.key); else openShows.add(sh.key); paint(); });
    paint();
    return card;
  }

  function showBody(sh) {
    return [
      h('div', { class: 'dup-section' }, 'Where the copies are'),
      sh.group ? h('div', {}, ...groupParts(sh.group)) : h('div', { class: 'list' }, entryRow(sh.primary)),
      sh.untracked.length ? h('div', { class: 'list', style: { marginTop: '10px' } }, ...sh.untracked.map((u) => untrackedRow(u, { inShow: true }))) : null,
      seasonsBlock(sh),
    ];
  }

  function entryRow(it) {
    const st = it.statistics || {};
    return h('div', { class: 'row', style: { alignItems: 'flex-start' } },
      h('div', { class: 'row-main' },
        h('div', { class: 'row-title', style: { fontSize: '13px' } }, `The show’s folder in ${ctx.service.label}`),
        h('div', { class: 'meta-line', style: { marginTop: '4px', flexWrap: 'wrap' } },
          pill(`${st.episodeFileCount || 0}/${st.episodeCount || 0} episodes`, (st.episodeFileCount || 0) > 0 ? 'ok' : 'warn'),
          st.sizeOnDisk ? h('span', {}, fmtBytes(st.sizeOnDisk)) : null,
          it.monitored ? pill('Monitored', 'info') : pill('Unmonitored', 'muted')),
        h('div', { style: { fontSize: '12px', wordBreak: 'break-all', marginTop: '4px' } }, copyable(it.path || '(no path)'))));
  }

  function seasonsBlock(sh) {
    const el = h('div', { class: 'dup-seasons' },
      h('div', { class: 'dim', style: { display: 'flex', gap: '8px', alignItems: 'center', margin: '14px 0 4px', fontSize: '13px' } }, spinner(), 'Reading the episodes and their files…'));
    showDetails(sh)
      .then((d) => mount(el, ...seasonsView(sh, d)))
      .catch((e) => mount(el, h('p', { class: 'dim', style: { margin: '14px 0 0', fontSize: '13px' } }, `Couldn’t read the episodes: ${e.message}`)));
    return el;
  }

  function seasonsView(sh, d) {
    const head = h('div', { class: 'dup-section', style: { marginTop: '16px' } }, d.seasons.length ? `Seasons with duplicate episodes (${d.seasons.length})` : 'Seasons');
    if (!d.seasons.length) {
      return [head, h('p', { class: 'dim', style: { fontSize: '13px', margin: '0' } }, `No episode is on disk more than once.${sh.group ? ' The entries above can still be tidied up.' : ''}`), unmatchedNote(d)];
    }
    if (d.seasons.length === 1) openSeasons.add(`${sh.key}|${d.seasons[0].season}`);
    return [head,
      h('div', { class: 'dup-season-list' }, ...d.seasons.map((sn) => seasonRow(sh, sn))),
      unmatchedNote(d),
      h('p', { class: 'dim', style: { fontSize: '12px', margin: '12px 0 0', lineHeight: '1.5' } },
        `* Read from the file name. ${ctx.service.label} can only delete the files it uses: delete other copies on disk, or in Plex if “Allow media deletion” is on. Click a path to copy it.`)];
  }

  function seasonRow(sh, sn) {
    const key = `${sh.key}|${sn.season}`;
    const id = domId(`${sh.key}-s${sn.season}`);
    const n = sn.episodes.length;
    const bodyEl = h('div', { class: 'dup-season-body', id });
    const head = h('button', { type: 'button', class: 'dup-season-head', 'aria-controls': id },
      h('span', { class: 'dup-chev', html: CHEVRON }),
      h('span', { class: 'dup-season-name' }, seasonName(sn.season)),
      h('span', { class: 'dim' }, sn.known ? `${n} of ${sn.known} ${sn.known === 1 ? 'episode' : 'episodes'} on disk more than once` : `${n} ${n === 1 ? 'episode' : 'episodes'} on disk more than once`,
        sn.extraBytes ? h('span', { title: 'Keeping only the best copy of each episode would free this much' }, ` · could free ${fmtBytes(sn.extraBytes)}`) : null),
      sn.better ? pill(`${sn.better} better ${sn.better === 1 ? 'copy' : 'copies'}`, 'ok') : null);
    const wrap = h('div', { class: 'dup-season' }, head, bodyEl);
    const paint = () => {
      const open = openSeasons.has(key);
      head.setAttribute('aria-expanded', String(open));
      wrap.classList.toggle('open', open);
      bodyEl.hidden = !open;
      if (open) mount(bodyEl, ...seasonBody(sh, sn)); else mount(bodyEl);
    };
    head.addEventListener('click', () => { if (openSeasons.has(key)) openSeasons.delete(key); else openSeasons.add(key); paint(); });
    paint();
    return wrap;
  }

  // The files of this season in `folder` that Sonarr doesn't use (each once).
  function seasonFilesIn(sn, folder) {
    const out = new Map();
    for (const e of sn.episodes) for (const c of e.copies) if ((c.where === 'extra' || c.where === 'unmanaged') && c.folder && pathKey(c.folder) === pathKey(folder)) out.set(pathKey(c.path), { path: c.path });
    return [...out.values()];
  }

  function seasonBody(sh, sn) {
    const panel = h('div', {});
    // Better copies Sonarr could import instead, by the folder they're in.
    const folders = new Map();
    for (const e of sn.episodes) if (e.better && e.better.folder) folders.set(pathKey(e.better.folder), e.better.folder);
    const actions = canFix && folders.size ? h('div', { class: 'dup-actions' }, ...[...folders.values()].map((folder) => h('button', {
      class: 'btn sm primary', type: 'button',
      onclick: () => openKeepPanelSeries(panel, { item: sh.primary, folder: { path: folder } }, { season: sn.season, files: seasonFilesIn(sn, folder) }),
    }, folders.size === 1 ? 'Use the better copies…' : pathKey(folder) === pathKey(sh.primary.path || '') ? 'Use the better copies in the show’s folder…' : `Use the better copies in ${splitPath(folder).name}…`))) : null;
    return [h('div', { class: 'dup-episodes' }, ...sn.episodes.map((e) => episodeBlock(sh, e))), actions, panel];
  }

  function episodeBlock(sh, e) {
    return h('div', { class: 'dup-ep' },
      h('div', { class: 'dup-ep-head' },
        h('b', {}, episodeCode(e.season, e.episode)), e.title ? h('span', {}, e.title) : null,
        h('span', { class: 'dim' }, `${e.copies.length} files`),
        e.plexFiles > e.copies.length ? pill(`Plex sees ${e.plexFiles}`, 'warn') : null,
        e.sonarrFile ? null : pill(`${ctx.service.label} has no file for it`, 'muted')),
      h('div', { class: 'dup-copies' }, ...e.copies.map((c) => copyLine(sh, c))));
  }

  function copyLine(sh, c) {
    const cls = c.where === 'tracked' ? 'ok' : c.where === 'other-entry' ? 'warn' : c.where === 'plex' ? 'muted' : 'info';
    return h('div', { class: `dup-copy${c.best ? ' best' : ''}` },
      h('div', { class: 'dup-copy-line' },
        pill(copyRole(c, sh.primary.id, ctx.service.label), cls),
        h('span', { class: 'dup-q', title: c.quality.guessed ? 'Read from the file name' : `${ctx.service.label}’s quality for this file` }, c.quality.name, c.quality.guessed && c.quality.name !== 'unknown quality' ? '*' : ''),
        c.size ? h('span', { class: 'dim' }, fmtBytes(c.size)) : null,
        c.inPlex && c.where !== 'plex' ? h('span', { class: 'dim' }, 'in Plex') : null,
        c.best ? pill('Best', 'ok') : null),
      h('div', { class: 'dup-path mono' }, copyable(c.path)));
  }

  function unmatchedNote(d) {
    if (!d.unmatched.length) return null;
    const n = d.unmatched.length;
    return h('details', { style: { marginTop: '10px', fontSize: '12px' } },
      h('summary', { class: 'dim', style: { cursor: 'pointer' } }, `${n} video ${n === 1 ? 'file has' : 'files have'} no episode number in the name`),
      h('div', { style: { marginTop: '6px' } }, ...d.unmatched.map((u) => h('div', { class: 'dup-path mono' }, copyable(u.path)))));
  }

  function renderFoot() {
    if (!scan.groups.length || !canDelete) { mount(footEl, scan.groups.length ? h('p', { class: 'dim settings-copy' }, 'Only admins can delete entries.') : null); return; }
    const { plan, warnings } = deletePlan(scan.groups, selected, { deleteFiles: opts.deleteFiles });
    const df = h('input', { type: 'checkbox', role: 'switch', checked: opts.deleteFiles ? 'checked' : null });
    df.addEventListener('change', () => { opts.deleteFiles = df.checked; renderFoot(); });
    const ex = h('input', { type: 'checkbox', role: 'switch', checked: opts.exclude ? 'checked' : null });
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
          catch (e) { if (e.cancelled) break; failed.push(`${p.path}: ${e.message}`); }
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
      h('div', { class: 'list' }, ...scan.untracked.map((u) => untrackedRow(u))));
  }

  // A folder the app doesn't manage that's named like one of its titles.
  function untrackedRow(u, { inShow = false } = {}) {
    const swap = !u.managedOnDisk && u.videoFiles > 0 && canFix ? h('button', { class: 'btn sm primary', onclick: async (e) => {
      e.currentTarget.disabled = true;
      const res = await applyChanges(arr, { kind, changes: [{ id: u.item.id, title: u.item.title, oldPath: u.item.path, oldRoot: u.item.rootFolderPath, newPath: u.folder.path, newRoot: splitPath(u.folder.path).parent }] });
      toast(res.ok.length ? `${u.item.title} now uses ${u.folder.path}` : `Couldn’t switch: ${(res.failed[0] || {}).error || 'failed'}`, res.ok.length ? 'success' : 'error');
      scanInto(body, arr, ctx, kind);
    } }, 'Use this copy') : null;
    const panel = h('div', {});
    const keep = u.managedOnDisk && u.videoFiles > 0 && canFix
      ? h('button', { class: 'btn sm', onclick: () => (kind === 'series' ? openKeepPanelSeries(panel, u, { files: u.files || null }) : openKeepPanel(panel, u)) }, kind === 'series' ? 'Use episodes from this copy…' : 'Keep this copy instead…') : null;
    return h('div', { class: 'row', style: { alignItems: 'flex-start', flexWrap: 'wrap' } },
      h('div', { class: 'row-main' },
        inShow ? h('div', { class: 'row-title', style: { fontSize: '13px' } }, `A folder ${ctx.service.label} doesn’t manage`) : h('div', { class: 'row-title', style: { fontSize: '13px' } }, `${u.item.title}${u.item.year ? ` (${u.item.year})` : ''}`),
        h('div', { class: 'meta-line', style: { marginTop: '4px', flexWrap: 'wrap' } },
          u.videoFiles == null ? null : u.videoFiles ? pill(`${u.videoFiles} video ${u.videoFiles === 1 ? 'file' : 'files'}`, 'info') : pill('No video files (extras?)', 'muted'),
          u.managedOnDisk ? null : pill('Managed copy is missing', 'down'),
          u.inPlex ? pill('Plex shows this as a duplicate', 'warn') : null),
        h('div', { class: 'dim', style: { fontSize: '12px', wordBreak: 'break-all', marginTop: '4px' } }, 'Managed: ', h('span', { class: 'mono' }, u.item.path || '(unknown)')),
        h('div', { style: { fontSize: '12px', wordBreak: 'break-all' } }, 'Extra: ', copyable(u.folder.path)),
        panel),
      swap || keep ? h('div', { class: 'row-actions' }, swap, keep) : null);
  }

  // Replace the managed movie file with the one in the extra folder, using
  // Radarr's Manual Import; Radarr removes the old file (Recycle Bin if set).
  async function openKeepPanel(panel, u) {
    const asking = h('div', { class: 'dim', style: { marginTop: '8px' } }, 'Asking Radarr what it would do…');
    mount(panel, asking);
    let prep;
    try { prep = await prepareKeepCopy(arr, { item: u.item, folder: u.folder.path, files: u.files || null, onProgress: ({ done, total }) => { if (total > 1) asking.textContent = `Asking Radarr about the files… ${done}/${total}`; } }); }
    catch (e) { mount(panel, h('div', { class: 'dim', style: { marginTop: '8px' } }, `Radarr couldn’t read that folder: ${e.message}`)); return; }
    if (!prep.best) { mount(panel, h('div', { class: 'dim', style: { marginTop: '8px' } }, 'Radarr found no video file it can import there.')); return; }
    const q = (x) => (x && x.quality && x.quality.quality && x.quality.quality.name) || 'unknown quality';
    const size = (x) => (x && x.size ? ` · ${fmtBytes(x.size)}` : '');
    const ack = h('input', { type: 'checkbox' });
    const go = h('button', { class: 'btn sm primary danger confirm-btn' }, 'Replace the current file');
    const risks = [
      !prep.better ? (prep.notUpgrade ? 'Radarr says this copy is not an upgrade.' : 'This copy isn’t better quality than the current file.') : null,
      ...prep.rejections.filter((r) => !/not an upgrade/i.test(r)).map((r) => `Radarr: ${r}`),
      !prep.recycleBin ? 'Radarr has no Recycle Bin set, so the current file will be deleted permanently (Settings → Media Management → Recycling Bin).' : null,
    ].filter(Boolean);
    const enable = () => { go.disabled = risks.length > 0 && !ack.checked; };
    ack.addEventListener('change', enable);
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

  // Sonarr: pick which files to import. Clean upgrades (one file per episode)
  // are preselected. A file from another folder is moved in and Sonarr removes
  // the episode's old file (Recycle Bin if set); a file already in the show's
  // folder is imported where it is, then the old file is deleted through Sonarr.
  async function openKeepPanelSeries(panel, u, { season = null, files = null } = {}) {
    const asking = h('div', { class: 'dim', style: { marginTop: '8px' } }, 'Asking Sonarr what it would do…');
    mount(panel, asking);
    let prep;
    try {
      prep = await prepareKeepCopySeries(arr, { item: u.item, folder: u.folder.path, season, files, onProgress: ({ done, total }) => { if (total > 1) asking.textContent = `Asking Sonarr about the files… ${done}/${total}`; } });
    } catch (e) { mount(panel, h('div', { class: 'dim', style: { marginTop: '8px' } }, `Sonarr couldn’t read that folder: ${e.message}`)); return; }
    if (!prep.rows.length) { mount(panel, h('div', { class: 'dim', style: { marginTop: '8px' } }, season == null ? 'No video files there that Sonarr isn’t already using.' : `No files for ${seasonName(season).toLowerCase()} there that Sonarr isn’t already using.`)); return; }
    const q = (x) => (x && x.quality && x.quality.quality && x.quality.quality.name) || '—';
    const pick = new Set(prep.rows.flatMap((r, i) => (r.pick ? [i] : [])));
    const idx = new Map(prep.rows.map((r, i) => [r, i]));
    const inFolder = prep.rows.some((r) => r.inFolder);
    const ack = h('input', { type: 'checkbox' });
    const go = h('button', { class: 'btn sm primary danger confirm-btn' });
    const paint = () => {
      const chosen = prep.rows.filter((r) => pick.has(idx.get(r)));
      const n = chosen.reduce((sum, r) => sum + r.file.episodes.length, 0);
      go.textContent = n ? `Import ${n} ${n === 1 ? 'episode' : 'episodes'}` : 'Choose episodes';
      go.disabled = !n || (chosen.some((r) => r.current) && !prep.recycleBin && !ack.checked);
    };
    ack.addEventListener('change', paint);
    // One file per episode: ticking a copy unticks other copies of its episodes.
    const boxes = new Map();
    const overlaps = (a, b) => a.file.episodes.some((e) => b.file.episodes.some((x) => x.id === e.id));
    const rowsEl = h('div', { class: 'list', style: { maxHeight: '240px', overflowY: 'auto', margin: '6px 0' } }, ...prep.rows.map((r) => {
      const i = idx.get(r);
      const cb = h('input', { type: 'checkbox', checked: pick.has(i) ? 'checked' : null, disabled: r.importable ? null : 'disabled', 'aria-label': `Import ${splitPath(r.file.path).name}` });
      boxes.set(i, cb);
      cb.addEventListener('change', () => {
        if (cb.checked) {
          pick.add(i);
          for (const o of prep.rows) { const j = idx.get(o); if (j !== i && pick.has(j) && overlaps(o, r)) { pick.delete(j); boxes.get(j).checked = false; } }
        } else pick.delete(i);
        paint();
      });
      const ep = r.importable ? r.file.episodes.map((e) => episodeCode(e.seasonNumber ?? r.file.seasonNumber ?? 0, e.episodeNumber)).join(', ') : splitPath(r.file.path).name;
      const status = !r.importable ? h('span', { class: 'pill muted' }, 'Sonarr can’t match this to an episode')
        : r.missingNow ? h('span', { class: 'pill info' }, 'you don’t have this one')
          : r.better ? h('span', { class: 'pill ok' }, 'upgrade')
            : h('span', { class: 'pill muted' }, r.notUpgrade ? 'Sonarr: not an upgrade' : 'not better');
      const other = r.rejections.filter((x) => !/not an upgrade|not a custom format upgrade/i.test(x));
      return h('label', { class: 'row', style: { padding: '6px 10px', gap: '8px', cursor: r.importable ? 'pointer' : 'default' } }, cb,
        h('div', { class: 'row-main' },
          h('div', { style: { fontSize: '13px', wordBreak: 'break-word' } }, h('b', {}, ep), r.importable ? ` · ${q(r.current)} → ${q(r.file)}` : null),
          r.importable ? h('div', { class: 'dim mono', style: { fontSize: '11px', wordBreak: 'break-all', margin: '2px 0' } }, splitPath(r.file.path).name) : null,
          h('div', { class: 'meta-line' }, status),
          other.length ? h('div', { class: 'dim', style: { fontSize: '12px', marginTop: '2px', whiteSpace: 'normal' } }, `Sonarr: ${other.join('; ')}`) : null));
    }));
    go.addEventListener('click', async () => {
      go.disabled = true;
      const chosen = prep.rows.filter((r) => pick.has(idx.get(r)));
      const picked = chosen.map((r) => r.file);
      mount(panel, h('div', { class: 'dim', style: { marginTop: '8px' } }, `Sonarr is importing ${picked.length} ${picked.length === 1 ? 'file' : 'files'}…`));
      try {
        const res = await runKeepCopySeries(arr, { item: u.item, files: picked, renameEpisodes: prep.renameEpisodes });
        const n = res.imported.length;
        if (n) toast(`Imported ${n} ${n === 1 ? 'file' : 'files'} into ${u.item.title}${prep.recycleBin && chosen.some((r) => r.current) ? '; replaced files are in the Recycle Bin' : ''}`, 'success', 6000);
        const notes = [
          res.missed.length ? `Sonarr didn’t import ${res.missed.join(', ')}; Sonarr’s log (System → Logs) says why.` : null,
          res.kept.length ? `Kept ${res.kept.map((x) => splitPath(x).name).join(', ')}: another episode still uses ${res.kept.length === 1 ? 'it' : 'them'}.` : null,
          ...res.problems,
        ].filter(Boolean);
        if (notes.length) toast(notes.join(' '), n ? 'warn' : 'error', 10000);
        invalidate(`arr:${ctx.service.key}:${itemsPath}`);
        scanInto(body, arr, ctx, kind);
      } catch (e) { mount(panel, h('div', { style: { marginTop: '8px', color: 'var(--red, #ef4444)' } }, e.message)); }
    });
    const rb = prep.recycleBin ? ` to its Recycle Bin (${prep.recycleBin})` : '';
    const how = inFolder
      ? `These files are already in ${u.item.path}. Sonarr switches each chosen episode to its file${prep.renameEpisodes ? ' and renames it' : ''}, then ${prep.recycleBin ? `moves the file the episode used before to its Recycle Bin (${prep.recycleBin})` : 'deletes the file the episode used before'}. A file another episode still uses is kept.${prep.renameEpisodes ? '' : ' Rename Episodes is off in Sonarr, so file names stay as they are.'} Arr Command Center doesn’t touch the drives.`
      : `Sonarr moves each chosen file into ${u.item.path}${prep.renameEpisodes ? ', renames it,' : ''} and removes that episode’s current file${rb}. Arr Command Center doesn’t touch the drives.`;
    mount(panel, h('div', { class: 'card', style: { marginTop: '8px', padding: '10px' } },
      h('p', { class: 'dim', style: { fontSize: '12px', margin: '0 0 4px' } }, how),
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

  const missingCopies = scan.groups.some((g) => g.items.some((it) => scan.onDisk.get(it.id) === false));
  const fixHint = missingCopies && canFix ? h('div', { class: 'card', style: { padding: '10px 12px', marginBottom: '12px', display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' } },
    h('span', { style: { flex: '1' } }, `Some copies’ folders aren’t on disk where ${ctx.service.label} expects them. Fix paths first so the suggestions compare what’s really there.`),
    h('button', { class: 'btn sm primary', onclick: () => openPathFix(arr, ctx, kind) }, 'Fix paths')) : null;
  if (kind === 'series') {
    const none = !buildShows(scan, ignored).length && !scan.crossInstance.length && !split.hidden.length;
    mount(body,
      none ? empty('✓', 'No duplicates found', `No episode is on disk more than once, no show is in ${ctx.service.label} twice, and nothing is shared with another instance.`) : null,
      fixHint, showsEl, footEl, crossSection(),
      !scan.groups.length ? h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '14px' } }, h('button', { class: 'btn', onclick: closeModal }, 'Close')) : null);
    renderShows();
    renderFoot();
    return;
  }
  const nothing = !scan.groups.length && !scan.untracked.length && !scan.crossInstance.length && !split.hidden.length;
  mount(body,
    nothing ? empty('✓', 'No duplicates found', `No repeated ${noun}, no untracked copies, nothing shared with another instance.`) : null,
    fixHint, groupsEl, footEl, untrackedSection(), crossSection(),
    nothing || !scan.groups.length ? h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '14px' } }, nothing ? null : exportBtn(), h('button', { class: 'btn', onclick: closeModal }, 'Close')) : null);
  renderGroups();
  renderFoot();
}
