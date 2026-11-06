// Windowed rendering for long lists and tables. Items are grouped into
// chunks; only chunks near the viewport are in the DOM, and the rest are
// spacers of the same height. Each chunk is measured the first time it
// renders, so rows can be any height. Short lists render normally.
//
// windowedRows(items, makeItem, { container, spacer, chunk, buffer, threshold })
//   container: the element rows go into (a .list div or a <tbody>)
//   spacer(px): creates a placeholder of that height (a div, or a <tr>)
// Assumes the window scrolls (sticky top bar, no inner overflow).
import { h } from './ui.js';

export function chunkRanges(n, size) {
  const out = [];
  for (let i = 0; i < n; i += size) out.push([i, Math.min(n, i + size)]);
  return out;
}

// Which chunks should be rendered, given each chunk's [top, bottom] relative
// to the viewport and the viewport height. Pure, for tests.
export function visibleChunks(boxes, viewport, buffer) {
  const keep = new Set();
  boxes.forEach(([top, bottom], i) => { if (bottom >= -buffer && top <= viewport + buffer) keep.add(i); });
  return keep;
}

export function windowedRows(items, makeItem, { container, spacer = (px) => h('div', { class: 'win-spacer', style: { height: `${px}px` } }), chunk = 40, buffer = 1500, threshold = 150, estimate = 64 } = {}) {
  if (items.length <= threshold) { for (let i = 0; i < items.length; i++) container.appendChild(makeItem(items[i], i)); return { refresh() {}, stop() {} }; }
  container.classList.add('windowed');
  container.style.overflowAnchor = 'none'; // we keep the scroll position ourselves
  const ranges = chunkRanges(items.length, chunk);
  // Each chunk: either { nodes } (rendered) or { spacer } (placeholder), plus
  // its last known height.
  const state = ranges.map(([a, b]) => ({ nodes: null, spacer: null, height: (b - a) * estimate }));
  let perItem = estimate;
  state.forEach((s, i) => { s.spacer = spacer(s.height); s.spacer.dataset.chunk = String(i); container.appendChild(s.spacer); });

  const edges = (s) => {
    if (s.nodes) { const a = s.nodes[0].getBoundingClientRect(); const z = s.nodes[s.nodes.length - 1].getBoundingClientRect(); return [a.top, z.bottom]; }
    const r = s.spacer.getBoundingClientRect(); return [r.top, r.bottom];
  };
  function render(i) {
    const s = state[i]; const [a, b] = ranges[i];
    const nodes = []; const frag = document.createDocumentFragment();
    for (let k = a; k < b; k++) { const el = makeItem(items[k], k); nodes.push(el); frag.appendChild(el); }
    s.spacer.replaceWith(frag); s.nodes = nodes;
  }
  function collapse(i, height) {
    const s = state[i];
    s.height = height; s.spacer.style.height = `${height}px`;
    s.nodes[0].before(s.spacer); for (const el of s.nodes) el.remove(); s.nodes = null;
  }
  let busy = false;
  function update() {
    if (!container.isConnected) return stop();
    // Reads first, then writes, so the browser lays out once.
    const vh = window.innerHeight;
    const boxes = state.map(edges);
    const keep = visibleChunks(boxes, vh, buffer);
    let shift = 0;
    state.forEach((s, i) => { if (s.nodes && !keep.has(i)) collapse(i, Math.max(0, boxes[i][1] - boxes[i][0])); });
    for (const i of keep) {
      const s = state[i]; if (s.nodes) continue;
      const above = boxes[i][1] < 0; const before = s.height;
      render(i);
      const [t, b] = edges(s); s.height = b - t;
      const n = ranges[i][1] - ranges[i][0]; perItem = perItem * 0.7 + (s.height / n) * 0.3;
      if (above) shift += s.height - before; // content above us changed size
    }
    if (shift) window.scrollBy(0, shift);
    // Better guesses for chunks never seen yet, so the scrollbar is honest.
    state.forEach((s, i) => { if (!s.nodes && !s.measured) { const want = Math.round((ranges[i][1] - ranges[i][0]) * perItem); if (Math.abs(want - s.height) > 4 && boxes[i][0] > vh + buffer) { s.height = want; s.spacer.style.height = `${want}px`; } } });
    state.forEach((s) => { if (s.nodes) s.measured = true; });
  }
  const onScroll = () => { if (busy) return; busy = true; requestAnimationFrame(() => { busy = false; update(); }); };
  function stop() { window.removeEventListener('scroll', onScroll, true); window.removeEventListener('resize', onScroll); }
  window.addEventListener('scroll', onScroll, true);
  window.addEventListener('resize', onScroll);
  requestAnimationFrame(update);
  // Render the first chunk straight away so the page isn't empty for a frame.
  render(0);
  return { refresh: update, stop };
}

// A .list of rows, windowed when long.
export function windowedList(items, makeRow, opts = {}) {
  const list = h('div', { class: 'list' });
  windowedRows(items, makeRow, { container: list, ...opts });
  return list;
}
