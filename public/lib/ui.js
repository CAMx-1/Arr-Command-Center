// Tiny DOM + UI helper library (no framework, no build step).

// Hyperscript: h('div', {class:'x', onclick:fn}, child1, child2)
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else el.setAttribute(k, v);
  }
  appendChildren(el, children);
  return el;
}

function appendChildren(el, children) {
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
}

export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }
export function mount(node, ...children) { clear(node); appendChildren(node, children); return node; }

// ---- Toast ----
export function toast(message, type = 'info', timeout = 3200) {
  const container = document.getElementById('toast-container');
  const t = h('div', { class: `toast ${type}` }, h('div', { class: 'toast-face' }, message));
  container.appendChild(t);
  if (type === 'error') {
    try { window.dispatchEvent(new CustomEvent('app-error', { detail: { message: String(message), at: Date.now() } })); } catch { /* ignore */ }
  }
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity 0.3s'; setTimeout(() => t.remove(), 300); }, timeout);
}

// ---- Overlay controller (modals + bottom sheet) ----
// Gives every overlay: (1) a history entry so the hardware/browser Back button
// (or iOS edge-swipe) closes it instead of navigating away, (2) a focus trap
// that keeps Tab within the overlay, (3) focus restore to the previously
// focused element on close, and (4) Escape-to-close. Overlays are keyed by id
// so re-opening/replacing (e.g. one modal over another) reuses the same slot.
const _overlays = new Map(); // id -> { close, prevFocus, trap, container }
let _popWired = false;
let _cleanupBacks = 0; // programmatic history.back() calls to swallow in popstate

function _focusables(container) {
  if (!container) return [];
  return Array.from(container.querySelectorAll(
    'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )).filter((el) => el.offsetParent !== null);
}
function _focusFirst(container) {
  requestAnimationFrame(() => { const items = _focusables(container); (items[0] || container)?.focus?.(); });
}
function _makeTrap(id) {
  return (e) => {
    const o = _overlays.get(id); if (!o) return;
    if (e.key === 'Escape') { e.preventDefault(); closeOverlay(id); return; }
    if (e.key !== 'Tab') return;
    const items = _focusables(o.container); if (!items.length) return;
    const first = items[0]; const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
}
function _teardownOverlay(id) { // no history side effects
  const o = _overlays.get(id); if (!o) return;
  _overlays.delete(id);
  document.removeEventListener('keydown', o.trap, true);
  try { o.close(); } catch { /* ignore */ }
  if (o.prevFocus && o.prevFocus.focus) { try { o.prevFocus.focus(); } catch { /* ignore */ } }
}
function _ensurePopstate() {
  if (_popWired) return; _popWired = true;
  window.addEventListener('popstate', () => {
    if (_cleanupBacks > 0) { _cleanupBacks--; return; } // swallow our own cleanup backs
    const ids = [..._overlays.keys()];
    if (ids.length) _teardownOverlay(ids[ids.length - 1]); // hardware Back closes the topmost overlay
  });
}
// Register an open overlay. container = the element to trap focus within;
// close = teardown callback that hides/removes the overlay DOM.
export function registerOverlay(id, { container, close }) {
  _ensurePopstate();
  const existing = _overlays.get(id);
  if (existing) { // replace/refresh in the same history slot
    document.removeEventListener('keydown', existing.trap, true);
    existing.container = container; existing.close = close;
    existing.trap = _makeTrap(id);
    document.addEventListener('keydown', existing.trap, true);
    _focusFirst(container);
    return;
  }
  const prevFocus = document.activeElement;
  try { history.pushState({ overlay: id }, ''); } catch { /* ignore */ }
  const trap = _makeTrap(id);
  document.addEventListener('keydown', trap, true);
  _overlays.set(id, { close, prevFocus, trap, container });
  _focusFirst(container);
}
export function overlayOpen(id) { return _overlays.has(id); }
// Programmatic/UI close: tear down now, then pop the (now dead) history state.
export function closeOverlay(id) {
  if (!_overlays.has(id)) return;
  _teardownOverlay(id);
  _cleanupBacks++;
  try { history.back(); } catch { _cleanupBacks--; }
}

// ---- Modal ----
export function openModal({ title, body, footer, wide = false }) {
  const root = document.getElementById('modal-root');
  const overlay = h('div', { class: 'modal-overlay', onclick: (e) => { if (e.target === overlay) closeModal(); } },
    h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title ? String(title) : 'Dialog', style: wide ? { maxWidth: '760px' } : {} },
      h('div', { class: 'modal-head' }, h('h3', {}, title), h('button', { class: 'close-x', 'aria-label': 'Close', onclick: closeModal }, '\u00d7')),
      h('div', { class: 'modal-body' }, body),
      footer ? h('div', { class: 'modal-foot' }, footer) : null,
    )
  );
  clear(root).appendChild(overlay);
  registerOverlay('modal', { container: overlay, close: () => clear(document.getElementById('modal-root')) });
  return overlay;
}
export function closeModal() {
  if (overlayOpen('modal')) { closeOverlay('modal'); return; }
  clear(document.getElementById('modal-root'));
}

// Confirmation dialog. Calls onConfirm() when the user confirms.
export function confirmModal({ title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false, onConfirm }) {
  const footer = h('div', { style: { display: 'flex', gap: '10px' } },
    h('button', { class: 'btn', onclick: closeModal }, cancelLabel),
    h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, onclick: () => { closeModal(); onConfirm(); } }, confirmLabel),
  );
  openModal({ title, body: h('p', { style: { margin: 0, lineHeight: '1.6' } }, message), footer });
}

// ---- Loading / empty states ----
export function spinner() { return h('div', { class: 'spinner' }); }
export function skeletonList(n = 4) {
  return h('div', { class: 'list' }, Array.from({ length: n }, () => h('div', { class: 'skeleton' })));
}
export function empty(icon, text, sub, action) {
  return h('div', { class: 'empty' },
    h('div', { class: 'empty-icon' }, icon),
    h('div', {}, text),
    sub ? h('div', { class: 'dim', style: { marginTop: '6px', fontSize: '13px' } }, sub) : null,
    action ? h('button', { class: 'btn sm primary', style: { marginTop: '14px' }, onclick: action.onClick }, action.label || 'Retry') : null,
  );
}

// Click-to-copy text (e.g. a file path). Shows a toast on copy.
export function copyable(text, display) {
  const el = h('span', { class: 'copyable', title: 'Click to copy', role: 'button', tabindex: '0' }, display || text);
  const doCopy = () => {
    const done = () => toast('Copied to clipboard', 'success', 1400);
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done).catch(() => {});
    else { try { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); done(); } catch { /* ignore */ } }
  };
  el.addEventListener('click', doCopy);
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); doCopy(); } });
  return el;
}

// A relative timestamp with the absolute time as a tooltip.
export function timeEl(dateish, opts = {}) {
  const d = new Date(dateish);
  if (isNaN(d)) return h('span', {}, '');
  return h('span', { class: opts.class || '', title: d.toLocaleString() }, opts.absolute ? fmtDate(dateish) : fmtRelative(dateish));
}

// ---- Formatters ----
export function fmtBytes(bytes) {
  bytes = Number(bytes) || 0;
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function fmtRelative(dateish) {
  const d = new Date(dateish);
  if (isNaN(d)) return '';
  const diff = d.getTime() - Date.now();
  const abs = Math.abs(diff);
  const mins = Math.round(abs / 60000);
  const hrs = Math.round(abs / 3600000);
  const days = Math.round(abs / 86400000);
  let str;
  if (mins < 1) str = 'just now';
  else if (mins < 60) str = `${mins}m`;
  else if (hrs < 24) str = `${hrs}h`;
  else str = `${days}d`;
  if (str === 'just now') return str;
  return diff < 0 ? `${str} ago` : `in ${str}`;
}

export function fmtDate(dateish) {
  const d = new Date(dateish);
  if (isNaN(d)) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function pct(n) { return `${Math.max(0, Math.min(100, Math.round(Number(n) || 0)))}%`; }

// Map a Sonarr/Radarr history eventType to a label + pill class.
export function arrEventInfo(eventType) {
  switch (eventType) {
    case 'grabbed': return { label: 'Grabbed', cls: 'info' };
    case 'downloadFolderImported': return { label: 'Imported', cls: 'ok' };
    case 'downloadFailed': return { label: 'Failed', cls: 'down' };
    case 'episodeFileDeleted':
    case 'movieFileDeleted': return { label: 'Deleted', cls: 'muted' };
    case 'downloadIgnored': return { label: 'Ignored', cls: 'muted' };
    case 'episodeFileRenamed':
    case 'movieFileRenamed': return { label: 'Renamed', cls: 'muted' };
    default: return { label: eventType || 'Event', cls: 'muted' };
  }
}

// Poster placeholder / image
export function poster(url, fallbackIcon = '') {
  if (url) return h('img', { class: 'poster', src: url, loading: 'lazy', onerror: function () { this.replaceWith(h('div', { class: 'poster' }, fallbackIcon)); } });
  return h('div', { class: 'poster' }, fallbackIcon);
}

// Debounce
export function debounce(fn, ms = 350) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// Re-run `fn` every `ms` while `sentinel` stays attached to the DOM; auto-stops
// when it's removed (tab switch or navigation clears the view). Returns the id.
export function autoRefresh(sentinel, ms, fn) {
  const id = setInterval(() => {
    if (!sentinel || !sentinel.isConnected) { clearInterval(id); return; }
    Promise.resolve(fn()).catch(() => {});
  }, ms);
  return id;
}

// Service icon: renders a logo <img> with graceful fallback to an emoji if the
// image fails to load.
export function svcIcon(src, emoji = '', size = 22) {
  if (!src) return h('span', {}, emoji);
  return h('img', {
    src, alt: '', class: 'svc-logo', loading: 'lazy',
    style: { width: `${size}px`, height: `${size}px` },
    onerror: function () { this.replaceWith(h('span', {}, emoji)); },
  });
}

// ---- Tabs ----
// tabsDef: [{ id, label, render(container) }]. Returns the tab-bar element and
// mounts content into `body`. Remembers last tab per storageKey. Includes an
// animated sliding indicator and an entrance animation on each panel switch.
export function tabs(body, tabsDef, storageKey) {
  const saved = storageKey ? localStorage.getItem(storageKey) : null;
  let activeId = (saved && tabsDef.some((t) => t.id === saved)) ? saved : tabsDef[0].id;
  const bar = h('div', { class: 'tabs' });
  const indicator = h('span', { class: 'tab-indicator' });

  function moveIndicator() {
    const btn = bar.querySelector('.tab.active');
    if (!btn) return;
    indicator.style.width = `${btn.offsetWidth}px`;
    indicator.style.transform = `translateX(${btn.offsetLeft}px)`;
  }

  function select(id, animate = true) {
    activeId = id;
    if (storageKey) localStorage.setItem(storageKey, id);
    for (const btn of bar.querySelectorAll('.tab')) btn.classList.toggle('active', btn.dataset.id === id);
    const def = tabsDef.find((t) => t.id === id);
    clear(body);
    def.render(body);
    // restart the entrance animation
    body.classList.remove('panel-enter');
    void body.offsetWidth;
    if (animate) body.classList.add('panel-enter');
    requestAnimationFrame(moveIndicator);
    // Keep the active tab visible when the bar overflows horizontally (mobile).
    requestAnimationFrame(() => {
      const a = bar.querySelector('.tab.active');
      if (a && bar.scrollWidth > bar.clientWidth + 4) {
        const target = a.offsetLeft - (bar.clientWidth - a.offsetWidth) / 2;
        bar.scrollTo({ left: Math.max(0, target), behavior: 'smooth' });
      }
    });
  }

  for (const t of tabsDef) {
    bar.appendChild(h('button', { class: 'tab', dataset: { id: t.id }, onclick: () => select(t.id) }, t.label));
  }
  bar.appendChild(indicator);
  select(activeId, false);
  // Reposition once mounted and on resize.
  requestAnimationFrame(moveIndicator);
  setTimeout(moveIndicator, 60);

  // Keep the indicator aligned as the bar's size changes (viewport resize,
  // sidebar toggle, orientation, late font load). Previously this attached a
  // permanent window 'resize' listener that was never removed, so every tab
  // view leaked a listener (and its detached DOM closure) on navigation.
  // Prefer a ResizeObserver scoped to the bar itself; it disconnects
  // automatically once the bar is detached. A window-listener fallback
  // self-cleans the same way for environments without ResizeObserver.
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => {
      if (!bar.isConnected) { ro.disconnect(); return; } // bar removed on nav — self-clean
      moveIndicator();
    });
    ro.observe(bar);
  } else if (typeof window !== 'undefined' && window.addEventListener) {
    const onResize = () => {
      if (!bar.isConnected) { window.removeEventListener('resize', onResize); return; } // self-clean once detached
      moveIndicator();
    };
    window.addEventListener('resize', onResize);
  }

  // Horizontal swipe to change tabs (touch). Ignores mostly-vertical drags and
  // swipes that begin inside a horizontally-scrollable element or a form field.
  let sx = 0; let sy = 0; let swiping = false;
  body.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) { swiping = false; return; }
    const el = e.target;
    if (el && el.closest && el.closest('.stat-scroll, .bchart-plot, .stat-strip, input, textarea, select, .modal-overlay')) { swiping = false; return; }
    const t = e.touches[0]; sx = t.clientX; sy = t.clientY; swiping = true;
  }, { passive: true });
  body.addEventListener('touchend', (e) => {
    if (!swiping) return; swiping = false;
    const t = e.changedTouches[0];
    const dx = t.clientX - sx; const dy = t.clientY - sy;
    if (Math.abs(dx) < 64 || Math.abs(dx) < Math.abs(dy) * 1.8) return; // require a clear horizontal swipe
    const idx = tabsDef.findIndex((x) => x.id === activeId);
    const next = dx < 0 ? idx + 1 : idx - 1;
    if (next < 0 || next >= tabsDef.length) return;
    select(tabsDef[next].id);
  }, { passive: true });

  return bar;
}

// ---- Swipe-to-remove (touch) ----
// Swipe a list row left to trigger a destructive action. The row follows the
// finger and turns red ("armed") once past the threshold; releasing past it
// slides the row out and runs onAction. Vertical drags scroll normally, and
// swipes that start on a control (button/link/input) are ignored. No-op on
// non-touch devices. Returns the same row for convenient chaining.
export function swipeToAction(row, onAction, { threshold = 90 } = {}) {
  if (typeof window === 'undefined' || !('ontouchstart' in window)) return row;
  let startX = 0; let startY = 0; let dx = 0; let active = false; let decided = false;
  row.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) { active = false; return; }
    if (e.target.closest && e.target.closest('button, a, input, select, textarea')) { active = false; return; }
    const t = e.touches[0]; startX = t.clientX; startY = t.clientY; dx = 0; active = true; decided = false;
    row.style.transition = '';
  }, { passive: true });
  row.addEventListener('touchmove', (e) => {
    if (!active) return;
    const t = e.touches[0]; const mx = t.clientX - startX; const my = t.clientY - startY;
    if (!decided) {
      if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
      decided = true;
      if (Math.abs(my) > Math.abs(mx)) { active = false; return; } // vertical scroll wins
    }
    dx = Math.min(0, mx);
    row.style.transform = `translateX(${dx}px)`;
    row.classList.toggle('swipe-armed', dx <= -threshold);
  }, { passive: true });
  const finish = () => {
    if (!active) return; active = false;
    if (dx <= -threshold) {
      row.style.transition = 'transform 0.2s var(--ease), opacity 0.2s var(--ease)';
      row.style.transform = 'translateX(-110%)'; row.style.opacity = '0';
      setTimeout(() => { try { onAction(); } catch { /* ignore */ } }, 190);
    } else {
      row.style.transition = 'transform 0.2s var(--ease)';
      row.style.transform = 'translateX(0)';
      row.classList.remove('swipe-armed');
    }
  };
  row.addEventListener('touchend', finish, { passive: true });
  row.addEventListener('touchcancel', finish, { passive: true });
  return row;
}
