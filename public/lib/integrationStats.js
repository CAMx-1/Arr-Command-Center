// Two-number summaries for the Home hexes of the newer integrations:
// [[value, label], [value, label]]. Each uses the same client as its page.
import {
  portainerClient, glancesClient, piholeClient, adguardClient, syncthingClient, navidromeClient, pulsarrClient, truenasClient, unraidClient,
} from './integrations.js';

const pct = (n) => `${Math.round(Number(n) || 0)}%`;

export const integrationStats = {
  async portainer(api, key) {
    const envs = await portainerClient(api, key).environments();
    const running = envs.reduce((n, e) => n + e.running, 0);
    const unhealthy = envs.reduce((n, e) => n + e.unhealthy, 0);
    return [[running, 'Running'], [unhealthy, 'Unhealthy']];
  },
  async glances(api, key) { const g = await glancesClient(api, key).overview(); return [[pct(g.cpu), 'CPU'], [g.cpuTemp ? `${Math.round(g.cpuTemp.value)}°` : pct(g.mem), g.cpuTemp ? 'CPU temp' : 'Memory']]; },
  async pihole(api, key) { const s = await piholeClient(api, key).summary(); return [[`${s.percent.toFixed(1)}%`, 'Blocked'], [s.blocking === 'enabled' ? 'On' : 'Off', 'Blocking']]; },
  async adguard(api, key) { const a = await adguardClient(api, key).overview(); return [[`${a.percent}%`, 'Blocked'], [a.protection ? 'On' : 'Off', 'Protection']]; },
  async syncthing(api, key) { const o = await syncthingClient(api, key).overview(); return [[o.folders.filter((f) => f.needBytes > 0 || f.state === 'error').length, 'Out of sync'], [`${o.devices.filter((d) => d.connected).length}/${o.devices.length}`, 'Devices']]; },
  async navidrome(api, key) { const n = await navidromeClient(api, key).overview(); return [[n.playing.length, 'Playing'], [n.artists ?? '—', 'Artists']]; },
  async pulsarr(api, key) { const s = await pulsarrClient(api, key).stats(); return [[s.pending ?? 0, 'Pending'], [s.auto_approved ?? 0, 'Auto-approved']]; },
  async truenas(api, key) { const d = await truenasClient(key).overview(); return [[d.pools.filter((p) => !p.healthy || p.status !== 'ONLINE').length, 'Pool issues'], [d.alerts.length, 'Alerts']]; },
  async unraid(api, key) { const u = await unraidClient(api, key).overview(); return [[pct(u.percent), 'Array used'], [u.disks.filter((x) => x.status !== 'DISK_OK' && x.status !== 'DISK_NP').length, 'Disk issues']]; },
};
