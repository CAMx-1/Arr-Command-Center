// Library insights for Sonarr/Radarr: where the space goes (by quality,
// resolution and video codec), the largest titles, an estimate of what
// re-encoding H.264 files to HEVC would save, and growth from the server's
// daily snapshots. Pure except loadInsights().

// HEVC usually needs about half the bitrate of H.264 for similar quality.
// This is a rough planning figure, not a promise.
export const HEVC_RATIO = 0.5;

export function codecFamily(c) {
  const s = String(c || '').toLowerCase().replace(/[\s.-]/g, '');
  if (!s) return 'Unknown';
  if (/^(x264|h264|avc)/.test(s)) return 'H.264';
  if (/^(x265|h265|hevc)/.test(s)) return 'HEVC';
  if (/^av1/.test(s)) return 'AV1';
  if (/^vp9/.test(s)) return 'VP9';
  if (/^(xvid|divx|mpeg4)/.test(s)) return 'XviD/DivX';
  if (/^(mpeg2|mpeg2video)/.test(s)) return 'MPEG-2';
  if (/^vc1/.test(s)) return 'VC-1';
  return String(c);
}

export function resolutionBucket(file) {
  const q = file.quality && file.quality.quality;
  const r = Number(q && q.resolution) || Number((/x(\d+)/.exec(String(file.mediaInfo && file.mediaInfo.resolution || '')) || [])[1]) || 0;
  if (r >= 2000) return '2160p';
  if (r >= 1000) return '1080p';
  if (r >= 700) return '720p';
  if (r > 0) return 'SD';
  return 'Unknown';
}

// rows: [{ title, size, file }] where file is a movieFile/episodefile.
export function summarize(rows, { top = 15 } = {}) {
  const group = (fn) => {
    const m = new Map();
    for (const r of rows) { const k = fn(r); const g = m.get(k) || { name: k, bytes: 0, count: 0 }; g.bytes += r.size; g.count += 1; m.set(k, g); }
    return [...m.values()].sort((a, b) => b.bytes - a.bytes);
  };
  const total = rows.reduce((s, r) => s + r.size, 0);
  const byQuality = group((r) => (r.file.quality && r.file.quality.quality && r.file.quality.quality.name) || 'Unknown');
  const byResolution = group((r) => resolutionBucket(r.file));
  const byCodec = group((r) => codecFamily(r.file.mediaInfo && r.file.mediaInfo.videoCodec));
  const titles = new Map();
  for (const r of rows) { const t = titles.get(r.title) || { title: r.title, bytes: 0, files: 0, id: r.id }; t.bytes += r.size; t.files += 1; titles.set(r.title, t); }
  const largest = [...titles.values()].sort((a, b) => b.bytes - a.bytes).slice(0, top);
  const h264 = byCodec.find((g) => g.name === 'H.264') || { bytes: 0, count: 0 };
  return {
    total, files: rows.length, byQuality, byResolution, byCodec, largest,
    hevc: { files: h264.count, bytes: h264.bytes, saving: Math.round(h264.bytes * (1 - HEVC_RATIO)) },
  };
}

export function movieRows(movies) {
  return (movies || []).filter((m) => m.movieFile).map((m) => ({ id: m.id, title: `${m.title}${m.year ? ` (${m.year})` : ''}`, size: Number(m.movieFile.size) || 0, file: m.movieFile }));
}
export function episodeRows(series, files) {
  return (files || []).map((f) => ({ id: series.id, title: series.title, size: Number(f.size) || 0, file: f }));
}

// history: [{ date, bytes, items, files }] oldest first.
export function growth(history, { days = 30 } = {}) {
  const h = (history || []).filter((x) => x && x.date).slice().sort((a, b) => a.date.localeCompare(b.date));
  if (h.length < 2) return null;
  const last = h[h.length - 1];
  const cutoff = new Date(Date.parse(last.date) - days * 86400000).toISOString().slice(0, 10);
  const from = h.find((x) => x.date >= cutoff) || h[0];
  const spanDays = Math.max(1, Math.round((Date.parse(last.date) - Date.parse(from.date)) / 86400000));
  const delta = last.bytes - from.bytes;
  return { from, to: last, days: spanDays, bytes: delta, items: last.items - from.items, perDay: delta / spanDays, points: h };
}

export async function loadInsights(arr, { kind, serviceKey, getJson, maxSeries = 400, onProgress = () => {} }) {
  let rows;
  if (kind === 'series') {
    const series = ((await arr.get('series')) || []).filter((s) => (s.statistics && s.statistics.episodeFileCount) || 0).slice(0, maxSeries);
    rows = []; let next = 0; let done = 0;
    await Promise.all(Array.from({ length: Math.min(4, series.length) }, async () => {
      while (next < series.length) {
        const s = series[next++];
        rows.push(...episodeRows(s, await arr.get(`episodefile?seriesId=${encodeURIComponent(s.id)}`).catch(() => [])));
        onProgress({ done: ++done, total: series.length });
      }
    }));
  } else {
    rows = movieRows(await arr.get('movie'));
  }
  const history = getJson ? await getJson(`/api/insights/history/${encodeURIComponent(serviceKey)}`).catch(() => []) : [];
  return { ...summarize(rows), growth: growth(history) };
}
