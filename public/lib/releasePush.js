// Send an indexer (Newznab) or Prowlarr search result to Sonarr/Radarr/
// Lidarr/Readarr with their release/push API. The app parses it, checks it
// against the profile and, if it's wanted, grabs it, so it's tracked and
// imported like its own grabs. Torrents work too (download or magnet link).

// Which app type(s) a Newznab category belongs to, and the API version.
export function targetTypesFor(cat) {
  const n = Number(cat);
  if (n >= 2000 && n < 3000) return ['radarr'];
  if (n >= 5000 && n < 6000) return ['sonarr', 'whisparr'];
  if (n === 3030 || (n >= 7000 && n < 8000)) return ['readarr', 'bindery'];
  if (n >= 3000 && n < 4000) return ['lidarr'];
  return [];
}
const API = { sonarr: 'v3', radarr: 'v3', whisparr: 'v3', lidarr: 'v1', readarr: 'v1', bindery: 'v1' };

// `cat` is one category or a list (Prowlarr results carry several).
export function pushTargets(services, cat) {
  const want = new Set((Array.isArray(cat) ? cat : [cat]).flatMap(targetTypesFor));
  return (services || []).filter((s) => want.has(s.type) && s.configured !== false);
}

export function pushBody(it, { indexerName = '' } = {}) {
  const torrent = it.protocol === 'torrent';
  return {
    title: it.title,
    downloadUrl: it.url || '',
    ...(it.magnetUrl ? { magnetUrl: it.magnetUrl } : {}),
    protocol: torrent ? 'torrent' : 'usenet',
    publishDate: it.pubDate ? new Date(it.pubDate).toISOString() : new Date().toISOString(),
    ...(it.size ? { size: Number(it.size) } : {}),
    ...(indexerName || it.indexer ? { indexer: indexerName || it.indexer } : {}),
    ...(torrent && it.infoHash ? { infoHash: it.infoHash } : {}),
    ...(torrent && it.seeders != null ? { seeders: Number(it.seeders) || 0, leechers: Number(it.leechers) || 0 } : {}),
  };
}

// A Prowlarr search result in the shape above. The indexer is named the way
// Prowlarr names it in the apps it syncs to ("NZBgeek (Prowlarr)"), so the
// app applies that indexer's settings (seed ratio, priority) to the grab.
// Prowlarr lists the parent category with the specific one ("Audio" and
// "Audio/Audiobook"); the parent alone would offer Lidarr for an audiobook.
export function specificCategories(ids) {
  const nums = [...new Set(ids.map(Number).filter(Number.isFinite))];
  return nums.filter((n) => !(n % 1000 === 0 && n < 10000 && nums.some((m) => m !== n && Math.floor(m / 1000) === n / 1000)));
}

export function fromProwlarr(r) {
  const cats = specificCategories((r.categories || []).flatMap((c) => [c.id, ...((c.subCategories || []).map((x) => x.id))]));
  return {
    title: r.title, url: r.downloadUrl || '', magnetUrl: r.magnetUrl || '', protocol: r.protocol === 'torrent' ? 'torrent' : 'usenet',
    pubDate: r.publishDate, size: r.size, cat: cats, indexer: r.indexer ? `${r.indexer} (Prowlarr)` : '',
    infoHash: r.infoHash || '', seeders: r.seeders, leechers: r.leechers,
  };
}

// Plain-language result from the app's reply (an array of releases with
// approved / rejections).
export function describePush(reply, svc) {
  const r = Array.isArray(reply) ? reply[0] : reply;
  if (!r) return { ok: false, text: `${svc.label} didn’t return a result` };
  const rejections = (r.rejections || []).map((x) => (typeof x === 'string' ? x : x.reason)).filter(Boolean);
  if (r.approved === false || rejections.length) return { ok: false, text: `${svc.label} turned it down: ${rejections.join('; ') || 'not wanted'}` };
  const what = r.seriesTitle || r.movieTitle || (r.artist && r.artist.artistName) || (r.author && r.author.authorName) || r.title || 'it';
  return { ok: true, text: `${svc.label} is grabbing ${what}` };
}

// Through the server: results only reach the browser with the indexer key
// redacted from their links, and the server puts it back. In the iOS
// local-only mode the app talks to the indexer itself and has the real link.
export async function pushRelease(api, svc, it, { indexerKey, indexerName = '', local = false } = {}) {
  const release = pushBody(it, { indexerName });
  if (local) return describePush(await api.proxy(svc.key, `api/${API[svc.type] || 'v3'}/release/push`, { method: 'POST', body: release }), svc);
  const { reply } = await api.sendJson(`/api/indexer/${encodeURIComponent(indexerKey)}/send`, { to: svc.key, release });
  return describePush(reply, svc);
}

export async function sendToSabnzbd(api, svc, it, { indexerKey, local = false } = {}) {
  if (local) return api.sab(svc.key, { mode: 'addurl', name: it.url, nzbname: it.title });
  return api.sendJson(`/api/indexer/${encodeURIComponent(indexerKey)}/send`, { to: svc.key, release: pushBody(it) });
}
