import { api } from './lib/api.js';
import { h, mount, clear, toast, svcIcon, confirmModal, openModal, closeModal, debounce, spinner, empty, poster, fmtBytes, copyable, registerOverlay, closeOverlay, overlayOpen } from './lib/ui.js';
import { orderServices, isHidden } from './lib/servicePrefs.js';
import { splitHive, flyoutLayout } from './lib/hiveLayout.js';
import { hiveSignature, statusDotClass } from './lib/hiveState.js';
import { cachedGet } from './lib/cache.js';
import { setPendingFilter } from './lib/libraryFilter.js';
import { renderHome, refreshHome } from './views/home.js';
import { renderSonarr } from './views/sonarr.js';
import { renderRadarr } from './views/radarr.js';
import { renderLidarr, renderReadarr } from './views/musicbooks.js';
import { renderOverseerr, openSeasonModal, openMovieRequestModal } from './views/overseerr.js';
import { renderSabnzbd } from './views/sabnzbd.js';
import { renderTautulli } from './views/tautulli.js';
import { renderProwlarr } from './views/prowlarr.js';
import { renderBazarr } from './views/bazarr.js';
import { renderQbittorrent } from './views/qbittorrent.js';
import { renderIndexer } from './views/indexer.js';
import { renderPlex } from './views/plex.js';
import { renderEmbed } from './views/embed.js';
import { renderSettings } from './views/settings.js';
import { openDetailModal } from './views/detail.js';
import { fetchNotifications, getLastSeen, markSeen, notifKind } from './lib/notifications.js';
import * as push from './lib/push.js';
import { initAppearance } from './lib/theme.js';
import { mergeState, classifyNavigation, targetScrollFor, createScrollStore } from './lib/scrollHistory.js';

export const SERVICE_META = {
  sonarr: { logo: '/icons/sonarr.svg', emoji: '', renderer: renderSonarr },
  radarr: { logo: '/icons/radarr.svg', emoji: '', renderer: renderRadarr },
  lidarr: { logo: '/icons/lidarr.svg', emoji: '🎵', renderer: renderLidarr },
  readarr: { logo: '/icons/readarr.svg', emoji: '📚', renderer: renderReadarr },
  overseerr: { logo: '/icons/overseerr.svg', emoji: '', renderer: renderOverseerr },
  sabnzbd: { logo: '/icons/sabnzbd.svg', emoji: '⬇', renderer: renderSabnzbd },
  tautulli: { logo: '/icons/tautulli.svg', emoji: '', renderer: renderTautulli },
  prowlarr: { logo: '/icons/prowlarr.png', emoji: '', renderer: renderProwlarr },
  bazarr: { logo: '/icons/bazarr.svg', emoji: '', renderer: renderBazarr },
  qbittorrent: { logo: '/icons/qbittorrent.svg', emoji: '⬇', renderer: renderQbittorrent },
  indexer: { logo: '/icons/indexer.svg', emoji: '🔍', renderer: renderIndexer },
  plex: { logo: '/icons/plex.svg', emoji: '▶', renderer: renderPlex },
};

const state = {
  config: null,
  status: {},
  services: [],
};

let homeCtx = null;
let notifOpen = false;
// Sidebar overflow: when nav cells exceed HIVE_CAP, extra hexes move into a
// collapsible flyout that extends right of the rail. `hiveExpanded` persists the
// open/closed state across rebuilds (status polls, route changes).
let hiveExpanded = false;
const HIVE_CAP = 10;
let notifications = [];
let errorLog = [];
// Signature of the last full hive build. A status poll compares against this to
// decide whether it can repaint dots in place (see refreshStatus).
let _lastHiveSig = null;

// ----- History-aware scroll restoration (see lib/scrollHistory.js) -----
// Each history entry is tagged with a monotonic `navId`; we remember the last
// scroll offset per navId so Back/Forward can restore it, new route entries
// start at the top, and reload/pull-to-refresh preserve the current position.
let _navSeq = 0;
let _currentNavId = null;
let _pendingIntent = null; // 'preserve' | 'new' set by reload/refresh/deep-link call sites
let _navGen = 0;           // bumped each navigation so stale async restores cancel
let _restoreRO = null;     // active ResizeObserver during a restore
let _restoreTimers = [];   // pending restore timers (bounded, always cleared)
const _scrollStore = createScrollStore();

// ----- Connection banner + health probe (offline / reconnecting) -----
let _probeActive = false;
let _probeTimer = 0;
let _probeDelay = 0;
let _bootBlocked = false; // initial config load failed; reload shell after probe recovery

const els = {
  hive: document.getElementById('hive'),
  hiveBg: document.getElementById('hive-bg'),
  view: document.getElementById('view'),
  title: document.getElementById('page-title'),
  actions: document.getElementById('topbar-actions'),
  sidebar: document.getElementById('sidebar'),
  notifBtn: document.getElementById('notif-btn'),
  notifBadge: document.getElementById('notif-badge'),
  notifPanel: document.getElementById('notif-panel'),
  searchBtn: document.getElementById('search-btn'),
};

// ---------- Routing ----------
function currentRoute() {
  const hash = location.hash.replace(/^#\/?/, '');
  return hash || 'home';
}

async function navigate() {
  const route = currentRoute();
  try { localStorage.setItem('acc:last-route', route); } catch { /* ignore */ }

  // ---- History-aware scroll: remember where we're leaving, decide where to land ----
  const currentY = window.scrollY || document.documentElement.scrollTop || 0;
  if (_currentNavId != null) _scrollStore.save(_currentNavId, currentY);
  const intent = _pendingIntent; _pendingIntent = null;
  const st = (history.state && typeof history.state === 'object') ? history.state : {};
  const kind = classifyNavigation({ pendingIntent: intent, navId: st.navId, knownIds: _scrollStore.keys });
  if (kind === 'new') {
    _navSeq += 1; _currentNavId = _navSeq;
    try { history.replaceState(mergeState(history.state, { navId: _currentNavId }), ''); } catch { /* ignore */ }
  } else if (kind === 'restore') {
    _currentNavId = st.navId;
  } // 'preserve' keeps the current navId
  const targetY = targetScrollFor({ kind, currentY, savedY: _scrollStore.get(_currentNavId) });

  buildHive();
  updateTopbarTools(route);
  els.actions && clear(els.actions);
  closeSidebarMobile();
  closeAllServices();

  // Restart the view entrance animation.
  els.view.dataset.route = route;
  els.view.classList.remove('view-enter');
  void els.view.offsetWidth;
  els.view.classList.add('view-enter');
  scheduleScrollRestore(kind, targetY);

  const ctx = {
    api,
    state,
    setTitle: (t) => { els.title.textContent = t; },
    setActions: (...nodes) => { mount(els.actions, ...nodes); },
    reload: () => { _pendingIntent = 'preserve'; return navigate(); },
  };

  if (route === 'home') {
    els.title.textContent = 'Overview';
    homeCtx = ctx;
    return renderHome(els.view, ctx);
  }
  homeCtx = null;

  if (route === 'settings') {
    els.title.textContent = 'Settings';
    return renderSettings(els.view, ctx);
  }

  const svc = state.services.find((s) => s.key === route);
  if (!svc) {
    els.title.textContent = 'Not found';
    return mount(els.view, h('div', { class: 'empty' }, h('div', { class: 'empty-icon' }, ''), 'Unknown or disabled service'));
  }
  els.title.textContent = svc.label;
  ctx.service = svc;
  // Embed mode: render the real app in an iframe instead of the custom panel.
  if (svc.embed && svc.embedUrl) {
    return renderEmbed(els.view, ctx);
  }
  const meta = SERVICE_META[svc.type];
  if (!meta || !meta.renderer) {
    return mount(els.view, h('div', { class: 'empty' }, 'No panel for this service type'));
  }
  return meta.renderer(els.view, ctx);
}

// Cancel any in-flight scroll restoration (observer + timers) so we never leak
// them across navigations.
function cancelScrollRestore() {
  if (_restoreRO) { try { _restoreRO.disconnect(); } catch { /* ignore */ } _restoreRO = null; }
  _restoreTimers.forEach((t) => clearTimeout(t));
  _restoreTimers = [];
}

// Bring the view to `targetY` after a navigation. New/top targets snap
// immediately; a remembered offset is re-applied as async content grows the
// page (ResizeObserver, with a bounded timer fallback) until it can be reached
// or a short budget elapses. Guarded by a generation token so a newer
// navigation supersedes an older restore.
function scheduleScrollRestore(kind, targetY) {
  const gen = ++_navGen;
  cancelScrollRestore();
  if (kind === 'new' || !targetY || targetY <= 0) {
    window.scrollTo(0, 0); // start at the top (mobile: avoids landing mid-scroll)
    requestAnimationFrame(() => { if (gen === _navGen) window.scrollTo(0, 0); });
    return;
  }
  const apply = () => { if (gen === _navGen) window.scrollTo(0, targetY); };
  const canReach = () => (document.documentElement.scrollHeight - window.innerHeight) >= targetY - 1;
  apply();
  requestAnimationFrame(apply);
  if (typeof ResizeObserver !== 'undefined') {
    let settled = 0;
    _restoreRO = new ResizeObserver(() => {
      if (gen !== _navGen) { cancelScrollRestore(); return; }
      apply();
      if (canReach() && ++settled >= 2) cancelScrollRestore();
    });
    try { _restoreRO.observe(els.view); } catch { /* ignore */ }
  } else {
    let tries = 0;
    const tick = () => {
      if (gen !== _navGen) return;
      apply();
      if (canReach() || ++tries > 12) return;
      _restoreTimers.push(setTimeout(tick, 60));
    };
    _restoreTimers.push(setTimeout(tick, 60));
  }
  // Hard stop: never keep an observer/timer alive beyond the settle budget.
  _restoreTimers.push(setTimeout(cancelScrollRestore, 1500));
}

// ---------- Sidebar honeycomb ("hive") ----------
function hiveImg(src) { return h('img', { class: 'hive-logo', src, alt: '' }); }

function buildHive() {
  const route = currentRoute();
  const isMobile = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(max-width: 720px)').matches;
  const cells = [];
  cells.push({ kind: 'home', active: route === 'home', title: 'Home', icon: hiveImg('/icons/home-icon.png'), onClick: () => { location.hash = '#/home'; } });
  // Nav order: default puts Seerr (overseerr) right below Home; the saved order
  // (from Settings) overrides it. On desktop, hidden services become an empty
  // slot in place; on mobile they (and the empty "add" slots) are omitted.
  const base = [...state.services].sort((a, b) => (a.type === 'overseerr' ? 0 : 1) - (b.type === 'overseerr' ? 0 : 1));
  const navServices = orderServices(base);
  for (const svc of navServices) {
    if (isHidden(svc.key)) {
      if (!isMobile) cells.push({ kind: 'placeholder', title: `${svc.label} is hidden — show it in Settings`, glyph: '＋', onClick: () => toast(`${svc.label} is hidden. Enable it in Settings → Services.`, 'info', 2800) });
      continue;
    }
    const meta = SERVICE_META[svc.type] || {};
    const st = state.status[svc.key];
    cells.push({
      kind: 'service', active: route === svc.key, title: svc.label,
      key: svc.key,
      dot: st ? (st.ok ? 'ok' : 'down') : '',
      icon: svcIcon(meta.logo, meta.emoji || '', 34),
      onClick: () => { location.hash = `#/${svc.key}`; },
    });
  }
  cells.push({ kind: 'settings', active: route === 'settings', title: 'Settings', icon: hiveImg('/icons/command-center.svg'), onClick: () => { location.hash = '#/settings'; } });
  if (state.config.auth && state.config.auth.plexEnabled) {
    cells.push({ kind: 'logout', title: 'Log out', glyph: '⏻', onClick: () => confirmModal({
      title: 'Sign out', message: 'Are you sure you want to sign out?', confirmLabel: 'Sign out', danger: true,
      onConfirm: async () => { try { await fetch('/api/auth/logout', { method: 'POST' }); } catch { /* ignore */ } location.href = '/login.html'; },
    }) });
  }

  // Flat-top hexagons stacked in a centered column. When there are more than
  // HIVE_CAP cells, keep the rail short (Settings/Log out pinned to the bottom)
  // and move the overflow into a collapsible flyout that extends out to the
  // right — so the nav never needs a scrollbar.
  const W = 100, H = 88, step = 88, oy = 10;
  const mkCell = (c) => h('button', {
    class: `hive-cell hive-${c.kind} ${c.active ? 'active' : ''}`, title: c.title,
    dataset: c.key ? { svcKey: c.key } : null,
    onclick: (e) => {
      if (c.kind === 'more') { e.stopPropagation(); hiveExpanded = !hiveExpanded; buildHive(); return; }
      closeSidebarMobile(); hiveExpanded = false; c.onClick();
    },
  },
    c.dot !== undefined ? h('span', { class: `hive-dot ${c.dot || ''}` }) : null,
    h('span', { class: 'hive-icon' }, c.icon || h('span', { class: 'hive-glyph' }, c.glyph)),
  );

  const bottomCount = (state.config.auth && state.config.auth.plexEnabled) ? 2 : 1; // Settings [+ Log out]
  const split = isMobile ? { overflow: false } : splitHive(cells.length, { cap: HIVE_CAP, bottomCount });

  let railCells = cells;
  let flyCells = [];
  if (split.overflow) {
    const bottom = cells.slice(cells.length - bottomCount);
    const rest = cells.slice(0, cells.length - bottomCount);
    const railMid = rest.slice(0, split.railMidCount);
    flyCells = rest.slice(split.railMidCount);
    const moreCell = {
      kind: 'more', active: hiveExpanded,
      title: hiveExpanded ? 'Collapse' : `Show ${flyCells.length} more`,
      glyph: hiveExpanded ? '‹' : `+${flyCells.length}`,
      onClick: () => {},
    };
    railCells = [...railMid, moreCell, ...bottom];
  } else {
    hiveExpanded = false;
  }

  let maxBottom = 0;
  const nodes = railCells.map((c, i) => {
    const el = mkCell(c);
    const y = oy + i * step;
    maxBottom = y + H;
    el.style.left = `calc(50% - ${W / 2}px)`;
    el.style.top = `${y}px`;
    return el;
  });
  mount(els.hive, ...nodes);
  if (state.config.mock) {
    els.hive.appendChild(h('div', { class: 'hive-demo', style: { top: `${maxBottom + 6}px` } }, 'DEMO'));
    maxBottom += 30;
  }
  els.hive.style.height = `${maxBottom + oy}px`;

  // ----- Overflow flyout -----
  const oldFly = document.getElementById('hive-flyout');
  if (oldFly) oldFly.remove();
  if (split.overflow && flyCells.length) {
    const layout = flyoutLayout(flyCells.length, { W, H, oy, cols: flyCells.length > 4 ? 2 : 1 });
    const flyInner = h('div', { class: 'hive-flyout-inner', style: { width: `${layout.width}px`, height: `${layout.height}px` } },
      ...flyCells.map((c, i) => { const el = mkCell(c); const p = layout.positions[i]; el.style.left = `${p.x}px`; el.style.top = `${p.y}px`; return el; }),
    );
    const fly = h('div', { id: 'hive-flyout', class: 'hive-flyout', style: { width: `${layout.width}px` } }, flyInner);
    document.getElementById('app').appendChild(fly);
    // Anchor to the right of the sidebar, vertically near the More toggle.
    const moreBtn = els.hive.querySelectorAll('.hive-cell')[split.moreIndex];
    const sb = els.sidebar.getBoundingClientRect();
    const r = moreBtn ? moreBtn.getBoundingClientRect() : sb;
    fly.style.left = `${Math.round(sb.right + 8)}px`;
    const desiredTop = (moreBtn ? r.top : sb.top) - oy;
    const maxTop = Math.max(8, window.innerHeight - layout.height - 8);
    fly.style.top = `${Math.round(Math.min(Math.max(8, desiredTop), maxTop))}px`;
    if (hiveExpanded) requestAnimationFrame(() => fly.classList.add('open'));
  }

  // Rebuild the background now that the nav buttons exist, so it aligns to them.
  buildHiveBackground();
  buildBottomNav();
  // Remember what this build reflects so a status-only poll can skip the rebuild.
  _lastHiveSig = currentHiveSignature();
}

// The current layout-affecting signature (route/services/order/hidden/pinned/
// mobile/expansion/auth/demo/cap). Mirrors the ordering used by buildHive and
// buildBottomNav so the gate matches what actually gets rendered.
function isMobileHive() {
  return typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(max-width: 720px)').matches;
}
function currentHiveSignature() {
  const base = [...state.services].sort((a, b) => (a.type === 'overseerr' ? 0 : 1) - (b.type === 'overseerr' ? 0 : 1));
  const ordered = orderServices(base).map((s) => ({ key: s.key, type: s.type, hidden: isHidden(s.key) }));
  return hiveSignature({
    route: currentRoute(),
    services: ordered,
    pinned: loadPinned(),
    isMobile: isMobileHive(),
    hiveExpanded,
    plexEnabled: !!(state.config && state.config.auth && state.config.auth.plexEnabled),
    mock: !!(state.config && state.config.mock),
    cap: HIVE_CAP,
  });
}

// Repaint just the connection dots on every rendered hive node (sidebar rail,
// overflow flyout, bottom-nav hexes, all-services sheet) without rebuilding any
// layout. Only touches dots that already exist, so appearance is unchanged for
// nodes that intentionally render no dot.
function updateStatusDots() {
  const nodes = document.querySelectorAll('[data-svc-key]');
  nodes.forEach((node) => {
    const dot = node.querySelector('.hive-dot');
    if (!dot) return;
    const cls = statusDotClass(state.status[node.dataset.svcKey]);
    dot.className = `hive-dot ${cls}`.trim();
  });
}

// ---------- Mobile hex bottom navigation ----------
// Short vibration on tap where supported (no-op on desktop / unsupported).
function haptic(ms = 10) { try { if (navigator.vibrate) navigator.vibrate(ms); } catch { /* ignore */ } }

// User-pinned quick-picks for the bottom bar (max 4). Falls back to nav order.
function loadPinned() { try { return JSON.parse(localStorage.getItem('bn:pinned') || '[]'); } catch { return []; } }
function savePinned(keys) { try { localStorage.setItem('bn:pinned', JSON.stringify(keys.slice(0, 4))); } catch { /* ignore */ } }
function isPinned(key) { return loadPinned().includes(key); }
function togglePinned(key) {
  const p = loadPinned();
  const i = p.indexOf(key);
  if (i >= 0) p.splice(i, 1);
  else { if (p.length >= 4) p.shift(); p.push(key); }
  savePinned(p);
  buildBottomNav();
}

// Service-specific quick destinations for the bottom-bar long-press menu. Each
// entry is [tabId, label] where tabId matches the `tabs()` id used by that
// service view (persisted under `tabs-<svcKey>`), so navigating deep-links
// straight to that tab. Types without a tabbed view (e.g. indexer) just get the
// "Open" entry added below.
const QUICK_ACTIONS = {
  sonarr: [['series', 'Library'], ['calendar', 'Calendar'], ['wanted', 'Wanted'], ['queue', 'Queue'], ['history', 'History']],
  radarr: [['movies', 'Library'], ['calendar', 'Calendar'], ['wanted', 'Wanted'], ['queue', 'Queue'], ['history', 'History']],
  lidarr: [['library', 'Library'], ['wanted', 'Wanted'], ['queue', 'Queue'], ['calendar', 'Calendar'], ['history', 'History']],
  readarr: [['library', 'Library'], ['wanted', 'Wanted'], ['queue', 'Queue'], ['calendar', 'Calendar'], ['history', 'History']],
  sabnzbd: [['queue', 'Queue'], ['history', 'History']],
  tautulli: [['streams', 'Active Streams'], ['history', 'History'], ['stats', 'Statistics'], ['graphs', 'Graphs']],
  qbittorrent: [['downloading', 'Downloading'], ['completed', 'Completed']],
  overseerr: [['pending', 'Pending'], ['all', 'All Requests'], ['issues', 'Issues'], ['recent', 'Recently Added'], ['discover', 'Discover']],
  bazarr: [['series', 'Series'], ['movies', 'Movies'], ['wanted', 'Wanted'], ['history', 'History'], ['blacklist', 'Blacklist'], ['providers', 'Providers'], ['system', 'System']],
  prowlarr: [['indexers', 'Indexers'], ['search', 'Search'], ['history', 'History']],
  plex: [['watchlist', 'Watchlist'], ['duplicates', 'Duplicates'], ['users', 'Users'], ['friends', 'Friends'], ['sessions', 'Now Playing']],
};

// Attach a press-and-hold gesture (touch): fires `onLongPress` after ~550ms if
// the finger hasn't moved, cancels on movement/lift, suppresses the synthetic
// click that follows, and blocks the context menu. Normal taps are unaffected.
function attachLongPress(el, onLongPress, { ms = 550, moveTol = 10 } = {}) {
  let timer = 0; let sx = 0; let sy = 0; let fired = false;
  const clearTimer = () => { if (timer) { clearTimeout(timer); timer = 0; } };
  el.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) { clearTimer(); return; }
    const t = e.touches[0]; sx = t.clientX; sy = t.clientY; fired = false;
    clearTimer();
    timer = setTimeout(() => { fired = true; haptic(20); try { onLongPress(); } catch { /* ignore */ } }, ms);
  }, { passive: true });
  el.addEventListener('touchmove', (e) => {
    const t = e.touches[0]; if (!t) return;
    if (Math.abs(t.clientX - sx) > moveTol || Math.abs(t.clientY - sy) > moveTol) clearTimer();
  }, { passive: true });
  el.addEventListener('touchend', clearTimer, { passive: true });
  el.addEventListener('touchcancel', clearTimer, { passive: true });
  el.addEventListener('contextmenu', (e) => { e.preventDefault(); });
  // Capture-phase so we can swallow the post-long-press click before the
  // element's own onclick (bubble phase) navigates.
  el.addEventListener('click', (e) => { if (fired) { e.preventDefault(); e.stopPropagation(); fired = false; } }, true);
  return el;
}

// Accessible action sheet (modal) of a service's quick destinations. Selecting
// one stores the target tab then navigates/re-renders so it deep-links even if
// we're already on that service (mirrors openInArr). Uses the overlay
// controller (via openModal) so Back/history stays consistent with Search.
function openServiceQuickActions(svc) {
  const go = (tab) => {
    if (tab) { try { localStorage.setItem(`tabs-${svc.key}`, tab); } catch { /* ignore */ } }
    const nav = () => { _pendingIntent = 'new'; if (currentRoute() === svc.key) navigate(); else location.hash = `#/${svc.key}`; };
    if (overlayOpen('modal')) { closeOverlay('modal'); requestAnimationFrame(nav); }
    else { closeModal(); nav(); }
  };
  const dests = QUICK_ACTIONS[svc.type] || [];
  const body = h('div', { class: 'qa-list' },
    ...dests.map(([tab, label]) => h('button', { class: 'qa-item', onclick: () => go(tab) }, h('span', { class: 'qa-label' }, label))),
    h('button', { class: 'qa-item qa-open', onclick: () => go(null) }, h('span', { class: 'qa-label' }, `Open ${svc.label}`)),
  );
  openModal({ title: svc.label, body });
}

// A raised center Home hex with two quick-pick service hexes on each side;
// swipe up (or tap the grip) opens a sheet with every service.
function buildBottomNav() {
  const el = document.getElementById('bottom-nav');
  if (!el) return;
  const route = currentRoute();
  const base = [...state.services].sort((a, b) => (a.type === 'overseerr' ? 0 : 1) - (b.type === 'overseerr' ? 0 : 1));
  const nav = orderServices(base).filter((s) => !isHidden(s.key));
  // Quick-picks: pinned first (in order), then fill from nav order up to 4.
  const pinned = loadPinned().map((k) => nav.find((s) => s.key === k)).filter(Boolean);
  const quick = [...pinned];
  for (const s of nav) { if (quick.length >= 4) break; if (!quick.includes(s)) quick.push(s); }
  quick.length = Math.min(quick.length, 4);
  // Reflect the current route: if you're on a service that isn't a quick-pick,
  // surface it in the last slot so the bar always shows where you are.
  const curSvc = nav.find((s) => s.key === route);
  if (curSvc && !quick.includes(curSvc)) { if (quick.length < 4) quick.push(curSvc); else quick[3] = curSvc; }
  const svcHex = (svc) => {
    const meta = SERVICE_META[svc.type] || {};
    const st = state.status[svc.key];
    const btn = h('button', { class: `bn-hex ${route === svc.key ? 'active' : ''}`, title: svc.label, 'aria-label': svc.label, dataset: { svcKey: svc.key }, onclick: () => { haptic(); location.hash = `#/${svc.key}`; } },
      st ? h('span', { class: `hive-dot ${st.ok ? 'ok' : 'down'}` }) : null,
      h('span', { class: 'hive-icon' }, svcIcon(meta.logo, meta.emoji || '', 24)),
    );
    return attachLongPress(btn, () => openServiceQuickActions(svc));
  };
  const home = h('button', { class: `bn-hex bn-home ${route === 'home' ? 'active' : ''}`, title: 'Home', onclick: () => { haptic(); location.hash = '#/home'; } },
    h('span', { class: 'hive-icon' }, hiveImg('/icons/home-icon.png')));
  const left = quick.slice(0, 2).map(svcHex);
  const right = quick.slice(2, 4).map(svcHex);
  while (left.length < 2) left.push(h('span', { class: 'bn-hex bn-empty' }));
  while (right.length < 2) right.push(h('span', { class: 'bn-hex bn-empty' }));
  // Single row of flat-bottom hexes anchored to the very bottom edge; they share
  // vertical sides so they tile edge-to-edge. Home is taller so it pops up while
  // its bottom stays flush with the rest.
  const nodes = [left[0], left[1], home, right[0], right[1]];
  const W = 68; const HOME_H = 74; const dx = W;
  const row = h('div', { class: 'bn-row', style: { width: `${5 * W}px`, height: `${HOME_H}px` } });
  nodes.forEach((n, i) => { n.style.left = `${i * dx}px`; n.style.bottom = '0'; row.appendChild(n); });
  // Grip is "active" when you're on a route no hex represents (e.g. Settings).
  const gripActive = route === 'settings' || (route !== 'home' && !quick.some((s) => s.key === route));
  const grip = h('button', { class: `bn-grip ${gripActive ? 'active' : ''}`, title: 'All services', 'aria-label': 'All services', onclick: () => { haptic(); openAllServices(); } }, h('span', { class: 'bn-grip-bar' }));
  mount(el, grip, row);
  // Swipe up anywhere on the bar to reveal all services.
  let sy = 0; let sactive = false;
  el.ontouchstart = (e) => { if (e.touches.length !== 1) { sactive = false; return; } sy = e.touches[0].clientY; sactive = true; };
  el.ontouchend = (e) => { if (!sactive) return; sactive = false; if (e.changedTouches[0].clientY - sy < -40) { haptic(); openAllServices(); } };
}

function closeAllServices() {
  const sheet = document.getElementById('allsvc-sheet');
  const bd = document.getElementById('allsvc-backdrop');
  if (sheet) sheet.classList.remove('show');
  if (bd) bd.classList.remove('show');
  unlockScroll();
}

// UI-initiated dismiss (backdrop tap / swipe-down): route through the overlay
// controller so the pushed history entry is consumed (keeps Back in sync).
function dismissAllServices() {
  if (overlayOpen('allsvc')) closeOverlay('allsvc'); else closeAllServices();
}
// Selecting a service: close the sheet (consuming its history state), then
// navigate on the next frame so the back-navigation settles first.
function selectAllService(go) {
  if (overlayOpen('allsvc')) { closeOverlay('allsvc'); requestAnimationFrame(go); }
  else { closeAllServices(); go(); }
}

// Lock/unlock background scrolling while the all-services sheet is open. Uses
// the position:fixed technique because iOS Safari ignores `overflow:hidden` on
// body for touch scrolling. The sheet itself (position:fixed) still scrolls.
let _lockedScrollY = 0;
function lockScroll() {
  if (document.body.style.position === 'fixed') return; // already locked
  _lockedScrollY = window.scrollY || document.documentElement.scrollTop || 0;
  document.body.style.top = `-${_lockedScrollY}px`;
  document.body.style.position = 'fixed';
  document.body.style.left = '0';
  document.body.style.right = '0';
  document.body.style.width = '100%';
}
function unlockScroll() {
  if (document.body.style.position !== 'fixed') return; // not locked
  document.body.style.position = '';
  document.body.style.top = '';
  document.body.style.left = '';
  document.body.style.right = '';
  document.body.style.width = '';
  window.scrollTo(0, _lockedScrollY);
}

// Build (or rebuild) the all-services sheet contents. Each service has a pin
// toggle (★) that adds/removes it from the bottom bar's quick-picks (max 4).
function renderAllServicesGrid() {
  const sheet = document.getElementById('allsvc-sheet');
  if (!sheet) return;
  const route = currentRoute();
  const base = [...state.services].sort((a, b) => (a.type === 'overseerr' ? 0 : 1) - (b.type === 'overseerr' ? 0 : 1));
  const nav = orderServices(base).filter((s) => !isHidden(s.key));
  const pinBtn = (svc) => h('span', { class: `allsvc-pin ${isPinned(svc.key) ? 'on' : ''}`, role: 'button',
    title: isPinned(svc.key) ? 'Unpin from bottom bar' : 'Pin to bottom bar',
    onclick: (e) => { e.stopPropagation(); haptic(); togglePinned(svc.key); renderAllServicesGrid(); } }, isPinned(svc.key) ? '\u2605' : '\u2606');
  const item = (label, active, icon, onClick, dot, svc) => h('button', { class: 'allsvc-item', onclick: () => { haptic(); selectAllService(onClick); } },
    h('span', { class: 'allsvc-hexwrap' },
      h('span', { class: `bn-hex ${active ? 'active' : ''}`, dataset: svc ? { svcKey: svc.key } : null }, dot ? h('span', { class: `hive-dot ${dot}` }) : null, h('span', { class: 'hive-icon' }, icon)),
      svc ? pinBtn(svc) : null,
    ),
    h('span', { class: 'allsvc-label' }, label));
  const items = [
    item('Home', route === 'home', hiveImg('/icons/home-icon.png'), () => { location.hash = '#/home'; }),
    // Search is a global tool (not a pinnable service). Selecting it closes the
    // all-services overlay (consuming its history entry + releasing the scroll
    // lock) before opening the shared Search modal.
    item('Search', false, h('span', { class: 'allsvc-search-ic', html: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>' }), () => openSearch()),
    ...nav.map((svc) => { const meta = SERVICE_META[svc.type] || {}; const st = state.status[svc.key]; return item(svc.label, route === svc.key, svcIcon(meta.logo, meta.emoji || '', 24), () => { location.hash = `#/${svc.key}`; }, st ? (st.ok ? 'ok' : 'down') : '', svc); }),
    item('Settings', route === 'settings', hiveImg('/icons/command-center.svg'), () => { location.hash = '#/settings'; }),
  ];
  mount(sheet,
    h('div', { class: 'allsvc-grip' }),
    h('div', { class: 'section-title', style: { marginTop: '2px' } }, 'All services'),
    h('div', { class: 'allsvc-hint' }, 'Tap \u2606 to pin up to 4 services to the bottom bar'),
    h('div', { class: 'allsvc-grid' }, ...items));
}

function openAllServices() {
  const app = document.getElementById('app');
  let bd = document.getElementById('allsvc-backdrop');
  if (!bd) { bd = h('div', { id: 'allsvc-backdrop', class: 'allsvc-backdrop', onclick: dismissAllServices }); app.appendChild(bd); }
  let sheet = document.getElementById('allsvc-sheet');
  if (!sheet) { sheet = h('div', { id: 'allsvc-sheet', class: 'allsvc-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'All services' }); app.appendChild(sheet); }
  renderAllServicesGrid();
  // Swipe the sheet down (from its top) to dismiss.
  let sy = 0; let sd = false;
  sheet.ontouchstart = (e) => { if (sheet.scrollTop > 0) { sd = false; return; } sy = e.touches[0].clientY; sd = true; };
  sheet.ontouchend = (e) => { if (!sd) return; sd = false; if (e.changedTouches[0].clientY - sy > 60) dismissAllServices(); };
  requestAnimationFrame(() => { lockScroll(); bd.classList.add('show'); sheet.classList.add('show'); registerOverlay('allsvc', { container: sheet, close: closeAllServices }); });
}

// ---------- Pull to refresh (touch) ----------
function initHideNavOnKeyboard() {
  const nav = document.getElementById('bottom-nav');
  if (!nav) return;
  const isField = (el) => el && el.matches && el.matches('input:not([type=button]):not([type=submit]):not([type=checkbox]):not([type=radio]), textarea, [contenteditable=""], [contenteditable="true"]');
  document.addEventListener('focusin', (e) => { if (isField(e.target)) nav.classList.add('kb-hidden'); });
  document.addEventListener('focusout', () => {
    // Defer so focus moving between fields doesn't flicker the bar.
    setTimeout(() => { if (!isField(document.activeElement)) nav.classList.remove('kb-hidden'); }, 60);
  });
}

function initPullToRefresh() {
  if (!('ontouchstart' in window)) return;
  const ind = h('div', { id: 'ptr', class: 'ptr' }, h('span', { class: 'ptr-spin' }));
  document.getElementById('app').appendChild(ind);
  let startY = 0; let pulling = false; let dist = 0;
  const TRIGGER = 72; const MAXPULL = 100;
  const atTop = () => (window.scrollY || document.documentElement.scrollTop || 0) <= 0;
  const bd = () => document.getElementById('allsvc-backdrop');
  const blocked = () => document.getElementById('modal-root').hasChildNodes()
    || (bd() && bd().classList.contains('show'))
    || els.sidebar.classList.contains('open');
  const reset = () => { ind.style.transform = 'translate(-50%, -64px)'; ind.style.opacity = '0'; ind.classList.remove('ready'); };
  window.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1 || !atTop() || blocked()) { pulling = false; return; }
    startY = e.touches[0].clientY; dist = 0; pulling = true;
  }, { passive: true });
  window.addEventListener('touchmove', (e) => {
    if (!pulling) return;
    dist = e.touches[0].clientY - startY;
    if (dist <= 0 || !atTop()) { pulling = false; reset(); return; }
    const y = Math.min(dist * 0.5, MAXPULL) - 64;
    ind.style.transform = `translate(-50%, ${y}px)`;
    ind.style.opacity = String(Math.min(1, dist / 90));
    ind.classList.toggle('ready', dist >= TRIGGER);
    if (dist > 6 && e.cancelable) e.preventDefault();
  }, { passive: false });
  const finish = async () => {
    if (!pulling) return; pulling = false;
    if (dist >= TRIGGER) {
      ind.classList.remove('ready'); ind.classList.add('spinning');
      ind.style.opacity = '1'; ind.style.transform = 'translate(-50%, 12px)';
      _pendingIntent = 'preserve'; // pull-to-refresh keeps your place
      try { await navigate(); } catch { /* ignore */ }
      ind.classList.remove('spinning');
    }
    reset();
  };
  window.addEventListener('touchend', finish, { passive: true });
  window.addEventListener('touchcancel', finish, { passive: true });
}

function setSidebar(open) {
  els.sidebar.classList.toggle('open', open);
  let bd = document.getElementById('sidebar-backdrop');
  if (open && !bd) {
    bd = document.createElement('div');
    bd.id = 'sidebar-backdrop';
    bd.className = 'sidebar-backdrop';
    bd.addEventListener('click', () => setSidebar(false));
    document.getElementById('app').appendChild(bd);
  }
  if (bd) requestAnimationFrame(() => bd.classList.toggle('show', open));
}
function closeSidebarMobile() { setSidebar(false); }

// The global search + notifications bell are available on every route (they
// aggregate across services, so they're useful regardless of the current page).
function toolsAllowed() { return true; }
function updateTopbarTools(route) {
  const show = toolsAllowed(route);
  if (els.searchBtn) els.searchBtn.style.display = show ? '' : 'none';
  const wrap = document.getElementById('notif-wrap');
  if (wrap) wrap.style.display = show ? '' : 'none';
  if (!show && notifOpen) toggleNotif(false);
}

// ---------- Notifications ----------
async function refreshNotifications() {
  try {
    notifications = await fetchNotifications({ api, state });
    updateNotifBadge();
    if (notifOpen) renderNotifPanel();
  } catch { /* ignore */ }
}

function updateNotifBadge() {
  const lastSeen = getLastSeen();
  const unread = notifications.filter((e) => e.at > lastSeen).length + errorLog.length;
  const b = els.notifBadge;
  if (!b) return;
  if (unread > 0) { b.textContent = unread > 99 ? '99+' : String(unread); b.classList.remove('hidden'); }
  else b.classList.add('hidden');
}

function dismissError(id) {
  errorLog = errorLog.filter((e) => e.id !== id);
  updateNotifBadge();
  if (notifOpen) renderNotifPanel();
}

function renderNotifPanel() {
  const panel = els.notifPanel;
  const errorRows = errorLog.map((e) => h('div', { class: 'notif-row' },
    h('span', { class: 'pill down' }, 'Issue'),
    h('div', { class: 'notif-main' },
      h('div', { class: 'notif-title' }, e.message),
      h('div', { class: 'notif-meta dim' }, relTime(e.at)),
    ),
    h('button', { class: 'btn sm', title: 'Dismiss', onclick: (ev) => { ev.stopPropagation(); dismissError(e.id); } }, '✕'),
  ));
  const rows = notifications.map((e) => {
    const k = notifKind(e.kind);
    return h('button', { class: 'notif-row', onclick: () => { location.hash = `#/${e.svcKey}`; toggleNotif(false); } },
      h('span', { class: `pill ${k.cls}` }, k.label),
      h('div', { class: 'notif-main' },
        h('div', { class: 'notif-title' }, e.title),
        h('div', { class: 'notif-meta dim' }, `${e.label} · ${relTime(e.at)}`),
      ),
    );
  });
  mount(panel,
    h('div', { class: 'notif-head' },
      h('span', {}, 'Notifications'),
      errorLog.length ? h('button', { class: 'btn sm', style: { marginLeft: 'auto' }, onclick: () => { errorLog = []; updateNotifBadge(); renderNotifPanel(); } }, 'Clear issues') : null,
    ),
    (errorRows.length || rows.length)
      ? h('div', { class: 'notif-list' }, ...errorRows, ...rows)
      : h('div', { class: 'empty', style: { padding: '24px' } }, 'No recent events'),
  );
}

function relTime(ms) {
  const diff = Date.now() - ms;
  const m = Math.round(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const hrs = Math.round(m / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

function toggleNotif(open) {
  notifOpen = open ?? !notifOpen;
  els.notifPanel.classList.toggle('hidden', !notifOpen);
  if (notifOpen) { positionNotifPanel(); renderNotifPanel(); markSeen(); updateNotifBadge(); }
}

// On mobile the panel is fixed + centered (see CSS); anchor its top just below
// the topbar's real bottom edge, which varies as the topbar wraps. On desktop
// clear the inline top so the CSS-anchored (wrapper-relative) position applies.
function positionNotifPanel() {
  const panel = els.notifPanel;
  if (!panel) return;
  if (window.matchMedia('(max-width: 720px)').matches) {
    const tb = document.getElementById('topbar');
    const bottom = tb ? tb.getBoundingClientRect().bottom : 56;
    panel.style.top = `${Math.round(bottom + 8)}px`;
  } else {
    panel.style.top = '';
  }
}

// ---------- Global search ----------
async function loadLibraries() {
  const out = [];
  const arrs = state.services.filter((s) => (s.type === 'sonarr' || s.type === 'radarr') && s.configured);
  await Promise.all(arrs.map(async (svc) => {
    try {
      const path = svc.type === 'sonarr' ? 'series' : 'movie';
      const items = await cachedGet(`arr:${svc.key}:${path}`, () => api.arr(svc.key).get(path), 300000);
      for (const it of (items || [])) {
        out.push({
          svc, title: it.title, year: it.year, tmdbId: it.tmdbId,
          mediaType: svc.type === 'sonarr' ? 'tv' : 'movie',
          poster: (it.images || []).find((i) => i.coverType === 'poster'),
          path: it.path,
          hasFile: it.hasFile,
          sizeOnDisk: it.sizeOnDisk ?? (it.statistics && it.statistics.sizeOnDisk),
          file: it.movieFile ? {
            name: it.movieFile.relativePath,
            size: it.movieFile.size,
            quality: it.movieFile.quality && it.movieFile.quality.quality && it.movieFile.quality.quality.name,
          } : null,
          stats: it.statistics ? { episodeFileCount: it.statistics.episodeFileCount, episodeCount: it.statistics.episodeCount } : null,
        });
      }
    } catch { /* ignore */ }
  }));
  return out;
}

function openShortcutsHelp() {
  const row = (k, d) => h('div', { class: 'setting-row' },
    h('span', {}, d),
    h('span', { class: 'right' }, h('kbd', {}, k)),
  );
  openModal({
    title: 'Keyboard shortcuts',
    body: h('div', {},
      row('?', 'Show this help'),
      row('/', 'Search your libraries'),
      row('r', 'Refresh connection status'),
      row('1 – 9', 'Jump to a nav item (1 = Home)'),
      row('Esc', 'Close dialogs'),
    ),
  });
}

function openSearch() {
  const input = h('input', { class: 'input', type: 'search', enterkeyhint: 'search', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', placeholder: 'Search libraries & discover new titles…' });
  const results = h('div', { class: 'list', style: { marginTop: '12px' } });
  let typeFilter = 'all';
  const seg = (t, label) => h('button', { class: `view-seg ${typeFilter === t ? 'active' : ''}`, dataset: { t }, onclick: () => setType(t) }, label);
  const filterBar = h('div', { class: 'view-toggle', style: { marginTop: '10px' } }, seg('all', 'All'), seg('movie', 'Movies'), seg('tv', 'TV'));
  const tf = (mt) => typeFilter === 'all' || typeFilter === mt;
  const run = debounce(async () => {
    const q = input.value.trim();
    if (!q) { clear(results); return; }
    mount(results, spinner());
    const ql = q.toLowerCase();
    const lib = await loadLibraries();
    let libMatches = lib.filter((x) => x.title.toLowerCase().includes(ql) && tf(x.mediaType)).slice(0, 40);
    const ownedTmdb = new Set(lib.map((x) => x.tmdbId).filter(Boolean));
    let discover = [];
    const seerrSvc = state.services.find((s) => s.type === 'overseerr' && s.configured);
    if (seerrSvc) {
      try {
        const data = await api.seerr(seerrSvc.key).get(`search?query=${encodeURIComponent(q)}`);
        discover = (data.results || []).filter((x) => x.mediaType !== 'person' && tf(x.mediaType) && !ownedTmdb.has(x.id)).slice(0, 20);
      } catch { /* ignore */ }
    }
    if (!libMatches.length && !discover.length) return mount(results, empty('', 'No matches', 'Try a different title'));
    const nodes = [];
    if (libMatches.length) { nodes.push(h('div', { class: 'section-title' }, 'In your library')); nodes.push(...libMatches.map(searchRow)); }
    if (discover.length) { nodes.push(h('div', { class: 'section-title', style: { marginTop: '14px' } }, 'Discover')); nodes.push(...discover.map((r) => discoverSearchRow(r, seerrSvc))); }
    mount(results, ...nodes);
  }, 300);
  function setType(t) { typeFilter = t; for (const b of filterBar.children) b.classList.toggle('active', b.dataset.t === t); run(); }
  input.addEventListener('input', run);
  openModal({ title: 'Search', body: h('div', {}, input, filterBar, results), wide: true });
  setTimeout(() => input.focus(), 50);
}

function discoverSearchRow(r, seerrSvc) {
  const isTv = r.mediaType === 'tv';
  const title = r.title || r.name || 'Untitled';
  const date = r.releaseDate || r.firstAirDate || '';
  const year = date ? ` (${new Date(date).getFullYear()})` : '';
  const url = r.posterPath ? `https://image.tmdb.org/t/p/w154${r.posterPath}` : null;
  const openMeta = () => openDetailModal({ api, state }, { mediaType: r.mediaType, tmdbId: r.id, fallback: { title, overview: r.overview, posterUrl: url } });
  const st = r.mediaInfo && r.mediaInfo.status;
  const stLabel = { 2: 'Requested', 3: 'Processing', 4: 'Partially Available', 5: 'Available' }[st];
  const canRequest = seerrSvc && (!st || st === 1 || (isTv && st === 4));
  const requestBtn = h('button', { class: 'btn sm primary', onclick: async (e) => {
    if (isTv) {
      // Let the user pick which seasons to download instead of forcing all.
      return openSeasonModal(api.seerr(seerrSvc.key), { service: { key: seerrSvc.key } }, r, title);
    }
    // Movies: offer install location + quality profile (same as the Overseerr view).
    return openMovieRequestModal(api.seerr(seerrSvc.key), { service: { key: seerrSvc.key } }, r, title);
  } }, isTv ? (st === 4 ? '＋ Seasons' : '＋ Select seasons') : '＋ Request');
  return h('div', { class: 'row' },
    h('div', { style: { cursor: 'pointer', flexShrink: '0' }, title: 'View details', onclick: openMeta }, poster(url, '')),
    h('div', { class: 'row-main' },
      h('div', { class: 'row-title', style: { cursor: 'pointer' }, onclick: openMeta }, title, h('span', { class: 'dim' }, year)),
      h('div', { class: 'meta-line', style: { marginTop: '4px' } },
        h('span', { class: 'pill muted' }, isTv ? 'TV' : 'Movie'),
        stLabel ? h('span', { class: `pill ${st >= 5 ? 'ok' : st >= 3 ? 'info' : 'warn'}` }, stLabel) : h('span', { class: 'pill info' }, 'Not in library'),
      ),
    ),
    h('div', { class: 'row-actions' }, canRequest ? requestBtn : null),
  );
}

// Open a library title in its Sonarr/Radarr app and pre-filter to it. Stashing
// the term + changing the hash is enough when we're coming from a different
// route, but if we're ALREADY on that app's route the hash assignment fires no
// `hashchange`, so navigate() wouldn't re-run and the filter would be dropped.
// In that case we invoke navigate() directly so the deep-link filter applies.
function openInArr(m) {
  setPendingFilter(m.svc.key, m.title);
  // The filter lives on the Library tab, but tabs() restores whatever tab the
  // app was last left on. Pin the Library tab so the deep-link always lands
  // there (matters most when we're already in the app on another tab).
  const libTab = m.svc.type === 'sonarr' ? 'series' : 'movies';
  try { localStorage.setItem(`tabs-${m.svc.key}`, libTab); } catch { /* ignore */ }
  closeModal();
  _pendingIntent = 'new'; // deep-linked filter: land at the top of the results
  if (currentRoute() === m.svc.key) navigate();
  else location.hash = `#/${m.svc.key}`;
}

function searchRow(m) {
  const url = m.poster && (m.poster.remoteUrl || m.poster.url);
  const openMeta = () => { if (m.tmdbId) openDetailModal({ api, state }, { mediaType: m.mediaType, tmdbId: m.tmdbId, fallback: { title: m.title, year: m.year, posterUrl: url } }); };
  const posterWrap = h('div', { style: { cursor: 'pointer', flexShrink: '0' }, title: 'View details', onclick: openMeta }, poster(url, ''));
  return h('div', { class: 'row' },
    posterWrap,
    h('div', { class: 'row-main' },
      h('div', { class: 'row-title', style: { cursor: 'pointer' }, title: 'View details', onclick: openMeta }, m.title, h('span', { class: 'dim' }, m.year ? ` (${m.year})` : '')),
      h('div', { class: 'meta-line', style: { marginTop: '4px' } },
        h('span', { class: 'pill muted' }, m.svc.label),
        m.hasFile ? h('span', { class: 'pill ok' }, 'Downloaded') : (m.hasFile === false ? h('span', { class: 'pill warn' }, 'Missing') : null),
        m.sizeOnDisk ? h('span', {}, fmtBytes(m.sizeOnDisk)) : null,
      ),
    ),
    h('div', { class: 'row-actions' },
      h('button', { class: 'btn sm', onclick: () => openArrInfo(m), title: 'Storage & file info' }, 'Info'),
      h('button', { class: 'btn sm primary', title: `Open in ${m.svc.label} and filter to this title`, onclick: () => openInArr(m) }, 'Open'),
    ),
  );
}

function arrInfoRow(label, value) {
  return h('div', { class: 'setting-row' },
    h('span', { class: 'dim' }, label),
    h('span', { class: 'right', style: { textAlign: 'right', maxWidth: '72%', wordBreak: 'break-all' } }, value),
  );
}

// Storage/file details for a Sonarr series or Radarr movie (the "Info" action).
function openArrInfo(m) {
  const rows = [];
  rows.push(arrInfoRow('Service', m.svc.label));
  rows.push(arrInfoRow('Status', m.hasFile ? 'Downloaded' : (m.hasFile === false ? 'Missing' : 'Unknown')));
  if (m.path) rows.push(arrInfoRow('Stored in', copyable(m.path)));
  if (m.sizeOnDisk) rows.push(arrInfoRow('Size on disk', fmtBytes(m.sizeOnDisk)));
  if (m.file && m.file.name) rows.push(arrInfoRow('Grabbed file', copyable(m.file.name)));
  if (m.file && m.file.size) rows.push(arrInfoRow('File size', fmtBytes(m.file.size)));
  if (m.file && m.file.quality) rows.push(arrInfoRow('Quality', m.file.quality));
  if (m.stats) rows.push(arrInfoRow('Episodes on disk', `${m.stats.episodeFileCount} / ${m.stats.episodeCount}`));
  openModal({
    title: `${m.title}${m.year ? ` (${m.year})` : ''}`,
    body: h('div', {}, ...rows),
    footer: h('div', { style: { display: 'flex', gap: '10px', justifyContent: 'flex-end', width: '100%' } },
      h('button', { class: 'btn', onclick: closeModal }, 'Close'),
      h('button', { class: 'btn primary', onclick: () => openInArr(m) }, `Open ${m.svc.label}`),
    ),
  });
}

// Background honeycomb swath: aligned to the nav hex grid, flowing out of the
// Sonarr cell diagonally down-and-right, fading from purple to gray.
function buildHiveBackground() {
  const el = els.hiveBg;
  if (!el) return;
  const VW = window.innerWidth, VH = window.innerHeight;
  // Align the background grid to the ACTUAL rendered nav button (position + size)
  // so the polygons sit exactly on the sidebar hexes.
  const firstCell = document.querySelector('#hive .hive-cell');
  let W = 100, H = 88, ax = 58, ay = 54;
  if (firstCell) {
    const r = firstCell.getBoundingClientRect();
    W = r.width; H = r.height;
    ax = r.left + r.width / 2; ay = r.top + r.height / 2;
  }
  if (ax < 20) ax = 58; // sidebar off-canvas on mobile — anchor the honeycomb near the left edge
  const dxc = 0.75 * W;             // flat-top column spacing
  const maxDim = Math.max(VW, VH);
  const hexPts = (cx, cy) => {
    const x = cx - W / 2, y = cy - H / 2;
    return [[x + 0.25 * W, y], [x + 0.75 * W, y], [x + W, y + 0.5 * H], [x + 0.75 * W, y + H], [x + 0.25 * W, y + H], [x, y + 0.5 * H]].map((q) => q.join(',')).join(' ');
  };
  const cl = (x) => Math.max(0, Math.min(255, Math.round(x)));
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const DEEP = [109, 40, 217], VIOLET = [168, 85, 247], SLATE = [226, 232, 240];
  const colorAt = (t) => (t < 0.5 ? mix(DEEP, VIOLET, t / 0.5) : mix(VIOLET, SLATE, (t - 0.5) / 0.5));
  // Deterministic per-hex pseudo-random (stable across rebuilds) for shade variation.
  const hash = (a, b) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };
  // Tessellate on the SAME grid as the sidebar hexes: column 0 sits exactly on the
  // nav button so the polygons line up with (and overlap) the buttons. Extends left
  // of the sidebar and generates outward to the right, densest at the left.
  const fadeL = 12 * dxc;  // left field fade distance (to the right)
  const fadeR = 10 * dxc;  // right field base fade distance (to the left)
  let polys = '';
  const cStart = Math.floor((-W - ax) / dxc) - 1;
  const cEnd = Math.ceil((VW + W - ax) / dxc) + 1;
  for (let c = cStart; c <= cEnd; c++) {
    const xc = ax + c * dxc;
    const parity = ((c % 2) + 2) % 2;
    for (let row = -2; row < Math.ceil(VH / H) + 2; row++) {
      const yc = ay + parity * (H / 2) + row * H;
      if (yc < -H || yc > VH + H) continue;
      // Left field: dense behind the sidebar, fading right — with a per-hex random
      // reach so its inner edge juts out irregularly like the right field.
      const jutL = hash(c * 2.3 + 4.1, row * 3.3 + 2.7);
      const reachL = fadeL * (0.5 + jutL * 1.0);
      const leftOp = 0.34 * Math.max(0, Math.min(1, 1 - xc / reachL));
      // Right field: dense at the right edge, fading left, with a per-hex random
      // reach so its inner edge randomly juts out into the page.
      const jut = hash(c * 3.7 + 1.3, row * 2.9 + 0.7);
      const reachR = fadeR * (0.5 + jut * 1.0);
      const rightOp = 0.28 * Math.max(0, Math.min(1, 1 - (VW - xc) / reachR));
      const baseOp = Math.max(leftOp, rightOp);
      if (baseOp <= 0.02) continue;
      const rightDom = rightOp > leftOp;
      const t = rightDom
        ? Math.max(0, Math.min(1, 0.35 + (hash(c, row) - 0.5) * 0.2))
        : Math.max(0, Math.min(1, xc / (maxDim * 0.8) + (hash(c, row) - 0.5) * 0.2));
      const rgb = colorAt(t);
      const f = 0.8 + hash(c * 1.7 + 3.1, row * 2.3 + 1.9) * 0.4;
      const op = baseOp * (0.8 + hash(row + 5, c + 9) * 0.4);
      polys += `<polygon points="${hexPts(xc, yc)}" fill="rgb(${cl(rgb[0] * f)},${cl(rgb[1] * f)},${cl(rgb[2] * f)})" fill-opacity="${op.toFixed(3)}"/>`;
    }
  }
  el.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="${VW}" height="${VH}" viewBox="0 0 ${VW} ${VH}">${polys}</svg>`;
}

// ---------- Status polling ----------
// Apply a freshly fetched status map: repaint dots in place when the layout is
// unchanged, otherwise rebuild the hive (see currentHiveSignature).
function applyStatusResult() {
  if (_lastHiveSig !== null && currentHiveSignature() === _lastHiveSig) {
    updateStatusDots();
  } else {
    buildHive();
  }
}

async function refreshStatus() {
  try {
    state.status = await api.status();
    applyStatusResult();
    // The aggregate request succeeded → the dashboard backend is reachable.
    // (Individual services may still be "down" in the map; that's not offline.)
    stopProbing();
    setConnBanner(navigator.onLine ? null : 'offline');
  } catch (err) {
    // The /api/status request itself failed → the dashboard can't reach its
    // backend. Surface "Reconnecting" and start the health probe.
    console.error('status error', err);
    startProbing();
  }
}

// ----- Connection banner -----
function setConnBanner(mode) {
  const el = document.getElementById('conn-banner');
  if (!el) return;
  if (!mode) { el.classList.remove('show'); el.removeAttribute('data-mode'); el.textContent = ''; return; }
  el.dataset.mode = mode;
  el.textContent = mode === 'offline' ? 'Offline — check your connection' : 'Reconnecting…';
  el.classList.add('show');
}

// ----- Health probe (bounded backoff, single in-flight loop) -----
function stopProbing() {
  _probeActive = false;
  if (_probeTimer) { clearTimeout(_probeTimer); _probeTimer = 0; }
  _probeDelay = 0;
}

function startProbing() {
  if (_probeActive) return; // never overlap probe loops
  _probeActive = true;
  _probeDelay = 0;
  setConnBanner(navigator.onLine ? 'reconnecting' : 'offline');
  probeCycle();
}

async function probeCycle() {
  _probeTimer = 0;
  if (!_probeActive) return;
  // If the browser itself is offline, pause until the 'online' event resumes us.
  if (!navigator.onLine) { setConnBanner('offline'); return; }
  setConnBanner('reconnecting');
  let healthy = false;
  try {
    const res = await fetch('/healthcheck', { cache: 'no-store', headers: { 'cache-control': 'no-store' } });
    healthy = res.ok;
  } catch { healthy = false; }
  if (!_probeActive) return; // stopped while awaiting
  if (healthy) {
    // If initial config loading failed, the app shell was never initialized.
    // Reload once the backend is reachable so config/routes/timers are built.
    if (_bootBlocked) { stopProbing(); location.reload(); return; }
    // Backend is up — refresh status once. If that also succeeds we've fully
    // recovered; otherwise keep probing on the backoff schedule.
    try {
      state.status = await api.status();
      if (!_probeActive) return;
      applyStatusResult();
      stopProbing();
      setConnBanner(navigator.onLine ? null : 'offline');
      return;
    } catch { /* status still failing — keep probing */ }
    if (!_probeActive) return;
  }
  _probeDelay = Math.min(_probeDelay ? Math.round(_probeDelay * 1.6) : 1200, 15000);
  _probeTimer = setTimeout(probeCycle, _probeDelay);
}

// ---------- Init ----------
async function init() {
  initAppearance();
  // Own scroll restoration so route/history-aware logic (see navigate) controls
  // it instead of the browser guessing on Back/Forward.
  try { if ('scrollRestoration' in history) history.scrollRestoration = 'manual'; } catch { /* ignore */ }
  // Connection banner: react to the browser's own online/offline transitions in
  // addition to backend reachability (see refreshStatus / probeCycle).
  window.addEventListener('offline', () => { setConnBanner('offline'); });
  window.addEventListener('online', () => {
    if (_probeActive) { if (!_probeTimer) probeCycle(); } // resume a paused loop
    else startProbing();
  });
  try {
    state.config = await api.config();
  } catch (err) {
    _bootBlocked = true;
    setConnBanner(navigator.onLine ? 'reconnecting' : 'offline');
    startProbing();
    mount(els.view, h('div', { class: 'empty' }, h('div', { class: 'empty-icon' }, ''), 'Could not load config', h('div', { class: 'dim' }, String(err.message))));
    return;
  }
  state.services = Object.values(state.config.services || {});

  // The sidebar is a permanent icon-only rail.
  document.getElementById('app').classList.add('collapsed');

  buildHiveBackground();
  let resizeTimer;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { buildHive(); }, 200); });

  await refreshStatus();
  // Restore the last route if no explicit hash was provided.
  if (!location.hash) {
    try { const last = localStorage.getItem('acc:last-route'); if (last && last !== 'home') location.hash = `#/${last}`; } catch { /* ignore */ }
  }
  window.addEventListener('hashchange', navigate);
  await navigate();

  // Poll connection status every 15s.
  setInterval(refreshStatus, 15000);

  // Auto-refresh the Overview activity area every 30s (silent, no flash).
  setInterval(() => {
    if (currentRoute() === 'home' && homeCtx) refreshHome(homeCtx);
  }, 30000);

  // Notifications: initial load + poll every 30s.
  refreshNotifications();
  setInterval(refreshNotifications, 30000);

  // Mobile: pull down at the top of any view to refresh.
  initPullToRefresh();

  // Mobile: hide the bottom hex nav while a text field is focused so it doesn't
  // float in the middle of the screen above the on-screen keyboard.
  initHideNavOnKeyboard();

  // Web push: register the service worker and self-heal the subscription so the
  // server always has this browser's current endpoint (fixes push silently
  // stopping after it "worked once"). No-ops if unsupported/insecure/not granted.
  try {
    if (push.isSupported() && push.isSecure()) {
      await push.registerServiceWorker().catch(() => {});
      push.sync().catch(() => {});
    }
  } catch { /* ignore */ }

  // Global controls
  document.getElementById('menu-toggle').addEventListener('click', () => setSidebar(!els.sidebar.classList.contains('open')));
  if (els.notifBtn) els.notifBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleNotif(); });
  if (els.searchBtn) els.searchBtn.addEventListener('click', openSearch);
  // Close the notifications panel on outside click.
  document.addEventListener('click', (e) => {
    if (notifOpen && !document.getElementById('notif-wrap').contains(e.target)) toggleNotif(false);
  });
  // Collapse the nav overflow flyout on outside click (rail + flyout clicks are
  // handled by their own buttons).
  document.addEventListener('click', (e) => {
    if (!hiveExpanded) return;
    const fly = document.getElementById('hive-flyout');
    if (els.sidebar.contains(e.target) || (fly && fly.contains(e.target))) return;
    hiveExpanded = false; buildHive();
  });
  // Persist error toasts into the notifications bell (action center).
  window.addEventListener('app-error', (e) => {
    const d = e.detail || {};
    errorLog.unshift({ id: Date.now() + Math.random(), message: d.message || 'Error', at: d.at || Date.now() });
    errorLog = errorLog.slice(0, 25);
    updateNotifBadge();
    if (notifOpen) renderNotifPanel();
  });
  document.addEventListener('keydown', (e) => {
    const typing = /input|textarea|select/i.test(document.activeElement.tagName);
    if (e.key === 'Escape' && notifOpen) toggleNotif(false);
    if (typing) return;
    if (e.key === 'r') { refreshStatus(); _pendingIntent = 'preserve'; navigate(); }
    if (e.key === '/') { if (toolsAllowed()) { e.preventDefault(); openSearch(); } }
    if (e.key === '?') { e.preventDefault(); openShortcutsHelp(); }
    if (/^[1-9]$/.test(e.key) && !document.getElementById('modal-root').hasChildNodes()) {
      const cells = document.querySelectorAll('#hive .hive-cell');
      const cell = cells[Number(e.key) - 1];
      if (cell) cell.click();
    }
  });
}

init();
