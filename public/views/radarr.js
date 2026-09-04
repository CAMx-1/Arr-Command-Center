import { h, mount, clear, tabs, spinner, skeletonList, empty, toast, fmtBytes, fmtDate, fmtRelative, timeEl, pct, poster, arrEventInfo, openModal, closeModal, confirmModal, debounce, autoRefresh, swipeToAction } from '../lib/ui.js';
import { openDetailModal, openArrFileInfo } from './detail.js';
import { openReleaseSearch } from './releaseSearch.js';
import { bulkLibrary } from './bulk.js';
import { tabSystem, tabWanted } from './arrSystem.js';
import { hive, virtualHive, posterHexCard, pagedLibrary } from '../lib/hive.js';
import { viewToggle, effectiveMode } from '../lib/viewMode.js';
import { cachedGet, invalidate } from '../lib/cache.js';
import { libraryFilter, consumePendingFilter } from '../lib/libraryFilter.js';
import { tagEditor, arrCommandBar, loadTags, openManualImport } from '../lib/arrActions.js';

export async function renderRadarr(root, ctx) {
  const svc = ctx.service;
  const arr = ctx.api.arr(svc.key);
  ctx.setActions(
    viewToggle(svc.key, ctx.reload),
    h('button', { class: 'btn primary', onclick: () => openAddModal(arr, ctx) }, '＋ Add Movie'),
  );

  const body = h('div', {});
  const bar = tabs(body, [
    { id: 'movies', label: 'Library', render: (c) => tabMovies(c, arr, ctx) },
    { id: 'calendar', label: 'Calendar', render: (c) => tabCalendar(c, arr) },
    { id: 'wanted', label: 'Wanted', render: (c) => tabWanted(c, arr, ctx, 'movie') },
    { id: 'queue', label: 'Queue', render: (c) => tabQueue(c, arr, ctx) },
    { id: 'history', label: 'History', render: (c) => tabHistory(c, arr) },
    { id: 'system', label: 'System', render: (c) => tabSystem(c, arr, ctx, 'movie') },
  ], `tabs-${svc.key}`);
  mount(root, bar, body);
}

async function tabCalendar(root, arr) {
  mount(root, skeletonList());
  try {
    const start = new Date(); start.setDate(start.getDate() - 1);
    const end = new Date(); end.setDate(end.getDate() + 60);
    const items = await arr.get(`calendar?start=${start.toISOString()}&end=${end.toISOString()}`);
    if (!items.length) return mount(root, empty('', 'Nothing scheduled', 'No upcoming movie releases in the next 60 days'));
    const withDate = items.map((m) => ({ m, when: m.digitalRelease || m.physicalRelease || m.inCinemas }))
      .filter((x) => x.when).sort((a, b) => new Date(a.when) - new Date(b.when));
    mount(root, h('div', { class: 'list' }, ...withDate.map(({ m, when }) => calRow(m, when))));
  } catch (err) {
    mount(root, empty('', 'Failed to load calendar', err.message));
  }
}

function calRow(m, when) {
  const img = (m.images || []).find((i) => i.coverType === 'poster');
  const kind = m.digitalRelease && when === m.digitalRelease ? 'Digital'
    : m.physicalRelease && when === m.physicalRelease ? 'Physical'
    : 'In Cinemas';
  return h('div', { class: 'row' },
    poster(img && (img.remoteUrl || img.url), ''),
    h('div', { class: 'row-main' },
      h('div', { class: 'row-title' }, `${m.title} `, h('span', { class: 'dim nowrap' }, m.year ? `(${m.year})` : '')),
      h('div', { class: 'meta-line', style: { marginTop: '4px' } },
        h('span', {}, fmtDate(when), ' · ', fmtRelative(when)),
        h('span', { class: 'pill muted' }, kind),
        m.hasFile ? h('span', { class: 'pill ok' }, 'Downloaded') : h('span', { class: 'pill warn' }, 'Pending'),
      ),
    ),
  );
}

async function tabHistory(root, arr) {
  mount(root, skeletonList());
  try {
    const data = await arr.get('history?page=1&pageSize=40&sortKey=date&sortDirection=descending&includeMovie=true');
    const records = data.records || [];
    if (!records.length) return mount(root, empty('', 'No history yet'));
    mount(root, h('div', { class: 'list' }, ...records.map(historyRow)));
  } catch (err) {
    mount(root, empty('', 'Failed to load history', err.message));
  }
}

function historyRow(r) {
  const info = arrEventInfo(r.eventType);
  const title = (r.movie && r.movie.title) || r.sourceTitle || 'Unknown';
  return h('div', { class: 'row' },
    h('div', { class: 'poster', style: { width: '40px', height: '40px', fontSize: '16px' } }, ''),
    h('div', { class: 'row-main' },
      h('div', { class: 'row-title' }, title),
      h('div', { class: 'meta-line', style: { marginTop: '4px' } },
        h('span', { class: `pill ${info.cls}` }, info.label),
        r.quality && r.quality.quality ? h('span', {}, r.quality.quality.name) : null,
        r.date ? timeEl(r.date) : null,
      ),
      r.movie && r.sourceTitle ? h('div', { class: 'row-sub' }, r.sourceTitle) : null,
    ),
  );
}

async function tabMovies(root, arr, ctx) {
  mount(root, skeletonList());
  try {
    const movies = [...await cachedGet(`arr:${ctx.service.key}:movie`, () => arr.get('movie'), 300000)];
    movies.sort((a, b) => a.title.localeCompare(b.title));
    if (!movies.length) return mount(root, empty('', 'No movies yet', 'Add a movie to get started', { label: '＋ Add Movie', onClick: () => openAddModal(arr, ctx) }));
    const isHex = effectiveMode(ctx.service.key) === 'hex';
    const listWrap = h('div', {});
    const renderList = (items) => {
      if (!items.length) return mount(listWrap, empty('', 'No matches', 'No movies match this filter'));
      mount(listWrap, pagedLibrary(items, {
        isHex,
        makeCard: (m) => movieHex(m, arr, ctx),
        makeRow: (m) => movieRow(m, arr, ctx),
      }));
    };
    const libHead = h('div', { class: 'lib-head' },
      libraryFilter('movie', movies, renderList, { initialTerm: consumePendingFilter(ctx.service.key) }),
      h('button', { class: 'btn sm', title: 'Bulk select', onclick: () => bulkLibrary(root, { items: movies, kind: 'movie', arr, invalidateKey: `arr:${ctx.service.key}:movie`, onExit: () => tabMovies(root, arr, ctx) }) }, '☑ Select'),
    );
    mount(root, libHead, listWrap);
  } catch (err) {
    mount(root, empty('', 'Failed to load movies', err.message, { label: 'Retry', onClick: () => tabMovies(root, arr, ctx) }));
  }
}

function movieHex(m, arr, ctx) {
  const img = (m.images || []).find((i) => i.coverType === 'poster');
  const url = img && (img.remoteUrl || img.url);
  const rating = m.ratings && (m.ratings.tmdb?.value || m.ratings.imdb?.value || m.ratings.value);
  const actions = h('div', { class: 'row-actions' },
    h('button', { class: 'btn sm', title: 'Storage & file info', onclick: (e) => { e.stopPropagation(); openArrFileInfo(ctx.service.label, false, m); } }, 'Info'),
    h('button', { class: 'btn sm', title: 'Interactive search', onclick: (e) => { e.stopPropagation(); openReleaseSearch(ctx, ctx.service.key, `movieId=${m.id}`, `${m.title} (${m.year})`); } }, 'Search'),
    h('button', { class: 'btn sm', title: 'Automatic search', onclick: async (e) => {
      e.stopPropagation();
      try { await arr.post('command', { name: 'MoviesSearch', movieIds: [m.id] }); toast(`Searching for ${m.title}`, 'success'); }
      catch (e2) { toast(e2.message, 'error'); }
    } }, 'Auto'),
    h('button', { class: 'btn sm', title: 'Edit / delete', onclick: (e) => { e.stopPropagation(); openEditMovie(arr, ctx, m); } }, 'Edit'),
  );
  return posterHexCard({
    posterUrl: url,
    title: `${m.title}${m.year ? ` (${m.year})` : ''}`,
    pills: [
      m.hasFile ? { label: 'Downloaded', cls: 'ok' } : { label: 'Missing', cls: 'warn' },
      m.monitored ? { label: 'Monitored', cls: 'info' } : { label: 'Unmonitored', cls: 'muted' },
    ],
    actions,
    onClick: () => openDetailModal(ctx, {
      mediaType: 'movie', tmdbId: m.tmdbId,
      fallback: { title: m.title, year: m.year, overview: m.overview, genres: m.genres, rating, runtime: m.runtime, posterUrl: url },
    }),
  });
}

function movieRow(m, arr, ctx) {
  const img = (m.images || []).find((i) => i.coverType === 'poster');
  const rating = m.ratings && (m.ratings.tmdb?.value || m.ratings.imdb?.value || m.ratings.value);
  const openInfo = () => openDetailModal(ctx, {
    mediaType: 'movie', tmdbId: m.tmdbId,
    fallback: { title: m.title, year: m.year, overview: m.overview, genres: m.genres, rating, runtime: m.runtime, posterUrl: img && (img.remoteUrl || img.url) },
  });
  return h('div', { class: 'row clickable', onclick: openInfo },
    poster(img && (img.remoteUrl || img.url), ''),
    h('div', { class: 'row-main' },
      h('div', { class: 'row-title' }, `${m.title} `, h('span', { class: 'dim nowrap' }, m.year ? `(${m.year})` : '')),
      h('div', { class: 'meta-line', style: { marginTop: '4px' } },
        h('span', {}, m.studio || '—'),
        m.runtime ? h('span', {}, `${m.runtime} min`) : null,
        h('span', {}, fmtBytes(m.sizeOnDisk || 0)),
        m.hasFile ? h('span', { class: 'pill ok' }, 'Downloaded') : h('span', { class: 'pill warn' }, 'Missing'),
        m.monitored ? h('span', { class: 'pill info' }, 'Monitored') : h('span', { class: 'pill muted' }, 'Unmonitored'),
      ),
    ),
    h('div', { class: 'row-actions' },
      h('button', { class: 'btn sm', title: 'Storage & file info', onclick: (e) => { e.stopPropagation(); openArrFileInfo(ctx.service.label, false, m); } }, 'Info'),
      h('button', { class: 'btn sm', onclick: (e) => { e.stopPropagation(); openReleaseSearch(ctx, ctx.service.key, `movieId=${m.id}`, `${m.title} (${m.year})`); } }, 'Interactive'),
      h('button', { class: 'btn sm', onclick: async (e) => {
        e.stopPropagation();
        try { await arr.post('command', { name: 'MoviesSearch', movieIds: [m.id] }); toast(`Searching for ${m.title}`, 'success'); }
        catch (e2) { toast(e2.message, 'error'); }
      } }, 'Auto'),
      h('button', { class: 'btn sm', title: 'Edit / delete', onclick: (e) => { e.stopPropagation(); openEditMovie(arr, ctx, m); } }, 'Edit'),
    ),
  );
}

async function tabQueue(root, arr, ctx) {
  const wrap = h('div', {});
  mount(root, wrap);
  const load = async (silent) => {
    if (!silent) mount(wrap, skeletonList());
    try {
      const queue = await arr.get('queue?pageSize=50');
      const records = queue.records || [];
      if (!records.length) { mount(wrap, empty('', 'Queue is empty', 'Nothing downloading right now')); return; }
      mount(wrap, queueAttentionBanner(records, ctx) || null, h('div', { class: 'list' }, ...records.map((r) => queueRow(r, arr, ctx))));
    } catch (err) {
      if (!silent) mount(wrap, empty('', 'Failed to load queue', err.message));
    }
  };
  await load(false);
  autoRefresh(wrap, 5000, () => load(true));
}

const _emittedQueueIssues = new Set();
function queueAttentionBanner(records, ctx) {
  const bad = records.filter((r) => /warning|stalled|failed|error/i.test(`${r.status} ${r.trackedDownloadStatus} ${(r.statusMessages || []).map((m) => m.title).join(' ')} ${r.errorMessage || ''}`));
  if (!bad.length) return null;
  for (const r of bad) {
    const key = `${ctx.service.key}:${r.downloadId || r.id}`;
    if (!_emittedQueueIssues.has(key)) {
      _emittedQueueIssues.add(key);
      try { window.dispatchEvent(new CustomEvent('app-error', { detail: { message: `${ctx.service.label}: “${r.title}” ${r.errorMessage || 'download needs attention'}`, at: Date.now() } })); } catch { /* ignore */ }
    }
  }
  return h('div', { class: 'attention-banner' },
    h('span', { class: 'pill down' }, `${bad.length} need${bad.length === 1 ? 's' : ''} attention`),
    h('span', { class: 'dim' }, bad.slice(0, 3).map((r) => r.title).join(' · ') + (bad.length > 3 ? '…' : '')),
  );
}

function queueRow(r, arr, ctx) {
  const prog = r.size ? ((r.size - (r.sizeleft || 0)) / r.size) * 100 : 0;
  const remove = async () => {
    try { await arr.del(`queue/${r.id}?removeFromClient=true&blocklist=false`); toast('Removed from queue', 'success'); ctx.reload(); }
    catch (e) { toast(e.message, 'error'); }
  };
  const row = h('div', { class: 'row' },
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
      h('button', { class: 'btn sm', title: 'Manually import completed files', onclick: () => openManualImport(arr, 'movie', { downloadId: r.downloadId, title: r.title }) }, '⇩ Import'),
      h('button', { class: 'btn sm danger', onclick: remove }, '✕ Remove'),
      h('button', { class: 'btn sm', title: 'Blocklist this release and search for a replacement', onclick: async () => {
        try {
          await arr.del(`queue/${r.id}?removeFromClient=true&blocklist=true`);
          if (r.movieId) await arr.post('command', { name: 'MoviesSearch', movieIds: [r.movieId] });
          toast('Blocklisted & searching for a replacement', 'success'); ctx.reload();
        } catch (e) { toast(e.message, 'error'); }
      } }, '⛔ Blocklist & search'),
    ),
  );
  return swipeToAction(row, remove); // swipe left to remove (touch)
}

// ---- Add movie flow ----
function openAddModal(arr, ctx) {
  const results = h('div', { class: 'list', style: { marginTop: '12px' } });
  const input = h('input', { class: 'input', placeholder: 'Search for a movie…' });
  const doSearch = debounce(async () => {
    const term = input.value.trim();
    if (!term) return clear(results);
    mount(results, spinner());
    try {
      const found = await arr.get(`movie/lookup?term=${encodeURIComponent(term)}`);
      if (!found.length) return mount(results, empty('', 'No matches'));
      mount(results, ...found.slice(0, 10).map((r) => lookupRow(r, arr, ctx)));
    } catch (e) { mount(results, empty('', 'Search failed', e.message)); }
  }, 400);
  input.addEventListener('input', doSearch);
  openModal({ title: 'Add Movie', body: h('div', {}, input, results), wide: true });
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
    h('div', { class: 'row-actions' }, h('button', { class: 'btn sm primary', onclick: () => confirmAdd(r, arr, ctx) }, '＋ Add')),
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
  const searchChk = h('input', { type: 'checkbox', checked: true });

  const doAdd = async () => {
    const payload = {
      title: r.title, tmdbId: r.tmdbId, year: r.year, titleSlug: r.titleSlug, images: r.images || [],
      qualityProfileId: Number(profileSel.value) || 1,
      rootFolderPath: folderSel.value || '/movies',
      monitored: true,
      addOptions: { searchForMovie: searchChk.checked },
    };
    try { await arr.post('movie', payload); invalidate(`arr:${ctx.service.key}:movie`); toast(`Added ${r.title}`, 'success'); closeModal(); ctx.reload(); }
    catch (e) { toast(e.message, 'error'); }
  };

  openModal({
    title: `Add “${r.title}”`,
    body: h('div', { class: 'grid', style: { gap: '14px' } },
      field('Root Folder', folderSel),
      field('Quality Profile', profileSel),
      h('label', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, searchChk, 'Search on add'),
    ),
    footer: h('div', { style: { display: 'flex', gap: '10px' } },
      h('button', { class: 'btn', onclick: closeModal }, 'Cancel'),
      h('button', { class: 'btn primary', onclick: doAdd }, 'Add Movie'),
    ),
  });
}

function field(label, control) {
  return h('div', {}, h('div', { class: 'section-title', style: { margin: '0 0 6px' } }, label), control);
}

// ---- Edit / delete an existing movie ----
async function openEditMovie(arr, ctx, m) {
  let profiles = [];
  try { profiles = await cachedGet(`arr:${ctx.service.key}:qualityprofile`, () => arr.get('qualityprofile'), 600000); } catch { /* defaults */ }
  const allTags = await loadTags(arr);
  const tagIds = [...(m.tags || [])];
  const tagsEl = tagEditor(allTags, tagIds, arr);
  const cmdBar = arrCommandBar(arr, 'movie', m.id);
  const monitorChk = h('input', { type: 'checkbox', checked: m.monitored ? 'checked' : null });
  const profileSel = h('select', { class: 'input' }, ...profiles.map((p) => h('option', { value: p.id, selected: p.id === m.qualityProfileId ? 'selected' : null }, p.name)));
  const deleteFilesChk = h('input', { type: 'checkbox' });

  const save = async () => {
    const payload = { ...m, monitored: monitorChk.checked, qualityProfileId: Number(profileSel.value) || m.qualityProfileId, tags: tagIds };
    try {
      await arr.put(`movie/${m.id}`, payload);
      invalidate(`arr:${ctx.service.key}:movie`);
      toast(`Saved ${m.title}`, 'success'); closeModal(); ctx.reload();
    } catch (e) { toast(e.message, 'error'); }
  };
  const del = () => confirmModal({
    title: 'Remove movie', message: `Remove "${m.title}" from ${ctx.service.label}?${deleteFilesChk.checked ? ' Files on disk will be deleted.' : ''}`,
    confirmLabel: 'Remove', danger: true,
    onConfirm: async () => {
      try {
        await arr.del(`movie/${m.id}?deleteFiles=${deleteFilesChk.checked}&addImportListExclusion=false`);
        invalidate(`arr:${ctx.service.key}:movie`);
        toast(`Removed ${m.title}`, 'success'); closeModal(); ctx.reload();
      } catch (e) { toast(e.message, 'error'); }
    },
  });

  openModal({
    title: `Edit “${m.title}”`,
    body: h('div', { class: 'grid', style: { gap: '14px' } },
      field('Quality Profile', profileSel),
      field('Tags', tagsEl),
      field('Maintenance', cmdBar),
      h('label', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, monitorChk, 'Monitored'),
      h('label', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, deleteFilesChk, 'Also delete files on disk (when removing)'),
    ),
    footer: h('div', { style: { display: 'flex', gap: '10px', justifyContent: 'space-between', width: '100%' } },
      h('button', { class: 'btn danger sm', onclick: del }, 'Remove'),
      h('div', { style: { display: 'flex', gap: '10px' } },
        h('button', { class: 'btn', onclick: closeModal }, 'Cancel'),
        h('button', { class: 'btn primary', onclick: save }, 'Save'),
      ),
    ),
  });
}
