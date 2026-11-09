// Year in review: numbers and words (no page or canvas code, so it can be
// tested on its own). Used by the dialog, the picture and the slideshow.
import { showcaseEnabled, fakeName } from './showcase.js';

export const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export const recapSeason = (d = new Date()) => d.getMonth() === 11 || d.getMonth() === 0;
// December shows this year, January last year, other months this year so far.
export const recapYear = (d = new Date()) => (d.getMonth() === 0 ? d.getFullYear() - 1 : d.getFullYear());
export const soFar = (year, d = new Date()) => year === d.getFullYear() && d.getMonth() < 11;

export function fmtHours(sec, { short = false } = {}) {
  const s = Math.max(0, Number(sec) || 0);
  if (s < 3600) { const m = Math.max(1, Math.round(s / 60)); return short ? `${m} min` : `${m} ${m === 1 ? 'minute' : 'minutes'}`; }
  const hrs = s / 3600;
  const n = hrs < 10 ? Math.round(hrs * 10) / 10 : Math.round(hrs);
  return short ? `${n.toLocaleString()} h` : `${n.toLocaleString()} ${n === 1 ? 'hour' : 'hours'}`;
}
// [number, unit] for the big figure on the picture.
export function bigNumber(sec) {
  const s = Math.max(0, Number(sec) || 0);
  if (s < 3600) { const m = Math.round(s / 60); return [String(m), m === 1 ? 'minute' : 'minutes']; }
  const hrs = s / 3600; const n = hrs < 10 ? Math.round(hrs * 10) / 10 : Math.round(hrs);
  return [n.toLocaleString(), n === 1 ? 'hour' : 'hours'];
}
// "Sat 14 Jun" for a YYYY-MM-DD date.
export function fmtDay(ymd) {
  const [y, m, d] = String(ymd || '').split('-').map(Number);
  if (!y || !m || !d) return '';
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}
export const hourLabel = (hr) => new Date(2000, 0, 1, hr).toLocaleTimeString([], { hour: 'numeric' });
export const monthName = (i, style = 'long') => new Date(2000, i, 1).toLocaleDateString(undefined, { month: style });
export const plural = (n, one, many = `${one}s`) => `${Number(n).toLocaleString()} ${n === 1 ? one : many}`;

export const nameFor = (data) => {
  const n = data.person ? data.person.name : 'Everyone';
  return data.person && showcaseEnabled() ? fakeName(n) : n;
};

// The line under the hours: plays, days, films, shows (and people).
export function totalsLine(data) {
  const t = data.recap.totals;
  const bits = [plural(t.plays, 'play'), plural(t.days, 'day')];
  if (t.films) bits.push(plural(t.films, 'film'));
  if (t.shows) bits.push(plural(t.shows, 'show'));
  if (!data.person && t.people) bits.push(plural(t.people, 'person', 'people'));
  return bits;
}

// Compared with last year: { dir: 'up' | 'down' | 'same', short, long }, or
// null when there's nothing to compare with.
export function compareText(recap) {
  const c = recap && recap.compare;
  if (!c || !(c.seconds > 0)) return null;
  const delta = recap.totals.seconds - c.seconds;
  const when = c.toDate ? `this time in ${c.year}` : String(c.year);
  const pct = Math.round((delta / c.seconds) * 100);
  if (Math.abs(delta) < Math.max(3600, c.seconds * 0.03)) return { dir: 'same', delta, pct: 0, short: `About the same as ${when}`, long: `About the same as ${when} (${fmtHours(c.seconds)})` };
  const word = delta > 0 ? 'more' : 'less';
  const amount = fmtHours(Math.abs(delta));
  return { dir: delta > 0 ? 'up' : 'down', delta, pct, short: `${amount} ${word} than ${when}`, long: `${amount} ${word} than ${when} (${fmtHours(c.seconds)} then, ${pct > 0 ? '+' : ''}${pct}%)` };
}
export const compareArrow = (dir) => (dir === 'up' ? '▲' : dir === 'down' ? '▼' : '●');

// The three stats in the honeycomb at the bottom of the picture: [label, value, line under].
export function statTiles(r) {
  const tiles = [];
  if (r.busiest) tiles.push([r.busiest.night ? 'Busiest night' : 'Busiest day', fmtDay(r.busiest.date), fmtHours(r.busiest.seconds)]);
  if (r.rewatched.film) tiles.push(['Most rewatched', r.rewatched.film.title, `${r.rewatched.film.times} times`]);
  else if (r.rewatched.episode) tiles.push(['Most rewatched', `${r.rewatched.episode.show} ${r.rewatched.episode.code}`.trim(), `${r.rewatched.episode.times} times`]);
  else if (r.binge) tiles.push(['Longest binge', r.binge.show, `${r.binge.episodes} episodes`]);
  if (r.streak) tiles.push(['Longest streak', `${r.streak.days} days`, 'in a row']);
  else if (r.topWeekday != null) tiles.push(['Favourite day', WEEKDAY_NAMES[r.topWeekday], '']);
  return tiles.slice(0, 3);
}

// The slideshow's cards, in order; only the ones there's something to show for.
export function slidesFor(data) {
  const r = data.recap;
  const out = ['intro', 'hours'];
  if (r.topShows.length) out.push('shows');
  if (r.topFilms.length) out.push('films');
  if ((r.months || []).some((s) => s > 0)) out.push('months');
  if (r.busiest) out.push('busiest');
  if (r.topWeekday != null) out.push('when');
  if (r.rewatched.film || r.rewatched.episode) out.push('rewatched');
  if (r.streak || r.binge) out.push('streak');
  if ((r.totals.musicSeconds || 0) >= 3600) out.push('music');
  out.push('outro');
  return out;
}

// ---- month by month: a tower of hexagons for each month ----
export const TOWER = Object.freeze({ cells: 6, rr: 16, gap: 3 });

// How each month's tower is built. The busiest month gets the full tower;
// the others get as many hexagons as their share of it, the top one filled
// part of the way. Months still to come this year are marked as such.
export function monthTowers(months, { year, now = new Date(), cells = TOWER.cells } = {}) {
  const hours = Array.from({ length: 12 }, (_, i) => Math.max(0, Number((months || [])[i]) || 0) / 3600);
  const thisYear = now.getFullYear();
  const lastMonth = year === thisYear ? now.getMonth() : year > thisYear ? -1 : 11;
  const peak = Math.max(0, ...hours);
  const unit = peak > 0 ? peak / cells : 0; // hours one hexagon stands for
  const total = hours.reduce((a, b) => a + b, 0);
  const peakIdx = peak > 0 ? hours.indexOf(peak) : -1;
  return {
    unit, total, peakIdx, cells,
    months: hours.map((hrs, i) => {
      const base = { i, hours: hrs, share: total ? hrs / total : 0, peak: i === peakIdx, full: 0, part: 0 };
      if (i > lastMonth) return { ...base, state: 'future' };
      if (hrs <= 0) return { ...base, state: 'empty' };
      const exact = hrs / unit;
      let full = Math.min(cells, Math.floor(exact + 1e-9)); let part = full >= cells ? 0 : exact - full;
      if (full > 0 && part < 0.12) part = 0; // a sliver isn't worth another hexagon
      if (full === 0) part = Math.max(part, 0.2); // anything watched shows
      return { ...base, full, part, state: year === thisYear && i === lastMonth ? 'current' : 'past' };
    }),
  };
}

// "about 15 hours" for the legend.
export function unitText(hours) {
  if (!(hours > 0)) return '';
  if (hours < 1) return `about ${Math.max(1, Math.round(hours * 60))} minutes`;
  const n = hours < 10 ? Math.round(hours * 2) / 2 : Math.round(hours);
  return `about ${n.toLocaleString()} ${n === 1 ? 'hour' : 'hours'}`;
}

// "Foundation 12 h · Severance 8 h" for a month's top titles.
export function monthTopsText(entry) {
  if (!entry || !entry.top || !entry.top.length) return '';
  return entry.top.map((x) => `${x.title} ${fmtHours(x.seconds, { short: true })}`).join(' · ');
}

export function summaryText(data) {
  const r = data.recap;
  const parts = [`${data.year} ${soFar(data.year) ? 'so far' : 'in review'} for ${nameFor(data)}: ${fmtHours(r.totals.seconds)} watched over ${r.totals.plays} plays.`];
  const cmp = compareText(r);
  if (cmp) parts.push(`${cmp.short}.`);
  if (r.topShows[0]) parts.push(`Top show: ${r.topShows[0].title}.`);
  if (r.topFilms[0]) parts.push(`Top film: ${r.topFilms[0].title}.`);
  return parts.join(' ');
}
