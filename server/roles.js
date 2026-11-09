// User roles for "Sign in with Plex".
//
//   admin  everything, including settings, service config, users and deletes
//   user   browse, request, search, grab and manage downloads; no settings,
//          no deletes
//   guest  read-only
//
// Who may sign in, and with which role:
//   1. A UI-managed entry in the data store ("plexUsers") wins.
//   2. Otherwise an entry in config.json auth.plex.allowedUsers is an admin,
//      unless auth.plex.roles[<user>] says otherwise; a user listed only in
//      auth.plex.roles may sign in with that role. This keeps every existing
//      deployment's users at full access.
//   3. Otherwise, with allowAnyPlexUser, anyone gets auth.plex.defaultRole
//      (default guest).
// With allowAnyPlexUser and no users listed anywhere, signed-in users are
// admins, as before roles existed, so nobody is locked out of settings. The
// server logs a warning in that case; add yourself as an admin to fix it.
//
// Enforcement is server-side: every /api request is classified as read, write,
// delete or admin and checked against the caller's role.

export const ROLES = Object.freeze(['admin', 'user', 'guest']);
const LEVELS = { guest: new Set(['read']), user: new Set(['read', 'write']), admin: new Set(['read', 'write', 'delete', 'admin']) };
const STORE_NS = 'plexUsers';
const norm = (v) => String(v || '').toLowerCase().trim();
const validRole = (r) => ROLES.includes(r);

export function permits(role, level) {
  if (level === 'self') return true;
  return !!(LEVELS[role] && LEVELS[role].has(level));
}

export function denialMessage(role, level, method = 'POST') {
  const reading = /^(GET|HEAD)$/i.test(method);
  if (level === 'admin' && reading) return 'Only admins can see this (it contains settings or credentials).';
  if (role === 'guest') return 'Guests have read-only access.';
  if (level === 'delete') return 'Only admins can delete.';
  return 'Only admins can change settings.';
}

// ---------------------------------------------------------------- directory
export function createRoleDirectory(cfg, store = {}) {
  const read = (ns, def) => (typeof store.get === 'function' ? store.get(ns, def) : def);
  const write = (ns, fn, def) => {
    if (typeof store.update === 'function') return store.update(ns, fn, def);
    if (typeof store.set === 'function') return store.set(ns, fn(read(ns, def)));
    throw httpError(500, 'User storage is not available');
  };
  const pcfg = (cfg.auth && cfg.auth.plex) || {};
  const configRoles = () => Object.fromEntries(Object.entries(pcfg.roles || {}).map(([k, v]) => [norm(k), v]).filter(([k, v]) => k && validRole(v)));
  // Anyone in allowedUsers or in roles may sign in.
  const configUsers = () => [...new Set([...(pcfg.allowedUsers || []).map(norm).filter(Boolean), ...Object.keys(configRoles())])];
  const allowAny = () => !!pcfg.allowAnyPlexUser || process.env.PLEX_ALLOW_ANY === 'true';
  const defaultRole = () => (validRole(pcfg.defaultRole) ? pcfg.defaultRole : 'guest');
  const managed = () => {
    const list = read(STORE_NS, []);
    return Array.isArray(list) ? list.filter((u) => u && norm(u.id) && validRole(u.role)) : [];
  };

  function entries() {
    const roles = configRoles();
    const out = new Map();
    for (const id of configUsers()) out.set(id, { id, role: roles[id] || 'admin', source: 'config' });
    for (const u of managed()) {
      const id = norm(u.id);
      const prev = out.get(id);
      out.set(id, { id, role: u.role, source: prev ? 'config' : 'managed', overridden: !!prev, at: u.at || null, by: u.by || null });
    }
    return [...out.values()];
  }

  const hasAdmin = () => entries().some((e) => e.role === 'admin');

  // ids: the Plex username and/or email of the account.
  function lookup(...ids) {
    const keys = ids.map(norm).filter(Boolean);
    if (!keys.length) return null;
    const all = entries();
    const hit = all.find((e) => keys.includes(e.id));
    if (hit) return hit.role;
    if (!configUsers().length && !managed().length) return allowAny() ? (hasAdmin() ? defaultRole() : 'admin') : null;
    if (allowAny()) return defaultRole();
    return null;
  }

  function list() {
    return { users: entries(), allowAny: allowAny(), defaultRole: defaultRole(), hasAdmin: hasAdmin() };
  }

  // Add or change a UI-managed user. `actor` is the admin making the change.
  function setUser(id, role, actor) {
    const key = norm(id);
    if (!key || key.length > 120 || !/^[^\s<>"']+$/.test(key)) throw httpError(400, 'Enter a Plex username or email');
    if (!validRole(role)) throw httpError(400, `Role must be one of: ${ROLES.join(', ')}`);
    if (actor && key === norm(actor) && role !== 'admin') throw httpError(400, 'You cannot remove your own admin role');
    const current = entries().find((e) => e.id === key);
    if (current && current.role === 'admin' && role !== 'admin' && adminCount() <= 1) throw httpError(400, 'At least one admin is required');
    write(STORE_NS, (list) => {
      const next = (Array.isArray(list) ? list : []).filter((u) => norm(u && u.id) !== key);
      next.push({ id: key, role, at: Date.now(), by: actor ? norm(actor) : null });
      return next;
    }, []);
    return list();
  }

  function removeUser(id, actor) {
    const key = norm(id);
    const current = entries().find((e) => e.id === key);
    if (!current) throw httpError(404, 'Unknown user');
    if (actor && key === norm(actor)) throw httpError(400, 'You cannot remove yourself');
    if (current.source === 'config' && !current.overridden) throw httpError(400, 'This user is listed in config.json (auth.plex.allowedUsers); remove them there');
    if (current.role === 'admin' && adminCount() <= 1 && !current.overridden) throw httpError(400, 'At least one admin is required');
    write(STORE_NS, (list) => (Array.isArray(list) ? list : []).filter((u) => norm(u && u.id) !== key), []);
    return list();
  }

  const adminCount = () => entries().filter((e) => e.role === 'admin').length;

  return { lookup, list, setUser, removeUser, hasAdmin, isAllowed: (...ids) => lookup(...ids) !== null };
}

function httpError(status, message) { const e = new Error(message); e.status = status; return e; }

// ------------------------------------------------------- app route levels
const ADMIN_ROUTES = [
  /^\/api\/config\/service(\/|$)/,
  /^\/api\/config\/local-fallback$/, // exports service credentials
  /^\/api\/self-backup(\/|$)/, // backups of Arr Command Center hold every API key
  /^\/api\/login-log$/,
  /^\/api\/diagnostics$/,
  /^\/api\/notify\/channels(\/|$)/,
  /^\/api\/automation(\/|$)/,
  /^\/api\/push\/(prefs|poll|status)$/,
  /^\/api\/plex\/(users|friends|match\/[^/]+)$/,
  /^\/api\/plex\/shares(\/|$)/,
  /^\/api\/media\/[^/]+\/match\/[^/]+$/,
  /^\/api\/plex\/library\/[^/]+\/emptyTrash$/,
  /^\/api\/users(\/|$)/,
  /^\/api\/activity$/,
  /^\/api\/digest(\/|$)/,
  /^\/api\/bot(\/|$)/,
  /^\/api\/backups(\/|$)/,
  /^\/api\/webhooks(\/|$)/,
  /^\/api\/setup(\/|$)/,
  /^\/api\/doctor(\/|$)/,
  /^\/api\/compat(\/|$)/,
];
const SELF_ROUTES = [/^\/api\/push\/(subscribe|unsubscribe|test|public-key)$/, /^\/api\/account(\/|$)/];

export function classifyAppRoute(method, path) {
  const m = String(method || 'GET').toUpperCase();
  if (SELF_ROUTES.some((re) => re.test(path))) return 'self';
  if (ADMIN_ROUTES.some((re) => re.test(path))) {
    // Reading the push prefs is harmless; changing them is global.
    if (path === '/api/push/prefs' && m === 'GET') return 'read';
    return 'admin';
  }
  if (/^\/api\/links(\/|$)/.test(path)) return m === 'GET' ? 'read' : 'admin';
  return m === 'GET' || m === 'HEAD' ? 'read' : 'write';
}

// ---------------------------------------------------- proxied requests
const ARR_TYPES = new Set(['sonarr', 'radarr', 'lidarr', 'readarr', 'bindery', 'prowlarr', 'listenarr', 'whisparr']);
// Arr resources whose GET responses contain secrets (API keys, passwords).
// backup/... is the backup zip itself, which holds the app's config and keys.
const ARR_SECRET_READ = /^(config(\/|$)|downloadclient|indexer(?!stats|status)|notification|importlist|applications|indexerproxy|metadata|system\/backup|backup\/|update|log\/file)/;
// Arr resources that are settings: any change is admin-only.
const ARR_SETTINGS = /^(config|downloadclient|indexer|notification|importlist|applications|indexerproxy|metadata|remotepathmapping|delayprofile|releaseprofile|qualityprofile|qualitydefinition|customformat|rootfolder|autotagging|appprofile|system|update|health)(\/|$)/;
const ADMIN_COMMANDS = /delete|backup|update|restart|shutdown|clear|reset|cleanup/i;

function jsonBody(body) {
  if (!body) return null;
  try {
    const text = Buffer.isBuffer(body) ? body.toString('utf8') : typeof body === 'string' ? body : JSON.stringify(body);
    return text ? JSON.parse(text) : null;
  } catch { return null; }
}

export function classifyProxyRequest(type, method, subPath, query = {}, body = null) {
  const m = String(method || 'GET').toUpperCase();
  const path = String(subPath || '').replace(/^\/+/, '');
  const read = m === 'GET' || m === 'HEAD' || m === 'OPTIONS';
  const q = query || {};
  const lower = path.toLowerCase();

  if (ARR_TYPES.has(type)) {
    const rest = lower.replace(/^api\/v\d+\//, '').replace(/^api\//, '');
    if (read) return ARR_SECRET_READ.test(rest) ? 'admin' : 'read';
    if (m === 'DELETE') return ARR_SETTINGS.test(rest) ? 'admin' : 'delete';
    if (ARR_SETTINGS.test(rest)) return 'admin';
    // Renaming a tag changes it on every item and setting that uses it.
    if (m === 'PUT' && /^tag\/\d+$/.test(rest)) return 'admin';
    if (/^command(\/|$)/.test(rest)) {
      const cmd = jsonBody(body) || {};
      const name = cmd.name || '';
      // Importing files that aren't a tracked download can replace (delete)
      // an existing file, so it needs delete rights. Fixing a stuck download
      // (files carry their downloadId) stays a normal action.
      if (/^manualimport$/i.test(name) && (cmd.files || []).some((f) => !f || !f.downloadId)) return 'delete';
      return ADMIN_COMMANDS.test(name) ? 'admin' : 'write';
    }
    return 'write';
  }

  switch (type) {
    case 'overseerr': {
      const rest = lower.replace(/^api\/v1\//, '');
      if (/^settings(\/|$)/.test(rest)) return 'admin';
      if (read) return 'read';
      if (/^request\/\d+\/(approve|decline)$/.test(rest)) return 'admin';
      if (/^user(\/|$)/.test(rest)) return 'admin';
      if (m === 'DELETE') return 'delete';
      return 'write';
    }
    case 'bazarr': {
      const rest = lower.replace(/^api\//, '');
      if (/^system\/(settings|backups?|logs)/.test(rest)) return 'admin';
      if (read) return 'read';
      if (/^system(\/|$)/.test(rest) && !/^system\/tasks$/.test(rest)) return 'admin';
      if (/^providers(\/|$)/.test(rest)) return 'admin';
      if (m === 'DELETE') return 'delete';
      return 'write';
    }
    case 'sabnzbd': {
      const mode = String(q.mode || '').toLowerCase();
      const name = String(q.name || '').toLowerCase();
      if (/^(get_config|set_config|set_config_default|del_config|config|restart|shutdown|restart_repair|set_apikey|set_nzbkey|regenerate_certs|create_backup|delete_orphan|disconnect)$/.test(mode)) return 'admin';
      if (mode === 'delete' || name === 'delete' || name === 'purge' || name === 'delete_nzf') return 'delete';
      if ((mode === 'queue' || mode === 'history' || mode === 'warnings') && !name) return 'read';
      if (/^(version|fullstatus|status|server_stats|get_cats|get_scripts|get_files|auth|qstatus|watched_now|rss_now|eval_sort|browse)$/.test(mode)) return mode === 'watched_now' || mode === 'rss_now' ? 'write' : 'read';
      return 'write';
    }
    case 'qbittorrent': {
      const rest = lower.replace(/^api\/v2\//, '');
      if (/^app\/(version|webapiversion|buildinfo|defaultsavepath)$/.test(rest)) return 'read';
      if (/^(app|auth)\//.test(rest)) return 'admin';
      if (/^torrents\/delete$/.test(rest)) return 'delete';
      return read ? 'read' : 'write';
    }
    case 'transmission': {
      if (read) return 'read';
      const rpc = String((jsonBody(body) || {}).method || '');
      if (/^(torrent-get|session-get|session-stats|free-space|port-test|group-get)$/.test(rpc)) return 'read';
      if (rpc === 'torrent-remove') return 'delete';
      if (/^(session-set|session-close|blocklist-update|group-set)$/.test(rpc)) return 'admin';
      return 'write';
    }
    case 'deluge': {
      if (read) return 'read';
      const rpc = String((jsonBody(body) || {}).method || '');
      if (/^core\.remove_torrents?$/.test(rpc)) return 'delete';
      if (/(set_config|get_config|shutdown|change_password|plugin|^web\.(connect|disconnect|add_host|remove_host|edit_host|start_daemon|stop_daemon)|^auth\.)/.test(rpc)) return 'admin';
      if (/^(web\.(update_ui|get_\w+|connected)|core\.get_\w+|daemon\.(info|get_method_list))$/.test(rpc)) return 'read';
      return 'write';
    }
    case 'nzbget': {
      if (read && !/jsonrpc/.test(lower)) return 'read';
      const b = jsonBody(body) || {};
      const rpc = String(b.method || '').toLowerCase();
      if (/^(version|status|listgroups|history|log|loadlog|listfiles|servervolumes|sysinfo|systemhealth)$/.test(rpc)) return 'read';
      if (/^(config|loadconfig|saveconfig|configtemplates|shutdown|reload|writelog|clearlog|resetservervolume|testserver)$/.test(rpc)) return 'admin';
      if (rpc === 'editqueue' && /delete/i.test(String((b.params || [])[0] || ''))) return 'delete';
      if (!rpc) return read ? 'read' : 'write';
      return 'write';
    }
    case 'flood': {
      const rest = lower.replace(/^api\//, '');
      if (/^(auth|settings|client\/settings|feed-monitor)(\/|$)/.test(rest)) return read && rest.startsWith('feed-monitor') ? 'read' : 'admin';
      if (read) return 'read';
      if (/^torrents\/delete$/.test(rest) || m === 'DELETE') return 'delete';
      return 'write';
    }
    case 'tautulli': {
      const cmd = String(q.cmd || '').toLowerCase();
      if (cmd === 'get_settings' || cmd === 'get_apikey') return 'admin';
      if (!cmd || /^(get_\w+|arnold|status|server_status|docs|docs_md|search|pms_image_proxy)$/.test(cmd)) return read ? 'read' : 'write';
      if (/^delete_/.test(cmd)) return 'delete';
      return 'admin'; // terminate_session, refresh, notify, settings, restart, …
    }
    case 'jellyfin':
    case 'emby': {
      if (/^(system\/(configuration|logs)|auth\/keys|startup|environment)/.test(lower)) return 'admin';
      // Playback Reporting's raw SQL endpoint and Identify (re-matching) are admin-only.
      if (/^(emby\/)?(user_usage_stats(\/|$)|items\/remotesearch\/apply)/.test(lower)) return 'admin';
      if (read) return 'read';
      if (/^(users|system|auth|plugins|packages|repositories|scheduledtasks|devices|notifications\/admin)(\/|$)/.test(lower)) return 'admin';
      if (/^sessions\/[^/]+\/(playing|system|command)/.test(lower)) return 'admin';
      if (m === 'DELETE') return 'delete';
      return 'write';
    }
    case 'tdarr': {
      if (read) return 'read';
      const b = jsonBody(body) || {};
      const mode = String((b.data && b.data.mode) || '');
      if (/cruddb$/.test(lower)) {
        if (/^(getAll|getById|count|getByKey)$/i.test(mode)) return 'read';
        if (/^remove/i.test(mode)) return 'delete';
      }
      if (/search-db|get-nodes|status/.test(lower)) return 'read';
      if (/update-node|settings|kill|restart/.test(lower)) return 'admin';
      return 'write';
    }
    case 'indexer':
      return read ? 'read' : 'write';
    case 'portainer': {
      // Read-only integration (the proxy refuses writes outright). Container
      // inspect, logs and settings can expose secrets, so they are admin-only.
      if (!read) return 'admin';
      if (/^api\/(settings|users|teams|registries|motd|backup|auth|webhooks|endpoints\/\d+\/docker\/(containers\/[^/]+\/(json|logs|archive|export)|configs|secrets|info|system))/.test(lower)) return 'admin';
      return 'read';
    }
    case 'glances':
      return read ? 'read' : 'admin';
    case 'unraid': {
      // Only queries reach Unraid (the proxy refuses mutations).
      const doc = jsonBody(body) || {};
      const q = typeof doc.query === 'string' ? doc.query.replace(/#[^\n]*/g, '') : '';
      if (m === 'POST' && lower.replace(/\/+$/, '') === 'graphql' && q && !/\b(mutation|subscription)\b/i.test(q)) {
        // API keys and SSO settings are admin-only even to read.
        return /\b(apiKeys?|apiKeyPossible|getApiKeyCreationFormSchema|config|ssoSettings|oidc)\b/.test(q) ? 'admin' : 'read';
      }
      return 'admin';
    }
    case 'truenas':
      return 'admin';
    case 'pihole': {
      // Settings, sessions, backups and logs are admin-only; turning blocking
      // off (or any other change) is an admin action too.
      const rest = lower.replace(/^api\//, '');
      if (/^(config|auth|teleporter|action|logs)(\/|$)/.test(rest)) return 'admin';
      return read ? 'read' : 'admin';
    }
    case 'adguard': {
      const rest = lower.replace(/^control\//, '');
      if (/^(tls|access|dns_info|profile)(\/|$)/.test(rest)) return 'admin';
      return read ? 'read' : 'admin'; // protection toggle, filters, settings
    }
    case 'syncthing': {
      const rest = lower.replace(/^rest\//, '');
      if (/^(config|system\/(config|debug|log|shutdown|restart|upgrade|reset|pause|resume|error\/clear)|svc\/(deviceid|random)|debug)/.test(rest)) return read && /^config\/(folders|devices)$/.test(rest) ? 'read' : 'admin';
      if (read) return 'read';
      if (/^db\/(scan|override|revert|prio)/.test(rest)) return 'write';
      return 'admin';
    }
    case 'navidrome': {
      const view = lower.replace(/^rest\//, '').replace(/\.view$/, '');
      if (/^(ping|getlicense|getscanstatus|getartists|getartist|getalbum|getalbumlist2?|getnowplaying|getmusicfolders|getgenres|search3|getcoverart|getplaylists|getplaylist|getsong|getrandomsongs|getstarred2?)$/.test(view)) return 'read';
      if (/^startscan$/.test(view)) return 'write';
      return 'admin';
    }
    case 'unpackerr': {
      const rest = lower.replace(/^api\//, '');
      // Config, logs, file browsing and auth are settings-level.
      if (/^(config|logs|browse|auth|system\/export)(\/|$)/.test(rest)) return 'admin';
      if (read) return 'read';
      if (rest === 'queue/retry') return 'write';
      if (/^(queue\/forget|history\/(delete|clear))$/.test(rest)) return 'delete';
      return 'admin';
    }
    case 'speedtest': {
      const rest = lower.replace(/^api\/v1\//, '');
      if (read) return /^(settings|users|tokens)/.test(rest) ? 'admin' : 'read';
      if (rest === 'speedtests/run') return 'write';
      return 'admin';
    }
    case 'pulsarr': {
      const rest = lower.replace(/^v1\//, '');
      if (read) return /^(config|api-keys|users|webhooks|notifications)/.test(rest) ? 'admin' : 'read';
      if (/^approval\/requests\/[^/]+\/(approve|reject)$/.test(rest) || /^approval\/requests\/bulk/.test(rest)) return 'admin';
      if (m === 'DELETE') return 'delete';
      return 'admin';
    }
    default: {
      if (/(^|\/)(settings|config|users?|api-?keys?|apikey|notifications?\/(agents|settings)|system)(\/|$)/.test(lower)) return read && !/(settings|config|api-?keys?|apikey)/.test(lower) ? 'read' : 'admin';
      if (read) return 'read';
      if (m === 'DELETE') return 'delete';
      return 'write';
    }
  }
}
