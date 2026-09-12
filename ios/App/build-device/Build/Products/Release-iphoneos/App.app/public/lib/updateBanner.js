// Build-aware update handling. The authenticated config response identifies the
// server build that supplied this page; a persisted previous build lets a cold
// client detect deployments instead of treating the newest /api/version value
// as its baseline.

import { h } from './ui.js';
import { api } from './api.js';

const LOADED_BUILD_KEY = 'acc:loaded-build';
const REFRESH_ATTEMPT_KEY = 'acc:build-refresh-attempt';

export function versionChanged(baseline, current) {
  if (baseline == null || current == null) return false;
  return String(baseline) !== String(current);
}

let _baseline = null;
let _shown = false;
let _timer = null;

async function fetchVersion() {
  try {
    const res = await api.version();
    return res && res.version != null ? String(res.version) : null;
  } catch { return null; }
}

function cacheBustedReload(build) {
  try {
    if (build) localStorage.setItem(LOADED_BUILD_KEY, String(build));
    const u = new URL(location.href);
    u.searchParams.set('acc_build', String(build || Date.now()));
    location.replace(u.toString());
  } catch { location.reload(); }
}

function showBanner(current) {
  if (_shown) return;
  const el = document.getElementById('update-banner');
  if (!el) return;
  el.textContent = '';
  el.appendChild(h('span', { class: 'update-banner-text' }, 'A new version is ready.'));
  el.appendChild(h('button', {
    class: 'btn sm primary hex-btn', type: 'button',
    onclick: () => cacheBustedReload(current),
  }, 'Refresh now'));
  el.classList.remove('hidden');
  el.classList.add('show');
  _shown = true;
}

// `loadedBuild` comes from /api/config and therefore represents the server
// deployment supplying the live authenticated app. Perform at most one
// automatic cache-busted reload for each new build, then use the visible banner
// for any later deployment detected while the app remains open.
export async function initUpdateBanner({ loadedBuild = null, intervalMs = 60000, poll = true } = {}) {
  const current = loadedBuild == null ? await fetchVersion() : String(loadedBuild);
  let previous = null; let attempted = null;
  try { previous = localStorage.getItem(LOADED_BUILD_KEY); attempted = sessionStorage.getItem(REFRESH_ATTEMPT_KEY); } catch { /* ignore */ }
  if (versionChanged(previous, current) && attempted !== current) {
    try { sessionStorage.setItem(REFRESH_ATTEMPT_KEY, current); } catch { /* ignore */ }
    cacheBustedReload(current);
    return { refreshed: true, previous, current };
  }
  try { if (current) localStorage.setItem(LOADED_BUILD_KEY, current); } catch { /* ignore */ }
  _baseline = current || await fetchVersion();
  if (!poll) return { refreshed: false, previous, current: _baseline };
  const period = Math.max(15000, intervalMs);
  _timer = setInterval(async () => {
    const latest = await fetchVersion();
    if (versionChanged(_baseline, latest)) { showBanner(latest); if (_timer) clearInterval(_timer); }
  }, period);
  return { refreshed: false, previous, current: _baseline };
}
