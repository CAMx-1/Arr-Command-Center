// Client-side Web Push: registers the service worker, captures a PushSubscription
// (this is the "capture push subscriptions from Safari" piece) and syncs it with
// the server. Works on desktop browsers and on iOS 16.4+ once the app is added
// to the Home Screen (standalone display mode).

export function isSupported() {
  return typeof navigator !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window;
}

// iOS only allows the Push API when the web app is launched from the Home Screen.
export function isStandalone() {
  return window.navigator.standalone === true
    || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
}

// Rough iOS detection (incl. iPadOS reporting as Mac with touch).
export function isIOS() {
  const ua = navigator.userAgent || '';
  return /iphone|ipad|ipod/i.test(ua)
    || (/(macintosh)/i.test(ua) && 'ontouchend' in document);
}

export function permission() {
  return isSupported() ? Notification.permission : 'unsupported';
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) throw new Error('Service workers are not supported here');
  return navigator.serviceWorker.register('/sw.js', { scope: '/' });
}

async function getRegistration() {
  return (await navigator.serviceWorker.getRegistration()) || registerServiceWorker();
}

// Current push status, for rendering the settings toggle.
export async function getStatus() {
  const supported = isSupported();
  const base = { supported, standalone: isStandalone(), ios: isIOS(), permission: supported ? Notification.permission : 'unsupported', subscribed: false };
  if (!supported) return base;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg) {
      const sub = await reg.pushManager.getSubscription();
      base.subscribed = !!sub;
    }
  } catch { /* ignore */ }
  return base;
}

// Enable push: register SW, request permission, subscribe, and persist server-side.
export async function enable() {
  if (!isSupported()) throw new Error('Push notifications are not supported in this browser');
  if (isIOS() && !isStandalone()) {
    throw new Error('On iOS, add this site to your Home Screen first, then open it from there to enable notifications.');
  }

  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Notification permission was not granted');

  const reg = await getRegistration();
  await navigator.serviceWorker.ready;

  const resp = await fetch('/api/push/public-key');
  if (!resp.ok) throw new Error('Could not fetch the server push key');
  const { publicKey } = await resp.json();
  if (!publicKey) throw new Error('Server has no VAPID public key');

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
  }

  const save = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscription: sub.toJSON() }),
  });
  if (!save.ok) {
    const e = await save.json().catch(() => ({}));
    throw new Error(e.error || 'Failed to store subscription on the server');
  }
  return true;
}

// Disable push: unsubscribe locally and tell the server to drop the endpoint.
export async function disable() {
  if (!isSupported()) return true;
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return true;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return true;
  const endpoint = sub.endpoint;
  try { await sub.unsubscribe(); } catch { /* ignore */ }
  await fetch('/api/push/unsubscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint }),
  }).catch(() => {});
  return true;
}

// Ask the server to send a test notification to all subscriptions.
export async function sendTest() {
  const resp = await fetch('/api/push/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.error || 'Test failed');
  return data;
}

// Per-category notification preferences (which event types push to mobile).
export async function getPrefs() {
  const resp = await fetch('/api/push/prefs');
  if (!resp.ok) throw new Error('Could not load notification preferences');
  return resp.json(); // { categories: [{id,label}], prefs: {id:bool} }
}

export async function setPrefs(prefs) {
  const resp = await fetch('/api/push/prefs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefs }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.error || 'Could not save preferences');
  return data.prefs;
}
