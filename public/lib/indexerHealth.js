// Prowlarr indexer health: failure rate, grab rate and response time per
// indexer from GET indexerstats (optionally limited to a date range), plus
// whether Prowlarr has disabled it after failures (GET indexerstatus).
// Pure except loadIndexerHealth().

const n = (v) => Number(v) || 0;
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);

export const THRESHOLDS = { failWarn: 10, failBad: 30, slowMs: 3000, minQueries: 20, lowGrabPct: 0.5 };

export function scoreIndexer(stat, { indexer = null, status = null, now = Date.now(), t = THRESHOLDS } = {}) {
  const queries = n(stat.numberOfQueries) + n(stat.numberOfRssQueries) + n(stat.numberOfAuthQueries);
  const failedQueries = n(stat.numberOfFailedQueries) + n(stat.numberOfFailedRssQueries) + n(stat.numberOfFailedAuthQueries);
  const grabs = n(stat.numberOfGrabs);
  const failedGrabs = n(stat.numberOfFailedGrabs);
  const row = {
    id: stat.indexerId, name: stat.indexerName || (indexer && indexer.name) || `Indexer ${stat.indexerId}`,
    enabled: indexer ? indexer.enable !== false : true, protocol: indexer && indexer.protocol, priority: indexer && indexer.priority,
    queries, failedQueries, failRate: pct(failedQueries, queries), grabs, failedGrabs, grabFailRate: pct(failedGrabs, grabs + failedGrabs),
    grabRate: pct(grabs, n(stat.numberOfQueries)), responseMs: Math.round(n(stat.averageResponseTime)), grabResponseMs: Math.round(n(stat.averageGrabResponseTime)),
    disabledTill: null, lastFailure: null, issues: [], level: 'ok',
  };
  if (status && status.disabledTill && Date.parse(status.disabledTill) > now) row.disabledTill = status.disabledTill;
  if (status && status.mostRecentFailure) row.lastFailure = status.mostRecentFailure;
  const add = (level, text, fix) => { row.issues.push({ level, text, fix }); if (level === 'down' || (level === 'warn' && row.level === 'ok')) row.level = level; };
  if (!row.enabled) { row.level = 'muted'; return row; }
  if (row.disabledTill) add('down', `Prowlarr has paused it after repeated failures, until ${new Date(row.disabledTill).toLocaleString()}.`, 'Test it. If the test fails, check its URL, API key or cookie, or whether the site is down.');
  if (queries >= t.minQueries && row.failRate >= t.failBad) add('down', `${row.failRate}% of searches fail.`, 'Test it; a bad key, expired cookie or Cloudflare block are the usual causes. Disable it if it stays broken.');
  else if (queries >= t.minQueries && row.failRate >= t.failWarn) add('warn', `${row.failRate}% of searches fail.`, 'Keep an eye on it. Lower its priority if it keeps failing.');
  if (failedGrabs && row.grabFailRate >= t.failWarn) add('warn', `${row.grabFailRate}% of grabs fail (${failedGrabs}).`, 'Downloads from it often fail. Check the download link settings or your ratio/limits on the site.');
  if (row.responseMs >= t.slowMs) add('warn', `Slow: ${(row.responseMs / 1000).toFixed(1)} s average response.`, 'Slow indexers delay every search. Raise its priority number (lower priority) or reduce its query limit.');
  if (queries >= 200 && grabs === 0) add('warn', `${queries} searches but nothing grabbed.`, 'It may not carry what you want, or its categories are wrong. Consider disabling it.');
  else if (n(stat.numberOfQueries) >= 200 && row.grabRate < t.lowGrabPct) add('muted', `Rarely used: ${row.grabRate}% of searches lead to a grab.`, '');
  return row;
}

export function indexerHealth({ stats, indexers = [], statuses = [], now = Date.now() }) {
  const byId = new Map(indexers.map((i) => [i.id, i]));
  const st = new Map(statuses.map((s) => [s.indexerId, s]));
  const list = ((stats && stats.indexers) || []).map((s) => scoreIndexer(s, { indexer: byId.get(s.indexerId), status: st.get(s.indexerId), now }));
  // Indexers with no stats yet still show.
  for (const i of indexers) if (!list.some((r) => r.id === i.id)) list.push(scoreIndexer({ indexerId: i.id, indexerName: i.name }, { indexer: i, status: st.get(i.id), now }));
  const order = { down: 0, warn: 1, ok: 2, muted: 3 };
  list.sort((a, b) => order[a.level] - order[b.level] || b.queries - a.queries);
  const active = list.filter((r) => r.enabled);
  const totalQ = active.reduce((s, r) => s + r.queries, 0);
  return {
    rows: list,
    summary: { indexers: active.length, problems: active.filter((r) => r.level === 'down').length, warnings: active.filter((r) => r.level === 'warn').length,
      queries: totalQ, failRate: pct(active.reduce((s, r) => s + r.failedQueries, 0), totalQ), grabs: active.reduce((s, r) => s + r.grabs, 0) },
  };
}

export async function loadIndexerHealth(px, { days = 30, now = Date.now() } = {}) {
  const start = new Date(now - days * 86400000).toISOString();
  const [stats, indexers, statuses] = await Promise.all([
    px.get(`indexerstats?startDate=${encodeURIComponent(start)}&endDate=${encodeURIComponent(new Date(now).toISOString())}`),
    px.get('indexer').catch(() => []),
    px.get('indexerstatus').catch(() => []),
  ]);
  return indexerHealth({ stats, indexers, statuses, now });
}
