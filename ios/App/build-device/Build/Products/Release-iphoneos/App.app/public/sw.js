/* Arr Command Center service worker.
 *
 * Responsibilities:
 *  - Receive Web Push messages and display them as OS notifications. This is the
 *    piece that makes notifications work on iOS/Safari (16.4+) when the app has
 *    been added to the Home Screen, as well as on desktop browsers.
 *  - Handle notification clicks by focusing an existing window or opening one.
 *
 * We intentionally do NOT cache app assets here — the dashboard is an online
 * tool and stale caches caused confusing behaviour in the past. The SW exists
 * purely for push.
 */

self.addEventListener('install', () => {
  // Activate this worker immediately instead of waiting for old tabs to close.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// A push arrived. Payload is JSON produced by server/push.js `notification()`.
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    // Fall back to plain text bodies.
    data = { title: 'Arr Command Center', body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'Arr Command Center';
  const options = {
    body: data.body || '',
    icon: data.icon || '/icons/favicon.png',
    badge: data.badge || '/icons/favicon.png',
    tag: data.tag || undefined,
    data: { url: data.url || '/' },
    timestamp: data.at || Date.now(),
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Focus an existing dashboard tab (or open a new one) when a notification is tapped.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        // If a window is already open, focus it (and navigate if possible).
        if ('focus' in client) {
          client.focus();
          if (targetUrl && 'navigate' in client && client.url !== targetUrl) {
            try { client.navigate(targetUrl); } catch { /* cross-origin or unsupported */ }
          }
          return undefined;
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
      return undefined;
    }),
  );
});

// Some browsers rotate the subscription; when that happens, re-subscribe and
// tell the server so we don't lose the endpoint.
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    try {
      const resp = await fetch('/api/push/public-key');
      const { publicKey } = await resp.json();
      if (!publicKey) return;
      const applicationServerKey = urlBase64ToUint8Array(publicKey);
      const sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
      await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: sub }),
      });
    } catch (e) {
      // Best effort; the client will re-subscribe on next app open.
    }
  })());
});

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = self.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}
