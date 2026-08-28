// Shared "System" + "Wanted" tabs for Sonarr/Radarr — health checks, disk space,
// system status, maintenance commands, and the missing/wanted list.
import { h, mount, skeletonList, empty, toast, fmtBytes, pct, timeEl } from '../lib/ui.js';
import { openPathFix } from '../lib/pathFix.js';

const HEALTH_CLS = { error: 'down', warning: 'warn', notice: 'info' };

export async function tabSystem(root, arr, ctx, kind) {
  mount(root, skeletonList());
  try {
    const [health, disks, status, blocklist, tags, profiles] = await Promise.all([
      arr.get('health').catch(() => []),
      arr.get('diskspace').catch(() => []),
      arr.get('system/status').catch(() => ({})),
      arr.get('blocklist?page=1&pageSize=20&sortDirection=descending').catch(() => ({ records: [] })),
      arr.get('tag').catch(() => []),
      arr.get('qualityprofile').catch(() => []),
    ]);
    const reload = () => tabSystem(root, arr, ctx, kind);
    const run = async (name) => {
      try { await arr.post('command', { name }); toast(`${name} started`, 'success'); }
      catch (e) { toast(e.message, 'error'); }
    };
    const commands = kind === 'series'
      ? [['RssSync', 'RSS Sync'], ['RefreshSeries', 'Refresh all'], ['MissingEpisodeSearch', 'Search missing'], ['Backup', 'Backup']]
      : [['RssSync', 'RSS Sync'], ['RefreshMovie', 'Refresh all'], ['MissingMoviesSearch', 'Search missing'], ['Backup', 'Backup']];

    mount(root,
      h('div', { class: 'section-title' }, 'Maintenance'),
      h('div', { class: 'meta-line', style: { gap: '8px', marginBottom: '16px', flexWrap: 'wrap' } },
        ...commands.map(([name, label]) => h('button', { class: 'btn sm', onclick: () => run(name) }, label)),
        h('button', { class: 'btn sm primary', title: 'Re-point moved libraries to the real disk (e.g. after a Windows → Mac move)', onclick: () => openPathFix(arr, ctx, kind) }, '🛠 Fix paths'),
      ),
      h('div', { class: 'section-title' }, 'Health'),
      (health && health.length)
        ? h('div', { class: 'list' }, ...health.map((c) => h('div', { class: 'row' },
            h('div', { class: 'row-main' },
              h('div', { class: 'row-title', style: { fontSize: '14px' } }, c.message || c.source),
              h('div', { class: 'meta-line', style: { marginTop: '4px' } },
                h('span', { class: `pill ${HEALTH_CLS[c.type] || 'muted'}` }, c.type || 'notice'),
                c.source ? h('span', { class: 'dim' }, c.source) : null,
                c.wikiUrl ? h('a', { class: 'btn sm', href: c.wikiUrl, target: '_blank', rel: 'noopener noreferrer' }, 'Info') : null,
              ),
            ),
          )))
        : h('div', { class: 'dim', style: { marginBottom: '16px' } }, 'No health issues — all good.'),
      h('div', { class: 'section-title', style: { marginTop: '16px' } }, 'Disk space'),
      h('div', { class: 'list' }, ...(disks || []).map((d) => {
        const used = (d.totalSpace || 0) - (d.freeSpace || 0);
        const p = d.totalSpace ? (used / d.totalSpace) * 100 : 0;
        return h('div', { class: 'row' },
          h('div', { class: 'row-main' },
            h('div', { class: 'row-title', style: { fontSize: '14px' } }, d.path || d.label || 'Disk'),
            h('div', { class: 'meta-line', style: { marginTop: '4px' } },
              h('span', {}, `${fmtBytes(d.freeSpace)} free of ${fmtBytes(d.totalSpace)}`),
              h('span', { class: `pill ${p > 90 ? 'down' : p > 75 ? 'warn' : 'ok'}` }, `${Math.round(p)}% used`),
            ),
            h('div', { class: 'progress' }, h('span', { style: { width: pct(p) } })),
          ),
        );
      })),
      h('div', { class: 'section-title', style: { marginTop: '16px' } }, 'System'),
      h('div', { class: 'card' },
        infoRow('Version', status.version || '—'),
        infoRow('App', status.appName || (kind === 'series' ? 'Sonarr' : 'Radarr')),
        infoRow('OS', status.osName ? `${status.osName} ${status.osVersion || ''}`.trim() : '—'),
        infoRow('Runtime', status.runtimeVersion ? `${status.runtimeName || ''} ${status.runtimeVersion}`.trim() : '—'),
        infoRow('Docker', status.isDocker ? 'Yes' : 'No'),
      ),
      h('div', { class: 'section-title', style: { marginTop: '16px' } }, 'Blocklist'),
      blocklistSection(blocklist, arr, reload),
      h('div', { class: 'section-title', style: { marginTop: '16px' } }, 'Tags'),
      tagsSection(tags, arr, reload),
      h('div', { class: 'section-title', style: { marginTop: '16px' } }, 'Quality profiles'),
      profilesSection(profiles),
    );
  } catch (err) {
    mount(root, empty('', 'Failed to load system info', err.message, { label: 'Retry', onClick: () => tabSystem(root, arr, ctx, kind) }));
  }
}

function infoRow(label, value) {
  return h('div', { class: 'setting-row' }, h('span', { class: 'dim' }, label), h('span', { class: 'right' }, value));
}

function blocklistSection(blocklist, arr, reload) {
  const records = (blocklist && blocklist.records) || [];
  if (!records.length) return h('div', { class: 'dim' }, 'Blocklist is empty.');
  return h('div', { class: 'list' }, ...records.map((b) => h('div', { class: 'row' },
    h('div', { class: 'row-main' },
      h('div', { class: 'row-title', style: { fontSize: '13px' } }, b.sourceTitle || 'Unknown'),
      h('div', { class: 'meta-line', style: { marginTop: '2px' } },
        b.protocol ? h('span', { class: 'pill muted' }, b.protocol) : null,
        b.indexer ? h('span', {}, b.indexer) : null,
        b.date ? timeEl(b.date) : null,
      ),
    ),
    h('div', { class: 'row-actions' }, h('button', { class: 'btn sm danger', onclick: async () => {
      try { await arr.del(`blocklist/${b.id}`); toast('Removed from blocklist', 'success'); reload(); }
      catch (e) { toast(e.message, 'error'); }
    } }, 'Remove')),
  )));
}
function profilesSection(profiles) {
  const list = profiles || [];
  if (!list.length) return h('div', { class: 'dim' }, 'No quality profiles.');
  return h('div', { class: 'list' }, ...list.map((p) => {
    const qualities = [];
    for (const item of (p.items || [])) {
      if (item.quality && item.allowed) qualities.push(item.quality.name);
      else if (item.items) for (const q of item.items) if (q.allowed && q.quality) qualities.push(q.quality.name);
    }
    return h('div', { class: 'row' },
      h('div', { class: 'row-main' },
        h('div', { class: 'row-title', style: { fontSize: '14px' } }, p.name),
        h('div', { class: 'meta-line', style: { marginTop: '2px' } },
          h('span', { class: 'pill info' }, `${qualities.length} qualities`),
          h('span', { class: 'dim' }, qualities.slice(0, 6).join(', ') + (qualities.length > 6 ? '…' : '')),
        ),
      ),
    );
  }));
}


function tagsSection(tags, arr, reload) {
  const list = tags || [];
  const input = h('input', { class: 'input', placeholder: 'New tag label', style: { maxWidth: '220px' } });
  const add = async () => {
    if (!input.value.trim()) return;
    try { await arr.post('tag', { label: input.value.trim() }); toast('Tag added', 'success'); reload(); }
    catch (e) { toast(e.message, 'error'); }
  };
  return h('div', {},
    h('div', { class: 'meta-line', style: { gap: '6px', flexWrap: 'wrap', marginBottom: '10px' } },
      ...list.map((t) => h('span', { class: 'pill muted' }, t.label,
        h('button', { class: 'tag-x', title: 'Delete tag', onclick: async () => {
          try { await arr.del(`tag/${t.id}`); toast('Tag deleted', 'success'); reload(); }
          catch (e) { toast(e.message, 'error'); }
        } }, ' ✕'))),
      list.length ? null : h('span', { class: 'dim' }, 'No tags'),
    ),
    h('div', { class: 'meta-line', style: { gap: '8px' } }, input, h('button', { class: 'btn sm', onclick: add }, 'Add tag')),
  );
}

export async function tabWanted(root, arr, ctx, kind, mode = 'missing') {
  mount(root, skeletonList());
  try {
    const inc = kind === 'series' ? 'includeSeries=true' : 'includeMovie=true';
    const endpoint = mode === 'cutoff' ? 'wanted/cutoff' : 'wanted/missing';
    const data = await arr.get(`${endpoint}?page=1&pageSize=50&sortDirection=descending&${inc}`);
    const records = (data && data.records) || [];
    const seg = (m, label) => h('button', { class: `view-seg ${mode === m ? 'active' : ''}`, onclick: () => { if (mode !== m) tabWanted(root, arr, ctx, kind, m); } }, label);
    const toggle = h('div', { class: 'view-toggle' }, seg('missing', 'Missing'), seg('cutoff', 'Cutoff Unmet'));
    const cmd = kind === 'series'
      ? (mode === 'cutoff' ? 'CutoffUnmetEpisodeSearch' : 'MissingEpisodeSearch')
      : (mode === 'cutoff' ? 'CutoffUnmetMoviesSearch' : 'MissingMoviesSearch');
    const searchAll = h('button', { class: 'btn sm primary', title: 'Search all ' + (mode === 'cutoff' ? 'cutoff-unmet' : 'missing') + ' items', onclick: async () => {
      try { await arr.post('command', { name: cmd }); toast(`Searching all ${mode === 'cutoff' ? 'cutoff-unmet' : 'missing'} items…`, 'success'); }
      catch (e) { toast(e.message, 'error'); }
    } }, '⌕ Search all');
    const head = h('div', { class: 'lib-head', style: { justifyContent: 'space-between', marginBottom: '12px' } }, toggle, searchAll);
    if (!records.length) return mount(root, head, empty('', mode === 'cutoff' ? 'Nothing below cutoff' : 'Nothing missing', 'Everything monitored is satisfied.'));
    mount(root, head, h('div', { class: 'list' }, ...records.map((r) => wantedRow(r, arr, kind))));
  } catch (err) {
    mount(root, empty('', 'Failed to load wanted', err.message, { label: 'Retry', onClick: () => tabWanted(root, arr, ctx, kind, mode) }));
  }
}

function wantedRow(r, arr, kind) {
  const isSeries = kind === 'series';
  const title = isSeries
    ? `${(r.series && r.series.title) || 'Unknown'} · S${String(r.seasonNumber ?? 0).padStart(2, '0')}E${String(r.episodeNumber ?? 0).padStart(2, '0')}`
    : `${r.title || 'Unknown'}${r.year ? ` (${r.year})` : ''}`;
  const search = async () => {
    try {
      if (isSeries) await arr.post('command', { name: 'EpisodeSearch', episodeIds: [r.id] });
      else await arr.post('command', { name: 'MoviesSearch', movieIds: [r.id] });
      toast('Searching…', 'success');
    } catch (e) { toast(e.message, 'error'); }
  };
  return h('div', { class: 'row' },
    h('div', { class: 'row-main' },
      h('div', { class: 'row-title', style: { fontSize: '14px' } }, isSeries ? title : `${r.title || 'Unknown'}`, isSeries ? null : h('span', { class: 'dim' }, r.year ? ` (${r.year})` : '')),
      h('div', { class: 'meta-line', style: { marginTop: '4px' } },
        isSeries && r.title ? h('span', { class: 'dim' }, r.title) : null,
        (isSeries ? r.airDateUtc : (r.inCinemas || r.digitalRelease)) ? timeEl(isSeries ? r.airDateUtc : (r.digitalRelease || r.inCinemas)) : null,
      ),
    ),
    h('div', { class: 'row-actions' }, h('button', { class: 'btn sm', onclick: search }, '⌕ Search')),
  );
}
