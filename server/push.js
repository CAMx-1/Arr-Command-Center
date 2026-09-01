// Web push (Safari/iOS + all standards-based browsers).
//
// Uses the `web-push` library to send VAPID-authenticated push messages to
// subscribed endpoints. VAPID keys and subscriptions are persisted in
// data/store.json so they survive restarts (a rotated VAPID key would
// invalidate every existing subscription, so the keypair must be stable).
//
// iOS/Safari notes:
//  - iOS 16.4+ supports the standard Push API, but ONLY for web apps the user
//    has added to the Home Screen (display: standalone). This is handled on the
//    client; the server side is identical to every other browser.
//  - Endpoints that return 404/410 are gone for good and are pruned.
import webpush from 'web-push';
import * as store from './store.js';

const VAPID_NS = 'vapid';
const SUBS_NS = 'pushSubscriptions';
const PREFS_NS = 'pushPrefs';

// Notification categories that can be individually toggled for mobile push.
export const CATEGORIES = [
  { id: 'downloaded', label: 'Downloads completed' },
  { id: 'failed', label: 'Download failures' },
  { id: 'approval', label: 'Requests needing approval' },
];
const DEFAULT_PREFS = { downloaded: true, failed: true, approval: true };

// Which categories are enabled for push (defaults on). Persisted in the store.
export function getPrefs() {
  const saved = store.get(PREFS_NS, null);
  return { ...DEFAULT_PREFS, ...(saved && typeof saved === 'object' ? saved : {}) };
}

// Merge + persist a partial prefs update; unknown keys are ignored.
export function setPrefs(partial) {
  const current = getPrefs();
  const next = { ...current };
  for (const c of CATEGORIES) {
    if (partial && Object.prototype.hasOwnProperty.call(partial, c.id)) next[c.id] = !!partial[c.id];
  }
  store.set(PREFS_NS, next);
  return next;
}

// Is a given category currently allowed to push?
export function categoryEnabled(category) {
  if (!category) return true; // uncategorised (e.g. test) always allowed
  return getPrefs()[category] !== false;
}

let ready = false;
let publicKey = null;

// A contact URI (mailto: or https:) is required by the VAPID spec. Overridable
// via env for real deployments.
function subject() {
  return process.env.VAPID_SUBJECT || 'mailto:admin@arr-command-center.local';
}

// Load an existing VAPID keypair or generate + persist a new one.
export function initPush() {
  if (ready) return { publicKey };
  let keys = store.get(VAPID_NS, null);
  // Allow env override (e.g. shared keys across replicas).
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    keys = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  }
  if (!keys || !keys.publicKey || !keys.privateKey) {
    keys = webpush.generateVAPIDKeys();
    store.set(VAPID_NS, keys);
    console.log('[push] generated a new VAPID keypair (persisted to data/store.json)');
  }
  webpush.setVapidDetails(subject(), keys.publicKey, keys.privateKey);
  publicKey = keys.publicKey;
  ready = true;
  return { publicKey };
}

export function getPublicKey() {
  if (!ready) initPush();
  return publicKey;
}

// ---- Subscription storage -------------------------------------------------
// A subscription is the browser PushSubscription JSON: { endpoint, keys:{p256dh,auth} }.
function loadSubs() {
  const s = store.get(SUBS_NS, []);
  return Array.isArray(s) ? s : [];
}
function saveSubs(subs) { store.set(SUBS_NS, subs); return subs; }

export function listSubscriptions() { return loadSubs(); }
export function subscriptionCount() { return loadSubs().length; }

// Add (or refresh) a subscription, keyed by its unique endpoint.
export function addSubscription(sub, meta = {}) {
  if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) {
    throw new Error('Invalid push subscription');
  }
  const subs = loadSubs();
  const record = {
    endpoint: sub.endpoint,
    keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
    user: meta.user || null,
    ua: meta.ua || null,
    createdAt: Date.now(),
  };
  const idx = subs.findIndex((s) => s.endpoint === sub.endpoint);
  if (idx >= 0) subs[idx] = { ...subs[idx], ...record, createdAt: subs[idx].createdAt };
  else subs.push(record);
  saveSubs(subs);
  return { count: subs.length, refreshed: idx >= 0 };
}

export function removeSubscription(endpoint) {
  const subs = loadSubs();
  const next = subs.filter((s) => s.endpoint !== endpoint);
  saveSubs(next);
  return { removed: subs.length - next.length, count: next.length };
}

// ---- Sending --------------------------------------------------------------
// Send a payload (object -> JSON) to every stored subscription. Prunes any
// endpoints the push service reports as permanently gone (404/410).
export async function sendToAll(payload, options = {}) {
  if (!ready) initPush();
  const subs = loadSubs();
  if (!subs.length) return { sent: 0, failed: 0, pruned: 0, total: 0 };

  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const gone = [];
  let sent = 0;
  let failed = 0;

  await Promise.all(subs.map(async (sub) => {
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, body, {
        TTL: options.ttl ?? 86400,
        urgency: options.urgency || 'normal',
      });
      sent += 1;
    } catch (err) {
      failed += 1;
      const code = err && err.statusCode;
      if (code === 404 || code === 410) gone.push(sub.endpoint);
    }
  }));

  let pruned = 0;
  if (gone.length) {
    const goneSet = new Set(gone);
    const next = subs.filter((s) => !goneSet.has(s.endpoint));
    pruned = subs.length - next.length;
    saveSubs(next);
  }
  return { sent, failed, pruned, total: subs.length };
}

// Convenience: build a notification payload the service worker understands.
export function notification({ title, body, url = '/', tag, icon = '/icons/favicon.png', badge = '/icons/favicon.png' }) {
  return { title: title || 'Arr Command Center', body: body || '', url, tag, icon, badge, at: Date.now() };
}
