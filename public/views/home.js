import { h, mount, clear, spinner, empty, fmtBytes, fmtDate, fmtRelative, pct, svcIcon, toast, openModal } from '../lib/ui.js';
import { SERVICE_META, attachLongPress, openServiceQuickActions, openInArr } from '../app.js';
import { listFailed, removeFailed } from '../lib/failedRequests.js';
import { visibleServices } from '../lib/servicePrefs.js';
import { loadDashboards, activeDashboard } from '../lib/dashboardPrefs.js';
import { actionGroup } from '../lib/actions.js';
import { hive, posterHexCard } from '../lib/hive.js';
import { getSysmonPrefs, diskVisible } from '../lib/systemMonitor.js';

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
// Overseerr media availability codes (media.status).
const MEDIA_AVAILABILITY = { 1: 'Unknown', 2: 'Pending', 3: 'Processing', 4: 'Partial', 5: 'Available' };
const TMDB_POSTER_BASE = 'https://image.tmdb.org/t/p/w154';

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
  const dashboards = loadDashboards();
  const dashboard = activeDashboard(dashboards);
  ctx.setActions(h('span', { class: 'dim', style: { fontSize: '13px' } }, state.config.mock ? 'Showing mock data' : 'Live'));

  mount(root, spinner());
  let status = {};
  const wantSys = getSysmonPrefs().enabled;
  const [st, sysInit] = await Promise.all([
    api.status().catch(() => ({})),
    wantSys ? api.system().catch(() => null) : Promise.resolve(null),
  ]);
  status = st || {};
  state.status = status;
  if (sysInit) pushSysSample(sysInit);

  const shown = visibleServices(state.services);
  // Build every tile once (service hexes + optional system-monitor hexes), then
  // lay them into as-wide-as-fits rows via layoutHoneycomb so the honeycomb
  // fills the width before wrapping to another row. The live sampler patches the
  // system hexes in place (by id) without rebuilding the service tiles.
  const sysCells = (sysInit && getSysmonPrefs().enabled) ? buildSystemCells(sysInit, getSysmonPrefs()) : [];
  const tileEls = [...shown.map((svc) => hexCell(svc, status[svc.key], ctx)), ...sysCells];
  const honeycomb = h('div', { class: 'honeycomb', id: 'services-hive' });

  const content = {
    status: h('div', { class: 'ops-summary', id: 'ops-status-panel' }, h('div', { class: 'dim' }, 'Loading operational status…')),
    inbox: h('div', { class: 'card', id: 'inbox-panel' }, h('div', { class: 'dim' }, 'Loading action inbox…')),
    seerr: h('div', { class: 'card panel-bare dashboard-feed-panel', id: 'seerr-panel' }, h('div', { class: 'dim' }, 'Loading Seerr requests and issues…')),
    services: honeycomb,
    activity: h('div', { class: 'dashboard-feed' },
      h('div', { class: 'timeline-tools dashboard-feed-tools' },
        h('input', { class: 'input', id: 'timeline-search', type: 'search', placeholder: 'Filter activity…' }),
        h('select', { class: 'input', id: 'timeline-kind' }, h('option', { value: '' }, 'All events')),
      ),
      h('div', { class: 'card panel-bare dashboard-feed-panel', id: 'activity-panel' }, h('div', { class: 'dim' }, 'Loading activity…')),
    ),
    upcoming: h('div', { class: 'dashboard-feed' },
      upcomingHeader(ctx),
      h('div', { class: 'card panel-bare dashboard-feed-panel', id: 'upcoming-panel' }, h('div', { class: 'dim' }, 'Loading calendar…')),
    ),
    links: h('div', { class: 'card', id: 'links-panel' }, h('div', { class: 'dim' }, 'Loading links…')),
    streams: h('div', { class: 'card panel-bare dashboard-feed-panel', id: 'streams-panel' }, h('div', { class: 'dim' }, 'Loading active streams…')),
  };
  const hasTautulli = (state.services || []).some((s) => s.type === 'tautulli');
  const widgets = dashboard.widgets
    .filter((widget) => widget.visible && (widget.id !== 'streams' || hasTautulli))
    .map((widget) => h('section', {
      class: `dashboard-widget widget-${widget.id} size-${widget.size}`, dataset: { widget: widget.id },
    }, h('div', { class: 'dashboard-widget-head' }, h('h2', { class: 'section-title' }, widget.label)), content[widget.id]));
  mount(root, h('div', { class: 'dashboard-grid', dataset: { dashboard: dashboard.id } }, ...widgets));

  layoutHoneycomb(honeycomb, tileEls);
  for (const svc of shown) hydrateCardStats(svc, ctx);
  hydrateOperations(ctx);
  hydrateUpcoming(ctx);
  hydrateLinks(ctx);
  hydrateStreams(ctx);
  hydrateSystem(ctx);
  if (ctx.params.focus) requestAnimationFrame(() => document.querySelector(`.widget-${CSS.escape(ctx.params.focus)}`)?.scrollIntoView({ block: 'start' }));
}

let lastOperations = null;
async function hydrateOperations(ctx, silent = false) {
  const statusPanel = document.getElementById('ops-status-panel');
  const inboxPanel = document.getElementById('inbox-panel');
  const seerrPanel = document.getElementById('seerr-panel');
  const activityPanel = document.getElementById('activity-panel');
  if (!statusPanel && !inboxPanel && !seerrPanel && !activityPanel) return;
  if (!silent) {
    if (inboxPanel) mount(inboxPanel, h('div', { class: 'dim' }, 'Loading action inbox…'));
    if (seerrPanel) mount(seerrPanel, h('div', { class: 'dim' }, 'Loading Seerr requests and issues…'));
    if (activityPanel) mount(activityPanel, h('div', { class: 'dim' }, 'Loading activity…'));
  }
  try { lastOperations = await ctx.api.operations({ fresh: !silent }); }
  catch (error) {
    if (inboxPanel) mount(inboxPanel, empty('', 'Could not load action inbox', error.message));
    if (seerrPanel) mount(seerrPanel, empty('', 'Could not load Seerr requests and issues', error.message));
    if (activityPanel) mount(activityPanel, empty('', 'Could not load activity', error.message));
    return;
  }
  const summary = lastOperations.summary || {};
  const unavailable = Object.values(ctx.state.status || {}).filter((entry) => entry && !entry.ok).length || summary.serviceErrors || 0;
  if (statusPanel) mount(statusPanel,
    summaryCard(summary.total || 0, 'Needs attention', summary.critical ? 'down' : summary.warning ? 'warn' : 'ok'),
    summaryCard(summary.critical || 0, 'Critical', summary.critical ? 'down' : 'muted'),
    summaryCard(summary.health || 0, 'Health', summary.health ? 'warn' : 'muted'),
    summaryCard(summary.missing || 0, 'Missing', summary.missing ? 'warn' : 'muted'),
    summaryCard(unavailable, 'Unavailable', unavailable ? 'down' : 'ok'),
  );
  if (inboxPanel) {
    const entries = lastOperations.inbox || [];
    mount(inboxPanel, entries.length ? h('div', { class: 'ops-inbox-list' }, ...entries.map((entry) => operationRow(entry, ctx, true))) : empty('', 'All clear', 'No actions currently need attention'));
  }
  if (seerrPanel) renderSeerrWidget(seerrPanel, ctx);
  wireTimeline(ctx);
}

function summaryCard(value, label, cls) {
  return h('div', { class: `ops-summary-card ${cls}` }, h('strong', {}, String(value)), h('span', {}, label));
}

function dashboardFeedEmpty(title, detail = '') {
  return h('div', { class: 'dashboard-feed-list' },
    h('div', { class: 'row dashboard-feed-row dashboard-feed-empty' },
      h('div', { class: 'poster dashboard-feed-icon' }, '✓'),
      h('div', { class: 'row-main' },
        h('div', { class: 'row-title' }, title),
        detail ? h('div', { class: 'row-sub' }, detail) : null,
      ),
    ),
  );
}

// A widget renders its flowing poster-hex honeycomb when the user picks the
// "Hexagons" size in the dashboard builder — matching the Services tiles.
function isHexWidget(panel) {
  return !!panel?.closest('.dashboard-widget')?.classList.contains('size-hex');
}

function severityPillClass(severity) {
  return severity === 'critical' ? 'down' : severity === 'warning' ? 'warn' : 'muted';
}

function seerrEntryActions(entry, ctx) {
  if (entry.action?.type !== 'overseerr-request') return null;
  const act = async (verb, event) => {
    event.stopPropagation();
    try { await ctx.api.seerr(entry.serviceKey).post(`request/${entry.action.requestId}/${verb}`); toast(`Request ${verb}d`, 'success'); await hydrateOperations(ctx); }
    catch (error) { toast(error.message, 'error'); }
  };
  return actionGroup([
    { label: 'Approve', variant: 'primary', primary: true, onClick: (event) => act('approve', event) },
    { label: 'Decline', variant: 'danger', onClick: (event) => act('decline', event) },
  ], { sheetTitle: entry.title });
}

function renderSeerrWidget(panel, ctx) {
  const entries = lastOperations?.seerr || [];
  const summary = lastOperations?.seerrSummary || { requests: 0, pending: 0, issues: 0 };
  const badges = h('div', { class: 'seerr-widget-summary' },
    h('span', { class: 'pill muted' }, `${summary.requests || 0} requests`),
    h('span', { class: summary.pending ? 'pill warn' : 'pill muted' }, `${summary.pending || 0} pending`),
    h('span', { class: summary.issues ? 'pill down' : 'pill muted' }, `${summary.issues || 0} open issues`),
  );
  if (!entries.length) {
    mount(panel, badges, dashboardFeedEmpty('No Seerr requests or open issues', 'New requests and reported issues will appear here'));
    return;
  }
  // Hexagons size → flowing poster-hex honeycomb; otherwise a list.
  if (isHexWidget(panel)) {
    const rendered = entries.map((entry) => {
      const isRequest = entry.action?.type === 'overseerr-request';
      const card = posterHexCard({
        title: entry.title,
        sub: entry.serviceLabel || '',
        pills: [isRequest
          ? { label: 'Pending', cls: 'warn' }
          : { label: (entry.kind || 'event').replace('seerr-', ''), cls: severityPillClass(entry.severity) }],
        actions: seerrEntryActions(entry, ctx),
        onClick: () => entry.serviceKey && ctx.go(entry.serviceKey, entry.tab ? { tab: entry.tab } : {}),
      });
      return { entry, el: card };
    });
    mount(panel, badges, hive(rendered.map((r) => r.el), panel.clientWidth));
    enrichSeerrHexes(ctx, rendered);
    return;
  }
  // Render immediately with server-provided fallbacks (title or "Request #id"),
  // keeping the element handles so we can patch each row in place once the
  // matching TMDB detail resolves.
  const rendered = entries.map((entry) => ({ entry, el: operationRow(entry, ctx, true) }));
  mount(panel, badges, h('div', { class: 'seerr-widget-list dashboard-feed-list' }, ...rendered.map((r) => r.el)));
  enrichSeerrRequests(ctx, rendered);
}

// Hex-tile variant of the Seerr enrichment: patch the poster background and
// title text of each hex once its TMDB detail resolves.
async function enrichSeerrHexes(ctx, rendered) {
  const targets = rendered.filter(({ entry }) => entry.media?.tmdbId).slice(0, 8);
  await Promise.all(targets.map(async ({ entry, el }) => {
    if (!el.isConnected) return;
    try {
      const detail = await seerrDetail(ctx, entry.serviceKey, entry.media.mediaType, entry.media.tmdbId);
      if (!detail || !el.isConnected) return;
      const title = detail.title || detail.name || detail.originalTitle || detail.originalName;
      const titleEl = el.querySelector('.hx-title');
      if (titleEl && title) titleEl.textContent = title;
      if (detail.posterPath) {
        const face = el.querySelector('.hx-face');
        if (face) face.style.backgroundImage = `url(https://image.tmdb.org/t/p/w300${detail.posterPath})`;
      }
    } catch { /* keep fallback */ }
  }));
}

// Lazily fetch up to five movie/tv detail records (deduped/cached via
// seerrDetail) and update the dashboard rows with real title/year/poster and
// the structured media-type/requester/target line. Failed lookups gracefully
// retain the server "Request #id" fallback already on screen.
async function enrichSeerrRequests(ctx, rendered) {
  const targets = rendered
    .filter(({ entry }) => entry.kind === 'seerr-request' && entry.media?.tmdbId)
    .slice(0, 5);
  await Promise.all(targets.map(async ({ entry, el }) => {
    if (!el.isConnected) return;
    try {
      const detail = await seerrDetail(ctx, entry.serviceKey, entry.media.mediaType, entry.media.tmdbId);
      if (detail && el.isConnected) applySeerrDetail(el, entry, detail);
    } catch { /* keep fallback */ }
  }));
}

function applySeerrDetail(el, entry, detail) {
  const title = detail.title || detail.name || detail.originalTitle || detail.originalName;
  const date = detail.releaseDate || detail.firstAirDate || '';
  const year = date && Number.isFinite(new Date(date).getFullYear()) ? new Date(date).getFullYear() : '';
  const titleEl = el.querySelector('.row-title');
  if (titleEl && title) {
    clear(titleEl);
    titleEl.appendChild(document.createTextNode(title));
    if (year) titleEl.appendChild(h('span', { class: 'dim nowrap' }, ` (${year})`));
  }
  const posterEl = el.querySelector('.poster');
  if (posterEl && detail.posterPath) {
    const fallback = posterEl.firstChild ? posterEl.firstChild.cloneNode(true) : document.createTextNode('•');
    const img = h('img', {
      src: `${TMDB_POSTER_BASE}${detail.posterPath}`, loading: 'lazy', alt: '',
      style: { width: '100%', height: '100%', objectFit: 'cover', borderRadius: '8px' },
      onerror: function () { this.replaceWith(fallback); },
    });
    clear(posterEl);
    posterEl.appendChild(img);
  }
  const subEl = el.querySelector('.row-sub');
  if (subEl) {
    const mt = entry.media.mediaType === 'tv' ? 'TV' : 'Movie';
    const availability = entry.availabilityLabel || MEDIA_AVAILABILITY[entry.media.availability] || '';
    const parts = [mt, availability, entry.requester ? `by ${entry.requester}` : null, entry.target].filter(Boolean);
    subEl.textContent = parts.join(' · ');
  }
}

function operationRow(entry, ctx, actionable = false) {
  const navigate = () => entry.serviceKey && ctx.go(entry.serviceKey, entry.tab ? { tab: entry.tab } : {});
  const meta = SERVICE_META[entry.serviceType] || {};
  let actions = null;
  if (actionable && entry.action?.type === 'overseerr-request') {
    const act = async (verb, event) => {
      event.stopPropagation();
      try { await ctx.api.seerr(entry.serviceKey).post(`request/${entry.action.requestId}/${verb}`); toast(`Request ${verb}d`, 'success'); await hydrateOperations(ctx); }
      catch (error) { toast(error.message, 'error'); }
    };
    actions = actionGroup([
      { label: 'Approve', variant: 'primary', primary: true, onClick: (event) => act('approve', event) },
      { label: 'Decline', variant: 'danger', onClick: (event) => act('decline', event) },
    ], { sheetTitle: entry.title });
  }
  return h('div', { class: `row dashboard-feed-row operation-row severity-${entry.severity || 'info'}${entry.serviceKey ? ' clickable' : ''}`, onclick: navigate },
    h('div', { class: 'poster dashboard-feed-icon' }, svcIcon(meta.logo, meta.emoji || '•', 22)),
    h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, entry.title),
      h('div', { class: 'row-sub' }, `${entry.serviceLabel || ''}${entry.detail ? ` · ${entry.detail}` : ''}`),
      h('div', { class: 'meta-line' }, h('span', { class: 'pill muted' }, entry.kind || 'event'), entry.at ? h('span', {}, fmtRelative(entry.at)) : null)),
    actions,
  );
}

function wireTimeline(ctx) {
  const panel = document.getElementById('activity-panel');
  if (!panel || !lastOperations) return;
  const search = document.getElementById('timeline-search');
  const kind = document.getElementById('timeline-kind');
  const events = lastOperations.activity || [];
  if (kind && kind.options.length <= 1) {
    for (const value of [...new Set(events.map((entry) => entry.kind))].sort()) kind.appendChild(h('option', { value }, value.replace(/(^|-)(\w)/g, (_, a, b) => `${a ? ' ' : ''}${b.toUpperCase()}`)));
  }
  const render = () => {
    const term = (search?.value || '').trim().toLowerCase();
    const selectedKind = kind?.value || '';
    const shown = events.filter((entry) => (!selectedKind || entry.kind === selectedKind) && (!term || `${entry.title} ${entry.detail} ${entry.serviceLabel}`.toLowerCase().includes(term)));
    mount(panel, shown.length
      ? h('div', { class: 'timeline-list dashboard-feed-list' }, ...shown.map((entry) => operationRow(entry, ctx)))
      : dashboardFeedEmpty('No matching activity'));
  };
  search?.addEventListener('input', render);
  kind?.addEventListener('change', render);
  render();
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

function fmtStreamBandwidth(kbps) {
  const n = Number(kbps) || 0;
  return n >= 1000 ? `${(n / 1000).toFixed(1)} Mbps` : `${n} kbps`;
}

// Tautulli "Active Streams" Overview widget: a summary line (streaming /
// direct-play / bandwidth) plus a now-playing list, aggregated across every
// configured Tautulli instance. Posters stream through the proxy so the Plex
// token stays server-side. The section itself is only rendered when at least
// one Tautulli service exists (see the render filter above).
async function hydrateStreams(ctx) {
  const panel = document.getElementById('streams-panel');
  if (!panel) return;
  const { api } = ctx;
  const services = (ctx.state.services || []).filter((svc) => svc.type === 'tautulli');
  if (!services.length) return;
  try {
    const results = (await Promise.all(services.map((svc) =>
      api.tautulli(svc.key).get('get_activity').then((d) => ({ svc, d })).catch(() => null)
    ))).filter(Boolean);
    let streamCount = 0; let directPlay = 0; let bandwidth = 0;
    const items = [];
    for (const { svc, d } of results) {
      const sessions = d.sessions || [];
      streamCount += Number(d.stream_count ?? sessions.length) || 0;
      directPlay += Number(d.stream_count_direct_play) || 0;
      bandwidth += Number(d.total_bandwidth) || 0;
      for (const s of sessions) items.push({ svc, s });
    }
    const badges = h('div', { class: 'seerr-widget-summary' },
      h('span', { class: streamCount ? 'pill ok' : 'pill muted' }, `${streamCount} streaming`),
      h('span', { class: 'pill muted' }, `${directPlay} direct play`),
      h('span', { class: 'pill muted' }, fmtStreamBandwidth(bandwidth)),
    );
    const hex = isHexWidget(panel);
    if (!items.length) {
      if (hex) {
        // Match the hex layout even when idle: a single "no streams" hexagon.
        const idle = posterHexCard({ title: 'No active streams', sub: 'Nobody is watching right now' });
        mount(panel, badges, hive([idle], panel.clientWidth));
      } else {
        mount(panel, badges, dashboardFeedEmpty('No active streams', 'Nobody is watching right now'));
      }
      return;
    }

    const proxyPoster = (svc, s, w, ht) => {
      const thumb = s.grandparent_thumb || s.thumb;
      return thumb
        ? `/api/proxy/${svc.key}/api/v2?${new URLSearchParams({ cmd: 'pms_image_proxy', img: thumb, width: String(w), height: String(ht), fallback: 'poster' }).toString()}`
        : null;
    };

    // Hexagons size → flowing poster-hex honeycomb (like the Tautulli page); otherwise a list.
    if (hex) {
      const cards = items.map(({ svc, s }) => {
        const isTranscode = (s.transcode_decision || '').toLowerCase().includes('transcode');
        return posterHexCard({
          posterUrl: proxyPoster(svc, s, 300, 450),
          title: s.full_title || s.title,
          sub: `${s.friendly_name || s.user || 'unknown'} · ${s.state || 'playing'}`,
          pills: [{ label: isTranscode ? 'Transcode' : 'Direct Play', cls: isTranscode ? 'warn' : 'ok' }],
          progress: Number(s.progress_percent) || 0,
          onClick: () => goTo(svc.key, 'streams'),
        });
      });
      mount(panel, badges, hive(cards, panel.clientWidth));
      return;
    }

    const rows = items.map(({ svc, s }) => {
      const isTranscode = (s.transcode_decision || '').toLowerCase().includes('transcode');
      return activityRow({
        posterUrl: proxyPoster(svc, s, 80, 80), title: s.full_title || s.title,
        sub: `${s.friendly_name || s.user || 'unknown'} · ${s.state || 'playing'} · ${isTranscode ? 'Transcode' : 'Direct Play'}`,
        progress: Number(s.progress_percent) || 0,
        nav: { key: svc.key, tab: 'streams' },
      });
    });
    mount(panel, badges, h('div', { class: 'dashboard-feed-list' }, ...rows));
  } catch (error) {
    mount(panel, empty('', 'Could not load active streams', error.message));
  }
}

// Upcoming widget view mode: a chronological list (default) or a month calendar.
function getUpcomingView() { try { return localStorage.getItem('upcoming-view') === 'calendar' ? 'calendar' : 'list'; } catch { return 'list'; } }
function setUpcomingView(v) { try { localStorage.setItem('upcoming-view', v === 'calendar' ? 'calendar' : 'list'); } catch { /* ignore */ } }

// Header: a window label + a List/Calendar segmented toggle. Switching re-runs
// hydrateUpcoming (which refetches for the mode's date range) without a reload.
function upcomingHeader(ctx) {
  const mode = getUpcomingView();
  const label = h('div', { class: 'upcoming-window', id: 'upcoming-window' }, mode === 'calendar' ? '' : 'Next 14 days');
  const seg = (id, text) => {
    const b = h('button', { class: `view-seg ${mode === id ? 'active' : ''}`, dataset: { v: id } }, text);
    b.addEventListener('click', () => {
      if (getUpcomingView() === id) return;
      setUpcomingView(id);
      for (const x of toggle.children) x.classList.toggle('active', x.dataset.v === id);
      hydrateUpcoming(ctx);
    });
    return b;
  };
  const toggle = h('div', { class: 'view-toggle upcoming-toggle' }, seg('list', 'List'), seg('calendar', 'Calendar'));
  return h('div', { class: 'upcoming-tools dashboard-feed-tools' }, label, toggle);
}

// Month grid for the current month with per-day release chips. Days outside the
// month are blank; today is highlighted; a chip deep-links to the service's
// Calendar tab.
function renderUpcomingCalendar(panel, items, { year, month, today }) {
  const byDay = new Map();
  for (const it of items) {
    const d = new Date(it.when);
    if (d.getFullYear() !== year || d.getMonth() !== month) continue;
    const k = d.getDate();
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(it);
  }
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDow = new Date(year, month, 1).getDay();
  const todayDate = (today.getFullYear() === year && today.getMonth() === month) ? today.getDate() : -1;
  const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const head = h('div', { class: 'up-cal-head' }, ...WD.map((d) => h('div', { class: 'up-cal-wd' }, d)));
  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push(h('div', { class: 'up-cal-day is-empty' }));
  for (let day = 1; day <= daysInMonth; day++) {
    const evs = byDay.get(day) || [];
    const attrs = { class: `up-cal-day${day === todayDate ? ' is-today' : ''}${evs.length ? ' has-events is-clickable' : ''}` };
    if (evs.length) {
      const open = () => openUpcomingDayModal(new Date(year, month, day), evs);
      attrs.role = 'button';
      attrs.tabindex = '0';
      attrs.title = `${evs.length} release${evs.length > 1 ? 's' : ''} — tap to view`;
      attrs.onclick = open;
      attrs.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } };
    }
    cells.push(h('div', attrs,
      h('div', { class: 'up-cal-daynum' }, String(day)),
      ...evs.slice(0, 3).map((it) => {
        const meta = SERVICE_META[it.svc.type] || {};
        return h('div', { class: 'up-cal-ev', title: `${it.title}${it.sub ? ` — ${it.sub}` : ''}` },
          h('span', { class: 'up-cal-ev-ico' }, svcIcon(meta.logo, meta.emoji || '', 14)),
          h('span', { class: 'up-cal-ev-t' }, it.title),
        );
      }),
      evs.length > 3 ? h('div', { class: 'up-cal-more' }, `+${evs.length - 3} more`) : null,
    ));
  }
  while (cells.length % 7 !== 0) cells.push(h('div', { class: 'up-cal-day is-empty' }));
  mount(panel, h('div', { class: 'up-cal' }, head, h('div', { class: 'up-cal-grid' }, ...cells)));
}

// Expanded day view: lists every release on a given day (full titles, service,
// sub-line and air time), each row deep-linking to that service's Calendar tab.
function openUpcomingDayModal(date, evs) {
  const sorted = [...evs].sort((a, b) => new Date(a.when) - new Date(b.when));
  const rows = sorted.map((it) => {
    const meta = SERVICE_META[it.svc.type] || {};
    return h('div', { class: 'row up-row dashboard-feed-row clickable', onclick: () => openInArr({ svc: it.svc, title: it.filterTitle || it.title }) },
      h('div', { class: 'poster dashboard-feed-icon' }, svcIcon(meta.logo, meta.emoji || '', 22)),
      h('div', { class: 'row-main' },
        h('div', { class: 'row-title', style: { fontSize: '14px' } }, it.title),
        h('div', { class: 'meta-line', style: { marginTop: '2px' } },
          h('span', { class: 'pill muted' }, it.svc.label),
          it.sub ? h('span', { class: 'dim' }, it.sub) : null,
          h('span', {}, new Date(it.when).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })),
        ),
      ),
    );
  });
  const title = date.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
  openModal({ title, body: h('div', { class: 'list dashboard-feed-list' }, ...rows) });
}

// Merged upcoming calendar across all configured Sonarr + Radarr instances.
async function hydrateUpcoming(ctx) {
  const panel = document.getElementById('upcoming-panel');
  if (!panel) return;
  const mode = getUpcomingView();
  const label = document.getElementById('upcoming-window');
  const today = new Date();
  let start; let end;
  if (mode === 'calendar') {
    // Whole current month, so the grid shows the full month's releases.
    start = new Date(today.getFullYear(), today.getMonth(), 1);
    end = new Date(today.getFullYear(), today.getMonth() + 1, 1);
    if (label) label.textContent = today.toLocaleDateString([], { month: 'long', year: 'numeric' });
  } else {
    start = new Date();
    end = new Date(); end.setDate(end.getDate() + 14);
    if (label) label.textContent = 'Next 14 days';
  }
  const s = start.toISOString(), e = end.toISOString();
  const arrs = (ctx.state.services || []).filter((x) => (x.type === 'sonarr' || x.type === 'radarr') && x.configured);
  const items = [];
  await Promise.all(arrs.map(async (svc) => {
    try {
      if (svc.type === 'sonarr') {
        const eps = await ctx.api.arr(svc.key).get(`calendar?start=${s}&end=${e}&includeSeries=true`);
        for (const ep of (eps || [])) if (ep.airDateUtc) items.push({ when: ep.airDateUtc, title: `${(ep.series && ep.series.title) || 'Unknown'} · S${pad2(ep.seasonNumber)}E${pad2(ep.episodeNumber)}`, filterTitle: (ep.series && ep.series.title) || '', sub: ep.title || '', svc });
      } else {
        const movies = await ctx.api.arr(svc.key).get(`calendar?start=${s}&end=${e}`);
        for (const m of (movies || [])) { const when = m.digitalRelease || m.physicalRelease || m.inCinemas; if (when) items.push({ when, title: `${m.title}${m.year ? ` (${m.year})` : ''}`, filterTitle: m.title || '', sub: 'Release', svc }); }
      }
    } catch { /* ignore per-service */ }
  }));
  if (mode === 'calendar') {
    return renderUpcomingCalendar(panel, items, { year: today.getFullYear(), month: today.getMonth(), today });
  }
  if (!items.length) { mount(panel, dashboardFeedEmpty('Nothing upcoming', 'No releases in the next 2 weeks')); return; }
  items.sort((a, b) => new Date(a.when) - new Date(b.when));
  const byDay = new Map();
  for (const it of items) {
    const key = new Date(it.when).toDateString();
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(it);
  }
  const blocks = [];
  for (const [day, list] of byDay) {
    blocks.push(h('div', { class: 'up-day dashboard-feed-day' }, fmtDate(day)));
    for (const it of list) {
      const meta = SERVICE_META[it.svc.type] || {};
      blocks.push(h('div', { class: 'row up-row dashboard-feed-row' },
        h('div', { class: 'poster dashboard-feed-icon' }, svcIcon(meta.logo, meta.emoji || '', 22)),
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
  mount(panel, h('div', { class: 'list dashboard-feed-list' }, ...blocks));
}

// Silent refresh used by the auto-refresh interval (no loading flash).
export function refreshHome(ctx) {
  hydrateOperations(ctx, true);
  hydrateStreams(ctx);
  hydrateSystem(ctx);
  for (const svc of ctx.state.services) hydrateCardStats(svc, ctx);
}

// ---- Optional system-monitor hexes (attach to the services honeycomb) ----
function usageDot(pct) { const n = Number(pct) || 0; return n >= 90 ? 'down' : n >= 70 ? 'warn' : 'ok'; }
function diskName(p) {
  const s = String(p || '');
  if (s === '/' || s === '\\') return 'Root';
  return s.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || s;
}
function netRate(v) { return v == null ? '—' : `${fmtBytes(v)}/s`; }
function dotColor(cls) { return cls === 'down' ? '#ef4444' : cls === 'warn' ? '#f59e0b' : 'var(--accent)'; }

// Rolling ~60s history of CPU% and memory% for the sparkline graphs.
const SYS_WINDOW_MS = 60000;
const SYS_SAMPLE_MS = 3000;
const sysHistory = { cpu: [], mem: [] };
function pushSysSample(sys) {
  const t = Date.now();
  if (sys.cpu) sysHistory.cpu.push({ t, v: Number(sys.cpu.percent) || 0 });
  if (sys.mem) sysHistory.mem.push({ t, v: Number(sys.mem.percent) || 0 });
  const cutoff = t - SYS_WINDOW_MS - SYS_SAMPLE_MS;
  sysHistory.cpu = sysHistory.cpu.filter((p) => p.t >= cutoff);
  sysHistory.mem = sysHistory.mem.filter((p) => p.t >= cutoff);
}

// A small SVG sparkline built as an HTML string (so it lands in the SVG
// namespace via innerHTML). The wrapper sets `color`, so `currentColor` tints
// the line/fill by severity.
function sparkline(points, cls) {
  const W = 116; const H = 30; const pad = 2;
  const vals = (points || []).map((p) => Math.max(0, Math.min(100, Number(p.v) || 0)));
  let inner;
  if (vals.length < 2) {
    inner = `<line x1="0" y1="${H - pad}" x2="${W}" y2="${H - pad}" stroke="currentColor" stroke-opacity="0.4" stroke-width="1.5"/>`;
  } else {
    const n = vals.length;
    const xs = (i) => (pad + (i / (n - 1)) * (W - pad * 2));
    const ys = (v) => (H - pad - (v / 100) * (H - pad * 2));
    let line = '';
    vals.forEach((v, i) => { line += `${i ? 'L' : 'M'}${xs(i).toFixed(1)} ${ys(v).toFixed(1)} `; });
    const area = `${line}L${xs(n - 1).toFixed(1)} ${H} L${xs(0).toFixed(1)} ${H} Z`;
    inner = `<path d="${area}" fill="currentColor" fill-opacity="0.16"/>`
      + `<path d="${line.trim()}" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
  }
  return h('div', { class: 'hex-spark', style: { color: dotColor(cls) }, html: `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" width="100%" height="${H}">${inner}</svg>` });
}

// Stat-style system hex (disk / network): icon, name, two stats.
function systemHex({ icon, name, stats, dotClass, title }) {
  return h('div', { class: 'hex-cell hex-static hex-system', title: title || name },
    h('div', { class: 'hex-border' }),
    h('div', { class: 'hex-face' },
      h('div', { class: 'hex-inner' },
        h('span', { class: `hex-dot ${dotClass || ''}` }),
        h('span', { class: 'hex-sys-ico' }, icon),
        h('div', { class: 'hex-name' }, name),
        h('div', { class: 'hex-stats' }, ...stats.map(([v, l]) => stat(v, l))),
      ),
    ),
  );
}

// Graph-style system hex (CPU / memory): name, big value, 60s sparkline.
function systemGraphHex({ icon, name, value, dotClass, history, title }) {
  return h('div', { class: 'hex-cell hex-static hex-system hex-graph', title: title || name },
    h('div', { class: 'hex-border' }),
    h('div', { class: 'hex-face' },
      h('div', { class: 'hex-inner' },
        h('span', { class: `hex-dot ${dotClass || ''}` }),
        h('div', { class: 'hex-name' }, `${icon} ${name}`),
        h('div', { class: 'hex-graph-val' }, `${value}%`),
        sparkline(history, dotClass),
      ),
    ),
  );
}

function systemCpuHex(sys) {
  const cpu = (sys.cpu && sys.cpu.percent) || 0;
  return systemGraphHex({
    icon: '🖥', name: 'CPU', value: cpu, dotClass: usageDot(cpu), history: sysHistory.cpu,
    title: `CPU ${cpu}%${sys.cpu && sys.cpu.cores ? ` · ${sys.cpu.cores} cores` : ''} · last 60s`,
  });
}
function systemMemHex(sys) {
  const mem = (sys.mem && sys.mem.percent) || 0;
  const detail = sys.mem ? ` · ${fmtBytes(sys.mem.used)} / ${fmtBytes(sys.mem.total)}` : '';
  return systemGraphHex({
    icon: '🧠', name: 'Memory', value: mem, dotClass: usageDot(mem), history: sysHistory.mem,
    title: `Memory ${mem}%${detail} · last 60s`,
  });
}

function systemDiskHex(d) {
  if (d.error) {
    return systemHex({ icon: '💾', name: diskName(d.path), stats: [['—', 'Used'], ['error', d.error]], dotClass: 'down', title: `${d.path}: ${d.error}` });
  }
  return systemHex({
    icon: '💾', name: diskName(d.path),
    stats: [[`${d.percent}%`, 'Used'], [fmtBytes(d.free), 'Free']],
    dotClass: usageDot(d.percent),
    title: `${d.path} · ${fmtBytes(d.used)} / ${fmtBytes(d.total)} used`,
  });
}

function systemNetHex(net) {
  return systemHex({
    icon: '🌐', name: 'Network',
    stats: [[netRate(net.rxSec), '↓ Down'], [netRate(net.txSec), '↑ Up']],
    dotClass: 'ok',
    title: 'Network throughput',
  });
}

// Stable per-disk hex id derived from the mount path (so selection/filtering
// never desyncs the in-place value updates from the rendered hexes).
const diskHexId = (p) => 'sys-hex-disk-' + (String(p).replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '') || 'root');

function buildSystemCells(sys, prefs) {
  const cells = [];
  if (prefs.cpu) { const el = systemCpuHex(sys); el.id = 'sys-hex-cpu'; cells.push(el); }
  if (prefs.memory) { const el = systemMemHex(sys); el.id = 'sys-hex-mem'; cells.push(el); }
  if (prefs.disk) (sys.disks || []).filter((d) => diskVisible(d.path, prefs)).forEach((d) => { const el = systemDiskHex(d); el.id = diskHexId(d.path); cells.push(el); });
  if (prefs.network && sys.net) { const el = systemNetHex(sys.net); el.id = 'sys-hex-net'; cells.push(el); }
  return cells;
}

// Patch a CPU/memory graph hex (dot severity + value + sparkline) in place.
function patchGraphHex(id, value, history) {
  const el = document.getElementById(id);
  if (!el) return;
  const cls = usageDot(value);
  const dot = el.querySelector('.hex-dot'); if (dot) dot.className = `hex-dot ${cls}`;
  const val = el.querySelector('.hex-graph-val'); if (val) val.textContent = `${value}%`;
  const spark = el.querySelector('.hex-spark'); if (spark) spark.replaceWith(sparkline(history, cls));
}

// Update the folded-in system hexes in place from a stats payload (no row
// rebuild, so the service tiles and their hydration are never disturbed).
function updateSystemHexes(sys) {
  patchGraphHex('sys-hex-cpu', (sys.cpu && sys.cpu.percent) || 0, sysHistory.cpu);
  patchGraphHex('sys-hex-mem', (sys.mem && sys.mem.percent) || 0, sysHistory.mem);
  (sys.disks || []).forEach((d) => {
    const el = document.getElementById(diskHexId(d.path));
    if (!el) return;
    const dot = el.querySelector('.hex-dot');
    const vals = el.querySelectorAll('.stat-value');
    if (d.error) { if (dot) dot.className = 'hex-dot down'; return; }
    if (dot) dot.className = `hex-dot ${usageDot(d.percent)}`;
    if (vals[0]) vals[0].textContent = `${d.percent}%`;
    if (vals[1]) vals[1].textContent = fmtBytes(d.free);
  });
  if (sys.net) {
    const el = document.getElementById('sys-hex-net');
    if (el) { const vals = el.querySelectorAll('.stat-value'); if (vals[0]) vals[0].textContent = netRate(sys.net.rxSec); if (vals[1]) vals[1].textContent = netRate(sys.net.txSec); }
  }
}

// Dedicated fast sampler (only while the Overview + monitor are active) so the
// CPU/memory graphs trace a live last-60s window. Self-stops when the system
// hexes leave the DOM (navigation) or the feature is turned off.
let sysTimer = null;
function stopSystemSampler() { if (sysTimer) { clearInterval(sysTimer); sysTimer = null; } }
function startSystemSampler(ctx) {
  if (sysTimer) return;
  sysTimer = setInterval(async () => {
    const hive = document.getElementById('services-hive');
    if (!hive || !getSysmonPrefs().enabled || !hive.querySelector('.hex-system')) { stopSystemSampler(); return; }
    let sys; try { sys = await ctx.api.system(); } catch { return; }
    pushSysSample(sys);
    updateSystemHexes(sys);
  }, SYS_SAMPLE_MS);
}

// The system hexes are built into the honeycomb by renderHome (folded into the
// 2-row band); here we just keep the live sampler running while they're shown.
function hydrateSystem(ctx) {
  const hive = document.getElementById('services-hive');
  if (!hive || !getSysmonPrefs().enabled || !hive.querySelector('.hex-system')) { stopSystemSampler(); return; }
  startSystemSampler(ctx);
}

const HEX_STEP = 186; // .hex-cell width (176) + horizontal margin (2 * 5)

// Lay the honeycomb tiles into as-wide-as-fits rows with a 2-row minimum: pack
// each row to the available width and only add a 3rd+ row once two full rows
// can't hold everything, balancing tiles across the rows. Fills the width first
// (no side dead space). Pointy-top nesting is kept via alternating row offsets
// (.hc-fill). Existing tile elements are moved between rows (never rebuilt) so
// hydrated stats/graphs are preserved. A ResizeObserver re-runs it as the width
// settles/changes; it self-detaches once the honeycomb leaves the DOM.
function layoutHoneycomb(hiveEl, tileEls) {
  let ro = null;
  let lastKey = '';
  const cleanup = () => { if (ro) { try { ro.disconnect(); } catch { /* ignore */ } ro = null; } window.removeEventListener('resize', apply); };
  const apply = () => {
    if (!hiveEl.isConnected) { cleanup(); return; }
    const total = tileEls.length;
    const mobile = typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 760px)').matches;
    let perRow;
    if (mobile) {
      perRow = Math.max(1, total); // one row; CSS flex-wrap handles wrapping
    } else {
      const avail = (hiveEl.parentElement && hiveEl.parentElement.clientWidth) || hiveEl.clientWidth || 0;
      const maxPerRow = avail ? Math.max(1, Math.floor((avail - HEX_STEP / 2) / HEX_STEP)) : total;
      const rowCount = total >= 2 ? Math.max(2, Math.ceil(total / maxPerRow)) : 1;
      perRow = Math.max(1, Math.ceil(total / rowCount));
    }
    const key = `${mobile ? 'm' : 'd'}:${perRow}:${total}`;
    if (key === lastKey) return; // width didn't change the layout — avoid RO loops
    lastKey = key;
    clear(hiveEl); // detaches rows; tileEls refs survive so state is preserved
    hiveEl.classList.toggle('hc-fill', !mobile && Math.ceil(total / perRow) > 1);
    const frag = document.createDocumentFragment();
    for (let i = 0; i < total; i += perRow) {
      const row = h('div', { class: 'hc-row' });
      for (const el of tileEls.slice(i, i + perRow)) row.appendChild(el);
      frag.appendChild(row);
    }
    hiveEl.appendChild(frag);
  };
  apply();
  const parent = hiveEl.parentElement;
  if (parent && typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => apply());
    ro.observe(parent);
  } else {
    window.addEventListener('resize', apply);
  }
}

function hexCell(svc, st, ctx) {
  const meta = SERVICE_META[svc.type] || {};
  const online = st && st.ok;
  const dotClass = online ? 'ok' : (st ? 'down' : '');
  const statsEl = h('div', { class: 'hex-stats', id: `stats-${svc.key}` });
  const cell = h('div', { class: 'hex-cell', title: svc.label, onclick: () => { location.hash = `#/${svc.key}`; } },
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
  // Long-press (touch) / long-click (mouse) opens the same quick-actions sheet
  // as the bottom nav, deep-linking to a service tab.
  return attachLongPress(cell, () => openServiceQuickActions(svc));
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
  const ck = `${key}:${mediaType}:${tmdbId}`;
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
  return actionGroup([
    { label: '\u2713', title: 'Approve', variant: 'primary', primary: true, onClick: (e) => doAct('approve', e) },
    { label: '\u2715', title: 'Decline', variant: 'danger', onClick: (e) => doAct('decline', e) },
  ], { sheetTitle: 'Request' });
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
