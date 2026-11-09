// Disk-full forecast for the disks that hold Sonarr/Radarr/Lidarr/Readarr/
// Whisparr root folders. Free space is recorded once a day per disk (from each
// app's own diskspace and rootfolder lists, so Docker paths are what the app
// sees), and a straight-line fit over the last 30 days says how fast it's
// filling. Until a disk has a week of readings, the library growth from the
// Insights snapshots stands in, but only when all of an app's root folders are
// on that disk, so that growth surely lands there.
import { serviceGet } from './proxy.js';

export const DISK_NS = 'diskSnapshots';
const ALERT_NS = 'diskAlertState';
const APPS = { sonarr: 'v3', radarr: 'v3', whisparr: 'v3', lidarr: 'v1', readarr: 'v1' };
const KEEP_DAYS = 400;
const DAY = 86400000;
const WINDOW_DAYS = 30;
export const MIN_POINTS = 5;
export const MIN_SPAN_DAYS = 6;

const day = (t) => new Date(t).toISOString().slice(0, 10);
const norm = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() || '/';
const under = (child, parent) => { const c = norm(child); const p = norm(parent); return p === '/' ? c.startsWith('/') : c === p || c.startsWith(`${p}/`); };
// Two free-space numbers read moments apart from the same disk.
const sameFree = (a, b) => a >= 0 && b >= 0 && Math.abs(a - b) <= Math.max(2 ** 30, Math.max(a, b) * 0.002);

// The disk (from the app's diskspace list) a root folder is on: the longest
// path that contains it, when its free space agrees; otherwise the one disk
// with the same free space (Docker lists mounts under other names); else null.
export function diskFor(rf, disks) {
  const list = (disks || []).filter((d) => d && d.path);
  const prefix = list.filter((d) => under(rf.path, d.path)).sort((a, b) => norm(b.path).length - norm(a.path).length)[0];
  const free = Number(rf.freeSpace);
  if (prefix && (!(free >= 0) || sameFree(Number(prefix.freeSpace), free))) return prefix;
  if (!(free >= 0)) return null;
  const same = list.filter((d) => sameFree(Number(d.freeSpace), free));
  return same.length === 1 ? same[0] : null;
}

// One app's disks that hold root folders: [{ path, label, free, total, roots, allRoots }]
export function rootDisks(rootFolders, disks) {
  const usable = (rootFolders || []).filter((r) => r && r.path && r.accessible !== false && Number(r.freeSpace) >= 0);
  const out = new Map();
  for (const rf of usable) {
    const d = diskFor(rf, disks);
    const path = d ? d.path : rf.path;
    const k = norm(path);
    const e = out.get(k) || { path, label: d ? (d.label || d.path) : rf.path, free: d ? Number(d.freeSpace) : Number(rf.freeSpace), total: d && Number(d.totalSpace) > 0 ? Number(d.totalSpace) : null, roots: [] };
    e.roots.push(rf.path);
    out.set(k, e);
  }
  const list = [...out.values()];
  for (const e of list) e.allRoots = list.length === 1;
  return list;
}

export function createDiskRecorder({ cfg, store, get = serviceGet, now = () => Date.now() }) {
  async function tick() {
    const today = day(now());
    const seen = [];
    await Promise.all(Object.entries(cfg.services || {}).map(async ([key, svc]) => {
      const v = APPS[svc.type];
      if (!v || svc.enabled === false) return;
      try {
        const [disks, roots] = await Promise.all([get(svc, `api/${v}/diskspace`, { timeout: 20000 }), get(svc, `api/${v}/rootfolder`, { timeout: 20000 })]);
        for (const d of rootDisks(roots, disks)) seen.push([`${key}|${norm(d.path)}`, { service: key, ...d }]);
      } catch { /* offline: try again next tick */ }
    }));
    if (!seen.length) return 0;
    // Today's reading is replaced on each tick, so it's always the newest.
    store.update(DISK_NS, (cur) => {
      const out = { ...(cur || {}) };
      for (const [k, d] of seen) {
        const prev = out[k] || { history: [] };
        const history = [...(prev.history || []).filter((x) => x.date !== today), { date: today, free: d.free, total: d.total }].slice(-KEEP_DAYS);
        out[k] = { service: d.service, path: d.path, label: d.label, roots: d.roots, allRoots: d.allRoots, lastDate: today, history };
      }
      return out;
    }, {});
    return seen.length;
  }
  return { tick };
}

// Least-squares slope of value per day. points: [{ t (ms), v }]
export function slopePerDay(points) {
  if (points.length < 2) return null;
  const xs = points.map((p) => p.t / DAY); const ys = points.map((p) => p.v);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length; const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0; let den = 0;
  for (let i = 0; i < xs.length; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
  return den ? num / den : null;
}

// The last 30 days of a dated series, when there's enough to fit a line.
function recent(list, field, nowMs) {
  const pts = (list || []).map((x) => ({ t: Date.parse(x.date), v: Number(x[field]) })).filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v) && nowMs - p.t <= WINDOW_DAYS * DAY);
  const span = pts.length ? (pts[pts.length - 1].t - pts[0].t) / DAY : 0;
  return { pts, span, enough: pts.length >= MIN_POINTS && span >= MIN_SPAN_DAYS };
}

export function statusOf(days, free, total) {
  if (total > 0 && free / total < 0.02) return 'full';
  if (days == null) return 'unknown';
  if (days === Infinity) return 'steady';
  if (days < 7) return 'critical';
  if (days < 30) return 'soon';
  if (days < 90) return 'watch';
  return 'ok';
}

// Forecast per physical disk. The same disk seen by two apps (Sonarr's /tv and
// Radarr's /movies on one array) is shown once: same size, same free space.
// opts.visible(serviceKey) limits it to the services a role can see.
export function forecastDisks(snaps, library, cfg, { now = Date.now(), visible = () => true } = {}) {
  const fresh = Object.entries(snaps || {})
    .filter(([, e]) => e && e.lastDate && now - Date.parse(e.lastDate) <= 3 * DAY && cfg.services[e.service] && cfg.services[e.service].enabled !== false && visible(e.service))
    .map(([key, e]) => ({ key, ...e, latest: (e.history || [])[e.history.length - 1] }))
    .filter((e) => e.latest)
    .sort((a, b) => a.key.localeCompare(b.key));
  const groups = [];
  for (const e of fresh) {
    const g = groups.find((x) => x.total > 0 && e.latest.total > 0 && Math.abs(x.total - e.latest.total) <= x.total * 0.001 && sameFree(x.free, e.latest.free));
    if (g) g.members.push(e);
    else groups.push({ key: e.key, total: e.latest.total, free: e.latest.free, members: [e] });
  }
  return groups.map((g) => {
    const best = g.members.slice().sort((a, b) => b.history.length - a.history.length)[0];
    const disk = recent(best.history, 'free', now);
    let rate = null; let method = null; let growthFrom = [];
    if (disk.enough) { rate = -slopePerDay(disk.pts); method = 'disk'; }
    else {
      for (const m of g.members.filter((x) => x.allRoots)) {
        const lib = recent((library || {})[m.service], 'bytes', now);
        if (lib.enough) { rate = (rate || 0) + Math.max(0, slopePerDay(lib.pts)); growthFrom.push(m.service); }
      }
      if (growthFrom.length) method = 'library';
    }
    const free = best.latest.free; const total = best.latest.total;
    const days = rate == null ? null : rate > 0 ? free / rate : Infinity;
    const label = best.label && best.label !== '/' ? best.label : best.path;
    return {
      key: g.key, label, path: best.path, free, total, usedPct: total > 0 ? Math.round(((total - free) / total) * 100) : null,
      rate, days: days === Infinity ? null : days, steady: days === Infinity, fillsOn: days != null && days !== Infinity ? new Date(now + days * DAY).toISOString().slice(0, 10) : null,
      method, historyDays: Math.round(disk.span), status: statusOf(days, free, total),
      services: g.members.map((m) => ({ key: m.service, label: (cfg.services[m.service] || {}).label || m.service, path: m.path, roots: m.roots })),
      history: best.history.slice(-60).map((x) => ({ date: x.date, free: x.free })),
      growthFrom,
    };
  }).sort((a, b) => (a.days ?? Infinity) - (b.days ?? Infinity) || a.label.localeCompare(b.label));
}

// "1.2 TB" style for notification text, in the same units as the page's
// fmtBytes (powers of 1024), so both say the same number.
export function bytesText(n) {
  const u = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']; let i = 0; let v = Math.abs(Number(n) || 0);
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i += 1; }
  return `${i === 0 ? Math.round(v) : v.toFixed(1)} ${u[i]}`;
}
export function forecastText(d) {
  if (d.status === 'full') return `${d.label} is full (${bytesText(d.free)} free)`;
  if (d.days == null) return `${d.label}: ${bytesText(d.free)} free`;
  const n = Math.max(1, Math.round(d.days));
  return `${d.label} fills in about ${n} ${n === 1 ? 'day' : 'days'} at the current rate (${bytesText(d.rate)} a day)`;
}

// Notification events: one when a disk's forecast drops under 30 days, one
// more under 7 days (or when it's full). Getting better doesn't alert; once
// it's back above 30 days, a later drop starts over and alerts again. Ids
// start with a service key so the per-role service lists apply.
export function diskAlertEvents(store, cfg, { now = Date.now() } = {}) {
  const list = forecastDisks(store.get(DISK_NS, {}), store.get('librarySnapshots', {}), cfg, { now });
  const state = { ...(store.get(ALERT_NS, {}) || {}) };
  const events = [];
  let changed = false;
  for (const d of list) {
    const band = d.status === 'full' || d.status === 'critical' ? 'critical' : d.status === 'soon' ? 'soon' : null;
    const s = { episode: 0, band: null, ...(state[d.key] || {}) };
    if (band && !s.band) s.episode += 1; // a new spell of "filling up"
    if (band !== s.band) { s.band = band; state[d.key] = s; changed = true; }
    if (!band) continue;
    events.push({
      id: `${d.services[0].key}:disk:${s.episode}:${band}:${d.key}`,
      category: 'problem', title: band === 'critical' ? 'Disk almost full' : 'Disk filling up',
      body: `${forecastText(d)}. Seen by ${d.services.map((x) => x.label).join(', ')}.`, url: '/#/', at: now,
    });
  }
  for (const k of Object.keys(state)) if (!list.some((d) => d.key === k)) { delete state[k]; changed = true; }
  if (changed) store.set(ALERT_NS, state);
  return events;
}

// Demo: a few weeks of readings before today's, so the forecast has a slope.
// Macintosh HD (both demo apps' /data folders) fills in about 18 days; other
// disks fill slowly or not at all.
export function seedDemoDiskHistory(store) {
  const out = { ...store.get(DISK_NS, {}) };
  for (const e of Object.values(out)) {
    if (!e || !e.history || e.history.length !== 1) continue;
    const last = e.history[0]; const t = Date.parse(last.date);
    const perDay = /macintosh/i.test(e.label) ? last.free / 18 : /movies3|archive/i.test(e.label) ? 0 : last.free / 140;
    e.history = Array.from({ length: 34 }, (_, i) => {
      const back = 34 - i;
      const wobble = ((back * 7919) % 13) / 13 - 0.5;
      return { date: day(t - back * DAY), free: Math.round(last.free + perDay * back + wobble * perDay * 0.8), total: last.total };
    }).concat(last);
  }
  store.set(DISK_NS, out);
}
