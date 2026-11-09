// Disk-full forecast: a warning on Home when a library disk is filling up,
// the forecast dialog (every disk with a free-space chart), and the line on
// each disk in an app's System tab.
import { h, mount, empty, fmtBytes, fmtDate, pct, spinner, openModal } from './ui.js';
import { api } from './api.js';

const HIDE_KEY = (k) => `acc:disk-hide:${k}`;
const WARN = new Set(['full', 'critical', 'soon']);
const PILL = { full: ['down', 'Full'], critical: ['down', 'Under a week'], soon: ['warn', 'Under a month'], watch: ['info', 'Within 3 months'], ok: ['ok', 'Months to go'], steady: ['ok', 'Not filling'], unknown: ['muted', 'Too early to tell'] };

let cache = null;
async function load(fresh = false) {
  if (!fresh && cache && Date.now() - cache.at < 60000) return cache.data;
  const data = await api.getJson('/api/disks/forecast');
  cache = { at: Date.now(), data };
  return data;
}

export function forecastLine(d) {
  if (d.status === 'full') return `Full: ${fmtBytes(d.free)} left`;
  if (d.steady) return 'Not filling up: free space held steady or grew over the last month';
  if (d.days == null) return d.method ? 'No forecast yet' : `A forecast appears after a week of daily readings (${d.historyDays || 0} so far)`;
  const n = Math.max(1, Math.round(d.days));
  return `Fills in about ${n} ${n === 1 ? 'day' : 'days'}${d.fillsOn ? ` (around ${fmtDate(d.fillsOn)})` : ''} at ${fmtBytes(d.rate)} a day`;
}
const methodNote = (d) => (d.method === 'disk' ? `From ${d.historyDays} days of free-space readings.`
  : d.method === 'library' ? `Estimated from how fast ${d.growthFrom.length === 1 ? 'that app’s library' : 'those apps’ libraries'} grew; daily disk readings take over after a week.` : '');

// Free space over time, as a small line chart.
function sparkline(history, total) {
  const pts = (history || []).filter((x) => Number.isFinite(x.free));
  if (pts.length < 2) return null;
  const W = 220; const H = 44;
  const max = Math.max(...pts.map((p) => p.free), 1); const min = Math.min(...pts.map((p) => p.free), 0);
  const top = total > 0 ? Math.max(max, Math.min(total, max * 1.1)) : max;
  const x = (i) => (i / (pts.length - 1)) * W;
  const y = (v) => H - ((v - min) / Math.max(1, top - min)) * (H - 4) - 2;
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.free).toFixed(1)}`).join(' ');
  const date = (v) => String(v || '').replace(/[^0-9-]/g, '');
  // SVG markup inside a span: elements made with createElement('svg') are
  // HTML elements and don't draw.
  return h('span', { class: 'disk-spark', style: { display: 'block', color: 'var(--accent)' },
    html: `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Free space over the last ${pts.length} days" style="display:block"><title>Free space, ${date(pts[0].date)} to ${date(pts[pts.length - 1].date)}</title><path d="${d}" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg>` });
}

function diskCard(d, ctx) {
  const [cls, word] = PILL[d.status] || PILL.unknown;
  const used = d.usedPct;
  const planner = WARN.has(d.status) || d.status === 'watch' ? h('button', { class: 'btn sm', onclick: () => import('./spacePlannerUI.js').then((m) => m.openSpacePlanner(ctx, { disk: d })).catch(() => {}) }, 'Free up space') : null;
  return h('div', { class: 'row', style: { alignItems: 'flex-start', flexWrap: 'wrap' } },
    h('div', { class: 'row-main', style: { minWidth: '260px' } },
      h('div', { class: 'row-title', style: { fontSize: '14px' } }, d.label, ' ', h('span', { class: `pill ${cls}` }, word)),
      h('div', { class: 'meta-line' }, h('span', {}, d.total ? `${fmtBytes(d.free)} free of ${fmtBytes(d.total)}` : `${fmtBytes(d.free)} free`), used != null ? h('span', { class: 'dim' }, `${used}% used`) : null),
      used != null ? h('div', { class: 'progress', style: { margin: '6px 0' } }, h('span', { style: { width: pct(used) } })) : null,
      h('div', { style: { fontSize: '13px', fontWeight: '600' } }, forecastLine(d)),
      methodNote(d) ? h('div', { class: 'dim', style: { fontSize: '12px' } }, methodNote(d)) : null,
      h('div', { class: 'dim', style: { fontSize: '12px', marginTop: '2px' } }, 'Holds ', d.services.map((s) => `${s.label} (${s.roots.join(', ')})`).join('; '))),
    h('div', { style: { display: 'grid', gap: '6px', justifyItems: 'end' } }, sparkline(d.history, d.total), planner));
}

export async function openDiskForecast(ctx) {
  const body = h('div', {}, spinner());
  openModal({ title: 'Disk space forecast', body, wide: true });
  let data;
  try { data = await load(true); } catch (e) { mount(body, empty('', 'Couldn’t read the forecast', e.message)); return; }
  if (!data.disks.length) { mount(body, empty('', 'No readings yet', 'Disk space is read from Sonarr, Radarr, Lidarr, Readarr and Whisparr once a day, starting a minute after the server starts.')); return; }
  mount(body,
    h('p', { class: 'dim', style: { fontSize: '13px', margin: '0 0 10px' } }, 'The disks that hold your apps’ root folders, soonest to fill first. The forecast is a straight line through the last 30 days of free space, so a big import or clean-up moves it.'),
    h('div', { class: 'list' }, ...data.disks.map((d) => diskCard(d, ctx))));
}

// Home: a warning for disks filling within a month. Hidden per disk for a
// week with "Hide for a week".
export function diskBanner(ctx) {
  const box = h('div', { class: 'disk-banner', hidden: 'hidden' });
  load().then((data) => {
    const hidden = (k) => { try { return Number(localStorage.getItem(HIDE_KEY(k))) > Date.now(); } catch { return false; } };
    const warn = (data.disks || []).filter((d) => WARN.has(d.status) && !hidden(d.key));
    if (!warn.length) return;
    box.hidden = false;
    mount(box, h('div', { class: `card disk-warning severity-${warn[0].status === 'soon' ? 'warning' : 'critical'}`, role: 'status', style: { marginBottom: '14px' } },
      ...warn.map((d) => h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', padding: '2px 0' } },
        h('div', { style: { flex: '1', minWidth: '220px' } }, h('b', {}, d.label), ` · ${forecastLine(d)}`, h('div', { class: 'dim', style: { fontSize: '12px' } }, `${fmtBytes(d.free)} free · holds ${d.services.map((s) => s.label).join(', ')}`)),
        h('button', { class: 'btn sm primary', onclick: () => import('./spacePlannerUI.js').then((m) => m.openSpacePlanner(ctx, { disk: d })).catch(() => openDiskForecast(ctx)) }, 'Free up space'),
        h('button', { class: 'btn sm', onclick: () => openDiskForecast(ctx) }, 'Forecast'),
        h('button', { class: 'btn sm', title: 'Hide this warning for a week', onclick: () => { try { localStorage.setItem(HIDE_KEY(d.key), String(Date.now() + 7 * 86400000)); } catch { /* ignore */ } box.remove(); } }, 'Hide for a week')))));
  }).catch(() => {});
  return box;
}

// An app's System tab: the forecast for one of its disks, if there is one.
export async function forecastFor(serviceKey, diskPath) {
  const norm = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() || '/';
  try {
    const data = await load();
    return (data.disks || []).find((d) => d.services.some((s) => s.key === serviceKey && norm(s.path) === norm(diskPath))) || null;
  } catch { return null; }
}
