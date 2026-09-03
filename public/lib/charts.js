import { h } from './ui.js';

// Dependency-free bar chart for Tautulli graph data
// ({ categories:[labels], series:[{name,data:[]}] }).
//
// Built from real DOM/CSS (not a scaled SVG), so the text stays crisp and
// theme-aware at any width, and long series scroll horizontally.
// Pure prep: filter empty series, drop a redundant "Total" (unless it's the only
// series), and compute per-category totals + max. Exported for testing.
export function prepareSeries(data) {
  const categories = (data && data.categories) || [];
  let series = ((data && data.series) || []).filter((s) => (s.data || []).some((v) => Number(v)));
  const nonTotal = series.filter((s) => String(s.name || '').toLowerCase() !== 'total');
  if (nonTotal.length) series = nonTotal;
  const totals = categories.map((_, i) => series.reduce((a, s) => a + (Number(s.data[i]) || 0), 0));
  const max = Math.max(1, ...totals);
  return { categories, series, totals, max };
}

export function barChart(data, { height = 190, colors } = {}) {
  const { categories, series, totals, max } = prepareSeries(data);
  if (!categories.length || !series.length) return h('div', { class: 'dim', style: { padding: '16px 4px' } }, 'No data for this range');

  const palette = colors || ['#a78bfa', '#4ade80', '#38bdf8', '#fbbf24', '#fb7185', '#e879f9'];
  const showVals = categories.length <= 16;
  // Leave headroom at the top so the value label above the tallest bar isn't clipped.
  const usable = Math.max(20, height - 22);

  const cols = categories.map((cat, i) => {
    const total = totals[i];
    const segs = series.map((ser, si) => {
      const v = Number(ser.data[i]) || 0;
      if (!v) return null;
      return h('div', { class: 'bchart-seg', style: { height: `${((v / max) * usable).toFixed(1)}px`, background: palette[si % palette.length] } });
    }).filter(Boolean);
    const tip = `${cat} — ${series.map((ser) => `${ser.name}: ${Number(ser.data[i]) || 0}`).join(', ')} (total ${total})`;
    return h('div', { class: 'bchart-col', title: tip },
      h('div', { class: 'bchart-barwrap', style: { height: `${height}px` } },
        showVals && total ? h('div', { class: 'bchart-val' }, String(total)) : null,
        h('div', { class: 'bchart-bar' }, ...segs),
      ),
      h('div', { class: 'bchart-xlabel' }, String(cat)),
    );
  });

  const legend = series.length > 1
    ? h('div', { class: 'bchart-legend' }, ...series.map((ser, si) => h('span', { class: 'bchart-key' },
      h('i', { style: { background: palette[si % palette.length] } }), ser.name)))
    : null;

  return h('div', { class: 'bchart' },
    legend,
    h('div', { class: 'bchart-area' },
      h('div', { class: 'bchart-axis' }, h('span', {}, String(max)), h('span', {}, String(Math.round(max / 2))), h('span', {}, '0')),
      h('div', { class: 'bchart-plot', style: { height: `${height}px` } }, ...cols),
    ),
  );
}
