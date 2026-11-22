// "Repeat downloads" (System tab): what was downloaded more than once in the
// last weeks and why, from the app's own history, plus the settings that
// cause it, with fixes for admins (each asks twice).
import { h, mount, spinner, empty, toast, openModal, closeModal, fmtBytes, fmtRelative } from './ui.js';
import { roleAllows } from './roleUi.js';
import { toCsv, downloadCsv, stamp } from './csv.js';
import { gatherRepeatDownloads, analyzeHistory, settingsFindings, applyFix, titleOf, CAUSE_TEXT, REPEAT_CSV_HEADERS, repeatCsvRows } from './repeatDownloads.js';

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const pill = (text, cls) => h('span', { class: `pill ${cls}` }, text);
const SEV = { problem: ['Problem', 'down'], warning: ['Warning', 'warn'], info: ['Note', 'muted'] };

export async function openRepeatDownloads(arr, ctx, kind) {
  const app = ctx.service.label;
  const series = kind === 'series';
  const body = h('div', { class: 'rpt' });
  openModal({ title: `Repeat downloads — ${app}`, body, wide: true });
  const isAdmin = roleAllows('admin');
  const sabServices = (ctx.state && ctx.state.services ? ctx.state.services : []).filter((s) => s.type === 'sabnzbd' && s.configured !== false)
    .map((s) => ({ key: s.key, label: s.label || 'SABnzbd', get: (params) => ctx.api.sab(s.key, params) }));
  let days = 90; let data = null; let analysis = null; let findings = []; let showTitles = 30; let showNever = 20;

  async function load() {
    mount(body, h('div', { class: 'meta-line' }, spinner(), h('span', {}, `Reading ${app}’s history…`)));
    try {
      data = await gatherRepeatDownloads(arr, kind, { days, sab: sabServices });
      analysis = analyzeHistory(data.records, { kind, queueIds: data.queueIds });
      findings = settingsFindings({ app, kind, clients: data.clients, dlcfg: data.dlcfg, health: data.health, sab: data.sab });
    } catch (e) { mount(body, empty('', `Couldn’t read ${app}’s history`, e.message)); return; }
    paint();
  }

  function findingCard(f) {
    const [word, cls] = SEV[f.severity];
    let armed = false;
    const btn = f.fix && isAdmin ? h('button', { class: 'btn sm primary confirm-btn', type: 'button', onclick: async () => {
      if (!armed) { armed = true; btn.textContent = `${f.fix.label}? Click again`; setTimeout(() => { if (armed) { armed = false; btn.textContent = f.fix.label; } }, 6000); return; }
      btn.disabled = true; btn.textContent = 'Saving…';
      try { await applyFix(f.fix.action, { arr, api: ctx.api }); toast('Saved', 'success'); await load(); }
      catch (e) { toast(e.message, 'error'); btn.disabled = false; btn.textContent = f.fix.label; armed = false; }
    } }, f.fix.label) : null;
    return h('div', { class: 'row', style: { alignItems: 'flex-start' } },
      h('div', { class: 'row-main' },
        h('div', { class: 'row-title', style: { fontSize: '14px' } }, pill(word, cls), ' ', f.title),
        h('div', { class: 'dim', style: { fontSize: '12px', marginTop: '3px', lineHeight: '1.5' } }, f.detail),
        f.help ? h('div', { style: { fontSize: '13px', marginTop: '4px' } }, h('b', {}, 'Fix: '), f.help) : null,
        f.fix && !isAdmin ? h('div', { class: 'dim', style: { fontSize: '12px', marginTop: '4px' } }, 'An admin can change this here.') : null),
      btn ? h('div', { class: 'row-actions' }, btn) : null);
  }

  const inQueue = (g) => !!(g.downloadId && data.queueIds.has(String(g.downloadId).toLowerCase()));
  const outcomeWord = (g) => (!g.outcome ? (inQueue(g) ? ['still in the queue', 'info'] : ['never imported', 'warn']) : g.outcome.type === 'downloadFolderImported' ? ['imported', 'ok'] : g.outcome.type === 'downloadFailed' ? ['failed', 'down'] : ['ignored', 'muted']);

  function titleRow(t) {
    const first = t.grabs[0];
    return h('div', { class: 'row rpt-title', style: { alignItems: 'flex-start' } },
      h('div', { class: 'row-main' },
        h('div', { class: 'row-title addf-name' }, titleOf(first, kind, data.names), pill(`${t.grabs.length}×`, 'warn')),
        ...t.grabs.map((g, i) => {
          const r = i ? t.repeats[i - 1] : null;
          const [ow, oc] = outcomeWord(g);
          const why = g.outcome && g.outcome.type === 'downloadFailed' && g.outcome.data ? (g.outcome.data.message || g.outcome.data.Message) : '';
          return h('div', { class: 'rpt-grab' },
            h('span', { class: 'dim' }, fmtRelative(g.date)), ' ',
            h('span', { class: 'mono' }, g.sourceTitle || ''), ' ',
            pill(ow, oc), r ? h('span', { class: 'dim' }, ` · ${CAUSE_TEXT[r.cause]}${r.same ? ', the same release' : ''}`) : null,
            why ? h('div', { class: 'dim', style: { fontSize: '11px' } }, why) : null);
        })));
  }

  function paint() {
    const c = analysis.counts;
    const period = h('select', { class: 'input', style: { width: 'auto', padding: '5px 8px', fontSize: '12px' }, 'aria-label': 'Period', onchange: (e) => { days = Number(e.target.value); load(); } },
      ...[30, 90, 180].map((d) => h('option', { value: d, selected: d === days ? 'selected' : null }, `Last ${d} days`)));
    const causes = [
      ['failed', `${app} tried another release after a download failed. That’s how it’s meant to work, unless the same thing keeps failing.`],
      ['upgrade', 'A better release came out (quality, a repack, or a better custom format score).'],
      ['lost', `It was downloaded again before the first download was imported. Either ${app} lost track of the first one (the usual causes are above: downloads saved inside a library folder, or a download history so long that ${app} misses some), or someone grabbed it again by hand.`],
      ['again', `It was imported, then downloaded again at no better quality (for example after the file was deleted).`],
      ['ignored', 'After a download you told it to ignore.'],
    ].filter(([k]) => c.byCause[k]);
    mount(body,
      h('div', { class: 'meta-line addf-counts' },
        h('span', { class: 'dim' }, `${plural(c.grabs, 'download', 'downloads')} in the last ${days} days`),
        c.titles ? pill(`${plural(c.titles, series ? 'episode' : 'movie', series ? 'episodes' : 'movies')} downloaded more than once`, 'warn') : pill('Nothing downloaded twice', 'ok'),
        c.same ? pill(`${plural(c.same, 'time', 'times')} the very same release`, 'down') : null,
        c.never ? pill(`${plural(c.never, 'download', 'downloads')} never imported`, 'warn') : null,
        h('span', { style: { marginLeft: 'auto', display: 'flex', gap: '8px', alignItems: 'center' } }, period,
          analysis.titles.length ? h('button', { class: 'btn sm', type: 'button', onclick: () => downloadCsv(`repeat-downloads-${ctx.service.key}-${stamp()}.csv`, toCsv(REPEAT_CSV_HEADERS, repeatCsvRows(analysis, { kind, names: data.names }))) }, 'Export CSV') : null)),
      data.errors.length ? h('p', { class: 'dim settings-copy' }, `Some of the history couldn’t be read: ${data.errors[0]}`) : null,
      h('div', { class: 'section-title' }, 'Settings that cause it'),
      !data.admin ? h('p', { class: 'dim settings-copy' }, 'Checking the download settings needs an admin.') :
        findings.length ? h('div', { class: 'list' }, ...findings.map(findingCard)) : h('p', { class: 'dim settings-copy' }, `No setting here makes ${app} download things twice.${data.usesSab && !sabServices.length ? ' Add SABnzbd in Settings → Services to check its duplicate settings too.' : ''}`),
      data.admin && data.usesSab && !sabServices.length && findings.length ? h('p', { class: 'dim settings-copy' }, 'Add SABnzbd in Settings → Services to check its duplicate settings too.') : null,
      causes.length ? h('div', {}, h('div', { class: 'section-title' }, 'Why they were downloaded again'),
        h('div', { class: 'list' }, ...causes.map(([k, text]) => h('div', { class: 'row', style: { alignItems: 'flex-start' } }, h('div', { class: 'row-main' },
          h('div', { class: 'row-title', style: { fontSize: '13px' } }, pill(String(c.byCause[k]), k === 'lost' || k === 'again' ? 'warn' : 'muted'), ' ', CAUSE_TEXT[k].replace(/^./, (x) => x.toUpperCase())),
          h('div', { class: 'dim', style: { fontSize: '12px', marginTop: '3px', lineHeight: '1.5' } }, text)))))) : null,
      c.same ? h('p', { class: 'dim settings-copy' }, `${plural(c.same, 'repeat was', 'repeats were')} the same release downloaded again.${data.usesSab ? ` Unless its duplicate detection stops it, SABnzbd saves the second copy in a folder ending “.1”, which ${app} doesn’t clean up.` : ''}`) : null,
      analysis.never.length ? h('div', {},
        h('div', { class: 'section-title' }, `Downloaded but never imported (${analysis.never.length})`),
        h('p', { class: 'dim settings-copy' }, `${app} has no record of importing these, and they’re not in the queue, so they’re probably still in the download folder.${c.neverBytes ? ` About ${fmtBytes(c.neverBytes)}.` : ''}`),
        h('div', { class: 'list' }, ...analysis.never.slice(0, showNever).map((g) => h('div', { class: 'row' }, h('div', { class: 'row-main' },
          h('div', { class: 'row-title addf-name' }, titleOf(g, kind, data.names), h('span', { class: 'dim' }, fmtRelative(g.date))),
          h('div', { class: 'mono dim', style: { fontSize: '11px', wordBreak: 'break-all' } }, g.sourceTitle || ''))))),
        analysis.never.length > showNever ? h('button', { class: 'btn sm', type: 'button', onclick: () => { showNever += 50; paint(); } }, `Show ${Math.min(50, analysis.never.length - showNever)} more`) : null,
        h('div', { class: 'meta-line', style: { marginTop: '8px' } }, h('button', { class: 'btn sm', type: 'button', onclick: () => { closeModal(); import('./untrackedUI.js').then((m) => m.openUntracked(arr, ctx, kind, { tab: 'leftovers' })); } }, 'Open Leftover downloads'))) : null,
      analysis.titles.length ? h('div', {},
        h('div', { class: 'section-title' }, `Downloaded more than once (${analysis.titles.length})`),
        h('div', { class: 'list' }, ...analysis.titles.slice(0, showTitles).map(titleRow)),
        analysis.titles.length > showTitles ? h('button', { class: 'btn sm', type: 'button', onclick: () => { showTitles += 50; paint(); } }, `Show ${Math.min(50, analysis.titles.length - showTitles)} more`) : null) : null);
  }
  load();
}
