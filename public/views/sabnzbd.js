import { h, mount, clear, tabs, spinner, skeletonList, empty, toast, fmtBytes, pct, poster, openModal, closeModal } from '../lib/ui.js';
import { hive, posterHexCard } from '../lib/hive.js';
import { viewToggle, effectiveMode } from '../lib/viewMode.js';

export async function renderSabnzbd(root, ctx) {
  const svc = ctx.service;
  const sab = (params) => ctx.api.sab(svc.key, params);
  ctx.sab = sab;

  const body = h('div', {});
  const bar = tabs(body, [
    { id: 'queue', label: 'Queue', render: (c) => tabQueue(c, sab, ctx) },
    { id: 'history', label: 'History', render: (c) => tabHistory(c, sab, ctx) },
  ], `tabs-${svc.key}`);
  mount(root, bar, body);
}

async function tabQueue(root, sab, ctx) {
  mount(root, skeletonList());
  try {
    const data = await sab({ mode: 'queue' });
    const q = data.queue || {};
    ctx.setActions(viewToggle(ctx.service.key, ctx.reload), ...queueControls(q, sab, ctx));
    const header = statsHeader(q);
    const slots = q.slots || [];
    if (!slots.length) {
      mount(root, header, h('div', { class: 'section-title' }, 'Downloads'), empty('', 'Queue is empty', 'Nothing downloading right now'));
      return;
    }
    const hex = effectiveMode(ctx.service.key) === 'hex';
    const els = slots.map((s) => (hex ? slotHex : slotRow)(s, sab, ctx));
    const list = hex ? hive(els, root.clientWidth) : h('div', { class: 'list' }, ...els);
    mount(root, header, h('div', { class: 'section-title' }, 'Downloads'), list);
    lazyPosters(slots, els, buildDownloadPosters(ctx));
  } catch (err) {
    mount(root, empty('', 'Failed to load queue', err.message, { label: 'Retry', onClick: () => tabQueue(root, sab, ctx) }));
  }
}

// Fill in posters after the list has rendered (they're not needed to show it).
function lazyPosters(slots, els, mapPromise) {
  mapPromise.then((map) => {
    slots.forEach((s, i) => {
      const url = slotPoster(s, map);
      const el = els[i];
      if (url && el && el._applyPoster) el._applyPoster(url);
    });
  }).catch(() => { /* ignore */ });
}

// Match SABnzbd downloads to their Sonarr/Radarr queue item (by download ID) to
// borrow the series/movie poster. Returns a map of downloadId(lowercased) -> url.
// Poster maps are cached briefly so repeated queue refreshes (pause/resume/delete
// each reload the tab) don't refetch. Keyed by downloadId and normalized title.
const _pcache = { queue: null, queueAt: 0, history: null, historyAt: 0 };
const PC_TTL = 30000;

async function fetchArrPosters(ctx, endpoint, titleField) {
  const map = {};
  const arrs = (ctx.state.services || []).filter((s) => (s.type === 'sonarr' || s.type === 'radarr') && s.configured);
  await Promise.all(arrs.map(async (svc) => {
    try {
      const inc = svc.type === 'sonarr' ? 'includeSeries=true' : 'includeMovie=true';
      const sep = endpoint.includes('?') ? '&' : '?';
      const data = await ctx.api.arr(svc.key).get(`${endpoint}${sep}${inc}`);
      for (const r of (data.records || [])) {
        const media = r.series || r.movie;
        const img = media && (media.images || []).find((i) => i.coverType === 'poster');
        const url = img && (img.remoteUrl || img.url);
        if (!url) continue;
        if (r.downloadId) map[String(r.downloadId).toLowerCase()] = url;
        const t = r[titleField];
        if (t) map[`t:${normTitle(t)}`] = url;
      }
    } catch { /* ignore per-service errors */ }
  }));
  return map;
}

async function buildDownloadPosters(ctx) {
  if (_pcache.queue && Date.now() - _pcache.queueAt < PC_TTL) return _pcache.queue;
  const map = await fetchArrPosters(ctx, 'queue?pageSize=60', 'title');
  _pcache.queue = map; _pcache.queueAt = Date.now();
  return map;
}

function statsHeader(q) {
  const paused = q.paused || q.status === 'Paused';
  return h('div', { class: 'honeycomb' }, h('div', { class: 'hc-row' },
    statCard('Status', paused ? 'Paused' : 'Active', paused ? 'warn' : 'ok'),
    statCard('Speed', paused ? '0' : (q.speed || q.kbpersec + ' KB/s'), 'info'),
    statCard('Remaining', q.sizeleft || fmtBytes((Number(q.mbleft) || 0) * 1048576), null),
    statCard('Free Disk', q.diskspace1 ? `${Number(q.diskspace1).toFixed(0)} GB` : '—', null),
  ));
}

function statCard(label, value, cls) {
  const color = cls === 'ok' ? 'var(--green)' : cls === 'warn' ? 'var(--amber)' : cls === 'info' ? 'var(--blue)' : '';
  return h('div', { class: 'hex-cell hex-static' },
    h('div', { class: 'hex-border' }),
    h('div', { class: 'hex-face' },
      h('div', { class: 'hex-inner' },
        h('div', { class: 'stat' },
          h('span', { class: 'stat-value', style: color ? { color } : {} }, String(value)),
          h('span', { class: 'stat-label' }, label),
        ),
      ),
    ),
  );
}

function queueControls(q, sab, ctx) {
  const paused = q.paused || q.status === 'Paused';
  return [
    h('button', { class: 'btn', onclick: async () => {
      try { await sab({ mode: paused ? 'resume' : 'pause' }); toast(paused ? 'Resumed' : 'Paused', 'success'); ctx.reload(); }
      catch (e) { toast(e.message, 'error'); }
    } }, paused ? 'Resume' : 'Pause'),
    h('button', { class: 'btn', onclick: () => openSpeedModal(q, sab, ctx) }, `Speed: ${q.speedlimit || 100}%`),
  ];
}

// Normalize a release name/title for fuzzy matching between SAB and the *arrs.
function normTitle(s) {
  return String(s || '').toLowerCase().replace(/\.(nzb|par2|rar|mkv|mp4)$/, '').replace(/[^a-z0-9]+/g, '');
}
function slotPoster(s, posterMap) {
  if (!posterMap) return null;
  const t = normTitle(s.filename || s.name || '');
  return posterMap[String(s.nzo_id || '').toLowerCase()] || posterMap[`t:${t}`] || null;
}

// Same idea for completed downloads, matched against Sonarr/Radarr *history*.
async function buildHistoryPosters(ctx) {
  if (_pcache.history && Date.now() - _pcache.historyAt < PC_TTL) return _pcache.history;
  const map = await fetchArrPosters(ctx, 'history?page=1&pageSize=60&sortKey=date&sortDirection=descending', 'sourceTitle');
  _pcache.history = map; _pcache.historyAt = Date.now();
  return map;
}

function slotRow(s, sab, ctx) {
  const prog = Number(s.percentage) || 0;
  const fallback = h('div', { class: 'poster', style: { width: '40px', height: '40px', fontSize: '18px' } }, catIcon(s.cat));
  const row = h('div', { class: 'row' },
    fallback,
    h('div', { class: 'row-main' },
      h('div', { class: 'row-title' }, s.filename),
      h('div', { class: 'meta-line', style: { marginTop: '4px' } },
        h('span', { class: `pill ${s.status === 'Downloading' ? 'info' : 'muted'}` }, s.status),
        s.cat ? h('span', { class: 'pill muted' }, s.cat) : null,
        h('span', {}, `${s.sizeleft} / ${s.size}`),
        s.timeleft && s.timeleft !== '0:00:00' ? h('span', {}, `ETA ${s.timeleft}`) : null,
        s.priority ? h('span', { class: 'dim' }, `${s.priority} priority`) : null,
      ),
      h('div', { class: 'progress' }, h('span', { style: { width: pct(prog) } })),
    ),
    h('div', { class: 'row-actions' },
      h('button', { class: 'btn sm danger', onclick: async () => {
        try { await sab({ mode: 'queue', name: 'delete', value: s.nzo_id, del_files: '1' }); toast('Removed', 'success'); ctx.reload(); }
        catch (e) { toast(e.message, 'error'); }
      } }, '✕'),
    ),
  );
  row._applyPoster = (url) => { try { fallback.replaceWith(poster(url, '')); } catch { /* ignore */ } };
  return row;
}

function slotHex(s, sab, ctx) {
  const prog = Number(s.percentage) || 0;
  const actions = h('div', { class: 'row-actions' },
    h('button', { class: 'btn sm danger', title: 'Remove', onclick: async (e) => {
      e.stopPropagation();
      try { await sab({ mode: 'queue', name: 'delete', value: s.nzo_id, del_files: '1' }); toast('Removed', 'success'); ctx.reload(); }
      catch (err) { toast(err.message, 'error'); }
    } }, '✕'),
  );
  const card = posterHexCard({
    gradient: 'linear-gradient(160deg, #4f46e5, #0f172a)',
    title: s.filename,
    pills: [
      { label: s.status, cls: s.status === 'Downloading' ? 'info' : 'muted' },
      s.cat ? { label: s.cat, cls: 'muted' } : null,
    ],
    sub: `${s.sizeleft} / ${s.size}${s.timeleft && s.timeleft !== '0:00:00' ? ` · ETA ${s.timeleft}` : ''}`,
    progress: prog,
    actions,
  });
  card._applyPoster = (url) => { const f = card.querySelector('.hx-face'); if (f) { f.style.backgroundImage = `url(${url})`; f.style.backgroundSize = 'cover'; f.style.backgroundPosition = 'center'; } };
  return card;
}

async function tabHistory(root, sab, ctx) {
  mount(root, skeletonList());
  try {
    const data = await sab({ mode: 'history', limit: '30' });
    const hist = data.history || {};
    const slots = hist.slots || [];
    if (!slots.length) return mount(root, empty('', 'No history yet'));
    ctx.setActions(viewToggle(ctx.service.key, ctx.reload));
    const meta = h('div', { class: 'meta-line', style: { marginBottom: '12px' } },
      h('span', {}, 'Today: ', h('b', {}, hist.day_size || '0')),
      h('span', {}, 'This week: ', h('b', {}, hist.week_size || '0')),
      h('span', {}, 'This month: ', h('b', {}, hist.month_size || '0')),
    );
    const hex = effectiveMode(ctx.service.key) === 'hex';
    const els = slots.map((s) => (hex ? historyHex : historyRow)(s, sab, ctx));
    const list = hex ? hive(els, root.clientWidth) : h('div', { class: 'list' }, ...els);
    mount(root, meta, list);
    lazyPosters(slots, els, buildHistoryPosters(ctx));
  } catch (err) {
    mount(root, empty('', 'Failed to load history', err.message));
  }
}

function historyRow(s, sab, ctx) {
  const ok = s.status === 'Completed';
  const fallback = h('div', { class: 'poster', style: { width: '40px', height: '40px', fontSize: '18px' } }, catIcon(s.category));
  const row = h('div', { class: 'row' },
    fallback,
    h('div', { class: 'row-main' },
      h('div', { class: 'row-title' }, s.name),
      h('div', { class: 'meta-line', style: { marginTop: '4px' } },
        h('span', { class: `pill ${ok ? 'ok' : 'down'}` }, s.status),
        s.category ? h('span', { class: 'pill muted' }, s.category) : null,
        h('span', {}, s.size || fmtBytes(s.bytes || 0)),
        s.completed ? h('span', {}, new Date(s.completed * 1000).toLocaleString()) : null,
        s.fail_message ? h('span', { class: 'dim' }, s.fail_message) : null,
      ),
    ),
    h('div', { class: 'row-actions' },
      h('button', { class: 'btn sm danger', onclick: async () => {
        try { await sab({ mode: 'history', name: 'delete', value: s.nzo_id }); toast('Deleted from history', 'success'); ctx.reload(); }
        catch (e) { toast(e.message, 'error'); }
      } }, '✕'),
    ),
  );
  row._applyPoster = (url) => { try { fallback.replaceWith(poster(url, '')); } catch { /* ignore */ } };
  return row;
}

function historyHex(s, sab, ctx) {
  const ok = s.status === 'Completed';
  const actions = h('div', { class: 'row-actions' },
    h('button', { class: 'btn sm danger', title: 'Delete', onclick: async (e) => {
      e.stopPropagation();
      try { await sab({ mode: 'history', name: 'delete', value: s.nzo_id }); toast('Deleted from history', 'success'); ctx.reload(); }
      catch (err) { toast(err.message, 'error'); }
    } }, '✕'),
  );
  const card = posterHexCard({
    gradient: 'linear-gradient(160deg, #4f46e5, #0f172a)',
    title: s.name,
    pills: [
      { label: s.status, cls: ok ? 'ok' : 'down' },
      s.category ? { label: s.category, cls: 'muted' } : null,
    ],
    sub: `${s.size || fmtBytes(s.bytes || 0)}${s.completed ? ` · ${new Date(s.completed * 1000).toLocaleDateString()}` : ''}`,
    actions,
  });
  card._applyPoster = (url) => { const f = card.querySelector('.hx-face'); if (f) { f.style.backgroundImage = `url(${url})`; f.style.backgroundSize = 'cover'; f.style.backgroundPosition = 'center'; } };
  return card;
}

function openSpeedModal(q, sab, ctx) {
  const input = h('input', { class: 'input', type: 'number', min: '0', max: '100', value: q.speedlimit || '100' });
  const presets = h('div', { style: { display: 'flex', gap: '8px', marginTop: '12px', flexWrap: 'wrap' } },
    ...['25', '50', '75', '100'].map((v) => h('button', { class: 'btn sm', onclick: () => { input.value = v; } }, `${v}%`)),
  );
  const apply = async () => {
    try { await sab({ mode: 'config', name: 'speedlimit', value: input.value }); toast(`Speed limit set to ${input.value}%`, 'success'); closeModal(); ctx.reload(); }
    catch (e) { toast(e.message, 'error'); }
  };
  openModal({
    title: 'Set Speed Limit',
    body: h('div', {}, h('div', { class: 'section-title', style: { margin: '0 0 6px' } }, 'Percentage of max speed'), input, presets),
    footer: h('div', { style: { display: 'flex', gap: '10px' } },
      h('button', { class: 'btn', onclick: closeModal }, 'Cancel'),
      h('button', { class: 'btn primary', onclick: apply }, 'Apply'),
    ),
  });
}

function catIcon(cat) {
  if (!cat) return '';
  const c = cat.toLowerCase();
  if (c.includes('tv')) return '';
  if (c.includes('movie')) return '';
  if (c.includes('music')) return '';
  return '';
}
