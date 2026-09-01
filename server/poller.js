// Server-side background poller.
//
// Periodically polls configured services for notable events (Sonarr/Radarr
// download imports & failures, Overseerr pending approvals) and sends a web-push
// notification for each NEW event, so users get mobile alerts even when the app
// is closed.
//
// Design notes:
//  - Dedup: every event has a stable id; ids we've already handled are kept in
//    the store (`pushSeen`) so an event is pushed at most once.
//  - Baseline on first run: the very first poll after a fresh start records the
//    current events as "seen" WITHOUT pushing, so we don't blast the user with a
//    backlog of historical items. Subsequent polls push only genuinely new ones.
//  - Category toggles: users can disable categories (see push.getPrefs). Disabled
//    events are still marked seen (so re-enabling doesn't replay old items).
import * as store from './store.js';
import * as push from './push.js';
import { serviceGet } from './proxy.js';

const SEEN_NS = 'pushSeen';
const SEEN_CAP = 500;

const pad = (n) => String(n).padStart(2, '0');

// Collect the current set of notable events across all enabled services.
export async function collectEvents(cfg) {
  const events = [];
  const entries = Object.entries(cfg.services || {}).filter(([, s]) => s.enabled !== false && s.baseUrl);

  await Promise.all(entries.map(async ([key, svc]) => {
    const s = { ...svc, key };
    try {
      if (svc.type === 'sonarr' || svc.type === 'radarr') {
        const inc = svc.type === 'sonarr' ? 'includeSeries=true&includeEpisode=true' : 'includeMovie=true';
        const data = await serviceGet(s, `api/v3/history?page=1&pageSize=25&sortKey=date&sortDirection=descending&${inc}`);
        for (const r of (data.records || [])) {
          if (r.eventType !== 'downloadFolderImported' && r.eventType !== 'downloadFailed') continue;
          const title = svc.type === 'sonarr'
            ? (((r.series && r.series.title) || r.sourceTitle) + (r.episode ? ` S${pad(r.episode.seasonNumber)}E${pad(r.episode.episodeNumber)}` : ''))
            : ((r.movie && r.movie.title) || r.sourceTitle);
          const failed = r.eventType === 'downloadFailed';
          events.push({
            id: `${key}:hist:${r.id}`,
            category: failed ? 'failed' : 'downloaded',
            title: failed ? 'Download failed' : 'Downloaded',
            body: `${svc.label}: ${title}`,
            url: '/',
            at: new Date(r.date).getTime() || Date.now(),
          });
        }
      } else if (svc.type === 'overseerr') {
        const data = await serviceGet(s, 'api/v1/request?filter=pending&take=20');
        for (const r of (data.results || [])) {
          const media = r.media || {};
          const t = media.title || media.name || `#${media.tmdbId || '?'}`;
          const who = (r.requestedBy && (r.requestedBy.displayName || r.requestedBy.email)) || '';
          events.push({
            id: `${key}:approval:${r.id}`,
            category: 'approval',
            title: 'Request needs approval',
            body: `${svc.label}: ${t}${who ? ` · ${who}` : ''}`,
            url: '/',
            at: new Date(r.createdAt).getTime() || Date.now(),
          });
        }
      }
    } catch { /* ignore per-service failures; other services still poll */ }
  }));

  events.sort((a, b) => b.at - a.at);
  return events;
}

function loadSeen() {
  const s = store.get(SEEN_NS, null);
  return s === null ? null : (Array.isArray(s) ? s : []);
}

// Poll once: collect events, push newly-seen ones (respecting category prefs),
// and update the dedup set. Returns a summary for diagnostics/tests.
//   opts.force  — push fresh events even on the first (baseline) run.
export async function pollOnce(cfg, opts = {}) {
  const events = await collectEvents(cfg);
  const seenArr = loadSeen();
  const firstRun = seenArr === null;
  const seen = new Set(seenArr || []);

  const fresh = events.filter((e) => !seen.has(e.id));

  let pushed = 0;
  let skipped = 0;
  const results = [];
  const doPush = opts.force || !firstRun;

  if (doPush) {
    for (const e of fresh) {
      if (!push.categoryEnabled(e.category)) { skipped += 1; continue; }
      try {
        const r = await push.sendToAll(push.notification({ title: e.title, body: e.body, url: e.url, tag: e.id }));
        results.push({ id: e.id, ...r });
        pushed += 1;
      } catch (err) {
        results.push({ id: e.id, error: err.message });
      }
    }
  }

  // Mark every current event as seen (fresh ones included) so nothing repeats.
  const nextSeen = Array.from(new Set([...events.map((e) => e.id), ...seen])).slice(0, SEEN_CAP);
  store.set(SEEN_NS, nextSeen);

  return { collected: events.length, fresh: fresh.length, pushed, skipped, firstRun, baseline: firstRun && !opts.force, results };
}

// Start the periodic loop. Returns a handle with stop().
export function startPoller(cfg, opts = {}) {
  const intervalMs = Math.max(15, Number(opts.intervalSeconds) || 60) * 1000;
  let running = false;

  const tick = async () => {
    if (running) return; // avoid overlap on slow upstreams
    running = true;
    try {
      const r = await pollOnce(cfg);
      if (r.pushed) console.log(`[poller] pushed ${r.pushed} notification(s) (${r.collected} events, ${r.fresh} new)`);
    } catch (e) {
      console.error('[poller] poll failed:', e.message);
    } finally {
      running = false;
    }
  };

  // Baseline shortly after boot, then on the interval.
  const kickoff = setTimeout(tick, (Number(opts.initialDelaySeconds) || 5) * 1000);
  const timer = setInterval(tick, intervalMs);
  if (timer.unref) timer.unref();
  if (kickoff.unref) kickoff.unref();

  console.log(`[poller] started — polling every ${intervalMs / 1000}s for push notifications`);
  return {
    stop() { clearInterval(timer); clearTimeout(kickoff); },
    tick,
  };
}
