// Sending an indexer (Newznab) or Prowlarr search result to SABnzbd or an
// *arr. Search results reach the browser with the source's API key replaced
// by "[redacted]" (see redact.js), and that includes the download links,
// which carry the key. So sends go through the server, which puts the key
// back, but only into links on the source's own host: a crafted link can't
// carry the key anywhere else. Magnet links have no key and pass through.
import { REDACTED, redactString, secretsFor } from './redact.js';

const MARKS = [REDACTED, encodeURIComponent(REDACTED)];

export function restoreIndexerLink(link, indexer) {
  const s = String(link || '');
  if (/^magnet:\?/i.test(s)) return s;
  let u;
  try { u = new URL(s); } catch { throw new Error('That isn’t a download link'); }
  if (!/^https?:$/.test(u.protocol)) throw new Error('That isn’t a download link');
  if (!MARKS.some((m) => s.includes(m))) return s; // nothing was hidden: send it as it is
  let base;
  try { base = new URL(indexer.baseUrl); } catch { throw new Error('The indexer has no valid address'); }
  if (u.hostname.toLowerCase() !== base.hostname.toLowerCase()) throw new Error(`This link is on ${u.hostname}, not on the indexer’s host, so the indexer key won’t be added to it`);
  if (!indexer.apiKey) throw new Error('The indexer has no API key');
  const key = encodeURIComponent(indexer.apiKey);
  return MARKS.reduce((out, m) => out.split(m).join(key), s);
}

// The release fields the apps' release/push API takes, from the browser's body.
export function cleanRelease(r) {
  const o = r && typeof r === 'object' ? r : {};
  const title = String(o.title || '').trim().slice(0, 500);
  if (!title) throw new Error('The result has no title');
  const at = Date.parse(o.publishDate);
  const torrent = o.protocol === 'torrent';
  const out = { title, downloadUrl: String(o.downloadUrl || ''), protocol: torrent ? 'torrent' : 'usenet', publishDate: new Date(Number.isFinite(at) ? at : Date.now()).toISOString() };
  if (torrent && o.magnetUrl) out.magnetUrl = String(o.magnetUrl).slice(0, 4000);
  if (!out.downloadUrl && !out.magnetUrl) throw new Error('The result has no download link');
  if (Number(o.size) > 0) out.size = Math.round(Number(o.size));
  if (o.indexer) out.indexer = String(o.indexer).slice(0, 100);
  if (torrent && /^[0-9a-f]{40}$/i.test(String(o.infoHash || ''))) out.infoHash = String(o.infoHash).toLowerCase();
  if (torrent && o.seeders != null) { out.seeders = Math.max(0, Math.round(Number(o.seeders) || 0)); out.leechers = Math.max(0, Math.round(Number(o.leechers) || 0)); }
  return out;
}

// Replies and errors can echo the download link; hide every key again
// before anything goes back to the browser.
export function scrub(value, ...services) {
  if (value == null) return value;
  const secrets = services.flatMap((s) => (s ? secretsFor(s) : [])).sort((a, b) => b.length - a.length);
  if (!secrets.length) return value;
  return typeof value === 'string' ? redactString(value, secrets) : JSON.parse(redactString(JSON.stringify(value), secrets));
}

// POST /api/indexer/:key/send { to, release }: :key is the Newznab indexer or
// Prowlarr the result came from; `to` is SABnzbd or an *arr.
const SEND_API = { sabnzbd: null, sonarr: 'v3', radarr: 'v3', whisparr: 'v3', lidarr: 'v1', readarr: 'v1', bindery: 'v1' };
export function createIndexerSend({ getService, canUse, serviceGet, serviceRequest }) {
  return async (req, res) => {
    const idx = getService(req.params.key);
    const b = req.body || {};
    const to = typeof b.to === 'string' ? getService(b.to) : null;
    if (!idx || !['indexer', 'prowlarr'].includes(idx.type) || idx.enabled === false) return res.status(404).json({ error: 'Unknown indexer' });
    if (!to || to.enabled === false || !(to.type in SEND_API) || !canUse(req, b.to)) return res.status(404).json({ error: 'Unknown service' });
    let release;
    try {
      release = cleanRelease(b.release);
      if (release.downloadUrl) release.downloadUrl = restoreIndexerLink(release.downloadUrl, idx);
      if (release.magnetUrl) release.magnetUrl = restoreIndexerLink(release.magnetUrl, idx);
    } catch (e) { return res.status(400).json({ error: e.message }); }
    if (to.type === 'sabnzbd' && (release.protocol !== 'usenet' || !release.downloadUrl)) return res.status(400).json({ error: 'SABnzbd only takes Usenet results' });
    try {
      if (to.type === 'sabnzbd') {
        const r = await serviceGet(to, `api?mode=addurl&name=${encodeURIComponent(release.downloadUrl)}&nzbname=${encodeURIComponent(release.title)}&output=json`);
        if (r && r.status === false) return res.status(502).json({ error: scrub(String(r.error || 'SABnzbd refused it'), idx, to) });
        return res.json({ ok: true });
      }
      const reply = await serviceRequest(to, `api/${SEND_API[to.type]}/release/push`, { method: 'POST', body: release });
      res.json({ reply: scrub(reply, idx, to) });
    } catch (e) {
      const msg = e.body && (Array.isArray(e.body) ? e.body.map((x) => x && x.errorMessage).filter(Boolean).join('; ') : e.body.message);
      res.status(502).json({ error: scrub(String(msg || e.message), idx, to) });
    }
  };
}
