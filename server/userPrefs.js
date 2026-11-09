// Settings that follow you: a person's look-and-layout settings (theme,
// colour, density, pinned services, service order and hidden services,
// Home workspaces, list or hexagon views) saved on the server, so every
// browser they sign in on matches. Values are the browser's own
// localStorage strings; the browser checks them again when it reads them.
//
// Saved per Plex user, or as one shared profile with Basic auth. With no
// sign-in there's no "you" to save them for, so it's off.
import express from 'express';

export const PREF_NAMES = new Set([
  'theme', 'accent', 'acc:density', 'bn:pinned', 'svc-hidden', 'svc-order',
  'view-mode', 'activity-sources', 'upcoming-view', 'dashboards',
]);
const PAGE_RE = /^view-mode:[a-z0-9_-]{1,40}$/i;
export const LIMITS = { value: 100_000, total: 200_000, pages: 40 };
const NS = 'userPrefs';

export const allowedName = (n) => typeof n === 'string' && (PREF_NAMES.has(n) || PAGE_RE.test(n));

// Merge a change set into saved prefs. Returns { prefs, ignored } or throws
// an Error with a status.
export function mergePrefs(saved, set) {
  if (!set || typeof set !== 'object' || Array.isArray(set)) throw Object.assign(new Error('Expected { set: { name: value } }'), { status: 400 });
  const prefs = { ...saved }; const ignored = [];
  for (const [name, value] of Object.entries(set)) {
    if (!allowedName(name)) { ignored.push(name); continue; }
    if (value === null) { delete prefs[name]; continue; }
    if (typeof value !== 'string') throw Object.assign(new Error(`“${name}” must be text`), { status: 400 });
    if (value.length > LIMITS.value) throw Object.assign(new Error(`“${name}” is too big to save`), { status: 413 });
    prefs[name] = value;
  }
  const pages = Object.keys(prefs).filter((n) => PAGE_RE.test(n));
  if (pages.length > LIMITS.pages) throw Object.assign(new Error('Too many page views to save'), { status: 413 });
  const total = Object.values(prefs).reduce((n, v) => n + v.length, 0);
  if (total > LIMITS.total) throw Object.assign(new Error('These settings are too big to save'), { status: 413 });
  return { prefs, ignored };
}

// whoOf(req) → { key, label } for the signed-in person, or null.
export function createUserPrefs({ store, whoOf, now = () => Date.now() }) {
  const all = () => { const v = store.get(NS, {}); return v && typeof v === 'object' ? v : {}; };
  const read = (key) => {
    const r = all()[key];
    return r && typeof r === 'object' ? { rev: Number(r.rev) || 0, prefs: r.prefs && typeof r.prefs === 'object' ? r.prefs : {}, at: r.at || null } : { rev: 0, prefs: {}, at: null };
  };
  const write = (key, rec) => store.update(NS, (cur) => ({ ...(cur && typeof cur === 'object' ? cur : {}), [key]: rec }), {});
  const shape = (who, r, extra = {}) => ({ available: true, who: who.label, id: who.key, rev: r.rev, at: r.at, prefs: r.prefs, ...extra });
  const unavailable = { available: false, reason: 'Needs a sign-in (Sign in with Plex or a password), so the server knows whose settings they are.' };

  const router = express.Router();
  router.use(express.json({ limit: '256kb' }));
  router.get('/', (req, res) => {
    const who = whoOf(req);
    if (!who) return res.json(unavailable);
    res.json(shape(who, read(who.key)));
  });
  router.put('/', (req, res) => {
    const who = whoOf(req);
    if (!who) return res.status(400).json(unavailable);
    const cur = read(who.key);
    // A browser sends the revision its changes are based on; if another
    // browser saved in between, it gets the newer copy back to merge first.
    const base = req.body && req.body.rev;
    if (base !== undefined && base !== cur.rev) return res.status(409).json({ error: 'Changed on another browser', conflict: true, ...shape(who, cur) });
    let merged;
    try { merged = mergePrefs(cur.prefs, req.body && req.body.set); }
    catch (e) { return res.status(e.status || 400).json({ error: e.message }); }
    const next = { rev: cur.rev + 1, at: now(), prefs: merged.prefs };
    write(who.key, next);
    res.json(shape(who, next, merged.ignored.length ? { ignored: merged.ignored } : {}));
  });
  return { router, read };
}
