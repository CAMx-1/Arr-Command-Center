// Year in review: each person's year of watching from Tautulli, with a
// picture or a story to save or share, a month-by-month chart and a
// tap-through slideshow. On Home in December and January, in Settings → You
// any time, and as a tab on the Tautulli page.
//
// The parts live in their own files: recapText.js (numbers and words),
// recapDraw.js (the pictures), recapViewer.js (full screen, with zoom) and
// recapShow.js (the slideshow).
import { h, mount, toast, openModal } from './ui.js';
import { api } from './api.js';
import { showcaseEnabled, fakeName } from './showcase.js';
import { isLocalMode } from './connections.js';
import {
  recapSeason, recapYear, soFar, fmtHours, fmtDay, hourLabel, monthName, nameFor, totalsLine, compareText, compareArrow,
  monthTowers, unitText, monthTopsText, summaryText, plural, TOWER, WEEKDAY_NAMES,
} from './recapText.js';
import { drawRecapCard, loadPosters, towerSvg } from './recapDraw.js';
import { openViewer } from './recapViewer.js';
import { openRecapShow } from './recapShow.js';

// Kept for the code and tests that import these from here.
export { recapSeason, recapYear, fmtHours, bigNumber, fmtDay, monthTowers, unitText, TOWER } from './recapText.js';
export { CARD, BOX, STORY, hexHalfWidth, rgbOf, monthColor, wrapLines, drawRecapCard } from './recapDraw.js';

const HIDE_KEY = (y) => `acc:recap-hide:${y}`;
export const recapAvailable = (state) => !!(state && state.config && state.config.recap) && !isLocalMode();

// Hex or Box for this device: the choice made here, or by default Hex on
// desktop and Box on phones (where the hexagon's text gets small). It isn't
// one of the settings that follow you, so each device keeps its own.
export const RECAP_VIEW_KEY = 'acc:recap-view';
export const RECAP_NARROW = '(max-width: 760px)';
export function pickRecapView(stored, narrow) { return stored === 'hex' || stored === 'box' ? stored : narrow ? 'box' : 'hex'; }
const storedView = () => { try { return localStorage.getItem(RECAP_VIEW_KEY); } catch { return null; } };
const narrowNow = () => { try { return !!(window.matchMedia && window.matchMedia(RECAP_NARROW).matches); } catch { return false; } };

function load({ year, user }) {
  const tz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { return ''; } })();
  const q = new URLSearchParams({ year: String(year), tz });
  if (user) q.set('user', user);
  return api.getJson(`/api/recap?${q}`);
}

const cssColors = () => {
  const cs = getComputedStyle(document.documentElement);
  const v = (n, d) => (cs.getPropertyValue(n) || '').trim() || d;
  return [v('--accent', '#6366f1'), v('--accent-2', '#a855f7'), v('--accent-3', '#ec4899')];
};
const fileName = (data, format) => `${data.year}-in-review-${String(nameFor(data)).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'everyone'}${format === 'story' ? '-story' : ''}.png`;
const toBlob = (canvas) => new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Couldn’t make the picture'))), 'image/png'));
export const canShareFiles = () => { try { return !!(navigator.canShare && navigator.canShare({ files: [new File([new Uint8Array(1)], 'x.png', { type: 'image/png' })] })); } catch { return false; } };

// Pictures for one year's data: drawn once per shape and format, with posters.
function pictures(data) {
  const colors = cssColors();
  const font = (typeof document !== 'undefined' && getComputedStyle(document.body).fontFamily) || undefined;
  const made = new Map();
  let posters = null;
  return {
    colors,
    async ready() { if (!posters) { try { posters = await loadPosters(data.recap, { timeout: 2500 }); } catch { posters = undefined; } } },
    canvas(shape, format) {
      const key = `${shape}|${format}`;
      if (made.has(key)) return made.get(key);
      let cv = document.createElement('canvas');
      drawRecapCard(cv, data, { shape, format, colors, font, posters: posters || undefined });
      let url;
      try { url = cv.toDataURL('image/png'); } catch {
        // A poster the browser won't let us read back: draw it without posters.
        cv = document.createElement('canvas'); drawRecapCard(cv, data, { shape, format, colors, font }); url = cv.toDataURL('image/png');
      }
      const out = { canvas: cv, url };
      made.set(key, out);
      return out;
    },
    async save(shape, format) {
      const url = URL.createObjectURL(await toBlob(this.canvas(shape, format).canvas));
      const a = h('a', { href: url, download: fileName(data, format) }); document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    },
    async share(shape, format) {
      const file = new File([await toBlob(this.canvas(shape, format).canvas)], fileName(data, format), { type: 'image/png' });
      await navigator.share({ files: [file], title: `${data.year} in review` });
    },
  };
}
const quietly = (fn) => async () => { try { await fn(); } catch (e) { if (e && e.name !== 'AbortError') toast(e.message, 'error'); } };

// Starts the slideshow for loaded data.
function playShow(data, pics, { shape }) {
  return openRecapShow(data, {
    colors: pics.colors,
    makePicture: async () => { await pics.ready(); const p = pics.canvas(shape, 'picture'); return { url: p.url, alt: summaryText(data) }; },
    save: quietly(() => pics.save(shape, 'picture')),
    share: quietly(() => pics.share(shape, 'picture')),
    canShare: canShareFiles,
  });
}

// ---- month by month ----
// Four corner arrows: "open full screen".
const EXPAND_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5"/></svg>';

let chartIds = 0;
function monthChart(data, colors) {
  const tw = monthTowers(data.recap.months, { year: data.year });
  const tops = data.recap.monthTops || [];
  const uid = `rcm${(chartIds += 1)}`;
  const pct = (m) => (m.share >= 0.005 ? `${Math.round(m.share * 100)}% of the year` : 'under 1% of the year');
  const describe = (m) => {
    const name = monthName(m.i);
    if (m.state === 'future') return `${name}: still to come`;
    if (m.state === 'empty') return `${name}: nothing watched`;
    return `${name}${m.state === 'current' ? ' so far' : ''}: ${fmtHours(m.hours * 3600)}, ${pct(m)}`;
  };
  const peak = tw.months[tw.peakIdx];
  const lead = h('span', { class: 'recap-chart-lead' }); const rest = h('span', { class: 'recap-chart-rest' });
  const what = h('div', { class: 'recap-chart-tops' });
  const caption = h('div', { class: 'recap-chart-caption', 'aria-live': 'polite' }, h('div', {}, lead, rest), what);
  const show = (m) => {
    if (!m) { mount(lead, 'Nothing watched yet'); mount(rest); mount(what); return; }
    if (m === peak) { mount(lead, `Busiest month: ${monthName(m.i)}`); mount(rest, ` · ${fmtHours(m.hours * 3600)} · ${pct(m)}`); }
    else { const [name, info] = describe(m).split(': '); mount(lead, name); mount(rest, ` · ${info.replace(', ', ' · ')}`); }
    const line = m.state === 'future' || m.state === 'empty' ? '' : monthTopsText(tops[m.i]);
    mount(what, line ? h('span', {}, h('span', { class: 'recap-chart-tops-k' }, 'Most watched: '), line) : null);
  };
  let pinned = null;
  const cols = tw.months.map((m) => h('button', {
    type: 'button',
    class: `recap-mcol ${m.state}${m.peak ? ' peak' : ''}`,
    'aria-label': describe(m), 'aria-pressed': 'false',
    onmouseenter: () => show(m), onfocus: () => show(m),
    onmouseleave: () => show(pinned || peak), onblur: () => show(pinned || peak),
    onclick: (e) => {
      pinned = pinned === m ? null : m;
      for (const b of e.currentTarget.parentElement.children) { b.classList.remove('pinned'); b.setAttribute('aria-pressed', 'false'); }
      if (pinned) { e.currentTarget.classList.add('pinned'); e.currentTarget.setAttribute('aria-pressed', 'true'); }
      show(pinned || peak);
    },
  }, h('span', { class: 'recap-tower', html: towerSvg(m, { ...TOWER, cells: tw.cells }, colors, `${uid}-${m.i}`) }), h('span', { class: 'recap-mname' }, monthName(m.i, 'short'))));
  show(peak);
  return h('section', { class: 'recap-chart', 'aria-label': 'Month by month' },
    h('div', { class: 'recap-chart-head' }, h('span', { class: 'recap-chart-title' }, 'Month by month'),
      tw.unit ? h('span', { class: 'recap-chart-key' }, h('span', { class: 'recap-key-hex', 'aria-hidden': 'true' }), ` = ${unitText(tw.unit)}`) : null),
    h('div', { class: 'recap-chart-cols' }, ...cols),
    caption,
    h('div', { class: 'recap-chart-hint' }, 'Tap a month to see what was watched'));
}

// ---- the details beside (or, on phones, under) the picture ----
function details(data) {
  const r = data.recap;
  const row = (label, ...value) => h('div', { class: 'recap-stat' }, h('div', { class: 'recap-stat-label' }, label), h('div', { class: 'recap-stat-value' }, ...value));
  const cmp = compareText(r);
  const list = (items, line) => h('ol', { class: 'recap-toplist' }, ...items.map((x) => h('li', {}, h('span', { class: 'recap-tl-title' }, x.title), h('span', { class: 'recap-tl-val' }, line(x)))));
  // On phones the picture's text is small, so the main numbers are here too.
  const phone = h('div', { class: 'recap-only-narrow' },
    row('Hours watched', h('span', { class: 'recap-big' }, fmtHours(r.totals.seconds)), h('div', { class: 'dim', style: { fontSize: '13px' } }, totalsLine(data).join(' · '))),
    r.topShows.length ? row('Top shows', list(r.topShows, (x) => `${fmtHours(x.seconds, { short: true })} · ${plural(x.episodes, 'episode')}`)) : null,
    r.topFilms.length ? row('Top films', list(r.topFilms, (x) => `${fmtHours(x.seconds, { short: true })}${x.plays > 1 ? ` · ${x.plays} times` : ''}`)) : null,
    r.busiest ? row(r.busiest.night ? 'Busiest night' : 'Busiest day', `${fmtDay(r.busiest.date)}, ${fmtHours(r.busiest.seconds)}`) : null,
    r.rewatched.film ? row('Most rewatched', `${r.rewatched.film.title}, ${r.rewatched.film.times} times`) : null);
  return h('div', { class: 'recap-details' },
    cmp ? row(`Compared with ${r.compare.year}`, h('span', { class: `recap-compare recap-${cmp.dir}` }, h('span', { 'aria-hidden': 'true' }, `${compareArrow(cmp.dir)} `), cmp.long)) : null,
    phone,
    r.topWeekday != null ? row('When', `Mostly ${WEEKDAY_NAMES[r.topWeekday]}s, around ${hourLabel(r.topHour)}`) : null,
    r.devices.length ? row('Watched on', r.devices.map((d) => `${d.name} (${fmtHours(d.seconds, { short: true })})`).join(', ')) : null,
    r.binge ? row('Longest binge', `${r.binge.episodes} episodes of ${r.binge.show}, ${fmtDay(r.binge.date)}`) : null,
    r.streak ? row('Longest streak', `${r.streak.days} days in a row, ${fmtDay(r.streak.from)} to ${fmtDay(r.streak.to)}`) : null,
    r.rewatched.episode && r.rewatched.film ? row('Most rewatched episode', `${r.rewatched.episode.show} ${r.rewatched.episode.code}${r.rewatched.episode.title ? ` “${r.rewatched.episode.title}”` : ''}, ${r.rewatched.episode.times} times`) : null,
    r.first ? row('First of the year', `${r.first.title}, ${fmtDay(r.first.date)}`) : null,
    r.totals.musicSeconds ? row('Music', `${fmtHours(r.totals.musicSeconds)} listened${r.topArtists.length ? `; most: ${r.topArtists.map((a) => a.title).join(', ')}` : ''}`) : null,
  );
}

// Fills `root` with the year in review and its controls.
export function renderRecap(root, ctx, { year = recapYear(), user = null, play = false } = {}) {
  let current = { year, user };
  const thisYear = new Date().getFullYear();
  let shown = false;
  let lastData = null; let pics = null; let format = 'picture'; let autoPlay = !!play;
  const draw = async () => {
    // The first time, a line of text; after that the current view stays
    // where it is (faded) until the new one is ready, so nothing jumps.
    if (shown) root.classList.add('recap-busy');
    else mount(root, h('div', { class: 'dim', style: { padding: '12px 0' } }, 'Adding up the year…'));
    let data;
    try { data = await load(current); }
    catch (e) { root.classList.remove('recap-busy'); mount(root, controls(null), h('p', { class: 'dim settings-copy' }, e.message)); return; }
    finally { shown = true; }
    lastData = data;
    if (data.recap.empty) { root.classList.remove('recap-busy'); mount(root, controls(data), h('p', { class: 'dim settings-copy' }, `Nothing watched in ${data.year}${data.person ? ` by ${nameFor(data)}` : ''} yet.`)); return; }
    try { if (document.fonts && document.fonts.ready) await document.fonts.ready; } catch { /* draw anyway */ }
    pics = pictures(data);
    await pics.ready();
    if (lastData !== data) return; // a newer year or person was picked meanwhile
    root.classList.remove('recap-busy');
    paint(data);
    if (autoPlay) { autoPlay = false; playShow(data, pics, { shape: pickRecapView(storedView(), narrowNow()) }); }
  };
  // Draws the picture in this device's shape and lays everything out.
  function paint(data) {
    const view = pickRecapView(storedView(), narrowNow());
    root.classList.toggle('recap-view-hex', view === 'hex');
    root.classList.toggle('recap-view-box', view === 'box');
    root.classList.toggle('recap-format-story', format === 'story');
    const pic = pics.canvas(view, format);
    const alt = summaryText(data);
    const img = h('img', { class: 'recap-card', src: pic.url, alt, width: String(pic.canvas.width), height: String(pic.canvas.height) });
    const full = () => openViewer({ src: pic.url, alt, title: `${data.year} in review`, actions: [h('button', { type: 'button', class: 'rv-btn rv-text', onclick: quietly(() => pics.save(view, format)) }, 'Save')] });
    const opener = h('button', { type: 'button', class: 'recap-card-open', 'aria-label': `Open the ${format} full screen`, title: 'Open full screen', onclick: full }, img, h('span', { class: 'recap-card-zoom', 'aria-hidden': 'true', html: EXPAND_ICON }));
    const save = h('button', { class: 'btn sm primary', onclick: quietly(() => pics.save(view, format)) }, format === 'story' ? 'Save story' : 'Save picture');
    const share = canShareFiles() ? h('button', { class: 'btn sm', onclick: quietly(() => pics.share(view, format)) }, 'Share…') : null;
    mount(root, controls(data, view),
      h('div', { class: 'recap-layout' },
        h('div', { class: 'recap-picture' }, opener, h('div', { class: 'recap-actions' }, save, share)),
        details(data),
        monthChart(data, pics.colors)));
  }
  const seg = (cls, label, items, active, onPick) => h('div', { class: `view-toggle ${cls}`, role: 'group', 'aria-label': label },
    ...items.map(([v, text]) => h('button', { type: 'button', class: `view-seg ${active === v ? 'active' : ''}`, 'aria-pressed': active === v ? 'true' : 'false', onclick: () => { if (active !== v) onPick(v); } }, text)));
  function controls(data, view = null) {
    const yearSel = h('select', { class: 'input', 'aria-label': 'Year', onchange: () => { current = { ...current, year: Number(yearSel.value) }; draw(); } },
      ...[thisYear, thisYear - 1, thisYear - 2].map((y) => h('option', { value: String(y), selected: y === current.year ? 'selected' : null }, `${y}${soFar(y) ? ' so far' : ''}`)));
    let personSel = null;
    if (data && data.canPick) {
      const chosen = data.person ? data.person.id : 'all';
      const mine = data.me && data.me.id;
      personSel = h('select', { class: 'input', 'aria-label': 'Whose year', onchange: () => { current = { ...current, user: personSel.value }; draw(); } },
        h('option', { value: 'all', selected: chosen === 'all' ? 'selected' : null }, 'Everyone'),
        ...(data.people || []).map((p) => h('option', { value: p.id, selected: p.id === chosen ? 'selected' : null }, `${showcaseEnabled() ? fakeName(p.name) : p.name}${p.id === mine ? ' (you)' : ''} · ${fmtHours(p.seconds, { short: true })}`)));
    }
    const ok = data && !data.recap.empty && view;
    return h('div', { class: 'recap-controls' }, yearSel, personSel,
      data ? h('span', { class: 'dim recap-source', style: { fontSize: '12px' } }, `From ${data.source}${data.canPick ? '. Only admins can pick other people.' : '.'}`) : null,
      ok ? h('div', { class: 'recap-switches' },
        h('button', { type: 'button', class: 'btn sm primary recap-play', onclick: () => playShow(data, pics, { shape: view }) }, 'Play the year'),
        // Picture or story: what's shown, saved and shared.
        seg('recap-format-toggle', 'Picture or story', [['picture', 'Picture'], ['story', 'Story']], format, (v) => { format = v; paint(lastData); }),
        // Hex | Box, like the app's other view switches. The choice stays on this device.
        seg('recap-view-toggle', 'Shape of the picture', [['hex', 'Hex'], ['box', 'Box']], view, (v) => { try { localStorage.setItem(RECAP_VIEW_KEY, v); } catch { /* this visit only */ } paint(lastData); })) : null);
  }
  // Without a choice made here, follow the screen size if the window changes.
  try {
    const mq = window.matchMedia(RECAP_NARROW);
    const onWidth = () => {
      if (!root.isConnected) { mq.removeEventListener('change', onWidth); return; }
      if (!storedView() && lastData && !lastData.recap.empty && pics) paint(lastData);
    };
    mq.addEventListener('change', onWidth);
  } catch { /* no matchMedia */ }
  draw();
  return root;
}

export function openRecap(ctx, opts = {}) {
  const body = h('div', { class: 'recap-modal' });
  openModal({ title: 'Year in review', body, overlayClass: 'recap-overlay' }); // wider than other dialogs, for the picture
  renderRecap(body, ctx, opts);
}

// Plays the slideshow straight away (from Home or Settings).
export async function playRecap(ctx, { year = recapYear(), user = null } = {}) {
  try {
    const data = await load({ year, user });
    if (data.recap.empty) { toast(`Nothing watched in ${data.year} yet.`, 'info'); return; }
    try { if (document.fonts && document.fonts.ready) await document.fonts.ready; } catch { /* go on */ }
    const pics = pictures(data);
    pics.ready(); // the posters load while the first cards play
    playShow(data, pics, { shape: pickRecapView(storedView(), narrowNow()) });
  } catch (e) { toast(e.message, 'error'); }
}

// A link like #/home?recap=2026&play=1 (from the December notification).
export function openRecapFromLink(ctx) {
  const p = (ctx && ctx.params) || {};
  if (!p.recap || !recapAvailable(ctx.state)) return false;
  const y = Number(p.recap); const now = new Date().getFullYear();
  const year = Number.isInteger(y) && y >= 2008 && y <= now ? y : recapYear();
  const play = p.play === '1';
  try { ctx.setParams({ recap: null, play: null }); } catch { /* keep going */ }
  openRecap(ctx, { year, play });
  return true;
}

// Home, in December and January.
export function recapBanner(ctx) {
  const state = ctx && ctx.state;
  if (!recapAvailable(state) || !recapSeason()) return null;
  const year = recapYear();
  try { if (localStorage.getItem(HIDE_KEY(year)) === '1') return null; } catch { /* show it */ }
  const signedIn = !!(state.config.auth && state.config.auth.user);
  const card = h('div', { class: 'card recap-banner' },
    h('div', { class: 'recap-banner-text' }, h('div', { class: 'recap-banner-title' }, signedIn ? `Your ${year} in review is ready` : `${year} in review is ready`),
      h('div', { class: 'dim', style: { fontSize: '13px' } }, 'Hours watched, top shows and films, your busiest night, and a picture to share.')),
    h('div', { class: 'recap-banner-actions' },
      h('button', { class: 'btn sm primary', onclick: () => playRecap(ctx, { year }) }, 'Play'),
      h('button', { class: 'btn sm', onclick: () => openRecap(ctx, { year }) }, 'Open'),
      h('button', { class: 'btn sm', onclick: () => { try { localStorage.setItem(HIDE_KEY(year), '1'); } catch { /* ignore */ } card.remove(); } }, 'Hide')));
  return card;
}

// Settings → You.
export function recapSettingsCard(ctx) {
  const year = recapYear();
  return h('div', { class: 'card' },
    h('p', { class: 'dim settings-copy', style: { marginTop: 0 } }, 'Your year of watching from Tautulli: hours, top shows and films, your busiest night, what you rewatched, and a picture or story you can save or share. Admins can look at anyone, or everyone together.'),
    h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
      h('button', { class: 'btn sm primary', onclick: () => openRecap(ctx, { year }) }, `Open ${year} ${soFar(year) ? 'so far' : 'in review'}`),
      h('button', { class: 'btn sm', onclick: () => playRecap(ctx, { year }) }, 'Play the year')));
}
