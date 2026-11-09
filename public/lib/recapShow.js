// Year in review as a tap-through slideshow: full-screen cards, one part of
// the year at a time, with progress bars across the top. Tap the right side
// (or swipe left, or press →) for the next card, the left side (or ←) to go
// back, hold to pause, swipe down or press Escape to close. With reduced
// motion turned on, cards don't move or advance on their own.
import { h, mount, registerOverlay, closeOverlay } from './ui.js';
import { slidesFor, fmtHours, fmtDay, hourLabel, monthName, soFar, nameFor, compareText, compareArrow, plural, monthTowers, unitText, TOWER, WEEKDAY_NAMES } from './recapText.js';
import { towerSvg, posterSrc } from './recapDraw.js';

export const SLIDE_MS = 6500;
const INTRO_MS = 4500;
export const reducedMotion = () => { try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch { return false; } };

// Words that change with whose year it is.
function voice(data) {
  const you = !!data.person;
  return {
    you,
    watched: you ? 'You watched' : 'Everyone watched',
    top: (what) => (you ? `Your top ${what}` : `The top ${what}`),
    your: you ? 'Your' : 'The',
  };
}

const counter = (target, { decimals = 0 } = {}) => {
  const el = h('span', { class: 'rs-count' }, (0).toFixed(decimals));
  el.run = () => {
    if (reducedMotion()) { el.textContent = Number(target).toLocaleString(undefined, { maximumFractionDigits: decimals, minimumFractionDigits: decimals }); return; }
    const t0 = performance.now(); const dur = 1300;
    const tick = (now) => {
      const p = Math.min(1, (now - t0) / dur); const eased = 1 - (1 - p) ** 3;
      el.textContent = (target * eased).toLocaleString(undefined, { maximumFractionDigits: decimals, minimumFractionDigits: decimals });
      if (p < 1 && el.isConnected) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
  return el;
};
const posterEl = (url, cls = 'rs-poster', w = 500) => (url ? h('img', { class: cls, src: posterSrc(url, w), alt: '', loading: 'eager', decoding: 'async' }) : null);
const step = (i, ...kids) => h('div', { class: 'rs-in', style: { '--i': String(i) } }, ...kids);

function slideContent(kind, data, ctx) {
  const r = data.recap; const v = voice(data); const t = r.totals;
  switch (kind) {
    case 'intro':
      return { label: `${data.year} ${soFar(data.year) ? 'so far' : 'in review'}`, el: h('div', { class: 'rs-slide rs-intro' },
        step(0, h('div', { class: 'rs-logo', 'aria-hidden': 'true' })),
        step(1, h('div', { class: 'rs-kicker' }, 'Arr Command Center')),
        step(2, h('div', { class: 'rs-year' }, String(data.year))),
        step(3, h('div', { class: 'rs-sub' }, soFar(data.year) ? 'so far' : 'in review')),
        step(4, h('div', { class: 'rs-name' }, data.person ? `for ${nameFor(data)}` : 'for everyone on the server'))) };
    case 'hours': {
      const hrs = t.seconds / 3600; const big = hrs >= 10 ? Math.round(hrs) : Math.round(hrs * 10) / 10;
      const num = counter(big, { decimals: hrs >= 10 ? 0 : 1 }); ctx.onShow.push(() => num.run());
      const cmp = compareText(r);
      return { label: `${v.watched} ${fmtHours(t.seconds)}`, el: h('div', { class: 'rs-slide' },
        step(0, h('div', { class: 'rs-kicker' }, v.watched)),
        step(1, h('div', { class: 'rs-huge' }, num)),
        step(2, h('div', { class: 'rs-sub' }, big === 1 ? 'hour' : 'hours')),
        step(3, h('div', { class: 'rs-line' }, hrs >= 24 ? `That's ${(hrs / 24).toLocaleString(undefined, { maximumFractionDigits: 1 })} days of watching` : `Across ${plural(t.days, 'day')}`)),
        step(4, h('div', { class: 'rs-chips' }, h('span', { class: 'rs-chip' }, plural(t.plays, 'play')), h('span', { class: 'rs-chip' }, plural(t.days, 'day')), t.films ? h('span', { class: 'rs-chip' }, plural(t.films, 'film')) : null, t.shows ? h('span', { class: 'rs-chip' }, plural(t.shows, 'show')) : null)),
        cmp ? step(5, h('div', { class: `rs-compare rs-${cmp.dir}` }, h('span', { 'aria-hidden': 'true' }, compareArrow(cmp.dir)), ` ${cmp.short}`)) : null) };
    }
    case 'shows': case 'films': {
      const list = kind === 'shows' ? r.topShows : r.topFilms; const lead = list[0];
      const what = kind === 'shows' ? 'show' : 'film';
      const detail = kind === 'shows' ? `${fmtHours(lead.seconds)} · ${plural(lead.episodes, 'episode')}` : `${fmtHours(lead.seconds)} · ${lead.plays === 1 ? 'watched once' : `watched ${lead.plays} times`}`;
      const max = Math.max(1, ...list.map((x) => x.seconds));
      return { label: `${v.top(what)}: ${lead.title}`, backdrop: lead.poster, el: h('div', { class: 'rs-slide' },
        step(0, h('div', { class: 'rs-kicker' }, v.top(what))),
        lead.poster ? step(1, h('div', { class: 'rs-poster-wrap' }, posterEl(lead.poster))) : null,
        step(2, h('div', { class: 'rs-title' }, lead.title)),
        step(3, h('div', { class: 'rs-line' }, detail)),
        list.length > 1 ? step(4, h('ol', { class: 'rs-list', start: '2' }, ...list.slice(1, 5).map((x) => h('li', {},
          posterEl(x.poster, 'rs-thumb', 200) || h('span', { class: 'rs-thumb rs-thumb-none' }),
          h('span', { class: 'rs-li-main' }, h('span', { class: 'rs-li-title' }, x.title), h('span', { class: 'rs-bar', style: { '--w': `${Math.max(6, Math.round((x.seconds / max) * 100))}%` } })),
          h('span', { class: 'rs-li-val' }, fmtHours(x.seconds, { short: true })))))) : null) };
    }
    case 'months': {
      const tw = monthTowers(r.months, { year: data.year }); const peak = tw.months[tw.peakIdx];
      const cells = tw.months.map((m) => h('div', { class: `rs-mcol ${m.state}${m.peak ? ' peak' : ''}` },
        h('span', { class: 'recap-tower', html: towerSvg(m, { ...TOWER, cells: tw.cells }, ctx.colors, `rs${ctx.uid}-${m.i}`) }),
        h('span', { class: 'rs-mname' }, monthName(m.i, 'short'))));
      const tops = peak && r.monthTops && r.monthTops[peak.i] && r.monthTops[peak.i].top.length ? r.monthTops[peak.i].top.map((x) => x.title).join(', ') : '';
      return { label: peak ? `Busiest month: ${monthName(peak.i)}` : 'Month by month', el: h('div', { class: 'rs-slide' },
        step(0, h('div', { class: 'rs-kicker' }, 'Month by month')),
        step(1, h('div', { class: 'rs-towers', role: 'img', 'aria-label': tw.months.map((m) => `${monthName(m.i)} ${fmtHours(m.hours * 3600, { short: true })}`).join(', ') }, ...cells)),
        peak ? step(2, h('div', { class: 'rs-title' }, monthName(peak.i))) : null,
        peak ? step(3, h('div', { class: 'rs-line' }, `${v.your} busiest month: ${fmtHours(peak.hours * 3600)}`)) : null,
        tops ? step(4, h('div', { class: 'rs-small' }, `Mostly ${tops}`)) : null,
        tw.unit ? step(5, h('div', { class: 'rs-small rs-dim' }, `Each hexagon is ${unitText(tw.unit)}`)) : null) };
    }
    case 'busiest': {
      const b = r.busiest;
      return { label: `${v.your} busiest ${b.night ? 'night' : 'day'}: ${fmtDay(b.date)}`, el: h('div', { class: 'rs-slide' },
        step(0, h('div', { class: 'rs-kicker' }, `${v.your} busiest ${b.night ? 'night' : 'day'}`)),
        step(1, h('div', { class: 'rs-title rs-xl' }, fmtDay(b.date))),
        step(2, h('div', { class: 'rs-line' }, `${fmtHours(b.seconds)} of watching`)),
        b.titles.length ? step(3, h('div', { class: 'rs-small' }, b.titles.join(' · '))) : null,
        r.binge ? step(4, h('div', { class: 'rs-card' }, h('div', { class: 'rs-card-k' }, 'Longest binge'), h('div', { class: 'rs-card-v' }, `${plural(r.binge.episodes, 'episode')} of ${r.binge.show}`), h('div', { class: 'rs-small rs-dim' }, fmtDay(r.binge.date)))) : null) };
    }
    case 'when': {
      const devices = r.devices.map((d) => d.name);
      return { label: `Mostly ${WEEKDAY_NAMES[r.topWeekday]}s around ${hourLabel(r.topHour)}`, el: h('div', { class: 'rs-slide' },
        step(0, h('div', { class: 'rs-kicker' }, v.you ? 'You watch most on' : 'Most watching happens on')),
        step(1, h('div', { class: 'rs-title rs-xl' }, `${WEEKDAY_NAMES[r.topWeekday]}s`)),
        r.topHour != null ? step(2, h('div', { class: 'rs-line' }, `around ${hourLabel(r.topHour)}`)) : null,
        devices.length ? step(3, h('div', { class: 'rs-chips' }, ...devices.map((d) => h('span', { class: 'rs-chip' }, d)))) : null) };
    }
    case 'rewatched': {
      const f = r.rewatched.film; const e = r.rewatched.episode;
      const lead = f ? { title: f.title, times: f.times, poster: f.poster } : { title: `${e.show} ${e.code}`.trim(), times: e.times, sub: e.title };
      return { label: `On repeat: ${lead.title}, ${lead.times} times`, backdrop: lead.poster, el: h('div', { class: 'rs-slide' },
        step(0, h('div', { class: 'rs-kicker' }, 'On repeat')),
        lead.poster ? step(1, h('div', { class: 'rs-poster-wrap rs-small-poster' }, posterEl(lead.poster))) : null,
        step(2, h('div', { class: 'rs-title' }, lead.title)),
        lead.sub ? step(3, h('div', { class: 'rs-small' }, `“${lead.sub}”`)) : null,
        step(4, h('div', { class: 'rs-huge rs-huge-sm' }, `${lead.times}×`)),
        f && e ? step(5, h('div', { class: 'rs-small rs-dim' }, `And ${e.show} ${e.code}, ${e.times} times`)) : null) };
    }
    case 'streak': {
      const s = r.streak;
      return { label: s ? `Longest streak: ${s.days} days` : `Longest binge: ${r.binge.episodes} episodes`, el: h('div', { class: 'rs-slide' },
        step(0, h('div', { class: 'rs-kicker' }, s ? `${v.your} longest streak` : `${v.your} longest binge`)),
        step(1, h('div', { class: 'rs-huge' }, String(s ? s.days : r.binge.episodes))),
        step(2, h('div', { class: 'rs-sub' }, s ? 'days in a row' : 'episodes in a day')),
        step(3, h('div', { class: 'rs-line' }, s ? `${fmtDay(s.from)} to ${fmtDay(s.to)}` : `${r.binge.show}, ${fmtDay(r.binge.date)}`))) };
    }
    case 'music':
      return { label: `And ${fmtHours(t.musicSeconds)} of music`, el: h('div', { class: 'rs-slide' },
        step(0, h('div', { class: 'rs-kicker' }, 'And some music')),
        step(1, h('div', { class: 'rs-title rs-xl' }, fmtHours(t.musicSeconds))),
        r.topArtists.length ? step(2, h('div', { class: 'rs-line' }, `Mostly ${r.topArtists.map((a) => a.title).join(', ')}`)) : null) };
    case 'outro': {
      const pic = h('div', { class: 'rs-picture' }, h('div', { class: 'dim' }, 'Making the picture…'));
      ctx.onShow.push(async () => {
        try {
          const p = await ctx.makePicture();
          mount(pic, h('img', { class: 'rs-pic', src: p.url, alt: p.alt }));
        } catch { mount(pic, null); }
      });
      const btn = (label, cls, fn) => h('button', { type: 'button', class: `rs-action ${cls}`, onclick: (e) => { e.stopPropagation(); fn(); } }, label);
      const buttons = [btn('Save picture', 'primary', () => ctx.save()), ctx.canShare() ? btn('Share…', '', () => ctx.share()) : null, btn('Watch again', '', () => ctx.go(0)), btn('Close', '', () => ctx.close())];
      return { label: 'That was your year', el: h('div', { class: 'rs-slide rs-outro' },
        step(0, h('div', { class: 'rs-kicker' }, v.you ? 'That was your year' : 'That was the year')),
        step(1, pic),
        step(2, h('div', { class: 'rs-actions' }, ...buttons))) };
    }
    default: return { label: '', el: h('div', { class: 'rs-slide' }) };
  }
}

// data: the /api/recap answer. makePicture() → { url, alt }; save(), share().
export function openRecapShow(data, { colors, makePicture, save, share, canShare = () => false, start = 0 } = {}) {
  const kinds = slidesFor(data);
  const uid = Math.random().toString(36).slice(2, 7);
  let index = -1; let timer = null; let started = 0; let remaining = 0; let paused = false; let holding = false;
  const bars = kinds.map(() => h('span', { class: 'rs-seg' }, h('span', { class: 'rs-fill' })));
  const progress = h('div', { class: 'rs-progress', 'aria-hidden': 'true' }, ...bars);
  const stage = h('div', { class: 'rs-stage', 'aria-live': 'polite' });
  const backdrop = h('div', { class: 'rs-backdrop', 'aria-hidden': 'true' });
  const PAUSE = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor"/></svg>';
  const PLAY = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" fill="currentColor"/></svg>';
  const pauseBtn = h('button', { type: 'button', class: 'rs-btn', 'aria-label': 'Pause', html: PAUSE, onclick: (e) => { e.stopPropagation(); setPaused(!paused); } });
  const prevBtn = h('button', { type: 'button', class: 'rs-btn rs-prev', 'aria-label': 'Previous', onclick: (e) => { e.stopPropagation(); go(index - 1); } }, '‹');
  const nextBtn = h('button', { type: 'button', class: 'rs-btn rs-next', 'aria-label': 'Next', onclick: (e) => { e.stopPropagation(); go(index + 1); } }, '›');
  const closeBtn = h('button', { type: 'button', class: 'rs-btn', 'aria-label': 'Close', onclick: (e) => { e.stopPropagation(); closeOverlay('recap-show'); } }, '×');
  const counterEl = h('span', { class: 'rs-counter' });
  const top = h('div', { class: 'rs-top' }, progress, h('div', { class: 'rs-toolbar' }, counterEl, h('span', { style: { flex: '1' } }), pauseBtn, closeBtn));
  // tabindex: a click on the card keeps focus here, so the arrow keys still work.
  const root = h('div', { class: 'recap-show', role: 'dialog', 'aria-modal': 'true', 'aria-label': `${data.year} in review`, tabindex: '-1' },
    h('div', { class: 'rs-bg', 'aria-hidden': 'true' }, h('span', { class: 'rs-hex rs-hex-a' }), h('span', { class: 'rs-hex rs-hex-b' }), h('span', { class: 'rs-hex rs-hex-c' })),
    backdrop, top, stage, prevBtn, nextBtn);
  if (colors) { root.style.setProperty('--rs-a', colors[0]); root.style.setProperty('--rs-b', colors[1]); root.style.setProperty('--rs-c', colors[2]); }
  const auto = !reducedMotion();
  root.classList.toggle('rs-still', !auto);

  const ctx = { colors, uid, onShow: [], makePicture, save: () => save && save(), share: () => share && share(), canShare, go: (i) => go(i), close: () => closeOverlay('recap-show') };
  const durationOf = (kind) => (kind === 'intro' ? INTRO_MS : SLIDE_MS);
  const clear = () => { if (timer) { clearTimeout(timer); timer = null; } };
  function schedule(ms) {
    clear();
    if (!auto || paused || holding || index >= kinds.length - 1) return;
    started = performance.now(); remaining = ms;
    timer = setTimeout(() => go(index + 1), ms);
  }
  function setPaused(p) {
    paused = p; root.classList.toggle('rs-paused', paused || holding);
    pauseBtn.innerHTML = paused ? PLAY : PAUSE; pauseBtn.setAttribute('aria-label', paused ? 'Play' : 'Pause');
    if (paused) { if (timer) { remaining -= performance.now() - started; clear(); } }
    else schedule(Math.max(400, remaining || durationOf(kinds[index])));
  }
  function go(i) {
    if (i < 0) i = 0;
    if (i >= kinds.length) { closeOverlay('recap-show'); return; }
    index = i; ctx.onShow = [];
    const { el, label, backdrop: bd } = slideContent(kinds[i], data, ctx);
    el.setAttribute('aria-label', label);
    mount(stage, el);
    backdrop.style.backgroundImage = bd ? `url("${posterSrc(bd, 300)}")` : '';
    backdrop.classList.toggle('on', !!bd);
    bars.forEach((b, k) => { b.classList.toggle('done', k < i); b.classList.toggle('now', k === i); b.style.setProperty('--ms', `${durationOf(kinds[k])}ms`); });
    counterEl.textContent = `${i + 1} of ${kinds.length}`;
    prevBtn.disabled = i === 0; nextBtn.disabled = i === kinds.length - 1;
    // Restart the bar's animation.
    const fill = bars[i].firstChild; fill.style.animation = 'none'; void fill.offsetWidth; fill.style.animation = '';
    for (const fn of ctx.onShow) { try { fn(); } catch { /* keep going */ } }
    remaining = durationOf(kinds[i]);
    schedule(remaining);
  }

  // Taps, holds and swipes on the card.
  let press = null;
  root.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button, a, input')) return;
    press = { x: e.clientX, y: e.clientY, t: performance.now(), hold: setTimeout(() => { holding = true; if (timer) { remaining -= performance.now() - started; clear(); } root.classList.add('rs-paused'); }, 240) };
  });
  // Moving the finger means a swipe, not a hold, however slow it is.
  root.addEventListener('pointermove', (e) => {
    if (press && !holding && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 12) clearTimeout(press.hold);
  });
  const release = (e) => {
    if (!press) return;
    const p = press; press = null; clearTimeout(p.hold);
    const held = holding;
    if (held) { holding = false; root.classList.toggle('rs-paused', paused); }
    const resume = () => { if (held) schedule(Math.max(400, remaining)); };
    if (e.type === 'pointercancel') { resume(); return; }
    const dx = e.clientX - p.x; const dy = e.clientY - p.y;
    if (dy > 90 && Math.abs(dy) > Math.abs(dx)) { closeOverlay('recap-show'); return; }
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) { go(index + (dx < 0 ? 1 : -1)); return; }
    if (held) { resume(); return; } // let go after holding: carry on with this card
    if (Math.hypot(dx, dy) < 12) go(index + (e.clientX < window.innerWidth * 0.3 ? -1 : 1));
  };
  root.addEventListener('pointerup', release); root.addEventListener('pointercancel', release);
  root.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); go(index + 1); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); go(index - 1); }
    else if (e.key === ' ' && !e.target.closest('button')) { e.preventDefault(); setPaused(!paused); }
  });
  const onVisibility = () => { if (document.hidden && !paused) setPaused(true); };
  document.addEventListener('visibilitychange', onVisibility);

  document.body.appendChild(root);
  document.documentElement.classList.add('recap-overlay-open');
  registerOverlay('recap-show', {
    container: root,
    close: () => { clear(); document.removeEventListener('visibilitychange', onVisibility); root.remove(); if (!document.querySelector('.recap-viewer')) document.documentElement.classList.remove('recap-overlay-open'); },
  });
  go(Math.max(0, Math.min(start, kinds.length - 1)));
  return { root, go, pause: () => setPaused(true), get index() { return index; }, kinds };
}
