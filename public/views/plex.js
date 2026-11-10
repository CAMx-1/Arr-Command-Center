import { h, mount, tabs, skeletonList, empty, fmtRelative, timeEl, fmtBytes, copyable } from '../lib/ui.js';
import { markManaged } from '../lib/plexDupes.js';
import { tabWrongMatches } from '../lib/plexMatchesUI.js';
import { tabMissingFromPlex } from '../lib/plexMissingUI.js';
import { tabServer, tabSharing } from '../lib/plexServerUI.js';

export async function renderPlex(root, ctx) {
  const svc = ctx.service;
  ctx.setActions(h('span', { class: 'dim', style: { fontSize: '13px' } }, 'Plex account'));
  const body = h('div', {});
  const bar = tabs(body, [
    { id: 'watchlist', label: 'Watchlist', render: (c) => tabWatchlist(c, ctx) },
    { id: 'duplicates', label: 'Duplicates', render: (c) => tabDuplicates(c, ctx) },
    { id: 'matches', label: 'Wrong matches', render: (c) => tabWrongMatches(c, ctx) },
    { id: 'missing', label: 'Missing from Plex', render: (c) => tabMissingFromPlex(c, ctx) },
    { id: 'server', label: 'Server', render: (c) => tabServer(c, ctx) },
    { id: 'users', label: 'Users', render: (c) => tabUsers(c, ctx) },
    { id: 'friends', label: 'Friends & sharing', render: (c) => tabSharing(c, ctx) },
    { id: 'sessions', label: 'Now Playing', render: (c) => tabSessions(c, ctx) },
  ], `tabs-${svc.key}`, { activeId: ctx.params.tab, onChange: (id) => ctx.setParams({ tab: id === 'watchlist' ? '' : id }) });
  mount(root, bar, body);
}

// Duplicates as Plex sees them on disk — works even when Radarr/Sonarr paths are
// broken, since Plex scans the real filesystem. Shows each file so you can tell
// which copy to remove.
// Every movie file Radarr manages (and series folder Sonarr manages), to mark
// which Plex copy the arr apps track.
async function arrFiles(ctx) {
  const out = [];
  await Promise.all((ctx.state.services || []).filter((s) => s.configured && (s.type === 'radarr' || s.type === 'sonarr')).map(async (svc) => {
    try {
      if (svc.type === 'radarr') {
        for (const m of await ctx.api.arr(svc.key).get('movie')) if (m.movieFile && m.path) out.push({ service: svc, item: m, file: `${m.path}/${m.movieFile.relativePath}` });
      } else {
        // Sonarr: series folders; episode files are matched by folder below.
        for (const s of await ctx.api.arr(svc.key).get('series')) if (s.path) out.push({ service: svc, item: s, folder: s.path });
      }
    } catch { /* skip an instance that errors */ }
  }));
  return out;
}

async function tabDuplicates(root, ctx) {
  mount(root, skeletonList());
  try {
    const [raw, files] = await Promise.all([ctx.api.plex.duplicates(), arrFiles(ctx)]);
    // Episode parts: a series folder anywhere in the path counts as managed.
    const showFolders = files.filter((f) => f.folder).map((f) => ({ ...f, key: f.folder.replace(/\\/g, '/').split('/').filter(Boolean).pop().toLowerCase() }));
    const items = markManaged(raw, files.filter((f) => f.file)).map((it) => {
      if (it.managedService || it.type !== 'episode') return it;
      const parts = it.parts.map((p) => { const segs = p.file.replace(/\\/g, '/').toLowerCase().split('/'); const hit = showFolders.find((f) => segs.includes(f.key)); return hit ? { ...p, where: 'show-folder', managedBy: { service: hit.service, item: hit.item } } : p; });
      return { ...it, parts };
    });
    if (!items.length) return mount(root, empty('', 'No duplicates in Plex', 'Every movie/episode has a single file.'));
    mount(root,
      h('div', { class: 'dim', style: { margin: '0 0 12px', lineHeight: '1.55', fontSize: '13px' } },
        `${items.length} ${items.length === 1 ? 'title has' : 'titles have'} more than one file on disk. Remove the copy you don't want on disk (or via Plex with media deletion enabled).`),
      h('div', { class: 'list' }, ...items.map((it) => h('div', { class: 'row' },
        h('div', { class: 'row-main' },
          h('div', { class: 'row-title' }, it.type === 'episode' && it.show
            ? `${it.show} · S${String(it.season ?? 0).padStart(2, '0')}E${String(it.episode ?? 0).padStart(2, '0')}${it.title ? ` · ${it.title}` : ''}`
            : `${it.title || 'Unknown'}${it.year ? ` (${it.year})` : ''}`,
            h('span', { class: 'pill warn', style: { marginLeft: '8px' } }, `${it.parts.length} files`),
            it.section ? h('span', { class: 'pill muted', style: { marginLeft: '6px' } }, it.section) : null),
          ...it.parts.map((p) => h('div', { class: 'meta-line', style: { marginTop: '4px', wordBreak: 'break-all', display: 'block' } },
            p.where === 'managed' ? h('span', { class: 'pill ok', style: { marginRight: '6px' } }, `${p.managedBy.service.label} manages this`)
              : p.where === 'show-folder' ? h('span', { class: 'pill info', style: { marginRight: '6px' } }, `in a ${p.managedBy.service.label} series folder`)
                : it.managedService ? h('span', { class: 'pill warn', style: { marginRight: '6px' } }, p.where === 'same-folder' ? 'extra file in the same folder' : `not managed by ${it.managedService.label}`) : null,
            copyable(p.file), p.size ? h('span', { class: 'dim', style: { marginLeft: '8px' } }, fmtBytes(p.size)) : null)),
          it.managedService ? h('div', { style: { marginTop: '6px' } }, h('a', { class: 'btn sm', href: `#/${encodeURIComponent(it.managedService.key)}?tab=system&tool=duplicates` }, `Open ${it.managedService.label} duplicate finder`)) : null,
        ),
      ))),
    );
  } catch (err) { needsAuth(root, err); }
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
