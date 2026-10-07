// Tiny JSON-file data store for app-level persistence (custom links, login log,
// captured Plex token, etc.). No external dependencies; writes to data/store.json.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const FILE = path.join(DATA_DIR, 'store.json');

let cache = null;
function load() {
  if (cache) return cache;
  try { cache = JSON.parse(fs.readFileSync(FILE, 'utf8')); }
  catch (e) {
    // If the file exists but is unreadable/corrupt, preserve it (back it up)
    // instead of silently overwriting all data (VAPID keys, push subs, token)
    // with an empty store on the next write.
    try {
      if (e.code !== 'ENOENT' && fs.existsSync(FILE) && fs.statSync(FILE).size > 0) {
        const bak = `${FILE}.corrupt-${Date.now()}`;
        fs.renameSync(FILE, bak);
        console.error(`[store] ${FILE} was corrupt; backed up to ${bak}`);
      }
    } catch { /* best effort */ }
    cache = {};
  }
  return cache;
}
let failing = false; // log a failure streak once, not on every write
function persist() {
  try {
    writeFileAtomic(FILE, JSON.stringify(cache, null, 2));
    if (failing) { failing = false; console.log('[store] writes recovered'); }
  } catch (e) {
    if (!failing) { failing = true; console.error(`[store] write failed (further failures suppressed until recovery): ${e.message}`); }
  }
}

// Write `data` to `file` without risking a truncated file on crash: write a
// uniquely named temp file next to it, then rename over the target. The unique
// name matters on Docker Desktop for macOS, whose file sharing can get stuck
// on a single cached name (a fixed "store.json.tmp" failed with ENOENT on every
// write for days while any other name worked). If the temp+rename path fails,
// fall back to writing the file in place so data still persists.
export function writeFileAtomic(file, data) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}.tmp`);
  try {
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, file);
  } catch (e) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* ignore */ }
    try { fs.writeFileSync(file, data); } catch { throw e; } // in-place fallback
  }
}

export function get(ns, def) { const d = load(); return d[ns] === undefined ? def : d[ns]; }
export function set(ns, value) { const d = load(); d[ns] = value; persist(); return value; }
export function update(ns, fn, def) { return set(ns, fn(get(ns, def))); }

// Append to a capped array namespace (newest first).
export function push(ns, item, cap = 200) {
  return update(ns, (arr) => [item, ...(Array.isArray(arr) ? arr : [])].slice(0, cap), []);
}
