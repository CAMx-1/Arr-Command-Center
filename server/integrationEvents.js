// Problem events from the newer integrations, for the notification poller.
// Each event id is stable while the problem lasts, so the poller's "seen"
// set notifies once per problem; a problem that clears and comes back gets a
// new id (it includes a counter-free description of the problem only, so it
// re-fires after it has dropped out of the seen set).
import { serviceGet, serviceRequest } from './proxy.js';
import { truenasOverview } from './truenas.js';

const ev = (key, svc, kind, id, title, body, category = 'problem') => ({
  id: `${key}:${kind}:${id}`, category, title, body: `${svc.label}: ${body}`, url: `/#/${encodeURIComponent(key)}`, at: Date.now(),
});

export async function integrationEvents(key, svc, { allowInsecureTruenas = false } = {}) {
  const s = { ...svc, key };
  const out = [];
  switch (svc.type) {
    case 'portainer': {
      const envs = await serviceGet(s, 'api/endpoints');
      for (const e of envs || []) {
        if (e.Status !== 1) out.push(ev(key, svc, 'env-down', e.Id, 'Docker environment down', `${e.Name} is not reachable`));
        if (e.Status !== 1) continue;
        const cs = await serviceGet(s, `api/endpoints/${e.Id}/docker/containers/json?all=1`).catch(() => []);
        for (const c of cs || []) if (/\(unhealthy\)/i.test(c.Status || '')) out.push(ev(key, svc, 'unhealthy', `${e.Id}:${c.Id}`, 'Container unhealthy', `${String((c.Names || [])[0] || c.Id).replace(/^\//, '')} on ${e.Name}`));
      }
      break;
    }
    case 'pulsarr': {
      const r = await serviceGet(s, 'v1/approval/requests?status=pending&limit=50');
      for (const a of (r && r.approvalRequests) || []) out.push(ev(key, svc, 'approval', a.id, 'Request needs approval', `${a.contentTitle}${a.userName ? ` · ${a.userName}` : ''}`, 'approval'));
      break;
    }
    case 'syncthing': {
      const folders = await serviceGet(s, 'rest/config/folders');
      for (const f of folders || []) {
        if (f.paused) continue;
        const st = await serviceGet(s, `rest/db/status?folder=${encodeURIComponent(f.id)}`).catch(() => null);
        if (st && (st.state === 'error' || st.error)) out.push(ev(key, svc, 'sync-error', f.id, 'Sync folder has an error', `${f.label || f.id}: ${st.error || 'error'}`));
      }
      break;
    }
    case 'pihole': {
      // Uses the proxy's session handling via serviceRequest-compatible GET.
      const b = await piholeBlocking(s);
      if (b && b.blocking === 'disabled' && !b.timer) out.push(ev(key, svc, 'blocking-off', 'x', 'Ad blocking is off', 'Pi-hole blocking was turned off and has no timer'));
      break;
    }
    case 'adguard': {
      const st = await serviceGet(s, 'control/status');
      if (st && st.protection_enabled === false && !st.protection_disabled_until) out.push(ev(key, svc, 'protection-off', 'x', 'Ad blocking is off', 'AdGuard protection was turned off and has no timer'));
      break;
    }
    case 'unraid': {
      const r = await serviceRequest(s, 'graphql', { method: 'POST', body: { query: '{ array { state disks { name status numErrors } parities { name status numErrors } } }' } });
      const a = (r && r.data && r.data.array) || {};
      if (a.state && a.state !== 'STARTED') out.push(ev(key, svc, 'array', a.state, 'Unraid array not started', `state ${String(a.state).toLowerCase().replace(/_/g, ' ')}`));
      for (const d of [...(a.parities || []), ...(a.disks || [])]) {
        if (d.status && d.status !== 'DISK_OK' && d.status !== 'DISK_NP') out.push(ev(key, svc, 'disk', `${d.name}:${d.status}`, 'Unraid disk problem', `${d.name} is ${String(d.status).replace('DISK_', '').toLowerCase()}`));
      }
      break;
    }
    case 'truenas': {
      const o = await truenasOverview(svc, { allowInsecure: allowInsecureTruenas });
      for (const p of o.pools) if (!p.healthy || p.status !== 'ONLINE') out.push(ev(key, svc, 'pool', `${p.name}:${p.status}`, 'TrueNAS pool problem', `${p.name} is ${p.status}`));
      break;
    }
    default:
      break;
  }
  return out;
}

// Pi-hole needs its session login; reuse the proxy by calling it through the
// exported ping-capable fetch (kept small: one GET).
let piholeFetcher = null;
export function setPiholeFetcher(fn) { piholeFetcher = fn; }
async function piholeBlocking(s) {
  if (!piholeFetcher) return null;
  return piholeFetcher(s, 'api/dns/blocking');
}
