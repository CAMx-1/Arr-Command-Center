// Setup wizard: find apps on the network, ask only for each one's key (or
// login), check it, and save it as a service. Opens from Settings → Services
// ("Find services") and on first run when nothing is set up yet.
import { h, mount, toast, openModal, closeModal, copyable } from './ui.js';
import { api } from './api.js';
import { isLocalMode } from './connections.js';

const LOGIN = new Set(['transmission', 'nzbget', 'flood', 'navidrome', 'glances']);
const PASSWORD_ONLY = new Set(['deluge']);
const NO_KEY = new Set(['maintainerr']);
const OPTIONAL_KEY = new Set(['qbittorrent', 'syncthing', 'plex']);
const WHERE = {
  sonarr: 'Sonarr → Settings → General → API Key', radarr: 'Radarr → Settings → General → API Key', lidarr: 'Lidarr → Settings → General → API Key',
  readarr: 'Readarr → Settings → General → API Key', prowlarr: 'Prowlarr → Settings → General → API Key', whisparr: 'Whisparr → Settings → General → API Key',
  bazarr: 'Bazarr → Settings → General → API Key', tautulli: 'Tautulli → Settings → Web Interface → API Key', overseerr: 'Seerr → Settings → General → API Key',
  sabnzbd: 'SABnzbd → Config → General → API Key', jellyfin: 'Jellyfin → Dashboard → API Keys → +', emby: 'Emby → Settings → API Keys → New',
  plex: 'Leave blank if you use Sign in with Plex. Otherwise your Plex token (X-Plex-Token): Plex Web → any item → Get Info → View XML.',
  qbittorrent: 'qBittorrent 5.2+: Options → Web UI → API key. Older versions: leave blank and use the WebUI login below.',
  audiobookshelf: 'Audiobookshelf → Settings → API Keys', autobrr: 'autobrr → Settings → API keys', portainer: 'Portainer → My account → Access tokens',
  syncthing: 'Syncthing → Actions → Settings → General → API Key', deluge: 'The Deluge Web UI password', transmission: 'Only if RPC login is turned on',
  nzbget: 'NZBGet ControlUsername and ControlPassword', navidrome: 'A Navidrome user', glances: 'Only if Glances runs with --password', flood: 'Your Flood login',
};

export function setupNeeded(state) {
  if (isLocalMode()) return false; // the iOS local-only mode sets up connections itself
  return !!(state && state.config && !state.config.mock && !(state.services || []).length && (state.config.auth || {}).role !== 'user' && (state.config.auth || {}).role !== 'guest');
}

export async function openSetupWizard(ctx, { firstRun = false } = {}) {
  let net = { subnets: [], demo: false, canSave: true };
  try { net = await api.getJson('/api/setup/networks'); } catch { /* older server */ }
  const hosts = h('input', { class: 'input', placeholder: 'Other hosts, e.g. 192.168.1.20, nas.local', autocapitalize: 'off', spellcheck: 'false', style: { width: '100%' } });
  const subnet = h('input', { type: 'checkbox', role: 'switch' });
  const results = h('div', { style: { marginTop: '14px' } });
  const scanBtn = h('button', { class: 'btn primary', onclick: () => scan() }, 'Look for services');
  const intro = net.demo
    ? 'In the demo this looks only at the demo’s own apps.'
    : 'Looks on this server, the Docker host, the usual Docker container names (sonarr, radarr, …) and any hosts you add. It only opens each app’s public login page; it never reads or guesses keys.';
  // Neither config.json nor the data folder can be written: check keys, then hand over the lines to add.
  const copyOnly = !net.demo && !net.canSave;
  const body = h('div', {},
    firstRun ? h('p', { style: { margin: '0 0 10px' } }, h('b', {}, 'Nothing is set up yet.'), ' Let’s find your apps.') : null,
    h('p', { class: 'dim', style: { fontSize: '13px', margin: '0 0 10px' } }, intro),
    copyOnly ? h('p', { style: { fontSize: '13px', margin: '0 0 10px' } }, 'This server can’t save services: config.json and the data folder are both read-only. Each app you check gives you the lines to add under "services" in config.json; restart Arr Command Center after editing it.') : null,
    net.demo ? null : hosts,
    net.demo || !net.subnets.length ? null : h('label', { style: { display: 'flex', gap: '8px', alignItems: 'center', fontSize: '13px', marginTop: '10px' } }, subnet,
      `Also check every address on ${net.subnets.slice(0, 2).map((s) => `${s}.0/24`).join(', ')} (can take a minute or two)`),
    h('div', { style: { marginTop: '12px' } }, scanBtn),
    results);
  openModal({ title: 'Find your services', body, wide: true, footer: h('div', { style: { display: 'flex', gap: '8px', justifyContent: 'flex-end', width: '100%' } },
    h('button', { class: 'btn', onclick: () => { closeModal(); if (added) location.reload(); } }, 'Done')) });
  let added = 0;

  async function scan() {
    scanBtn.disabled = true; scanBtn.textContent = 'Looking…';
    mount(results, h('div', { class: 'dim' }, subnet.checked ? 'Checking your network. This can take a minute or two…' : 'Checking…'));
    let d;
    try { d = await api.sendJson('/api/setup/discover', { hosts: hosts.value, subnet: subnet.checked }); }
    catch (e) { mount(results, h('div', { class: 'dim' }, `Could not scan: ${e.message}`)); return; }
    finally { scanBtn.disabled = false; scanBtn.textContent = 'Look again'; }
    const taken = new Set((ctx.state.services || []).map((s) => s.key));
    mount(results,
      h('div', { class: 'dim', style: { fontSize: '12px', margin: '0 0 8px' } }, `Found ${d.found.length} ${d.found.length === 1 ? 'app' : 'apps'} after checking ${d.scanned} addresses.`,
        d.skipped && d.skipped.length ? ` Skipped ${d.skipped.join(', ')} (not found, or not a private address).` : ''),
      d.found.length ? h('div', { class: 'list' }, ...d.found.map((f) => foundRow(f, taken))) : h('p', { class: 'dim' }, 'Nothing found. Add the host your apps run on above, or add a service by hand in Settings → Services.'));
  }

  function foundRow(f, taken) {
    const head = h('div', { class: 'row-main' },
      h('div', { class: 'row-title', style: { fontSize: '14px' } }, f.name, ' ', f.version ? h('span', { class: 'dim', style: { fontSize: '12px' } }, `v${f.version}`) : null, ' ',
        f.existing ? h('span', { class: 'pill muted' }, `already added as ${f.existing}`) : null),
      h('div', { class: 'mono dim', style: { fontSize: '12px' } }, f.baseUrl));
    if (f.existing) return h('div', { class: 'row' }, head);
    const key = h('input', { class: 'input', type: 'password', autocomplete: 'off', placeholder: OPTIONAL_KEY.has(f.type) ? 'API key (optional)' : 'API key', style: { width: '100%' } });
    const user = h('input', { class: 'input', autocomplete: 'off', placeholder: 'Username', style: { flex: '1', minWidth: '120px' } });
    const pass = h('input', { class: 'input', type: 'password', autocomplete: 'off', placeholder: 'Password', style: { flex: '1', minWidth: '120px' } });
    const usesLogin = LOGIN.has(f.type) || f.type === 'qbittorrent';
    const msg = h('div', { style: { fontSize: '12px', marginTop: '6px' } });
    const btn = h('button', { class: 'btn sm primary', title: net.demo ? 'Adding services is turned off in the demo' : '' }, net.canSave ? 'Check and add' : 'Check');
    btn.onclick = async () => {
      const svc = { type: f.type, baseUrl: f.baseUrl, apiKey: key.value.trim(), username: user.value.trim() || undefined, password: pass.value || undefined };
      if (!svc.apiKey && !NO_KEY.has(f.type) && !OPTIONAL_KEY.has(f.type) && !LOGIN.has(f.type) && !PASSWORD_ONLY.has(f.type)) { mount(msg, h('span', { class: 'dim' }, 'Paste the API key first.')); key.focus(); return; }
      btn.disabled = true; mount(msg, h('span', { class: 'dim' }, 'Checking…'));
      try {
        const r = await api.sendJson('/api/setup/check', svc);
        if (!r.ok) { mount(msg, h('span', { style: { color: 'var(--danger, #e5484d)' } }, `Didn’t work: ${r.error}`)); return; }
        if (net.demo) { mount(msg, h('span', { style: { color: 'var(--ok, #30a46c)' } }, `Works${r.version ? ` (v${r.version})` : ''}. Adding is turned off in the demo.`)); return; }
        let k = f.suggestedKey; for (let i = 2; taken.has(k); i++) k = `${f.type}-${i}`;
        const label = (ctx.state.services || []).some((s) => s.label === f.name) ? `${f.name} (${new URL(f.baseUrl).hostname})` : f.name;
        const service = { label, type: f.type, enabled: true, baseUrl: f.baseUrl, apiKey: svc.apiKey };
        if (svc.username) service.username = svc.username;
        if (svc.password) service.password = svc.password;
        if (copyOnly) {
          taken.add(k);
          const lines = `"${k}": ${JSON.stringify(service, null, 2)}`;
          mount(msg, h('span', { style: { color: 'var(--ok, #30a46c)' } }, `Works${r.version ? ` (v${r.version})` : ''}. Add this under "services" in config.json:`),
            h('pre', { class: 'mono', style: { fontSize: '12px', margin: '6px 0 0', padding: '8px', background: 'var(--surface-2)', borderRadius: '8px', whiteSpace: 'pre-wrap', wordBreak: 'break-all' } }, lines),
            h('div', { style: { marginTop: '4px' } }, copyable(lines, 'Copy')));
          return;
        }
        await ctx.api.saveService(k, service);
        taken.add(k); added++;
        ctx.state.config = await ctx.api.config(); ctx.state.services = Object.values(ctx.state.config.services || {});
        mount(row, head, h('span', { class: 'pill ok' }, `Added${r.version ? ` · v${r.version}` : ''}`));
        toast(`Added ${label}`, 'success');
      } catch (e) { mount(msg, h('span', { style: { color: 'var(--danger, #e5484d)' } }, e.message)); }
      finally { btn.disabled = false; }
    };
    const fields = [];
    if (!NO_KEY.has(f.type) && !LOGIN.has(f.type) && !PASSWORD_ONLY.has(f.type)) fields.push(key);
    if (usesLogin) fields.push(h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } }, user, pass));
    if (PASSWORD_ONLY.has(f.type)) fields.push(pass);
    const row = h('div', { class: 'row', style: { flexWrap: 'wrap', alignItems: 'flex-start' } }, head,
      h('div', { style: { flexBasis: '100%', display: 'grid', gap: '6px', marginTop: '6px' } }, ...fields,
        h('div', { class: 'dim', style: { fontSize: '12px' } }, NO_KEY.has(f.type) ? 'No key needed.' : (WHERE[f.type] || 'The app’s API key')),
        h('div', {}, btn), msg));
    return row;
  }
}
