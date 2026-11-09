// "Confirm it's you" before deleting files or changing roles, for accounts
// with two-factor on: the session must have confirmed (a code, a recovery
// code or a passkey) in the last 10 minutes. Signing in with two-factor
// counts. Accounts without two-factor, and setups without Sign in with Plex,
// aren't asked (there's nothing to confirm with).

const ARR = new Set(['sonarr', 'radarr', 'whisparr', 'lidarr', 'readarr', 'bindery']);
const truthy = (v) => v === true || /^(true|1|yes)$/i.test(String(v ?? '').trim());

function text(body) {
  if (body == null) return '';
  if (Buffer.isBuffer(body)) return body.toString('utf8');
  return typeof body === 'string' ? body : JSON.stringify(body);
}
function json(body) { try { const t = text(body); return t ? JSON.parse(t) : null; } catch { return null; } }
function form(body) { try { return Object.fromEntries(new URLSearchParams(text(body))); } catch { return {}; } }

// Does this proxied request delete files from disk (not just an entry)?
export function deletesFiles(type, method, subPath, query = {}, body = null) {
  const m = String(method || 'GET').toUpperCase();
  const lower = String(subPath || '').replace(/^\/+/, '').toLowerCase();
  const q = query || {};
  if (ARR.has(type)) {
    const rest = lower.replace(/^api\/v\d+\//, '').replace(/^api\//, '');
    if (m === 'DELETE') {
      if (/^(series|movie|artist|author|book)\/\d+$/.test(rest)) return truthy(q.deleteFiles);
      if (/^(series|movie|artist|author|book)\/editor$/.test(rest)) return truthy((json(body) || {}).deleteFiles);
      // Removing a file entry deletes the file (or moves it to the Recycle Bin).
      if (/^(episodefile|moviefile|trackfile|bookfile)(\/(\d+|bulk))?$/.test(rest)) return true;
      return false;
    }
    // Importing files that aren't a tracked download can replace an existing file.
    if (m === 'POST' && /^command$/.test(rest)) {
      const cmd = json(body) || {};
      return /^manualimport$/i.test(cmd.name || '') && (cmd.files || []).some((f) => !f || !f.downloadId);
    }
    return false;
  }
  switch (type) {
    case 'qbittorrent': return /^api\/v2\/torrents\/delete$/.test(lower) && truthy(form(body).deleteFiles);
    case 'transmission': { const b = json(body) || {}; return b.method === 'torrent-remove' && truthy((b.arguments || {})['delete-local-data']); }
    case 'deluge': { const b = json(body) || {}; return /^core\.remove_torrents?$/.test(String(b.method || '')) && (b.params || [])[1] === true; }
    case 'flood': return /^api\/torrents\/delete$/.test(lower) && truthy((json(body) || {}).deleteData);
    case 'sabnzbd': {
      const mode = String(q.mode || '').toLowerCase(); const name = String(q.name || '').toLowerCase();
      return (mode === 'queue' || mode === 'history') && name === 'delete' && truthy(q.del_files);
    }
    // Deleting an item in Jellyfin/Emby deletes its media files.
    case 'jellyfin': case 'emby': return m === 'DELETE' && /^(emby\/)?items(\/[^/]+)?$/.test(lower);
    case 'audiobookshelf': return m === 'DELETE' && /^api\/items\/[^/]+$/.test(lower) && truthy(q.hard);
    default: return false;
  }
}

export function createStepUp(plexAuth) {
  const needed = (req) => !!(plexAuth.enabled && req.plexUser && plexAuth.twoFactorOn(req.plexUser) && !plexAuth.recentlyVerified(req));
  const denial = (doing) => ({ status: 403, error: `Confirm it’s you before ${doing}.`, needsVerification: true });
  return {
    needed,
    // For the proxy's authorize hook: null to allow, or the denial.
    proxy(req, svc, subPath) {
      return svc && deletesFiles(svc.type, req.method, subPath, req.query, req.body) && needed(req) ? denial('deleting files') : null;
    },
    // Express middleware for changes under a route (reads pass).
    app(doing) {
      return (req, res, next) => {
        if (/^(GET|HEAD|OPTIONS)$/i.test(req.method) || !needed(req)) return next();
        res.locals.needsVerification = true;
        const d = denial(doing);
        return res.status(d.status).json({ error: d.error, needsVerification: true });
      };
    },
  };
}
