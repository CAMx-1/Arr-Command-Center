// Uptime bars (last 24h) for service cards, fed by /api/uptime.
import { h, mount } from './ui.js';

let cache = { at: 0, data: null, inflight: null };
export async function loadUptime() {
  if (cache.data && Date.now() - cache.at < 30000) return cache.data;
  if (cache.inflight) return cache.inflight;
  cache.inflight = fetch('/api/uptime?days=1').then((r) => (r.ok ? r.json() : {})).catch(() => ({}))
    .then((d) => { cache = { at: Date.now(), data: d, inflight: null }; return d; });
  return cache.inflight;
}

export function uptimeBar(u) {
  if (!u) return h('div', { class: 'uptime dim' }, 'Uptime: collecting…');
  const pctTxt = `${u.uptime % 1 ? u.uptime.toFixed(1) : u.uptime}%`;
  const bars = u.bars.map((b, i) => h('span', { class: `uptime-cell ${b == null ? 'none' : b ? 'up' : 'down'}`, title: `${24 - i}h ago${b == null ? ' · not tracked' : b ? ' · up' : ' · had downtime'}` }));
  return h('div', { class: 'uptime', title: `Uptime over the last ${Math.round(u.tracked / 3600000) || '<1'} h` },
    h('div', { class: 'uptime-bars', role: 'img', 'aria-label': `Uptime ${pctTxt} over 24 hours` }, ...bars),
    h('span', { class: `uptime-pct ${u.uptime >= 99 ? 'ok' : u.uptime >= 90 ? 'warn' : 'down'}` }, pctTxt));
}

// Fill every [data-uptime-key] slot under root.
export async function hydrateUptime(root) {
  const slots = root.querySelectorAll('[data-uptime-key]');
  if (!slots.length) return;
  const data = await loadUptime();
  slots.forEach((el) => mount(el, uptimeBar(data[el.dataset.uptimeKey])));
}
