// Daily library size snapshots for Sonarr, Radarr and Lidarr, so the Insights
// dialog can show growth over time. One small entry per instance per day,
// kept for two years. Reads only list endpoints the apps already serve.
import { serviceGet } from './proxy.js';

const TYPES = { radarr: 'movie', sonarr: 'series', lidarr: 'artist' };
export const KEEP_DAYS = 730;

export function totalsFrom(type, list) {
  let bytes = 0; let items = 0; let files = 0;
  for (const x of list || []) {
    items += 1;
    if (type === 'radarr') { bytes += Number(x.sizeOnDisk) || 0; if (x.hasFile) files += 1; }
    else { const s = x.statistics || {}; bytes += Number(s.sizeOnDisk) || 0; files += Number(type === 'sonarr' ? s.episodeFileCount : s.trackFileCount) || 0; }
  }
  return { bytes, items, files };
}

const day = (t) => new Date(t).toISOString().slice(0, 10);

export function createInsightsRecorder({ cfg, store, get = serviceGet, now = () => Date.now() }) {
  const read = () => store.get('librarySnapshots', {});
  async function tick() {
    const today = day(now());
    const all = read();
    const done = [];
    for (const [key, svc] of Object.entries(cfg.services || {})) {
      const type = svc.type || key;
      if (!TYPES[type]) continue;
      const list = all[key] || [];
      if (list.length && list[list.length - 1].date === today) continue;
      try {
        const t = totalsFrom(type, await get(svc, `api/${type === 'lidarr' ? 'v1' : 'v3'}/${TYPES[type]}`, { timeout: 30000 }));
        done.push([key, { date: today, ...t }]);
      } catch { /* app offline: try again next tick */ }
    }
    if (done.length) {
      store.update('librarySnapshots', (cur) => {
        const out = { ...(cur || {}) };
        for (const [key, snap] of done) out[key] = [...(out[key] || []).filter((s) => s.date !== snap.date), snap].slice(-KEEP_DAYS);
        return out;
      }, {});
    }
    return done.length;
  }
  return { tick, history: (key) => read()[key] || [] };
}

// Demo mode: two months of made-up history leading up to today's real
// snapshot, so the growth chart has a shape.
export function seedDemoHistory(store) {
  const out = { ...store.get('librarySnapshots', {}) };
  for (const [key, list] of Object.entries(out)) {
    if (!list || list.length !== 1) continue;
    const last = list[0]; const t = Date.parse(last.date);
    out[key] = Array.from({ length: 59 }, (_, i) => {
      const back = 59 - i;
      const g = Math.max(0.2, 1 - back * 0.006 - (back % 7 < 2 ? 0.01 : 0));
      return { date: day(t - back * 86400000), bytes: Math.round(last.bytes * g), items: Math.max(0, Math.round(last.items * g)), files: Math.max(0, Math.round(last.files * g)) };
    }).concat(last);
  }
  store.set('librarySnapshots', out);
}
