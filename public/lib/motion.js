// Small motion helpers for collapsible panels and lists (Web Animations API).
// Every helper is instant when the user prefers reduced motion, and a new
// animation on an element picks up from wherever the previous one was.

export const EASE_OUT = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
export const EASE_IN_OUT = 'cubic-bezier(0.4, 0, 0.2, 1)';

export function reducedMotion() {
  try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch { return false; }
}

const running = new WeakMap();
// Vertical padding/border, so a panel can shrink all the way to nothing.
function padding(el) {
  const cs = getComputedStyle(el);
  return { paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom, borderTopWidth: cs.borderTopWidth };
}
function stop(el) {
  const a = running.get(el);
  if (!a) return null;
  // Freeze the current height so the next animation starts from it.
  const h = el.getBoundingClientRect().height;
  a.cancel();
  running.delete(el);
  return h;
}

// Open a hidden panel by growing its height from 0 (or from where an
// interrupted close left it) to its natural height.
// Taller panels take a little longer so they don't whip open (220–420 ms).
export const durationFor = (px, base = 200) => Math.round(Math.min(420, Math.max(220, base + px * 0.12)));

export function expand(el, { duration } = {}) {
  const from = stop(el) ?? 0;
  el.hidden = false;
  if (reducedMotion()) return Promise.resolve();
  const to = el.getBoundingClientRect().height;
  duration = duration ?? durationFor(Math.abs(to - from), 210);
  const pad = padding(el);
  const a = el.animate([
    { height: `${from}px`, opacity: from ? 1 : 0, transform: 'translateY(-6px)', overflow: 'hidden', ...(from ? {} : { paddingTop: '0px', paddingBottom: '0px', borderTopWidth: '0px' }) },
    { height: `${to}px`, opacity: 1, transform: 'translateY(0)', overflow: 'hidden', ...pad },
  ], { duration, easing: EASE_OUT });
  running.set(el, a);
  return a.finished.then(() => { if (running.get(el) === a) running.delete(el); }, () => {});
}

// Close a panel by shrinking it to 0, then hide it.
export function collapse(el, { duration } = {}) {
  const from = stop(el) ?? el.getBoundingClientRect().height;
  duration = duration ?? Math.round(durationFor(from, 160) * 0.85);
  if (reducedMotion() || el.hidden) { el.hidden = true; return Promise.resolve(); }
  const a = el.animate([
    { height: `${from}px`, opacity: 1, overflow: 'hidden', ...padding(el) },
    { height: '0px', opacity: 0, overflow: 'hidden', paddingTop: '0px', paddingBottom: '0px', borderTopWidth: '0px' },
  ], { duration, easing: EASE_IN_OUT, fill: 'forwards' });
  running.set(el, a);
  // fill: forwards holds it at 0 until it's hidden, so it never flashes open
  // for a frame between the animation ending and the hide.
  return a.finished.then(() => { if (running.get(el) === a) { running.delete(el); el.hidden = true; a.cancel(); } }, () => {});
}

// Ease items in, one after another, sliding from dx/dy.
export function staggerIn(els, { dx = 0, dy = 8, step = 28, duration = 260, max = 10 } = {}) {
  if (reducedMotion()) return;
  els.forEach((el, i) => {
    el.animate([
      { opacity: 0, transform: `translate(${dx}px, ${dy}px)` },
      { opacity: 1, transform: 'translate(0, 0)' },
    ], { duration, delay: Math.min(i, max) * step, easing: EASE_OUT, fill: 'backwards' });
  });
}

// Keep `el` at the same spot on screen for `ms` while things above it change
// size (a row above closing, say), by scrolling the page by however much it moved.
export function holdInPlace(el, ms = 320) {
  if (reducedMotion() || !el) return;
  const startTop = el.getBoundingClientRect().top;
  const t0 = performance.now();
  const tick = () => {
    const d = el.getBoundingClientRect().top - startTop;
    if (Math.abs(d) > 0.5) window.scrollBy(0, d);
    if (performance.now() - t0 < ms) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// Set open/closed straight away, stopping any animation in progress.
export function setOpenInstant(el, isOpen) {
  stop(el);
  el.hidden = !isOpen;
}
