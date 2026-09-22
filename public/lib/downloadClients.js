// Normalized adapters for RPC download clients. Wire formats stay here; the
// shared view consumes only normalized session/item fields and action methods.

const MIB = 1024 * 1024;
const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));
const first = (obj, ...keys) => keys.map((key) => obj?.[key]).find((value) => value !== undefined && value !== null);

export function rpcState(state, { stalled = false, error = '' } = {}) {
  if (error) return { state: 'error', stateLabel: 'Error', stateClass: 'down' };
  const value = String(state || '').toLowerCase();
  if (stalled || value.includes('stalled')) return { state: 'stalled', stateLabel: 'Stalled', stateClass: 'warn' };
  if (value.includes('fail') || value.includes('error')) return { state: 'error', stateLabel: 'Failed', stateClass: 'down' };
  if (value.includes('pause') || value === 'stopped') return { state: 'paused', stateLabel: 'Paused', stateClass: 'warn' };
  if (value.includes('seed') || value.includes('success') || value.includes('complete') || value.includes('finished')) return { state: 'completed', stateLabel: value.includes('seed') ? 'Seeding' : 'Completed', stateClass: 'ok' };
  if (value.includes('download') || value.includes('fetch')) return { state: 'downloading', stateLabel: 'Downloading', stateClass: 'info' };
  if (value.includes('check') || value.includes('verify') || value.includes('repair') || value.includes('unpack') || value.includes('move')) return { state: 'checking', stateLabel: String(state).replaceAll('_', ' '), stateClass: 'muted' };
  return { state: 'queued', stateLabel: state ? String(state).replaceAll('_', ' ') : 'Queued', stateClass: 'muted' };
}

function transmissionState(status) {
  return ({ 0: 'stopped', 1: 'queued verify', 2: 'checking', 3: 'queued', 4: 'downloading', 5: 'queued seed', 6: 'seeding' })[Number(status)] || String(status || 'queued');
}

export function normalizeTransmissionTorrent(raw = {}) {
  const progress = clamp(first(raw, 'percentDone', 'percent_done'), 0, 1);
  const error = first(raw, 'errorString', 'error_string') || (Number(raw.error) ? `Error ${raw.error}` : '');
  const stateInfo = rpcState(transmissionState(raw.status), { stalled: !!first(raw, 'isStalled', 'is_stalled'), error });
  const size = Number(first(raw, 'totalSize', 'total_size', 'sizeWhenDone', 'size_when_done')) || 0;
  const left = Number(first(raw, 'leftUntilDone', 'left_until_done')) || 0;
  return {
    id: String(first(raw, 'hashString', 'hash_string', 'id') ?? ''), rawId: raw.id,
    name: raw.name || 'Unnamed torrent', ...stateInfo, progress,
    size, sizeDone: Math.max(0, size - left), sizeLeft: left,
    dlSpeed: Number(first(raw, 'rateDownload', 'rate_download')) || 0,
    upSpeed: Number(first(raw, 'rateUpload', 'rate_upload')) || 0,
    eta: Number(raw.eta) || 0, category: (raw.labels || [])[0] || '',
    seeds: undefined, leechs: Number(first(raw, 'peersConnected', 'peers_connected')) || 0,
    ratio: Number(first(raw, 'uploadRatio', 'upload_ratio')) || 0,
    failMessage: error, completed: progress >= 1,
    canPause: stateInfo.state !== 'paused', canResume: stateInfo.state === 'paused', history: false,
  };
}

export function normalizeDelugeTorrent(id, raw = {}) {
  const progress = clamp(raw.progress, 0, 100) / 100;
  const stateInfo = rpcState(raw.state, { stalled: !!raw.is_stalled, error: raw.message || '' });
  const size = Number(raw.total_size) || 0;
  const done = Number(raw.total_done) || size * progress;
  return {
    id: String(id), name: raw.name || 'Unnamed torrent', ...stateInfo, progress,
    size, sizeDone: done, sizeLeft: Math.max(0, size - done),
    dlSpeed: Number(raw.download_payload_rate) || 0, upSpeed: Number(raw.upload_payload_rate) || 0,
    eta: Number(raw.eta) || 0, category: raw.label || '', seeds: Number(raw.num_seeds) || 0,
    leechs: Number(raw.num_peers) || 0, ratio: Number(raw.ratio) || 0,
    failMessage: raw.message || '', completed: !!raw.is_finished || progress >= 1,
    canPause: stateInfo.state !== 'paused', canResume: stateInfo.state === 'paused', history: false,
  };
}

export function nzbBytes(raw, prefix) {
  const mb = Number(raw?.[`${prefix}MB`]);
  if (Number.isFinite(mb)) return mb * MIB;
  const lo = Number(raw?.[`${prefix}Lo`]) >>> 0;
  const hi = Number(raw?.[`${prefix}Hi`]) >>> 0;
  return hi * 4294967296 + lo;
}

export function normalizeNzbgetGroup(raw = {}, downloadRate = 0) {
  const size = nzbBytes(raw, 'FileSize');
  const left = nzbBytes(raw, 'RemainingSize');
  const progress = size > 0 ? clamp((size - left) / size, 0, 1) : 0;
  const stateInfo = rpcState(raw.Status);
  return {
    id: String(raw.NZBID ?? raw.ID ?? ''), rawId: Number(raw.NZBID ?? raw.ID),
    name: raw.NZBName || raw.Name || 'Unnamed download', ...stateInfo, progress,
    size, sizeDone: Math.max(0, size - left), sizeLeft: left,
    dlSpeed: Number(downloadRate) || 0, upSpeed: 0,
    eta: downloadRate > 0 ? Math.round(left / downloadRate) : 0,
    category: raw.Category || '', priority: raw.MaxPriority,
    completed: false, canPause: stateInfo.state !== 'paused', canResume: stateInfo.state === 'paused', history: false,
  };
}

export function normalizeNzbgetHistory(raw = {}) {
  const status = raw.Status || '';
  const stateInfo = rpcState(status, { error: /FAILURE|WARNING/i.test(status) ? status : '' });
  return {
    id: String(raw.NZBID ?? raw.ID ?? ''), rawId: Number(raw.NZBID ?? raw.ID),
    name: raw.Name || raw.NZBName || 'History item', ...stateInfo, progress: 1,
    size: nzbBytes(raw, 'FileSize'), sizeDone: nzbBytes(raw, 'FileSize'), sizeLeft: 0,
    dlSpeed: 0, upSpeed: 0, eta: 0, category: raw.Category || '',
    completedAt: Number(raw.HistoryTime) || 0,
    failMessage: /FAILURE|WARNING/i.test(status) ? status.replace('/', ': ') : '',
    completed: true, canPause: false, canResume: false, history: true,
  };
}

function transmissionAdapter(api, key) {
  const rpc = api.transmission(key);
  const fields = ['id', 'hashString', 'name', 'status', 'percentDone', 'rateDownload', 'rateUpload', 'eta', 'totalSize', 'leftUntilDone', 'uploadRatio', 'error', 'errorString', 'isStalled', 'peersConnected', 'labels'];
  return {
    type: 'transmission', protocol: 'torrent', tabs: [{ id: 'active', label: 'Downloading' }, { id: 'completed', label: 'Completed' }],
    capabilities: { upload: true, pauseItem: true, deleteData: true, speed: true },
    async load(tab) {
      const [torrentData, stats, settings] = await Promise.all([rpc.call('torrent-get', { fields }), rpc.call('session-stats'), rpc.call('session-get')]);
      const all = (torrentData.torrents || []).map(normalizeTransmissionTorrent);
      const items = tab === 'completed' ? all.filter((item) => item.completed) : all.filter((item) => !item.completed);
      return { items, all, session: {
        paused: Number(first(stats, 'pausedTorrentCount', 'paused_torrent_count')) === Number(first(stats, 'torrentCount', 'torrent_count')) && Number(first(stats, 'torrentCount', 'torrent_count')) > 0,
        dlSpeed: Number(first(stats, 'downloadSpeed', 'download_speed')) || 0,
        upSpeed: Number(first(stats, 'uploadSpeed', 'upload_speed')) || 0,
        activeCount: Number(first(stats, 'activeTorrentCount', 'active_torrent_count')) || 0,
        dlLimit: (Number(first(settings, 'speed-limit-down', 'speed_limit_down')) || 0) * 1024,
        upLimit: (Number(first(settings, 'speed-limit-up', 'speed_limit_up')) || 0) * 1024,
      } };
    },
    pauseAll: () => rpc.call('torrent-stop', {}), resumeAll: () => rpc.call('torrent-start', {}),
    pauseItem: (item) => rpc.call('torrent-stop', { ids: [item.id] }), resumeItem: (item) => rpc.call('torrent-start', { ids: [item.id] }),
    remove: (item, { deleteData = false } = {}) => rpc.call('torrent-remove', { ids: [item.id], 'delete-local-data': !!deleteData }),
    setSpeed: ({ downloadKiB = 0, uploadKiB = 0 }) => rpc.call('session-set', { 'speed-limit-down': Number(downloadKiB) || 0, 'speed-limit-down-enabled': Number(downloadKiB) > 0, 'speed-limit-up': Number(uploadKiB) || 0, 'speed-limit-up-enabled': Number(uploadKiB) > 0 }),
  };
}

function delugeAdapter(api, key) {
  const rpc = api.deluge(key);
  const fields = ['name', 'state', 'progress', 'total_size', 'total_done', 'download_payload_rate', 'upload_payload_rate', 'eta', 'ratio', 'num_seeds', 'num_peers', 'label', 'is_finished', 'is_stalled', 'message'];
  return {
    type: 'deluge', protocol: 'torrent', tabs: [{ id: 'active', label: 'Downloading' }, { id: 'completed', label: 'Completed' }],
    capabilities: { upload: true, pauseItem: true, deleteData: true, speed: true },
    async load(tab) {
      const [ui, paused, limits] = await Promise.all([
        rpc.call('web.update_ui', [fields, {}]), rpc.call('core.is_session_paused'), rpc.call('core.get_config_values', [['max_download_speed', 'max_upload_speed']]),
      ]);
      if (ui?.connected === false) throw new Error('Deluge Web is not connected to a daemon');
      const all = Object.entries(ui?.torrents || {}).map(([id, torrent]) => normalizeDelugeTorrent(id, torrent));
      const items = tab === 'completed' ? all.filter((item) => item.completed) : all.filter((item) => !item.completed);
      return { items, all, session: {
        paused: !!paused, dlSpeed: Number(ui?.stats?.download_rate) || 0, upSpeed: Number(ui?.stats?.upload_rate) || 0,
        activeCount: all.filter((item) => item.dlSpeed > 0 || item.upSpeed > 0).length,
        freeSpace: Number(ui?.stats?.free_space) || 0,
        dlLimit: Number(limits?.max_download_speed) > 0 ? Number(limits.max_download_speed) * 1024 : 0,
        upLimit: Number(limits?.max_upload_speed) > 0 ? Number(limits.max_upload_speed) * 1024 : 0,
      } };
    },
    pauseAll: () => rpc.call('core.pause_session'), resumeAll: () => rpc.call('core.resume_session'),
    pauseItem: (item) => rpc.call('core.pause_torrent', [item.id]), resumeItem: (item) => rpc.call('core.resume_torrent', [item.id]),
    remove: (item, { deleteData = false } = {}) => rpc.call('core.remove_torrent', [item.id, !!deleteData]),
    setSpeed: ({ downloadKiB = 0, uploadKiB = 0 }) => rpc.call('core.set_config', [{ max_download_speed: Number(downloadKiB) > 0 ? Number(downloadKiB) : -1, max_upload_speed: Number(uploadKiB) > 0 ? Number(uploadKiB) : -1 }]),
  };
}

function nzbgetAdapter(api, key) {
  const rpc = api.nzbget(key);
  return {
    type: 'nzbget', protocol: 'usenet', tabs: [{ id: 'queue', label: 'Queue' }, { id: 'history', label: 'History' }],
    capabilities: { upload: false, pauseItem: true, deleteData: false, speed: true },
    async load(tab) {
      const status = await rpc.call('status');
      const dlSpeed = Number(status.DownloadRate) || nzbBytes(status, 'DownloadRate');
      const raw = tab === 'history' ? await rpc.call('history', [false]) : await rpc.call('listgroups', [0]);
      const items = (raw || []).map((item) => tab === 'history' ? normalizeNzbgetHistory(item) : normalizeNzbgetGroup(item, dlSpeed));
      return { items, all: items, session: {
        paused: !!status.DownloadPaused, dlSpeed, upSpeed: 0, activeCount: tab === 'history' ? 0 : items.filter((item) => item.state === 'downloading').length,
        dlLimit: Number(status.DownloadLimit) || nzbBytes(status, 'DownloadLimit'), upLimit: 0,
        freeSpace: nzbBytes(status, 'FreeDiskSpace'), remaining: nzbBytes(status, 'RemainingSize'),
      } };
    },
    pauseAll: () => rpc.call('pausedownload'), resumeAll: () => rpc.call('resumedownload'),
    pauseItem: (item) => rpc.call('editqueue', ['GroupPause', '', [item.rawId]]),
    resumeItem: (item) => rpc.call('editqueue', ['GroupResume', '', [item.rawId]]),
    remove: (item) => rpc.call('editqueue', [item.history ? 'HistoryDelete' : 'GroupDelete', '', [item.rawId]]),
    setSpeed: ({ downloadKiB = 0 }) => rpc.call('rate', [Number(downloadKiB) || 0]),
  };
}

export function downloadClientFor(api, service) {
  if (service?.type === 'transmission') return transmissionAdapter(api, service.key);
  if (service?.type === 'deluge') return delugeAdapter(api, service.key);
  if (service?.type === 'nzbget') return nzbgetAdapter(api, service.key);
  throw new Error(`Unsupported download client: ${service?.type || 'unknown'}`);
}
