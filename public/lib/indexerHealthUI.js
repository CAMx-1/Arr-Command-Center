// Prowlarr → Health tab: per-indexer failure rate, grab rate, response time,
// and what to do about the problem ones.
import { h, mount, skeletonList, empty, toast, fmtRelative } from './ui.js';
import { loadIndexerHealth } from './indexerHealth.js';
import { roleAllows } from './roleUi.js';
import { toCsv, downloadCsv, stamp } from './csv.js';

const LEVEL = { down: ['Problem', 'down'], warn: ['Check', 'warn'], ok: ['Healthy', 'ok'], muted: ['Disabled', 'muted'] };

export function tabIndexerHealth(root, ctx, px) {
  let days = 30;
  const sel = h('select', { class: 'input', style: { width: 'auto' }, 'aria-label': 'Period' }, ...[[1, 'Last day'], [7, 'Last week'], [30, 'Last 30 days'], [90, 'Last 90 days']].map(([d, l]) => h('option', { value: String(d), selected: d === days ? 'selected' : null }, l)));
  const out = h('div', {});
  sel.addEventListener('change', () => { days = Number(sel.value); load(); });
  mount(root, h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: '8px', marginBottom: '8px' } }, sel), out);
  const admin = roleAllows('admin');

  async function test(r, btn) {
    btn.disabled = true;
    try {
      const ix = await px.get(`indexer/${r.id}`);
      await px.post('indexer/test', ix);
      toast(`${r.name}: test passed`, 'success');
    } catch (e) { toast(`${r.name}: ${e.message}`, 'error', 7000); }
    btn.disabled = false;
  }
  async function disable(r, btn) {
    if (btn.dataset.armed !== '1') { btn.dataset.armed = '1'; btn.textContent = 'Disable?'; setTimeout(() => { btn.dataset.armed = ''; btn.textContent = 'Disable'; }, 5000); return; }
    btn.disabled = true;
    try { const ix = await px.get(`indexer/${r.id}`); await px.put(`indexer/${r.id}`, { ...ix, enable: false }); toast(`${r.name} disabled`, 'success'); load(); }
    catch (e) { toast(e.message, 'error'); btn.disabled = false; }
  }

  async function load() {
    mount(out, skeletonList(4));
    let data;
    try { data = await loadIndexerHealth(px, { days }); } catch (e) { mount(out, empty('', 'Couldn’t load indexer stats', e.message)); return; }
    const s = data.summary;
    const stat = (label, value, cls = '') => h('div', { class: 'card', style: { padding: '10px 12px' } }, h('div', { class: 'dim', style: { fontSize: '12px' } }, label), h('div', { class: cls ? `pill ${cls}` : '', style: { fontSize: '20px', fontWeight: '600' } }, value));
    mount(out,
      h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '8px' } },
        stat('Indexers', String(s.indexers)), stat('Problems', String(s.problems)), stat('To check', String(s.warnings)),
        stat('Searches', s.queries.toLocaleString()), stat('Failed', `${s.failRate}%`), stat('Grabs', s.grabs.toLocaleString())),
      h('div', { style: { display: 'flex', justifyContent: 'flex-end', margin: '10px 0 6px' } },
        h('button', { class: 'btn sm', onclick: () => downloadCsv(`indexer-health-${stamp()}.csv`, toCsv(['Indexer', 'Status', 'Searches', 'Failed %', 'Grabs', 'Grab rate %', 'Failed grabs', 'Avg response ms', 'Issues'], data.rows.map((r) => [r.name, LEVEL[r.level][0], r.queries, r.failRate, r.grabs, r.grabRate, r.failedGrabs, r.responseMs, r.issues.map((i) => i.text).join(' ')]))) }, 'Export CSV')),
      h('div', { class: 'list' }, ...data.rows.map((r) => {
        const [label, cls] = LEVEL[r.level];
        const tBtn = admin && r.enabled ? h('button', { class: 'btn sm', onclick: () => test(r, tBtn) }, 'Test') : null;
        const dBtn = admin && r.enabled && r.level === 'down' ? h('button', { class: 'btn sm danger', onclick: () => disable(r, dBtn) }, 'Disable') : null;
        return h('div', { class: 'row', style: { alignItems: 'flex-start' } },
          h('div', { class: 'row-main' },
            h('div', { class: 'row-title', style: { fontSize: '14px' } }, r.name, ' ', h('span', { class: `pill ${cls}` }, label), r.protocol ? h('span', { class: 'pill muted', style: { marginLeft: '4px' } }, r.protocol) : null),
            r.enabled ? h('div', { class: 'meta-line', style: { fontSize: '12px', flexWrap: 'wrap' } },
              h('span', {}, `${r.queries.toLocaleString()} searches`), h('span', { class: r.failRate >= 10 ? '' : 'dim' }, `${r.failRate}% failed`),
              h('span', {}, `${r.grabs} grabs (${r.grabRate}% of searches)`), r.responseMs ? h('span', { class: 'dim' }, `${r.responseMs} ms avg`) : null,
              r.lastFailure ? h('span', { class: 'dim' }, `last failure ${fmtRelative(r.lastFailure)}`) : null) : h('div', { class: 'dim', style: { fontSize: '12px' } }, 'Disabled in Prowlarr'),
            ...r.issues.filter((i) => i.level !== 'muted' || r.level === 'ok').map((i) => h('div', { style: { fontSize: '12px', marginTop: '4px' } }, '• ', i.text, i.fix ? h('span', { class: 'dim' }, ` ${i.fix}`) : null))),
          tBtn || dBtn ? h('div', { class: 'row-actions' }, tBtn, dBtn) : null);
      })),
      h('p', { class: 'dim', style: { fontSize: '12px', marginTop: '10px' } }, 'Counts come from Prowlarr’s own stats for the chosen period and include RSS and auth requests.'));
  }
  load();
}
