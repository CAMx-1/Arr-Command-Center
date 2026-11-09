// Year in review: the pictures. A hexagon (see-through corners), a box, and
// a 1080 × 1920 story that puts either one on a full background. Posters
// (loaded through this server) go behind the top of the card, and in the
// box and the story the top show's and top film's posters stand out on
// their own.
import { soFar, fmtHours, fmtDay, bigNumber, nameFor, totalsLine, compareText, compareArrow, statTiles } from './recapText.js';

const SQ3 = Math.sqrt(3);
// A pointy-top hexagon, r from the centre to a corner, with room around it
// for the glow.
export const CARD = Object.freeze({ r: 665, pad: 40, width: Math.ceil(SQ3 * 665 + 80), height: 2 * 665 + 80 });
export const BOX = Object.freeze({ width: 1080, height: 1350 });
export const STORY = Object.freeze({ width: 1080, height: 1920 });
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

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
export const rgba = (rgb, a = 1) => `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${a})`;
export const mixRgb = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
// January to December run through the three accent colours.
export function monthColor(i, colors) {
  const [a, b, c] = [0, 1, 2].map((k) => rgbOf(colors && colors[k]));
  const t = Math.max(0, Math.min(1, i / 11));
  return t < 0.5 ? mixRgb(a, b, t * 2) : mixRgb(b, c, (t - 0.5) * 2);
}

export function fit(c, text, max) {
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
export function hexPath(c, x, y, rr) {
  c.beginPath();
  for (let i = 0; i < 6; i += 1) { const a = (Math.PI / 3) * i - Math.PI / 2; c.lineTo(x + rr * Math.cos(a), y + rr * Math.sin(a)); }
  c.closePath();
}
// A wide hexagon with pointed left and right ends, like the app's buttons.
function pillPath(c, x, y, w, hgt) {
  const e = hgt * 0.3;
  c.beginPath(); c.moveTo(x, y + hgt / 2); c.lineTo(x + e, y); c.lineTo(x + w - e, y); c.lineTo(x + w, y + hgt / 2); c.lineTo(x + w - e, y + hgt); c.lineTo(x + e, y + hgt); c.closePath();
}
function roundRect(c, x, y, w, hgt, q) {
  c.beginPath();
  if (c.roundRect) { c.roundRect(x, y, w, hgt, q); return; }
  c.moveTo(x + q, y); c.arcTo(x + w, y, x + w, y + hgt, q); c.arcTo(x + w, y + hgt, x, y + hgt, q); c.arcTo(x, y + hgt, x, y, q); c.arcTo(x, y, x + w, y, q); c.closePath(); // Safari before 16
}

// Draws `img` over the rectangle, cropped to fill it (like object-fit: cover).
function drawCover(c, img, x, y, w, hgt) {
  const iw = img.naturalWidth || img.width; const ih = img.naturalHeight || img.height;
  if (!iw || !ih) return;
  const s = Math.max(w / iw, hgt / ih); const sw = w / s; const sh = hgt / s;
  c.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, x, y, w, hgt);
}

// Which poster goes in each cell of the wall, so neighbours differ.
export function wallPick(row, col, n) { return n ? (((row * 7 + col * 3) % n) + n) % n : -1; }

// Safari (and so the iPhone app) has no canvas blur (ctx.filter): check
// once by blurring one pixel and looking next to it.
let blurWorks = null;
function canvasBlurWorks() {
  if (blurWorks !== null) return blurWorks;
  try {
    const t = document.createElement('canvas'); t.width = 9; t.height = 9;
    const x = t.getContext('2d'); x.filter = 'blur(2px)'; x.fillStyle = '#fff'; x.fillRect(4, 4, 1, 1);
    blurWorks = x.getImageData(3, 4, 1, 1).data[3] > 0;
  } catch { blurWorks = false; }
  return blurWorks;
}
// Without it: halve the layer twice, then scale it back up, which softens
// it about as much as blur(2px).
function soften(layer) {
  let src = layer;
  for (let i = 0; i < 2; i += 1) {
    const t = document.createElement('canvas'); t.width = Math.max(1, Math.round(src.width / 2)); t.height = Math.max(1, Math.round(src.height / 2));
    const x = t.getContext('2d'); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
    x.drawImage(src, 0, 0, t.width, t.height); src = t;
  }
  const c = layer.getContext('2d');
  c.clearRect(0, 0, layer.width, layer.height); c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
  c.drawImage(src, 0, 0, layer.width, layer.height);
}

// A tilted wall of posters, darkened and fading out towards the bottom,
// as its own layer (w × h) to draw behind the text.
function posterWall(imgs, w, hgt, { cell = 150, gap = 14, angle = -0.2, dark = 0.5 } = {}) {
  const layer = document.createElement('canvas'); layer.width = Math.ceil(w); layer.height = Math.ceil(hgt);
  const c = layer.getContext('2d');
  const cw = cell; const ch = cell * 1.5;
  const span = Math.hypot(w, hgt) / 2 + ch;
  c.save(); c.translate(w / 2, hgt / 2); c.rotate(angle);
  const blur = canvasBlurWorks();
  if (blur) c.filter = 'blur(2px)'; // softer, so the posters' own lettering doesn't compete
  const rows = Math.ceil(span / (ch + gap)); const cols = Math.ceil(span / (cw + gap)) + 1;
  for (let row = -rows; row <= rows; row += 1) {
    const off = (Math.abs(row) % 2) * ((cw + gap) / 2);
    for (let col = -cols; col <= cols; col += 1) {
      const img = imgs[wallPick(row, col, imgs.length)];
      const px = col * (cw + gap) + off - cw / 2; const py = row * (ch + gap) - ch / 2;
      c.save(); roundRect(c, px, py, cw, ch, 10); c.clip(); drawCover(c, img, px, py, cw, ch); c.restore();
    }
  }
  c.restore();
  if (blur) c.filter = 'none'; else soften(layer);
  c.fillStyle = `rgba(10, 12, 22, ${dark})`; c.fillRect(0, 0, w, hgt);
  // Fade out towards the bottom.
  c.globalCompositeOperation = 'destination-in';
  const fade = c.createLinearGradient(0, 0, 0, hgt);
  fade.addColorStop(0, 'rgba(0,0,0,1)'); fade.addColorStop(0.55, 'rgba(0,0,0,0.85)'); fade.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = fade; c.fillRect(0, 0, w, hgt);
  c.globalCompositeOperation = 'source-over';
  return layer;
}

// Darkens the face behind a block of text so it reads over the posters.
function spotlight(c, x, y, r, a = 0.55) {
  const g = c.createRadialGradient(x, y, r * 0.15, x, y, r);
  g.addColorStop(0, `rgba(10, 12, 22, ${a})`); g.addColorStop(1, 'rgba(10, 12, 22, 0)');
  c.fillStyle = g; c.fillRect(x - r, y - r, 2 * r, 2 * r);
}

// A poster standing on its own: rounded, with a shadow and a small label.
function heroPoster(c, img, cx, cy, w, hgt, angle, label, { font, colors }) {
  c.save(); c.translate(cx, cy); c.rotate(angle);
  c.save(); c.shadowColor = 'rgba(0, 0, 0, 0.55)'; c.shadowBlur = 34; c.shadowOffsetY = 14;
  roundRect(c, -w / 2, -hgt / 2, w, hgt, 18); c.fillStyle = '#111'; c.fill(); c.restore();
  c.save(); roundRect(c, -w / 2, -hgt / 2, w, hgt, 18); c.clip(); drawCover(c, img, -w / 2, -hgt / 2, w, hgt); c.restore();
  roundRect(c, -w / 2, -hgt / 2, w, hgt, 18); c.lineWidth = 3; c.strokeStyle = 'rgba(255, 255, 255, 0.35)'; c.stroke();
  if (label) {
    c.font = `800 ${Math.round(w * 0.085)}px ${font}`;
    const lw = c.measureText(label).width + w * 0.12; const lh = w * 0.15;
    const g = c.createLinearGradient(-lw / 2, 0, lw / 2, 0); g.addColorStop(0, rgba(rgbOf(colors[0]))); g.addColorStop(1, rgba(rgbOf(colors[2])));
    pillPath(c, -lw / 2, hgt / 2 - lh * 0.55, lw, lh); c.fillStyle = g; c.fill();
    c.fillStyle = '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(label, 0, hgt / 2 - lh * 0.55 + lh / 2 + 1);
  }
  c.restore();
}

const ARROW_RGB = { up: [134, 239, 172], down: [253, 164, 175], same: [226, 232, 240] };

function drawHexCard(canvas, data, { colors, font, posters }) {
  const R = CARD.r; const W = CARD.width; const H = CARD.height;
  canvas.width = W; canvas.height = H;
  const c = canvas.getContext('2d');
  const rec = data.recap;
  const [c0, c1, c2] = [0, 1, 2].map((k) => rgbOf(colors[k]));
  const cx = W / 2; const top = CARD.pad; const cy = top + R;
  const Y = (rel) => top + rel; // positions below are measured from the top corner
  const room = (rel, margin) => Math.max(0, 2 * (hexHalfWidth(rel) - margin));
  const diag = (a = 1) => { const g = c.createLinearGradient(cx - R, top, cx + R, top + 2 * R); g.addColorStop(0, rgba(c0, a)); g.addColorStop(0.55, rgba(c1, a)); g.addColorStop(1, rgba(c2, a)); return g; };
  const text = (str, x, y, { size = 32, weight = 600, alpha = 1, align = 'center', max = null, fill = null, shadow = 0 } = {}) => {
    c.font = `${weight} ${size}px ${font}`; c.fillStyle = fill || `rgba(255,255,255,${alpha})`; c.textAlign = align; c.textBaseline = 'alphabetic';
    const out = max ? fit(c, str, max) : String(str);
    if (shadow) { c.save(); c.shadowColor = 'rgba(0, 0, 0, 0.55)'; c.shadowBlur = shadow; c.fillText(out, x, y); c.restore(); } else c.fillText(out, x, y);
    return c.measureText(out).width;
  };
  const spaced = (str, y, { size, weight, alpha, spacing }) => {
    c.font = `${weight} ${size}px ${font}`; c.fillStyle = `rgba(255,255,255,${alpha})`; c.textAlign = 'left'; c.textBaseline = 'alphabetic';
    const chars = [...String(str)]; const widths = chars.map((ch) => c.measureText(ch).width);
    let x = cx - (widths.reduce((a, b) => a + b, 0) + spacing * (chars.length - 1)) / 2;
    chars.forEach((ch, i) => { c.fillText(ch, x, y); x += widths[i] + spacing; });
  };
  const wall = posters.all.length > 0;

  // The glow around the edge, then the face over it.
  c.save(); hexPath(c, cx, cy, R); c.shadowColor = rgba(c1, 0.75); c.shadowBlur = 38; c.fillStyle = rgba(c1); c.fill(); c.restore();
  c.save(); hexPath(c, cx, cy, R); c.clip();
  c.fillStyle = diag(); c.fillRect(0, 0, W, H);
  c.fillStyle = 'rgba(10, 12, 22, 0.66)'; c.fillRect(0, 0, W, H);
  if (wall) { c.drawImage(posterWall(posters.all, W, Y(720), { cell: 150, dark: 0.6 }), 0, 0); spotlight(c, cx, Y(330), 470, 0.6); }
  const light = c.createRadialGradient(cx, Y(250), 10, cx, Y(250), 470);
  light.addColorStop(0, rgba(c1, wall ? 0.3 : 0.42)); light.addColorStop(1, rgba(c1, 0));
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
  spaced('ARR COMMAND CENTER', Y(170), { size: 21, weight: 700, alpha: 0.72, spacing: 3 });
  const yearFill = c.createLinearGradient(0, Y(200), 0, Y(322)); yearFill.addColorStop(0, '#ffffff'); yearFill.addColorStop(1, rgba(mixRgb([255, 255, 255], c2, 0.4)));
  text(String(data.year), cx, Y(322), { size: 164, weight: 800, fill: yearFill, shadow: wall ? 24 : 0 });
  text(soFar(data.year) ? 'so far' : 'in review', cx, Y(386), { size: 48, weight: 600, alpha: 0.95, shadow: wall ? 16 : 0 });
  text(nameFor(data), cx, Y(432), { size: 31, weight: 600, alpha: 0.8, max: room(432, 130), shadow: wall ? 12 : 0 });

  // Hours, in a wide hexagon.
  const [num, unit] = bigNumber(rec.totals.seconds);
  c.font = `800 96px ${font}`; const nw = c.measureText(num).width;
  c.font = `600 33px ${font}`; const uw = c.measureText(`${unit} watched`).width;
  const bh = 122; const bTop = Y(456);
  const bw = Math.min(room(520, 70), Math.max(560, nw + 20 + uw + 2 * (bh * 0.3 + 46)));
  pillPath(c, cx - bw / 2, bTop, bw, bh);
  const pill = c.createLinearGradient(cx - bw / 2, 0, cx + bw / 2, 0); pill.addColorStop(0, 'rgba(255, 255, 255, 0.18)'); pill.addColorStop(1, 'rgba(255, 255, 255, 0.07)');
  c.fillStyle = pill; c.fill(); c.lineWidth = 2; c.strokeStyle = 'rgba(255, 255, 255, 0.32)'; c.stroke();
  c.fillStyle = 'rgba(10, 12, 22, 0.25)'; c.fill();
  const x0 = cx - (nw + 20 + uw) / 2;
  text(num, x0, bTop + bh / 2 + 34, { size: 96, weight: 800, align: 'left' });
  text(`${unit} watched`, x0 + nw + 20, bTop + bh / 2 + 34, { size: 33, weight: 600, alpha: 0.92, align: 'left' });
  const cmp = compareText(rec);
  let lineY = Y(634);
  if (cmp) {
    const label = cmp.short; c.font = `700 25px ${font}`; const lw = c.measureText(label).width; const aw = 30;
    const sx = cx - (aw + lw) / 2;
    text(compareArrow(cmp.dir), sx, Y(616), { size: 22, weight: 800, align: 'left', fill: rgba(ARROW_RGB[cmp.dir]) });
    text(label, sx + aw, Y(616), { size: 25, weight: 700, align: 'left', fill: rgba(ARROW_RGB[cmp.dir], 0.95), max: room(616, 120) - aw });
    lineY = Y(656);
  }
  text(totalsLine(data).join('  ·  '), cx, lineY, { size: 24, weight: 500, alpha: 0.8, max: room(656, 100) });

  // Top shows and films, side by side across the widest part.
  const colW = 450; const gutter = 40;
  const list = (title, items, x, empty) => {
    text(title.toUpperCase(), x, Y(714), { size: 20, weight: 700, alpha: 0.62, align: 'left' });
    if (!items.length) { text(empty, x, Y(760), { size: 26, weight: 500, alpha: 0.55, align: 'left' }); return; }
    items.slice(0, 5).forEach((it, i) => {
      const y = Y(760 + i * 41);
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

function drawBoxCard(canvas, data, { colors, font, posters }) {
  const W = BOX.width; const H = BOX.height; const L = 80; const R = W - 80;
  canvas.width = W; canvas.height = H;
  const c = canvas.getContext('2d');
  const rec = data.recap;
  const [c0, c1, c2] = [0, 1, 2].map((k) => rgbOf(colors[k]));
  const diag = (a = 1) => { const g = c.createLinearGradient(0, 0, W, H); g.addColorStop(0, rgba(c0, a)); g.addColorStop(0.55, rgba(c1, a)); g.addColorStop(1, rgba(c2, a)); return g; };
  const text = (str, x, y, { size = 32, weight = 600, alpha = 1, align = 'left', max = null, fill = null, shadow = 0 } = {}) => {
    c.font = `${weight} ${size}px ${font}`; c.fillStyle = fill || `rgba(255,255,255,${alpha})`; c.textAlign = align; c.textBaseline = 'alphabetic';
    const out = max ? fit(c, str, max) : String(str);
    if (shadow) { c.save(); c.shadowColor = 'rgba(0, 0, 0, 0.55)'; c.shadowBlur = shadow; c.fillText(out, x, y); c.restore(); } else c.fillText(out, x, y);
    return c.measureText(out).width;
  };
  const box = (x, y, w, hgt, a = 0.08) => { roundRect(c, x, y, w, hgt, 28); c.fillStyle = `rgba(255,255,255,${a})`; c.fill(); };
  const heroes = [posters.topShow && [posters.topShow, 'TOP SHOW'], posters.topFilm && [posters.topFilm, 'TOP FILM']].filter(Boolean);
  const wall = posters.all.length > 0;

  // Face: the same gradient, light and honeycomb as the hexagon.
  c.fillStyle = diag(); c.fillRect(0, 0, W, H);
  c.fillStyle = 'rgba(10, 12, 22, 0.66)'; c.fillRect(0, 0, W, H);
  if (wall) { c.drawImage(posterWall(posters.all, W, 640, { cell: 132, dark: 0.64 }), 0, 0); spotlight(c, 290, 250, 500, 0.6); }
  const light = c.createRadialGradient(300, 210, 10, 300, 210, 560);
  light.addColorStop(0, rgba(c1, wall ? 0.28 : 0.40)); light.addColorStop(1, rgba(c1, 0));
  c.fillStyle = light; c.fillRect(0, 0, W, H);
  c.lineWidth = 1.5; c.strokeStyle = 'rgba(255, 255, 255, 0.045)';
  const s = 46; const dx = SQ3 * s; const dy = 1.5 * s;
  for (let row = 0, y = -s; y < H + s; row += 1, y += dy) {
    for (let x = (row % 2 ? dx / 2 : 0) - dx; x < W + dx; x += dx) { hexPath(c, x, y, s - 2); c.stroke(); }
  }
  if (!heroes.length) {
    c.lineWidth = 3;
    for (const [x, y, rr, a] of [[940, 150, 130, 0.12], [1030, 360, 70, 0.09], [700, 60, 40, 0.07]]) { hexPath(c, x, y, rr); c.strokeStyle = `rgba(255,255,255,${a})`; c.stroke(); }
    c.save(); hexPath(c, 940, 150, 88); c.shadowColor = rgba(c1, 0.8); c.shadowBlur = 30; c.fillStyle = diag(0.55); c.fill(); c.restore();
  }
  c.lineWidth = 6; c.strokeStyle = diag(); c.strokeRect(3, 3, W - 6, H - 6);

  // The top show and top film, on their own at the top right.
  const opts = { font, colors };
  if (heroes.length === 2) { heroPoster(c, heroes[0][0], 742, 226, 184, 276, -0.06, heroes[0][1], opts); heroPoster(c, heroes[1][0], 924, 252, 184, 276, 0.06, heroes[1][1], opts); }
  else if (heroes.length === 1) heroPoster(c, heroes[0][0], 850, 240, 210, 315, 0.05, heroes[0][1], opts);
  const headMax = heroes.length ? 600 - L : R - L;

  text('ARR COMMAND CENTER', L, 100, { size: 24, weight: 700, alpha: 0.7 });
  const yearFill = c.createLinearGradient(0, 130, 0, 250); yearFill.addColorStop(0, '#ffffff'); yearFill.addColorStop(1, rgba(mixRgb([255, 255, 255], c2, 0.4)));
  text(String(data.year), L, 250, { size: 170, weight: 800, fill: yearFill, shadow: wall ? 24 : 0 });
  text(soFar(data.year) ? 'so far' : 'in review', L, 325, { size: 62, weight: 600, alpha: 0.95, shadow: wall ? 16 : 0 });
  text(nameFor(data), L, 395, { size: 40, weight: 600, alpha: 0.8, max: headMax, shadow: wall ? 12 : 0 });

  box(L - 20, 430, R - L + 40, 190, 0.1);
  c.fillStyle = 'rgba(10, 12, 22, 0.25)'; c.fill();
  const [num, unit] = bigNumber(rec.totals.seconds);
  const cmp = compareText(rec);
  const numW = text(num, L + 10, cmp ? 540 : 548, { size: 112, weight: 800 });
  text(`${unit} watched`, L + 10 + numW + 22, cmp ? 540 : 548, { size: 40, weight: 600, alpha: 0.92 });
  let listTop = 690;
  if (cmp) {
    text(compareArrow(cmp.dir), L + 12, 594, { size: 24, weight: 800, fill: rgba(ARROW_RGB[cmp.dir]) });
    text(cmp.short, L + 46, 594, { size: 28, weight: 700, fill: rgba(ARROW_RGB[cmp.dir], 0.95), max: R - L - 56 });
    text(totalsLine(data).join('  ·  '), L, 668, { size: 27, weight: 500, alpha: 0.8, max: R - L });
    listTop = 726;
  } else text(totalsLine(data).join('  ·  '), L + 10, 596, { size: 28, weight: 500, alpha: 0.8, max: R - L - 20 });

  const step = cmp ? 56 : 60;
  const list = (title, items, x, w, empty) => {
    text(title.toUpperCase(), x, listTop, { size: 24, weight: 700, alpha: 0.62 });
    if (!items.length) { text(empty, x, listTop + 55, { size: 28, weight: 500, alpha: 0.55 }); return; }
    items.slice(0, 5).forEach((it, i) => {
      const y = listTop + 60 + i * step;
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
    text(label.toUpperCase(), x + 24, 1115, { size: 21, weight: 700, alpha: 0.62, max: tw - 48 });
    let size = 34;
    for (const tryIt of [34, 31, 28]) { size = tryIt; c.font = `700 ${size}px ${font}`; if (c.measureText(value).width <= tw - 48) break; }
    text(value, x + 24, 1170, { size, weight: 700, max: tw - 48 });
    if (sub) text(sub, x + 24, 1212, { size: 26, weight: 500, alpha: 0.8, max: tw - 48 });
  });
  text(`From ${data.source || 'Tautulli'} · made with Arr Command Center`, L, 1300, { size: 23, weight: 500, alpha: 0.5, max: R - L });
  return canvas;
}

// The story: either card on a full 1080 × 1920 background, with the top
// show's and top film's posters above it. Nothing see-through, so it looks
// the same in every app.
function drawStory(canvas, data, { shape, colors, font, posters }) {
  const W = STORY.width; const H = STORY.height;
  canvas.width = W; canvas.height = H;
  const c = canvas.getContext('2d');
  const [c0, c1, c2] = [0, 1, 2].map((k) => rgbOf(colors[k]));
  const g = c.createLinearGradient(0, 0, W, H); g.addColorStop(0, rgba(c0)); g.addColorStop(0.55, rgba(c1)); g.addColorStop(1, rgba(c2));
  c.fillStyle = g; c.fillRect(0, 0, W, H);
  c.fillStyle = 'rgba(8, 9, 18, 0.74)'; c.fillRect(0, 0, W, H);
  const wall = posters.all.length > 0;
  if (wall) c.drawImage(posterWall(posters.all, W, 820, { cell: 170, dark: 0.62, angle: -0.18 }), 0, 0);
  const glow = c.createRadialGradient(W / 2, 1250, 40, W / 2, 1250, 900); glow.addColorStop(0, rgba(c1, 0.32)); glow.addColorStop(1, rgba(c1, 0));
  c.fillStyle = glow; c.fillRect(0, 0, W, H);
  c.lineWidth = 1.5; c.strokeStyle = 'rgba(255, 255, 255, 0.045)';
  const s = 52; const dx = SQ3 * s; const dy = 1.5 * s;
  for (let row = 0, y = -s; y < H + s; row += 1, y += dy) {
    for (let x = (row % 2 ? dx / 2 : 0) - dx; x < W + dx; x += dx) { hexPath(c, x, y, s - 2); c.stroke(); }
  }
  // The card, scaled down at the bottom.
  // The card itself without posters: they're shown above it.
  const card = document.createElement('canvas');
  const plain = { all: [], topShow: null, topFilm: null };
  if (shape === 'box') drawBoxCard(card, data, { colors, font, posters: plain });
  else drawHexCard(card, data, { colors, font, posters: plain });
  const cw = shape === 'box' ? 940 : 1010; const ch = card.height * (cw / card.width);
  const cardX = (W - cw) / 2; const cardY = H - ch - (shape === 'box' ? 70 : 108);
  if (shape === 'box') {
    c.save(); c.shadowColor = 'rgba(0, 0, 0, 0.5)'; c.shadowBlur = 50; c.shadowOffsetY = 18; roundRect(c, cardX, cardY, cw, ch, 36); c.fillStyle = '#000'; c.fill(); c.restore();
    c.save(); roundRect(c, cardX, cardY, cw, ch, 36); c.clip(); c.drawImage(card, cardX, cardY, cw, ch); c.restore();
  } else c.drawImage(card, cardX, cardY, cw, ch);
  // Above it: the top show and top film.
  const heroes = [posters.topShow && [posters.topShow, 'TOP SHOW'], posters.topFilm && [posters.topFilm, 'TOP FILM']].filter(Boolean);
  const room = cardY - 150; const ph = Math.min(450, room - 40); const pw = ph / 1.5;
  const midY = 130 + room / 2;
  if (heroes.length === 2) { heroPoster(c, heroes[0][0], W / 2 - pw / 2 - 26, midY, pw, ph, -0.06, heroes[0][1], { font, colors }); heroPoster(c, heroes[1][0], W / 2 + pw / 2 + 26, midY + 18, pw, ph, 0.06, heroes[1][1], { font, colors }); }
  else if (heroes.length === 1) heroPoster(c, heroes[0][0], W / 2, midY, pw, ph, 0.04, heroes[0][1], { font, colors });
  else {
    // No posters: a cluster of glowing hexagons.
    c.lineWidth = 4;
    for (const [x, y, rr, a] of [[W / 2, midY, 150, 0.5], [W / 2 - 230, midY + 60, 80, 0.25], [W / 2 + 240, midY - 70, 95, 0.3]]) {
      c.save(); hexPath(c, x, y, rr); c.shadowColor = rgba(c1, 0.9); c.shadowBlur = 40; c.strokeStyle = rgba(mixRgb(c1, [255, 255, 255], 0.3), a); c.stroke(); c.restore();
    }
    c.font = `800 120px ${font}`; c.fillStyle = '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(String(data.year), W / 2, midY + 6);
  }
  if (shape !== 'box') { // the box card says it already
    c.font = `600 26px ${font}`; c.fillStyle = 'rgba(255, 255, 255, 0.6)'; c.textAlign = 'center'; c.textBaseline = 'alphabetic';
    c.fillText('Made with Arr Command Center', W / 2, H - 52);
  }
  return canvas;
}

const noPosters = { all: [], topShow: null, topFilm: null };
// shape: 'hex' or 'box'; format: 'picture' or 'story'. posters from loadPosters().
export function drawRecapCard(canvas, data, { shape = 'hex', format = 'picture', colors = ['#6366f1', '#a855f7', '#ec4899'], font = FONT, posters = noPosters } = {}) {
  const opts = { shape, colors, font, posters: { ...noPosters, ...posters } };
  if (format === 'story') return drawStory(canvas, data, opts);
  return shape === 'box' ? drawBoxCard(canvas, data, opts) : drawHexCard(canvas, data, opts);
}

// ---- posters ----
const posterCache = new Map(); // url → Promise<HTMLImageElement | null>
function loadImage(url, timeout = 8000) {
  if (posterCache.has(url)) return posterCache.get(url);
  const p = new Promise((resolve) => {
    const img = new Image(); let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const timer = setTimeout(() => { posterCache.delete(url); finish(null); }, timeout); // try again next time
    img.onload = () => { clearTimeout(timer); finish(img.naturalWidth ? img : null); };
    img.onerror = () => { clearTimeout(timer); posterCache.delete(url); finish(null); };
    img.decoding = 'async'; img.src = url;
  });
  posterCache.set(url, p);
  if (posterCache.size > 80) posterCache.delete(posterCache.keys().next().value);
  return p;
}
export const posterSrc = (url, w = 500) => (url ? `${url}&w=${w}` : null);

// The posters for a year: the wall (top shows and films, most watched first)
// and the top show and top film on their own. Missing ones are left out.
export async function loadPosters(recap, { timeout = 8000 } = {}) {
  const shows = recap.topShows.map((x) => x.poster); const films = recap.topFilms.map((x) => x.poster);
  const order = []; for (let i = 0; i < 5; i += 1) { if (shows[i]) order.push(shows[i]); if (films[i]) order.push(films[i]); }
  const urls = [...new Set(order)];
  const imgs = await Promise.all(urls.map((u) => loadImage(posterSrc(u), timeout)));
  const byUrl = new Map(urls.map((u, i) => [u, imgs[i]]));
  return { all: imgs.filter(Boolean), topShow: (shows[0] && byUrl.get(shows[0])) || null, topFilm: (films[0] && byUrl.get(films[0])) || null };
}

// The SVG for one month's tower (flat-top hexagons stacked edge to edge).
export function towerSvg(m, { cells, rr, gap }, colors, id) {
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
