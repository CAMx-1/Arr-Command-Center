import { h, mount, tabs, skeletonList, empty, fmtRelative, timeEl } from '../lib/ui.js';

export async function renderPlex(root, ctx) {
  const svc = ctx.service;
  ctx.setActions(h('span', { class: 'dim', style: { fontSize: '13px' } }, 'Plex account'));
  const body = h('div', {});
  const bar = tabs(body, [
    { id: 'watchlist', label: 'Watchlist', render: (c) => tabWatchlist(c, ctx) },
    { id: 'users', label: 'Users', render: (c) => tabUsers(c, ctx) },
    { id: 'friends', label: 'Friends', render: (c) => tabFriends(c, ctx) },
    { id: 'sessions', label: 'Now Playing', render: (c) => tabSessions(c, ctx) },
  ], `tabs-${svc.key}`);
  mount(root, bar, body);
}

function needsAuth(root, err) {
  mount(root, empty('', 'Plex not connected', (err && err.message) || 'Sign in with Plex to enable these features.'));
}

async function tabWatchlist(root, ctx) {
  mount(root, skeletonList());
  try {
    const items = await ctx.api.plex.watchlist();
    if (!items.length) return mount(root, empty('', 'Your watchlist is empty'));
    const seerrSvc = (ctx.state.services || []).find((s) => s.type === 'overseerr');
    mount(root, h('div', { class: 'list' }, ...items.map((m) => h('div', { class: 'row' },
      m.image ? h('img', { class: 'poster', src: m.image, loading: 'lazy', onerror: function () { this.replaceWith(h('div', { class: 'poster' }, m.type === 'show' ? 'TV' : 'MOV')); } }) : h('div', { class: 'poster', style: { width: '40px', height: '40px', fontSize: '16px' } }, m.type === 'show' ? 'TV' : 'MOV'),
      h('div', { class: 'row-main' },
        h('div', { class: 'row-title' }, m.title, h('span', { class: 'dim' }, m.year ? ` (${m.year})` : '')),
        h('div', { class: 'meta-line', style: { marginTop: '4px' } },
          h('span', { class: 'pill muted' }, m.type === 'show' ? 'TV' : 'Movie'),
          m.addedAt ? h('span', {}, 'Added ', timeEl(m.addedAt * 1000)) : null,
        ),
      ),
      seerrSvc ? h('div', { class: 'row-actions' }, h('button', { class: 'btn sm primary', onclick: () => { try { localStorage.setItem(`tabs-${seerrSvc.key}`, 'discover'); } catch { /* ignore */ } location.hash = `#/${seerrSvc.key}`; } }, 'Find in Seerr')) : null,
    ))));
  } catch (err) { needsAuth(root, err); }
}

async function tabUsers(root, ctx) {
  mount(root, skeletonList());
  try {
    const users = await ctx.api.plex.users();
    if (!users.length) return mount(root, empty('', 'No users found'));
    mount(root, h('div', { class: 'list' }, ...users.map((u) => h('div', { class: 'row' },
      h('div', { class: 'poster', style: { width: '40px', height: '40px', fontSize: '16px' } }, (u.title || '?').slice(0, 1).toUpperCase()),
      h('div', { class: 'row-main' },
        h('div', { class: 'row-title' }, u.title),
        h('div', { class: 'meta-line', style: { marginTop: '4px' } },
          u.admin ? h('span', { class: 'pill ok' }, 'Admin') : null,
          u.restricted ? h('span', { class: 'pill warn' }, 'Managed') : null,
          u.email ? h('span', { class: 'dim' }, u.email) : null,
        ),
      ),
    ))));
  } catch (err) { needsAuth(root, err); }
}

async function tabFriends(root, ctx) {
  mount(root, skeletonList());
  try {
    const friends = await ctx.api.plex.friends();
    if (!friends.length) return mount(root, empty('', 'No friends found'));
    mount(root, h('div', { class: 'list' }, ...friends.map((f) => h('div', { class: 'row' },
      f.thumb ? h('img', { class: 'poster', src: f.thumb, loading: 'lazy', onerror: function () { this.replaceWith(h('div', { class: 'poster' }, (f.title || '?').slice(0, 1).toUpperCase())); } }) : h('div', { class: 'poster', style: { width: '40px', height: '40px', fontSize: '16px' } }, (f.title || '?').slice(0, 1).toUpperCase()),
      h('div', { class: 'row-main' },
        h('div', { class: 'row-title' }, f.title),
        h('div', { class: 'meta-line', style: { marginTop: '4px' } },
          f.home ? h('span', { class: 'pill info' }, 'Home') : null,
          f.restricted ? h('span', { class: 'pill warn' }, 'Managed') : null,
          f.username ? h('span', { class: 'dim' }, `@${f.username}`) : null,
          f.email ? h('span', { class: 'dim' }, f.email) : null,
        ),
      ),
    ))));
  } catch (err) { needsAuth(root, err); }
}

async function tabSessions(root, ctx) {
  mount(root, skeletonList());
  try {
    const s = await ctx.api.plex.sessions();
    if (!s.length) return mount(root, empty('', 'Nothing playing', 'Set plex.serverUrl in config.json to see live sessions here (Tautulli also shows streams).'));
    mount(root, h('div', { class: 'list' }, ...s.map((x) => h('div', { class: 'row' },
      x.image ? h('img', { class: 'poster', src: x.image, loading: 'lazy', onerror: function () { this.remove(); } }) : null,
      h('div', { class: 'row-main' },
        h('div', { class: 'row-title' }, x.title),
        h('div', { class: 'meta-line', style: { marginTop: '4px' } },
          h('span', { class: `pill ${x.state === 'playing' ? 'ok' : 'muted'}` }, x.state || 'unknown'),
          x.user ? h('span', {}, x.user) : null,
          x.player ? h('span', {}, x.player) : null,
        ),
        x.progress ? h('div', { class: 'progress' }, h('span', { style: { width: `${x.progress}%` } })) : null,
      ),
    ))));
  } catch (err) { needsAuth(root, err); }
}
