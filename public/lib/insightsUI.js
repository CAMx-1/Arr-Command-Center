// "Insights" dialog (System tab): where the space goes, largest titles,
// possible HEVC savings and growth from the daily snapshots.
import { h, mount, spinner, empty, openModal, closeModal, fmtBytes } from './ui.js';
import { loadInsights, HEVC_RATIO } from './libraryInsights.js';
import { api } from './api.js';
import { toCsv, downloadCsv, stamp } from './csv.js';

const COLORS = ['#a78bfa', '#38bdf8', '#4ade80', '#fbbf24', '#fb7185', '#e879f9', '#94a3b8'];

function breakdown(title, groups, total) {
  return h('div', { style: { minWidth: '0' } },
    h('div', { class: 'section-title', style: { margin: '14px 0 6px' } }, title),
    ...groups.slice(0, 8).map((g, i) => h('div', { style: { margin: '0 0 6px' } },
      h('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: '12px', gap: '8px' } },
        h('span', {}, g.name), h('span', { class: 'dim' }, `${fmtBytes(g.bytes)} · ${g.count} ${g.count === 1 ? 'file' : 'files'}`)),
      h('div', { style: { height: '6px', borderRadius: '3px', background: 'var(--border, #333)', overflow: 'hidden' } },
        h('div', { style: { height: '100%', width: `${total ? Math.max(1, (g.bytes / total) * 100) : 0}%`, background: COLORS[i % COLORS.length] } })))));
}

function growthChart(points) {
  const w = 600; const ht = 120; const pad = 4;
  const ys = points.map((p) => p.bytes);
  const min = Math.min(...ys); const max = Math.max(...ys); const span = max - min || 1;
  const xy = points.map((p, i) => `${(pad + (i / Math.max(1, points.length - 1)) * (w - 2 * pad)).toFixed(1)},${(ht - pad - ((p.bytes - min) / span) * (ht - 2 * pad)).toFixed(1)}`);
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${ht}`); svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', `Library size from ${fmtBytes(min)} to ${fmtBytes(max)}`);
  Object.assign(svg.style, { width: '100%', height: '120px', display: 'block' });
  const line = document.createElementNS(svgNS, 'polyline');
  line.setAttribute('points', xy.join(' ')); line.setAttribute('fill', 'none'); line.setAttribute('stroke', '#a78bfa'); line.setAttribute('stroke-width', '2'); line.setAttribute('vector-effect', 'non-scaling-stroke');
  svg.appendChild(line);
  return h('div', {}, svg, h('div', { class: 'dim', style: { display: 'flex', justifyContent: 'space-between', fontSize: '11px' } }, h('span', {}, points[0].date), h('span', {}, points[points.length - 1].date)));
}

export async function openInsights(arr, ctx, kind) {
  const body = h('div', {});
  openModal({ title: `Insights — ${ctx.service.label}`, body, wide: true, footer: h('button', { class: 'btn', onclick: closeModal }, 'Close') });
  const progress = h('span', { class: 'dim' }, 'Reading the library…');
  mount(body, h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center' } }, spinner(), progress));
  let s;
  try { s = await loadInsights(arr, { kind, serviceKey: ctx.service.key, getJson: (p) => api.getJson(p), onProgress: ({ done, total }) => { progress.textContent = `Reading episode files… ${done}/${total} series`; } }); }
  catch (e) { mount(body, empty('', 'Couldn’t read the library', e.message)); return; }
  if (!s.files) { mount(body, empty('', 'No files yet', 'Insights appear once there are downloaded files.')); return; }
  const g = s.growth;
  const stat = (label, value, sub) => h('div', { class: 'card', style: { padding: '10px 12px' } }, h('div', { class: 'dim', style: { fontSize: '12px' } }, label), h('div', { style: { fontSize: '20px', fontWeight: '600' } }, value), sub ? h('div', { class: 'dim', style: { fontSize: '11px' } }, sub) : null);
  mount(body,
    h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '8px' } },
      stat('Total size', fmtBytes(s.total), `${s.files} files`),
      stat(g ? `Last ${g.days} days` : 'Growth', g ? `${g.bytes >= 0 ? '+' : '−'}${fmtBytes(Math.abs(g.bytes))}` : '—', g ? `about ${fmtBytes(Math.abs(g.perDay))} a day · ${g.items >= 0 ? '+' : ''}${g.items} titles` : 'Snapshots are saved once a day'),
      stat('Possible HEVC saving', s.hevc.files ? `~${fmtBytes(s.hevc.saving)}` : 'None', s.hevc.files ? `${s.hevc.files} H.264 ${s.hevc.files === 1 ? 'file' : 'files'}, ${fmtBytes(s.hevc.bytes)}` : 'No H.264 files')),
    g && g.points.length > 2 ? h('div', {}, h('div', { class: 'section-title', style: { margin: '14px 0 6px' } }, 'Library size over time'), growthChart(g.points)) : null,
    h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '0 18px' } },
      breakdown('By quality', s.byQuality, s.total), breakdown('By resolution', s.byResolution, s.total), breakdown('By video codec', s.byCodec, s.total)),
    h('div', { style: { display: 'flex', alignItems: 'center', margin: '14px 0 6px' } },
      h('div', { class: 'section-title', style: { margin: '0', flex: '1' } }, 'Largest titles'),
      h('button', { class: 'btn sm', onclick: () => downloadCsv(`largest-${ctx.service.key}-${stamp()}.csv`, toCsv(['Title', 'Bytes', 'Size', 'Files'], s.largest.map((t) => [t.title, t.bytes, fmtBytes(t.bytes), t.files]))) }, 'Export CSV')),
    h('div', { class: 'list' }, ...s.largest.map((t, i) => h('div', { class: 'row', style: { padding: '6px 10px' } },
      h('div', { class: 'row-main' }, h('div', { class: 'row-title', style: { fontSize: '13px' } }, `${i + 1}. ${t.title}`)),
      h('span', { class: 'dim', style: { fontSize: '12px', whiteSpace: 'nowrap' } }, `${fmtBytes(t.bytes)}${kind === 'series' ? ` · ${t.files} files` : ''}`)))),
    h('p', { class: 'dim', style: { fontSize: '12px', marginTop: '10px' } }, `The HEVC figure assumes re-encoded files end up about ${Math.round(HEVC_RATIO * 100)}% of their H.264 size. Real results depend on the source and encoder settings.`));
}
