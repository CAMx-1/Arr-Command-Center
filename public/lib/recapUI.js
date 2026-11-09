// Year in review: each person's year of watching from Tautulli, with a
// picture to save or share. On Home in December and January, in
// Settings → You any time, and as a tab on the Tautulli page.
import { h, mount, toast, openModal } from './ui.js';
import { api } from './api.js';
import { showcaseEnabled, fakeName } from './showcase.js';
import { isLocalMode } from './connections.js';

const HIDE_KEY = (y) => `acc:recap-hide:${y}`;
const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export const recapSeason = (d = new Date()) => d.getMonth() === 11 || d.getMonth() === 0;
// December shows this year, January last year, other months this year so far.
export const recapYear = (d = new Date()) => (d.getMonth() === 0 ? d.getFullYear() - 1 : d.getFullYear());
const soFar = (year, d = new Date()) => year === d.getFullYear() && d.getMonth() < 11;
export const recapAvailable = (state) => !!(state && state.config && state.config.recap) && !isLocalMode();

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
const hourLabel = (hr) => new Date(2000, 0, 1, hr).toLocaleTimeString([], { hour: 'numeric' });

function load({ year, user }) {
  const tz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { return ''; } })();
  const q = new URLSearchParams({ year: String(year), tz });
  if (user) q.set('user', user);
  return api.getJson(`/api/recap?${q}`);
}

const nameFor = (data) => {
  const n = data.person ? data.person.name : 'Everyone';
  return data.person && showcaseEnabled() ? fakeName(n) : n;
};

// ---- the picture: a hexagon, like the app's tiles ----
const SQ3 = Math.sqrt(3);
// A pointy-top hexagon, r from the centre to a corner, with room around it
// for the glow. The corners outside the hexagon are see-through.
export const CARD = Object.freeze({ r: 665, pad: 40, width: Math.ceil(SQ3 * 665 + 80), height: 2 * 665 + 80 });

// Half the hexagon's width at `y` (0 = its top corner, 2r = its bottom corner).
export function hexHalfWidth(y, r = CARD.r) {
  const half = (SQ3 * r) / 2;
  if (!(y > 0 && y < 2 * r)) return 0;
  if (y < r / 2) return half * (y / (r / 2));
  if (y > 1.5 * r) return half * ((2 * r - y) / (r / 2));
  return half;
}

// '#6366f1', '#abc' or 'rgb(…)' → [r, g, b].
export function rgbOf(color, fallback = [99, 102, 241]) {
  const s = String(color || '').trim();
  let m = /^#([0-9a-f]{6})$/i.exec(s);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  m = /^#([0-9a-f]{3})$/i.exec(s);
  if (m) return [...m[1]].map((ch) => parseInt(ch + ch, 16));
  m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(s);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  return fallback;
}
const rgba = (rgb, a = 1) => `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${a})`;
const mixRgb = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
// January to December run through the three accent colours.
export function monthColor(i, colors) {
  const [a, b, c] = [0, 1, 2].map((k) => rgbOf(colors && colors[k]));
  const t = Math.max(0, Math.min(1, i / 11));
  return t < 0.5 ? mixRgb(a, b, t * 2) : mixRgb(b, c, (t - 0.5) * 2);
}

function fit(c, text, max) {
  const t = String(text || '');
  if (c.measureText(t).width <= max) return t;
  let lo = 0; let hi = t.length;
  while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (c.measureText(`${t.slice(0, mid)}…`).width <= max) lo = mid; else hi = mid - 1; }
  return `${t.slice(0, lo).trimEnd()}…`;
}
// Up to `lines` lines that fit `max`; the last one is shortened with … if needed.
export function wrapLines(c, text, max, lines = 2) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const out = []; let line = '';
  for (let i = 0; i < words.length; i += 1) {
    const test = line ? `${line} ${words[i]}` : words[i];
    if (c.measureText(test).width <= max) { line = test; continue; }
    if (line) out.push(line);
    line = words[i];
    if (out.length === lines - 1) { line = words.slice(i).join(' '); break; }
  }
  if (line) out.push(line);
  return out.slice(0, lines).map((l) => fit(c, l, max));
}

// Pointy-top hexagon around (x, y), rr from the centre to a corner.
function hexPath(c, x, y, rr) {
  c.beginPath();
  for (let i = 0; i < 6; i += 1) { const a = (Math.PI / 3) * i - Math.PI / 2; c.lineTo(x + rr * Math.cos(a), y + rr * Math.sin(a)); }
  c.closePath();
}
// A wide hexagon with pointed left and right ends, like the app's buttons.
function pillPath(c, x, y, w, hgt) {
  const e = hgt * 0.3;
  c.beginPath(); c.moveTo(x, y + hgt / 2); c.lineTo(x + e, y); c.lineTo(x + w - e, y); c.lineTo(x + w, y + hgt / 2); c.lineTo(x + w - e, y + hgt); c.lineTo(x + e, y + hgt); c.closePath();
}

// The three stats in the honeycomb at the bottom: [label, value, line under].
function statTiles(r) {
  const tiles = [];
  if (r.busiest) tiles.push([r.busiest.night ? 'Busiest night' : 'Busiest day', fmtDay(r.busiest.date), fmtHours(r.busiest.seconds)]);
  if (r.rewatched.film) tiles.push(['Most rewatched', r.rewatched.film.title, `${r.rewatched.film.times} times`]);
  else if (r.rewatched.episode) tiles.push(['Most rewatched', `${r.rewatched.episode.show} ${r.rewatched.episode.code}`.trim(), `${r.rewatched.episode.times} times`]);
  else if (r.binge) tiles.push(['Longest binge', r.binge.show, `${r.binge.episodes} episodes`]);
  if (r.streak) tiles.push(['Longest streak', `${r.streak.days} days`, 'in a row']);
  else if (r.topWeekday != null) tiles.push(['Favourite day', WEEKDAY_NAMES[r.topWeekday], '']);
  return tiles.slice(0, 3);
}

function drawHexCard(canvas, data, { colors, font }) {
  const R = CARD.r; const W = CARD.width; const H = CARD.height;
  canvas.width = W; canvas.height = H;
  const c = canvas.getContext('2d');
  const rec = data.recap; const t = rec.totals;
  const [c0, c1, c2] = [0, 1, 2].map((k) => rgbOf(colors[k]));
  const cx = W / 2; const top = CARD.pad; const cy = top + R;
  const Y = (rel) => top + rel; // positions below are measured from the top corner
  const room = (rel, margin) => Math.max(0, 2 * (hexHalfWidth(rel) - margin));
  const diag = (a = 1) => { const g = c.createLinearGradient(cx - R, top, cx + R, top + 2 * R); g.addColorStop(0, rgba(c0, a)); g.addColorStop(0.55, rgba(c1, a)); g.addColorStop(1, rgba(c2, a)); return g; };
  const text = (str, x, y, { size = 32, weight = 600, alpha = 1, align = 'center', max = null, fill = null } = {}) => {
    c.font = `${weight} ${size}px ${font}`; c.fillStyle = fill || `rgba(255,255,255,${alpha})`; c.textAlign = align; c.textBaseline = 'alphabetic';
    const out = max ? fit(c, str, max) : String(str);
    c.fillText(out, x, y);
    return c.measureText(out).width;
  };
  const spaced = (str, y, { size, weight, alpha, spacing }) => {
    c.font = `${weight} ${size}px ${font}`; c.fillStyle = `rgba(255,255,255,${alpha})`; c.textAlign = 'left'; c.textBaseline = 'alphabetic';
    const chars = [...String(str)]; const widths = chars.map((ch) => c.measureText(ch).width);
    let x = cx - (widths.reduce((a, b) => a + b, 0) + spacing * (chars.length - 1)) / 2;
    chars.forEach((ch, i) => { c.fillText(ch, x, y); x += widths[i] + spacing; });
  };

  // The glow around the edge, then the face over it.
  c.save(); hexPath(c, cx, cy, R); c.shadowColor = rgba(c1, 0.75); c.shadowBlur = 38; c.fillStyle = rgba(c1); c.fill(); c.restore();
  c.save(); hexPath(c, cx, cy, R); c.clip();
  c.fillStyle = diag(); c.fillRect(0, 0, W, H);
  c.fillStyle = 'rgba(10, 12, 22, 0.66)'; c.fillRect(0, 0, W, H);
  const light = c.createRadialGradient(cx, Y(250), 10, cx, Y(250), 470);
  light.addColorStop(0, rgba(c1, 0.42)); light.addColorStop(1, rgba(c1, 0));
  c.fillStyle = light; c.fillRect(0, 0, W, H);
  // A faint honeycomb across the face.
  c.lineWidth = 1.5; c.strokeStyle = 'rgba(255, 255, 255, 0.045)';
  const s = 46; const dx = SQ3 * s; const dy = 1.5 * s;
  for (let row = 0, y = top - s; y < H + s; row += 1, y += dy) {
    for (let x = (row % 2 ? dx / 2 : 0) - dx; x < W + dx; x += dx) { hexPath(c, x, y, s - 2); c.stroke(); }
  }
  c.restore();
  // The edge, and a thin line just inside it.
  hexPath(c, cx, cy, R - 3); c.lineWidth = 6; c.strokeStyle = diag(); c.stroke();
  hexPath(c, cx, cy, R - 24); c.lineWidth = 2; c.strokeStyle = 'rgba(255, 255, 255, 0.10)'; c.stroke();

  // Top corner: a small glowing hexagon, the name, the year.
  c.save(); hexPath(c, cx, Y(96), 30); c.shadowColor = rgba(c1, 0.85); c.shadowBlur = 24; c.fillStyle = diag(); c.fill(); c.restore();
  hexPath(c, cx, Y(96), 14); c.fillStyle = 'rgba(10, 12, 22, 0.6)'; c.fill();
  spaced('ARR COMMAND CENTER', Y(176), { size: 21, weight: 700, alpha: 0.66, spacing: 3 });
  const yearFill = c.createLinearGradient(0, Y(205), 0, Y(330)); yearFill.addColorStop(0, '#ffffff'); yearFill.addColorStop(1, rgba(mixRgb([255, 255, 255], c2, 0.4)));
  text(String(data.year), cx, Y(330), { size: 168, weight: 800, fill: yearFill });
  text(soFar(data.year) ? 'so far' : 'in review', cx, Y(398), { size: 50, weight: 600, alpha: 0.94 });
  text(nameFor(data), cx, Y(448), { size: 32, weight: 600, alpha: 0.72, max: room(448, 130) });

  // Hours, in a wide hexagon.
  const [num, unit] = bigNumber(t.seconds);
  c.font = `800 100px ${font}`; const nw = c.measureText(num).width;
  c.font = `600 34px ${font}`; const uw = c.measureText(`${unit} watched`).width;
  const bh = 128; const bTop = Y(476);
  const bw = Math.min(room(540, 70), Math.max(560, nw + 20 + uw + 2 * (bh * 0.3 + 46)));
  pillPath(c, cx - bw / 2, bTop, bw, bh);
  const pill = c.createLinearGradient(cx - bw / 2, 0, cx + bw / 2, 0); pill.addColorStop(0, 'rgba(255, 255, 255, 0.16)'); pill.addColorStop(1, 'rgba(255, 255, 255, 0.06)');
  c.fillStyle = pill; c.fill(); c.lineWidth = 2; c.strokeStyle = 'rgba(255, 255, 255, 0.3)'; c.stroke();
  const x0 = cx - (nw + 20 + uw) / 2;
  text(num, x0, bTop + bh / 2 + 36, { size: 100, weight: 800, align: 'left' });
  text(`${unit} watched`, x0 + nw + 20, bTop + bh / 2 + 36, { size: 34, weight: 600, alpha: 0.9, align: 'left' });
  const bits = [`${t.plays.toLocaleString()} ${t.plays === 1 ? 'play' : 'plays'}`, `${t.days} ${t.days === 1 ? 'day' : 'days'}`];
  if (t.films) bits.push(`${t.films} ${t.films === 1 ? 'film' : 'films'}`);
  if (t.shows) bits.push(`${t.shows} ${t.shows === 1 ? 'show' : 'shows'}`);
  if (!data.person && t.people) bits.push(`${t.people} ${t.people === 1 ? 'person' : 'people'}`);
  text(bits.join('  ·  '), cx, Y(650), { size: 26, weight: 500, alpha: 0.78, max: room(650, 100) });

  // Top shows and films, side by side across the widest part.
  const colW = 450; const gutter = 40;
  const list = (title, items, x, empty) => {
    text(title.toUpperCase(), x, Y(712), { size: 20, weight: 700, alpha: 0.6, align: 'left' });
    if (!items.length) { text(empty, x, Y(760), { size: 26, weight: 500, alpha: 0.55, align: 'left' }); return; }
    items.slice(0, 5).forEach((it, i) => {
      const y = Y(760 + i * 42);
      text(String(i + 1), x, y, { size: 26, weight: 800, alpha: 0.45, align: 'left' });
      c.font = `500 24px ${font}`; const right = fmtHours(it.seconds, { short: true }); const rw = c.measureText(right).width;
      text(it.title, x + 36, y, { size: 28, weight: 600, align: 'left', max: colW - 36 - rw - 14 });
      text(right, x + colW, y, { size: 24, weight: 500, alpha: 0.7, align: 'right' });
    });
  };
  list('Top shows', rec.topShows, cx - gutter / 2 - colW, 'No shows this year');
  list('Top films', rec.topFilms, cx + gutter / 2, 'No films this year');

  // Bottom corner: the stats as a row of honeycomb cells.
  const tiles = statTiles(rec);
  const rt = 106; const tileY = Y(1076); const step = SQ3 * rt + 12;
  const xs = tiles.length === 3 ? [cx - step, cx, cx + step] : tiles.length === 2 ? [cx - step / 2, cx + step / 2] : [cx];
  tiles.forEach(([label, value, sub], i) => {
    const x = xs[i];
    hexPath(c, x, tileY, rt); c.fillStyle = 'rgba(255, 255, 255, 0.08)'; c.fill();
    hexPath(c, x, tileY, rt - 1.5); c.lineWidth = 3; c.strokeStyle = diag(0.9); c.stroke();
    // Text stays in the middle band, where the hexagon is widest.
    text(label.toUpperCase(), x, tileY - 40, { size: 14, weight: 700, alpha: 0.62, max: 150 });
    // Smaller type before cutting a long word ("Oppenheimer") short.
    let size = 27; let lines = [];
    for (const tryIt of [27, 25, 23, 21]) {
      size = tryIt; c.font = `700 ${size}px ${font}`;
      lines = wrapLines(c, value, 158, 2);
      if (!lines.some((l) => l.endsWith('…'))) break;
    }
    if (lines.length === 1) text(lines[0], x, tileY + 12, { size, weight: 700 });
    else { text(lines[0], x, tileY - 4, { size, weight: 700 }); text(lines[1], x, tileY + 27, { size, weight: 700 }); }
    if (sub) text(sub, x, tileY + 60, { size: 20, weight: 500, alpha: 0.8, max: 132 });
  });
  text(`From ${data.source || 'Tautulli'}`, cx, Y(1252), { size: 20, weight: 500, alpha: 0.5, max: room(1252, 40) });
  return canvas;
}

// The box version: a full rectangle (1080 × 1350, nothing see-through),
// easier to read on a phone. Same face and type as the hexagon.
export const BOX = Object.freeze({ width: 1080, height: 1350 });
function drawBoxCard(canvas, data, { colors, font }) {
  const W = BOX.width; const H = BOX.height; const L = 80; const R = W - 80;
  canvas.width = W; canvas.height = H;
  const c = canvas.getContext('2d');
  const rec = data.recap; const t = rec.totals;
  const [c0, c1, c2] = [0, 1, 2].map((k) => rgbOf(colors[k]));
  const diag = (a = 1) => { const g = c.createLinearGradient(0, 0, W, H); g.addColorStop(0, rgba(c0, a)); g.addColorStop(0.55, rgba(c1, a)); g.addColorStop(1, rgba(c2, a)); return g; };
  const text = (str, x, y, { size = 32, weight = 600, alpha = 1, align = 'left', max = null, fill = null } = {}) => {
    c.font = `${weight} ${size}px ${font}`; c.fillStyle = fill || `rgba(255,255,255,${alpha})`; c.textAlign = align; c.textBaseline = 'alphabetic';
    const out = max ? fit(c, str, max) : String(str);
    c.fillText(out, x, y);
    return c.measureText(out).width;
  };
  const box = (x, y, w, hgt, a = 0.08) => {
    c.beginPath();
    if (c.roundRect) c.roundRect(x, y, w, hgt, 28);
    else { const q = 28; c.moveTo(x + q, y); c.arcTo(x + w, y, x + w, y + hgt, q); c.arcTo(x + w, y + hgt, x, y + hgt, q); c.arcTo(x, y + hgt, x, y, q); c.arcTo(x, y, x + w, y, q); c.closePath(); } // Safari before 16
    c.fillStyle = `rgba(255,255,255,${a})`; c.fill();
  };
  // Face: the same gradient, light and honeycomb as the hexagon.
  c.fillStyle = diag(); c.fillRect(0, 0, W, H);
  c.fillStyle = 'rgba(10, 12, 22, 0.66)'; c.fillRect(0, 0, W, H);
  const light = c.createRadialGradient(300, 210, 10, 300, 210, 560);
  light.addColorStop(0, rgba(c1, 0.40)); light.addColorStop(1, rgba(c1, 0));
  c.fillStyle = light; c.fillRect(0, 0, W, H);
  c.lineWidth = 1.5; c.strokeStyle = 'rgba(255, 255, 255, 0.045)';
  const s = 46; const dx = SQ3 * s; const dy = 1.5 * s;
  for (let row = 0, y = -s; y < H + s; row += 1, y += dy) {
    for (let x = (row % 2 ? dx / 2 : 0) - dx; x < W + dx; x += dx) { hexPath(c, x, y, s - 2); c.stroke(); }
  }
  c.lineWidth = 3;
  for (const [x, y, rr, a] of [[940, 150, 130, 0.12], [1030, 360, 70, 0.09], [700, 60, 40, 0.07]]) { hexPath(c, x, y, rr); c.strokeStyle = `rgba(255,255,255,${a})`; c.stroke(); }
  c.save(); hexPath(c, 940, 150, 88); c.shadowColor = rgba(c1, 0.8); c.shadowBlur = 30; c.fillStyle = diag(0.55); c.fill(); c.restore();
  c.lineWidth = 6; c.strokeStyle = diag(); c.strokeRect(3, 3, W - 6, H - 6);

  text('ARR COMMAND CENTER', L, 100, { size: 24, weight: 700, alpha: 0.62 });
  const yearFill = c.createLinearGradient(0, 130, 0, 250); yearFill.addColorStop(0, '#ffffff'); yearFill.addColorStop(1, rgba(mixRgb([255, 255, 255], c2, 0.4)));
  text(String(data.year), L, 250, { size: 170, weight: 800, fill: yearFill });
  text(soFar(data.year) ? 'so far' : 'in review', L, 325, { size: 62, weight: 600, alpha: 0.94 });
  text(nameFor(data), L, 395, { size: 40, weight: 600, alpha: 0.75, max: R - L });

  box(L - 20, 430, R - L + 40, 190, 0.1);
  const [num, unit] = bigNumber(t.seconds);
  const numW = text(num, L + 10, 548, { size: 112, weight: 800 });
  text(`${unit} watched`, L + 10 + numW + 22, 548, { size: 40, weight: 600, alpha: 0.9 });
  const bits = [`${t.plays.toLocaleString()} ${t.plays === 1 ? 'play' : 'plays'}`, `${t.days} ${t.days === 1 ? 'day' : 'days'}`];
  if (t.films) bits.push(`${t.films} ${t.films === 1 ? 'film' : 'films'}`);
  if (t.shows) bits.push(`${t.shows} ${t.shows === 1 ? 'show' : 'shows'}`);
  if (!data.person && t.people) bits.push(`${t.people} ${t.people === 1 ? 'person' : 'people'}`);
  text(bits.join('  ·  '), L + 10, 596, { size: 28, weight: 500, alpha: 0.78, max: R - L - 20 });

  const list = (title, items, x, w, empty) => {
    text(title.toUpperCase(), x, 690, { size: 24, weight: 700, alpha: 0.6 });
    if (!items.length) { text(empty, x, 745, { size: 28, weight: 500, alpha: 0.55 }); return; }
    items.slice(0, 5).forEach((it, i) => {
      const y = 750 + i * 60;
      text(String(i + 1), x, y, { size: 30, weight: 800, alpha: 0.45 });
      const right = fmtHours(it.seconds, { short: true });
      c.font = `500 26px ${font}`; const rw = c.measureText(right).width;
      text(it.title, x + 38, y, { size: 31, weight: 600, max: w - 38 - rw - 16 });
      text(right, x + w, y, { size: 26, weight: 500, alpha: 0.7, align: 'right' });
    });
  };
  const colW = (R - L - 60) / 2;
  list('Top shows', rec.topShows, L, colW, 'No shows this year');
  list('Top films', rec.topFilms, L + colW + 60, colW, 'No films this year');

  const tw = (R - L - 2 * 24) / 3;
  statTiles(rec).forEach(([label, value, sub], i) => {
    const x = L + i * (tw + 24);
    box(x, 1070, tw, 170, 0.09);
    text(label.toUpperCase(), x + 24, 1115, { size: 21, weight: 700, alpha: 0.6, max: tw - 48 });
    let size = 34;
    for (const tryIt of [34, 31, 28]) { size = tryIt; c.font = `700 ${size}px ${font}`; if (c.measureText(value).width <= tw - 48) break; }
    text(value, x + 24, 1170, { size, weight: 700, max: tw - 48 });
    if (sub) text(sub, x + 24, 1212, { size: 26, weight: 500, alpha: 0.8, max: tw - 48 });
  });
  text(`From ${data.source || 'Tautulli'} · made with Arr Command Center`, L, 1300, { size: 23, weight: 500, alpha: 0.5, max: R - L });
  return canvas;
}

// shape: 'hex' (see-through corners) or 'box' (a plain rectangle).
export function drawRecapCard(canvas, data, { shape = 'hex', colors = ['#6366f1', '#a855f7', '#ec4899'], font = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' } = {}) {
  return shape === 'box' ? drawBoxCard(canvas, data, { colors, font }) : drawHexCard(canvas, data, { colors, font });
}

// Hex or Box for this device: the choice made here, or by default Hex on
// desktop and Box on phones (where the hexagon's text gets small). It isn't
// one of the settings that follow you, so each device keeps its own.
export const RECAP_VIEW_KEY = 'acc:recap-view';
export const RECAP_NARROW = '(max-width: 760px)';
export function pickRecapView(stored, narrow) { return stored === 'hex' || stored === 'box' ? stored : narrow ? 'box' : 'hex'; }
const storedView = () => { try { return localStorage.getItem(RECAP_VIEW_KEY); } catch { return null; } };
const narrowNow = () => { try { return !!(window.matchMedia && window.matchMedia(RECAP_NARROW).matches); } catch { return false; } };

const cssColors = () => {
  const cs = getComputedStyle(document.documentElement);
  const v = (n, d) => (cs.getPropertyValue(n) || '').trim() || d;
  return [v('--accent', '#6366f1'), v('--accent-2', '#a855f7'), v('--accent-3', '#ec4899')];
};
const fileName = (data) => `${data.year}-in-review-${String(nameFor(data)).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'everyone'}.png`;
const toBlob = (canvas) => new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Couldn’t make the picture'))), 'image/png'));

function summaryText(data) {
  const r = data.recap;
  const parts = [`${data.year} ${soFar(data.year) ? 'so far' : 'in review'} for ${nameFor(data)}: ${fmtHours(r.totals.seconds)} watched over ${r.totals.plays} plays.`];
  if (r.topShows[0]) parts.push(`Top show: ${r.topShows[0].title}.`);
  if (r.topFilms[0]) parts.push(`Top film: ${r.topFilms[0].title}.`);
  return parts.join(' ');
}


// ---- month by month: a tower of hexagons for each month ----
export const TOWER = Object.freeze({ cells: 6, rr: 16, gap: 3 });
const monthName = (i, style = 'long') => new Date(2000, i, 1).toLocaleDateString(undefined, { month: style });

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

// The SVG for one month's tower (flat-top hexagons stacked edge to edge).
function towerSvg(m, { cells, rr, gap }, colors, id) {
  const hh = SQ3 * rr; const pitch = hh + gap;
  const W = 2 * rr + 6; const H = Math.ceil(cells * pitch - gap + 4);
  const x = W / 2;
  const pts = (y) => [0, 1, 2, 3, 4, 5].map((k) => { const a = (Math.PI / 3) * k; return `${(x + rr * Math.cos(a)).toFixed(2)},${(y + rr * Math.sin(a)).toFixed(2)}`; }).join(' ');
  const yOf = (k) => H - 2 - hh / 2 - k * pitch; // k = 0 is the bottom hexagon
  const base = monthColor(m.i, colors);
  const out = [];
  if (m.state === 'future' || m.state === 'empty') {
    out.push(`<polygon class="cell ${m.state}" points="${pts(yOf(0))}" style="--d:${m.i * 45}"/>`);
  } else {
    for (let k = 0; k < m.full; k += 1) {
      const col = mixRgb(base, [255, 255, 255], Math.min(0.42, k * 0.07));
      out.push(`<polygon class="cell" points="${pts(yOf(k))}" fill="${rgba(col, 0.94)}" style="--d:${m.i * 45 + k * 60}"/>`);
    }
    if (m.part > 0) {
      const k = m.full; const y = yOf(k); const col = mixRgb(base, [255, 255, 255], Math.min(0.42, k * 0.07));
      const fillTop = (y + hh / 2 - hh * m.part).toFixed(2);
      out.push(`<clipPath id="${id}"><rect x="0" y="${fillTop}" width="${W}" height="${H}"/></clipPath>`);
      out.push(`<g class="cell" style="--d:${m.i * 45 + k * 60}"><polygon class="shell" points="${pts(y)}"/><polygon points="${pts(y)}" fill="${rgba(col, 0.94)}" clip-path="url(#${id})"/></g>`);
    }
  }
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true" focusable="false">${out.join('')}</svg>`;
}

let chartIds = 0;
function monthChart(data, colors) {
  const tw = monthTowers(data.recap.months, { year: data.year });
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
  const caption = h('div', { class: 'recap-chart-caption', 'aria-live': 'polite' }, lead, rest);
  const show = (m) => {
    if (!m) { mount(lead, 'Nothing watched yet'); mount(rest); return; }
    if (m === peak) { mount(lead, `Busiest month: ${monthName(m.i)}`); mount(rest, ` · ${fmtHours(m.hours * 3600)} · ${pct(m)}`); return; }
    const [name, what] = describe(m).split(': ');
    mount(lead, name); mount(rest, ` · ${what.replace(', ', ' · ')}`);
  };
  let pinned = null;
  const cols = tw.months.map((m) => h('button', {
    type: 'button',
    class: `recap-mcol ${m.state}${m.peak ? ' peak' : ''}`,
    'aria-label': describe(m),
    onmouseenter: () => show(m), onfocus: () => show(m),
    onmouseleave: () => show(pinned || peak), onblur: () => show(pinned || peak),
    onclick: () => { pinned = pinned === m ? null : m; show(pinned || peak); },
  }, h('span', { class: 'recap-tower', html: towerSvg(m, { ...TOWER, cells: tw.cells }, colors, `${uid}-${m.i}`) }), h('span', { class: 'recap-mname' }, monthName(m.i, 'short'))));
  show(peak);
  return h('section', { class: 'recap-chart', 'aria-label': 'Month by month' },
    h('div', { class: 'recap-chart-head' }, h('span', { class: 'recap-chart-title' }, 'Month by month'),
      tw.unit ? h('span', { class: 'recap-chart-key' }, h('span', { class: 'recap-key-hex', 'aria-hidden': 'true' }), ` = ${unitText(tw.unit)}`) : null),
    h('div', { class: 'recap-chart-cols' }, ...cols),
    caption);
}

function details(data) {
  const r = data.recap;
  const row = (label, ...value) => h('div', { class: 'recap-stat' }, h('div', { class: 'recap-stat-label' }, label), h('div', { class: 'recap-stat-value' }, ...value));
  return h('div', { class: 'recap-details' },
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
export function renderRecap(root, ctx, { year = recapYear(), user = null } = {}) {
  let current = { year, user };
  const thisYear = new Date().getFullYear();
  let shown = false;
  let lastData = null;
  const draw = async () => {
    // The first time, a line of text; after that the current view stays
    // where it is (faded) until the new one is ready, so nothing jumps.
    if (shown) root.classList.add('recap-busy');
    else mount(root, h('div', { class: 'dim', style: { padding: '12px 0' } }, 'Adding up the year…'));
    let data;
    try { data = await load(current); }
    catch (e) { root.classList.remove('recap-busy'); mount(root, controls(null), h('p', { class: 'dim settings-copy' }, e.message)); return; }
    finally { shown = true; }
    root.classList.remove('recap-busy');
    lastData = data;
    if (data.recap.empty) { mount(root, controls(data), h('p', { class: 'dim settings-copy' }, `Nothing watched in ${data.year}${data.person ? ` by ${nameFor(data)}` : ''} yet.`)); return; }
    try { if (document.fonts && document.fonts.ready) await document.fonts.ready; } catch { /* draw anyway */ }
    paint(data);
  };
  // Draws the picture in this device's shape and lays everything out.
  function paint(data) {
    const view = pickRecapView(storedView(), narrowNow());
    root.classList.toggle('recap-view-hex', view === 'hex');
    root.classList.toggle('recap-view-box', view === 'box');
    const colors = cssColors();
    const canvas = drawRecapCard(document.createElement('canvas'), data, { shape: view, colors, font: getComputedStyle(document.body).fontFamily || undefined });
    const img = h('img', { class: 'recap-card', src: canvas.toDataURL('image/png'), alt: summaryText(data), width: String(canvas.width), height: String(canvas.height) });
    const save = h('button', { class: 'btn sm primary', onclick: async () => {
      try {
        const url = URL.createObjectURL(await toBlob(canvas));
        const a = h('a', { href: url, download: fileName(data) }); document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      } catch (e) { toast(e.message, 'error'); }
    } }, 'Save picture');
    const share = h('button', { class: 'btn sm', hidden: 'hidden', onclick: async () => {
      try { const file = new File([await toBlob(canvas)], fileName(data), { type: 'image/png' }); await navigator.share({ files: [file], title: `${data.year} in review` }); }
      catch (e) { if (e && e.name !== 'AbortError') toast(e.message, 'error'); }
    } }, 'Share…');
    try { if (navigator.canShare && navigator.canShare({ files: [new File([new Uint8Array(1)], 'x.png', { type: 'image/png' })] })) share.hidden = false; } catch { /* no sharing */ }
    mount(root, controls(data, view),
      h('div', { class: 'recap-layout' },
        h('div', { class: 'recap-picture' }, img, h('div', { class: 'recap-actions' }, save, share)),
        details(data),
        monthChart(data, colors)));
  }
  // Hex | Box, like the app's other view switches. The choice stays on this device.
  function viewSwitch(view) {
    const seg = (v, label) => h('button', {
      type: 'button', class: `view-seg ${view === v ? 'active' : ''}`, 'aria-pressed': view === v ? 'true' : 'false',
      onclick: () => { if (view === v) return; try { localStorage.setItem(RECAP_VIEW_KEY, v); } catch { /* this visit only */ } if (lastData) paint(lastData); },
    }, label);
    return h('div', { class: 'view-toggle recap-view-toggle', role: 'group', 'aria-label': 'Shape of the picture' }, seg('hex', 'Hex'), seg('box', 'Box'));
  }
  // Without a choice made here, follow the screen size if the window changes.
  try {
    const mq = window.matchMedia(RECAP_NARROW);
    const onWidth = () => {
      if (!root.isConnected) { mq.removeEventListener('change', onWidth); return; }
      if (!storedView() && lastData && !lastData.recap.empty) paint(lastData);
    };
    mq.addEventListener('change', onWidth);
  } catch { /* no matchMedia */ }
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
    return h('div', { class: 'recap-controls' }, yearSel, personSel,
      data ? h('span', { class: 'dim', style: { fontSize: '12px' } }, `From ${data.source}${data.canPick ? '. Only admins can pick other people.' : '.'}`) : null,
      view ? viewSwitch(view) : null);
  }
  draw();
  return root;
}

export function openRecap(ctx, opts = {}) {
  const body = h('div', { class: 'recap-modal' });
  openModal({ title: 'Year in review', body, overlayClass: 'recap-overlay' }); // wider than other dialogs, for the picture
  renderRecap(body, ctx, opts);
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
      h('button', { class: 'btn sm primary', onclick: () => openRecap(ctx, { year }) }, 'Open'),
      h('button', { class: 'btn sm', onclick: () => { try { localStorage.setItem(HIDE_KEY(year), '1'); } catch { /* ignore */ } card.remove(); } }, 'Hide')));
  return card;
}

// Settings → You.
export function recapSettingsCard(ctx) {
  const year = recapYear();
  return h('div', { class: 'card' },
    h('p', { class: 'dim settings-copy', style: { marginTop: 0 } }, 'Your year of watching from Tautulli: hours, top shows and films, your busiest night, what you rewatched, and a picture you can save or share. Admins can look at anyone, or everyone together.'),
    h('button', { class: 'btn sm primary', onclick: () => openRecap(ctx, { year }) }, `Open ${year} ${soFar(year) ? 'so far' : 'in review'}`));
}
