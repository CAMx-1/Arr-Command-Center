// Sending an indexer search result to SABnzbd or an *arr.
// Search results reach the browser with the indexer's API key replaced by
// "[redacted]" (see redact.js), and that includes the download links, which
// carry the key. So sends go through the server, which puts the key back,
// but only into links on the indexer's own host: a crafted link can't carry
// the key anywhere else.
import { REDACTED, redactString, secretsFor } from './redact.js';

const MARKS = [REDACTED, encodeURIComponent(REDACTED)];

export function restoreIndexerLink(link, indexer) {
  const s = String(link || '');
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
  const out = { title, downloadUrl: String(o.downloadUrl || ''), protocol: 'usenet', publishDate: new Date(Number.isFinite(at) ? at : Date.now()).toISOString() };
  if (Number(o.size) > 0) out.size = Math.round(Number(o.size));
  if (o.indexer) out.indexer = String(o.indexer).slice(0, 100);
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
