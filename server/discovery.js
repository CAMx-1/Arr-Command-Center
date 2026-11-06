// Setup wizard: look for known apps on the hosts the admin names (plus
// localhost, the Docker host and the usual Docker container names), and,
// only when asked, every address on the server's own /24. Each candidate is
// read with plain GETs of public pages (the login page title, Plex's
// /identity, Jellyfin's public info). No API keys are read or guessed, and
// only private addresses are contacted.
import dns from 'node:dns/promises';
import os from 'node:os';
import net from 'node:net';

// type -> usual ports. Several apps share 8080/8096; the page decides which.
export const DEFAULT_PORTS = {
  sonarr: [8989], radarr: [7878], lidarr: [8686], readarr: [8787], prowlarr: [9696], whisparr: [6969],
  bazarr: [6767], tautulli: [8181], overseerr: [5055], sabnzbd: [8080, 8085], qbittorrent: [8080, 8090],
  nzbget: [6789], transmission: [9091], deluge: [8112], jellyfin: [8096], emby: [8096, 8920], plex: [32400],
  audiobookshelf: [13378], maintainerr: [6246], autobrr: [7474], navidrome: [4533], portainer: [9000],
  syncthing: [8384], glances: [61208],
};
// Common Docker container names for each type (used as host names).
const DOCKER_NAMES = { overseerr: ['overseerr', 'jellyseerr', 'seerr'], qbittorrent: ['qbittorrent', 'qbit'], sabnzbd: ['sabnzbd', 'sab'] };

// Page title → type. Order matters (Jellyseerr before Jellyfin).
const TITLES = [
  [/jellyseerr|overseerr|\bseerr\b/i, 'overseerr', 'Seerr'], [/sonarr/i, 'sonarr', 'Sonarr'], [/radarr/i, 'radarr', 'Radarr'],
  [/lidarr/i, 'lidarr', 'Lidarr'], [/readarr/i, 'readarr', 'Readarr'], [/prowlarr/i, 'prowlarr', 'Prowlarr'], [/whisparr/i, 'whisparr', 'Whisparr'],
  [/bazarr/i, 'bazarr', 'Bazarr'], [/tautulli/i, 'tautulli', 'Tautulli'], [/sabnzbd/i, 'sabnzbd', 'SABnzbd'], [/qbittorrent/i, 'qbittorrent', 'qBittorrent'],
  [/nzbget/i, 'nzbget', 'NZBGet'], [/transmission/i, 'transmission', 'Transmission'], [/deluge/i, 'deluge', 'Deluge'], [/jellyfin/i, 'jellyfin', 'Jellyfin'],
  [/\bemby\b/i, 'emby', 'Emby'], [/audiobookshelf/i, 'audiobookshelf', 'Audiobookshelf'], [/maintainerr/i, 'maintainerr', 'Maintainerr'],
  [/autobrr/i, 'autobrr', 'autobrr'], [/navidrome/i, 'navidrome', 'Navidrome'], [/portainer/i, 'portainer', 'Portainer'],
  [/syncthing/i, 'syncthing', 'Syncthing'], [/glances/i, 'glances', 'Glances'],
];
export function identifyTitle(title) {
  for (const [re, type, name] of TITLES) if (re.test(title || '')) return { type, name };
  return null;
}

export function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
  }
  if (net.isIPv6(ip)) { const l = ip.toLowerCase(); return l === '::1' || /^f[cd]/.test(l) || /^fe[89ab]/.test(l) || (l.startsWith('::ffff:') && isPrivateIp(l.slice(7))); }
  return false;
}

// Resolve a host; null when it doesn't resolve or any address is public.
export async function privateAddress(host, lookup = dns.lookup) {
  if (net.isIP(host)) return isPrivateIp(host) ? host : null;
  try {
    const all = await lookup(host, { all: true });
    if (!all.length || !all.every((a) => isPrivateIp(a.address))) return null;
    return (all.find((a) => a.family === 4) || all[0]).address;
  } catch { return null; }
}

// The server's own private /24 networks, e.g. ["192.168.1"].
export function localSubnets(ifaces = os.networkInterfaces()) {
  const out = new Set();
  for (const list of Object.values(ifaces)) for (const a of list || []) {
    if (a.family === 'IPv4' && !a.internal && isPrivateIp(a.address) && !a.address.startsWith('169.254.')) out.add(a.address.split('.').slice(0, 3).join('.'));
  }
  return [...out];
}

export function cleanHosts(input) {
  return [...new Set(String(input || '').split(/[\s,]+/).map((x) => x.trim().replace(/^https?:\/\//, '').replace(/[/:].*$/, '')).filter((x) => /^[a-z0-9.-]{1,253}$/i.test(x)))].slice(0, 20);
}

// What answers at http://host:port? Reads at most 64 KB of a public page.
export async function probe(host, port, { timeoutMs = 1200, fetchImpl = fetch } = {}) {
  const base = `http://${host.includes(':') ? `[${host}]` : host}:${port}`;
  const get = async (path) => {
    let url = base + path;
    for (let i = 0; i < 3; i++) {
      const r = await fetchImpl(url, { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs), headers: { Accept: 'text/html,application/json,application/xml' } });
      const loc = r.headers.get('location');
      if (r.status >= 300 && r.status < 400 && loc) { const next = new URL(loc, url); if (next.origin !== new URL(base).origin) return null; url = next.href; continue; }
      const text = (await r.text()).slice(0, 65536);
      return { status: r.status, text, server: r.headers.get('server') || '' };
    }
    return null;
  };
  let root;
  try { root = await get('/'); } catch { return null; }
  if (!root) return null;
  const title = (/<title[^>]*>([^<]*)<\/title>/i.exec(root.text) || [])[1] || '';
  let hit = identifyTitle(title.trim());
  let version;
  // Plex and Jellyfin/Emby have public endpoints that say exactly what they are.
  if (!hit || hit.type === 'jellyfin' || hit.type === 'emby') {
    try {
      const id = await get('/identity');
      if (id && id.status === 200) {
        let mc = null;
        try { mc = JSON.parse(id.text).MediaContainer; } catch { if (/<MediaContainer[^>]*machineIdentifier/i.test(id.text)) mc = { version: (/version="([^"]+)"/.exec(id.text) || [])[1] }; }
        if (mc && (mc.machineIdentifier || mc.version)) { hit = { type: 'plex', name: 'Plex' }; version = mc.version; }
      }
    } catch { /* not Plex */ }
  }
  if (!hit || hit.type === 'jellyfin' || hit.type === 'emby') {
    try {
      const info = await get('/System/Info/Public');
      if (info && info.status === 200) { const j = JSON.parse(info.text); if (j && j.Version && j.Id) { hit = /jellyfin/i.test(j.ProductName || '') ? { type: 'jellyfin', name: 'Jellyfin' } : { type: 'emby', name: 'Emby' }; version = j.Version; } }
    } catch { /* not Jellyfin/Emby */ }
  }
  return hit ? { ...hit, baseUrl: base, version } : null;
}

async function pool(items, n, fn) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const it = items[i++]; out.push(await fn(it)); } }));
  return out;
}

// Build the list of [host, port] pairs to try.
export async function plan({ hosts = [], subnet = false, ports = DEFAULT_PORTS, mockOnly = false, subnets = localSubnets, lookup } = {}) {
  const allPorts = [...new Set(Object.values(ports).flat())];
  const targets = []; const skipped = [];
  const add = async (host, list) => {
    const ip = await privateAddress(host, lookup);
    if (!ip) { if (hosts.includes(host)) skipped.push(host); return; }
    for (const port of list) targets.push({ host, ip, port });
  };
  if (mockOnly) { for (const port of allPorts) targets.push({ host: '127.0.0.1', ip: '127.0.0.1', port }); return { targets, skipped }; }
  for (const host of hosts) await add(host, allPorts);
  for (const host of ['localhost', 'host.docker.internal']) await add(host, allPorts);
  for (const [type, list] of Object.entries(ports)) for (const name of DOCKER_NAMES[type] || [type]) await add(name, list);
  if (subnet) for (const net24 of subnets().slice(0, 2)) for (let i = 1; i < 255; i++) targets.push({ host: `${net24}.${i}`, ip: `${net24}.${i}`, port: null, ports: allPorts });
  return { targets: targets.flatMap((t) => (t.port ? [t] : t.ports.map((port) => ({ host: t.host, ip: t.ip, port })))), skipped };
}

// Scan, drop duplicates (the same ip:port reached by two names), and mark
// what's already set up.
export async function discover({ existing = {}, timeoutMs, concurrency = 48, probeImpl = probe, ...opts } = {}) {
  const { targets, skipped } = await plan(opts);
  const seen = new Set(); const unique = [];
  for (const t of targets) { const id = `${t.ip}:${t.port}`; if (!seen.has(id)) { seen.add(id); unique.push(t); } }
  // Two /24 networks at most (see plan), so this cap never cuts a scan short.
  const capped = unique.slice(0, 20000);
  const found = (await pool(capped, concurrency, async (t) => { const r = await probeImpl(t.host, t.port, { timeoutMs }); return r ? { ...r, ip: t.ip, port: t.port } : null; })).filter(Boolean);
  const existingAt = await Promise.all(Object.entries(existing).map(async ([key, s]) => {
    try { const u = new URL(s.baseUrl); return { key, type: s.type, ip: await privateAddress(u.hostname, opts.lookup) || u.hostname, port: Number(u.port) || (u.protocol === 'https:' ? 443 : 80) }; } catch { return null; }
  }));
  for (const f of found) { const m = existingAt.find((e) => e && e.ip === f.ip && e.port === f.port); f.existing = m ? m.key : null; }
  const order = Object.keys(DEFAULT_PORTS);
  found.sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type) || a.baseUrl.localeCompare(b.baseUrl));
  return { found: found.map(({ ip, ...f }) => f), scanned: capped.length, skipped };
}

// A free config key for a new service: "sonarr", then "sonarr-2", …
export function freeKey(type, taken) {
  if (!taken.includes(type)) return type;
  for (let i = 2; ; i++) if (!taken.includes(`${type}-${i}`)) return `${type}-${i}`;
}
