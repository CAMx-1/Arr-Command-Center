// Update banner: polls the backend build identity (/api/version) and shows a
// visible "Reload" banner when the server reports a different build than the
// one this page loaded with (i.e. a new version was deployed).

import { h } from './ui.js';
import { api } from './api.js';

// Pure decision helper (unit-tested): prompt only when we have both a baseline
// and a current value and they differ.
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

function showBanner() {
  if (_shown) return;
  const el = document.getElementById('update-banner');
  if (!el) return;
  el.textContent = '';
  el.appendChild(h('span', { class: 'update-banner-text' }, 'A new version is available.'));
  el.appendChild(h('button', {
    class: 'btn sm primary hex-btn',
    type: 'button',
    onclick: () => { try { location.reload(); } catch { /* ignore */ } },
  }, 'Reload'));
  el.classList.remove('hidden');
  el.classList.add('show');
  _shown = true;
}

// Start polling. Captures the current build identity as the baseline, then
// re-checks every `intervalMs` (min 15s) and reveals the banner on a change.
export async function initUpdateBanner({ intervalMs = 60000, poll = true } = {}) {
  _baseline = await fetchVersion();
  if (!poll) return;
  const period = Math.max(15000, intervalMs);
  const tick = async () => {
    const current = await fetchVersion();
    if (versionChanged(_baseline, current)) { showBanner(); if (_timer) clearInterval(_timer); }
  };
  _timer = setInterval(tick, period);
  if (_timer && _timer.unref) { /* keep default in browsers */ }
}
