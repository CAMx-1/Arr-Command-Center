// Settings → You → "Settings on every device": the per-device switch for
// settings that follow you (prefSync.js).
import { h, mount, toast, fmtRelative } from './ui.js';
import { api } from './api.js';
import { syncOffHere, setSyncHere, onSyncStatus } from './prefSync.js';

export function prefSyncSummary() {
  return api.getJson('/api/account/prefs').then((d) => (!d.available ? 'Needs a sign-in' : syncOffHere() ? 'Off on this device' : `On · ${d.who}`));
}

export function prefSyncCard() {
  const card = h('div', { class: 'card', id: 'pref-sync-panel' }, h('div', { class: 'dim' }, 'Loading…'));
  const paint = (d) => {
    if (!d.available) { mount(card, h('p', { class: 'dim settings-copy', style: { margin: 0 } }, d.reason)); return; }
    const off = syncOffHere();
    const sw = h('input', { type: 'checkbox', role: 'switch', checked: off ? null : 'checked', 'aria-label': 'Use the same settings on every device', onchange: async () => {
      sw.disabled = true;
      try { await setSyncHere(sw.checked); toast(sw.checked ? 'This device uses the settings saved to your account again' : 'This device keeps its own settings now', 'success'); }
      catch (e) { toast(e.message, 'error'); }
      load();
    } });
    const whose = d.who === 'the shared sign-in' ? 'the shared sign-in' : `your account (${d.who})`;
    mount(card,
      h('label', { style: { display: 'flex', gap: '8px', alignItems: 'center', fontSize: '14px', fontWeight: '600' } }, sw, 'Use the same settings on every device I sign in on'),
      h('p', { class: 'dim settings-copy', style: { margin: '8px 0 0' } }, `Saved to ${whose} on this server: theme, colour and density; pinned, ordered and hidden services; Home workspaces; and list or hexagon views. Turning it off only changes this device, which then keeps its own settings.`),
      h('p', { class: 'dim', style: { fontSize: '12px', margin: '6px 0 0' } }, off ? 'Off on this device.' : d.at ? `Last saved ${fmtRelative(d.at)}.` : 'Nothing saved yet.'));
  };
  const load = () => api.getJson('/api/account/prefs').then(paint).catch((e) => mount(card, h('p', { class: 'dim' }, e.message)));
  load();
  // Repaint when this browser saves (the "last saved" line), while shown.
  let shown = false;
  const stop = onSyncStatus(() => { if (card.isConnected) { shown = true; load(); } else if (shown) stop(); });
  return card;
}
