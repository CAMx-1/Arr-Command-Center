// arrcc:// deep links and home-screen quick actions (native app).
//
// Link formats (all navigation only: a link can never add, delete or change
// anything, so a malicious page or app opening one can't do harm):
//   arrcc://search?q=dune&type=movie   open Search (type: all | movie | tv)
//   arrcc://calendar | arrcc://settings | arrcc://cleanup | arrcc://home
//   arrcc://service/<key>?tab=queue     a configured service, optional tab
//
// parseDeepLink and quickActionItems are pure so they can be unit-tested.

const STATIC_ROUTES = new Set(['home', 'calendar', 'settings', 'cleanup']);
const SEARCH_TYPES = new Set(['all', 'movie', 'tv']);
const TAB_RE = /^[a-z][a-z0-9-]{0,31}$/;
const DOWNLOAD_TYPES = ['sabnzbd', 'qbittorrent', 'transmission', 'deluge', 'nzbget', 'flood'];

/**
 * @param {string} raw
 * @param {{ serviceKeys?: string[] }} known
 * @returns {null | { kind: 'search', q: string, type: string } | { kind: 'route', route: string, params: object }}
 */
export function parseDeepLink(raw, { serviceKeys = [] } = {}) {
  let u;
  try { u = new URL(String(raw)); } catch { return null; }
  if (u.protocol !== 'arrcc:') return null;
  // arrcc://search → host "search"; tolerate arrcc:search and arrcc:///search too.
  const parts = [u.hostname, ...u.pathname.split('/')].map((p) => decodeURIComponent(p || '').trim()).filter(Boolean);
  const [head, arg] = parts;
  if (!head) return { kind: 'route', route: 'home', params: {} };
  if (head === 'search') {
    const q = (u.searchParams.get('q') || '').slice(0, 120);
    const t = u.searchParams.get('type') || 'all';
    return { kind: 'search', q, type: SEARCH_TYPES.has(t) ? t : 'all' };
  }
  if (STATIC_ROUTES.has(head)) return { kind: 'route', route: head, params: {} };
  if (head === 'service' && arg && serviceKeys.includes(arg)) {
    const tab = u.searchParams.get('tab');
    return { kind: 'route', route: arg, params: tab && TAB_RE.test(tab) ? { tab } : {} };
  }
  return null;
}

/** Up to 4 quick actions for the configured services. */
export function quickActionItems(services = []) {
  const items = [{ type: 'search', title: 'Search', subtitle: 'Libraries and new titles', icon: 'magnifyingglass', url: 'arrcc://search' }];
  const has = (t) => services.find((s) => s.type === t && s.enabled !== false);
  if (has('radarr') || has('overseerr') || has('seerr')) items.push({ type: 'add-movie', title: 'Add a movie', icon: 'plus.circle', url: 'arrcc://search?type=movie' });
  const dl = services.find((s) => DOWNLOAD_TYPES.includes(s.type) && s.enabled !== false);
  const arr = has('sonarr') || has('radarr');
  if (dl) items.push({ type: 'downloads', title: 'Downloads', subtitle: dl.label || dl.key, icon: 'arrow.down.circle', url: `arrcc://service/${encodeURIComponent(dl.key)}` });
  else if (arr) items.push({ type: 'queue', title: 'Queue', subtitle: arr.label || arr.key, icon: 'arrow.down.circle', url: `arrcc://service/${encodeURIComponent(arr.key)}?tab=queue` });
  items.push({ type: 'calendar', title: 'Calendar', subtitle: 'Upcoming releases', icon: 'calendar', url: 'arrcc://calendar' });
  return items.slice(0, 4);
}

const plugin = (name) => globalThis.window?.Capacitor?.Plugins?.[name] || null;

/**
 * Wire links and quick actions (native app only). `open(link)` performs a
 * parsed link; `services` is the current service list.
 */
export async function installDeepLinks({ services, open, onError = () => {} }) {
  const app = plugin('App');
  const quick = plugin('QuickActions');
  if (!app && !quick) return;
  const keys = () => services().map((s) => s.key);
  const handle = (url) => {
    const link = parseDeepLink(url, { serviceKeys: keys() });
    if (link) open(link); else onError(url);
  };
  try { if (app?.addListener) await app.addListener('appUrlOpen', (e) => e && e.url && handle(e.url)); } catch { /* ignore */ }
  try { if (quick?.setItems) await quick.setItems({ items: quickActionItems(services()) }); } catch { /* ignore */ }
  // Cold launch: a quick action or link that started the app.
  try {
    const pending = quick?.getPending ? await quick.getPending() : null;
    if (pending && pending.url) return handle(pending.url);
    const launch = app?.getLaunchUrl ? await app.getLaunchUrl() : null;
    if (launch && launch.url && launch.url.startsWith('arrcc:')) handle(launch.url);
  } catch { /* ignore */ }
}

/** Refresh the quick actions after services change (Settings). */
export async function refreshQuickActions(services) {
  try { await plugin('QuickActions')?.setItems?.({ items: quickActionItems(services) }); } catch { /* ignore */ }
}
