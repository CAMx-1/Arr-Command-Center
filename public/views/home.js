import { h, mount, clear, spinner, empty, fmtBytes, fmtDate, pct, svcIcon, toast } from '../lib/ui.js';
import { SERVICE_META } from '../app.js';
import { listFailed, removeFailed } from '../lib/failedRequests.js';
import { visibleServices } from '../lib/servicePrefs.js';
import { honeycombRows, isWide } from '../lib/honeycomb.js';

// ---- Activity source definitions ----
const ACTIVITY_DEFS = [
  { id: 'failed', label: 'Failed Requests', local: true },
  { id: 'streams', label: 'Active Streams', type: 'tautulli' },
  { id: 'sab', label: 'Downloads', type: 'sabnzbd' },
  { id: 'qbittorrent', label: 'Torrents', type: 'qbittorrent' },
  { id: 'sonarr', label: 'Sonarr Queue', type: 'sonarr' },
  { id: 'radarr', label: 'Radarr Queue', type: 'radarr' },
  { id: 'seerr-approval', label: 'Needs Approval', type: 'overseerr' },
  { id: 'seerr-requests', label: 'Recent Requests', type: 'overseerr' },
  { id: 'bazarr', label: 'Wanted Subtitles', type: 'bazarr' },
];
const ACTIVITY_DEFAULTS = { failed: true, streams: true, sab: true, sonarr: true, radarr: true, 'seerr-approval': true, 'seerr-requests': false, bazarr: false, qbittorrent: true };
const REQ_STATUS = { 1: 'Pending', 2: 'Approved', 3: 'Declined' };

function loadActivityPrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem('activity-sources'));
    if (saved && typeof saved === 'object') return { ...ACTIVITY_DEFAULTS, ...saved };
  } catch { /* ignore */ }
  return { ...ACTIVITY_DEFAULTS };
}
function saveActivityPrefs(prefs) { localStorage.setItem('activity-sources', JSON.stringify(prefs)); }

export async function renderHome(root, ctx) {
  const { api, state } = ctx;
  ctx.setActions(h('span', { class: 'dim', style: { fontSize: '13px' } }, state.config.mock ? 'Showing mock data' : 'Live'));

  mount(root, spinner());

  let status = {};
  try { status = await api.status(); state.status = status; } catch { /* ignore */ }

  const shown = visibleServices(state.services);
  const rows = honeycombRows(shown);
  const wide = isWide(shown.length);
  // When the two rows are equal length they don't nestle by centering alone, so
  // flag it for CSS to offset alternate rows.
  const evenSplit = wide && rows.length === 2 && rows[0].length === rows[1].length;
  const hcClass = 'honeycomb' + (wide ? ' hc-wide' : '') + (evenSplit ? ' hc-wide-even' : '');
  const honeycomb = h('div', { class: hcClass },
    ...rows.map((rowItems) =>
      h('div', { class: 'hc-row' }, ...rowItems.map((svc) => hexCell(svc, status[svc.key], ctx)))));

  mount(root,
    h('div', { class: 'section-title' }, 'Services'),
    honeycomb,
    h('div', { class: 'activity-header' },
      h('div', { class: 'section-title', style: { margin: 0 } }, 'Activity'),
      h('div', { class: 'activity-toggles', id: 'activity-toggles' }),
    ),
    h('div', { class: 'card', id: 'activity-panel' }, h('div', { class: 'dim' }, 'Loading activity…')),
    h('div', { class: 'section-title', style: { marginTop: '26px' } }, 'Upcoming'),
    h('div', { class: 'card', id: 'upcoming-panel' }, h('div', { class: 'dim' }, 'Loading calendar…')),
    h('div', { class: 'section-title', style: { marginTop: '26px' } }, 'Quick Links'),
    h('div', { class: 'card', id: 'links-panel' }, h('div', { class: 'dim' }, 'Loading links…')),
  );

  for (const svc of shown) hydrateCardStats(svc, ctx);
  buildActivityToggles(ctx);
  hydrateActivity(ctx);
  hydrateUpcoming(ctx);
  hydrateLinks(ctx);
}

async function hydrateLinks(ctx) {
  const panel = document.getElementById('links-panel');
  if (!panel) return;
  let links = [];
  try { links = await ctx.api.links(); } catch { /* ignore */ }
  if (!links.length) { mount(panel, h('div', { class: 'dim' }, 'No custom links yet — add them in Settings → Custom Links.')); return; }
  mount(panel, h('div', { class: 'link-grid' }, ...links.map((l) => h('a', {
    class: 'link-tile', href: l.url, target: '_blank', rel: 'noopener noreferrer', title: l.url,
  },
    h('span', { class: 'link-ico' }, l.icon ? h('img', { src: l.icon, alt: '', style: { width: '30px', height: '30px', objectFit: 'contain' } }) : (l.label || '?').slice(0, 1).toUpperCase()),
    h('span', { class: 'link-label' }, l.label),
  ))));
}

const pad2 = (n) => String(n ?? 0).padStart(2, '0');

// Merged upcoming calendar across all configured Sonarr + Radarr instances.
async function hydrateUpcoming(ctx) {
  const panel = document.getElementById('upcoming-panel');
  if (!panel) return;
  const start = new Date();
  const end = new Date(); end.setDate(end.getDate() + 14);
  const s = start.toISOString(), e = end.toISOString();
  const arrs = (ctx.state.services || []).filter((x) => (x.type === 'sonarr' || x.type === 'radarr') && x.configured);
  const items = [];
  await Promise.all(arrs.map(async (svc) => {
    try {
      if (svc.type === 'sonarr') {
        const eps = await ctx.api.arr(svc.key).get(`calendar?start=${s}&end=${e}&includeSeries=true`);
        for (const ep of (eps || [])) if (ep.airDateUtc) items.push({ when: ep.airDateUtc, title: `${(ep.series && ep.series.title) || 'Unknown'} · S${pad2(ep.seasonNumber)}E${pad2(ep.episodeNumber)}`, sub: ep.title || '', svc });
      } else {
        const movies = await ctx.api.arr(svc.key).get(`calendar?start=${s}&end=${e}`);
        for (const m of (movies || [])) { const when = m.digitalRelease || m.physicalRelease || m.inCinemas; if (when) items.push({ when, title: `${m.title}${m.year ? ` (${m.year})` : ''}`, sub: 'Release', svc }); }
      }
    } catch { /* ignore per-service */ }
  }));
  if (!items.length) { panel.classList.remove('panel-bare'); mount(panel, empty('', 'Nothing upcoming', 'No releases in the next 2 weeks')); return; }
  items.sort((a, b) => new Date(a.when) - new Date(b.when));
  const byDay = new Map();
  for (const it of items) {
    const key = new Date(it.when).toDateString();
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(it);
  }
  const blocks = [];
  for (const [day, list] of byDay) {
    blocks.push(h('div', { class: 'up-day' }, fmtDate(day)));
    for (const it of list) {
      const meta = SERVICE_META[it.svc.type] || {};
      blocks.push(h('div', { class: 'row up-row' },
        h('div', { class: 'poster', style: { width: '34px', height: '34px' } }, svcIcon(meta.logo, meta.emoji || '', 22)),
        h('div', { class: 'row-main' },
          h('div', { class: 'row-title', style: { fontSize: '14px' } }, it.title),
          h('div', { class: 'meta-line', style: { marginTop: '2px' } },
            h('span', { class: 'pill muted' }, it.svc.label),
            it.sub ? h('span', { class: 'dim' }, it.sub) : null,
            h('span', {}, new Date(it.when).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })),
          ),
        ),
      ));
    }
  }
  mount(panel, h('div', { class: 'list' }, ...blocks));
}

// Silent refresh used by the auto-refresh interval (no loading flash).
export function refreshHome(ctx) {
  hydrateActivity(ctx, true);
  for (const svc of ctx.state.services) hydrateCardStats(svc, ctx);
}

function hexCell(svc, st, ctx) {
  const meta = SERVICE_META[svc.type] || {};
  const online = st && st.ok;
  const dotClass = online ? 'ok' : (st ? 'down' : '');
  const statsEl = h('div', { class: 'hex-stats', id: `stats-${svc.key}` });
  return h('div', { class: 'hex-cell', title: svc.label, onclick: () => { location.hash = `#/${svc.key}`; } },
    h('div', { class: 'hex-border' }),
    h('div', { class: 'hex-face' },
      h('div', { class: 'hex-inner' },
        h('span', { class: `hex-dot ${dotClass}` }),
        svcIcon(meta.logo, meta.emoji || '', 34),
        h('div', { class: 'hex-name' }, svc.label),
        statsEl,
      ),
    ),
  );
}

function stat(value, label) {
  return h('div', { class: 'stat' }, h('span', { class: 'stat-value' }, value), h('span', { class: 'stat-label' }, label));
}

async function hydrateCardStats(svc, ctx) {
  const { api } = ctx;
  const el = document.getElementById(`stats-${svc.key}`);
  if (!el) return;
  try {
    if (svc.type === 'sonarr' || svc.type === 'radarr') {
      const arr = api.arr(svc.key);
      const [items, queue] = await Promise.all([
        arr.get(svc.type === 'sonarr' ? 'series' : 'movie'),
        arr.get('queue').catch(() => ({ records: [] })),
      ]);
      const count = Array.isArray(items) ? items.length : 0;
      const q = (queue && queue.records) ? queue.records.length : 0;
      mount(el, stat(count, svc.type === 'sonarr' ? 'Series' : 'Movies'), stat(q, 'Queue'));
    } else if (svc.type === 'lidarr' || svc.type === 'readarr') {
      const arr = api.arrV1(svc.key);
      const [items, queue] = await Promise.all([
        arr.get(svc.type === 'lidarr' ? 'artist' : 'author'),
        arr.get('queue').catch(() => ({ records: [] })),
      ]);
      const count = Array.isArray(items) ? items.length : 0;
      const q = (queue && queue.records) ? queue.records.length : 0;
      mount(el, stat(count, svc.type === 'lidarr' ? 'Artists' : 'Authors'), stat(q, 'Queue'));
    } else if (svc.type === 'overseerr') {
      const counts = await api.seerr(svc.key).get('request/count');
      mount(el, stat(counts.pending ?? 0, 'Pending'), stat(counts.total ?? 0, 'Requests'));
    } else if (svc.type === 'sabnzbd') {
      const data = await api.sab(svc.key, { mode: 'queue' });
      const q = data.queue || {};
      mount(el, stat((q.slots || []).length, 'In Queue'), stat(q.status === 'Paused' ? '' : (q.speed || '0'), 'Speed'));
    } else if (svc.type === 'tautulli') {
      const data = await api.tautulli(svc.key).get('get_activity');
      const bw = Number(data.total_bandwidth) || 0;
      const bwLabel = bw >= 1000 ? `${(bw / 1000).toFixed(1)} Mbps` : `${bw} kbps`;
      mount(el, stat(data.stream_count ?? (data.sessions || []).length, 'Streams'), stat(bwLabel, 'Bandwidth'));
    } else if (svc.type === 'bazarr') {
      const badges = await api.bazarr(svc.key).get('badges');
      const wanted = (badges.episodes || 0) + (badges.movies || 0);
      mount(el, stat(wanted, 'Wanted'), stat(badges.providers ?? 0, 'Throttled'));
    } else if (svc.type === 'qbittorrent') {
      const [info, torrents] = await Promise.all([
        api.qbit(svc.key).get('transfer/info').catch(() => ({})),
        api.qbit(svc.key).get('torrents/info').catch(() => []),
      ]);
      const active = (Array.isArray(torrents) ? torrents : []).filter((t) => (t.dlspeed || 0) > 0 || (t.upspeed || 0) > 0).length;
      const dl = Number(info.dl_info_speed) || 0;
      mount(el, stat(active, 'Active'), stat(dl > 0 ? `${fmtBytes(dl)}/s` : '0', 'Down'));
    } else {
      clear(el);
    }
  } catch (err) {
    mount(el, h('span', { class: 'dim' }, 'Stats unavailable'));
  }
}

// ---- Activity toggles ----
function buildActivityToggles(ctx) {
  const { state } = ctx;
  const container = document.getElementById('activity-toggles');
  if (!container) return;
  const prefs = loadActivityPrefs();
  const available = ACTIVITY_DEFS.filter((d) => d.local || state.services.some((s) => s.type === d.type));

  const chips = available.map((def) => {
    const meta = SERVICE_META[def.type] || {};
    const chip = h('button', {
      class: `toggle-chip ${prefs[def.id] ? 'active' : ''}`,
      title: `Toggle ${def.label}`,
      onclick: () => {
        const p = loadActivityPrefs();
        p[def.id] = !p[def.id];
        saveActivityPrefs(p);
        chip.classList.toggle('active', p[def.id]);
        hydrateActivity(ctx);
      },
    }, svcIcon(meta.logo, meta.emoji || '•', 16), h('span', {}, def.label));
    return chip;
  });
  mount(container, ...chips);
}

// ---- Activity list ----
const detailCache = new Map();
async function seerrDetail(ctx, key, mediaType, tmdbId) {
  if (!tmdbId) return null;
  const ck = `${mediaType}:${tmdbId}`;
  if (detailCache.has(ck)) return detailCache.get(ck);
  const p = ctx.api.seerr(key).get(`${mediaType === 'tv' ? 'tv' : 'movie'}/${tmdbId}`).catch(() => null);
  detailCache.set(ck, p);
  return p;
}

async function hydrateActivity(ctx, silent = false) {
  const { state } = ctx;
  const panel = document.getElementById('activity-panel');
  if (!panel) return;
  if (!silent) mount(panel, h('div', { class: 'dim' }, 'Loading activity…'));

  const prefs = loadActivityPrefs();
  const groups = [];
  for (const def of ACTIVITY_DEFS) {
    if (!prefs[def.id]) continue;
    if (def.local) { groups.push({ id: def.id, p: Promise.resolve(failedRows(ctx)) }); continue; }
    // Include every configured instance of the type (supports multiple
    // Sonarr/Radarr instances, e.g. a separate Anime instance).
    const svcs = state.services.filter((s) => s.type === def.type && s.configured !== false);
    for (const svc of svcs) groups.push({ id: def.id, p: fetchSource(def, svc, ctx) });
  }

  if (!groups.length) {
    return mount(panel, h('div', { class: 'empty' }, h('div', { class: 'empty-icon' }, ''), 'No activity sources selected', 'Use the toggles above to choose what appears here'));
  }

  const results = await Promise.all(groups.map((g) => g.p));
  // Pending approvals jump to the top when present (so you don't have to scroll
  // to find them); everything else keeps its configured order.
  const approvals = [];
  const other = [];
  groups.forEach((g, i) => { const r = results[i] || []; (g.id === 'seerr-approval' ? approvals : other).push(...r); });
  const rows = [...approvals, ...other];
  if (!rows.length) {
    mount(panel, h('div', { class: 'empty' }, h('div', { class: 'empty-icon' }, ''), 'Nothing to show right now'));
  } else {
    mount(panel, h('div', { class: 'list' }, ...rows));
  }
}

async function fetchSource(def, svc, ctx) {
  const { api } = ctx;
  const rows = [];
  try {
    if (def.id === 'streams') {
      const data = await api.tautulli(svc.key).get('get_activity');
      for (const s of (data.sessions || [])) {
        const state = s.state || 'playing';
        const thumb = s.grandparent_thumb || s.thumb;
        const url = thumb ? `/api/proxy/${svc.key}/api/v2?${new URLSearchParams({ cmd: 'pms_image_proxy', img: thumb, width: '80', height: '80', fallback: 'poster' }).toString()}` : null;
        rows.push(activityRow({ posterUrl: url, title: s.full_title || s.title,
          sub: `Tautulli · ${state} · ${s.friendly_name || s.user || 'unknown'} · ${s.player || ''}`, progress: Number(s.progress_percent) || 0,
          nav: { key: svc.key, tab: 'streams' } }));
      }
    } else if (def.id === 'sab') {
      const data = await api.sab(svc.key, { mode: 'queue' });
      for (const s of ((data.queue || {}).slots || [])) {
        rows.push(activityRow({ icon: '⬇', title: s.filename, sub: `Downloads · ${s.status} · ${s.percentage}% · ${s.sizeleft} left`, progress: Number(s.percentage),
          nav: { key: svc.key, tab: 'queue' } }));
      }
    } else if (def.id === 'qbittorrent') {
      const meta = SERVICE_META.qbittorrent || {};
      const torrents = await api.qbit(svc.key).get('torrents/info').catch(() => []);
      for (const t of (Array.isArray(torrents) ? torrents : []).filter((x) => (x.progress || 0) < 1).slice(0, 20)) {
        rows.push(activityRow({ icon: svcIcon(meta.logo, meta.emoji || '⬇', 22), title: t.name,
          sub: `${svc.label} · ${t.state} · ${fmtBytes((t.size || 0) - (t.amount_left || 0))} / ${fmtBytes(t.size || 0)}`,
          progress: (t.progress || 0) * 100, nav: { key: svc.key, tab: 'downloading' } }));
      }
    } else if (def.id === 'sonarr' || def.id === 'radarr') {
      const queue = await api.arr(svc.key).get('queue');
      const meta = SERVICE_META[def.type] || {};
      for (const r of (queue.records || [])) {
        const prog = r.size ? ((r.size - (r.sizeleft || 0)) / r.size) * 100 : 0;
        rows.push(activityRow({ icon: svcIcon(meta.logo, meta.emoji || '', 22), title: r.title, sub: `${svc.label} · ${r.status} · ${fmtBytes(r.sizeleft || 0)} left`, progress: prog,
          nav: { key: svc.key, tab: 'queue' } }));
      }
    } else if (def.id === 'bazarr') {
      const meta = SERVICE_META.bazarr || {};
      const [epResp, mvResp] = await Promise.all([
        api.bazarr(svc.key).get('episodes/wanted').catch(() => ({ data: [] })),
        api.bazarr(svc.key).get('movies/wanted').catch(() => ({ data: [] })),
      ]);
      const langNames = (list) => (list || []).map((l) => l.name || l.code2).join(', ');
      for (const e of ((epResp && epResp.data) || [])) {
        rows.push(activityRow({ icon: svcIcon(meta.logo, meta.emoji || '', 22), title: `${e.seriesTitle}${e.episode_number ? ` · ${e.episode_number}` : ''}`,
          sub: `${svc.label} · Missing ${langNames(e.missing_subtitles)}`, progress: 0, nav: { key: svc.key, tab: 'wanted' } }));
      }
      for (const m of ((mvResp && mvResp.data) || [])) {
        rows.push(activityRow({ icon: svcIcon(meta.logo, meta.emoji || '', 22), title: `${m.title}${m.year ? ` (${m.year})` : ''}`,
          sub: `${svc.label} · Missing ${langNames(m.missing_subtitles)}`, progress: 0, nav: { key: svc.key, tab: 'wanted' } }));
      }
    } else if (def.id === 'seerr-approval' || def.id === 'seerr-requests') {
      const q = def.id === 'seerr-approval' ? 'request?filter=pending&take=10' : 'request?take=10&sort=added';
      const data = await api.seerr(svc.key).get(q);
      for (const r of (data.results || [])) {
        const media = r.media || {};
        const mt = r.type || media.mediaType;
        const isTv = mt === 'tv';
        const detail = await seerrDetail(ctx, svc.key, mt, media.tmdbId);
        const title = (detail && (detail.title || detail.name)) || `#${media.tmdbId || '?'}`;
        const posterUrl = detail && detail.posterPath ? `https://image.tmdb.org/t/p/w154${detail.posterPath}` : null;
        const label = def.id === 'seerr-approval' ? 'Needs approval' : (REQ_STATUS[r.status] || 'Requested');
        const actions = def.id === 'seerr-approval' ? approvalActions(ctx, svc.key, r.id) : null;
        rows.push(activityRow({ posterUrl, icon: isTv ? '' : '', title, sub: `Seerr · ${label} · by ${r.requestedBy?.displayName || r.requestedBy?.username || 'unknown'}`, progress: 0, actions,
          nav: { key: svc.key, tab: def.id === 'seerr-approval' ? 'pending' : 'all' } }));
      }
    }
  } catch { /* ignore per-source errors */ }
  return rows;
}

function approvalActions(ctx, key, id) {
  const doAct = async (action, ev) => {
    ev.stopPropagation();
    try { await ctx.api.seerr(key).post(`request/${id}/${action}`); toast(`Request ${action}d`, 'success'); hydrateActivity(ctx); }
    catch (e) { toast(e.message, 'error'); }
  };
  return h('div', { class: 'row-actions' },
    h('button', { class: 'btn sm primary', title: 'Approve', onclick: (e) => doAct('approve', e) }, '✓'),
    h('button', { class: 'btn sm danger', title: 'Decline', onclick: (e) => doAct('decline', e) }, '✕'),
  );
}

function failedRows(ctx) {
  const list = listFailed();
  return list.map((e) => {
    const retry = async (ev) => {
      ev.stopPropagation();
      const btn = ev.currentTarget; btn.disabled = true; btn.textContent = '…';
      try {
        await ctx.api.seerr(e.svcKey).post('request', e.payload);
        toast(`Requested ${e.title}`, 'success');
        removeFailed(e.id);
        hydrateActivity(ctx, true);
      } catch (err) { btn.disabled = false; btn.textContent = 'Retry'; toast(`Retry failed: ${err.message}`, 'error'); }
    };
    const dismiss = (ev) => { ev.stopPropagation(); removeFailed(e.id); hydrateActivity(ctx, true); };
    const actions = h('div', { class: 'row-actions' },
      h('button', { class: 'btn sm primary', onclick: retry }, 'Retry'),
      h('button', { class: 'btn sm', onclick: dismiss }, 'Dismiss'),
    );
    const when = e.at ? new Date(e.at).toLocaleString() : '';
    return activityRow({ icon: '', title: e.title || 'Request', sub: `Seerr · Failed · ${e.error || 'error'}${when ? ' · ' + when : ''}`, progress: 0, actions,
      nav: { key: e.svcKey, tab: 'all' } });
  });
}

function activityPoster(url, fallbackIcon) {
  if (url) {
    return h('img', {
      src: url, loading: 'lazy',
      style: { width: '40px', height: '40px', borderRadius: '8px', objectFit: 'cover' },
      onerror: function () { this.replaceWith(document.createTextNode(fallbackIcon)); },
    });
  }
  return fallbackIcon;
}

// Navigate to a service page, optionally pre-selecting one of its tabs.
// tabs() reads the active tab from localStorage key `tabs-<svcKey>` on render.
function goTo(svcKey, tab) {
  if (tab) localStorage.setItem(`tabs-${svcKey}`, tab);
  location.hash = `#/${svcKey}`;
}

function activityRow(opts) {
  const { posterUrl = null, icon = '', title, sub, progress = 0, actions = null, nav = null } = opts;
  const onClick = nav ? () => goTo(nav.key, nav.tab) : undefined;
  const iconEl = posterUrl ? activityPoster(posterUrl, typeof icon === 'string' ? icon : '') : icon;
  return h('div', { class: `row${nav ? ' clickable' : ''}`, onclick: onClick },
    h('div', { class: 'poster', style: { width: '40px', height: '40px', fontSize: '20px' } }, iconEl),
    h('div', { class: 'row-main' },
      h('div', { class: 'row-title' }, title),
      h('div', { class: 'row-sub' }, sub),
      progress > 0 ? h('div', { class: 'progress' }, h('span', { style: { width: pct(progress) } })) : null,
    ),
    actions || null,
  );
}
