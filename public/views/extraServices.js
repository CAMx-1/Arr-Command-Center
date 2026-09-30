// Views for Autobrr, Maintainerr, Tdarr and Audiobookshelf. Data access and
// normalization live in lib/extraServices.js.
import { h, mount, tabs, skeletonList, empty, toast, fmtBytes, fmtRelative, fmtDate, pct, poster, autoRefresh, confirmModal } from '../lib/ui.js';
import { statCard } from './downloadClient.js';
import {
  autobrrClient, maintainerrClient, tdarrClient, absClient,
  normalizeTdarrWorkers, normalizeTdarrNodes, TDARR_TABLES, fmtDuration,
} from '../lib/extraServices.js';

const statRow = (...cards) => h('div', { class: 'honeycomb' }, h('div', { class: 'hc-row' }, ...cards.filter(Boolean)));
const failed = (root, what, err, retry) => mount(root, empty('⚠️', `Failed to load ${what}`, err.message, retry ? { label: 'Retry', onClick: retry } : undefined));
const section = (label) => h('div', { class: 'section-title' }, label);

// Wraps an async tab loader with the skeleton/error/silent-refresh pattern.
function tabLoader(root, what, render, { refreshMs = 0 } = {}) {
  const wrap = h('div', {});
  mount(root, wrap);
  const load = async (silent = false) => {
    if (!silent) mount(wrap, skeletonList());
    try { await render(wrap, () => load(true)); }
    catch (err) { if (!silent) failed(wrap, what, err, () => load(false)); }
  };
  load(false);
  if (refreshMs) autoRefresh(wrap, refreshMs, () => load(true));
}

function mountTabs(root, ctx, defs) {
  const body = h('div', {});
  const bar = tabs(body, defs, `tabs-${ctx.service.key}`, {
    activeId: ctx.params.tab,
    onChange: (id) => ctx.setParams({ tab: id === defs[0].id ? '' : id }),
  });
  mount(root, bar, body);
}

// ======================================================================= Autobrr
const AUTOBRR_FILTERS = [['', 'All'], ['PUSH_APPROVED', 'Pushed'], ['PUSH_REJECTED', 'Rejected'], ['PUSH_ERROR', 'Errors']];

export async function renderAutobrr(root, ctx) {
  const client = autobrrClient(ctx.api, ctx.service.key);
  ctx.setActions();
  mountTabs(root, ctx, [
    { id: 'releases', label: 'Releases', render: (c) => autobrrReleases(c, client, ctx) },
    { id: 'filters', label: 'Filters', render: (c) => autobrrFilters(c, client) },
    { id: 'irc', label: 'IRC', render: (c) => autobrrIrc(c, client) },
  ]);
}

function autobrrReleases(root, client, ctx) {
  let pushStatus = ctx.params.status || '';
  tabLoader(root, 'releases', async (wrap) => {
    const [stats, releases] = await Promise.all([client.stats().catch(() => null), client.releases({ limit: 50, pushStatus })]);
    const select = h('select', { class: 'input', 'aria-label': 'Filter releases', style: { width: 'auto' } },
      ...AUTOBRR_FILTERS.map(([v, l]) => h('option', { value: v }, l)));
    select.value = pushStatus;
    select.addEventListener('change', () => { pushStatus = select.value; ctx.setParams({ status: pushStatus }); autobrrReleases(root, client, ctx); });
    mount(wrap,
      stats ? statRow(
        statCard('Announces', String(stats.total_count ?? 0)),
        statCard('Matched', String(stats.filtered_count ?? 0), 'info'),
        statCard('Pushed', String(stats.push_approved_count ?? 0), 'ok'),
        statCard('Rejected', String(stats.push_rejected_count ?? 0), 'warn'),
        statCard('Errors', String(stats.push_error_count ?? 0), stats.push_error_count ? 'warn' : ''),
      ) : null,
      h('div', { class: 'lib-head' }, section('Recent releases'), select),
      releases.length
        ? h('div', { class: 'list' }, ...releases.map((r) => h('div', { class: 'row' },
            h('div', { class: 'poster', style: { width: '40px', height: '40px', fontSize: '18px' } }, r.protocol === 'usenet' ? '⬇' : '🧲'),
            h('div', { class: 'row-main' },
              h('div', { class: 'row-title', style: { wordBreak: 'break-all' } }, r.name),
              h('div', { class: 'meta-line', style: { marginTop: '4px' } },
                h('span', { class: `pill ${r.cls}` }, r.client ? `${r.label} · ${r.client}` : r.label),
                r.filter ? h('span', { class: 'pill muted' }, r.filter) : null,
                r.indexer ? h('span', {}, r.indexer) : null,
                r.size ? h('span', {}, fmtBytes(r.size)) : null,
                r.timestamp ? h('span', {}, fmtRelative(r.timestamp)) : null,
              ),
              r.reason ? h('div', { class: 'row-sub', style: { color: r.cls === 'down' ? 'var(--red)' : undefined } }, r.reason) : null,
            ))))
        : empty('📡', 'No releases', pushStatus ? 'Nothing matches this filter yet' : 'Autobrr hasn’t matched any announces yet'),
    );
  }, { refreshMs: 30000 });
}

function autobrrFilters(root, client) {
  tabLoader(root, 'filters', async (wrap, refresh) => {
    const filters = await client.filters();
    if (!filters.length) return mount(wrap, empty('🧰', 'No filters', 'Create filters in Autobrr to start matching releases'));
    mount(wrap, h('div', { class: 'list' }, ...filters.map((f) => {
      const toggle = h('input', { type: 'checkbox', role: 'switch', 'aria-label': `Enable ${f.name}` });
      toggle.checked = !!f.enabled;
      toggle.addEventListener('change', async () => {
        toggle.disabled = true;
        try { await client.setFilterEnabled(f.id, toggle.checked); toast(`${f.name} ${toggle.checked ? 'enabled' : 'disabled'}`, 'success'); refresh(); }
        catch (e) { toggle.checked = !toggle.checked; toast(e.message, 'error'); }
        toggle.disabled = false;
      });
      const indexers = (f.indexers || []).map((i) => i.name).filter(Boolean);
      return h('div', { class: 'row' },
        h('div', { class: 'row-main' },
          h('div', { class: 'row-title' }, f.name),
          h('div', { class: 'meta-line', style: { marginTop: '4px' } },
            h('span', { class: `pill ${f.enabled ? 'ok' : 'muted'}` }, f.enabled ? 'Enabled' : 'Disabled'),
            f.priority != null ? h('span', {}, `Priority ${f.priority}`) : null,
            indexers.length ? h('span', {}, indexers.join(', ')) : null,
          ),
        ),
        h('div', { class: 'row-actions' }, h('span', { class: 'pw-toggle' }, toggle)),
      );
    })));
  });
}

function autobrrIrc(root, client) {
  tabLoader(root, 'IRC networks', async (wrap) => {
    const networks = await client.irc();
    if (!networks.length) return mount(wrap, empty('💬', 'No IRC networks', 'Add an indexer with IRC announces in Autobrr'));
    mount(wrap, h('div', { class: 'list' }, ...networks.map((n) => {
      const state = !n.enabled ? ['muted', 'Disabled'] : n.healthy ? ['ok', 'Healthy'] : n.connected ? ['warn', 'Degraded'] : ['down', 'Disconnected'];
      return h('div', { class: 'row' }, h('div', { class: 'row-main' },
        h('div', { class: 'row-title' }, n.name),
        h('div', { class: 'meta-line', style: { marginTop: '4px' } },
          h('span', { class: `pill ${state[0]}` }, state[1]),
          h('span', {}, `${n.server}:${n.port}${n.tls ? ' (TLS)' : ''}`),
          n.connected_since ? h('span', {}, `up ${fmtRelative(n.connected_since).replace(/ ago$/, '')}`) : null,
        ),
        ...(n.channels || []).map((c) => h('div', { class: 'row-sub' },
          `${c.name} · ${c.monitoring ? 'monitoring' : 'not monitoring'}${c.last_announce ? ` · last announce ${fmtRelative(c.last_announce)}` : ''}`)),
        (n.connection_errors || []).length ? h('div', { class: 'row-sub', style: { color: 'var(--red)' } }, n.connection_errors.join(' · ')) : null,
      ));
    })));
  }, { refreshMs: 30000 });
}

// =================================================================== Maintainerr
export async function renderMaintainerr(root, ctx) {
  const client = maintainerrClient(ctx.api, ctx.service.key);
  const run = h('button', { class: 'btn', type: 'button' }, 'Run rules now');
  run.onclick = async () => {
    run.disabled = true;
    try { await client.runRules(); toast('Rule run started', 'success'); }
    catch (e) { toast(e.status === 409 ? 'Rules are already running' : e.message, 'error'); }
    run.disabled = false;
  };
  ctx.setActions(run);
  mountTabs(root, ctx, [
    { id: 'leaving', label: 'Leaving soon', render: (c) => maintainerrLeaving(c, client) },
    { id: 'collections', label: 'Collections', render: (c) => maintainerrCollections(c, client) },
  ]);
}

function deletionPill(item) {
  if (item.daysLeft == null) return h('span', { class: 'pill muted' }, 'Kept');
  if (item.overdue) return h('span', { class: 'pill down' }, 'Due now');
  return h('span', { class: `pill ${item.daysLeft <= 3 ? 'down' : item.daysLeft <= 7 ? 'warn' : 'info'}` }, `${item.daysLeft} day${item.daysLeft === 1 ? '' : 's'} left`);
}

function maintainerrLeaving(root, client) {
  tabLoader(root, 'scheduled deletions', async (wrap, refresh) => {
    const collections = (await client.collections()).filter((c) => c.isActive && c.deleteAfterDays != null);
    const pages = await Promise.all(collections.map((c) => client.media(c).then((r) => r.items.map((it) => ({ ...it, collection: c })))));
    const items = pages.flat().sort((a, b) => (a.daysLeft ?? 1e9) - (b.daysLeft ?? 1e9));
    const totalSize = items.reduce((n, it) => n + it.size, 0);
    mount(wrap,
      statRow(
        statCard('Scheduled', String(items.length), items.length ? 'warn' : 'ok'),
        statCard('This week', String(items.filter((i) => i.daysLeft != null && i.daysLeft <= 7).length), 'warn'),
        statCard('Frees', fmtBytes(totalSize), 'info'),
        statCard('Rules', String(collections.length)),
      ),
      section('Scheduled for deletion'),
      items.length
        ? h('div', { class: 'list' }, ...items.map((it) => h('div', { class: 'row' },
            poster(it.image, it.type === 'show' ? '📺' : '🎬'),
            h('div', { class: 'row-main' },
              h('div', { class: 'row-title' }, it.title),
              h('div', { class: 'meta-line', style: { marginTop: '4px' } },
                deletionPill(it),
                h('span', { class: 'pill muted' }, it.collection.title),
                it.deletionDate ? h('span', {}, fmtDate(it.deletionDate)) : null,
                it.size ? h('span', {}, fmtBytes(it.size)) : null,
              ),
            ),
            h('div', { class: 'row-actions' }, h('button', { class: 'btn sm', type: 'button', title: 'Keep this item: exclude it from this rule', onclick: () => confirmModal({
              title: 'Keep this title?',
              message: `Exclude “${it.title}” from “${it.collection.title}”? Maintainerr will stop scheduling it for deletion under this rule.`,
              confirmLabel: 'Keep it',
              onConfirm: async () => {
                try { await client.exclude(it); toast(`Keeping ${it.title}`, 'success'); refresh(); }
                catch (e) { toast(e.message, 'error'); }
              },
            }) }, 'Keep')),
          )))
        : empty('🧹', 'Nothing scheduled', 'No active rule currently has items waiting to be deleted'),
    );
  });
}

function maintainerrCollections(root, client) {
  tabLoader(root, 'collections', async (wrap, refresh) => {
    const collections = await client.collections();
    if (!collections.length) return mount(wrap, empty('🗂', 'No collections', 'Create rules in Maintainerr to build collections'));
    const counts = await Promise.all(collections.map((c) => client.media(c, { size: 1 }).then((r) => r.total).catch(() => null)));
    mount(wrap, h('div', { class: 'list' }, ...collections.map((c, i) => {
      const toggle = h('input', { type: 'checkbox', role: 'switch', 'aria-label': `Activate ${c.title}` });
      toggle.checked = !!c.isActive;
      toggle.addEventListener('change', async () => {
        toggle.disabled = true;
        try { await client.setCollectionActive(c.id, toggle.checked); toast(`${c.title} ${toggle.checked ? 'activated' : 'deactivated'}`, 'success'); refresh(); }
        catch (e) { toggle.checked = !toggle.checked; toast(e.message, 'error'); }
        toggle.disabled = false;
      });
      return h('div', { class: 'row' },
        h('div', { class: 'row-main' },
          h('div', { class: 'row-title' }, c.title),
          c.description ? h('div', { class: 'row-sub' }, c.description) : null,
          h('div', { class: 'meta-line', style: { marginTop: '4px' } },
            h('span', { class: `pill ${c.isActive ? 'ok' : 'muted'}` }, c.isActive ? 'Active' : 'Inactive'),
            counts[i] != null ? h('span', {}, `${counts[i]} item${counts[i] === 1 ? '' : 's'}`) : null,
            c.deleteAfterDays != null ? h('span', {}, `Delete after ${c.deleteAfterDays} days`) : h('span', {}, 'Never deletes'),
            c.handledMediaAmount ? h('span', {}, `${c.handledMediaAmount} handled`) : null,
            c.handledMediaSizeBytes ? h('span', {}, `${fmtBytes(c.handledMediaSizeBytes)} freed`) : null,
          ),
        ),
        h('div', { class: 'row-actions' }, h('span', { class: 'pw-toggle' }, toggle)),
      );
    })));
  });
}

// ========================================================================= Tdarr
export async function renderTdarr(root, ctx) {
  const client = tdarrClient(ctx.api, ctx.service.key);
  ctx.setActions();
  mountTabs(root, ctx, [
    { id: 'workers', label: 'Workers', render: (c) => tdarrWorkers(c, client) },
    { id: 'queue', label: 'Queue', render: (c) => tdarrTable(c, client, TDARR_TABLES.queue, 'Transcode queue') },
    { id: 'errors', label: 'Errors', render: (c) => tdarrTable(c, client, TDARR_TABLES.errors, 'Transcode errors') },
  ]);
}

function tdarrWorkers(root, client) {
  tabLoader(root, 'Tdarr', async (wrap) => {
    const [stats, rawNodes] = await Promise.all([client.stats().catch(() => null), client.nodes()]);
    const workers = normalizeTdarrWorkers(rawNodes);
    const nodes = normalizeTdarrNodes(rawNodes);
    mount(wrap,
      stats ? statRow(
        statCard('Files', stats.totalFiles.toLocaleString()),
        statCard('Transcoded', stats.transcodeSuccess.toLocaleString(), 'ok'),
        statCard('Space saved', fmtBytes(stats.spaceSaved), 'info'),
        statCard('Queued', (stats.transcodeQueued + stats.healthQueued).toLocaleString()),
        statCard('Errors', (stats.transcodeErrors + stats.healthErrors).toLocaleString(), stats.transcodeErrors + stats.healthErrors ? 'warn' : ''),
      ) : null,
      section(`Nodes (${nodes.length})`),
      h('div', { class: 'meta-line', style: { marginBottom: '10px' } }, ...nodes.map((n) =>
        h('span', { class: `pill ${n.paused ? 'warn' : 'ok'}` }, `${n.name} · ${n.paused ? 'paused' : `${n.workers} worker${n.workers === 1 ? '' : 's'}`}`))),
      section('Active workers'),
      workers.length
        ? h('div', { class: 'list' }, ...workers.map((w) => h('div', { class: 'row' },
            h('div', { class: 'poster', style: { width: '40px', height: '40px', fontSize: '18px' } }, w.type === 'healthcheck' ? '🩺' : '🎞'),
            h('div', { class: 'row-main' },
              h('div', { class: 'row-title', style: { wordBreak: 'break-all' } }, w.name),
              h('div', { class: 'meta-line', style: { marginTop: '4px' } },
                h('span', { class: 'pill info' }, w.type === 'healthcheck' ? 'Health check' : 'Transcode'),
                h('span', { class: 'pill muted' }, w.node),
                h('span', {}, `${Math.round(w.percentage)}%`),
                w.fps ? h('span', {}, `${w.fps} fps`) : null,
                w.eta ? h('span', {}, `ETA ${w.eta}`) : null,
                w.originalSize ? h('span', {}, w.estimatedSize ? `${fmtBytes(w.originalSize)} → ~${fmtBytes(w.estimatedSize)}` : fmtBytes(w.originalSize)) : null,
              ),
              h('div', { class: 'progress' }, h('span', { style: { width: pct(w.percentage) } })),
            ))))
        : empty('💤', 'All workers idle', 'Nothing is transcoding or being health-checked right now'),
    );
  }, { refreshMs: 5000 });
}

function tdarrTable(root, client, table, title) {
  tabLoader(root, title.toLowerCase(), async (wrap) => {
    const { total, items } = await client.table(table, { pageSize: 50 });
    const isErrors = table === TDARR_TABLES.errors;
    mount(wrap,
      section(`${title} (${total})`),
      items.length
        ? h('div', { class: 'list' }, ...items.map((it) => h('div', { class: 'row' }, h('div', { class: 'row-main' },
            h('div', { class: 'row-title', style: { wordBreak: 'break-all' } }, it.name),
            h('div', { class: 'meta-line', style: { marginTop: '4px' } },
              h('span', { class: `pill ${isErrors ? 'down' : 'muted'}` }, isErrors ? 'Error' : it.transcode || 'Queued'),
              it.resolution ? h('span', {}, it.resolution) : null,
              it.codec ? h('span', {}, it.codec) : null,
              it.size ? h('span', {}, fmtBytes(it.size)) : null,
            ),
            h('div', { class: 'row-sub', style: { wordBreak: 'break-all' } }, it.file),
          ))))
        : empty(isErrors ? '✅' : '📭', isErrors ? 'No errors' : 'Queue is empty', isErrors ? 'Every transcode has succeeded' : 'Nothing is waiting to be transcoded'),
      total > items.length ? h('div', { class: 'dim', style: { fontSize: '12px', marginTop: '8px' } }, `Showing ${items.length} of ${total}. Open Tdarr for the full list.`) : null,
    );
  }, { refreshMs: 30000 });
}

// ================================================================ Audiobookshelf
export async function renderAudiobookshelf(root, ctx) {
  const client = absClient(ctx.api, ctx.service.key);
  ctx.setActions();
  mountTabs(root, ctx, [
    { id: 'listening', label: 'Listening', render: (c) => absListening(c, client) },
    { id: 'recent', label: 'Recently added', render: (c) => absRecent(c, client, ctx) },
    { id: 'libraries', label: 'Libraries', render: (c) => absLibraries(c, client) },
  ]);
}

function absRow(item, extra = []) {
  return h('div', { class: 'row' },
    poster(item.cover, item.mediaType === 'podcast' ? '🎙' : '🎧'),
    h('div', { class: 'row-main' },
      h('div', { class: 'row-title' }, item.title),
      item.author ? h('div', { class: 'row-sub' }, item.author + (item.series ? ` · ${item.series}` : '')) : null,
      h('div', { class: 'meta-line', style: { marginTop: '4px' } }, ...extra.filter(Boolean)),
      item.progress != null ? h('div', { class: 'progress' }, h('span', { style: { width: pct(item.progress * 100) } })) : null,
    ),
  );
}

function absListening(root, client) {
  tabLoader(root, 'listening activity', async (wrap) => {
    const [sessions, progress] = await Promise.all([
      client.sessions().then((s) => ({ ok: true, s })).catch((e) => ({ ok: false, error: e })),
      client.inProgress(),
    ]);
    const live = sessions.ok ? sessions.s : [];
    mount(wrap,
      section(`Listening now${sessions.ok ? ` (${live.length})` : ''}`),
      !sessions.ok
        ? h('div', { class: 'dim', style: { fontSize: '13px', marginBottom: '12px' } }, 'Live sessions need an admin API token.')
        : live.length
          ? h('div', { class: 'list' }, ...live.map((s) => absRow({ ...s, mediaType: 'book' }, [
              h('span', { class: 'pill ok' }, 'Playing'),
              s.user ? h('span', {}, s.user) : null,
              s.device ? h('span', {}, s.device) : null,
              h('span', {}, `${fmtDuration(s.currentTime)} / ${fmtDuration(s.duration)}`),
            ])))
          : empty('🎧', 'Nobody is listening', 'Active listening sessions show up here'),
      section('Continue listening'),
      progress.length
        ? h('div', { class: 'list' }, ...progress.map((it) => absRow(it, [
            it.progress != null ? h('span', { class: 'pill info' }, `${Math.round(it.progress * 100)}%`) : null,
            it.duration ? h('span', {}, fmtDuration(it.duration)) : null,
            it.narrator ? h('span', {}, `Narrated by ${it.narrator}`) : null,
          ])))
        : empty('📖', 'Nothing in progress', 'Start a book in Audiobookshelf and it appears here'),
    );
  }, { refreshMs: 15000 });
}

function absRecent(root, client, ctx) {
  tabLoader(root, 'recent items', async (wrap) => {
    const libraries = await client.libraries();
    if (!libraries.length) return mount(wrap, empty('📚', 'No libraries', 'Create a library in Audiobookshelf'));
    let libId = libraries.some((l) => l.id === ctx.params.library) ? ctx.params.library : libraries[0].id;
    const select = h('select', { class: 'input', 'aria-label': 'Library', style: { width: 'auto' } }, ...libraries.map((l) => h('option', { value: l.id }, l.name)));
    select.value = libId;
    const list = h('div', {});
    const show = async () => {
      mount(list, skeletonList());
      try {
        const items = await client.recent(libId, 30);
        mount(list, items.length
          ? h('div', { class: 'list' }, ...items.map((it) => absRow(it, [
              it.mediaType === 'podcast' ? h('span', {}, `${it.episodes} episodes`) : it.duration ? h('span', {}, fmtDuration(it.duration)) : null,
              it.size ? h('span', {}, fmtBytes(it.size)) : null,
              it.addedAt ? h('span', {}, `Added ${fmtRelative(it.addedAt)}`) : null,
            ])))
          : empty('📚', 'Library is empty'));
      } catch (e) { failed(list, 'library', e); }
    };
    select.addEventListener('change', () => { libId = select.value; ctx.setParams({ library: libId }); show(); });
    mount(wrap, h('div', { class: 'lib-head' }, section('Recently added'), select), list);
    await show();
  });
}

function absLibraries(root, client) {
  tabLoader(root, 'libraries', async (wrap) => {
    const libraries = await client.libraries();
    if (!libraries.length) return mount(wrap, empty('📚', 'No libraries'));
    const stats = await Promise.all(libraries.map((l) => client.stats(l.id).catch(() => null)));
    mount(wrap, h('div', { class: 'list' }, ...libraries.map((l, i) => {
      const s = stats[i] || {};
      return h('div', { class: 'row' },
        h('div', { class: 'poster', style: { width: '40px', height: '40px', fontSize: '18px' } }, l.mediaType === 'podcast' ? '🎙' : '🎧'),
        h('div', { class: 'row-main' },
          h('div', { class: 'row-title' }, l.name),
          h('div', { class: 'meta-line', style: { marginTop: '4px' } },
            h('span', { class: 'pill muted' }, l.mediaType === 'podcast' ? 'Podcasts' : 'Books'),
            s.totalItems != null ? h('span', {}, `${s.totalItems} item${s.totalItems === 1 ? '' : 's'}`) : null,
            s.totalAuthors ? h('span', {}, `${s.totalAuthors} authors`) : null,
            s.totalDuration ? h('span', {}, fmtDuration(s.totalDuration)) : null,
            s.totalSize ? h('span', {}, fmtBytes(s.totalSize)) : null,
          ),
        ),
      );
    })));
  });
}
