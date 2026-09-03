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

// ---- Modal ----
export function openModal({ title, body, footer, wide = false }) {
  const root = document.getElementById('modal-root');
  const overlay = h('div', { class: 'modal-overlay', onclick: (e) => { if (e.target === overlay) closeModal(); } },
    h('div', { class: 'modal', style: wide ? { maxWidth: '760px' } : {} },
      h('div', { class: 'modal-head' }, h('h3', {}, title), h('button', { class: 'close-x', onclick: closeModal }, '\u00d7')),
      h('div', { class: 'modal-body' }, body),
      footer ? h('div', { class: 'modal-foot' }, footer) : null,
    )
  );
  clear(root).appendChild(overlay);
  const onEsc = (e) => { if (e.key === 'Escape') closeModal(); };
  document.addEventListener('keydown', onEsc, { once: true });
  return overlay;
}
export function closeModal() { clear(document.getElementById('modal-root')); }

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
  }

  for (const t of tabsDef) {
    bar.appendChild(h('button', { class: 'tab', dataset: { id: t.id }, onclick: () => select(t.id) }, t.label));
  }
  bar.appendChild(indicator);
  select(activeId, false);
  // Reposition once mounted and on resize.
  requestAnimationFrame(moveIndicator);
  setTimeout(moveIndicator, 60);
  window.addEventListener('resize', moveIndicator);
  return bar;
}
