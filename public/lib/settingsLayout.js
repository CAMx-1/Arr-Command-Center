// Settings layout: tabs across the top, each holding collapsible rows. A
// closed row shows the setting's name and its current value; opening it shows
// the full controls. Only one row is open at a time. Tab and open row are
// kept in the URL (?tab=…&open=…) so links and reloads land in the same place.
//
// The section bodies are the existing cards, built once and kept in the page
// (hidden while closed), so code that fills them in by id keeps working.
import { h, mount, debounce } from './ui.js';
import { expand, collapse, setOpenInstant, staggerIn, holdInPlace, reducedMotion, EASE_IN_OUT } from './motion.js';

export const SETTINGS_TABS = [
  ['you', 'You'], ['notifications', 'Notifications'], ['services', 'Services'],
  ['automation', 'Automation'], ['admin', 'Admin'], ['system', 'System'],
];

const CHEVRON = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
const SEARCH = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>';

const textOf = (v) => (v == null ? '' : typeof v === 'string' ? v : v.textContent || '');

// Pure: which tabs to show, and where to land.
export function visibleTabs(sections) {
  return SETTINGS_TABS.filter(([id]) => sections.some((s) => s.tab === id));
}
export function resolveLanding(sections, { tab, open } = {}) {
  const tabs = visibleTabs(sections);
  const byId = new Map(sections.map((s) => [s.id, s]));
  // Old anchor names (settings-backups) and bare ids both work for ?open=.
  const want = open && (byId.get(open) || sections.find((s) => (s.aliases || []).includes(open)));
  if (want) return { tab: want.tab, open: want.id };
  const t = tabs.find(([id]) => id === tab) ? tab : (tabs[0] || [])[0];
  return { tab: t, open: null };
}
export function matchSections(sections, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return null;
  return sections.filter((s) => `${s.title} ${(s.keywords || []).join(' ')} ${textOf(s.summaryText)}`.toLowerCase().includes(q));
}

// sections: [{ id, tab, title, nodes: [Node], summary?: string|Node|() => Promise<string|Node>,
//              badge?: number|() => Promise<number>, keywords?: [], aliases?: [] }]
export function settingsLayout(sections, { params = {}, setParams = () => {} } = {}) {
  const tabsDef = visibleTabs(sections);
  let { tab, open } = resolveLanding(sections, params);
  const badges = new Map();
  const tabEls = new Map();
  const items = new Map();

  const list = h('div', { class: 'sx-list' });
  const empty = h('div', { class: 'dim sx-empty', hidden: 'hidden' }, 'No settings match.');

  const paintBadges = () => {
    for (const [id, el] of tabEls) {
      const n = sections.filter((s) => s.tab === id).reduce((sum, s) => sum + (badges.get(s.id) || 0), 0);
      const b = el.querySelector('.sx-n');
      b.textContent = n ? String(n) : '';
      b.hidden = !n;
    }
  };

  for (const s of sections) {
    const value = h('span', { class: 'sx-v' });
    const badge = h('span', { class: 'sx-badge', hidden: 'hidden' });
    const body = h('div', { class: 'sx-body', id: `settings-body-${s.id}`, hidden: 'hidden', role: 'region', 'aria-label': s.title }, ...(s.nodes || []).filter(Boolean));
    const head = h('button', { type: 'button', class: 'sx-head', id: `settings-${s.id}`, 'aria-expanded': 'false', 'aria-controls': body.id, onclick: () => toggle(s.id) },
      h('span', { class: 'sx-t' }, s.title), badge, value, h('span', { class: 'sx-chev', html: CHEVRON }));
    const wrap = h('div', { class: 'sx-item', dataset: { section: s.id, tab: s.tab } }, head, body);
    items.set(s.id, { wrap, head, body, value, badge, isOpen: false });
    list.appendChild(wrap);
    const setValue = (v) => { s.summaryText = v; mount(value, ...(v == null ? [] : [typeof v === 'string' ? document.createTextNode(v) : v])); };
    if (typeof s.summary === 'function') { setValue(''); Promise.resolve().then(s.summary).then(setValue).catch(() => setValue('')); } else setValue(s.summary);
    // A card can ask for its row's summary to be read again after a change.
    if (typeof s.summary === 'function') body.addEventListener('sx:refresh', () => { Promise.resolve().then(s.summary).then(setValue).catch(() => {}); });
    const setBadge = (n) => { const v = Number(n) || 0; badges.set(s.id, v); badge.textContent = v ? `${v} ${s.badgeLabel || ''}`.trim() : ''; badge.hidden = !v; paintBadges(); };
    if (typeof s.badge === 'function') Promise.resolve().then(s.badge).then(setBadge).catch(() => setBadge(0)); else setBadge(s.badge);
  }

  const tabBar = h('div', { class: 'sx-tabs', role: 'tablist', 'aria-label': 'Settings' }, ...tabsDef.map(([id, label]) => {
    const el = h('button', { type: 'button', role: 'tab', class: 'sx-tab', onclick: () => selectTab(id) }, label, h('span', { class: 'sx-n', hidden: 'hidden' }));
    tabEls.set(id, el);
    return el;
  }));

  let query = '';
  // paint() puts every row in its state. Rows whose open state changes grow
  // or shrink (animate), or snap when they're not on screen.
  function paint({ animate = true } = {}) {
    const hits = matchSections(sections, query);
    for (const [id, el] of tabEls) { el.classList.toggle('on', !hits && id === tab); el.setAttribute('aria-selected', String(!hits && id === tab)); }
    tabBar.classList.toggle('searching', !!hits);
    let shown = 0;
    for (const s of sections) {
      const it = items.get(s.id);
      const visible = hits ? hits.includes(s) : s.tab === tab;
      const wasVisible = !it.wrap.hidden;
      it.wrap.hidden = !visible;
      if (visible) shown += 1;
      const isOpen = visible && s.id === open;
      it.wrap.classList.toggle('sx-open', isOpen);
      it.head.setAttribute('aria-expanded', String(isOpen));
      if (isOpen === it.isOpen) continue;
      it.isOpen = isOpen;
      if (animate && visible && wasVisible) { if (isOpen) expand(it.body); else collapse(it.body); }
      else setOpenInstant(it.body, isOpen);
    }
    empty.hidden = shown > 0;
  }
  const visibleItems = () => [...items.values()].filter((it) => !it.wrap.hidden).map((it) => it.wrap);
  const tabIndex = (id) => tabsDef.findIndex(([t]) => t === id);

  // Swap the list's contents with a quick fade out, then ease the new rows in
  // from the side the tab is on.
  let swapToken = 0;
  function swapList(change, { dx = 0, dy = 6 } = {}) {
    const token = ++swapToken;
    if (reducedMotion()) { change(); return; }
    const out = list.animate([{ opacity: 1, transform: 'translateX(0)' }, { opacity: 0, transform: `translateX(${-dx / 2}px)` }], { duration: 90, easing: EASE_IN_OUT });
    out.finished.then(() => {
      if (token !== swapToken) return;
      change();
      staggerIn(visibleItems(), { dx, dy: dx ? 0 : dy });
    }, () => {});
  }

  function selectTab(id) {
    if (id === tab && !query) return;
    const dir = Math.sign(tabIndex(id) - tabIndex(tab)) || 1;
    tab = id; open = null; query = ''; search.value = '';
    setParams({ tab: id === tabsDef[0][0] ? '' : id, open: '' });
    swapList(() => paint({ animate: false }), { dx: 22 * dir });
    tabEls.get(id).scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
  }

  function toggle(id) {
    const s = sections.find((x) => x.id === id);
    const it = items.get(id);
    const prev = open && items.get(open);
    open = open === id ? null : id;
    if (open && !query) tab = s.tab;
    setParams({ tab: tab === tabsDef[0][0] ? '' : tab, open: open || '' });
    // If a row above is closing, keep the one you tapped under your finger
    // instead of letting it slide up the screen.
    if (open && prev && prev !== it && (prev.wrap.compareDocumentPosition(it.wrap) & Node.DOCUMENT_POSITION_FOLLOWING)) holdInPlace(it.head, 260);
    paint();
    if (open) {
      setTimeout(() => {
        const head = it.head.getBoundingClientRect();
        const body = it.body.getBoundingClientRect();
        const room = innerHeight - 24;
        // Bring the opened panel into view without pushing its row off the top.
        if (head.top < 70) it.head.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' });
        else if (body.bottom > room) window.scrollBy({ top: Math.min(body.bottom - room, head.top - 80), behavior: reducedMotion() ? 'auto' : 'smooth' });
      }, reducedMotion() ? 0 : 290);
    }
  }

  const search = h('input', { class: 'sx-search-input', type: 'search', placeholder: 'Search settings', 'aria-label': 'Search settings', autocomplete: 'off' });
  const applySearch = () => { query = search.value; if (query) { const hits = matchSections(sections, query); if (hits && hits.length === 1) open = hits[0].id; } paint({ animate: false }); staggerIn(visibleItems(), { dy: 4, step: 18, duration: 200 }); };
  search.addEventListener('input', debounce(applySearch, 150));
  search.addEventListener('keydown', (e) => { if (e.key === 'Escape') { search.value = ''; applySearch(); } });

  const el = h('div', { class: 'sx-settings' },
    h('label', { class: 'sx-search' }, h('span', { class: 'sx-search-ic', html: SEARCH }), search),
    h('div', { class: 'sx-tabwrap' }, tabBar), list, empty);
  paint({ animate: false });
  // First load: rows settle in one after another.
  requestAnimationFrame(() => staggerIn(visibleItems(), { dy: 10, step: 35, duration: 320 }));
  return { el, openSection: (id) => { const r = resolveLanding(sections, { open: id }); if (r.open) { tab = r.tab; open = null; toggle(r.open); } } };
}
