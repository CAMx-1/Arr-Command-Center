// Compatibility check: for each configured service, its version and a quick
// read-only call to each API the newer tools use, so you know which tools
// will work with your versions before you rely on them. Only GET requests:
// nothing is changed, nothing is searched (no indexer hits), nothing is sent.
import { serviceGet as defaultGet, qbitApi as defaultQbit } from './proxy.js';
import { plexCompat } from './plex.js';

export const TOOLS = [
  { id: 'push', name: 'Send search results to an app', where: 'Indexer and Prowlarr → Search' },
  { id: 'tidy', name: 'Tidy up', where: 'Sonarr and Radarr → System; Lidarr and Readarr, top bar' },
  { id: 'collections', name: 'Complete your collections', where: 'Radarr → System' },
  { id: 'subtitles', name: 'Missing subtitles', where: 'Bazarr → Wanted' },
  { id: 'transcodes', name: 'Titles that always transcode', where: 'Tautulli, Jellyfin, Emby → Transcodes' },
  { id: 'wrong', name: 'Wrong matches', where: 'Plex, Jellyfin, Emby → Wrong matches' },
  { id: 'missing', name: 'Missing from Plex', where: 'Plex → Missing from Plex' },
  { id: 'plexServer', name: 'Plex server and sharing', where: 'Plex → Server; Friends & sharing' },
  { id: 'hooks', name: 'Instant updates (webhooks)', where: 'Settings → Services' },
  { id: 'seeding', name: 'Seeding clean-up', where: 'qBittorrent → Seeding clean-up' },
  { id: 'doctor', name: 'Setup doctor', where: 'Settings → Services' },
  { id: 'forecast', name: 'Disk-full forecast', where: 'Home; System → Disk space' },
  { id: 'planner', name: 'Free up space', where: 'Home; System' },
];
const ARR_V = { sonarr: 'v3', radarr: 'v3', whisparr: 'v3', lidarr: 'v1', readarr: 'v1' };

// "4.3.2" >= "4.3.0"? Ignores a leading "v" and anything after the numbers.
export function atLeast(version, min) {
  const p = (v) => String(v || '').replace(/^v/i, '').split(/[^0-9]+/).filter(Boolean).map(Number);
  const a = p(version); const b = p(min);
  if (!a.length) return null;
  for (let i = 0; i < b.length; i++) { const x = a[i] || 0; if (x !== b[i]) return x > b[i]; }
  return true;
}
const attempt = (p) => p.then((d) => ({ ok: true, d }), (e) => ({ ok: false, e }));
const why = (r) => (r.e && r.e.status === 404 ? 'not found (older version?)' : (r.e && r.e.message) || 'failed');
const check = (tool, ok, note) => ({ tool, ok, note });

async function arrChecks(svc, get) {
  const v = ARR_V[svc.type];
  const status = await get(svc, `api/${v}/system/status`);
  const g = (p) => attempt(get(svc, `api/${v}/${p}`));
  const [qp, rf, ds, sch, dc, rpm, dcfg, tag, mm, col] = await Promise.all([
    g('qualityprofile'), g('rootfolder'), g('diskspace'), g('notification/schema'), g('downloadclient'), g('remotepathmapping'), g('config/downloadclient'),
    g('tag'), g('config/mediamanagement'), svc.type === 'radarr' ? g('collection') : Promise.resolve(null)]);
  const out = [check('push', true, `Takes releases through its ${v} release/push API`)];
  out.push(qp.ok && rf.ok ? check('tidy', true, 'Library, profiles and root folders readable') : check('tidy', false, `Couldn’t read ${!qp.ok ? 'quality profiles' : 'root folders'}: ${why(qp.ok ? rf : qp)}`));
  if (col) out.push(col.ok ? check('collections', true, `${(col.d || []).length} collections`) : check('collections', false, col.e && col.e.status === 404 ? 'Needs Radarr 4.2 or newer (collections)' : why(col)));
  const hook = sch.ok && (sch.d || []).some((x) => x.implementation === 'Webhook');
  out.push(hook ? check('hooks', true, 'The webhook can be added for you') : check('hooks', false, sch.ok ? 'No Webhook connection type' : why(sch)));
  const missing = [[dc, 'download clients'], [rpm, 'remote path mappings'], [dcfg, 'download client settings']].filter(([r]) => !r.ok).map(([, n]) => n);
  out.push(missing.length ? check('doctor', 'partly', `Couldn’t read ${missing.join(', ')}`) : check('doctor', true, `${(dc.d || []).length} download ${(dc.d || []).length === 1 ? 'client' : 'clients'}, ${(rpm.d || []).length} path ${(rpm.d || []).length === 1 ? 'mapping' : 'mappings'}`));
  out.push(!ds.ok ? check('forecast', false, `Couldn’t read disk space: ${why(ds)}`) : (ds.d || []).length ? check('forecast', true, `${ds.d.length} ${ds.d.length === 1 ? 'disk' : 'disks'} reported`) : check('forecast', null, 'Reports no disks'));
  if (svc.type === 'sonarr' || svc.type === 'radarr') {
    out.push(!(tag.ok && mm.ok) ? check('planner', false, `Couldn’t read ${!tag.ok ? 'tags' : 'media management'}`) : check('planner', true, mm.d && mm.d.recycleBin ? `Recycle Bin: ${mm.d.recycleBin}` : 'No Recycle Bin: deleted files are gone for good'));
  }
  return { version: status.version || null, checks: out };
}

async function plexChecks(cfg) {
  const c = await plexCompat(cfg);
  const out = [];
  if (c.guids == null) out.push(check('wrong', null, 'No titles to check yet'));
  else if (c.guids.withIds) out.push(check('wrong', true, 'Titles carry TMDB/TVDB ids'));
  else out.push(check('wrong', false, c.guids.legacy ? 'This library uses Plex’s legacy agents, which don’t store TMDB/TVDB ids. Switch it to the Plex Movie / Plex TV Series agent (library ⋯ → Edit → Advanced).' : 'Titles have no TMDB/TVDB ids'));
  out.push(c.locations ? check('missing', true, `${c.sections} ${c.sections === 1 ? 'library' : 'libraries'} with folders`) : check('missing', false, 'Plex didn’t list its library folders'));
  out.push(c.owner === true ? check('plexServer', true, 'Libraries and sharing (the token is the owner’s)') : check('plexServer', 'partly', `Scan, refresh and empty trash work; sharing needs the server owner’s Plex token${c.ownerError ? ` (${c.ownerError.replace(/^plex\.tv: /, 'plex.tv said: ')})` : ''}`));
  return { version: c.version, checks: out };
}

async function mediaChecks(svc, get) {
  const info = await get(svc, 'System/Info');
  const [items, pr] = await Promise.all([
    attempt(get(svc, 'Items?Recursive=true&IncludeItemTypes=Movie,Series&Fields=ProviderIds,Path&Limit=5')),
    attempt(get(svc, 'user_usage_stats/type_filter_list')),
  ]);
  const list = items.ok ? ((items.d && items.d.Items) || []) : null;
  const out = [];
  if (!list) out.push(check('wrong', false, why(items)));
  else if (!list.length) out.push(check('wrong', null, 'No titles to check yet'));
  else out.push(list.some((x) => x.Path) ? check('wrong', true, 'Titles have folders and provider ids') : check('wrong', false, 'The server didn’t return file paths'));
  out.push(pr.ok ? check('transcodes', true, 'Playback Reporting is installed') : check('transcodes', false, pr.e && pr.e.status === 404 ? 'Install the Playback Reporting plugin (Dashboard → Plugins → Catalog)' : why(pr)));
  return { version: info.Version || null, checks: out };
}

const taut = (svc, get, cmd, qs = '') => get(svc, `api/v2?cmd=${cmd}${qs}`).then((d) => { const r = d && d.response; if (!r || r.result === 'error') throw new Error((r && r.message) || 'error'); return r.data; });
async function tautulliChecks(svc, get) {
  const info = await taut(svc, get, 'get_tautulli_info').catch(() => null);
  const hist = await taut(svc, get, 'get_history', '&length=25');
  const rows = (hist && hist.data) || [];
  const out = [check('hooks', true, 'Add the webhook in Tautulli (steps in Instant updates)')];
  if (!rows.length) out.push(check('transcodes', null, 'No plays yet to check'));
  else {
    const row = rows.find((r) => r.transcode_decision === 'transcode') || rows[0];
    const sd = await attempt(taut(svc, get, 'get_stream_data', `&row_id=${encodeURIComponent(row.id ?? row.row_id)}`));
    out.push(sd.ok && sd.d && (sd.d.video_decision || sd.d.stream_video_codec || sd.d.transcode_decision) ? check('transcodes', true, 'Stream details are kept for plays') : check('transcodes', 'partly', 'Titles are listed, but reasons need Tautulli’s stream details, which it doesn’t have for recent plays'));
  }
  const libs = await attempt(taut(svc, get, 'get_libraries'));
  const sec = libs.ok ? (libs.d || []).find((l) => l.section_type === 'movie' || l.section_type === 'show') : null;
  const media = sec ? await attempt(taut(svc, get, 'get_library_media_info', `&section_id=${encodeURIComponent(sec.section_id)}&length=1`)) : null;
  out.push(media && media.ok ? check('planner', true, 'Plays per title are available') : check('planner', false, libs.ok ? 'Couldn’t read library media info' : why(libs)));
  return { version: (info && info.tautulli_version) || null, checks: out };
}

async function bazarrChecks(svc, get) {
  const st = await get(svc, 'api/system/status');
  const [ep, mv] = await Promise.all([attempt(get(svc, 'api/episodes/wanted?start=0&length=1')), attempt(get(svc, 'api/movies/wanted?start=0&length=1'))]);
  const n = (r) => (r.ok ? Number((r.d && r.d.total) ?? ((r.d && r.d.data) || []).length) : null);
  return { version: (st && st.data && st.data.bazarr_version) || null, checks: [ep.ok && mv.ok ? check('subtitles', true, `Wanted lists readable (${n(ep)} episodes, ${n(mv)} movies)`) : check('subtitles', false, `Couldn’t read the wanted ${!ep.ok ? 'episodes' : 'movies'}: ${why(ep.ok ? mv : ep)}`)] };
}

async function qbitChecks(svc, key, qbit) {
  const version = await qbit(svc, key, 'app/version');
  const [list, prefs] = await Promise.all([attempt(qbit(svc, key, 'torrents/info?filter=completed&limit=5')), attempt(qbit(svc, key, 'app/preferences'))]);
  const out = [];
  if (!list.ok) out.push(check('seeding', false, why(list)), check('doctor', false, why(list)));
  else {
    const t = list.d || [];
    out.push(t.length && t.some((x) => x.seeding_time == null) ? check('seeding', 'partly', 'This version doesn’t report seeding time; days count from when each torrent finished') : check('seeding', true, 'Ratio and seeding time reported'));
    out.push(check('doctor', true, 'Torrent folders and categories readable'));
  }
  if (!prefs.ok) out.push(check('hooks', false, why(prefs)));
  else {
    const p = prefs.d || {};
    const busy = p.autorun_enabled && p.autorun_program && !String(p.autorun_program).includes('/api/hooks/');
    if (!('autorun_program' in p)) out.push(check('hooks', false, 'No “run external program” setting in this version'));
    else if (busy) out.push(check('hooks', 'partly', 'It already runs another program when a torrent finishes; add the command to it yourself'));
    else out.push(check('hooks', true, 'autorun_on_torrent_added_program' in p ? 'Can be set up for finished and added torrents' : 'Can be set up for finished torrents (4.6+ also does added ones)'));
  }
  return { version: String(version || '').trim() || null, checks: out };
}

async function sabChecks(svc, get) {
  const v = await get(svc, 'api?mode=version&output=json');
  const version = (v && v.version) || null;
  const hist = await attempt(get(svc, 'api?mode=history&limit=1&output=json'));
  const slots = hist.ok ? ((hist.d && hist.d.history && hist.d.history.slots) || []) : null;
  const apprise = atLeast(version, '4.3.0');
  return { version, checks: [
    apprise ? check('hooks', true, 'Apprise is built in') : check('hooks', false, apprise === false ? 'Needs SABnzbd 4.3 or newer (Apprise)' : 'Couldn’t read the version'),
    !slots ? check('doctor', false, why(hist)) : !slots.length ? check('doctor', null, 'No finished downloads to check yet') : slots[0].storage ? check('doctor', true, 'Download folders readable') : check('doctor', 'partly', 'History doesn’t say where downloads were saved'),
  ] };
}

async function prowlarrChecks(svc, get) {
  const st = await get(svc, 'api/v1/system/status');
  const [apps, idx, sch] = await Promise.all([attempt(get(svc, 'api/v1/applications')), attempt(get(svc, 'api/v1/indexer')), attempt(get(svc, 'api/v1/notification/schema'))]);
  return { version: st.version || null, checks: [
    check('push', true, 'Search results are sent to the apps through this server'),
    apps.ok && idx.ok ? check('doctor', true, `${(idx.d || []).length} indexers, ${(apps.d || []).length} apps`) : check('doctor', false, why(apps.ok ? idx : apps)),
    sch.ok && (sch.d || []).some((x) => x.implementation === 'Webhook') ? check('hooks', true, 'The webhook can be added for you') : check('hooks', false, sch.ok ? 'No Webhook connection type' : why(sch)),
  ] };
}

async function seerrChecks(svc, get) {
  const st = await get(svc, 'api/v1/status');
  const rq = await attempt(get(svc, 'api/v1/request?take=1'));
  return { version: st.version || null, checks: [check('hooks', true, 'Add the webhook in Seerr (steps in Instant updates)'), rq.ok ? check('planner', true, 'Shows who asked for each title') : check('planner', false, why(rq))] };
}

async function maintainerrChecks(svc, get) {
  let st = await get(svc, 'api/app/status');
  if (typeof st === 'string') { try { st = JSON.parse(st); } catch { st = {}; } }
  const ex = await attempt(get(svc, 'api/rules/exclusion'));
  return { version: (st && st.version) || null, checks: [ex.ok ? check('planner', true, 'Exclusions and “leaving soon” are respected') : check('planner', false, why(ex))] };
}

const RUNNERS = {
  sonarr: arrChecks, radarr: arrChecks, whisparr: arrChecks, lidarr: arrChecks, readarr: arrChecks,
  jellyfin: mediaChecks, emby: mediaChecks, tautulli: tautulliChecks, bazarr: bazarrChecks, sabnzbd: sabChecks,
  prowlarr: prowlarrChecks, overseerr: seerrChecks, maintainerr: maintainerrChecks,
};

// Tool status from its checks: ready, partly, no, unknown (nothing to check
// yet) or off (no service it uses is set up), plus what else it needs.
export function summarize(services) {
  const has = (types) => services.some((s) => types.includes(s.type) && s.reachable);
  return TOOLS.map((t) => {
    const items = services.flatMap((s) => s.checks.filter((c) => c.tool === t.id).map((c) => ({ key: s.key, label: s.label, ok: c.ok, note: c.note })));
    const needs = [];
    if ((t.id === 'wrong' || t.id === 'missing') && !has(['sonarr', 'radarr'])) needs.push('Sonarr or Radarr');
    if (t.id === 'planner' && items.length && !has(['tautulli'])) needs.push('Tautulli, to know what nobody watched (without it, only size counts)');
    let status;
    if (!items.length) status = 'off';
    else if (items.every((i) => i.ok === true)) status = 'ready';
    else if (items.some((i) => i.ok === true || i.ok === 'partly')) status = 'partly';
    else if (items.every((i) => i.ok === null)) status = 'unknown';
    else status = 'no';
    if (status === 'ready' && needs.length && t.id !== 'planner') status = 'partly';
    return { ...t, status, items, needs };
  });
}

export async function runCompat(cfg, { get = defaultGet, qbit = defaultQbit, canSee = () => true, plexCheck = () => plexChecks(cfg) } = {}) {
  const entries = Object.entries(cfg.services || {}).filter(([k, s]) => s.enabled !== false && canSee(k) && (RUNNERS[s.type] || s.type === 'qbittorrent' || s.type === 'plex'));
  const services = await Promise.all(entries.map(async ([key, s]) => {
    const base = { key, label: s.label || key, type: s.type };
    try {
      const r = s.type === 'qbittorrent' ? await qbitChecks(s, key, qbit) : s.type === 'plex' ? await plexCheck() : await RUNNERS[s.type](s, get);
      return { ...base, reachable: true, version: r.version, checks: r.checks };
    } catch (e) {
      const reason = e.status === 401 || e.status === 403 ? 'the API key was refused' : e.message || 'no answer';
      return { ...base, reachable: false, version: null, error: reason, checks: TOOL_IDS[s.type] ? TOOL_IDS[s.type].map((tool) => check(tool, false, `Not reachable: ${reason}`)) : [] };
    }
  }));
  services.sort((a, b) => a.label.localeCompare(b.label));
  const tools = summarize(services);
  return { at: Date.now(), services, tools, counts: { ready: tools.filter((t) => t.status === 'ready').length, used: tools.filter((t) => t.status !== 'off').length } };
}

// The tools each service type feeds, for unreachable services.
const ARR_TOOLS = ['push', 'tidy', 'hooks', 'doctor', 'forecast'];
const TOOL_IDS = {
  sonarr: [...ARR_TOOLS, 'planner'], radarr: [...ARR_TOOLS, 'collections', 'planner'], whisparr: ARR_TOOLS, lidarr: ARR_TOOLS, readarr: ARR_TOOLS,
  plex: ['wrong', 'missing', 'plexServer'], jellyfin: ['wrong', 'transcodes'], emby: ['wrong', 'transcodes'], tautulli: ['hooks', 'transcodes', 'planner'],
  bazarr: ['subtitles'], qbittorrent: ['seeding', 'doctor', 'hooks'], sabnzbd: ['hooks', 'doctor'], prowlarr: ['push', 'doctor', 'hooks'], overseerr: ['hooks', 'planner'], maintainerr: ['planner'],
};
