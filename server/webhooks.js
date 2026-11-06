// Instant updates: Sonarr, Radarr (and the other *arrs), Seerr and Tautulli
// call a secret URL on this server when something happens, so open pages
// refresh and notifications go out straight away instead of on the next
// poll. Each service has its own random token in the URL; nothing else is
// trusted from the request, and the body is only used to name the event.
import { randomBytes, timingSafeEqual } from 'node:crypto';

export const NS = 'webhooks';
export const HOOK_TYPES = ['sonarr', 'radarr', 'lidarr', 'readarr', 'whisparr', 'prowlarr', 'overseerr', 'tautulli'];
const ARR = new Set(['sonarr', 'radarr', 'lidarr', 'readarr', 'whisparr', 'prowlarr']);
const newToken = () => randomBytes(24).toString('base64url');

// What happened, in a few words, from each app's payload.
export function eventName(type, body) {
  const b = body && typeof body === 'object' ? body : {};
  if (ARR.has(type)) return String(b.eventType || 'event').slice(0, 40);
  if (type === 'overseerr') return String(b.notification_type || b.event || 'event').slice(0, 40);
  if (type === 'tautulli') return String(b.event || b.action || 'event').slice(0, 40);
  return 'event';
}
export const isTest = (name) => /^(test|test_notification)$/i.test(name);

export function createWebhooks({ cfg, store, onEvent = () => {}, now = () => Date.now() }) {
  const read = () => store.get(NS, {}) || {};
  const write = (v) => store.set(NS, v);
  const services = () => Object.entries(cfg.services || {}).filter(([, s]) => s.enabled !== false && HOOK_TYPES.includes(s.type));

  function tokenFor(key) {
    const all = read();
    if (!all[key] || !all[key].token) { all[key] = { ...(all[key] || {}), token: newToken(), count: 0 }; write(all); }
    return all[key].token;
  }
  function rotate(key) { const all = read(); all[key] = { token: newToken(), count: 0 }; write(all); return all[key].token; }
  function check(key, token) {
    const want = (read()[key] || {}).token;
    if (!want || typeof token !== 'string') return false;
    const a = Buffer.from(token); const b = Buffer.from(want);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  // Express handler for POST /api/hooks/:key/:token (no session; the token is the secret).
  function receive(req, res) {
    const key = req.params.key;
    const svc = (cfg.services || {})[key];
    if (!svc || !HOOK_TYPES.includes(svc.type) || !check(key, req.params.token)) return res.status(404).json({ error: 'Not found' });
    const name = eventName(svc.type, req.body);
    const all = read();
    all[key] = { ...all[key], lastAt: new Date(now()).toISOString(), lastEvent: name, count: (Number((all[key] || {}).count) || 0) + 1 };
    write(all);
    if (!isTest(name)) { try { onEvent({ key, svc, event: name }); } catch { /* never fail the sender */ } }
    res.json({ ok: true });
  }

  function list() {
    const all = read();
    return services().map(([key, s]) => ({ key, label: s.label || key, type: s.type, path: `/api/hooks/${encodeURIComponent(key)}/${tokenFor(key)}`, lastAt: (all[key] || {}).lastAt || null, lastEvent: (all[key] || {}).lastEvent || null, count: (all[key] || {}).count || 0 }));
  }
  return { receive, list, rotate, tokenFor, check };
}

// Debounce so a burst of events (a season pack) triggers one notification poll.
export function debounced(fn, ms = 1500) {
  let t = null;
  return () => { if (t) return; t = setTimeout(() => { t = null; fn(); }, ms); if (t.unref) t.unref(); };
}

// Sonarr/Radarr/etc.: the Connect → Webhook entry to create, from the app's
// own notification schema so every "on…" event it supports is switched on.
export function arrWebhookNotification(schema, url) {
  const tpl = (schema || []).find((s) => s.implementation === 'Webhook');
  if (!tpl) throw new Error('This app has no Webhook connection type');
  const n = { ...tpl, name: 'Arr Command Center', enable: true, tags: [] };
  delete n.id; delete n.presets;
  n.fields = (tpl.fields || []).map((f) => (f.name === 'url' ? { ...f, value: url } : f.name === 'method' ? { ...f, value: 1 } : f));
  for (const k of Object.keys(tpl)) if (/^on[A-Z]/.test(k) && tpl[`supports${k[0].toUpperCase()}${k.slice(1)}`] !== false && typeof tpl[k] === 'boolean') n[k] = true;
  return n;
}
