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
function persist() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    // Atomic write: write to a temp file then rename, so a crash mid-write can't
    // truncate/corrupt the store.
    const tmp = `${FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(cache, null, 2));
    fs.renameSync(tmp, FILE);
  } catch (e) { console.error('[store] write failed:', e.message); }
}

export function get(ns, def) { const d = load(); return d[ns] === undefined ? def : d[ns]; }
export function set(ns, value) { const d = load(); d[ns] = value; persist(); return value; }
export function update(ns, fn, def) { return set(ns, fn(get(ns, def))); }

// Append to a capped array namespace (newest first).
export function push(ns, item, cap = 200) {
  return update(ns, (arr) => [item, ...(Array.isArray(arr) ? arr : [])].slice(0, cap), []);
}
