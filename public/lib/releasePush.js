// Send an indexer search result to Sonarr/Radarr/Lidarr/Readarr with their
// release/push API. The app parses it, checks it against the profile and, if
// it's wanted, grabs it, so it's tracked and imported like its own grabs.

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

export function pushTargets(services, cat) {
  const want = targetTypesFor(cat);
  return (services || []).filter((s) => want.includes(s.type) && s.configured !== false);
}

export function pushBody(it, { indexerName = '' } = {}) {
  return {
    title: it.title,
    downloadUrl: it.url,
    protocol: 'usenet',
    publishDate: it.pubDate ? new Date(it.pubDate).toISOString() : new Date().toISOString(),
    ...(it.size ? { size: Number(it.size) } : {}),
    ...(indexerName ? { indexer: indexerName } : {}),
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
