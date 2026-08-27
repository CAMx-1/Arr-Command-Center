import { h, mount, clear, tabs, spinner, skeletonList, empty, toast, fmtBytes, fmtDate, fmtRelative, timeEl, pct, poster, arrEventInfo, openModal, closeModal, debounce } from '../lib/ui.js';
import { openDetailModal, openArrFileInfo } from './detail.js';
import { openReleaseSearch } from './releaseSearch.js';
import { bulkLibrary } from './bulk.js';
import { tabSystem, tabWanted } from './arrSystem.js';
import { hive, virtualHive, posterHexCard, pagedLibrary } from '../lib/hive.js';
import { viewToggle, effectiveMode } from '../lib/viewMode.js';
import { cachedGet, invalidate } from '../lib/cache.js';
import { libraryFilter } from '../lib/libraryFilter.js';

export async function renderSonarr(root, ctx) {
  const svc = ctx.service;
  const arr = ctx.api.arr(svc.key);
  ctx.setActions(
    viewToggle(svc.key, ctx.reload),
    h('button', { class: 'btn primary', onclick: () => openAddModal(arr, ctx) }, '＋ Add Series'),
  );

  const body = h('div', {});
  const bar = tabs(body, [
    { id: 'series', label: 'Library', render: (c) => tabSeries(c, arr, ctx) },
    { id: 'calendar', label: 'Calendar', render: (c) => tabCalendar(c, arr) },
    { id: 'wanted', label: 'Wanted', render: (c) => tabWanted(c, arr, ctx, 'series') },
    { id: 'queue', label: 'Queue', render: (c) => tabQueue(c, arr, ctx) },
    { id: 'history', label: 'History', render: (c) => tabHistory(c, arr) },
    { id: 'system', label: 'System', render: (c) => tabSystem(c, arr, ctx, 'series') },
  ], `tabs-${svc.key}`);
  mount(root, bar, body);
}

async function tabHistory(root, arr) {
  mount(root, skeletonList());
  try {
    const data = await arr.get('history?page=1&pageSize=40&sortKey=date&sortDirection=descending&includeSeries=true&includeEpisode=true');
    const records = data.records || [];
    if (!records.length) return mount(root, empty('', 'No history yet'));
    mount(root, h('div', { class: 'list' }, ...records.map(historyRow)));
  } catch (err) {
    mount(root, empty('', 'Failed to load history', err.message));
  }
}

function historyRow(r) {
  const info = arrEventInfo(r.eventType);
  const ep = r.episode ? ` · S${String(r.episode.seasonNumber).padStart(2, '0')}E${String(r.episode.episodeNumber).padStart(2, '0')}` : '';
  const title = ((r.series && r.series.title) || r.sourceTitle || 'Unknown') + ep;
  return h('div', { class: 'row' },
    h('div', { class: 'poster', style: { width: '40px', height: '40px', fontSize: '16px' } }, ''),
    h('div', { class: 'row-main' },
      h('div', { class: 'row-title' }, title),
      h('div', { class: 'meta-line', style: { marginTop: '4px' } },
        h('span', { class: `pill ${info.cls}` }, info.label),
        r.quality && r.quality.quality ? h('span', {}, r.quality.quality.name) : null,
        r.date ? timeEl(r.date) : null,
      ),
      r.series && r.sourceTitle ? h('div', { class: 'row-sub' }, r.sourceTitle) : null,
    ),
  );
}

async function tabSeries(root, arr, ctx) {
  mount(root, skeletonList());
  try {
    const series = [...await cachedGet(`arr:${ctx.service.key}:series`, () => arr.get('series'), 300000)];
    series.sort((a, b) => a.title.localeCompare(b.title));
    if (!series.length) return mount(root, empty('', 'No series yet', 'Add a series to get started', { label: '＋ Add Series', onClick: () => openAddModal(arr, ctx) }));
    const isHex = effectiveMode(ctx.service.key) === 'hex';
    const listWrap = h('div', {});
    const renderList = (items) => {
      if (!items.length) return mount(listWrap, empty('', 'No matches', 'No series match this filter'));
      mount(listWrap, pagedLibrary(items, {
        isHex,
        makeCard: (s) => seriesHex(s, arr, ctx),
        makeRow: (s) => seriesRow(s, arr, ctx),
      }));
    };
    const libHead = h('div', { class: 'lib-head' },
      libraryFilter('series', series, renderList),
      h('button', { class: 'btn sm', title: 'Bulk select', onclick: () => bulkLibrary(root, { items: series, kind: 'series', arr, invalidateKey: `arr:${ctx.service.key}:series`, onExit: () => tabSeries(root, arr, ctx) }) }, '☑ Select'),
    );
    mount(root, libHead, listWrap);
    renderList(series);
  } catch (err) {
    mount(root, empty('', 'Failed to load series', err.message, { label: 'Retry', onClick: () => tabSeries(root, arr, ctx) }));
  }
}

function seriesHex(s, arr, ctx) {
  const stats = s.statistics || {};
  const img = (s.images || []).find((i) => i.coverType === 'poster');
  const url = img && (img.remoteUrl || img.url);
  const rating = s.ratings && s.ratings.value;
  const actions = h('div', { class: 'row-actions' },
    h('button', { class: 'btn sm', title: 'Storage & file info', onclick: (e) => { e.stopPropagation(); openArrFileInfo(ctx.service.label, true, s, arr); } }, 'Info'),
    h('button', { class: 'btn sm', title: 'Seasons & episodes', onclick: (e) => { e.stopPropagation(); openSeasonBrowser(arr, ctx, s); } }, 'Seasons'),
    h('button', { class: 'btn sm', title: 'Interactive search', onclick: (e) => { e.stopPropagation(); openInteractive(ctx, arr, s); } }, 'Search'),
    h('button', { class: 'btn sm', title: 'Automatic search', onclick: async (e) => {
      e.stopPropagation();
      try { await arr.post('command', { name: 'SeriesSearch', seriesId: s.id }); toast(`Searching for ${s.title}`, 'success'); }
      catch (e2) { toast(e2.message, 'error'); }
    } }, 'Auto'),
  );
  return posterHexCard({
    posterUrl: url,
    title: `${s.title}${s.year ? ` (${s.year})` : ''}`,
    pills: [
      s.monitored ? { label: 'Monitored', cls: 'info' } : { label: 'Unmonitored', cls: 'muted' },
      stats.episodeCount ? { label: `${stats.episodeFileCount ?? 0}/${stats.episodeCount} eps`, cls: 'ok' } : null,
    ],
    progress: stats.episodeCount ? (stats.percentOfEpisodes ?? 0) : null,
    actions,
    onClick: () => openDetailModal(ctx, {
      mediaType: 'tv', tmdbId: s.tmdbId,
      fallback: { title: s.title, year: s.year, overview: s.overview, genres: s.genres, rating, posterUrl: url },
    }),
  });
}

function seriesRow(s, arr, ctx) {
  const stats = s.statistics || {};
  const img = (s.images || []).find((i) => i.coverType === 'poster');
  const rating = s.ratings && s.ratings.value;
  const openInfo = () => openDetailModal(ctx, {
    mediaType: 'tv', tmdbId: s.tmdbId,
    fallback: { title: s.title, year: s.year, overview: s.overview, genres: s.genres, rating, posterUrl: img && (img.remoteUrl || img.url) },
  });
  return h('div', { class: 'row clickable', onclick: openInfo },
    poster(img && (img.remoteUrl || img.url), ''),
    h('div', { class: 'row-main' },
      h('div', { class: 'row-title' }, `${s.title} `, h('span', { class: 'dim nowrap' }, s.year ? `(${s.year})` : '')),
      h('div', { class: 'meta-line', style: { marginTop: '4px' } },
        h('span', {}, s.network || '—'),
        h('span', {}, `${stats.episodeFileCount ?? 0}/${stats.episodeCount ?? 0} eps`),
        h('span', {}, fmtBytes(stats.sizeOnDisk || 0)),
        h('span', { class: `pill ${s.status === 'continuing' ? 'ok' : 'muted'}` }, s.status || 'unknown'),
        s.monitored ? h('span', { class: 'pill info' }, 'Monitored') : h('span', { class: 'pill muted' }, 'Unmonitored'),
      ),
      stats.episodeCount ? h('div', { class: 'progress' }, h('span', { style: { width: pct(stats.percentOfEpisodes ?? 0) } })) : null,
    ),
    h('div', { class: 'row-actions' },
      h('button', { class: 'btn sm', title: 'Storage & file info', onclick: (e) => { e.stopPropagation(); openArrFileInfo(ctx.service.label, true, s, arr); } }, 'Info'),
      h('button', { class: 'btn sm', title: 'Seasons & episodes', onclick: (e) => { e.stopPropagation(); openSeasonBrowser(arr, ctx, s); } }, 'Seasons'),
      h('button', { class: 'btn sm', onclick: (e) => { e.stopPropagation(); openInteractive(ctx, arr, s); } }, 'Interactive'),
      h('button', { class: 'btn sm', onclick: async (e) => {
        e.stopPropagation();
        try { await arr.post('command', { name: 'SeriesSearch', seriesId: s.id }); toast(`Searching for ${s.title}`, 'success'); }
        catch (e2) { toast(e2.message, 'error'); }
      } }, 'Auto'),
    ),
  );
}

async function tabCalendar(root, arr) {
  mount(root, skeletonList());
  try {
    const start = new Date(); start.setDate(start.getDate() - 1);
    const end = new Date(); end.setDate(end.getDate() + 28);
    const items = await arr.get(`calendar?start=${start.toISOString()}&end=${end.toISOString()}&includeSeries=true`);
    if (!items.length) return mount(root, empty('', 'Nothing scheduled', 'No upcoming episodes in the next 4 weeks'));
    items.sort((a, b) => new Date(a.airDateUtc) - new Date(b.airDateUtc));
    mount(root, h('div', { class: 'list' }, ...items.map(calRow)));
  } catch (err) {
    mount(root, empty('', 'Failed to load calendar', err.message));
  }
}

function calRow(e) {
  const title = (e.series && e.series.title) || e.title;
  return h('div', { class: 'row' },
    h('div', { class: 'poster', style: { width: '54px', height: '54px', fontSize: '13px', flexDirection: 'column' } },
      h('div', { style: { fontWeight: '700' } }, `S${String(e.seasonNumber).padStart(2, '0')}`),
      h('div', {}, `E${String(e.episodeNumber).padStart(2, '0')}`),
    ),
    h('div', { class: 'row-main' },
      h('div', { class: 'row-title' }, title),
      h('div', { class: 'row-sub' }, e.title),
      h('div', { class: 'meta-line', style: { marginTop: '4px' } },
        h('span', {}, fmtDate(e.airDateUtc), ' · ', fmtRelative(e.airDateUtc)),
        e.hasFile ? h('span', { class: 'pill ok' }, 'Downloaded') : h('span', { class: 'pill warn' }, 'Pending'),
      ),
    ),
  );
}

async function tabQueue(root, arr, ctx) {
  mount(root, skeletonList());
  try {
    const queue = await arr.get('queue?pageSize=50');
    const records = queue.records || [];
    if (!records.length) return mount(root, empty('', 'Queue is empty', 'Nothing downloading right now'));
    mount(root, h('div', { class: 'list' }, ...records.map((r) => queueRow(r, arr, ctx))));
  } catch (err) {
    mount(root, empty('', 'Failed to load queue', err.message));
  }
}

function queueRow(r, arr, ctx) {
  const prog = r.size ? ((r.size - (r.sizeleft || 0)) / r.size) * 100 : 0;
  return h('div', { class: 'row' },
    h('div', { class: 'poster', style: { width: '40px', height: '40px', fontSize: '18px' } }, '⬇'),
    h('div', { class: 'row-main' },
      h('div', { class: 'row-title' }, r.title),
      h('div', { class: 'meta-line', style: { marginTop: '4px' } },
        h('span', { class: 'pill info' }, r.status || 'unknown'),
        h('span', {}, r.indexer || ''),
        h('span', {}, `${fmtBytes(r.sizeleft || 0)} left`),
        r.timeleft ? h('span', {}, `ETA ${r.timeleft}`) : null,
      ),
      h('div', { class: 'progress' }, h('span', { style: { width: pct(prog) } })),
    ),
    h('div', { class: 'row-actions' },
      h('button', { class: 'btn sm danger', onclick: async () => {
        try { await arr.del(`queue/${r.id}?removeFromClient=true&blocklist=false`); toast('Removed from queue', 'success'); ctx.reload(); }
        catch (e) { toast(e.message, 'error'); }
      } }, '✕ Remove'),
    ),
  );
}

// ---- Season / episode browser ----
async function openSeasonBrowser(arr, ctx, series) {
  const body = h('div', { class: 'season-browser' }, skeletonList(3));
  openModal({ title: `${series.title} · Seasons`, body, wide: true });
  let episodes, files;
  try {
    [episodes, files] = await Promise.all([
      arr.get(`episode?seriesId=${series.id}`),
      arr.get(`episodefile?seriesId=${series.id}`).catch(() => []),
    ]);
  } catch (e) {
    mount(body, empty('', 'Failed to load episodes', e.message, { label: 'Retry', onClick: () => openSeasonBrowser(arr, ctx, series) }));
    return;
  }
  const fileById = {};
  for (const f of (files || [])) fileById[f.id] = f;
  const bySeason = new Map();
  for (const e of episodes) { if (!bySeason.has(e.seasonNumber)) bySeason.set(e.seasonNumber, []); bySeason.get(e.seasonNumber).push(e); }
  const seasons = [...bySeason.keys()].sort((a, b) => (a === 0 ? 1e9 : a) - (b === 0 ? 1e9 : b));
  const render = () => mount(body, ...seasons.map((sn) => seasonBlock(sn, bySeason.get(sn), fileById, arr, series, render)));
  render();
}

function seasonBlock(sn, eps, fileById, arr, series, reload) {
  eps.sort((a, b) => a.episodeNumber - b.episodeNumber);
  const withFile = eps.filter((e) => e.hasFile).length;
  const totalSize = eps.reduce((s, e) => s + ((e.episodeFileId && fileById[e.episodeFileId] && fileById[e.episodeFileId].size) || 0), 0);
  const header = h('div', { class: 'season-head' },
    h('div', { class: 'season-title' }, sn === 0 ? 'Specials' : `Season ${sn}`),
    h('span', { class: 'dim' }, `${withFile}/${eps.length} · ${fmtBytes(totalSize)}`),
    h('button', { class: 'btn sm', style: { marginLeft: 'auto' }, title: 'Search season', onclick: async () => {
      try { await arr.post('command', { name: 'SeasonSearch', seriesId: series.id, seasonNumber: sn }); toast(`Searching Season ${sn}`, 'success'); }
      catch (e) { toast(e.message, 'error'); }
    } }, 'Search'),
  );
  return h('div', { class: 'season-block' }, header, h('div', { class: 'list' }, ...eps.map((e) => seasonEpisodeRow(e, fileById[e.episodeFileId], arr, reload))));
}

function seasonEpisodeRow(e, file, arr, reload) {
  const q = file && file.quality && file.quality.quality && file.quality.quality.name;
  return h('div', { class: 'row' },
    h('div', { class: 'row-main' },
      h('div', { class: 'row-title', style: { fontSize: '13px' } }, `S${String(e.seasonNumber).padStart(2, '0')}E${String(e.episodeNumber).padStart(2, '0')} · ${e.title || ''}`),
      h('div', { class: 'meta-line', style: { marginTop: '2px' } },
        e.hasFile ? h('span', { class: 'pill ok' }, 'Downloaded') : h('span', { class: 'pill warn' }, 'Missing'),
        file && file.size ? h('span', {}, fmtBytes(file.size)) : null,
        q ? h('span', { class: 'pill info' }, q) : null,
      ),
    ),
    h('div', { class: 'row-actions' },
      h('button', { class: `btn sm ${e.monitored ? 'primary' : ''}`, title: 'Toggle monitored', onclick: async () => {
        try { await arr.put('episode/monitor', { episodeIds: [e.id], monitored: !e.monitored }); e.monitored = !e.monitored; reload(); }
        catch (err) { toast(err.message, 'error'); }
      } }, e.monitored ? 'Monitored' : 'Unmonitored'),
      h('button', { class: 'btn sm', title: 'Search episode', onclick: async () => {
        try { await arr.post('command', { name: 'EpisodeSearch', episodeIds: [e.id] }); toast('Searching…', 'success'); }
        catch (err) { toast(err.message, 'error'); }
      } }, '⌕'),
    ),
  );
}

// ---- Add series flow ----
function openAddModal(arr, ctx) {
  const results = h('div', { class: 'list', style: { marginTop: '12px' } });
  const input = h('input', { class: 'input', placeholder: 'Search for a series…', autofocus: true });

  const doSearch = debounce(async () => {
    const term = input.value.trim();
    if (!term) return clear(results);
    mount(results, spinner());
    try {
      const found = await arr.get(`series/lookup?term=${encodeURIComponent(term)}`);
      if (!found.length) return mount(results, empty('', 'No matches'));
      mount(results, ...found.slice(0, 10).map((r) => lookupRow(r, arr, ctx)));
    } catch (e) { mount(results, empty('', 'Search failed', e.message)); }
  }, 400);
  input.addEventListener('input', doSearch);

  openModal({ title: 'Add Series', body: h('div', {}, input, results), wide: true });
  setTimeout(() => input.focus(), 50);
}

function lookupRow(r, arr, ctx) {
  const img = (r.images || []).find((i) => i.coverType === 'poster');
  return h('div', { class: 'row' },
    poster(img && (img.remoteUrl || img.url), ''),
    h('div', { class: 'row-main' },
      h('div', { class: 'row-title' }, `${r.title} `, h('span', { class: 'dim' }, r.year ? `(${r.year})` : '')),
      h('div', { class: 'row-sub' }, r.overview || ''),
    ),
    h('div', { class: 'row-actions' },
      h('button', { class: 'btn sm primary', onclick: () => confirmAdd(r, arr, ctx) }, '＋ Add'),
    ),
  );
}

async function confirmAdd(r, arr, ctx) {
  let folders = [], profiles = [];
  try { [folders, profiles] = await Promise.all([
    cachedGet(`arr:${ctx.service.key}:rootfolder`, () => arr.get('rootfolder'), 600000),
    cachedGet(`arr:${ctx.service.key}:qualityprofile`, () => arr.get('qualityprofile'), 600000),
  ]); } catch { /* defaults */ }
  const folderSel = h('select', { class: 'input' }, ...folders.map((f) => h('option', { value: f.path }, `${f.path} (${fmtBytes(f.freeSpace)} free)`)));
  const profileSel = h('select', { class: 'input' }, ...profiles.map((p) => h('option', { value: p.id }, p.name)));
  const monitorChk = h('input', { type: 'checkbox', checked: true });
  const searchChk = h('input', { type: 'checkbox', checked: true });

  const doAdd = async () => {
    const payload = {
      title: r.title, tvdbId: r.tvdbId, year: r.year, titleSlug: r.titleSlug,
      images: r.images || [], seasons: r.seasons || [],
      qualityProfileId: Number(profileSel.value) || 1,
      rootFolderPath: folderSel.value || '/tv',
      monitored: monitorChk.checked,
      addOptions: { searchForMissingEpisodes: searchChk.checked },
    };
    try { await arr.post('series', payload); invalidate(`arr:${ctx.service.key}:series`); toast(`Added ${r.title}`, 'success'); closeModal(); ctx.reload(); }
    catch (e) { toast(e.message, 'error'); }
  };

  openModal({
    title: `Add “${r.title}”`,
    body: h('div', { class: 'grid', style: { gap: '14px' } },
      field('Root Folder', folderSel),
      field('Quality Profile', profileSel),
      h('label', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, monitorChk, 'Monitor'),
      h('label', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, searchChk, 'Search on add'),
    ),
    footer: h('div', { style: { display: 'flex', gap: '10px' } },
      h('button', { class: 'btn', onclick: closeModal }, 'Cancel'),
      h('button', { class: 'btn primary', onclick: doAdd }, 'Add Series'),
    ),
  });
}

function field(label, control) {
  return h('div', {}, h('div', { class: 'section-title', style: { margin: '0 0 6px' } }, label), control);
}

// ---- Interactive search: pick a season, then an episode, then browse releases ----
function openInteractive(ctx, arr, s) {
  const seasons = (s.seasons || [])
    .filter((x) => x.seasonNumber > 0)
    .sort((a, b) => b.seasonNumber - a.seasonNumber);
  if (!seasons.length) {
    // No seasons metadata — fall back to a whole-series interactive search.
    return openReleaseSearch(ctx, ctx.service.key, `seriesId=${s.id}`, s.title);
  }

  const seasonSel = h('select', { class: 'input' }, ...seasons.map((x) => h('option', { value: x.seasonNumber }, `Season ${x.seasonNumber}`)));
  const epList = h('div', { class: 'list', style: { marginTop: '4px' } });

  const loadEpisodes = async () => {
    mount(epList, spinner());
    const seasonNumber = Number(seasonSel.value);
    try {
      const episodes = await arr.get(`episode?seriesId=${s.id}&seasonNumber=${seasonNumber}`);
      episodes.sort((a, b) => a.episodeNumber - b.episodeNumber);
      if (!episodes.length) return mount(epList, empty('', 'No episodes in this season'));
      mount(epList,
        h('div', { style: { display: 'flex', justifyContent: 'flex-end', marginBottom: '8px' } },
          h('button', { class: 'btn sm', onclick: () => openReleaseSearch(ctx, ctx.service.key, `seriesId=${s.id}&seasonNumber=${seasonNumber}`, `${s.title} — Season ${seasonNumber}`) }, 'Search whole season'),
        ),
        ...episodes.map((ep) => episodeRow(ep, s, ctx)),
      );
    } catch (e) { mount(epList, empty('', 'Failed to load episodes', e.message)); }
  };
  seasonSel.addEventListener('change', loadEpisodes);

  openModal({
    title: `Interactive Search — ${s.title}`,
    wide: true,
    body: h('div', {},
      field('Season', seasonSel),
      h('div', { class: 'section-title', style: { margin: '16px 0 6px' } }, 'Episodes'),
      epList,
    ),
  });
  loadEpisodes();
}

function episodeRow(ep, s, ctx) {
  return h('div', { class: 'row' },
    h('div', { class: 'poster', style: { width: '46px', height: '46px', fontSize: '12px', fontWeight: '700' } }, `E${String(ep.episodeNumber).padStart(2, '0')}`),
    h('div', { class: 'row-main' },
      h('div', { class: 'row-title' }, ep.title || `Episode ${ep.episodeNumber}`),
      h('div', { class: 'meta-line', style: { marginTop: '4px' } },
        ep.airDateUtc ? h('span', {}, fmtDate(ep.airDateUtc)) : null,
        ep.hasFile ? h('span', { class: 'pill ok' }, 'Downloaded') : h('span', { class: 'pill warn' }, 'Missing'),
        ep.monitored ? h('span', { class: 'pill info' }, 'Monitored') : h('span', { class: 'pill muted' }, 'Unmonitored'),
      ),
    ),
    h('div', { class: 'row-actions' },
      h('button', { class: 'btn sm primary', onclick: () => openReleaseSearch(ctx, ctx.service.key, `episodeId=${ep.id}`, `${s.title} — S${String(ep.seasonNumber).padStart(2, '0')}E${String(ep.episodeNumber).padStart(2, '0')}`) }, 'Search'),
    ),
  );
}
