// Year in review: a person's year of watching, from Tautulli's history.
// Read-only (get_users and get_history). Everyone sees their own year;
// admins can pick anyone, or everyone on the server together.
import { serviceGet as defaultGet } from './proxy.js';

const PAGE = 2000;
const MAX_ROWS = 100000;
const CACHE_MS = 10 * 60000;
const MIN_PLAY = 60; // plays shorter than a minute are accidental starts
const NIGHT_SHIFT = 5 * 3600; // plays before 5 am count for the evening before
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const tautData = (d) => (d && d.response && d.response.data) || null;
const norm = (v) => String(v || '').trim().toLowerCase();

export function validTimeZone(tz) {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return 'UTC';
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return tz; } catch { return 'UTC'; }
}

export function partsFormatter(tz) {
  return new Intl.DateTimeFormat('en-US', { timeZone: validTimeZone(tz), year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23', weekday: 'short' });
}
// Local date parts of a unix time (seconds).
export function localParts(fmt, sec) {
  const o = {};
  for (const p of fmt.formatToParts(new Date(sec * 1000))) o[p.type] = p.value;
  return { y: Number(o.year), m: Number(o.month), d: Number(o.day), hour: Number(o.hour) % 24, wd: WEEKDAYS.indexOf(o.weekday) };
}
const ymd = (p) => `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
// Every time zone's offset is a multiple of 15 minutes, so all times in the
// same 15-minute slot share a local date, hour and weekday.
export function localClock(tz) {
  const fmt = partsFormatter(tz); const memo = new Map();
  return (sec) => { const b = Math.floor(sec / 900); let v = memo.get(b); if (!v) { v = localParts(fmt, b * 900); memo.set(b, v); } return v; };
}

// Seconds actually played. Tautulli calls it play_duration (duration before 2.12).
export function playSeconds(r) {
  let s = Number(r.play_duration ?? r.duration);
  if (!Number.isFinite(s) || s <= 0) s = Number(r.stopped) - Number(r.started) - Number(r.paused_counter || 0);
  if (!Number.isFinite(s) || s < 0) return 0;
  return Math.min(s, 86400);
}
const startOf = (r) => Number(r.started || r.date) || 0;
const finished = (r) => (r.watched_status != null && r.watched_status !== '' ? Number(r.watched_status) >= 1 : Number(r.percent_complete) >= 85);
const episodeCode = (r) => (r.parent_media_index != null && r.media_index != null && r.parent_media_index !== '' ? `S${r.parent_media_index}E${r.media_index}` : '');
export function labelOf(r) {
  if (r.media_type === 'episode') return `${r.grandparent_title || 'Unknown show'}${episodeCode(r) ? ` ${episodeCode(r)}` : ''}`;
  if (r.media_type === 'live') return 'Live TV';
  return r.title || r.full_title || 'Unknown';
}

const bump = (map, key, make) => { let v = map.get(key); if (!v) { v = make(); map.set(key, v); } return v; };
const top = (map, n, by = (x) => x.seconds) => [...map.values()].sort((a, b) => by(b) - by(a) || String(a.title).localeCompare(String(b.title))).slice(0, n);

// The numbers for one person (or everyone) and one year. Pure.
export function summarizeYear(rows, { year, tz = 'UTC' } = {}) {
  const local = localClock(tz);
  const months = Array(12).fill(0); const weekdays = Array(7).fill(0); const hours = Array(24).fill(0);
  const films = new Map(); const shows = new Map(); const episodes = new Map(); const artists = new Map();
  const days = new Map(); const devices = new Map(); const people = new Set(); const binges = new Map();
  let seconds = 0; let plays = 0; let musicSeconds = 0; let first = null;
  for (const r of rows || []) {
    const at = startOf(r); if (!at) continue;
    const p = local(at); if (p.y !== year) continue;
    const secs = playSeconds(r);
    const person = String(r.user_id ?? r.user ?? '');
    if (secs < MIN_PLAY) continue;
    if (r.media_type === 'track') {
      musicSeconds += secs;
      const a = bump(artists, norm(r.grandparent_title || r.original_title), () => ({ title: r.grandparent_title || r.original_title || 'Unknown artist', seconds: 0 }));
      a.seconds += secs;
      continue;
    }
    if (!['movie', 'episode', 'live'].includes(r.media_type)) continue;
    plays += 1; seconds += secs;
    months[p.m - 1] += secs; if (p.wd >= 0) weekdays[p.wd] += secs; hours[p.hour] += secs;
    if (r.user_id != null || r.user) people.add(String(r.user_id ?? r.user));
    const ev = local(at - NIGHT_SHIFT); const day = ev.y === year ? ymd(ev) : ymd(p);
    const d = bump(days, day, () => ({ date: day, seconds: 0, night: 0, titles: new Map() }));
    d.seconds += secs; if (p.hour >= 17 || p.hour < 5) d.night += secs;
    const lbl = r.media_type === 'episode' ? (r.grandparent_title || 'Unknown show') : labelOf(r);
    d.titles.set(lbl, (d.titles.get(lbl) || 0) + secs);
    const dev = r.player || r.platform || r.product;
    if (dev) bump(devices, dev, () => ({ title: dev, seconds: 0 })).seconds += secs;
    if (!first || at < first.at) first = { at, title: labelOf(r) };
    if (r.media_type === 'movie') {
      const f = bump(films, String(r.rating_key || norm(r.title)), () => ({ title: r.title || r.full_title || 'Unknown', year: r.year ? Number(r.year) || null : null, seconds: 0, plays: 0, by: new Map(), thumb: r.thumb || '' }));
      f.seconds += secs; f.plays += 1; if (finished(r)) f.by.set(person, (f.by.get(person) || 0) + 1);
    } else if (r.media_type === 'episode') {
      const showKey = String(r.grandparent_rating_key || norm(r.grandparent_title));
      const s = bump(shows, showKey, () => ({ title: r.grandparent_title || 'Unknown show', seconds: 0, plays: 0, eps: new Set(), thumb: r.grandparent_thumb || '' }));
      const epKey = String(r.rating_key || `${showKey}:${episodeCode(r)}`);
      s.seconds += secs; s.plays += 1; s.eps.add(epKey);
      const e = bump(episodes, epKey, () => ({ show: s.title, code: episodeCode(r), title: r.title || '', by: new Map() }));
      if (finished(r)) e.by.set(person, (e.by.get(person) || 0) + 1);
      const b = bump(binges, `${day}|${showKey}`, () => ({ show: s.title, date: day, eps: new Set() }));
      b.eps.add(epKey);
    }
  }
  const dayList = [...days.values()];
  const busiest = dayList.sort((a, b) => b.seconds - a.seconds || a.date.localeCompare(b.date))[0] || null;
  const binge = [...binges.values()].sort((a, b) => b.eps.size - a.eps.size || a.date.localeCompare(b.date))[0];
  // Longest run of days in a row with something watched.
  let streak = null;
  const sorted = [...days.keys()].sort();
  for (let i = 0, run = 1; i < sorted.length; i += 1) {
    const next = sorted[i + 1];
    if (next && (Date.parse(`${next}T12:00:00Z`) - Date.parse(`${sorted[i]}T12:00:00Z`)) === 86400000) { run += 1; continue; }
    if (!streak || run > streak.days) streak = { days: run, from: sorted[i - run + 1], to: sorted[i] };
    run = 1;
  }
  // A rewatch is the same person finishing the same film or episode again
  // (two people watching it once each isn't one).
  const rewatch = (map) => [...map.values()].map((x) => ({ x, times: Math.max(0, ...x.by.values()) })).filter((v) => v.times >= 2).sort((a, b) => b.times - a.times || (b.x.seconds || 0) - (a.x.seconds || 0))[0];
  const rf = rewatch(films); const re = rewatch(episodes);
  const film = rf && { ...rf.x, finished: rf.times }; const ep = re && { ...re.x, finished: re.times };
  const maxAt = (arr) => (arr.some((v) => v > 0) ? arr.indexOf(Math.max(...arr)) : null);
  return {
    year, tz: validTimeZone(tz), empty: plays === 0 && musicSeconds === 0,
    totals: { seconds, plays, days: days.size, films: films.size, shows: shows.size, episodes: episodes.size, musicSeconds, people: people.size },
    topShows: top(shows, 5).map((s) => ({ title: s.title, seconds: s.seconds, episodes: s.eps.size, thumb: s.thumb })),
    topFilms: top(films, 5).map((f) => ({ title: f.title, year: f.year, seconds: f.seconds, plays: f.plays, thumb: f.thumb })),
    topArtists: top(artists, 3).map((a) => ({ title: a.title, seconds: a.seconds })),
    rewatched: {
      film: film ? { title: film.title, year: film.year, times: film.finished } : null,
      episode: ep ? { show: ep.show, code: ep.code, title: ep.title, times: ep.finished } : null,
    },
    busiest: busiest ? { date: busiest.date, seconds: busiest.seconds, night: busiest.night * 2 > busiest.seconds, titles: [...busiest.titles.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t]) => t) } : null,
    binge: binge && binge.eps.size >= 3 ? { show: binge.show, episodes: binge.eps.size, date: binge.date } : null,
    streak: streak && streak.days >= 2 ? streak : null,
    months, weekdays, hours, topWeekday: maxAt(weekdays), topHour: maxAt(hours),
    devices: top(devices, 3).map((d) => ({ name: d.title, seconds: d.seconds })),
    first: first ? { title: first.title, date: ymd(local(first.at)) } : null,
  };
}

// Who is this signed-in person in Tautulli? By username, then email, then
// the friendly name.
export function matchTautulliUser(users, { user, email } = {}) {
  const u = norm(user); const e = norm(email);
  if (!u && !e) return null;
  return (u && users.find((x) => norm(x.username) === u))
    || (e && users.find((x) => norm(x.email) === e))
    || (u && users.find((x) => norm(x.friendly_name) === u))
    || null;
}
const personOf = (x) => ({ id: String(x.user_id), name: x.friendly_name || x.username || `User ${x.user_id}` });

export function createYearReview({ get = defaultGet, now = () => Date.now() } = {}) {
  const cache = new Map();
  const cached = (key, load) => {
    const hit = cache.get(key);
    if (hit && now() - hit.at < CACHE_MS) return hit.value;
    const value = load().catch((e) => { cache.delete(key); throw e; });
    cache.set(key, { at: now(), value });
    if (cache.size > 50) cache.delete(cache.keys().next().value);
    return value;
  };
  const users = (svcKey, svc) => cached(`${svcKey}|users`, async () => {
    const list = tautData(await get(svc, 'api/v2?cmd=get_users', { timeout: 20000 }));
    if (!Array.isArray(list)) throw new Error('Tautulli didn’t return its user list');
    return list.filter((x) => x && x.user_id != null).map((x) => ({ user_id: x.user_id, username: x.username || '', friendly_name: x.friendly_name || '', email: x.email || '' }));
  });
  // A year of history, a day either side for time zones. Grouped, so a
  // paused and resumed play counts once.
  const history = (svcKey, svc, year, userId = null) => cached(`${svcKey}|${year}|${userId ?? 'all'}`, async () => {
    const rows = [];
    for (let start = 0; start < MAX_ROWS; start += PAGE) {
      const q = new URLSearchParams({ cmd: 'get_history', grouping: '1', after: `${year - 1}-12-31`, before: `${year + 1}-01-01`, order_column: 'date', order_dir: 'asc', start: String(start), length: String(PAGE) });
      if (userId != null) q.set('user_id', String(userId));
      const d = tautData(await get(svc, `api/v2?${q}`, { timeout: 30000 }));
      const page = (d && Array.isArray(d.data) && d.data) || [];
      for (const r of page) rows.push({ started: r.started, date: r.date, stopped: r.stopped, play_duration: r.play_duration, duration: r.duration, paused_counter: r.paused_counter, media_type: r.media_type, title: r.title, full_title: r.full_title, grandparent_title: r.grandparent_title, original_title: r.original_title, parent_media_index: r.parent_media_index, media_index: r.media_index, rating_key: r.rating_key, grandparent_rating_key: r.grandparent_rating_key, year: r.year, user_id: r.user_id, user: r.user, friendly_name: r.friendly_name, player: r.player, platform: r.platform, product: r.product, watched_status: r.watched_status, percent_complete: r.percent_complete, thumb: r.thumb, grandparent_thumb: r.grandparent_thumb });
      const total = Number(d && d.recordsFiltered);
      if (page.length < PAGE || (Number.isFinite(total) && rows.length >= total)) break;
    }
    return rows;
  });

  // viewer: { user, email } with Sign in with Plex, else null (the admin).
  async function recap({ svcKey, svc, year, tz, viewer, admin, pick }) {
    const list = await users(svcKey, svc);
    const me = viewer ? matchTautulliUser(list, viewer) : null;
    let target;
    if (pick && pick !== 'me') {
      const wanted = pick === 'all' ? 'all' : list.find((x) => String(x.user_id) === String(pick));
      if (!wanted) throw Object.assign(new Error('Tautulli doesn’t have that person.'), { status: 404 });
      if (!admin && (wanted === 'all' || !me || String(wanted.user_id) !== String(me.user_id))) throw Object.assign(new Error('Only admins can see someone else’s year.'), { status: 403 });
      target = wanted;
    } else if (viewer) {
      target = me || (admin ? 'all' : null);
      if (!target) throw Object.assign(new Error(`Tautulli doesn’t know “${viewer.user}” yet, so there’s no year to show. It tracks people by their Plex username and email.`), { status: 404, notFound: true });
    } else target = 'all';
    const rows = await history(svcKey, svc, year, admin ? null : target.user_id);
    const own = target === 'all' ? rows : rows.filter((r) => String(r.user_id) === String(target.user_id));
    const out = { year, tz: validTimeZone(tz), person: target === 'all' ? null : personOf(target), me: me ? personOf(me) : null, canPick: !!admin, recap: summarizeYear(own, { year, tz }) };
    if (admin) {
      // Everyone who watched something this year, most first.
      const local = localClock(tz); const time = new Map();
      for (const r of rows) {
        if (!['movie', 'episode', 'live'].includes(r.media_type)) continue;
        const at = startOf(r); if (!at || local(at).y !== year) continue;
        const s = playSeconds(r); if (s < MIN_PLAY) continue;
        time.set(String(r.user_id), (time.get(String(r.user_id)) || 0) + s);
      }
      out.people = list.filter((x) => time.has(String(x.user_id))).map((x) => ({ ...personOf(x), seconds: time.get(String(x.user_id)) })).sort((a, b) => b.seconds - a.seconds);
    }
    return out;
  }
  return { recap, clear: () => cache.clear() };
}

// Which year to show by default: December shows this year, January last
// year, and other months this year so far.
export function defaultYear(date = new Date()) {
  return date.getMonth() === 0 ? date.getFullYear() - 1 : date.getFullYear();
}
