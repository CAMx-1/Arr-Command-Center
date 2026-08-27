// Shared honeycomb layout + poster/gradient hex tile, reused across all pages.
import { h, mount } from './ui.js';

// A paged library view: renders the first `pageSize` items (hex = virtualized,
// list = plain rows) with a "Load more" button that reveals the next page.
export function pagedLibrary(items, { isHex, makeCard, makeRow, pageSize = 100 }) {
  const container = h('div', {});
  let limit = pageSize;
  let io = null;
  const loadMore = () => { if (limit < items.length) { limit += pageSize; render(); } };
  const render = () => {
    const shown = items.slice(0, limit);
    const view = isHex ? virtualHive(shown, makeCard) : h('div', { class: 'list' }, ...shown.map(makeRow));
    const remaining = items.length - shown.length;
    let footer = null;
    if (io) { io.disconnect(); io = null; }
    if (remaining > 0) {
      footer = h('div', { class: 'load-more' }, h('button', { class: 'btn', onclick: loadMore }, `Load more (${remaining} more)`));
      if (typeof IntersectionObserver !== 'undefined') {
        io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) loadMore(); }, { rootMargin: '500px 0px' });
        requestAnimationFrame(() => { if (footer.isConnected && io) io.observe(footer); });
      }
    }
    mount(container, view, footer);
  };
  render();
  return container;
}

// Position card elements into an interlocking honeycomb that fills the width.
// `gap` adds breathing room between hexes so dense views feel less cluttered.
// The layout re-measures after mount (first render width may be 0) and on resize.
export function hive(cards, viewWidth, { W = 300, H = 290, gap = 18 } = {}) {
  const colStep = Math.round(0.75 * W) + gap;
  const rowStep = H + gap;
  const container = h('div', { class: 'seerr-hive', style: { position: 'relative' } });
  for (const el of cards) container.appendChild(el);

  const layout = (avail) => {
    const width = avail || viewWidth || (colStep + W);
    const cols = Math.max(1, Math.floor((width - W) / colStep) + 1);
    let maxBottom = 0;
    cards.forEach((el, i) => {
      const c = i % cols, k = Math.floor(i / cols);
      const x = c * colStep, y = k * rowStep + (c % 2) * (rowStep / 2);
      el.style.width = `${W}px`; el.style.height = `${H}px`;
      el.style.left = `${x}px`; el.style.top = `${y}px`;
      maxBottom = Math.max(maxBottom, y + H);
    });
    container.style.width = `${(cols - 1) * colStep + W}px`;
    container.style.height = `${maxBottom + 8}px`;
  };
  // Available width comes from the parent (independent of the container's own
  // width, which we shrink to the honeycomb and centre with margin:auto).
  const measure = () => { const p = container.parentElement; return (p && p.clientWidth) || viewWidth || 0; };

  layout(viewWidth);
  requestAnimationFrame(() => { if (container.isConnected) layout(measure()); });
  let lastW = -1;
  const onResize = () => {
    if (!container.isConnected) { window.removeEventListener('resize', onResize); return; }
    const w = measure();
    if (w === lastW) return;
    lastW = w;
    layout(w);
  };
  window.addEventListener('resize', onResize);
  return container;
}

// Windowed honeycomb for large collections: only builds the hexes near the
// viewport and recycles them on scroll. `makeCard(item, index)` creates a tile.
// Assumes the document/window scrolls (sticky topbar, no inner overflow).
export function virtualHive(items, makeCard, { W = 300, H = 290, gap = 18, buffer = 900 } = {}) {
  const colStep = Math.round(0.75 * W) + gap;
  const rowStep = H + gap;
  const container = h('div', { class: 'seerr-hive', style: { position: 'relative' } });
  const mounted = new Map();
  let cols = 1, rowsCount = 0, lastW = -1;

  function layout() {
    const avail = container.clientWidth || (colStep + W);
    cols = Math.max(1, Math.floor((avail - W) / colStep) + 1);
    rowsCount = Math.ceil(items.length / cols);
    let maxBottom = 0;
    const lastK = rowsCount - 1;
    for (let c = 0; c < cols; c++) {
      const i = lastK * cols + c;
      if (i >= items.length || i < 0) continue;
      maxBottom = Math.max(maxBottom, lastK * rowStep + (c % 2) * (rowStep / 2) + H);
    }
    container.style.width = `${(cols - 1) * colStep + W}px`;
    container.style.height = `${maxBottom + 8}px`;
  }

  function placeCard(el, i) {
    const c = i % cols, k = Math.floor(i / cols);
    el.style.width = `${W}px`; el.style.height = `${H}px`;
    el.style.left = `${c * colStep}px`;
    el.style.top = `${k * rowStep + (c % 2) * (rowStep / 2)}px`;
  }

  function renderWindow() {
    if (!container.isConnected) return teardown();
    const rect = container.getBoundingClientRect();
    const top = -rect.top - buffer;
    const bottom = -rect.top + window.innerHeight + buffer;
    const kStart = Math.max(0, Math.floor(top / rowStep) - 1);
    const kEnd = Math.min(rowsCount - 1, Math.ceil(bottom / rowStep) + 1);
    const need = new Set();
    for (let k = kStart; k <= kEnd; k++) {
      for (let c = 0; c < cols; c++) {
        const i = k * cols + c;
        if (i >= items.length) break;
        need.add(i);
      }
    }
    for (const [i, el] of mounted) if (!need.has(i)) { el.remove(); mounted.delete(i); }
    for (const i of need) {
      if (mounted.has(i)) continue;
      const el = makeCard(items[i], i);
      placeCard(el, i);
      container.appendChild(el);
      mounted.set(i, el);
    }
  }

  let ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { ticking = false; renderWindow(); });
  }
  function onResize() {
    if (!container.isConnected) return teardown();
    if (container.clientWidth === lastW) return;
    lastW = container.clientWidth;
    for (const [, el] of mounted) el.remove();
    mounted.clear();
    layout();
    renderWindow();
  }
  function teardown() {
    window.removeEventListener('scroll', onScroll, true);
    window.removeEventListener('resize', onResize);
  }

  window.addEventListener('scroll', onScroll, true);
  window.addEventListener('resize', onResize);
  requestAnimationFrame(() => { lastW = container.clientWidth; layout(); renderWindow(); });
  return container;
}

// Shared lazy-loader: poster backgrounds are only fetched once a hex scrolls
// near the viewport, keeping large libraries (e.g. Radarr) smooth to scroll.
let _io = null;
function lazyObserver() {
  if (_io || typeof IntersectionObserver === 'undefined') return _io;
  _io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const el = e.target;
      const url = el.dataset.bg;
      if (url) {
        const face = el.querySelector('.hx-face');
        if (face) face.style.backgroundImage = `url(${url})`;
        el.removeAttribute('data-bg');
      }
      _io.unobserve(el);
    }
  }, { rootMargin: '600px 0px' });
  return _io;
}

// A hexagon tile filled with a poster (or gradient), with an overlaid title,
// optional pills, sub-line, progress bar and actions.
export function posterHexCard({ posterUrl, gradient, title, sub, pills = [], progress = null, actions = null, onClick }) {
  const overlay = h('div', { class: 'hx-overlay' }, h('div', { class: 'hx-title' }, title || ''));
  for (const p of pills) if (p) overlay.appendChild(h('span', { class: `pill ${p.cls}` }, p.label));
  if (sub) overlay.appendChild(h('div', { class: 'hx-sub' }, sub));
  if (progress !== null && progress !== undefined) {
    overlay.appendChild(h('div', { class: 'progress' }, h('span', { style: { width: `${Math.max(0, Math.min(100, Math.round(progress)))}%` } })));
  }
  if (actions) overlay.appendChild(actions);
  const face = h('div', { class: 'hx-face' }, overlay);
  const card = h('div', { class: 'seerr-hex', title: title || '', onclick: onClick }, h('div', { class: 'hx-border' }), face);
  if (posterUrl) {
    const io = lazyObserver();
    if (io) { card.dataset.bg = posterUrl; io.observe(card); }
    else { face.style.backgroundImage = `url(${posterUrl})`; }
  } else if (gradient) {
    face.style.backgroundImage = gradient;
  }
  return card;
}
