// Views for Portainer, Glances, Pi-hole, AdGuard Home, Syncthing, Navidrome
// and Pulsarr. Data access lives in lib/integrations.js.
import { h, mount, tabs, skeletonList, empty, toast, fmtBytes, fmtRelative, pct, poster, confirmModal, openModal, closeModal } from '../lib/ui.js';
import { statCard } from './downloadClient.js';
import { liveRefresh } from '../lib/live.js';
import {
  portainerClient, glancesClient, piholeClient, adguardClient, syncthingClient, navidromeClient, pulsarrClient, PULSARR_STATUS,
  truenasClient, unraidClient,
} from '../lib/integrations.js';
import { currentRole } from '../lib/usersRoles.js';

const statRow = (...cards) => h('div', { class: 'honeycomb' }, h('div', { class: 'hc-row' }, ...cards.filter(Boolean)));
const section = (label) => h('div', { class: 'section-title' }, label);
const failed = (root, what, err, retry) => mount(root, empty('⚠️', `Failed to load ${what}`, err.message, retry ? { label: 'Retry', onClick: retry } : undefined));
const isAdmin = (ctx) => currentRole(ctx.state && ctx.state.config) === 'admin';
const bar = (p, cls = '') => h('div', { class: `progress ${cls}` }, h('span', { style: { width: pct(p) } }));
const level = (p) => (p >= 90 ? 'down' : p >= 75 ? 'warn' : 'ok');
const fmtNum = (n) => Number(n || 0).toLocaleString();

function tabLoader(root, what, render, refreshMs = 0) {
  const wrap = h('div', {});
  mount(root, wrap);
  const load = async (silent = false) => {
    if (!silent) mount(wrap, skeletonList());
    try { await render(wrap, () => load(true)); }
    catch (err) { if (!silent) failed(wrap, what, err, () => load(false)); }
  };
  load(false);
  if (refreshMs) liveRefresh(wrap, null, refreshMs, () => load(true));
}

function mountTabs(root, ctx, defs) {
  const body = h('div', {});
  const t = tabs(body, defs, `tabs-${ctx.service.key}`, {
    activeId: ctx.params.tab,
    onChange: (id) => ctx.setParams({ tab: id === defs[0].id ? '' : id }),
  });
  mount(root, t, body);
}

// ==================================================================== Portainer
export async function renderPortainer(root, ctx) {
  const client = portainerClient(ctx.api, ctx.service.key);
  ctx.setActions(isAdmin(ctx) ? null : h('span', { class: 'pill muted', title: 'Only admins can start, stop or restart containers' }, 'View only'));
  mountTabs(root, ctx, [
    { id: 'containers', label: 'Containers', render: (c) => portainerContainers(c, client, ctx) },
    { id: 'environments', label: 'Environments', render: (c) => portainerEnvironments(c, client) },
  ]);
}

function portainerEnvironments(root, client) {
  tabLoader(root, 'environments', async (wrap) => {
    const envs = await client.environments();
    if (!envs.length) return mount(wrap, empty('', 'No environments', 'Add an environment in Portainer first.'));
    mount(wrap, h('div', { class: 'list' }, ...envs.map((e) => h('div', { class: 'row' },
      h('div', { class: 'row-main' },
        h('div', { class: 'row-title' }, e.name),
        h('div', { class: 'meta-line' },
          h('span', { class: `pill ${e.up ? 'ok' : 'down'}` }, e.up ? 'Up' : 'Down'),
          h('span', {}, `${e.type}${e.docker ? ` ${e.docker}` : ''}`),
          h('span', {}, `${e.running} running · ${e.stopped} stopped`),
          e.unhealthy ? h('span', { class: 'pill down' }, `${e.unhealthy} unhealthy`) : null,
          h('span', { class: 'dim' }, `${e.stacks} stacks · ${e.images} images · ${e.volumes} volumes`),
          e.cpus ? h('span', { class: 'dim' }, `${e.cpus} CPU · ${fmtBytes(e.memory)}`) : null,
        ))))));
  }, 30000);
}

// The ACC server itself may run as one of these containers; stopping it
// would cut off this page, so say so in the confirmation.
const CONTAINER_ACTIONS = {
  start: { label: 'Start', done: 'started', cls: 'primary' },
  restart: { label: 'Restart', done: 'restarted', cls: '' },
  stop: { label: 'Stop', done: 'stopped', cls: 'danger' },
};
function containerActions(c, envId, client, reload) {
  const running = c.state === 'running' || c.state === 'restarting';
  const acts = running ? ['restart', 'stop'] : ['start'];
  const logsBtn = h('button', { class: 'btn sm', onclick: () => openLogs(c, envId, client) }, 'Logs');
  return h('div', { class: 'row-actions' }, logsBtn, ...acts.map((a) => {
    const info = CONTAINER_ACTIONS[a];
    return h('button', { class: `btn sm ${info.cls} confirm-btn`, onclick: () => confirmModal({
      title: `${info.label} ${c.name}?`,
      message: a === 'start' ? `Start the ${c.name} container.` : `${info.label} the ${c.name} container${c.stack ? ` (stack ${c.stack})` : ''}. Anything using it will be interrupted${a === 'stop' ? ' until it is started again' : ' briefly'}. If Arr Command Center runs in this container, this page will lose its connection.`,
      confirmLabel: info.label, danger: a !== 'start',
      onConfirm: async () => {
        try { await client.containerAction(envId, c.id, a); toast(`${c.name} ${info.done}`, 'success'); reload(); }
        catch (e) { toast(e.message, 'error'); }
      },
    }) }, info.label);
  }));
}

function openLogs(c, envId, client) {
  const pre = h('pre', { class: 'mono', style: { maxHeight: '60vh', overflow: 'auto', fontSize: '12px', whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0 } }, 'Loading…');
  const load = async () => {
    pre.textContent = 'Loading…';
    try {
      const lines = await client.logs(envId, c.id, 300);
      mount(pre, ...(lines.length ? lines.map((l) => h('div', { style: l.stream === 'stderr' ? { color: 'var(--amber, #d97706)' } : {} }, l.text)) : [h('span', { class: 'dim' }, 'No log output.')]));
      pre.scrollTop = pre.scrollHeight;
    } catch (e) { pre.textContent = `Couldn’t load logs: ${e.message}`; }
  };
  openModal({ title: `${c.name} logs`, wide: true, body: h('div', {}, h('p', { class: 'dim', style: { fontSize: '12px', margin: '0 0 8px' } }, 'Last 300 lines. Errors (stderr) are highlighted.'), pre),
    footer: h('div', { style: { display: 'flex', gap: '8px', justifyContent: 'flex-end', width: '100%' } }, h('button', { class: 'btn', onclick: load }, 'Refresh'), h('button', { class: 'btn', onclick: closeModal }, 'Close')) });
  load();
}

function portainerContainers(root, client, ctx) {
  let envId = ctx.params.env || '';
  let filter = ctx.params.state || 'all';
  const admin = isAdmin(ctx);
  tabLoader(root, 'containers', async (wrap, reload) => {
    const envs = await client.environments();
    if (!envs.length) return mount(wrap, empty('', 'No environments', 'Add an environment in Portainer first.'));
    if (!envs.some((e) => String(e.id) === String(envId))) envId = String((envs.find((e) => e.up) || envs[0]).id);
    const all = await client.containers(envId);
    const counts = { running: all.filter((c) => c.state === 'running').length, stopped: all.filter((c) => c.state !== 'running').length, unhealthy: all.filter((c) => c.health === 'unhealthy').length };
    const shown = all.filter((c) => filter === 'all' || (filter === 'running' ? c.state === 'running' : filter === 'unhealthy' ? c.health === 'unhealthy' : c.state !== 'running'));
    const envSel = envs.length > 1 ? h('select', { class: 'input', style: { width: 'auto' }, 'aria-label': 'Environment', onchange: (e) => { envId = e.target.value; ctx.setParams({ env: envId }); portainerContainers(root, client, ctx); } },
      ...envs.map((e) => h('option', { value: String(e.id), selected: String(e.id) === String(envId) ? 'selected' : null }, e.name))) : null;
    const stateSel = h('select', { class: 'input', style: { width: 'auto' }, 'aria-label': 'Show', onchange: (e) => { filter = e.target.value; ctx.setParams({ state: filter === 'all' ? '' : filter }); portainerContainers(root, client, ctx); } },
      ...[['all', 'All'], ['running', 'Running'], ['stopped', 'Stopped'], ['unhealthy', 'Unhealthy']].map(([v, l]) => h('option', { value: v, selected: v === filter ? 'selected' : null }, l)));
    let lastStack = null;
    const rows = [];
    for (const c of shown) {
      if (c.stack !== lastStack) { rows.push(h('div', { class: 'up-day dashboard-feed-day' }, c.stack || 'Standalone')); lastStack = c.stack; }
      rows.push(h('div', { class: 'row' },
        h('div', { class: 'row-main' },
          h('div', { class: 'row-title', style: { fontSize: '14px' } }, c.name),
          h('div', { class: 'meta-line' },
            h('span', { class: `pill ${c.state === 'running' ? (c.health === 'unhealthy' ? 'down' : 'ok') : c.state === 'restarting' ? 'warn' : 'muted'}` }, c.health === 'unhealthy' ? 'unhealthy' : c.state),
            h('span', { class: 'dim' }, c.status),
            h('span', { class: 'dim', style: { wordBreak: 'break-all' } }, c.image),
            ...c.ports.slice(0, 3).map((p) => h('span', { class: 'pill muted' }, p)))),
        admin ? containerActions(c, envId, client, reload) : null));
    }
    mount(wrap,
      statRow(statCard('Running', String(counts.running), 'ok'), statCard('Stopped', String(counts.stopped)), statCard('Unhealthy', String(counts.unhealthy), counts.unhealthy ? 'warn' : null), statCard('Total', String(all.length))),
      h('div', { class: 'meta-line', style: { margin: '10px 0' } }, envSel, stateSel),
      shown.length ? h('div', { class: 'list' }, ...rows) : empty('', 'No containers', 'Nothing matches this filter.'));
  }, 15000);
}

// ====================================================================== Glances
export async function renderGlances(root, ctx) {
  const client = glancesClient(ctx.api, ctx.service.key);
  ctx.setActions();
  mountTabs(root, ctx, [
    { id: 'overview', label: 'Overview', render: (c) => glancesOverview(c, client) },
    { id: 'sensors', label: 'Temperatures', render: (c) => glancesSensors(c, client) },
    { id: 'containers', label: 'Containers', render: (c) => glancesContainers(c, client) },
  ]);
}

const tempLabel = (t) => (t ? `${Math.round(t.value)}${t.unit === 'C' ? '°C' : t.unit}` : '—');

function glancesOverview(root, client) {
  tabLoader(root, 'Glances', async (wrap) => {
    const g = await client.overview();
    mount(wrap,
      statRow(
        statCard('CPU', `${Math.round(g.cpu)}%`, g.cpu > 85 ? 'warn' : 'info'),
        statCard('Memory', `${Math.round(g.mem)}%`, g.mem > 85 ? 'warn' : 'info'),
        g.cpuTemp ? statCard('CPU temp', tempLabel(g.cpuTemp), g.cpuTemp.critical && g.cpuTemp.value >= g.cpuTemp.critical ? 'warn' : 'ok') : statCard('Swap', `${Math.round(g.swap)}%`),
        g.load ? statCard('Load (1m)', g.load[0].toFixed(2), g.cores && g.load[0] > g.cores ? 'warn' : null) : null),
      h('div', { class: 'meta-line', style: { margin: '6px 0 12px' } },
        g.host ? h('span', {}, g.host) : null, g.os ? h('span', { class: 'dim' }, g.os) : null,
        g.uptime ? h('span', { class: 'dim' }, `up ${g.uptime}`) : null, g.cpuName ? h('span', { class: 'dim' }, g.cpuName) : null),
      section('Disks'),
      g.disks.length ? h('div', { class: 'list' }, ...g.disks.map((d) => h('div', { class: 'row' },
        h('div', { class: 'row-main' },
          h('div', { class: 'row-title', style: { fontSize: '14px' } }, d.mount),
          h('div', { class: 'meta-line' }, h('span', {}, `${fmtBytes(d.size - d.used)} free of ${fmtBytes(d.size)}`), h('span', { class: `pill ${level(d.percent)}` }, `${Math.round(d.percent)}%`), h('span', { class: 'dim' }, `${d.device} · ${d.type}`)),
          bar(d.percent))))) : h('div', { class: 'dim' }, 'No disks reported.'));
  }, 5000);
}

function glancesSensors(root, client) {
  tabLoader(root, 'temperatures', async (wrap) => {
    const g = await client.overview();
    if (!g.temps.length) return mount(wrap, empty('', 'No temperature sensors', 'Glances reports none (on Docker, run with --privileged or mount /sys).'));
    mount(wrap, h('div', { class: 'list' }, ...g.temps.map((t) => {
      const hot = t.critical && t.value >= t.critical ? 'down' : t.warning && t.value >= t.warning ? 'warn' : 'ok';
      return h('div', { class: 'row' }, h('div', { class: 'row-main' }, h('div', { class: 'row-title', style: { fontSize: '14px' } }, t.label)), h('span', { class: `pill ${hot}` }, tempLabel(t)));
    })));
  }, 5000);
}

function glancesContainers(root, client) {
  tabLoader(root, 'containers', async (wrap) => {
    const g = await client.overview();
    if (!g.containers.length) return mount(wrap, empty('', 'No containers', 'Glances sees no Docker or Podman containers.'));
    mount(wrap, h('div', { class: 'list' }, ...g.containers.sort((a, b) => b.cpu - a.cpu).map((c) => h('div', { class: 'row' },
      h('div', { class: 'row-main' },
        h('div', { class: 'row-title', style: { fontSize: '14px' } }, c.name),
        h('div', { class: 'meta-line' }, h('span', { class: `pill ${/running/i.test(c.status) ? 'ok' : 'muted'}` }, c.status || 'unknown'), h('span', {}, `CPU ${c.cpu.toFixed(1)}%`), h('span', {}, `RAM ${fmtBytes(c.memory)}`)))))));
  }, 5000);
}

// ====================================================================== Pi-hole
const PAUSES = [[0, 'Turn off'], [30, '30 seconds'], [300, '5 minutes'], [1800, '30 minutes'], [3600, '1 hour']];

function blockingControls(ctx, on, setter, reload, what) {
  if (!isAdmin(ctx)) return null;
  if (!on) return h('button', { class: 'btn sm primary', onclick: async () => { try { await setter(true); toast(`${what} turned on`, 'success'); reload(); } catch (e) { toast(e.message, 'error'); } } }, `Turn ${what.toLowerCase()} on`);
  const sel = h('select', { class: 'input', style: { width: 'auto' }, 'aria-label': `Pause ${what.toLowerCase()} for` }, ...PAUSES.map(([s, l]) => h('option', { value: String(s) }, s ? `Pause for ${l}` : l)));
  return h('span', { class: 'meta-line' }, sel, h('button', { class: 'btn sm danger', onclick: () => confirmModal({
    title: `Pause ${what.toLowerCase()}`, message: 'Ads and trackers will not be blocked on your network while this is off.', confirmLabel: 'Pause', danger: true,
    onConfirm: async () => { try { await setter(false, Number(sel.value) || null); toast(`${what} paused`, 'success'); reload(); } catch (e) { toast(e.message, 'error'); } },
  }) }, 'Apply'));
}

const topList = (title, items, unit = 'queries') => h('div', {}, section(title), items.length
  ? h('div', { class: 'list' }, ...items.map((d) => h('div', { class: 'row' }, h('div', { class: 'row-main' }, h('div', { class: 'row-title', style: { fontSize: '13px', wordBreak: 'break-all' } }, d.name || d.domain)), h('span', { class: 'pill muted' }, `${fmtNum(d.count)} ${unit}`))))
  : h('div', { class: 'dim' }, 'Nothing yet.'));

export async function renderPihole(root, ctx) {
  const client = piholeClient(ctx.api, ctx.service.key);
  ctx.setActions();
  tabLoader(root, 'Pi-hole', async (wrap, reload) => {
    const [s, blocked, clients] = await Promise.all([client.summary(), client.topBlocked().catch(() => []), client.topClients().catch(() => [])]);
    const on = s.blocking === 'enabled';
    mount(wrap,
      statRow(statCard('Queries today', fmtNum(s.total), 'info'), statCard('Blocked', fmtNum(s.blocked), 'warn'), statCard('Blocked %', `${s.percent.toFixed(1)}%`), statCard('Domains on lists', fmtNum(s.domains))),
      h('div', { class: 'meta-line', style: { margin: '10px 0' } },
        h('span', { class: `pill ${on ? 'ok' : 'down'}` }, on ? 'Blocking on' : s.blocking === 'disabled' ? 'Blocking off' : `Blocking ${s.blocking}`),
        !on && s.timer ? h('span', { class: 'dim' }, `back on in ${Math.ceil(s.timer / 60)} min`) : null,
        h('span', { class: 'dim' }, `${fmtNum(s.clients)} active clients`),
        blockingControls(ctx, on, (en, secs) => client.setBlocking(en, secs), reload, 'Blocking')),
      topList('Top blocked domains', blocked.map((d) => ({ name: d.domain, count: d.count }))),
      topList('Top clients', clients));
  }, 10000);
}

// ================================================================= AdGuard Home
export async function renderAdguard(root, ctx) {
  const client = adguardClient(ctx.api, ctx.service.key);
  ctx.setActions();
  tabLoader(root, 'AdGuard Home', async (wrap, reload) => {
    const a = await client.overview();
    mount(wrap,
      statRow(statCard('Queries', fmtNum(a.total), 'info'), statCard('Blocked', fmtNum(a.blocked), 'warn'), statCard('Blocked %', `${a.percent}%`), statCard('Avg time', `${a.avgMs} ms`)),
      h('div', { class: 'meta-line', style: { margin: '10px 0' } },
        h('span', { class: `pill ${a.protection ? 'ok' : 'down'}` }, a.protection ? 'Protection on' : 'Protection off'),
        a.disabledUntil ? h('span', { class: 'dim' }, `back on ${fmtRelative(a.disabledUntil)}`) : null,
        a.version ? h('span', { class: 'dim' }, a.version) : null,
        blockingControls(ctx, a.protection, (en, secs) => client.setProtection(en, secs ? secs * 1000 : 0), reload, 'Protection')),
      topList('Top blocked domains', a.topBlocked),
      topList('Top clients', a.topClients));
  }, 10000);
}

// ==================================================================== Syncthing
export async function renderSyncthing(root, ctx) {
  const client = syncthingClient(ctx.api, ctx.service.key);
  ctx.setActions();
  mountTabs(root, ctx, [
    { id: 'folders', label: 'Folders', render: (c) => syncFolders(c, client, ctx) },
    { id: 'devices', label: 'Devices', render: (c) => syncDevices(c, client) },
  ]);
}

const SYNC_STATE = { idle: ['Up to date', 'ok'], syncing: ['Syncing', 'info'], 'sync-preparing': ['Preparing', 'info'], scanning: ['Scanning', 'info'], 'scan-waiting': ['Waiting to scan', 'muted'], 'sync-waiting': ['Waiting to sync', 'muted'], error: ['Error', 'down'], paused: ['Paused', 'muted'] };

function syncFolders(root, client, ctx) {
  tabLoader(root, 'folders', async (wrap, reload) => {
    const o = await client.overview();
    const outOfSync = o.folders.filter((f) => f.needBytes > 0 || f.state === 'error').length;
    mount(wrap,
      statRow(statCard('Folders', String(o.folders.length)), statCard('Out of sync', String(outOfSync), outOfSync ? 'warn' : 'ok'), statCard('Devices online', `${o.devices.filter((d) => d.connected).length}/${o.devices.length}`, 'info'), statCard('Received', fmtBytes(o.inTotal))),
      o.folders.length ? h('div', { class: 'list', style: { marginTop: '10px' } }, ...o.folders.map((f) => {
        const [label, cls] = SYNC_STATE[f.state] || [f.state, 'muted'];
        return h('div', { class: 'row' },
          h('div', { class: 'row-main' },
            h('div', { class: 'row-title', style: { fontSize: '14px' } }, f.label),
            h('div', { class: 'meta-line' },
              h('span', { class: `pill ${cls}` }, label),
              f.needBytes ? h('span', {}, `${fmtBytes(f.needBytes)} / ${fmtNum(f.needFiles)} files to go`) : h('span', { class: 'dim' }, fmtBytes(f.globalBytes)),
              h('span', { class: 'dim' }, `shared with ${f.devices}`), h('span', { class: 'dim', style: { wordBreak: 'break-all' } }, f.path),
              f.error ? h('span', { class: 'dim' }, f.error) : null),
            f.needBytes ? bar(f.percent) : null),
          h('div', { class: 'row-actions' }, h('button', { class: 'btn sm', title: 'Look for changed files now', onclick: async () => { try { await client.rescan(f.id); toast(`Rescanning ${f.label}`, 'success'); reload(); } catch (e) { toast(e.message, 'error'); } } }, 'Rescan')));
      })) : empty('', 'No folders', 'Share a folder in Syncthing first.'));
  }, 10000);
}

function syncDevices(root, client) {
  tabLoader(root, 'devices', async (wrap) => {
    const o = await client.overview();
    if (!o.devices.length) return mount(wrap, empty('', 'No remote devices', 'Add a device in Syncthing first.'));
    mount(wrap, h('div', { class: 'list' }, ...o.devices.map((d) => h('div', { class: 'row' },
      h('div', { class: 'row-main' },
        h('div', { class: 'row-title', style: { fontSize: '14px' } }, d.name),
        h('div', { class: 'meta-line' },
          h('span', { class: `pill ${d.paused ? 'muted' : d.connected ? 'ok' : 'down'}` }, d.paused ? 'Paused' : d.connected ? 'Connected' : 'Disconnected'),
          d.address ? h('span', { class: 'dim' }, d.address) : null, d.client ? h('span', { class: 'dim' }, d.client) : null,
          d.connected ? h('span', { class: 'dim' }, `↓ ${fmtBytes(d.inBytes)} · ↑ ${fmtBytes(d.outBytes)}`) : null))))));
  }, 10000);
}

// ==================================================================== Navidrome
export async function renderNavidrome(root, ctx) {
  const client = navidromeClient(ctx.api, ctx.service.key);
  ctx.setActions();
  tabLoader(root, 'Navidrome', async (wrap, reload) => {
    const n = await client.overview();
    const scanBtn = h('button', { class: 'btn sm', disabled: n.scanning ? 'disabled' : null, onclick: async () => { try { await client.startScan(); toast('Library scan started', 'success'); reload(); } catch (e) { toast(e.message, 'error'); } } }, n.scanning ? 'Scanning…' : 'Scan library');
    mount(wrap,
      statRow(statCard('Songs', fmtNum(n.songs), 'info'), n.artists != null ? statCard('Album artists', fmtNum(n.artists)) : null, statCard('Folders', fmtNum(n.folders)), statCard('Playing now', String(n.playing.length), n.playing.length ? 'ok' : null)),
      h('div', { class: 'meta-line', style: { margin: '10px 0' } }, n.lastScan ? h('span', { class: 'dim' }, `Last scan ${fmtRelative(n.lastScan)}`) : null, n.version ? h('span', { class: 'dim' }, `Navidrome ${n.version}`) : null, scanBtn),
      n.playing.length ? h('div', {}, section('Now playing'), h('div', { class: 'list' }, ...n.playing.map((p) => h('div', { class: 'row' },
        poster(p.cover, '♪'),
        h('div', { class: 'row-main' }, h('div', { class: 'row-title', style: { fontSize: '14px' } }, p.title), h('div', { class: 'meta-line' }, h('span', {}, p.artist), h('span', { class: 'dim' }, p.album), h('span', { class: 'pill info' }, p.user), p.player ? h('span', { class: 'dim' }, p.player) : null)))))) : null,
      section('Recently added'),
      n.newest.length ? h('div', { class: 'list' }, ...n.newest.map((a) => h('div', { class: 'row' },
        poster(a.cover, '💿'),
        h('div', { class: 'row-main' }, h('div', { class: 'row-title', style: { fontSize: '14px' } }, a.name), h('div', { class: 'meta-line' }, h('span', {}, a.artist), a.year ? h('span', { class: 'dim' }, String(a.year)) : null, a.created ? h('span', { class: 'dim' }, fmtRelative(a.created)) : null))))) : h('div', { class: 'dim' }, 'No albums yet.'));
  }, 15000);
}

// ====================================================================== Pulsarr
export async function renderPulsarr(root, ctx) {
  const client = pulsarrClient(ctx.api, ctx.service.key);
  ctx.setActions();
  mountTabs(root, ctx, [
    { id: 'approvals', label: 'Approvals', render: (c) => pulsarrApprovals(c, client, ctx) },
    { id: 'recent', label: 'Recent requests', render: (c) => pulsarrRecent(c, client) },
  ]);
}

function pulsarrApprovals(root, client, ctx) {
  tabLoader(root, 'approvals', async (wrap, reload) => {
    const [stats, pending] = await Promise.all([client.stats().catch(() => ({})), client.approvals('pending')]);
    const admin = isAdmin(ctx);
    const act = (fn, done) => async () => { try { await fn(); toast(done, 'success'); reload(); } catch (e) { toast(e.message, 'error'); } };
    mount(wrap,
      statRow(statCard('Pending', String(stats.pending ?? pending.length), (stats.pending ?? pending.length) ? 'warn' : 'ok'), statCard('Approved', String(stats.approved ?? 0), 'ok'), statCard('Auto-approved', String(stats.auto_approved ?? 0), 'info'), statCard('Rejected', String(stats.rejected ?? 0))),
      pending.length ? h('div', { class: 'list', style: { marginTop: '10px' } }, ...pending.map((r) => h('div', { class: 'row' },
        h('div', { class: 'row-main' },
          h('div', { class: 'row-title', style: { fontSize: '14px' } }, r.contentTitle),
          h('div', { class: 'meta-line' },
            h('span', { class: 'pill muted' }, r.contentType === 'show' ? 'TV' : 'Movie'),
            h('span', {}, r.userName), r.approvalReason ? h('span', { class: 'dim' }, r.approvalReason) : null,
            r.createdAt ? h('span', { class: 'dim' }, fmtRelative(r.createdAt)) : null,
            r.expirationDisplayText ? h('span', { class: 'dim' }, r.expirationDisplayText) : null)),
        admin ? h('div', { class: 'row-actions' },
          h('button', { class: 'btn sm primary', onclick: act(() => client.approve(r.id), `Approved ${r.contentTitle}`) }, 'Approve'),
          h('button', { class: 'btn sm danger', onclick: () => confirmModal({ title: 'Reject request', message: `Reject ${r.contentTitle} for ${r.userName}?`, confirmLabel: 'Reject', danger: true, onConfirm: act(() => client.reject(r.id), 'Rejected') }) }, 'Reject')) : null))) : empty('', 'Nothing waiting', 'No watchlist requests need approval.'));
  }, 30000);
}

function pulsarrRecent(root, client) {
  tabLoader(root, 'recent requests', async (wrap) => {
    const items = await client.recent(30);
    if (!items.length) return mount(wrap, empty('', 'No requests yet', 'Watchlist additions appear here.'));
    mount(wrap, h('div', { class: 'list' }, ...items.map((r) => {
      const [label, cls] = PULSARR_STATUS[r.status] || [r.status, 'muted'];
      return h('div', { class: 'row' },
        h('div', { class: 'row-main' },
          h('div', { class: 'row-title', style: { fontSize: '14px' } }, r.title),
          h('div', { class: 'meta-line' }, h('span', { class: `pill ${cls}` }, label), h('span', { class: 'pill muted' }, r.contentType === 'show' ? 'TV' : 'Movie'), h('span', {}, r.userName), r.createdAt ? h('span', { class: 'dim' }, fmtRelative(r.createdAt)) : null)));
    })));
  }, 30000);
}

// ====================================================================== TrueNAS
const tempPill = (t) => (t == null ? h('span', { class: 'dim' }, '—') : h('span', { class: `pill ${t >= 55 ? 'down' : t >= 45 ? 'warn' : 'ok'}` }, `${t}°C`));
const fmtUptime = (s) => { const d = Math.floor(s / 86400); const hrs = Math.floor((s % 86400) / 3600); return d ? `${d}d ${hrs}h` : `${hrs}h ${Math.floor((s % 3600) / 60)}m`; };

export async function renderTruenas(root, ctx) {
  const client = truenasClient(ctx.service.key);
  ctx.setActions(h('span', { class: 'pill muted', title: 'Arr Command Center only reads from TrueNAS' }, 'Read-only'));
  let cache = null;
  const data = async (fresh) => { if (fresh || !cache) cache = await client.overview(); return cache; };
  mountTabs(root, ctx, [
    { id: 'pools', label: 'Pools', render: (c) => tabLoader(c, 'pools', async (wrap) => truenasPools(wrap, await data(true)), 30000) },
    { id: 'disks', label: 'Disks', render: (c) => tabLoader(c, 'disks', async (wrap) => truenasDisks(wrap, await data(true)), 60000) },
    { id: 'apps', label: 'Apps', render: (c) => tabLoader(c, 'apps', async (wrap) => truenasApps(wrap, await data(true)), 30000) },
    { id: 'alerts', label: 'Alerts', render: (c) => tabLoader(c, 'alerts', async (wrap) => truenasAlerts(wrap, await data(true)), 60000) },
  ]);
}

function truenasPools(wrap, d) {
  const unhealthy = d.pools.filter((p) => !p.healthy || p.status !== 'ONLINE').length;
  mount(wrap,
    statRow(statCard('Pools', String(d.pools.length)), statCard('Unhealthy', String(unhealthy), unhealthy ? 'warn' : 'ok'), statCard('Alerts', String(d.alerts.length), d.alerts.length ? 'warn' : null), statCard('Uptime', fmtUptime(d.uptimeSeconds))),
    h('div', { class: 'meta-line', style: { margin: '6px 0 12px' } }, d.hostname ? h('span', {}, d.hostname) : null, d.version ? h('span', { class: 'dim' }, d.version) : null, d.load ? h('span', { class: 'dim' }, `load ${d.load.map((x) => x.toFixed(2)).join(' ')}`) : null),
    d.pools.length ? h('div', { class: 'list' }, ...d.pools.map((p) => h('div', { class: 'row' },
      h('div', { class: 'row-main' },
        h('div', { class: 'row-title', style: { fontSize: '14px' } }, p.name),
        h('div', { class: 'meta-line' },
          h('span', { class: `pill ${p.healthy && p.status === 'ONLINE' ? 'ok' : 'down'}` }, p.status),
          h('span', {}, `${fmtBytes(p.free)} free of ${fmtBytes(p.size)}`), h('span', { class: `pill ${level(p.percent)}` }, `${Math.round(p.percent)}%`),
          p.scan && p.scan.state === 'SCANNING' ? h('span', { class: 'pill info' }, `${p.scan.kind.toLowerCase()} ${Math.floor(p.scan.percent)}%`) : null,
          p.scan && p.scan.errors ? h('span', { class: 'pill down' }, `${p.scan.errors} scan errors`) : null),
        bar(p.percent))))) : empty('', 'No pools', 'Create a pool in TrueNAS first.'));
}

function truenasDisks(wrap, d) {
  mount(wrap, d.disks.length ? h('div', { class: 'list' }, ...d.disks.map((x) => h('div', { class: 'row' },
    h('div', { class: 'row-main' },
      h('div', { class: 'row-title', style: { fontSize: '14px' } }, x.name, x.pool ? h('span', { class: 'pill muted', style: { marginLeft: '8px' } }, x.pool) : null),
      h('div', { class: 'meta-line' }, h('span', {}, fmtBytes(x.size)), h('span', { class: 'dim' }, x.model), x.type ? h('span', { class: 'dim' }, x.type) : null, h('span', { class: 'dim' }, x.serial))),
    tempPill(x.temp)))) : empty('', 'No disks', 'TrueNAS reported no disks.'));
}

function truenasApps(wrap, d) {
  if (!d.apps.length) return mount(wrap, empty('', 'No apps', 'Install apps in TrueNAS to see them here.'));
  const running = d.apps.filter((a) => a.state === 'RUNNING').length;
  mount(wrap,
    statRow(statCard('Running', String(running), 'ok'), statCard('Stopped', String(d.apps.length - running)), statCard('Updates', String(d.apps.filter((a) => a.upgrade).length), 'info')),
    h('div', { class: 'list', style: { marginTop: '10px' } }, ...d.apps.map((a) => h('div', { class: 'row' },
      h('div', { class: 'row-main' },
        h('div', { class: 'row-title', style: { fontSize: '14px' } }, a.name),
        h('div', { class: 'meta-line' }, h('span', { class: `pill ${a.state === 'RUNNING' ? 'ok' : a.state === 'DEPLOYING' ? 'info' : a.state === 'CRASHED' ? 'down' : 'muted'}` }, a.state.toLowerCase()), a.version ? h('span', { class: 'dim' }, a.version) : null, a.upgrade ? h('span', { class: 'pill info' }, 'update available') : null))))));
}

function truenasAlerts(wrap, d) {
  if (!d.alerts.length) return mount(wrap, empty('', 'No alerts', 'TrueNAS has nothing to report.'));
  mount(wrap, h('div', { class: 'list' }, ...d.alerts.map((a) => h('div', { class: 'row' },
    h('span', { class: `pill ${/CRIT|ERROR|ALERT|EMERG/.test(a.level) ? 'down' : /WARN/.test(a.level) ? 'warn' : 'info'}` }, a.level.toLowerCase()),
    h('div', { class: 'row-main' }, h('div', { style: { fontSize: '13px' } }, a.text))))));
}

// ======================================================================= Unraid
const UNRAID_DISK = { DISK_OK: ['OK', 'ok'], DISK_NP: ['Not installed', 'muted'], DISK_NP_MISSING: ['Missing', 'down'], DISK_INVALID: ['Invalid', 'down'], DISK_WRONG: ['Wrong disk', 'down'], DISK_DSBL: ['Disabled', 'down'], DISK_NP_DSBL: ['Disabled', 'down'], DISK_DSBL_NEW: ['New, disabled', 'warn'], DISK_NEW: ['New', 'info'] };

export async function renderUnraid(root, ctx) {
  const client = unraidClient(ctx.api, ctx.service.key);
  ctx.setActions(h('span', { class: 'pill muted', title: 'Arr Command Center only reads from Unraid' }, 'Read-only'));
  mountTabs(root, ctx, [
    { id: 'array', label: 'Array', render: (c) => tabLoader(c, 'array', async (wrap) => unraidArray(wrap, await client.overview()), 15000) },
    { id: 'docker', label: 'Docker', render: (c) => tabLoader(c, 'containers', async (wrap) => unraidDocker(wrap, await client.overview()), 15000) },
    { id: 'vms', label: 'VMs', render: (c) => tabLoader(c, 'VMs', async (wrap) => unraidVms(wrap, await client.overview()), 30000) },
  ]);
}

function unraidArray(wrap, u) {
  const bad = u.disks.filter((d) => d.status !== 'DISK_OK' && d.status !== 'DISK_NP').length;
  const pc = u.parityCheck;
  const groups = ['parity', 'data', 'cache'].map((role) => [role, u.disks.filter((d) => d.role === role && d.status !== 'DISK_NP')]).filter(([, l]) => l.length);
  mount(wrap,
    statRow(statCard('Array', u.started ? 'Started' : u.state.toLowerCase().replace(/_/g, ' '), u.started ? 'ok' : 'warn'), statCard('Used', `${Math.round(u.percent)}%`, u.percent > 90 ? 'warn' : 'info'), statCard('Disk problems', String(bad), bad ? 'warn' : 'ok'), u.cpu != null ? statCard('CPU', `${Math.round(u.cpu)}%`) : null),
    h('div', { class: 'meta-line', style: { margin: '6px 0 12px' } },
      u.hostname ? h('span', {}, u.hostname) : null, u.version ? h('span', { class: 'dim' }, `Unraid ${u.version}`) : null,
      h('span', { class: 'dim' }, `${fmtBytes(u.total - u.used)} free of ${fmtBytes(u.total)}`),
      pc.running ? h('span', { class: 'pill info' }, `Parity check ${pc.progress}%${pc.paused ? ' (paused)' : ''}`) : pc.date ? h('span', { class: 'dim' }, `Last parity check ${fmtRelative(pc.date)}${pc.errors ? `, ${pc.errors} errors` : ''}`) : null,
      u.alerts.alert || u.alerts.warning ? h('span', { class: 'pill warn' }, `${u.alerts.alert + u.alerts.warning} unread warnings`) : null),
    ...groups.flatMap(([role, list]) => [section(role === 'data' ? 'Data disks' : role === 'parity' ? 'Parity' : 'Cache / pools'), h('div', { class: 'list' }, ...list.map((d) => {
      const [label, cls] = UNRAID_DISK[d.status] || [d.status, 'muted'];
      const p = d.fsSize ? (d.fsUsed / d.fsSize) * 100 : null;
      return h('div', { class: 'row' },
        h('div', { class: 'row-main' },
          h('div', { class: 'row-title', style: { fontSize: '14px' } }, d.name, d.device ? h('span', { class: 'dim', style: { marginLeft: '8px', fontSize: '12px' } }, d.device) : null),
          h('div', { class: 'meta-line' },
            h('span', { class: `pill ${cls}` }, label),
            p != null ? h('span', {}, `${fmtBytes(d.fsSize - d.fsUsed)} free of ${fmtBytes(d.fsSize)}`) : h('span', {}, fmtBytes(d.size)),
            d.errors ? h('span', { class: 'pill down' }, `${d.errors} errors`) : null),
          p != null ? bar(p) : null),
        d.temp == null ? h('span', { class: 'pill muted', title: 'Spun down, or no sensor' }, d.standby ? 'standby' : '—') : tempPill(d.temp));
    }))]));
}

function unraidDocker(wrap, u) {
  if (!u.containers.length) return mount(wrap, empty('', 'No containers', 'Docker is stopped or has no containers.'));
  const running = u.containers.filter((c) => c.state === 'running').length;
  mount(wrap,
    statRow(statCard('Running', String(running), 'ok'), statCard('Stopped', String(u.containers.length - running)), statCard('Updates', String(u.containers.filter((c) => c.update).length), 'info')),
    h('div', { class: 'list', style: { marginTop: '10px' } }, ...u.containers.map((c) => h('div', { class: 'row' },
      h('div', { class: 'row-main' },
        h('div', { class: 'row-title', style: { fontSize: '14px' } }, c.name),
        h('div', { class: 'meta-line' }, h('span', { class: `pill ${c.state === 'running' ? 'ok' : c.state === 'paused' ? 'warn' : 'muted'}` }, c.state), h('span', { class: 'dim' }, c.status), h('span', { class: 'dim', style: { wordBreak: 'break-all' } }, c.image), c.update ? h('span', { class: 'pill info' }, 'update available') : null, c.autoStart ? null : h('span', { class: 'dim' }, 'no autostart')))))));
}

function unraidVms(wrap, u) {
  if (!u.vms.length) return mount(wrap, empty('', 'No VMs', 'VMs are off or none are defined.'));
  mount(wrap, h('div', { class: 'list' }, ...u.vms.map((v) => h('div', { class: 'row' },
    h('div', { class: 'row-main' }, h('div', { class: 'row-title', style: { fontSize: '14px' } }, v.name)),
    h('span', { class: `pill ${v.state === 'running' ? 'ok' : v.state === 'paused' || v.state === 'pmsuspended' ? 'warn' : v.state === 'crashed' ? 'down' : 'muted'}` }, v.state)))));
}
