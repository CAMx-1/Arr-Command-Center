import { h, mount, tabs, spinner, skeletonList, empty, toast, fmtBytes, pct, openModal, closeModal } from '../lib/ui.js';
import { hive, posterHexCard } from '../lib/hive.js';
import { viewToggle, effectiveMode } from '../lib/viewMode.js';

// qBittorrent (torrent client) panel — mirrors the SABnzbd view: a transfer
// stats header, global pause/resume + speed-limit controls, and per-torrent
// pause/resume/delete. Talks to the WebUI API v2 through the proxy.

const GRAD = 'linear-gradient(160deg, #3772d8, #0f172a)';

function fmtSpeed(b) { return `${fmtBytes(Number(b) || 0)}/s`; }
function fmtEta(s) {
  s = Number(s) || 0;
  if (s <= 0 || s >= 8640000) return '∞';
  const d = Math.floor(s / 86400), hh = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (d) return `${d}d ${hh}h`;
  if (hh) return `${hh}h ${m}m`;
  return m ? `${m}m ${sec}s` : `${sec}s`;
}
const STATE = {
  downloading: { label: 'Downloading', cls: 'info' }, forcedDL: { label: 'Downloading', cls: 'info' },
  stalledDL: { label: 'Stalled', cls: 'muted' }, metaDL: { label: 'Metadata', cls: 'muted' },
  uploading: { label: 'Seeding', cls: 'ok' }, forcedUP: { label: 'Seeding', cls: 'ok' }, stalledUP: { label: 'Seeding', cls: 'ok' },
  pausedDL: { label: 'Paused', cls: 'warn' }, pausedUP: { label: 'Paused', cls: 'warn' },
  stoppedDL: { label: 'Stopped', cls: 'warn' }, stoppedUP: { label: 'Stopped', cls: 'warn' },
  queuedDL: { label: 'Queued', cls: 'muted' }, queuedUP: { label: 'Queued', cls: 'muted' },
  checkingDL: { label: 'Checking', cls: 'muted' }, checkingUP: { label: 'Checking', cls: 'muted' }, checkingResumeData: { label: 'Checking', cls: 'muted' },
  moving: { label: 'Moving', cls: 'muted' }, allocating: { label: 'Allocating', cls: 'muted' },
  error: { label: 'Error', cls: 'down' }, missingFiles: { label: 'Missing files', cls: 'down' },
};
function stateInfo(s) { return STATE[s] || { label: s || 'Unknown', cls: 'muted' }; }
// qBittorrent 5.0 renamed paused* -> stopped*; treat both as "not running".
function isPaused(s) { return /paused|stopped/i.test(s || ''); }

export async function renderQbittorrent(root, ctx) {
  const svc = ctx.service;
  if (!svc.configured) { ctx.setActions(); return mount(root, notConfigured(svc)); }
  const qb = ctx.api.qbit(svc.key);
  const body = h('div', {});
  const bar = tabs(body, [
    { id: 'downloading', label: 'Downloading', render: (c) => tabTorrents(c, qb, ctx, 'downloading') },
    { id: 'completed', label: 'Completed', render: (c) => tabTorrents(c, qb, ctx, 'completed') },
  ], `tabs-${svc.key}`);
  mount(root, bar, body);
}

function notConfigured(svc) {
  return h('div', { class: 'empty', style: { padding: '48px 24px' } },
    h('div', { class: 'empty-icon' }, ''),
    h('div', { style: { fontWeight: '700', fontSize: '16px' } }, 'qBittorrent isn’t configured yet'),
    h('div', { class: 'dim', style: { marginTop: '10px', maxWidth: '560px', lineHeight: '1.6' } },
      'Add your qBittorrent URL plus an ', h('span', { class: 'mono' }, 'API key'),
      ' (WebUI → Settings → API Key, requires v5.2.0+) or a username/password, under ',
      h('span', { class: 'mono' }, `services.${svc.key}`), ' in config.json, then restart.'),
  );
}

async function tabTorrents(root, qb, ctx, filter) {
  const svcKey = ctx.service.key;
  mount(root, skeletonList());
  try {
    const [info, torrents] = await Promise.all([
      qb.get('transfer/info').catch(() => ({})),
      qb.get('torrents/info'),
    ]);
    const all = Array.isArray(torrents) ? torrents : [];
    const list = filter === 'completed' ? all.filter((t) => (t.progress || 0) >= 1) : all.filter((t) => (t.progress || 0) < 1);
    ctx.setActions(viewToggle(svcKey, ctx.reload), ...globalControls(qb, ctx, info || {}));
    const header = statsHeader(info || {}, all);
    const title = filter === 'completed' ? 'Completed' : 'Downloading';
    if (!list.length) {
      mount(root, header, h('div', { class: 'section-title' }, title), empty('', filter === 'completed' ? 'Nothing completed' : 'Nothing downloading', 'No torrents here right now'));
      return;
    }
    const hex = effectiveMode(svcKey) === 'hex';
    const els = list.map((t) => (hex ? torrentHex : torrentRow)(t, qb, ctx));
    const view = hex ? hive(els, root.clientWidth) : h('div', { class: 'list' }, ...els);
    mount(root, header, h('div', { class: 'section-title' }, title), view);
  } catch (err) {
    mount(root, empty('', 'Failed to load torrents', err.message, { label: 'Retry', onClick: () => tabTorrents(root, qb, ctx, filter) }));
  }
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

function statsHeader(info, all) {
  const active = all.filter((t) => (t.dlspeed || 0) > 0 || (t.upspeed || 0) > 0).length;
  return h('div', { class: 'honeycomb' }, h('div', { class: 'hc-row' },
    statCard('Download', fmtSpeed(info.dl_info_speed), 'info'),
    statCard('Upload', fmtSpeed(info.up_info_speed), 'ok'),
    statCard('Active', String(active), null),
    statCard('Alt limits', info.use_alt_speed_limits ? 'On' : 'Off', info.use_alt_speed_limits ? 'warn' : null),
  ));
}

function globalControls(qb, ctx, info) {
  const act = async (path, params, msg) => {
    try { await qb.post(path, params); toast(msg, 'success'); ctx.reload(); }
    catch (e) { toast(e.message, 'error'); }
  };
  return [
    h('button', { class: 'btn', onclick: () => act('torrents/start', { hashes: 'all' }, 'Resumed all') }, 'Resume all'),
    h('button', { class: 'btn', onclick: () => act('torrents/stop', { hashes: 'all' }, 'Paused all') }, 'Pause all'),
    h('button', { class: 'btn', onclick: () => openSpeedModal(qb, ctx, info) }, 'Speed limits'),
  ];
}

function catIcon(cat) {
  const c = (cat || '').toLowerCase();
  if (c.includes('tv')) return '📺';
  if (c.includes('movie')) return '🎬';
  if (c.includes('music')) return '🎵';
  if (c.includes('linux') || c.includes('iso')) return '💿';
  return '⬇';
}

function torrentMeta(t) {
  const done = (t.size || 0) - (t.amount_left || 0);
  const parts = [
    `${fmtBytes(done)} / ${fmtBytes(t.size || 0)}`,
  ];
  if ((t.progress || 0) < 1 && (t.dlspeed || 0) > 0) parts.push(`↓ ${fmtSpeed(t.dlspeed)}`);
  if ((t.upspeed || 0) > 0) parts.push(`↑ ${fmtSpeed(t.upspeed)}`);
  if ((t.progress || 0) < 1) parts.push(`ETA ${fmtEta(t.eta)}`);
  parts.push(`▲ ${t.num_seeds ?? 0} ▼ ${t.num_leechs ?? 0}`);
  if (t.ratio != null) parts.push(`ratio ${Number(t.ratio).toFixed(2)}`);
  return parts;
}

function torrentRow(t, qb, ctx) {
  const s = stateInfo(t.state);
  const paused = isPaused(t.state);
  const prog = (t.progress || 0) * 100;
  return h('div', { class: 'row' },
    h('div', { class: 'poster', style: { width: '40px', height: '40px', fontSize: '18px' } }, catIcon(t.category)),
    h('div', { class: 'row-main' },
      h('div', { class: 'row-title' }, t.name),
      h('div', { class: 'meta-line', style: { marginTop: '4px' } },
        h('span', { class: `pill ${s.cls}` }, s.label),
        t.category ? h('span', { class: 'pill muted' }, t.category) : null,
        ...torrentMeta(t).map((x) => h('span', {}, x)),
      ),
      h('div', { class: 'progress' }, h('span', { style: { width: pct(prog) } })),
    ),
    h('div', { class: 'row-actions' },
      h('button', { class: 'btn sm', title: paused ? 'Resume' : 'Pause', onclick: async () => {
        try { await qb.post(paused ? 'torrents/start' : 'torrents/stop', { hashes: t.hash }); toast(paused ? 'Resumed' : 'Paused', 'success'); ctx.reload(); }
        catch (e) { toast(e.message, 'error'); }
      } }, paused ? '▶' : '⏸'),
      h('button', { class: 'btn sm danger', title: 'Delete', onclick: () => openDeleteModal(t, qb, ctx) }, '✕'),
    ),
  );
}

function torrentHex(t, qb, ctx) {
  const s = stateInfo(t.state);
  const paused = isPaused(t.state);
  const prog = (t.progress || 0) * 100;
  const actions = h('div', { class: 'row-actions' },
    h('button', { class: 'btn sm', title: paused ? 'Resume' : 'Pause', onclick: async (e) => {
      e.stopPropagation();
      try { await qb.post(paused ? 'torrents/start' : 'torrents/stop', { hashes: t.hash }); toast(paused ? 'Resumed' : 'Paused', 'success'); ctx.reload(); }
      catch (err) { toast(err.message, 'error'); }
    } }, paused ? '▶' : '⏸'),
    h('button', { class: 'btn sm danger', title: 'Delete', onclick: (e) => { e.stopPropagation(); openDeleteModal(t, qb, ctx); } }, '✕'),
  );
  return posterHexCard({
    gradient: GRAD,
    title: t.name,
    pills: [{ label: s.label, cls: s.cls }, t.category ? { label: t.category, cls: 'muted' } : null],
    sub: `${fmtBytes((t.size || 0) - (t.amount_left || 0))} / ${fmtBytes(t.size || 0)} · ▲ ${t.num_seeds ?? 0}`,
    progress: prog,
    actions,
  });
}

function openDeleteModal(t, qb, ctx) {
  const delFiles = h('input', { type: 'checkbox' });
  const confirm = async () => {
    try {
      await qb.post('torrents/delete', { hashes: t.hash, deleteFiles: delFiles.checked ? 'true' : 'false' });
      toast(delFiles.checked ? 'Removed torrent + files' : 'Removed torrent', 'success');
      closeModal(); ctx.reload();
    } catch (e) { toast(e.message, 'error'); }
  };
  openModal({
    title: 'Remove torrent',
    body: h('div', {},
      h('p', { style: { margin: '0 0 12px', lineHeight: '1.5' } }, `Remove “${t.name}” from qBittorrent?`),
      h('label', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, delFiles, 'Also delete downloaded files from disk'),
    ),
    footer: h('div', { style: { display: 'flex', gap: '10px', justifyContent: 'flex-end', width: '100%' } },
      h('button', { class: 'btn', onclick: closeModal }, 'Cancel'),
      h('button', { class: 'btn primary danger', onclick: confirm }, 'Remove'),
    ),
  });
}

function openSpeedModal(qb, ctx, info) {
  const toKiB = (bytes) => (Number(bytes) > 0 ? Math.round(Number(bytes) / 1024) : 0);
  const dl = h('input', { class: 'input', type: 'number', min: '0', value: String(toKiB(info.dl_rate_limit)) });
  const up = h('input', { class: 'input', type: 'number', min: '0', value: String(toKiB(info.up_rate_limit)) });
  const field = (label, control, hint) => h('div', { style: { marginBottom: '12px' } },
    h('div', { class: 'section-title', style: { margin: '0 0 6px' } }, label), control,
    hint ? h('div', { class: 'dim', style: { fontSize: '11px', marginTop: '4px' } }, hint) : null);
  const apply = async () => {
    try {
      await qb.post('transfer/setDownloadLimit', { limit: String((Number(dl.value) || 0) * 1024) });
      await qb.post('transfer/setUploadLimit', { limit: String((Number(up.value) || 0) * 1024) });
      toast('Speed limits updated', 'success'); closeModal(); ctx.reload();
    } catch (e) { toast(e.message, 'error'); }
  };
  const toggleAlt = async () => {
    try { await qb.post('transfer/toggleSpeedLimitsMode', {}); toast('Toggled alternative speed limits', 'success'); closeModal(); ctx.reload(); }
    catch (e) { toast(e.message, 'error'); }
  };
  openModal({
    title: 'Global speed limits',
    body: h('div', {},
      field('Download limit (KiB/s)', dl, '0 = unlimited'),
      field('Upload limit (KiB/s)', up, '0 = unlimited'),
      h('button', { class: 'btn sm', onclick: toggleAlt }, `Alternative limits: ${info.use_alt_speed_limits ? 'On' : 'Off'} (toggle)`),
    ),
    footer: h('div', { style: { display: 'flex', gap: '10px', justifyContent: 'flex-end', width: '100%' } },
      h('button', { class: 'btn', onclick: closeModal }, 'Cancel'),
      h('button', { class: 'btn primary', onclick: apply }, 'Apply'),
    ),
  });
}
