import { h, mount, clear, tabs, spinner, skeletonList, empty, toast, fmtRelative, timeEl, fmtBytes, poster, debounce, openModal, closeModal } from '../lib/ui.js';
import { openDetailModal } from './detail.js';
import { addFailed } from '../lib/failedRequests.js';
import { hive, posterHexCard } from '../lib/hive.js';
import { viewToggle, effectiveMode } from '../lib/viewMode.js';
import { cachedGet } from '../lib/cache.js';

// Seerr request status codes
const REQ_STATUS = { 1: { label: 'Pending', cls: 'warn' }, 2: { label: 'Approved', cls: 'ok' }, 3: { label: 'Declined', cls: 'down' } };
// Media availability codes
const MEDIA_STATUS = { 1: 'Unknown', 2: 'Pending', 3: 'Processing', 4: 'Partially Available', 5: 'Available' };

// Build a TMDB poster URL from a Seerr posterPath (public CDN, loaded by browser).
function tmdbPoster(path) {
  return path ? `https://image.tmdb.org/t/p/w154${path}` : null;
}

// Submit a request with one automatic retry for transient errors; on persistent
// failure, record it to the Failed Requests store (shown on the dashboard).
async function submitRequest(seerr, ctx, payload, title) {
  const svcKey = ctx.service.key;
  try {
    await seerr.post('request', payload);
    toast(`Requested ${title}`, 'success');
    return true;
  } catch (e1) {
    if (!e1.status || e1.status >= 500) {
      await new Promise((r) => setTimeout(r, 1500));
      try { await seerr.post('request', payload); toast(`Requested ${title}`, 'success'); return true; }
      catch (e2) { addFailed({ svcKey, payload, title, error: e2.message || 'Request failed' }); toast('Request failed — saved to Failed Requests', 'error', 3500); return false; }
    }
    addFailed({ svcKey, payload, title, error: e1.message || 'Request failed' });
    toast('Request failed — saved to Failed Requests', 'error', 3500);
    return false;
  }
}

// Cache of fetched media details keyed by "mediaType:tmdbId".
const detailCache = new Map();
async function getDetail(seerr, mediaType, tmdbId) {
  if (!mediaType || !tmdbId) return null;
  const key = `${mediaType}:${tmdbId}`;
  if (detailCache.has(key)) return detailCache.get(key);
  const p = seerr.get(`${mediaType === 'tv' ? 'tv' : 'movie'}/${tmdbId}`).catch(() => null);
  detailCache.set(key, p);
  return p;
}

export async function renderOverseerr(root, ctx) {
  const svc = ctx.service;
  const seerr = ctx.api.seerr(svc.key);
  ctx.setActions(viewToggle(svc.key, ctx.reload));

  const body = h('div', {});
  const bar = tabs(body, [
    { id: 'pending', label: 'Pending', render: (c) => tabRequests(c, seerr, ctx, 'pending') },
    { id: 'all', label: 'All Requests', render: (c) => tabRequests(c, seerr, ctx, 'all') },
    { id: 'issues', label: 'Issues', render: (c) => tabIssues(c, seerr, ctx) },
    { id: 'recent', label: 'Recently Added', render: (c) => tabRecentlyAdded(c, seerr, ctx) },
    { id: 'discover', label: 'Discover', render: (c) => tabDiscover(c, seerr, ctx) },
  ], `tabs-${svc.key}`);
  mount(root, bar, body);
}

async function tabRecentlyAdded(root, seerr, ctx) {
  mount(root, skeletonList());
  try {
    const data = await seerr.get('media?take=60&sort=mediaAdded&filter=allavailable');
    const results = data.results || [];
    if (!results.length) return mount(root, empty('', 'Nothing recently added'));
    if (effectiveMode(ctx.service.key) === 'list') {
      mount(root, h('div', { class: 'list' }, ...results.map((m) => mediaListRow(m, seerr, ctx))));
      return;
    }
    const cards = results.map((m) => seerrHex(ctx, seerr, {
      mediaType: m.mediaType, tmdbId: m.tmdbId,
      pill: { label: MEDIA_STATUS[m.status] || 'Available', cls: 'ok' },
      sub: m.mediaAddedAt ? `Added ${fmtRelative(m.mediaAddedAt)}` : '',
    }));
    mount(root, hive(cards, root.clientWidth));
  } catch (err) {
    mount(root, empty('', 'Failed to load recently added', err.message, { label: 'Retry', onClick: () => tabRecentlyAdded(root, seerr, ctx) }));
  }
}

// A poster-filled hexagon tile (title + status overlay), clickable to open details.
function seerrHex(ctx, seerr, opts) {
  const titleEl = h('div', { class: 'hx-title' }, 'Loading…');
  const overlay = h('div', { class: 'hx-overlay' }, titleEl);
  if (opts.pill) overlay.appendChild(h('span', { class: `pill ${opts.pill.cls}` }, opts.pill.label));
  if (opts.sub) overlay.appendChild(h('div', { class: 'hx-sub' }, opts.sub));
  if (opts.actions) overlay.appendChild(opts.actions);
  const face = h('div', { class: 'hx-face' }, overlay);
  const card = h('div', { class: 'seerr-hex', title: 'View details', onclick: () => openDetailModal(ctx, { mediaType: opts.mediaType, tmdbId: opts.tmdbId, fallback: {} }) },
    h('div', { class: 'hx-border' }), face);
  getDetail(seerr, opts.mediaType, opts.tmdbId).then((d) => {
    if (!d) { titleEl.textContent = `#${opts.tmdbId || '?'}`; return; }
    titleEl.textContent = d.title || d.name || d.originalTitle || d.originalName || `#${opts.tmdbId}`;
    if (d.posterPath) face.style.backgroundImage = `url(https://image.tmdb.org/t/p/w300${d.posterPath})`;
  });
  return card;
}

// A compact list row for Seerr media / requests (used in List view).
function mediaListRow(m, seerr, ctx) {
  const mediaType = m.mediaType;
  const isTv = mediaType === 'tv';
  const posterEl = poster(null, '');
  const titleEl = h('div', { class: 'row-title' }, h('span', { class: 'dim' }, 'Loading…'));
  const row = h('div', { class: 'row clickable', onclick: () => openDetailModal(ctx, { mediaType, tmdbId: m.tmdbId, fallback: {} }) },
    posterEl,
    h('div', { class: 'row-main' },
      titleEl,
      h('div', { class: 'meta-line', style: { marginTop: '4px' } },
        h('span', { class: 'pill muted' }, isTv ? 'TV' : 'Movie'),
        m.status ? h('span', { class: 'pill ok' }, MEDIA_STATUS[m.status] || 'Available') : null,
        m.mediaAddedAt ? h('span', {}, 'Added ', timeEl(m.mediaAddedAt)) : null,
      ),
    ),
  );
  getDetail(seerr, mediaType, m.tmdbId).then((d) => {
    if (!d) { clear(titleEl); titleEl.appendChild(document.createTextNode(`#${m.tmdbId || '?'}`)); return; }
    const title = d.title || d.name || d.originalTitle || d.originalName || `#${m.tmdbId}`;
    const date = d.releaseDate || d.firstAirDate || '';
    const year = date ? ` (${new Date(date).getFullYear()})` : '';
    clear(titleEl);
    titleEl.appendChild(document.createTextNode(title));
    titleEl.appendChild(h('span', { class: 'dim nowrap' }, year));
    const url = tmdbPoster(d.posterPath);
    if (url) posterEl.replaceWith(poster(url, ''));
  });
  return row;
}

function requestListRow(r, seerr, ctx) {
  const media = r.media || {};
  const mediaType = r.type || media.mediaType;
  const isTv = mediaType === 'tv';
  const st = REQ_STATUS[r.status] || { label: 'Unknown', cls: 'muted' };
  const posterEl = poster(null, '');
  const titleEl = h('div', { class: 'row-title' }, h('span', { class: 'dim' }, 'Loading…'));
  const row = h('div', { class: 'row clickable', onclick: () => openDetailModal(ctx, { mediaType, tmdbId: media.tmdbId, fallback: {} }) },
    posterEl,
    h('div', { class: 'row-main' },
      titleEl,
      h('div', { class: 'meta-line', style: { marginTop: '4px' } },
        h('span', { class: `pill ${st.cls}` }, st.label),
        h('span', { class: 'pill muted' }, isTv ? 'TV' : 'Movie'),
        h('span', {}, `by ${r.requestedBy?.displayName || r.requestedBy?.username || 'unknown'}`),
        timeEl(r.createdAt),
      ),
    ),
    r.status === 1 ? h('div', { class: 'row-actions' },
      h('button', { class: 'btn sm primary', onclick: (e) => { e.stopPropagation(); act(seerr, ctx, r.id, 'approve'); } }, '✓ Approve'),
      h('button', { class: 'btn sm danger', onclick: (e) => { e.stopPropagation(); act(seerr, ctx, r.id, 'decline'); } }, '✕ Decline'),
    ) : null,
  );
  getDetail(seerr, mediaType, media.tmdbId).then((d) => {
    if (!d) { clear(titleEl); titleEl.appendChild(document.createTextNode(`#${media.tmdbId || '?'}`)); return; }
    const title = d.title || d.name || d.originalTitle || d.originalName || `#${media.tmdbId}`;
    const date = d.releaseDate || d.firstAirDate || '';
    const year = date ? ` (${new Date(date).getFullYear()})` : '';
    clear(titleEl);
    titleEl.appendChild(document.createTextNode(title));
    titleEl.appendChild(h('span', { class: 'dim nowrap' }, year));
    const url = tmdbPoster(d.posterPath);
    if (url) posterEl.replaceWith(poster(url, ''));
  });
  return row;
}

async function tabRequests(root, seerr, ctx, filter) {
  mount(root, skeletonList());
  try {
    const q = filter === 'pending' ? '?filter=pending&take=60' : '?take=60&sort=added';
    const data = await seerr.get(`request${q}`);
    const results = data.results || [];
    if (!results.length) return mount(root, empty('', filter === 'pending' ? 'No pending requests' : 'No requests yet'));
    if (effectiveMode(ctx.service.key) === 'list') {
      mount(root, h('div', { class: 'list' }, ...results.map((r) => requestListRow(r, seerr, ctx))));
      return;
    }
    const cards = results.map((r) => {
      const media = r.media || {};
      const mt = r.type || media.mediaType;
      const stt = REQ_STATUS[r.status] || { label: 'Unknown', cls: 'muted' };
      let actions = null;
      if (r.status === 1) {
        actions = h('div', { class: 'row-actions' },
          h('button', { class: 'btn sm primary', title: 'Approve', onclick: (e) => { e.stopPropagation(); act(seerr, ctx, r.id, 'approve'); } }, '✓'),
          h('button', { class: 'btn sm danger', title: 'Decline', onclick: (e) => { e.stopPropagation(); act(seerr, ctx, r.id, 'decline'); } }, '✕'),
        );
      }
      return seerrHex(ctx, seerr, {
        mediaType: mt, tmdbId: media.tmdbId, pill: stt,
        sub: `by ${r.requestedBy?.displayName || r.requestedBy?.username || 'unknown'}`,
        actions,
      });
    });
    mount(root, hive(cards, root.clientWidth));
  } catch (err) {
    mount(root, empty('', 'Failed to load requests', err.message, { label: 'Retry', onClick: () => tabRequests(root, seerr, ctx, filter) }));
  }
}

async function act(seerr, ctx, id, action) {
  try {
    await seerr.post(`request/${id}/${action}`);
    toast(`Request ${action}d`, 'success');
    ctx.reload();
  } catch (e) { toast(e.message, 'error'); }
}

const ISSUE_TYPE = { 1: 'Video', 2: 'Audio', 3: 'Subtitle', 4: 'Other' };
function issueTitle(is) { const m = is.media || {}; return m.title || m.name || `#${m.tmdbId || is.id}`; }

async function tabIssues(root, seerr, ctx) {
  mount(root, skeletonList());
  try {
    const data = await seerr.get('issue?take=50&skip=0&sort=added&filter=all');
    const results = data.results || [];
    if (!results.length) return mount(root, empty('🐞', 'No issues', 'No reported media issues.'));
    mount(root, h('div', { class: 'list' }, ...results.map((is) => issueRow(is, seerr, ctx))));
  } catch (e) {
    mount(root, empty('⚠️', 'Failed to load issues', e.message, { label: 'Retry', onClick: () => tabIssues(root, seerr, ctx) }));
  }
}

function issueRow(is, seerr, ctx) {
  const open = is.status === 1;
  return h('div', { class: 'row', style: { cursor: 'pointer' }, onclick: () => openIssueModal(seerr, ctx, is) },
    h('div', { class: 'row-main' },
      h('div', { class: 'row-title' }, issueTitle(is)),
      h('div', { class: 'meta-line', style: { marginTop: '4px' } },
        h('span', { class: `pill ${open ? 'warn' : 'ok'}` }, open ? 'Open' : 'Resolved'),
        h('span', { class: 'pill muted' }, ISSUE_TYPE[is.issueType] || 'Issue'),
        is.problemSeason ? h('span', {}, `S${is.problemSeason}${is.problemEpisode ? `E${is.problemEpisode}` : ''}`) : null,
        h('span', { class: 'dim' }, `${(is.comments || []).length} comment${(is.comments || []).length === 1 ? '' : 's'}`),
        (is.createdBy && (is.createdBy.displayName || is.createdBy.username)) ? h('span', { class: 'dim' }, `by ${is.createdBy.displayName || is.createdBy.username}`) : null,
      ),
    ),
    h('div', { class: 'row-actions' }, h('span', { class: 'dim' }, is.createdAt ? fmtRelative(is.createdAt) : '')),
  );
}

function issueComment(c) {
  return h('div', { class: 'row' }, h('div', { class: 'row-main' },
    h('div', { class: 'meta-line' },
      h('span', { style: { fontWeight: '700' } }, (c.user && (c.user.displayName || c.user.username)) || 'user'),
      c.createdAt ? h('span', { class: 'dim' }, fmtRelative(c.createdAt)) : null,
    ),
    h('div', { style: { marginTop: '4px', lineHeight: '1.5', whiteSpace: 'pre-wrap' } }, c.message || ''),
  ));
}

async function openIssueModal(seerr, ctx, brief) {
  const body = h('div', {}, h('div', { style: { padding: '18px' } }, spinner()));
  openModal({ title: `Issue · ${issueTitle(brief)}`, body, wide: true });
  let issue = brief;
  try { issue = await seerr.get(`issue/${brief.id}`); } catch { /* use brief */ }
  const open = issue.status === 1;
  const commentsBox = h('div', { class: 'list' }, ...((issue.comments || []).length ? (issue.comments || []).map(issueComment) : [h('div', { class: 'dim', style: { padding: '8px 0' } }, 'No comments yet.')]));
  const ta = h('textarea', { class: 'input', rows: '3', placeholder: 'Add a comment…', style: { width: '100%', resize: 'vertical' } });
  const addComment = async () => {
    const message = ta.value.trim(); if (!message) return;
    try { await seerr.post(`issue/${issue.id}/comment`, { message }); ta.value = ''; const fresh = await seerr.get(`issue/${issue.id}`); mount(commentsBox, ...((fresh.comments || []).map(issueComment))); toast('Comment added', 'success'); }
    catch (e) { toast(e.message, 'error'); }
  };
  const resolveBtn = h('button', { class: `btn ${open ? 'primary' : ''}` }, open ? 'Mark resolved' : 'Reopen');
  resolveBtn.onclick = async () => {
    try { await seerr.post(`issue/${issue.id}/${open ? 'resolved' : 'reopen'}`); toast(open ? 'Resolved' : 'Reopened', 'success'); closeModal(); ctx.reload(); }
    catch (e) { toast(e.message, 'error'); }
  };
  mount(body,
    h('div', { class: 'meta-line', style: { marginBottom: '10px' } },
      h('span', { class: `pill ${open ? 'warn' : 'ok'}` }, open ? 'Open' : 'Resolved'),
      h('span', { class: 'pill muted' }, ISSUE_TYPE[issue.issueType] || 'Issue'),
      (issue.createdBy && (issue.createdBy.displayName || issue.createdBy.username)) ? h('span', { class: 'dim' }, `opened by ${issue.createdBy.displayName || issue.createdBy.username}`) : null,
    ),
    h('div', { class: 'section-title' }, 'Comments'),
    commentsBox,
    h('div', { style: { marginTop: '10px' } }, ta,
      h('div', { class: 'meta-line', style: { marginTop: '8px', justifyContent: 'flex-end' } }, resolveBtn, h('button', { class: 'btn primary', onclick: addComment }, 'Comment')),
    ),
  );
}

async function tabDiscover(root, seerr, ctx) {
  const results = h('div', { class: 'list', style: { marginTop: '12px' } });
  const popularList = h('div', { class: 'list' }, spinner());
  const popular = h('div', {},
    h('div', { class: 'section-title' }, 'Popular right now'),
    popularList,
  );
  const input = h('input', { class: 'input', placeholder: 'Search movies & TV to request…' });

  const showPopular = (show) => { popular.style.display = show ? '' : 'none'; };

  const doSearch = debounce(async () => {
    const term = input.value.trim();
    if (!term) { clear(results); showPopular(true); return; }
    showPopular(false);
    mount(results, spinner());
    try {
      const data = await seerr.get(`search?query=${encodeURIComponent(term)}`);
      const found = (data.results || []).filter((x) => x.mediaType !== 'person');
      if (!found.length) return mount(results, empty('', 'No matches'));
      renderDiscoverInto(results, found.slice(0, 20), seerr, ctx);
    } catch (e) { mount(results, empty('', 'Search failed', e.message)); }
  }, 400);

  input.addEventListener('input', () => {
    // Toggle immediately for responsiveness; the fetch is debounced.
    if (input.value.trim()) { showPopular(false); } else { clear(results); showPopular(true); }
    doSearch();
  });

  mount(root, h('div', { class: 'search-row' }, input), results, popular);
  setTimeout(() => input.focus(), 50);

  // Load the popular quick-add list.
  try {
    const data = await seerr.get('discover/trending?page=1');
    const found = (data.results || []).filter((x) => x.mediaType !== 'person');
    if (!found.length) mount(popularList, empty('', 'No popular titles right now'));
    else renderDiscoverInto(popularList, found.slice(0, 20), seerr, ctx);
  } catch (e) {
    mount(popularList, empty('', 'Could not load popular titles', e.message));
  }
}

// Render an array of discover items into a container as hexes or list rows,
// following the Seerr Hex/List toggle.
function renderDiscoverInto(target, items, seerr, ctx) {
  if (effectiveMode(ctx.service.key) === 'hex') {
    mount(target, hive(items.map((r) => discoverHex(r, seerr, ctx)), target.clientWidth));
  } else {
    mount(target, ...items.map((r) => discoverRow(r, seerr, ctx)));
  }
}

function discoverHex(r, seerr, ctx) {
  const isTv = r.mediaType === 'tv';
  const title = r.title || r.name || r.originalTitle || r.originalName || 'Untitled';
  const date = r.releaseDate || r.firstAirDate || '';
  const year = date ? String(new Date(date).getFullYear()) : '';
  const st = r.mediaInfo && r.mediaInfo.status;
  const info = st && DISCOVER_STATUS[st];
  const pills = [{ label: isTv ? 'TV' : 'Movie', cls: 'muted' }];
  if (info) pills.push({ label: info.label, cls: info.cls });
  if (r.voteAverage) pills.push({ label: `★ ${r.voteAverage.toFixed(1)}`, cls: 'ok' });
  const canRequest = !st || st === 1 || (isTv && st === 4);
  const actions = canRequest ? h('div', { class: 'row-actions' },
    h('button', { class: 'btn sm primary', onclick: async (e) => {
      e.stopPropagation();
      if (isTv) return openSeasonModal(seerr, ctx, r, title);
      return openMovieRequestModal(seerr, ctx, r, title);
    } }, isTv && st === 4 ? '＋ Seasons' : '＋ Request'),
  ) : null;
  return posterHexCard({
    posterUrl: tmdbPoster(r.posterPath),
    title,
    sub: year,
    pills,
    actions,
    onClick: () => openDetailModal(ctx, { mediaType: r.mediaType, tmdbId: r.id, fallback: { title, overview: r.overview, posterUrl: tmdbPoster(r.posterPath) } }),
  });
}

function discoverRow(r, seerr, ctx) {
  const isTv = r.mediaType === 'tv';
  const title = r.title || r.name || r.originalTitle || r.originalName || 'Untitled';
  const date = r.releaseDate || r.firstAirDate || '';
  const year = date ? ` (${new Date(date).getFullYear()})` : '';
  return h('div', { class: 'row clickable', onclick: () => openDetailModal(ctx, { mediaType: r.mediaType, tmdbId: r.id, fallback: { title, overview: r.overview, posterUrl: tmdbPoster(r.posterPath) } }) },
    poster(tmdbPoster(r.posterPath), isTv ? '' : ''),
    h('div', { class: 'row-main' },
      h('div', { class: 'row-title' }, title, h('span', { class: 'dim' }, year)),
      h('div', { class: 'row-sub' }, r.overview || 'No description available.'),
      h('div', { class: 'meta-line', style: { marginTop: '4px' } },
        h('span', { class: 'pill muted' }, isTv ? 'TV' : 'Movie'),
        r.voteAverage ? h('span', {}, `★ ${r.voteAverage.toFixed(1)}`) : null,
      ),
    ),
    h('div', { class: 'row-actions' },
      ...discoverActions(r, seerr, ctx, isTv, title),
    ),
  );
}

// Request/availability status shown in Discover based on Overseerr's mediaInfo.
const DISCOVER_STATUS = {
  2: { label: 'Requested', cls: 'warn' },
  3: { label: 'Processing', cls: 'info' },
  4: { label: 'Partially Available', cls: 'info' },
  5: { label: 'Available', cls: 'ok' },
};

function discoverActions(r, seerr, ctx, isTv, title) {
  const st = r.mediaInfo && r.mediaInfo.status;
  const info = st && DISCOVER_STATUS[st];
  // Can still request when unknown, or a partially-available show (to add seasons).
  const canRequest = !st || st === 1 || (isTv && st === 4);
  const nodes = [];
  if (info) nodes.push(h('span', { class: `pill ${info.cls}` }, info.label));
  if (canRequest) {
    nodes.push(h('button', { class: 'btn sm primary', onclick: async (e) => {
      e.stopPropagation();
      if (isTv) return openSeasonModal(seerr, ctx, r, title);
      return openMovieRequestModal(seerr, ctx, r, title);
    } }, isTv && st === 4 ? '＋ Seasons' : '＋ Request'));
  }
  return nodes;
}

// Fetch the Radarr/Sonarr server + root folders + quality profiles that Seerr
// knows about, so the user can choose an install location when requesting.
async function fetchRequestOptions(seerr, mediaType) {
  const svcType = mediaType === 'tv' ? 'sonarr' : 'radarr';
  const servers = await cachedGet(`seerr:service:${svcType}`, () => seerr.get(`service/${svcType}`), 600000);
  if (!Array.isArray(servers) || !servers.length) return null;
  const server = servers.find((s) => s.isDefault && !s.is4k) || servers.find((s) => !s.is4k) || servers[0];
  const details = await cachedGet(`seerr:service:${svcType}:${server.id}`, () => seerr.get(`service/${svcType}/${server.id}`), 600000);
  return {
    serverId: server.id,
    defaultProfileId: server.activeProfileId,
    defaultRoot: server.activeDirectory,
    rootFolders: details.rootFolders || [],
    profiles: details.profiles || [],
  };
}

function seerrField(label, control) {
  return h('div', {}, h('div', { class: 'section-title', style: { margin: '0 0 6px' } }, label), control);
}

function folderSelect(opts) {
  return h('select', { class: 'input' }, ...opts.rootFolders.map((f) =>
    h('option', { value: f.path, selected: f.path === opts.defaultRoot ? 'selected' : null }, `${f.path} (${fmtBytes(f.freeSpace || 0)} free)`)));
}

function profileSelect(opts) {
  return h('select', { class: 'input' }, ...opts.profiles.map((p) =>
    h('option', { value: p.id, selected: p.id === opts.defaultProfileId ? 'selected' : null }, p.name)));
}

export async function openMovieRequestModal(seerr, ctx, r, title) {
  const bodyEl = h('div', {}, spinner());
  openModal({ title: `Request “${title}”`, body: bodyEl, wide: true });

  let opts = null;
  try { opts = await fetchRequestOptions(seerr, 'movie'); } catch { /* no advanced options / no permission */ }

  if (!opts || !opts.rootFolders.length) {
    // Fall back to a simple request (no install-location choice available).
    const ok = await submitRequest(seerr, ctx, { mediaType: 'movie', mediaId: r.id }, title);
    if (ok) closeModal(); else mount(bodyEl, empty('', 'Request failed', 'Saved to Failed Requests — retry from the dashboard.'));
    return;
  }

  const rootSel = folderSelect(opts);
  const profSel = profileSelect(opts);
  const submit = async () => {
    const ok = await submitRequest(seerr, ctx, { mediaType: 'movie', mediaId: r.id, serverId: opts.serverId, profileId: Number(profSel.value), rootFolder: rootSel.value }, title);
    if (ok) closeModal();
  };

  mount(bodyEl,
    h('div', { class: 'grid', style: { gap: '14px' } },
      seerrField('Install location (root folder)', rootSel),
      seerrField('Quality Profile', profSel),
    ),
    h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '18px' } },
      h('button', { class: 'btn', onclick: closeModal }, 'Cancel'),
      h('button', { class: 'btn primary', onclick: submit }, 'Request'),
    ),
  );
}

// Season picker for TV requests (mirrors Seerr's native behaviour).
export async function openSeasonModal(seerr, ctx, r, title) {
  const bodyEl = h('div', {}, spinner());
  openModal({ title: `Request “${title}”`, body: bodyEl, wide: true });

  let detail;
  try { detail = await seerr.get(`tv/${r.id}`); }
  catch (e) { return mount(bodyEl, empty('', 'Could not load seasons', e.message)); }

  // Season 0 = specials; list real seasons first, specials last.
  const seasons = (detail.seasons || [])
    .filter((s) => typeof s.seasonNumber === 'number')
    .sort((a, b) => a.seasonNumber - b.seasonNumber);
  const requestable = seasons.filter((s) => s.seasonNumber > 0);

  if (!requestable.length) {
    // No discrete seasons — fall back to requesting everything.
    const ok = await submitRequest(seerr, ctx, { mediaType: 'tv', mediaId: r.id, seasons: 'all' }, title);
    if (ok) closeModal();
    return;
  }

  let opts = null;
  try { opts = await fetchRequestOptions(seerr, 'tv'); } catch { /* no advanced options / no permission */ }
  const rootSel = opts && opts.rootFolders.length ? folderSelect(opts) : null;
  const profSel = opts && opts.profiles.length ? profileSelect(opts) : null;

  const seasonStatus = {};
  ((detail.mediaInfo && detail.mediaInfo.seasons) || []).forEach((s) => { seasonStatus[s.seasonNumber] = s.status; });
  const SEASON_LABEL = { 2: 'Requested', 3: 'Processing', 4: 'Partially Available', 5: 'Available' };

  const checks = new Map();
  const rows = requestable.map((s) => {
    const st = seasonStatus[s.seasonNumber];
    const done = st === 2 || st === 3 || st === 5;       // already requested / available
    const selectable = !done;
    const cb = h('input', { type: 'checkbox', checked: selectable && st !== 4, disabled: !selectable, dataset: { season: s.seasonNumber } });
    if (selectable) checks.set(s.seasonNumber, cb);
    return h('label', { class: 'row', style: { cursor: selectable ? 'pointer' : 'default', padding: '10px 14px', opacity: done ? 0.55 : 1 } },
      cb,
      h('div', { class: 'row-main', style: { marginLeft: '10px' } },
        h('div', { class: 'row-title' }, s.name || `Season ${s.seasonNumber}`),
        h('div', { class: 'row-sub' }, `${s.episodeCount || 0} episode${(s.episodeCount || 0) === 1 ? '' : 's'}`),
      ),
      st ? h('span', { class: `pill ${st === 5 ? 'ok' : st === 4 ? 'info' : 'warn'} right` }, SEASON_LABEL[st]) : null,
    );
  });

  const selectAll = h('input', { type: 'checkbox', checked: true });
  selectAll.addEventListener('change', () => { for (const cb of checks.values()) cb.checked = selectAll.checked; });
  const syncSelectAll = () => { selectAll.checked = [...checks.values()].every((c) => c.checked); };
  for (const cb of checks.values()) cb.addEventListener('change', syncSelectAll);

  const submit = async () => {
    const chosen = [...checks.entries()].filter(([, cb]) => cb.checked).map(([n]) => n);
    if (!chosen.length) return toast('Select at least one new season', 'error');
    const payload = { mediaType: 'tv', mediaId: r.id, seasons: chosen };
    if (opts) {
      payload.serverId = opts.serverId;
      if (profSel) payload.profileId = Number(profSel.value);
      if (rootSel) payload.rootFolder = rootSel.value;
    }
    const ok = await submitRequest(seerr, ctx, payload, `${chosen.length} season${chosen.length === 1 ? '' : 's'} of ${title}`);
    if (ok) closeModal();
  };

  mount(bodyEl,
    (rootSel || profSel) ? h('div', { class: 'grid', style: { gap: '14px', marginBottom: '16px' } },
      rootSel ? seerrField('Install location (root folder)', rootSel) : null,
      profSel ? seerrField('Quality Profile', profSel) : null,
    ) : null,
    h('label', { style: { display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '12px', fontWeight: '600' } }, selectAll, 'Select all seasons'),
    h('div', { class: 'list' }, ...rows),
    h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '18px' } },
      h('button', { class: 'btn', onclick: closeModal }, 'Cancel'),
      h('button', { class: 'btn primary', onclick: submit }, 'Request Selected'),
    ),
  );
}
