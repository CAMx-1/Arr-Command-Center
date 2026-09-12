import { h, mount, tabs, spinner, skeletonList, empty, toast, fmtBytes, fmtRelative, timeEl, debounce, openModal, closeModal, confirmModal } from '../lib/ui.js';
import { hive, posterHexCard } from '../lib/hive.js';
import { viewToggle, effectiveMode } from '../lib/viewMode.js';

// Live Prowlarr (v1 API) panel. Indexers, manual search, history, health.
// Shows a friendly "not configured" state until a baseUrl + API key are set in
// config.json (services.prowlarr).

export async function renderProwlarr(root, ctx) {
  const svc = ctx.service;
  if (!svc.configured) {
    ctx.setActions();
    return mount(root, notConfigured());
  }
  const px = ctx.api.prowlarr(svc.key);

  // Health checks power the notification bell badge.
  let health = [];
  try { health = await px.get('health'); } catch { /* ignore */ }
  ctx.setActions(
    viewToggle(svc.key, ctx.reload),
    h('button', { class: 'btn pw-bell', title: 'Notifications', onclick: () => openNotifications(health) },
      bellSvg(), health.length ? h('span', { class: 'pw-badge' }, String(health.length)) : null),
  );

  const body = h('div', {});
  const bar = tabs(body, [
    { id: 'indexers', label: 'Indexers', render: (c) => tabIndexers(c, ctx, px) },
    { id: 'search', label: 'Search', render: (c) => tabSearch(c, ctx, px) },
    { id: 'history', label: 'History', render: (c) => tabHistory(c, ctx, px) },
  ], `tabs-${svc.key}`);
  mount(root, bar, body);
}

function notConfigured() {
  return h('div', { class: 'empty', style: { padding: '48px 24px' } },
    h('div', { class: 'empty-icon' }, ''),
    h('div', { style: { fontWeight: '700', fontSize: '16px' } }, 'Prowlarr isn’t configured yet'),
    h('div', { class: 'dim', style: { marginTop: '10px', maxWidth: '540px', lineHeight: '1.6' } },
      'Add your Prowlarr URL and API key to ', h('span', { class: 'mono' }, 'config.json'),
      ' under ', h('span', { class: 'mono' }, 'services.prowlarr'),
      ' (the API key is in Prowlarr under Settings → General → Security), then restart the server.'),
  );
}

const bellSvg = () => h('span', { class: 'pw-bell-ico', html: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>' });

// ---- Notifications (Prowlarr health checks) ----
function openNotifications(health) {
  const list = (health && health.length)
    ? h('div', { class: 'list' }, ...health.map((c) => h('div', { class: 'row' },
        h('div', { class: 'row-main' },
          h('div', { class: 'row-title' }, c.message || c.source || 'Health issue'),
          h('div', { class: 'meta-line', style: { marginTop: '4px' } },
            h('span', { class: `pill ${c.type === 'error' ? 'down' : c.type === 'warning' ? 'warn' : 'info'}` }, c.type || 'notice'),
            c.source ? h('span', { class: 'dim' }, c.source) : null,
            c.wikiUrl ? h('a', { class: 'btn sm', href: c.wikiUrl, target: '_blank', rel: 'noopener noreferrer' }, 'More info') : null,
          ),
        ),
      )))
    : h('div', { class: 'empty', style: { padding: '24px' } }, 'No health issues — everything looks good');
  openModal({ title: 'Prowlarr Notifications', body: list });
}

// ---- Stat header ----
function statCard(label, value) {
  return h('div', { class: 'hex-cell hex-static' },
    h('div', { class: 'hex-border' }),
    h('div', { class: 'hex-face' },
      h('div', { class: 'hex-inner' },
        h('div', { class: 'stat' },
          h('span', { class: 'stat-value' }, String(value)),
          h('span', { class: 'stat-label' }, label),
        ),
      ),
    ),
  );
}

const protoGrad = (p) => p === 'usenet' ? 'linear-gradient(160deg, #1d4ed8, #0f172a)' : 'linear-gradient(160deg, #047857, #0f172a)';
const catNames = (ix) => {
  const cats = (ix.capabilities && ix.capabilities.categories) || [];
  return cats.map((c) => c.name).filter(Boolean).slice(0, 4).join(', ');
};

// ---- Indexers ----
async function tabIndexers(root, ctx, px) {
  mount(root, skeletonList());
  try {
    const [indexers, statsResp] = await Promise.all([
      px.get('indexer'),
      px.get('indexerstats').catch(() => null),
    ]);
    const statById = {};
    if (statsResp && Array.isArray(statsResp.indexers)) {
      for (const s of statsResp.indexers) statById[s.indexerId] = s;
    }
    if (!indexers.length) return mount(root, empty('', 'No indexers', 'Add indexers in Prowlarr to see them here'));
    const enabled = indexers.filter((i) => i.enable).length;
    const totalQueries = Object.values(statById).reduce((a, s) => a + (s.numberOfQueries || 0), 0);
    const totalGrabs = Object.values(statById).reduce((a, s) => a + (s.numberOfGrabs || 0), 0);
    const header = h('div', { class: 'honeycomb' }, h('div', { class: 'hc-row' },
      statCard('Indexers', indexers.length),
      statCard('Enabled', enabled),
      statCard('Queries', totalQueries.toLocaleString()),
      statCard('Grabs', totalGrabs.toLocaleString()),
    ));
    const reload = () => tabIndexers(root, ctx, px);
    const list = effectiveMode(ctx.service.key) === 'hex'
      ? hive(indexers.map((ix) => indexerHex(ix, statById[ix.id], px, reload)), root.clientWidth)
      : h('div', { class: 'list' }, ...indexers.map((ix) => indexerRow(ix, statById[ix.id], px, reload)));
    mount(root, header, h('div', { class: 'section-title' }, 'Indexers'), list);
  } catch (err) {
    mount(root, empty('', 'Failed to load indexers', err.message, { label: 'Retry', onClick: () => tabIndexers(root, ctx, px) }));
  }
}

function indexerRow(ix, stat, px, reload) {
  const avg = stat && stat.averageResponseTime ? `${Math.round(stat.averageResponseTime)}ms avg` : null;
  const grabs = stat ? `${(stat.numberOfGrabs || 0).toLocaleString()} grabs` : null;
  return h('div', { class: 'row clickable', onclick: () => openEdit(ix, px, reload) },
    h('div', { class: 'poster', style: { width: '40px', height: '40px', fontSize: '13px', fontWeight: '800' } }, ix.protocol === 'usenet' ? 'NZB' : 'TOR'),
    h('div', { class: 'row-main' },
      h('div', { class: 'row-title' }, ix.name),
      h('div', { class: 'meta-line', style: { marginTop: '4px' } },
        h('span', { class: `pill ${ix.enable ? 'ok' : 'muted'}` }, ix.enable ? 'Enabled' : 'Disabled'),
        h('span', { class: 'pill info' }, ix.protocol === 'usenet' ? 'Usenet' : 'Torrent'),
        h('span', {}, `Priority ${ix.priority}`),
        catNames(ix) ? h('span', {}, catNames(ix)) : null,
        avg ? h('span', {}, avg) : null,
        grabs ? h('span', {}, grabs) : null,
      ),
    ),
    h('div', { class: 'row-actions' },
      h('button', { class: 'btn sm', onclick: (e) => { e.stopPropagation(); testIndexer(ix, px); } }, 'Test'),
      h('button', { class: 'btn sm', onclick: (e) => { e.stopPropagation(); openEdit(ix, px, reload); } }, 'Edit'),
    ),
  );
}

function indexerHex(ix, stat, px, reload) {
  const avg = stat && stat.averageResponseTime ? `${Math.round(stat.averageResponseTime)}ms` : null;
  const actions = h('div', { class: 'row-actions' },
    h('button', { class: 'btn sm', title: 'Test connectivity', onclick: (e) => { e.stopPropagation(); testIndexer(ix, px); } }, 'Test'),
    h('button', { class: 'btn sm', title: 'Edit', onclick: (e) => { e.stopPropagation(); openEdit(ix, px, reload); } }, 'Edit'),
  );
  const catStr = catNames(ix);
  return posterHexCard({
    gradient: protoGrad(ix.protocol),
    title: ix.name,
    pills: [
      { label: ix.enable ? 'Enabled' : 'Disabled', cls: ix.enable ? 'ok' : 'muted' },
      { label: ix.protocol === 'usenet' ? 'Usenet' : 'Torrent', cls: 'info' },
    ],
    sub: [catStr, avg].filter(Boolean).join(' · ') || `Priority ${ix.priority}`,
    actions,
    onClick: () => openEdit(ix, px, reload),
  });
}

// ---- Connectivity test (real) ----
async function testIndexer(ix, px) {
  toast(`Testing ${ix.name}…`, 'info', 1500);
  try {
    await px.post('indexer/test', ix);
    toast(`${ix.name}: connection OK`, 'success', 2600);
  } catch (err) {
    toast(`${ix.name}: ${err.message || 'test failed'}`, 'error', 3600);
  }
}

// ---- Edit modal (enable / priority; full resource PUT back) ----
function field(label, control) {
  return h('label', { class: 'pw-field' }, h('span', { class: 'pw-field-label' }, label), control);
}
function openEdit(ix, px, reload) {
  const model = { ...ix };
  const enabled = h('input', { type: 'checkbox', checked: model.enable ? 'checked' : null });
  const priority = h('input', { class: 'input', type: 'number', min: '1', max: '50', value: String(model.priority ?? 25) });
  const status = h('div', { class: 'dim pw-test-status', style: { minHeight: '16px' } }, '');

  const save = async () => {
    model.enable = enabled.checked;
    model.priority = Number(priority.value) || model.priority || 25;
    try {
      await px.put(`indexer/${model.id}`, model);
      toast(`Saved ${model.name}`, 'success');
      closeModal();
      reload();
    } catch (err) {
      toast(`Save failed: ${err.message}`, 'error', 3600);
    }
  };
  const del = () => confirmModal({
    title: 'Remove indexer', message: `Remove "${model.name}" from Prowlarr?`, confirmLabel: 'Remove', danger: true,
    onConfirm: async () => {
      try { await px.del(`indexer/${model.id}`); toast(`Removed ${model.name}`, 'success'); closeModal(); reload(); }
      catch (err) { toast(`Remove failed: ${err.message}`, 'error', 3600); }
    },
  });
  const test = async () => {
    status.textContent = 'Testing…';
    const m = { ...model, enable: enabled.checked, priority: Number(priority.value) || model.priority };
    try { await px.post('indexer/test', m); status.textContent = 'Connection OK'; toast(`${model.name}: connection OK`, 'success'); }
    catch (err) { status.textContent = err.message || 'Test failed'; toast(`${model.name}: ${err.message || 'test failed'}`, 'error', 3600); }
  };

  const bodyEl = h('div', { class: 'pw-form' },
    field('Name', h('span', {}, model.name)),
    field('Protocol', h('span', {}, model.protocol === 'usenet' ? 'Usenet' : 'Torrent')),
    field('Categories', h('span', { class: 'dim' }, catNames(model) || '—')),
    field('Enabled', h('span', { class: 'pw-toggle' }, enabled)),
    field('Priority', priority),
    h('div', { class: 'pw-test-row' },
      h('button', { class: 'btn sm', onclick: test }, 'Test connectivity'),
      status,
    ),
  );
  const footer = h('div', { style: { display: 'flex', gap: '10px', justifyContent: 'space-between', width: '100%' } },
    h('button', { class: 'btn danger sm', onclick: del }, 'Remove'),
    h('div', { style: { display: 'flex', gap: '10px' } },
      h('button', { class: 'btn', onclick: closeModal }, 'Cancel'),
      h('button', { class: 'btn primary', onclick: save }, 'Save'),
    ),
  );
  openModal({ title: `Edit ${model.name}`, body: bodyEl, footer });
}

// ---- Manual search ----
function tabSearch(root, ctx, px) {
  const input = h('input', { class: 'input', placeholder: 'Search all enabled indexers…' });
  const results = h('div', { class: 'list', style: { marginTop: '12px' } });
  const run = debounce(async () => {
    const q = input.value.trim();
    if (!q) { mount(results, empty('', 'Type to search', 'Results from all enabled indexers appear here')); return; }
    mount(results, spinner());
    try {
      const releases = await px.get(`search?query=${encodeURIComponent(q)}&type=search&limit=100`);
      if (!Array.isArray(releases) || !releases.length) return mount(results, empty('', 'No results', 'Try a different query'));
      releases.sort((a, b) => (b.seeders || 0) - (a.seeders || 0));
      mount(results, ...releases.slice(0, 100).map((r) => releaseRow(r, px)));
    } catch (err) {
      mount(results, empty('', 'Search failed', err.message));
    }
  }, 350);
  input.addEventListener('input', run);
  mount(root, h('div', { class: 'section-title' }, 'Manual Search'), input, results);
  run();
}

function releaseRow(r, px) {
  const cat = Array.isArray(r.categories) ? r.categories.map((c) => c.name).filter(Boolean).join(', ') : '';
  return h('div', { class: 'row' },
    h('div', { class: 'poster', style: { width: '40px', height: '40px', fontSize: '13px', fontWeight: '800' } }, r.protocol === 'usenet' ? 'NZB' : 'TOR'),
    h('div', { class: 'row-main' },
      h('div', { class: 'row-title' }, r.title),
      h('div', { class: 'meta-line', style: { marginTop: '4px' } },
        r.indexer ? h('span', { class: 'pill info' }, r.indexer) : null,
        cat ? h('span', { class: 'pill muted' }, cat) : null,
        r.size ? h('span', {}, fmtBytes(r.size)) : null,
        r.protocol === 'torrent' ? h('span', {}, `▲ ${r.seeders ?? 0}  ▼ ${r.leechers ?? 0}`) : h('span', {}, 'Usenet'),
        r.publishDate ? timeEl(r.publishDate, { class: 'dim' }) : null,
      ),
    ),
    h('div', { class: 'row-actions' },
      h('button', { class: 'btn sm primary', onclick: async (e) => {
        e.stopPropagation();
        try { await px.post('search', { guid: r.guid, indexerId: r.indexerId }); toast(`Sent to download client: ${r.title}`, 'success'); }
        catch (err) { toast(`Grab failed: ${err.message}`, 'error', 3600); }
      } }, 'Grab'),
    ),
  );
}

// ---- History ----
async function tabHistory(root, ctx, px) {
  mount(root, skeletonList());
  try {
    const data = await px.get('history?page=1&pageSize=30&sortKey=date&sortDirection=descending');
    const records = (data && data.records) || [];
    if (!records.length) return mount(root, empty('', 'No history yet'));
    const list = effectiveMode(ctx.service.key) === 'hex'
      ? hive(records.map(histHex), root.clientWidth, { W: 380, H: 360 })
      : h('div', { class: 'list' }, ...records.map(histRow));
    mount(root, list);
  } catch (err) {
    mount(root, empty('', 'Failed to load history', err.message));
  }
}

const EVENT_LABEL = { releaseGrabbed: 'Grabbed', indexerQuery: 'Query', indexerRss: 'RSS', indexerAuth: 'Auth' };
function histTitle(r) {
  const d = r.data || {};
  if (d.query) return `Query: ${d.query}`;
  return d.title || d.source || d.host || (r.eventType || 'Event');
}
function histRow(r) {
  const label = EVENT_LABEL[r.eventType] || r.eventType || 'Event';
  const grab = r.eventType === 'releaseGrabbed';
  return h('div', { class: 'row' },
    h('div', { class: 'poster', style: { width: '40px', height: '40px', fontSize: '18px' } }, grab ? '⬇' : '⌕'),
    h('div', { class: 'row-main' },
      h('div', { class: 'row-title' }, histTitle(r)),
      h('div', { class: 'meta-line', style: { marginTop: '4px' } },
        h('span', { class: `pill ${grab ? 'ok' : 'muted'}` }, label),
        r.data && r.data.indexer ? h('span', {}, r.data.indexer) : null,
        r.date ? timeEl(r.date) : null,
      ),
    ),
  );
}
function histHex(r) {
  const grab = r.eventType === 'releaseGrabbed';
  const label = EVENT_LABEL[r.eventType] || r.eventType || 'Event';
  return posterHexCard({
    gradient: grab ? 'linear-gradient(160deg, #047857, #0f172a)' : 'linear-gradient(160deg, #4338ca, #0f172a)',
    title: histTitle(r),
    pills: [{ label, cls: grab ? 'ok' : 'muted' }],
    sub: [r.data && r.data.indexer, r.date ? fmtRelative(r.date) : null].filter(Boolean).join(' · '),
  });
}
