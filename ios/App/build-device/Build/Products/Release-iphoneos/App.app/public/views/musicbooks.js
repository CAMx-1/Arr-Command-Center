import { h, mount, spinner, empty, toast, fmtBytes, fmtRelative, fmtDate, pct, tabs, confirmModal } from '../lib/ui.js';

// Lidarr (music) & Readarr (books) share the *arr v1 API, so one renderer serves
// both with type-specific labels/fields.
const CFG = {
  lidarr: {
    libPath: 'artist', libLabel: 'Artists', nameKey: 'artistName', icon: '🎵',
    stat: (s) => `${(s.statistics && s.statistics.albumCount) || 0} albums · ${(s.statistics && s.statistics.trackFileCount) || 0} tracks · ${fmtBytes((s.statistics && s.statistics.sizeOnDisk) || 0)}`,
    wantedTitle: (r) => `${(r.artist && r.artist.artistName) || ''} — ${r.title}`,
    calTitle: (r) => `${(r.artist && r.artist.artistName) || ''} — ${r.title}`,
    searchCmd: (id) => ({ name: 'AlbumSearch', albumIds: [id] }),
    histTitle: (r) => (r.artist && r.artist.artistName) || r.sourceTitle || 'Album',
  },
  readarr: {
    libPath: 'author', libLabel: 'Authors', nameKey: 'authorName', icon: '📚',
    stat: (s) => `${(s.statistics && s.statistics.bookCount) || 0} books · ${(s.statistics && s.statistics.bookFileCount) || 0} files · ${fmtBytes((s.statistics && s.statistics.sizeOnDisk) || 0)}`,
    wantedTitle: (r) => `${(r.author && r.author.authorName) || ''} — ${r.title}`,
    calTitle: (r) => `${(r.author && r.author.authorName) || ''} — ${r.title}`,
    searchCmd: (id) => ({ name: 'BookSearch', bookIds: [id] }),
    histTitle: (r) => (r.author && r.author.authorName) || r.sourceTitle || 'Book',
  },
};

export function renderLidarr(root, ctx) { return renderMB(root, ctx, 'lidarr'); }
export function renderReadarr(root, ctx) { return renderMB(root, ctx, 'readarr'); }

function renderMB(root, ctx, type) {
  const svc = ctx.service;
  ctx.setActions();
  if (!svc.configured) return mount(root, empty(CFG[type].icon, `${svc.label} isn’t configured`, 'Set the URL and API key in config.json.'));
  const cfg = CFG[type];
  const client = ctx.api.arrV1(svc.key);
  const body = h('div', {});
  const bar = tabs(body, [
    { id: 'library', label: cfg.libLabel, render: (c) => tabLibrary(c, client, cfg) },
    { id: 'wanted', label: 'Wanted', render: (c) => tabWanted(c, client, cfg) },
    { id: 'queue', label: 'Queue', render: (c) => tabQueue(c, client, cfg) },
    { id: 'calendar', label: 'Calendar', render: (c) => tabCalendar(c, client, cfg) },
    { id: 'history', label: 'History', render: (c) => tabHistory(c, client, cfg) },
  ], `tabs-${svc.key}`);
  mount(root, bar, body);
}

async function tabLibrary(root, client, cfg) {
  mount(root, spinner());
  try {
    const items = await client.get(cfg.libPath);
    if (!items || !items.length) return mount(root, empty(cfg.icon, `No ${cfg.libLabel.toLowerCase()}`, 'Nothing in this library yet.'));
    const rows = items.map((it) => h('div', { class: 'row' },
      h('div', { class: 'poster', style: { width: '40px', height: '40px', fontSize: '18px' } }, cfg.icon),
      h('div', { class: 'row-main' },
        h('div', { class: 'row-title' }, it[cfg.nameKey] || 'Unknown'),
        h('div', { class: 'meta-line', style: { marginTop: '4px' } },
          it.monitored ? h('span', { class: 'pill ok' }, 'Monitored') : h('span', { class: 'pill muted' }, 'Unmonitored'),
          h('span', {}, cfg.stat(it)),
        ),
      ),
    ));
    mount(root, h('div', { class: 'section-title' }, `${items.length} ${cfg.libLabel.toLowerCase()}`), h('div', { class: 'list' }, ...rows));
  } catch (e) { mount(root, empty('⚠️', 'Failed to load', e.message)); }
}

async function tabWanted(root, client, cfg) {
  mount(root, spinner());
  try {
    const data = await client.get('wanted/missing?page=1&pageSize=50&sortDirection=descending');
    const recs = data.records || [];
    if (!recs.length) return mount(root, empty('✅', 'Nothing wanted', 'No missing monitored items.'));
    const rows = recs.map((r) => h('div', { class: 'row' },
      h('div', { class: 'row-main' },
        h('div', { class: 'row-title' }, cfg.wantedTitle(r)),
        h('div', { class: 'meta-line', style: { marginTop: '4px' } }, r.releaseDate ? h('span', { class: 'dim' }, `Released ${fmtDate(r.releaseDate)}`) : null),
      ),
      h('div', { class: 'row-actions' },
        h('button', { class: 'btn sm primary', title: 'Search now', onclick: async (e) => {
          const b = e.currentTarget; b.disabled = true; b.textContent = 'Searching…';
          try { await client.post('command', cfg.searchCmd(r.id)); toast('Search triggered', 'success'); b.textContent = 'Searched'; }
          catch (err) { toast(err.message, 'error'); b.disabled = false; b.textContent = 'Search'; }
        } }, 'Search'),
      ),
    ));
    mount(root, h('div', { class: 'section-title' }, `${recs.length} wanted`), h('div', { class: 'list' }, ...rows));
  } catch (e) { mount(root, empty('⚠️', 'Failed to load', e.message)); }
}

async function tabQueue(root, client, cfg) {
  mount(root, spinner());
  try {
    const data = await client.get('queue?page=1&pageSize=50');
    const recs = data.records || [];
    if (!recs.length) return mount(root, empty('📥', 'Queue is empty', 'Nothing downloading.'));
    const rows = recs.map((r) => {
      const s = Number(r.size) || 0; const left = Number(r.sizeleft) || 0; const prog = s > 0 ? ((s - left) / s) * 100 : 0;
      const problem = /warning|stalled|failed|error/i.test(`${r.status} ${r.trackedDownloadStatus} ${r.errorMessage || ''}`);
      return h('div', { class: 'row' },
        h('div', { class: 'row-main' },
          h('div', { class: 'row-title' }, r.title || `#${r.id}`),
          h('div', { class: 'meta-line', style: { marginTop: '4px' } },
            h('span', { class: `pill ${problem ? 'warn' : 'info'}` }, r.status || 'downloading'),
            h('span', {}, `${fmtBytes(s - left)} / ${fmtBytes(s)}`),
            r.errorMessage ? h('span', { class: 'dim' }, r.errorMessage) : null,
          ),
          h('div', { class: 'progress' }, h('span', { style: { width: pct(prog) } })),
        ),
        h('div', { class: 'row-actions' },
          h('button', { class: 'btn sm danger', title: 'Remove', onclick: () => confirmModal({ title: 'Remove from queue', message: `Remove “${r.title}”?`, confirmLabel: 'Remove', danger: true, onConfirm: async () => {
            try { await client.del(`queue/${r.id}?removeFromClient=true&blocklist=true`); toast('Removed', 'success'); tabQueue(root, client, cfg); } catch (e) { toast(e.message, 'error'); }
          } }) }, '✕'),
        ),
      );
    });
    mount(root, h('div', { class: 'section-title' }, `${recs.length} downloading`), h('div', { class: 'list' }, ...rows));
  } catch (e) { mount(root, empty('⚠️', 'Failed to load', e.message)); }
}

async function tabCalendar(root, client, cfg) {
  mount(root, spinner());
  try {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const end = new Date(start.getTime() + 30 * 86400000);
    const data = await client.get(`calendar?start=${start.toISOString()}&end=${end.toISOString()}`);
    const items = (Array.isArray(data) ? data : (data.records || [])).filter((it) => it.releaseDate || it.airDate);
    if (!items.length) return mount(root, empty('📅', 'Nothing scheduled', 'No upcoming releases in the next 30 days.'));
    items.sort((a, b) => new Date(a.releaseDate || a.airDate) - new Date(b.releaseDate || b.airDate));
    const rows = items.map((it) => h('div', { class: 'row' }, h('div', { class: 'row-main' },
      h('div', { class: 'row-title' }, cfg.calTitle(it)),
      h('div', { class: 'meta-line', style: { marginTop: '4px' } }, h('span', { class: 'dim' }, fmtDate(it.releaseDate || it.airDate)), it.monitored ? h('span', { class: 'pill ok' }, 'Monitored') : null),
    )));
    mount(root, h('div', { class: 'section-title' }, `${items.length} upcoming`), h('div', { class: 'list' }, ...rows));
  } catch (e) { mount(root, empty('⚠️', 'Failed to load', e.message)); }
}

async function tabHistory(root, client, cfg) {
  mount(root, spinner());
  try {
    const data = await client.get('history?page=1&pageSize=30&sortKey=date&sortDirection=descending');
    const recs = data.records || [];
    if (!recs.length) return mount(root, empty('🕓', 'No history', 'No recent activity.'));
    const kind = (e) => /Imported/i.test(e) ? { label: 'Imported', cls: 'ok' } : /Failed/i.test(e) ? { label: 'Failed', cls: 'down' } : { label: e || 'Event', cls: 'muted' };
    const rows = recs.map((r) => { const k = kind(r.eventType); return h('div', { class: 'row' }, h('div', { class: 'row-main' },
      h('div', { class: 'row-title' }, cfg.histTitle(r)),
      h('div', { class: 'meta-line', style: { marginTop: '4px' } }, h('span', { class: `pill ${k.cls}` }, k.label), r.sourceTitle ? h('span', { class: 'dim', style: { maxWidth: '60%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, r.sourceTitle) : null, h('span', { class: 'dim' }, fmtRelative(new Date(r.date).getTime()))),
    )); });
    mount(root, h('div', { class: 'section-title' }, 'Recent history'), h('div', { class: 'list' }, ...rows));
  } catch (e) { mount(root, empty('⚠️', 'Failed to load', e.message)); }
}
