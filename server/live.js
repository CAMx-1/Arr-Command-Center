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
  jellyfin: mediaSessions(),
  emby: mediaSessions(),
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
export function createLiveHub({ getService, fetchJson, intervalMs = 3000, heartbeatMs = 25000, now = () => Date.now() }) {
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
      const data = await fetchJson(svc, topic.path);
      const sig = liveSignature(svc.type, data);
      if (t.error) { t.error = null; for (const c of t.clients) send(c, 'status', { ok: true }); }
      if (sig !== t.sig) {
        const first = t.sig === undefined;
        t.sig = sig;
        if (!first) for (const c of t.clients) send(c, 'change', { at: now() });
      }
    } catch (e) {
      if (!t.error) { t.error = String(e.message || e); for (const c of t.clients) send(c, 'status', { ok: false }); }
    } finally {
      t.running = false;
    }
  }

  function subscribe(key, res) {
    let t = topics.get(key);
    if (!t) {
      t = { clients: new Set(), sig: undefined, running: false, error: null };
      topics.set(key, t);
      t.timer = setInterval(() => tick(key), intervalMs);
      if (t.timer.unref) t.timer.unref();
      tick(key);
    }
    t.clients.add(res);
    const hb = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* closed */ } }, heartbeatMs);
    if (hb.unref) hb.unref();
    return () => {
      clearInterval(hb);
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

  return { handler, subscribe, tick, size: () => topics.size, clients: (key) => (topics.get(key) ? topics.get(key).clients.size : 0) };
}
