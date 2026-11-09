// Posters for the year in review, loaded through Tautulli by this server.
// Links are signed, so only Plex images the server put into someone's year
// can be fetched. The images come through Tautulli, so no Plex or Tautulli
// key ever reaches the browser.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { serviceFetch as defaultFetch } from './proxy.js';

export const POSTER_PATH = /^\/library\/metadata\/\d{1,12}\/(thumb|art)(\/\d{1,20})?$/;

export function createPosterLinks(secret) {
  const sig = (thumb) => createHmac('sha256', String(secret)).update(`recap-poster|${thumb}`).digest('base64url').slice(0, 22);
  return {
    url: (thumb) => (POSTER_PATH.test(String(thumb)) ? `/api/recap/poster?p=${encodeURIComponent(thumb)}&s=${sig(thumb)}` : null),
    check(thumb, given) {
      if (!POSTER_PATH.test(String(thumb))) return false;
      const a = Buffer.from(String(given || '')); const b = Buffer.from(sig(thumb));
      return a.length === b.length && timingSafeEqual(a, b);
    },
  };
}

// GET /api/recap/poster?p=<plex path>&s=<signature>&w=<width>
export function posterHandler({ links, tautulli, fetchImage = defaultFetch }) {
  return async (req, res) => {
    const thumb = String(req.query.p || '');
    if (!links.check(thumb, req.query.s)) return res.status(404).end();
    const tau = tautulli();
    if (!tau) return res.status(404).end();
    const w = Math.max(80, Math.min(900, Math.round(Number(req.query.w) || 400)));
    try {
      const q = new URLSearchParams({ cmd: 'pms_image_proxy', img: thumb, width: String(w), height: String(Math.round(w * 1.5)), fallback: 'poster' });
      const r = await fetchImage(tau[1], `api/v2?${q}`, { timeout: 15000, maxBytes: 4 * 1024 * 1024 });
      if (!r.ok || !/^image\//.test(r.type)) return res.status(404).end();
      res.set('Content-Type', r.type); res.set('Cache-Control', 'private, max-age=86400'); res.set('X-Content-Type-Options', 'nosniff');
      // An image opened on its own (an SVG, say) can't run anything here.
      res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
      return res.send(r.body);
    } catch { return res.status(502).end(); }
  };
}
