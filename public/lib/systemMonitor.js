// Preferences for the optional Overview "system monitor" hexes (CPU/memory,
// per-disk usage, network throughput). Opt-in and persisted in localStorage.
const KEY = 'acc:sysmon';
const DEFAULTS = { enabled: false, cpu: true, memory: true, disk: true, network: true };

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
