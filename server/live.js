// Live updates over Server-Sent Events.
//
// GET /api/live/:service opens an event stream for one service's activity
// (download queue or now-playing sessions). The server polls that service
// once every few seconds for all connected viewers, and sends a `change`
// event only when something visible changed (an item added, removed, paused,
// or progress moving by a whole percent). The page then re-fetches through the
// normal proxy, so roles and credentials work exactly as for any other read.
// Nothing service-specific is sent over the stream itself.

import { createHash } from 'node:crypto';

// Speeds rounded to 2 significant figures: what the list shows, without
// firing on every byte.
const rate = (v) => { const n = Number(v) || 0; return n > 0 ? Number(n.toPrecision(2)) : 0; };
const pct = (done, total) => (Number(total) > 0 ? Math.floor((Number(done) / Number(total)) * 100) : 0);

// type -> { path, signature(data) }
export const LIVE_TOPICS = {
  sonarr: arrQueue('api/v3/queue?pageSize=50'),
  radarr: arrQueue('api/v3/queue?pageSize=50'),
  whisparr: arrQueue('api/v3/queue?pageSize=50'),
  lidarr: arrQueue('api/v1/queue?pageSize=50'),
  readarr: arrQueue('api/v1/queue?pageSize=50'),
  sabnzbd: {
    path: 'api?mode=queue&output=json',
    signature: (d) => {
      const q = (d && d.queue) || {};
      return [q.paused ? 'P' : 'R', ...(q.slots || []).map((s) => `${s.nzo_id}:${s.status}:${Math.floor(Number(s.percentage) || 0)}`)];
    },
  },
  tautulli: {
    path: 'api/v2?cmd=get_activity',
    signature: (d) => {
      const data = (d && d.response && d.response.data) || {};
      return (data.sessions || []).map((s) => `${s.session_key}:${s.state}:${Math.floor(Number(s.progress_percent) || 0)}:${s.transcode_decision}`);
    },
  },
  overseerr: { path: 'api/v1/request/count', signature: (d) => [JSON.stringify(d || {})] },
  jellyfin: mediaSessions(),
  emby: mediaSessions(),
  // Download clients need session logins, so they use the proxy's client
  // fetch (`client: true`) instead of a plain GET.
  qbittorrent: {
    client: true, path: 'api/v2/torrents/info',
    signature: (d) => (Array.isArray(d) ? d : []).map((t) => `${t.hash}:${t.state}:${Math.floor((Number(t.progress) || 0) * 100)}:${rate(t.dlspeed)}:${rate(t.upspeed)}`).sort(),
  },
  transmission: {
    client: true, path: 'transmission/rpc',
    signature: (d) => (((d && d.arguments) || {}).torrents || []).map((t) => `${t.id}:${t.status}:${t.error || 0}:${Math.floor((Number(t.percentDone) || 0) * 100)}:${rate(t.rateDownload)}:${rate(t.rateUpload)}`).sort(),
  },
  deluge: {
    client: true, path: 'json',
    signature: (d) => Object.entries((d && d.torrents) || {}).map(([id, t]) => `${id}:${t.state}:${Math.floor(Number(t.progress) || 0)}:${rate(t.download_payload_rate)}:${rate(t.upload_payload_rate)}`).sort(),
  },
  flood: {
    client: true, path: 'api/torrents',
    signature: (d) => Object.entries((d && d.torrents) || {}).map(([id, t]) => `${id}:${(t.status || []).join(',')}:${Math.floor(Number(t.percentComplete) || 0)}:${rate(t.downRate)}:${rate(t.upRate)}`).sort(),
  },
  nzbget: {
    client: true, path: 'jsonrpc',
    signature: (d) => ((d && d.result) || []).map((g) => `${g.NZBID}:${g.Status}:${pct((g.FileSizeMB || 0) - (g.RemainingSizeMB || 0), g.FileSizeMB)}`),
  },
};

function arrQueue(path) {
  return {
    path,
    signature: (d) => ((d && d.records) || []).map((r) => `${r.id}:${r.status}:${r.trackedDownloadState || ''}:${pct((r.size || 0) - (r.sizeleft || 0), r.size)}`),
  };
}
function mediaSessions() {
  return {
    path: 'Sessions',
    signature: (d) => (Array.isArray(d) ? d : []).filter((s) => s.NowPlayingItem).map((s) => `${s.Id}:${s.NowPlayingItem.Id}:${s.PlayState && s.PlayState.IsPaused ? 'P' : 'R'}:${pct(s.PlayState && s.PlayState.PositionTicks, s.NowPlayingItem.RunTimeTicks)}`),
  };
}

export const liveSignature = (type, data) => {
  const topic = LIVE_TOPICS[type];
  return createHash('sha1').update(JSON.stringify(topic ? topic.signature(data) : data)).digest('hex');
};

// fetchJson(svc, path) -> data. One poller per service key, shared by every
// stream for it; it stops when the last stream closes.
export function createLiveHub({ getService, fetchJson, fetchClient, intervalMs = 3000, heartbeatMs = 25000, now = () => Date.now() }) {
  const topics = new Map(); // key -> { clients:Set<res>, timer, sig, running }

  function send(res, event, data) {
    try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch { /* closed */ }
  }

  async function tick(key) {
    const t = topics.get(key);
    if (!t || t.running) return;
    const svc = getService(key);
    const topic = svc && LIVE_TOPICS[svc.type];
    if (!topic) return;
    t.running = true;
    try {
      const data = topic.client ? await fetchClient(svc, key) : await fetchJson(svc, topic.path);
      const sig = liveSignature(svc.type, data);
      if (t.error) { t.error = null; for (const c of t.clients) send(c, 'status', { ok: true }); }
      if (sig !== t.sig) {
        const first = t.sig === undefined;
        t.sig = sig;
        if (!first) for (const c of t.clients) send(c, 'change', { at: now(), service: key });
      }
    } catch (e) {
      if (!t.error) { t.error = String(e.message || e); for (const c of t.clients) send(c, 'status', { ok: false }); }
    } finally {
      t.running = false;
    }
  }

  function subscribe(key, res, tag = false) {
    let t = topics.get(key);
    if (!t) {
      t = { clients: new Set(), sig: undefined, running: false, error: null };
      topics.set(key, t);
      t.timer = setInterval(() => tick(key), intervalMs);
      if (t.timer.unref) t.timer.unref();
      tick(key);
    }
    t.clients.add(res);
    if (tag) (res.__liveKeys || (res.__liveKeys = new Set())).add(key);
    const hb = tag ? null : setInterval(() => { try { res.write(': ping\n\n'); } catch { /* closed */ } }, heartbeatMs);
    if (hb && hb.unref) hb.unref();
    return () => {
      if (hb) clearInterval(hb);
      t.clients.delete(res);
      if (!t.clients.size) { clearInterval(t.timer); topics.delete(key); }
    };
  }

  // Express handler. `authorize(req, svc)` returns null or { status, error }.
  function handler(authorize) {
    return (req, res) => {
      const key = req.params.service;
      const svc = getService(key);
      if (!svc || svc.enabled === false || !LIVE_TOPICS[svc.type]) return res.status(404).json({ error: 'No live updates for this service' });
      const denial = authorize ? authorize(req, svc, LIVE_TOPICS[svc.type].path) : null;
      if (denial) return res.status(denial.status || 403).json({ error: denial.error });
      res.status(200).set({
        'Content-Type': 'text/event-stream; charset=utf-8',
        // no-transform keeps compression() from buffering the stream.
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.flushHeaders();
      res.write('retry: 5000\n\n');
      send(res, 'ready', { service: key, intervalMs });
      const unsubscribe = subscribe(key, res);
      req.on('close', unsubscribe);
    };
  }

  // GET /api/live?services=a,b,c — one stream for several services (the Home
  // dashboard), so a page never needs more than one connection. Services the
  // caller may not read, or that have no live topic, are skipped.
  function multiHandler(authorize, { max = 40 } = {}) {
    return (req, res) => {
      const keys = [...new Set(String(req.query.services || '').split(',').map((k) => k.trim()).filter(Boolean))].slice(0, max);
      const usable = keys.filter((key) => {
        const svc = getService(key);
        if (!svc || svc.enabled === false || !LIVE_TOPICS[svc.type]) return false;
        return !(authorize && authorize(req, svc, LIVE_TOPICS[svc.type].path));
      });
      if (!usable.length) return res.status(404).json({ error: 'No live updates for these services' });
      res.status(200).set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.flushHeaders();
      res.write('retry: 5000\n\n');
      send(res, 'ready', { services: usable, intervalMs });
      const offs = usable.map((key) => subscribe(key, res, true));
      const hb = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* closed */ } }, heartbeatMs);
      if (hb.unref) hb.unref();
      req.on('close', () => { clearInterval(hb); offs.forEach((off) => off()); });
    };
  }

  // A webhook said something changed: tell open pages now, then re-read.
  function nudge(key) {
    const t = topics.get(key);
    if (!t) return 0;
    for (const c of t.clients) send(c, 'change', { at: now(), service: key, source: 'webhook' });
    tick(key);
    return t.clients.size;
  }

  return { handler, multiHandler, subscribe, tick, nudge, size: () => topics.size, clients: (key) => (topics.get(key) ? topics.get(key).clients.size : 0) };
}
