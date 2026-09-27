import { h, mount, tabs, skeletonList, empty, toast, fmtBytes, pct, openModal, closeModal, autoRefresh } from '../lib/ui.js';
import { hive, posterHexCard } from '../lib/hive.js';
import { viewToggle, effectiveMode } from '../lib/viewMode.js';
import { downloadClientFor } from '../lib/downloadClients.js';

const GRADIENT = {
  transmission: 'linear-gradient(160deg, #dc2626, #3f0d12)',
  deluge: 'linear-gradient(160deg, #2563eb, #082f49)',
  nzbget: 'linear-gradient(160deg, #16a34a, #052e16)',
};

function fmtSpeed(bytes) { return `${fmtBytes(Number(bytes) || 0)}/s`; }
function fmtEta(seconds) {
  const value = Number(seconds) || 0;
  if (value <= 0 || value >= 8640000) return '∞';
  const days = Math.floor(value / 86400);
  const hours = Math.floor((value % 86400) / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export async function renderDownloadClient(root, ctx) {
  const svc = ctx.service;
  if (!svc.configured) { ctx.setActions(); return mount(root, notConfigured(svc)); }
  const adapter = downloadClientFor(ctx.api, svc);
  const body = h('div', {});
  const bar = tabs(body, adapter.tabs.map((tab) => ({
    ...tab,
    render: (container) => renderTab(container, adapter, ctx, tab),
  })), `tabs-${svc.key}`);
  mount(root, bar, body);
}

function notConfigured(svc) {
  const detail = svc.type === 'deluge'
    ? 'Add the Deluge Web URL and password in Settings.'
    : svc.type === 'nzbget'
      ? 'Add the NZBGet URL plus ControlUsername and ControlPassword in Settings.'
      : 'Add the Transmission RPC URL and optional Basic-auth username/password in Settings.';
  return empty('⬇', `${svc.label} isn’t configured`, detail);
}

async function renderTab(root, adapter, ctx, tab) {
  const wrap = h('div', {});
  mount(root, wrap);
  const load = async (silent = false) => {
    if (!silent) mount(wrap, skeletonList());
    try {
      const data = await adapter.load(tab.id);
      if (!silent) ctx.setActions(viewToggle(ctx.service.key, ctx.reload), ...globalControls(adapter, ctx, data.session));
      const header = statsHeader(adapter, data.session, data.all || data.items);
      const items = data.items || [];
      if (!items.length) {
        mount(wrap, header, h('div', { class: 'section-title' }, tab.label), empty('⬇', `No ${tab.label.toLowerCase()}`, 'Nothing here right now'));
        return;
      }
      const hexMode = effectiveMode(ctx.service.key) === 'hex';
      const cards = items.map((item) => hexMode ? itemHex(item, adapter, ctx) : itemRow(item, adapter, ctx));
      mount(wrap, header, h('div', { class: 'section-title' }, tab.label), hexMode ? hive(cards, root.clientWidth) : h('div', { class: 'list' }, ...cards));
    } catch (error) {
      if (!silent) mount(wrap, empty('⚠️', `Failed to load ${ctx.service.label}`, error.message, { label: 'Retry', onClick: () => load(false) }));
    }
  };
  await load(false);
  autoRefresh(wrap, 5000, () => load(true));
}

function statsHeader(adapter, session = {}, items = []) {
  const active = session.activeCount ?? items.filter((item) => item.dlSpeed > 0 || item.upSpeed > 0).length;
  return h('div', { class: 'honeycomb' }, h('div', { class: 'hc-row' },
    statCard('Status', session.paused ? 'Paused' : 'Active', session.paused ? 'warn' : 'ok'),
    statCard('Download', fmtSpeed(session.dlSpeed), 'info'),
    adapter.capabilities.upload ? statCard('Upload', fmtSpeed(session.upSpeed), 'ok') : statCard('Remaining', session.remaining != null ? fmtBytes(session.remaining) : '—'),
    statCard('Active', String(active || 0)),
    session.freeSpace != null ? statCard('Free disk', fmtBytes(session.freeSpace)) : null,
  ));
}

function statCard(label, value, cls) {
  const color = cls === 'ok' ? 'var(--green)' : cls === 'warn' ? 'var(--amber)' : cls === 'info' ? 'var(--blue)' : '';
  return h('div', { class: 'hex-cell hex-static' }, h('div', { class: 'hex-border' }), h('div', { class: 'hex-face' }, h('div', { class: 'hex-inner' },
    h('div', { class: 'stat' }, h('span', { class: 'stat-value', style: color ? { color } : {} }, String(value)), h('span', { class: 'stat-label' }, label)),
  )));
}

function globalControls(adapter, ctx, session) {
  const act = async (operation, message) => {
    try { await operation(); toast(message, 'success'); ctx.reload(); }
    catch (error) { toast(error.message, 'error'); }
  };
  return [
    h('button', { class: 'btn', onclick: () => act(session.paused ? adapter.resumeAll : adapter.pauseAll, session.paused ? 'Resumed all' : 'Paused all') }, session.paused ? 'Resume all' : 'Pause all'),
    adapter.capabilities.speed ? h('button', { class: 'btn', onclick: () => openSpeedModal(adapter, ctx, session) }, 'Speed limits') : null,
  ];
}

function itemMeta(item, adapter) {
  const parts = [`${fmtBytes(item.sizeDone)} / ${fmtBytes(item.size)}`];
  if (!item.completed && item.dlSpeed > 0) parts.push(`↓ ${fmtSpeed(item.dlSpeed)}`);
  if (adapter.capabilities.upload && item.upSpeed > 0) parts.push(`↑ ${fmtSpeed(item.upSpeed)}`);
  if (!item.completed && item.eta > 0) parts.push(`ETA ${fmtEta(item.eta)}`);
  if (item.seeds != null) parts.push(`▲ ${item.seeds}`);
  if (item.leechs != null) parts.push(`▼ ${item.leechs}`);
  if (item.ratio != null) parts.push(`ratio ${Number(item.ratio).toFixed(2)}`);
  if (item.completedAt) parts.push(new Date(item.completedAt * 1000).toLocaleString());
  if (item.failMessage) parts.push(item.failMessage);
  return parts;
}

function itemActions(item, adapter, ctx, stopPropagation = false) {
  const wrap = (handler) => async (event) => { if (stopPropagation) event.stopPropagation(); await handler(); };
  const buttons = [];
  if (adapter.capabilities.pauseItem && !item.history && (item.canPause || item.canResume)) {
    const resume = item.canResume;
    buttons.push(h('button', { class: 'btn sm', title: resume ? 'Resume' : 'Pause', onclick: wrap(async () => {
      try { await (resume ? adapter.resumeItem(item) : adapter.pauseItem(item)); toast(resume ? 'Resumed' : 'Paused', 'success'); ctx.reload(); }
      catch (error) { toast(error.message, 'error'); }
    }) }, resume ? '▶' : '⏸'));
  }
  buttons.push(h('button', { class: 'btn sm danger', title: 'Remove', onclick: wrap(() => openRemoveModal(item, adapter, ctx)) }, '✕'));
  return h('div', { class: 'row-actions' }, ...buttons);
}

function itemRow(item, adapter, ctx) {
  return h('div', { class: 'row' },
    h('div', { class: 'poster', style: { width: '40px', height: '40px', fontSize: '18px' } }, categoryIcon(item.category, adapter.protocol)),
    h('div', { class: 'row-main' },
      h('div', { class: 'row-title' }, item.name),
      h('div', { class: 'meta-line', style: { marginTop: '4px' } },
        h('span', { class: `pill ${item.stateClass}` }, item.stateLabel),
        item.category ? h('span', { class: 'pill muted' }, item.category) : null,
        ...itemMeta(item, adapter).map((value) => h('span', { class: item.failMessage === value ? 'dim' : '' }, value)),
      ),
      !item.history ? h('div', { class: 'progress' }, h('span', { style: { width: pct(item.progress * 100) } })) : null,
    ),
    itemActions(item, adapter, ctx),
  );
}

function itemHex(item, adapter, ctx) {
  return posterHexCard({
    gradient: GRADIENT[adapter.type], title: item.name,
    pills: [{ label: item.stateLabel, cls: item.stateClass }, item.category ? { label: item.category, cls: 'muted' } : null],
    sub: itemMeta(item, adapter).join(' · '),
    progress: item.history ? undefined : item.progress * 100,
    actions: itemActions(item, adapter, ctx, true),
  });
}

function openRemoveModal(item, adapter, ctx) {
  const deleteData = h('input', { type: 'checkbox' });
  const confirm = async () => {
    try {
      await adapter.remove(item, { deleteData: adapter.capabilities.deleteData && deleteData.checked });
      toast(adapter.capabilities.deleteData && deleteData.checked ? 'Removed job and downloaded data' : 'Removed job', 'success');
      closeModal(); ctx.reload();
    } catch (error) { toast(error.message, 'error'); }
  };
  openModal({
    title: item.history ? 'Delete history entry' : 'Remove download',
    body: h('div', {},
      h('p', { style: { margin: '0 0 12px', lineHeight: '1.5' } }, `${item.history ? 'Delete' : 'Remove'} “${item.name}”?`),
      adapter.capabilities.deleteData && !item.history
        ? h('label', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, deleteData, 'Also delete downloaded files from disk')
        : null,
    ),
    footer: h('div', { style: { display: 'flex', gap: '10px', justifyContent: 'flex-end', width: '100%' } },
      h('button', { class: 'btn', onclick: closeModal }, 'Cancel'),
      h('button', { class: 'btn primary danger', onclick: confirm }, 'Remove'),
    ),
  });
}

function openSpeedModal(adapter, ctx, session) {
  const toKiB = (bytes) => Number(bytes) > 0 ? Math.round(Number(bytes) / 1024) : 0;
  const download = h('input', { class: 'input', type: 'number', min: '0', value: String(toKiB(session.dlLimit)) });
  const upload = h('input', { class: 'input', type: 'number', min: '0', value: String(toKiB(session.upLimit)) });
  const apply = async () => {
    try {
      await adapter.setSpeed({ downloadKiB: Number(download.value) || 0, uploadKiB: Number(upload.value) || 0 });
      toast('Speed limits updated', 'success'); closeModal(); ctx.reload();
    } catch (error) { toast(error.message, 'error'); }
  };
  openModal({
    title: 'Global speed limits',
    body: h('div', {}, speedField('Download limit (KiB/s)', download), adapter.capabilities.upload ? speedField('Upload limit (KiB/s)', upload) : null),
    footer: h('div', { style: { display: 'flex', gap: '10px', justifyContent: 'flex-end', width: '100%' } },
      h('button', { class: 'btn', onclick: closeModal }, 'Cancel'), h('button', { class: 'btn primary', onclick: apply }, 'Apply')),
  });
}

function speedField(label, control) {
  return h('div', { style: { marginBottom: '12px' } }, h('div', { class: 'section-title', style: { margin: '0 0 6px' } }, label), control, h('div', { class: 'dim', style: { fontSize: '11px', marginTop: '4px' } }, '0 = unlimited'));
}

function categoryIcon(category, protocol) {
  const value = String(category || '').toLowerCase();
  if (value.includes('tv')) return '📺';
  if (value.includes('movie')) return '🎬';
  if (value.includes('music')) return '🎵';
  if (value.includes('book')) return '📚';
  return protocol === 'torrent' ? '🧲' : '⬇';
}
