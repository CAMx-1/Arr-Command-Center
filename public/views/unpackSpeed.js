// Unpackerr (extract queue, why items are stuck) and Speedtest Tracker
// (line speed history next to what the download clients use right now).
import { h, mount, tabs, skeletonList, empty, toast, fmtBytes, fmtRelative } from '../lib/ui.js';
import { statCard } from './downloadClient.js';
import { liveRefresh } from '../lib/live.js';
import { unpackerrClient, unpackerrDiagnosis, UNPACKERR_STATUS, speedtestClient, speedSummary } from '../lib/integrations.js';
import { currentDownloadSpeed } from '../lib/currentDownloadSpeed.js';
import { roleAllows } from '../lib/roleUi.js';

const statRow = (...cards) => h('div', { class: 'honeycomb' }, h('div', { class: 'hc-row' }, ...cards.filter(Boolean)));
const failed = (root, what, err, retry) => mount(root, empty('⚠️', `Failed to load ${what}`, err.message, retry ? { label: 'Retry', onClick: retry } : undefined));
const baseName = (p) => String(p || '').split(/[\\/]/).filter(Boolean).pop() || p;

function loader(root, what, render, refreshMs = 0) {
  const wrap = h('div', {});
  mount(root, wrap);
  const load = async (silent = false) => {
    if (!silent) mount(wrap, skeletonList());
    try { await render(wrap, () => load(true)); } catch (err) { if (!silent) failed(wrap, what, err, () => load(false)); }
  };
  load(false);
  if (refreshMs) liveRefresh(wrap, null, refreshMs, () => load(true));
}
function mountTabs(root, ctx, defs) {
  const body = h('div', {});
  mount(root, tabs(body, defs, `tabs-${ctx.service.key}`, { activeId: ctx.params.tab, onChange: (id) => ctx.setParams({ tab: id === defs[0].id ? '' : id }) }), body);
}

// ==================================================================== Unpackerr
export async function renderUnpackerr(root, ctx) {
  const client = unpackerrClient(ctx.api, ctx.service.key);
  ctx.setActions();
  mountTabs(root, ctx, [
    { id: 'queue', label: 'Queue', render: (c) => unpackerrQueue(c, client) },
    { id: 'history', label: 'History', render: (c) => unpackerrHistory(c, client) },
  ]);
}

function unpackerrRow(item, actions) {
  const [label, cls] = UNPACKERR_STATUS[item.status] || [item.status, 'muted'];
  const dx = unpackerrDiagnosis(item);
  return h('div', { class: 'row', style: { alignItems: 'flex-start' } },
    h('div', { class: 'row-main' },
      h('div', { class: 'row-title', style: { fontSize: '14px', wordBreak: 'break-all' } }, (item.ids && item.ids.title) || baseName(item.path)),
      h('div', { class: 'meta-line' },
        h('span', { class: `pill ${cls}` }, label), h('span', { class: 'pill muted' }, item.app || item.kind || ''),
        item.status === 'extracting' && item.percent != null ? h('span', {}, `${Math.round(item.percent)}%${item.speedBps ? ` · ${fmtBytes(item.speedBps)}/s` : ''}`) : null,
        item.retries ? h('span', { class: 'dim' }, `${item.retries} ${item.retries === 1 ? 'retry' : 'retries'}`) : null,
        item.bytes ? h('span', { class: 'dim' }, fmtBytes(item.bytes)) : null,
        item.updated || item.finished ? h('span', { class: 'dim' }, fmtRelative(item.finished || item.updated)) : null,
        item.due && item.dueKind === 'retry' ? h('span', { class: 'dim' }, `retries ${fmtRelative(item.due)}`) : null),
      dx ? h('div', { style: { fontSize: '12px', marginTop: '4px' } }, h('b', {}, 'Why: '), dx.reason, dx.fix ? h('div', { class: 'dim' }, dx.fix) : null) : null),
    actions && actions.length ? h('div', { class: 'row-actions' }, ...actions) : null);
}

function unpackerrQueue(root, client) {
  loader(root, 'the extract queue', async (wrap, reload) => {
    const [stats, queue] = await Promise.all([client.stats().catch(() => ({})), client.queue()]);
    const stuck = queue.filter((q) => unpackerrDiagnosis(q) && unpackerrDiagnosis(q).level !== 'muted');
    const order = { extractfailed: 0, extracted: 1, extracting: 2, queued: 3, waiting: 4 };
    const list = queue.slice().sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));
    const act = (fn, done) => async (e) => { e.target.disabled = true; try { await fn(); toast(done, 'success'); reload(); } catch (err) { toast(err.message, 'error'); e.target.disabled = false; } };
    mount(wrap,
      statRow(statCard('Extracting', String(stats.extracting ?? 0), 'info'), statCard('Queued', String((stats.queued ?? 0) + (stats.waiting ?? 0)), 'muted'),
        statCard('Stuck', String(stuck.length), stuck.length ? 'down' : 'ok'), statCard('Finished', String(stats.finished ?? 0), 'ok')),
      (stats.starrQueues || []).some((s) => s.error) ? h('p', { class: 'dim' }, `Can’t reach: ${(stats.starrQueues || []).filter((s) => s.error).map((s) => `${s.app}${s.name ? ` ${s.name}` : ''} (${s.error})`).join(', ')}`) : null,
      list.length ? h('div', { class: 'list', style: { marginTop: '10px' } }, ...list.map((q) => {
        const actions = [];
        if (q.status === 'extractfailed' && roleAllows('write')) actions.push(h('button', { class: 'btn sm primary', onclick: act(() => client.retry(q.id), `Retrying ${baseName(q.path)}`) }, 'Retry'));
        if (['extractfailed', 'extracted', 'imported', 'deleted', 'extractednothing'].includes(q.status) && roleAllows('delete')) actions.push(h('button', { class: 'btn sm', title: 'Stop tracking this item (files are left alone)', onclick: act(() => client.forget(q.id), `Forgot ${baseName(q.path)}`) }, 'Forget'));
        return unpackerrRow(q, actions);
      })) : empty('✓', 'Nothing in the queue', 'Archives from Sonarr, Radarr and watched folders show here while they extract.'));
  }, 10000);
}

function unpackerrHistory(root, client) {
  loader(root, 'history', async (wrap) => {
    const items = await client.history();
    if (!items.length) return mount(wrap, empty('', 'No history yet'));
    mount(wrap, h('div', { class: 'list' }, ...items.map((i) => unpackerrRow(i))));
  }, 30000);
}

// ========================================================= Speedtest Tracker
function speedChart(points, current) {
  const ok = points.filter((p) => p.ok && p.down != null);
  const w = 600; const ht = 140; const pad = 6;
  const max = Math.max(1, ...ok.map((p) => p.down), current || 0) * 1.08;
  const t0 = Date.parse(points[0].at); const t1 = Date.parse(points[points.length - 1].at) || t0 + 1;
  const x = (p) => pad + ((Date.parse(p.at) - t0) / Math.max(1, t1 - t0)) * (w - 2 * pad);
  const y = (v) => ht - pad - (v / max) * (ht - 2 * pad);
  const ns = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs) => { const e = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
  const svg = el('svg', { viewBox: `0 0 ${w} ${ht}`, preserveAspectRatio: 'none', role: 'img', 'aria-label': `Download speed tests, ${ok.length} results` });
  Object.assign(svg.style, { width: '100%', height: '140px', display: 'block' });
  const line = (key, color) => svg.appendChild(el('polyline', { points: ok.map((p) => `${x(p).toFixed(1)},${y(p[key]).toFixed(1)}`).join(' '), fill: 'none', stroke: color, 'stroke-width': '2', 'vector-effect': 'non-scaling-stroke' }));
  line('down', '#a78bfa'); line('up', '#38bdf8');
  for (const p of points.filter((q) => !q.ok)) svg.appendChild(el('line', { x1: x(p), x2: x(p), y1: pad, y2: ht - pad, stroke: '#fb7185', 'stroke-dasharray': '3 3', 'vector-effect': 'non-scaling-stroke' }));
  if (current) svg.appendChild(el('line', { x1: pad, x2: w - pad, y1: y(current), y2: y(current), stroke: '#4ade80', 'stroke-width': '2', 'stroke-dasharray': '6 4', 'vector-effect': 'non-scaling-stroke' }));
  const key = (c, t) => h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '4px' } }, h('span', { style: { width: '10px', height: '3px', background: c, display: 'inline-block' } }), t);
  return h('div', {}, svg,
    h('div', { class: 'dim', style: { display: 'flex', gap: '12px', fontSize: '11px', flexWrap: 'wrap', marginTop: '4px' } },
      key('#a78bfa', 'Download'), key('#38bdf8', 'Upload'), current ? key('#4ade80', 'Downloading now') : null, points.some((p) => !p.ok) ? key('#fb7185', 'Failed test') : null,
      h('span', { style: { marginLeft: 'auto' } }, `${new Date(t0).toLocaleDateString()} – ${new Date(t1).toLocaleDateString()}`)));
}

export async function renderSpeedtest(root, ctx) {
  const client = speedtestClient(ctx.api, ctx.service.key);
  const runBtn = roleAllows('write') ? h('button', { class: 'btn sm', onclick: async () => { runBtn.disabled = true; try { await client.run(); toast('Speedtest started. Results appear in a minute or two.', 'success'); } catch (e) { toast(e.message, 'error'); } runBtn.disabled = false; } }, 'Run speedtest') : null;
  ctx.setActions(runBtn);
  let days = 14;
  const daysSel = h('select', { class: 'input', style: { width: 'auto' }, 'aria-label': 'Range' }, ...[[1, 'Last day'], [7, 'Last week'], [14, 'Last 2 weeks'], [30, 'Last 30 days']].map(([d, l]) => h('option', { value: String(d), selected: d === days ? 'selected' : null }, l)));
  const body = h('div', {});
  daysSel.addEventListener('change', () => { days = Number(daysSel.value); go(); });
  mount(root, h('div', { style: { display: 'flex', justifyContent: 'flex-end', marginBottom: '8px' } }, daysSel), body);
  const go = () => loader(body, 'speedtest results', async (wrap) => {
    const [results, dl] = await Promise.all([client.results({ days }), currentDownloadSpeed(ctx.api, ctx.state.services).catch(() => ({ total: 0, clients: [] }))]);
    if (!results.length) return mount(wrap, empty('', 'No results in this range', 'Speedtest Tracker hasn’t run a test yet.'));
    const s = speedSummary(results);
    const last = results[results.length - 1];
    const nowMbps = Math.round((dl.total * 8) / 1e5) / 10;
    const share = s && s.avgDown ? Math.round((nowMbps / s.avgDown) * 100) : null;
    mount(wrap,
      statRow(
        statCard('Latest down', last.ok ? `${last.down} Mbps` : 'Failed', last.ok ? (last.healthy === false ? 'warn' : 'ok') : 'down'),
        statCard('Latest up', last.ok ? `${last.up} Mbps` : '—', 'info'),
        statCard('Ping', last.ok && last.ping != null ? `${last.ping} ms` : '—', 'muted'),
        statCard('Downloading now', `${nowMbps} Mbps`, share != null && share >= 85 ? 'warn' : 'ok')),
      h('p', { class: 'dim', style: { fontSize: '12px', margin: '8px 0' } },
        s ? `Average ${s.avgDown} Mbps down, ${s.avgUp} up, ${s.avgPing} ms over ${s.count} tests (lowest ${s.minDown}, highest ${s.maxDown}).` : '',
        s && s.failed ? ` ${s.failed} failed.` : '', s && s.unhealthy ? ` ${s.unhealthy} below your benchmark.` : '',
        share != null && dl.clients.length ? ` Your download clients are using about ${share}% of the average tested speed right now.` : '',
        dl.clients.some((c) => c.error) ? ` Couldn’t read: ${dl.clients.filter((c) => c.error).map((c) => c.svc.label).join(', ')}.` : ''),
      speedChart(results, nowMbps),
      h('div', { class: 'section-title', style: { marginTop: '14px' } }, 'Recent tests'),
      h('div', { class: 'list' }, ...results.slice(-12).reverse().map((r) => h('div', { class: 'row', style: { padding: '6px 10px' } },
        h('div', { class: 'row-main' },
          h('div', { class: 'meta-line' },
            r.ok ? h('span', {}, `↓ ${r.down} Mbps · ↑ ${r.up} Mbps · ${r.ping} ms`) : h('span', { class: 'pill down' }, r.status),
            r.ok && r.healthy === false ? h('span', { class: 'pill warn' }, 'below benchmark') : null,
            h('span', { class: 'dim' }, fmtRelative(r.at)), r.server ? h('span', { class: 'dim' }, r.server) : null,
            r.error ? h('span', { class: 'dim' }, r.error) : null))))));
  }, 60000);
  go();
}
