// Full-screen picture viewer for the year in review: tap the picture to open
// it, then pinch, double-tap, scroll or use + and − to zoom, and drag to move
// around. Swipe down, tap outside the picture, press Escape or Back to close.
import { h, registerOverlay, closeOverlay } from './ui.js';

export const MAX_ZOOM = 5;

// The picture's size when it fits the screen (never larger than its pixels × 2).
export function fitSize(iw, ih, vw, vh) {
  if (!(iw > 0 && ih > 0 && vw > 0 && vh > 0)) return { w: 0, h: 0 };
  const s = Math.min(vw / iw, vh / ih, 2);
  return { w: iw * s, h: ih * s };
}
// view: { scale, x, y } — x, y move the picture's centre from the screen's
// centre. Keeps the picture covering the screen in each direction it's
// bigger than the screen, and centred in each direction it isn't.
export function clampView(view, { vw, vh, fw, fh }) {
  const scale = Math.min(MAX_ZOOM, Math.max(1, view.scale));
  const lim = (size, room, v) => { const over = (size * scale - room) / 2; return over > 0 ? Math.max(-over, Math.min(over, v)) : 0; };
  return { scale, x: lim(fw, vw, view.x), y: lim(fh, vh, view.y) };
}
// Zoom by `factor` keeping the point (px, py) — measured from the screen's
// centre — where it is.
export function zoomAt(view, px, py, factor, dims) {
  const scale = Math.min(MAX_ZOOM, Math.max(1, view.scale * factor));
  const k = scale / view.scale;
  return clampView({ scale, x: px - (px - view.x) * k, y: py - (py - view.y) * k }, dims);
}

export function openViewer({ src, alt = '', title = 'Picture', actions = [] }) {
  const img = h('img', { class: 'rv-img', src, alt, draggable: 'false' });
  const hint = h('div', { class: 'rv-hint' }, 'Pinch or double-tap to zoom');
  const closeBtn = h('button', { type: 'button', class: 'rv-btn rv-close', 'aria-label': 'Close', onclick: () => closeOverlay('recap-viewer') }, '×');
  const zoomIn = h('button', { type: 'button', class: 'rv-btn', 'aria-label': 'Zoom in', onclick: () => step(1.6) }, '+');
  const zoomOut = h('button', { type: 'button', class: 'rv-btn', 'aria-label': 'Zoom out', onclick: () => step(1 / 1.6) }, '−');
  const bar = h('div', { class: 'rv-bar' }, ...actions, zoomOut, zoomIn, closeBtn);
  const stage = h('div', { class: 'rv-stage' }, img);
  const root = h('div', { class: 'recap-viewer', role: 'dialog', 'aria-modal': 'true', 'aria-label': title, tabindex: '-1' }, stage, bar, hint);
  let view = { scale: 1, x: 0, y: 0 }; let dims = { vw: 0, vh: 0, fw: 0, fh: 0 };
  let drag = null; let pinch = null; let lastTap = 0; let swipeY = 0;
  const pointers = new Map();

  const measure = () => {
    const vw = stage.clientWidth; const vh = stage.clientHeight;
    const { w, h: fh } = fitSize(img.naturalWidth, img.naturalHeight, vw, vh);
    dims = { vw, vh, fw: w, fh };
    img.style.width = `${w}px`; img.style.height = `${fh}px`;
    view = clampView(view, dims); paint();
  };
  const paint = (animate = false) => {
    img.classList.toggle('rv-anim', animate);
    img.style.transform = `translate(${view.x}px, ${view.y + swipeY}px) scale(${view.scale})`;
    root.classList.toggle('rv-zoomed', view.scale > 1.01);
    root.style.setProperty('--rv-fade', String(Math.max(0.35, 1 - Math.abs(swipeY) / 400)));
  };
  const local = (e) => { const r = stage.getBoundingClientRect(); return { x: e.clientX - r.left - r.width / 2, y: e.clientY - r.top - r.height / 2 }; };
  const step = (f) => { view = zoomAt(view, 0, 0, f, dims); paint(true); };
  const hideHint = () => hint.classList.add('rv-hint-gone');
  setTimeout(hideHint, 2600);

  stage.addEventListener('pointerdown', (e) => {
    stage.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, local(e));
    hideHint();
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { s0: view.scale, v0: { ...view }, m0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, d0: Math.hypot(a.x - b.x, a.y - b.y) || 1 };
      drag = null;
    } else if (pointers.size === 1) drag = { p0: local(e), v0: { ...view }, moved: false, onImg: e.target === img, t: Date.now() };
  });
  stage.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, local(e));
    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; const d = Math.hypot(a.x - b.x, a.y - b.y);
      const scale = Math.min(MAX_ZOOM, Math.max(1, pinch.s0 * (d / pinch.d0)));
      const k = scale / pinch.s0;
      view = clampView({ scale, x: m.x - (pinch.m0.x - pinch.v0.x) * k, y: m.y - (pinch.m0.y - pinch.v0.y) * k }, dims);
      paint(); return;
    }
    if (!drag) return;
    const p = local(e); const dx = p.x - drag.p0.x; const dy = p.y - drag.p0.y;
    if (Math.hypot(dx, dy) > 6) drag.moved = true;
    if (view.scale > 1.01) { view = clampView({ ...view, x: drag.v0.x + dx, y: drag.v0.y + dy }, dims); paint(); }
    else { swipeY = dy; paint(); } // not zoomed: drag down (or up) to close
  });
  const up = (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pinch) { if (pointers.size < 2) pinch = null; drag = null; return; }
    if (!drag) return;
    const d = drag; drag = null;
    if (Math.abs(swipeY) > 110) { closeOverlay('recap-viewer'); return; }
    if (swipeY) { swipeY = 0; paint(true); }
    if (d.moved) return;
    const now = Date.now();
    if (now - lastTap < 320) { // double tap: zoom in there, or back out
      lastTap = 0;
      const p = local(e);
      view = view.scale > 1.01 ? clampView({ scale: 1, x: 0, y: 0 }, dims) : zoomAt(view, p.x, p.y, 2.5, dims);
      paint(true); return;
    }
    lastTap = now;
    if (!d.onImg && view.scale <= 1.01) setTimeout(() => { if (lastTap === now) closeOverlay('recap-viewer'); }, 330);
  };
  stage.addEventListener('pointerup', up); stage.addEventListener('pointercancel', up);
  stage.addEventListener('wheel', (e) => {
    e.preventDefault(); hideHint();
    const p = local(e); view = zoomAt(view, p.x, p.y, Math.exp(-e.deltaY * 0.0018), dims); paint();
  }, { passive: false });
  root.addEventListener('keydown', (e) => {
    if (e.key === '+' || e.key === '=') { step(1.6); e.preventDefault(); }
    else if (e.key === '-' || e.key === '_') { step(1 / 1.6); e.preventDefault(); }
    else if (e.key === '0') { view = clampView({ scale: 1, x: 0, y: 0 }, dims); paint(true); }
    else if (/^Arrow/.test(e.key) && view.scale > 1.01) {
      const d = 60; const v = { ArrowLeft: [d, 0], ArrowRight: [-d, 0], ArrowUp: [0, d], ArrowDown: [0, -d] }[e.key];
      view = clampView({ ...view, x: view.x + v[0], y: view.y + v[1] }, dims); paint(true); e.preventDefault();
    }
  });
  const onResize = () => measure();
  window.addEventListener('resize', onResize);
  document.body.appendChild(root);
  document.documentElement.classList.add('recap-overlay-open');
  registerOverlay('recap-viewer', {
    container: root,
    close: () => { window.removeEventListener('resize', onResize); root.remove(); if (!document.querySelector('.recap-show')) document.documentElement.classList.remove('recap-overlay-open'); },
  });
  if (img.complete && img.naturalWidth) measure(); else img.addEventListener('load', measure, { once: true });
  return root;
}
