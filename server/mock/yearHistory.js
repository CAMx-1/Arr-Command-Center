// Demo only: a year of Tautulli history for four people, made up but
// believable (evenings, weekends, binges, a few rewatches, some music).
// The Tautulli mock serves it for date-range requests (Year in review), so
// the other demo pages keep their small history.

export const DEMO_TAUTULLI_USERS = [
  { user_id: 1001, username: 'cameron', friendly_name: 'cameron', email: 'cameron@example.test', is_active: 1 },
  { user_id: 3003, username: 'alex', friendly_name: 'alex', email: 'alex@example.test', is_active: 1 },
  { user_id: 4004, username: 'jamie', friendly_name: 'jamie', email: 'jamie@example.test', is_active: 1 },
  { user_id: 5005, username: 'guest', friendly_name: 'Guest', email: '', is_active: 1 },
];

const SHOWS = [
  { title: 'The Bear', key: 40, seasons: [8, 10, 10], mins: 32 },
  { title: 'Severance', key: 20, seasons: [9, 10], mins: 52 },
  { title: 'Foundation', key: 30, seasons: [10, 10], mins: 58 },
  { title: 'Slow Horses', key: 50, seasons: [6, 6, 6, 6], mins: 46 },
  { title: 'Shōgun', key: 60, seasons: [10], mins: 58 },
  { title: 'The Last of Us', key: 70, seasons: [9, 7], mins: 55 },
  { title: 'Bluey', key: 80, seasons: [52, 52, 49], mins: 7 },
];
const FILMS = [
  { title: 'Dune: Part Two', key: 12, year: 2024, mins: 166 },
  { title: 'Oppenheimer', key: 10, year: 2023, mins: 180 },
  { title: '1917', key: 15, year: 2019, mins: 119 },
  { title: 'Interstellar', key: 13, year: 2014, mins: 169 },
  { title: 'Blade Runner 2049', key: 14, year: 2017, mins: 164 },
  { title: 'Arrival', key: 16, year: 2016, mins: 116 },
  { title: 'Past Lives', key: 17, year: 2023, mins: 106 },
  { title: 'Spirited Away', key: 18, year: 2001, mins: 125 },
  { title: 'Paddington 2', key: 19, year: 2017, mins: 104 },
];
const TRACKS = [
  { artist: 'Daft Punk', key: 900, titles: ['One More Time', 'Digital Love', 'Harder, Better, Faster, Stronger', 'Something About Us', 'Veridis Quo'] },
  { artist: 'Miles Davis', key: 910, titles: ['So What', 'Freddie Freeloader', 'Blue in Green', 'All Blues', 'Flamenco Sketches'] },
];
// Who watches what, how often, and on what.
const PEOPLE = {
  1001: { p: 0.62, weekend: 0.85, shows: ['The Bear', 'Severance', 'Slow Horses', 'Shōgun', 'Foundation'], films: 0.18, players: [['Apple TV', 'tvOS', 'Plex for Apple TV'], ['iPhone', 'iOS', 'Plex for iOS'], ['Chrome', 'Chrome', 'Plex Web']], start: [19.5, 22.5] },
  3003: { p: 0.42, weekend: 0.6, shows: ['The Last of Us', 'Severance', 'Foundation'], films: 0.25, players: [['Roku', 'Roku', 'Plex for Roku'], ['Pixel 8', 'Android', 'Plex for Android']], start: [20, 23.5] },
  4004: { p: 0.3, weekend: 0.5, shows: ['Slow Horses', 'The Bear'], films: 0.3, players: [['Living Room PC', 'Windows', 'Plex for Windows'], ['iPad', 'iPadOS', 'Plex for iOS']], start: [18.5, 21.5], music: 0.45 },
  5005: { p: 0.35, weekend: 0.7, shows: ['Bluey'], films: 0.12, kidsFilms: true, players: [['Fire TV', 'Android', 'Plex for Fire TV']], start: [16, 18.5] },
};

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const cache = new Map();
// Rows for one calendar year (local time), up to `now`.
export function demoYearRows(year, now = Date.now()) {
  const ck = `${year}|${Math.floor(now / 3600000)}`;
  if (cache.has(ck)) return cache.get(ck);
  const rows = []; let id = year * 100000;
  const user = Object.fromEntries(DEMO_TAUTULLI_USERS.map((u) => [u.user_id, u]));
  for (const [uid, who] of Object.entries(PEOPLE)) {
    const rand = rng(year * 7919 + Number(uid));
    const progress = Object.fromEntries(SHOWS.map((s) => [s.title, { season: 1, ep: 1 }]));
    let showIdx = 0;
    const u = user[uid];
    const push = (o, at, secs, player) => {
      const [name, platform, product] = player;
      rows.push({ id, row_id: id, reference_id: id, date: at, started: at, stopped: at + secs + 30, play_duration: secs, paused_counter: 30, user_id: Number(uid), user: u.username, friendly_name: u.friendly_name, player: name, platform, product, transcode_decision: rand() < 0.2 ? 'transcode' : 'direct play', ...o });
      id += 1;
    };
    const episode = (show, at, player) => {
      const s = SHOWS.find((x) => x.title === show); const pr = progress[show];
      if (pr.season > s.seasons.length) { pr.season = 1; pr.ep = 1; }
      const secs = Math.round((s.mins * (0.92 + rand() * 0.1)) * 60);
      const partial = rand() < 0.06;
      push({ media_type: 'episode', title: `Episode ${pr.ep}`, full_title: `${s.title} - S${pr.season}E${pr.ep}`, grandparent_title: s.title, parent_media_index: pr.season, media_index: pr.ep, rating_key: s.key * 1000 + pr.season * 100 + pr.ep, grandparent_rating_key: s.key, parent_rating_key: s.key * 100 + pr.season, thumb: `/library/metadata/${s.key * 100 + pr.season}/thumb/1`, percent_complete: partial ? 40 : 100, watched_status: partial ? 0.5 : 1 }, at, partial ? Math.round(secs * 0.4) : secs, player);
      if (!partial) { pr.ep += 1; if (pr.ep > s.seasons[pr.season - 1]) { pr.season += 1; pr.ep = 1; } }
      return partial ? Math.round(secs * 0.4) : secs;
    };
    const film = (f, at, player) => {
      const secs = Math.round(f.mins * 60 * (0.97 + rand() * 0.03));
      push({ media_type: 'movie', title: f.title, full_title: f.title, year: f.year, rating_key: f.key, thumb: `/library/metadata/${f.key}/thumb/1`, percent_complete: 100, watched_status: 1 }, at, secs, player);
      return secs;
    };
    for (let day = new Date(year, 0, 1); day.getFullYear() === year; day = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1)) {
      const weekend = day.getDay() === 0 || day.getDay() === 6 || day.getDay() === 5;
      // A quieter summer, a busier winter.
      const season = [1.15, 1.1, 1, 0.95, 0.85, 0.75, 0.7, 0.75, 0.9, 1, 1.1, 1.25][day.getMonth()];
      const player = () => who.players[Math.floor(rand() * who.players.length)];
      const startHr = who.start[0] + rand() * (who.start[1] - who.start[0]) + (weekend ? -1 : 0);
      let at = Math.floor(new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0).getTime() / 1000 + startHr * 3600);
      if (who.music && rand() < who.music) {
        const t = TRACKS[Math.floor(rand() * TRACKS.length)];
        let mAt = at - 3 * 3600;
        for (let k = 0; k < 2 + Math.floor(rand() * 5); k += 1) {
          const ti = Math.floor(rand() * t.titles.length); const secs = 180 + Math.floor(rand() * 240);
          if (mAt * 1000 > now) break;
          push({ media_type: 'track', title: t.titles[ti], full_title: `${t.artist} - ${t.titles[ti]}`, grandparent_title: t.artist, original_title: '', rating_key: t.key + ti, grandparent_rating_key: t.key, percent_complete: 100, watched_status: 1 }, mAt, secs, who.players[0]);
          mAt += secs + 5;
        }
      }
      if (rand() > Math.min(0.95, (weekend ? who.weekend : who.p) * season)) continue;
      const pl = player();
      if (rand() < who.films) {
        const pool = who.kidsFilms ? FILMS.filter((f) => ['Spirited Away', 'Paddington 2'].includes(f.title)) : FILMS.filter((f) => !['Paddington 2'].includes(f.title));
        if (at * 1000 <= now) film(pool[Math.floor(rand() * pool.length)], at, pl);
        continue;
      }
      const binge = rand() < (weekend ? 0.12 : 0.04);
      const count = who.shows[0] === 'Bluey' ? 3 + Math.floor(rand() * 5) : binge ? 4 + Math.floor(rand() * 5) : 1 + Math.floor(rand() * 2);
      if (rand() < 0.08) showIdx = (showIdx + 1) % who.shows.length;
      for (let k = 0; k < count; k += 1) {
        if (at * 1000 > now) break;
        at += episode(who.shows[showIdx], at, pl) + 60 + Math.floor(rand() * 240);
      }
    }
    // Planted rewatches.
    if (Number(uid) === 1001) {
      for (const [m, d] of [[2, 2], [6, 19], [10, 1]]) {
        const at = Math.floor(new Date(year, m, d, 20, 15).getTime() / 1000);
        if (at * 1000 <= now) film(FILMS[0], at, who.players[0]);
      }
      const bear = SHOWS[0];
      for (const [m, d] of [[4, 10], [8, 27]]) {
        const at = Math.floor(new Date(year, m, d, 21, 40).getTime() / 1000);
        if (at * 1000 <= now) push({ media_type: 'episode', title: 'Fishes', full_title: 'The Bear - S2E6', grandparent_title: bear.title, parent_media_index: 2, media_index: 6, rating_key: bear.key * 1000 + 206, grandparent_rating_key: bear.key, parent_rating_key: bear.key * 100 + 2, thumb: `/library/metadata/${bear.key * 100 + 2}/thumb/1`, percent_complete: 100, watched_status: 1 }, at, 66 * 60, who.players[0]);
      }
    }
  }
  rows.sort((a, b) => a.started - b.started);
  cache.set(ck, rows);
  if (cache.size > 6) cache.delete(cache.keys().next().value);
  return rows;
}

const localDate = (sec) => { const d = new Date(sec * 1000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
// get_history with after/before (inclusive dates), user_id, order, start/length.
export function demoHistoryPage(query, now = Date.now()) {
  const after = String(query.after || ''); const before = String(query.before || '');
  const y0 = Number(after.slice(0, 4)) || new Date(now).getFullYear(); const y1 = Number(before.slice(0, 4)) || y0;
  let rows = [];
  for (let y = y0; y <= Math.min(y1, new Date(now).getFullYear()); y += 1) rows = rows.concat(demoYearRows(y, now));
  rows = rows.filter((r) => (!after || localDate(r.started) >= after) && (!before || localDate(r.started) <= before));
  if (query.user_id) rows = rows.filter((r) => String(r.user_id) === String(query.user_id));
  if (String(query.order_dir || 'desc') === 'desc') rows = [...rows].reverse();
  const start = Number(query.start) || 0; const length = Number(query.length) || 25;
  return { draw: 1, recordsTotal: rows.length, recordsFiltered: rows.length, data: rows.slice(start, start + length) };
}

// Demo posters for the Tautulli mock's pms_image_proxy: a made-up poster per
// title (gradient, shapes and the title), so the demo has artwork to show.
const POSTER_TITLES = Object.fromEntries([
  ...SHOWS.map((s) => [s.key, { title: s.title, kind: 'Series' }]),
  ...FILMS.map((f) => [f.key, { title: f.title, kind: String(f.year) }]),
  [11, { title: 'Dune: Part Two', kind: '2024' }], [21, { title: 'Severance', kind: 'Series' }], [31, { title: 'Foundation', kind: 'Series' }], [41, { title: 'The Bear', kind: 'Series' }],
]);
// Season posters (key: show key × 100 + season). Like Tautulli's history, an
// episode's thumb is its season's poster; there's no grandparent_thumb.
const SEASON_POSTERS = Object.fromEntries(SHOWS.flatMap((sh) => sh.seasons.map((_, i) => [sh.key * 100 + i + 1, { title: sh.title, kind: `Season ${i + 1}` }])));
const esc = (t) => String(t).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
function wrapWords(title, max = 11) {
  const out = []; let line = '';
  for (const w of String(title).split(/\s+/)) {
    if (!line) line = w; else if ((`${line} ${w}`).length <= max) line = `${line} ${w}`; else { out.push(line); line = w; }
  }
  if (line) out.push(line);
  return out.slice(0, 4);
}
export function demoPosterSvg(img) {
  const key = Number((/\/library\/metadata\/(\d+)/.exec(String(img)) || [])[1]) || 0;
  const info = POSTER_TITLES[key] || SEASON_POSTERS[key] || { title: 'Arr Command Center', kind: '' };
  let hash = 0; for (const ch of info.title) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const h1 = hash % 360; const h2 = (h1 + 40 + (hash % 80)) % 360;
  const lines = wrapWords(info.title.toUpperCase());
  const size = lines.some((l) => l.length > 9) ? 34 : 40;
  const y0 = 410 - (lines.length - 1) * (size + 4);
  const shapes = [0, 1, 2].map((i) => {
    const cx = 60 + ((hash >> (i * 4)) % 180); const cy = 70 + ((hash >> (i * 5)) % 200); const r = 46 + ((hash >> (i * 3)) % 70);
    const pts = [0, 1, 2, 3, 4, 5].map((k) => { const a = (Math.PI / 3) * k - Math.PI / 2; return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`; }).join(' ');
    return `<polygon points="${pts}" fill="none" stroke="#fff" stroke-opacity="${0.18 + i * 0.08}" stroke-width="${3 + i * 2}"/>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450" viewBox="0 0 300 450">`
    + `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h1},70%,46%)"/><stop offset="1" stop-color="hsl(${h2},75%,18%)"/></linearGradient>`
    + `<radialGradient id="l" cx="0.3" cy="0.25" r="0.8"><stop offset="0" stop-color="#fff" stop-opacity="0.35"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>`
    + `<linearGradient id="f" x1="0" y1="0" x2="0" y2="1"><stop offset="0.45" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.7"/></linearGradient></defs>`
    + `<rect width="300" height="450" fill="url(#g)"/><rect width="300" height="450" fill="url(#l)"/>${shapes}<rect width="300" height="450" fill="url(#f)"/>`
    + (info.kind ? `<text x="22" y="40" font-family="Helvetica, Arial, sans-serif" font-size="15" font-weight="700" letter-spacing="3" fill="#fff" fill-opacity="0.8">${esc(info.kind.toUpperCase())}</text>` : '')
    + lines.map((l, i) => `<text x="22" y="${y0 + i * (size + 4)}" font-family="Helvetica, Arial, sans-serif" font-size="${size}" font-weight="800" fill="#fff">${esc(l)}</text>`).join('')
    + '</svg>';
}
