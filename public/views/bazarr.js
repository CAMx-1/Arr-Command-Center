import { h, mount, tabs, spinner, skeletonList, empty, toast, fmtRelative, timeEl, openModal, closeModal } from '../lib/ui.js';
import { hive, posterHexCard } from '../lib/hive.js';
import { viewToggle, effectiveMode } from '../lib/viewMode.js';
import { cachedGet } from '../lib/cache.js';

// Bazarr (subtitle manager) panel. Mirrors the Sonarr/Radarr/Prowlarr layout:
// tabbed sections, a Hex/List toggle, stat-hex headers, and a filter bar that
// matches the arr library views. Talks to Bazarr's /api (no version prefix).

const OK_GRAD = 'linear-gradient(160deg, #047857, #0f172a)';   // fully subtitled
const MISS_GRAD = 'linear-gradient(160deg, #b45309, #0f172a)'; // missing subtitles
const NEU_GRAD = 'linear-gradient(160deg, #6d28d9, #0f172a)';  // neutral

const HISTORY_ACTION = {
  0: { label: 'Deleted', cls: 'down' },
  1: { label: 'Downloaded', cls: 'ok' },
  2: { label: 'Manual', cls: 'info' },
  3: { label: 'Upgraded', cls: 'ok' },
  4: { label: 'Synced', cls: 'muted' },
  5: { label: 'Translated', cls: 'muted' },
};

export async function renderBazarr(root, ctx) {
  const svc = ctx.service;
  if (!svc.configured) {
    ctx.setActions();
    return mount(root, notConfigured());
  }
  const bz = ctx.api.bazarr(svc.key);

  // Health powers the notifications bell (parity with Prowlarr).
  let health = [];
  try { const r = await bz.get('system/health'); health = (r && r.data) || []; } catch { /* ignore */ }

  ctx.setActions(
    viewToggle(svc.key, ctx.reload),
    h('button', { class: 'btn pw-bell', title: 'Health notifications', onclick: () => openNotifications(health) },
      bellSvg(), health.length ? h('span', { class: 'pw-badge' }, String(health.length)) : null),
  );

  const body = h('div', {});
  const bar = tabs(body, [
    { id: 'series', label: 'Series', render: (c) => tabSeries(c, ctx, bz) },
    { id: 'movies', label: 'Movies', render: (c) => tabMovies(c, ctx, bz) },
    { id: 'wanted', label: 'Wanted', render: (c) => tabWanted(c, ctx, bz) },
    { id: 'history', label: 'History', render: (c) => tabHistory(c, ctx, bz) },
    { id: 'blacklist', label: 'Blacklist', render: (c) => tabBlacklist(c, ctx, bz) },
    { id: 'providers', label: 'Providers', render: (c) => tabProviders(c, ctx, bz) },
    { id: 'system', label: 'System', render: (c) => tabSystem(c, ctx, bz) },
  ], `tabs-${svc.key}`);
  mount(root, bar, body);
}

function notConfigured() {
  return h('div', { class: 'empty', style: { padding: '48px 24px' } },
    h('div', { class: 'empty-icon' }, ''),
    h('div', { style: { fontWeight: '700', fontSize: '16px' } }, 'Bazarr isn’t configured yet'),
    h('div', { class: 'dim', style: { marginTop: '10px', maxWidth: '540px', lineHeight: '1.6' } },
      'Add your Bazarr URL and API key to ', h('span', { class: 'mono' }, 'config.json'),
      ' under ', h('span', { class: 'mono' }, 'services.bazarr'),
      ' (the API key is in Bazarr under Settings → General → Security), then restart the server. Or run ',
      h('span', { class: 'mono' }, 'npm run demo'), ' to explore with mock data.'),
  );
}

const bellSvg = () => h('span', { class: 'pw-bell-ico', html: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>' });

function openNotifications(health) {
  const list = (health && health.length)
    ? h('div', { class: 'list' }, ...health.map((c) => h('div', { class: 'row' },
        h('div', { class: 'row-main' },
          h('div', { class: 'row-title' }, c.issue || c.message || 'Health issue'),
          h('div', { class: 'meta-line', style: { marginTop: '4px' } },
            h('span', { class: 'pill warn' }, 'Health'),
            c.object ? h('span', { class: 'dim' }, c.object) : null,
          ),
        ),
      )))
    : h('div', { class: 'empty', style: { padding: '24px' } }, 'No health issues — everything looks good');
  openModal({ title: 'Bazarr Notifications', body: list });
}

// ---- Stat header ----
function statCard(label, value) {
  return h('div', { class: 'hex-cell hex-static' },
    h('div', { class: 'hex-border' }),
    h('div', { class: 'hex-face' },
      h('div', { class: 'hex-inner' },
        h('div', { class: 'stat' },
          h('span', { class: 'stat-value' }, String(value)),
          h('span', { class: 'stat-label' }, label),
        ),
      ),
    ),
  );
}

// Render subtitle language chips from a list of {name, code2, forced, hi}.
function langPills(langs, cls) {
  return (langs || []).map((l) => {
    const extra = [l.forced ? 'Forced' : null, l.hi ? 'HI' : null].filter(Boolean).join('/');
    return h('span', { class: `pill ${cls}` }, `${l.name || l.code2 || '??'}${extra ? ` (${extra})` : ''}`);
  });
}

// ---- Filter bar (matches the arr library views) ----
function filterBar(defs, items, onChange) {
  let statusId = 'all';
  let term = '';
  const apply = () => {
    const def = defs.find((d) => d.id === statusId) || defs[0];
    const t = term.trim().toLowerCase();
    onChange(items.filter((it) => def.test(it) && (!t || String(it.title || it.seriesTitle || '').toLowerCase().includes(t))));
  };
  const search = h('input', { class: 'input lib-filter-search', type: 'search', placeholder: 'Filter by title…' });
  search.addEventListener('input', () => { term = search.value; apply(); });
  const sel = h('select', { class: 'input lib-filter-select' }, ...defs.map((d) => h('option', { value: d.id }, d.label)));
  sel.addEventListener('change', () => { statusId = sel.value; apply(); });
  return { el: h('div', { class: 'lib-filter' }, search, sel), apply };
}

async function getProfiles(ctx, bz) {
  try {
    const profiles = await cachedGet(`bazarr:${ctx.service.key}:profiles`, () => bz.get('system/languages/profiles'), 600000);
    const map = {};
    for (const p of (profiles || [])) map[p.profileId] = p.name;
    return map;
  } catch { return {}; }
}

// ---- Series ----
async function tabSeries(root, ctx, bz) {
  mount(root, skeletonList());
  try {
    const [resp, profileMap] = await Promise.all([bz.get('series'), getProfiles(ctx, bz)]);
    const series = (resp && resp.data) || [];
    if (!series.length) return mount(root, empty('', 'No series', 'Bazarr has no series from Sonarr yet'));
    const missing = series.reduce((a, s) => a + (s.episodeMissingCount || 0), 0);
    const monitored = series.filter((s) => s.monitored).length;
    const header = h('div', { class: 'honeycomb' }, h('div', { class: 'hc-row' },
      statCard('Series', series.length),
      statCard('Missing Subs', missing),
      statCard('Monitored', monitored),
    ));

    const listWrap = h('div', {});
    const isHex = effectiveMode(ctx.service.key) === 'hex';
    const render = (items) => {
      if (!items.length) return mount(listWrap, empty('', 'No matches', 'No series match this filter'));
      mount(listWrap, isHex
        ? hive(items.map((s) => seriesHex(s, bz, profileMap, () => tabSeries(root, ctx, bz))), listWrap.clientWidth)
        : h('div', { class: 'list' }, ...items.map((s) => seriesRow(s, bz, profileMap, () => tabSeries(root, ctx, bz)))));
    };
    const defs = [
      { id: 'all', label: 'All', test: () => true },
      { id: 'missing', label: 'Missing subtitles', test: (s) => (s.episodeMissingCount || 0) > 0 },
      { id: 'complete', label: 'Complete', test: (s) => (s.episodeMissingCount || 0) === 0 },
      { id: 'monitored', label: 'Monitored', test: (s) => !!s.monitored },
      { id: 'unmonitored', label: 'Unmonitored', test: (s) => !s.monitored },
    ];
    const f = filterBar(defs, series, render);
    mount(root, header, h('div', { class: 'lib-head' }, f.el), listWrap);
    render(series);
  } catch (err) {
    mount(root, empty('', 'Failed to load series', err.message, { label: 'Retry', onClick: () => tabSeries(root, ctx, bz) }));
  }
}

function seriesMeta(s, profileMap) {
  const miss = s.episodeMissingCount || 0;
  return {
    complete: miss === 0,
    pills: [
      s.monitored ? { label: 'Monitored', cls: 'info' } : { label: 'Unmonitored', cls: 'muted' },
      miss > 0 ? { label: `${miss} missing`, cls: 'warn' } : { label: 'Complete', cls: 'ok' },
    ],
    sub: [profileMap[s.profileId] || `Profile ${s.profileId ?? '—'}`, `${s.episodeFileCount ?? 0} eps`].filter(Boolean).join(' · '),
  };
}

function seriesHex(s, bz, profileMap, reload) {
  const m = seriesMeta(s, profileMap);
  const actions = h('div', { class: 'row-actions' },
    h('button', { class: 'btn sm', title: 'Search missing subtitles', onclick: (e) => { e.stopPropagation(); searchSeries(s, bz, reload); } }, 'Search'),
  );
  return posterHexCard({
    gradient: m.complete ? OK_GRAD : MISS_GRAD,
    title: `${s.title}${s.year ? ` (${s.year})` : ''}`,
    pills: m.pills, sub: m.sub, actions,
  });
}

function seriesRow(s, bz, profileMap, reload) {
  const m = seriesMeta(s, profileMap);
  return h('div', { class: 'row' },
    h('div', { class: 'poster', style: { width: '40px', height: '40px', fontSize: '16px' } }, '📺'),
    h('div', { class: 'row-main' },
      h('div', { class: 'row-title' }, `${s.title} `, h('span', { class: 'dim nowrap' }, s.year ? `(${s.year})` : '')),
      h('div', { class: 'meta-line', style: { marginTop: '4px' } },
        ...m.pills.map((p) => h('span', { class: `pill ${p.cls}` }, p.label)),
        h('span', { class: 'dim' }, m.sub),
      ),
    ),
    h('div', { class: 'row-actions' },
      h('button', { class: 'btn sm', title: 'Search missing subtitles', onclick: () => searchSeries(s, bz, reload) }, 'Search'),
    ),
  );
}

async function searchSeries(s, bz, reload) {
  toast(`Searching subtitles for ${s.title}…`, 'info', 1500);
  try {
    await bz.patch(`series?seriesid=${s.sonarrSeriesId}`);
    toast(`Subtitle search queued for ${s.title}`, 'success');
    if (reload) reload();
  } catch (e) { toast(e.message || 'Search failed', 'error'); }
}

// ---- Movies ----
async function tabMovies(root, ctx, bz) {
  mount(root, skeletonList());
  try {
    const [resp, profileMap] = await Promise.all([bz.get('movies'), getProfiles(ctx, bz)]);
    const movies = (resp && resp.data) || [];
    if (!movies.length) return mount(root, empty('', 'No movies', 'Bazarr has no movies from Radarr yet'));
    const missing = movies.filter((m) => (m.missing_subtitles || []).length > 0).length;
    const monitored = movies.filter((m) => m.monitored).length;
    const header = h('div', { class: 'honeycomb' }, h('div', { class: 'hc-row' },
      statCard('Movies', movies.length),
      statCard('Missing Subs', missing),
      statCard('Monitored', monitored),
    ));

    const listWrap = h('div', {});
    const isHex = effectiveMode(ctx.service.key) === 'hex';
    const render = (items) => {
      if (!items.length) return mount(listWrap, empty('', 'No matches', 'No movies match this filter'));
      mount(listWrap, isHex
        ? hive(items.map((m) => movieHex(m, bz, profileMap, () => tabMovies(root, ctx, bz))), listWrap.clientWidth)
        : h('div', { class: 'list' }, ...items.map((m) => movieRow(m, bz, profileMap, () => tabMovies(root, ctx, bz)))));
    };
    const defs = [
      { id: 'all', label: 'All', test: () => true },
      { id: 'missing', label: 'Missing subtitles', test: (m) => (m.missing_subtitles || []).length > 0 },
      { id: 'complete', label: 'Complete', test: (m) => (m.missing_subtitles || []).length === 0 },
      { id: 'monitored', label: 'Monitored', test: (m) => !!m.monitored },
      { id: 'unmonitored', label: 'Unmonitored', test: (m) => !m.monitored },
    ];
    const f = filterBar(defs, movies, render);
    mount(root, header, h('div', { class: 'lib-head' }, f.el), listWrap);
    render(movies);
  } catch (err) {
    mount(root, empty('', 'Failed to load movies', err.message, { label: 'Retry', onClick: () => tabMovies(root, ctx, bz) }));
  }
}

function movieMeta(m, profileMap) {
  const have = (m.subtitles || []).length;
  const miss = (m.missing_subtitles || []).length;
  return {
    complete: miss === 0,
    pills: [
      m.monitored ? { label: 'Monitored', cls: 'info' } : { label: 'Unmonitored', cls: 'muted' },
      miss > 0 ? { label: `${miss} missing`, cls: 'warn' } : { label: 'Complete', cls: 'ok' },
    ],
    sub: [profileMap[m.profileId] || `Profile ${m.profileId ?? '—'}`, `${have} subtitle${have === 1 ? '' : 's'}`].join(' · '),
  };
}

function movieHex(m, bz, profileMap, reload) {
  const meta = movieMeta(m, profileMap);
  const actions = (m.missing_subtitles || []).length ? h('div', { class: 'row-actions' },
    h('button', { class: 'btn sm', title: 'Search missing subtitles', onclick: (e) => { e.stopPropagation(); searchMovie(m, bz, reload); } }, 'Search'),
  ) : null;
  return posterHexCard({
    gradient: meta.complete ? OK_GRAD : MISS_GRAD,
    title: `${m.title}${m.year ? ` (${m.year})` : ''}`,
    pills: meta.pills, sub: meta.sub, actions,
  });
}

function movieRow(m, bz, profileMap, reload) {
  const meta = movieMeta(m, profileMap);
  return h('div', { class: 'row' },
    h('div', { class: 'poster', style: { width: '40px', height: '40px', fontSize: '16px' } }, '🎬'),
    h('div', { class: 'row-main' },
      h('div', { class: 'row-title' }, `${m.title} `, h('span', { class: 'dim nowrap' }, m.year ? `(${m.year})` : '')),
      h('div', { class: 'meta-line', style: { marginTop: '4px' } },
        ...meta.pills.map((p) => h('span', { class: `pill ${p.cls}` }, p.label)),
        ...langPills(m.missing_subtitles, 'warn'),
        h('span', { class: 'dim' }, meta.sub),
      ),
    ),
    (m.missing_subtitles || []).length ? h('div', { class: 'row-actions' },
      h('button', { class: 'btn sm', title: 'Search missing subtitles', onclick: () => searchMovie(m, bz, reload) }, 'Search'),
    ) : null,
  );
}

async function searchMovie(m, bz, reload) {
  toast(`Searching subtitles for ${m.title}…`, 'info', 1500);
  try {
    await bz.patch(`movies?radarrid=${m.radarrId}`);
    toast(`Subtitle search queued for ${m.title}`, 'success');
    if (reload) reload();
  } catch (e) { toast(e.message || 'Search failed', 'error'); }
}

// ---- Wanted (missing subtitles) ----
async function tabWanted(root, ctx, bz) {
  mount(root, skeletonList());
  try {
    const [epResp, mvResp] = await Promise.all([
      bz.get('episodes/wanted').catch(() => ({ data: [] })),
      bz.get('movies/wanted').catch(() => ({ data: [] })),
    ]);
    const eps = (epResp && epResp.data) || [];
    const mvs = (mvResp && mvResp.data) || [];
    const reload = () => tabWanted(root, ctx, bz);

    if (!eps.length && !mvs.length) {
      return mount(root, empty('', 'Nothing wanted', 'Every monitored item has its subtitles 🎉'));
    }

    const header = h('div', { class: 'honeycomb' }, h('div', { class: 'hc-row' },
      statCard('Episodes', eps.length),
      statCard('Movies', mvs.length),
    ));

    const searchAll = h('button', { class: 'btn sm primary', onclick: async () => {
      toast('Searching all wanted subtitles…', 'info', 1800);
      try {
        for (const e of eps) await bz.patch(`episodes?episodeid=${e.sonarrEpisodeId}`);
        for (const m of mvs) await bz.patch(`movies?radarrid=${m.radarrId}`);
        toast('Subtitle search queued for all wanted items', 'success');
        reload();
      } catch (err) { toast(err.message || 'Search failed', 'error'); }
    } }, '⌕ Search all');

    const blocks = [header, h('div', { class: 'lib-head' }, searchAll)];
    if (eps.length) {
      blocks.push(h('div', { class: 'section-title' }, `Episodes (${eps.length})`));
      blocks.push(h('div', { class: 'list' }, ...eps.map((e) => wantedEpisodeRow(e, bz, reload))));
    }
    if (mvs.length) {
      blocks.push(h('div', { class: 'section-title', style: { marginTop: '18px' } }, `Movies (${mvs.length})`));
      blocks.push(h('div', { class: 'list' }, ...mvs.map((m) => wantedMovieRow(m, bz, reload))));
    }
    mount(root, ...blocks);
  } catch (err) {
    mount(root, empty('', 'Failed to load wanted', err.message, { label: 'Retry', onClick: () => tabWanted(root, ctx, bz) }));
  }
}

function wantedEpisodeRow(e, bz, reload) {
  return h('div', { class: 'row' },
    h('div', { class: 'poster', style: { width: '40px', height: '40px', fontSize: '16px' } }, '📺'),
    h('div', { class: 'row-main' },
      h('div', { class: 'row-title' }, `${e.seriesTitle} `, h('span', { class: 'dim' }, e.episode_number ? `· ${e.episode_number}` : ''), e.episodeTitle ? h('span', { class: 'dim' }, ` · ${e.episodeTitle}`) : null),
      h('div', { class: 'meta-line', style: { marginTop: '4px' } },
        h('span', { class: 'dim' }, 'Missing:'),
        ...langPills(e.missing_subtitles, 'warn'),
        e.failedAttempts ? h('span', { class: 'pill muted' }, `${e.failedAttempts} failed`) : null,
      ),
    ),
    h('div', { class: 'row-actions' },
      h('button', { class: 'btn sm primary', title: 'Auto-search & download best subtitle', onclick: async () => {
        toast('Searching subtitles…', 'info', 1200);
        try { await bz.patch(`episodes?episodeid=${e.sonarrEpisodeId}`); toast('Subtitle search complete', 'success'); reload(); }
        catch (err) { toast(err.message || 'Search failed', 'error'); }
      } }, '⌕ Search'),
      h('button', { class: 'btn sm', title: 'Browse providers and pick a subtitle', onclick: () => openManualSearch(bz, 'episode', e, reload) }, 'Manual'),
    ),
  );
}

function wantedMovieRow(m, bz, reload) {
  return h('div', { class: 'row' },
    h('div', { class: 'poster', style: { width: '40px', height: '40px', fontSize: '16px' } }, '🎬'),
    h('div', { class: 'row-main' },
      h('div', { class: 'row-title' }, `${m.title} `, h('span', { class: 'dim nowrap' }, m.year ? `(${m.year})` : '')),
      h('div', { class: 'meta-line', style: { marginTop: '4px' } },
        h('span', { class: 'dim' }, 'Missing:'),
        ...langPills(m.missing_subtitles, 'warn'),
        m.failedAttempts ? h('span', { class: 'pill muted' }, `${m.failedAttempts} failed`) : null,
      ),
    ),
    h('div', { class: 'row-actions' },
      h('button', { class: 'btn sm primary', title: 'Auto-search & download best subtitle', onclick: async () => {
        toast('Searching subtitles…', 'info', 1200);
        try { await bz.patch(`movies?radarrid=${m.radarrId}`); toast('Subtitle search complete', 'success'); reload(); }
        catch (err) { toast(err.message || 'Search failed', 'error'); }
      } }, '⌕ Search'),
      h('button', { class: 'btn sm', title: 'Browse providers and pick a subtitle', onclick: () => openManualSearch(bz, 'movie', m, reload) }, 'Manual'),
    ),
  );
}

// ---- History ----
async function tabHistory(root, ctx, bz) {
  mount(root, skeletonList());
  try {
    const [epResp, mvResp] = await Promise.all([
      bz.get('history/series?length=50').catch(() => ({ data: [] })),
      bz.get('history/movies?length=50').catch(() => ({ data: [] })),
    ]);
    const rows = [
      ...((epResp && epResp.data) || []).map((r) => ({ ...r, _kind: 'episode' })),
      ...((mvResp && mvResp.data) || []).map((r) => ({ ...r, _kind: 'movie' })),
    ].sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
    if (!rows.length) return mount(root, empty('', 'No history yet'));
    mount(root, h('div', { class: 'list' }, ...rows.map(historyRow)));
  } catch (err) {
    mount(root, empty('', 'Failed to load history', err.message, { label: 'Retry', onClick: () => tabHistory(root, ctx, bz) }));
  }
}

function historyRow(r) {
  const act = HISTORY_ACTION[r.action] || { label: 'Event', cls: 'muted' };
  const title = r._kind === 'episode'
    ? `${r.seriesTitle}${r.episode_number ? ` · ${r.episode_number}` : ''}${r.episodeTitle ? ` · ${r.episodeTitle}` : ''}`
    : r.title;
  const when = r.timestamp && !Number.isNaN(Date.parse(r.timestamp)) ? timeEl(r.timestamp) : (r.timestamp ? h('span', { class: 'dim' }, String(r.timestamp)) : null);
  return h('div', { class: 'row' },
    h('div', { class: 'poster', style: { width: '40px', height: '40px', fontSize: '16px' } }, r._kind === 'episode' ? '📺' : '🎬'),
    h('div', { class: 'row-main' },
      h('div', { class: 'row-title' }, title || 'Unknown'),
      h('div', { class: 'row-sub' }, r.description || ''),
      h('div', { class: 'meta-line', style: { marginTop: '4px' } },
        h('span', { class: `pill ${act.cls}` }, act.label),
        r.language ? h('span', { class: 'pill info' }, r.language.name || r.language.code2 || 'sub') : null,
        r.provider ? h('span', { class: 'pill muted' }, r.provider) : null,
        r.score ? h('span', { class: 'dim' }, `score ${r.score}`) : null,
        when,
      ),
    ),
  );
}

// ---- Providers ----
async function tabProviders(root, ctx, bz) {
  mount(root, skeletonList());
  try {
    const resp = await bz.get('providers');
    const providers = (resp && resp.data) || [];
    if (!providers.length) return mount(root, empty('', 'No providers', 'Enable subtitle providers in Bazarr → Settings → Providers'));
    const good = providers.filter((p) => /good/i.test(p.status)).length;
    const throttled = providers.filter((p) => /throttl/i.test(p.status)).length;
    const header = h('div', { class: 'honeycomb' }, h('div', { class: 'hc-row' },
      statCard('Providers', providers.length),
      statCard('Healthy', good),
      statCard('Throttled', throttled),
    ));
    const isHex = effectiveMode(ctx.service.key) === 'hex';
    const list = isHex
      ? hive(providers.map(providerHex), root.clientWidth, { W: 300, H: 240 })
      : h('div', { class: 'list' }, ...providers.map(providerRow));
    mount(root, header, h('div', { class: 'section-title' }, 'Providers'), list);
  } catch (err) {
    mount(root, empty('', 'Failed to load providers', err.message, { label: 'Retry', onClick: () => tabProviders(root, ctx, bz) }));
  }
}

function providerStatus(p) {
  const throttled = /throttl/i.test(p.status || '');
  return { throttled, cls: throttled ? 'warn' : 'ok', label: throttled ? 'Throttled' : 'Good' };
}
function providerRow(p) {
  const s = providerStatus(p);
  return h('div', { class: 'row' },
    h('div', { class: 'poster', style: { width: '40px', height: '40px', fontSize: '16px' } }, '💬'),
    h('div', { class: 'row-main' },
      h('div', { class: 'row-title' }, p.name),
      h('div', { class: 'meta-line', style: { marginTop: '4px' } },
        h('span', { class: `pill ${s.cls}` }, s.label),
        h('span', { class: 'dim' }, p.status || ''),
      ),
    ),
  );
}
function providerHex(p) {
  const s = providerStatus(p);
  return posterHexCard({
    gradient: s.throttled ? MISS_GRAD : NEU_GRAD,
    title: p.name,
    pills: [{ label: s.label, cls: s.cls }],
    sub: p.status || '',
  });
}

// ---- System ----
function infoRow(label, value) {
  return h('div', { class: 'setting-row' },
    h('span', { class: 'dim' }, label),
    h('span', { class: 'right' }, value ?? '—'),
  );
}

async function tabSystem(root, ctx, bz) {
  mount(root, skeletonList());
  try {
    const [statusResp, health, langs, profiles] = await Promise.all([
      bz.get('system/status'),
      bz.get('system/health').then((r) => (r && r.data) || []).catch(() => []),
      bz.get('system/languages').catch(() => []),
      bz.get('system/languages/profiles').catch(() => []),
    ]);
    const s = (statusResp && statusResp.data) || {};
    const enabledLangs = (Array.isArray(langs) ? langs : []).filter((l) => l.enabled);

    const statusCard = h('div', { class: 'card' },
      h('h3', {}, 'System'),
      infoRow('Bazarr version', s.bazarr_version),
      infoRow('Sonarr version', s.sonarr_version),
      infoRow('Radarr version', s.radarr_version),
      infoRow('Operating system', s.operating_system),
      infoRow('Python', s.python_version),
      s.start_time ? infoRow('Started', new Date(s.start_time).toLocaleString()) : null,
    );

    const healthCard = h('div', { class: 'card' },
      h('h3', {}, `Health${health.length ? ` (${health.length})` : ''}`),
      health.length
        ? h('div', { class: 'list' }, ...health.map((c) => h('div', { class: 'row' },
            h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, c.issue || c.message || 'Issue'), c.object ? h('div', { class: 'row-sub' }, c.object) : null))))
        : h('div', { class: 'dim' }, 'No health issues — everything looks good.'),
    );

    const langCard = h('div', { class: 'card' },
      h('h3', {}, 'Enabled Languages'),
      enabledLangs.length
        ? h('div', { class: 'meta-line' }, ...enabledLangs.map((l) => h('span', { class: 'pill info' }, `${l.name} (${l.code2})`)))
        : h('div', { class: 'dim' }, 'No languages enabled.'),
    );

    const profileCard = h('div', { class: 'card' },
      h('h3', {}, 'Language Profiles'),
      (Array.isArray(profiles) && profiles.length)
        ? h('div', { class: 'list' }, ...profiles.map((p) => h('div', { class: 'row' },
            h('div', { class: 'row-main' },
              h('div', { class: 'row-title' }, p.name),
              h('div', { class: 'meta-line', style: { marginTop: '4px' } },
                ...((p.items || []).map((it) => h('span', { class: 'pill muted' }, it.language)))),
            ))))
        : h('div', { class: 'dim' }, 'No language profiles configured.'),
    );

    mount(root, h('div', { class: 'grid cols-2' }, statusCard, healthCard, langCard, profileCard));
  } catch (err) {
    mount(root, empty('', 'Failed to load system info', err.message, { label: 'Retry', onClick: () => tabSystem(root, ctx, bz) }));
  }
}

// ---- Manual search: browse provider candidates and download a chosen one ----
async function openManualSearch(bz, kind, item, reload) {
  const bodyEl = h('div', {}, spinner());
  const title = kind === 'episode'
    ? `${item.seriesTitle}${item.episode_number ? ` · ${item.episode_number}` : ''}`
    : `${item.title}${item.year ? ` (${item.year})` : ''}`;
  openModal({ title: `Manual search — ${title}`, body: bodyEl, wide: true });

  const path = kind === 'episode'
    ? `providers/episodes?episodeid=${item.sonarrEpisodeId}`
    : `providers/movies?radarrid=${item.radarrId}`;
  let list = [];
  try { const r = await bz.get(path); list = (r && r.data) || []; }
  catch (e) { return mount(bodyEl, empty('', 'Search failed', e.message)); }
  if (!list.length) return mount(bodyEl, empty('', 'No subtitles found', 'No enabled provider returned a match'));
  list.sort((a, b) => (b.score || 0) - (a.score || 0));
  mount(bodyEl, h('div', { class: 'list' }, ...list.map((c) => manualResultRow(bz, kind, item, c, reload))));
}

function manualResultRow(bz, kind, item, c, reload) {
  const lang = c.language || {};
  const extra = [c.hearing_impaired ? 'HI' : null, c.forced ? 'Forced' : null].filter(Boolean).join('/');
  const score = Number(c.score) || 0;
  const scoreCls = score >= 90 ? 'ok' : score >= 75 ? 'info' : 'warn';
  const download = async (ev) => {
    const btn = ev.currentTarget; btn.disabled = true; btn.textContent = 'Downloading…';
    try {
      const p = kind === 'episode'
        ? `providers/episodes?episodeid=${item.sonarrEpisodeId}`
        : `providers/movies?radarrid=${item.radarrId}`;
      await bz.post(p, { provider: c.provider, subtitle: c.subtitle, hi: !!c.hearing_impaired, forced: !!c.forced, original_format: false, language: lang.code2 });
      toast('Subtitle downloaded', 'success');
      closeModal();
      if (reload) reload();
    } catch (err) { btn.disabled = false; btn.textContent = '⤓ Download'; toast(err.message || 'Download failed', 'error'); }
  };
  return h('div', { class: 'row' },
    h('div', { class: 'poster', style: { width: '44px', height: '44px', fontSize: '15px', fontWeight: '800' } }, String(score)),
    h('div', { class: 'row-main' },
      h('div', { class: 'row-title', style: { fontSize: '13px' } }, (c.release_info && c.release_info[0]) || 'Subtitle'),
      h('div', { class: 'meta-line', style: { marginTop: '4px' } },
        h('span', { class: 'pill info' }, `${lang.name || lang.code2 || 'sub'}${extra ? ` (${extra})` : ''}`),
        h('span', { class: 'pill muted' }, c.provider || 'provider'),
        h('span', { class: `pill ${scoreCls}` }, `score ${score}`),
        c.uploader ? h('span', { class: 'dim' }, `by ${c.uploader}`) : null,
      ),
      (c.matches && c.matches.length) ? h('div', { class: 'row-sub' }, `Matches: ${c.matches.join(', ')}`) : null,
    ),
    h('div', { class: 'row-actions' },
      h('button', { class: 'btn sm primary', onclick: download }, '⤓ Download'),
    ),
  );
}

// ---- Blacklist (rejected subtitles Bazarr won't re-download) ----
async function tabBlacklist(root, ctx, bz) {
  mount(root, skeletonList());
  try {
    const [epResp, mvResp] = await Promise.all([
      bz.get('episodes/blacklist').catch(() => ({ data: [] })),
      bz.get('movies/blacklist').catch(() => ({ data: [] })),
    ]);
    const eps = (epResp && epResp.data) || [];
    const mvs = (mvResp && mvResp.data) || [];
    const reload = () => tabBlacklist(root, ctx, bz);
    if (!eps.length && !mvs.length) {
      return mount(root, empty('', 'Blacklist is empty', 'Subtitles you reject appear here so Bazarr won’t grab them again'));
    }
    const header = h('div', { class: 'honeycomb' }, h('div', { class: 'hc-row' },
      statCard('Episodes', eps.length),
      statCard('Movies', mvs.length),
    ));
    const clearAll = h('button', { class: 'btn sm danger', onclick: async () => {
      try {
        if (eps.length) await bz.del('episodes/blacklist?all=true');
        if (mvs.length) await bz.del('movies/blacklist?all=true');
        toast('Blacklist cleared', 'success'); reload();
      } catch (err) { toast(err.message || 'Failed to clear', 'error'); }
    } }, 'Clear all');
    const blocks = [header, h('div', { class: 'lib-head' }, clearAll)];
    if (eps.length) {
      blocks.push(h('div', { class: 'section-title' }, `Episodes (${eps.length})`));
      blocks.push(h('div', { class: 'list' }, ...eps.map((b) => blacklistRow('episode', b, bz, reload))));
    }
    if (mvs.length) {
      blocks.push(h('div', { class: 'section-title', style: { marginTop: '18px' } }, `Movies (${mvs.length})`));
      blocks.push(h('div', { class: 'list' }, ...mvs.map((b) => blacklistRow('movie', b, bz, reload))));
    }
    mount(root, ...blocks);
  } catch (err) {
    mount(root, empty('', 'Failed to load blacklist', err.message, { label: 'Retry', onClick: () => tabBlacklist(root, ctx, bz) }));
  }
}

function blacklistRow(kind, b, bz, reload) {
  const lang = b.language || {};
  const title = kind === 'episode'
    ? `${b.seriesTitle || 'Unknown'}${b.episode_number ? ` · ${b.episode_number}` : ''}`
    : (b.title || 'Unknown');
  const when = b.timestamp && !Number.isNaN(Date.parse(b.timestamp)) ? timeEl(b.timestamp) : null;
  const remove = async () => {
    try {
      const base = kind === 'episode' ? 'episodes/blacklist' : 'movies/blacklist';
      await bz.del(`${base}?id=${encodeURIComponent(b.id)}&subs_id=${encodeURIComponent(b.subs_id || '')}`);
      toast('Removed from blacklist', 'success'); reload();
    } catch (err) { toast(err.message || 'Failed to remove', 'error'); }
  };
  return h('div', { class: 'row' },
    h('div', { class: 'poster', style: { width: '40px', height: '40px', fontSize: '16px' } }, kind === 'episode' ? '📺' : '🎬'),
    h('div', { class: 'row-main' },
      h('div', { class: 'row-title' }, title),
      h('div', { class: 'meta-line', style: { marginTop: '4px' } },
        lang.name ? h('span', { class: 'pill info' }, lang.name) : null,
        b.provider ? h('span', { class: 'pill muted' }, b.provider) : null,
        when,
      ),
      b.subtitles_path ? h('div', { class: 'row-sub' }, b.subtitles_path) : null,
    ),
    h('div', { class: 'row-actions' },
      h('button', { class: 'btn sm', title: 'Remove from blacklist', onclick: remove }, 'Remove'),
    ),
  );
}
