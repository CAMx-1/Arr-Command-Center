import { h, mount, tabs, skeletonList, empty, poster, pct, fmtRelative, autoRefresh } from '../lib/ui.js';
import { hive, posterHexCard } from '../lib/hive.js';
import { viewToggle, effectiveMode } from '../lib/viewMode.js';
import { mediaServerFor } from '../lib/mediaServers.js';

export async function renderMediaServer(root, ctx) {
  const svc = ctx.service;
  ctx.setActions(viewToggle(svc.key, ctx.reload));
  if (!svc.configured) return mount(root, empty('▶', `${svc.label} isn’t configured`, 'Add the server URL and API key in Settings.'));
  const media = mediaServerFor(ctx.api, svc);
  const body = h('div', {});
  const bar = tabs(body, [
    { id: 'libraries', label: 'Libraries', render: (node) => librariesTab(node, media, ctx) },
    { id: 'latest', label: 'Recently Added', render: (node) => latestTab(node, media, ctx) },
    { id: 'sessions', label: 'Now Playing', render: (node) => sessionsTab(node, media, ctx) },
    { id: 'users', label: 'Users', render: (node) => usersTab(node, media, ctx) },
  ], `tabs-${svc.key}`);
  mount(root, bar, body);
}

async function librariesTab(root, media, ctx) {
  mount(root, skeletonList());
  try {
    const libraries = await media.libraries();
    if (!libraries.length) return mount(root, empty('📚', 'No libraries found'));
    mount(root, h('div', { class: 'list' }, ...libraries.map((library) => h('button', {
      class: 'row clickable', style: { width: '100%', textAlign: 'left', border: '0' }, onclick: () => browseLibrary(root, media, ctx, library),
    }, h('div', { class: 'poster', style: { width: '40px', height: '40px', fontSize: '18px' } }, libraryIcon(library.type)), h('div', { class: 'row-main' },
      h('div', { class: 'row-title' }, library.name), h('div', { class: 'meta-line' }, h('span', { class: 'pill muted' }, library.type || 'media'), h('span', { class: 'dim' }, `${library.locations.length} location${library.locations.length === 1 ? '' : 's'}`)),
    )))));
  } catch (error) { mount(root, empty('⚠️', 'Failed to load libraries', error.message)); }
}

async function browseLibrary(root, media, ctx, library) {
  mount(root, skeletonList());
  try {
    const items = await media.items(library.id);
    const back = h('button', { class: 'btn sm', onclick: () => librariesTab(root, media, ctx) }, '← Libraries');
    mount(root, h('div', { style: { marginBottom: '12px' } }, back), h('div', { class: 'section-title' }, `${library.name} · ${items.length}`), mediaItems(items, ctx.service.key, root));
  } catch (error) { mount(root, empty('⚠️', `Failed to browse ${library.name}`, error.message)); }
}

async function latestTab(root, media, ctx) {
  mount(root, skeletonList());
  try {
    const items = await media.latest();
    if (!items.length) return mount(root, empty('🎞️', 'Nothing recently added'));
    mount(root, mediaItems(items, ctx.service.key, root));
  } catch (error) { mount(root, empty('⚠️', 'Failed to load recent media', error.message)); }
}

function mediaItems(items, serviceKey, root) {
  if (effectiveMode(serviceKey) === 'hex') return hive(items.map((item) => posterHexCard({
    posterUrl: item.image, gradient: 'linear-gradient(160deg,#4b5563,#111827)', title: item.seriesName ? `${item.seriesName} — ${item.name}` : item.name,
    pills: [{ label: item.type || 'Media', cls: 'muted' }], sub: [item.year, item.runtimeMinutes ? `${item.runtimeMinutes} min` : ''].filter(Boolean).join(' · '),
  })), root.clientWidth);
  return h('div', { class: 'list' }, ...items.map((item) => h('div', { class: 'row' },
    item.image ? poster(item.image, libraryIcon(item.type)) : h('div', { class: 'poster' }, libraryIcon(item.type)),
    h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, item.seriesName ? `${item.seriesName} — ${item.name}` : item.name),
      h('div', { class: 'meta-line' }, h('span', { class: 'pill muted' }, item.type || 'Media'), item.year ? h('span', {}, item.year) : null, item.runtimeMinutes ? h('span', {}, `${item.runtimeMinutes} min`) : null, item.communityRating ? h('span', {}, `★ ${Number(item.communityRating).toFixed(1)}`) : null)),
  )));
}

async function sessionsTab(root, media, ctx) {
  const wrap = h('div', {}); mount(root, wrap);
  const load = async (silent = false) => {
    if (!silent) mount(wrap, skeletonList());
    try {
      const sessions = await media.sessions();
      const header = h('div', { class: 'section-title' }, `${sessions.length} active stream${sessions.length === 1 ? '' : 's'}`);
      if (!sessions.length) return mount(wrap, header, empty('▶', 'Nothing playing', 'No active sessions.'));
      mount(wrap, header, h('div', { class: 'list' }, ...sessions.map((session) => h('div', { class: 'row' },
        session.image ? poster(session.image, '▶') : h('div', { class: 'poster' }, '▶'),
        h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, session.title), h('div', { class: 'meta-line' },
          h('span', { class: `pill ${session.state === 'playing' ? 'ok' : 'warn'}` }, session.state), h('span', {}, session.user), h('span', {}, session.client || session.device),
          h('span', { class: `pill ${session.transcode ? 'warn' : 'ok'}` }, session.transcode ? 'Transcode' : 'Direct Play'), session.videoCodec ? h('span', {}, session.videoCodec) : null),
          h('div', { class: 'progress' }, h('span', { style: { width: pct(session.progress) } }))),
      ))));
    } catch (error) { if (!silent) mount(wrap, empty('⚠️', 'Failed to load sessions', error.message)); }
  };
  await load(); autoRefresh(wrap, 5000, () => load(true));
}

async function usersTab(root, media) {
  mount(root, skeletonList());
  try {
    const users = await media.users();
    if (!users.length) return mount(root, empty('👤', 'No users found'));
    mount(root, h('div', { class: 'list' }, ...users.map((user) => h('div', { class: 'row' },
      user.image ? poster(user.image, '👤') : h('div', { class: 'poster' }, (user.name || '?')[0]),
      h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, user.name), h('div', { class: 'meta-line' }, user.admin ? h('span', { class: 'pill ok' }, 'Admin') : null, user.disabled ? h('span', { class: 'pill warn' }, 'Disabled') : null, user.lastLogin ? h('span', { class: 'dim' }, `Last login ${fmtRelative(new Date(user.lastLogin).getTime())}`) : null)),
    ))));
  } catch (error) { mount(root, empty('⚠️', 'Failed to load users', error.message)); }
}

function libraryIcon(type) {
  const value = String(type || '').toLowerCase();
  if (value.includes('movie')) return '🎬';
  if (value.includes('tv') || value.includes('show') || value === 'series' || value === 'episode') return '📺';
  if (value.includes('music')) return '🎵';
  if (value.includes('book')) return '📚';
  return '▶';
}
