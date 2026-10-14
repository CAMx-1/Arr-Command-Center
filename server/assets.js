// Build-versioned frontend assets.
//
// The app shell (index.html) is served fresh on every load, but it references
// JS/CSS under /b/<assetId>/..., which are immutable and cached for a year by
// browsers and WKWebView. assetId is a hash of every file's path, size and
// mtime, so any change produces new URLs: a new deploy can never run a mix of
// old and new modules (the reason assets used to be no-store), yet relaunches
// load the whole UI from the HTTP cache instead of ~90 sequential requests.
//
// index.html also gets <link rel="modulepreload"> for the full static import
// graph, so a cold load fetches modules in parallel instead of import-by-import.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const ASSET_PREFIX = '/b/';
const VERSIONED_EXT = /\.(js|css|mjs)$/i;
const IMPORT_RE = /(?:^|[;\s])(?:import|export)\s+(?:[^'"`;]*?\sfrom\s+)?['"](\.{1,2}\/[^'"]+)['"]/g;

function walk(dir, base = dir, out = []) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, base, out);
    else out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out;
}

// Hash of (path, size, mtime) for every file under dir. Cheap enough to
// recompute (stat only); content changes always bump size or mtime in practice.
export function computeAssetId(dir) {
  const hash = createHash('sha1');
  for (const rel of walk(dir).sort()) {
    try {
      const st = fs.statSync(path.join(dir, rel));
      hash.update(`${rel}\0${st.size}\0${Math.floor(st.mtimeMs)}\n`);
    } catch { /* vanished mid-walk */ }
  }
  return hash.digest('hex').slice(0, 12);
}

// Static relative import graph reachable from entry (paths relative to dir).
export function moduleGraph(dir, entry = 'app.js') {
  const seen = new Set();
  const queue = [entry];
  while (queue.length) {
    const rel = queue.shift();
    if (seen.has(rel)) continue;
    let src;
    try { src = fs.readFileSync(path.join(dir, rel), 'utf8'); } catch { continue; }
    seen.add(rel);
    for (const m of src.matchAll(IMPORT_RE)) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(rel), m[1]));
      if (!target.startsWith('..') && !seen.has(target)) queue.push(target);
    }
  }
  return [...seen];
}

// Rewrite root-relative JS/CSS references in index.html to the versioned
// prefix and add modulepreload hints for the module graph.
export function renderShell(html, assetId, modules = []) {
  const base = `${ASSET_PREFIX}${assetId}/`;
  let out = html.replace(/(\s(?:src|href)=")\/([^"/][^"]*\.(?:js|css))"/g, (_, attr, p) => `${attr}${base}${p}"`);
  const preload = modules.filter((m) => m !== 'app.js')
    .map((m) => `  <link rel="modulepreload" href="${base}${m}" />`).join('\n');
  if (preload) out = out.replace('</head>', `${preload}\n</head>`);
  return out;
}

// Express wiring: returns { assetId(), shell(), middleware } where middleware
// serves /b/<id>/<file>. Current-id requests are immutable; any other id gets
// the current file uncached (an old document's late request still works but
// can't pin a stale copy).
export function createAssetServer(publicDir, { ttlMs = 2000 } = {}) {
  let cached = { at: 0, id: null, shell: null };
  const refresh = () => {
    const now = Date.now();
    if (cached.id && now - cached.at < ttlMs) return cached;
    const id = computeAssetId(publicDir);
    if (id !== cached.id || !cached.shell) {
      let html = '';
      try { html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8'); } catch { /* missing */ }
      cached = { at: now, id, shell: renderShell(html, id, moduleGraph(publicDir)) };
    } else cached.at = now;
    return cached;
  };
  const root = path.resolve(publicDir);
  function middleware(req, res, next) {
    if (!req.path.startsWith(ASSET_PREFIX)) return next();
    const m = /^\/b\/([a-f0-9]{6,40})\/(.+)$/.exec(req.path);
    if (!m) return res.status(404).end();
    const file = path.resolve(root, decodeURIComponent(m[2]));
    if (!file.startsWith(root + path.sep) || !VERSIONED_EXT.test(file)) return res.status(404).end();
    const current = m[1] === refresh().id;
    res.setHeader('Cache-Control', current ? 'private, max-age=31536000, immutable' : 'no-store');
    // Never fall through to the SPA route: an HTML body under a .js URL breaks
    // module loading in confusing ways. Missing assets are plain 404s.
    res.sendFile(file, { dotfiles: 'deny', lastModified: !current, etag: !current }, (err) => {
      if (err && !res.headersSent) res.status(err.status || 404).end();
    });
  }
  return { assetId: () => refresh().id, shell: () => refresh().shell, middleware };
}
