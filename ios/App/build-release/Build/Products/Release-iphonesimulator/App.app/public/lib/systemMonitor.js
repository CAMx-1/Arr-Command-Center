// Preferences for the optional Overview "system monitor" hexes (CPU/memory,
// per-disk usage, network throughput). Opt-in and persisted in localStorage.
const KEY = 'acc:sysmon';
// diskPaths: null = show every reported disk; an array = show only those paths.
const DEFAULTS = { enabled: false, cpu: true, memory: true, disk: true, network: true, diskPaths: null };

const storageFor = (storage) => storage || globalThis.localStorage;

export function getSysmonPrefs(storage) {
  try {
    const v = JSON.parse(storageFor(storage).getItem(KEY) || 'null');
    return v && typeof v === 'object' ? { ...DEFAULTS, ...v } : { ...DEFAULTS };
  } catch { return { ...DEFAULTS }; }
}

export function setSysmonPrefs(patch, storage) {
  const next = { ...getSysmonPrefs(storage), ...(patch || {}) };
  try { storageFor(storage).setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ }
  return next;
}

export function sysmonEnabled(storage) { return !!getSysmonPrefs(storage).enabled; }

// Whether a given disk path should be shown. null selection => show all.
export function diskVisible(path, prefs) {
  const sel = prefs && prefs.diskPaths;
  return !Array.isArray(sel) || sel.includes(path);
}
