// Automation: Queue Cleaner + scheduled Hunting across all *arr instances.
//
// - Queue Cleaner: flags stalled/errored downloads, applies a strike each run,
//   and removes items once they reach the strike threshold (optionally from the
//   download client + blocklist). Dry-run previews without changing anything.
// - Hunting: periodically triggers a search for a batch of wanted/missing (and
//   optionally cutoff-unmet) items on each instance.
//
// Runs server-side (via a tick from index.js) so it works even when no browser
// is open. Config + strike state + last-run summaries persist in data/store.json.
import * as store from './store.js';
import { serviceGet, serviceRequest } from './proxy.js';

const CFG_NS = 'automation';
const STRIKES_NS = 'automationStrikes';
const RUN_NS = 'automationRuns';

const ARR_TYPES = ['sonarr', 'radarr', 'lidarr', 'readarr'];
const apiBase = (type) => (type === 'lidarr' || type === 'readarr') ? 'api/v1' : 'api/v3';

const DEFAULT_CONFIG = {
  queueCleaner: { enabled: false, dryRun: true, maxStrikes: 3, removeFromClient: true, blocklist: false, intervalMinutes: 15 },
  hunting: { enabled: false, mode: 'missing', batchSize: 5, intervalMinutes: 360 },
};

const log = []; // recent run summaries (in-memory ring)
function pushLog(entry) { log.unshift(entry); if (log.length > 50) log.pop(); }

export function getConfig() {
  const saved = store.get(CFG_NS, null) || {};
  return {
    queueCleaner: { ...DEFAULT_CONFIG.queueCleaner, ...(saved.queueCleaner || {}) },
    hunting: { ...DEFAULT_CONFIG.hunting, ...(saved.hunting || {}) },
  };
}
export function setConfig(partial) {
  const cur = getConfig();
  const next = {
    queueCleaner: { ...cur.queueCleaner, ...((partial && partial.queueCleaner) || {}) },
    hunting: { ...cur.hunting, ...((partial && partial.hunting) || {}) },
  };
  // Coerce numeric/boolean fields defensively.
  next.queueCleaner.maxStrikes = Math.max(1, Math.min(20, Number(next.queueCleaner.maxStrikes) || 3));
  next.queueCleaner.intervalMinutes = Math.max(1, Number(next.queueCleaner.intervalMinutes) || 15);
  next.queueCleaner.enabled = !!next.queueCleaner.enabled;
  next.queueCleaner.dryRun = !!next.queueCleaner.dryRun;
  next.queueCleaner.removeFromClient = !!next.queueCleaner.removeFromClient;
  next.queueCleaner.blocklist = !!next.queueCleaner.blocklist;
  next.hunting.batchSize = Math.max(1, Math.min(50, Number(next.hunting.batchSize) || 5));
  next.hunting.intervalMinutes = Math.max(5, Number(next.hunting.intervalMinutes) || 360);
  next.hunting.enabled = !!next.hunting.enabled;
  next.hunting.mode = ['missing', 'cutoff', 'both'].includes(next.hunting.mode) ? next.hunting.mode : 'missing';
  store.set(CFG_NS, next);
  return next;
}

function arrInstances(cfg) {
  return Object.entries(cfg.services || {})
    .filter(([, s]) => s.enabled !== false && s.baseUrl && ARR_TYPES.includes(s.type))
    .map(([key, s]) => ({ ...s, key }));
}

// Heuristics for a "problem" download worth cleaning.
function stallReason(item) {
  const msgs = [(item.errorMessage || '')]
    .concat((item.statusMessages || []).flatMap((m) => [m.title || '', ...((m.messages) || [])]))
    .join(' ');
  const status = String(item.status || '').toLowerCase();
  const tds = String(item.trackedDownloadStatus || '').toLowerCase();
  if (/stalled|no connections|no files found|not found|failed|error/i.test(msgs)) return msgs.trim().slice(0, 140);
  if (status === 'warning' || status === 'stalled' || status === 'failed') return `status: ${item.status}`;
  if (tds === 'warning' || tds === 'error') return `tracked status: ${item.trackedDownloadStatus}`;
  return null;
}

// ---- Queue Cleaner --------------------------------------------------------
export async function runQueueCleanerOnce(cfg, opts = {}) {
  const c = getConfig().queueCleaner;
  const dryRun = opts.dryRun != null ? !!opts.dryRun : c.dryRun;
  const strikes = { ...(store.get(STRIKES_NS, {}) || {}) };
  const result = { at: Date.now(), type: 'queueCleaner', dryRun, instances: 0, checked: 0, flagged: 0, removed: 0, items: [] };
  const liveKeys = new Set();

  for (const svc of arrInstances(cfg)) {
    const base = apiBase(svc.type);
    let data;
    try { data = await serviceGet(svc, `${base}/queue?page=1&pageSize=100&includeUnknownSeriesItems=true&includeUnknownMovieItems=true`); }
    catch (e) { result.items.push({ svc: svc.label, error: e.message }); continue; }
    const records = Array.isArray(data) ? data : (data.records || []);
    result.instances += 1;
    for (const rec of records) {
      result.checked += 1;
      const key = `${svc.key}:${rec.downloadId || rec.id}`;
      liveKeys.add(key);
      const reason = stallReason(rec);
      if (!reason) { delete strikes[key]; continue; }
      const n = (strikes[key] || 0) + 1;
      strikes[key] = n;
      result.flagged += 1;
      const item = { svc: svc.label, title: rec.title || `#${rec.id}`, strikes: n, max: c.maxStrikes, reason };
      if (n >= c.maxStrikes) {
        if (dryRun) { item.action = 'would remove'; }
        else {
          try {
            await serviceRequest(svc, `${base}/queue/${rec.id}?removeFromClient=${c.removeFromClient}&blocklist=${c.blocklist}`, { method: 'DELETE' });
            item.action = 'removed'; result.removed += 1; delete strikes[key];
          } catch (e) { item.action = 'error'; item.error = e.message; }
        }
      } else { item.action = dryRun ? 'would strike' : 'struck'; }
      result.items.push(item);
    }
  }
  // Forget strikes for items no longer in any queue.
  for (const k of Object.keys(strikes)) if (!liveKeys.has(k)) delete strikes[k];
  if (!dryRun) { store.set(STRIKES_NS, strikes); recordRun('queueCleaner', result); }
  pushLog(result);
  return result;
}

// ---- Hunting --------------------------------------------------------------
function huntCommand(type, ids) {
  switch (type) {
    case 'sonarr': return { name: 'EpisodeSearch', episodeIds: ids };
    case 'radarr': return { name: 'MoviesSearch', movieIds: ids };
    case 'lidarr': return { name: 'AlbumSearch', albumIds: ids };
    case 'readarr': return { name: 'BookSearch', bookIds: ids };
    default: return { name: 'MissingSearch' };
  }
}
export async function runHuntOnce(cfg, opts = {}) {
  const c = getConfig().hunting;
  const mode = opts.mode || c.mode;
  const batch = opts.batchSize || c.batchSize;
  const result = { at: Date.now(), type: 'hunting', mode, instances: 0, searched: 0, items: [] };

  for (const svc of arrInstances(cfg)) {
    const base = apiBase(svc.type);
    const collectIds = async (which) => {
      try {
        const data = await serviceGet(svc, `${base}/wanted/${which}?page=1&pageSize=${batch}`);
        return (data.records || []).map((r) => r.id).filter((x) => x != null);
      } catch { return []; }
    };
    let ids = [];
    if (mode === 'missing' || mode === 'both') ids = ids.concat(await collectIds('missing'));
    if (mode === 'cutoff' || mode === 'both') ids = ids.concat(await collectIds('cutoff'));
    ids = Array.from(new Set(ids)).slice(0, batch);
    result.instances += 1;
    if (!ids.length) { result.items.push({ svc: svc.label, count: 0 }); continue; }
    const cmd = huntCommand(svc.type, ids);
    try {
      await serviceRequest(svc, `${base}/command`, { method: 'POST', body: cmd });
      result.searched += ids.length;
      result.items.push({ svc: svc.label, count: ids.length, command: cmd.name });
    } catch (e) { result.items.push({ svc: svc.label, error: e.message }); }
  }
  recordRun('hunting', result);
  pushLog(result);
  return result;
}

function recordRun(kind, result) {
  const runs = store.get(RUN_NS, {}) || {};
  runs[kind] = { at: result.at, summary: summarize(kind, result) };
  store.set(RUN_NS, runs);
}
function summarize(kind, r) {
  if (kind === 'queueCleaner') return `${r.dryRun ? 'Dry run: ' : ''}${r.checked} checked, ${r.flagged} flagged, ${r.removed} removed`;
  return `${r.searched} item(s) searched across ${r.instances} instance(s)`;
}

export function getStatus() {
  return {
    config: getConfig(),
    runs: store.get(RUN_NS, {}) || {},
    strikes: Object.keys(store.get(STRIKES_NS, {}) || {}).length,
    log: log.slice(0, 25),
  };
}

// ---- Scheduler tick (called periodically by the server) -------------------
const lastTick = { queueCleaner: 0, hunting: 0 };
export async function tick(cfg) {
  const c = getConfig();
  const now = Date.now();
  if (c.queueCleaner.enabled && now - lastTick.queueCleaner >= c.queueCleaner.intervalMinutes * 60000) {
    lastTick.queueCleaner = now;
    try { const r = await runQueueCleanerOnce(cfg); if (r.flagged || r.removed) console.log(`[automation] queue cleaner: ${summarize('queueCleaner', r)}`); }
    catch (e) { console.error('[automation] queue cleaner failed:', e.message); }
  }
  if (c.hunting.enabled && now - lastTick.hunting >= c.hunting.intervalMinutes * 60000) {
    lastTick.hunting = now;
    try { const r = await runHuntOnce(cfg); if (r.searched) console.log(`[automation] hunt: ${summarize('hunting', r)}`); }
    catch (e) { console.error('[automation] hunt failed:', e.message); }
  }
}
