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
  catch { cache = {}; }
  return cache;
}
function persist() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(cache, null, 2));
  } catch (e) { console.error('[store] write failed:', e.message); }
}

export function get(ns, def) { const d = load(); return d[ns] === undefined ? def : d[ns]; }
export function set(ns, value) { const d = load(); d[ns] = value; persist(); return value; }
export function update(ns, fn, def) { return set(ns, fn(get(ns, def))); }

// Append to a capped array namespace (newest first).
export function push(ns, item, cap = 200) {
  return update(ns, (arr) => [item, ...(Array.isArray(arr) ? arr : [])].slice(0, cap), []);
}
