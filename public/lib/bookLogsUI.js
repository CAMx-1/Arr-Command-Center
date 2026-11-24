// The app's log files, grouped: each warning or error pattern once, with how
// often it happened, when first and last, the latest lines and, for a few
// common problems, what they mean and where to fix them. Log files can hold
// paths and server names, so ArrCC shows them to admins only (log/file is an
// admin read). Pure logic is lib/logGroups.js.
import { h, mount, spinner, skeletonList, empty, toast, fmtRelative } from './ui.js';
import {
  parseLogText, groupLogEntries, sortLogGroups, logSummary, pickLogFiles, logHint,
} from './logGroups.js';

const plural = (n, one, many = `${one}s`) => `${Number(n).toLocaleString()} ${n === 1 ? one : many}`;
const LEVEL_CLS = { Fatal: 'down', Error: 'down', Warn: 'warn', Info: 'info', Debug: 'muted', Trace: 'muted' };
const SHOW_LEVELS = [['Error', 'Errors'], ['Warn', 'Warnings'], ['Info', 'Everything']];
const FILE_COUNTS = [[1, 'Newest file'], [3, 'Newest 3 files'], [8, 'Newest 8 files'], [0, 'All files']];
const fmtTime = (t) => (t ? new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
const spanText = (from, to) => {
  if (!from || !to) return '';
  const hours = (to - from) / 3600000;
  return hours < 1.5 ? `${Math.max(1, Math.round(hours * 60))} min` : hours < 48 ? `${Math.round(hours)} h` : `${Math.round(hours / 24)} days`;
};

async function readFiles(arr, files, onProgress) {
  const texts = [];
  let done = 0;
  const queue = [...files];
  const worker = async () => {
    while (queue.length) {
      const f = queue.shift();
      try { texts.push({ f, text: String(await arr.get(`log/file/${encodeURIComponent(f.filename)}`)) }); }
      catch (e) { texts.push({ f, error: e.message }); }
      onProgress(++done, files.length);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return texts;
}

//   actions: { folders(), unmapped(), queue() } for the hints' buttons.
export async function tabLogs(root, arr, ctx, actions = {}) {
  const app = ctx.service.label;
  const state = {
    files: Number(ctx.params.logfiles) >= 0 && FILE_COUNTS.some(([n]) => n === Number(ctx.params.logfiles)) ? Number(ctx.params.logfiles) : 3,
    level: SHOW_LEVELS.some(([l]) => l === ctx.params.loglevel) ? ctx.params.loglevel : 'Warn',
    sort: ctx.params.logsort === 'latest' ? 'latest' : 'count',
    term: '',
  };
  mount(root, skeletonList());
  let list;
  try { list = await arr.get('log/file'); }
  catch (e) {
    return mount(root, empty('', 'Couldn’t list the log files', e.status === 403 ? 'Reading logs needs an admin account.' : e.message, { label: 'Retry', onClick: () => tabLogs(root, arr, ctx, actions) }));
  }
  const allFiles = pickLogFiles(Array.isArray(list) ? list : [], 0);
  if (!allFiles.length) return mount(root, empty('📄', 'No log files', `${app} didn’t list any log file.`));

  const summarySlot = h('div', {});
  const listSlot = h('div', {});
  let entries = [];
  let loadedFiles = [];

  const fileSel = h('select', { class: 'input sm', 'aria-label': 'Which log files' }, ...FILE_COUNTS.map(([n, label]) => h('option', { value: String(n) }, n === 0 ? `${label} (${allFiles.length})` : label)));
  fileSel.value = String(state.files);
  const levelSeg = h('div', { class: 'view-toggle', role: 'group', 'aria-label': 'Levels' }, ...SHOW_LEVELS.map(([l, label]) => h('button', {
    class: `view-seg ${state.level === l ? 'active' : ''}`, type: 'button', dataset: { level: l },
    onclick: (e) => {
      if (state.level === l) return;
      state.level = l;
      for (const b of e.currentTarget.parentElement.children) b.classList.toggle('active', b.dataset.level === l);
      ctx.setParams({ loglevel: l === 'Warn' ? '' : l });
      render();
    },
  }, label)));
  const sortSel = h('select', { class: 'input sm', 'aria-label': 'Order' }, h('option', { value: 'count' }, 'Most often first'), h('option', { value: 'latest' }, 'Latest first'));
  sortSel.value = state.sort;
  sortSel.addEventListener('change', () => { state.sort = sortSel.value; ctx.setParams({ logsort: state.sort === 'latest' ? 'latest' : '' }); render(); });
  const search = h('input', { class: 'input lib-filter-search', type: 'search', placeholder: 'Filter messages…', 'aria-label': 'Filter messages', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' });
  search.addEventListener('input', () => { state.term = search.value; render(); });
  const reloadBtn = h('button', { class: 'btn sm', type: 'button', title: 'Read the files again' }, 'Reload');

  const hintButton = (hint) => {
    if (hint.action === 'folders' && actions.folders) return h('button', { class: 'btn sm', type: 'button', onclick: actions.folders }, 'Check folders');
    if (hint.action === 'unmapped' && actions.unmapped) return h('button', { class: 'btn sm', type: 'button', onclick: actions.unmapped }, 'Unmapped files');
    return null;
  };

  const groupRow = (g) => {
    const hint = logHint(g, app);
    const detail = h('div', { class: 'log-detail', hidden: true });
    const open = () => {
      if (!detail.hidden) { detail.hidden = true; row.setAttribute('aria-expanded', 'false'); return; }
      const ex = g.examples.find((x) => x.extra && x.extra.length);
      mount(detail,
        hint ? h('div', { class: 'log-hint' }, h('span', {}, hint.text), hintButton(hint)) : null,
        h('div', { class: 'section-title', style: { margin: '8px 0 4px' } }, g.count > g.examples.length ? `Latest ${g.examples.length} of ${plural(g.count, 'line')}` : plural(g.count, 'line')),
        h('div', { class: 'log-examples' }, ...g.examples.map((x) => h('div', { class: 'log-example' }, h('span', { class: 'dim' }, fmtTime(x.time)), ' ', h('span', { class: 'mono' }, x.message)))),
        ex ? h('pre', { class: 'log-exception' }, ex.extra.join('\n')) : null);
      detail.hidden = false;
      row.setAttribute('aria-expanded', 'true');
    };
    const row = h('div', {
      class: 'row log-group', role: 'button', tabindex: '0', 'aria-expanded': 'false', onclick: (e) => { if (!e.target.closest('.log-detail')) open(); },
      onkeydown: (e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); open(); } },
    },
    h('div', { class: 'log-count', title: plural(g.count, 'time') }, g.count > 9999 ? `${Math.round(g.count / 1000)}k` : g.count.toLocaleString()),
    h('div', { class: 'row-main' },
      h('div', { class: 'log-pattern' }, g.pattern),
      h('div', { class: 'meta-line', style: { marginTop: '4px' } },
        h('span', { class: `pill ${LEVEL_CLS[g.level] || 'muted'}` }, g.level),
        h('span', { class: 'dim' }, g.logger),
        h('span', {}, `last ${fmtRelative(new Date(g.last).toISOString())}`),
        g.count > 1 ? h('span', { class: 'dim' }, `first ${fmtRelative(new Date(g.first).toISOString())}`) : null,
        hint ? h('span', { class: 'pill info', title: hint.text }, 'What this means') : null),
      detail));
    return row;
  };

  function render() {
    const groups = sortLogGroups(groupLogEntries(entries, { minLevel: state.level, term: state.term }), state.sort);
    const s = logSummary(entries);
    const c = s.counts;
    const failed = loadedFiles.filter((x) => x.error);
    mount(summarySlot, h('div', { class: 'log-summary' },
      h('span', {}, h('b', {}, plural((c.Error || 0) + (c.Fatal || 0), 'error')), ' · ', h('b', {}, plural(c.Warn || 0, 'warning')), ' · ', `${plural(groups.length, 'pattern')} shown`),
      s.from ? h('span', { class: 'dim' }, `${fmtTime(s.from)} → ${fmtTime(s.to)} (${spanText(s.from, s.to)}), from ${plural(loadedFiles.length - failed.length, 'file')}`) : null,
      failed.length ? h('span', { class: 'pill warn' }, `${plural(failed.length, 'file')} couldn’t be read`) : null));
    if (!groups.length) {
      return mount(listSlot, empty('✅', state.term ? 'Nothing matches' : `No ${state.level === 'Error' ? 'errors' : 'warnings or errors'}`, state.term ? 'Try other words.' : 'Read more files to look further back.'));
    }
    mount(listSlot, h('div', { class: 'list log-groups' }, ...groups.slice(0, 200).map(groupRow)),
      groups.length > 200 ? h('div', { class: 'dim', style: { margin: '8px 0' } }, `${groups.length - 200} more patterns: filter to narrow them down.`) : null);
  }

  async function load() {
    const chosen = pickLogFiles(allFiles, state.files);
    mount(listSlot, h('div', { class: 'dim', style: { margin: '10px 0' } }, spinner(), ` Reading ${plural(chosen.length, 'log file')}…`));
    mount(summarySlot);
    reloadBtn.disabled = true;
    loadedFiles = await readFiles(arr, chosen, (n, of) => {
      const el = listSlot.querySelector('.dim');
      if (el) el.lastChild.textContent = ` Reading log files… ${n} of ${of}`;
    });
    entries = [];
    for (const { f, text } of loadedFiles) if (text) entries = entries.concat(parseLogText(text, { source: f.filename }));
    reloadBtn.disabled = false;
    if (!root.isConnected) return;
    if (!entries.length && loadedFiles.every((x) => x.error)) {
      mount(listSlot, empty('', 'Couldn’t read the log files', loadedFiles[0].error));
      return;
    }
    render();
  }
  fileSel.addEventListener('change', () => { state.files = Number(fileSel.value); ctx.setParams({ logfiles: state.files === 3 ? '' : String(state.files) }); load(); });
  reloadBtn.onclick = () => load().catch((e) => toast(e.message, 'error'));

  mount(root,
    h('div', { class: 'lib-head log-head' }, levelSeg, h('div', { class: 'lib-filter' }, search, sortSel), fileSel, reloadBtn),
    h('p', { class: 'dim section-note' }, `${app}’s log files, with each kind of message counted once. Paths, numbers and titles are taken out, so the same problem with different books shows as one line. Open a line for the latest examples.`),
    summarySlot,
    listSlot);
  await load();
}
