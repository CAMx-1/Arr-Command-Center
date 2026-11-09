// Settings → Services → "Instant updates": the webhook address for each app,
// one-click setup for Sonarr/Radarr/etc., and steps for Seerr and Tautulli.
import { h, mount, toast, fmtRelative, copyable } from './ui.js';
import { api } from './api.js';

const BASE_KEY = 'acc:webhook-base';
const ARR = new Set(['sonarr', 'radarr', 'lidarr', 'readarr', 'whisparr', 'prowlarr', 'qbittorrent']);
// Same as server/webhooks.js (qBittorrent's command passes no torrent details).
const qbitCmd = (url, event) => `curl -fsS -m 10 -X POST "${url}?event=${event}"`;
const qbitWget = (url, event) => `wget -q -O /dev/null --post-data= "${url}?event=${event}"`;
const apprise = (url) => { try { const u = new URL(url); return `${u.protocol === 'https:' ? 'jsons' : 'json'}://${u.host}${u.pathname}`; } catch { return url; } };
const TAUTULLI_JSON = '{"event": "{action}", "title": "{title}", "user": "{username}"}';

export function webhooksCard() {
  const card = h('div', { class: 'card', id: 'webhooks-panel' }, h('div', { class: 'dim' }, 'Loading…'));
  const baseInput = h('input', { class: 'input', type: 'url', value: localStorage.getItem(BASE_KEY) || location.origin, placeholder: 'http://192.168.1.10:7373', style: { flex: '1', minWidth: '220px' } });
  baseInput.addEventListener('change', () => { try { localStorage.setItem(BASE_KEY, baseInput.value.trim()); } catch { /* ignore */ } load(); });
  const base = () => baseInput.value.trim().replace(/\/+$/, '');
  async function load() {
    let d;
    try { d = await api.getJson('/api/webhooks'); } catch (e) { mount(card, h('div', { class: 'dim' }, e.message)); return; }
    const row = (hk) => {
      const url = `${base()}${hk.path}`;
      const install = ARR.has(hk.type) ? h('button', { class: 'btn sm primary', onclick: async () => {
        install.disabled = true;
        try {
          const r = await api.sendJson(`/api/webhooks/${encodeURIComponent(hk.key)}/install`, { baseUrl: base() });
          if (hk.type === 'qbittorrent') toast(`${hk.label} now calls this server when a torrent is ${r.events.join(' and when one is ')}${r.busy && r.busy.length ? ` (it already runs another program when a torrent is ${r.busy.join(', ')}, so that one was left alone)` : ''}`, 'success', 7000);
          else toast(r.already ? `${hk.label} already has it` : r.updated ? `Updated the webhook in ${hk.label}` : `Added a webhook to ${hk.label} (Settings → Connect)`, 'success', 5000);
        }
        catch (e) { toast(`${hk.label}: ${e.message}`, 'error', 10000); }
        install.disabled = false;
      } }, `Add to ${hk.label}`) : null;
      const rotate = h('button', { class: 'btn sm', title: 'Make a new secret address (the old one stops working)', onclick: async () => {
        if (rotate.dataset.armed !== '1') { rotate.dataset.armed = '1'; rotate.textContent = 'New address?'; return; }
        try { await api.sendJson(`/api/webhooks/${encodeURIComponent(hk.key)}/rotate`, {}); toast(`New address for ${hk.label}. Update it in the app.`, 'warn', 6000); await load(); card.dispatchEvent(new CustomEvent('sx:refresh', { bubbles: true })); } catch (e) { toast(e.message, 'error'); }
      } }, 'New address');
      const code = (t) => h('span', { class: 'mono', style: { wordBreak: 'break-all' } }, copyable(t, t));
      const steps = hk.type === 'sabnzbd'
        ? h('div', { class: 'dim', style: { fontSize: '12px', marginTop: '4px' } }, 'In SABnzbd (4.3 or newer): Config → Notifications → Apprise. Tick Enable, put this in the URLs box: ', code(apprise(url)), ', tick Job finished, Job failed and Added NZB, Save, then press Test Notification.')
        : hk.type === 'qbittorrent'
          ? h('div', { class: 'dim', style: { fontSize: '12px', marginTop: '4px' } }, '“Add to” fills in Options → Downloads → Run external program, unless qBittorrent already runs a program there. To add it yourself, on torrent finished: ', code(qbitCmd(url, 'finished')),
            ' and on torrent added (qBittorrent 4.6+): ', code(qbitCmd(url, 'added')), '. Without curl in the qBittorrent container, use ', code(qbitWget(url, 'finished')), '.')
        : hk.type === 'overseerr'
        ? h('div', { class: 'dim', style: { fontSize: '12px', marginTop: '4px' } }, 'In Seerr: Settings → Notifications → Webhook. Paste the address as Webhook URL, tick the notification types you want, leave the JSON payload as it is, and save.')
        : hk.type === 'tautulli'
          ? h('div', { class: 'dim', style: { fontSize: '12px', marginTop: '4px' } }, 'In Tautulli: Settings → Notification Agents → Add → Webhook. Paste the address, method POST. Under Triggers tick Playback Start/Stop/Pause/Resume; under Data, use this JSON body for each: ', h('code', { class: 'mono' }, TAUTULLI_JSON))
          : null;
      return h('div', { class: 'row', style: { alignItems: 'flex-start' } },
        h('div', { class: 'row-main' },
          h('div', { class: 'row-title', style: { fontSize: '14px' } }, hk.label, ' ', hk.lastAt ? h('span', { class: 'pill ok' }, `last event ${fmtRelative(hk.lastAt)}${hk.lastEvent ? ` · ${hk.lastEvent}` : ''}`) : h('span', { class: 'pill muted' }, 'nothing received yet')),
          h('div', { class: 'mono', style: { fontSize: '11px', wordBreak: 'break-all', marginTop: '4px' } }, copyable(url, url)),
          steps),
        h('div', { class: 'row-actions', style: { flexWrap: 'wrap' } }, install, rotate));
    };
    mount(card,
      h('p', { class: 'dim', style: { fontSize: '13px', margin: '0 0 10px' } }, 'Apps can tell Arr Command Center the moment something happens, so open pages update and notifications go out straight away instead of on the next check (up to a minute). Each address contains a secret, so treat it like a password.'),
      h('label', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', fontSize: '13px', marginBottom: '10px' } }, h('span', {}, 'Address the apps use to reach this server'), baseInput),
      d.hooks.length ? h('div', { class: 'list' }, ...d.hooks.map(row)) : h('div', { class: 'dim' }, 'Add Sonarr, Radarr, Seerr, Tautulli, SABnzbd or qBittorrent first.'),
      h('p', { class: 'dim', style: { fontSize: '12px', marginTop: '10px' } }, 'If you use Cloudflare Access or a login in front of this server, let /api/hooks/ through, or use the server’s local address here.'));
  }
  load();
  return card;
}
